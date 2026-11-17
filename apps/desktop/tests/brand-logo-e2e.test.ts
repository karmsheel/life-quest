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
const REPORT = path.join(desktopRoot, "e2e/artifacts/brand-logo.json");
/** The wordmark artwork's own ink box, repeated so the claim is readable here. */
const WORDMARK_RATIO = 872.25 / 162.45;

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type BrandSample = {
  box: Box;
  role: string | null;
  label: string | null;
  inHeader: boolean;
  display: string;
  background: string;
  ink: string;
  maskImage: string | null;
  maskRepeat: string | null;
  maskPosition: string | null;
  maskSize: string | null;
};

type State = {
  viewport: { width: number; height: number };
  rail: Box | null;
  header: Box | null;
  toggle: Box | null;
  firstLink: Box | null;
  brand: BrandSample | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  vaultName?: string;
  expanded?: State;
  day?: State;
  collapsed?: State;
  icon?: {
    png: { width: number; height: number } | null;
    ico: { signature: number; type: number; count: number; sizes: number[] };
    builder: { masterNamed: boolean; windowsNamed: boolean };
  };
  screenshots: string[];
};

/**
 * The rig measures the real shell in a real Electron window, so it needs the
 * Vite dev server — the same posture as the shell sidebar rig. With the server
 * down the test skips; `npm run dev` in another shell turns it on.
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

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/brand-logo.electron.mjs")],
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

/** A PNG's width/height from its IHDR, so "the artifact exists" is not enough. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${file} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("brand logo (shell header and app icon)", () => {
  it("paints the official wordmark at the top of the rail and ships the emblem-only app icon", async (t) => {
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

    // The driver's own failures first: the geometry below is only meaningful if
    // the rig did not throw on its way to the sample.
    assert.deepEqual(report.failures, [], "the brand rig reported failures");
    assert.equal(report.pass, true, "the brand rig did not pass");
    assert.equal(exitCode, 0, "the brand rig exited non-zero");

    const expanded = report.expanded;
    const brand = expanded?.brand;
    assert.ok(expanded, "the rig wrote no wide sample");
    assert.ok(brand, "the rail's header carries no .nav-rail__brand");

    // The official file, painted as a mask so the rail's ink carries it.
    assert.equal(brand.role, "img", "the wordmark is not exposed as an image");
    assert.equal(brand.label, "LifeQuest", "the wordmark is not named LifeQuest");
    assert.equal(brand.inHeader, true, "the wordmark is outside the rail's header");
    assert.match(
      brand.maskImage ?? "",
      /lifequest-wordmark/,
      "the header mark is not painted from the official wordmark SVG",
    );
    assert.doesNotMatch(
      brand.maskImage ?? "",
      /data:/,
      "the wordmark is a baked data URL, not the shipped asset",
    );
    assert.equal(brand.maskRepeat, "no-repeat", "the wordmark tile is not contained");
    assert.equal(brand.maskSize, "contain", "the wordmark is not contained in its box");
    assert.equal(
      brand.background,
      brand.ink,
      `the wordmark's ink ${brand.background} is not the rail's --fg ${brand.ink}`,
    );

    // The same element, re-inked by the day palette: the mask takes the rail's
    // ink in both modes, and the two inks really differ.
    const day = report.day;
    assert.ok(day?.brand, "the rig wrote no day-palette sample");
    assert.notEqual(day?.brand?.display, "none", "the day rail dropped the wordmark");
    assert.equal(
      day?.brand?.background,
      day?.brand?.ink,
      `the day wordmark's fill ${day?.brand?.background} is not the day --fg ${day?.brand?.ink}`,
    );
    assert.notEqual(
      day?.brand?.background,
      brand.background,
      `the wordmark is the same colour in day and night (${brand.background})`,
    );

    // The artwork's own proportions, and the rail's content edge.
    assert.ok(
      brand.box.height >= 18 && brand.box.height <= 24,
      `the wordmark is ${brand.box.height}px tall, outside the strip's 18–24px band`,
    );
    assert.ok(
      Math.abs(brand.box.width / brand.box.height - WORDMARK_RATIO) < 0.15,
      `the wordmark's box ${brand.box.width}x${brand.box.height} does not keep the artwork's ${WORDMARK_RATIO.toFixed(2)} ratio`,
    );
    assert.ok(expanded?.firstLink, "the rail has no navigation rows to align against");
    assert.ok(
      Math.abs(brand.box.left - (expanded?.firstLink?.left ?? -1)) <= 1,
      `the wordmark starts at ${brand.box.left}px, the rail's first row at ${expanded?.firstLink?.left}px`,
    );
    assert.ok(
      expanded?.toggle && brand.box.right < expanded.toggle.left,
      "the wordmark runs into the collapse toggle",
    );
    assert.ok(
      expanded?.header &&
        brand.box.top >= expanded.header.top &&
        brand.box.bottom <= expanded.header.bottom,
      "the wordmark is not inside the window strip",
    );

    // The thin rail leaves the word out; the toggle keeps the band, centred.
    const collapsed = report.collapsed;
    assert.ok(collapsed, "the rig wrote no collapsed sample");
    assert.equal(collapsed?.rail?.width, 56, "the collapsed rail is not the 56px icon column");
    assert.equal(
      collapsed?.brand?.display,
      "none",
      "the thin rail still draws the wordmark",
    );
    assert.ok(collapsed?.header && collapsed?.toggle, "the thin rail lost its band");
    const toggleCentre =
      ((collapsed?.toggle?.left ?? 0) + (collapsed?.toggle?.right ?? 0)) / 2;
    const headerCentre =
      ((collapsed?.header?.left ?? 0) + (collapsed?.header?.right ?? 0)) / 2;
    assert.ok(
      Math.abs(toggleCentre - headerCentre) <= 1,
      `the thin band's toggle is at ${toggleCentre}px, the band's centre at ${headerCentre}px`,
    );

    // The app icon: emblem-only master 1024px, multi-size ICO, wired in config.
    const icon = report.icon;
    assert.ok(icon, "the rig wrote no icon facts");
    assert.deepEqual(
      icon?.png,
      { width: 1024, height: 1024 },
      "the app icon master is not the 1024px emblem-only square",
    );
    assert.equal(icon?.ico.signature, 0, "the Windows icon is not an ICO");
    assert.equal(icon?.ico.type, 1, "the Windows icon is not an icon file");
    assert.ok(
      (icon?.ico.sizes.length ?? 0) >= 6 &&
        Math.max(...(icon?.ico.sizes ?? [0])) === 256 &&
        icon?.ico.sizes.includes(16) &&
        icon?.ico.sizes.includes(32),
      `the Windows icon's entries are ${JSON.stringify(icon?.ico.sizes)}`,
    );
    assert.equal(
      icon?.builder.masterNamed,
      true,
      "electron-builder.yml does not name build/icon.png",
    );
    assert.equal(
      icon?.builder.windowsNamed,
      true,
      "electron-builder.yml does not name build/icon.ico",
    );

    // The screenshots: the shipped header at 1:1 in both rails, and the shell it
    // sits in. The wide crop must be the rail's own width, not a hand-made tile.
    const [wide, shell, thin] = report.screenshots;
    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `${file} is missing`);
      // A flat, mostly dark band compresses to well under a kilobyte, so
      // "artefact exists" is a decoded PNG with real pixels, not a byte count.
      const size = pngSize(file);
      assert.ok(size.width > 0 && size.height > 0, `${file} has no pixels`);
    }
    const wideSize = pngSize(wide);
    assert.equal(
      wideSize.width,
      expanded?.rail?.width,
      "the wide wordmark artifact is not the rail's width",
    );
    assert.equal(pngSize(thin).width, expanded?.rail?.width, "the thin artifact is not the rail's width");
    assert.ok(pngSize(shell).width >= 1200, "the shell artifact is not the full window");
  });
});
