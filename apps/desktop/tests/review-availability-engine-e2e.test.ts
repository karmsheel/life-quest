import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, mock } from "node:test";
import {
  DEFAULT_REVIEW_AVAILABILITY,
  createVault,
  ensureReview,
  getReview,
  openVault,
  updateSettings,
  vaultPaths,
  writeReview,
  type VaultSettings,
} from "@lifequest/vault-core";
import {
  DEFAULT_REVIEW_AVAILABILITY as DEFAULT_REVIEW_AVAILABILITY_PURE,
  defaultReviewAvailability,
  formatReviewOpening,
  isReviewTimeOfDay,
  isReviewWindowOpen,
  openReviewPeriod,
  parseReviewAvailabilityPatch,
  reviewAvailabilityFromUnknown,
  reviewOpensAt,
  reviewWindowSummary,
  type ReviewAvailability,
  type ReviewCadence,
} from "@lifequest/vault-core/pure";

/**
 * Review opening windows, end to end against a real vault on disk.
 *
 * The UI rig (`review-window-e2e.test.ts`) drives the REAL Review page and the
 * REAL Settings review tab with a stubbed bridge and a faked clock, which is the
 * right instrument for what the operator sees on each day. It deliberately does
 * not prove that the window is part of the VAULT: the settings live in
 * `.lifequest/settings.json`, and the code that writes and gates on them is the
 * vault engine in the main process, behind the bridge that rig stubs. A window
 * that only exists in the renderer is a window an agent can ignore.
 *
 * This file runs under `node --experimental-strip-types --test` from
 * `apps/desktop`, so it needs no Electron and no dev server: every assertion is
 * against a real temporary vault's real settings file, and the enforcement
 * claims run with the process clock pinned through `node:test`'s own Date
 * mocking, so "before 18:00" means the same thing on every run.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A new vault is created without `reviewAvailability`, so the settings page
 *     draws five default rows while the file it wrote has nothing to read back.
 *  2. A vault written before the windows existed (no key) opens without them, so
 *     the page is left to guess, or opening it rewrites the operator's file.
 *  3. A hand-edited file loses a whole cadence — or every cadence — because one
 *     field is broken, instead of falling back per field.
 *  4. The settings page's write (the whole object) does not round-trip, or the
 *     next unrelated settings write drops it because `updateSettings` rebuilds
 *     the object from named fields.
 *  5. A partial cadence patch resets the other four cadences to their defaults.
 *  6. An invalid window (non-object, negative/fractional/oversized days, a
 *     malformed time) is accepted and saved, so behaviour changes silently.
 *  7. The boundary is off by one: before the opening minute the previous period
 *     is still the latest open one, and at the opening minute the new period is —
 *     for all five cadences, and for both week-start settings.
 *  8. `ensureReview` / `writeReview` write a file for a period whose window has
 *     not opened, or they gate reads and past periods along with it.
 *  9. The engine ignores the stored window and uses the shipped default, so a
 *     vault that changed daily to 20:00 still opens it at 18:00.
 * 10. An artifact written by a failing run: the report is only written when every
 *     claim held, so its presence means something.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT = path.join(
  desktopRoot,
  "e2e/artifacts/review-availability-engine.json",
);

type Claim = {
  claim: string;
  pass: boolean;
  detail: Record<string, unknown>;
};

const claims: Claim[] = [];

function record(claim: string, detail: Record<string, unknown> = {}): void {
  claims.push({ claim, pass: true, detail });
}

async function readSettings(
  root: string,
): Promise<VaultSettings & { reviewAvailability?: unknown }> {
  const raw = await fs.readFile(vaultPaths(root).settingsJson, "utf8");
  return JSON.parse(raw) as VaultSettings & { reviewAvailability?: unknown };
}

/** Rewrite the settings file exactly as a hand-edit or a legacy vault would. */
async function writeSettings(
  root: string,
  value: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(
    vaultPaths(root).settingsJson,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function exists(file: string): Promise<boolean> {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false);
}

/** A local wall-clock instant, so a pinned minute means the same on any host. */
function localDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

const CADENCES: ReviewCadence[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

const DEFAULTS = DEFAULT_REVIEW_AVAILABILITY;

/** The latest open period for a cadence at a pinned instant. */
function openAt(
  cadence: ReviewCadence,
  now: Date,
  availability: ReviewAvailability = DEFAULTS,
  weekStartDay: "monday" | "sunday" = "monday",
): string {
  return openReviewPeriod(cadence, weekStartDay, availability, now);
}

function assertDefined<T>(value: T | null | undefined, message: string): T {
  assert.notEqual(value, null, message);
  assert.notEqual(value, undefined, message);
  return value as T;
}

/** The opening instant of a period, as the page would print it. */
function openingText(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: "monday" | "sunday" = "monday",
  availability: ReviewAvailability = DEFAULTS,
): string {
  const at = reviewOpensAt(cadence, period, weekStartDay, availability);
  assert.equal(
    at.ok,
    true,
    `reviewOpensAt(${cadence}, ${period}) failed: ${at.ok ? "" : at.error}`,
  );
  return formatReviewOpening(at.ok ? at.value : new Date(0));
}

describe("the review opening windows persist and gate in a real vault", () => {
  it("seeds, normalizes, persists and validates the windows; opens each cadence at its pinned minute; and refuses a review before its window", async () => {
    // A pass artifact from an earlier run must not outlive a failing one: the
    // report is written only when every claim held, so its presence means this
    // run held.
    await fs.rm(ARTIFACT, { force: true });
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "lifequest-review-window-"),
    );
    try {
      // ══ 1. a new vault seeds exactly the five shipped windows ════════════
      const created = await createVault(root, "Harness");
      assert.equal(
        created.ok,
        true,
        `createVault failed: ${created.ok ? "" : created.error}`,
      );
      const seeded = await readSettings(root);
      assert.deepEqual(
        seeded.reviewAvailability,
        {
          daily: { daysBeforeEnd: 0, timeOfDay: "18:00" },
          weekly: { daysBeforeEnd: 0, timeOfDay: "08:00" },
          monthly: { daysBeforeEnd: 1, timeOfDay: "00:00" },
          quarterly: { daysBeforeEnd: 2, timeOfDay: "00:00" },
          yearly: { daysBeforeEnd: 6, timeOfDay: "00:00" },
        },
        "a new vault's settings.json does not carry the five default review windows",
      );
      assert.deepEqual(
        seeded.reviewAvailability,
        DEFAULTS,
        "the vault's seeded windows are not DEFAULT_REVIEW_AVAILABILITY",
      );
      assert.deepEqual(
        Object.keys(seeded.reviewAvailability as object).sort(),
        [...CADENCES].sort(),
        "the seeded windows are not exactly the five cadences",
      );
      record(
        "1. createVault seeds settings.json with exactly the five default windows (daily 0/18:00, weekly 0/08:00, monthly 1/00:00, quarterly 2/00:00, yearly 6/00:00).",
        { seeded: seeded.reviewAvailability },
      );

      // Both export paths carry the same defaults: the renderer imports from
      // pure, the main process from the package root.
      assert.deepEqual(
        DEFAULT_REVIEW_AVAILABILITY_PURE,
        DEFAULT_REVIEW_AVAILABILITY,
        "the pure and package-root defaults disagree",
      );
      assert.deepEqual(
        defaultReviewAvailability(),
        DEFAULTS,
        "defaultReviewAvailability() is not the shipped defaults",
      );
      const freshCopy = defaultReviewAvailability();
      assert.notEqual(
        freshCopy,
        DEFAULT_REVIEW_AVAILABILITY,
        "defaultReviewAvailability() hands out the shared object",
      );
      freshCopy.daily.timeOfDay = "23:59";
      assert.equal(
        DEFAULT_REVIEW_AVAILABILITY.daily.timeOfDay,
        "18:00",
        "mutating a returned default changed the shipped default",
      );
      record(
        "1b. DEFAULT_REVIEW_AVAILABILITY is exported from both entry points, and defaultReviewAvailability() returns an independent copy.",
        { defaults: DEFAULTS },
      );

      // ══ 2a. a legacy vault gains the defaults on open, unrewritten ══════
      const legacy: Record<string, unknown> = { ...seeded };
      delete legacy.reviewAvailability;
      await writeSettings(root, legacy);
      const opened = await openVault(root);
      assert.equal(
        opened.ok,
        true,
        `openVault failed: ${opened.ok ? "" : opened.error}`,
      );
      assert.deepEqual(
        opened.ok ? opened.value.settings.reviewAvailability : null,
        DEFAULTS,
        "a vault with no reviewAvailability key did not open with the defaults",
      );
      assert.equal(
        (await readSettings(root)).reviewAvailability,
        undefined,
        "opening a legacy vault rewrote its settings file",
      );
      record(
        "2a. A vault with no reviewAvailability key opens with the defaults, and opening it leaves settings.json untouched.",
        { opened: DEFAULTS },
      );

      // ══ 2b. a hand-edited file falls back per FIELD, not per vault ══════
      await writeSettings(root, {
        ...legacy,
        reviewAvailability: {
          daily: { daysBeforeEnd: 0, timeOfDay: "25:00" },
          weekly: { daysBeforeEnd: 999, timeOfDay: "08:00" },
          monthly: "oops",
          quarterly: { daysBeforeEnd: 2, timeOfDay: "00:00" },
          yearly: { daysBeforeEnd: 6, timeOfDay: "00:00" },
        },
      });
      const tolerant = await openVault(root);
      assert.equal(
        tolerant.ok,
        true,
        "a hand-edited settings file failed to open",
      );
      assert.deepEqual(
        tolerant.ok ? tolerant.value.settings.reviewAvailability : null,
        {
          // the good field of each broken cadence is kept
          daily: { daysBeforeEnd: 0, timeOfDay: "18:00" },
          weekly: { daysBeforeEnd: 0, timeOfDay: "08:00" },
          // a cadence that is not an object falls back whole
          monthly: { daysBeforeEnd: 1, timeOfDay: "00:00" },
          // untouched cadences are kept exactly
          quarterly: { daysBeforeEnd: 2, timeOfDay: "00:00" },
          yearly: { daysBeforeEnd: 6, timeOfDay: "00:00" },
        },
        "a hand-edited file did not fall back field by field",
      );
      record(
        "2b. A hand-edited file falls back per field: the good cadences keep their values, a broken field falls back alone, and a cadence with no valid window falls back whole.",
        { daily: "0/18:00", weekly: "0/08:00", monthly: "1/00:00" },
      );

      // The tolerant read is also the pure helper's contract.
      assert.deepEqual(
        reviewAvailabilityFromUnknown(undefined),
        DEFAULTS,
        "reviewAvailabilityFromUnknown(undefined) is not the defaults",
      );
      assert.deepEqual(
        reviewAvailabilityFromUnknown({
          daily: { daysBeforeEnd: 4, timeOfDay: "09:30" },
        }),
        { ...DEFAULTS, daily: { daysBeforeEnd: 4, timeOfDay: "09:30" } },
        "reviewAvailabilityFromUnknown dropped the valid cadence it was given",
      );
      record(
        "2c. reviewAvailabilityFromUnknown tolerates an absent or partial object and keeps every valid cadence.",
        {},
      );

      // Re-seed a clean vault for the writes below.
      await writeSettings(root, { ...legacy, reviewAvailability: DEFAULTS });
      assert.equal(
        (await openVault(root)).ok,
        true,
        "the re-seeded vault failed to open",
      );

      // ══ 3. the settings page's whole-object write lands and survives ════
      const asOnThePage: ReviewAvailability = {
        ...DEFAULTS,
        daily: { daysBeforeEnd: 0, timeOfDay: "20:00" },
      };
      const whole = await updateSettings(root, {
        reviewAvailability: asOnThePage,
      });
      assert.equal(
        whole.ok,
        true,
        "updateSettings refused the settings page's write",
      );
      assert.deepEqual(
        (await readSettings(root)).reviewAvailability,
        asOnThePage,
        "the whole-object write never reached settings.json",
      );
      const reopened = await openVault(root);
      assert.deepEqual(
        reopened.ok ? reopened.value.settings.reviewAvailability : null,
        asOnThePage,
        "the written window did not survive a reopen",
      );
      record(
        "3. The settings page's whole reviewAvailability object lands in settings.json and survives a reopen.",
        { stored: asOnThePage },
      );

      // ══ 4. an unrelated later settings write keeps it ═══════════════════
      const theme = await updateSettings(root, { theme: "dark" });
      assert.equal(theme.ok, true, "the unrelated theme write was refused");
      const afterTheme = await readSettings(root);
      assert.equal(afterTheme.theme, "dark", "the unrelated write did not land");
      assert.deepEqual(
        afterTheme.reviewAvailability,
        asOnThePage,
        "an unrelated settings write dropped or reset the review windows",
      );
      record(
        "4. An unrelated settings write (theme) preserves every review window.",
        { theme: afterTheme.theme, stored: afterTheme.reviewAvailability },
      );

      // ══ 5. a partial cadence patch merges, it does not reset ════════════
      const partial = await updateSettings(root, {
        reviewAvailability: {
          monthly: { daysBeforeEnd: 3, timeOfDay: "06:00" },
        } as ReviewAvailability,
      });
      assert.equal(partial.ok, true, "a one-cadence patch was refused");
      assert.deepEqual(
        (await readSettings(root)).reviewAvailability,
        {
          ...DEFAULTS,
          // the stored daily window from step 3 is kept, not reset
          daily: { daysBeforeEnd: 0, timeOfDay: "20:00" },
          monthly: { daysBeforeEnd: 3, timeOfDay: "06:00" },
        },
        "a one-cadence patch reset the other cadences to their defaults",
      );
      record(
        "5. A partial cadence patch keeps every other cadence's stored window.",
        { daily: "0/20:00", monthly: "3/06:00" },
      );
      assert.deepEqual(
        parseReviewAvailabilityPatch(
          { monthly: { daysBeforeEnd: 3, timeOfDay: "06:00" } },
          { ...DEFAULTS, daily: { daysBeforeEnd: 0, timeOfDay: "20:00" } },
        ),
        {
          ok: true,
          value: {
            ...DEFAULTS,
            daily: { daysBeforeEnd: 0, timeOfDay: "20:00" },
            monthly: { daysBeforeEnd: 3, timeOfDay: "06:00" },
          },
        },
        "parseReviewAvailabilityPatch did not merge onto the base",
      );
      record(
        "5b. parseReviewAvailabilityPatch merges a partial patch onto the base windows.",
        {},
      );

      // ══ 6. invalid writes are refused and change nothing ════════════════
      const beforeBad = await readSettings(root);
      const invalid: { label: string; patch: unknown }[] = [
        { label: "non-object", patch: "nope" },
        { label: "null", patch: null },
        {
          label: "string days",
          patch: { daily: { daysBeforeEnd: "0", timeOfDay: "18:00" } },
        },
        {
          label: "fractional days",
          patch: { daily: { daysBeforeEnd: 1.5, timeOfDay: "18:00" } },
        },
        {
          label: "negative days",
          patch: { daily: { daysBeforeEnd: -1, timeOfDay: "18:00" } },
        },
        {
          label: "more than 60 days",
          patch: { daily: { daysBeforeEnd: 61, timeOfDay: "18:00" } },
        },
        {
          label: "hour 24",
          patch: { daily: { daysBeforeEnd: 0, timeOfDay: "24:00" } },
        },
        {
          label: "minute 60",
          patch: { daily: { daysBeforeEnd: 0, timeOfDay: "20:60" } },
        },
        {
          label: "single-digit hour",
          patch: { daily: { daysBeforeEnd: 0, timeOfDay: "8:00" } },
        },
        { label: "cadence window is a string", patch: { weekly: "08:00" } },
      ];
      const refused: { label: string; error: string | null }[] = [];
      for (const entry of invalid) {
        const result = await updateSettings(root, {
          reviewAvailability: entry.patch,
        } as unknown as Partial<VaultSettings>);
        assert.equal(
          result.ok,
          false,
          `an invalid write was accepted (${entry.label})`,
        );
        if (!result.ok) {
          assert.ok(
            result.error.length > 0,
            `the refusal for ${entry.label} had no message`,
          );
        }
        refused.push({
          label: entry.label,
          error: result.ok ? null : result.error,
        });
      }
      assert.deepEqual(
        (await readSettings(root)).reviewAvailability,
        beforeBad.reviewAvailability,
        "a refused write still changed settings.json",
      );
      record(
        "6. Invalid window writes (non-object, bad days, bad time, string cadence) are refused and settings.json is unchanged.",
        { refused },
      );

      // A malformed time is refused by the same predicate the page uses.
      for (const good of ["00:00", "08:00", "18:00", "23:59"]) {
        assert.equal(
          isReviewTimeOfDay(good),
          true,
          `${good} was not a valid time`,
        );
      }
      const badTimes: unknown[] = ["24:00", "8:00", "20:60", "eight", "", 1800];
      for (const bad of badTimes) {
        assert.equal(
          isReviewTimeOfDay(bad),
          false,
          `${String(bad)} was accepted as a time`,
        );
      }
      record("6b. isReviewTimeOfDay accepts HH:MM only.", {
        accepted: ["00:00", "08:00", "18:00", "23:59"],
        refused: ["24:00", "8:00", "20:60", "eight", ""],
      });

      // ══════════ 7. the boundary table, one row per cadence ══════════════
      const table = [
        {
          cadence: "daily" as const,
          before: { at: localDate(2026, 11, 15, 17, 59), period: "2026-11-14" },
          open: { at: localDate(2026, 11, 15, 18, 0), period: "2026-11-15" },
        },
        {
          cadence: "weekly" as const,
          before: { at: localDate(2026, 11, 15, 7, 59), period: "2026-11-02" },
          open: { at: localDate(2026, 11, 15, 8, 0), period: "2026-11-09" },
        },
        {
          cadence: "monthly" as const,
          before: { at: localDate(2026, 11, 28, 23, 59), period: "2026-10" },
          open: { at: localDate(2026, 11, 29, 0, 0), period: "2026-11" },
        },
        {
          cadence: "quarterly" as const,
          before: { at: localDate(2026, 12, 28, 23, 59), period: "2026-Q3" },
          open: { at: localDate(2026, 12, 29, 0, 0), period: "2026-Q4" },
        },
        {
          cadence: "yearly" as const,
          before: { at: localDate(2026, 12, 24, 23, 59), period: "2025" },
          open: { at: localDate(2026, 12, 25, 0, 0), period: "2026" },
        },
      ];
      const rows: Record<string, unknown>[] = [];
      for (const row of table) {
        const beforeOpen = openAt(row.cadence, row.before.at);
        assert.equal(
          beforeOpen,
          row.before.period,
          `${row.cadence} before its window opened the ${beforeOpen}, expected ${row.before.period}`,
        );
        const openPeriod = openAt(row.cadence, row.open.at);
        assert.equal(
          openPeriod,
          row.open.period,
          `${row.cadence} at its opening minute opened the ${openPeriod}, expected ${row.open.period}`,
        );
        // The period that opened stays open; the one that has not opened yet is
        // closed until its own minute.
        assert.equal(
          isReviewWindowOpen(
            row.cadence,
            row.before.period,
            "monday",
            DEFAULTS,
            row.open.at,
          ),
          true,
          `${row.cadence}: ${row.before.period} is not open after the next period opened`,
        );
        assert.equal(
          isReviewWindowOpen(
            row.cadence,
            row.open.period,
            "monday",
            DEFAULTS,
            row.before.at,
          ),
          false,
          `${row.cadence}: ${row.open.period} was open before its opening minute`,
        );
        assert.equal(
          isReviewWindowOpen(
            row.cadence,
            row.open.period,
            "monday",
            DEFAULTS,
            row.open.at,
          ),
          true,
          `${row.cadence}: ${row.open.period} is not open at its opening minute`,
        );
        // reviewOpensAt is the exact instant the page names in its note.
        const opens = reviewOpensAt(
          row.cadence,
          row.open.period,
          "monday",
          DEFAULTS,
        );
        assert.equal(opens.ok, true, `${row.cadence}: reviewOpensAt failed`);
        const opensAt = opens.ok ? opens.value : new Date(0);
        assert.equal(
          opensAt.getTime(),
          row.open.at.getTime(),
          `${row.cadence}: ${row.open.period} opens at ${opensAt.toString()}, expected ${row.open.at.toString()}`,
        );
        rows.push({
          cadence: row.cadence,
          before: {
            at: row.before.at.toString(),
            openPeriod: beforeOpen,
            newPeriodOpen: isReviewWindowOpen(
              row.cadence,
              row.open.period,
              "monday",
              DEFAULTS,
              row.before.at,
            ),
          },
          open: {
            at: row.open.at.toString(),
            openPeriod,
            noteOpens: formatReviewOpening(opensAt),
          },
        });
      }
      record(
        "7. Boundary table: before the opening minute the previous period is open and the new one is not; at the opening minute the new one is open — daily, weekly, monthly, quarterly and yearly.",
        { rows },
      );

      // The exact labels the contract pins.
      assert.equal(
        formatReviewOpening(localDate(2026, 9, 20, 8, 0)),
        "20 Sep 2026 at 08:00",
        'formatReviewOpening is not "20 Sep 2026 at 08:00"',
      );
      assert.equal(
        openingText("daily", "2026-11-15"),
        "15 Nov 2026 at 18:00",
        "the daily opening is not 15 Nov 2026 at 18:00",
      );
      assert.equal(
        openingText("weekly", "2026-11-09"),
        "15 Nov 2026 at 08:00",
        "the weekly opening is not 15 Nov 2026 at 08:00",
      );
      assert.equal(
        openingText("monthly", "2026-11"),
        "29 Nov 2026 at 00:00",
        "the monthly opening is not 29 Nov 2026 at 00:00",
      );
      assert.equal(
        openingText("quarterly", "2026-Q4"),
        "29 Dec 2026 at 00:00",
        "the quarterly opening is not 29 Dec 2026 at 00:00",
      );
      assert.equal(
        openingText("yearly", "2026"),
        "25 Dec 2026 at 00:00",
        "the yearly opening is not 25 Dec 2026 at 00:00",
      );
      record(
        "7b. reviewOpensAt + formatReviewOpening name the exact opening instant for every cadence.",
        {
          daily: "15 Nov 2026 at 18:00",
          weekly: "15 Nov 2026 at 08:00",
          monthly: "29 Nov 2026 at 00:00",
          quarterly: "29 Dec 2026 at 00:00",
          yearly: "25 Dec 2026 at 00:00",
        },
      );

      // weekStartDay is honoured, not hardcoded to Monday. 2026-11-15 is a
      // Sunday. A Sunday-start week ends on Saturday 21 Nov, so the week of
      // 15 Nov is NOT open on the 15th — only the week of 8 Nov is.
      assert.equal(
        openAt("weekly", localDate(2026, 11, 15, 7, 59), DEFAULTS, "sunday"),
        "2026-11-08",
        "a Sunday-start vault opened the current week before its last day",
      );
      assert.equal(
        openAt("weekly", localDate(2026, 11, 21, 8, 0), DEFAULTS, "sunday"),
        "2026-11-15",
        "a Sunday-start vault did not open the week on its last day at 08:00",
      );
      record(
        "7c. The weekly window follows the vault's weekStartDay: with Sunday-start the week of 15 Nov opens Sat 21 Nov at 08:00.",
        { sundayStart: { before: "2026-11-08", at: "2026-11-15" } },
      );

      // ══ 8. a changed window is what the engine uses ═════════════════════
      const laterDaily: ReviewAvailability = {
        ...DEFAULTS,
        daily: { daysBeforeEnd: 0, timeOfDay: "20:00" },
      };
      assert.equal(
        openAt("daily", localDate(2026, 11, 15, 19, 0), laterDaily),
        "2026-11-14",
        "daily at 19:00 with a 20:00 window opened today instead of yesterday",
      );
      assert.equal(
        openAt("daily", localDate(2026, 11, 15, 20, 0), laterDaily),
        "2026-11-15",
        "daily at 20:00 with a 20:00 window did not open today",
      );
      assert.equal(
        isReviewWindowOpen(
          "daily",
          "2026-11-15",
          "monday",
          laterDaily,
          localDate(2026, 11, 15, 19, 0),
        ),
        false,
        "a 20:00 daily window was open at 19:00",
      );
      // A larger daysBeforeEnd moves a monthly window earlier.
      const earlyMonthly: ReviewAvailability = {
        ...DEFAULTS,
        monthly: { daysBeforeEnd: 5, timeOfDay: "00:00" },
      };
      assert.equal(
        openAt("monthly", localDate(2026, 11, 25, 12, 0), earlyMonthly),
        "2026-11",
        "a monthly window 5 days before the end was not open on 25 Nov",
      );
      assert.equal(
        openAt("monthly", localDate(2026, 11, 25, 12, 0), DEFAULTS),
        "2026-10",
        "the shipped monthly window opened before the second-last day",
      );
      record(
        "8. A changed window drives the engine: daily at 20:00 still opens the previous day at 19:00, and monthly 5 days before the end opens early.",
        { laterDaily: "0/20:00", earlyMonthly: "5/00:00" },
      );

      // reviewWindowSummary is the operator-facing sentence the page can show.
      const summary = reviewWindowSummary(DEFAULTS.daily, "daily");
      assert.equal(
        typeof summary,
        "string",
        "reviewWindowSummary did not return a string",
      );
      assert.ok(summary.length > 0, "reviewWindowSummary returned an empty summary");
      assert.match(
        summary,
        /18:00/,
        "the daily summary does not name its time of day",
      );
      record(
        "8b. reviewWindowSummary returns a non-empty sentence naming the window's time of day.",
        { summary },
      );

      // ══════════ 9. enforcement, with the process clock pinned ═══════════
      // The write path above left this vault's windows changed (daily 20:00,
      // monthly 3/06:00). The enforcement claims are about the SHIPPED
      // defaults, so the vault is re-seeded before the clock is pinned.
      await writeSettings(root, {
        ...(await readSettings(root)),
        reviewAvailability: DEFAULTS,
      });
      // 15 Nov 2026, 19:00 local. With the shipped defaults daily has opened
      // (18:00), weekly has opened (Sunday 08:00), and monthly has not (29 Nov
      // 00:00) — so the November monthly review is an unopened period that is
      // NOT in the future, which is exactly the case the gate has to refuse
      // rather than the old future-only check.
      mock.timers.enable({
        apis: ["Date"],
        now: localDate(2026, 11, 15, 19, 0).getTime(),
      });
      try {
        assert.equal(
          openReviewPeriod("daily", "monday", DEFAULTS),
          "2026-11-15",
          "with the clock pinned at 19:00 the daily review is not open",
        );
        assert.equal(
          openReviewPeriod("monthly", "monday", DEFAULTS),
          "2026-10",
          "with the clock pinned at 15 Nov the November monthly review is already open",
        );

        // The open period is ensured and written.
        const openPeriod = "2026-11-15";
        const openedResult = await ensureReview(root, {
          cadence: "daily",
          period: openPeriod,
          scope: "overall",
        });
        assert.equal(
          openedResult.ok,
          true,
          `ensureReview refused the open daily period: ${openedResult.ok ? "" : openedResult.error}`,
        );
        const openFile = vaultPaths(root).reviewMd("daily", openPeriod);
        assert.equal(
          await exists(openFile),
          true,
          "ensureReview for the open period created no file",
        );
        const openBody = openedResult.ok ? openedResult.value.bodyMarkdown : "";
        const written = await writeReview(root, {
          cadence: "daily",
          period: openPeriod,
          bodyMarkdown: `${openBody}\n\nA line the operator typed in the open window.`,
          actor: { type: "user" },
        });
        assert.equal(
          written.ok,
          true,
          `writeReview refused the open daily period: ${written.ok ? "" : written.error}`,
        );
        record(
          "9. With the clock pinned at 15 Nov 2026 19:00, the open daily period (15 Nov) is ensured and written.",
          { period: openPeriod },
        );

        // The unopened period: November's monthly review opens 29 Nov 00:00.
        const unopenedPeriod = "2026-11";
        const expectsOpening = openingText("monthly", unopenedPeriod);
        const unopenedFile = vaultPaths(root).reviewMd(
          "monthly",
          unopenedPeriod,
        );
        assert.equal(
          await exists(unopenedFile),
          false,
          "the unopened review file already existed",
        );
        const refusedEnsure = await ensureReview(root, {
          cadence: "monthly",
          period: unopenedPeriod,
          scope: "overall",
        });
        assert.equal(
          refusedEnsure.ok,
          false,
          "ensureReview created the November monthly review before its window opened",
        );
        const ensureError = refusedEnsure.ok ? "" : refusedEnsure.error;
        assert.ok(
          ensureError.includes(expectsOpening),
          `the refusal does not name when the review opens (${expectsOpening}): ${ensureError}`,
        );
        assert.equal(
          await exists(unopenedFile),
          false,
          "the refused ensureReview still created a file",
        );
        record(
          "9b. ensureReview refuses a period before its window opens, names the opening instant, and creates no file.",
          { period: unopenedPeriod, expectsOpening, error: ensureError },
        );

        // The previous (open) monthly period is created and written normally.
        const previousMonthly = "2026-10";
        const previousEnsure = await ensureReview(root, {
          cadence: "monthly",
          period: previousMonthly,
          scope: "overall",
        });
        assert.equal(
          previousEnsure.ok,
          true,
          `ensureReview refused the open monthly period: ${previousEnsure.ok ? "" : previousEnsure.error}`,
        );
        const previousFile = vaultPaths(root).reviewMd(
          "monthly",
          previousMonthly,
        );
        const previousBody = previousEnsure.ok
          ? previousEnsure.value.bodyMarkdown
          : "";
        const previousWrite = await writeReview(root, {
          cadence: "monthly",
          period: previousMonthly,
          bodyMarkdown: `${previousBody}\n\nThe October review, written while November is still closed.`,
          actor: { type: "user" },
        });
        assert.equal(
          previousWrite.ok,
          true,
          `writeReview refused the open monthly period: ${previousWrite.ok ? "" : previousWrite.error}`,
        );

        // Forge a file for the unopened period by copying the open period's
        // file, so a refusal can only be the window gate and not "not found".
        await fs.copyFile(previousFile, unopenedFile);
        const forged = await getReview(root, "monthly", unopenedPeriod);
        assert.equal(
          forged.ok,
          true,
          "a review file that exists could not be read back (reads must not be gated)",
        );
        const refusedWrite = await writeReview(root, {
          cadence: "monthly",
          period: unopenedPeriod,
          bodyMarkdown: `${forged.ok ? forged.value.bodyMarkdown : ""}\n\nThis must not be written.`,
          actor: { type: "user" },
        });
        assert.equal(
          refusedWrite.ok,
          false,
          "writeReview wrote the November monthly review before its window opened",
        );
        const writeError = refusedWrite.ok ? "" : refusedWrite.error;
        assert.notEqual(
          writeError,
          "Review file not found",
          "writeReview refused the unopened period because it could not find the file, not because its window is closed",
        );
        const afterRefusedWrite = await getReview(
          root,
          "monthly",
          unopenedPeriod,
        );
        assert.equal(
          afterRefusedWrite.ok
            ? afterRefusedWrite.value.bodyMarkdown.includes(
                "This must not be written.",
              )
            : false,
          false,
          "the refused write still changed the file on disk",
        );
        record(
          "9c. writeReview refuses an unopened period even when a file exists; the refusal is the window, not a missing file, and the file is unchanged.",
          { period: unopenedPeriod, error: writeError },
        );

        // Reads of past and open periods keep working, and past periods stay
        // writable: the gate is a lower bound on the newest period, not a lock
        // on every period once the clock moves.
        const readOpen = await getReview(root, "daily", openPeriod);
        assert.equal(
          readOpen.ok,
          true,
          "an open period's review could not be read",
        );
        const pastMonthly = "2026-09";
        const pastEnsure = await ensureReview(root, {
          cadence: "monthly",
          period: pastMonthly,
          scope: "overall",
        });
        assert.equal(
          pastEnsure.ok,
          true,
          `ensureReview refused a past monthly period: ${pastEnsure.ok ? "" : pastEnsure.error}`,
        );
        const pastBody = pastEnsure.ok ? pastEnsure.value.bodyMarkdown : "";
        const pastWrite = await writeReview(root, {
          cadence: "monthly",
          period: pastMonthly,
          bodyMarkdown: `${pastBody}\n\nSeptember, written later.`,
          actor: { type: "user" },
        });
        assert.equal(
          pastWrite.ok,
          true,
          `writeReview refused a past monthly period: ${pastWrite.ok ? "" : pastWrite.error}`,
        );
        const pastRead = await getReview(root, "monthly", pastMonthly);
        assert.equal(
          pastRead.ok,
          true,
          "a past period's review could not be read",
        );
        record(
          "9d. Reads and writes of open and past periods keep working: the gate only refuses the period whose window has not opened.",
          { read: openPeriod, pastWritten: pastMonthly },
        );

        // ══ 10. the stored window is what the gate uses ══════════════════
        // Change daily to 20:00 and monthly to open far earlier. The engine must
        // gate on what was saved, not on the shipped default.
        const changed: ReviewAvailability = {
          ...DEFAULTS,
          daily: { daysBeforeEnd: 0, timeOfDay: "20:00" },
          monthly: { daysBeforeEnd: 60, timeOfDay: "00:00" },
        };
        const saved = await updateSettings(root, {
          reviewAvailability: changed,
        });
        assert.equal(
          saved.ok,
          true,
          "updateSettings refused the changed windows",
        );
        assert.deepEqual(
          (await readSettings(root)).reviewAvailability,
          changed,
          "the changed windows did not reach settings.json",
        );
        // Same pinned clock (19:00): a 20:00 daily window means today's review
        // is NOT open any more — the engine reads the stored window.
        assert.equal(
          openReviewPeriod("daily", "monday", changed),
          "2026-11-14",
          "the engine ignored the stored 20:00 daily window and still opened today at 19:00",
        );
        // And the monthly write that was refused a moment ago now passes,
        // because the stored window now opens it before 15 Nov.
        const nowOpenMonthly = await ensureReview(root, {
          cadence: "monthly",
          period: unopenedPeriod,
          scope: "overall",
        });
        assert.equal(
          nowOpenMonthly.ok,
          true,
          `the gate ignored the stored monthly window: ${nowOpenMonthly.ok ? "" : nowOpenMonthly.error}`,
        );
        const nowWritable = await writeReview(root, {
          cadence: "monthly",
          period: unopenedPeriod,
          bodyMarkdown: `${nowOpenMonthly.ok ? nowOpenMonthly.value.bodyMarkdown : ""}\n\nNow that the window is open.`,
          actor: { type: "user" },
        });
        assert.equal(
          nowWritable.ok,
          true,
          `the stored monthly window did not open the write: ${nowWritable.ok ? "" : nowWritable.error}`,
        );
        record(
          "10. The gate honours the stored window: changing daily to 20:00 closes today at 19:00, and opening monthly early lets the previously refused review be written.",
          { changedDaily: "0/20:00", changedMonthly: "60/00:00" },
        );

        // The repeatable artifact: only a run that held writes one.
        const report = {
          pass: true,
          ranAt: new Date().toISOString(),
          command:
            "cd apps/desktop && node --experimental-strip-types --test tests/review-availability-engine-e2e.test.ts",
          vaultRoot: "<temporary, removed after the run>",
          pinnedNow: localDate(2026, 11, 15, 19, 0).toString(),
          defaults: DEFAULTS,
          claims,
          passCount: claims.length,
          failCount: 0,
          files: {
            settings: ".lifequest/settings.json",
            reviews: ".lifequest/reviews/<cadence>/<period>.md",
            artifact:
              "apps/desktop/e2e/artifacts/review-availability-engine.json",
          },
        };
        await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
        await fs.writeFile(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);

        for (const claim of claims) {
          assert.equal(claim.pass, true, `claim failed: ${claim.claim}`);
        }
      } finally {
        mock.timers.reset();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
