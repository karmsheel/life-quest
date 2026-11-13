// Which companion the studio is talking to.
//
// The choice belongs to the vault: a session belongs to the harness that made
// it, and a vault is the profile that is loaded, so a new vault never inherits
// the previous vault's agent. The binding itself lives in app prefs beside the
// other per-vault maps (`vault-agents.ts`); this module owns the running choice
// — the active harness, its status, and the switch.
import os from "node:os";
import type { AgentHarness } from "./agent-harness.ts";
import { hermesHarness } from "./hermes-harness.ts";
import { piHarness } from "./pi-harness.ts";
import { resolveHermesCli } from "../companion-profile.ts";
import { readPiSettings } from "./pi-settings.ts";
import { getHarnessId } from "../recent-vaults.ts";
import {
  currentVaultAgentBinding,
  persistHarnessChoice,
  publishHarnessChanged,
} from "../vault-agents.ts";
import { currentVaultScope } from "../vault-scope.ts";
import { lastHarnessStatus, publishHarnessStatus } from "./status-bus.ts";
import type { HarnessId, HarnessStatus, HarnessSummary, HarnessTurnCapabilities } from "./types.ts";

/**
 * Hermes until the app decides otherwise.
 *
 * Hydration below is main-process boot's job, and a module that calls the
 * facade directly — a rig bundling the companion path, a test harness — never
 * runs that boot. Those callers were written against the external companion, so
 * the unhydrated answer has to be the one they were written for. A fresh
 * machine without the CLI changes this at boot, in `loadHarnessSelection`.
 */
let active: HarnessId = "hermes";
let hydrated = false;

const byId: Record<HarnessId, AgentHarness> = {
  hermes: hermesHarness,
  pi: piHarness,
};

export function activeHarness(): AgentHarness {
  return byId[active];
}

export function activeHarnessId(): HarnessId {
  return active;
}

/**
 * Read the stored choice once.
 *
 * An operator who has never chosen gets whichever companion this machine can
 * actually run: Hermes if the CLI is installed (the app they already have),
 * the built-in one otherwise (the app that works on a fresh machine). Defaulting
 * everyone to the new one would move a working install onto a setup screen.
 */
export async function loadHarnessSelection(): Promise<HarnessId> {
  if (hydrated) return active;
  hydrated = true;
  try {
    const stored = await getHarnessId();
    if (stored === "hermes" || stored === "pi") {
      active = stored;
      return active;
    }
  } catch {
    // An unreadable prefs file falls through to the probe.
  }
  // Pi is the app's main agent. The one exception is a machine that already has
  // Hermes working and no Pi endpoint configured: landing such an operator on
  // Pi's setup screen would take a working app away from them, so the existing
  // install keeps the companion it has until they choose Pi.
  try {
    const configuredPi = (await readPiSettings()).model.trim() !== "";
    const cli = await resolveHermesCli(process.env, os.homedir());
    active = configuredPi || !cli ? "pi" : "hermes";
  } catch {
    active = "pi";
  }
  return active;
}

/**
 * Whether the open vault has a Hermes agent at all.
 *
 * Hermes is not a choice in a vault with no Hermes agent: the switcher omits it
 * (`harnessSummaries`), and a direct bridge call has to be answered the same
 * way. Honouring one would leave the running harness saying Hermes while the
 * vault's binding says Pi — a state nothing in the app can show or repair.
 * Before a vault exists (the setup screen) both are the operator's to choose.
 */
function hermesAvailableHere(): boolean {
  const scope = currentVaultScope();
  return scope === null || currentVaultAgentBinding()?.hermesProfile != null;
}

/** The answer to "switch to Hermes" in a vault that has no Hermes agent. */
function noHermesAgentStatus(): HarnessStatus {
  return {
    kind: "needs_setup",
    message:
      "This vault has no Hermes agent. Add one in Settings › Agents in this vault, or keep using Pi.",
  };
}

/**
 * Switch companion, persist it, and bring the new one up — the BOOT path.
 *
 * The boot and the setup screen wait for the answer, because their job is to
 * report a failure in the agent's own words (no CLI, no key, a port that is
 * busy). A switch made from the studio must not wait: see `switchHarness`.
 */
export async function useHarness(id: HarnessId): Promise<HarnessStatus> {
  if (id === "hermes" && !hermesAvailableHere()) return noHermesAgentStatus();
  active = id;
  hydrated = true;
  await rememberChoice(id);
  publishHarnessChanged({
    harness: id,
    vaultId: currentVaultScope()?.id ?? null,
  });
  const status = await byId[id].ensure();
  return publishHarnessStatus(id, status);
}

/**
 * Remember the choice without letting a prefs write decide whether the switch
 * holds: the agent is running for this session either way.
 */
async function rememberChoice(id: HarnessId): Promise<void> {
  try {
    await persistHarnessChoice(id);
  } catch {
    // The switch still holds for this run.
  }
}

/**
 * Publish a `switching` answer and let the target's own verdict land later.
 *
 * A switch does not wait for the target to boot: holding the studio still while
 * a gateway restarted looked exactly like a reconnection. The ensure publishes
 * its own verdict (tagged with its agent) and a throw is still a status the
 * operator can read.
 */
function bringUpInBackground(id: HarnessId, answer: HarnessStatus): HarnessStatus {
  publishHarnessStatus(id, answer);
  void byId[id]
    .ensure()
    .then((status) => publishHarnessStatus(id, status))
    .catch(() => publishHarnessStatus(id, { kind: "disconnected" }));
  return answer;
}

/**
 * Switch companion from the app that is already open.
 *
 * The choice flips at once, the answer is whatever the target last reported
 * (or a `switching` status when it has never answered), and the ensure runs in
 * the background. Owners that are already up keep running: an agent is a
 * service, not a page.
 */
export async function switchHarness(id: HarnessId): Promise<HarnessStatus> {
  if (id === "hermes" && !hermesAvailableHere()) return noHermesAgentStatus();
  if (active === id) return lastHarnessStatus(id) ?? byId[id].status();
  active = id;
  hydrated = true;
  await rememberChoice(id);
  publishHarnessChanged({
    harness: id,
    vaultId: currentVaultScope()?.id ?? null,
  });
  return bringUpInBackground(
    id,
    lastHarnessStatus(id) ?? { kind: "switching", harness: id },
  );
}

/**
 * Make the open vault's bound agent the running one.
 *
 * Called on vault open, after its binding has been settled. Module state and the
 * change push only — the vault already remembers the choice, so nothing is
 * persisted here — and the answer is always `switching`: a status from the
 * previous vault's agent is not this one's answer, even when the harness id
 * happens to be the same.
 */
export async function applyHarnessSelection(id: HarnessId): Promise<HarnessStatus> {
  active = id;
  hydrated = true;
  publishHarnessChanged({
    harness: id,
    vaultId: currentVaultScope()?.id ?? null,
  });
  return bringUpInBackground(id, { kind: "switching", harness: id });
}

/**
 * The per-harness capability facts, kept beside the summaries so there is one
 * place to update when a harness gains a frame. These are claims about what the
 * adapter can emit today, not what the vendor could theoretically provide.
 */
const PI_CAPABILITIES: HarnessTurnCapabilities = {
  toolRows: true,
  toolArgs: true,
  toolCallIds: true,
  toolResultsLive: true,
  toolResultsOnSettle: true,
  toolDurations: true,
  toolProgress: true,
  reasoning: "delta",
  commentary: true,
  steps: true,
  usage: true,
  history: true,
  approvals: true,
  steering: true,
};

const HERMES_CAPABILITIES: HarnessTurnCapabilities = {
  toolRows: true,
  toolArgs: true,
  // The session chat stream carries no tool_call_id on tool.started/completed.
  toolCallIds: false,
  toolResultsLive: false,
  // The terminal run.<status> row carries the turn's transcript, results included.
  toolResultsOnSettle: true,
  toolDurations: false,
  toolProgress: false,
  // The session route's thinking is a sampled preview, not a delta stream.
  reasoning: "preview",
  // Forwarded only when the runtime emits assistant.commentary.
  commentary: true,
  steps: false,
  usage: true,
  history: true,
  approvals: true,
  steering: true,
};

export function harnessSummaries(): HarnessSummary[] {
  // A vault with no Hermes agent does not offer Hermes: the pill is absent, not
  // greyed out, because there is no agent behind it to switch to. Before a vault
  // exists (the setup screen and the app-less harness pages) both are the
  // operator's to choose from, exactly as they were.
  const scope = currentVaultScope();
  const hermesOffered =
    scope === null || currentVaultAgentBinding()?.hermesProfile != null;
  const rows: HarnessSummary[] = [
    {
      id: "hermes",
      name: "Hermes",
      blurb: "External sidekick",
      kind: "external",
      active: active === "hermes",
      icon: "hermes",
      capabilities: HERMES_CAPABILITIES,
    },
    {
      id: "pi",
      name: "Pi",
      blurb: "Built in",
      kind: "embedded",
      active: active === "pi",
      icon: "pi",
      capabilities: PI_CAPABILITIES,
    },
  ];
  return rows.filter((row) => row.id !== "hermes" || hermesOffered);
}

/** Both, on quit: a harness that is not active may still hold a child or a socket. */
export async function shutdownHarnesses(): Promise<void> {
  await Promise.allSettled([hermesHarness.shutdown(), piHarness.shutdown()]);
}
