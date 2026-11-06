// Which companion the studio is talking to.
//
// The choice is one per app, not per vault and not per chat: a session belongs
// to the harness that made it, so switching changes which set of chats you are
// looking at. It is stored in app prefs (a setting, not vault data).
import os from "node:os";
import type { AgentHarness } from "./agent-harness.ts";
import { hermesHarness } from "./hermes-harness.ts";
import { piHarness } from "./pi-harness.ts";
import { resolveHermesCli } from "../companion-profile.ts";
import { readPiSettings } from "./pi-settings.ts";
import { getHarnessId, setHarnessId } from "../recent-vaults.ts";
import { publishHarnessStatus } from "./status-bus.ts";
import type { HarnessId, HarnessStatus, HarnessSummary } from "./types.ts";

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

/** Switch companion, persist it, and bring the new one up. */
export async function useHarness(id: HarnessId): Promise<HarnessStatus> {
  active = id;
  hydrated = true;
  try {
    await setHarnessId(id);
  } catch {
    // The switch still holds for this run.
  }
  const status = await byId[id].ensure();
  return publishHarnessStatus(status);
}

export function harnessSummaries(): HarnessSummary[] {
  return [
    {
      id: "hermes",
      name: "Hermes",
      blurb: "External sidekick",
      kind: "external",
      active: active === "hermes",
      icon: "hermes",
    },
    {
      id: "pi",
      name: "Pi",
      blurb: "Built in",
      kind: "embedded",
      active: active === "pi",
      icon: "pi",
    },
  ];
}

/** Both, on quit: a harness that is not active may still hold a child or a socket. */
export async function shutdownHarnesses(): Promise<void> {
  await Promise.allSettled([hermesHarness.shutdown(), piHarness.shutdown()]);
}
