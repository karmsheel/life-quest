import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The layout-spacing rig: the real shell and all fifteen real pages, in a real
 * Electron window, measured with the real layout engine.
 *
 * The operator's three visual changes are the claims, and each is measured:
 *
 *   1. Page left/right padding is 32px (2rem) on every one of the fifteen
 *      boards — `.shell__content` computed padding-left and padding-right. The
 *      chat bar's own composer gutter is reported as an informational number
 *      only; the operator explicitly chose the roomier 32px over matching it.
 *   2. Cards and blocks have more room: the main card container's computed
 *      `row-gap`/`column-gap` is 20px (`--space-board-gap`, 1.25rem) where the
 *      CSS converts it, and two sibling cards measure ~20px apart on the card
 *      grids. Compact rows (task columns, schedule rows) are intentionally
 *      tighter, so the generic floor there is 12px; ruled list rows (Data,
 *      Pages, Projects, Ideal State history) draw hairline separators rather
 *      than a gap and are reported without a gap claim.
 *   3. On Task Manager (`/act`) the add-task textbox+button's right edge equals
 *      the last kanban column's right edge within 1px, driven at 2000x900 and
 *      2400x900 where the board fits its sheet; at 1280x800 the board
 *      legitimately scrolls and that state is reported, not failed. The
 *      chat-closed state is measured at the standard 1440x900 sheet too.
 *
 * This suite asserts the STRUCTURAL claims plus those named design values; the
 * report carries the raw numbers so the Lead can read the fix against the
 * baseline. It also asserts that each route rendered its real page root with
 * real cards, that every route wrote a measured object and a screenshot over
 * 10 KB, that the screenshots are the shipped LIGHT day theme, and that the
 * report is fresh (it is deleted before the driver runs).
 *
 * Every way this could fail, and how the suite names it:
 *
 *  - the dev server is down, so the rig would "pass" by measuring nothing: the
 *    suite skips loudly instead, and a skipped rig is evidence of nothing;
 *  - `dist-electron/main.js` is missing, so the bench never built the e2e seam:
 *    the suite fails with the wrapper's name in the message;
 *  - a stale artifact is read as this run's result: the report and every
 *    screenshot are deleted first, and `generatedAt`/mtime must be newer than
 *    the run's start;
 *  - a page never commits, or commits to a different route than the driver
 *    asked for: `committedRoute` must equal the route;
 *  - a page root exists but is empty (its data never landed): every route's
 *    recorded card count is asserted against the expected minimum;
 *  - a page renders a *different* page's cards: the driver reads the page's own
 *    root selector inside `.shell__content` and the suite asserts that root
 *    exists with a non-zero box;
 *  - the page padding is not 32px: asserted per route, each side;
 *  - a container sets a 20px gap the layout ignores: the report carries both
 *    the computed gap and the measured sibling distance, and the suite requires
 *    a 20px gap and (on card grids) a ~20px first pair;
 *  - a board falls back to tight spacing: every measured non-ruled gap must be
 *    at least 12px;
 *  - the chat dock never drew a panel, so the gutter is unmeasurable: the suite
 *    fails rather than reading a zero;
 *  - the dock never collapsed, so "chat closed" is really "chat open": the
 *    driver asserts the shell's own `shell--chat-collapsed` class and a null
 *    composer rect before it reports the closed state, and the suite asserts
 *    those fields;
 *  - the Task Manager is judged on a sheet where alignment cannot hold: the
 *    judged sizes require a non-scrolled board, and the narrow size is reported
 *    only;
 *  - the screenshots are blank, missing, or a mock: every PNG's byte size is
 *    asserted over 10 KB and matched against the report;
 *  - the screenshots are dark while the operator runs light: the report's mode,
 *    theme and skin are asserted;
 *  - a page logged an error, a promise rejected unhandled, or the console
 *    logged one: the harness collects `window.onerror` (with the stack) and
 *    unhandled rejections on every route, the driver collects console errors,
 *    and both must be empty.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `/root/.local/bin/lifequest-e2e <checkout> tests/layout-spacing-e2e.test.ts`
 * puts this checkout on the bench and restores the previous one afterwards.
 *
 * The artifact is `e2e/artifacts/layout-spacing.json` plus one PNG per route,
 * three Task Manager sheet sizes, and the closed-dock state: same command, same
 * claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = Number(process.env.LIFEQUEST_DEV_PORT ?? 5173);
const REPORT = path.join(desktopRoot, "e2e/artifacts/layout-spacing.json");
const DRIVER = path.join(desktopRoot, "e2e/layout-spacing.electron.mjs");
const MIN_SCREENSHOT_BYTES = 10 * 1024;

const PAGE_PADDING = 32;
const CARD_GAP = 20;
const MIN_CARD_GAP = 12;
const GAP_TOLERANCE = 0.5;
const ALIGN_TOLERANCE = 1;

/** The fifteen boards, the real content each must draw, and its spacing kind. */
const ROUTES = [
  { route: "/home", slug: "home", minCards: 5, spacing: "cards" },
  { route: "/data", slug: "data", minCards: 2, spacing: "ruled" },
  { route: "/pages", slug: "pages", minCards: 2, spacing: "ruled" },
  { route: "/documents", slug: "documents", minCards: 2, spacing: "cards" },
  { route: "/personnel", slug: "personnel", minCards: 2, spacing: "compact" },
  { route: "/images", slug: "images", minCards: 2, spacing: "cards" },
  { route: "/dream", slug: "dream", minCards: 2, spacing: "cards" },
  { route: "/vision", slug: "vision", minCards: 2, spacing: "cards" },
  { route: "/ideal-state", slug: "ideal-state", minCards: 2, spacing: "ruled" },
  { route: "/goals", slug: "goals", minCards: 2, spacing: "cards" },
  { route: "/chart", slug: "chart", minCards: 2, spacing: "compact" },
  { route: "/track", slug: "track", minCards: 2, spacing: "cards" },
  { route: "/projects", slug: "projects", minCards: 2, spacing: "ruled" },
  { route: "/daily", slug: "daily", minCards: 2, spacing: "compact" },
  { route: "/act", slug: "act", minCards: 6, spacing: "compact" },
];

/** The Task Manager sheets the alignment is judged at. */
const ACT_SIZES = ["2000x900", "2400x900", "1280x800"];

const EXPECTED_SCREENSHOTS = [
  ...ROUTES.map((spec) =>
    path.join(desktopRoot, `e2e/artifacts/layout-spacing-${spec.slug}.png`),
  ),
  ...ACT_SIZES.map((size) =>
    path.join(desktopRoot, `e2e/artifacts/layout-spacing-act-${size}.png`),
  ),
  path.join(desktopRoot, "e2e/artifacts/layout-spacing-act-chat-closed.png"),
];

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type FirstPair = {
  horizontal: number | null;
  vertical: number | null;
  sameRow: boolean;
};

type GapSummary = {
  horizontal: number | null;
  vertical: number | null;
  rows: number;
  firstPair: FirstPair | null;
  firstRects: Rect[];
};

type ContainerRecord = {
  index: number;
  label: string | null;
  cardCount: number;
  computed: {
    display: string | null;
    gridTemplateColumns: string | null;
    flexDirection: string | null;
    rowGap: string | null;
    columnGap: string | null;
    gap: string | null;
  };
  gaps: GapSummary;
  cards: { label: string | null; rect: Rect }[];
};

type ChatRecord = {
  open: boolean;
  collapsed: boolean;
  panel: Rect | null;
  composerBand: Rect | null;
  composerBox: Rect | null;
  gutterLeft: number | null;
  gutterRight: number | null;
  bandGutterLeft: number | null;
  bandGutterRight: number | null;
};

type ActRecord = {
  head: Rect | null;
  form: Rect | null;
  input: Rect | null;
  button: Rect | null;
  union: Rect | null;
  viewport: Rect | null;
  viewportScroll: {
    scrollWidth: number;
    clientWidth: number;
    scrollLeft: number;
    maxScrollLeft: number;
    horizontallyScrolled: boolean;
  } | null;
  columns: Rect | null;
  columnCount: number;
  columnRects: { index: number; id: string | null; rect: Rect }[];
  deltas: {
    formRightMinusLastColumnRight: number | null;
    formRightMinusColumnsRight: number | null;
    formRightMinusViewportRight: number | null;
    lastColumnRightMinusViewportRight: number | null;
    formLeftMinusHeadLeft: number | null;
  };
};

type ContentRecord = {
  rect: Rect;
  padding: { left: number; right: number; top: number; bottom: number };
  clientWidth: number;
  scrollWidth: number;
  className: string;
};

type PageRootRecord =
  | {
      found: boolean;
      selector: string;
      label: string | null;
      rect: Rect | null;
      insetLeft: number | null;
      insetRight: number | null;
    }
  | { found: false; selector: string };

type SpacingCheck = {
  kind: "cards" | "compact" | "ruled";
  measuredGaps: number[];
  gapsBelowFloor: number[];
  twentyPx: { found: boolean; value: number | null; candidates: number[] };
  firstCardPair: { container: string | null; value: number } | null;
};

type RouteRecord = {
  route: string;
  slug: string;
  committedRoute: string | null;
  title: string;
  skin: string | null;
  mode: string | null;
  theme: string | null;
  content: ContentRecord | null;
  pageRoot: PageRootRecord;
  pageRootChildren: {
    count: number;
    computed: { rowGap: string | null; columnGap: string | null };
    gaps: GapSummary;
  };
  containers: ContainerRecord[];
  totalCards: number;
  mainContainer: {
    found: boolean;
    selector: string;
    label: string | null;
    cardCount: number;
    computed: ContainerRecord["computed"];
    gaps: GapSummary;
  };
  chat: ChatRecord;
  tokens: {
    spaceBoardGap: string | null;
    densityPadPageX: string | null;
    composerGutter: string | null;
    chatColumn: string | null;
  };
  act: ActRecord | null;
  actChatClosed?: ActRecord | null;
  chatChatClosed?: ChatRecord;
  spacingCheck: SpacingCheck;
  calls: string[];
  errors: string[];
  screenshot: { file: string; bytes: number };
};

type SizeEntry = {
  size: string;
  width: number;
  height: number;
  assertAlignment: boolean;
  content: ContentRecord | null;
  pageRoot: PageRootRecord;
  act: ActRecord | null;
  chat: ChatRecord;
  screenshot: { file: string; bytes: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  generatedAt: string;
  mode: string;
  targets: {
    pagePadding: number;
    cardGap: number;
    minCardGap: number;
    alignTolerance: number;
    boardGapToken: string;
  };
  routes: Record<string, RouteRecord>;
  chatGutter: ChatRecord | null;
  taskManager: {
    standard: { chatOpen: ActRecord | null; chatClosed: ActRecord | null };
    chatClosed: ActRecord | null;
    sizes: SizeEntry[];
    collapseMethod: string;
    chatOpenDeltas: ActRecord["deltas"] | null;
    chatClosedDeltas: ActRecord["deltas"] | null;
    screenshotClosed: { file: string; bytes: number };
  } | null;
  screenshots: { route: string; state?: string; file: string; bytes: number }[];
  consoleErrors: string[];
  harnessErrors: string[];
};

/** The suite needs the Vite dev server; with it down the test skips. */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          exitCode: error ? (error.code as number) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const near = (value: unknown, target: number, tolerance = GAP_TOLERANCE) =>
  isFiniteNumber(value) && Math.abs(value - target) <= tolerance;

const byteSize = (file: string): number => fs.statSync(file).size;

describe("layout spacing (page gutter, card rhythm, Task Manager alignment)", () => {
  it("measures all fifteen boards against the locked design targets", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`lifequest-e2e\` to include this e2e`,
      );
      return;
    }

    assert.equal(
      fs.existsSync(path.join(desktopRoot, "dist-electron/main.js")),
      true,
      "no dist-electron/main.js — run this rig through `lifequest-e2e`, which builds the e2e seam",
    );

    // A stale artifact is evidence of nothing: this run must write every file.
    fs.rmSync(REPORT, { force: true });
    for (const file of EXPECTED_SCREENSHOTS) fs.rmSync(file, { force: true });

    const startedAt = Date.now();
    const driverRun = await runDriver();
    const exitCode = driverRun.exitCode;
    if (!fs.existsSync(REPORT)) {
      // The child's own logs are the only witness a missing artifact leaves.
      t.diagnostic(`driver stdout:\n${driverRun.stdout}`);
      t.diagnostic(`driver stderr:\n${driverRun.stderr}`);
    }

    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact",
    );
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // Freshness: the report and its pictures are this run's, not a leftover's.
    assert.ok(
      Date.parse(report.generatedAt) >= startedAt - 2_000,
      `report generatedAt ${report.generatedAt} predates this run`,
    );
    assert.ok(
      fs.statSync(REPORT).mtimeMs >= startedAt - 2_000,
      "report file mtime predates this run",
    );

    // The handover screenshots must show the shipped light day theme.
    assert.equal(report.mode, "light", `the driver ran in ${report.mode} mode`);

    // ── Every route rendered its real page root with real cards ────────────
    const measuredRoutes = Object.keys(report.routes ?? {}).sort();
    assert.deepEqual(
      measuredRoutes,
      ROUTES.map((spec) => spec.route).sort(),
      "the report does not carry all fifteen routes",
    );

    for (const spec of ROUTES) {
      const record = report.routes[spec.route];
      assert.ok(record, `${spec.route} has no measured object`);

      assert.equal(
        record.committedRoute,
        spec.route,
        `${spec.route} committed a different route`,
      );
      assert.equal(
        record.pageRoot.found,
        true,
        `${spec.route} did not render its page root (${record.pageRoot.selector})`,
      );
      const rootRect = (record.pageRoot as { rect: Rect | null }).rect;
      assert.ok(
        rootRect !== null && rootRect.width > 0 && rootRect.height > 0,
        `${spec.route} page root has no box`,
      );
      assert.ok(
        record.totalCards >= spec.minCards,
        `${spec.route} drew ${record.totalCards} cards, wanted at least ${spec.minCards}`,
      );

      // Design target 1: the page's side padding is 32px on every board.
      assert.equal(
        record.content !== null,
        true,
        `${spec.route} has no content measurement`,
      );
      assert.ok(
        near(record.content?.padding.left, PAGE_PADDING),
        `${spec.route} padding-left ${record.content?.padding.left} (want ${PAGE_PADDING})`,
      );
      assert.ok(
        near(record.content?.padding.right, PAGE_PADDING),
        `${spec.route} padding-right ${record.content?.padding.right} (want ${PAGE_PADDING})`,
      );
      assert.ok(
        near(
          (record.pageRoot as { insetLeft: number | null }).insetLeft,
          0,
          1,
        ),
        `${spec.route} page root does not start on the padded content box ` +
          `(insetLeft ${(record.pageRoot as { insetLeft: number | null }).insetLeft})`,
      );
      assert.equal(
        record.tokens.spaceBoardGap,
        report.targets.boardGapToken,
        `${spec.route} does not read --space-board-gap as ${report.targets.boardGapToken}`,
      );
      assert.equal(
        record.mode,
        "light",
        `${spec.route} was painted in ${record.mode} mode`,
      );
      assert.equal(
        record.theme,
        "light",
        `${spec.route} did not carry data-theme="light"`,
      );

      // Design target 2: the card rhythm.
      assert.ok(
        record.spacingCheck?.twentyPx?.found,
        `${spec.route} has no computed or measured ${CARD_GAP}px gap ` +
          `(candidates ${JSON.stringify(record.spacingCheck?.twentyPx?.candidates)})`,
      );
      if (spec.spacing !== "ruled") {
        assert.deepEqual(
          record.spacingCheck.gapsBelowFloor,
          [],
          `${spec.route} has a card gap below ${MIN_CARD_GAP}px`,
        );
      }
      if (spec.spacing === "cards" && record.spacingCheck.firstCardPair) {
        assert.ok(
          Math.abs(record.spacingCheck.firstCardPair.value - CARD_GAP) <= 1,
          `${spec.route} first sibling cards are ` +
            `${record.spacingCheck.firstCardPair.value}px apart (want ~${CARD_GAP})`,
        );
      }

      for (const message of record.errors ?? []) {
        assert.fail(`${spec.route} logged an error: ${message}`);
      }

      const shot = record.screenshot;
      assert.equal(
        fs.existsSync(shot.file),
        true,
        `driver wrote no screenshot ${shot.file}`,
      );
      const size = byteSize(shot.file);
      assert.ok(
        size > MIN_SCREENSHOT_BYTES,
        `${shot.file} is ${size} bytes, wanted over ${MIN_SCREENSHOT_BYTES}`,
      );
      assert.equal(
        size,
        shot.bytes,
        `${shot.file} does not match the report's byte count`,
      );
    }

    // The map is a page like the rest: its padding is the same 32px.
    assert.ok(
      near(report.routes["/chart"]?.content?.padding.left, PAGE_PADDING) &&
        near(report.routes["/chart"]?.content?.padding.right, PAGE_PADDING),
      `the Life Map kept a full-bleed box: ${JSON.stringify(report.routes["/chart"]?.content?.padding)}`,
    );

    // ── The chat bar's gutter: informational, not an equality claim ────────
    const chat = report.chatGutter;
    assert.ok(chat, "the report has no chat gutter measurement");
    assert.equal(chat.open, true, "the dock was not open on the gutter route");
    assert.ok(chat.panel !== null, "no .chat-panel rect");
    assert.ok(chat.composerBox !== null, "no composer box rect");
    assert.ok(
      isFiniteNumber(chat.gutterLeft) && isFiniteNumber(chat.gutterRight),
      `chat gutter is not a number (${JSON.stringify(chat)})`,
    );

    // ── Task Manager alignment, at the sizes the board fits ────────────────
    const taskManager = report.taskManager;
    assert.ok(taskManager, "the report has no Task Manager measurement");
    assert.equal(
      taskManager.sizes.length,
      ACT_SIZES.length,
      "the Task Manager was not measured at every sheet size",
    );
    assert.deepEqual(
      taskManager.sizes.map((entry) => entry.size),
      ACT_SIZES,
      "the Task Manager sheet sizes moved",
    );
    for (const entry of taskManager.sizes) {
      assert.equal(
        entry.act !== null,
        true,
        `/act ${entry.size} has no measurement`,
      );
      assert.equal(
        entry.act?.columnCount,
        6,
        `/act ${entry.size} does not draw six columns`,
      );
      assert.ok(
        entry.act?.form !== null &&
          entry.act?.union !== null &&
          entry.act?.input !== null &&
          entry.act?.button !== null,
        `/act ${entry.size}: the add-task form, input or button has no rect`,
      );
      assert.ok(
        isFiniteNumber(entry.act?.viewportScroll?.scrollWidth) &&
          isFiniteNumber(entry.act?.viewportScroll?.clientWidth),
        `/act ${entry.size}: the board viewport has no scroll numbers`,
      );
      assert.ok(
        isFiniteNumber(entry.act?.deltas.formRightMinusLastColumnRight),
        `/act ${entry.size}: the form-to-last-column delta is not a number`,
      );
      assert.equal(
        fs.existsSync(entry.screenshot.file),
        true,
        `/act ${entry.size}: driver wrote no screenshot`,
      );
      assert.ok(
        byteSize(entry.screenshot.file) > MIN_SCREENSHOT_BYTES,
        `/act ${entry.size}: screenshot is too small to be the shipped board`,
      );

      if (entry.assertAlignment) {
        assert.ok(
          Math.abs(
            entry.act?.deltas.formRightMinusLastColumnRight as number,
          ) <= ALIGN_TOLERANCE,
          `/act ${entry.size}: the add-task form ends ` +
            `${entry.act?.deltas.formRightMinusLastColumnRight}px from the last column's right edge`,
        );
        assert.ok(
          (entry.act?.viewportScroll?.maxScrollLeft ?? 1) <= 1,
          `/act ${entry.size}: the board is horizontally scrolled ` +
            `(${entry.act?.viewportScroll?.scrollWidth}/${entry.act?.viewportScroll?.clientWidth}), so alignment cannot be judged`,
        );
      }
    }

    // The standard sheet, both dock states, and a real collapse.
    assert.ok(
      isFiniteNumber(taskManager.chatOpenDeltas?.formRightMinusLastColumnRight),
      "the chat-open form-to-last-column delta is not a number",
    );
    assert.ok(
      isFiniteNumber(taskManager.chatClosedDeltas?.formRightMinusLastColumnRight),
      "the chat-closed form-to-last-column delta is not a number",
    );
    assert.ok(
      ["real-control", "query-flag"].includes(taskManager.collapseMethod),
      `unexpected collapse method ${taskManager.collapseMethod}`,
    );
    const closedChat = report.routes["/act"]?.chatChatClosed;
    assert.ok(closedChat, "the report has no /act chat-closed measurement");
    assert.equal(closedChat.collapsed, true, "the dock did not collapse on /act");
    assert.equal(closedChat.open, false, "the dock still reports itself open");
    assert.equal(
      closedChat.composerBox,
      null,
      "a collapsed dock still drew a composer box",
    );

    // ── Nothing threw, anywhere ────────────────────────────────────────────
    assert.deepEqual(report.harnessErrors, [], "a page logged an error");
    assert.deepEqual(report.consoleErrors, [], "the window logged a console error");

    assert.equal(
      report.screenshots.length,
      EXPECTED_SCREENSHOTS.length,
      "the run did not write every screenshot",
    );
    for (const shot of report.screenshots ?? []) {
      assert.equal(
        fs.existsSync(shot.file),
        true,
        `driver reported a screenshot that does not exist: ${shot.file}`,
      );
      assert.ok(
        byteSize(shot.file) > MIN_SCREENSHOT_BYTES,
        `${shot.file} is too small to be a picture of the shipped UI`,
      );
    }
  });
});
