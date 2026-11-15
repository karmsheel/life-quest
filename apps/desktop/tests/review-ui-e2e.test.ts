import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Review page: the document and the Review checklist beside it, the per-area
 * reviews, the life review they unlock, and the daily review that has none of
 * them.
 *
 * The claims themselves live in `e2e/review.electron.mjs`, which drives the
 * harness; this file runs that driver and refuses a report that does not hold.
 * Every claim is restated here so a regression names the surface rather than
 * only the rig's own failure list.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up (the repository's
 * `lifequest-e2e` runner starts one itself, so the final run does not skip).
 *
 * The artifact is `e2e/artifacts/review.json` plus the seven `.png`s the driver
 * captures: same command, same claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/review.json");
const SHOTS = [
  "review-document.png",
  "review-started.png",
  "review-rules.png",
  "review-wide.png",
  "review-checklist.png",
  "review-life-ready.png",
  "review-daily.png",
].map((name) => path.join(desktopRoot, "e2e/artifacts", name));

/** The four-overall-headings order the engine's skeleton uses. */
const AREAS = [
  { slug: "health", name: "Health" },
  { slug: "mind", name: "Mind" },
  { slug: "financial", name: "Finance" },
  { slug: "business", name: "Business" },
  { slug: "relationships", name: "Relationships" },
] as const;
const TOTAL_AREAS = AREAS.length;
const RAIL_ROWS = [
  "review-area-overall",
  ...AREAS.map((area) => `review-area-${area.slug}`),
];

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
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/review.electron.mjs")],
      { cwd: desktopRoot, timeout: 180_000 },
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

type Rect = { left: number; top: number; width: number; height: number };

/** How the page stands in the sheet: the column, the rail, and the pair. */
type Layout = {
  shellClass: string | null;
  content: (Rect & { clientWidth: number; centerX: number }) | null;
  layout: Rect | null;
  page: Rect | null;
  pageMaxWidth: string | null;
  rail: Rect | null;
  railPosition: string | null;
  header: Rect | null;
  modes: Rect | null;
  editor: Rect | null;
  scope: Rect | null;
  pageActions: Rect | null;
  notes: Rect | null;
};

/** The numbers the driver claims the two-column layout with. */
type Column = {
  shellClass: string | null;
  contentLeft: number | null;
  contentRight: number | null;
  contentClientWidth: number | null;
  contentCentre: number | null;
  layoutLeft: number | null;
  layoutWidth: number | null;
  pageLeft: number | null;
  pageRight: number | null;
  pageWidth: number | null;
  pageTop: number | null;
  pageMaxWidth: string | null;
  railLeft: number | null;
  railRight: number | null;
  railWidth: number | null;
  railTop: number | null;
  railBottom: number | null;
  railPosition: string | null;
  gap: number | null;
  groupCentre: number | null;
  headerLeft: number | null;
  modesLeft: number | null;
  editorLeft: number | null;
  scopeLeft: number | null;
  actionsLeft: number | null;
  notesLeft: number | null;
};

/** One row of the Review checklist. */
type RailItem = {
  tag: string;
  text: string | null;
  disabled: boolean;
  ariaCurrent: string | null;
  className: string;
};

type Page = {
  boxes: number;
  blockCount: number;
  blanks: number;
  writingLines: number;
  editing: boolean;
  inputValue: string | null;
  boxMarkdown: string;
  boxText: string;
  readOnly: boolean | null;
  strong: number;
  underlines: number;
  tables: number;
  headers: string[];
  headings: number;
  title: string | null;
  period: string | null;
  notice: string | null;
  error: string | null;
  status: string | null;
  lockedBadge: string | null;
  actions: string[];
  modes: string[];
  previewShown: boolean;
  skillOpen: boolean;
  skillValue: string | null;
  layoutPresent: boolean;
  layoutSingle: boolean | null;
  railPresent: boolean;
  railLabel: string | null;
  progress: string | null;
  hint: string | null;
  railButtons: string[];
  lifeItem: RailItem | null;
  lifeStatus: string | null;
  healthItem: RailItem | null;
  healthStatus: string | null;
  mindItem: RailItem | null;
  mindStatus: string | null;
  financeItem: RailItem | null;
  financeStatus: string | null;
  businessItem: RailItem | null;
  businessStatus: string | null;
  relationshipsItem: RailItem | null;
  relationshipsStatus: string | null;
  scopeLine: string | null;
  scopeName: string | null;
  scopeWholeLifeLink: boolean;
  markDoneLabel: string | null;
  markDoneDisabled: boolean | null;
  startLabel: string | null;
  unlockPresent: boolean;
  emptyPresent: boolean;
  layout: Layout;
};

type RailState = {
  progress: string | null;
  hint: string | null;
  rows: string[];
  lifeStatus: string | null;
  lifeDisabled: boolean | null;
  statuses: Record<string, string | null>;
};

type StartCall = {
  cadence: string;
  period: string;
  scope: string;
  sessionId: string;
  kickoff: string;
};

type ScopeState = { status: "draft" | "done"; sessionId: string | null };

type Report = {
  pass: boolean;
  failures: string[];
  generatedAt: string;
  checks: {
    opened: Page;
    openedRail: RailState;
    centering: Column;
    wide: Page;
    wideCentering: Column;
    narrow: Page;
    narrowColumns: Column;
    blankLineBody: string;
    blankLineBlocks: number;
    bolded: { value: string; start: number; end: number; prevented: boolean };
    underlined: { value: string };
    headed: { value: string };
    reheaded: { value: string };
    formatted: Page;
    agentDown: Page;
    agentDownRail: RailState;
    agentDownSnapshotCalls: { cadence: string; period: string; scope: string }[];
    filledBody: string;
    started: Page;
    starts: StartCall[];
    financeKickoffs: string[];
    startedTwiceBody: string;
    financeDone: Page;
    financeDoneRail: RailState;
    scopesAfterFinance: Record<string, ScopeState>;
    startedMind: { page: Page; start: StartCall };
    completedMind: Page;
    startedBusiness: { page: Page; start: StartCall };
    completedBusiness: Page;
    startedRelationships: { page: Page; start: StartCall };
    completedRelationships: Page;
    allDone: Page;
    allDoneRail: RailState;
    dailyOpen: Page;
    dailyStarted: Page;
    dailyStart: StartCall;
    dailyBody: string;
    back: Page;
    rules: Page;
    skillWrites: string[];
    preview: Page;
    previewText: string;
    lifeStarted: Page;
    lifeStart: StartCall;
    locked: Page;
    lockedRail: RailState;
    lockedScopes: Record<string, ScopeState>;
    refusedWrite: boolean;
    lockedBody: string;
    startsAll: StartCall[];
    kickoffsAll: string[];
    scopeSequence: string[];
    kickoffsMatched: number;
    calls: string[];
    failedFinanceStarts: number;
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
};

/** The rail a page is showing, for a message that names the surface. */
function railOf(page: Page): RailState {
  return {
    progress: page.progress,
    hint: page.hint,
    rows: page.railButtons,
    lifeStatus: page.lifeStatus,
    lifeDisabled: page.lifeItem ? page.lifeItem.disabled : null,
    statuses: {
      health: page.healthStatus,
      mind: page.mindStatus,
      financial: page.financeStatus,
      business: page.businessStatus,
      relationships: page.relationshipsStatus,
    },
  };
}

/** One checklist row by slug, as the report's flat page fields hold it. */
function railItem(page: Page, slug: string): RailItem | null {
  if (slug === "overall") return page.lifeItem;
  const key = slug === "financial" ? "finance" : slug;
  return (page as unknown as Record<string, RailItem | null>)[`${key}Item`];
}

/** One checklist row's status text by slug. */
function railText(page: Page, slug: string): string | null {
  if (slug === "overall") return page.lifeStatus;
  const key = slug === "financial" ? "finance" : slug;
  return (page as unknown as Record<string, string | null>)[`${key}Status`];
}

describe("review ui e2e", () => {
  it("draws the review checklist beside the document, gates the life review behind the areas, and keeps the daily review one general review", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    for (const shot of SHOTS) fs.rmSync(shot, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // ── the review IS the document, with the checklist beside it ────────────
    const opened = report.checks.opened;
    assert.equal(opened.boxes, 1, "the review page does not draw exactly one editor box");
    assert.equal(opened.blockCount, 35, "the review did not render its own file");
    assert.equal(opened.editing, false, "the review opened a writing line on arrival");
    assert.equal(opened.blanks, 1, "the blank line the operator typed is not drawn");
    assert.equal(opened.title, "Weekly review", "the review page is not titled for its cadence");
    // The page opens on the CURRENT week, which is whatever week the suite runs
    // in: the claim is the shape of its own label, not a pinned date.
    assert.match(
      String(opened.period),
      /^Weekly review · Week of \d{1,2} [A-Z][a-z]{2} \d{4}$/,
      "the review page does not label its period",
    );
    assert.equal(
      opened.actions.includes("Edit"),
      false,
      "the review document is behind an Edit control again",
    );
    assert.equal(
      opened.actions.includes("Save"),
      false,
      "the review document is behind a Save control again",
    );
    assert.equal(
      opened.boxText.includes("**"),
      false,
      "raw markdown markers are painted in the review box",
    );

    // ── the checklist is the LIVE areas, Life first, with the file's statuses ─
    assert.equal(opened.layoutPresent, true, "the review-page-layout wrapper is missing");
    assert.equal(opened.layoutSingle, false, "a weekly review was rendered as a single column");
    assert.equal(opened.railPresent, true, "the weekly review has no Review checklist");
    assert.equal(opened.railLabel, "Review checklist", "the checklist is not labelled as one");
    assert.deepEqual(
      opened.railButtons,
      RAIL_ROWS,
      "the checklist's rows are not the Life review then the live areas in vault order",
    );
    // The fixture also has a locked `spirit` area on disk: a rail built from every
    // domain file would offer a review for an area the operator cannot see.
    assert.equal(
      opened.railButtons.includes("review-area-spirit"),
      false,
      "the checklist offers a review for the locked spirit area",
    );
    assert.equal(
      opened.progress,
      `1 of ${TOTAL_AREAS} areas done`,
      "the progress line does not count the fixture's one done area",
    );
    assert.equal(opened.healthStatus, "Done", "the done area does not read Done");
    assert.equal(opened.financeStatus, "In progress", "the started area does not read In progress");
    assert.equal(opened.mindStatus, "Not started", "an untouched area does not read Not started");
    assert.equal(opened.businessStatus, "Not started", "an untouched area does not read Not started");
    assert.equal(
      opened.relationshipsStatus,
      "Not started",
      "an untouched area does not read Not started",
    );
    assert.equal(
      opened.lifeStatus,
      `${TOTAL_AREAS - 1} areas left`,
      "the gated Life review does not say how many areas are left",
    );
    assert.equal(
      opened.lifeItem !== null && opened.lifeItem.disabled,
      true,
      "the Life review is pressable before the areas are done",
    );
    // The scope line names the scope this box is, and only an area scope offers
    // the way back to the whole-life review.
    assert.equal(opened.scopeName, "Life", "the scope line does not name the Life scope");
    assert.match(String(opened.scopeLine), /Reviewing/, "the scope line does not say what is being reviewed");
    assert.equal(
      opened.scopeWholeLifeLink,
      false,
      "the whole-life link is offered while the page IS the whole-life review",
    );
    assert.equal(
      opened.markDoneLabel,
      "Mark life review complete",
      "the mark-done button is not the life review's form",
    );

    // ── the page is one centred pair: 48rem column + checklist to its right ──
    const centred = report.checks.centering;
    assert.ok(centred.pageLeft !== null, "the reading column's leading edge could not be read");
    assert.ok(centred.pageWidth !== null, "the reading column's width could not be read");
    assert.ok(centred.contentCentre !== null, "the sheet's centre could not be read");
    assert.ok(
      Number(centred.pageWidth) <= 48 * 16 + 1,
      `the reading column is ${centred.pageWidth}px wide, past its 48rem measure`,
    );
    assert.ok(
      Number(centred.pageWidth) >= 48 * 16 - 1,
      `the reading column narrowed to ${centred.pageWidth}px although the sheet had room for 48rem`,
    );
    assert.ok(centred.railWidth !== null, "the checklist's width could not be read");
    assert.ok(
      Number(centred.railWidth) >= 180 && Number(centred.railWidth) <= 420,
      `the checklist is ${centred.railWidth}px wide, not the ~17rem column the page is drawn for`,
    );
    assert.ok(
      centred.gap !== null && centred.gap >= 16,
      `the checklist is not to the right of the column with a gap: ${centred.gap}px`,
    );
    assert.ok(
      Math.abs((centred.groupCentre ?? NaN) - (centred.contentCentre ?? NaN)) <= 2,
      `the page+checklist group's centre is ${centred.groupCentre}, ${centred.contentCentre} is the sheet's`,
    );
    for (const [part, left] of [
      ["header", centred.headerLeft],
      ["modes", centred.modesLeft],
      ["editor", centred.editorLeft],
      ["scope line", centred.scopeLeft],
      ["actions", centred.actionsLeft],
      ["daily-notes strip", centred.notesLeft],
    ] as const) {
      assert.ok(
        left !== null && centred.pageLeft !== null && Math.abs(left - centred.pageLeft) <= 1,
        `the ${part} does not start on the reading column`,
      );
    }

    // ── a wide window: the same measure, the pair centred with room ─────────
    const wide = report.checks.wideCentering;
    assert.ok(wide.pageLeft !== null, "the wide page column's leading edge could not be read");
    assert.ok(wide.pageWidth !== null, "the wide page column's width could not be read");
    assert.ok(wide.contentCentre !== null, "the wide sheet's centre could not be read");
    assert.ok(
      Math.abs((wide.groupCentre ?? NaN) - (wide.contentCentre ?? NaN)) <= 2,
      "in a wide window the page+checklist group is not centred on the sheet",
    );
    assert.ok(
      Number(wide.pageWidth) >= 48 * 16 - 1 && Number(wide.pageWidth) <= 48 * 16 + 1,
      `in a wide window the reading column is ${wide.pageWidth}px wide, not its 48rem measure`,
    );
    assert.ok(
      wide.railLeft !== null &&
        wide.pageRight !== null &&
        wide.railLeft >= wide.pageRight + 16,
      "in a wide window the checklist is not a real column to the right of the page",
    );

    // ── a narrow window: no room beside the column, so the rail stacks above ─
    const narrow = report.checks.narrowColumns;
    assert.ok(narrow.railTop !== null && narrow.pageTop !== null, "the narrow layout could not be read");
    assert.ok(
      Number(narrow.railTop) < Number(narrow.pageTop),
      "in a narrow window the checklist is not above the reading column",
    );
    assert.ok(
      Number(narrow.railBottom) <= Number(narrow.pageTop) + 1,
      "in a narrow window the checklist overlaps the reading column",
    );
    assert.equal(
      report.checks.narrow.railPresent,
      true,
      "the narrow window lost the checklist instead of stacking it",
    );

    // ── a blank line the operator typed reaches the file ────────────────────
    assert.match(
      report.checks.blankLineBody,
      /Two walks, and \*\*one\*\* late night\.\n\n\n\nSlept badly, and it showed at work\./,
      "the blank line the operator typed did not survive being written down",
    );
    assert.equal(
      report.checks.blankLineBlocks,
      1,
      "the blank line disappeared from the box after an edit below it",
    );

    // ── the formatting keys ────────────────────────────────────────────────
    assert.equal(report.checks.bolded.prevented, true, "Ctrl+B was not claimed by the editor");
    assert.equal(report.checks.bolded.value, "alpha **beta** gamma", "Ctrl+B did not wrap the selection");
    assert.equal(report.checks.bolded.start, 8, "Ctrl+B left the caret outside the mark");
    assert.equal(report.checks.bolded.end, 12, "Ctrl+B left the selection outside the mark");
    assert.equal(
      report.checks.underlined.value,
      "<u>alpha</u> **beta** gamma",
      "Ctrl+U did not write the underline mark",
    );
    assert.equal(
      report.checks.headed.value,
      "## <u>alpha</u> **beta** gamma",
      "Ctrl+2 did not make the line an H2",
    );
    assert.equal(
      report.checks.reheaded.value,
      "### <u>alpha</u> **beta** gamma",
      "Ctrl+3 stacked a second heading instead of replacing the first",
    );
    assert.equal(report.checks.formatted.underlines >= 1, true, "the underline mark did not render");
    assert.equal(report.checks.formatted.strong >= 1, true, "the bold mark did not render");
    assert.equal(
      report.checks.formatted.boxText.includes("<u>"),
      false,
      "the underline tag is printed literally in the box",
    );

    // ── a checklist row starts THAT row's review, even with the agent down ──
    const agentDown = report.checks.agentDown;
    assert.match(
      String(agentDown.error),
      /Settings › Hermes/,
      "an unreachable agent was not reported with the place to fix it",
    );
    assert.doesNotMatch(
      String(agentDown.error),
      /fetch failed/i,
      "the page reported the transport's own words",
    );
    assert.equal(agentDown.boxes, 1, "an unreachable agent took the review document away");
    assert.equal(
      agentDown.boxText.includes("Spending this period"),
      true,
      "the filled snapshot is not visible in the review with the agent down",
    );
    // Pressing a row puts the page on that area: the scope line and the selected
    // row must agree, or the kickoff and the box are about different sections.
    assert.equal(agentDown.scopeName, "Finance", "the Finance row left the scope line on another scope");
    assert.equal(
      agentDown.financeItem !== null && agentDown.financeItem.className.includes("is-active"),
      true,
      "the pressed row is not the selected row",
    );
    assert.match(
      String(agentDown.scopeLine),
      /Whole-life review/,
      "an area scope does not offer the way back to the whole-life review",
    );
    assert.equal(
      report.checks.agentDownSnapshotCalls.length,
      1,
      "the failed start did not run the snapshot pass exactly once",
    );
    assert.equal(
      report.checks.agentDownSnapshotCalls[0]!.scope,
      "financial",
      "the Finance row ran the snapshot pass for another scope",
    );
    assert.equal(
      report.checks.filledBody.split("<!-- lifequest:snapshot:finance-spend -->").length - 1,
      1,
      "the snapshot marker is not in the file exactly once",
    );
    assert.match(report.checks.filledBody, /\| Groceries \| 1,234\.56 \|/, "the snapshot did not carry the figure");
    // The rule names the financial domain's Look-back, so the block belongs in
    // the Finance area section, not under the overall `## Look-back`.
    const filled = report.checks.filledBody;
    const financeAt = filled.indexOf("## Finance");
    const financeLookback = filled.indexOf("### Look-back", Math.max(financeAt, 0));
    const snapshotAt = filled.indexOf("<!-- lifequest:snapshot:finance-spend -->");
    const financeKeep = filled.indexOf("### Keep", Math.max(financeLookback, 0));
    assert.ok(
      financeAt !== -1 &&
        financeLookback !== -1 &&
        snapshotAt > financeLookback &&
        snapshotAt < financeKeep,
      "the snapshot did not land in Finance's Look-back section",
    );
    assert.equal(
      agentDown.boxText.includes("lifequest:snapshot"),
      false,
      "the snapshot marker is printed in the review",
    );
    assert.equal(agentDown.tables >= 1, true, "the snapshot's table is not drawn as a table");
    assert.deepEqual(
      agentDown.headers.filter((h) => h === "Category" || h === "Total (ZAR)").sort(),
      ["Category", "Total (ZAR)"],
      "the snapshot's table headers are wrong",
    );
    assert.equal(
      agentDown.boxText.includes("| --- |"),
      false,
      "the snapshot's table is painted as markdown pipes",
    );

    // ── the Finance row opens the Finance interview, and finishing it flips
    //    only that row ───────────────────────────────────────────────────────
    const started = report.checks.started;
    const financeStart = report.checks.starts[0]!;
    assert.equal(started.error, null, `the Finance start reported ${String(started.error)}`);
    assert.equal(financeStart.scope, "financial", "the Finance row started another scope");
    assert.equal(financeStart.cadence, "weekly", "the Finance row started another cadence");
    assert.match(financeStart.kickoff, /## Finance/, "the Finance kickoff does not name its own section");
    assert.match(financeStart.kickoff, /only/, "the Finance kickoff does not scope the companion to one section");
    assert.equal(report.checks.financeKickoffs.length, 1, "the dock was not sent exactly the Finance kickoff");
    assert.match(String(report.checks.financeKickoffs[0]), /## Finance/, "the dock was sent another kickoff");
    assert.match(String(started.notice), /snapshot/i, "the page did not say what it filled");
    assert.match(String(started.notice), /chat/i, "the page did not say the interview opened");
    assert.equal(
      started.markDoneLabel,
      "Mark Finance review complete",
      "the mark-done button is not the Finance form",
    );
    assert.equal(
      report.checks.startedTwiceBody.split("<!-- lifequest:snapshot:finance-spend -->").length - 1,
      1,
      "a second start appended a second snapshot block",
    );
    assert.equal(
      report.checks.startedTwiceBody.split("| Groceries | 1,234.56 |").length - 1,
      1,
      "a second start appended the snapshot's own table again",
    );
    assert.equal(
      railText(report.checks.financeDone, "financial"),
      "Done",
      "finishing Finance did not flip its row to Done",
    );
    assert.equal(
      report.checks.financeDone.progress,
      `2 of ${TOTAL_AREAS} areas done`,
      "the progress line did not count the second area",
    );
    assert.match(
      String(report.checks.financeDone.notice),
      /Finance review complete/,
      "finishing Finance did not say so",
    );
    assert.equal(
      report.checks.scopesAfterFinance.financial?.status,
      "done",
      "the review file's financial scope was not marked done",
    );

    // ── the last area unlocks the life review, and only the last one ────────
    const remaining = [
      { slug: "mind", name: "Mind" },
      { slug: "business", name: "Business" },
      { slug: "relationships", name: "Relationships" },
    ] as const;
    for (const area of remaining) {
      const startedArea = report.checks[`started${area.name}`];
      const completed = report.checks[`completed${area.name}`];
      assert.equal(
        startedArea.start.scope,
        area.slug,
        `the ${area.name} row started another scope`,
      );
      assert.match(
        startedArea.start.kickoff,
        new RegExp(`## ${area.name}`),
        `the ${area.name} kickoff does not name its own section`,
      );
      assert.equal(
        startedArea.page.scopeName,
        area.name,
        `the ${area.name} row left the scope line on another scope`,
      );
      assert.equal(
        startedArea.page.markDoneLabel,
        `Mark ${area.name} review complete`,
        `the mark-done button is not the ${area.name} form`,
      );
      assert.equal(
        startedArea.page.scopeWholeLifeLink,
        true,
        `the ${area.name} scope does not offer the whole-life review link`,
      );
      assert.equal(railText(completed, area.slug), "Done", `the ${area.name} row did not flip to Done`);
      const doneCount = remaining.findIndex((r) => r.slug === area.slug) + 3;
      assert.equal(
        completed.progress,
        `${doneCount} of ${TOTAL_AREAS} areas done`,
        `the progress line after ${area.name} is wrong`,
      );
      if (area.slug === "relationships") {
        assert.match(
          String(completed.notice),
          /Every area is reviewed/,
          "finishing the last area did not say every area is reviewed",
        );
        assert.match(
          String(completed.hint),
          /All areas are reviewed/i,
          "the checklist hint does not say all areas are reviewed",
        );
        assert.equal(
          completed.lifeItem !== null && completed.lifeItem.disabled,
          false,
          "the Life review is still disabled after the last area was completed",
        );
        assert.equal(
          completed.lifeStatus,
          "In progress",
          "the unlocked Life review does not read In progress (the file's overall scope is planted but unstarted)",
        );
      } else {
        assert.match(
          String(completed.notice),
          new RegExp(`${area.name} review complete`),
          `finishing ${area.name} did not say so`,
        );
      }
    }
    const allDone = report.checks.allDone;
    assert.equal(
      allDone.progress,
      `${TOTAL_AREAS} of ${TOTAL_AREAS} areas done`,
      "every area is done but the progress line does not say so",
    );
    for (const area of AREAS) {
      assert.equal(railText(allDone, area.slug), "Done", `the ${area.name} row is not Done after completion`);
    }

    // ── the daily review is one general review, with no checklist ───────────
    const dailyOpen = report.checks.dailyOpen;
    assert.equal(dailyOpen.railPresent, false, "the daily review drew an area checklist");
    assert.deepEqual(dailyOpen.railButtons, [], "the daily review drew area controls");
    assert.equal(dailyOpen.scopeLine, null, "the daily review drew a scope line");
    assert.equal(dailyOpen.scopeName, null, "the daily review drew a scope name");
    assert.equal(dailyOpen.layoutPresent, true, "the daily review has no review-page-layout wrapper");
    assert.equal(
      dailyOpen.layoutSingle,
      true,
      "the daily review is not rendered as the single-column review-page-layout",
    );
    assert.equal(
      dailyOpen.startLabel,
      "Start the interview",
      "the daily empty state does not offer one general start",
    );
    assert.equal(dailyOpen.emptyPresent, true, "the daily review did not draw its empty state");
    const dailyStart = report.checks.dailyStart;
    // The rig is on the Relationships lens when it navigates to Daily: a daily
    // review that honoured the lens would start an area scope.
    assert.equal(dailyStart.cadence, "daily", "the daily start asked for another cadence");
    assert.equal(
      dailyStart.scope,
      "overall",
      "the daily review started an area scope — it must ignore the title-bar lens",
    );
    assert.match(
      dailyStart.kickoff,
      /one general review/,
      "the daily kickoff does not say it is one general review",
    );
    assert.match(
      dailyStart.kickoff,
      /no area sections/,
      "the daily kickoff does not say there are no area sections",
    );
    assert.equal(
      report.checks.dailyBody.includes("### "),
      false,
      "the daily review file grew area (###) sections",
    );
    for (const area of AREAS) {
      assert.equal(
        report.checks.dailyBody.includes(`## ${area.name}`),
        false,
        `the daily review file grew a ${area.name} section`,
      );
    }
    assert.equal(
      report.checks.dailyStarted.markDoneLabel,
      "Mark review complete",
      "the daily review's mark-done button is not its general form",
    );
    assert.equal(
      report.checks.dailyStarted.railPresent,
      false,
      "the daily review grew a checklist after its interview started",
    );

    // ── back on the weekly review: the lens survived the daily page ─────────
    const back = report.checks.back;
    assert.equal(
      back.scopeName,
      "Relationships",
      "the daily review consumed the title-bar lens the weekly page had",
    );
    assert.equal(
      back.markDoneLabel,
      "Mark Relationships review complete",
      "the weekly mark-done button is not the area's form",
    );
    assert.equal(
      back.lifeItem !== null && back.lifeItem.disabled,
      false,
      "the Life review is not enabled on the weekly review with every area done",
    );

    // ── the cadence's rules, read and written from the page ────────────────
    assert.match(
      String(report.checks.rules.skillValue),
      /Keep it to a page\./,
      "the rules panel did not show the cadence's rules",
    );
    assert.equal(report.checks.skillWrites.length, 1, "the rules were not written exactly once");
    assert.match(
      report.checks.skillWrites[0]!,
      /Always ask about sleep\./,
      "the rules write did not carry what the operator wrote",
    );

    // ── Preview is the whole file, and no longer a domains list ────────────
    assert.equal(report.checks.preview.previewShown, true, "the preview mode drew no preview");
    assert.equal(report.checks.preview.boxes, 0, "the preview mode left the editor on the page");
    assert.match(
      report.checks.previewText,
      /A note outside the skeleton\./,
      "the preview dropped a section the operator wrote",
    );
    assert.match(
      report.checks.previewText,
      /alpha beta gamma/,
      "the preview dropped the heading the operator wrote",
    );
    assert.match(
      report.checks.previewText,
      /Relationships/,
      "the preview dropped an area section the checklist maps",
    );
    assert.equal(
      report.checks.previewText.includes("lifequest:snapshot"),
      false,
      "the preview printed the snapshot marker",
    );
    assert.equal(
      report.checks.previewText.includes("Not started"),
      false,
      "the preview still draws the old domains/status list",
    );

    // ── the life review is the summary, and marking it complete locks ──────
    const lifeStart = report.checks.lifeStart;
    assert.equal(lifeStart.scope, "overall", "the Life review row started another scope");
    assert.match(lifeStart.kickoff, /whole-life review/, "the life-review kickoff is not the whole-life one");
    assert.match(lifeStart.kickoff, /area/, "the life-review kickoff does not speak about the areas");
    assert.equal(
      report.checks.lifeStarted.lifeStatus,
      "In progress",
      "the Life review does not read In progress while it is being worked",
    );
    assert.equal(
      report.checks.lifeStarted.scopeName,
      "Life",
      "the life review left the scope line on another scope",
    );
    assert.equal(
      report.checks.lifeStarted.markDoneLabel,
      "Mark life review complete",
      "the life review's mark-done button is not its form",
    );
    const locked = report.checks.locked;
    assert.equal(locked.lockedBadge, "Locked", "the locked review does not show its Locked badge");
    assert.equal(locked.status, "Locked", "the page's status line is not Locked");
    assert.equal(railText(locked, "overall"), "Done", "the Life row does not read Done after completion");
    for (const area of [...AREAS, { slug: "overall", name: "Life" }]) {
      const item = railItem(locked, area.slug);
      assert.equal(
        item !== null && item.disabled,
        true,
        `the ${area.name} row is still pressable on a locked review`,
      );
    }
    assert.equal(locked.unlockPresent, true, "the locked review offers no way to unlock it");
    assert.equal(
      report.checks.lockedScopes.overall?.status,
      "done",
      "the review file's overall scope was not marked done",
    );
    // The lock is on the FILE, not only on the badge: a write attempted through
    // the bridge is refused, and the body does not move.
    assert.equal(report.checks.refusedWrite, true, "a write to the locked review was accepted");
    assert.equal(
      report.checks.lockedBody.includes("tampered after lock"),
      false,
      "the refused write reached the locked review file",
    );
    for (const area of AREAS) {
      assert.equal(
        report.checks.lockedBody.split(`\n## ${area.name}\n`).length - 1,
        1,
        `the locked review holds a duplicate ${area.name} section`,
      );
    }
    assert.equal(
      report.checks.lockedBody.split("<!-- lifequest:snapshot:finance-spend -->").length - 1,
      1,
      "the lock changed the snapshot block",
    );

    // ── every start, one kickoff, and nothing unexpected ───────────────────
    assert.deepEqual(
      report.checks.scopeSequence,
      [
        "weekly:financial",
        "weekly:mind",
        "weekly:business",
        "weekly:relationships",
        "daily:overall",
        "weekly:overall",
      ],
      "the page did not start one scope per row, the general day, then the whole life",
    );
    assert.equal(
      report.checks.kickoffsMatched,
      report.checks.startsAll.length,
      "a start reached the page but not the dock",
    );
    assert.equal(
      report.checks.failedFinanceStarts,
      2,
      "the agent-down finance press and its retry are not both in the bridge calls",
    );
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    // ── the artifacts ──────────────────────────────────────────────────────
    assert.equal(report.checks.openedRail.rows.length, RAIL_ROWS.length);
    for (const shot of SHOTS) {
      assert.equal(fs.existsSync(shot), true, `driver captured no screenshot ${shot}`);
      // A picture of nothing is not evidence: the captures are real windows.
      assert.ok(fs.statSync(shot).size > 10_000, `screenshot ${path.basename(shot)} is suspiciously small`);
    }
  });
});
