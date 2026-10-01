import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

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
  tokens: { track: number; frame: number; titlebarHeight: number };
  rail: {
    box: Box;
    marginTop: string;
    borderRightWidth: string;
    borderLeftWidth: string;
    borderRadius: string;
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
  main: Box | null;
  corner: { insideRail: boolean; insideTitlebar: boolean } | null;
  overflow: { scrollWidth: number; clientWidth: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  vaultName: string;
  tokens: State["tokens"];
  expanded: State;
  collapsed: State;
  restored: State;
  reclaimedPx: number;
  screenshots: string[];
};

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
    assert.equal(
      expanded.rail.borderLeftWidth,
      "0px",
      "rail grew a leading border",
    );
    assert.ok(
      parseFloat(expanded.rail.borderRightWidth) > 0 &&
        parseFloat(expanded.rail.borderRightWidth) <= 1,
      `rail lost its trailing hairline (${expanded.rail.borderRightWidth})`,
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
    assert.ok(expanded.firstLink, "rail rendered no nav rows");
    assert.ok(
      expanded.firstLink.top >= expanded.header.box.bottom,
      "nav rows overlap the topband",
    );
    assert.equal(
      expanded.railToggle?.box.left,
      Math.round((track - (expanded.railToggle?.box.width ?? 0)) / 2),
      "the toggle is not centred in the rail column",
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
    assert.equal(
      expanded.main?.left,
      track + frame,
      "the sheet is not one pane gap past the rail",
    );
    assert.equal(
      expanded.rail?.box.right !== undefined &&
        expanded.chat?.left !== undefined &&
        expanded.main?.right !== undefined
        ? expanded.main.left - expanded.rail.box.right ===
            expanded.chat.left - expanded.main.right
        : false,
      true,
      "the rail→sheet and sheet→chat gaps disagree",
    );
    assert.equal(
      expanded.vault?.box.left,
      expanded.main?.left,
      "the chip's leading border does not line up with the sheet's",
    );

    // Collapsed: rail gone, its width back to the sheet, a toggle left behind.
    assert.ok(
      collapsed.rail === null || collapsed.railDisplay === "none",
      "collapsing left the rail on screen",
    );
    assert.equal(
      collapsed.main?.left,
      frame,
      "the sheet did not reclaim the collapsed column",
    );
    assert.equal(
      collapsed.titlebarToggle?.label,
      "Expand sidebar",
      "no reopen toggle in the titlebar",
    );
    assert.deepEqual(
      collapsed.titlebarToggle?.box,
      expanded.railToggle?.box,
      "the toggle moved between the open and closed states",
    );
    assert.deepEqual(
      collapsed.vault?.box,
      expanded.vault?.box,
      "the vault chip moved between the open and closed states",
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
      collapsed.chat.left - (collapsed.main?.right ?? 0),
      frame,
      "collapsing the rail ate the sheet's gap to the chat panel",
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
