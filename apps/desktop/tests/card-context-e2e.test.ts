import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;

/**
 * The card-context rigs, in two halves over two pages.
 *
 * `dashboard-card-context` judges the Dashboard: the pin board as a header
 * control above the grid, and the chat control every pinned card wears. `card-
 * context` judges the chat: the pill above the composer and the instruction
 * context the turn carries. They are wrapped together because they are one
 * feature seen from its two ends, and neither half means anything alone — a
 * control that hands nothing over and a pill nothing hands to.
 *
 * Both render real pages in a real layout engine, so they need the Vite dev
 * server. With it down the tests skip; `npm run dev` in another terminal brings
 * it up.
 */
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

function runDriver(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, `e2e/${name}.electron.mjs`)],
      { cwd: desktopRoot, timeout: 120_000 },
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

type Scenario = { name: string; pass: boolean; detail: string | null };

type Report = {
  pass: boolean;
  failures: string[];
  checks: { scenarios: Scenario[] } & Record<string, unknown>;
};

/**
 * Every driver's report, read the same way: it wrote one, it passed, its failure
 * list is empty, and every claim it exists to make is in the list and green.
 */
async function readReport(
  t: { skip: (message: string) => void },
  driver: string,
  scenarioNames: string[],
): Promise<Report> {
  if (!(await devServerUp())) {
    t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
    // Unreachable once the test skips, but the return type has to be honest.
    throw new Error("dev server down");
  }

  const reportPath = path.join(desktopRoot, `e2e/artifacts/${driver}.json`);
  fs.rmSync(reportPath, { force: true });
  const exitCode = await runDriver(driver);
  assert.equal(fs.existsSync(reportPath), true, "driver wrote no report artifact");

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report;
  assert.deepEqual(report.failures, []);
  assert.equal(report.pass, true);
  assert.equal(exitCode, 0, "driver exited non-zero");

  const byName = new Map(report.checks.scenarios.map((s) => [s.name, s]));
  for (const name of scenarioNames) {
    const scenario = byName.get(name);
    assert.ok(scenario, `${driver} never ran the scenario ${name}`);
    assert.equal(scenario.pass, true, `${driver} failed ${name}: ${scenario.detail ?? ""}`);
  }
  return report;
}

/** The Dashboard's card controls: the pin board's toggle, and the chat control. */
describe("dashboard card context e2e", () => {
  it("moves the pin board behind a header toggle and puts a card's chat control on every card", async (t) => {
    const report = await readReport(t, "dashboard-card-context", [
      "add-toggle-is-closed-on-landing",
      "add-toggle-opens-and-closes",
      "pin-board-sits-above-the-grid",
      "add-pin-still-writes",
      "locked-board-has-no-add-path",
      "every-card-offers-the-chat-control",
      "the-chat-control-is-not-editing-chrome",
      "chat-control-hands-over-the-card",
      "the-name-comes-off-the-heading",
      "a-locked-board-still-offers-it",
      "the-chat-control-does-not-lift-the-card",
      "every-card-offers-the-menu",
      "the-menu-holds-archive-and-delete-where-there-is-one",
      "one-menu-at-a-time",
      "escape-closes-the-menu",
      "a-press-away-closes-the-menu",
      "archive-takes-the-card-off-the-board",
      "archiving-a-view-card-keeps-the-view",
      "a-locked-board-has-no-menu",
      "delete-asks-before-it-writes",
      "cancelling-deletes-nothing",
      "deleting-a-view-takes-the-card-with-it",
      "deleting-a-page-takes-the-card-with-it",
      "the-deadline-pin-keeps-its-controls-out-of-the-way",
    ]);

    // Landing: closed, and above the grid the moment it is opened.
    const landing = report.checks.landing as { section: unknown; toggle: { expanded: string } | null };
    assert.equal(landing.section, null, "the pin board was open on landing");
    assert.equal(landing.toggle?.expanded, "false");
    assert.deepEqual(
      report.checks.above,
      { sectionBeforeGrid: true, toggleBeforeSection: true },
      "the pin board is not above the grid it adds to",
    );

    // The moved row still does its job, with exactly the pin that was clicked.
    const addWrites = report.checks.addPinWrites as { id: string }[][];
    assert.equal(addWrites.length, 1, "the add button did not write exactly once");
    assert.deepEqual(addWrites[0]?.at(-1), {
      id: "sys:deadline",
      kind: "system",
      system: "deadline",
    });

    // A locked board is still the claim the whole lock rests on.
    const locked = report.checks.lockedBoard as { toggle: unknown; section: unknown; strayAddButtons: number };
    assert.equal(locked.toggle, null, "a locked board still offered the pin board");
    assert.equal(locked.section, null);
    assert.equal(locked.strayAddButtons, 0);

    // The names the dock took: the card's own heading, for all three kinds.
    assert.deepEqual(report.checks.handedNames, {
      "sys:goal-progress": "Goals",
      "view:financial:v-weekly": "Weekly expenses",
      "page:financial:ledger": "Ledger",
      "sys:today-week": "Today & this week",
      "view:financial:v-summary": "Spending by month",
      "sys:pending-decisions": "Pending decisions",
      "sys:recent-log": "Recent activity",
    });
    // The goals card paints a count inside its heading; the name is the words.
    const board = report.checks.board as { cards: { id: string; heading: string | null }[] };
    assert.equal(board.cards.find((c) => c.id === "sys:goal-progress")?.heading, "Goals2");

    // The deadline pin is not a card: its controls take their own line above the
    // banner instead of a corner, and they must not land on top of it.
    const deadline = report.checks.deadlinePin as {
      banner: boolean;
      toolsPosition: string | null;
      toolsBottom: number;
      bannerTop: number;
      chatSvgs: number;
    };
    assert.equal(deadline.banner, true, "the deadline banner did not draw");
    assert.equal(deadline.toolsPosition, "static", "the deadline pin's controls took a corner");
    assert.ok(
      deadline.toolsBottom <= deadline.bannerTop,
      `the deadline pin's controls sat on the banner: ${deadline.toolsBottom} > ${deadline.bannerTop}`,
    );
    assert.equal(deadline.chatSvgs, 1, "the deadline pin lost its chat control");

    // Asking about a card is not picking one up — and the hold still works.
    assert.deepEqual(report.checks.heldOnChatControl, { lifted: 0, liftedByTheHold: 1 });

    // The card's own menu: Archive everywhere, Delete only where there is
    // something behind the card, and Delete is the destructive one.
    const menus = report.checks.menus as Record<
      string,
      { role: string | null; items: string[]; testids: (string | null)[]; danger: boolean[] } | undefined
    >;
    assert.equal(menus["sys:goal-progress"]?.items.join(","), "Archive");
    assert.equal(menus["sys:goal-progress"]?.danger[0], false, "Archive wore the destructive token");
    for (const id of ["view:financial:v-weekly", "page:financial:ledger"]) {
      assert.deepEqual(menus[id]?.items, ["Archive", "Delete"], `${id}'s menu is not Archive + Delete`);
      assert.equal(menus[id]?.danger[1], true, `${id}'s Delete is not marked destructive`);
      assert.equal(menus[id]?.testids[1], "pin-delete");
    }

    // Archive is the old unpin: one pin write, the card gone, no question asked.
    const archiveWrites = report.checks.archiveWrites as { id: string }[][];
    assert.equal(archiveWrites.length, 1, "Archive did not write exactly once");
    assert.equal(
      archiveWrites[0]?.some((p) => p.id === "sys:today-week"),
      false,
      "the archived card is still in the pin list that was written",
    );

    // The pair the two laws make: taking a card off is not deleting what it
    // draws. Archiving a view card writes one pin list, deletes nothing, and
    // leaves the view offered again — so the card can come back.
    assert.deepEqual(report.checks.viewArchive, { writes: 1, deletes: 0, offeredAgain: true });

    // Delete asks by name, and writes nothing until it is answered.
    const asking = report.checks.asking as {
      title: string;
      message: string;
      confirmLabel: string;
      destructive: boolean;
    } | null;
    assert.equal(asking?.title, "Delete “Weekly expenses”?", "the question did not name the card");
    assert.match(asking?.message ?? "", /cannot be undone/i);
    assert.equal(asking?.destructive, true, "the confirming control is not the destructive one");

    // Confirming deletes the view; the card leaves the board through the pin
    // board's own validation, not through a pin rewrite.
    assert.deepEqual(report.checks.deleteWrites, [
      { kind: "view", slug: "financial", id: "v-weekly" },
    ]);
    assert.deepEqual(report.checks.pageDeletes, [
      { kind: "page", slug: "financial", id: "ledger" },
    ]);
    assert.equal(
      (report.checks.pageQuestion as { confirmLabel: string } | null)?.confirmLabel,
      "Delete page",
    );

    // A locked board has no menu, and still has the chat control.
    assert.deepEqual(report.checks.lockedMenus, { menuToggles: 0, menus: 0, chat: 7 });

    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);
  });

  it("shows the card above the composer and puts it on the turn", async (t) => {
    const report = await readReport(t, "card-context", [
      "no-card-no-pill-no-line",
      "the-pill-names-the-card",
      "the-pill-sits-above-the-composer",
      "the-turn-carries-the-card",
      "the-pill-survives-the-turn",
      "removing-the-pill-clears-the-context",
      "the-card-control-puts-it-in-the-chat",
    ]);

    // The turn is the whole point: the card's ids have to reach the companion.
    assert.deepEqual(report.checks.carriedTurn, {
      label: "Weekly expenses",
      pinId: "view:financial:v-weekly",
      kind: "view",
      boardSlug: null,
      domainSlug: "financial",
      viewId: "v-weekly",
    });

    // A turn with no card is the turn it always was: no key, not a null one.
    const bare = report.checks.bareTurn as { focusedCard: unknown; pill: unknown };
    assert.equal(bare.focusedCard, "<absent>", "a turn with no card carried a focusedCard key");
    assert.equal(bare.pill, null);

    // Taking it off puts everything back.
    const cleared = report.checks.cleared as { dock: { contextCard: unknown }; focusedCard: unknown };
    assert.equal(cleared.dock.contextCard, null);
    assert.equal(cleared.focusedCard, "<absent>");

    // The join: the operator's own click on a card's chat control, on one page
    // that holds both the real Dashboard and the real panel.
    const joined = report.checks.fromTheCard as {
      pill: { label: string } | null;
      focused: { tag: string; cls: string } | null;
      focusedCard: unknown;
    };
    assert.equal(joined.pill?.label, "Weekly expenses", "the click grew no pill");
    assert.equal(joined.focused?.tag, "TEXTAREA", "the click did not hand the caret to the composer");
    assert.match(joined.focused?.cls ?? "", /chat-panel__composer-input/);
    assert.deepEqual(joined.focusedCard, {
      label: "Weekly expenses",
      pinId: "view:financial:v-weekly",
      kind: "view",
      boardSlug: null,
      domainSlug: "financial",
      viewId: "v-weekly",
    });

    assert.equal(report.checks.turnsSent, 5, "the rig did not send every turn it claims about");
    assert.deepEqual(report.checks.consoleErrors, []);
  });
});
