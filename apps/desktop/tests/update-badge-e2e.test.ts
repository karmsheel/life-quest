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

/**
 * The build under test, off the app's own `package.json`. The rigs read the same
 * file, so this suite's expectations move with a version bump instead of breaking
 * on one.
 */
const APP_VERSION = (require("../package.json") as { version: string }).version;

/** The release the harness's stub feed offers — a fixed fixture. */
const OFFERED = "0.4.0";

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/update-badge.json");

type ShadowLayer = {
  color: { rgb: string; alpha: number } | null;
  x: number;
  y: number;
  blur: number;
  spread: number;
};

type Dialog = {
  role: string | null;
  ariaModal: string | null;
  title: string;
  kicker: string;
  kickerKind: string | null;
  versionsText: string;
  fileLine: string;
  buttons: { label: string; disabled: boolean }[];
  notesToggle: boolean;
  notesBody: string | null;
  progressText: string | null;
  progressNow: string | null;
  error: string | null;
};

type State = {
  reducedMotion: boolean;
  calls: { check: number; install: number; installAsset: { name: string } | null } | null;
  chip: {
    tag: string;
    className: string;
    text: string;
    dataState: string | null;
    dataVersion: string | null;
    dataPreview: string | null;
    ariaLabel: string | null;
    ariaHaspopup: string | null;
    ariaExpanded: string | null;
    boxShadow: string;
    color: string;
    background: string;
    borderRadius: string;
    animationName: string;
    box: { left: number; right: number };
    halo: {
      boxShadow: string;
      opacity: number;
      animationName: string;
      content: string;
      pointerEvents: string;
      inset: string;
    };
    tokens: {
      accent: string;
      accentFill: string;
      resolved: { accent: string; accentFill: string };
    };
  } | null;
  rail: {
    box: { left: number; right: number };
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null;
  dialog: Dialog | null;
  backdropPresent: boolean;
  listenerAttached: boolean | null;
  dom: { hasRail: boolean; hasChip: boolean; errors: string[] | null };
  settings: {
    summaryState: string | null;
    summaryText: string | null;
    hasTokenField: boolean;
    note: string | null;
    previewChecked: boolean | null;
    previewState: string | null;
    previewNote: string | null;
    storedPreview: string | null;
    cardResizeChecked: boolean | null;
    cardResizeState: string | null;
    cardResizeNote: string | null;
    storedCardResize: string | null;
    buttons: { label: string | null; disabled: boolean }[];
    message: string | null;
    error: string | null;
  } | null;
  overflow: { scrollWidth: number; clientWidth: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  states: Record<string, State>;
  glow: {
    accent: string;
    accentFill: string;
    resolved: { accent: string; accentFill: string };
    chipInk: string;
    chipFill: string;
    halo: string;
    layers: ShadowLayer[];
    reach: number;
    room: number;
    animation: string | null;
  };
  screenshots: string[];
};

/** The `rgb(...)` inside an `rgb()`/`rgba()` colour, or a `color(srgb …)` one. */
function rgbKey(color: string): string | null {
  const rgb = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => parseFloat(part.trim()));
    return `rgb(${parts.slice(0, 3).join(", ")})`;
  }
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(color.trim());
  if (srgb) {
    const nums = srgb[1]
      .split("/")[0]
      .trim()
      .split(/\s+/)
      .map((part) => Math.round(parseFloat(part) * 255));
    return `rgb(${nums.join(", ")})`;
  }
  return null;
}

/**
 * The badge rig drives the real shell in a real Electron window, so it needs the
 * Vite dev server. With the server down the test skips; `npm run dev` in another
 * shell turns it on.
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
      [path.join(desktopRoot, "e2e/update-badge.electron.mjs")],
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

describe("auto-update badge", () => {
  it("glows when a newer release exists, opens the upgrade, and stays quiet otherwise", async (t) => {
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
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    const { available, opened, notesOpen, installing, halfway, installFailed, upToDate, junk, afterRemount } =
      report.states;

    // The version line at rest: the same paragraph it has always been, so a rail
    // with nothing to install gains no control and no focus stop.
    assert.equal(upToDate.chip?.tag, "p", "an up-to-date build made the version a control");
    assert.equal(
      upToDate.chip?.boxShadow,
      "none",
      `an up-to-date build glowed anyway (${upToDate.chip?.boxShadow})`,
    );
    assert.equal(
      upToDate.chip?.className.includes("--available"),
      false,
      "an up-to-date build carried the available class",
    );
    assert.equal(
      upToDate.chip?.dataVersion,
      null,
      "an up-to-date build named a release it is not offering",
    );

    // The glow, restated here so the suite — not only the driver — asserts the
    // halves of the claim: a halo paints, it paints the palette's own inks, and it
    // paints them on a layer of its own rather than as a shadow on the chip.
    assert.equal(available.chip?.tag, "button", "an available release was not clickable");
    assert.equal(
      available.chip?.dataVersion,
      OFFERED,
      "the glowing build number did not name the release",
    );
    assert.equal(
      available.chip?.text,
      `v${APP_VERSION}`,
      "the build number stopped reading the running version",
    );
    assert.equal(
      available.chip?.boxShadow,
      "none",
      "the chip carries the halo itself — it belongs on its own layer, where the breath can animate opacity",
    );
    assert.equal(
      available.chip?.halo.content,
      '""',
      "the chip grew no halo layer",
    );
    assert.equal(
      available.chip?.halo.pointerEvents,
      "none",
      "the halo layer would swallow clicks meant for the chip",
    );
    assert.equal(
      available.chip?.animationName,
      "none",
      "the chip animates itself instead of the halo layer",
    );
    assert.equal(
      available.chip?.halo.animationName,
      "nav-rail-version-breathe",
      "the halo does not breathe",
    );

    // A hairline of the state ink, then a bloom of the accent's translucent fill.
    const [hairline, bloom] = report.glow.layers;
    assert.equal(report.glow.layers.length, 2, `the halo has ${report.glow.layers.length} layers`);
    assert.equal(
      hairline?.color?.rgb,
      rgbKey(report.glow.resolved.accent),
      `the hairline is not the state ink: ${JSON.stringify(hairline?.color)} vs ${report.glow.resolved.accent}`,
    );
    assert.equal(hairline?.color?.alpha, 1, "the hairline is not a solid hairline");
    assert.equal(
      bloom?.color?.rgb,
      rgbKey(report.glow.resolved.accentFill),
      `the bloom is not the accent's own fill: ${JSON.stringify(bloom?.color)} vs ${report.glow.resolved.accentFill}`,
    );
    assert.ok(
      (bloom?.color?.alpha ?? 0) > 0.05 && (bloom?.color?.alpha ?? 0) < 1,
      `the bloom is not translucent: ${JSON.stringify(bloom?.color)}`,
    );
    // Light around the chip, not a lift under it.
    for (const layer of report.glow.layers) {
      assert.equal(layer.x, 0, `a halo layer is offset horizontally by ${layer.x}px`);
      assert.equal(layer.y, 0, `a halo layer is offset vertically by ${layer.y}px — that is a drop shadow`);
    }
    // And it has to fit: the rail clips its overflow at its own edge, so a bloom
    // reaching past the padding around the chip would be sliced off flat.
    assert.ok(
      report.glow.reach <= report.glow.room,
      `the halo reaches ${report.glow.reach}px into the ${report.glow.room}px the rail gives it — it would be clipped`,
    );

    // The chip wears the palette's own inks, not new ones.
    assert.equal(
      rgbKey(available.chip?.color ?? ""),
      rgbKey(report.glow.resolved.accent),
      "the glowing build number is not wearing the state ink",
    );
    assert.equal(
      available.chip?.background,
      report.glow.resolved.accentFill,
      `the chip is not on the accent's translucent fill: ${available.chip?.background}`,
    );

    // The glow must not break the rail's own contract: a halo is not a reflow.
    assert.equal(available.rail?.scrollTop, 0, "the glow scrolled the rail's topband away");
    assert.ok(
      (available.rail?.scrollHeight ?? 0) <= (available.rail?.clientHeight ?? 0),
      `the glow made the rail taller than its column: ${available.rail?.scrollHeight}px in ${available.rail?.clientHeight}px`,
    );

    // One check per launch, even under StrictMode's second mount effect.
    assert.equal(
      available.calls?.check,
      1,
      `the launch asked the feed ${available.calls?.check} times`,
    );

    // The popup: a modal that names both versions, the file, and the way out.
    assert.ok(opened.dialog, "clicking the glowing build number opened no popup");
    assert.equal(opened.dialog?.role, "dialog", "the popup is not a dialog");
    assert.equal(opened.dialog?.ariaModal, "true", "the popup is not modal");
    assert.equal(opened.dialog?.title, `LifeQuest ${OFFERED}`, "the popup does not name the release");
    assert.ok(
      opened.dialog?.versionsText.includes(`v${APP_VERSION}`) &&
        opened.dialog?.versionsText.includes(OFFERED),
      `the popup does not name both versions: ${opened.dialog?.versionsText}`,
    );
    assert.ok(
      opened.dialog?.fileLine.includes(`LifeQuest-${OFFERED}-setup.exe`),
      `the popup does not name the file: ${opened.dialog?.fileLine}`,
    );
    const labels = opened.dialog?.buttons.map((button) => button.label) ?? [];
    assert.ok(
      labels.includes("Download and install") &&
        labels.includes("Open the release page") &&
        labels.includes("Not now"),
      `the popup's actions are ${JSON.stringify(labels)}`,
    );
    assert.ok(
      notesOpen.dialog?.notesBody?.includes("The build number glows"),
      `the release notes could not be read: ${JSON.stringify(notesOpen.dialog?.notesBody)}`,
    );
    assert.equal(
      opened.dialog?.notesBody,
      null,
      "the notes were already open — they start folded away",
    );

    // The install: once, with the release's own asset, and reporting progress.
    assert.equal(
      installing.calls?.install,
      1,
      `the install reached the bridge ${installing.calls?.install} times`,
    );
    assert.equal(
      installing.calls?.installAsset?.name,
      `LifeQuest-${OFFERED}-setup.exe`,
      `the bridge was handed ${JSON.stringify(installing.calls?.installAsset)}`,
    );
    assert.equal(
      halfway.dialog?.progressNow,
      "25",
      `the download's progress did not reach the popup: ${JSON.stringify(halfway.dialog?.progressText)}`,
    );

    // A failure is reported rather than swallowed, and the popup stays escapable.
    assert.ok(
      installFailed.dialog?.error?.includes("no handler"),
      `a failed install was not reported: ${JSON.stringify(installFailed.dialog?.error)}`,
    );
    assert.equal(
      installFailed.dialog?.buttons.find((button) => button.label === "Download and install")
        ?.disabled,
      false,
      "a failed install left the action disabled",
    );

    // A bridge that does not know this channel must not glow, and must not throw.
    assert.equal(junk.chip?.tag, "p", "a junk answer turned the version into a control");
    assert.equal(junk.chip?.boxShadow, "none", "a junk answer produced a glow");
    assert.equal(junk.dialog, null, "a junk answer opened the popup");
    assert.equal(
      junk.listenerAttached,
      true,
      "the provider never subscribed to the progress channel",
    );
    // The junk is the *handle*, not the callback: a bridge that does not know the
    // channel answers with something that is not an unsubscribe. Unmounting the
    // provider runs that cleanup, so a guard that tried to call it would surface
    // here as an uncaught TypeError.
    assert.deepEqual(
      afterRemount.dom.errors,
      [],
      `unmounting with a junk progress handle threw: ${JSON.stringify(afterRemount.dom.errors)}`,
    );
    assert.equal(
      afterRemount.rail !== null && afterRemount.chip?.tag === "p",
      true,
      "the rail did not survive the provider's remount",
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }

    // Settings → Updates — what the feed said, and asking by hand. Asserted from
    // the report's own numbers rather than only inside the driver, so a regression
    // names the field it broke.
    const { settings, checked } = report.states;
    assert.ok(settings.settings, "the Settings view rendered nothing");
    assert.equal(
      settings.settings?.summaryState,
      "available",
      `the view did not report the release the feed found: ${JSON.stringify(settings.settings?.summaryText)}`,
    );
    // The feed is public: the page must not ask for a token, nor imply one is
    // needed. This is the assertion that would have caught the leftover field.
    assert.equal(
      settings.settings?.hasTokenField,
      false,
      "the Updates page still asks the operator for a token",
    );
    assert.ok(
      (settings.settings?.note ?? "").includes("public"),
      `the page does not say the feed is public: ${JSON.stringify(settings.settings?.note)}`,
    );
    assert.equal(
      checked.calls?.check,
      2,
      `checking by hand did not reach the feed: ${JSON.stringify(checked.calls?.checkOptions)}`,
    );
    assert.equal(
      checked.calls?.checkOptions?.[1]?.force,
      true,
      `the hand's check replayed the session instead of forcing the feed: ${JSON.stringify(checked.calls?.checkOptions)}`,
    );

    // Settings → Developer: the switch that makes the badge glow on demand. It is
    // the only way to look at the upgrade affordance without cutting a release.
    const {
      developer,
      previewOn,
      handleOn,
      previewRail,
      previewDialog,
      shadowed,
      shadowedDialog,
      developerOn,
      developerOff,
    } = report.states;
    assert.equal(
      developer.settings?.previewChecked,
      false,
      "the preview switch came up already on",
    );
    assert.equal(
      developer.settings?.previewState,
      "off",
      `the page did not report the switch as off: ${developer.settings?.previewState}`,
    );
    assert.equal(
      previewOn.settings?.previewChecked,
      true,
      "the switch did not come up checked when it was turned on",
    );
    assert.equal(
      previewOn.settings?.storedPreview,
      "1",
      "turning the switch on did not write the preference the rail reads",
    );
    assert.equal(
      previewOn.settings?.previewState,
      "previewing",
      `the page misreported what the rail is showing: ${previewOn.settings?.previewState}`,
    );

    // And the page's other switch: the card width handle, a developer flag for the
    // dashboard's resize gesture. It ships off — a flag that defaults on is not
    // gated — and flipping it writes the key the board reads. What it does to the
    // board is the dashboard-tile rig's claim; this is the surface.
    assert.equal(
      previewOn.settings?.cardResizeChecked,
      false,
      "the card width handle came up already on",
    );
    assert.equal(
      previewOn.settings?.cardResizeState,
      "off",
      `the page did not report the card width handle as off: ${previewOn.settings?.cardResizeState}`,
    );
    assert.equal(
      previewOn.settings?.storedCardResize,
      null,
      "a developer flag was stored before anybody turned it on",
    );
    assert.equal(
      handleOn.settings?.cardResizeChecked,
      true,
      "the card width handle did not come up checked when it was turned on",
    );
    assert.equal(
      handleOn.settings?.cardResizeState,
      "on",
      `the page misreported the card width handle: ${handleOn.settings?.cardResizeState}`,
    );
    assert.equal(
      handleOn.settings?.storedCardResize,
      "1",
      "turning the card width handle on did not write the flag the board reads",
    );

    // And the rail really glows from it, with the feed offering nothing.
    assert.equal(
      previewRail.chip?.tag,
      "button",
      "the preview did not turn the build number into a control",
    );
    assert.equal(
      previewRail.chip?.dataPreview,
      "true",
      "the glowing chip does not say it is a preview",
    );
    assert.equal(
      report.glow.layers.length,
      2,
      "the preview glow is not the same halo",
    );
    assert.equal(
      previewDialog.dialog?.kickerKind,
      "preview",
      `the preview's popup does not announce itself: ${JSON.stringify(previewDialog.dialog?.kicker)}`,
    );
    assert.equal(
      previewDialog.dialog?.dataVersion,
      "9.9.9",
      "the preview did not name the version that does not exist",
    );
    assert.equal(
      (previewDialog.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install",
      ),
      false,
      "the preview offered an install — a preview must not be able to start one",
    );
    assert.equal(
      previewDialog.calls?.install,
      0,
      "the preview reached the install channel",
    );

    // A real release outranks the preview: a switch that could hide an upgrade
    // would be worse than no switch at all.
    assert.equal(
      shadowed.chip?.dataVersion,
      OFFERED,
      `the preview hid a real release — the chip offered ${shadowed.chip?.dataVersion}`,
    );
    assert.equal(
      shadowed.chip?.dataPreview,
      "false",
      "the chip claims to be a preview while showing a real release",
    );
    assert.equal(
      shadowedDialog.dialog?.kickerKind,
      "release",
      "the popup announced a real release as a preview",
    );
    assert.ok(
      (shadowedDialog.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install",
      ),
      "the real release behind the switch lost its install action",
    );

    // The switch clears up after itself: a preference left behind would glow the
    // rail on the next launch with no visible cause.
    assert.equal(
      developerOn.settings?.previewChecked,
      true,
      "a stored preference did not bring the switch up on",
    );
    assert.equal(
      developerOff.settings?.previewChecked,
      false,
      "the switch did not turn off",
    );
    assert.equal(
      developerOff.settings?.storedPreview,
      null,
      "turning the switch off left the preference behind",
    );
    assert.equal(
      developerOff.settings?.previewState,
      "off",
      `the page still reports a preview after the switch went off: ${developerOff.settings?.previewState}`,
    );
  });
});
