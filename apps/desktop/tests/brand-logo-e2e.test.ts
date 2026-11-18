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
  variant: string;
  role: string | null;
  label: string | null;
  viewBox: string | null;
  inBand: boolean;
  fills: { life: string | null; icon: string | null; uest: string | null };
};

type Tokens = { life: string; icon: string; uest: string };

type State = {
  viewport: { width: number; height: number };
  rail: Box | null;
  header: Box | null;
  toggle: Box | null;
  firstLink: Box | null;
  band: Box | null;
  bandDisplay: string | null;
  brand: BrandSample | null;
  tokens: Tokens;
  storedLogo: string | null;
  overlay: boolean;
  developer: {
    optionCount: number;
    labels: string[];
    ids: string[];
    active: string | null;
  } | null;
};

type SplashState = {
  hasSplash: boolean;
  dataLogo: string | null;
  variantCount: number;
  variants: string[];
  visibleVariant: string | null;
  role: string | null;
  label: string | null;
  fills: { life: string | null; icon: string | null; uest: string | null };
  tokens: Tokens;
  hidden: boolean;
};

type Report = {
  pass: boolean;
  failures: string[];
  vaultName?: string;
  expanded?: State;
  day?: State;
  nous?: State;
  collapsed?: State;
  afterPick?: State;
  reloaded?: State;
  splashDefault?: SplashState;
  splashSelected?: SplashState;
  icon?: {
    png: { width: number; height: number } | null;
    ico: { signature: number; type: number; count: number; sizes: number[] };
    builder: { masterNamed: boolean; windowsNamed: boolean };
  };
  screenshots: string[];
};

/** A token as the `rgb()` string a computed fill reports. */
function cssColor(value: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return value.trim();
  const full =
    hex[1].length === 3
      ? hex[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

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
      { cwd: desktopRoot, timeout: 240_000 },
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

describe("brand logo (rail lockup, Developer pick, splash, app icon)", () => {
  it("draws the picked lockup from the theme's three inks in the rail and on the splash", async (t) => {
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

    // The default: the supplied Modern lockup, no stored pick, in the rail band
    // under the window strip, painted from the theme tokens.
    const expanded = report.expanded;
    const brand = expanded?.brand;
    assert.ok(expanded, "the rig wrote no wide sample");
    assert.ok(brand, "the rail carries no .lifequest-logo");
    assert.equal(expanded?.storedLogo, null, "a logo pick was stored before any press");
    assert.equal(brand.variant, "minimal", "the rail is not wearing the default Minimal lockup");
    assert.equal(brand.inBand, true, "the lockup is not in the rail's brand band");
    assert.equal(brand.role, "img", "the lockup is not exposed as an image");
    assert.equal(brand.label, "LifeQuest", "the lockup is not named LifeQuest");
    assert.equal(brand.viewBox, "47.19 39 1059.6 161.78", "the lockup is not the supplied Minimal art");
    assert.ok(
      brand.box.height >= 20 && brand.box.width > brand.box.height,
      `the lockup is ${brand.box.width}x${brand.box.height}px, outside the band's shape`,
    );
    // A 10% inset on every side: the band is the rail's content width and its
    // padding is the gap around the lockup.
    assert.ok(expanded?.band, "the rail has no brand band to measure");
    const insetX =
      (expanded.band.width - brand.box.width) / 2 / expanded.band.width;
    const insetY =
      (expanded.band.height - brand.box.height) / 2 / brand.box.height;
    assert.ok(
      Math.abs(insetX - 0.1) <= 0.01,
      `the lockup's side inset is ${(insetX * 100).toFixed(1)}%, not 10%`,
    );
    assert.ok(
      Math.abs(insetY - 0.1) <= 0.03,
      `the lockup's top/bottom inset is ${(insetY * 100).toFixed(1)}% of its height, not 10%`,
    );
    assert.ok(
      Math.abs(brand.box.width / brand.box.height - 1059.6 / 161.78) < 0.15,
      `the lockup's box ${brand.box.width}x${brand.box.height} does not keep the artwork's 553:160 ratio`,
    );
    assert.ok(expanded?.band && expanded?.header && expanded?.firstLink, "the rail has no band to measure");
    assert.ok(
      expanded.band.top >= expanded.header.bottom - 1 &&
        expanded.band.bottom <= expanded.firstLink.top,
      `the band ${JSON.stringify(expanded.band)} is not between the strip ${JSON.stringify(expanded.header)} and the first row ${JSON.stringify(expanded.firstLink)}`,
    );
    assert.deepEqual(
      brand.fills,
      {
        life: cssColor(expanded.tokens.life),
        icon: cssColor(expanded.tokens.icon),
        uest: cssColor(expanded.tokens.uest),
      },
      "the lockup's three groups are not painted from --life-color/--icon-color/--uest-color",
    );
    assert.deepEqual(
      {
        life: expanded.tokens.life.toLowerCase(),
        icon: expanded.tokens.icon.toLowerCase(),
        uest: expanded.tokens.uest.toLowerCase(),
      },
      { life: "#f8e5c8", icon: "#c66a3d", uest: "#f8e5c8" },
      "the forge night palette does not draw both words cream and the emblem ember",
    );

    // Day: derived inks, and the fills follow them.
    const day = report.day;
    assert.ok(day?.brand, "the rig wrote no day-palette sample");
    assert.deepEqual(
      {
        life: day?.tokens.life.toLowerCase(),
        icon: day?.tokens.icon.toLowerCase(),
        uest: day?.tokens.uest.toLowerCase(),
      },
      { life: "#1e1e22", icon: "#b4532a", uest: "#1e1e22" },
      "the day palette did not derive dark logo inks",
    );
    assert.deepEqual(
      day?.brand?.fills,
      {
        life: cssColor(day?.tokens.life ?? ""),
        icon: cssColor(day?.tokens.icon ?? ""),
        uest: cssColor(day?.tokens.uest ?? ""),
      },
      "the day lockup's fills do not follow the day tokens",
    );
    assert.notEqual(day?.brand?.fills.life, brand.fills.life, "day and night draw the same LIFE ink");
    assert.notEqual(day?.brand?.fills.uest, brand.fills.uest, "day and night draw the same UEST ink");

    // A second skin re-inks the mark too.
    const nous = report.nous;
    assert.ok(nous?.brand, "the rig wrote no second-skin sample");
    assert.equal(
      nous?.brand?.fills.life,
      cssColor(nous?.tokens.life ?? ""),
      "the second skin's LIFE fill is not its token",
    );
    assert.notEqual(nous?.tokens.life, expanded?.tokens.life, "the second skin did not move the LIFE ink");
    assert.notEqual(nous?.tokens.icon, expanded?.tokens.icon, "the second skin did not move the emblem ink");

    // Collapsed: the rail is the icon column and the lockup's band is gone.
    const collapsed = report.collapsed;
    assert.ok(collapsed, "the rig wrote no collapsed sample");
    assert.equal(collapsed?.rail?.width, 56, "the collapsed rail is not the 56px icon column");
    assert.equal(collapsed?.bandDisplay, "none", "the thin rail still draws the lockup's band");

    // Developer: four options, Modern active; a press changes the rail behind the
    // sheet, stores the pick, and the next mount keeps it.
    const afterPick = report.afterPick;
    assert.ok(afterPick, "the rig wrote no sample after the pick");
    assert.equal(afterPick?.storedLogo, "classic", "the Classic pick was not stored");
    assert.equal(afterPick?.developer?.active, "classic", "the picker does not mark Classic");
    assert.equal(
      afterPick?.brand?.variant,
      "classic",
      "the rail behind the sheet did not repaint to Classic",
    );
    assert.equal(
      afterPick?.brand?.viewBox,
      "69.41 38 906.85 173.77",
      "the rail behind the sheet is not the supplied Classic art",
    );
    const reloaded = report.reloaded;
    assert.equal(reloaded?.brand?.variant, "classic", "the pick did not survive a reload");
    assert.equal(reloaded?.storedLogo, "classic", "the stored pick did not survive a reload");

    // The splash: all four lockups are in the boot page, exactly one is shown,
    // the default before a pick and the picked one after it.
    const splashDefault = report.splashDefault;
    assert.ok(splashDefault, "the rig wrote no default splash sample");
    assert.equal(splashDefault?.hasSplash, true, "the boot page has no splash");
    assert.equal(splashDefault?.variantCount, 4, "the splash does not carry all four lockups");
    assert.deepEqual(
      splashDefault?.variants,
      ["modern", "athletic", "classic", "minimal"],
      "the splash's lockups are not the shipped four",
    );
    assert.equal(splashDefault?.dataLogo, "minimal", "the default splash is not Minimal");
    assert.equal(splashDefault?.visibleVariant, "minimal", "the default splash shows another lockup");
    assert.equal(splashDefault?.role, "img", "the splash's lockup is not exposed as an image");
    assert.equal(splashDefault?.label, "LifeQuest", "the splash's lockup is not named LifeQuest");
    assert.deepEqual(
      splashDefault?.fills,
      { life: "rgb(248, 229, 200)", icon: "rgb(198, 106, 61)", uest: "rgb(248, 229, 200)" },
      "the splash's lockup is not the brand trio on the dark boot",
    );
    const splashSelected = report.splashSelected;
    assert.equal(splashSelected?.dataLogo, "classic", "the picked splash is not Classic");
    assert.equal(splashSelected?.visibleVariant, "classic", "the picked splash shows another lockup");

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
    assert.equal(icon?.builder.masterNamed, true, "electron-builder.yml does not name build/icon.png");
    assert.equal(icon?.builder.windowsNamed, true, "electron-builder.yml does not name build/icon.ico");

    // The screenshots: the shipped rail header in both rails, the Developer bench,
    // and both splash states. The crops are the rail's own width, not hand-made tiles.
    const [wide, shell, thin, developer, splashDefaultShot, splashSelectedShot] =
      report.screenshots;
    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `${file} is missing`);
      const size = pngSize(file);
      assert.ok(size.width > 0 && size.height > 0, `${file} has no pixels`);
    }
    assert.equal(
      pngSize(wide).width,
      expanded?.rail?.width,
      "the wide lockup artifact is not the rail's width",
    );
    assert.equal(
      pngSize(thin).width,
      collapsed?.rail?.width,
      "the thin lockup artifact is not the collapsed rail's width",
    );
    assert.ok(pngSize(shell).width >= 1200, "the shell artifact is not the full window");
    assert.ok(pngSize(developer).width >= 1200, "the Developer artifact is not the full window");
    assert.ok(
      pngSize(splashDefaultShot).width >= 1200 && pngSize(splashSelectedShot).width >= 1200,
      "a splash artifact is not the full window",
    );
  });
});
