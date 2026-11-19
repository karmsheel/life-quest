import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ALL_TOOL_DEFS,
  CONNECTED_SCHEDULE_TOOLS,
  DEFAULT_REVIEW_AVAILABILITY,
  RECURRING_HISTORY_LIMIT,
  REVIEW_CADENCES,
  applyMapCommand,
  createVault,
  dueRecurringItems,
  ensureMapOnOpen,
  isRecurrence,
  loadMapState,
  nextOccurrenceAfter,
  occurrenceOnOrAfter,
  openReviewDate,
  openReviewPeriod,
  recurringState,
  toolAllowed,
  todayLocalIso,
} from "@lifequest/vault-core";
import type {
  ConnectedGrant,
  Recurrence,
  RecurringTask,
  ReviewIndexEntry,
  StoreState,
  VaultSnapshot,
  WeekStartDay,
} from "@lifequest/vault-core";
import { ensureCompanionToken } from "../electron/pairing-secrets.ts";

/**
 * The one toolchain shim this rig needs.
 *
 * `pairing-door.ts` is real Electron-main code and is imported with its own
 * `.ts` extension (Node's type stripping accepts that). One module it pulls in,
 * `theme-tools.ts`, writes a relative dependency as `./theme-store.js` — the
 * TypeScript style that assumes a compiler rewrites the specifier. Node 22's
 * type stripping does not rewrite `.js` to `.ts`, so importing the real door
 * under the contracted command would die with ERR_MODULE_NOT_FOUND before a
 * single claim ran. The hook below only rescues exactly that case (a relative
 * `.js` specifier from a `.ts` file with no such `.js` on disk); it changes no
 * vault code and adds nothing to the door. When the electron sources adopt
 * `.ts` specifiers consistently this becomes a no-op.
 *
 * The second rescue is the same story one step further along: the door's theme
 * tools (`electron/theme-tools.ts`) import `electron` for `app.getPath`. This is
 * a plain-`node:test` rig, deliberately never Electron, and the door's claims
 * are about the MCP wire and the vault — the theme module's app paths are not
 * reached. A minimal stand-in keeps the import graph loadable without pretending
 * any Electron behaviour, and `tools/list` still advertises the real theme tools.
 */
const ELECTRON_STUB =
  "data:text/javascript," +
  encodeURIComponent(
    [
      "const app = {",
      '  getPath: () => "/tmp/lifequest-recurring-e2e-electron",',
      '  getName: () => "LifeQuest",',
      '  getVersion: () => "0.0.0",',
      "};",
      'const nativeTheme = { themeSource: "dark" };',
      "export { app, nativeTheme };",
      "export default { app, nativeTheme };",
    ].join("\n"),
  );

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron" && context.parentURL?.endsWith(".ts")) {
      return { url: ELECTRON_STUB, format: "module", shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        specifier.startsWith(".") &&
        specifier.endsWith(".js") &&
        typeof context.parentURL === "string" &&
        context.parentURL.endsWith(".ts")
      ) {
        try {
          return nextResolve(`${specifier.slice(0, -".js".length)}.ts`, context);
        } catch {
          // Not a TypeScript sibling: fall through to the original refusal.
        }
      }
      throw error;
    }
  },
});

// Loaded after the hook, so the real door and its whole import graph resolve.
const { startPairingDoors } = await import("../electron/pairing-door.ts");
/**
 * The recurring-task engine and its companion/tool door, end to end over a real
 * vault and the real MCP server. No Electron.
 *
 * WHY THIS FILE EXISTS
 *
 * "How can I keep track of certain tasks that are recurring? For example weekly
 * review is a recurring task and should pop up under the Today & this week card"
 * — the feature has three surfaces (engine, renderer, companion door) built in
 * parallel against one contract. This rig owns the two that are not pixels: the
 * record and its calendar, and the four tools a connected agent calls over
 * HTTP. The shipped screen has its own rig (`recurring-tasks-e2e.test.ts`);
 * every number below is derived from a real `map.json`, not remembered.
 *
 * THE WAYS THIS FEATURE COULD FAIL, WRITTEN DOWN BEFORE THE ASSERTIONS
 *
 *   1. The record is not persisted at all, or is written under a key the reader
 *      does not read back — so a task survives only until the vault reopens.
 *   2. An old map file (written before this feature) is treated as corrupt
 *      instead of loading with no recurring tasks.
 *   3. A created record gets a due date that does not match its cadence (a
 *      Monday weekly task due on a Tuesday), so the row lies about the schedule.
 *   4. A bad cadence is stored anyway: a weekly record with no weekday, an
 *      external URL in the internal-route field, or 30 February as a date.
 *   5. The dashboard's due buckets disagree with the manager's: a date counted
 *      as "this week" on the card and "later" on the page, or a paused record
 *      still surfacing as due.
 *   6. Completing an occurrence does not advance the date, or advances it from
 *      the calendar — so an overdue weekly task replays weeks of past dates one
 *      tick at a time instead of scheduling the next one after today.
 *   7. History grows without a cap, or records the wrong occurrence.
 *   8. Month-end maths drifts: Jan 31 → Feb 28 → Mar 31 must return to the 31st,
 *      not stay on the 28th; Feb 29 must clamp to Feb 28 in a common year.
 *   9. The built-in review rows do not appear while a review is due, do not
 *      disappear when its overall scope is marked done, are tickable (a review
 *      clears on its own page, not from the card), or link to a route that does
 *      not exist.
 *  10. The companion cannot discover the tools at all: `tools/list` advertises
 *      no argument names, so the model invents `recurrence` instead of
 *      `cadence`/`weekday`. (The dashboard-card rig exists for exactly this
 *      class of failure — the advertised schema must name what the validator
 *      wants.)
 *  11. A paired agent with Schedule + Write is refused a tool it was granted,
 *      or the same agent without Schedule is allowed to write.
 *
 * It binds test ports (18_753 / 18_756), so the operator's running LifeQuest
 * (8643 / 8646) is neither disturbed nor consulted.
 *
 * The artifact is `e2e/artifacts/recurring-engine.json`: same command, same
 * claims, no eyeballing. Failures throw, so the artifact only exists for a run
 * whose every claim held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/recurring-engine.json");

/** Test ports. The pairing rig holds 18_643 / 18_646; the live app holds 8643 / 8646. */
const LOCAL_PORT = 18_753;
const INVITE_PORT = 18_756;

/**
 * The fixed day every engine assertion runs on. A Thursday, deliberately: the
 * week buckets (today, this-week, later) are only falsifiable on a day that is
 * neither the first nor the last of its week.
 */
const TODAY = "2026-11-19";
const WEEK_START: WeekStartDay = "monday";
/** The same day as a local Date, for the review window's wall-clock moments. */
const NOW = new Date(2026, 10, 19, 10, 0, 0);

type Auth = { bearer?: string };
type Reply = { status: number; json: unknown; raw: string };

/** `YYYY-MM-DD` of a Date's LOCAL calendar day — the rule the review rows use. */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO arithmetic on plain dates, in UTC, matching the engine's own day rule. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The engine's weekday: 0 = Monday … 6 = Sunday. */
function weekdayOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}

/** The last day of the week `date` falls in, following Monday starts. */
function weekEnd(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(date, 6 - dow);
}

/** One JSON-RPC call to the door. */
async function mcp(auth: Auth, method: string, params: unknown = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (auth.bearer !== undefined) headers.authorization = `Bearer ${auth.bearer}`;
  const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await res.text();
  const frame = raw.split("\n").find((line) => line.startsWith("data: "));
  let json: unknown;
  try {
    json = JSON.parse(frame ? frame.slice(6) : raw);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, raw };
}

async function toolsList(
  auth: Auth,
): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]> {
  const reply = await mcp(auth, "tools/list");
  return (
    (reply.json as { result?: { tools?: { name: string }[] } } | undefined)?.result?.tools ?? []
  ) as { name: string; inputSchema?: Record<string, unknown> }[];
}

/** One tool call, with the tool's own JSON answer unwrapped. */
async function callTool(
  auth: Auth,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const reply = await mcp(auth, "tools/call", { name, arguments: args });
  const text = (reply.json as { result?: { content?: { text?: string }[] } } | undefined)?.result
    ?.content?.[0]?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function propertyNames(schema: unknown): string[] {
  const props = (schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return props && typeof props === "object" ? Object.keys(props) : [];
}

function schemaAt(schema: unknown, ...trail: string[]): unknown {
  let node = schema;
  for (const key of trail) {
    const bag = node as { properties?: Record<string, unknown> } & Record<string, unknown>;
    node = bag?.properties?.[key] ?? bag?.[key];
  }
  return node;
}

/** A fresh record as the map store holds it, for building due-model fixtures. */
function record(
  id: string,
  title: string,
  recurrence: Recurrence,
  dueDate: string,
  extra: Partial<Pick<RecurringTask, "paused" | "history" | "link">> = {},
): RecurringTask {
  return {
    id,
    title,
    notes: "",
    recurrence,
    dueDate,
    paused: false,
    history: [],
    ...extra,
  };
}

/** The review index entry that makes one cadence's open period read as done. */
function doneReview(cadence: (typeof REVIEW_CADENCES)[number]): ReviewIndexEntry {
  return {
    cadence,
    period: openReviewPeriod(cadence, WEEK_START, DEFAULT_REVIEW_AVAILABILITY, NOW),
    locked: false,
    scopes: { overall: { status: "done", sessionId: null } },
  };
}

/** A review index holding every open period, locked (so no review row is due). */
function allReviewsLocked(): ReviewIndexEntry[] {
  return REVIEW_CADENCES.map((cadence) => ({
    cadence,
    period: openReviewPeriod(cadence, WEEK_START, DEFAULT_REVIEW_AVAILABILITY, NOW),
    locked: true,
    scopes: {},
  }));
}

/** Every cadence's open period finished, so the due list holds no review rows. */
function allReviewsDone(): ReviewIndexEntry[] {
  return REVIEW_CADENCES.map(doneReview);
}

const DUE_SETTINGS = { weekStartDay: WEEK_START, reviewAvailability: DEFAULT_REVIEW_AVAILABILITY };

const recurringOf = (state: StoreState, id: string): RecurringTask | undefined =>
  (state.recurring ?? []).find((item) => item.id === id);

describe("recurring tasks engine and tools e2e", () => {
  it("persists the record, keeps the calendar, buckets due rows and answers the MCP door", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-recurring-engine-"));
    const vaultRoot = path.join(workDir, "vault");
    const secretsDir = path.join(workDir, "userData", "pairing-secrets");
    fs.mkdirSync(secretsDir, { recursive: true });

    const checks: Record<string, unknown> = {};
    const transcript: Array<Record<string, unknown>> = [];

    const created = await createVault(vaultRoot, "E2E");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
    const vaultId = (created as { ok: true; value: VaultSnapshot }).value.lifequest.id;
    const mapFile = path.join(vaultRoot, ".lifequest", "map.json");

    // ── 1. a created record is on disk and comes back on reopen ───────────────
    const made = await applyMapCommand(
      vaultRoot,
      { type: "createRecurring", title: "  Water the fig tree  ", recurrence: { unit: "day" } },
      "user",
      TODAY,
    );
    assert.equal(made.ok, true, `createRecurring failed: ${made.ok ? "" : made.error}`);
    const createdRecord = recurringOf((made as { ok: true; value: StoreState }).value, "x");
    assert.equal(createdRecord, undefined, "no id was minted beyond the command's own");

    const onDisk = JSON.parse(fs.readFileSync(mapFile, "utf8")) as {
      recurring?: RecurringTask[];
    };
    checks.persisted = onDisk.recurring ?? [];
    assert.equal(onDisk.recurring?.length, 1, "map.json holds no (or more than one) recurring task");
    const persisted = onDisk.recurring![0];
    assert.equal(persisted.title, "Water the fig tree", "the title was not trimmed on write");
    assert.deepEqual(persisted.recurrence, { unit: "day" });
    assert.equal(persisted.dueDate, TODAY, "a daily task created today is not due today");
    assert.equal(persisted.paused, false);
    assert.deepEqual(persisted.history, []);
    assert.equal(persisted.origin, "operator", "an operator write was not stamped as the operator's");

    const reopened = await loadMapState(vaultRoot);
    assert.equal(reopened.ok, true);
    const reopenedRecord = recurringOf((reopened as { ok: true; value: StoreState }).value, persisted.id);
    checks.reopened = reopenedRecord;
    assert.deepEqual(reopenedRecord, persisted, "the record read back differs from the one written");

    // An old map file (written before the feature) has no `recurring` key at all.
    const legacy = JSON.parse(fs.readFileSync(mapFile, "utf8")) as Record<string, unknown>;
    delete legacy.recurring;
    fs.writeFileSync(mapFile, `${JSON.stringify(legacy, null, 2)}\n`);
    const loadedLegacy = await loadMapState(vaultRoot);
    assert.equal(loadedLegacy.ok, true, "a map file with no recurring key is treated as corrupt");
    checks.legacyLoadsAs = (loadedLegacy as { ok: true; value: StoreState }).value.recurring;
    assert.deepEqual(
      (loadedLegacy as { ok: true; value: StoreState }).value.recurring,
      [],
      "a map file written before the feature does not load as an empty list",
    );
    const ensured = await ensureMapOnOpen(vaultRoot, TODAY);
    assert.equal(ensured.ok, true, "opening a pre-feature vault failed");
    assert.deepEqual((ensured as { ok: true; value: StoreState }).value.recurring, []);

    // ── 2. defaults and refusals ──────────────────────────────────────────────
    const weekdayMissing = await applyMapCommand(
      vaultRoot,
      { type: "createRecurring", title: "Call the accountant", recurrence: { unit: "week" } as Recurrence },
      "user",
      TODAY,
    );
    checks.weekdayMissing = weekdayMissing;
    assert.equal(weekdayMissing.ok, false, "a weekly task with no weekday was accepted");
    assert.match(
      (weekdayMissing as { ok: false; error: string }).error,
      /weekday/i,
      "the weekly refusal does not name the field it needs",
    );

    const monthly = await applyMapCommand(
      vaultRoot,
      { type: "createRecurring", title: "Pay the water bill", recurrence: { unit: "month", dayOfMonth: 12 } },
      "user",
      TODAY,
    );
    assert.equal(monthly.ok, true);
    const monthlyRecord = recurringOf((monthly as { ok: true; value: StoreState }).value, "x");
    assert.equal(monthlyRecord, undefined);
    const monthlyItem = (monthly as { ok: true; value: StoreState }).value.recurring.find(
      (item) => item.title === "Pay the water bill",
    )!;
    checks.monthlyDefault = monthlyItem;
    assert.equal(
      monthlyItem.dueDate,
      occurrenceOnOrAfter({ unit: "month", dayOfMonth: 12 }, TODAY),
      "a monthly task's due date does not default to its next occurrence",
    );
    assert.equal(monthlyItem.dueDate, "2026-12-12", "the monthly default landed on the wrong date");

    const externalLink = await applyMapCommand(
      vaultRoot,
      {
        type: "createRecurring",
        title: "Open the dashboard",
        recurrence: { unit: "day" },
        link: "https://example.com/review",
      },
      "user",
      TODAY,
    );
    checks.externalLink = externalLink;
    assert.equal(externalLink.ok, false, "an external URL was accepted as an internal route");
    assert.match(
      (externalLink as { ok: false; error: string }).error,
      /route/i,
      "the external-link refusal does not say the field is an internal route",
    );

    const badDate = await applyMapCommand(
      vaultRoot,
      { type: "createRecurring", title: "Do the books", recurrence: { unit: "month", dayOfMonth: 1 }, dueDate: "2026-02-30" },
      "user",
      TODAY,
    );
    checks.badDate = badDate;
    assert.equal(badDate.ok, false, "30 February was accepted as a due date");
    assert.match((badDate as { ok: false; error: string }).error, /date/i);

    const emptyTitle = await applyMapCommand(
      vaultRoot,
      { type: "createRecurring", title: "   ", recurrence: { unit: "day" } },
      "user",
      TODAY,
    );
    checks.emptyTitle = emptyTitle;
    assert.equal(emptyTitle.ok, false, "an empty title was accepted");
    assert.match((emptyTitle as { ok: false; error: string }).error, /title/i);

    const linked = await applyMapCommand(
      vaultRoot,
      {
        type: "createRecurring",
        title: "Weekly review",
        recurrence: { unit: "week", weekday: 6 },
        link: "/review/weekly",
        notes: "Look back over the week.",
      },
      "user",
      TODAY,
    );
    assert.equal(linked.ok, true, `an internal route was refused: ${linked.ok ? "" : linked.error}`);
    const linkedItem = (linked as { ok: true; value: StoreState }).value.recurring.find(
      (item) => item.title === "Weekly review",
    )!;
    checks.linked = linkedItem;
    assert.equal(linkedItem.link, "/review/weekly", "an internal route was not stored");
    assert.equal(linkedItem.notes, "Look back over the week.");
    assert.equal(
      linkedItem.dueDate,
      occurrenceOnOrAfter({ unit: "week", weekday: 6 }, TODAY),
      "a weekly task's default due date does not land on the chosen weekday",
    );
    assert.equal(weekdayOf(linkedItem.dueDate), 6, "the weekly default landed on the wrong weekday");

    // ── 3. the due model's buckets, omissions and order ──────────────────────
    const buckets = [
      record("r-overdue", "Overdue fixture", { unit: "day" }, addDays(TODAY, -3)),
      record("r-today", "Today fixture", { unit: "day" }, TODAY),
      record("r-week", "This week fixture", { unit: "day" }, addDays(TODAY, 2)),
      record("r-later", "Later fixture", { unit: "day" }, addDays(TODAY, 20)),
      record("r-paused", "Paused fixture", { unit: "day" }, addDays(TODAY, -1), { paused: true }),
    ];
    checks.recurringStates = Object.fromEntries(
      buckets.map((item) => [item.id, recurringState(item, TODAY, WEEK_START)]),
    );
    assert.equal(recurringState(buckets[0], TODAY, WEEK_START), "overdue");
    assert.equal(recurringState(buckets[1], TODAY, WEEK_START), "today");
    assert.equal(recurringState(buckets[2], TODAY, WEEK_START), "this-week");
    assert.equal(recurringState(buckets[3], TODAY, WEEK_START), "later");
    assert.equal(recurringState(buckets[4], TODAY, WEEK_START), "paused");
    assert.ok(
      addDays(TODAY, 2) <= weekEnd(TODAY),
      "the this-week fixture is not inside the same week (the fixture's own assumption)",
    );

    const due = dueRecurringItems(buckets, allReviewsDone(), DUE_SETTINGS, NOW);
    checks.due = due;
    const dueIds = due.map((item) => item.id);
    assert.deepEqual(
      dueIds,
      ["r-overdue", "r-today", "r-week"],
      `the due list is ${JSON.stringify(dueIds)}; paused and later must be absent and overdue first`,
    );
    assert.equal(due[0].state, "overdue");
    assert.equal(due[0].daysLate, 3, "the overdue row's daysLate is not the whole days from its date");
    assert.equal(due[1].state, "today");
    assert.equal(due[2].state, "this-week");
    assert.ok(due.every((item) => item.kind === "task" && item.completable), "operator rows are not completable");

    // The overdue row is the oldest, and ties keep a stable order.
    const tie = dueRecurringItems(
      [
        record("tie-b", "Tie B", { unit: "day" }, TODAY),
        record("tie-a", "Tie A", { unit: "day" }, TODAY),
      ],
      allReviewsDone(),
      DUE_SETTINGS,
      NOW,
    );
    checks.tieOrder = tie.map((item) => item.id);
    assert.deepEqual(tie.map((item) => item.id), ["tie-a", "tie-b"], "equal due dates are not ordered by id");

    // ── 4. completing records the occurrence and advances from today ─────────
    const overdueCreated = await applyMapCommand(
      vaultRoot,
      {
        type: "createRecurring",
        title: "Submit the expense claim",
        recurrence: { unit: "day" },
        dueDate: addDays(TODAY, -14),
      },
      "user",
      TODAY,
    );
    assert.equal(overdueCreated.ok, true);
    const claim = (overdueCreated as { ok: true; value: StoreState }).value.recurring.find(
      (item) => item.title === "Submit the expense claim",
    )!;

    const completed = await applyMapCommand(
      vaultRoot,
      { type: "completeRecurring", id: claim.id },
      "user",
      TODAY,
    );
    assert.equal(completed.ok, true, `completeRecurring failed: ${completed.ok ? "" : completed.error}`);
    const afterTick = recurringOf((completed as { ok: true; value: StoreState }).value, claim.id)!;
    checks.completed = afterTick;
    assert.deepEqual(
      afterTick.history,
      [{ due: addDays(TODAY, -14), completedOn: TODAY }],
      "the completion was not recorded as { due, completedOn }",
    );
    assert.equal(
      afterTick.dueDate,
      nextOccurrenceAfter({ unit: "day" }, TODAY),
      "an overdue daily task did not advance to the day after today (it replayed the backlog)",
    );
    assert.equal(afterTick.dueDate, addDays(TODAY, 1));

    // The cap: twelve kept, newest first.
    let cappedState: StoreState = (completed as { ok: true; value: StoreState }).value;
    for (let i = 0; i < RECURRING_HISTORY_LIMIT; i += 1) {
      const next = await applyMapCommand(vaultRoot, { type: "completeRecurring", id: claim.id }, "user", TODAY);
      assert.equal(next.ok, true);
      cappedState = (next as { ok: true; value: StoreState }).value;
    }
    const capped = recurringOf(cappedState, claim.id)!;
    checks.cappedHistory = capped.history;
    assert.equal(
      capped.history.length,
      RECURRING_HISTORY_LIMIT,
      `history grew to ${capped.history.length}; the cap is ${RECURRING_HISTORY_LIMIT}`,
    );
    assert.equal(capped.history[0].due, addDays(TODAY, RECURRING_HISTORY_LIMIT), "the newest completion is not at the head");
    assert.ok(
      capped.history[0].completedOn >= capped.history[1].completedOn,
      "history is not newest first",
    );
    assert.ok(
      capped.history.every((entry) => entry.completedOn === TODAY),
      "a completion recorded a day other than the explicit today",
    );

    const pausedItem = record("r-paused-2", "Paused", { unit: "day" }, TODAY, { paused: true });
    const pausedState: StoreState = { ...cappedState, recurring: [...cappedState.recurring, pausedItem] };
    // The paused refusal is a command rule; the pure completion path takes the
    // state the command would have, so prove it through applyMapCommand below.
    const pausedCreated = await applyMapCommand(
      vaultRoot,
      { type: "createRecurring", title: "Paused by the operator", recurrence: { unit: "day" } },
      "user",
      TODAY,
    );
    const paused = (pausedCreated as { ok: true; value: StoreState }).value.recurring.find(
      (item) => item.title === "Paused by the operator",
    )!;
    const pausedOnce = await applyMapCommand(
      vaultRoot,
      { type: "updateRecurring", id: paused.id, paused: true },
      "user",
      TODAY,
    );
    assert.equal(pausedOnce.ok, true);
    const refusedComplete = await applyMapCommand(
      vaultRoot,
      { type: "completeRecurring", id: paused.id },
      "user",
      TODAY,
    );
    checks.pausedComplete = refusedComplete;
    assert.equal(refusedComplete.ok, false, "a paused recurring task was completed");
    assert.match((refusedComplete as { ok: false; error: string }).error, /paused/i);

    const unknownComplete = await applyMapCommand(
      vaultRoot,
      { type: "completeRecurring", id: "no-such-recurring" },
      "user",
      TODAY,
    );
    checks.unknownComplete = unknownComplete;
    assert.equal(unknownComplete.ok, false);
    assert.match((unknownComplete as { ok: false; error: string }).error, /NOT_FOUND/);

    // ── 5. cadence arithmetic ────────────────────────────────────────────────
    const weekly = occurrenceOnOrAfter({ unit: "week", weekday: 0 }, TODAY);
    checks.weekly = weekly;
    assert.equal(weekly, "2026-11-23", "the next Monday on/after Thursday is not the following Monday");
    assert.equal(weekdayOf(weekly), 0, "the weekly occurrence is not a Monday");

    const jan31 = occurrenceOnOrAfter({ unit: "month", dayOfMonth: 31 }, "2026-01-31");
    const febAfter = nextOccurrenceAfter({ unit: "month", dayOfMonth: 31 }, "2026-01-31");
    const marAfter = nextOccurrenceAfter({ unit: "month", dayOfMonth: 31 }, "2026-02-28");
    checks.monthAnchor = { jan31, febAfter, marAfter };
    assert.equal(jan31, "2026-01-31");
    assert.equal(febAfter, "2026-02-28", "Jan 31 did not clamp to Feb 28");
    assert.equal(marAfter, "2026-03-31", "the monthly anchor did not return to the 31st after February");

    const leap = occurrenceOnOrAfter({ unit: "year", month: 2, day: 29 }, "2026-02-01");
    const nextLeapYear = nextOccurrenceAfter({ unit: "year", month: 2, day: 29 }, "2026-02-28");
    // On a common year the occurrence IS 28 February; the leap day comes back
    // when the calendar has one, which is what "Feb 29 → Feb 28" must not lose.
    const clampedOnCommonYear = occurrenceOnOrAfter({ unit: "year", month: 2, day: 29 }, "2027-02-28");
    const leapDayAgain = nextOccurrenceAfter({ unit: "year", month: 2, day: 29 }, "2027-02-28");
    checks.feb29 = { leap, nextLeapYear, clampedOnCommonYear, leapDayAgain };
    assert.equal(leap, "2026-02-28", "29 February did not clamp to the 28th in a common year");
    assert.equal(nextLeapYear, "2027-02-28");
    assert.equal(clampedOnCommonYear, "2027-02-28", "a 29 February rule did not clamp on a common year");
    assert.equal(leapDayAgain, "2028-02-29", "29 February did not land on the leap day in 2028");

    const daily = nextOccurrenceAfter({ unit: "day" }, TODAY);
    checks.daily = daily;
    assert.equal(daily, addDays(TODAY, 1));

    // isRecurrence is the load-time guard as well as the validator.
    checks.isRecurrence = {
      day: isRecurrence({ unit: "day" }),
      weeklyMissingWeekday: isRecurrence({ unit: "week" }),
      weekly: isRecurrence({ unit: "week", weekday: 6 }),
      feb30: isRecurrence({ unit: "year", month: 2, day: 30 }),
      feb29: isRecurrence({ unit: "year", month: 2, day: 29 }),
      rubbish: isRecurrence({ unit: "fortnight" }),
    };
    assert.deepEqual(checks.isRecurrence, {
      day: true,
      weeklyMissingWeekday: false,
      weekly: true,
      feb30: false,
      feb29: true,
      rubbish: false,
    });

    // ── 6. built-in review rows ──────────────────────────────────────────────
    // `since` is the vault's creation day: periods that ended before it are not
    // owed. The reference vault predates every period below (the yearly row's
    // open period is the one that ended in 2025, hence the 2025 floor), so all
    // cadences are candidates; each is unfinished, so each is due.
    const REVIEW_SETTINGS = { ...DUE_SETTINGS, since: "2025-01-01" };
    const emptyIndexDue = dueRecurringItems([], [], REVIEW_SETTINGS, NOW);
    checks.emptyReviewIndex = emptyIndexDue;
    assert.equal(
      emptyIndexDue.length,
      REVIEW_CADENCES.length,
      "an empty review index did not make every open cadence due",
    );
    assert.deepEqual(
      emptyIndexDue.map((item) => item.id).sort(),
      REVIEW_CADENCES.map((cadence) => `review:${cadence}`).sort(),
      "the review rows are not one per cadence",
    );
    assert.ok(emptyIndexDue.every((item) => item.kind === "review"), "a review row is not kind 'review'");
    assert.ok(
      emptyIndexDue.every((item) => item.completable === false),
      "a review row is tickable; a review clears on its own page",
    );
    const weeklyRow = emptyIndexDue.find((item) => item.id === "review:weekly")!;
    checks.weeklyReviewRow = weeklyRow;
    assert.equal(weeklyRow.title, "Weekly review");
    assert.equal(weeklyRow.link, "/review/weekly", "the weekly review row does not link to its page");
    const weeklyOpen = openReviewDate("weekly", WEEK_START, DEFAULT_REVIEW_AVAILABILITY, NOW);
    assert.ok(weeklyOpen, "the weekly review's window is not open at the reference instant");
    const weeklyOpenedOn = weeklyOpen!.day;
    assert.equal(weeklyRow.dueDate, weeklyOpenedOn, "the review row's date is not the day its window opened");
    const daysLateOf = (item: typeof weeklyRow) => {
      const from = new Date(`${item.dueDate}T00:00:00Z`).getTime();
      const to = new Date(`${TODAY}T00:00:00Z`).getTime();
      return Math.round((to - from) / 86_400_000);
    };
    if (weeklyOpenedOn === TODAY) {
      assert.equal(weeklyRow.state, "today");
      assert.equal(weeklyRow.daysLate, 0);
    } else {
      assert.equal(weeklyRow.state, "overdue");
      assert.equal(weeklyRow.daysLate, daysLateOf(weeklyRow), "daysLate is not whole days from the opening date");
    }

    // A fresh vault owes no review for a period that ended before it existed.
    // The same instant with `since` set to today has no review rows at all: every
    // open period ended in the past (the current ones have not opened yet).
    const freshVaultDue = dueRecurringItems([], [], { ...DUE_SETTINGS, since: TODAY }, NOW);
    checks.freshVaultReviewRows = freshVaultDue.filter((item) => item.kind === "review");
    assert.deepEqual(
      checks.freshVaultReviewRows,
      [],
      "a brand-new vault's due list carries a review for a period that ended before it existed",
    );

    // Marking the weekly review's overall scope done removes its row, and only it.
    const weeklyDone = REVIEW_CADENCES.map((cadence) =>
      cadence === "weekly" ? doneReview(cadence) : { cadence, period: "", locked: false, scopes: {} } as ReviewIndexEntry,
    );
    const afterWeeklyDone = dueRecurringItems([], weeklyDone, REVIEW_SETTINGS, NOW);
    checks.afterWeeklyDone = afterWeeklyDone;
    assert.ok(
      !afterWeeklyDone.some((item) => item.id === "review:weekly"),
      "marking the weekly review's overall scope done did not clear its row",
    );
    assert.equal(
      afterWeeklyDone.length,
      REVIEW_CADENCES.length - 1,
      "marking one review done changed the other cadences' rows",
    );

    // A locked review file does not surface either.
    const lockedIndex = allReviewsLocked().map((entry) =>
      entry.cadence === "weekly" ? entry : { ...entry, locked: false },
    );
    const afterLocked = dueRecurringItems([], lockedIndex, REVIEW_SETTINGS, NOW);
    checks.afterLocked = afterLocked;
    assert.ok(
      !afterLocked.some((item) => item.id === "review:weekly"),
      "a locked review file still shows as a due row",
    );

    // ── 7. the real MCP door ─────────────────────────────────────────────────
    const doorVault = path.join(workDir, "door-vault");
    const doorSecrets = path.join(workDir, "door-secrets");
    fs.mkdirSync(doorSecrets, { recursive: true });
    const doorCreated = await createVault(doorVault, "Door E2E");
    assert.equal(doorCreated.ok, true);
    const doorVaultId = (doorCreated as { ok: true; value: VaultSnapshot }).value.lifequest.id;

    const doors = await startPairingDoors({
      root: doorVault,
      vaultId: doorVaultId,
      secretsDir: doorSecrets,
      localPort: LOCAL_PORT,
      invitePort: INVITE_PORT,
    });
    try {
      assert.equal(doors.localError, null, `the door did not bind: ${doors.localError}`);
      const companion = await ensureCompanionToken(doorSecrets, doorVaultId);
      const auth: Auth = { bearer: companion };
      transcript.push({ step: "door bound", port: doors.localPort, vault: doorVault });

      const manifest = await toolsList(auth);
      checks.doorToolCount = manifest.length;
      const names = manifest.map((tool) => tool.name);
      for (const name of [
        "create_recurring_task",
        "update_recurring_task",
        "delete_recurring_task",
        "complete_recurring_task",
      ]) {
        assert.ok(names.includes(name), `tools/list does not advertise ${name}`);
      }
      const createTool = manifest.find((tool) => tool.name === "create_recurring_task")!;
      const createSchema = createTool.inputSchema;
      const createProps = propertyNames(createSchema);
      checks.createToolSchema = {
        description: createTool.description,
        properties: createProps,
        required: (createSchema as { required?: string[] }).required,
      };
      for (const field of [
        "title",
        "notes",
        "cadence",
        "weekday",
        "dayOfMonth",
        "month",
        "day",
        "dueDate",
        "link",
      ]) {
        assert.ok(
          createProps.includes(field),
          `create_recurring_task advertises no '${field}', so a model has to invent the argument`,
        );
      }
      assert.ok(
        (createSchema as { required?: string[] }).required?.includes("title") &&
          (createSchema as { required?: string[] }).required?.includes("cadence"),
        "create_recurring_task does not require title and cadence",
      );
      const updateProps = propertyNames(manifest.find((tool) => tool.name === "update_recurring_task")?.inputSchema);
      checks.updateToolProperties = updateProps;
      for (const field of ["id", "title", "notes", "cadence", "weekday", "dayOfMonth", "month", "day", "dueDate", "link", "paused"]) {
        assert.ok(updateProps.includes(field), `update_recurring_task advertises no '${field}'`);
      }
      assert.ok(
        propertyNames(manifest.find((tool) => tool.name === "delete_recurring_task")?.inputSchema).includes("id"),
        "delete_recurring_task advertises no id",
      );
      assert.ok(
        propertyNames(manifest.find((tool) => tool.name === "complete_recurring_task")?.inputSchema).includes("id"),
        "complete_recurring_task advertises no id",
      );
      // The declared definitions and the door agree about membership.
      assert.ok(
        ALL_TOOL_DEFS.some((def) => def.name === "create_recurring_task"),
        "ALL_TOOL_DEFS does not contain the recurring tools",
      );

      // The cadence enum is what a model needs to choose a rhythm.
      const cadenceSchema = schemaAt(createSchema, "cadence");
      checks.cadenceSchema = cadenceSchema;
      const cadenceEnum = (cadenceSchema as { enum?: unknown[] } | undefined)?.enum;
      assert.deepEqual(cadenceEnum, ["daily", "weekly", "monthly", "yearly"]);

      // create_recurring_task really writes the record.
      const today = todayLocalIso();
      const todaysWeekday = weekdayOf(today);
      const createdOverDoor = await callTool(auth, "create_recurring_task", {
        title: "Weekly review",
        cadence: "weekly",
        weekday: todaysWeekday,
        link: "/review/weekly",
        notes: "Look back over the week.",
      });
      checks.createdOverDoor = createdOverDoor;
      const createdState = (createdOverDoor as { state?: StoreState }).state;
      assert.ok(createdState, `create_recurring_task returned no state: ${JSON.stringify(createdOverDoor).slice(0, 300)}`);
      const overDoor = (createdState!.recurring ?? []).find((item) => item.title === "Weekly review")!;
      assert.ok(overDoor, "create_recurring_task did not add the record to the map store");
      assert.deepEqual(overDoor.recurrence, { unit: "week", weekday: todaysWeekday });
      assert.equal(overDoor.dueDate, today, "the tool's default due date is not the next occurrence");
      assert.equal(overDoor.link, "/review/weekly");
      assert.equal(overDoor.notes, "Look back over the week.");

      // get_state returns the whole map store including the recurring list.
      const stateRead = await callTool(auth, "get_state");
      checks.getState = {
        hasRecurring: Array.isArray((stateRead as { state?: StoreState }).state?.recurring),
        count: ((stateRead as { state?: StoreState }).state?.recurring ?? []).length,
      };
      const readRecord = ((stateRead as { state?: StoreState }).state?.recurring ?? []).find(
        (item) => item.id === overDoor.id,
      );
      assert.ok(readRecord, "get_state does not return the created recurring task");
      assert.deepEqual(readRecord, overDoor);

      // complete_recurring_task advances it and records the completion.
      const completedOverDoor = await callTool(auth, "complete_recurring_task", { id: overDoor.id });
      checks.completedOverDoor = completedOverDoor;
      const completedState = (completedOverDoor as { state?: StoreState }).state;
      assert.ok(completedState, "complete_recurring_task returned no state");
      const advanced = (completedState!.recurring ?? []).find((item) => item.id === overDoor.id)!;
      assert.equal(
        advanced.dueDate,
        nextOccurrenceAfter({ unit: "week", weekday: todaysWeekday }, today),
        "complete_recurring_task did not advance the due date",
      );
      assert.equal(weekdayOf(advanced.dueDate), todaysWeekday, "the advanced date left the chosen weekday");
      assert.equal(advanced.history[0]?.due, today, "the completion did not record the occurrence that was due");
      assert.equal(advanced.history[0]?.completedOn, todayLocalIso(), "the completion was not stamped with today");

      // toolAllowed: Schedule + Write allows all four; no Schedule refuses them.
      // The no-Schedule case carries a domain on purpose: a grant with neither a
      // domain nor Schedule is NO_GRANT ("this row grants nothing at all") before
      // the Schedule classification is reached, which is the existing semantics
      // for every tool — so the Schedule gate itself is what is under test.
      const grant: ConnectedGrant = {
        agentId: "agent-e2e",
        name: "E2E agent",
        access: "write",
        domainSlugs: [],
        schedule: true,
      };
      const noSchedule: ConnectedGrant = { ...grant, domainSlugs: ["life"], schedule: false };
      const emptyGrant: ConnectedGrant = { ...grant, domainSlugs: [], schedule: false };
      const readOnly: ConnectedGrant = { ...grant, access: "read" };
      const names4 = [
        "create_recurring_task",
        "update_recurring_task",
        "delete_recurring_task",
        "complete_recurring_task",
      ];
      checks.toolAllowed = {
        withSchedule: Object.fromEntries(names4.map((name) => [name, toolAllowed(name, grant)])),
        withoutSchedule: Object.fromEntries(names4.map((name) => [name, toolAllowed(name, noSchedule)])),
        noGrant: Object.fromEntries(names4.map((name) => [name, toolAllowed(name, emptyGrant)])),
        readOnly: Object.fromEntries(names4.map((name) => [name, toolAllowed(name, readOnly)])),
      };
      assert.ok(
        names4.every((name) => CONNECTED_SCHEDULE_TOOLS.has(name)),
        "a recurring tool is not classified as a Schedule tool",
      );
      assert.deepEqual(
        names4.map((name) => toolAllowed(name, grant)),
        ["allow", "allow", "allow", "allow"],
        "a Schedule + Write grant cannot use the recurring tools",
      );
      assert.deepEqual(
        names4.map((name) => toolAllowed(name, noSchedule)),
        ["FORBIDDEN", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN"],
        "an agent with a domain but no Schedule can use the recurring tools",
      );
      assert.ok(
        names4.every((name) => toolAllowed(name, emptyGrant) !== "allow"),
        "a grant with neither a domain nor Schedule can use the recurring tools",
      );
      assert.deepEqual(
        names4.map((name) => toolAllowed(name, readOnly)),
        ["FORBIDDEN", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN"],
        "a read-only grant can write a recurring task",
      );

      transcript.push({
        step: "recurring tools used over the door",
        created: overDoor.id,
        advancedTo: advanced.dueDate,
      });
    } finally {
      await doors.close();
    }

    // ── the artifact ─────────────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: true,
      failures: [],
      what:
        "the recurring-task engine over a real vault and the real MCP door: persistence and a " +
        "pre-feature map file, due-date defaults and refusals, the dashboard's due buckets and " +
        "sort, completion history and its cap, the backlog rule, cadence arithmetic (week/month " +
        "anchor/leap year), built-in review rows that clear when the review is done or locked, " +
        "and the four companion tools with their advertised arguments and Schedule+Write gate",
      command: "cd apps/desktop && node --experimental-strip-types --test tests/recurring-engine-e2e.test.ts",
      reference: { today: TODAY, weekStartDay: WEEK_START, now: NOW.toISOString(), historyLimit: RECURRING_HISTORY_LIMIT },
      door: { local: LOCAL_PORT, invite: INVITE_PORT, livePorts: [8643, 8646] },
      checks,
      transcript,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

    // The unused local: the paused state is exercised through the command, and
    // the pure state object is kept only to make that intent legible.
    void pausedState;
    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
