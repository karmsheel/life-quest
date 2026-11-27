import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createVault,
  ensureReview,
  getPeriodPack,
  getReview,
  getReviewAreaChecklist,
  getReviewSkill,
  markReviewDone,
  shiftLocalIsoDate,
  todayLocalIso,
  unlockDomain,
  weekStartOnOrBefore,
} from "@lifequest/vault-core";
import { boundKickoff, formatReviewContext } from "../electron/review-sessions.ts";

/**
 * Domain sub-reviews, end to end, against a real vault on disk.
 *
 * This is the engine half of the feature the Review page renders: one review
 * file per cadence+period, one `## <Area name>` section per live area, a
 * checklist that reports which areas are missing, in progress and done, and an
 * overall review that cannot be marked done (and therefore cannot lock the
 * file) until every live area's section is done. The daily cadence is the
 * deliberate exception: one general review, no area sections, and both
 * `ensureReview` and `markReviewDone` refuse an area scope with a sentence the
 * operator reads.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`), so it
 * needs no Electron and no dev server. The two message-shaping functions are
 * imported from the real main-process module, because the bound session's
 * kickoff and its instruction context are what the companion actually sees.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The checklist counting a locked area, or the `life` base area, so the
 *     operator is told to review every area and can never unlock the life
 *     review.
 *  2. The checklist reading a missing review file as an error, which would make
 *     every fresh period unstartable instead of showing "Not started".
 *  3. The checklist reporting a scope's section as done when the frontmatter
 *     status is still draft — progress that lies is worse than no progress.
 *  4. `markReviewDone(overall)` on a non-daily cadence locking the file while
 *     areas are missing, which skips the sub-reviews the feature exists for.
 *  5. The refusal naming done areas, or losing the "in progress" / "not started"
 *     distinction, so the operator cannot tell what is left to do.
 *  6. A daily review accepting an area scope (or a daily area mark-done), which
 *     would plant an area section the daily page never shows.
 *  7. A daily overall review being gated by the checklist, so a daily review can
 *     never be completed.
 *  8. Marking one area done marking the others (or the overall scope) done too;
 *     completion is per-area and the file must stay editable until the life
 *     review is done.
 *  9. Locking creating extra files or a second copy of a section, which would
 *     split the review across files.
 * 10. The life review's kickoff not telling the companion to synthesise across
 *     the area sections, so the summary repeats one area instead of reading all
 *     of them.
 * 11. The area kickoff not naming its own section, so the companion writes a
 *     second area's prose into the wrong heading.
 * 12. The daily kickoff still implying area sections exist.
 * 13. The instruction context losing the operator's review skill, or omitting
 *     the scope line, so the companion does not know what it is writing.
 * 14. An artifact written by a failing run. Every assertion throws, and the
 *     artifact is written only after the last one holds.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/review-areas.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

const DAILY_SENTENCE = "The daily review is one general review — it has no area sections.";
const GATE_PREFIX = "Finish every area review first — ";

function readFileNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** The level-2 headings of a review body, in file order. */
function h2Headings(body: string): string[] {
  return body
    .split("\n")
    .map((line) => /^##\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]!.trim());
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("review areas e2e", () => {
  it("gates the life review on every live area, and keeps daily one general review", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-areas-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    // A failed run must leave no artifact behind, even when a previous run passed.
    fs.rmSync(ARTIFACT, { force: true });

    try {
      const created = await createVault(vaultRoot, "Review Areas Rig");
      assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);

      // Three live areas; business and relationships stay locked. The checklist
      // must list exactly these three, in the vault's own order.
      for (const slug of ["health", "mind", "financial"]) {
        const unlocked = await unlockDomain(vaultRoot, slug);
        assert.equal(
          unlocked.ok,
          true,
          `unlockDomain(${slug}) failed: ${unlocked.ok ? "" : unlocked.error}`,
        );
      }

      // Past periods, so `ensureReview` never refuses a future review. A past
      // week is wholly writable on every day of the year.
      const today = todayLocalIso();
      const weekPeriod = weekStartOnOrBefore(shiftLocalIsoDate(today, -28)!, "monday");
      const dayPeriod = shiftLocalIsoDate(today, -2)!;
      checks.periods = { weekly: weekPeriod, daily: dayPeriod };

      // ── 1. a fresh weekly review: three live areas, all missing ───────────
      const planted = await ensureReview(vaultRoot, {
        cadence: "weekly",
        period: weekPeriod,
        scope: "overall",
      });
      assert.equal(planted.ok, true, `ensureReview(weekly overall) failed: ${planted.ok ? "" : planted.error}`);

      const fresh = await getReviewAreaChecklist(vaultRoot, "weekly", weekPeriod);
      assert.equal(fresh.ok, true, `getReviewAreaChecklist failed: ${fresh.ok ? "" : fresh.error}`);
      const freshList = fresh.ok ? fresh.value : null;
      assert.ok(freshList, "no checklist");
      checks.freshChecklist = freshList;
      assert.deepEqual(
        freshList!.areas.map((a) => a.slug),
        ["health", "mind", "financial"],
        "the checklist is not exactly the live areas, in vault order",
      );
      assert.deepEqual(
        freshList!.areas.map((a) => a.name),
        ["Health", "Mind", "Finance"],
        "the checklist lost the areas' display names",
      );
      assert.deepEqual(
        freshList!.areas.map((a) => a.status),
        ["missing", "missing", "missing"],
        "a fresh review reported an area as started",
      );
      assert.equal(freshList!.done, 0, "a fresh review has done areas");
      assert.equal(freshList!.total, 3, "the checklist's total is not the live area count");
      assert.equal(freshList!.allDone, false, "an unreviewed file reported allDone");
      assert.deepEqual(freshList!.remaining, ["Health", "Mind", "Finance"], "remaining is not the not-done areas");

      // ── 2. the life review refuses while areas are missing ────────────────
      const refused = await markReviewDone(vaultRoot, {
        cadence: "weekly",
        period: weekPeriod,
        scope: "overall",
      });
      assert.equal(refused.ok, false, "the life review was marked done with no area reviews");
      const refusedError = refused.ok ? "" : refused.error;
      checks.refusal = refusedError;
      assert.ok(refusedError.startsWith(GATE_PREFIX), `the refusal lost its prefix: ${refusedError}`);
      assert.match(refusedError, /Health: not started/, "the refusal does not name Health as not started");
      assert.match(refusedError, /Mind: not started/, "the refusal does not name Mind");
      assert.match(refusedError, /Finance: not started/, "the refusal does not name Finance");
      // A refused mark did not write: the file is still unlocked and draft.
      const afterRefusal = await getReview(vaultRoot, "weekly", weekPeriod);
      assert.equal(afterRefusal.ok && afterRefusal.value.locked, false, "a refused mark locked the file");
      assert.equal(
        afterRefusal.ok && afterRefusal.value.scopes.overall?.status,
        "draft",
        "a refused mark completed the overall scope",
      );

      // Starting an area (draft) changes the refusal's wording: in progress.
      const healthStarted = await ensureReview(vaultRoot, {
        cadence: "weekly",
        period: weekPeriod,
        scope: "health",
      });
      assert.equal(healthStarted.ok, true, "the Health section was not planted");
      const inProgress = await markReviewDone(vaultRoot, {
        cadence: "weekly",
        period: weekPeriod,
        scope: "overall",
      });
      const inProgressError = inProgress.ok ? "" : inProgress.error;
      checks.inProgressRefusal = inProgressError;
      assert.ok(
        inProgressError.includes("Health: in progress"),
        `a started area is not reported as in progress: ${inProgressError}`,
      );
      assert.ok(
        inProgressError.includes("Mind: not started"),
        `an unstarted area is not reported as not started: ${inProgressError}`,
      );
      assert.equal(
        inProgressError.replace("Health: in progress", "Health: not started"),
        refusedError,
        "the refusal's own prefix/suffix changed with the statuses it lists",
      );

      // ── 3. per-area completion, and progress that tells the truth ────────
      const completedHealth = await markReviewDone(vaultRoot, {
        cadence: "weekly",
        period: weekPeriod,
        scope: "health",
      });
      assert.equal(completedHealth.ok, true, "the Health review could not be marked done");

      const oneOfThree = await getReviewAreaChecklist(vaultRoot, "weekly", weekPeriod);
      const one = oneOfThree.ok ? oneOfThree.value : null;
      checks.progressOne = one;
      assert.ok(one, "no checklist after the first area");
      assert.equal(one!.done, 1, "the first area was not counted");
      assert.equal(one!.allDone, false, "allDone with two areas outstanding");
      assert.deepEqual(one!.remaining, ["Mind", "Finance"], "remaining after one is wrong");
      assert.deepEqual(
        one!.areas.map((a) => a.status),
        ["done", "missing", "missing"],
        "the first area's status is wrong",
      );

      // Completing one area did not complete another, nor the overall scope.
      assert.equal(
        one!.areas[1]!.status !== "done" && one!.areas[2]!.status !== "done",
        true,
        "completing one area completed the others",
      );
      const afterOne = await getReview(vaultRoot, "weekly", weekPeriod);
      assert.equal(
        afterOne.ok && afterOne.value.scopes.overall?.status,
        "draft",
        "completing an area completed the overall scope",
      );

      for (const slug of ["mind", "financial"]) {
        const ensured = await ensureReview(vaultRoot, {
          cadence: "weekly",
          period: weekPeriod,
          scope: slug,
        });
        assert.equal(ensured.ok, true, `the ${slug} section was not planted: ${ensured.ok ? "" : ensured.error}`);
        const done = await markReviewDone(vaultRoot, {
          cadence: "weekly",
          period: weekPeriod,
          scope: slug,
        });
        assert.equal(done.ok, true, `the ${slug} review could not be marked done`);

        const progress = await getReviewAreaChecklist(vaultRoot, "weekly", weekPeriod);
        const value = progress.ok ? progress.value : null;
        if (slug === "mind") {
          checks.progressTwo = value;
          assert.equal(value?.done, 2, "the second area was not counted");
          assert.equal(value?.allDone, false, "allDone with one area outstanding");
          assert.deepEqual(value?.remaining, ["Finance"], "remaining after two is wrong");
        } else {
          checks.progressThree = value;
          assert.equal(value?.done, 3, "the third area was not counted");
          assert.equal(value?.total, 3, "the total changed as areas were completed");
          assert.equal(value?.allDone, true, "all three areas are done but allDone is false");
          assert.deepEqual(value?.remaining, [], "a complete checklist still names remaining areas");
          assert.deepEqual(
            value?.areas.map((a) => a.status),
            ["done", "done", "done"],
            "a complete checklist does not report every area done",
          );
        }
      }

      // ── 4. the life review after every area: done, locked, still complete ─
      const overallDone = await markReviewDone(vaultRoot, {
        cadence: "weekly",
        period: weekPeriod,
        scope: "overall",
      });
      assert.equal(
        overallDone.ok,
        true,
        `the life review was refused after every area: ${overallDone.ok ? "" : overallDone.error}`,
      );
      const lockedRecord = await getReview(vaultRoot, "weekly", weekPeriod);
      assert.equal(lockedRecord.ok, true, "the review could not be read after locking");
      const lockedValue = lockedRecord.ok ? lockedRecord.value : null;
      checks.locked = lockedValue?.locked;
      assert.equal(lockedValue?.locked, true, "the life review did not lock the file");
      assert.equal(lockedValue?.scopes.overall?.status, "done", "the overall scope is not done");
      assert.equal(lockedValue?.scopes.health?.status, "done", "an area scope was lost when locking");
      assert.equal(lockedValue?.scopes.business, undefined, "a locked area was added to the file");
      assert.equal(lockedValue?.scopes.relationships, undefined, "a locked area was added to the file");

      const afterLock = await getReviewAreaChecklist(vaultRoot, "weekly", weekPeriod);
      const afterLockValue = afterLock.ok ? afterLock.value : null;
      checks.afterLock = afterLockValue;
      assert.equal(afterLockValue?.allDone, true, "the checklist forgot the done areas after locking");
      assert.equal(afterLockValue?.total, 3, "the checklist total changed after locking");

      // ── 5. one file, one section per area, no duplicates ──────────────────
      const weeklyFiles = readFileNames(path.join(vaultRoot, "reviews", "weekly"));
      checks.weeklyFiles = weeklyFiles;
      // A period is a notebook directory now: the manifest plus one page per
      // scope. The old single file must be gone (the migration archives it).
      assert.deepEqual(weeklyFiles, [weekPeriod], "locking created or removed a review period");
      const notebookDir = path.join(vaultRoot, "reviews", "weekly", weekPeriod);
      assert.ok(fs.existsSync(path.join(notebookDir, "review.json")), "the notebook manifest is missing");
      assert.deepEqual(
        readFileNames(notebookDir).sort(),
        ["review.json", "overall.md", "health.md", "mind.md", "financial.md"].sort(),
        "the notebook does not hold one page per scope",
      );
      assert.deepEqual(
        readFileNames(path.join(vaultRoot, "reviews")),
        ["weekly"],
        "a second cadence directory appeared",
      );
      const body = lockedValue?.bodyMarkdown ?? "";
      checks.headings = h2Headings(body);
      for (const name of ["Health", "Mind", "Finance"]) {
        assert.equal(countOf(body, `## ${name}`), 1, `the ## ${name} section appears more than once`);
      }
      assert.equal(body.includes("## Life"), false, "the base area became an area section");
      assert.deepEqual(
        h2Headings(body),
        [
          "Look-back",
          "Keep",
          "Change",
          "Next-period intent",
          "Health",
          "Mind",
          "Finance",
        ],
        "the body's sections are not the overall skeleton plus the three areas",
      );

      // ── 6. daily is one general review ───────────────────────────────────
      const dailyAreaEnsure = await ensureReview(vaultRoot, {
        cadence: "daily",
        period: dayPeriod,
        scope: "health",
      });
      checks.dailyAreaEnsure = dailyAreaEnsure.ok ? null : dailyAreaEnsure.error;
      assert.equal(dailyAreaEnsure.ok, false, "a daily review accepted an area scope");
      assert.equal(
        dailyAreaEnsure.ok ? "" : dailyAreaEnsure.error,
        DAILY_SENTENCE,
        "the daily area refusal is not the operator's sentence, word for word",
      );

      const dailyOverall = await ensureReview(vaultRoot, {
        cadence: "daily",
        period: dayPeriod,
        scope: "overall",
      });
      assert.equal(dailyOverall.ok, true, `the daily review was not planted: ${dailyOverall.ok ? "" : dailyOverall.error}`);

      const dailyMarkArea = await markReviewDone(vaultRoot, {
        cadence: "daily",
        period: dayPeriod,
        scope: "health",
      });
      checks.dailyMarkArea = dailyMarkArea.ok ? null : dailyMarkArea.error;
      assert.equal(dailyMarkArea.ok, false, "a daily area scope was marked done");
      assert.equal(
        dailyMarkArea.ok ? "" : dailyMarkArea.error,
        DAILY_SENTENCE,
        "the daily area mark-done refusal is not the operator's sentence",
      );

      const dailyMarkOverall = await markReviewDone(vaultRoot, {
        cadence: "daily",
        period: dayPeriod,
        scope: "overall",
      });
      assert.equal(
        dailyMarkOverall.ok,
        true,
        `the daily review was gated by the area checklist: ${dailyMarkOverall.ok ? "" : dailyMarkOverall.error}`,
      );
      const dailyRecord = await getReview(vaultRoot, "daily", dayPeriod);
      const dailyValue = dailyRecord.ok ? dailyRecord.value : null;
      checks.dailyRecord = dailyValue
        ? { locked: dailyValue.locked, scopes: Object.keys(dailyValue.scopes), body: dailyValue.bodyMarkdown }
        : null;
      assert.equal(dailyValue?.locked, true, "the daily review did not lock");
      assert.deepEqual(Object.keys(dailyValue?.scopes ?? {}), ["overall"], "the daily review grew a scope");
      assert.equal(dailyValue?.bodyMarkdown.includes("## Health"), false, "the daily review grew an area section");

      const dailyChecklist = await getReviewAreaChecklist(vaultRoot, "daily", dayPeriod);
      const dailyList = dailyChecklist.ok ? dailyChecklist.value : null;
      checks.dailyChecklist = dailyList;
      assert.equal(dailyList?.total, 0, "the daily checklist has areas");
      assert.equal(dailyList?.allDone, true, "the daily checklist is not vacuously complete");
      assert.deepEqual(dailyList?.areas, [], "the daily checklist lists areas");
      assert.deepEqual(dailyList?.remaining, [], "the daily checklist names remaining areas");

      // ── 7. the kickoffs and context the companion actually receives ──────
      const dailyKickoff = boundKickoff({
        kind: "review",
        cadence: "daily",
        period: dayPeriod,
        scope: "overall",
        weekStartDay: "monday",
      });
      checks.dailyKickoff = dailyKickoff;
      assert.match(dailyKickoff, /one general review/, "the daily kickoff does not say it is one general review");
      assert.match(dailyKickoff, /no area sections/, "the daily kickoff still implies area sections");
      assert.match(dailyKickoff, /get_review/, "the daily kickoff lost the get_review guidance");
      assert.match(dailyKickoff, /get_period_pack/, "the daily kickoff lost the get_period_pack guidance");

      const overallKickoff = boundKickoff({
        kind: "review",
        cadence: "weekly",
        period: weekPeriod,
        scope: "overall",
        domainName: null,
        weekStartDay: "monday",
        areaCount: 3,
      });
      checks.overallKickoff = overallKickoff;
      assert.match(overallKickoff, /whole-life review/, "the life review kickoff is not the whole-life review");
      assert.match(overallKickoff, /area/, "the life review kickoff does not speak about the area reviews");
      assert.match(overallKickoff, /3 areas/, "the life review kickoff does not count the areas");
      assert.match(overallKickoff, /get_review/, "the life review kickoff lost the get_review guidance");
      assert.match(overallKickoff, /get_period_pack/, "the life review kickoff lost the get_period_pack guidance");

      const areaKickoff = boundKickoff({
        kind: "review",
        cadence: "weekly",
        period: weekPeriod,
        scope: "health",
        domainName: "Health",
        weekStartDay: "monday",
      });
      checks.areaKickoff = areaKickoff;
      assert.match(areaKickoff, /scope "health"/, "the area kickoff does not name its own scope");
      assert.match(areaKickoff, /only this page/i, "the area kickoff does not say to write only its page");
      assert.match(areaKickoff, /get_review/, "the area kickoff lost the get_review guidance");
      assert.match(areaKickoff, /write_review/, "the area kickoff lost the write_review guidance");

      // The plan kickoff is untouched by all of this.
      const planKickoff = boundKickoff({
        kind: "plan",
        cadence: "weekly",
        period: weekPeriod,
        scope: "overall",
        weekStartDay: "monday",
      });
      checks.planKickoff = planKickoff;
      assert.match(planKickoff, /Do not write a plan file yet\./, "the plan kickoff changed");

      // The instruction context names the scope and keeps the operator's skill.
      const weeklySkill = await getReviewSkill(vaultRoot, "weekly");
      const skill = weeklySkill.ok
        ? { markdown: weeklySkill.value.markdown, problems: weeklySkill.value.problems }
        : null;
      assert.ok(skill, "the weekly review skill could not be read");
      const overallPack = await getPeriodPack(vaultRoot, {
        cadence: "weekly",
        period: weekPeriod,
        scope: "overall",
      });
      const overallContext = formatReviewContext({
        kind: "review",
        pack: overallPack,
        skill,
        scope: "overall",
        domainName: null,
        cadence: "weekly",
      });
      checks.overallContext = overallContext;
      assert.match(
        overallContext,
        /Review scope: the whole life — the overall page\./,
        "the overall context does not name the whole-life scope",
      );
      assert.match(
        overallContext,
        /synthesise across them/,
        "the overall context does not tell the companion to synthesise across the sections",
      );
      assert.match(
        overallContext,
        /A week is where patterns start to show\./,
        "the context dropped the operator's own review skill",
      );

      const areaPack = await getPeriodPack(vaultRoot, {
        cadence: "weekly",
        period: weekPeriod,
        scope: "health",
      });
      const areaContext = formatReviewContext({
        kind: "review",
        pack: areaPack,
        skill,
        scope: "health",
        domainName: "Health",
        cadence: "weekly",
      });
      checks.areaContext = areaContext;
      assert.match(
        areaContext,
        /Review scope: the Health area page — call get_review with scope "health", then write_review with that scope and its rev; leave every other section and area alone\./,
        "the area context does not name and bound the area section",
      );
      assert.match(
        areaContext,
        /A week is where patterns start to show\./,
        "the area context dropped the operator's own review skill",
      );

      const dailyPack = await getPeriodPack(vaultRoot, {
        cadence: "daily",
        period: dayPeriod,
        scope: "overall",
      });
      const dailyContext = formatReviewContext({
        kind: "review",
        pack: dailyPack,
        scope: "overall",
        domainName: null,
        cadence: "daily",
      });
      checks.dailyContext = dailyContext;
      assert.match(
        dailyContext,
        /Review scope: the day as a whole — the daily review has no area sections; do not create any\./,
        "the daily context does not say the day is the whole scope",
      );

      // The two older callers pass no scope and must get no scope line.
      const noScopeContext = formatReviewContext({ kind: "review", pack: overallPack });
      checks.noScopeContextHasLine = noScopeContext.includes("Review scope:");
      assert.equal(
        noScopeContext.includes("Review scope:"),
        false,
        "a context with no scope grew a scope line",
      );

      // ── the artifact, written only after every claim above holds ──────────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      const report = {
        pass: true,
        failures: [] as string[],
        what:
          "a weekly review has one section per live area, the life review refuses and cannot lock " +
          "until every live area is done, and daily stays one general review with no area sections",
        command:
          "node --experimental-strip-types --test apps/desktop/tests/review-areas-e2e.test.ts",
        vault: vaultRoot,
        checks,
        generatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
