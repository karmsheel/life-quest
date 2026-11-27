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
 * `dashboard-card-context` judges the Dashboard: the card is the chat control
 * now — no corner icon, a press anywhere on the card toggles it, three cards
 * hold at once, the fourth is refused with a visible status, empty board space
 * clears them all, and a card's own controls, a drag, a hold and Edit mode keep
 * their own presses. `card-context` judges the chat: one pill per card in the
 * order chosen, each pill removable on its own, and the turn's `focusedCards`
 * array. They are wrapped together because they are one feature seen from its
 * two ends, and neither half means anything alone — a card that hands nothing
 * over and a pill nothing hands to.
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
      (error, stdout, stderr) => {
        // A rig that exits without writing its report has to say why: its own
        // output is the only account of the step it was on.
        if (error && (typeof error.code !== "number" || error.code !== 0)) {
          console.error(`[${name}] driver output:\n${stdout}\n${stderr}`);
        }
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

type CardCheck = {
  id: string;
  heading: string | null;
  inContext: boolean;
  outline: { style: string; width: string };
  cursor: string;
  tabIndex: number;
  tools: number;
  chrome: number;
  chat: number;
  chatIcons: number;
  toggle: {
    pinId: string | null;
    pressed: string | null;
    label: string | null;
    svgs: number;
    width: number;
    height: number;
    inChrome: boolean;
    tabIndex: number;
  } | null;
};

/** The Dashboard's card-as-control claims, asserted from the report's own JSON. */
describe("dashboard card context e2e", () => {
  it("makes the card itself the chat control, holding three and refusing a fourth", async (t) => {
    const report = await readReport(t, "dashboard-card-context", [
      "the-header-drops-the-doctrine-line",
      "add-toggle-is-closed-on-landing",
      "add-toggle-opens-and-closes",
      "pin-board-sits-above-the-grid",
      "add-pin-still-writes",
      "locked-board-has-no-add-path",
      "a-locked-board-has-no-menu",
      "no-chat-icon-remains",
      "every-card-is-a-click-target",
      "clicking-a-card-adds-it",
      "a-press-on-the-cards-content-is-a-press-on-the-card",
      "three-cards-hold-at-once",
      "a-second-click-removes-only-that-card",
      "a-fourth-card-is-refused-with-a-status-line",
      "the-refusal-line-clears-on-the-next-toggle",
      "empty-board-clicks-clear-all",
      "a-cards-own-controls-do-not-toggle",
      "a-drag-does-not-toggle",
      "the-locked-board-still-selects-and-removes",
      "the-keyboard-toggle-works",
      "the-name-comes-off-the-heading",
      "every-card-offers-the-menu",
      "the-menu-holds-archive-and-delete-where-there-is-one",
      "one-menu-at-a-time",
      "escape-closes-the-menu",
      "a-press-away-closes-the-menu",
      "archive-takes-the-card-off-the-board",
      "archiving-a-view-card-keeps-the-view",
      "delete-asks-before-it-writes",
      "cancelling-deletes-nothing",
      "deleting-a-view-takes-the-card-with-it",
      "deleting-a-page-takes-the-card-with-it",
      "the-deadline-pin-keeps-its-controls-out-of-the-way",
      "the-cards-say-what-they-show",
      "a-task-tick-marks-it-done",
    ]);

    // ── the old chat control is gone ────────────────────────────────────────
    // The board the no-icon claim was read on: not one `pin-chat`, not one
    // `.home-pin__chat`, not one MessageSquare glyph inside a pin.
    const board = report.checks.board as {
      cards: CardCheck[];
      chatControls: number;
      chatClasses: number;
      messageIcons: number;
      contextToggles: number;
      staticPins: { cursor: string; toggles: number; tools: number }[];
      inContextCards: string[];
    };
    assert.equal(board.chatControls, 0, "a card still wore a pin-chat control");
    assert.equal(board.chatClasses, 0, "a card still wore the .home-pin__chat class");
    assert.equal(board.messageIcons, 0, "a card still drew a MessageSquare glyph");
    assert.ok(
      board.cards.every((card) => card.chat === 0 && card.chatIcons === 0),
      "a card in the report still carried the old chat control",
    );

    // ── every card is a click target with one keyboard toggle ───────────────
    assert.equal(board.cards.length, 7, "the seeded board did not draw seven cards");
    assert.equal(board.contextToggles, 7, "the board did not draw one context toggle per card");
    for (const card of board.cards) {
      assert.ok(card.toggle, `${card.id} has no keyboard context toggle`);
      assert.equal(card.toggle?.pinId, card.id, `${card.id}'s toggle addresses another pin`);
      assert.equal(card.toggle?.pressed, "false", `${card.id}'s toggle started pressed`);
      assert.match(
        card.toggle?.label ?? "",
        /^Add ".+" to the chat context$/,
        `${card.id}'s toggle has no accessible name that names it`,
      );
      assert.equal(card.toggle?.svgs, 0, `${card.id}'s toggle drew a visible icon`);
      assert.ok(
        (card.toggle?.width ?? 99) <= 2 && (card.toggle?.height ?? 99) <= 2,
        `${card.id}'s toggle was visible before it was focused`,
      );
      assert.equal(card.toggle?.inChrome, false, `${card.id}'s toggle was inside the editing chrome`);
      assert.equal(card.cursor, "pointer", `${card.id} did not paint a pointer cursor`);
      assert.equal(card.inContext, false, `${card.id} started in the chat context`);
    }
    // Every card on the board is a pin: the page draws no card of its own
    // beside them.
    assert.deepEqual(
      board.staticPins.map((pin) => ({ toggles: pin.toggles, tools: pin.tools })),
      [],
      "the page drew a static card beside the pins",
    );

    // The goals card paints its count inside the heading; the name is the words.
    assert.equal(
      board.cards.find((card) => card.id === "sys:goal-progress")?.heading,
      "Goals2",
      "the goals card's heading no longer carries its count badge",
    );

    // ── a press adds the card, ringed, in order ─────────────────────────────
    const pressed = report.checks.pressedCard as {
      dock: {
        open: boolean;
        contextCards: { pin: { id: string }; label: string; boardSlug: string | null }[];
      };
      card: CardCheck;
      inContextCards: string[];
    };
    assert.equal(pressed.dock.open, true, "pressing a card left the dock closed");
    assert.deepEqual(pressed.dock.contextCards.map((card) => card.pin.id), [
      "view:financial:v-weekly",
    ]);
    assert.equal(pressed.dock.contextCards[0]?.label, "Weekly expenses", "the press named the card wrongly");
    assert.equal(pressed.dock.contextCards[0]?.boardSlug, null, "the Overview board was given a slug");
    assert.deepEqual(pressed.inContextCards, ["view:financial:v-weekly"]);
    assert.equal(pressed.card.inContext, true, "the pressed card wore no context ring");
    assert.equal(pressed.card.outline.style, "solid", "the context ring was a class and not a line");
    assert.equal(pressed.card.toggle?.pressed, "true", "the pressed card's toggle did not read as pressed");
    assert.equal(
      pressed.card.toggle?.label,
      'Take "Weekly expenses" out of the chat context',
      "the pressed card's toggle still offered to add it",
    );

    // ── three at once, then only the pressed one leaves ─────────────────────
    const three = report.checks.threeHeld as {
      ids: string[];
      cards: { label: string; boardSlug: string | null }[];
      inContextCards: string[];
      toggles: { id: string; pressed: string | null; label: string | null }[];
    };
    assert.deepEqual(three.ids, [
      "view:financial:v-weekly",
      "page:financial:ledger",
      "sys:today-week",
    ]);
    assert.deepEqual(
      three.cards.map((card) => card.label),
      ["Weekly expenses", "Ledger", "Today & this week"],
      "the chat held the cards under the wrong names",
    );
    assert.ok(three.cards.every((card) => card.boardSlug === null), "an Overview card was given a board slug");
    assert.deepEqual(three.inContextCards, three.ids, "the rings did not match the cards held");
    assert.ok(
      three.toggles.every((toggle) => toggle.pressed === "true" && /^Take ".+" out/.test(toggle.label ?? "")),
      "a held card's toggle did not read as pressed",
    );

    const second = report.checks.afterSecond as {
      ids: string[];
      inContextCards: string[];
      ledger: CardCheck;
    };
    assert.deepEqual(second.ids, ["view:financial:v-weekly", "sys:today-week"], "the second press removed the wrong cards");
    assert.equal(second.ledger.inContext, false, "the second press left the card's ring on");
    assert.equal(second.ledger.toggle?.pressed, "false");

    // ── the fourth is refused, visibly and without a write ──────────────────
    const refused = report.checks.refused as {
      ids: string[];
      status: { present: boolean; role: string | null; text: string; height: number; display: string };
      card: CardCheck;
      inContextCards: string[];
    };
    assert.deepEqual(refused.ids, [
      "view:financial:v-weekly",
      "sys:today-week",
      "page:financial:ledger",
    ], "the fourth press changed which cards were held");
    assert.equal(refused.status.present, true, "the fourth press said nothing");
    assert.equal(refused.status.role, "status", "the refusal was not a status");
    assert.equal(
      refused.status.text,
      "Three cards are already in the chat context — take one out first.",
      "the refusal did not use the contract's words",
    );
    assert.ok(refused.status.height > 0, "the refusal line was in the document but not painted");
    assert.equal(refused.card.inContext, false, "the refused card was added anyway");
    assert.equal(refused.card.toggle?.pressed, "false");
    assert.equal(refused.inContextCards.length, 3, "a fourth ring appeared");
    assert.equal(
      (report.checks.noticeCleared as { present: boolean }).present,
      false,
      "the refusal line outlived the next successful toggle",
    );

    // ── empty board space clears all; another surface does not ──────────────
    const cleared = report.checks.emptyClear as {
      afterGap: string[];
      afterHeader: string[];
      afterOutside: string[];
    };
    assert.deepEqual(cleared.afterGap, [], "a press in the gap between cards did not clear the context");
    assert.deepEqual(cleared.afterHeader, [], "a press on the board's header text did not clear the context");
    assert.deepEqual(
      cleared.afterOutside,
      ["view:financial:v-weekly", "page:financial:ledger", "sys:today-week"],
      "a press on another app surface cleared the chat's context",
    );

    // ── controls, gestures and the locked board ─────────────────────────────
    const drag = report.checks.drag as { writes: number; context: string[]; lifted: number };
    const hold = report.checks.hold as { context: string[]; lifted: number; liftedDuringHold: boolean };
    const drift = report.checks.drift as { context: string[]; lifted: number };
    assert.equal(hold.liftedDuringHold, true, "the hold did not lift the card, so the claim was vacuous");
    assert.deepEqual(hold.context, [], "a hold-and-release toggled the card's context");
    assert.equal(drag.writes, 1, "the drag did not reorder the board");
    assert.deepEqual(drag.context, [], "a drag toggled the card's context");
    assert.deepEqual(drift.context, [], "a drifting press toggled the card's context");

    const locked = report.checks.lockedSelection as {
      chrome: { bars: number; buttons: number; tools: number[] };
      cursor: string[];
      two: string[];
      removed: string[];
      cleared: string[];
      writes: number;
      deletes: number;
    };
    assert.deepEqual(locked.chrome, { bars: 0, buttons: 0, tools: [0, 0, 0, 0, 0, 0, 0] });
    assert.ok(locked.cursor.every((cursor) => cursor === "pointer"), "a locked card stopped being a click target");
    assert.deepEqual(locked.two, ["view:financial:v-weekly", "page:financial:ledger"]);
    assert.deepEqual(locked.removed, ["page:financial:ledger"], "a locked board removed the wrong card");
    assert.deepEqual(locked.cleared, [], "a locked board's empty space did not clear the context");
    assert.equal(locked.writes, 0, "selecting a card on a locked board wrote to the pin list");
    assert.equal(locked.deletes, 0, "selecting a card on a locked board deleted anything");

    const keyboard = report.checks.keyboard as {
      afterEnter: { rings: string[]; pressed: string | null; label: string | null };
      afterSecondEnter: { rings: string[]; pressed: string | null };
      locked: { cardTabIndex: number[]; toggleTabIndex: number[]; rings: string[]; writes: number };
    };
    assert.deepEqual(keyboard.afterEnter.rings, ["view:financial:v-weekly"]);
    assert.equal(keyboard.afterEnter.pressed, "true");
    assert.match(keyboard.afterEnter.label ?? "", /^Take "Weekly expenses" out of the chat context$/);
    assert.deepEqual(keyboard.afterSecondEnter.rings, []);
    assert.equal(keyboard.afterSecondEnter.pressed, "false");
    assert.ok(
      keyboard.locked.cardTabIndex.every((value) => value === -1),
      "a locked card became a keyboard tab stop",
    );
    assert.ok(
      keyboard.locked.toggleTabIndex.every((value) => value === 0),
      "the context toggle was not reachable from the keyboard on a locked board",
    );
    assert.deepEqual(keyboard.locked.rings, ["view:financial:v-weekly"]);
    assert.equal(keyboard.locked.writes, 0, "the keyboard toggle wrote to a locked board");

    // ── the name comes off the heading, for all three kinds ─────────────────
    assert.deepEqual(report.checks.handedNames, {
      "sys:goal-progress": "Goals",
      "view:financial:v-weekly": "Weekly expenses",
      "page:financial:ledger": "Ledger",
      "sys:today-week": "Today & this week",
      "view:financial:v-summary": "Spending by month",
      "sys:pending-decisions": "Pending decisions",
      "sys:recent-log": "Recent activity",
    });

    // ── the pre-existing board claims still hold ────────────────────────────
    const landing = report.checks.landing as {
      section: unknown;
      pageMenu: { expanded: string } | null;
      pageMenuPopover: unknown;
      addItem: unknown;
    };
    assert.equal(landing.section, null, "the pin board was open on landing");
    assert.equal(landing.pageMenu?.expanded, "false", "the page menu was open on landing");
    assert.equal(landing.pageMenuPopover, null, "a closed menu left its popover in the document");
    assert.equal(landing.addItem, null, "a closed menu left its pin-board item in the document");
    assert.deepEqual(
      report.checks.above,
      { sectionBeforeGrid: true, triggerBeforeSection: true },
      "the pin board is not above the grid it adds to",
    );

    const addWrites = report.checks.addPinWrites as { id: string }[][];
    assert.equal(addWrites.length, 1, "the add button did not write exactly once");
    assert.deepEqual(addWrites[0]?.at(-1), {
      id: "sys:deadline",
      kind: "system",
      system: "deadline",
    });

    const lockedBoard = report.checks.lockedBoard as {
      addItem: unknown;
      section: unknown;
      strayAddButtons: number;
      pageMenu: unknown;
    };
    const lockedMenu = report.checks.lockedMenu as {
      pageMenuPopover: { items: (string | null)[] } | null;
      addItem: unknown;
    };
    assert.equal(lockedBoard.addItem, null, "a locked board still offered the pin-board item");
    assert.equal(lockedBoard.section, null);
    assert.equal(lockedBoard.strayAddButtons, 0);
    assert.ok(lockedBoard.pageMenu, "a locked board lost its page-menu trigger");
    assert.deepEqual(
      lockedMenu.pageMenuPopover?.items,
      ["board-lock-toggle"],
      "a locked board's menu grew an add path",
    );
    assert.equal(lockedMenu.addItem, null);
    assert.deepEqual(report.checks.lockedMenus, {
      menuToggles: 0,
      menus: 0,
      chromeBars: 0,
      toolsRows: 0,
      contextToggles: 7,
    });

    const menus = report.checks.menus as Record<
      string,
      { role: string | null; items: string[]; testids: (string | null)[]; danger: boolean[] } | undefined
    >;
    assert.deepEqual(menus["sys:goal-progress"]?.items, ["Edit card", "Archive"]);
    for (const id of ["view:financial:v-weekly", "page:financial:ledger"]) {
      assert.deepEqual(menus[id]?.items, ["Edit card", "Archive", "Delete"], `${id}'s menu lost a removal`);
      assert.equal(menus[id]?.testids[2], "pin-delete");
    }

    const archiveWrites = report.checks.archiveWrites as { id: string }[][];
    assert.equal(archiveWrites.length, 1, "Archive did not write exactly once");
    assert.equal(
      archiveWrites[0]?.some((pin) => pin.id === "sys:today-week"),
      false,
      "the archived card is still in the pin list that was written",
    );
    assert.deepEqual(report.checks.viewArchive, { writes: 1, deletes: 0, offeredAgain: true });

    const asking = report.checks.asking as { title: string; destructive: boolean } | null;
    assert.equal(asking?.title, "Delete “Weekly expenses”?");
    assert.equal(asking?.destructive, true);
    assert.deepEqual(report.checks.deleteWrites, [{ kind: "view", slug: "financial", id: "v-weekly" }]);
    assert.deepEqual(report.checks.pageDeletes, [{ kind: "page", slug: "financial", id: "ledger" }]);

    const deadline = report.checks.deadlinePin as {
      banner: boolean;
      toolsPosition: string | null;
      toolsBottom: number;
      bannerTop: number;
      chatControls: number;
      messageIcons: number;
    };
    assert.equal(deadline.banner, true, "the deadline banner did not draw");
    assert.equal(deadline.toolsPosition, "static", "the deadline pin's controls took a corner");
    assert.ok(deadline.toolsBottom <= deadline.bannerTop, "the deadline pin's controls sat on the banner");
    assert.equal(deadline.chatControls, 0, "the deadline pin kept a chat icon");
    assert.equal(deadline.messageIcons, 0, "the deadline pin kept a MessageSquare glyph");

    // ── the cards' content: domains, the inline count, the task tick ────────
    const homeCards = report.checks.homeCards as {
      boardWidth: number;
      goals: {
        width: number;
        rows: {
          name: string;
          domain: string;
          unassigned: boolean;
          progress: string | null;
          hasBar: boolean;
        }[];
      };
      heading: {
        markerBeforeCount: boolean;
        countGapFromMarker: number | null;
        countInFirstHalf: boolean;
      };
      activity: { width: number; rows: { summary: string; type: string; when: string }[] };
      todayWeek: {
        width: number;
        columns: { heading: string; tasks: { title: string; checkbox: string }[] }[];
      };
    };
    assert.deepEqual(
      homeCards.goals.rows,
      [
        {
          name: "Run 5k",
          domain: "Financial",
          unassigned: false,
          progress: "40",
          hasBar: true,
        },
        {
          name: "Renew the passport",
          domain: "No area",
          unassigned: true,
          progress: null,
          hasBar: false,
        },
      ],
      "the goals card does not say what each goal is filed under or how far along it is",
    );
    assert.ok(
      homeCards.goals.width < homeCards.boardWidth - 40,
      "the goals card is still a full-row card",
    );
    assert.ok(
      homeCards.activity.width < homeCards.boardWidth - 40,
      "the activity card is still a full-row card",
    );
    assert.ok(
      homeCards.todayWeek.width < homeCards.boardWidth - 40,
      "the today-and-this-week card is still a full-row card",
    );
    assert.equal(homeCards.heading.markerBeforeCount, true, "the count no longer follows the card's marker");
    assert.ok(
      (homeCards.heading.countGapFromMarker ?? 99) <= 16,
      `the count sits ${homeCards.heading.countGapFromMarker}px from the heading's marker`,
    );
    assert.equal(homeCards.heading.countInFirstHalf, true, "the count drifted to the card's far edge");
    assert.equal(homeCards.activity.rows.length, 2, "the activity card did not draw its lines");
    assert.ok(
      homeCards.activity.rows.every((row) => row.summary && row.type && row.when),
      "an activity line lost its summary, its type or its time",
    );
    assert.deepEqual(
      homeCards.todayWeek.columns.map((column) => column.heading),
      ["Today 2", "This week 1"],
      "the task columns do not count their tasks",
    );
    assert.deepEqual(
      homeCards.todayWeek.columns.map((column) => column.tasks.map((task) => task.title)),
      [["Draft the ledger import", "Reply to the accountant"], ["Close the books"]],
      "the task columns do not list the tasks in their columns",
    );
    assert.ok(
      homeCards.todayWeek.columns.every((column) =>
        column.tasks.every((task) => /^Mark ".+" done$/.test(task.checkbox)),
      ),
      "a task has no tick of its own",
    );

    const tick = report.checks.taskTick as {
      commands: unknown[];
      headings: string[];
      titles: string[];
      context: number;
    };
    assert.deepEqual(
      tick.commands,
      [{ type: "moveTask", id: "t-draft", column: "done" }],
      "the Dashboard's tick did not write the Act board's own move to Done",
    );
    assert.deepEqual(
      tick.headings,
      ["Today 1", "This week 1"],
      "the tick did not move the count with the task",
    );
    assert.ok(tick.titles.includes("Reply to the accountant"), "the tick removed the wrong task");
    assert.ok(!tick.titles.includes("Draft the ledger import"), "the done task stayed on the card");
    assert.equal(tick.context, 0, "pressing a task's tick put the card in the chat's context");

    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);
  });

  it("shows one pill per card, removes each on its own, and puts the array on the turn", async (t) => {
    const report = await readReport(t, "card-context", [
      "the-harness-board-offers-three-cards",
      "no-card-no-pill-and-no-context",
      "one-pill-per-card-in-the-order-added",
      "each-pill-removes-only-its-card",
      "a-three-card-turn-carries-focusedcards",
      "the-click-join-puts-the-card-in-the-pill-and-the-caret-in-the-composer",
      "removing-the-last-pill-restores-the-ordinary-turn",
      "only-the-dashboard-clears-the-context",
    ]);

    const EXPECTED = [
      {
        label: "Weekly expenses",
        pinId: "view:financial:v-weekly",
        kind: "view",
        boardSlug: null,
        domainSlug: "financial",
        viewId: "v-weekly",
      },
      {
        label: "Spending by month",
        pinId: "view:financial:v-summary",
        kind: "view",
        boardSlug: null,
        domainSlug: "financial",
        viewId: "v-summary",
      },
      {
        label: "Cash flow",
        pinId: "view:financial:v-cashflow",
        kind: "view",
        boardSlug: null,
        domainSlug: "financial",
        viewId: "v-cashflow",
      },
    ];

    // The board really has three cards, so the cap and order claims can break.
    const board = report.checks.board as {
      cards: { id: string; heading: string | null; toggle: { pinId: string | null } | null }[];
    };
    assert.deepEqual(
      board.cards.map((card) => card.id),
      EXPECTED.map((card) => card.pinId),
      "the harness board did not offer three cards",
    );
    assert.deepEqual(
      board.cards.map((card) => card.heading),
      EXPECTED.map((card) => card.label),
      "a card's heading was not its name",
    );

    // No card, no pill, and no `focusedCards` key at all — not even a null one.
    const bare = report.checks.bareTurn as {
      focusedCards: unknown;
      focusedCard: unknown;
      pill: unknown;
    };
    assert.equal(bare.focusedCards, "<absent>", "a turn with no card carried a focusedCards key");
    assert.equal(bare.focusedCard, "<absent>", "a turn with no card carried the old focusedCard key");
    assert.equal(bare.pill, null);

    // One pill per card, in the order the cards were chosen, each named.
    const held = report.checks.held as {
      pills: {
        label: string | null;
        pinId: string | null;
        remove: { pinId: string | null; label: string | null } | null;
      }[];
      container: { testId: string; count: number; flexWrap: string } | null;
      inContextCards: string[];
    };
    assert.deepEqual(
      held.pills.map((pill) => pill.label),
      EXPECTED.map((card) => card.label),
      "the pills were not in the order the cards were chosen",
    );
    assert.deepEqual(held.pills.map((pill) => pill.pinId), EXPECTED.map((card) => card.pinId));
    for (const [index, pill] of held.pills.entries()) {
      assert.equal(pill.remove?.pinId, EXPECTED[index]?.pinId);
      assert.equal(pill.remove?.label, `Remove "${EXPECTED[index]?.label}" from context`);
    }
    assert.equal(held.container?.testId, "chat-context-pills");
    assert.equal(held.container?.count, 3);
    assert.equal(held.container?.flexWrap, "wrap", "the pill row squeezed the composer instead of wrapping");
    assert.deepEqual(held.inContextCards, EXPECTED.map((card) => card.pinId));

    // Each pill removes only its card.
    const afterPill = report.checks.afterPill as {
      pills: { pinId: string | null }[];
      inContextCards: string[];
      dock: { open: boolean; contextCards: { pin: { id: string } }[] };
    };
    assert.deepEqual(afterPill.pills.map((pill) => pill.pinId), [
      EXPECTED[0]?.pinId,
      EXPECTED[2]?.pinId,
    ]);
    assert.deepEqual(afterPill.inContextCards, [EXPECTED[0]?.pinId, EXPECTED[2]?.pinId]);
    assert.equal(afterPill.dock.open, true, "removing a pill closed the dock");

    // The three-card turn carries the whole array, field by field, and no legacy
    // single-card key.
    const three = report.checks.threeCardTurn as {
      focusedCards: unknown;
      hasFocusedCard: boolean;
    };
    // The middle card was taken out by its pill and put back, so it went to the
    // END of the array: the order is the order the cards were added, not the
    // board's order and not the seed's.
    assert.deepEqual(
      three.focusedCards,
      [EXPECTED[0], EXPECTED[2], EXPECTED[1]],
      "the three-card turn did not carry the cards exactly, in add order",
    );
    assert.equal(three.hasFocusedCard, false, "the turn carried a legacy focusedCard key");

    // The join: a real press on a real card grows the pill and takes the caret.
    const joined = report.checks.fromTheCard as {
      pill: { label: string | null; pinId: string | null } | null;
      pills: number;
      active: { tag: string; cls: string } | null;
      ring: { inContext: boolean } | null;
      focusedCards: unknown;
    };
    assert.equal(joined.pills, 1, "the press grew no pill");
    assert.equal(joined.pill?.label, "Weekly expenses", "the press's pill named the wrong card");
    assert.equal(joined.pill?.pinId, "view:financial:v-weekly");
    assert.equal(joined.active?.tag, "TEXTAREA", "the press did not hand the caret to the composer");
    assert.match(joined.active?.cls ?? "", /chat-panel__composer-input/);
    assert.equal(joined.ring?.inContext, true, "the card the press handed over wore no ring");
    assert.deepEqual(joined.focusedCards, [EXPECTED[0]], "the clicked card did not reach the turn");

    // Removing the last pill restores the ordinary turn.
    const last = report.checks.lastPill as {
      pills: unknown[];
      container: unknown;
      rings: string[];
      dock: { contextCards: unknown[] };
      focusedCards: unknown;
      focusedCard: unknown;
    };
    assert.deepEqual(last.pills, []);
    assert.equal(last.container, null);
    assert.deepEqual(last.rings, []);
    assert.deepEqual(last.dock.contextCards, []);
    assert.equal(last.focusedCards, "<absent>", "a turn after the last pill still carried focusedCards");
    assert.equal(last.focusedCard, "<absent>", "a turn after the last pill carried the legacy key");

    // Only the Dashboard's own empty space clears the held cards.
    const surfaces = report.checks.surfaces as {
      held: string[];
      afterChatAndRail: string[];
      afterBoard: string[];
      rings: string[];
    };
    assert.deepEqual(surfaces.held, [EXPECTED[0]?.pinId, EXPECTED[1]?.pinId]);
    assert.deepEqual(
      surfaces.afterChatAndRail,
      [EXPECTED[0]?.pinId, EXPECTED[1]?.pinId],
      "pressing the chat or the rail cleared the context",
    );
    assert.deepEqual(surfaces.afterBoard, [], "the Dashboard's empty space did not clear the context");
    assert.deepEqual(surfaces.rings, []);

    assert.equal(report.checks.turnsSent, 4, "the rig did not send every turn it claims about");
    assert.deepEqual(report.checks.consoleErrors, []);
  });
});
