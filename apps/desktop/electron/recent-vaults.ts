import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

function localIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type RecentEntry = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
};

/**
 * Which agent a vault runs on. `hermesProfile` names a machine-local Hermes
 * profile, which is why this lives in app prefs and never in the vault: a vault
 * copied to another machine must not drag an agent's profile with it.
 */
export type VaultAgentPrefs = {
  harness: "hermes" | "pi";
  hermesProfile: string | null;
};

export type UserPrefs = {
  recent: RecentEntry[];
  activeDomainByVaultId: Record<string, string>;
  deadlineDismissedOnByVaultId: Record<string, string>;
  deadlineNotifiedOnByVaultId: Record<string, string>;
  /**
   * Each vault's agent choice, keyed by the vault's stable id. An absent entry
   * means a clean vault (Pi, no Hermes agent) — never "inherit the last one".
   */
  vaultAgents?: Record<string, VaultAgentPrefs>;
  /**
   * The one-time move of the pre-vault world (flat Pi chats, the single Hermes
   * profile) into the vault that was open at the upgrade. True once it has run.
   */
  vaultAgentsMigrated?: boolean;
  /**
   * The Hermes profile the companion runs on (see `companionUseProfile`).
   * Absent means the app's own `lifequest` profile, which is what every
   * install used before the picker existed — so an older prefs file keeps
   * behaving exactly as it did.
   */
  companionProfile?: string;
  /**
   * Which companion the studio talks to: the built-in one or the external
   * Hermes gateway. Absent means "never chosen", which the registry resolves by
   * asking whether Hermes is installed — so an existing install keeps working
   * and a fresh machine gets the built-in companion.
   */
  harness?: "hermes" | "pi";
};

const MAX_RECENT = 20;

function prefsPath(): string {
  return path.join(app.getPath("userData"), "recent.json");
}

const emptyPrefs = (): UserPrefs => ({
  recent: [],
  activeDomainByVaultId: {},
  deadlineDismissedOnByVaultId: {},
  deadlineNotifiedOnByVaultId: {},
});

/**
 * One stored binding, validated.
 *
 * `harness` says which agent the vault is answering with right now; a Hermes
 * profile may be bound without being chosen yet (the pill exists, the vault is
 * still on Pi), so the profile is kept independently of the harness. A Hermes
 * harness with no usable profile is not a Hermes agent at all, so that record
 * reads back as the clean default. Only this app writes these; the check is for
 * a file that was hand-edited or written by a future version.
 */
function readVaultAgent(value: unknown): VaultAgentPrefs | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { harness?: unknown; hermesProfile?: unknown };
  if (record.harness !== "hermes" && record.harness !== "pi") return null;
  const profile =
    typeof record.hermesProfile === "string" && record.hermesProfile.trim()
      ? record.hermesProfile.trim()
      : null;
  if (record.harness === "hermes" && !profile) return null;
  return { harness: record.harness, hermesProfile: profile };
}

function readVaultAgents(value: unknown): Record<string, VaultAgentPrefs> {
  const out: Record<string, VaultAgentPrefs> = {};
  if (!value || typeof value !== "object") return out;
  for (const [vaultId, record] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const binding = readVaultAgent(record);
    if (binding) out[vaultId] = binding;
  }
  return out;
}

export async function loadPrefs(): Promise<UserPrefs> {
  try {
    const raw = await fs.readFile(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      activeDomainByVaultId:
        parsed.activeDomainByVaultId &&
        typeof parsed.activeDomainByVaultId === "object"
          ? parsed.activeDomainByVaultId
          : {},
      deadlineDismissedOnByVaultId:
        parsed.deadlineDismissedOnByVaultId &&
        typeof parsed.deadlineDismissedOnByVaultId === "object"
          ? parsed.deadlineDismissedOnByVaultId
          : {},
      deadlineNotifiedOnByVaultId:
        parsed.deadlineNotifiedOnByVaultId &&
        typeof parsed.deadlineNotifiedOnByVaultId === "object"
          ? parsed.deadlineNotifiedOnByVaultId
          : {},
      // Every field this reader drops is a field `savePrefs` will erase on the
      // next write, and the profile choice is the one that hurts: the picker's
      // choice was written on switch and then read back as absent, so a relaunch
      // silently reverted the companion to `lifequest` — and any later write to
      // the same file (an active domain, a dismissed deadline) dropped it for
      // good. Read it, keep it.
      ...(typeof parsed.companionProfile === "string"
        ? { companionProfile: parsed.companionProfile }
        : {}),
      // Same rule as the profile: a field this reader drops is a field the next
      // write erases. The harness choice must survive an unrelated prefs write.
      ...(parsed.harness === "hermes" || parsed.harness === "pi"
        ? { harness: parsed.harness }
        : {}),
      // The same rule again, and this one loses agent bindings if broken: a
      // vault's claim on a Hermes profile must survive a lens or deadline write.
      ...(parsed.vaultAgents !== undefined
        ? { vaultAgents: readVaultAgents(parsed.vaultAgents) }
        : {}),
      ...(parsed.vaultAgentsMigrated === true
        ? { vaultAgentsMigrated: true }
        : {}),
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyPrefs();
    }
    throw e;
  }
}

export async function savePrefs(prefs: UserPrefs): Promise<void> {
  const file = prefsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

/** Touch or insert a recent vault entry (most-recent-first). */
export async function recordRecentVault(entry: {
  id: string;
  name: string;
  path: string;
}): Promise<void> {
  const prefs = await loadPrefs();
  const now = new Date().toISOString();
  const next: RecentEntry = {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    lastOpenedAt: now,
  };
  const filtered = prefs.recent.filter(
    (r) => r.id !== entry.id && r.path !== entry.path,
  );
  prefs.recent = [next, ...filtered].slice(0, MAX_RECENT);
  await savePrefs(prefs);
}

export async function listRecentVaults(): Promise<RecentEntry[]> {
  const prefs = await loadPrefs();
  return prefs.recent;
}

export async function getActiveDomain(vaultId: string): Promise<string | null> {
  const prefs = await loadPrefs();
  return prefs.activeDomainByVaultId[vaultId] ?? null;
}

export async function setActiveDomain(
  vaultId: string,
  slug: string | null,
): Promise<void> {
  const prefs = await loadPrefs();
  if (slug === null) {
    delete prefs.activeDomainByVaultId[vaultId];
  } else {
    prefs.activeDomainByVaultId[vaultId] = slug;
  }
  await savePrefs(prefs);
}

export async function getDeadlineDismissedOn(vaultId: string): Promise<string | null> {
  const prefs = await loadPrefs();
  return prefs.deadlineDismissedOnByVaultId[vaultId] ?? null;
}

export async function setDeadlineDismissedOn(vaultId: string): Promise<void> {
  const prefs = await loadPrefs();
  prefs.deadlineDismissedOnByVaultId[vaultId] = localIsoDate();
  await savePrefs(prefs);
}

export async function getDeadlineNotifiedOn(vaultId: string): Promise<string | null> {
  const prefs = await loadPrefs();
  return prefs.deadlineNotifiedOnByVaultId[vaultId] ?? null;
}

export async function setDeadlineNotifiedOn(vaultId: string): Promise<void> {
  const prefs = await loadPrefs();
  prefs.deadlineNotifiedOnByVaultId[vaultId] = localIsoDate();
  await savePrefs(prefs);
}

/** The Hermes profile the companion runs on; null = the app's own `lifequest`. */
export async function getCompanionProfile(): Promise<string | null> {
  const prefs = await loadPrefs();
  const name = prefs.companionProfile?.trim();
  return name ? name : null;
}

export async function setCompanionProfile(name: string): Promise<void> {
  const prefs = await loadPrefs();
  prefs.companionProfile = name;
  await savePrefs(prefs);
}

/** The companion the operator chose; null = never chosen, let the registry probe. */
export async function getHarnessId(): Promise<"hermes" | "pi" | null> {
  const prefs = await loadPrefs();
  return prefs.harness ?? null;
}

export async function setHarnessId(id: "hermes" | "pi"): Promise<void> {
  const prefs = await loadPrefs();
  prefs.harness = id;
  await savePrefs(prefs);
}
