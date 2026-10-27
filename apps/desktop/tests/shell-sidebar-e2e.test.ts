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
  tokens: { track: number; frame: number; titlebarHeight: number; radiusSm: string };
  theme: {
    dataTheme: string | null;
    skin: string | null;
    canvasBase: string;
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
    appRegion: string;
    controls: { tag: string; label: string | null }[];
  } | null;
  railToggle: { label: string | null; box: Box; appRegion: string } | null;
  titlebarToggle: { label: string | null; box: Box } | null;
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
    inRail: boolean;
    title: string;
    newChat: boolean;
    scrollRegion: string;
  } | null;
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
   * The band's two selectors, the wing switcher and the domain lens. Each is a
   * `.ui-segmented`, whose shared rule framed the whole control one pixel outside
   * the active tab's own line.
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
  day: State;
  ladder: { night: Ladder; day: Ladder; skins: Record<string, Ladder> };
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
  it("docks the rail flush to the window and collapses back into the titlebar", async (t) => {
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
    const { track, frame, titlebarHeight } = report.tokens;

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

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
    // Border widths are read back in CSS px, which Chromium snaps to whole
    // device px — on a 125%-scaled display a 1px hairline computes as 0.8px.
    // The rail is a flush, square pane that paints no line of its own: the
    // sheet's frame is the seam's single divider, so a trailing hairline here
    // would double it.
    for (const [side, width] of [
      ["top", expanded.rail.borderTopWidth],
      ["right", expanded.rail.borderRightWidth],
      ["bottom", expanded.rail.borderBottomWidth],
      ["left", expanded.rail.borderLeftWidth],
    ] as const) {
      assert.equal(
        width,
        "0px",
        `rail grew a ${side} border (${width}) — the sheet draws that seam`,
      );
    }

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
    assert.ok(expanded.firstLink, "rail rendered no nav rows");
    assert.ok(
      expanded.firstLink.top >= expanded.header.box.bottom,
      "nav rows overlap the topband",
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

    // The chrome is one band of mat: the rail that wraps the sheet's leading edge
    // wears the very fill the titlebar across the top does, with no frost of its
    // own left between them.
    assert.equal(
      expanded.rail?.background,
      expanded.titlebarBackground,
      `the rail (${expanded.rail?.background}) is not wearing the titlebar's fill (${expanded.titlebarBackground})`,
    );
    assert.equal(
      expanded.rail?.backdropFilter,
      "none",
      `the rail is still frosted (${expanded.rail?.backdropFilter})`,
    );

    // The sheet's own chrome: square, and carrying the studio's one hairline —
    // its trailing edge, the seam with the dock.
    assert.ok(expanded.sheet, "the shell rendered no workspace sheet");
    // One rounded corner — the leading top, beside the wing selector's first tab —
    // and three square ones.
    assert.equal(
      expanded.sheet.borderTopLeftRadius,
      expanded.tokens.radiusSm,
      `the sheet's leading top corner is not the system radius (${expanded.sheet.borderTopLeftRadius} vs ${expanded.tokens.radiusSm})`,
    );
    for (const [corner, radius] of [
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
      titlebarHeight + frame,
      `the sheet's top edge is not one pane gap under the strip (${expanded.sheet.box.top}px vs ${titlebarHeight + frame}px)`,
    );
    // The rail meets the sheet with no line between them, and the dock paints none
    // of its own on any edge.
    assert.equal(
      expanded.rail.borderRightWidth === "0px" &&
        expanded.sheet.borderLeftWidth === "0px" &&
        expanded.chat.borderTopWidth === "0px" &&
        expanded.chat.borderRightWidth === "0px" &&
        expanded.chat.borderBottomWidth === "0px" &&
        expanded.chat.borderLeftWidth === "0px",
      true,
      `rail right ${expanded.rail.borderRightWidth}, sheet left ${expanded.sheet.borderLeftWidth}, dock t/r/b/l ${expanded.chat.borderTopWidth}/${expanded.chat.borderRightWidth}/${expanded.chat.borderBottomWidth}/${expanded.chat.borderLeftWidth}`,
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

    // Neither of the band's two selectors wears a frame of its own. The frame is
    // what the pair doubled: `.ui-segmented`'s hairline sits one pixel outside the
    // active tab's own, so the wing switcher and the domain lens read as two
    // concentric outlines in a row. The control must still read as one without it
    // — its fill separates it from the band, and the active tab keeps its line.
    assert.equal(
      expanded.topBarSelectors?.length,
      2,
      `the rig did not measure both of the band's selectors: ${JSON.stringify(expanded.topBarSelectors)}`,
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

    // Collapsed: rail gone, its width back to the sheet, a toggle left behind.
    assert.ok(
      collapsed.rail === null || collapsed.railDisplay === "none",
      "collapsing left the rail on screen",
    );
    // The sidebar's column is reclaimed, and the chip comes to the window's own
    // leading edge with the re-open toggle in front of it.
    assert.equal(
      collapsed.main?.left,
      0,
      "the sheet did not reclaim the collapsed sidebar's column",
    );
    assert.ok(
      collapsed.vault && expanded.vault,
      "the strip lost the vault chip in one of the two states",
    );
    assert.ok(
      collapsed.vault!.box.left < expanded.vault!.box.left,
      `the chip stayed at ${collapsed.vault!.box.left}px instead of coming to the leading edge`,
    );
    assert.ok(
      collapsed.vault!.box.left <= 48,
      `the chip sits ${collapsed.vault!.box.left}px in, not at the window's leading edge`,
    );
    assert.equal(
      collapsed.titlebarToggle?.label,
      "Expand sidebar",
      "no reopen toggle in the titlebar",
    );
    assert.notDeepEqual(
      collapsed.vault?.box,
      expanded.vault?.box,
      "the vault chip did not take the leading edge when the sidebar went",
    );
    assert.equal(
      collapsed.vault?.text,
      report.vaultName,
      "the vault name left the strip when the rail collapsed",
    );
    assert.equal(
      collapsed.corner?.insideTitlebar,
      true,
      "the window's top-left corner is not painted by the titlebar once collapsed",
    );
    assert.equal(
      report.reclaimedPx,
      track,
      "unexpected reclaimed width",
    );

    // Round trip: same rail box, same offsets.
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
      collapsed.chat.box.left - (collapsed.main?.right ?? 0),
      0,
      "collapsing the rail opened a gap between the sheet and the dock",
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
      titlebarHeight + frame,
      `the panel's top edge is not level with the sheet's (${expanded.chat.box.top}px vs ${titlebarHeight + frame}px)`,
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
    // step up off it, and the chrome band wears the dock's own quiet band. A skin
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
      ladder.night.surfaces.chrome,
      ladder.night.surfaces.dockActions,
      `the mat does not wear the dock's action band: mat ${ladder.night.surfaces.chrome} vs .chat-panel__actions ${ladder.night.surfaces.dockActions}`,
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
    // cannot land without being measured, and each palette is held to the four
    // claims: the page canvas is the deepest surface, the cards step up off it, the
    // mat is its own ink, and the mat and the dock's action row are one material.
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
        skin.surfaces.chrome,
        skin.surfaces.dockActions,
        `${name}: the mat does not wear the dock's action band (${skin.surfaces.chrome} vs ${skin.surfaces.dockActions})`,
      );
      assert.equal(
        skin.tokens.canvasBase,
        skin.tokens.mutedSurface,
        `${name}: --canvas-base and --muted-surface are different inks (${skin.tokens.canvasBase} vs ${skin.tokens.mutedSurface})`,
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
