import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Review opening windows, on the shipped Review page and the shipped Settings
 * sheet.
 *
 * The claims themselves live in `e2e/review-window.electron.mjs`, which pins the
 * clock per page load and drives both surfaces; this file runs that driver and
 * refuses a report that does not hold. Every claim is restated here so a
 * regression names the surface rather than only the rig's own failure list.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up.
 *
 * The artifact is `e2e/artifacts/review-window.json` plus six `.png`s the driver
 * captures: same command, same claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/review-window.json");
const SHOTS = [
  "review-window-daily-before.png",
  "review-window-daily-open.png",
  "review-window-weekly-before.png",
  "review-window-monthly-open.png",
  "review-window-yearly-before.png",
  "review-window-settings.png",
].map((name) => path.join(desktopRoot, "e2e/artifacts", name));

/** The shipped windows, restated so the report can be checked against them. */
const DEFAULTS = {
  daily: { daysBeforeEnd: 0, timeOfDay: "18:00" },
  weekly: { daysBeforeEnd: 0, timeOfDay: "08:00" },
  monthly: { daysBeforeEnd: 1, timeOfDay: "00:00" },
  quarterly: { daysBeforeEnd: 2, timeOfDay: "00:00" },
  yearly: { daysBeforeEnd: 6, timeOfDay: "00:00" },
};

const CADENCES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

type SettingsSample = {
  view: string | null;
  overlay: boolean;
  backgroundReview: boolean;
  navLabels: string[];
  days: Record<string, string | null>;
  times: Record<string, string | null>;
  previews: Record<string, string | null>;
  savePresent: boolean;
  resetPresent: boolean;
  error: string | null;
  notice: string | null;
};

type Sample = {
  params?: Record<string, string>;
  path: string | null;
  rigView: string | null;
  pinnedNow: string | null;
  shell: boolean;
  title: string | null;
  periodLabel: string | null;
  note: string | null;
  error: string | null;
  notice: string | null;
  nextDisabled: boolean | null;
  prevDisabled: boolean | null;
  editor: boolean;
  settings: SettingsSample;
};

type Report = {
  pass: boolean;
  failures: string[];
  generatedAt: string;
  scenarios: Record<string, Sample>;
  screenshots: string[];
  calls: string[];
  unexpectedBridgeCalls: string[];
  consoleErrors: string[];
};

/** Every review scenario the driver samples, with the exact text it must show. */
const REVIEW_SCENARIOS: {
  name: string;
  title: string;
  periodLabel: string;
  note: string | null;
  now: string;
}[] = [
  {
    name: "dailyBefore",
    title: "Daily review",
    periodLabel: "Daily review · 14 Nov 2026",
    note: "The daily review for the current period opens 15 Nov 2026 at 18:00.",
    now: "2026-11-15T17:59:00",
  },
  {
    name: "dailyOpen",
    title: "Daily review",
    periodLabel: "Daily review · 15 Nov 2026",
    note: null,
    now: "2026-11-15T18:00:00",
  },
  {
    name: "weeklyBefore",
    title: "Weekly review",
    periodLabel: "Weekly review · Week of 2 Nov 2026",
    note: "The weekly review for the current period opens 15 Nov 2026 at 08:00.",
    now: "2026-11-10T09:00:00",
  },
  {
    name: "weeklyOpen",
    title: "Weekly review",
    periodLabel: "Weekly review · Week of 9 Nov 2026",
    note: null,
    now: "2026-11-15T08:00:00",
  },
  {
    name: "monthlyBefore",
    title: "Monthly review",
    periodLabel: "Monthly review · Oct 2026",
    note: "The monthly review for the current period opens 29 Nov 2026 at 00:00.",
    now: "2026-11-28T12:00:00",
  },
  {
    name: "monthlyOpen",
    title: "Monthly review",
    periodLabel: "Monthly review · Nov 2026",
    note: null,
    now: "2026-11-29T00:00:00",
  },
  {
    name: "quarterlyBefore",
    title: "Quarterly review",
    periodLabel: "Quarterly review · 2026 Q3",
    note: "The quarterly review for the current period opens 29 Dec 2026 at 00:00.",
    now: "2026-12-28T12:00:00",
  },
  {
    name: "quarterlyOpen",
    title: "Quarterly review",
    periodLabel: "Quarterly review · 2026 Q4",
    note: null,
    now: "2026-12-29T00:00:00",
  },
  {
    name: "yearlyBefore",
    title: "Yearly review",
    periodLabel: "Yearly review · 2025",
    note: "The yearly review for the current period opens 25 Dec 2026 at 00:00.",
    now: "2026-12-24T23:59:00",
  },
  {
    name: "yearlyOpen",
    title: "Yearly review",
    periodLabel: "Yearly review · 2026",
    note: null,
    now: "2026-12-25T00:00:00",
  },
];

/** The five settings rows when the vault carries the shipped defaults. */
const DEFAULT_ROWS = [
  { id: "daily", days: "0", time: "18:00", preview: "Opens each day at 18:00." },
  {
    id: "weekly",
    days: "0",
    time: "08:00",
    preview: "Opens on the week's last day at 08:00.",
  },
  {
    id: "monthly",
    days: "1",
    time: "00:00",
    preview: "Opens 1 day before the period ends, at 00:00.",
  },
  {
    id: "quarterly",
    days: "2",
    time: "00:00",
    preview: "Opens 2 days before the period ends, at 00:00.",
  },
  {
    id: "yearly",
    days: "6",
    time: "00:00",
    preview: "Opens 6 days before the period ends, at 00:00.",
  },
];

function rowsOf(sample: Sample) {
  return CADENCES.map((id) => ({
    id,
    days: sample.settings.days[id],
    time: sample.settings.times[id],
    preview: sample.settings.previews[id],
  }));
}

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
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
      [path.join(desktopRoot, "e2e/review-window.electron.mjs")],
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

describe("review window e2e", () => {
  it("opens the Review page on the latest open period, says when the current one opens, and saves the settings that drive it", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    for (const shot of SHOTS) fs.rmSync(shot, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // ── the page opens on the latest OPEN period, not on the calendar's ────
    // Ten page loads, five cadences, both sides of each opening minute. The
    // period label is read off the page's own header, so a page that opened on
    // the calendar's period shows the current period before its window — the
    // review the vault would refuse to write.
    for (const scenario of REVIEW_SCENARIOS) {
      const sample = report.scenarios[scenario.name];
      assert.ok(sample, `the driver did not sample ${scenario.name}`);
      assert.equal(sample.periodLabel, scenario.periodLabel, `${scenario.name}: wrong period on the Review page`);
      assert.equal(sample.note, scenario.note, `${scenario.name}: wrong (or missing) window note`);
      assert.equal(sample.nextDisabled, true, `${scenario.name}: Next walks past the open period`);
      assert.equal(sample.error, null, `${scenario.name}: the page reported ${String(sample.error)}`);
      assert.equal(sample.title, scenario.title, `${scenario.name}: the page is titled for another cadence`);
      // The page is the REAL page in the REAL shell, and the pinned clock
      // reached it: the page computed its period from the URL's instant.
      assert.equal(sample.shell, true, `${scenario.name}: no app shell around the Review page`);
      assert.equal(sample.editor, true, `${scenario.name}: the Review page drew no document`);
      assert.equal(sample.rigView, "review", `${scenario.name}: the wrong harness surface`);
      assert.equal(
        new Date(String(sample.pinnedNow)).getTime(),
        new Date(scenario.now).getTime(),
        `${scenario.name}: the page did not see the pinned clock`,
      );
    }

    // The note names the opening instant: before 18:00 the page is on the 14th
    // and says when the 15th opens; at 18:00 it is on the 15th and says nothing.
    assert.match(
      String(report.scenarios.dailyBefore!.note),
      /^The daily review for the current period opens 15 Nov 2026 at 18:00\.$/,
      "the daily note does not name the opening instant in words",
    );
    assert.equal(
      report.scenarios.dailyOpen!.note,
      null,
      "the open daily period still shows a waiting note",
    );

    // ── a changed setting drives the page, not a hardcoded default ─────────
    const honours = report.scenarios.honoursSetting;
    assert.ok(honours, "the driver did not sample the changed-setting scenario");
    assert.equal(
      new Date(String(honours.pinnedNow)).getTime(),
      new Date("2026-11-15T19:00:00").getTime(),
      "the changed-setting scenario did not pin its own clock",
    );
    assert.equal(
      honours.periodLabel,
      "Daily review · 14 Nov 2026",
      "at 19:00 with daily set to 20:00 the page showed today's review instead of yesterday's",
    );
    assert.equal(
      honours.note,
      "The daily review for the current period opens 15 Nov 2026 at 20:00.",
      "the note did not follow the vault's 20:00 window",
    );

    // ── Prev still reaches an older period; Next stops at the open one ─────
    const previous = report.scenarios.prevNav;
    assert.ok(previous, "the driver did not sample Prev navigation");
    assert.equal(
      previous.periodLabel,
      "Daily review · 14 Nov 2026",
      "Prev did not reach the previous period",
    );
    assert.equal(previous.nextDisabled, false, "Next is disabled while viewing an older period");
    const back = report.scenarios.nextBack;
    assert.ok(back, "the driver did not sample Next navigation");
    assert.equal(
      back.periodLabel,
      "Daily review · 15 Nov 2026",
      "Next did not return to the open period",
    );
    assert.equal(back.nextDisabled, true, "Next did not stop at the open period");

    // ── the Settings review tab is the real sheet with the five defaults ───
    const defaults = report.scenarios.settingsDefaults;
    assert.ok(defaults, "the driver did not sample the Settings review tab");
    assert.equal(defaults.rigView, "settings", "the harness opened the wrong surface");
    assert.equal(defaults.settings.view, "review", "the sheet did not open on Review");
    assert.equal(defaults.settings.overlay, true, "the settings sheet did not render");
    assert.equal(
      defaults.settings.backgroundReview,
      true,
      "the sheet does not sit over the Review page it was opened from",
    );
    assert.equal(
      defaults.settings.navLabels.length,
      12,
      `the section column holds ${defaults.settings.navLabels.length} sections, expected 12`,
    );
    assert.ok(defaults.settings.navLabels.includes("Review"), "the section column has no Review entry");
    assert.equal(defaults.settings.savePresent, true, "the review tab has no Save control");
    assert.equal(defaults.settings.resetPresent, true, "the review tab has no Restore defaults control");
    assert.deepEqual(rowsOf(defaults), DEFAULT_ROWS, "the five rows do not show the shipped defaults");
    assert.equal(defaults.settings.notice, null, "the review tab opened with a notice already up");

    // ── Save carries the WHOLE object, with only daily changed ─────────────
    const saved = report.scenarios.settingsSaved;
    assert.ok(saved, "the driver did not sample the saved settings");
    assert.equal(saved.settings.times.daily, "20:00", "the Save did not leave 20:00 in the daily row");
    assert.match(
      String(saved.settings.notice),
      /saved/i,
      `the Save left no notice: ${String(saved.settings.notice)}`,
    );
    const writes = report.scenarios.settingsUpdates as unknown as Record<
      string,
      unknown
    >[];
    assert.equal(writes.length, 1, "the settings page wrote more than once for one Save");
    const edited = { ...DEFAULTS, daily: { daysBeforeEnd: 0, timeOfDay: "20:00" } };
    assert.deepEqual(
      writes[0]!.reviewAvailability,
      edited,
      "the Save patch is not the WHOLE reviewAvailability object with only daily changed",
    );
    for (const cadence of CADENCES) {
      if (cadence === "daily") continue;
      assert.deepEqual(
        (writes[0]!.reviewAvailability as Record<string, unknown>)[cadence],
        DEFAULTS[cadence],
        `the Save patch reset ${cadence}, which the operator did not edit`,
      );
    }

    // ── Restore defaults puts the rows back and writes nothing ─────────────
    const reset = report.scenarios.settingsReset;
    assert.ok(reset, "the driver did not sample Restore defaults");
    assert.deepEqual(rowsOf(reset), DEFAULT_ROWS, "Restore defaults did not put the rows back");
    assert.match(
      String(reset.settings.notice),
      /Defaults restored/i,
      `Restore defaults left no notice: ${String(reset.settings.notice)}`,
    );
    // The reset is a draft: it must not have written to the vault without Save.
    assert.equal(
      writes.length,
      1,
      "Restore defaults wrote to the vault without the operator pressing Save",
    );

    // ── nothing unexpected, nothing on fire ────────────────────────────────
    assert.deepEqual(report.unexpectedBridgeCalls, []);
    assert.deepEqual(report.consoleErrors, []);

    // ── the pictures of the shipped screens ────────────────────────────────
    for (const shot of SHOTS) {
      assert.equal(fs.existsSync(shot), true, `driver captured no screenshot ${shot}`);
    }
    assert.deepEqual(
      new Set(report.screenshots),
      new Set(SHOTS.map((shot) => path.basename(shot))),
      "the report names a different screenshot set than the one on disk",
    );
  });
});
