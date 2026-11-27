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
  view: string | null;
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

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type State = {
  /** How many `.update-badge__label` captions the bar holds. */
  captionCount: number;
  viewport: { width: number; height: number };
  reducedMotion: boolean;
  calls: {
    check: number;
    checkOptions?: ({ force?: boolean } | null)[];
    install: number;
    installAsset: { name: string } | null;
  } | null;
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
    inVersion: boolean;
    inRail: boolean;
    inHeader: boolean;
    inFoot: boolean;
    inDockBar: boolean;
    underLockup: boolean;
    boxShadow: string;
    color: string;
    background: string;
    borderRadius: string;
    animationName: string;
    box: {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
    };
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
  version: {
    box: Box;
    padding: { top: number; right: number; bottom: number; left: number };
    display: string;
    flexDirection: string;
    alignItems: string;
    justifyContent: string;
    gap: string;
    /** The slot is not the query container; the header is (see the header fields). */
    containerType: string;
    containerName: string;
    inHeader: boolean;
    containsChip: boolean;
    containsLabel: boolean;
    childCount: number;
    firstChildIsChip: boolean;
    lastChildIsLabel: boolean;
    lastControlIsChip: boolean;
    lastControlAriaLabel: string | null;
    controls: {
      tag: string;
      ariaLabel: string | null;
      testId: string | null;
      className: string;
      box: Box | null;
    }[];
    /** The header's own box and container identity: the words' retreat is a query on it. */
    headerBox: Box | null;
    headerContainerType: string | null;
    headerContainerName: string | null;
    brandBox: Box | null;
    footBox: Box | null;
    footRowBox: Box | null;
    footChildCount: number | null;
    logRowBox: Box | null;
    vaultBox: Box | null;
    toggleInFootRow: boolean;
    metaRowRetired: boolean;
  } | null;
  toggle: {
    ariaLabel: string | null;
    box: Box;
    display: string;
  } | null;
  label: {
    tag: string;
    text: string;
    dataLabel: string | null;
    inVersion: boolean;
    underChip: boolean;
    /** `none` in the thin rail: the caption leaves the layout, it does not shrink. */
    display: string;
    visibility: string;
    focusables: number;
    box: { left: number; right: number; top: number; bottom: number } | null;
    color: string;
    fontSize: string;
    textTransform: string;
    tabIndex: string | null;
    role: string | null;
    overflow: { scrollWidth: number; clientWidth: number };
  } | null;
  rail: {
    box: Box;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    display: string;
    direction: string;
  } | null;
  railHeader: {
    box: Box;
    display: string;
    containerType: string;
    containerName: string;
  } | null;
  dialog: Dialog | null;
  backdropPresent: boolean;
  chipFocused: boolean | null;
  listenerAttached: boolean | null;
  dom: {
    hasRail: boolean;
    hasVersionSlot: boolean;
    hasChip: boolean;
    hasShell: boolean;
    metaRowRetired: boolean;
    errors: string[] | null;
  };
  settings: {
    summaryState: string | null;
    summaryText: string | null;
    hasTokenField: boolean;
    note: string | null;
    previewTag: string | null;
    previewRole: string | null;
    previewChecked: boolean | null;
    previewState: string | null;
    previewNote: string | null;
    storedPreview: string | null;
    previewBox: Box | null;
    previewRowBox: Box | null;
    previewCopyBox: Box | null;
    previewDescBox: Box | null;
    previewTrackBox: Box | null;
    previewThumbBox: Box | null;
    previewTrackBackground: string | null;
    previewThumbTransform: string | null;
    previewRowDisplay: string | null;
    previewRowJustify: string | null;
    previewList: { display: string; direction: string; rows: number } | null;
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
  /** The thin-rail probe: what the icon column keeps of the version line. */
  narrowGlow: {
    reach: number;
    room: number;
    captionDisplay: string | null;
    version: Box | null;
  };
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
  it("checks when asked at any time, glows when a newer release exists, and opens the upgrade", async (t) => {
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

    const {
      available,
      opened,
      notesOpen,
      installing,
      halfway,
      installFailed,
      manualRest,
      asking,
      manual,
      upToDate,
      afterClick,
      checkedAgain,
      junk,
      junkClicked,
      afterRemount,
    } = report.states;

    // The badge's home is the rail's version slot: the div inside the header,
    // directly under the centred lockup, with the number and then the caption
    // stacked and centred. The foot below is one row now — the Log, the vault chip
    // and the collapse toggle — and the old caption row (`.nav-rail__meta`) is
    // gone from the DOM.
    const version = available.version;
    assert.ok(version, "the rail's version slot rendered nothing");
    assert.equal(available.chip?.inRail, true, "the chip left the rail");
    assert.equal(available.chip?.inVersion, true, "the chip left the rail's version slot");
    assert.equal(available.chip?.inHeader, true, "the chip is not inside the rail's header");
    assert.equal(available.chip?.inFoot, false, "the chip is back in the rail's foot");
    assert.equal(available.chip?.inDockBar, false, "the chip is still in the dock's action bar");
    assert.equal(version?.containsChip, true, "the version slot does not contain the chip");
    assert.equal(version?.inHeader, true, "the version slot is not inside the header");
    assert.equal(
      available.chip?.underLockup,
      true,
      `the chip is not under the lockup: chip ${JSON.stringify(available.chip?.box)}, lockup ${JSON.stringify(version?.brandBox)}`,
    );
    // The header's band holds the lockup and the version line, in that order, and
    // the version line is centred on the rail's own column.
    assert.ok(
      Boolean(version?.box && version?.headerBox && version?.brandBox) &&
        version.brandBox.bottom <= version.box.top + 1 &&
        version.box.top >= version.headerBox.top &&
        version.box.bottom <= version.headerBox.bottom,
      `the version line is not under the lockup in the header: line ${JSON.stringify(version?.box)}, lockup ${JSON.stringify(version?.brandBox)}, header ${JSON.stringify(version?.headerBox)}`,
    );
    assert.ok(
      version?.box &&
        available.rail?.box &&
        Math.abs(
          (version.box.left + version.box.right) / 2 -
            (available.rail.box.left + available.rail.box.right) / 2,
        ) <= 2,
      `the version line is not centred on the column: line ${JSON.stringify(version?.box)}, rail ${JSON.stringify(available.rail?.box)}`,
    );
    // The version slot's only control is the chip: the words are a paragraph, and
    // the sidebar's toggle lives in the foot row now, not beside the number.
    assert.equal(
      version?.childCount,
      2,
      `the version slot holds ${version?.childCount} children, expected the words and the number`,
    );
    assert.equal(version?.containsLabel, true, "the version slot does not hold the words");
    assert.equal(
      version?.controls.length,
      1,
      `the version slot holds ${version?.controls.length} controls, expected the badge alone`,
    );
    assert.equal(version?.lastControlIsChip, true, "the chip is not the version slot's control");
    assert.equal(version?.firstChildIsChip, true, "the number is not the version slot's first line");
    assert.equal(version?.lastChildIsLabel, true, "the caption is not the version slot's second line");
    assert.equal(
      version?.lastControlAriaLabel,
      available.chip?.ariaLabel,
      `the version slot's control is ${JSON.stringify(version?.lastControlAriaLabel)}`,
    );
    assert.equal(
      available.toggle?.ariaLabel,
      "Collapse sidebar",
      `the sidebar toggle is labelled ${JSON.stringify(available.toggle?.ariaLabel)}`,
    );
    assert.equal(
      version?.toggleInFootRow,
      true,
      "the sidebar toggle left the rail's foot row",
    );
    // The foot is one row now: the Log, the vault chip and the toggle, with no
    // version line under them and no retired caption row anywhere.
    assert.equal(version?.metaRowRetired, true, "the retired .nav-rail__meta is back in the DOM");
    assert.equal(
      version?.footChildCount,
      1,
      `the rail's foot has ${version?.footChildCount} children, expected its one row`,
    );
    assert.ok(
      Boolean(version?.footRowBox && version?.logRowBox && version?.vaultBox) &&
        version.logRowBox.left >= version.footRowBox.left - 1 &&
        version.vaultBox.left >= version.logRowBox.right - 1 &&
        Boolean(available.toggle?.box) &&
        available.toggle.box.left >= version.vaultBox.right - 1 &&
        available.toggle.box.right <= version.footRowBox.right + 1,
      `the foot row is not Log / vault / toggle: Log ${JSON.stringify(version?.logRowBox)}, vault ${JSON.stringify(version?.vaultBox)}, toggle ${JSON.stringify(available.toggle?.box)}, row ${JSON.stringify(version?.footRowBox)}`,
    );
    assert.ok(
      Boolean(version?.box && version?.footRowBox) && version.box.bottom < version.footRowBox.top,
      `the version line reached the foot: line ${JSON.stringify(version?.box)}, foot row ${JSON.stringify(version?.footRowBox)}`,
    );
    // Inside the version line's own box: the number is the line's content, not
    // something bleeding into the rail's gutter.
    assert.ok(
      available.chip &&
        version &&
        available.chip.box.left >= version.box.left + version.padding.left - 0.5 &&
        available.chip.box.right <= version.box.right - version.padding.right + 0.5 &&
        available.chip.box.top >= version.box.top &&
        available.chip.box.bottom <= version.box.bottom,
      `the chip spills past the version line's box: chip ${JSON.stringify(available.chip?.box)}, line ${JSON.stringify(version?.box)}, padding ${JSON.stringify(version?.padding)}`,
    );
    // The version line stays inside the header and inside the rail's column.
    assert.ok(
      Boolean(version?.box && version?.headerBox && available.rail?.box) &&
        version.box.left >= available.rail.box.left &&
        version.box.right <= available.rail.box.right,
      `the version line left the rail's column: line ${JSON.stringify(version?.box)}, rail ${JSON.stringify(available.rail?.box)}`,
    );
    // The chip sits inside the version line. The line is the taller of the two
    // once the caption is stacked under the number.
    assert.ok(
      available.chip &&
        version &&
        available.chip.box.height <=
          version.box.height - version.padding.top - version.padding.bottom + 1,
      `the chip is taller than the version line: chip ${available.chip?.box.height}px, line ${JSON.stringify(version?.box)}`,
    );

    // The version line is the operator's manual way in, so it is a control in
    // every state — but a quiet one: no glow, no caption, no release named until
    // the feed has one.
    assert.equal(
      upToDate.chip?.tag,
      "button",
      "an up-to-date build left the operator no way to ask for an update",
    );
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
    assert.equal(
      upToDate.chip?.ariaHaspopup,
      "dialog",
      "the quiet build number is not a popup trigger",
    );
    assert.ok(
      upToDate.chip?.ariaLabel?.includes("Check for updates"),
      `the quiet build number does not say what it does: ${JSON.stringify(upToDate.chip?.ariaLabel)}`,
    );
    assert.equal(
      upToDate.label,
      null,
      `an up-to-date build says an update is available: ${JSON.stringify(upToDate.label?.text)}`,
    );
    // The caption is a second line, so the version line and the header band are
    // taller while an offer is up. The band keeps its place and its width, and
    // it grows by no more than the extra line.
    const headerGrowth =
      (available.railHeader?.box.height ?? 0) - (upToDate.railHeader?.box.height ?? 0);
    const lineGrowth =
      (available.version?.box.height ?? 0) - (upToDate.version?.box.height ?? 0);
    assert.ok(
      available.railHeader?.box &&
        upToDate.railHeader?.box &&
        Math.abs(available.railHeader.box.left - upToDate.railHeader.box.left) <= 1 &&
        Math.abs(available.railHeader.box.width - upToDate.railHeader.box.width) <= 1 &&
        Math.abs(available.railHeader.box.top - upToDate.railHeader.box.top) <= 1 &&
        headerGrowth > 0 &&
        lineGrowth > 0 &&
        headerGrowth <= lineGrowth + 1,
      `the caption did not grow the header under the version: available ${JSON.stringify(available.railHeader?.box)} / line ${available.version?.box.height}px, up-to-date ${JSON.stringify(upToDate.railHeader?.box)} / line ${upToDate.version?.box.height}px`,
    );

    // The manual check at rest: one launch check, then the operator's click
    // forces the feed, and the popup answers rather than opening into nothing.
    assert.equal(
      manualRest.calls?.check,
      1,
      `the launch asked the feed ${manualRest.calls?.check} times`,
    );
    assert.equal(
      manualRest.chip?.tag,
      "button",
      "a build with nothing to install offered no manual check",
    );
    assert.equal(
      asking.calls?.check,
      2,
      `the operator's click did not reach the feed: ${JSON.stringify(asking.calls?.checkOptions)}`,
    );
    assert.equal(
      asking.calls?.checkOptions?.[1]?.force,
      true,
      `the manual check did not force the feed: ${JSON.stringify(asking.calls?.checkOptions)}`,
    );
    assert.equal(
      asking.dialog?.view,
      "checking",
      `a manual check in flight did not say so: ${JSON.stringify(asking.dialog?.view)}`,
    );
    assert.equal(
      (asking.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install",
      ),
      false,
      "a check that has not answered offered an install",
    );
    assert.equal(
      manual.dialog?.view,
      "offer",
      `the manual check's release did not become the offer: ${JSON.stringify(manual.dialog?.view)}`,
    );
    assert.equal(
      manual.dialog?.dataVersion,
      OFFERED,
      `the manual check's popup named ${manual.dialog?.dataVersion}`,
    );
    assert.ok(
      (manual.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install" && !button.disabled,
      ),
      "the manual check found a release with no way to install it",
    );

    // An up-to-date click answers in the same panel, with no install on offer —
    // and lets the operator ask again.
    assert.equal(
      afterClick.calls?.check,
      2,
      `clicking the quiet build number did not reach the feed: ${JSON.stringify(afterClick.calls?.checkOptions)}`,
    );
    assert.equal(
      afterClick.calls?.checkOptions?.[1]?.force,
      true,
      "the quiet build number replayed the session instead of forcing the feed",
    );
    assert.equal(
      afterClick.dialog?.view,
      "up-to-date",
      `an up-to-date click answered with ${JSON.stringify(afterClick.dialog?.view)}`,
    );
    assert.ok(
      (afterClick.dialog?.versionsText ?? "").includes(`v${APP_VERSION}`) &&
        (afterClick.dialog?.versionsText ?? "").includes("newest release"),
      `the up-to-date answer does not say it: ${afterClick.dialog?.versionsText}`,
    );
    assert.equal(
      (afterClick.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install",
      ),
      false,
      "an up-to-date answer offered an install",
    );
    assert.equal(
      checkedAgain.calls?.check,
      3,
      `the popup's own check did not reach the feed: ${JSON.stringify(checkedAgain.calls?.checkOptions)}`,
    );
    assert.equal(
      checkedAgain.calls?.checkOptions?.[2]?.force,
      true,
      "the popup's own check replayed the session",
    );
    assert.equal(
      report.states.currentClosed?.chipFocused,
      true,
      "dismissing the popup dropped the keyboard on the page instead of the build number",
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

    // The caption: a glowing number is a state without a sentence, so the rail's
    // version slot says what it means — the words exist while the offer does,
    // centred on the line under the number, and never as a second focus stop in
    // the chrome. The wide rail has room for them; the thin rail retires them
    // (the probe below is the other half of that claim).
    assert.equal(
      available.label?.text,
      "Update available",
      `the glow is unexplained: ${JSON.stringify(available.label?.text)}`,
    );
    assert.equal(available.label?.tag, "p", "the caption is not a paragraph");
    assert.equal(
      available.label?.tabIndex,
      null,
      "the caption became a focus stop with nothing to do",
    );
    assert.equal(available.label?.role, null, "the caption claims a role it does not have");
    assert.equal(
      available.label?.focusables,
      0,
      "the caption grew a control of its own",
    );
    assert.equal(
      available.label?.inVersion,
      true,
      "the caption is not inside the rail's version slot",
    );
    assert.equal(
      available.label?.underChip,
      true,
      "the caption is not the line under the chip",
    );
    assert.notEqual(
      available.label?.display,
      "none",
      `the wide rail retired the caption (display: ${JSON.stringify(available.label?.display)})`,
    );
    assert.ok(
      available.label?.box &&
        available.chip?.box &&
        available.label.box.top >= available.chip.box.bottom - 1 &&
        available.label.box.top - available.chip.box.bottom <= 12,
      `the caption is not under the chip: caption ${JSON.stringify(available.label?.box)} vs chip ${JSON.stringify(available.chip?.box)}`,
    );
    assert.ok(
      available.label?.box &&
        available.chip?.box &&
        Math.abs(
          (available.label.box.left + available.label.box.right) / 2 -
            (available.chip.box.left + available.chip.box.right) / 2,
        ) <= 2,
      `the caption is not centred on the chip: caption ${JSON.stringify(available.label?.box)} vs chip ${JSON.stringify(available.chip?.box)}`,
    );
    assert.ok(
      (available.label?.overflow.scrollWidth ?? Infinity) <=
        (available.label?.overflow.clientWidth ?? 0),
      `the caption bleeds out of the rail: ${JSON.stringify(available.label?.overflow)}`,
    );
    assert.equal(
      rgbKey(available.label?.color ?? ""),
      rgbKey(report.glow.resolved.accent),
      `the caption is not wearing the state ink: ${available.label?.color}`,
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
      "update-badge-breathe",
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
    // And it has to fit: the bar runs to the window's corner and the dock clips
    // at that edge, so a bloom reaching past the bar's own box would be sliced
    // off flat.
    assert.ok(
      report.glow.reach <= report.glow.room,
      `the halo reaches ${report.glow.reach}px into the ${report.glow.room}px the header gives the version line — it would be clipped`,
    );

    // ── the thin rail: the version line retires with the words ───────────────
    // The header is the query's container, measured: collapsing the rail to its
    // icon column must take the whole version slot out of the layout rather than
    // squeeze the build number into the column's edge, where its halo would be
    // clipped. The wide rail's version line comes back on reopening.
    const narrow = report.states.narrow;
    assert.ok(narrow, "the rig never collapsed the rail");
    assert.ok(
      (narrow.rail?.box.width ?? Number.POSITIVE_INFINITY) <= 58,
      `the rail did not actually collapse: ${JSON.stringify(narrow.rail?.box)}`,
    );
    assert.equal(
      narrow.version?.headerContainerName,
      "rail-header",
      `the header's container name is ${JSON.stringify(narrow.version?.headerContainerName)}`,
    );
    assert.ok(
      (narrow.version?.headerContainerType ?? "").includes("inline-size"),
      `the header's container-type is ${JSON.stringify(narrow.version?.headerContainerType)}`,
    );
    assert.equal(
      narrow.version?.display,
      "none",
      `the thin rail left the version line in the layout (display: ${JSON.stringify(narrow.version?.display)})`,
    );
    assert.equal(
      narrow.captionCount,
      1,
      `the thin rail holds ${narrow.captionCount} captions, expected the retired one`,
    );
    assert.equal(
      narrow.label?.inVersion,
      true,
      "the retired caption is not the version slot's own element",
    );
    // The slot takes no room in the icon column: the number is not painted, and
    // the expand emblem is not here (it moved up into the header).
    assert.equal(
      narrow.chip?.inRail,
      true,
      "the build number left the rail's DOM",
    );
    assert.ok(
      narrow.chip?.box &&
        narrow.chip.box.width === 0 &&
        narrow.chip.box.height === 0,
      `the number still paints in the thin rail: ${JSON.stringify(narrow.chip?.box)}`,
    );
    assert.equal(
      narrow.toggle,
      null,
      "the sidebar toggle stayed in the thin rail's version line",
    );
    // ...and reopening leaves the shipped wide rail untouched: the version line
    // and the number come back to the boxes they had, and the words return.
    const narrowRestored = report.states.narrowRestored;
    assert.ok(narrowRestored, "the rig never reopened the rail");
    assert.notEqual(
      narrowRestored.label?.display,
      "none",
      "the caption stayed retired after the rail came back wide",
    );
    assert.equal(
      narrowRestored.label?.text,
      "Update available",
      "the restored caption does not read 'Update available'",
    );
    assert.ok(
      narrowRestored.version?.box &&
        available.version?.box &&
        Math.abs(narrowRestored.version.box.width - available.version.box.width) <= 1 &&
        Math.abs(narrowRestored.version.box.left - available.version.box.left) <= 1,
      `the restored version line is ${JSON.stringify(narrowRestored.version?.box)}, not the shipped ${JSON.stringify(available.version?.box)}`,
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

    // The rail's own contract still holds — it is one column with its topband in
    // the window's top strip, and it does not scroll — but the badge no longer
    // lives in it, so no claim here says the rail grows for the glow.
    assert.equal(available.rail?.scrollTop, 0, "the rail scrolled its topband away");
    assert.ok(
      (available.rail?.scrollHeight ?? 0) <= (available.rail?.clientHeight ?? 0),
      `the rail is taller than its column: ${available.rail?.scrollHeight}px in ${available.rail?.clientHeight}px`,
    );
    assert.equal(available.rail?.display, "flex", "the rail is not a flex column");
    assert.equal(available.rail?.direction, "column", "the rail stopped being one column");
    assert.ok(
      available.railHeader?.box &&
        Math.abs(
          available.railHeader.box.width - (available.rail?.box.width ?? 0),
        ) <= 2,
      `the rail's topband no longer spans its column: topband ${JSON.stringify(available.railHeader?.box)}, rail ${JSON.stringify(available.rail?.box)}`,
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
    assert.equal(
      junk.chip?.tag,
      "button",
      "a junk answer left the operator no way to ask again",
    );
    assert.equal(junk.chip?.boxShadow, "none", "a junk answer produced a glow");
    assert.equal(junk.dialog, null, "a junk answer opened the popup unasked");
    assert.equal(
      junk.chip?.inVersion,
      true,
      "a junk answer took the chip out of the rail's version slot",
    );
    assert.equal(
      junk.label,
      null,
      `a junk answer claimed an update was available: ${JSON.stringify(junk.label?.text)}`,
    );
    // Asking anyway is answered: a failed check is reported, not swallowed.
    assert.equal(
      junkClicked.dialog?.view,
      "error",
      `a failed check opened ${JSON.stringify(junkClicked.dialog?.view)}`,
    );
    assert.ok(
      (junkClicked.dialog?.versionsText ?? "").includes("could not reach"),
      `a failed check says nothing about why: ${junkClicked.dialog?.versionsText}`,
    );
    assert.ok(
      (junkClicked.dialog?.buttons ?? []).some(
        (button) => button.label === "Try the update check again",
      ) &&
        (junkClicked.dialog?.buttons ?? []).some(
          (button) => button.label === "Close",
        ),
      `a failed check offers ${JSON.stringify(junkClicked.dialog?.buttons)}`,
    );
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
      afterRemount.version?.containsChip === true && afterRemount.chip?.tag === "button",
      true,
      "the rail's version slot did not survive the provider's remount",
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
      previewBar,
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
      developer.settings?.previewTag,
      "button",
      "the Developer page's control is not a button",
    );
    assert.equal(
      developer.settings?.previewRole,
      "switch",
      "the Developer page's control does not announce itself as a switch",
    );
    // The switch belongs on the row's trailing edge, in its own column: the copy
    // and its description must end before the switch begins.
    assert.ok(
      developer.settings?.previewBox != null &&
        developer.settings?.previewRowBox != null,
      "the switch has no box to measure",
    );
    if (developer.settings?.previewBox && developer.settings.previewRowBox) {
      assert.ok(
        Math.abs(
          developer.settings.previewRowBox.right -
            developer.settings.previewBox.right,
        ) <= 2,
        `the switch is not on the row's trailing edge: switch ${JSON.stringify(developer.settings.previewBox)}, row ${JSON.stringify(developer.settings.previewRowBox)}`,
      );
      assert.ok(
        developer.settings.previewBox.top <=
          developer.settings.previewRowBox.top + 8,
        `the switch is not at the top of its row: ${JSON.stringify(developer.settings.previewBox)}`,
      );
    }
    assert.ok(
      (developer.settings?.previewCopyBox?.right ?? Infinity) <=
        (developer.settings?.previewBox?.left ?? 0) - 12,
      `the copy runs under the switch: copy ${JSON.stringify(developer.settings?.previewCopyBox)}, switch ${JSON.stringify(developer.settings?.previewBox)}`,
    );
    assert.ok(
      (developer.settings?.previewDescBox?.right ?? Infinity) <=
        (developer.settings?.previewBox?.left ?? 0) - 12,
      `the description runs under the switch: desc ${JSON.stringify(developer.settings?.previewDescBox)}, switch ${JSON.stringify(developer.settings?.previewBox)}`,
    );
    // A page with one switch is still a list: the next developer setting is
    // another row, so the container and the row keep the layout that makes it so.
    assert.equal(
      developer.settings?.previewList?.display,
      "flex",
      `the developer settings are not a list: ${JSON.stringify(developer.settings?.previewList)}`,
    );
    assert.equal(
      developer.settings?.previewList?.direction,
      "column",
      "the developer settings do not stack",
    );
    assert.equal(
      developer.settings?.previewRowDisplay,
      "flex",
      "a developer setting is not a row",
    );
    assert.equal(
      developer.settings?.previewRowJustify,
      "space-between",
      "the row does not push the switch to its trailing edge",
    );
    assert.equal(
      previewOn.settings?.previewChecked,
      true,
      "the switch did not come up checked when it was turned on",
    );
    assert.notEqual(
      previewOn.settings?.previewThumbTransform,
      developer.settings?.previewThumbTransform,
      "the thumb did not move when the switch went on",
    );
    assert.notEqual(
      previewOn.settings?.previewTrackBackground,
      developer.settings?.previewTrackBackground,
      "the track did not change ink when the switch went on",
    );
    assert.equal(
      previewOn.settings?.previewBox?.width,
      developer.settings?.previewBox?.width,
      "the switch changed width with its state",
    );
    assert.equal(
      previewOn.settings?.previewBox?.height,
      developer.settings?.previewBox?.height,
      "the switch changed height with its state",
    );
    assert.equal(
      previewOn.settings?.storedPreview,
      "1",
      "turning the switch on did not write the preference the badge reads",
    );
    assert.equal(
      previewOn.settings?.previewState,
      "previewing",
      `the page misreported what the badge is showing: ${previewOn.settings?.previewState}`,
    );

    // And the dock's bar really glows from it, with the feed offering nothing.
    assert.equal(
      previewBar.chip?.tag,
      "button",
      "the preview did not turn the build number into a control",
    );
    assert.equal(
      previewBar.chip?.dataPreview,
      "true",
      "the glowing chip does not say it is a preview",
    );
    // The preview is the surface built to catch a broken affordance before a
    // release, so it has to show the caption the release will.
    assert.equal(
      previewBar.label?.dataLabel,
      "preview",
      `the preview does not say the caption is a preview: ${JSON.stringify(previewBar.label)}`,
    );
    assert.equal(
      previewBar.label?.text,
      "Update available",
      `the preview dropped the caption: ${JSON.stringify(previewBar.label?.text)}`,
    );
    // The caption element is the same one the release draws, in the rail's
    // version slot and marked as a preview.
    assert.equal(
      previewBar.label?.inVersion,
      true,
      "the preview's caption left the rail's version slot",
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
      shadowed.label?.dataLabel,
      "available",
      `a real release kept the preview's caption: ${JSON.stringify(shadowed.label)}`,
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
    // badge on the next launch with no visible cause.
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
