import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  BRIEF_DISMISSAL_REASONS,
  BRIEF_ITEMS_MAX,
  BRIEF_KINDS,
  BRIEF_OPERATOR_REASONS,
  BRIEF_TEXT_MAX,
  BRIEF_WHY_MAX,
  type Actor,
  type BriefDismissal,
  type BriefDismissalReason,
  type BriefItem,
  type BriefItemInput,
  type BriefKind,
  type CompanionBrief,
  type CompanionBriefRead,
  type Result,
} from "./types.ts";

/**
 * The companion's brief — the one place it says "here is what I would tell you
 * if I had thirty seconds with you this morning".
 *
 * The problem it answers is specific: the durable things in a daily note (a
 * decision, a watch, a commitment, a pattern) evaporate, because every other
 * surface is either a task (action) or a signal (a write-only capture list). So
 * the brief is not free text: an item is TYPED, SOURCED and EXPIRING. The writer
 * cannot hand over a paragraph and hope; every line names what kind of thing it
 * is, where it came from, and when it should stop standing.
 *
 * Three rules live here rather than in the card or the tools:
 *
 *  1. THE COMPANION IS THE ONLY WRITER. `setCompanionBrief` refuses every other
 *     actor. The operator's one verb is dismissal — and that path is not a tool
 *     at all (see `dismissBriefItem` and its IPC caller), so the companion
 *     cannot clear its own mistakes or "complete" an item it got wrong.
 *  2. A WRITE REPLACES, NEVER APPENDS. The brief is re-derived each day: items
 *     absent from the new array are gone. The dismissal log is the one part that
 *     survives, because that is the feedback the companion is writing for.
 *  3. THE READER RECORDS EXPIRY. An item past `expiresAt` with no answer becomes
 *     a `expired-unseen` dismissal the next time anyone reads — not clicked by
 *     the operator, recorded by the reader — so the companion can see what it
 *     wrote that nobody acted on.
 *
 * The file is `.lifequest/companion-brief.json`, rewritten wholesale and written
 * atomically. A missing file reads as an empty brief. So does an unparseable
 * one, with a `problems[]` entry instead of a throw, the way the review-skill
 * reader reports a rule it could not trust.
 */

/** The dismissal log's hard cap ("last 200"). */
export const BRIEF_DISMISSAL_LOG_MAX = 200;

/** How long a dismissal is kept ("retained 90 days"). */
export const BRIEF_DISMISSAL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** How long an expired item is still drawn, faded, before it disappears. */
export const BRIEF_EXPIRED_VISIBLE_MS = 24 * 60 * 60 * 1000;

/** How long `watch`, `commitment` and `pattern` stand when no expiry is given. */
export const BRIEF_LONG_KIND_MS = 7 * 24 * 60 * 60 * 1000;

/** How many dismissals `get_companion_brief` reports ("the last twenty"). */
export const BRIEF_DISMISSALS_SHOWN = 20;

/** The companion's actor id, exactly as the MCP door passes it. */
export const COMPANION_BRIEF_WRITER_ID = "companion";

const COMPANION_ONLY_ERROR = "the brief is written by the companion only";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function emptyBrief(): CompanionBrief {
  return { writtenAt: null, writtenBy: null, items: [], dismissalLog: [] };
}

/** The end of the writer's local day, as an ISO instant. */
export function endOfLocalDay(now = new Date()): string {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return end.toISOString();
}

/** The default expiry for a kind: the day for a prompt or an ahead, a week for
 * the slower shapes the operator may not see until later. */
export function defaultBriefExpiry(kind: BriefKind, now = new Date()): string {
  if (kind === "prompt" || kind === "ahead") return endOfLocalDay(now);
  return new Date(now.getTime() + BRIEF_LONG_KIND_MS).toISOString();
}

/** Newest first, the last 200, and nothing older than 90 days. */
function pruneDismissals(log: BriefDismissal[], now: Date): BriefDismissal[] {
  const cutoff = now.getTime() - BRIEF_DISMISSAL_RETENTION_MS;
  return log
    .filter((entry) => {
      const at = Date.parse(entry.dismissedAt);
      return !Number.isNaN(at) && at >= cutoff;
    })
    .sort((a, b) => b.dismissedAt.localeCompare(a.dismissedAt))
    .slice(0, BRIEF_DISMISSAL_LOG_MAX);
}

/** Whether a stored item can be trusted enough to hand to a card or a tool. */
function parseStoredItem(raw: unknown): BriefItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const kind = item.kind;
  if (typeof kind !== "string" || !(BRIEF_KINDS as readonly string[]).includes(kind)) {
    return null;
  }
  const priority = item.priority;
  if (
    typeof item.id !== "string" ||
    item.id === "" ||
    typeof item.text !== "string" ||
    item.text.trim() === "" ||
    typeof item.why !== "string" ||
    typeof item.sourceRef !== "string" ||
    !(item.domainSlug === null || typeof item.domainSlug === "string") ||
    typeof priority !== "number" ||
    !Number.isInteger(priority) ||
    priority < 1 ||
    priority > 5 ||
    !isIsoInstant(item.createdAt) ||
    !isIsoInstant(item.expiresAt)
  ) {
    return null;
  }
  return {
    id: item.id,
    kind: kind as BriefKind,
    text: item.text,
    why: item.why,
    sourceRef: item.sourceRef,
    domainSlug: item.domainSlug as string | null,
    priority,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
  };
}

function parseStoredDismissal(raw: unknown): BriefDismissal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const reason = entry.reason;
  if (
    typeof entry.itemId !== "string" ||
    entry.itemId === "" ||
    !isIsoInstant(entry.dismissedAt) ||
    typeof reason !== "string" ||
    !(BRIEF_DISMISSAL_REASONS as readonly string[]).includes(reason)
  ) {
    return null;
  }
  return {
    itemId: entry.itemId,
    dismissedAt: entry.dismissedAt,
    reason: reason as BriefDismissalReason,
  };
}

/**
 * Parse the stored file. Trustworthy entries survive a partly-broken file; what
 * cannot be trusted is named in `problems[]` and left out, never thrown.
 */
function parseStoredBrief(raw: string): { brief: CompanionBrief; problems: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      brief: emptyBrief(),
      problems: [`companion brief: the file is not valid JSON (${message(e)})`],
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      brief: emptyBrief(),
      problems: ["companion brief: the file does not hold an object"],
    };
  }
  const record = parsed as Record<string, unknown>;
  const problems: string[] = [];
  const writtenBy = record.writtenBy;
  if (writtenBy !== null && writtenBy !== "companion") {
    problems.push("companion brief: writtenBy is not the companion");
  }
  const writtenAt = record.writtenAt;
  if (writtenAt !== null && !isIsoInstant(writtenAt)) {
    problems.push("companion brief: writtenAt is not an instant");
  }

  const items: BriefItem[] = [];
  if (!Array.isArray(record.items)) {
    problems.push("companion brief: items is not an array");
  } else {
    for (const [index, rawItem] of record.items.entries()) {
      const item = parseStoredItem(rawItem);
      if (item) items.push(item);
      else problems.push(`companion brief: item ${index + 1} is not a readable brief item`);
    }
  }

  const dismissalLog: BriefDismissal[] = [];
  if (!Array.isArray(record.dismissalLog)) {
    problems.push("companion brief: dismissalLog is not an array");
  } else {
    for (const [index, rawEntry] of record.dismissalLog.entries()) {
      const entry = parseStoredDismissal(rawEntry);
      if (entry) dismissalLog.push(entry);
      else problems.push(`companion brief: dismissal ${index + 1} is not a readable dismissal`);
    }
  }

  return {
    brief: {
      writtenAt: typeof writtenAt === "string" ? writtenAt : null,
      writtenBy: writtenBy === "companion" ? "companion" : null,
      items: items.slice(0, BRIEF_ITEMS_MAX),
      dismissalLog,
    },
    problems,
  };
}

/**
 * The expiry pass: record `expired-unseen` for every item that lapsed with no
 * answer, prune expired items once they have been visible for a day, and keep
 * the dismissal log inside its retention window.
 *
 * Pure over `brief`, so a caller that cannot write a file still gets the answer
 * the clock implies; the read path is what persists it.
 */
export function expireBriefItems(
  brief: CompanionBrief,
  now: Date,
): { brief: CompanionBrief; newlyExpired: BriefItem[]; changed: boolean } {
  const dismissedIds = new Set(
    brief.dismissalLog.filter((entry) => entry.reason !== "expired-unseen").map((entry) => entry.itemId),
  );
  const expiredUnseenIds = new Set(
    brief.dismissalLog.filter((entry) => entry.reason === "expired-unseen").map((entry) => entry.itemId),
  );
  const nowMs = now.getTime();
  const newlyExpired: BriefItem[] = [];
  for (const item of brief.items) {
    const at = Date.parse(item.expiresAt);
    if (Number.isNaN(at) || at > nowMs) continue;
    if (dismissedIds.has(item.id) || expiredUnseenIds.has(item.id)) continue;
    newlyExpired.push(item);
    expiredUnseenIds.add(item.id);
  }

  const dismissalLog = pruneDismissals(
    [
      ...brief.dismissalLog,
      ...newlyExpired.map((item) => ({
        itemId: item.id,
        dismissedAt: now.toISOString(),
        reason: "expired-unseen" as const,
      })),
    ],
    now,
  );

  // An expired item is kept for one day so the card can draw it faded; older
  // than that it is gone from the active record (its dismissal remains).
  const items = brief.items.filter((item) => {
    const at = Date.parse(item.expiresAt);
    return Number.isNaN(at) || at > nowMs - BRIEF_EXPIRED_VISIBLE_MS;
  });

  const changed =
    newlyExpired.length > 0 ||
    items.length !== brief.items.length ||
    dismissalLog.length !== brief.dismissalLog.length ||
    dismissalLog.some((entry, index) => entry !== brief.dismissalLog[index]);

  return {
    brief: { ...brief, items, dismissalLog },
    newlyExpired,
    changed,
  };
}

async function loadBrief(
  root: string,
): Promise<Result<{ brief: CompanionBrief; problems: string[] }>> {
  try {
    const raw = await fs.readFile(vaultPaths(root).companionBriefJson, "utf8");
    return { ok: true, value: parseStoredBrief(raw) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: { brief: emptyBrief(), problems: [] } };
    }
    return { ok: false, error: message(e) };
  }
}

async function writeBrief(root: string, brief: CompanionBrief): Promise<Result<CompanionBrief>> {
  try {
    const paths = vaultPaths(root);
    await fs.mkdir(paths.lifequestDir, { recursive: true });
    await atomicWriteFile(paths.companionBriefJson, `${JSON.stringify(brief, null, 2)}\n`);
    return { ok: true, value: brief };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

function sortByPriority(items: BriefItem[]): BriefItem[] {
  return items
    .slice()
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

/** The read shape both the card and `get_companion_brief` are built from. */
function shapeRead(
  brief: CompanionBrief,
  now: Date,
  problems: string[],
): CompanionBriefRead {
  const operatorAnswered = new Set(
    brief.dismissalLog.filter((entry) => entry.reason !== "expired-unseen").map((entry) => entry.itemId),
  );
  const active: BriefItem[] = [];
  const recentlyExpired: BriefItem[] = [];
  const nowMs = now.getTime();
  for (const item of brief.items) {
    if (operatorAnswered.has(item.id)) continue;
    const at = Date.parse(item.expiresAt);
    if (Number.isNaN(at)) continue;
    if (at > nowMs) active.push(item);
    else if (at > nowMs - BRIEF_EXPIRED_VISIBLE_MS) recentlyExpired.push(item);
  }
  return {
    writtenAt: brief.writtenAt,
    writtenBy: brief.writtenBy,
    items: sortByPriority(active),
    recentlyExpired: sortByPriority(recentlyExpired),
    dismissals: brief.dismissalLog.slice(0, BRIEF_DISMISSALS_SHOWN),
    problems,
  };
}

/**
 * The brief as it stands, with the reader's expiry bookkeeping applied.
 *
 * This is a read that may WRITE: the first reader after an item's expiry records
 * `expired-unseen`, because nobody clicked it and the companion must still learn
 * that nobody acted. A failure to persist that bookkeeping is reported as a
 * problem on the read rather than as a missing brief — the words the operator
 * should see are still returned.
 */
export async function readCompanionBrief(
  root: string,
  now: Date = new Date(),
): Promise<Result<CompanionBriefRead>> {
  const loaded = await loadBrief(root);
  if (!loaded.ok) return loaded;
  const problems = [...loaded.value.problems];
  const swept = expireBriefItems(loaded.value.brief, now);
  if (swept.changed) {
    const written = await writeBrief(root, swept.brief);
    if (!written.ok) {
      problems.push(`companion brief: the expiry pass could not be saved (${written.error})`);
    }
  }
  return { ok: true, value: shapeRead(swept.brief, now, problems) };
}

type ValidatedItems =
  | { ok: true; items: BriefItem[] }
  | { ok: false; error: string };

/**
 * Validate one write and turn it into stored items, or refuse by name.
 *
 * The messages are the contract the companion is told to expect: each names the
 * field and the value (or the allowed values), so one retry is enough.
 */
function validateItems(
  raw: unknown,
  now: Date,
): ValidatedItems {
  if (!Array.isArray(raw)) return { ok: false, error: "items must be an array" };
  if (raw.length > BRIEF_ITEMS_MAX) {
    return { ok: false, error: `too many brief items (max ${BRIEF_ITEMS_MAX})` };
  }
  const createdAt = now.toISOString();
  const seenText = new Set<string>();
  const out: BriefItem[] = [];
  for (const [index, candidate] of raw.entries()) {
    const at = `item ${index + 1}`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, error: `${at} must be an object` };
    }
    const item = candidate as Record<string, unknown>;

    const kind = item.kind;
    if (typeof kind !== "string" || !(BRIEF_KINDS as readonly string[]).includes(kind)) {
      return {
        ok: false,
        error: `${at}: kind ${JSON.stringify(kind)} is not one of ${BRIEF_KINDS.join(", ")}`,
      };
    }

    const text = item.text;
    if (typeof text !== "string") {
      return { ok: false, error: `${at}: text must be a string` };
    }
    const textLength = text.trim().length;
    if (textLength === 0 || textLength > BRIEF_TEXT_MAX) {
      return {
        ok: false,
        error: `${at}: text is ${textLength} characters; the field text must be 1 to ${BRIEF_TEXT_MAX}`,
      };
    }
    const trimmedText = text.trim();
    if (seenText.has(trimmedText)) {
      return { ok: false, error: `duplicate brief text: ${JSON.stringify(trimmedText)}` };
    }
    seenText.add(trimmedText);

    const why = item.why;
    if (typeof why !== "string" || why.trim() === "") {
      return {
        ok: false,
        error: `${at}: why is required — a brief item without a reason is wallpaper`,
      };
    }
    const whyLength = why.trim().length;
    if (whyLength > BRIEF_WHY_MAX) {
      return {
        ok: false,
        error: `${at}: why is ${whyLength} characters; the field why must be 1 to ${BRIEF_WHY_MAX}`,
      };
    }

    const priority = item.priority;
    if (
      typeof priority !== "number" ||
      !Number.isInteger(priority) ||
      priority < 1 ||
      priority > 5
    ) {
      return { ok: false, error: `${at}: priority ${String(priority)} is outside 1 to 5` };
    }

    let expiresAt = "";
    if (item.expiresAt === undefined || item.expiresAt === null) {
      expiresAt = defaultBriefExpiry(kind as BriefKind, now);
    } else {
      if (!isIsoInstant(item.expiresAt)) {
        return {
          ok: false,
          error: `${at}: expiresAt ${JSON.stringify(item.expiresAt)} is not an ISO instant (createdAt ${createdAt})`,
        };
      }
      if (Date.parse(item.expiresAt) <= now.getTime()) {
        return {
          ok: false,
          error: `${at}: expiresAt ${item.expiresAt} is not after createdAt ${createdAt}`,
        };
      }
      expiresAt = new Date(Date.parse(item.expiresAt)).toISOString();
    }

    if (item.sourceRef !== undefined && typeof item.sourceRef !== "string") {
      return { ok: false, error: `${at}: sourceRef must be a string` };
    }
    if (
      item.domainSlug !== undefined &&
      item.domainSlug !== null &&
      typeof item.domainSlug !== "string"
    ) {
      return { ok: false, error: `${at}: domainSlug must be a slug or null` };
    }
    if (item.id !== undefined && (typeof item.id !== "string" || item.id.trim() === "")) {
      return { ok: false, error: `${at}: id must be a non-empty string when it is given` };
    }

    out.push({
      id: typeof item.id === "string" ? item.id.trim() : randomUUID(),
      kind: kind as BriefKind,
      text: trimmedText,
      why: why.trim(),
      sourceRef: typeof item.sourceRef === "string" ? item.sourceRef.trim() : "",
      domainSlug:
        typeof item.domainSlug === "string" && item.domainSlug.trim() !== ""
          ? item.domainSlug.trim()
          : null,
      priority,
      createdAt,
      expiresAt,
    });
  }
  return { ok: true, items: out };
}

export type CompanionBriefWriteResult = {
  brief: CompanionBrief;
  /** How many of the previous writer's items had expired with no answer by the
   * time this write replaced them — the "what did I get wrong" number. */
  expiredSincePreviousWrite: number;
};

/**
 * Replace the whole active set. An item not present in `input.items` is gone:
 * this is a re-derivation, not an append.
 *
 * The expiry pass runs over the PREVIOUS brief first, so the reply can report
 * how many of those items lapsed unseen, and the dismissal log that pass grows
 * is kept for the new brief.
 */
export async function setCompanionBrief(
  root: string,
  actor: Actor,
  input: { items: BriefItemInput[] },
  now: Date = new Date(),
): Promise<Result<CompanionBriefWriteResult>> {
  if (actor.type !== "agent" || actor.id !== COMPANION_BRIEF_WRITER_ID) {
    return { ok: false, error: COMPANION_ONLY_ERROR };
  }
  const validated = validateItems(input.items, now);
  if (!validated.ok) return validated;

  const loaded = await loadBrief(root);
  if (!loaded.ok) return loaded;
  const previousWrittenAt = loaded.value.brief.writtenAt;
  const swept = expireBriefItems(loaded.value.brief, now);
  // "How many expired since the previous write" is a question about the window
  // between the two writes, not about this call's own sweep: a reader may have
  // recorded the lapses overnight, and the companion still needs the number.
  const sinceMs = previousWrittenAt ? Date.parse(previousWrittenAt) : Number.NEGATIVE_INFINITY;
  const expiredSincePreviousWrite = swept.brief.dismissalLog.filter(
    (entry) =>
      entry.reason === "expired-unseen" &&
      Date.parse(entry.dismissedAt) > sinceMs,
  ).length;

  const brief: CompanionBrief = {
    writtenAt: now.toISOString(),
    writtenBy: "companion",
    items: validated.items,
    dismissalLog: swept.brief.dismissalLog,
  };
  const written = await writeBrief(root, brief);
  if (!written.ok) return written;

  // A brief write is an attributable write like every other; the log names the
  // companion, how many items it left, and how many had lapsed unseen.
  await appendLog(root, {
    domainSlug: null,
    type: "brief.written",
    summary: `Wrote the companion brief (${brief.items.length} item${brief.items.length === 1 ? "" : "s"})`,
    payload: {
      items: brief.items.map((item) => ({ id: item.id, kind: item.kind, priority: item.priority })),
      expiredSincePreviousWrite,
    },
    actor,
  });

  return {
    ok: true,
    value: { brief, expiredSincePreviousWrite },
  };
}

/**
 * The operator's one verb on the brief: settle one item.
 *
 * Deliberately not an MCP tool. The companion writes the brief and the operator
 * answers it; a companion that could dismiss its own items could hide its own
 * mistakes, and one that could mark an item `done` could claim work it did not
 * do instead of the operator saying so.
 *
 * A dismissal touches exactly one item: every other item stays active and
 * untouched, and a re-dismissal is a no-op rather than a second log entry.
 */
export async function dismissBriefItem(
  root: string,
  actor: Actor,
  itemId: string,
  reason: BriefDismissalReason,
  now: Date = new Date(),
): Promise<Result<CompanionBriefRead>> {
  if (actor.type !== "user") {
    return { ok: false, error: "Only the operator can dismiss a brief item" };
  }
  if (typeof itemId !== "string" || itemId.trim() === "") {
    return { ok: false, error: "itemId is required" };
  }
  if (!(BRIEF_OPERATOR_REASONS as readonly string[]).includes(reason)) {
    return {
      ok: false,
      error: `reason ${JSON.stringify(reason)} is not one of ${BRIEF_OPERATOR_REASONS.join(", ")}`,
    };
  }
  const loaded = await loadBrief(root);
  if (!loaded.ok) return loaded;
  const swept = expireBriefItems(loaded.value.brief, now);
  const brief = swept.brief;
  const id = itemId.trim();
  const known =
    brief.items.some((item) => item.id === id) ||
    brief.dismissalLog.some((entry) => entry.itemId === id);
  if (!known) {
    return { ok: false, error: `unknown brief item: ${id}` };
  }
  // A re-dismissal (or settling a lapsed item) replaces the earlier record for
  // THAT item only; the rest of the log and every other item are untouched.
  const dismissalLog = pruneDismissals(
    [
      ...brief.dismissalLog.filter((entry) => entry.itemId !== id),
      { itemId: id, dismissedAt: now.toISOString(), reason },
    ],
    now,
  );
  const next: CompanionBrief = { ...brief, dismissalLog };
  const written = await writeBrief(root, next);
  if (!written.ok) return written;
  await appendLog(root, {
    domainSlug: null,
    type: "brief.dismissed",
    summary: `Dismissed a brief item (${reason})`,
    payload: { itemId: id, reason },
    actor,
  });
  return { ok: true, value: shapeRead(next, now, loaded.value.problems) };
}
