/**
 * The dock's tab strip, remembered between runs.
 *
 * The strip is the operator's working set: every chat they had open, in the
 * order the tabs were made, and the one that was in front. That set used to live
 * only in the provider's React state, so quitting the app threw all but the last
 * chat away — the landing reopened that one and the other tabs were lost. This
 * module is the memory: the provider reads it when it lands and writes it back
 * whenever the strip or the tab in front changes.
 *
 * There is one strip PER AGENT, not one per profile. A chat belongs to the
 * agent that made it, so the two agents' chats cannot share a strip: restoring
 * Hermes ids onto Pi would ask for chats Pi has never heard of, and a switch
 * that cleared the strip threw away the other agent's working set for good.
 * That is why the key carries the agent id, and why a switch writes the strip
 * it is leaving before it reads the one it is entering.
 *
 * `null` is the app-less case: a harness page (the e2e rigs) mounts the dock
 * with only the IPC bridge stubbed and no agent chosen at all. Those pages keep
 * the pre-agent key, so their behaviour is exactly what it always was.
 *
 * Only what the strip itself knows is stored: ids and order. Whether a
 * remembered chat still exists is the agent's answer, so the landing filters
 * the stored ids against the list it just read (`restoredChatTabs`) rather than
 * trusting the memory. A chat deleted or archived elsewhere while this app was
 * shut is dropped from the strip instead of coming back as a tab with no thread
 * behind it.
 */
import type { HarnessId } from "@/vite-env";

/** The pre-agent slot, still used by the app-less harness pages. */
const LEGACY_CHAT_TABS_KEY = "lifequest.companion.openTabs";

/** One strip per agent: `lifequest.companion.openTabs.hermes`, `.pi`. */
const CHAT_TABS_PREFIX = "lifequest.companion.openTabs.";

function keyFor(agent: HarnessId | null): string {
  return agent ? `${CHAT_TABS_PREFIX}${agent}` : LEGACY_CHAT_TABS_KEY;
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
 * Read the strip this agent last had open.
 *
 * A malformed value is treated as no memory rather than a boot failure: the
 * landing then follows the old rule instead of the dock refusing to open.
 *
 * A build from before the strips were per-agent left its one strip in the
 * legacy slot. The first agent asked about it claims it (a copy under that
 * agent's key) and the legacy slot is cleared, so the other agent does not read
 * a strip that never belonged to it.
 */
export function readStoredChatTabs(agent: HarnessId | null = null): StoredChatTabs {
  try {
    const own = parseStored(window.localStorage.getItem(keyFor(agent)));
    if (own.known || !agent) return own;
    const legacy = parseStored(window.localStorage.getItem(LEGACY_CHAT_TABS_KEY));
    if (!legacy.known) return NONE;
    writeStoredChatTabs(agent, legacy.tabs, legacy.activeId);
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
  agent: HarnessId | null,
  tabs: readonly string[],
  activeId: string | null,
): void {
  try {
    const ids = cleanIds(tabs);
    window.localStorage.setItem(
      keyFor(agent),
      JSON.stringify({
        tabs: ids,
        activeId: activeId && ids.includes(activeId) ? activeId : null,
      }),
    );
  } catch {
    // A storage refusal costs the strip its memory, not the open chats.
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
