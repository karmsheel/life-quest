// The agents a vault runs on.
//
// A vault is the profile that is loaded, and that includes its agent: which
// companion it uses and, for Hermes, which profile that companion runs on are
// the vault's choices, not the app's. The old app-level pickers meant a new
// vault inherited the previous vault's agent — the same Hermes profile, with the
// same memory, skills and knowledge — which is the cross-contamination this
// module ends.
//
// The binding lives in app prefs beside the other per-vault maps (see
// `recent-vaults.ts`), never in the vault: it names a machine-local Hermes
// profile, and a vault copied to another machine must not drag an agent with it.
//
// One companion per vault. A vault starts on Pi; the operator may add one
// Hermes agent (a fresh profile seeded on use, or an existing profile reused with
// a warning that its memory is shared). Reuse is never the default.
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Result } from "@lifequest/vault-core";
import {
  PROFILE_NAME,
  hermesRoot,
  isSafeProfileName,
  listHermesProfiles,
} from "./companion-profile.ts";
import {
  loadPrefs,
  savePrefs,
  setHarnessId,
  type VaultAgentPrefs,
} from "./recent-vaults.ts";
import {
  adoptLegacyPiSessions,
  hasLegacyPiSessions,
} from "./harness/pi-sessions.ts";
import type { HarnessId } from "./harness/types.ts";
import {
  currentVaultScope,
  onVaultScopeChanged,
  type VaultScope,
} from "./vault-scope.ts";

/** Which agent a vault runs on. `hermesProfile` is null while it has none. */
export type VaultAgentBinding = VaultAgentPrefs;

/** One Hermes profile the operator could bind, with the vaults it already works on. */
export type VaultAgentProfile = {
  name: string;
  path: string;
  isDefault: boolean;
  hasSoul: boolean;
  hasConfig: boolean;
  /**
   * The other vaults already bound to this profile. A non-empty list is what
   * the reuse warning names: memory, skills and knowledge will be shared.
   */
  usedBy: { vaultId: string; vaultName: string }[];
};

/** What Settings → Agents in this vault reads in one call. */
export type VaultAgentsState = {
  vaultId: string | null;
  binding: VaultAgentBinding;
  installedProfiles: VaultAgentProfile[];
  vaultOpen: boolean;
};

/** "Create a new agent for this vault" or "use an existing agent". */
export type VaultAgentAddInput =
  | { mode: "fresh"; name?: string }
  | { mode: "existing"; profile: string };

/** What the renderer hears when the agent for the open vault is (re)applied. */
export type CompanionHarnessChanged = {
  harness: HarnessId;
  vaultId: string | null;
};

const MAX_PROFILE_NAME = 64;

const cleanBinding = (): VaultAgentBinding => ({ harness: "pi", hermesProfile: null });

function normalise(record: VaultAgentPrefs | null | undefined): VaultAgentBinding {
  if (!record) return cleanBinding();
  const harness: HarnessId = record.harness === "hermes" ? "hermes" : "pi";
  const profile = record.hermesProfile?.trim();
  const validProfile = profile && isSafeProfileName(profile) ? profile : null;
  // A Hermes harness without a profile is not an agent the vault can answer
  // with; it reads back as the clean default rather than as Hermes on nothing.
  if (harness === "hermes" && !validProfile) return cleanBinding();
  return { harness, hermesProfile: validProfile };
}

// The binding of the open vault, kept so a synchronous question ("does this
// vault offer Hermes in the switcher?") does not have to wait on a prefs read.
let cached: VaultAgentBinding | null = null;
let cachedVaultId: string | null = null;

// A switch moves the answer to a different vault; this cache belongs to the one
// it was read for.
onVaultScopeChanged((scope) => {
  if (scope?.id !== cachedVaultId) {
    cached = null;
    cachedVaultId = null;
  }
});

/**
 * The open vault's binding, if it has been read yet.
 *
 * For synchronous callers only — the harness switcher's filter. A null answer
 * means "not read for this vault yet", never "clean vault".
 */
export function currentVaultAgentBinding(): VaultAgentBinding | null {
  return cached && cachedVaultId === currentVaultScope()?.id ? cached : null;
}

/**
 * The app-level binding, read only before a vault exists (the setup screen).
 * `effectiveHarness` is the harness the registry resolved at boot, so an install
 * that never chose one still reads back the agent it is actually running.
 */
async function legacyBinding(effectiveHarness?: HarnessId): Promise<VaultAgentBinding> {
  const prefs = await loadPrefs();
  const harness: HarnessId =
    effectiveHarness ?? (prefs.harness === "hermes" ? "hermes" : "pi");
  const profile = prefs.companionProfile?.trim();
  return normalise({
    harness,
    hermesProfile: harness === "hermes" ? profile || PROFILE_NAME : null,
  });
}

/**
 * A vault's agent. An absent entry materialises the clean default (Pi, no
 * Hermes agent); the read never writes, so asking cannot change a vault.
 */
export async function getVaultAgentBinding(
  vaultId: string | null,
): Promise<VaultAgentBinding> {
  if (vaultId === null) return legacyBinding();
  if (cached && cachedVaultId === vaultId) return cached;
  const prefs = await loadPrefs();
  const binding = normalise(prefs.vaultAgents?.[vaultId]);
  cached = binding;
  cachedVaultId = vaultId;
  return binding;
}

export async function setVaultAgentBinding(
  vaultId: string,
  next: VaultAgentBinding,
): Promise<void> {
  const binding = normalise(next);
  const prefs = await loadPrefs();
  await savePrefs({
    ...prefs,
    vaultAgents: { ...(prefs.vaultAgents ?? {}), [vaultId]: binding },
  });
  cached = binding;
  cachedVaultId = vaultId;
}

/**
 * Remember the operator's companion choice in the place that owns it: the open
 * vault's binding, or the app-level prefs before a vault exists (the setup
 * screen, and the one-time adoption). The registry calls this before it swaps
 * the active agent.
 *
 * Hermes is not a choice in a vault that has no Hermes agent, so a switch to it
 * there is not remembered: binding a profile is the explicit "use an agent" step
 * and must not happen by accident.
 */
export async function persistHarnessChoice(harness: HarnessId): Promise<void> {
  const scope = currentVaultScope();
  if (!scope) {
    await setHarnessId(harness);
    return;
  }
  const binding = await getVaultAgentBinding(scope.id);
  if (harness === "hermes" && !binding.hermesProfile) return;
  await setVaultAgentBinding(scope.id, { ...binding, harness });
}

/** What the adopting vault inherits, decided before its own open is recorded. */
export type LegacyAdoption = {
  /** The app already had chats, a recent vault, or an agent choice. */
  legacyInstall: boolean;
  /** The harness the registry resolved at boot — the install's effective choice. */
  effectiveHarness?: HarnessId;
};

/**
 * Whether there is a pre-vault world to adopt.
 *
 * Called BEFORE the opening vault is recorded as recent: after that, every
 * install looks like it had a previous vault, and a fresh install whose machine
 * happens to have Hermes on PATH would bind the shared `lifequest` agent on its
 * very first open — the default reuse the operator ruled out. Each vault starts
 * clean; reusing an agent is always the explicit "use an existing agent" step.
 */
export async function detectLegacyInstall(): Promise<boolean> {
  const prefs = await loadPrefs();
  if (prefs.recent.length > 0) return true;
  if (prefs.harness !== undefined || prefs.companionProfile !== undefined) {
    return true;
  }
  return hasLegacyPiSessions();
}

/**
 * The one-time move of the pre-vault world into the vault that is open now.
 *
 * Before this change chats and agents followed the app: Pi's flat
 * `pi-sessions/*.json` and the single Hermes profile. The vault open at the
 * upgrade keeps them, so nothing is lost; every other vault starts clean.
 *
 * `legacyInstall` is the install's own history, captured before this open; a
 * fresh install gets a clean Pi binding and no files are moved, because there is
 * nothing of its own to keep. For a real legacy install, `effectiveHarness` is
 * the harness the registry resolved at boot — an install that never chose one
 * was resolved by probing this machine, and that answer is the install's
 * effective choice. A Pi vault records no Hermes profile even when the old app
 * remembered one: reusing that agent later is the explicit "use an existing
 * agent" step, never a silent migration.
 */
export async function adoptLegacyVaultDataOnce(
  openedVaultId: string,
  adoption: LegacyAdoption = { legacyInstall: false },
): Promise<void> {
  const prefs = await loadPrefs();
  if (prefs.vaultAgentsMigrated) return;
  const legacyHarness: HarnessId =
    adoption.effectiveHarness ??
    (prefs.harness === "hermes" ? "hermes" : "pi");
  const legacyProfile = prefs.companionProfile?.trim();
  const binding = adoption.legacyInstall
    ? normalise({
        harness: legacyHarness,
        hermesProfile:
          legacyHarness === "hermes" ? legacyProfile || PROFILE_NAME : null,
      })
    : cleanBinding();
  if (adoption.legacyInstall) {
    await adoptLegacyPiSessions(openedVaultId);
  }
  await savePrefs({
    ...prefs,
    vaultAgents: { ...(prefs.vaultAgents ?? {}), [openedVaultId]: binding },
    vaultAgentsMigrated: true,
  });
  cached = binding;
  cachedVaultId = openedVaultId;
}

/**
 * Make the open vault's binding the running one, on vault open.
 *
 * "The bound profile" is not copied into module state here: `companion.ts`
 * reads the open vault's binding when it needs the profile, so the vault is the
 * single source of truth and there is no second copy to go stale. Applying the
 * harness is awaited (it is module state plus one prefs read); the agent's
 * `ensure` is fired in the background by the registry, so a gateway that is slow
 * — or refuses to start — is a status the operator can read, never a reason to
 * keep the previous vault's chats or to fail the open.
 */
export async function applyVaultAgentBinding(scope: VaultScope): Promise<void> {
  const binding = await getVaultAgentBinding(scope.id);
  // The registry reads this module (it persists the operator's switch and
  // publishes the change), so importing it statically would close a cycle.
  // This is the only call site that needs it, and it runs long after both
  // modules are loaded.
  const { applyHarnessSelection } = await import("./harness/facade.ts");
  await applyHarnessSelection(binding.harness);
}

/** The open vault's folder name, for a generated profile name. */
async function vaultNameOf(scope: VaultScope): Promise<string> {
  const prefs = await loadPrefs();
  const recent = prefs.recent.find((entry) => entry.id === scope.id);
  const named = recent?.name?.trim();
  return named || path.basename(scope.rootPath) || "vault";
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug || "vault";
}

/** The vault's id, short enough to live in a profile name. */
function shortVaultId(vaultId: string): string {
  const short = vaultId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
  return short || randomUUID().replace(/-/g, "").slice(0, 8);
}

/**
 * `lifequest-<vault slug>-<vault id>`, never an installed profile's name.
 *
 * The vault's identity is the suffix on purpose: a fresh profile is this vault's
 * agent, and the name says which vault. If an installed profile somehow already
 * has the name, random characters are appended rather than adopting it — a
 * generated name must never bind a profile that already has memory.
 */
function freshProfileName(
  vaultName: string,
  vaultId: string,
  taken: Set<string>,
): string {
  const base = `lifequest-${slugify(vaultName)}-${shortVaultId(vaultId)}`.slice(
    0,
    MAX_PROFILE_NAME,
  );
  let candidate = base.replace(/-+$/g, "");
  while (taken.has(candidate) || !isSafeProfileName(candidate)) {
    candidate = `${base.slice(0, MAX_PROFILE_NAME - 7)}-${randomUUID()
      .replace(/-/g, "")
      .slice(0, 6)}`;
  }
  return candidate;
}

/**
 * Bind a Hermes agent to the open vault.
 *
 * `fresh` names a profile that does not exist yet; the companion's existing
 * `ensure` seeds it (SOUL, MCP entry, eager tool search) the first time it is
 * used, exactly as it does for the app's own `lifequest` profile. `existing`
 * binds an installed profile — the only path by which two vaults share an agent,
 * which is why the caller has to see the warning first.
 *
 * Adding an agent makes it AVAILABLE to the vault; it does not make it the
 * agent the vault answers with. The binding's `harness` is left as it is (on a
 * clean vault, Pi), so a reload keeps the vault on the companion it was on and
 * the operator activates the new agent with an explicit "Use Hermes". Binding a
 * profile and switching to it are two different decisions.
 */
export async function addHermesAgentToVault(
  input: VaultAgentAddInput,
): Promise<Result<VaultAgentBinding>> {
  const scope = currentVaultScope();
  if (!scope) return { ok: false, error: "No vault is open" };
  const request = (input ?? {}) as {
    mode?: unknown;
    name?: unknown;
    profile?: unknown;
  };
  const installed = await listHermesProfiles(
    hermesRoot(process.env, os.homedir()),
  );
  const taken = new Set(installed.map((profile) => profile.name));

  let profile: string;
  if (request.mode === "existing") {
    const requested =
      typeof request.profile === "string" ? request.profile.trim() : "";
    if (!isSafeProfileName(requested)) {
      return { ok: false, error: `Not a usable profile name: "${requested}"` };
    }
    if (!taken.has(requested)) {
      return {
        ok: false,
        error: `No installed Hermes profile named "${requested}".`,
      };
    }
    profile = requested;
  } else if (request.mode === "fresh") {
    const requested =
      typeof request.name === "string" ? request.name.trim() : "";
    if (requested) {
      if (!isSafeProfileName(requested)) {
        return {
          ok: false,
          error: `Not a usable profile name: "${requested}"`,
        };
      }
      if (taken.has(requested)) {
        return {
          ok: false,
          error: `A Hermes profile named "${requested}" already exists.`,
        };
      }
      profile = requested;
    } else {
      profile = freshProfileName(await vaultNameOf(scope), scope.id, taken);
    }
  } else {
    return { ok: false, error: "Unknown agent mode" };
  }

  const current = await getVaultAgentBinding(scope.id);
  const binding: VaultAgentBinding = {
    harness: current.harness,
    hermesProfile: profile,
  };
  await setVaultAgentBinding(scope.id, binding);
  return { ok: true, value: binding };
}

/**
 * Take the Hermes agent away from the open vault.
 *
 * The vault falls back to Pi — it has one companion, and removing the agent is
 * not "choose another". The binding is applied at once, so the switcher and the
 * dock cannot keep pointing at an agent this vault no longer has.
 */
export async function removeHermesAgentFromVault(): Promise<
  Result<VaultAgentBinding>
> {
  const scope = currentVaultScope();
  if (!scope) return { ok: false, error: "No vault is open" };
  const binding = cleanBinding();
  await setVaultAgentBinding(scope.id, binding);
  await applyVaultAgentBinding(scope);
  return { ok: true, value: binding };
}

/** Every installed profile, with the vaults each one already works on. */
export async function listReusableProfiles(
  vaultId: string | null,
): Promise<VaultAgentProfile[]> {
  const profiles = await listHermesProfiles(
    hermesRoot(process.env, os.homedir()),
  );
  const prefs = await loadPrefs();
  const bindings = prefs.vaultAgents ?? {};
  const nameOf = (id: string) =>
    prefs.recent.find((entry) => entry.id === id)?.name ?? id;
  return profiles.map((profile) => ({
    name: profile.name,
    path: profile.path,
    isDefault: profile.isDefault,
    hasSoul: profile.hasSoul,
    hasConfig: profile.hasConfig,
    usedBy: Object.entries(bindings)
      .filter(
        ([id, binding]) =>
          // Bound, not necessarily chosen: a Pi vault can hold an agent it has
          // not switched to yet, and that vault still shares the profile's memory.
          id !== vaultId && binding.hermesProfile === profile.name,
      )
      .map(([id]) => ({ vaultId: id, vaultName: nameOf(id) })),
  }));
}

/** The renderer's one read for Settings → Agents in this vault. */
export async function vaultAgentsState(
  activeHarness?: HarnessId,
): Promise<VaultAgentsState> {
  const scope = currentVaultScope();
  const vaultId = scope?.id ?? null;
  return {
    vaultId,
    binding: vaultId
      ? await getVaultAgentBinding(vaultId)
      : await legacyBinding(activeHarness),
    installedProfiles: await listReusableProfiles(vaultId),
    vaultOpen: scope !== null,
  };
}

// ── The push to the renderer ──────────────────────────────────────────

const harnessChangedListeners = new Set<
  (payload: CompanionHarnessChanged) => void
>();

/** Returns the unsubscribe. */
export function onHarnessChanged(
  listener: (payload: CompanionHarnessChanged) => void,
): () => void {
  harnessChangedListeners.add(listener);
  return () => {
    harnessChangedListeners.delete(listener);
  };
}

/**
 * Tell every window the agent for the open vault is now this one.
 *
 * A vault open applies its binding without the renderer asking, so a studio
 * already on screen has to hear that "the companion" is a different agent — the
 * harness id can move while neither agent's status does. A vault switch itself
 * is carried by the vault snapshot; this event is only about the agent.
 */
export function publishHarnessChanged(payload: CompanionHarnessChanged): void {
  for (const listener of [...harnessChangedListeners]) {
    try {
      listener(payload);
    } catch {
      // One broken listener must not keep the others from hearing it.
    }
  }
}
