/**
 * The dock's tab strip, remembered between runs — per vault and per agent.
 *
 * The strip is the operator's working set: every chat they had open, in the
 * order the tabs were made, and the one that was in front. That set used to live
 * only in the provider's React state, so quitting the app threw all but the last
 * chat away — the landing reopened that one and the other tabs were lost. This
 * module is the memory: the provider reads it when it lands and writes it back
 * whenever the strip or the tab in front changes.
 *
 * Chats belong to a vault now, so the strip does too: a tab id is a chat the
 * open vault's agent made, and restoring it onto another vault would ask for a
 * chat that vault has never heard of. The key therefore carries the vault's
 * stable identity (`VaultSnapshot.lifequest.id`, not its path — a copied vault
 * keeps its identity) AND the agent: the two agents' chats cannot share a strip
 * either, because restoring Hermes ids onto Pi would ask for chats Pi has never
 * heard of, and a switch that cleared the strip threw away the other agent's
 * working set for good.
 *
 * A landing with no agent is the app-less case: a harness page (the e2e rigs)
 * mounts the dock with only the IPC bridge stubbed and no companion provider at
 * all, so no agent is ever chosen. Those pages keep the pre-vault slots — even
 * when their stub bridge answers with a snapshot — so their behaviour is exactly
 * what it always was, cleanup included. The app never lands without an agent:
 * the harness list is read above the studio gate.
 *
 * The pre-vault keys the shipped app used (`lifequest.companion.openTabs`,
 * `lifequest.companion.openTabs.<agent>`, `lifequest.companion.lastSessionId`)
 * are deliberately not read for a vault: their strip names chats from whichever
 * vault happened to be open when they were written. Losing that memory costs
 * open-tab order, never chats — the list the landing reads is the truth.
 *
 * Only what the strip itself knows is stored: ids and order. Whether a
 * remembered chat still exists is the agent's answer, so the landing filters
 * the stored ids against the list it just read (`restoredChatTabs`) rather than
 * trusting the memory. A chat deleted or archived elsewhere while this app was
 * shut is dropped from the strip instead of coming back as a tab with no thread
 * behind it.
 */
import type { HarnessId } from "@/vite-env";

/** The pre-vault slots, still used by the app-less harness pages. */
const LEGACY_CHAT_TABS_KEY = "lifequest.companion.openTabs";
const LEGACY_LAST_SESSION_KEY = "lifequest.companion.lastSessionId";

/** One strip per vault and agent: `lifequest.companion.openTabs.<vaultId>.hermes`. */
const CHAT_TABS_PREFIX = "lifequest.companion.openTabs.";
const LAST_SESSION_PREFIX = "lifequest.companion.lastSessionId.";

function keyFor(vaultId: string | null, agent: HarnessId | null): string {
  // No agent is a harness page, not a vault with an unknown agent: the app's
  // studio never opens before the companion names its harness.
  if (!vaultId || !agent) {
    return agent ? `${CHAT_TABS_PREFIX}${agent}` : LEGACY_CHAT_TABS_KEY;
  }
  return `${CHAT_TABS_PREFIX}${vaultId}.${agent}`;
}

function lastSessionKeyFor(vaultId: string | null, agent: HarnessId | null): string {
  if (!vaultId || !agent) return LEGACY_LAST_SESSION_KEY;
  return `${LAST_SESSION_PREFIX}${vaultId}`;
}

/** The strip as it was stored, or `known: false` when none was. */
export type StoredChatTabs = {
  /** Whether this profile has ever written a strip. */
  known: boolean;
  /** The tab ids, in tab order, deduped. */
  tabs: string[];
  /** The tab that was in front, or null. */
  activeId: string | null;
};

const NONE: StoredChatTabs = { known: false, tabs: [], activeId: null };

/** Ids only, in order, with blanks and repeats dropped. */
function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
  }
  return ids;
}

/** The stored shape, or none when the slot is empty or malformed. */
function parseStored(raw: string | null): StoredChatTabs {
  if (raw === null) return NONE;
  try {
    const parsed = JSON.parse(raw) as unknown;
    // A bare array is a strip without a front tab; it is accepted so a partial
    // write from an older build still restores the tabs.
    const stored = Array.isArray(parsed)
      ? { tabs: cleanIds(parsed), activeId: null }
      : {
          tabs: cleanIds((parsed as { tabs?: unknown } | null)?.tabs),
          activeId: (parsed as { activeId?: unknown } | null)?.activeId,
        };
    const active =
      typeof stored.activeId === "string" && stored.tabs.includes(stored.activeId)
        ? stored.activeId
        : null;
    return { known: true, tabs: stored.tabs, activeId: active };
  } catch {
    return NONE;
  }
}

/**
 * Read the strip this vault's agent last had open.
 *
 * A malformed value is treated as no memory rather than a boot failure: the
 * landing then follows the old rule instead of the dock refusing to open.
 *
 * With no vault, or no agent — a harness page — this is the old behaviour,
 * including the claim of a strip an older build left in the legacy slot: the
 * first agent asked about it gets a copy under its own key and the legacy slot is
 * cleared. The app never runs that claim for a vault: its pre-vault strip named
 * chats from another vault, so restoring it would put the wrong chats in the
 * strip.
 */
export function readStoredChatTabs(
  vaultId: string | null,
  agent: HarnessId | null = null,
): StoredChatTabs {
  try {
    const own = parseStored(window.localStorage.getItem(keyFor(vaultId, agent)));
    if (own.known || (vaultId && agent) || !agent) return own;
    const legacy = parseStored(window.localStorage.getItem(LEGACY_CHAT_TABS_KEY));
    if (!legacy.known) return NONE;
    writeStoredChatTabs(null, agent, legacy.tabs, legacy.activeId);
    window.localStorage.removeItem(LEGACY_CHAT_TABS_KEY);
    return legacy;
  } catch {
    return NONE;
  }
}

/**
 * Remember the strip for the next run.
 *
 * An empty strip is written as an empty strip, not deleted: "I closed every tab
 * before quitting" is a decision the next landing has to honour, and it is a
 * different fact from "this profile has never had a strip".
 */
export function writeStoredChatTabs(
  vaultId: string | null,
  agent: HarnessId | null,
  tabs: readonly string[],
  activeId: string | null,
): void {
  try {
    const ids = cleanIds(tabs);
    window.localStorage.setItem(
      keyFor(vaultId, agent),
      JSON.stringify({
        tabs: ids,
        activeId: activeId && ids.includes(activeId) ? activeId : null,
      }),
    );
  } catch {
    // A storage refusal costs the strip its memory, not the open chats.
  }
}

/**
 * The chat this dock opened last in one vault, or null.
 *
 * It is separate from the strip because it also covers a chat that was open on
 * its own (a run nobody tabbed, a chat opened then closed): the landing resumes
 * it even though the strip never remembered it. Per-vault for the same reason
 * the strip is: the id names a chat in that vault.
 */
export function readStoredLastSessionId(
  vaultId: string | null,
  agent: HarnessId | null,
): string | null {
  try {
    return window.localStorage.getItem(lastSessionKeyFor(vaultId, agent));
  } catch {
    return null;
  }
}

/** Remember the chat this dock opened last, for the next landing. */
export function writeStoredLastSessionId(
  vaultId: string | null,
  agent: HarnessId | null,
  sessionId: string,
): void {
  try {
    window.localStorage.setItem(lastSessionKeyFor(vaultId, agent), sessionId);
  } catch {
    // A storage refusal costs the landing its hint, not the chat.
  }
}

/** Forget the last-opened chat: nothing is open in this vault any more. */
export function clearStoredLastSessionId(
  vaultId: string | null,
  agent: HarnessId | null,
): void {
  try {
    window.localStorage.removeItem(lastSessionKeyFor(vaultId, agent));
  } catch {
    // A storage refusal costs the landing its hint, not the chat.
  }
}

/** What the landing should put on screen, given what the agent still has. */
export type RestoredChatTabs = {
  /** The remembered tabs that still exist, in tab order. */
  tabs: string[];
  /** The tab to put in front, or null when `tabs` is empty. */
  activeId: string | null;
  /**
   * The stored strip was present and empty — the operator closed every tab
   * before quitting — so the landing is the list, not a chat resumed over that
   * decision.
   */
  closedStrip: boolean;
};

/**
 * Reconcile the remembered strip against the chats that still exist.
 *
 * `liveIds` is the list just read from the agent (archived and hidden chats
 * are absent from it by design). `openNow` are tabs a live turn opened while
 * this read was in flight — a scheduled automation can start one before the
 * list arrives — and they are kept, because they belong to the run that is
 * happening now rather than to the previous session.
 *
 * The tab in front is the remembered one; if it vanished from the agent the
 * next remembered tab to its right takes over, else the one to its left, the way
 * a browser hands a closed tab's place to its neighbour. A remembered strip with
 * no surviving tab returns no tabs: the caller falls back to its own landing rule
 * rather than inventing one from a stale id.
 */
export function restoredChatTabs(
  stored: StoredChatTabs,
  liveIds: ReadonlySet<string>,
  options: { openNow: readonly string[]; lastSessionId: string | null },
): RestoredChatTabs {
  if (!stored.known) {
    // A first landing, or a profile from before strips were remembered: the
    // caller's old rule — last chat, most recent, or the list — is the rule.
    return { tabs: [], activeId: null, closedStrip: false };
  }
  const tabs: string[] = [];
  for (const id of stored.tabs) {
    if (liveIds.has(id) && !tabs.includes(id)) tabs.push(id);
  }
  for (const id of options.openNow) {
    if (id && !tabs.includes(id)) tabs.push(id);
  }
  if (tabs.length === 0) {
    return { tabs: [], activeId: null, closedStrip: stored.tabs.length === 0 };
  }
  let active: string | null = null;
  if (stored.activeId && tabs.includes(stored.activeId)) {
    active = stored.activeId;
  } else if (options.lastSessionId && tabs.includes(options.lastSessionId)) {
    active = options.lastSessionId;
  } else if (stored.activeId) {
    const at = stored.tabs.indexOf(stored.activeId);
    for (let i = at + 1; i < stored.tabs.length && !active; i += 1) {
      const id = stored.tabs[i];
      if (id && tabs.includes(id)) active = id;
    }
    for (let i = at - 1; i >= 0 && !active; i -= 1) {
      const id = stored.tabs[i];
      if (id && tabs.includes(id)) active = id;
    }
  }
  // No remembered front tab (a bare-array write, or a strip restored from a live
  // run's tabs alone): the rightmost tab is the newest one, which is what the old
  // landing would have picked anyway.
  active ??= tabs[tabs.length - 1] ?? null;
  return { tabs, activeId: active, closedStrip: false };
}
