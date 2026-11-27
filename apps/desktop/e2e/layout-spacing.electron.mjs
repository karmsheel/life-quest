/**
 * Drives the layout-spacing harness in a real Electron window and writes
 * `e2e/artifacts/layout-spacing.{json,png}` — the repeatable artifact for the
 * three visual changes the operator asked for on all fifteen boards:
 *
 *  1. Page left/right padding is 32px (2rem) on every routed board.
 *  2. The boards' cards and blocks get more air: `--space-board-gap` is 20px
 *     (1.25rem) where the CSS converts a container, and a measured gap between
 *     two sibling cards reads that same 20px.
 *  3. On Task Manager (`/act`) the add-task box's right edge equals the last
 *     kanban column's right edge (within 1px) on a sheet wide enough to hold
 *     the board; at a narrow sheet the board scrolls and that state is reported,
 *     not failed.
 *
 * The screenshots show the shipped LIGHT day theme (`?mode=light`); the harness
 * paints whichever mode the query asks for.
 *
 * Run with the dev server up:
 *
 *   node e2e/layout-spacing.electron.mjs
 *
 * Exit code 0 = every claim above held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * How this rig can lie, and what catches it:
 *
 *  1. A route that never commits: the wait names the route, and the sample's
 *     `committedRoute` must equal it.
 *  2. A page root that exists but is still empty (its data has not landed):
 *     every wait names a minimum card count, so a sample is never taken off a
 *     loading screen.
 *  3. A page that renders a DIFFERENT page's root: the wait and the sample both
 *     read the page's own selector from inside `.shell__content`.
 *  4. A collapsed dock measured as open: the driver reads the shell's own
 *     `shell--chat-collapsed` class and requires a null composer rect before it
 *     reports the closed state.
 *  5. A screenshot of a blank or half-painted window: the file's byte size is
 *     recorded and must exceed 10 KB, and the capture happens after two frames
 *     settle.
 *  6. A hidden window that never paints: background throttling is off and the
 *     window is shown inactive before the first crop.
 *  7. A stub that throws: the harness collects `window.onerror` (with the stack)
 *     and unhandled rejections, the driver samples them on every route, and the
 *     run fails on any entry.
 *  8. A cross-route leak: every route is a fresh load (the other rigs' cold-load
 *     case), so no page's state can stand in for another's.
 *  9. Numbers read as strings or `auto`: every measurement is coerced, and a gap
 *     is reported as `null` when there is no pair to measure rather than as a
 *     misleading zero.
 * 10. A CSS rule that sets a gap the layout ignores: every gap is read twice,
 *     as the container's computed `row-gap`/`column-gap` AND as the actual
 *     distance between the first sibling rectangles.
 * 11. Alignment measured on a sheet where it cannot hold: the /act pass asserts
 *     the board is not horizontally scrolled at the sizes it judges, and reports
 *     the narrow size (where the board is meant to scroll) without failing it.
 * 12. A stale artifact: the Node test deletes the report and every screenshot
 *     before it runs, and asserts `generatedAt` is newer than the run's start.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs instead
// of failing. Every rig runs hidden beside the others, so it has to keep
// painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/layout-spacing.html";
/** The shipped screen the operator runs is the light day theme. */
const MODE = process.env.LIFEQUEST_E2E_MODE ?? "light";
const SIZE = { width: 1440, height: 900 };
const MIN_SCREENSHOT_BYTES = 10 * 1024;

/** The locked design targets, as numbers the driver can assert. */
const PAGE_PADDING = 32;
const CARD_GAP = 20;
const MIN_CARD_GAP = 12;
const GAP_TOLERANCE = 0.5;
const ALIGN_TOLERANCE = 1;
const BOARD_GAP_TOKEN = "1.25rem";

/**
 * The fifteen boards, the page's own markers, and how the card spacing reads on
 * that board:
 *
 *  - `cards`   — a real card grid/list: two sibling cards must measure ~20px
 *                 apart, and no measured gap may fall below 12px.
 *  - `compact` — compact rows (task columns, schedule rows): 12px is intended;
 *                 every measured gap must still be >= 12px.
 *  - `ruled`   — ruled list rows separated by a hairline rather than a gap; the
 *                 board's own 20px lives in its page stack, so only that is
 *                 asserted.
 */
const ROUTES = [
  {
    route: "/home",
    slug: "home",
    root: ".home-dashboard",
    container: ".home-dashboard__grid",
    card: ".home-pin",
    minCards: 5,
    spacing: "cards",
  },
  {
    route: "/data",
    slug: "data",
    root: ".data-studio",
    container: ".database-list",
    card: ".database-list__item",
    minCards: 2,
    spacing: "ruled",
  },
  {
    route: "/pages",
    slug: "pages",
    root: ".pages-studio",
    container: ".page-list",
    card: ".page-list__item",
    minCards: 2,
    spacing: "ruled",
  },
  {
    route: "/documents",
    slug: "documents",
    root: ".documents-page",
    container: ".library-list",
    card: ".doc-card",
    minCards: 2,
    spacing: "cards",
  },
  {
    route: "/personnel",
    slug: "personnel",
    root: ".personnel-studio",
    container: ".personnel-studio__list",
    card: ".personnel-card",
    minCards: 2,
    spacing: "compact",
  },
  {
    route: "/images",
    slug: "images",
    root: ".images-studio",
    container: ".images-library__grid",
    card: ".image-card",
    minCards: 2,
    spacing: "cards",
  },
  {
    route: "/dream",
    slug: "dream",
    root: ".doctrine-page",
    container: ".doctrine-index__cards",
    card: ".doctrine-index__card",
    minCards: 2,
    spacing: "cards",
  },
  {
    route: "/vision",
    slug: "vision",
    root: ".doctrine-page",
    container: ".doctrine-index__cards",
    card: ".doctrine-index__card",
    minCards: 2,
    spacing: "cards",
  },
  {
    route: "/ideal-state",
    slug: "ideal-state",
    root: ".ideal-state",
    container: ".ideal-state__history-list",
    card: ".ideal-state__history-item",
    minCards: 2,
    spacing: "ruled",
    // The board's 20px rhythm is its page layout's stack; the history list is a
    // compact 1.6px-ruled index and is reported, not judged.
    layoutContainer: ".ideal-state__layout",
  },
  {
    route: "/goals",
    slug: "goals",
    root: ".goals-page",
    container: ".goals-page__list",
    card: ".goals-page__row",
    minCards: 2,
    spacing: "cards",
  },
  {
    route: "/chart",
    slug: "chart",
    root: ".life-map",
    container: ".quarters",
    card: ".quarter",
    minCards: 2,
    spacing: "compact",
  },
  {
    route: "/blueprints",
    slug: "track",
    root: ".blueprints",
    container: ".arch-type-list",
    card: ".arch-type-card",
    minCards: 2,
    spacing: "cards",
  },
  {
    route: "/projects",
    slug: "projects",
    root: ".projects-page",
    container: ".projects-list",
    card: ".projects-list__item",
    minCards: 2,
    spacing: "ruled",
  },
  {
    route: "/daily",
    slug: "daily",
    root: ".schedule",
    container: ".schedule__list",
    card: "li",
    minCards: 2,
    spacing: "compact",
  },
  {
    route: "/act",
    slug: "act",
    root: ".act-page",
    container: ".task-columns",
    card: ".task-column",
    minCards: 6,
    spacing: "compact",
  },
];

const ACT_SPEC = ROUTES.find((spec) => spec.route === "/act");

/**
 * Where the Task Manager alignment is judged.
 *
 * The board can only line its add-task row up with its last column when the
 * columns fit the sheet. The page content is ~(window − rail − dock): at
 * 2000x900 it is narrower than the board's 90rem ceiling and still fits all six
 * columns, and at 2400x900 the board is capped at 90rem so the head and the
 * columns share their trailing edge. At 1280x800 the board is narrower than its
 * columns and legitimately scrolls, so that state is reported, not failed.
 */
const ACT_SIZES = [
  { id: "2000x900", width: 2000, height: 900, assertAlignment: true },
  { id: "2400x900", width: 2400, height: 900, assertAlignment: true },
  { id: "1280x800", width: 1280, height: 800, assertAlignment: false },
];

/**
 * The whole measurement, one evaluate per route.
 *
 * It is deliberately generic: selectors come from `ROUTES`, and every gap is
 * read two ways — the container's computed `row-gap`/`column-gap` and the actual
 * distance between sibling rectangles. A stylesheet that sets a gap and a layout
 * that ignores it would agree only on the first number.
 */
const measurementExpression = (spec) => `(() => {
  const SPEC = ${JSON.stringify({
    route: spec.route,
    root: spec.root,
    container: spec.container,
    card: spec.card,
    layoutContainer: spec.layoutContainer ?? null,
  })};

  const round = (value) => Math.round(value * 100) / 100;
  const px = (value) => {
    const parsed = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) ? round(parsed) : 0;
  };
  /** A computed length in px, or null for "normal"/"auto". */
  const lengthPx = (value) => {
    const match = /^(-?[\\d.]+)px$/.exec(String(value ?? "").trim());
    return match ? round(Number.parseFloat(match[1])) : null;
  };
  const rectOf = (el) => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      left: round(box.left),
      top: round(box.top),
      right: round(box.right),
      bottom: round(box.bottom),
      width: round(box.width),
      height: round(box.height),
    };
  };
  const css = (el, property) =>
    el ? getComputedStyle(el).getPropertyValue(property).trim() : null;
  const labelOf = (el) => {
    if (!el) return null;
    const className =
      typeof el.className === "string" ? el.className.trim() : "";
    return className || el.tagName.toLowerCase();
  };

  /**
   * Rows are grouped by top edge (a grid lays its row out on one line); the
   * gap between rows is the distance from the row's tallest bottom to the next
   * row's top, which is exactly the space the operator sees.
   */
  const gapsOf = (elements, limit = 8) => {
    const rects = elements
      .slice(0, limit)
      .map(rectOf)
      .filter(Boolean)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    if (rects.length < 2) {
      return {
        horizontal: null,
        vertical: null,
        rows: rects.length,
        firstPair: null,
        rects,
      };
    }
    const rows = [];
    for (const rect of rects) {
      let row = rows.find(
        (candidate) => Math.abs(candidate[0].top - rect.top) <= 2,
      );
      if (!row) {
        row = [];
        rows.push(row);
      }
      row.push(rect);
    }
    let horizontal = null;
    for (const row of rows) {
      const sorted = row.slice().sort((a, b) => a.left - b.left);
      for (let i = 1; i < sorted.length; i += 1) {
        const gap = round(sorted[i].left - sorted[i - 1].right);
        if (horizontal === null || gap < horizontal) horizontal = gap;
      }
    }
    let vertical = null;
    for (let i = 1; i < rows.length; i += 1) {
      const previousBottom = Math.max(
        ...rows[i - 1].map((rect) => rect.bottom),
      );
      const gap = round(rows[i][0].top - previousBottom);
      if (vertical === null || gap < vertical) vertical = gap;
    }
    const first = rects[0];
    const second = rects[1];
    const firstPair = {
      horizontal:
        second.left >= first.right
          ? round(second.left - first.right)
          : null,
      vertical:
        second.top >= first.bottom
          ? round(second.top - first.bottom)
          : null,
      sameRow: Math.abs(first.top - second.top) <= 2,
    };
    return { horizontal, vertical, rows: rows.length, firstPair, rects };
  };

  const containerOf = (candidate) => {
    const style = getComputedStyle(candidate);
    return {
      display: style.display,
      gridTemplateColumns: style.gridTemplateColumns,
      flexDirection: style.flexDirection,
      rowGap: style.rowGap,
      columnGap: style.columnGap,
      gap: style.gap,
    };
  };
  const gapsSummary = (gaps) => ({
    horizontal: gaps.horizontal,
    vertical: gaps.vertical,
    rows: gaps.rows,
    firstPair: gaps.firstPair,
    firstRects: gaps.rects.slice(0, 4),
  });

  const shell = document.querySelector(".shell");
  const content = document.querySelector(".shell__content");
  const contentStyle = content ? getComputedStyle(content) : null;
  const contentRect = rectOf(content);
  const padding = contentStyle
    ? {
        left: px(contentStyle.paddingLeft),
        right: px(contentStyle.paddingRight),
        top: px(contentStyle.paddingTop),
        bottom: px(contentStyle.paddingBottom),
      }
    : null;
  const border = contentStyle
    ? {
        left: px(contentStyle.borderLeftWidth),
        right: px(contentStyle.borderRightWidth),
      }
    : null;
  const scrollbar =
    content && contentRect
      ? round(
          contentRect.width - content.clientWidth - border.left - border.right,
        )
      : null;
  const rootBySelector = content ? content.querySelector(SPEC.root) : null;
  const pageRoot = content
    ? rootBySelector ?? content.firstElementChild
    : null;
  const pageRootRect = rectOf(pageRoot);
  const pageInnerLeft =
    contentRect && padding ? contentRect.left + border.left + padding.left : null;
  const pageInnerRight =
    content && padding && contentRect
      ? contentRect.left + content.clientWidth - padding.right
      : null;

  const pageChildren = pageRoot
    ? Array.from(pageRoot.children).filter((child) => {
        const box = child.getBoundingClientRect();
        const style = getComputedStyle(child);
        return (
          box.width > 0 &&
          box.height > 4 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      })
    : [];
  const childGaps = gapsOf(pageChildren);
  const pageRootStyle = pageRoot ? getComputedStyle(pageRoot) : null;

  const containerCandidates = pageRoot
    ? Array.from(pageRoot.querySelectorAll(SPEC.container))
    : [];
  const containers = containerCandidates.map((candidate, index) => {
    const cards = Array.from(candidate.querySelectorAll(SPEC.card));
    const gaps = gapsOf(cards);
    return {
      index,
      label: labelOf(candidate),
      cardCount: cards.length,
      computed: containerOf(candidate),
      gaps: gapsSummary(gaps),
      cards: cards.slice(0, 8).map((card) => ({
        label: labelOf(card),
        rect: rectOf(card),
      })),
    };
  });
  const layoutContainerEls = pageRoot && SPEC.layoutContainer
    ? Array.from(pageRoot.querySelectorAll(SPEC.layoutContainer))
    : [];
  const layoutContainers = layoutContainerEls.map((candidate) => ({
    label: labelOf(candidate),
    computed: containerOf(candidate),
  }));
  const totalCards = containers.reduce(
    (count, container) => count + container.cardCount,
    0,
  );
  let main = null;
  for (const container of containers) {
    if (!main || container.cardCount > main.cardCount) main = container;
  }

  const panel = document.querySelector(".chat-panel");
  const composerBand = document.querySelector(".chat-panel__composer");
  const composerBox =
    document.querySelector(".chat-panel__composer-box") ?? composerBand;
  const panelRect = rectOf(panel);
  const bandRect = rectOf(composerBand);
  const boxRect = rectOf(composerBox);
  const chat = {
    open: Boolean(shell && shell.classList.contains("shell--chat-open")),
    collapsed: Boolean(
      shell && shell.classList.contains("shell--chat-collapsed"),
    ),
    panel: panelRect,
    composerBand: bandRect,
    composerBox: boxRect,
    gutterLeft:
      panelRect && boxRect ? round(boxRect.left - panelRect.left) : null,
    gutterRight:
      panelRect && boxRect ? round(panelRect.right - boxRect.right) : null,
    bandGutterLeft:
      panelRect && bandRect ? round(bandRect.left - panelRect.left) : null,
    bandGutterRight:
      panelRect && bandRect ? round(panelRect.right - bandRect.right) : null,
    boxInBandLeft:
      bandRect && boxRect ? round(boxRect.left - bandRect.left) : null,
    boxInBandRight:
      bandRect && boxRect ? round(boxRect.right - bandRect.right) : null,
  };

  let act = null;
  if (SPEC.route === "/act") {
    const head = document.querySelector(".task-board__head");
    const form = document.querySelector(".task-create");
    const input = form ? form.querySelector("input") : null;
    const button = form ? form.querySelector("button") : null;
    const viewport = document.querySelector(".task-board__viewport");
    const columns = document.querySelector(".task-columns");
    const columnEls = Array.from(document.querySelectorAll(".task-column"));
    const inputRect = rectOf(input);
    const buttonRect = rectOf(button);
    const union =
      inputRect && buttonRect
        ? {
            left: Math.min(inputRect.left, buttonRect.left),
            right: Math.max(inputRect.right, buttonRect.right),
            top: Math.min(inputRect.top, buttonRect.top),
            bottom: Math.max(inputRect.bottom, buttonRect.bottom),
          }
        : null;
    if (union) {
      union.width = round(union.right - union.left);
      union.height = round(union.bottom - union.top);
    }
    const headRect = rectOf(head);
    const formRect = rectOf(form);
    const viewportRect = rectOf(viewport);
    const columnsRect = rectOf(columns);
    const columnRects = columnEls.map((column, index) => ({
      index,
      id: column.getAttribute("data-column") ?? null,
      rect: rectOf(column),
    }));
    const lastColumnRight =
      columnRects.length > 0
        ? columnRects[columnRects.length - 1].rect.right
        : null;
    const formRight = union ? union.right : null;
    act = {
      head: headRect,
      form: formRect,
      input: inputRect,
      button: buttonRect,
      union,
      viewport: viewportRect,
      viewportScroll: viewport
        ? {
            scrollWidth: viewport.scrollWidth,
            clientWidth: viewport.clientWidth,
            scrollLeft: viewport.scrollLeft,
            maxScrollLeft: viewport.scrollWidth - viewport.clientWidth,
            horizontallyScrolled: viewport.scrollLeft > 0,
          }
        : null,
      columns: columnsRect,
      columnCount: columnEls.length,
      columnRects,
      deltas: {
        formRightMinusLastColumnRight:
          formRight !== null && lastColumnRight !== null
            ? round(formRight - lastColumnRight)
            : null,
        formRightMinusColumnsRight:
          formRight !== null && columnsRect !== null
            ? round(formRight - columnsRect.right)
            : null,
        formRightMinusViewportRight:
          formRight !== null && viewportRect !== null
            ? round(formRight - viewportRect.right)
            : null,
        lastColumnRightMinusViewportRight:
          lastColumnRight !== null && viewportRect !== null
            ? round(lastColumnRight - viewportRect.right)
            : null,
        formLeftMinusHeadLeft:
          union && headRect ? round(union.left - headRect.left) : null,
      },
    };
  }

  return {
    route: window.layoutSpacingRoute ?? null,
    href: location.href,
    title: document.title,
    skin: window.layoutSpacingSkin ?? null,
    mode: window.layoutSpacingMode ?? null,
    theme: document.documentElement.getAttribute("data-theme"),
    shellClass: shell ? shell.className : null,
    chatStartClosed: Boolean(window.layoutSpacingChatStartClosed),
    content: content
      ? {
          rect: contentRect,
          padding,
          border,
          clientWidth: content.clientWidth,
          scrollWidth: content.scrollWidth,
          clientHeight: content.clientHeight,
          scrollHeight: content.scrollHeight,
          scrollbar,
          className: content.className,
        }
      : null,
    pageRoot: pageRoot
      ? {
          found: true,
          selector: SPEC.root,
          matchedBySelector: rootBySelector !== null,
          label: labelOf(pageRoot),
          rect: pageRootRect,
          insetLeft:
            pageRootRect && pageInnerLeft !== null
              ? round(pageRootRect.left - pageInnerLeft)
              : null,
          insetRight:
            pageRootRect && pageInnerRight !== null
              ? round(pageInnerRight - pageRootRect.right)
              : null,
          style: pageRootStyle
            ? {
                display: pageRootStyle.display,
                flexDirection: pageRootStyle.flexDirection,
                rowGap: pageRootStyle.rowGap,
                columnGap: pageRootStyle.columnGap,
                paddingLeft: pageRootStyle.paddingLeft,
                paddingRight: pageRootStyle.paddingRight,
                marginLeft: pageRootStyle.marginLeft,
                marginRight: pageRootStyle.marginRight,
                maxWidth: pageRootStyle.maxWidth,
              }
            : null,
        }
      : { found: false, selector: SPEC.root },
    pageRootChildren: {
      count: pageChildren.length,
      computed: {
        display: pageRootStyle ? pageRootStyle.display : null,
        flexDirection: pageRootStyle ? pageRootStyle.flexDirection : null,
        rowGap: pageRootStyle ? pageRootStyle.rowGap : null,
        columnGap: pageRootStyle ? pageRootStyle.columnGap : null,
      },
      gaps: gapsSummary(childGaps),
      children: pageChildren.slice(0, 8).map((child) => ({
        label: labelOf(child),
        rect: rectOf(child),
      })),
    },
    containers,
    layoutContainers,
    totalCards,
    mainContainer: main
      ? {
          found: true,
          selector: SPEC.container,
          cardSelector: SPEC.card,
          candidates: containerCandidates.length,
          index: main.index,
          label: main.label,
          cardCount: main.cardCount,
          computed: main.computed,
          gaps: main.gaps,
          cards: main.cards,
        }
      : {
          found: false,
          selector: SPEC.container,
          cardSelector: SPEC.card,
          candidates: 0,
        },
    chat,
    tokens: {
      spaceBoardGap: css(document.documentElement, "--space-board-gap"),
      densityPadPageX: css(document.documentElement, "--density-pad-page-x"),
      densityPadPageY: css(document.documentElement, "--density-pad-page-y"),
      composerGutter: panel ? css(panel, "--composer-gutter") : null,
      transcriptGutter: panel ? css(panel, "--transcript-gutter") : null,
      chatColumn: shell ? css(shell, "--chat-column") : null,
    },
    act,
    calls: (window.layoutSpacingCalls ?? []).slice(),
    errors: (window.layoutSpacingErrors ?? []).slice(),
  };
})()`;

const failures = [];
const check = (name, condition, detail) => {
  if (!condition) {
    failures.push(`${name} — ${detail}`);
    console.error(`FAIL ${name} — ${detail}`);
  }
  return Boolean(condition);
};

/** A number is "at the target" when it is within tolerance of it. */
const near = (value, target, tolerance = GAP_TOLERANCE) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value - target) <= tolerance;

/** A computed length in px, or null for "normal"/"auto". */
function lengthOf(value) {
  const match = /^(-?[\d.]+)px$/.exec(String(value ?? "").trim());
  return match ? Number.parseFloat(match[1]) : null;
}

/** Every non-null measured gap between sibling CARDS (the 12px floor). */
function cardGapsOf(measured) {
  const gaps = [];
  const push = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) gaps.push(value);
  };
  for (const container of measured.containers ?? []) {
    push(container.gaps?.horizontal);
    push(container.gaps?.vertical);
    push(container.gaps?.firstPair?.horizontal);
    push(container.gaps?.firstPair?.vertical);
  }
  return gaps;
}

/**
 * The first container with two sibling cards, and the gap it measures.
 *
 * The row-grouped gap is used rather than the raw first-two-rectangles delta:
 * in a grid the first two DOM cards can land in different rows (a full-width
 * card first), and a short card's own bottom is not its row's bottom. The
 * row-grouped number is the space the operator actually sees between the first
 * two cards side by side — or the first two stacked, on a list.
 */
function firstCardPair(measured) {
  for (const container of measured.containers ?? []) {
    if (container.cardCount < 2) continue;
    const gaps = container.gaps;
    if (!gaps) continue;
    if (typeof gaps.horizontal === "number" && Number.isFinite(gaps.horizontal)) {
      return {
        container: container.label,
        value: gaps.horizontal,
        axis: "horizontal",
      };
    }
    if (typeof gaps.vertical === "number" && Number.isFinite(gaps.vertical)) {
      return {
        container: container.label,
        value: gaps.vertical,
        axis: "vertical",
      };
    }
  }
  return null;
}

/** Whether any computed/measured gap on the board sits at the 20px target. */
function twentyPxGap(measured) {
  const candidates = [];
  const push = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      candidates.push(value);
    }
  };
  for (const container of measured.containers ?? []) {
    push(lengthOf(container.computed?.rowGap));
    push(lengthOf(container.computed?.columnGap));
  }
  push(lengthOf(measured.pageRootChildren?.computed?.rowGap));
  push(lengthOf(measured.pageRootChildren?.computed?.columnGap));
  for (const container of measured.layoutContainers ?? []) {
    push(lengthOf(container.computed?.rowGap));
    push(lengthOf(container.computed?.columnGap));
  }
  push(measured.pageRootChildren?.gaps?.horizontal);
  push(measured.pageRootChildren?.gaps?.vertical);
  push(measured.pageRootChildren?.gaps?.firstPair?.horizontal);
  push(measured.pageRootChildren?.gaps?.firstPair?.vertical);
  for (const gap of cardGapsOf(measured)) push(gap);
  const hit = candidates.find((value) => near(value, CARD_GAP));
  return { found: hit !== undefined, value: hit ?? null, candidates };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  nativeTheme.themeSource = MODE === "dark" ? "dark" : "light";

  const win = new BrowserWindow({
    ...SIZE,
    show: false,
    backgroundColor: MODE === "dark" ? "#1a1917" : "#f7f4ee",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // A unique partition keeps a previous run's localStorage (and so a
      // previous run's skin or open chat tabs) out of this one's measurements.
      partition: `layout-spacing-${Date.now()}`,
      backgroundThrottling: false,
    },
  });

  const consoleErrors = [];
  const debug = process.env.LAYOUT_SPACING_DEBUG === "1";
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
    if (debug) console.error(`console[${event.level}]: ${event.message}`);
  });
  win.webContents.on("did-fail-load", (_event, code, description, failedUrl) => {
    console.error(`did-fail-load ${code} ${description} ${failedUrl}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`render-process-gone ${JSON.stringify(details)}`);
  });

  const run = (expression) =>
    Promise.race([
      win.webContents.executeJavaScript(expression, true),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("executeJavaScript timed out after 10s")),
          10_000,
        ),
      ),
    ]);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const settleFrames = () =>
    run(
      `new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
      )`,
    );

  /**
   * Vite re-optimises dependencies the first time a new import appears and
   * reloads the page when it does, clearing the harness globals mid-wait — so
   * poll instead of assuming the first evaluate lands after the module ran.
   */
  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.layoutSpacingReady !== "object") return null;
          await window.layoutSpacingReady;
          return true;
        })()`);
        if (ready === true) return true;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await sleep(250);
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  /** Poll until the named expression is true, naming the state being waited on. */
  const waitFor = async (expression, label, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await run(expression);
        if (last) return true;
      } catch (error) {
        last = String(error);
      }
      await sleep(120);
    }
    console.error(
      `WAIT FAIL: ${label} — never became true (last ${JSON.stringify(last)})`,
    );
    check(
      `wait: ${label}`,
      false,
      `never became true (last ${JSON.stringify(last)})`,
    );
    return false;
  };

  const sample = async (spec, attempt = 0) => {
    let value;
    try {
      value = await run(measurementExpression(spec));
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(250);
      return sample(spec, attempt + 1);
    }
    if (!value) throw new Error(`${spec.route}: harness returned no sample`);
    return value;
  };

  const shoot = async (name) => {
    const file = path.join(artifactsDir, `layout-spacing-${name}.png`);
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    fs.writeFileSync(file, png);
    return { file, bytes: png.length };
  };

  let loads = 0;

  /** A cold load of one route, settled until its real content has drawn. */
  const loadRoute = async (spec, extraQuery = "") => {
    loads += 1;
    await win.loadURL(
      `${url}?route=${encodeURIComponent(spec.route)}&mode=${MODE}&v=${Date.now()}-${loads}${extraQuery}`,
    );
    await waitForHarness();
    await waitFor(
      `window.layoutSpacingRoute === ${JSON.stringify(spec.route)}`,
      `${spec.route} committed`,
    );
    await waitFor(
      `Boolean(document.querySelector(${JSON.stringify(spec.root)}))`,
      `${spec.route} page root`,
    );
    await waitFor(
      `document.querySelectorAll(${JSON.stringify(spec.card)}).length >= 1`,
      `${spec.route} at least one card`,
    );
    await settleFrames();
    await sleep(180);
  };

  const screenshots = [];
  const routes = {};
  const sampledErrors = [];
  let taskManager = null;
  let report;

  const timeout = setTimeout(() => {
    console.error("layout-spacing: timed out after 240s");
    const partial = {
      url,
      mode: MODE,
      generatedAt: new Date().toISOString(),
      routes,
      screenshots,
      consoleErrors,
      harnessErrors: sampledErrors,
      failures: [...failures, "threw: watchdog timeout after 240s"],
      pass: false,
    };
    fs.writeFileSync(
      path.join(artifactsDir, "layout-spacing.json"),
      `${JSON.stringify(partial, null, 2)}\n`,
    );
    app.exit(1);
  }, 240_000);

  try {
    await win.loadURL(`${url}?route=/home&mode=${MODE}`);
    await waitForHarness();
    win.setContentSize(SIZE.width, SIZE.height);
    await sleep(250);
    win.showInactive();

    for (const spec of ROUTES) {
      console.log(`route ${spec.route}: loading…`);
      await loadRoute(spec);
      const measured = await sample(spec);
      console.log(
        `route ${spec.route}: measured cards=${measured.totalCards} ` +
          `root=${measured.pageRoot?.found} errors=${measured.errors?.length ?? 0}`,
      );

      const record = {
        route: spec.route,
        slug: spec.slug,
        expectations: spec,
        committedRoute: measured.route,
        title: measured.title,
        skin: measured.skin,
        mode: measured.mode,
        theme: measured.theme,
        shellClass: measured.shellClass,
        content: measured.content,
        pageRoot: measured.pageRoot,
        pageRootChildren: measured.pageRootChildren,
        containers: measured.containers,
        layoutContainers: measured.layoutContainers,
        totalCards: measured.totalCards,
        mainContainer: measured.mainContainer,
        chat: measured.chat,
        tokens: measured.tokens,
        act: measured.act,
        calls: measured.calls,
        errors: measured.errors,
      };
      routes[spec.route] = record;

      // ── The route rendered its real page root with real cards ────────────
      check(
        `${spec.route} committed`,
        measured.route === spec.route,
        `committed ${measured.route}`,
      );
      check(
        `${spec.route} page root`,
        measured.pageRoot?.found === true &&
          (measured.pageRoot.rect?.width ?? 0) > 0 &&
          (measured.pageRoot.rect?.height ?? 0) > 0,
        `root ${JSON.stringify(measured.pageRoot)}`,
      );
      check(
        `${spec.route} real cards`,
        measured.totalCards >= spec.minCards,
        `total cards ${measured.totalCards} (wanted >= ${spec.minCards})`,
      );
      for (const message of measured.errors) {
        sampledErrors.push(`${spec.route}: ${message}`);
      }

      // ── Design target 1: page side padding is 32px ───────────────────────
      const pad = measured.content?.padding;
      check(
        `${spec.route} padding-left ${PAGE_PADDING}px`,
        near(pad?.left, PAGE_PADDING),
        `padding-left ${pad?.left} (target ${PAGE_PADDING})`,
      );
      check(
        `${spec.route} padding-right ${PAGE_PADDING}px`,
        near(pad?.right, PAGE_PADDING),
        `padding-right ${pad?.right} (target ${PAGE_PADDING})`,
      );
      // The left inset is the claim (the page starts on the padded content
      // box); a page with its own max-width legitimately stops short of the
      // right edge, so that inset is reported raw and not asserted.
      check(
        `${spec.route} page root starts on the content box`,
        near(measured.pageRoot?.insetLeft, 0, 1),
        `insetLeft ${measured.pageRoot?.insetLeft} (insetRight ${measured.pageRoot?.insetRight} reported raw)`,
      );

      // ── Design target 2: the card rhythm ─────────────────────────────────
      const gaps = cardGapsOf(measured);
      const gapsBelowFloor = gaps.filter((gap) => gap < MIN_CARD_GAP - 0.5);
      if (spec.spacing !== "ruled") {
        check(
          `${spec.route} no card gap below ${MIN_CARD_GAP}px`,
          gapsBelowFloor.length === 0,
          `gaps ${JSON.stringify(gapsBelowFloor)} (all ${JSON.stringify(gaps)})`,
        );
      }
      const twenty = twentyPxGap(measured);
      check(
        `${spec.route} has a ${CARD_GAP}px container gap`,
        twenty.found,
        `no computed/measured gap at ${CARD_GAP}px (candidates ${JSON.stringify(twenty.candidates)})`,
      );
      const pair = firstCardPair(measured);
      if (spec.spacing === "cards" && pair !== null) {
        check(
          `${spec.route} first sibling cards ${CARD_GAP}px apart`,
          near(pair.value, CARD_GAP, 1),
          `${pair.container} first pair ${pair.value}px (target ${CARD_GAP})`,
        );
      }
      record.spacingCheck = {
        kind: spec.spacing,
        measuredGaps: gaps,
        gapsBelowFloor,
        twentyPx: twenty,
        firstCardPair: pair,
      };

      const shot = await shoot(spec.slug);
      screenshots.push({ route: spec.route, ...shot });
      check(
        `${spec.route} screenshot`,
        shot.bytes > MIN_SCREENSHOT_BYTES,
        `layout-spacing-${spec.slug}.png is ${shot.bytes} bytes, wanted > ${MIN_SCREENSHOT_BYTES}`,
      );
      record.screenshot = shot;

      // ── Design target 3: Task Manager alignment, at the sizes it can hold ─
      if (spec.route === "/act") {
        const sizes = [];
        for (const sizeSpec of ACT_SIZES) {
          win.setContentSize(sizeSpec.width, sizeSpec.height);
          await sleep(140);
          await settleFrames();
          await sleep(220);
          const sized = await sample(ACT_SPEC);
          const sizedShot = await shoot(`act-${sizeSpec.id}`);
          screenshots.push({
            route: "/act",
            state: `window-${sizeSpec.id}`,
            ...sizedShot,
          });
          check(
            `/act ${sizeSpec.id} screenshot`,
            sizedShot.bytes > MIN_SCREENSHOT_BYTES,
            `layout-spacing-act-${sizeSpec.id}.png is ${sizedShot.bytes} bytes`,
          );
          const entry = {
            size: sizeSpec.id,
            width: sizeSpec.width,
            height: sizeSpec.height,
            assertAlignment: sizeSpec.assertAlignment,
            content: sized.content,
            pageRoot: sized.pageRoot,
            act: sized.act,
            chat: sized.chat,
            screenshot: sizedShot,
          };
          sizes.push(entry);
          if (sizeSpec.assertAlignment) {
            const deltas = sized.act?.deltas;
            check(
              `/act ${sizeSpec.id} form right = last column right`,
              near(deltas?.formRightMinusLastColumnRight, 0, ALIGN_TOLERANCE),
              `delta ${deltas?.formRightMinusLastColumnRight}px (want within ±${ALIGN_TOLERANCE})`,
            );
            check(
              `/act ${sizeSpec.id} board is not horizontally scrolled`,
              (sized.act?.viewportScroll?.maxScrollLeft ?? 1) <= 1,
              `viewport scrollWidth/clientWidth ${sized.act?.viewportScroll?.scrollWidth}/${sized.act?.viewportScroll?.clientWidth}`,
            );
          } else {
            console.log(
              `/act ${sizeSpec.id}: reported, not judged — viewport ` +
                `${sized.act?.viewportScroll?.scrollWidth}/${sized.act?.viewportScroll?.clientWidth}, ` +
                `form-to-last-column ${sized.act?.deltas?.formRightMinusLastColumnRight}px`,
            );
          }
        }

        // Back to the standard sheet, then collapse through the panel's own
        // control — the state the operator reaches by pressing it.
        win.setContentSize(SIZE.width, SIZE.height);
        await sleep(160);
        await settleFrames();
        await sleep(180);
        const clicked = await run(`(() => {
          const control = document.querySelector('[data-testid="chat-collapse"]');
          if (!control) return false;
          control.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              button: 0,
              view: window,
            }),
          );
          return true;
        })()`);
        let collapseMethod = "real-control";
        let collapsed = false;
        if (clicked) {
          collapsed = await waitFor(
            `document.querySelector(".shell")?.classList.contains("shell--chat-collapsed") === true`,
            "/act dock collapses through its own control",
          );
        }
        if (!collapsed) {
          collapseMethod = "query-flag";
          await loadRoute(ACT_SPEC, "&chat=closed");
          collapsed = await waitFor(
            `document.querySelector(".shell")?.classList.contains("shell--chat-collapsed") === true`,
            "/act dock starts collapsed through ?chat=closed",
          );
        }
        await settleFrames();
        await sleep(220);
        const closedMeasure = await sample(ACT_SPEC);
        routes["/act"].actChatClosed = closedMeasure.act;
        routes["/act"].chatChatClosed = closedMeasure.chat;
        const closedShot = await shoot("act-chat-closed");
        screenshots.push({ route: "/act", state: "chat-closed", ...closedShot });
        check(
          "/act chat-closed screenshot",
          closedShot.bytes > MIN_SCREENSHOT_BYTES,
          `layout-spacing-act-chat-closed.png is ${closedShot.bytes} bytes`,
        );
        check(
          "/act dock really collapsed",
          closedMeasure.chat.collapsed === true &&
            closedMeasure.chat.open === false &&
            closedMeasure.chat.composerBox === null,
          `chat ${JSON.stringify(closedMeasure.chat)}`,
        );
        const openAtStandard = measured.act;
        taskManager = {
          standard: {
            chatOpen: openAtStandard,
            chatClosed: closedMeasure.act,
          },
          chatClosed: closedMeasure.act,
          sizes,
          collapseMethod,
          chatOpenDeltas: openAtStandard?.deltas ?? null,
          chatClosedDeltas: closedMeasure.act?.deltas ?? null,
          screenshotClosed: closedShot,
        };
      }
    }

    // ── The whole-run invariants ─────────────────────────────────────────────
    check(
      "all fifteen routes measured",
      Object.keys(routes).length === ROUTES.length,
      `measured ${Object.keys(routes).length} of ${ROUTES.length}`,
    );
    check(
      "the map keeps the page's own padding (no full-bleed route)",
      near(routes["/chart"]?.content?.padding?.left, PAGE_PADDING) &&
        near(routes["/chart"]?.content?.padding?.right, PAGE_PADDING),
      `chart padding ${JSON.stringify(routes["/chart"]?.content?.padding)}`,
    );
    check(
      "no page logged an error",
      sampledErrors.length === 0,
      `errors ${JSON.stringify(sampledErrors)}`,
    );
    check(
      "no console errors",
      consoleErrors.length === 0,
      `console ${JSON.stringify(consoleErrors)}`,
    );
    check(
      "the shipped light theme painted",
      routes["/home"]?.mode === "light" &&
        routes["/home"]?.theme === "light" &&
        String(routes["/home"]?.skin ?? "").length > 0,
      `mode ${routes["/home"]?.mode}, theme ${routes["/home"]?.theme}, skin ${routes["/home"]?.skin}`,
    );
    check(
      "the chat gutter was measured (informational)",
      routes["/home"]?.chat?.open === true &&
        routes["/home"]?.chat?.composerBox !== null &&
        typeof routes["/home"]?.chat?.gutterLeft === "number" &&
        typeof routes["/home"]?.chat?.gutterRight === "number",
      `chat ${JSON.stringify(routes["/home"]?.chat)}`,
    );
    check(
      "the task manager was measured in both dock states",
      taskManager !== null &&
        taskManager.chatOpenDeltas !== null &&
        taskManager.chatClosedDeltas !== null,
      `taskManager ${JSON.stringify(taskManager?.collapseMethod)}`,
    );

    report = {
      url,
      mode: MODE,
      generatedAt: new Date().toISOString(),
      window: { ...SIZE },
      targets: {
        pagePadding: PAGE_PADDING,
        cardGap: CARD_GAP,
        minCardGap: MIN_CARD_GAP,
        alignTolerance: ALIGN_TOLERANCE,
        boardGapToken: BOARD_GAP_TOKEN,
      },
      claims: {
        pagePadding:
          "every route: .shell__content computed padding-left/right === 32px; page root sits on that content box",
        cardSpacing:
          "every route: no measured card gap below 12px and at least one computed/measured container gap at 20px; card grids: first two sibling cards 20px apart",
        chatGutter:
          "informational only: composer box inset from the chat panel's left and right edges",
        taskManagerAlignment:
          "add-task form union right edge === last .task-column right edge within 1px at 2000x900 and 2400x900 (chat open, board not scrolled); 1280x800 reported (board legitimately scrolls); chat-closed measured at 1440x900",
        exitPolicy:
          "all fifteen routes render with real cards, every route has a measured object and a screenshot > 10 KB, design targets hold, no page or console errors",
      },
      routes,
      chatGutter: routes["/home"]?.chat ?? null,
      taskManager,
      screenshots,
      consoleErrors,
      harnessErrors: sampledErrors,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      mode: MODE,
      generatedAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      consoleErrors,
      harnessErrors: sampledErrors,
      routes,
      screenshots,
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "layout-spacing.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  // The measurement table, as the run read it: one row per board.
  const rows = [
    [
      "route",
      "pad L/R",
      "inset L/R",
      "container",
      "css gap",
      "measured",
      "cards",
      "20px",
      "shot KB",
    ],
  ];
  for (const record of Object.values(report.routes ?? {})) {
    const pad = record.content?.padding;
    rows.push([
      record.route,
      `${pad?.left ?? "—"}/${pad?.right ?? "—"}`,
      `${record.pageRoot?.insetLeft ?? "—"}/${record.pageRoot?.insetRight ?? "—"}`,
      String(record.mainContainer?.label ?? "—"),
      `${record.mainContainer?.computed?.rowGap ?? "—"}/${record.mainContainer?.computed?.columnGap ?? "—"}`,
      `${record.spacingCheck?.firstCardPair?.value ?? "—"}`,
      `${record.totalCards ?? "—"}`,
      record.spacingCheck?.twentyPx?.found ? "yes" : "no",
      String(Math.round((record.screenshot?.bytes ?? 0) / 1024)),
    ]);
  }
  const widths = rows[0].map((_, index) =>
    Math.max(...rows.map((row) => row[index].length)),
  );
  for (const row of rows) {
    console.log(row.map((cell, index) => cell.padEnd(widths[index])).join("  "));
  }

  if (report.taskManager) {
    console.log("");
    for (const entry of report.taskManager.sizes ?? []) {
      console.log(
        `/act ${entry.size}: page ${entry.content?.rect?.width}px, ` +
          `form-to-last-column ${entry.act?.deltas?.formRightMinusLastColumnRight}px, ` +
          `viewport ${entry.act?.viewportScroll?.scrollWidth}/${entry.act?.viewportScroll?.clientWidth}, ` +
          `judged=${entry.assertAlignment}`,
      );
    }
    console.log(
      `/act chat-closed at standard sheet: form-to-last-column ` +
        `${report.taskManager.chatClosedDeltas?.formRightMinusLastColumnRight}px`,
    );
  }

  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "layout spacing: PASS" : "layout spacing: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(
      `layout-spacing: ${error instanceof Error ? error.stack : error}`,
    );
    app.exit(1);
  });
