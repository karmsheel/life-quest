import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The recurring-tasks feature's shipped UI, rendered by the real pages in a real
 * layout engine. The claims live in `e2e/recurring-tasks.electron.mjs`; this
 * file runs that driver and refuses a report that does not hold.
 *
 * The three surfaces of this feature were built in parallel against one
 * contract, so each has a rig that tests IT against the contract rather than
 * against the other implementation. This is the pixels half:
 *
 *   - the Dashboard's Today & this week card grows a Recurring block listing
 *     what is owed NOW — overdue and due today. A record dated later, even
 *     tomorrow in the same week, is not dosed a day early: it waits for its own
 *     day. The built-in review cadences appear as rows that link to their page
 *     and carry no tick;
 *   - ticking an operator row writes one `completeRecurring`, records it in the
 *     vault and advances the date (no Done card is materialised);
 *   - the card's manage link reaches the real Task Manager's Recurring tasks
 *     section, where records can be created, paused, resumed and deleted, with
 *     delete asking first;
 *   - a refused write is printed on the card instead of looking like success.
 *
 * The harness computes every fixture date from the run's own local today and
 * publishes its expectations on `window`; the driver compares the DOM against
 * those, never against a date hardcoded in this file. So the rig holds on any
 * day — the only thing it needs is the Vite dev server.
 *
 * THE WAYS THIS FEATURE COULD FAIL, WRITTEN DOWN BEFORE THE ASSERTIONS
 *
 *   1. The rig silently runs against another checkout's dev server (a stale
 *      branch), or skips because no server is up — a skipped rig proves nothing.
 *   2. The fixture only makes sense on the day it was written, so the run is
 *      green today and red tomorrow (every date here is derived from today).
 *   3. The card draws no Recurring block at all, or draws the paused/later
 *      records it must hide — including a same-week record dated tomorrow,
 *      which is the "dosed a day early" failure — or the heading count
 *      disagrees with the rows.
 *   4. The card's state labels are wrong or missing (an overdue row reading
 *      "Due today"), or a future record's "This week" label leaks onto the
 *      card: with the due-today-only rule no card row may carry "This week" at
 *      all; that vocabulary stays in the model for the manager.
 *   5. The built-in weekly review row is missing while it is due, carries a
 *      tick (it clears on its review page, not here), links to the wrong route,
 *      or survives its review being marked done (stale review index read).
 *   6. A tick sends nothing, sends two completeRecurring commands, completes the
 *      wrong record, or the row stays because the page never re-read the store.
 *   7. A refused write is swallowed and the row disappears as if it worked.
 *   8. "Manage recurring →" points somewhere else, or lands on the Act page
 *      without the section scrolled into view, so the link's promise is false.
 *   9. The manager omits paused or later records, prints the stored
 *      `{unit:"week"}` shape instead of a cadence sentence, drops "Next due" or
 *      "Last done", or offers a bare Delete with no confirmation.
 *  10. Create saves the wrong recurrence (a stale cadence field), leaves the due
 *      date contradicting the rhythm, sends two commands, or the new row never
 *      appears.
 *  11. Pause/Resume sends the wrong `paused` value, writes twice, or the badge
 *      and the control disagree about the state.
 *  12. Delete writes before the question is answered (or on Cancel), sends more
 *      than one command, or leaves the row.
 *  13. The harness drifts into testing a mock: the pictures must show the real
 *      HomePage and ActPage. The driver mounts the real pages and captures them
 *      with `capturePage`; the wrapper refuses a report whose PNGs are absent or
 *      too small to be the shipped screen.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * run it through `/root/.local/bin/lifequest-e2e <checkout>` so the server is
 * THIS checkout's. `LIFEQUEST_DEV_PORT` lets the rig point at a server other
 * than 5173.
 *
 * The artifact is `e2e/artifacts/recurring-tasks.json` plus the three pictures
 * the driver captures (`recurring-tasks-card.png`, `recurring-tasks-manager.png`,
 * `recurring-tasks-editor.png`): same command, same claims, no eyeballing.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = Number(process.env.LIFEQUEST_DEV_PORT ?? 5173);
const REPORT = path.join(desktopRoot, "e2e/artifacts/recurring-tasks.json");
const SHOTS = [
  path.join(desktopRoot, "e2e/artifacts/recurring-tasks-card.png"),
  path.join(desktopRoot, "e2e/artifacts/recurring-tasks-manager.png"),
  path.join(desktopRoot, "e2e/artifacts/recurring-tasks-editor.png"),
];

/** The contract's scenario order, exactly. */
const SCENARIOS = [
  "card-recurring",
  "review-row",
  "card-tick",
  "card-manage",
  "manager-list",
  "manager-create",
  "manager-pause",
  "manager-delete",
  "clean",
];

type Scenario = { name: string; pass: boolean; detail: string | null };

type CardRow = {
  id: string;
  title: string | null;
  state: string | null;
  dataState: string | null;
  link: string | null;
  checkbox: { testid: string | null; label: string | null } | null;
  text: string;
};

type ExpectedCardRow = {
  id: string;
  title: string;
  state: string;
  label: string;
  link: string | null;
  checkbox: boolean;
};

type ExpectedManagerRow = {
  id: string;
  title: string;
  cadence: string;
  dueIso: string;
  dueLabel: string;
  paused: boolean;
  dueState: string | null;
  lastDone: string | null;
};

type Expectations = {
  today: string;
  weekStartDay: "monday" | "sunday";
  weekEnd: string;
  now: string;
  reviewsDone: boolean;
  refuseWrites: boolean;
  writeError: string;
  card: {
    count: number;
    rows: ExpectedCardRow[];
    absentIds: string[];
    /** A same-week record dated tomorrow: the "not dosed a day early" control. */
    tomorrow: { id: string; title: string; dueDate: string };
    manage: { testId: string; text: string; href: string };
  };
  review: { id: string; title: string; link: string; expected: boolean };
  manager: { count: number; rows: ExpectedManagerRow[] };
  tick: { id: string; afterDueIso: string; afterDueLabel: string };
  create: {
    title: string;
    cadenceLabel: string;
    weekdayLabel: string;
    recurrence: { unit: string; weekday?: number };
    dueIso: string;
    dueLabel: string;
  };
  pause: { id: string };
  delete: { id: string; title: string };
};

type ManagerRow = {
  id: string;
  text: string;
  name: string | null;
  meta: string | null;
  badges: { text: string | null; cls: string }[];
  paused: boolean;
  edit: { text: string | null; tag: string } | null;
  pause: { text: string | null; tag: string } | null;
  delete: { text: string | null; tag: string } | null;
};

type CardSample = {
  rows: CardRow[];
  rowCount: number;
  headingText: string | null;
  countText: string | null;
  count: number | null;
  manage: { href: string | null; text: string | null } | null;
  cardPresent: boolean;
  blockText: string | null;
  alert: string | null;
  route: { home: boolean; act: boolean };
};

type ManagerSample = {
  present: boolean;
  heading: string | null;
  count: string | null;
  add: { text: string | null; tag: string } | null;
  empty: string | null;
  rows: ManagerRow[];
  alert: string | null;
  editor: {
    present: boolean;
    title: string | null;
    fields: {
      title: string | null;
      cadence: { value: string; label: string | null } | null;
      weekday: { value: string; label: string | null } | null;
      dueDate: string | null;
      link: string | null;
    };
    save: string | null;
    cancel: string | null;
  } | null;
  dialog: {
    role: string | null;
    modal: string | null;
    title: string | null;
    message: string | null;
    confirm: string | null;
    cancel: string | null;
  } | null;
  sectionRect: { top: number; bottom: number; height: number } | null;
  viewport: { top: number; bottom: number; height: number };
  inViewport: boolean;
  route: { home: boolean; act: boolean };
};

type MapCommand = {
  type?: string;
  id?: string;
  title?: string;
  paused?: boolean;
  recurrence?: unknown;
  dueDate?: string;
};

type Report = {
  pass: boolean;
  failures: string[];
  what: string;
  skin: { name?: string; applied?: string | null };
  scenarioOrder: string[];
  reference: { today: string; weekStartDay: string; weekEnd: string; now: string };
  checks: {
    scenarios: Scenario[];
    expectations: Expectations;
    card: {
      first: CardSample;
      afterTick: CardSample;
      refused: CardSample;
      reviewsDone: CardSample;
    };
    review: { before: CardRow | null; afterDone: CardRow | null };
    tick: {
      commands: MapCommand[];
      managerRow: ManagerRow | null;
      refusedCommands: MapCommand[];
      refusedAlert: string | null;
    };
    manage: {
      link: { href: string | null; text: string | null } | null;
      afterPress: ManagerSample;
    };
    manager: ManagerSample;
    create: {
      editor: ManagerSample["editor"];
      command: MapCommand | null;
      record: { id: string; title: string } | null;
      row: ManagerRow | null;
      commands: MapCommand[];
    };
    pause: {
      paused: MapCommand[];
      pausedRow: ManagerRow | null;
      resumed: MapCommand[];
      resumedRow: ManagerRow | null;
    };
    delete: {
      dialog: ManagerSample["dialog"];
      commands: MapCommand[];
      survivedCancel: boolean;
    };
    bridgeCalls: string[];
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
};

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    // A DSH/Electron host exports ELECTRON_RUN_AS_NODE, which would make the
    // spawned `electron` run as plain node and die before opening a window.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/recurring-tasks.electron.mjs")],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        stdio: "inherit",
        env: {
          ...env,
          LIFEQUEST_E2E_URL: `http://127.0.0.1:${DEV_PORT}/e2e/recurring-tasks.html`,
        },
      },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

/** The PNG's own IHDR: a picture, and one big enough to be the shipped screen. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file);
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${path.basename(file)} is not a PNG`,
  );
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const rowOf = (rows: { id: string }[], id: string) => rows.find((row) => row.id === id) ?? null;

describe("recurring tasks shipped UI e2e", () => {
  it("draws the card's Recurring block, ticks, and manages the records", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` ` +
          `(or set LIFEQUEST_DEV_PORT) to include this e2e`,
      );
      return;
    }

    const code = await runDriver();
    assert.equal(code, 0, "the recurring-tasks driver reported a failure");
    assert.ok(fs.existsSync(REPORT), `the driver wrote no report at ${REPORT}`);

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(report.pass, true, `the report failed: ${report.failures.join("; ")}`);
    assert.deepEqual(report.failures, []);
    assert.ok(report.what.includes("recurring"), "the report does not say what was judged");
    assert.ok(report.skin.name, "the harness painted no skin");
    assert.equal(report.skin.applied, report.skin.name, "the harness painted the wrong skin");

    // ── the claims, in the contract's order, all held ─────────────────────────
    assert.deepEqual(
      report.checks.scenarios.map((scenario) => scenario.name),
      SCENARIOS,
      "the driver's claims moved",
    );
    assert.deepEqual(report.scenarioOrder, SCENARIOS, "the report's own order moved");
    for (const scenario of report.checks.scenarios) {
      assert.equal(scenario.pass, true, `${scenario.name}: ${scenario.detail}`);
    }

    const expectations = report.checks.expectations;
    assert.match(expectations.today, /^\d{4}-\d{2}-\d{2}$/, "the reference day is not an ISO date");
    assert.ok(
      expectations.weekStartDay === "monday" || expectations.weekStartDay === "sunday",
      "the reference week start is not a week start",
    );

    // ── 1. the card's Recurring block ─────────────────────────────────────────
    const card = report.checks.card.first;
    assert.equal(card.cardPresent, true, "the Today & this week card did not render");
    assert.equal(card.route.home, true, "the harness did not land on the Dashboard");
    assert.equal(
      card.rows.length,
      expectations.card.count,
      `the card drew ${card.rows.length} recurring rows, expected ${expectations.card.count}`,
    );
    assert.equal(
      card.count,
      expectations.card.count,
      `the Recurring heading counts ${JSON.stringify(card.countText)}, expected ${expectations.card.count}`,
    );
    assert.equal(
      card.rowCount,
      expectations.card.count,
      `the DOM holds ${card.rowCount} [data-testid^="recurring-row-"] elements, expected ${expectations.card.count}`,
    );
    // The fixture's same-week record dated tomorrow is the falsifiable case for
    // "a scheduled task is not dosed a day early": it must be absent today even
    // though the model calls it "this-week", and no card row may wear that
    // vocabulary (the old "This week" label assertion, inverted).
    const tomorrow = expectations.card.tomorrow;
    assert.ok(tomorrow?.id, "the harness publishes no tomorrow-record expectation");
    assert.ok(
      expectations.card.absentIds.includes(tomorrow.id),
      `the harness does not expect the tomorrow record ${tomorrow.id} to be absent`,
    );
    assert.equal(
      rowOf(card.rows, tomorrow.id),
      null,
      `the card lists ${tomorrow.id} (${tomorrow.title}), due ${tomorrow.dueDate}, which is not due today`,
    );
    assert.equal(
      card.rows.filter((row) => row.state === "This week" || row.dataState === "this-week").length,
      0,
      `the card draws a "This week" recurring row; with the due-today-only rule only Overdue and Due today are owed now`,
    );
    for (const expected of expectations.card.rows) {
      const row = rowOf(card.rows, expected.id);
      assert.ok(row, `the card does not list ${expected.id} (${expected.title})`);
      assert.equal(row?.title, expected.title, `${expected.id}: title moved`);
      assert.equal(row?.state, expected.label, `${expected.id}: state label is ${JSON.stringify(row?.state)}`);
      assert.equal(row?.dataState, expected.state, `${expected.id}: state attribute moved`);
      assert.equal(row?.link, expected.link, `${expected.id}: row link moved`);
      assert.equal(
        Boolean(row?.checkbox),
        expected.checkbox,
        `${expected.id}: ${expected.checkbox ? "no tick" : "a tick on a row that must not have one"}`,
      );
    }
    for (const absent of expectations.card.absentIds) {
      assert.equal(rowOf(card.rows, absent), null, `the card lists ${absent}, which is not due`);
    }
    assert.equal(card.manage?.href, expectations.card.manage.href, "the manage link's route moved");
    assert.equal(card.manage?.text, expectations.card.manage.text, "the manage link's words moved");

    // ── 2. the built-in review row, and its absence once done ─────────────────
    const review = report.checks.review;
    assert.equal(review.before?.title, expectations.review.title, "the review row's title moved");
    assert.equal(review.before?.link, expectations.review.link, "the review row does not link to its page");
    assert.equal(review.before?.checkbox, null, "the review row carries a tick");
    assert.equal(review.afterDone, null, "the review row survived its review being marked done");
    assert.ok(
      report.checks.card.reviewsDone.rows.length < card.rows.length,
      "the completed review did not reduce the due rows",
    );

    // ── 3. a tick writes once, leaves the card, advances the manager date ─────
    const tick = report.checks.tick;
    assert.equal(tick.commands.length, 1, `a tick sent ${tick.commands.length} completeRecurring commands`);
    assert.equal(tick.commands[0]?.type, "completeRecurring");
    assert.equal(tick.commands[0]?.id, expectations.tick.id, "the tick completed the wrong record");
    assert.equal(
      rowOf(report.checks.card.afterTick.rows, expectations.tick.id),
      null,
      "the ticked row stayed on the card",
    );
    assert.ok(tick.managerRow, "the manager did not show the ticked record");
    assert.ok(
      (tick.managerRow?.meta ?? "").includes(expectations.tick.afterDueLabel),
      `the manager reads ${JSON.stringify(tick.managerRow?.meta)}, expected ${JSON.stringify(
        expectations.tick.afterDueLabel,
      )}`,
    );
    assert.equal(tick.refusedCommands.length, 1, "the refused mount did not attempt exactly one write");
    assert.equal(tick.refusedCommands[0]?.id, expectations.tick.id);
    assert.ok(
      (tick.refusedAlert ?? "").includes(expectations.writeError),
      `a refused write printed ${JSON.stringify(tick.refusedAlert)} on the card`,
    );
    assert.ok(
      rowOf(report.checks.card.refused.rows, expectations.tick.id),
      "a refused tick removed the row as if it had been written",
    );

    // ── 4. the manage link reaches the real Act page ──────────────────────────
    const manage = report.checks.manage;
    assert.equal(manage.link?.href, expectations.card.manage.href, "the manage link is not the contract's route");
    assert.equal(manage.afterPress.present, true, "pressing Manage recurring did not draw the section");
    assert.equal(manage.afterPress.route.act, true, "pressing Manage recurring did not reach the Act page");
    assert.equal(
      manage.afterPress.inViewport,
      true,
      `the recurring section is outside the viewport: section ${JSON.stringify(
        manage.afterPress.sectionRect,
      )}, scrollport ${JSON.stringify(manage.afterPress.viewport)}`,
    );

    // ── 5. the manager lists every record ────────────────────────────────────
    const manager = report.checks.manager;
    assert.equal(manager.heading, "Recurring tasks", "the manager's heading moved");
    assert.equal(manager.count, String(expectations.manager.count), "the manager's count moved");
    assert.equal(
      manager.rows.length,
      expectations.manager.count,
      "the manager does not list every record",
    );
    for (const expected of expectations.manager.rows) {
      const row = rowOf(manager.rows, expected.id);
      assert.ok(row, `the manager does not list ${expected.id} (${expected.title})`);
      assert.equal(row?.name, expected.title, `${expected.id}: title moved`);
      assert.ok(
        (row?.meta ?? "").includes(expected.cadence),
        `${expected.id}: cadence line ${JSON.stringify(row?.meta)} lacks ${JSON.stringify(expected.cadence)}`,
      );
      assert.ok(
        (row?.meta ?? "").includes(expected.dueLabel),
        `${expected.id}: next-due line ${JSON.stringify(row?.meta)} lacks ${JSON.stringify(expected.dueLabel)}`,
      );
      if (expected.paused) {
        assert.ok(
          (row?.badges ?? []).some((badge) => badge.text === "Paused"),
          `${expected.id}: no Paused badge`,
        );
        assert.equal(row?.pause?.text, "Resume", `${expected.id}: a paused row's control does not say Resume`);
      } else {
        assert.equal(row?.pause?.text, "Pause", `${expected.id}: control does not say Pause`);
      }
      if (expected.dueState) {
        assert.ok(
          (row?.badges ?? []).some((badge) => badge.text === expected.dueState),
          `${expected.id}: no ${expected.dueState} badge`,
        );
      }
      if (expected.lastDone) {
        assert.ok(
          (row?.text ?? "").includes(expected.lastDone),
          `${expected.id}: no ${JSON.stringify(expected.lastDone)} line`,
        );
      } else {
        assert.ok(!(row?.text ?? "").includes("Last done"), `${expected.id}: a Last done line with no history`);
      }
      assert.equal(row?.edit?.text, "Edit", `${expected.id}: no Edit control`);
      assert.equal(row?.delete?.text, "Delete", `${expected.id}: no Delete control`);
    }

    // ── 6. create from the editor ────────────────────────────────────────────
    const created = report.checks.create;
    assert.equal(created.command?.type, "createRecurring", "Save sent no createRecurring");
    assert.equal(created.command?.title, expectations.create.title, "the created title moved");
    assert.deepEqual(
      created.command?.recurrence,
      expectations.create.recurrence,
      "the created recurrence is not the one the editor showed",
    );
    assert.equal(
      created.command?.dueDate,
      expectations.create.dueIso,
      "the created due date is not the editor's own next-Monday default",
    );
    assert.equal(
      created.editor?.fields.dueDate,
      expectations.create.dueIso,
      "the editor's due-date field did not default to the cadence's next occurrence",
    );
    assert.ok(created.record, "the created record is not in the harness's map store");
    assert.ok(created.row, "the created record did not draw a row");
    assert.ok(
      (created.row?.meta ?? "").includes("Every Monday"),
      `the created row's cadence line is ${JSON.stringify(created.row?.meta)}`,
    );
    assert.equal(
      created.commands.filter((command) => command.type === "createRecurring").length,
      1,
      "Save sent more than one createRecurring",
    );

    // ── 7. pause and resume ──────────────────────────────────────────────────
    const pause = report.checks.pause;
    assert.equal(pause.paused.length, 1, `Pause sent ${pause.paused.length} updateRecurring commands`);
    assert.equal(pause.paused[0]?.id, expectations.pause.id);
    assert.equal(pause.paused[0]?.paused, true);
    assert.ok(
      (pause.pausedRow?.badges ?? []).some((badge) => badge.text === "Paused"),
      "the paused row draws no Paused badge",
    );
    assert.equal(pause.pausedRow?.pause?.text, "Resume", "a paused row does not offer Resume");
    assert.equal(pause.resumed.length, 1, `Resume sent ${pause.resumed.length} updateRecurring commands`);
    assert.equal(pause.resumed[0]?.id, expectations.pause.id);
    assert.equal(pause.resumed[0]?.paused, false);
    assert.ok(
      !(pause.resumedRow?.badges ?? []).some((badge) => badge.text === "Paused"),
      "the Paused badge survived Resume",
    );

    // ── 8. delete asks first ─────────────────────────────────────────────────
    const removed = report.checks.delete;
    assert.equal(removed.dialog?.role, "dialog", "Delete did not ask through a dialog");
    assert.equal(removed.dialog?.title, "Delete recurring task?", "the delete question's heading moved");
    assert.ok(
      (removed.dialog?.message ?? "").includes(expectations.delete.title),
      "the delete question does not name the record",
    );
    assert.equal(removed.dialog?.confirm, "Delete", "the confirming control moved");
    assert.equal(removed.dialog?.cancel, "Cancel", "the cancelling control moved");
    assert.equal(removed.survivedCancel, true, "Cancel wrote something");
    assert.equal(removed.commands.length, 1, `Delete sent ${removed.commands.length} deleteRecurring commands`);
    assert.equal(removed.commands[0]?.id, expectations.delete.id, "Delete removed the wrong record");

    // ── 9. nothing stray happened ────────────────────────────────────────────
    assert.deepEqual(
      report.checks.unexpectedBridgeCalls,
      [],
      "the page reached for a bridge method this harness does not model",
    );
    assert.deepEqual(report.checks.consoleErrors, [], "the page logged a console error");

    // ── the artifact: three real pictures ────────────────────────────────────
    for (const shot of SHOTS) {
      assert.ok(fs.existsSync(shot), `the driver captured no ${path.basename(shot)}`);
      assert.ok(
        fs.statSync(shot).size > 2_000,
        `${path.basename(shot)} is too small to be a picture`,
      );
      const size = pngSize(shot);
      assert.ok(
        size.width >= 800 && size.height >= 500,
        `${path.basename(shot)} is ${size.width}x${size.height}, too small to show the shipped screen`,
      );
    }
  });
});
