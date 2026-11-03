import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { BUILTIN_SKIN_LIST, filterSkinsForMode } from "../src/lib/themes/presets.ts";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/shell-sidebar.json");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type State = {
  viewport: { width: number; height: number };
  tokens: {
    track: number;
    collapsedTrack: number;
    frame: number;
    titlebarHeight: number;
    radiusSm: string;
  };
  theme: {
    dataTheme: string | null;
    skin: string | null;
    canvasBase: string;
    titlebarBg: string;
    background: string;
    card: string;
    bgPanel: string;
    mutedSurface: string;
  };
  cards: Record<string, string>;
  dockActions: string | null;
  rail: {
    box: Box;
    marginTop: string;
    borderRightWidth: string;
    borderTopWidth: string;
    borderBottomWidth: string;
    borderLeftWidth: string;
    borderRadius: string;
    background: string;
    backdropFilter: string;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null;
  railDisplay: string | null;
  header: {
    box: Box;
    background: string;
    appRegion: string;
    controls: { tag: string; label: string | null }[];
  } | null;
  railToggle: {
    label: string | null;
    box: Box;
    ariaExpanded: string | null;
    ariaControls: string | null;
    /** The lucide icon class currently drawn in the toggle. */
    icon: string | null;
    appRegion: string;
  } | null;
  titlebarToggle: { label: string | null; box: Box } | null;
  titlebarClass: string | null;
  /** The shell's arrangement class, and the first grid track it laid out. */
  shellClass: string | null;
  shellNavCollapsed: boolean;
  firstLink: Box | null;
  vault: {
    box: Box;
    text: string;
    background: string;
    color: string;
    radius: string;
    href: string | null;
    appRegion: string;
  } | null;
  legacyBrand: boolean;
  leadingText: string;
  titlebarBackground: string | null;
  chats: {
    box: Box;
    display: string;
    inRail: boolean;
    title: string;
    newChat: boolean;
    scrollRegion: string;
  } | null;
  /** The divider directly above the chats section: a wide-rail fixture. */
  chatsDivider: { display: string; box: Box } | null;
  /** The rail's text labels, and the rows that carry them. */
  railLabels: { count: number; display: string | null };
  railRows: {
    title: string | null;
    ariaLabel: string | null;
    label: string;
    labelDisplay: string | null;
    icon: string | null;
    iconBox: Box | null;
    badge: boolean;
    justifyContent: string;
    box: Box;
  }[];
  wingSection: Box | null;
  bottomSection: Box | null;
  main: Box | null;
  mainBackground: string | null;
  topBar: {
    box: Box;
    borderBottomWidth: string;
    borderBottomColor: string;
    background: string;
  } | null;
  /**
   * The sheet's band now carries one selector, the domain lens. It is a
   * `.ui-segmented`, whose shared rule framed the whole control one pixel outside
   * the active tab's own line. The wing switcher moved to the rail, and is
   * measured separately below.
   */
  topBarSelectors: {
    selector: string;
    borderTopWidth: string;
    borderRightWidth: string;
    borderBottomWidth: string;
    borderLeftWidth: string;
    background: string;
    activeBorderWidth: string | null;
    activeBackground: string | null;
    optionCount: number;
  }[];
  /** How many `.ui-segmented` controls the sheet's band carries. */
  bandControlCount: number;
  /** The domain lens as the band lays it out, for the centring claim. */
  domainLens: { box: Box; labels: string[] } | null;
  /**
   * The rail's first level: the five-wing switcher and the band it sits in.
   * The band's own bottom border is measured because it must stay unpainted —
   * the hairline under the strip belongs to the sheet's top bar alone.
   */
  wingsBand: { box: Box; display: string; borderBottomWidth: string } | null;
  wingSwitcher: {
    box: Box;
    inRail: boolean;
    role: string | null;
    ariaLabel: string | null;
    labels: string[];
    active: string | null;
    optionCount: number;
    background: string;
  } | null;
  /** The active wing's rows, as the rail renders them under the switcher. */
  wingRows: { label: string | null; href: string | null; active: boolean }[];
  chatHeader: {
    box: Box;
    borderBottomWidth: string;
    borderBottomColor: string;
    background: string;
  } | null;
  sheet: {
    box: Box;
    borderRadius: string;
    borderTopWidth: string;
    borderRightWidth: string;
    borderBottomWidth: string;
    borderLeftWidth: string;
    background: string;
    boxShadow: string;
  } | null;
  corner: { insideRail: boolean; insideTitlebar: boolean } | null;
  /** The tray's tracks: the collapse narrows the first, it does not remove a pane. */
  shell: {
    className: string;
    gridTemplateColumns: string;
    gridColumns: number[];
    gap: string;
    box: Box;
  } | null;
  overflow: { scrollWidth: number; clientWidth: number };
};

type Ladder = {
  dataTheme: string | null;
  skin: string | null;
  tokens: State["theme"];
  surfaces: {
    chrome: string | null;
    titlebar: string | null;
    page: string | null;
    dock: string | null;
    dockActions: string | null;
    card: string | null;
    viewCard: string | null;
  };
  luminance: Record<keyof Ladder["surfaces"], number>;
};

/** One scroller as the driver measured it. */
type ScrollRegion = {
  selector: string;
  box: Box;
  gutterX: number;
  gutterY: number;
  overflowsY: boolean;
  hovered: boolean;
  barWidth: string | null;
  thumbBackground: string | null;
  thumbRadius: string | null;
  trackBackground: string | null;
};

/** The app's own scrollbar, on the two scrollers the driver measured. */
type ScrollChrome = {
  sheet: ScrollRegion;
  transcript: ScrollRegion;
  thumbToken: string;
  mutedForeground: string;
  accent: string;
  primary: string;
};

type Report = {
  pass: boolean;
  failures: string[];
  vaultName: string;
  tokens: State["tokens"];
  expanded: State;
  collapsed: State;
  restored: State;
  /** The rail switcher's own trip: Define, then back to Home. */
  wingSwitch: { defined: State; home: State };
  day: State;
  ladder: { night: Ladder; day: Ladder; skins: Record<string, Ladder> };
  /** Every native-titlebar hand-off the provider made, oldest first. */
  overlay: { color: string; symbolColor: string }[];
  scroll: {
    day: ScrollChrome;
    night: Record<string, ScrollChrome>;
    hover: {
      pointerOut: { sheet: string | null; transcript: string | null };
      overSheet: { sheet: string | null; transcript: string | null };
      overTranscript: { sheet: string | null; transcript: string | null };
      forcedByDebugger: boolean;
      forceError: string | null;
    };
    pseudoReadable: boolean;
  };
  reclaimedPx: number;
  screenshots: string[];
};

/** A colour's alpha from `rgb()`/`rgba()` or `color(srgb r g b / a)`. */
function alphaOf(value: string | null): number {
  const text = (value ?? "").trim();
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(text);
  const parts = (rgb ?? srgb)?.[1]
    .split(/[,/ ]+/)
    .filter(Boolean)
    .map(Number);
  if (!parts) return Number.NaN;
  return parts.length > 3 ? parts[3] : 1;
}

/**
 * The sidebar rig measures the real shell in a real Electron window, so it needs
 * the Vite dev server. With the server down the test skips; `npm run dev` in
 * another shell turns it on.
 */
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

/** Alpha of a computed `rgb()`/`rgba()` colour — an opaque `rgb()` is 1. */
function alpha(color: string): number {
  const rgba = /^rgba\(([^)]+)\)$/.exec(color);
  if (!rgba) return 1;
  const parts = rgba[1].split(",");
  return parts.length > 3 ? parseFloat(parts[3]) : 1;
}

/** The `rgb()` Chromium computes for a palette's `#rrggbb` fill. */
function computedHex(hex: string): string {
  const clean = hex.trim().replace(/^#/, "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/shell-sidebar.electron.mjs")],
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

describe("shell sidebar (docked rail)", () => {
  it("docks the rail flush to the window and narrows it to the icon column in place", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    // The driver's own failures first: a report that threw before the first
    // sample has no geometry to destructure, and the TypeError would hide the
    // step it broke on.
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    const { track, collapsedTrack, titlebarHeight } = report.tokens;

    // Restated here so the numbers are asserted by the suite, not only inside
    // the driver — and so a regression names the geometry it broke.
    const { expanded, collapsed, restored } = report;

    assert.ok(expanded.rail, "expanded shell rendered no .nav-rail");
    assert.equal(expanded.rail.box.left, 0, "rail kept a left inset");
    assert.equal(expanded.rail.box.top, 0, "rail kept a top inset");
    assert.equal(
      expanded.rail.box.bottom,
      expanded.viewport.height,
      "rail stopped short of the window bottom",
    );
    assert.equal(expanded.rail.box.width, track, "rail width left the track");
    assert.equal(expanded.rail.borderRadius, "0px", "rail kept a rounded corner");
    // The rail is a pane, not a card, and it draws exactly one line: the
    // rail|sheet seam on its trailing edge, inside its own box. Border widths
    // are read back in CSS px, which Chromium snaps to whole device px — on a
    // 125%-scaled display a 1px hairline computes as 0.8px — so the claim is
    // "greater than zero, at most 1". Its other three edges paint nothing: a line
    // there would box the sidebar in or double the seam.
    assert.ok(
      parseFloat(expanded.rail.borderRightWidth) > 0 &&
        parseFloat(expanded.rail.borderRightWidth) <= 1,
      `the rail lost the seam with the sheet (${expanded.rail.borderRightWidth})`,
    );
    for (const [side, width] of [
      ["top", expanded.rail.borderTopWidth],
      ["bottom", expanded.rail.borderBottomWidth],
      ["left", expanded.rail.borderLeftWidth],
    ] as const) {
      assert.equal(
        width,
        "0px",
        `rail grew a ${side} border (${width}) — only the trailing edge draws the rail|sheet seam`,
      );
    }
    assert.equal(
      expanded.tokens.collapsedTrack,
      56,
      `--shell-nav-width-collapsed resolved to ${expanded.tokens.collapsedTrack}px, not the 56px icon column`,
    );

    assert.ok(expanded.header, "rail rendered no topband");
    assert.equal(expanded.header.box.top, 0, "topband left the window edge");
    assert.equal(
      expanded.header.box.height,
      titlebarHeight,
      "topband is not the titlebar row's height",
    );
    assert.equal(
      expanded.header.controls.length,
      1,
      `topband holds ${expanded.header.controls.length} controls, expected one`,
    );
    assert.equal(
      expanded.railToggle?.label,
      "Collapse sidebar",
      "the single topband control is not the collapse toggle",
    );
    assert.equal(
      expanded.railToggle?.ariaExpanded,
      "true",
      `the rail's toggle reports aria-expanded=${JSON.stringify(expanded.railToggle?.ariaExpanded)} while the rail is wide`,
    );
    assert.equal(
      expanded.railToggle?.ariaControls,
      "nav-rail",
      "the rail's toggle does not name the rail it controls",
    );
    assert.match(
      expanded.railToggle?.icon ?? "",
      /lucide-panel-left-close/,
      `the wide rail's toggle is not the collapse icon (${JSON.stringify(expanded.railToggle?.icon)})`,
    );
    assert.ok(
      (expanded.railToggle?.box.right ?? 0) <= (expanded.rail?.box.right ?? 0),
      `the rail's toggle (${JSON.stringify(expanded.railToggle?.box)}) leaves the rail's box (${JSON.stringify(expanded.rail?.box)})`,
    );
    // The reported bug: a second toggle in the titlebar, over the vault chip.
    // There is no such element in the wide state either — the rail keeps its own.
    assert.equal(
      expanded.titlebarToggle,
      null,
      `a titlebar toggle exists while the rail is wide (${JSON.stringify(expanded.titlebarToggle)})`,
    );
    // The wide rail is the full column: its labels, the wing switcher's band and
    // the chats section are on screen. A thin-rail rule leaking into this state
    // would hide them while the geometry checks above still passed.
    assert.ok(
      expanded.railLabels.count > 0 && expanded.railLabels.display !== "none",
      `the wide rail has no text labels (${expanded.railLabels.count} labels, display ${JSON.stringify(expanded.railLabels.display)})`,
    );
    assert.notEqual(
      expanded.wingsBand?.display,
      "none",
      "the wide rail hid the wing switcher's band",
    );
    assert.notEqual(
      expanded.chats?.display,
      "none",
      "the wide rail hid the chats section",
    );
    assert.notEqual(
      expanded.chatsDivider?.display,
      "none",
      "the wide rail hid the divider above the chats section",
    );
    assert.ok(expanded.firstLink, "rail rendered no nav rows");
    assert.ok(
      expanded.firstLink.top >= expanded.header.box.bottom,
      "nav rows overlap the topband",
    );

    // The rail's first level: the five-wing switcher in a band of its own, above
    // the wing's rows and on the sheet's top-bar row. The band paints no line of
    // its own — the strip's hairline stays in the sheet, under the domain lens.
    assert.ok(expanded.wingSwitcher, "the rail rendered no wing switcher");
    assert.equal(
      expanded.wingSwitcher.inRail,
      true,
      "the wing switcher left the rail",
    );
    assert.equal(
      expanded.wingSwitcher.role,
      "tablist",
      `the wing switcher is not a tablist (${expanded.wingSwitcher.role})`,
    );
    assert.equal(
      expanded.wingSwitcher.optionCount,
      5,
      `the wing switcher rendered ${expanded.wingSwitcher.optionCount} options`,
    );
    assert.deepEqual(
      expanded.wingSwitcher.labels,
      ["Home", "Define", "Plan", "Act", "Review"],
      "the wing switcher is not the five wings in order",
    );
    assert.equal(
      expanded.wingSwitcher.active,
      "Home",
      `the active wing tab reads ${JSON.stringify(expanded.wingSwitcher.active)}`,
    );
    assert.ok(expanded.wingsBand, "the rail drew no band for the wing switcher");
    assert.ok(expanded.topBar, "the sheet rendered no top bar");
    assert.equal(
      expanded.wingsBand.box.top,
      expanded.topBar.box.top,
      `the rail's band starts at ${expanded.wingsBand.box.top}px, not on the top bar's row (${expanded.topBar.box.top}px)`,
    );
    assert.equal(
      expanded.wingsBand.box.bottom,
      expanded.topBar.box.bottom,
      `the rail's band ends at ${expanded.wingsBand.box.bottom}px, not on the top bar's line (${expanded.topBar.box.bottom}px)`,
    );
    assert.ok(
      expanded.wingSwitcher.box.top >= expanded.wingsBand.box.top &&
        expanded.wingSwitcher.box.bottom <= expanded.wingsBand.box.bottom,
      `the switcher (${JSON.stringify(expanded.wingSwitcher.box)}) does not sit inside its band (${JSON.stringify(expanded.wingsBand)})`,
    );
    assert.ok(
      expanded.firstLink.top >= expanded.wingsBand.box.bottom - 1,
      `the wing's first row starts at ${expanded.firstLink.top}px, above the switcher's band bottom at ${expanded.wingsBand.box.bottom}px`,
    );
    assert.equal(
      expanded.wingsBand.borderBottomWidth,
      "0px",
      `the sidebar's band paints a line across the rail (${expanded.wingsBand.borderBottomWidth}); the strip's hairline belongs to the sheet's top bar`,
    );
    assert.ok(
      (expanded.railToggle?.box.right ?? 0) > track * 0.7 &&
        (expanded.railToggle?.box.right ?? 0) <= track,
      `the collapse toggle sits at ${JSON.stringify(expanded.railToggle?.box)} in a ${track}px column, not at its trailing edge`,
    );
    assert.equal(
      expanded.corner?.insideRail,
      true,
      "the window's top-left corner is not painted by the rail",
    );

    assert.ok(expanded.vault, "titlebar rendered no vault chip");
    assert.ok(
      expanded.vault.box.left >= expanded.rail.box.right,
      `titlebar text (${expanded.vault.box.left}px) did not clear the rail (${expanded.rail.box.right}px)`,
    );
    assert.ok(
      (expanded.railToggle?.box.right ?? 0) <= expanded.vault.box.left,
      `the rail's toggle (${JSON.stringify(expanded.railToggle?.box)}) overlaps the vault chip starting at ${expanded.vault.box.left}px`,
    );
    assert.equal(
      expanded.vault.text,
      report.vaultName,
      "the strip is not wearing the vault name",
    );
    assert.equal(
      expanded.leadingText,
      report.vaultName,
      `the strip carries more than the vault name: "${expanded.leadingText}"`,
    );
    assert.equal(
      expanded.legacyBrand,
      false,
      "the app mark or wordmark is still in the titlebar",
    );
    assert.notEqual(
      expanded.vault.background,
      expanded.titlebarBackground,
      "the vault chip has no highlighted background",
    );
    // Not equal to the surface behind it is not enough — `transparent` passes
    // that test too. The fill has to actually paint.
    assert.ok(
      alpha(expanded.vault.background) > 0.05,
      `the vault chip paints no fill: ${expanded.vault.background}`,
    );
    // Square and flush to the window's top edge over the strip's full height —
    // a rounded pill floating in the middle of the band is the old chrome.
    assert.equal(
      expanded.vault.radius,
      "0px",
      `the chip kept a rounded corner: ${expanded.vault.radius}`,
    );
    assert.equal(
      expanded.vault.box.top,
      0,
      "the chip kept a margin above it",
    );
    assert.equal(
      expanded.vault.box.height,
      titlebarHeight,
      "the chip does not fill the strip",
    );
    // The sidebar is one wide column: the chats section sits inside it, between
    // the wing's rows and the icons at the foot. The sheet abuts the column.
    assert.ok(expanded.chats, "the sidebar rendered no chats section");
    assert.equal(expanded.chats.inRail, true, "the chats section left the sidebar");
    assert.equal(
      expanded.chats.box.left >= (expanded.rail?.box.left ?? 0) &&
        expanded.chats.box.right <= (expanded.rail?.box.right ?? 0),
      true,
      `the chats section (${JSON.stringify(expanded.chats.box)}) is not inside the sidebar (${JSON.stringify(expanded.rail?.box)})`,
    );
    assert.equal(expanded.chats.title, "Chats", "the chats section has no heading");
    assert.equal(expanded.chats.newChat, true, "the chats section offers no New chat");
    assert.equal(
      expanded.chats.scrollRegion,
      "auto",
      "the chats list does not scroll inside the sidebar",
    );
    assert.ok(
      expanded.wingSection && expanded.bottomSection,
      "the sidebar did not render its top and bottom groups",
    );
    assert.equal(
      expanded.chats.box.top >= expanded.wingSection!.bottom - 1,
      true,
      `the chats section starts at ${expanded.chats.box.top}px, above the wing's rows (${expanded.wingSection!.bottom}px)`,
    );
    assert.equal(
      expanded.chats.box.bottom <= expanded.bottomSection!.top + 1,
      true,
      `the chats section ends at ${expanded.chats.box.bottom}px, below the foot's start (${expanded.bottomSection!.top}px)`,
    );
    assert.equal(
      expanded.main?.left,
      track,
      "the sheet is not flush to the sidebar's trailing edge",
    );
    assert.equal(
      expanded.main?.right,
      expanded.chat.box.left,
      "the sheet left a gap between itself and the dock",
    );
    assert.equal(
      expanded.main?.bottom,
      expanded.viewport.height,
      "the sheet stopped short of the window bottom",
    );
    assert.equal(
      expanded.vault?.box.left,
      expanded.main?.left,
      "the chip's leading border does not line up with the sheet's",
    );

    // The rail's box reaches over the titlebar row and paints the mat there, so
    // the sidebar runs to the window's top and the titlebar's own fill begins only
    // at the rail's trailing edge — where the sheet and its vault chip start. The
    // night ladder asserts the strip's own step below the mat; this is the
    // paint-order half of the claim.
    assert.equal(
      expanded.header?.background,
      "rgba(0, 0, 0, 0)",
      `the rail's topband drew a fill of its own (${expanded.header?.background}) instead of showing the rail's mat`,
    );
    assert.equal(
      expanded.header?.box.top,
      0,
      `the rail's topband starts at ${expanded.header?.box.top}px, not the window's top`,
    );
    assert.equal(
      expanded.header?.box.bottom,
      titlebarHeight,
      `the rail's topband ends at ${expanded.header?.box.bottom}px, not the titlebar's ${titlebarHeight}px`,
    );
    assert.equal(
      expanded.vault?.box.left,
      expanded.rail?.box.right,
      `the titlebar's fill starts at the chip (${expanded.vault?.box.left}px) but the rail ends at ${expanded.rail?.box.right}px`,
    );
    assert.notEqual(
      expanded.titlebarBackground,
      expanded.rail?.background,
      `the titlebar still wears the mat's ink (${expanded.titlebarBackground}) at night`,
    );
    assert.equal(
      expanded.rail?.background,
      computedHex(report.ladder.night.tokens.canvasBase),
      `the rail (${expanded.rail?.background}) is not painting --canvas-base (${report.ladder.night.tokens.canvasBase})`,
    );
    assert.equal(
      expanded.rail?.backdropFilter,
      "none",
      `the rail is still frosted (${expanded.rail?.backdropFilter})`,
    );
    // The native caption strip is painted by the OS in the same row: the provider
    // (and the harness's stand-in for its stored-preference repaint) must hand it
    // the titlebar's own fill, or the window controls sit on the old ink.
    const lastOverlay = report.overlay?.at(-1) ?? null;
    assert.ok(lastOverlay, "the provider never handed the native overlay a fill");
    assert.equal(
      computedHex(lastOverlay.color),
      expanded.titlebarBackground,
      `the native caption strip (${lastOverlay.color}) is not wearing the titlebar's fill (${expanded.titlebarBackground})`,
    );

    // The sheet's own chrome: square, and carrying the studio's one hairline —
    // its trailing edge, the seam with the dock.
    assert.ok(expanded.sheet, "the shell rendered no workspace sheet");
    // Square on all four corners: the sheet is a pane, not a card, and no corner
    // of it is notched out of the mat.
    for (const [corner, radius] of [
      ["top left", expanded.sheet.borderTopLeftRadius],
      ["top right", expanded.sheet.borderTopRightRadius],
      ["bottom right", expanded.sheet.borderBottomRightRadius],
      ["bottom left", expanded.sheet.borderBottomLeftRadius],
    ] as const) {
      assert.equal(
        radius,
        "0px",
        `the sheet grew a radius on its ${corner} corner (${radius})`,
      );
    }
    assert.ok(
      parseFloat(expanded.sheet.borderRightWidth) > 0 &&
        parseFloat(expanded.sheet.borderRightWidth) <= 1,
      `the sheet lost the seam with the dock (${expanded.sheet.borderRightWidth})`,
    );
    for (const [side, width] of [
      ["top", expanded.sheet.borderTopWidth],
      ["bottom", expanded.sheet.borderBottomWidth],
      ["left", expanded.sheet.borderLeftWidth],
    ] as const) {
      assert.equal(
        width,
        "0px",
        `the sheet grew a line on its ${side} edge (${width})`,
      );
    }
    assert.equal(
      expanded.sheet.box.top,
      titlebarHeight,
      `the sheet's top edge is not directly under the strip (${expanded.sheet.box.top}px vs ${titlebarHeight}px)`,
    );
    // The rail|sheet seam is one line, drawn by the rail's trailing edge; the
    // sheet's leading edge stays unpainted so the seam is not a two-pixel band.
    // The dock paints none of its own on any edge.
    assert.ok(
      parseFloat(expanded.rail.borderRightWidth) > 0 &&
        parseFloat(expanded.rail.borderRightWidth) <= 1 &&
        expanded.sheet.borderLeftWidth === "0px",
      `rail right ${expanded.rail.borderRightWidth}, sheet left ${expanded.sheet.borderLeftWidth}`,
    );
    assert.equal(
      expanded.chat.borderTopWidth === "0px" &&
        expanded.chat.borderRightWidth === "0px" &&
        expanded.chat.borderBottomWidth === "0px" &&
        expanded.chat.borderLeftWidth === "0px",
      true,
      `dock t/r/b/l ${expanded.chat.borderTopWidth}/${expanded.chat.borderRightWidth}/${expanded.chat.borderBottomWidth}/${expanded.chat.borderLeftWidth}`,
    );
    // And the line under the strip is still there — it is the top bar's own, under
    // the wing and domain selectors, not a frame on the sheet — and it is one line
    // across both panes: the dock's header wears the same band height.
    assert.ok(
      parseFloat(expanded.topBar?.borderBottomWidth ?? "0") > 0 &&
        parseFloat(expanded.topBar?.borderBottomWidth ?? "0") <= 1,
      `the wing and domain selectors lost their underline (${expanded.topBar?.borderBottomWidth})`,
    );
    assert.equal(
      expanded.topBar?.background,
      expanded.mainBackground,
      `the top bar is not on the page canvas: ${expanded.topBar?.background} vs ${expanded.mainBackground}`,
    );
    assert.ok(expanded.chatHeader, "the dock rendered no header band");
    assert.equal(
      expanded.topBar.box.top,
      expanded.chatHeader.box.top,
      `the two bands do not start on the same row: ${expanded.topBar.box.top}px vs ${expanded.chatHeader.box.top}px`,
    );
    assert.equal(
      expanded.topBar.box.bottom,
      expanded.chatHeader.box.bottom,
      `the top bar's underline and the dock header's do not meet on one line: ${expanded.topBar.box.bottom}px vs ${expanded.chatHeader.box.bottom}px`,
    );
    assert.ok(
      parseFloat(expanded.chatHeader.borderBottomWidth) > 0 &&
        parseFloat(expanded.chatHeader.borderBottomWidth) <= 1,
      `the dock header lost its underline (${expanded.chatHeader.borderBottomWidth})`,
    );

    // The sheet's band carries one control now — the domain lens — with no frame
    // of its own, centred in the pane. The frame doubled the pair's outlines back
    // when the wing switcher shared the row; the control must still read as one
    // without it — its fill separates it from the band, and the active tab keeps
    // its line.
    assert.equal(
      expanded.bandControlCount,
      1,
      `the sheet's band carries ${expanded.bandControlCount} .ui-segmented controls, expected the lens alone`,
    );
    assert.equal(
      expanded.topBarSelectors?.length,
      1,
      `the rig did not measure the band's one selector: ${JSON.stringify(expanded.topBarSelectors)}`,
    );
    assert.equal(
      expanded.topBarSelectors?.[0]?.selector,
      ".domain-switcher__tabs",
      "the sheet's band is not carrying the domain lens",
    );
    for (const entry of expanded.topBarSelectors ?? []) {
      assert.equal(
        [
          entry.borderTopWidth,
          entry.borderRightWidth,
          entry.borderBottomWidth,
          entry.borderLeftWidth,
        ].join("/"),
        "0px/0px/0px/0px",
        `${entry.selector} still wears an outer frame`,
      );
      assert.ok(
        alphaOf(entry.background) > 0.05,
        `${entry.selector} lost its fill too, so it vanishes into the band (${entry.background})`,
      );
      assert.ok(
        entry.optionCount > 0,
        `${entry.selector} rendered no options`,
      );
      assert.notEqual(
        entry.activeBorderWidth,
        "0px",
        `${entry.selector}'s active tab lost the line that marks it as the current one`,
      );
      assert.ok(
        alphaOf(entry.activeBackground) > 0.05,
        `${entry.selector}'s active tab lost its fill (${entry.activeBackground})`,
      );
    }
    assert.ok(expanded.domainLens, "the band rendered no domain lens");
    assert.ok(expanded.topBar, "the sheet rendered no top bar");
    assert.ok(
      Math.abs(
        (expanded.domainLens.box.left + expanded.domainLens.box.right) / 2 -
          (expanded.topBar.box.left + expanded.topBar.box.right) / 2,
      ) <= 1,
      `the domain lens is not centred: its centre is ${(expanded.domainLens.box.left + expanded.domainLens.box.right) / 2}px, the band's is ${(expanded.topBar.box.left + expanded.topBar.box.right) / 2}px`,
    );

    // The switcher is live where it now sits: clicking Define in the rail turns
    // the rows under it into the Define pages, and Home brings the Home pages
    // back. Read off the shipping rail, so a switcher that renders but does not
    // navigate cannot pass.
    const { wingSwitch } = report;
    assert.ok(
      wingSwitch?.defined && wingSwitch?.home,
      "the rig did not record the rail switcher's trip",
    );
    assert.equal(
      wingSwitch.defined.wingSwitcher?.active,
      "Define",
      `after clicking Define the active wing tab reads ${JSON.stringify(wingSwitch.defined.wingSwitcher?.active)}`,
    );
    assert.deepEqual(
      wingSwitch.defined.wingRows.map((row) => row.label),
      ["Dream", "Vision", "Ideal State", "Images"],
      "the Define wing's rows did not replace the Home wing's under the switcher",
    );
    assert.equal(
      wingSwitch.home.wingSwitcher?.active,
      "Home",
      `after clicking Home the active wing tab reads ${JSON.stringify(wingSwitch.home.wingSwitcher?.active)}`,
    );
    assert.deepEqual(
      wingSwitch.home.wingRows.map((row) => row.label),
      ["Dashboard", "Data", "Pages", "Documents", "Personnel"],
      "the Home wing's rows did not come back",
    );

    // Collapsed: the rail narrows to the icon column IN PLACE and keeps its one
    // toggle. The reported bug — a second toggle in the titlebar over the vault
    // chip — is a negative claim now: that element must not exist in either state.
    assert.ok(
      collapsed.rail !== null && collapsed.railDisplay !== "none",
      `collapsing left the rail off the layout (rail ${collapsed.rail ? `display:${collapsed.railDisplay}` : "missing"})`,
    );
    assert.equal(
      collapsed.rail!.box.width,
      collapsedTrack,
      `the thin rail is ${collapsed.rail!.box.width}px, not the ${collapsedTrack}px icon column`,
    );
    assert.equal(
      collapsed.shellNavCollapsed,
      true,
      "the shell did not take the nav-collapsed arrangement",
    );
    assert.equal(
      collapsed.shell?.gridColumns[0],
      collapsedTrack,
      `the shell's first track is ${collapsed.shell?.gridColumns[0]}px, not the ${collapsedTrack}px icon column`,
    );
    // Same pane, same three window edges, same single trailing hairline: the
    // collapse changes the column's width and nothing about the panel's shape.
    assert.equal(collapsed.rail!.box.left, 0, "the thin rail kept a left inset");
    assert.equal(collapsed.rail!.box.top, 0, "the thin rail kept a top inset");
    assert.equal(
      collapsed.rail!.box.bottom,
      expanded.viewport.height,
      "the thin rail stopped short of the window bottom",
    );
    assert.equal(
      collapsed.rail!.borderRadius,
      "0px",
      "the thin rail kept a rounded corner",
    );
    assert.ok(
      parseFloat(collapsed.rail!.borderRightWidth) > 0 &&
        parseFloat(collapsed.rail!.borderRightWidth) <= 1 &&
        collapsed.rail!.borderLeftWidth === "0px" &&
        collapsed.rail!.borderTopWidth === "0px" &&
        collapsed.rail!.borderBottomWidth === "0px",
      `the thin rail's borders t/r/b/l are ${collapsed.rail!.borderTopWidth}/${collapsed.rail!.borderRightWidth}/${collapsed.rail!.borderBottomWidth}/${collapsed.rail!.borderLeftWidth}`,
    );
    // The toggle stays in the rail's header at both widths; collapsed it is the
    // expand icon, centred in the icon column.
    assert.equal(
      collapsed.header?.controls.length,
      1,
      `the thin rail's topband holds ${collapsed.header?.controls.length} controls, expected its one toggle`,
    );
    assert.equal(
      collapsed.railToggle?.label,
      "Expand sidebar",
      `the thin rail's one control is not the expand toggle (${JSON.stringify(collapsed.railToggle?.label)})`,
    );
    assert.equal(
      collapsed.railToggle?.ariaExpanded,
      "false",
      `the rail's toggle reports aria-expanded=${JSON.stringify(collapsed.railToggle?.ariaExpanded)} while the rail is thin`,
    );
    assert.equal(
      collapsed.railToggle?.ariaControls,
      "nav-rail",
      "the thin rail's toggle does not name the rail it controls",
    );
    assert.match(
      collapsed.railToggle?.icon ?? "",
      /lucide-panel-left-open/,
      `the thin rail's toggle is not the expand icon (${JSON.stringify(collapsed.railToggle?.icon)})`,
    );
    assert.ok(
      Math.abs(
        ((collapsed.railToggle?.box.left ?? 0) +
          (collapsed.railToggle?.box.right ?? 0)) /
          2 -
          (collapsed.rail!.box.left + collapsed.rail!.box.right) / 2,
      ) <= 1,
      `the toggle (${JSON.stringify(collapsed.railToggle?.box)}) is not centred in the ${collapsedTrack}px rail (${JSON.stringify(collapsed.rail!.box)})`,
    );
    assert.equal(
      collapsed.titlebarToggle,
      null,
      `a titlebar toggle re-appeared when the rail narrowed (${JSON.stringify(collapsed.titlebarToggle)})`,
    );
    // The chip holds its place at the rail's trailing edge in both states: it
    // starts where the sheet does, never at the window's leading edge and never
    // under the rail's toggle.
    assert.ok(
      collapsed.vault && collapsed.rail,
      "the strip lost the vault chip in one of the two states",
    );
    assert.equal(
      collapsed.vault!.box.left,
      collapsed.rail!.box.right,
      `the chip starts at ${collapsed.vault!.box.left}px but the rail ends at ${collapsed.rail!.box.right}px`,
    );
    assert.equal(
      collapsed.vault!.box.left,
      collapsedTrack,
      `the chip starts at ${collapsed.vault!.box.left}px, not the thin rail's ${collapsedTrack}px`,
    );
    assert.equal(
      collapsed.main?.left,
      collapsedTrack,
      `the sheet starts at ${collapsed.main?.left}px, not the thin rail's ${collapsedTrack}px`,
    );
    assert.ok(
      (collapsed.railToggle?.box.right ?? Infinity) <= collapsed.vault!.box.left,
      `the rail's toggle (${JSON.stringify(collapsed.railToggle?.box)}) overlaps the vault chip starting at ${collapsed.vault!.box.left}px`,
    );
    assert.equal(
      collapsed.vault!.text,
      report.vaultName,
      "the vault name left the strip when the rail narrowed",
    );
    assert.equal(
      collapsed.vault!.box.width,
      expanded.vault!.box.width,
      "the chip changed width when the rail narrowed",
    );
    assert.equal(
      collapsed.corner?.insideRail,
      true,
      "the window's top-left corner is not painted by the thin rail",
    );
    assert.equal(
      report.reclaimedPx,
      track - collapsedTrack,
      `unexpected reclaimed width ${report.reclaimedPx}px, expected the rail's own difference ${track - collapsedTrack}px`,
    );
    assert.equal(
      collapsed.chat.box.left - (collapsed.main?.right ?? 0),
      0,
      "collapsing the rail opened a gap between the sheet and the dock",
    );

    // The thin rail is icon-only: the labelled wing switcher, the chats section,
    // the divider above it and the row labels leave. The rows themselves stay —
    // an icon column with no pages in it would be the rail leaving in disguise.
    assert.equal(
      collapsed.wingsBand?.display,
      "none",
      `the thin rail still shows the wing switcher's band (${collapsed.wingsBand?.display})`,
    );
    assert.equal(
      collapsed.chats?.display,
      "none",
      `the thin rail still shows the chats section (${collapsed.chats?.display})`,
    );
    assert.equal(
      collapsed.chatsDivider?.display,
      "none",
      `the thin rail still shows the divider above the chats section (${collapsed.chatsDivider?.display})`,
    );
    assert.equal(
      collapsed.railLabels.display,
      "none",
      `the thin rail still shows its row labels (${collapsed.railLabels.count} labels, display ${JSON.stringify(collapsed.railLabels.display)})`,
    );
    assert.ok(collapsed.railRows.length > 0, "the thin rail has no nav rows");
    assert.equal(
      collapsed.railRows.length,
      expanded.railRows.length,
      `the thin rail kept ${collapsed.railRows.length} of the wide rail's ${expanded.railRows.length} rows`,
    );
    for (const row of collapsed.railRows) {
      assert.notEqual(
        row.icon,
        null,
        `the thin rail's row "${row.ariaLabel}" lost its icon`,
      );
      assert.equal(
        row.labelDisplay,
        "none",
        `the row "${row.ariaLabel}" still draws its label`,
      );
      assert.ok(row.title, `the thin rail's row "${row.label}" lost its title`);
      assert.ok(
        row.ariaLabel,
        `the thin rail's row "${row.label}" lost its accessible name`,
      );
      assert.ok(row.iconBox, `the thin rail's row "${row.ariaLabel}" has no icon`);
      assert.ok(
        Math.abs(
          (row.iconBox!.left + row.iconBox!.right) / 2 -
            (collapsed.rail!.box.left + collapsed.rail!.box.right) / 2,
        ) <= 1,
        `the row "${row.ariaLabel}" does not centre its icon in the ${collapsedTrack}px column`,
      );
    }

    // Round trip: same rail box, same offsets, from the rail's own toggle — the
    // way back is where the way in was.
    assert.deepEqual(
      restored.rail?.box,
      expanded.rail?.box,
      "reopening did not restore the rail box",
    );
    assert.equal(
      restored.main?.left,
      expanded.main?.left,
      "reopening did not restore the sheet offset",
    );
    assert.equal(
      restored.vault?.box.left,
      expanded.vault?.box.left,
      "reopening did not restore the chip's offset",
    );
    assert.equal(
      restored.shellNavCollapsed,
      false,
      "reopening did not leave the nav-collapsed arrangement",
    );
    assert.equal(
      restored.shell?.gridColumns[0],
      track,
      `reopening left the shell's first track at ${restored.shell?.gridColumns[0]}px, not ${track}px`,
    );
    assert.equal(
      restored.railToggle?.label,
      "Collapse sidebar",
      "reopening left the rail's toggle in the expand state",
    );
    assert.notEqual(
      restored.railLabels.display,
      "none",
      "reopening did not bring the rail's labels back",
    );

    // The dock's own contract: square, flush right and bottom, on the sheet's
    // surface rather than a frosted one, and painting no line of its own on any
    // edge — the sheet's trailing hairline is the seam's only divider.
    const { height: viewportHeight, width: viewportWidth } = expanded.viewport;
    assert.equal(
      viewportWidth - expanded.chat.box.right,
      0,
      "the chat panel kept a right inset",
    );
    assert.equal(
      expanded.chat.box.bottom,
      viewportHeight,
      "the chat panel stopped short of the window bottom",
    );
    assert.equal(expanded.chat.borderRadius, "0px", "the chat panel kept its radius");
    for (const [edge, width] of [
      ["top", expanded.chat.borderTopWidth],
      ["right", expanded.chat.borderRightWidth],
      ["bottom", expanded.chat.borderBottomWidth],
      ["left", expanded.chat.borderLeftWidth],
    ] as const) {
      assert.equal(
        width,
        "0px",
        `the chat panel grew a line on its ${edge} edge (${width})`,
      );
    }
    assert.equal(
      expanded.chat.box.top,
      titlebarHeight,
      `the panel's top edge is not level with the sheet's (${expanded.chat.box.top}px vs ${titlebarHeight}px)`,
    );
    assert.equal(
      expanded.chat.backdropFilter,
      "none",
      "the chat panel is still frosted",
    );
    assert.equal(
      expanded.chat.background,
      expanded.mainBackground,
      "the chat panel is not on the sheet's surface",
    );
    assert.equal(expanded.chat.boxShadow, "none", "the chat panel still floats on a shadow");

    // The night ladder, restated on the numbers the driver wrote down: the studio
    // is a frame around the darkest page. The page canvas is the floor, the cards
    // step up off it, and the chrome band wears the palette's quiet band. A skin
    // may move the inks; it may not move them in this order.
    const { ladder } = report;
    assert.ok(ladder, "report carries no colour ladder");
    assert.equal(ladder.night.dataTheme, "dark", "the rig did not run at night");
    assert.equal(ladder.night.skin, "forge-os", "the night rig is not on Forge OS");
    for (const surface of [
      "chrome",
      "titlebar",
      "page",
      "dock",
      "dockActions",
      "card",
      "viewCard",
    ] as const) {
      assert.equal(
        Number.isFinite(ladder.night.luminance[surface]),
        true,
        `no luminance for the night ${surface} (${ladder.night.surfaces[surface]})`,
      );
    }
    assert.ok(
      ladder.night.luminance.chrome > ladder.night.luminance.page,
      `the chrome band is not lighter than the page canvas: mat ${ladder.night.surfaces.chrome} (${ladder.night.luminance.chrome}) vs page ${ladder.night.surfaces.page} (${ladder.night.luminance.page})`,
    );
    assert.ok(
      ladder.night.luminance.titlebar > ladder.night.luminance.page,
      `the titlebar is not lighter than the page canvas: ${ladder.night.surfaces.titlebar} (${ladder.night.luminance.titlebar}) vs ${ladder.night.luminance.page}`,
    );
    // The strip's and the bar's own step: below the mat they cap and above the page
    // they open onto. The mat is still the rail's ink — the strip and the dock's
    // action band are the surfaces that leave the band, so they must not be equal
    // to it any more, and they wear each other's ink.
    assert.ok(
      ladder.night.luminance.titlebar < ladder.night.luminance.chrome,
      `the titlebar is not darker than the mat: ${ladder.night.surfaces.titlebar} (${ladder.night.luminance.titlebar}) vs mat ${ladder.night.surfaces.chrome} (${ladder.night.luminance.chrome})`,
    );
    assert.notEqual(
      ladder.night.surfaces.titlebar,
      ladder.night.surfaces.chrome,
      `the titlebar still wears the mat's ink (${ladder.night.surfaces.titlebar})`,
    );
    assert.ok(
      ladder.night.luminance.dockActions < ladder.night.luminance.chrome &&
        ladder.night.luminance.dockActions > ladder.night.luminance.page,
      `the dock's action band does not take the strip's step: bar ${ladder.night.surfaces.dockActions} (${ladder.night.luminance.dockActions}) vs mat ${ladder.night.surfaces.chrome} (${ladder.night.luminance.chrome}) / page ${ladder.night.luminance.page}`,
    );
    // Forge OS's own band sits *under* its cards, so its sidebar and strip are the
    // darker chrome and the cards stay the lighter grey. That ordering is this
    // palette's — a palette whose quiet band sits above its cards is held only to
    // the sweep's claims below.
    for (const surface of ["card", "viewCard"] as const) {
      assert.ok(
        ladder.night.luminance.chrome < ladder.night.luminance[surface],
        `the chrome band is not darker than the night ${surface}: mat ${ladder.night.surfaces.chrome} (${ladder.night.luminance.chrome}) vs ${ladder.night.surfaces[surface]} (${ladder.night.luminance[surface]})`,
      );
    }
    assert.equal(
      ladder.night.surfaces.dockActions,
      ladder.night.surfaces.titlebar,
      `the dock's action band does not wear the strip's fill: bar ${ladder.night.surfaces.dockActions} vs titlebar ${ladder.night.surfaces.titlebar}`,
    );
    assert.equal(
      ladder.night.tokens.canvasBase,
      ladder.night.tokens.mutedSurface,
      `--canvas-base and --muted-surface are different inks: ${ladder.night.tokens.canvasBase} vs ${ladder.night.tokens.mutedSurface}`,
    );
    for (const surface of ["card", "viewCard"] as const) {
      assert.ok(
        ladder.night.luminance[surface] > ladder.night.luminance.page,
        `the ${surface} does not step up off the page canvas: ${ladder.night.surfaces[surface]} (${ladder.night.luminance[surface]}) vs page ${ladder.night.surfaces.page} (${ladder.night.luminance.page})`,
      );
    }
    // Nothing in the window may paint below the page canvas — that is what makes
    // it the darkest surface rather than merely a dark one.
    for (const surface of [
      "chrome",
      "titlebar",
      "dock",
      "dockActions",
      "card",
      "viewCard",
    ] as const) {
      assert.ok(
        ladder.night.luminance[surface] >= ladder.night.luminance.page,
        `the night ${surface} paints below the page canvas: ${ladder.night.surfaces[surface]} (${ladder.night.luminance[surface]}) vs page (${ladder.night.luminance.page})`,
      );
    }
    // And day keeps its own ladder: the mat and the panels sink below the sheet,
    // so the night swap cannot have been bought with the light theme.
    assert.equal(ladder.day.dataTheme, "light", "the day pass did not run in light");
    assert.ok(
      ladder.day.luminance.chrome < ladder.day.luminance.page &&
        ladder.day.luminance.titlebar < ladder.day.luminance.page,
      `day lost the sunk mat: mat ${ladder.day.surfaces.chrome} (${ladder.day.luminance.chrome}) and titlebar (${ladder.day.luminance.titlebar}) vs sheet ${ladder.day.surfaces.page} (${ladder.day.luminance.page})`,
    );
    // By day the strip stays the mat: the night step is a mode decision, not a
    // restyle that followed the token into daylight.
    assert.equal(
      ladder.day.luminance.titlebar,
      ladder.day.luminance.chrome,
      `day gave the strip its own ink: titlebar ${ladder.day.surfaces.titlebar} (${ladder.day.luminance.titlebar}) vs mat ${ladder.day.surfaces.chrome} (${ladder.day.luminance.chrome})`,
    );
    assert.equal(
      ladder.day.surfaces.titlebar,
      ladder.day.surfaces.chrome,
      `day: the titlebar (${ladder.day.surfaces.titlebar}) is not wearing the mat (${ladder.day.surfaces.chrome})`,
    );
    assert.equal(
      ladder.day.surfaces.dockActions,
      ladder.day.surfaces.titlebar,
      `day: the dock's action band (${ladder.day.surfaces.dockActions}) is not wearing the mat like the strip (${ladder.day.surfaces.titlebar})`,
    );
    assert.ok(
      ladder.day.luminance.card < ladder.day.luminance.page,
      `day lost its recessed panels: ${ladder.day.surfaces.card} (${ladder.day.luminance.card}) vs sheet (${ladder.day.luminance.page})`,
    );
    // Both passes are the same skin, so a run that fell back to the tokens.css
    // palette — the one nobody ships — cannot pass as Forge OS.
    assert.equal(ladder.day.skin, "forge-os", "the day rig is not on Forge OS");
    assert.equal(
      ladder.night.surfaces.chrome,
      computedHex(ladder.night.tokens.canvasBase),
      `the mat is not painting --canvas-base: ${ladder.night.surfaces.chrome} vs ${ladder.night.tokens.canvasBase}`,
    );
    assert.equal(
      ladder.night.surfaces.page,
      computedHex(ladder.night.tokens.background),
      `the sheet is not painting --background: ${ladder.night.surfaces.page} vs ${ladder.night.tokens.background}`,
    );
    assert.equal(
      ladder.night.surfaces.card,
      computedHex(ladder.night.tokens.bgPanel),
      `the card is not painting --bg-panel: ${ladder.night.surfaces.card} vs ${ladder.night.tokens.bgPanel}`,
    );

    // And the same ladder on every other dark palette — not just the default one.
    // The sweep is cross-checked against the skin registry, so a new night skin
    // cannot land without being measured, and each palette is held to the same
    // claims: the page canvas is the deepest surface, the cards step up off it,
    // the mat is its own ink, and the titlebar strip and the dock's action row
    // wear one step below it.
    const swept = ladder.skins ?? {};
    const darkSkins = filterSkinsForMode(BUILTIN_SKIN_LIST, "dark")
      .map((skin) => skin.name)
      .sort();
    assert.deepEqual(
      Object.keys(swept).sort(),
      darkSkins,
      "the night sweep did not cover every dark skin",
    );
    const floors = [
      "chrome",
      "titlebar",
      "dock",
      "dockActions",
      "card",
      "viewCard",
    ] as const;
    for (const name of darkSkins) {
      const skin = swept[name];
      assert.equal(skin.dataTheme, "dark", `${name} was swept in the day palette`);
      assert.equal(skin.skin, name, `the sweep measured ${skin.skin} as ${name}`);
      for (const surface of [...floors, "page"] as const) {
        assert.equal(
          Number.isFinite(skin.luminance[surface]),
          true,
          `${name}: no luminance for the ${surface} (${skin.surfaces[surface]})`,
        );
      }
      assert.equal(
        skin.surfaces.dockActions,
        skin.surfaces.titlebar,
        `${name}: the dock's action band does not wear the strip's fill (${skin.surfaces.dockActions} vs ${skin.surfaces.titlebar})`,
      );
      assert.equal(
        skin.tokens.canvasBase,
        skin.tokens.mutedSurface,
        `${name}: --canvas-base and --muted-surface are different inks (${skin.tokens.canvasBase} vs ${skin.tokens.mutedSurface})`,
      );
      // The strip's and the bar's own step holds in every night palette: darker
      // than the mat, lighter than the page, and never the same ink as either.
      assert.notEqual(
        skin.surfaces.titlebar,
        skin.surfaces.chrome,
        `${name}: the titlebar still wears the mat's ink (${skin.surfaces.titlebar})`,
      );
      assert.ok(
        skin.luminance.titlebar < skin.luminance.chrome,
        `${name}: the titlebar does not step below the mat (${skin.surfaces.titlebar} vs mat ${skin.surfaces.chrome})`,
      );
      assert.ok(
        skin.luminance.titlebar > skin.luminance.page,
        `${name}: the titlebar sinks to or below the page canvas (${skin.surfaces.titlebar} vs page ${skin.surfaces.page})`,
      );
      assert.ok(
        skin.luminance.dockActions < skin.luminance.chrome &&
          skin.luminance.dockActions > skin.luminance.page,
        `${name}: the dock's action band is not one step below the mat (${skin.surfaces.dockActions} vs mat ${skin.surfaces.chrome} / page ${skin.surfaces.page})`,
      );
      // A skin may declare that its night ladder runs inverted: a faithful copy
      // of an upstream theme that puts its cards *below* its page. GitHub Dark
      // Default does, and `nous` forks it, so the palette is kept and the
      // direction declared rather than bent. See `darkLadder` on `ForgeSkin`.
      const inverted =
        BUILTIN_SKIN_LIST.find((candidate) => candidate.name === name)?.darkLadder ===
        "inverted";
      // The mat lifts off the page either way — that one is structural, not a
      // property of the upstream theme's card direction.
      assert.ok(
        skin.luminance.chrome > skin.luminance.page,
        `${name}: the mat does not lift off the page canvas (${skin.surfaces.chrome} vs ${skin.surfaces.page})`,
      );
      for (const surface of floors) {
        if (inverted && (surface === "card" || surface === "viewCard")) continue;
        assert.ok(
          skin.luminance[surface] >= skin.luminance.page,
          `${name}: the ${surface} paints below the page canvas (${skin.luminance[surface]} vs page ${skin.luminance.page})`,
        );
      }
      for (const surface of ["card", "viewCard"] as const) {
        if (inverted) {
          assert.ok(
            skin.luminance[surface] < skin.luminance.page,
            `${name}: declares an inverted ladder but the ${surface} does not sit below the page canvas (${skin.surfaces[surface]} vs ${skin.surfaces.page})`,
          );
          continue;
        }
        assert.ok(
          skin.luminance[surface] > skin.luminance.page,
          `${name}: the ${surface} does not step up off the page canvas (${skin.surfaces[surface]} vs ${skin.surfaces.page})`,
        );
      }
    }

    // The app's own scrollbar, cross-checked the same way the ladder is: the sweep
    // has to have measured every dark palette, so a new night skin cannot land with
    // a scrollbar nobody looked at — and each palette is held to the two claims the
    // driver made in the loop (the app's 8px gutter replaced the platform bar, and
    // the thumb ink is that palette's own mid ink rather than the accent).
    const { scroll } = report;
    assert.ok(scroll, "report carries no scrollbar section");
    assert.equal(
      scroll.pseudoReadable,
      true,
      "the engine did not answer for the scrollbar pseudo-elements, so the thumb was never read",
    );
    assert.equal(
      scroll.hover.forcedByDebugger,
      true,
      `the hovered scrollbar was never measured: ${scroll.hover.forceError ?? "no reason recorded"}`,
    );
    assert.deepEqual(
      Object.keys(scroll.night).sort(),
      darkSkins,
      "the scrollbar sweep did not cover every dark skin",
    );
    for (const [name, chrome] of [
      ["day", scroll.day],
      ...Object.entries(scroll.night),
    ] as const) {
      for (const [region, worst] of [
        ["the sheet's content", chrome.sheet],
        ["the chat transcript", chrome.transcript],
      ] as const) {
        assert.equal(
          worst.overflowsY,
          true,
          `${name}: ${region} does not scroll, so its bar proves nothing`,
        );
        // The load-bearing measurement: Chromium lays a styled scrollbar out at
        // exactly the width the CSS asks for and leaves a platform bar at the
        // platform's own width (15-17px on Windows). 8 is the app's rule winning.
        assert.equal(
          worst.gutterX,
          8,
          `${name}: ${region} left a ${worst.gutterX}px gutter, so the platform bar is still in place`,
        );
      }
      assert.equal(
        chrome.thumbToken,
        chrome.mutedForeground,
        `${name}: the scrollbar ink is not the palette's mid ink (${chrome.thumbToken} vs ${chrome.mutedForeground})`,
      );
      assert.notEqual(
        chrome.thumbToken,
        chrome.accent,
        `${name}: the scrollbar wears the accent`,
      );
      // The bar is QUIET at rest, not absent. A transparent thumb reads to an
      // operator as "there is no scrollbar here", which is the whole reason this
      // app departs from Hermes on this one point.
      for (const [region, worst] of [
        ["the sheet's content", chrome.sheet],
        ["the chat transcript", chrome.transcript],
      ] as const) {
        assert.ok(
          alphaOf(worst.thumbBackground) > 0,
          `${name}: ${region} draws no thumb at rest (${worst.thumbBackground})`,
        );
        assert.ok(
          alphaOf(worst.thumbBackground) <= 0.2,
          `${name}: ${region} draws a loud thumb at rest (${worst.thumbBackground})`,
        );
      }
    }

    // And hovering a region strengthens ITS thumb while the other stays at rest:
    // a custom scrollbar follows its own scroller, not hover anywhere in the app.
    for (const [hovered, region] of [
      ["the sheet", "sheet"],
      ["the transcript", "transcript"],
    ] as const) {
      const other = region === "sheet" ? "transcript" : "sheet";
      const over = hovered === "the sheet" ? scroll.hover.overSheet : scroll.hover.overTranscript;
      assert.ok(
        alphaOf(over[region]) > alphaOf(scroll.hover.pointerOut[region]),
        `hovering ${hovered} did not strengthen its thumb (${over[region]} vs rest ${scroll.hover.pointerOut[region]})`,
      );
      assert.equal(
        alphaOf(over[other]),
        alphaOf(scroll.hover.pointerOut[other]),
        `hovering ${hovered} changed the other region's thumb (${over[other]} vs rest ${scroll.hover.pointerOut[other]})`,
      );
    }

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
