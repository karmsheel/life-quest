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

/** A computed `::before`/`::after` as the driver read it off the lens. */
type Fillet = {
  content: string;
  backgroundImage: string;
  width: string;
  height: string;
  bottom: string;
  left: string;
  right: string;
};

type State = {
  viewport: { width: number; height: number };
  tokens: {
    track: number;
    collapsedTrack: number;
    frame: number;
    titlebarHeight: number;
    topbarHeight: number;
    radiusSm: string;
  };
  theme: {
    dataTheme: string | null;
    skin: string | null;
    canvasBase: string;
    accent: string;
    /** The palette's mid ink, which the vault chip's quiet label wears. */
    muted: string;
    /** The rail's soft neutral surface, which the vault chip's fill wears. */
    bgSubtle: string;
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
  /** Negative regression claim: the titlebar must render no vault chip. */
  titlebarVault: { box: Box; text: string } | null;
  /**
   * The rail's foot: the Log row and the vault chip. Wide it is one row of two
   * equal halves; thin it is a column with the Log's icon above the initials.
   */
  foot: {
    box: Box;
    display: string;
    flexDirection: string;
    children: { tag: string; className: string; box: Box }[];
    logRow: Box | null;
  } | null;
  /** The vault chip's home since round 2: the rail's foot, not the titlebar. */
  vaultChip: {
    box: Box;
    tag: string;
    title: string | null;
    ariaLabel: string | null;
    haspopup: string | null;
    ariaExpanded: string | null;
    background: string;
    color: string;
    radius: string;
    name: { text: string; display: string | null } | null;
    initials: { text: string; display: string | null } | null;
    chevronDisplay: string | null;
    inRail: boolean;
    inFoot: boolean;
    isLastControl: boolean;
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
  /**
   * The sheet's first element child. It must be the page column: the retired
   * `.top-bar` used to sit here, between the strip and the page.
   */
  mainFirstChild: { tag: string | null; className: string } | null;
  /** Negative regression claim: the retired `.top-bar` is gone from the DOM. */
  legacyTopBar: boolean;
  /** The window's strip, from the window's leading edge to its trailing edge. */
  titlebar: Box | null;
  /**
   * The domain tab raised into the window strip: its page ink, its no-drag
   * carve-out, its two bottom fillets where the page flares into the strip, its
   * rounded top corners matching them, and the two gaps that hold it clear of the
   * rail and of the trailing cluster.
   */
  lens: {
    box: Box;
    background: string;
    appRegion: string;
    inTitlebar: boolean;
    firstChild: boolean;
    fromRail: number | null;
    toTrailing: number | null;
    borderTopLeftRadius: string;
    borderTopRightRadius: string;
    borderBottomLeftRadius: string;
    borderBottomRightRadius: string;
    before: Fillet | null;
    after: Fillet | null;
  } | null;
  /** `data-nav-collapsed` on the strip: the rail's width the strip reports. */
  titlebarNavCollapsed: string | null;
  /** The trailing cluster (theme, shortcuts, settings, window controls). */
  trailing: Box | null;
  /** The page column: its top edge is where the retired band used to end. */
  shellContent: Box | null;
  /**
   * The lens's segmented control. Its outer `.ui-segmented` frame is gone inside
   * the page-ink tab; the fill and the active tab's line still carry it.
   */
  lensTabs: {
    selector: string;
    box: Box;
    borderTopWidth: string;
    borderRightWidth: string;
    borderBottomWidth: string;
    borderLeftWidth: string;
    background: string;
    activeBorderWidth: string | null;
    activeBackground: string | null;
    optionCount: number;
  } | null;
  /** The real domain switcher inside the lens, and the options it offers. */
  domainLens: {
    box: Box;
    inLens: boolean;
    labels: string[];
    optionCount: number;
    height: number;
  } | null;
  /**
   * The first-run band: with fewer than two unlocked areas the lens is one inert
   * word, "Life", in the same tab. Absent when the segmented control rendered.
   */
  quietLens: {
    text: string;
    box: Box;
    inLens: boolean;
    offsetFromLensCentreX: number;
    height: number;
    gapAbove: number;
    gapBelow: number;
  } | null;
  /** The quiet state's negative claim: no `.domain-switcher__tabs` in the lens. */
  lensHasTabs: boolean;
  /**
   * The rail's first level: the five-wing switcher and the band it sits in.
   * The band's own bottom border is measured because it must stay unpainted —
   * the hairline in that row belongs to the dock's header.
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
    /** Wide the control is horizontal; thin it stacks its options. */
    flexDirection: string;
    /** Square block: the frame and every tab carry no corner radius. */
    borderRadius: string;
    padding: { top: number; right: number; bottom: number; left: number };
    options: {
      label: string;
      active: boolean;
      box: Box;
      borderRadius: string;
      padding: { top: number; right: number; bottom: number; left: number };
      /** Overflow test: a word wider than its content box scrolls. */
      scrollWidth: number;
      clientWidth: number;
    }[];
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
  /** The live domains the harness handed the shell, in lens order. */
  domains: string[];
  tokens: State["tokens"];
  expanded: State;
  collapsed: State;
  restored: State;
  /** The quiet `Life` lens at 0 and 1 unlocked areas. */
  quiet: { none: State; one: State };
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
 * Whether a computed `background-image` paints `ink` — the page canvas, for the
 * lens's bottom fillets. The gradient's stops serialise as their own colour
 * strings, so the ink is looked for among them rather than substring-matched
 * against the whole gradient (whose stop positions would let a naive `includes`
 * pass on geometry alone).
 */
function gradientPaints(image: string | null, ink: string): boolean {
  if (!image || !ink || image === "none") return false;
  const stops = image.match(/rgba?\([^)]*\)|color\([^)]*\)/g) ?? [];
  return stops.includes(ink);
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

    const { track, collapsedTrack, titlebarHeight, topbarHeight } = report.tokens;

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
    // the wing's rows and directly under the window strip. The band paints no
    // line of its own — the hairline in that row is the dock's own header rule.
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
    // Wide, the five wings stay one horizontal segmented control. The vertical
    // stack is the thin rail's layout and must not leak into this state.
    assert.equal(
      expanded.wingSwitcher.flexDirection,
      "row",
      `the wide wing switcher is ${expanded.wingSwitcher.flexDirection}, not one row`,
    );
    assert.ok(expanded.wingsBand, "the rail drew no band for the wing switcher");
    // The rail's band did not give its height back with the sheet's band: it
    // starts at the strip's bottom edge and keeps the 44px band the dock's header
    // wears, so the two chrome rows stay level across the pane seam.
    assert.equal(
      expanded.wingsBand.box.top,
      titlebarHeight,
      `the rail's band starts at ${expanded.wingsBand.box.top}px, not at the strip's bottom edge (${titlebarHeight}px)`,
    );
    assert.equal(
      expanded.wingsBand.box.bottom,
      titlebarHeight + topbarHeight,
      `the rail's band ends at ${expanded.wingsBand.box.bottom}px, not ${titlebarHeight + topbarHeight}px down`,
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
      `the sidebar's band paints a line across the rail (${expanded.wingsBand.borderBottomWidth}); the hairline in that row is the dock's own header rule`,
    );
    // The switcher is a rectangular block, not the shared pill: square corners
    // on the frame and on every tab, the rail's own padding as its only margin —
    // one thin gap either side, equal — which is what centres it in the column.
    assert.equal(
      expanded.wingSwitcher.borderRadius,
      "0px",
      `the wide wing switcher kept a rounded frame (${expanded.wingSwitcher.borderRadius})`,
    );
    for (const option of expanded.wingSwitcher.options) {
      assert.equal(
        option.borderRadius,
        "0px",
        `the wide wing switcher's "${option.label}" tab kept a rounded corner (${option.borderRadius})`,
      );
    }
    assert.ok(
      Math.abs(
        expanded.wingSwitcher.box.left -
          expanded.rail!.box.left -
          (expanded.rail!.box.right - expanded.wingSwitcher.box.right),
      ) <= 1 &&
        expanded.wingSwitcher.box.left - expanded.rail!.box.left >= 3 &&
        expanded.rail!.box.right - expanded.wingSwitcher.box.right >= 3 &&
        expanded.wingSwitcher.box.left === expanded.wingsBand.box.left &&
        expanded.wingSwitcher.box.right === expanded.wingsBand.box.right,
      `the switcher (${JSON.stringify(expanded.wingSwitcher.box)}) is not the band's centred block in the rail (${JSON.stringify(expanded.rail!.box)}), band ${JSON.stringify(expanded.wingsBand.box)}`,
    );
    for (const option of expanded.wingSwitcher.options) {
      assert.ok(
        option.padding.top >= 5 &&
          option.padding.bottom >= 5 &&
          option.padding.left >= 3 &&
          option.padding.right >= 3,
        `the wide wing switcher's "${option.label}" tab has tight padding (${JSON.stringify(option.padding)})`,
      );
      assert.ok(
        option.scrollWidth <= option.clientWidth,
        `the wide wing switcher's "${option.label}" word overflows its ${option.clientWidth}px tab (${option.scrollWidth}px)`,
      );
    }
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

    // Round 2: the titlebar no longer names the vault. The chip moved into the
    // rail's foot, the strip's leading half is an empty drag handle, and the
    // titlebar carries no nav-column reservation classes.
    assert.equal(
      expanded.titlebarVault,
      null,
      `a .window-titlebar__vault is still in the strip (${JSON.stringify(expanded.titlebarVault)})`,
    );
    assert.equal(
      expanded.leadingText,
      "",
      `the strip still carries text: "${expanded.leadingText}"`,
    );
    assert.equal(
      expanded.legacyBrand,
      false,
      "the app mark or wordmark is still in the titlebar",
    );

    // The chip's new home: the rail's foot, on one row with the Log. Wide, the
    // two split the foot in half and the chip names the whole vault.
    assert.ok(expanded.foot, "the rail rendered no footer group");
    assert.ok(expanded.vaultChip, "the rail rendered no vault chip");
    const foot = expanded.foot!;
    const chip = expanded.vaultChip!;
    assert.equal(
      foot.children.length,
      2,
      `the foot carries ${foot.children.length} children, expected the Log row and the chip`,
    );
    assert.match(
      foot.children[0].className,
      /nav-rail__link/,
      "the foot's first control is not the Log row",
    );
    assert.match(
      foot.children[1].className,
      /nav-rail__vault/,
      "the foot's second control is not the vault chip",
    );
    assert.equal(foot.display, "flex", `the wide foot is not flex (${foot.display})`);
    assert.equal(
      foot.flexDirection,
      "row",
      `the wide foot is ${foot.flexDirection}, not one row`,
    );
    assert.ok(foot.logRow, "the foot rendered no Log row");
    assert.equal(chip.inRail, true, "the vault chip left the rail");
    assert.equal(chip.inFoot, true, "the vault chip left the rail's foot");
    // Half the row each: not "a row of two things" but equal halves. A chip that
    // stayed at its text width, or took the whole row, would fail here.
    assert.ok(
      Math.abs(foot.logRow!.width - chip.box.width) <= 1,
      `the Log (${foot.logRow!.width}px) and the chip (${chip.box.width}px) are not equal halves of the foot`,
    );
    assert.ok(
      foot.logRow!.width >= foot.box.width * 0.4 &&
        chip.box.width >= foot.box.width * 0.4,
      `the foot's controls (${foot.logRow!.width}px / ${chip.box.width}px) do not split its ${foot.box.width}px width`,
    );
    // Same row: one vertical centre and one height.
    assert.ok(
      Math.abs(
        (foot.logRow!.top + foot.logRow!.bottom) / 2 -
          (chip.box.top + chip.box.bottom) / 2,
      ) <= 1,
      `the Log (${JSON.stringify(foot.logRow)}) and the chip (${JSON.stringify(chip.box)}) do not share a row`,
    );
    assert.ok(
      Math.abs(foot.logRow!.height - chip.box.height) <= 1,
      `the chip (${chip.box.height}px) and the Log row (${foot.logRow!.height}px) are not the same height`,
    );
    assert.equal(
      chip.name?.text,
      report.vaultName,
      `the chip is not showing the vault's name (${JSON.stringify(chip.name?.text)})`,
    );
    assert.notEqual(
      chip.name?.display,
      "none",
      "the wide chip hid the vault's name",
    );
    assert.equal(
      chip.initials?.display,
      "none",
      "the wide chip shows the thin rail's initials mark",
    );
    assert.notEqual(chip.chevronDisplay, "none", "the wide chip lost its chevron");
    assert.equal(chip.tag, "button", `the chip is a ${chip.tag}, not a button`);
    assert.equal(
      chip.haspopup,
      "dialog",
      "the chip does not raise the vault switcher dialog",
    );
    assert.equal(chip.ariaExpanded, "false", "the chip says its dialog is already open");
    assert.equal(
      chip.title,
      "Switch vault",
      `the chip's title is ${JSON.stringify(chip.title)}`,
    );
    assert.ok(
      (chip.ariaLabel ?? "").includes(report.vaultName),
      `the chip's accessible name (${JSON.stringify(chip.ariaLabel)}) does not carry the vault's name`,
    );
    // Quiet neutral fill and the palette's mid ink: the chip is still a shape on
    // the mat — not the rail's own surface, not the old square strip tab — but
    // changing the vault is a rare errand, so it must not wear the accent the
    // page's real actions wear.
    assert.ok(
      alpha(chip.background) > 0.05 &&
        chip.background === expanded.theme.bgSubtle &&
        chip.background !== expanded.rail!.background &&
        chip.background !== expanded.theme.accent,
      `the chip's fill (${chip.background}) is not the quiet --bg-subtle (${expanded.theme.bgSubtle}) on the rail (${expanded.rail!.background})`,
    );
    assert.equal(
      chip.color,
      expanded.theme.muted,
      `the chip's ink (${chip.color}) is not the muted ink (${expanded.theme.muted}), not the accent (${expanded.theme.accent})`,
    );
    assert.notEqual(
      chip.radius,
      "0px",
      "the chip kept the old square strip tab's corners",
    );
    assert.equal(
      chip.radius,
      expanded.tokens.radiusSm,
      `the chip's radius (${chip.radius}) is not --radius-sm (${expanded.tokens.radiusSm})`,
    );
    assert.ok(
      chip.box.left >= expanded.rail!.box.left &&
        chip.box.right <= expanded.rail!.box.right,
      `the chip (${JSON.stringify(chip.box)}) leaves the rail (${JSON.stringify(expanded.rail!.box)})`,
    );
    assert.equal(
      chip.isLastControl,
      true,
      "a visible control follows the vault chip in the rail",
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
    // The chip can no longer be measured against the sheet's leading edge — it
    // lives at the foot of the rail. What replaces that claim is where the foot
    // sits: the rail's last band, under the chats section.
    assert.ok(expanded.foot && expanded.chats && expanded.rail, "the rail rendered no foot or chats section");
    assert.ok(
      expanded.foot!.box.top >= expanded.chats!.box.bottom - 1 &&
        expanded.foot!.box.bottom <= expanded.rail!.box.bottom + 1 &&
        expanded.foot!.box.left >= expanded.rail!.box.left &&
        expanded.foot!.box.right <= expanded.rail!.box.right,
      `the foot (${JSON.stringify(expanded.foot!.box)}) is not the rail's last band under the chats (${JSON.stringify(expanded.chats!.box)})`,
    );

    // The rail's box reaches over the titlebar row and paints the mat there, so
    // the sidebar runs to the window's top. Round 2 removed the strip's column
    // reservation (the chip that needed it is in the rail now), so the claim here
    // is the paint order alone: the titlebar carries no nav-column classes and the
    // rail still owns the window's top-left corner. The night ladder asserts the
    // strip's own step below the mat.
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
      (expanded.titlebarClass ?? "").includes("window-titlebar--nav-column") ||
        (expanded.titlebarClass ?? "").includes("window-titlebar--nav-collapsed"),
      false,
      `the titlebar still reserves the rail's column (${expanded.titlebarClass})`,
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
    // The sheet's retired band. The page now starts at the strip's bottom edge,
    // and the dock's header keeps the hairline that is now its own — in the same
    // 44px band as the rail's wing switcher, so the chrome rows stay level across
    // the pane seam while the page reclaims its band.
    assert.ok(expanded.chatHeader, "the dock rendered no header band");
    assert.equal(
      expanded.chatHeader.box.top,
      titlebarHeight,
      `the dock header starts at ${expanded.chatHeader.box.top}px, not the strip's bottom edge (${titlebarHeight}px)`,
    );
    assert.equal(
      expanded.chatHeader.box.bottom,
      titlebarHeight + topbarHeight,
      `the dock header ends at ${expanded.chatHeader.box.bottom}px, not ${titlebarHeight + topbarHeight}px down`,
    );
    assert.ok(
      parseFloat(expanded.chatHeader.borderBottomWidth) > 0 &&
        parseFloat(expanded.chatHeader.borderBottomWidth) <= 1,
      `the dock header lost its underline (${expanded.chatHeader.borderBottomWidth})`,
    );

    // The domain tab raised into the window strip. The sheet's `.top-bar` is gone
    // from the DOM, the page begins where the strip ends (44px higher than it did),
    // and the strip's first child is the page-ink lens holding the real switcher:
    // no-drag, flush top and bottom, centred on the strip between the rail and
    // the trailing controls.
    assert.equal(expanded.legacyTopBar, false, "a .top-bar is still in the tree");
    assert.ok(expanded.mainFirstChild, "the sheet rendered no first child");
    assert.match(
      expanded.mainFirstChild!.className,
      /shell__content/,
      `the sheet's first child is not the page column (${JSON.stringify(expanded.mainFirstChild)})`,
    );
    assert.ok(expanded.titlebar, "the shell rendered no .window-titlebar");
    assert.ok(expanded.shellContent, "the shell rendered no page column");
    assert.equal(
      expanded.shellContent!.top,
      expanded.titlebar!.bottom,
      `the page starts at ${expanded.shellContent!.top}px, not at the strip's bottom edge (${expanded.titlebar!.bottom}px)`,
    );
    assert.equal(
      expanded.shellContent!.top,
      titlebarHeight,
      `the page still starts ${expanded.shellContent!.top - titlebarHeight}px below the strip; the retired band used to put it ${topbarHeight}px further down`,
    );
    assert.equal(
      expanded.titlebarNavCollapsed,
      null,
      `the wide strip reports data-nav-collapsed=${JSON.stringify(expanded.titlebarNavCollapsed)}`,
    );
    assert.ok(expanded.lens, "the strip rendered no .window-titlebar__lens");
    const lens = expanded.lens!;
    assert.equal(lens.inTitlebar, true, "the lens is not inside the strip");
    assert.equal(lens.firstChild, true, "the lens is not the strip's first child");
    assert.equal(
      lens.box.top,
      expanded.titlebar!.top,
      `the lens starts at ${lens.box.top}px, not at the strip's top (${expanded.titlebar!.top}px)`,
    );
    assert.equal(
      lens.box.height,
      titlebarHeight,
      `the lens is ${lens.box.height}px high, not the strip's ${titlebarHeight}px`,
    );
    assert.equal(
      lens.box.bottom,
      expanded.shellContent!.top,
      `the lens ends at ${lens.box.bottom}px, not at the page's top edge (${expanded.shellContent!.top}px)`,
    );
    // The tab is centred on the strip, not pinned to the rail. Its own box is
    // the claim: the lens's centre and the strip's centre must be the same line
    // (a box has no integer centre, so one pixel of rounding is allowed).
    const lensCentre = (lens.box.left + lens.box.right) / 2;
    const stripCentre = (expanded.titlebar!.left + expanded.titlebar!.right) / 2;
    assert.ok(
      Math.abs(lensCentre - stripCentre) <= 1,
      `the lens's centre is at ${lensCentre}px, not on the strip's ${stripCentre}px centre line`,
    );
    // Centred, not merely overlapping: the tab keeps positive slack to the rail
    // beside it and to the trailing controls it must not bury.
    assert.ok(
      lens.fromRail !== null && lens.fromRail > 0,
      `the lens runs into the rail (gap ${lens.fromRail}px)`,
    );
    assert.ok(
      lens.toTrailing !== null && lens.toTrailing > 0,
      `the lens runs into the trailing controls (gap ${lens.toTrailing}px)`,
    );
    assert.ok(
      lens.box.left >= expanded.rail!.box.right,
      `the lens starts at ${lens.box.left}px, left of the rail's ${expanded.rail!.box.right}px edge`,
    );
    assert.ok(
      expanded.trailing,
      "the strip rendered no trailing cluster to measure the tab against",
    );
    assert.ok(
      lens.box.right <= expanded.trailing!.left,
      `the lens ends at ${lens.box.right}px, past the trailing cluster's ${expanded.trailing!.left}px edge`,
    );
    assert.equal(
      lens.background,
      expanded.mainBackground,
      `the lens paints ${lens.background}, not the page canvas (${expanded.mainBackground})`,
    );
    assert.equal(
      lens.appRegion,
      "no-drag",
      `the lens is ${lens.appRegion}; a click in the tab would start a window drag`,
    );
    // The tab's connection: 8px page-ink fillets at the two bottom corners, so the
    // page flares into the strip instead of meeting it on two hard inside corners.
    for (const [side, fillet] of [
      ["leading", lens.before],
      ["trailing", lens.after],
    ] as const) {
      assert.ok(fillet, `the lens's ${side} bottom fillet is missing`);
      assert.notEqual(
        fillet!.content,
        "none",
        `the lens's ${side} fillet renders no box`,
      );
      assert.equal(
        fillet!.width,
        "8px",
        `the ${side} fillet is ${fillet!.width} wide, not 8px`,
      );
      assert.equal(
        fillet!.height,
        "8px",
        `the ${side} fillet is ${fillet!.height} high, not 8px`,
      );
      assert.equal(
        fillet!.bottom,
        "0px",
        `the ${side} fillet does not sit on the strip's bottom edge (${fillet!.bottom})`,
      );
      assert.match(
        fillet!.backgroundImage,
        /radial-gradient/,
        `the ${side} fillet is not a radial curve (${fillet!.backgroundImage})`,
      );
      assert.ok(
        gradientPaints(fillet!.backgroundImage, expanded.mainBackground!),
        `the ${side} fillet does not paint the page ink (${fillet!.backgroundImage} vs ${expanded.mainBackground})`,
      );
    }
    // The other end of the tab: the top corners are rounded by the same 8px step
    // as the fillets, with the strip visible through the notches above them. The
    // bottom corners stay square on the box because their rounding is the concave
    // flare, not a radius carved into the tab.
    assert.equal(
      lens.borderTopLeftRadius,
      "8px",
      `the lens's top-left corner is ${lens.borderTopLeftRadius}, not the 8px of its base`,
    );
    assert.equal(
      lens.borderTopRightRadius,
      "8px",
      `the lens's top-right corner is ${lens.borderTopRightRadius}, not the 8px of its base`,
    );
    assert.equal(
      lens.borderBottomLeftRadius,
      "0px",
      `the lens's bottom-left corner wears a ${lens.borderBottomLeftRadius} radius on top of its fillet`,
    );
    assert.equal(
      lens.borderBottomRightRadius,
      "0px",
      `the lens's bottom-right corner wears a ${lens.borderBottomRightRadius} radius on top of its fillet`,
    );
    const lensSwitcher = expanded.domainLens;
    assert.ok(lensSwitcher, "the lens rendered no domain switcher");
    assert.equal(
      lensSwitcher!.inLens,
      true,
      "the domain switcher is not inside the lens",
    );
    assert.ok(
      lensSwitcher!.box.top >= lens.box.top &&
        lensSwitcher!.box.bottom <= lens.box.bottom,
      `the switcher (${JSON.stringify(lensSwitcher!.box)}) leaves the lens (${JSON.stringify(lens.box)})`,
    );
    assert.ok(
      lensSwitcher!.height > 0 && lensSwitcher!.height <= titlebarHeight,
      `the switcher is ${lensSwitcher!.height}px high, over the ${titlebarHeight}px strip`,
    );
    assert.deepEqual(
      lensSwitcher!.labels,
      ["Life", ...report.domains],
      `the lens offers ${JSON.stringify(lensSwitcher!.labels)}, not Life then the vault's areas ${JSON.stringify(report.domains)}`,
    );
    assert.equal(
      lensSwitcher!.optionCount,
      report.domains.length + 1,
      `the lens exposes ${lensSwitcher!.optionCount} options, not Life plus the vault's ${report.domains.length} areas`,
    );
    // The lens's own segmented control: no outer frame inside the page-ink tab,
    // with the fill and the active tab's line still carrying it.
    assert.ok(
      expanded.lensTabs,
      "the rig did not measure the lens's segmented control",
    );
    const lensTabs = expanded.lensTabs!;
    assert.equal(
      [
        lensTabs.borderTopWidth,
        lensTabs.borderRightWidth,
        lensTabs.borderBottomWidth,
        lensTabs.borderLeftWidth,
      ].join("/"),
      "0px/0px/0px/0px",
      "the lens's control still wears the shared .ui-segmented outer frame",
    );
    assert.ok(
      alphaOf(lensTabs.background) > 0.05,
      `the lens's control lost its fill too, so it vanishes into the tab (${lensTabs.background})`,
    );
    assert.equal(
      lensTabs.optionCount,
      report.domains.length + 1,
      `the lens's control renders ${lensTabs.optionCount} options, expected Life plus the vault's ${report.domains.length} areas`,
    );
    assert.notEqual(
      lensTabs.activeBorderWidth,
      "0px",
      "the lens's active tab lost the line that marks it as the current one",
    );
    assert.ok(
      alphaOf(lensTabs.activeBackground) > 0.05,
      `the lens's active tab lost its fill (${lensTabs.activeBackground})`,
    );

    // The first-run band: the switcher is hidden below two unlocked areas, so the
    // same tab carries one inert word instead of a control. The driver opens the
    // same harness with `?areas=none` (0 unlocked) and `?areas=one` (1 unlocked);
    // both must render the quiet label, centred, in the strip's height, with no
    // segmented control — the rule is "hidden below two", not "hidden when empty".
    const quietModes = [
      { mode: "none", unlocked: 0, state: report.quiet?.none },
      { mode: "one", unlocked: 1, state: report.quiet?.one },
    ];
    for (const { mode, unlocked, state } of quietModes) {
      const label = `${mode} (${unlocked} unlocked area${unlocked === 1 ? "" : "s"})`;
      assert.ok(state, `the rig did not record the quiet lens at ${label}`);
      const quiet = state!.quietLens;
      assert.ok(quiet, `the lens rendered no quiet Life label at ${label}`);
      assert.equal(quiet!.inLens, true, `the quiet label is not inside the lens at ${label}`);
      assert.equal(
        quiet!.text,
        "Life",
        `the quiet label reads ${JSON.stringify(quiet!.text)}, not "Life" at ${label}`,
      );
      assert.equal(state!.lensHasTabs, false, `a segmented control rendered at ${label}`);
      assert.equal(state!.lensTabs, null, `the rig measured a segmented control at ${label}`);
      assert.equal(state!.domainLens?.optionCount ?? 0, 0, `the quiet lens offered options at ${label}`);
      assert.ok(
        Math.abs(quiet!.offsetFromLensCentreX) <= 2,
        `the quiet label is ${quiet!.offsetFromLensCentreX}px off the lens's centre line at ${label}`,
      );
      assert.ok(
        quiet!.height > 0 && quiet!.height <= report.tokens.titlebarHeight,
        `the quiet label is ${quiet!.height}px high in a ${report.tokens.titlebarHeight}px strip at ${label}`,
      );
      assert.ok(
        quiet!.gapAbove >= 0 && quiet!.gapBelow >= 0,
        `the quiet label leaves its tab's band: ${quiet!.gapAbove}px above, ${quiet!.gapBelow}px below at ${label}`,
      );
      assert.ok(
        (state!.lens?.fromRail ?? 0) > 0 && (state!.lens?.toTrailing ?? 0) > 0,
        `the quiet lens is not the strip's centred tab: ${JSON.stringify(
          state!.lens && {
            fromRail: state!.lens.fromRail,
            toTrailing: state!.lens.toTrailing,
          },
        )} at ${label}`,
      );
    }

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
      ["Dream", "Vision", "Ideal State"],
      "the Define wing's rows did not replace the Home wing's under the switcher",
    );
    assert.equal(
      wingSwitch.home.wingSwitcher?.active,
      "Home",
      `after clicking Home the active wing tab reads ${JSON.stringify(wingSwitch.home.wingSwitcher?.active)}`,
    );
    assert.deepEqual(
      wingSwitch.home.wingRows.map((row) => row.label),
      ["Dashboard", "Data", "Pages", "Documents", "Agents", "Images"],
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
    // The lens is centred on the strip, so narrowing the rail does not drag it
    // along: the tab holds the window's centre line at both widths, still flush
    // with the strip and the page's top edge.
    assert.equal(
      collapsed.titlebarNavCollapsed,
      "true",
      `the collapsed strip does not report data-nav-collapsed (${JSON.stringify(collapsed.titlebarNavCollapsed)})`,
    );
    assert.ok(collapsed.lens, "the thin strip rendered no domain lens");
    const collapsedLensCentre =
      (collapsed.lens!.box.left + collapsed.lens!.box.right) / 2;
    const collapsedStripCentre =
      (collapsed.titlebar!.left + collapsed.titlebar!.right) / 2;
    assert.ok(
      Math.abs(collapsedLensCentre - collapsedStripCentre) <= 1,
      `the collapsed lens's centre is at ${collapsedLensCentre}px, not on the strip's ${collapsedStripCentre}px centre line`,
    );
    assert.ok(
      Math.abs(collapsed.lens!.box.left - lens.box.left) <= 1,
      `the lens slid from ${lens.box.left}px to ${collapsed.lens!.box.left}px when the rail narrowed; a centred tab holds still`,
    );
    assert.ok(
      collapsed.lens!.fromRail !== null && collapsed.lens!.fromRail > 0,
      `the collapsed lens runs into the thin rail (gap ${collapsed.lens!.fromRail}px)`,
    );
    assert.ok(
      collapsed.lens!.toTrailing !== null && collapsed.lens!.toTrailing > 0,
      `the collapsed lens runs into the trailing controls (gap ${collapsed.lens!.toTrailing}px)`,
    );
    assert.equal(
      collapsed.lens!.box.top,
      0,
      `the collapsed lens starts at ${collapsed.lens!.box.top}px, not the strip's top`,
    );
    assert.equal(
      collapsed.lens!.box.bottom,
      collapsed.shellContent!.top,
      `the collapsed lens ends at ${collapsed.lens!.box.bottom}px, not at the page's top edge (${collapsed.shellContent!.top}px)`,
    );
    assert.equal(
      collapsed.lens!.background,
      collapsed.mainBackground,
      `the collapsed lens paints ${collapsed.lens!.background}, not the page canvas (${collapsed.mainBackground})`,
    );
    // The chip travels with the rail: thin, it stacks under the Log's icon and
    // reduces to the vault's initials. It is still the same button — the full
    // vault name stays in its accessible name, so nothing is lost but paint.
    assert.equal(
      collapsed.titlebarVault,
      null,
      `a .window-titlebar__vault appeared when the rail narrowed (${JSON.stringify(collapsed.titlebarVault)})`,
    );
    assert.equal(
      collapsed.leadingText,
      "",
      `the strip carries text once the rail is thin: "${collapsed.leadingText}"`,
    );
    assert.ok(
      collapsed.foot && collapsed.vaultChip && collapsed.rail,
      "the thin rail lost its foot or its vault chip",
    );
    assert.equal(
      collapsed.foot!.display,
      "flex",
      `the thin foot is not flex (${collapsed.foot!.display})`,
    );
    assert.equal(
      collapsed.foot!.flexDirection,
      "column",
      `the thin foot is ${collapsed.foot!.flexDirection}, not a column`,
    );
    assert.ok(collapsed.foot!.logRow, "the thin foot lost the Log row");
    assert.ok(
      collapsed.foot!.logRow!.bottom <= collapsed.vaultChip!.box.top + 1,
      `the Log row (${JSON.stringify(collapsed.foot!.logRow)}) is not above the chip (${JSON.stringify(collapsed.vaultChip!.box)})`,
    );
    // A small square mark in the icon column, not the wide row's half-width chip.
    assert.ok(
      collapsed.vaultChip!.box.width > 0 &&
        collapsed.vaultChip!.box.height > 0 &&
        Math.abs(
          collapsed.vaultChip!.box.width - collapsed.vaultChip!.box.height,
        ) <= 1 &&
        collapsed.vaultChip!.box.width >= 24 &&
        collapsed.vaultChip!.box.width <= 32,
      `the thin chip is ${collapsed.vaultChip!.box.width}x${collapsed.vaultChip!.box.height}px, not the ~28px mark`,
    );
    assert.ok(
      collapsed.vaultChip!.box.left >= collapsed.rail!.box.left &&
        collapsed.vaultChip!.box.right <= collapsed.rail!.box.right,
      `the thin chip (${JSON.stringify(collapsed.vaultChip!.box)}) leaves the rail (${JSON.stringify(collapsed.rail!.box)})`,
    );
    assert.equal(
      collapsed.vaultChip!.initials?.text,
      "HV",
      `the thin chip shows ${JSON.stringify(collapsed.vaultChip!.initials?.text)} instead of the vault's initials "HV"`,
    );
    assert.notEqual(
      collapsed.vaultChip!.initials?.display,
      "none",
      "the thin chip hid the initials",
    );
    assert.equal(
      collapsed.vaultChip!.name?.display,
      "none",
      "the thin chip still draws the full vault name",
    );
    assert.equal(
      collapsed.vaultChip!.chevronDisplay,
      "none",
      "the thin chip still draws its chevron",
    );
    assert.equal(
      collapsed.vaultChip!.tag,
      "button",
      `the thin chip is a ${collapsed.vaultChip!.tag}, not a button`,
    );
    assert.equal(
      collapsed.vaultChip!.haspopup,
      "dialog",
      "the thin chip does not raise the vault switcher dialog",
    );
    assert.equal(
      collapsed.vaultChip!.ariaExpanded,
      "false",
      "the thin chip says its dialog is already open",
    );
    assert.equal(
      collapsed.vaultChip!.title,
      "Switch vault",
      `the thin chip's title is ${JSON.stringify(collapsed.vaultChip!.title)}`,
    );
    assert.ok(
      (collapsed.vaultChip!.ariaLabel ?? "").includes(report.vaultName),
      `the thin chip's accessible name (${JSON.stringify(collapsed.vaultChip!.ariaLabel)}) lost the vault's name`,
    );
    assert.ok(
      alpha(collapsed.vaultChip!.background) > 0.05 &&
        collapsed.vaultChip!.background === collapsed.theme.bgSubtle &&
        collapsed.vaultChip!.background !== collapsed.rail!.background,
      `the thin chip's fill (${collapsed.vaultChip!.background}) is not the quiet --bg-subtle (${collapsed.theme.bgSubtle}) on the rail (${collapsed.rail!.background})`,
    );
    assert.notEqual(
      collapsed.vaultChip!.radius,
      "0px",
      "the thin chip kept the old square strip tab's corners",
    );
    assert.equal(
      collapsed.vaultChip!.isLastControl,
      true,
      "a visible control follows the vault chip in the thin rail",
    );
    assert.equal(
      collapsed.main?.left,
      collapsedTrack,
      `the sheet starts at ${collapsed.main?.left}px, not the thin rail's ${collapsedTrack}px`,
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

    // The thin rail keeps its first level of navigation: the five-wing switcher
    // turns vertical in the icon column rather than disappearing. The labelled
    // chats section and the row labels still leave, and the page rows stay.
    assert.notEqual(
      collapsed.wingsBand,
      null,
      "the thin rail lost its wing switcher's band",
    );
    assert.notEqual(
      collapsed.wingsBand!.display,
      "none",
      `the thin rail hid the wing switcher's band (${collapsed.wingsBand!.display})`,
    );
    assert.ok(
      collapsed.wingSwitcher,
      "the thin rail rendered no wing switcher",
    );
    assert.equal(
      collapsed.wingSwitcher!.flexDirection,
      "column",
      `the thin wing switcher is ${collapsed.wingSwitcher!.flexDirection}, not vertical`,
    );
    assert.equal(
      collapsed.wingSwitcher!.optionCount,
      5,
      `the thin wing switcher rendered ${collapsed.wingSwitcher!.optionCount} options`,
    );
    assert.deepEqual(
      collapsed.wingSwitcher!.labels,
      ["Home", "Define", "Plan", "Act", "Review"],
      "the thin wing switcher is not the five wings in order",
    );
    // All five in ONE column, inside the rail: same left/right edge, strictly
    // increasing tops, every box on screen. A control merely set to
    // `flex-direction: column` with no vertical room would fail the last part.
    const stacked = collapsed.wingSwitcher!.options;
    assert.equal(
      stacked.length,
      5,
      `the thin wing switcher exposed ${stacked.length} option boxes`,
    );
    for (const [index, option] of stacked.entries()) {
      assert.ok(
        option.box.width > 0 && option.box.height > 0,
        `the thin wing switcher's "${option.label}" option has no box`,
      );
      assert.ok(
        option.box.left >= collapsed.rail!.box.left &&
          option.box.right <= collapsed.rail!.box.right,
        `the wing option "${option.label}" (${JSON.stringify(option.box)}) leaves the rail`,
      );
      assert.ok(
        Math.abs(option.box.left - stacked[0].box.left) <= 1 &&
          Math.abs(option.box.right - stacked[0].box.right) <= 1,
        `the wing option "${option.label}" is not in the same column as the first`,
      );
      if (index > 0) {
        assert.ok(
          option.box.top >= stacked[index - 1].box.bottom,
          `the wing options "${stacked[index - 1].label}" and "${option.label}" overlap vertically`,
        );
      }
    }
    assert.equal(
      collapsed.wingSwitcher!.active,
      "Home",
      `the thin wing switcher marks ${JSON.stringify(collapsed.wingSwitcher!.active)} as active`,
    );
    assert.equal(
      stacked.filter((option) => option.active).length,
      1,
      "the thin wing switcher marks more than one wing as active",
    );
    // Square in the thin layout too, and still centred: the icon column's own
    // padding is the thin, equal margin on either side of the block.
    assert.equal(
      collapsed.wingSwitcher!.borderRadius,
      "0px",
      `the thin wing switcher kept a rounded frame (${collapsed.wingSwitcher!.borderRadius})`,
    );
    for (const option of stacked) {
      assert.equal(
        option.borderRadius,
        "0px",
        `the thin wing switcher's "${option.label}" tab kept a rounded corner (${option.borderRadius})`,
      );
    }
    assert.ok(
      Math.abs(
        collapsed.wingSwitcher!.box.left -
          collapsed.rail!.box.left -
          (collapsed.rail!.box.right - collapsed.wingSwitcher!.box.right),
      ) <= 1 &&
        collapsed.wingSwitcher!.box.left - collapsed.rail!.box.left >= 3 &&
        collapsed.rail!.box.right - collapsed.wingSwitcher!.box.right >= 3 &&
        collapsed.wingSwitcher!.box.left === collapsed.wingsBand!.box.left &&
        collapsed.wingSwitcher!.box.right === collapsed.wingsBand!.box.right,
      `the thin switcher (${JSON.stringify(collapsed.wingSwitcher!.box)}) is not the band's centred block in the rail (${JSON.stringify(collapsed.rail!.box)}), band ${JSON.stringify(collapsed.wingsBand!.box)}`,
    );
    // In 56px the words are the tight dimension: every tab must keep enough
    // padding for its rule to sit clear of its label, and no label may overflow.
    for (const option of stacked) {
      assert.ok(
        option.padding.top >= 5 &&
          option.padding.bottom >= 5 &&
          option.padding.left >= 1 &&
          option.padding.right >= 1,
        `the thin wing switcher's "${option.label}" tab has tight padding (${JSON.stringify(option.padding)})`,
      );
      assert.ok(
        option.scrollWidth <= option.clientWidth,
        `the thin wing switcher's "${option.label}" word overflows its ${option.clientWidth}px tab (${option.scrollWidth}px)`,
      );
    }
    // The band sits under the rail's header, and the active wing's page icons
    // begin underneath it.
    assert.ok(collapsed.firstLink, "the thin rail rendered no page rows");
    assert.ok(
      collapsed.wingsBand!.box.top >= (collapsed.header?.box.bottom ?? 0) - 1,
      `the thin band (${JSON.stringify(collapsed.wingsBand!.box)}) starts above the header's bottom (${collapsed.header?.box.bottom}px)`,
    );
    assert.ok(
      collapsed.firstLink!.top >= collapsed.wingsBand!.box.bottom - 1,
      `the thin rail's first page row (${collapsed.firstLink!.top}px) starts above the wing switcher's band (${collapsed.wingsBand!.box.bottom}px)`,
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
    // The strip's state signal and the lens's offset come back with the rail: the
    // tab travels with the chrome in both directions.
    assert.equal(
      restored.titlebarNavCollapsed,
      null,
      `reopening left data-nav-collapsed=${JSON.stringify(restored.titlebarNavCollapsed)} on the strip`,
    );
    assert.deepEqual(
      restored.lens?.box,
      expanded.lens?.box,
      "reopening did not restore the lens's wide offset",
    );
    assert.deepEqual(
      restored.vaultChip?.box,
      expanded.vaultChip?.box,
      "reopening did not restore the chip's box in the rail's foot",
    );
    assert.equal(
      restored.foot?.flexDirection,
      "row",
      `reopening left the foot in ${restored.foot?.flexDirection} instead of one row`,
    );
    assert.equal(
      restored.vaultChip?.name?.display,
      "block",
      "reopening did not bring the chip's full name back",
    );
    assert.equal(
      restored.vaultChip?.initials?.display,
      "none",
      "reopening left the thin rail's initials mark showing",
    );
    assert.equal(
      restored.wingSwitcher?.flexDirection,
      "row",
      `reopening left the wing switcher ${restored.wingSwitcher?.flexDirection} instead of horizontal`,
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
    assert.equal(ladder.night.skin, "forge", "the night rig is not on Forge");
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
    // Forge's own band sits *under* its cards, so its sidebar and strip are the
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
    // palette — the one nobody ships — cannot pass as Forge.
    assert.equal(ladder.day.skin, "forge", "the day rig is not on Forge");
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
