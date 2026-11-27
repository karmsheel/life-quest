import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import {
  ALL_TOOL_DEFS,
  BRIEF_DISMISSALS_SHOWN,
  BRIEF_DISMISSAL_LOG_MAX,
  BRIEF_DISMISSAL_RETENTION_MS,
  BRIEF_EXPIRED_VISIBLE_MS,
  BRIEF_ITEMS_MAX,
  BRIEF_KINDS,
  BRIEF_LONG_KIND_MS,
  BRIEF_OPERATOR_REASONS,
  BRIEF_TEXT_MAX,
  BRIEF_WHY_MAX,
  COMPANION_ONLY_TOOLS,
  SYSTEM_PIN_KINDS,
  connectedWriteKind,
  createVault,
  defaultBriefExpiry,
  defaultPins,
  dismissBriefItem,
  endOfLocalDay,
  executeCompanionBriefTool,
  expireBriefItems,
  listPinBoard,
  readCompanionBrief,
  readLog,
  setCompanionBrief,
  setPins,
  toolAllowed,
  vaultPaths,
} from "@lifequest/vault-core";
import type {
  Actor,
  BriefDismissal,
  BriefDismissalReason,
  BriefItemInput,
  BriefKind,
  CompanionBrief,
  CompanionBriefRead,
  CompanionBriefWriteResult,
  ConnectedGrant,
} from "@lifequest/vault-core";
import { READ_ONLY_TOOLS, toolMayChangeData } from "../electron/data-revision.ts";

/**
 * The companion brief, end to end, against real vaults on disk.
 *
 * The brief is the companion's one standing piece of writing: "here is what I
 * would tell you if I had thirty seconds with you this morning". It is not free
 * text — an item is TYPED, SOURCED and EXPIRING — and the three rules that make
 * that true live in the engine:
 *
 *   1. THE COMPANION IS THE ONLY WRITER. Every other actor is refused, and the
 *      operator's one verb (dismissal) is deliberately not an MCP tool, so the
 *      companion can neither clear its own mistakes nor mark its own work done.
 *   2. A WRITE REPLACES, NEVER APPENDS. Three items, then two: the third is gone.
 *      The dismissal log survives, because that is the feedback the companion
 *      writes for.
 *   3. THE READER RECORDS EXPIRY. An item past `expiresAt` with no answer becomes
 *      `expired-unseen` on the next read, is drawn faded for a day, and is then
 *      only a dismissal.
 *
 * This run exercises the shipping functions — `setCompanionBrief`,
 * `readCompanionBrief`, `dismissBriefItem`, `expireBriefItems`,
 * `executeCompanionBriefTool`, and the pin seeding in `pins.ts` — against temp
 * vaults created by `createVault`. Nothing is mocked: the file under test is
 * `.lifequest/companion-brief.json` itself, byte comparisons included.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. An invalid item is accepted, or is refused with a message that does not
 *     name the field, the value or the allowed values — a retry the companion
 *     cannot make from the answer.
 *  2. A refused write is not a no-op: the previous brief is damaged, emptied or
 *     half-rewritten on the way to the refusal.
 *  3. A second write appends to the first, so yesterday's items accumulate and
 *     the brief becomes a list instead of a glance.
 *  4. `createdAt`/`expiresAt` are computed in the wrong clock: the day ends in
 *     UTC rather than the writer's local day, or a slow kind gets a day instead
 *     of a week.
 *  5. A missing or corrupt file throws, or hides the whole brief instead of
 *     reading empty with a `problems[]` entry.
 *  6. The expiry pass is memory-only: a lapsed item is reported as
 *     `expired-unseen` in one answer and forgotten before the next reader.
 *  7. A dismissal touches other items, is written twice for one item, or is
 *     accepted from the companion.
 *  8. The dismissal log grows without bound or keeps entries older than 90 days.
 *  9. The card is not seeded first on a fresh board, a read migrates an existing
 *     board by WRITING to it, or an archived brief returns on the next read.
 * 10. The tool surface drifts: a dismiss tool appears, a connected hire is not
 *     refused, or `get_companion_brief` is classified as a write.
 *
 * Runs under `npm test` (`node --experimental-strip-types --test`), which needs
 * no Electron: vault-core is plain Node. The artifact is
 * `e2e/artifacts/companion-brief.json`.
 *
 * Re-run: `cd apps/desktop && node --experimental-strip-types --test tests/companion-brief-e2e.test.ts`
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/companion-brief.json");

/** The companion's actor, exactly as the MCP door passes it. */
const COMPANION: Actor = { type: "agent", id: "companion", name: "Hermes" };
/** A connected hire: an agent, but not THIS agent. */
const HIRE: Actor = { type: "agent", id: "hire-1", name: "A Hire" };
/** The operator. */
const USER: Actor = { type: "user" };

/** A fixed clock, so every stamped instant in the artifact is deterministic. */
const NOW = new Date("2026-11-06T09:30:00.000Z");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The sixteen cases, in order. The artifact names each one and whether it ran. */
const CASES = {
  tooMany: "validation: more than five items is refused by count",
  textEmpty: "validation: an empty text is refused, naming the field and the length",
  textTooLong: "validation: a text over 120 is refused, naming the field and the length",
  whyEmpty: "validation: an empty why is refused as wallpaper",
  whyTooLong: "validation: a why over 160 is refused, naming the field and the length",
  expiresAtNotIso: "validation: a non-ISO expiresAt is refused, naming both instants",
  expiresAtNotAfter: "validation: an expiresAt not after createdAt is refused, naming both",
  kindUnknown: "validation: an unknown kind is refused, listing the allowed kinds",
  priorityOutside: "validation: a priority outside 1 to 5 is refused",
  writerNotCompanion: "validation: the companion is the only writer",
  duplicateText: "validation: two items with the same text in one write are refused",
  defaults: "defaults: prompt/ahead end with the local day, watch/commitment/pattern stand seven days",
  replace: "a write replaces the active set instead of appending to it",
  roundtrip: "a write round-trips through .lifequest/companion-brief.json",
  missing: "a missing brief file reads empty with no problems",
  corrupt: "a corrupt brief file reads empty with a problem and never throws",
  getTool: "get_companion_brief reports writtenAt, the active items and the last twenty dismissals",
  expiry: "an expired item leaves the active set, is drawn faded for a day, and becomes expired-unseen",
  expiredCount: "expiredSincePreviousWrite counts the items that lapsed between writes",
  dismissRefusals: "dismiss: only the operator may dismiss, and only with a valid reason for a known item",
  dismiss: "dismiss: settling one item leaves the others active and is reported by the next get",
  retention: "retention: the last 200 dismissals, and nothing older than 90 days",
  pins: "pins: the brief is seeded first, read-injected into an old board, and sticky once archived",
  tools: "tools: get/set are registered, companion-only to grants, and get is a read while set is a write",
} as const;

type CaseName = (typeof CASES)[keyof typeof CASES];

// ── assertion bookkeeping (the artifact reports the real count) ──────────────

let currentCase: CaseName | "" = "";
let assertionCount = 0;
const assertionsByCase = new Map<string, number>();
const passedCases = new Set<CaseName>();
const claims: Array<{ claim: string; evidence: string }> = [];
const readback: Record<string, unknown> = {};
const transcript: Array<Record<string, unknown>> = [];

function begin(name: CaseName): void {
  currentCase = name;
}

function end(name: CaseName): void {
  passedCases.add(name);
  currentCase = "";
}

function countAssertion(): void {
  assertionCount += 1;
  if (currentCase) {
    assertionsByCase.set(currentCase, (assertionsByCase.get(currentCase) ?? 0) + 1);
  }
}

function eq(actual: unknown, expected: unknown, message: string): void {
  countAssertion();
  assert.equal(actual, expected, message);
}

function notEq(actual: unknown, expected: unknown, message: string): void {
  countAssertion();
  assert.notEqual(actual, expected, message);
}

function deepEq(actual: unknown, expected: unknown, message: string): void {
  countAssertion();
  assert.deepEqual(actual, expected, message);
}

function ok(value: unknown, message: string): void {
  countAssertion();
  assert.ok(value, message);
}

function claim(claimText: string, evidence: string): void {
  claims.push({ claim: claimText, evidence });
}

// ── vault + brief helpers ────────────────────────────────────────────────────

let vaultSeq = 0;

/** A real vault in a throwaway directory, removed even when an assertion fails. */
async function withVault(fn: (root: string) => Promise<void>): Promise<void> {
  vaultSeq += 1;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `lq-companion-brief-${process.pid}-${vaultSeq}-`));
  const root = path.join(workDir, "vault");
  const created = await createVault(root, "E2E");
  eq(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
  try {
    await fn(root);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** `.lifequest/companion-brief.json` — the file the feature is about. */
function briefFile(root: string): string {
  return vaultPaths(root).companionBriefJson;
}

function briefBytes(root: string): Buffer {
  return fs.readFileSync(briefFile(root));
}

function readStoredBrief(root: string): CompanionBrief {
  return JSON.parse(fs.readFileSync(briefFile(root), "utf8")) as CompanionBrief;
}

function writeStoredBrief(root: string, brief: CompanionBrief): void {
  fs.mkdirSync(path.dirname(briefFile(root)), { recursive: true });
  fs.writeFileSync(briefFile(root), `${JSON.stringify(brief, null, 2)}\n`);
}

function plus(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** One valid item; each test overrides just the field it is about. */
function item(overrides: Partial<BriefItemInput> = {}): BriefItemInput {
  return {
    kind: "watch",
    text: "A line the operator should read",
    why: "Because it changes what they do today",
    sourceRef: "note 2026-11-05",
    domainSlug: null,
    priority: 2,
    ...overrides,
  };
}

async function writeBrief(
  root: string,
  items: BriefItemInput[],
  now: Date = NOW,
): Promise<CompanionBriefWriteResult> {
  const res = await setCompanionBrief(root, COMPANION, { items }, now);
  eq(res.ok, true, `setCompanionBrief failed: ${res.ok ? "" : res.error}`);
  if (!res.ok) throw new Error(`setCompanionBrief failed: ${res.error}`);
  return res.value;
}

async function readBrief(root: string, now: Date = NOW): Promise<CompanionBriefRead> {
  const res = await readCompanionBrief(root, now);
  eq(res.ok, true, `readCompanionBrief failed: ${res.ok ? "" : res.error}`);
  if (!res.ok) throw new Error(`readCompanionBrief failed: ${res.error}`);
  return res.value;
}

/** Write a known-good brief, so a refusal has something it must not damage. */
async function writeBaseline(root: string): Promise<void> {
  await writeBrief(root, [item({ id: "baseline-item", text: "Baseline: the file before the refusal" })]);
}

/**
 * Attempt an invalid write and prove three things: it is refused, the refusal
 * names the rule, and the stored file is byte-for-byte what it was.
 */
async function assertRefused(
  root: string,
  actor: Actor,
  items: unknown,
  expectedParts: string[],
): Promise<string> {
  const before = briefBytes(root);
  const res = await setCompanionBrief(root, actor, { items: items as BriefItemInput[] }, NOW);
  eq(res.ok, false, `the write was accepted: ${JSON.stringify(items).slice(0, 240)}`);
  const error = res.ok ? "" : res.error;
  for (const part of expectedParts) {
    ok(error.includes(part), `refusal ${JSON.stringify(error)} does not name ${JSON.stringify(part)}`);
  }
  eq(
    Buffer.compare(briefBytes(root), before),
    0,
    "a refused write changed .lifequest/companion-brief.json",
  );
  return error;
}

/** Execute a brief tool and return its reply as a plain record (errors included). */
function toolReply(reply: unknown): Record<string, any> {
  return reply as Record<string, any>;
}

function toolError(reply: unknown): { code?: string; message?: string } {
  return (toolReply(reply).error as { code?: string; message?: string }) ?? {};
}

// ── the suite ────────────────────────────────────────────────────────────────

describe("companion brief e2e", () => {
  it(CASES.tooMany, async () => {
    begin(CASES.tooMany);
    await withVault(async (root) => {
      await writeBaseline(root);
      const items = Array.from({ length: BRIEF_ITEMS_MAX + 1 }, (_, i) =>
        item({ id: `over-${i}`, text: `Item number ${i}` }),
      );
      const error = await assertRefused(root, COMPANION, items, [
        `too many brief items (max ${BRIEF_ITEMS_MAX})`,
      ]);
      eq(
        error,
        `too many brief items (max ${BRIEF_ITEMS_MAX})`,
        "the count refusal is not the documented message",
      );
      readback.tooMany = { attempted: items.length, max: BRIEF_ITEMS_MAX, error };
    });
    end(CASES.tooMany);
  });

  it(CASES.textEmpty, async () => {
    begin(CASES.textEmpty);
    await withVault(async (root) => {
      await writeBaseline(root);
      const error = await assertRefused(root, COMPANION, [item({ text: "    " })], [
        `item 1: text is 0 characters`,
        `the field text must be 1 to ${BRIEF_TEXT_MAX}`,
      ]);
      readback.textEmpty = error;
    });
    end(CASES.textEmpty);
  });

  it(CASES.textTooLong, async () => {
    begin(CASES.textTooLong);
    await withVault(async (root) => {
      await writeBaseline(root);
      const text = "x".repeat(BRIEF_TEXT_MAX + 1);
      const error = await assertRefused(root, COMPANION, [item({ text })], [
        `text is ${BRIEF_TEXT_MAX + 1} characters`,
        `the field text must be 1 to ${BRIEF_TEXT_MAX}`,
      ]);
      readback.textTooLong = { length: text.length, max: BRIEF_TEXT_MAX, error };
    });
    end(CASES.textTooLong);
  });

  it(CASES.whyEmpty, async () => {
    begin(CASES.whyEmpty);
    await withVault(async (root) => {
      await writeBaseline(root);
      const error = await assertRefused(root, COMPANION, [item({ why: "   " })], [
        "why is required — a brief item without a reason is wallpaper",
      ]);
      readback.whyEmpty = error;
    });
    end(CASES.whyEmpty);
  });

  it(CASES.whyTooLong, async () => {
    begin(CASES.whyTooLong);
    await withVault(async (root) => {
      await writeBaseline(root);
      const why = "y".repeat(BRIEF_WHY_MAX + 1);
      const error = await assertRefused(root, COMPANION, [item({ why })], [
        `why is ${BRIEF_WHY_MAX + 1} characters`,
        `the field why must be 1 to ${BRIEF_WHY_MAX}`,
      ]);
      readback.whyTooLong = { length: why.length, max: BRIEF_WHY_MAX, error };
    });
    end(CASES.whyTooLong);
  });

  it(CASES.expiresAtNotIso, async () => {
    begin(CASES.expiresAtNotIso);
    await withVault(async (root) => {
      await writeBaseline(root);
      const error = await assertRefused(root, COMPANION, [item({ expiresAt: "tomorrow" })], [
        "not an ISO instant",
        `createdAt ${NOW.toISOString()}`,
      ]);
      readback.expiresAtNotIso = error;
    });
    end(CASES.expiresAtNotIso);
  });

  it(CASES.expiresAtNotAfter, async () => {
    begin(CASES.expiresAtNotAfter);
    await withVault(async (root) => {
      await writeBaseline(root);
      const equal = NOW.toISOString();
      const equalError = await assertRefused(root, COMPANION, [item({ expiresAt: equal })], [
        "is not after createdAt",
        equal,
      ]);
      const past = plus(NOW, -MIN).toISOString();
      const pastError = await assertRefused(root, COMPANION, [item({ expiresAt: past })], [
        "is not after createdAt",
        past,
      ]);
      eq(
        equalError === pastError,
        false,
        "the two refusal messages do not name the different expiresAt values",
      );
      readback.expiresAtNotAfter = { equal: equalError, past: pastError };
    });
    end(CASES.expiresAtNotAfter);
  });

  it(CASES.kindUnknown, async () => {
    begin(CASES.kindUnknown);
    await withVault(async (root) => {
      await writeBaseline(root);
      const error = await assertRefused(
        root,
        COMPANION,
        [item({ kind: "rumour" as unknown as BriefKind })],
        [`kind "rumour" is not one of`, ...BRIEF_KINDS],
      );
      ok(error.includes(BRIEF_KINDS.join(", ")), "the refusal does not list the allowed kinds in order");
      readback.kindUnknown = { allowed: [...BRIEF_KINDS], error };
    });
    end(CASES.kindUnknown);
  });

  it(CASES.priorityOutside, async () => {
    begin(CASES.priorityOutside);
    await withVault(async (root) => {
      await writeBaseline(root);
      const zero = await assertRefused(root, COMPANION, [item({ priority: 0 })], [
        "priority 0 is outside 1 to 5",
      ]);
      const six = await assertRefused(root, COMPANION, [item({ priority: 6 })], [
        "priority 6 is outside 1 to 5",
      ]);
      const fraction = await assertRefused(root, COMPANION, [item({ priority: 2.5 })], [
        "priority 2.5 is outside 1 to 5",
      ]);
      readback.priorityOutside = { zero, six, fraction };
    });
    end(CASES.priorityOutside);
  });

  it(CASES.writerNotCompanion, async () => {
    begin(CASES.writerNotCompanion);
    await withVault(async (root) => {
      await writeBaseline(root);
      const userError = await assertRefused(root, USER, [item()], [
        "the brief is written by the companion only",
      ]);
      const hireError = await assertRefused(root, HIRE, [item()], [
        "the brief is written by the companion only",
      ]);
      const otherAgentError = await assertRefused(
        root,
        { type: "agent", id: "not-the-companion", name: "Someone Else" },
        [item()],
        ["the brief is written by the companion only"],
      );
      eq(
        userError,
        "the brief is written by the companion only",
        "the user was refused with a different message",
      );
      readback.writerNotCompanion = { userError, hireError, otherAgentError };
    });
    end(CASES.writerNotCompanion);
  });

  it(CASES.duplicateText, async () => {
    begin(CASES.duplicateText);
    await withVault(async (root) => {
      await writeBaseline(root);
      const error = await assertRefused(
        root,
        COMPANION,
        [
          item({ id: "dup-1", text: "Same line twice" }),
          item({ id: "dup-2", text: "  Same line twice  " }),
        ],
        ['duplicate brief text: "Same line twice"'],
      );
      claim(
        "every invalid write is refused with a message that names the offending field and value (or the allowed values), and leaves .lifequest/companion-brief.json byte-identical",
        "eleven refusal cases: count, empty text, long text, empty why, long why, non-ISO expiresAt, expiresAt not after createdAt, unknown kind, priority outside 1 to 5, non-companion actor, duplicate text — each compared the file bytes before and after",
      );
      readback.duplicateText = error;
    });
    end(CASES.duplicateText);
  });

  // ── defaults, replacement, round trip ─────────────────────────────────────

  it(CASES.defaults, async () => {
    begin(CASES.defaults);
    await withVault(async (root) => {
      const items = BRIEF_KINDS.map((kind, index) =>
        item({ id: `kind-${kind}`, kind, text: `A ${kind} line`, priority: index + 1 }),
      );
      await writeBrief(root, items);
      const stored = readStoredBrief(root);
      eq(stored.items.length, BRIEF_KINDS.length, "the write dropped a kind");

      const writtenAt = NOW.toISOString();
      const endOfDay = endOfLocalDay(NOW);
      const sevenDays = plus(NOW, BRIEF_LONG_KIND_MS).toISOString();
      const seen: Record<string, string> = {};
      for (const [index, kind] of BRIEF_KINDS.entries()) {
        const storedItem = stored.items[index];
        eq(storedItem.kind, kind, `item ${index + 1} is not the kind that was written`);
        eq(storedItem.createdAt, writtenAt, `item ${index + 1} was not stamped with the write instant`);
        const expected =
          kind === "prompt" || kind === "ahead" ? endOfDay : sevenDays;
        eq(
          storedItem.expiresAt,
          expected,
          `${kind} did not default to ${kind === "prompt" || kind === "ahead" ? "the end of the local day" : "seven days"}`,
        );
        eq(defaultBriefExpiry(kind, NOW), expected, `defaultBriefExpiry(${kind}) disagrees with the write`);
        seen[kind] = storedItem.expiresAt;
      }

      // "End of the local day" is a local day, not 24 hours after the write and
      // not midnight UTC: the instant is the next local midnight.
      const end = new Date(endOfDay);
      eq(end.getHours(), 0, "the default prompt expiry is not a local midnight");
      eq(end.getMinutes(), 0, "the default prompt expiry is not a local midnight");
      eq(end.getSeconds(), 0, "the default prompt expiry is not a local midnight");
      eq(end.getMilliseconds(), 0, "the default prompt expiry is not a local midnight");
      const expectedLocalDate = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1);
      eq(end.getFullYear(), expectedLocalDate.getFullYear(), "the day rolls over the wrong year");
      eq(end.getMonth(), expectedLocalDate.getMonth(), "the day rolls over the wrong month");
      eq(end.getDate(), expectedLocalDate.getDate(), "the default expiry is not the NEXT local day");
      eq(sevenDays, new Date(NOW.getTime() + 7 * DAY).toISOString(), "a slow kind did not get seven days");

      const read = await readBrief(root);
      eq(read.items.length, BRIEF_KINDS.length, "not every written kind is active");
      claim(
        "the server stamps createdAt and fills expiresAt by kind: prompt/ahead end at the writer's next local midnight, watch/commitment/pattern stand seven days",
        `writtenAt ${writtenAt}; local-day end ${endOfDay}; slower kinds ${sevenDays}`,
      );
      readback.defaults = { writtenAt, endOfLocalDay: endOfDay, sevenDays, expiresAt: seen };
    });
    end(CASES.defaults);
  });

  it(CASES.replace, async () => {
    begin(CASES.replace);
    await withVault(async (root) => {
      await writeBrief(root, [
        item({ id: "keep-a", text: "First item" }),
        item({ id: "keep-b", text: "Second item" }),
        item({ id: "gone-c", text: "Third item, written once" }),
      ]);
      eq(readStoredBrief(root).items.length, 3, "the first write did not store three items");

      await writeBrief(root, [
        item({ id: "keep-b", text: "Second item" }),
        item({ id: "keep-a", text: "First item" }),
      ]);
      const stored = readStoredBrief(root);
      eq(stored.items.length, 2, "the second write appended instead of replacing");
      deepEq(stored.items.map((i) => i.id), ["keep-b", "keep-a"], "the replacement order is wrong");
      eq(
        stored.items.some((i) => i.id === "gone-c"),
        false,
        "an item absent from the new write survived it",
      );

      const read = await readBrief(root);
      deepEq(read.items.map((i) => i.id), ["keep-a", "keep-b"], "the read did not sort by priority");
      eq(
        read.items.some((i) => i.id === "gone-c"),
        false,
        "the replaced item is still active",
      );

      // A write with no items is a replacement too: the brief can be emptied.
      await writeBrief(root, []);
      eq(readStoredBrief(root).items.length, 0, "writing no items did not clear the brief");
      claim(
        "a write replaces the active set rather than appending to it, and an empty write clears the brief",
        "three items written, then two: the third is absent from the file and from the next read; a later empty write leaves zero items",
      );
      readback.replace = { afterFirst: 3, afterSecond: 2, emptied: 0 };
    });
    end(CASES.replace);
  });

  it(CASES.roundtrip, async () => {
    begin(CASES.roundtrip);
    await withVault(async (root) => {
      const expiresAt = plus(NOW, 3 * DAY).toISOString();
      await writeBrief(root, [
        item({
          id: "roundtrip-item",
          kind: "ahead",
          text: "  Renew the domain  ",
          why: "  It renews on Friday  ",
          sourceRef: "task:t-17",
          domainSlug: "financial",
          priority: 1,
          expiresAt,
        }),
      ]);

      eq(fs.existsSync(briefFile(root)), true, "the write did not create .lifequest/companion-brief.json");
      eq(
        briefFile(root),
        path.join(root, ".lifequest", "companion-brief.json"),
        "the brief is not stored at .lifequest/companion-brief.json",
      );

      const stored = readStoredBrief(root);
      eq(stored.writtenAt, NOW.toISOString(), "writtenAt is not the write instant");
      eq(stored.writtenBy, "companion", "writtenBy does not name the companion");
      eq(stored.items.length, 1, "the stored file has the wrong number of items");
      const storedItem = stored.items[0];
      eq(storedItem.id, "roundtrip-item", "the caller's id was not kept");
      eq(storedItem.kind, "ahead", "the kind changed on the way to disk");
      eq(storedItem.text, "Renew the domain", "the text was not trimmed on the way to disk");
      eq(storedItem.why, "It renews on Friday", "the why was not trimmed on the way to disk");
      eq(storedItem.sourceRef, "task:t-17", "the sourceRef was lost");
      eq(storedItem.domainSlug, "financial", "the domainSlug was lost");
      eq(storedItem.priority, 1, "the priority was lost");
      eq(storedItem.createdAt, NOW.toISOString(), "createdAt is not the write instant");
      eq(storedItem.expiresAt, expiresAt, "the explicit expiry changed on the way to disk");

      const read = await readBrief(root);
      eq(read.writtenAt, NOW.toISOString(), "the read lost writtenAt");
      eq(read.writtenBy, "companion", "the read lost writtenBy");
      deepEq(read.items, stored.items, "the read shape disagrees with the file it read");
      deepEq(read.problems, [], "a healthy file reported problems");
      deepEq(read.recentlyExpired, [], "a healthy file reported an expired item");

      // The write is attributable: it lands in the Life log naming the companion.
      const log = await readLog(root);
      ok(log.ok, "readLog failed");
      const events = log.ok ? log.value : [];
      const briefEvents = events.filter((e) => e.type === "brief.written");
      eq(briefEvents.length, 1, "the write did not log exactly one brief.written event");
      eq(briefEvents[0].actor?.type, "agent", "the log entry has no agent actor");
      eq((briefEvents[0].actor as { id?: string }).id, "companion", "the log entry does not name the companion");
      const payload = briefEvents[0].payload as { expiredSincePreviousWrite?: number } | null;
      eq(payload?.expiredSincePreviousWrite, 0, "the log entry lost expiredSincePreviousWrite");

      claim(
        "the brief round-trips through .lifequest/companion-brief.json: id, kind, trimmed text and why, sourceRef, domainSlug, priority, createdAt and expiresAt all survive, and the write is attributed in the Life log",
        `wrote ${briefFile(root)}; read ${read.items.length} item(s) back; logged type ${briefEvents[0].type} by companion`,
      );
      readback.roundtrip = {
        path: briefFile(root),
        storedItem,
        writtenAt: stored.writtenAt,
        logged: { type: briefEvents[0].type, payload },
      };
    });
    end(CASES.roundtrip);
  });

  // ── missing / corrupt files ───────────────────────────────────────────────

  it(CASES.missing, async () => {
    begin(CASES.missing);
    await withVault(async (root) => {
      eq(fs.existsSync(briefFile(root)), false, "createVault already wrote a brief file");
      const read = await readBrief(root);
      eq(read.writtenAt, null, "a missing brief reported a writtenAt");
      eq(read.writtenBy, null, "a missing brief reported a writtenBy");
      deepEq(read.items, [], "a missing brief did not read as empty");
      deepEq(read.recentlyExpired, [], "a missing brief reported expired items");
      deepEq(read.dismissals, [], "a missing brief reported dismissals");
      deepEq(read.problems, [], "a missing brief is not a problem");
      eq(fs.existsSync(briefFile(root)), false, "reading a missing brief wrote the file");

      const reply = toolReply(await executeCompanionBriefTool(root, COMPANION, "get_companion_brief", {}, NOW));
      eq(reply.writtenAt, null, "the tool invented a writtenAt for a missing brief");
      deepEq(reply.items, [], "the tool did not report the missing brief as empty");
      ok(
        String(reply.note ?? "").includes("no active items"),
        "the tool did not explain that the brief is empty",
      );
      claim(
        "a missing brief file reads as an empty brief with problems:[] and is not created by the read; the tool explains the empty state instead of failing",
        `writtenAt ${String(read.writtenAt)}, ${read.items.length} items, ${read.problems.length} problems, file still absent`,
      );
      readback.missing = { writtenAt: read.writtenAt, items: read.items.length, problems: read.problems, note: reply.note };
    });
    end(CASES.missing);
  });

  it(CASES.corrupt, async () => {
    begin(CASES.corrupt);
    await withVault(async (root) => {
      fs.writeFileSync(briefFile(root), "{ this is not json\n");
      const corruptBytes = briefBytes(root);

      const read = await readBrief(root);
      eq(read.writtenAt, null, "a corrupt file reported a writtenAt");
      deepEq(read.items, [], "a corrupt file did not read as empty");
      deepEq(read.dismissals, [], "a corrupt file did not read as an empty log");
      eq(read.problems.length, 1, "a corrupt file did not report exactly one problem");
      ok(
        read.problems[0].includes("not valid JSON"),
        `the problem does not say the file is not JSON: ${JSON.stringify(read.problems[0])}`,
      );
      eq(
        Buffer.compare(briefBytes(root), corruptBytes),
        0,
        "reading a corrupt file rewrote it",
      );

      // A JSON value that is not an object is the other unreadable shape.
      fs.writeFileSync(briefFile(root), "[]\n");
      const arrayRead = await readBrief(root);
      deepEq(arrayRead.items, [], "a JSON array did not read as empty");
      ok(
        arrayRead.problems.some((p) => p.includes("does not hold an object")),
        `the problem does not name the shape: ${JSON.stringify(arrayRead.problems)}`,
      );

      // A corrupt file never blocks the next write: the companion's new brief
      // simply replaces it.
      await writeBrief(root, [item({ id: "after-corruption", text: "A clean brief over a corrupt file" })]);
      const recovered = readStoredBrief(root);
      eq(recovered.items.length, 1, "a corrupt file blocked the next write");
      eq(recovered.items[0].id, "after-corruption", "the recovered brief is not the one that was written");
      const recoveredRead = await readBrief(root);
      deepEq(recoveredRead.problems, [], "the recovered brief still reports a problem");

      claim(
        "a corrupt brief file never throws: it reads as empty with a problems[] entry naming the fault, is left byte-identical, and the next write replaces it cleanly",
        `${read.problems[0]}; the array shape reported "${arrayRead.problems[0]}"; a clean write recovered the file`,
      );
      readback.corrupt = {
        problem: read.problems[0],
        arrayProblem: arrayRead.problems[0],
        recovered: recovered.items[0].id,
      };
    });
    end(CASES.corrupt);
  });

  // ── the get tool ──────────────────────────────────────────────────────────

  it(CASES.getTool, async () => {
    begin(CASES.getTool);
    await withVault(async (root) => {
      // Four full rounds of five items, each item answered, then a fifth round
      // with three answers: 23 dismissals across five writes. The log must keep
      // the newest twenty and the replies must show the newest first.
      let lastWrittenAt = "";
      for (let round = 0; round < 4; round += 1) {
        const at = plus(NOW, round * 10 * MIN);
        const items = Array.from({ length: BRIEF_ITEMS_MAX }, (_, i) =>
          item({ id: `r${round}-${i}`, text: `Round ${round} item ${i}`, priority: i + 1 }),
        );
        const written = await writeBrief(root, items, at);
        lastWrittenAt = written.brief.writtenAt ?? "";
        for (let i = 0; i < items.length; i += 1) {
          const dismissed = await dismissBriefItem(
            root,
            USER,
            `r${round}-${i}`,
            BRIEF_OPERATOR_REASONS[i % BRIEF_OPERATOR_REASONS.length],
            plus(at, (i + 1) * 1000),
          );
          eq(dismissed.ok, true, `round ${round} dismissal ${i} failed`);
        }
      }
      const lastRoundAt = plus(NOW, 40 * MIN);
      await writeBrief(
        root,
        Array.from({ length: BRIEF_ITEMS_MAX }, (_, i) =>
          item({ id: `r4-${i}`, text: `Round 4 item ${i}`, priority: i + 1 }),
        ),
        lastRoundAt,
      );
      lastWrittenAt = lastRoundAt.toISOString();
      for (let i = 0; i < 3; i += 1) {
        const dismissed = await dismissBriefItem(
          root,
          USER,
          `r4-${i}`,
          BRIEF_OPERATOR_REASONS[i],
          plus(lastRoundAt, (i + 1) * 1000),
        );
        eq(dismissed.ok, true, `round 4 dismissal ${i} failed`);
      }

      const at = plus(NOW, 60 * MIN);
      const reply = toolReply(await executeCompanionBriefTool(root, COMPANION, "get_companion_brief", {}, at));
      eq(reply.error, undefined, `get_companion_brief failed: ${JSON.stringify(reply.error)}`);
      eq(reply.writtenAt, lastWrittenAt, "get_companion_brief lost writtenAt");
      eq(reply.writtenBy, "companion", "get_companion_brief lost writtenBy");
      deepEq(
        (reply.items as Array<{ id: string }>).map((i) => i.id),
        ["r4-3", "r4-4"],
        "get_companion_brief did not return the two items the operator has not answered",
      );
      eq("problems" in reply, false, "a healthy brief reported problems through the tool");

      const dismissals = reply.dismissals as BriefDismissal[];
      eq(dismissals.length, BRIEF_DISMISSALS_SHOWN, `the tool returned ${dismissals.length} dismissals, not the last twenty`);
      eq(dismissals[0].itemId, "r4-2", "the newest dismissal is not first");
      ok(
        dismissals.every((d, i) => i === 0 || dismissals[i - 1].dismissedAt >= d.dismissedAt),
        "the dismissals are not newest first",
      );
      ok(
        dismissals.some((d) => d.itemId === "r4-0"),
        "a dismissal cast away by the twenty-entry window is missing from the newest entries",
      );
      eq(
        dismissals.some((d) => d.itemId === "r0-0"),
        false,
        "the oldest dismissal survived the twenty-entry window",
      );
      deepEq(
        [...new Set(dismissals.map((d) => d.reason))].sort(),
        [...BRIEF_OPERATOR_REASONS].sort(),
        "the dismissals lost the reasons the operator chose",
      );

      const read = await readBrief(root, at);
      eq(read.dismissals.length, BRIEF_DISMISSALS_SHOWN, "the engine read and the tool disagree about the log");
      deepEq(read.items.map((i) => i.id), ["r4-3", "r4-4"], "the engine read and the tool disagree about the active set");
      claim(
        "get_companion_brief returns writtenAt, the active items in priority order and the newest twenty dismissals, newest first, without a problems key on a healthy file",
        `${dismissals.length} dismissals shown from 23 recorded, newest ${dismissals[0].itemId}, active ${(reply.items as Array<{ id: string }>).map((i) => i.id).join("+")}`,
      );
      readback.getTool = {
        writtenAt: reply.writtenAt,
        activeItems: (reply.items as Array<{ id: string }>).map((i) => i.id),
        dismissalsShown: dismissals.length,
        newest: dismissals[0],
        oldestShown: dismissals[dismissals.length - 1],
      };
    });
    end(CASES.getTool);
  });

  // ── expiry ────────────────────────────────────────────────────────────────

  it(CASES.expiry, async () => {
    begin(CASES.expiry);
    await withVault(async (root) => {
      const T0 = NOW;
      const soon = plus(T0, HOUR).toISOString();
      const later = plus(T0, 2 * HOUR).toISOString();
      await writeBrief(root, [
        item({ id: "soon", text: "Expires an hour from the write", priority: 1, expiresAt: soon }),
        item({ id: "later", text: "Expires two hours from the write", priority: 2, expiresAt: later }),
      ]);

      const stored = readStoredBrief(root);

      // The pure pass, with no file involved: it says what the clock implies and
      // does not mutate the brief it is handed.
      const halfHour = plus(T0, 30 * MIN);
      const noSweep = expireBriefItems(stored, halfHour);
      eq(noSweep.changed, false, "the expiry pass claimed a change before anything expired");
      eq(noSweep.newlyExpired.length, 0, "an item that has not expired was reported expired");

      const at90 = plus(T0, 90 * MIN);
      const pureSweep = expireBriefItems(stored, at90);
      deepEq(pureSweep.newlyExpired.map((i) => i.id), ["soon"], "the pure pass did not report the lapsed item");
      eq(pureSweep.changed, true, "the pure pass did not record a change");
      eq(stored.items.length, 2, "expireBriefItems mutated the brief it was handed");
      eq(stored.dismissalLog.length, 0, "expireBriefItems mutated the log it was handed");
      eq(pureSweep.brief.dismissalLog.length, 1, "the pure pass did not record expired-unseen");
      eq(pureSweep.brief.dismissalLog[0].reason, "expired-unseen", "the pure pass recorded the wrong reason");

      // Half an hour in, both items are still active.
      const at30 = await readBrief(root, halfHour);
      deepEq(at30.items.map((i) => i.id), ["soon", "later"], "an unexpired item is missing from the active set");
      deepEq(at30.recentlyExpired, [], "an unexpired item was reported as recently expired");

      // Ninety minutes in, the first item has lapsed with no answer. The READER
      // records that, because nobody clicked it.
      const at90Read = await readBrief(root, at90);
      deepEq(at90Read.items.map((i) => i.id), ["later"], "an expired item is still active");
      deepEq(at90Read.recentlyExpired.map((i) => i.id), ["soon"], "the expired item is not drawn faded");
      deepEq(at90Read.problems, [], "the expiry pass reported a problem");
      const soonEntry = at90Read.dismissals.find((d) => d.itemId === "soon");
      ok(soonEntry, "the lapse was not recorded in the dismissal log");
      eq(soonEntry.reason, "expired-unseen", "the lapse was not recorded as expired-unseen");
      eq(soonEntry.dismissedAt, at90.toISOString(), "the lapse is not stamped with the instant the reader saw it");

      // The read persisted its bookkeeping: the next reader sees the same log,
      // and a second read does not record the same lapse twice.
      const afterFirstRead = readStoredBrief(root);
      eq(
        afterFirstRead.dismissalLog.filter((d) => d.itemId === "soon").length,
        1,
        "the read did not persist the expired-unseen entry",
      );
      eq(
        afterFirstRead.items.some((i) => i.id === "soon"),
        true,
        "the lapsed item vanished from storage before its day of faded visibility",
      );
      const reread = await readBrief(root, at90);
      eq(
        reread.dismissals.filter((d) => d.itemId === "soon").length,
        1,
        "a second read recorded the same lapse again",
      );

      // A day after its expiry the item is gone from the record; only the
      // dismissal remains.
      const at26 = plus(T0, 26 * HOUR);
      const at26Read = await readBrief(root, at26);
      deepEq(at26Read.items, [], "an item expired for more than a day is still active");
      deepEq(at26Read.recentlyExpired, [], "an item expired for more than a day is still drawn faded");
      const soonAfter = at26Read.dismissals.find((d) => d.itemId === "soon");
      ok(soonAfter, "the expired item's dismissal was forgotten");
      eq(soonAfter.dismissedAt, at90.toISOString(), "the dismissal timestamp moved on the later read");
      const laterEntry = at26Read.dismissals.find((d) => d.itemId === "later");
      ok(laterEntry, "the item that lapsed unseen overnight was not recorded");
      eq(laterEntry.reason, "expired-unseen", "the overnight lapse was not recorded as expired-unseen");
      eq(laterEntry.dismissedAt, at26.toISOString(), "the overnight lapse was not stamped when it was first seen");
      eq(readStoredBrief(root).items.length, 0, "the pruned items are still in the stored file");

      claim(
        "an item past its expiry leaves the active set and is recorded by the reader as expired-unseen, stays drawable faded for a day, then is pruned from the record while the dismissal remains",
        `soon expired at ${soon}, was faded at 90m and pruned by 26h; its expired-unseen entry is stamped ${soonEntry.dismissedAt}; the unread later item was recorded at ${laterEntry.dismissedAt}`,
      );
      readback.expiry = {
        writtenExpiries: { soon, later },
        activeAt90m: at90Read.items.map((i) => i.id),
        fadedAt90m: at90Read.recentlyExpired.map((i) => i.id),
        expiredUnseenAt90m: soonEntry,
        activeAt26h: at26Read.items.length,
        dismissalsAt26h: at26Read.dismissals,
        visibleWindowHours: BRIEF_EXPIRED_VISIBLE_MS / HOUR,
      };
    });
    end(CASES.expiry);
  });

  it(CASES.expiredCount, async () => {
    begin(CASES.expiredCount);
    await withVault(async (root) => {
      const T0 = NOW;
      const lapsedAt = plus(T0, HOUR).toISOString();
      await writeBrief(root, [
        item({ id: "lapse-1", text: "First item that lapses", expiresAt: lapsedAt }),
        item({ id: "lapse-2", text: "Second item that lapses", expiresAt: lapsedAt }),
      ]);

      // The reader records both lapses overnight...
      const read = await readBrief(root, plus(T0, 90 * MIN));
      eq(read.dismissals.filter((d) => d.reason === "expired-unseen").length, 2, "the reader did not record both lapses");

      // ...and the next write still reports both, because the question is what
      // happened between the two writes, not what this call's own sweep found.
      const replacement = await writeBrief(
        root,
        [item({ id: "replacement", text: "A fresh brief the next morning" })],
        plus(T0, 3 * HOUR),
      );
      eq(replacement.expiredSincePreviousWrite, 2, "the write under-reported the lapses it replaced");
      const logAfterReplacement = await readLog(root);
      const writtenEvents = (logAfterReplacement.ok ? logAfterReplacement.value : []).filter(
        (e) => e.type === "brief.written",
      );
      const replacementPayload = writtenEvents[writtenEvents.length - 1].payload as {
        expiredSincePreviousWrite?: number;
      } | null;
      eq(replacementPayload?.expiredSincePreviousWrite, 2, "the logged count disagrees with the reply");

      // A write immediately after has nothing to report: the window starts at
      // the previous write's own instant.
      const quiet = await writeBrief(
        root,
        [item({ id: "quiet", text: "Nothing lapsed since the last write" })],
        plus(T0, 3 * HOUR + MIN),
      );
      eq(quiet.expiredSincePreviousWrite, 0, "a quiet write invented a lapse");

      // An item that lapses between two writes with no reader in between is
      // still counted, and counted once.
      await writeBrief(
        root,
        [item({ id: "doomed", text: "Written to lapse before the next write", expiresAt: plus(T0, 3 * HOUR + 3 * MIN).toISOString() })],
        plus(T0, 3 * HOUR + 2 * MIN),
      );
      const afterLapse = await writeBrief(
        root,
        [item({ id: "survivor", text: "The write after the lapse" })],
        plus(T0, 3 * HOUR + 5 * MIN),
      );
      eq(afterLapse.expiredSincePreviousWrite, 1, "an unread lapse between writes was not counted");

      claim(
        "set_companion_brief reports expiredSincePreviousWrite: the count of prior items that lapsed unanswered between the previous write and this one, whether or not a reader recorded them first",
        `two lapses recorded by the reader counted as ${replacement.expiredSincePreviousWrite}; a quiet write counted ${quiet.expiredSincePreviousWrite}; one lapse with no reader between writes counted ${afterLapse.expiredSincePreviousWrite}`,
      );
      readback.expiredCount = {
        replacedLapses: replacement.expiredSincePreviousWrite,
        quiet: quiet.expiredSincePreviousWrite,
        unreadLapse: afterLapse.expiredSincePreviousWrite,
      };
    });
    end(CASES.expiredCount);
  });

  // ── dismissal ─────────────────────────────────────────────────────────────

  it(CASES.dismissRefusals, async () => {
    begin(CASES.dismissRefusals);
    await withVault(async (root) => {
      await writeBrief(root, [
        item({ id: "keep-a", text: "First item", priority: 1 }),
        item({ id: "keep-b", text: "Second item", priority: 2 }),
      ]);
      const before = briefBytes(root);

      const byCompanion = await dismissBriefItem(root, COMPANION, "keep-a", "done", NOW);
      eq(byCompanion.ok, false, "the companion dismissed its own item");
      eq(byCompanion.ok ? "" : byCompanion.error, "Only the operator can dismiss a brief item", "the companion was refused with the wrong message");

      const byHire = await dismissBriefItem(root, HIRE, "keep-a", "done", NOW);
      eq(byHire.ok, false, "a connected agent dismissed a brief item");
      eq(byHire.ok ? "" : byHire.error, "Only the operator can dismiss a brief item", "the hire was refused with the wrong message");

      const badReason = await dismissBriefItem(
        root,
        USER,
        "keep-a",
        "expired-unseen" as unknown as BriefDismissalReason,
        NOW,
      );
      eq(badReason.ok, false, "the operator was allowed to choose the reader's own reason");
      const badReasonMessage = badReason.ok ? "" : badReason.error;
      ok(badReasonMessage.includes("is not one of"), `the reason refusal does not list the allowed reasons: ${JSON.stringify(badReasonMessage)}`);
      for (const reason of BRIEF_OPERATOR_REASONS) {
        ok(
          badReasonMessage.includes(reason),
          `the reason refusal does not name ${JSON.stringify(reason)}`,
        );
      }

      const unknown = await dismissBriefItem(root, USER, "no-such-item", "done", NOW);
      eq(unknown.ok, false, "an unknown item was dismissed");
      eq(unknown.ok ? "" : unknown.error, "unknown brief item: no-such-item", "the unknown-item refusal is not the documented message");

      const noId = await dismissBriefItem(root, USER, "   ", "done", NOW);
      eq(noId.ok, false, "an empty itemId was accepted");
      eq(noId.ok ? "" : noId.error, "itemId is required", "the empty-id refusal is not the documented message");

      eq(
        Buffer.compare(briefBytes(root), before),
        0,
        "a refused dismissal changed .lifequest/companion-brief.json",
      );
      claim(
        "dismissal is the operator's verb only: the companion and a connected agent are refused, the reader's own expired-unseen reason is not offered to the operator, and an unknown or empty item id is refused without touching the file",
        `companion: "${byCompanion.ok ? "" : byCompanion.error}"; hire: "${byHire.ok ? "" : byHire.error}"; bad reason: "${badReasonMessage}"; unknown: "${unknown.ok ? "" : unknown.error}"`,
      );
      readback.dismissRefusals = {
        companion: byCompanion.ok ? "" : byCompanion.error,
        hire: byHire.ok ? "" : byHire.error,
        badReason: badReasonMessage,
        unknown: unknown.ok ? "" : unknown.error,
        noId: noId.ok ? "" : noId.error,
      };
    });
    end(CASES.dismissRefusals);
  });

  it(CASES.dismiss, async () => {
    begin(CASES.dismiss);
    await withVault(async (root) => {
      const T0 = NOW;
      await writeBrief(root, [
        item({ id: "item-a", text: "The item the operator settles", priority: 1 }),
        item({ id: "item-b", text: "The item left standing", priority: 2 }),
      ]);
      const before = readStoredBrief(root);

      const at1 = plus(T0, MIN);
      const settled = await dismissBriefItem(root, USER, "item-a", "done", at1);
      eq(settled.ok, true, `the operator's dismissal failed: ${settled.ok ? "" : settled.error}`);
      if (!settled.ok) return;
      const afterSettle = settled.value;
      deepEq(afterSettle.items.map((i) => i.id), ["item-b"], "the dismissed item is still active");
      eq(afterSettle.dismissals.length, 1, "the dismissal was not reported");
      eq(afterSettle.dismissals[0].itemId, "item-a", "the dismissal names the wrong item");
      eq(afterSettle.dismissals[0].reason, "done", "the dismissal lost the operator's reason");
      eq(afterSettle.dismissals[0].dismissedAt, at1.toISOString(), "the dismissal is not stamped with the click");
      deepEq(afterSettle.recentlyExpired, [], "settling an active item produced an expired item");

      // A dismissal answers an item; it does not delete it from the record.
      const stored = readStoredBrief(root);
      deepEq(stored.items.map((i) => i.id), ["item-a", "item-b"], "a dismissal deleted the item from the file");
      eq(stored.dismissalLog.length, 1, "the dismissal log has the wrong length");
      eq(stored.dismissalLog[0].itemId, "item-a", "the stored dismissal names the wrong item");

      // The other item is untouched, and the next read/get report the answer.
      const at2 = plus(T0, 2 * MIN);
      const next = await readBrief(root, at2);
      deepEq(next.items.map((i) => i.id), ["item-b"], "the dismissed item returned on the next read");
      eq(next.dismissals.length, 1, "the answer vanished from the next read");
      const storedB = before.items.find((i) => i.id === "item-b");
      deepEq(next.items[0], storedB, "dismissing item-a changed item-b");

      const viaTool = toolReply(await executeCompanionBriefTool(root, COMPANION, "get_companion_brief", {}, at2));
      eq(viaTool.dismissals[0].itemId, "item-a", "the next get did not return the dismissal");
      eq(viaTool.dismissals[0].reason, "done", "the next get lost the dismissal reason");
      deepEq((viaTool.items as Array<{ id: string }>).map((i) => i.id), ["item-b"], "the next get returned the dismissed item");

      // Changing an answer replaces that item's entry instead of adding one.
      const at3 = plus(T0, 3 * MIN);
      const changed = await dismissBriefItem(root, USER, "item-a", "wrong", at3);
      eq(changed.ok, true, "changing the dismissal failed");
      if (!changed.ok) return;
      const entriesForA = changed.value.dismissals.filter((d) => d.itemId === "item-a");
      eq(entriesForA.length, 1, "a changed answer wrote a second entry for the same item");
      eq(entriesForA[0].reason, "wrong", "a changed answer kept the old reason");
      eq(entriesForA[0].dismissedAt, at3.toISOString(), "a changed answer kept the old timestamp");

      const at4 = plus(T0, 4 * MIN);
      const second = await dismissBriefItem(root, USER, "item-b", "later", at4);
      eq(second.ok, true, "the second dismissal failed");
      if (!second.ok) return;
      deepEq(second.value.items, [], "the brief still has active items after both were answered");
      eq(second.value.dismissals.length, 2, "the dismissal log lost an answer");
      eq(second.value.dismissals[0].itemId, "item-b", "the dismissals are not newest first");
      const emptyGet = toolReply(await executeCompanionBriefTool(root, COMPANION, "get_companion_brief", {}, at4));
      eq((emptyGet.items as unknown[]).length, 0, "the get returned answered items");
      eq((emptyGet.dismissals as unknown[]).length, 2, "the get lost an answer");
      ok(String(emptyGet.note ?? "").includes("no active items"), "the get did not explain that the brief is now empty");
      ok(
        (emptyGet.dismissals as BriefDismissal[]).some((d) => d.itemId === "item-b" && d.reason === "later"),
        "the next get did not return the operator's answer",
      );

      claim(
        "settling one item touches only that item: the other stays active and unchanged, a changed answer replaces that item's entry, and the next get reports the operator's answer",
        `dismissed item-a (done) at ${at1.toISOString()}; active left ${afterSettle.items.map((i) => i.id).join(",")}; changed to ${entriesForA[0].reason}; final log ${second.value.dismissals.map((d) => `${d.itemId}:${d.reason}`).join(", ")}`,
      );
      readback.dismiss = {
        settled: afterSettle.dismissals[0],
        activeAfterSettle: afterSettle.items.map((i) => i.id),
        storedItems: stored.items.map((i) => i.id),
        changedAnswer: entriesForA[0],
        finalDismissals: second.value.dismissals,
      };
    });
    end(CASES.dismiss);
  });

  // ── retention ─────────────────────────────────────────────────────────────

  it(CASES.retention, async () => {
    begin(CASES.retention);
    await withVault(async (root) => {
      const inWindow: BriefDismissal[] = Array.from({ length: BRIEF_DISMISSAL_LOG_MAX + 10 }, (_, i) => ({
        itemId: `recent-${i}`,
        dismissedAt: plus(NOW, -(i + 1) * MIN).toISOString(),
        reason: "done" as const,
      }));
      const tooOld: BriefDismissal[] = Array.from({ length: 5 }, (_, i) => ({
        itemId: `old-${i}`,
        dismissedAt: plus(NOW, -BRIEF_DISMISSAL_RETENTION_MS - (i + 1) * MIN).toISOString(),
        reason: "later" as const,
      }));
      writeStoredBrief(root, {
        writtenAt: NOW.toISOString(),
        writtenBy: "companion",
        items: [],
        dismissalLog: [...inWindow, ...tooOld],
      });

      const read = await readBrief(root);
      eq(read.dismissals.length, BRIEF_DISMISSALS_SHOWN, "the read did not cap the visible log at twenty");
      eq(read.dismissals[0].itemId, "recent-0", "the read is not newest first");

      const stored = readStoredBrief(root);
      eq(stored.dismissalLog.length, BRIEF_DISMISSAL_LOG_MAX, "the stored log is not capped at 200 entries");
      eq(stored.dismissalLog[0].itemId, "recent-0", "the stored log is not newest first");
      eq(
        stored.dismissalLog.some((d) => d.itemId.startsWith("old-")),
        false,
        "a dismissal older than 90 days survived the prune",
      );
      eq(
        stored.dismissalLog.some((d) => d.itemId === `recent-${BRIEF_DISMISSAL_LOG_MAX + 9}`),
        false,
        "the 200-entry cap kept the oldest entries and dropped the newest",
      );
      ok(
        stored.dismissalLog.some((d) => d.itemId === `recent-${BRIEF_DISMISSAL_LOG_MAX - 1}`),
        "the cap dropped an entry it should have kept",
      );
      const cutoff = NOW.getTime() - BRIEF_DISMISSAL_RETENTION_MS;
      ok(
        stored.dismissalLog.every((d) => Date.parse(d.dismissedAt) >= cutoff),
        "the pruned log contains an entry past the retention window",
      );
      ok(
        stored.dismissalLog.every((d, i, log) => i === 0 || log[i - 1].dismissedAt >= d.dismissedAt),
        "the pruned log is not sorted newest first",
      );

      claim(
        "the dismissal log is pruned on read to the newest 200 entries and nothing older than 90 days, newest first, and the read shape shows only the newest twenty",
        `crafted ${inWindow.length + tooOld.length} entries (${tooOld.length} just past the window): kept ${stored.dismissalLog.length}, shown ${read.dismissals.length}, newest ${stored.dismissalLog[0].itemId}`,
      );
      readback.retention = {
        crafted: inWindow.length + tooOld.length,
        kept: stored.dismissalLog.length,
        shown: read.dismissals.length,
        newest: stored.dismissalLog[0],
        oldestKept: stored.dismissalLog[stored.dismissalLog.length - 1],
        retentionDays: BRIEF_DISMISSAL_RETENTION_MS / DAY,
      };
    });
    end(CASES.retention);
  });

  // ── pins ──────────────────────────────────────────────────────────────────

  it(CASES.pins, async () => {
    begin(CASES.pins);
    await withVault(async (root) => {
      const pinsPath = vaultPaths(root).overviewPins;

      ok(
        (SYSTEM_PIN_KINDS as readonly string[]).includes("companion-brief"),
        "SYSTEM_PIN_KINDS no longer contains companion-brief",
      );
      eq(defaultPins()[0].id, "sys:companion-brief", "a fresh board's default order does not start with the brief");
      eq(defaultPins().length, SYSTEM_PIN_KINDS.length, "defaultPins does not carry every system pin");

      // A board that has never been written reads as the defaults, with the
      // brief first — and reading does not create the file.
      const fresh = await listPinBoard(root, null);
      eq(fresh.ok, true, `listPinBoard failed: ${fresh.ok ? "" : fresh.error}`);
      if (!fresh.ok) return;
      eq(fresh.value.pins[0].id, "sys:companion-brief", "a fresh board does not seed the brief first");
      eq(
        (fresh.value.pins[0] as { system?: string }).system,
        "companion-brief",
        "the seeded first pin is not the companion brief",
      );
      eq(fresh.value.pins.length, SYSTEM_PIN_KINDS.length, "the fresh board lost a seeded card");
      eq(fs.existsSync(pinsPath), false, "reading a fresh board wrote a pin file");

      // A board written before the card existed: the read injects it first and
      // does NOT write the migration, because a read never writes.
      const preFeature = {
        schemaVersion: 1,
        pins: [{ id: "sys:today-week", kind: "system", system: "today-week" }],
        locked: false,
      };
      fs.writeFileSync(pinsPath, `${JSON.stringify(preFeature, null, 2)}\n`);
      const preFeatureBytes = fs.readFileSync(pinsPath);
      const migrated = await listPinBoard(root, null);
      eq(migrated.ok, true, `listPinBoard failed on a pre-feature board: ${migrated.ok ? "" : migrated.error}`);
      if (!migrated.ok) return;
      deepEq(
        migrated.value.pins.map((p) => p.id),
        ["sys:companion-brief", "sys:today-week"],
        "the pre-feature board did not get the brief injected first",
      );
      eq(
        Buffer.compare(fs.readFileSync(pinsPath), preFeatureBytes),
        0,
        "the read-injection wrote the old board file",
      );

      // The next board write records the seed, and from then on the operator's
      // arrangement wins: a brief they archived stays archived.
      const archivedPin = { id: "sys:today-week", kind: "system" as const, system: "today-week" as const };
      const archived = await setPins(root, null, [archivedPin], USER);
      eq(archived.ok, true, `setPins failed: ${archived.ok ? "" : archived.error}`);
      const onDisk = JSON.parse(fs.readFileSync(pinsPath, "utf8")) as {
        pins: Array<{ id: string }>;
        companionBriefSeeded?: boolean;
      };
      eq(onDisk.companionBriefSeeded, true, "the board write did not record companionBriefSeeded");
      deepEq(onDisk.pins.map((p) => p.id), ["sys:today-week"], "the board write kept a card that was archived");
      const afterArchive = await listPinBoard(root, null);
      eq(afterArchive.ok, true, "listPinBoard failed after archiving the brief");
      if (!afterArchive.ok) return;
      deepEq(
        afterArchive.value.pins.map((p) => p.id),
        ["sys:today-week"],
        "an archived brief came back on the next read",
      );

      // A board that already carries the card keeps its own position: the seed
      // only answers "was this board ever offered the card", never "move it".
      fs.writeFileSync(
        pinsPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            pins: [
              archivedPin,
              { id: "sys:companion-brief", kind: "system", system: "companion-brief" },
            ],
            locked: false,
          },
          null,
          2,
        )}\n`,
      );
      const keptPlace = await listPinBoard(root, null);
      eq(keptPlace.ok, true, "listPinBoard failed on a board that already carries the brief");
      if (!keptPlace.ok) return;
      deepEq(
        keptPlace.value.pins.map((p) => p.id),
        ["sys:today-week", "sys:companion-brief"],
        "a board that already carries the brief had it moved",
      );

      claim(
        "the companion brief is a system pin: seeded first on a fresh board, read-injected first into a board written before the card existed without writing that board, and sticky once archived because companionBriefSeeded is recorded by the next board write",
        `fresh board ${fresh.value.pins[0]?.id} first; pre-feature read ${migrated.value.pins.map((p) => p.id).join(",")}; after archive ${afterArchive.value.pins.map((p) => p.id).join(",")}; kept place ${keptPlace.value.pins.map((p) => p.id).join(",")}`,
      );
      readback.pins = {
        systemPinKinds: [...SYSTEM_PIN_KINDS],
        freshBoard: fresh.value.pins.map((p) => p.id),
        preFeature: migrated.value.pins.map((p) => p.id),
        archived: afterArchive.value.pins.map((p) => p.id),
        keptPlace: keptPlace.value.pins.map((p) => p.id),
      };
    });
    end(CASES.pins);
  });

  // ── tools ─────────────────────────────────────────────────────────────────

  it(CASES.tools, async () => {
    begin(CASES.tools);
    const briefTools = ALL_TOOL_DEFS.filter((tool) => tool.name.includes("brief"));
    deepEq(
      briefTools.map((tool) => tool.name),
      ["get_companion_brief", "set_companion_brief"],
      "the registered brief tools are not exactly get and set",
    );
    const names = new Set(ALL_TOOL_DEFS.map((tool) => tool.name));
    ok(names.has("get_companion_brief"), "get_companion_brief is not in ALL_TOOL_DEFS");
    ok(names.has("set_companion_brief"), "set_companion_brief is not in ALL_TOOL_DEFS");
    eq(names.has("dismiss_brief_item"), false, "a dismiss tool is registered; the companion must not clear its own items");
    eq(names.has("dismiss_companion_brief"), false, "a dismiss tool is registered under another name");

    ok(COMPANION_ONLY_TOOLS.has("get_companion_brief"), "get_companion_brief is not companion-only");
    ok(COMPANION_ONLY_TOOLS.has("set_companion_brief"), "set_companion_brief is not companion-only");

    // A connected hire, with a domain and the Write switch on, is still refused
    // both tools: the brief is the studio's word, not a domain's record.
    const readGrant: ConnectedGrant = {
      agentId: "hire-1",
      name: "A Hire",
      access: "read",
      domainSlugs: ["financial"],
      schedule: false,
    };
    const writeGrant: ConnectedGrant = { ...readGrant, access: "write" };
    for (const grant of [readGrant, writeGrant]) {
      eq(toolAllowed("get_companion_brief", grant), "FORBIDDEN", `a ${grant.access} grant was allowed to read the brief`);
      eq(toolAllowed("set_companion_brief", grant), "FORBIDDEN", `a ${grant.access} grant was allowed to write the brief`);
    }
    eq(connectedWriteKind("get_companion_brief"), null, "get_companion_brief is classified as a grant write");
    eq(connectedWriteKind("set_companion_brief"), null, "set_companion_brief is classified as a grant write");

    // The renderer's change signal: the read must not repaint the dashboard,
    // the write must.
    eq(READ_ONLY_TOOLS.has("get_companion_brief"), true, "get_companion_brief is not in READ_ONLY_TOOLS");
    eq(READ_ONLY_TOOLS.has("set_companion_brief"), false, "set_companion_brief is in READ_ONLY_TOOLS");
    eq(toolMayChangeData("get_companion_brief"), false, "a brief read is treated as a data change");
    eq(toolMayChangeData("set_companion_brief"), true, "a brief write is treated as a read");

    // The declared schema is the contract the companion reads: typed, sourced,
    // expiring items, never free text.
    const getDef = briefTools.find((tool) => tool.name === "get_companion_brief");
    const setDef = briefTools.find((tool) => tool.name === "set_companion_brief");
    ok(getDef && setDef, "a brief tool definition is missing");
    if (!getDef || !setDef) return;
    const setSchema = setDef.parameters as {
      properties: { items: { type?: string; items: { properties: Record<string, { enum?: string[]; description?: string }>; required?: string[] } } };
      required?: string[];
    };
    deepEq(setSchema.required, ["items"], "set_companion_brief does not require its item array");
    eq(setSchema.properties.items.type, "array", "set_companion_brief's items parameter is not an array");
    deepEq(
      setSchema.properties.items.items.required,
      ["kind", "text", "why", "priority"],
      "a brief item's required fields changed",
    );
    deepEq(
      setSchema.properties.items.items.properties.kind.enum,
      [...BRIEF_KINDS],
      "the declared kinds disagree with BRIEF_KINDS",
    );
    ok(
      String(setSchema.properties.items.items.properties.text.description).includes(String(BRIEF_TEXT_MAX)),
      "the text description does not name its limit",
    );
    ok(
      String(setSchema.properties.items.items.properties.why.description).includes(String(BRIEF_WHY_MAX)),
      "the why description does not name its limit",
    );

    await withVault(async (root) => {
      const setReply = toolReply(
        await executeCompanionBriefTool(
          root,
          COMPANION,
          "set_companion_brief",
          { items: [item({ id: "through-the-tool", text: "Written by the companion tool" })] },
          NOW,
        ),
      );
      eq(setReply.error, undefined, `set_companion_brief failed: ${JSON.stringify(setReply.error)}`);
      eq(setReply.writtenAt, NOW.toISOString(), "set_companion_brief lost writtenAt");
      eq(setReply.writtenBy, "companion", "set_companion_brief lost writtenBy");
      eq(setReply.expiredSincePreviousWrite, 0, "set_companion_brief lost expiredSincePreviousWrite");
      eq((setReply.items as Array<{ id: string }>)[0]?.id, "through-the-tool", "set_companion_brief returned the wrong item");

      const getReply = toolReply(await executeCompanionBriefTool(root, COMPANION, "get_companion_brief", {}, NOW));
      eq(getReply.error, undefined, `get_companion_brief failed: ${JSON.stringify(getReply.error)}`);
      eq(getReply.writtenAt, NOW.toISOString(), "the get did not see the write");
      deepEq(
        (getReply.items as Array<{ id: string }>).map((i) => i.id),
        ["through-the-tool"],
        "the get did not return the written item",
      );

      const refused = await executeCompanionBriefTool(
        root,
        USER,
        "set_companion_brief",
        { items: [item()] },
        NOW,
      );
      eq(toolError(refused).code, "FORBIDDEN", "the tool accepted the operator as a writer");
      eq(
        toolError(refused).message,
        "the brief is written by the companion only",
        "the tool refusal does not carry the engine's message",
      );

      const malformed = await executeCompanionBriefTool(
        root,
        COMPANION,
        "set_companion_brief",
        { items: Array.from({ length: BRIEF_ITEMS_MAX + 1 }, (_, i) => item({ text: `Tool item ${i}` })) },
        NOW,
      );
      eq(toolError(malformed).code, "MALFORMED", "the tool filed a malformed write under another code");
      eq(
        toolError(malformed).message,
        `too many brief items (max ${BRIEF_ITEMS_MAX})`,
        "the tool lost the engine's count message",
      );

      const unknown = await executeCompanionBriefTool(
        root,
        COMPANION,
        "dismiss_brief_item",
        { itemId: "through-the-tool" },
        NOW,
      );
      eq(toolError(unknown).code, "MALFORMED", "the vanish-or-not dismiss tool did not answer MALFORMED");
      eq(
        toolError(unknown).message,
        "Unknown companion brief tool: dismiss_brief_item",
        "there is no dismiss tool, but the unknown-tool reply disagrees",
      );

      readback.tools = {
        registered: briefTools.map((tool) => tool.name),
        companionOnly: [...COMPANION_ONLY_TOOLS].filter((name) => name.includes("brief")),
        grantAnswers: {
          read: toolAllowed("get_companion_brief", readGrant),
          write: toolAllowed("set_companion_brief", writeGrant),
        },
        readOnly: READ_ONLY_TOOLS.has("get_companion_brief"),
        setMayChangeData: toolMayChangeData("set_companion_brief"),
        toolWrite: {
          writtenAt: setReply.writtenAt,
          expiredSincePreviousWrite: setReply.expiredSincePreviousWrite,
        },
        toolRead: { writtenAt: getReply.writtenAt, items: (getReply.items as Array<{ id: string }>).map((i) => i.id) },
        refusals: {
          user: toolError(refused),
          malformed: toolError(malformed),
          dismiss: toolError(unknown),
        },
      };
    });

    claim(
      "the tool surface is get_companion_brief and set_companion_brief only — there is no dismiss tool — and both are refused to a connected grant",
      "ALL_TOOL_DEFS filter holds exactly those two names; toolAllowed returns FORBIDDEN for a read and a write grant; executeCompanionBriefTool('dismiss_brief_item') returns MALFORMED Unknown companion brief tool",
    );
    end(CASES.tools);
  });

  // ── the artifact ──────────────────────────────────────────────────────────

  after(() => {
    const caseNames = Object.values(CASES);
    const failed = caseNames.filter((name) => !passedCases.has(name));
    const report = {
      pass: failed.length === 0,
      what: "the companion brief engine: validation by rule, replace-not-append, expiry bookkeeping, operator dismissal, retention, pin seeding and the companion-only tool surface",
      command:
        "cd apps/desktop && node --experimental-strip-types --test tests/companion-brief-e2e.test.ts",
      engine: [
        "packages/vault-core/src/companion-brief.ts",
        "packages/vault-core/src/companion-brief-tools.ts",
        "packages/vault-core/src/pins.ts",
        "apps/desktop/electron/data-revision.ts",
      ],
      cases: caseNames.map((name) => ({ name, passed: passedCases.has(name) })),
      failedCases: failed,
      assertions: {
        count: assertionCount,
        byCase: Object.fromEntries(assertionsByCase),
      },
      claims,
      readback,
      isolation:
        "none of the real profile is touched: every vault is a temp directory created with createVault and removed at the end of its case",
      transcript,
      generatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    eq(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    eq(report.pass, true, `cases failed: ${failed.join(", ")}`);
  });
});
