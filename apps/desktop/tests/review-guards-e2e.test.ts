import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  applyLockedReviewBody,
  createVault,
  ensureReview,
  executeReviewTool,
  getReview,
  getReviewPageBody,
  installFinanceKit,
  insertRows,
  markReviewDone,
  prepopulateReview,
  shiftLocalIsoDate,
  todayLocalIso,
  unlockDomain,
  unlockReview,
  weekStartOnOrBefore,
  writeReview,
  writeReviewPage,
} from "@lifequest/vault-core";

/**
 * The review write guards, end to end, against a real vault on disk.
 *
 * A review period is one file that four writers share: the page's autosave, the
 * companion's area sessions, the snapshot pass, and a Decision apply. Before
 * these guards every one of them sent the whole body from a read it made
 * earlier, so the last writer won and the others' prose vanished — while the
 * frontmatter still said the work was done. This rig is the evidence that the
 * three fixes hold together:
 *
 *  1. one mutex per period, so a read-merge-write is never interleaved;
 *  2. a content `rev` and compare-and-swap on whole-body writes, so the page's
 *     autosave cannot overwrite a body it never saw;
 *  3. scope-addressed page writes, so two area sessions on one period never
 *     fight over the same headings.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. Two area page writes serialized but the second one composing from the
 *     first's read (a shared `record`) — one area's prose would disappear.
 *  2. A whole-body write accepted after another writer bumped the rev; the
 *     stale text would replace the newer text and report success.
 *  3. A refused write still changing the file (or bumping the rev), so a retry
 *     loop never converges.
 *  4. A locked review accepting a page write, an editor save, a mark-done or a
 *     new section — "finished" that keeps moving.
 *  5. A Decision apply replacing a heading the file changed after the proposal
 *     (the stale-resurrection bug), or applying nothing at all.
 *  6. The snapshot pass reverting an area page written while its figures were
 *     being read, because its whole-body write did not carry its rev.
 *  7. The page projection losing the four headings or the rev the companion
 *     needs to write back.
 *  8. An artifact written by a failing run; failures throw, and the artifact is
 *     written only after the last assertion holds.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/review-guards.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

const HEADINGS = ["Look-back", "Keep", "Change", "Next-period intent"] as const;

/** One page body: an H1 title and four H2 sections with text under each. */
function page(title: string, text: Record<string, string>): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const heading of HEADINGS) {
    lines.push(`## ${heading}`, "", text[heading] ?? "", "");
  }
  return lines.join("\n");
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function check(result: { ok: boolean; error?: string }, message: string): void {
  assert.equal(result.ok, true, `${message}: ${result.ok ? "" : result.error}`);
}

describe("review guards e2e", () => {
  it("keeps concurrent area writes, refuses stale whole-body writes, locks the whole period, and merges Decisions", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-guards-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};
    fs.rmSync(ARTIFACT, { force: true });

    try {
      const created = await createVault(vaultRoot, "Review Guards Rig");
      check(created, "createVault failed");
      for (const slug of ["health", "mind", "financial"]) {
        const unlocked = await unlockDomain(vaultRoot, slug);
        check(unlocked, `unlockDomain(${slug}) failed`);
      }

      const today = todayLocalIso();
      const period = weekStartOnOrBefore(shiftLocalIsoDate(today, -21)!, "monday");
      checks.period = period;

      const ensured = await ensureReview(vaultRoot, { cadence: "weekly", period, scope: "overall" });
      check(ensured, "ensureReview(overall) failed");

      // ── 1. two area sessions write concurrently; both reports survive ─────
      const [healthWrite, mindWrite] = await Promise.all([
        executeReviewTool(vaultRoot, ACTOR, "write_review", {
          cadence: "weekly",
          period,
          scope: "health",
          body: page("Health", {
            "Look-back": "Two walks and three early nights.",
            Keep: "Walks at lunch.",
            Change: "Phone out of the bedroom.",
            "Next-period intent": "Four walks next week.",
          }),
        }),
        executeReviewTool(vaultRoot, ACTOR, "write_review", {
          cadence: "weekly",
          period,
          scope: "mind",
          body: page("Mind", {
            "Look-back": "Read three evenings.",
            Keep: "A chapter before bed.",
            Change: "Less scrolling in the morning.",
            "Next-period intent": "Finish the book.",
          }),
        }),
      ]) as Array<{ review?: { bodyMarkdown: string }; error?: unknown }>;
      assert.equal(healthWrite.error, undefined, "the health session's write was refused");
      assert.equal(mindWrite.error, undefined, "the mind session's write was refused");

      const afterAreas = await getReview(vaultRoot, "weekly", period);
      check(afterAreas, "the review could not be read after the two area writes");
      const bodyAfterAreas = afterAreas.ok ? afterAreas.value.bodyMarkdown : "";
      checks.bodyAfterAreas = bodyAfterAreas;
      assert.match(bodyAfterAreas, /Two walks and three early nights\./, "the health page's prose is gone");
      assert.match(bodyAfterAreas, /Read three evenings\./, "the mind page's prose is gone");
      assert.equal(countOf(bodyAfterAreas, "## Health"), 1, "the health section was planted twice");
      assert.equal(countOf(bodyAfterAreas, "## Mind"), 1, "the mind section was planted twice");

      // ── 2. the companion reads back its own page and the rev to quote ─────
      const readPage = await getReviewPageBody(vaultRoot, "weekly", period, "health");
      check(readPage, "the health page could not be read");
      const pageValue = readPage.ok ? readPage.value : null;
      checks.page = pageValue;
      assert.ok(pageValue, "no page value");
      assert.match(pageValue!.bodyMarkdown, /^# Health\n\n## Look-back/, "the page is not one H1 and the four H2s");
      assert.match(pageValue!.bodyMarkdown, /Two walks and three early nights\./, "the page lost its prose");
      assert.equal(
        (pageValue!.bodyMarkdown.match(/^## /gm) ?? []).length,
        4,
        "the page does not hold exactly the four required headings",
      );
      const scopedRead = await executeReviewTool(vaultRoot, ACTOR, "get_review", {
        cadence: "weekly",
        period,
        scope: "health",
      }) as { page?: { rev: number; bodyMarkdown: string }; review?: unknown };
      assert.ok(scopedRead.page, "get_review with a scope did not return a page");
      assert.equal(scopedRead.page!.rev, pageValue!.rev, "the page's rev does not match the file's");
      const beforeStale = await getReview(vaultRoot, "weekly", period);
      check(beforeStale, "the review could not be read before the stale write");
      const staleRecord = beforeStale.ok ? beforeStale.value : null;
      assert.ok(staleRecord, "no record for the stale write");

      // ── 3. a whole-body save from before another writer landed is refused ─
      const mindUpdate = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period,
        scope: "mind",
        bodyMarkdown: page("Mind", {
          "Look-back": "Read four evenings.",
          Keep: "A chapter before bed.",
          Change: "Less scrolling in the morning.",
          "Next-period intent": "Finish the book.",
        }),
        actor: ACTOR,
      });
      check(mindUpdate, "the mind page update failed");
      const stale = await writeReview(vaultRoot, {
        cadence: "weekly",
        period,
        bodyMarkdown: staleRecord!.bodyMarkdown,
        actor: ACTOR,
        baseRev: staleRecord!.rev,
      });
      checks.staleWrite = stale;
      assert.equal(stale.ok, false, "a stale whole-body write was accepted");
      assert.equal(stale.ok ? "" : stale.code, "CONFLICT", "the stale write was not a conflict");
      assert.equal(
        stale.ok ? 0 : stale.current?.rev,
        staleRecord!.rev + 1,
        "the conflict did not carry the file as it now stands",
      );
      const afterStale = await getReview(vaultRoot, "weekly", period);
      const bodyAfterStale = afterStale.ok ? afterStale.value.bodyMarkdown : "";
      assert.match(bodyAfterStale, /Read four evenings\./, "the newer mind report was overwritten by the stale save");
      assert.match(bodyAfterStale, /Two walks and three early nights\./, "the health report was lost in the stale save");

      // ── 4. a locked review refuses every write path ───────────────────────
      const financial = await ensureReview(vaultRoot, { cadence: "weekly", period, scope: "financial" });
      check(financial, "ensureReview(financial) failed");
      const financialWrite = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period,
        scope: "financial",
        bodyMarkdown: page("Finance", { "Look-back": "Spent less than planned." }),
        actor: ACTOR,
      });
      check(financialWrite, "the finance page write failed");
      for (const scope of ["health", "mind", "financial"]) {
        const done = await markReviewDone(vaultRoot, { cadence: "weekly", period, scope });
        check(done, `markReviewDone(${scope}) failed`);
      }
      const locked = await markReviewDone(vaultRoot, { cadence: "weekly", period, scope: "overall" });
      check(locked, "the life review could not be completed");
      const lockedRecord = await getReview(vaultRoot, "weekly", period);
      assert.equal(lockedRecord.ok ? lockedRecord.value.locked : false, true, "the review did not lock");

      const lockedPage = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period,
        scope: "health",
        bodyMarkdown: page("Health", { "Look-back": "After the lock." }),
        actor: ACTOR,
      });
      assert.equal(lockedPage.ok, false, "a locked review accepted a page write");
      assert.equal(lockedPage.ok ? "" : lockedPage.code, "LOCKED", "the page refusal was not LOCKED");
      const lockedWhole = await writeReview(vaultRoot, {
        cadence: "weekly",
        period,
        bodyMarkdown: bodyAfterStale,
        actor: ACTOR,
      });
      assert.equal(lockedWhole.ok, false, "a locked review accepted an editor save");
      assert.equal(lockedWhole.ok ? "" : lockedWhole.code, "LOCKED", "the editor refusal was not LOCKED");
      const lockedMark = await markReviewDone(vaultRoot, { cadence: "weekly", period, scope: "overall" });
      assert.equal(lockedMark.ok, false, "a locked review accepted a second mark-done");
      checks.lockedRefusals = {
        page: lockedPage.ok ? "" : lockedPage.code,
        whole: lockedWhole.ok ? "" : lockedWhole.code,
        mark: lockedMark.ok ? "" : lockedMark.error,
      };

      // ── 5. a Decision applies only the headings the file still honours ────
      const period2 = weekStartOnOrBefore(shiftLocalIsoDate(today, -28)!, "monday");
      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period: period2, scope: "overall" }),
        "ensureReview(overall, period2) failed",
      );
      for (const [scope, title] of [
        ["health", "Health"],
        ["mind", "Mind"],
        ["financial", "Finance"],
      ] as const) {
        check(
          await ensureReview(vaultRoot, { cadence: "weekly", period: period2, scope }),
          `ensureReview(${scope}, period2) failed`,
        );
        check(
          await writeReviewPage(vaultRoot, {
            cadence: "weekly",
            period: period2,
            scope,
            bodyMarkdown: page(title, {
              "Look-back": `${title} original.`,
              Keep: "Keep original.",
              Change: "Change original.",
              "Next-period intent": "Intent original.",
            }),
            actor: ACTOR,
          }),
          `writeReviewPage(${scope}, period2) failed`,
        );
        check(
          await markReviewDone(vaultRoot, { cadence: "weekly", period: period2, scope }),
          `markReviewDone(${scope}, period2) failed`,
        );
      }
      check(
        await markReviewDone(vaultRoot, { cadence: "weekly", period: period2, scope: "overall" }),
        "period2 did not lock",
      );
      const locked2 = await getReview(vaultRoot, "weekly", period2);
      const previous = locked2.ok ? locked2.value.bodyMarkdown : "";
      const proposed = previous
        .replace("Health original.", "Health proposed.")
        .replace("Mind original.", "Mind proposed.");
      checks.proposedDecisionBody = proposed;

      check(await unlockReview(vaultRoot, "weekly", period2, ACTOR), "period2 did not unlock");
      const newer = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period: period2,
        scope: "health",
        bodyMarkdown: page("Health", {
          "Look-back": "Health newer.",
          Keep: "Keep newer.",
          Change: "Change newer.",
          "Next-period intent": "Intent newer.",
        }),
        actor: ACTOR,
      });
      check(newer, "the newer health write failed");
      check(
        await markReviewDone(vaultRoot, { cadence: "weekly", period: period2, scope: "overall" }),
        "period2 did not re-lock",
      );
      const applied = await applyLockedReviewBody(
        vaultRoot,
        "weekly",
        period2,
        proposed,
        ACTOR,
        previous,
      );
      check(applied, "the Decision body was not applied");
      const afterApply = await getReview(vaultRoot, "weekly", period2);
      const bodyAfterApply = afterApply.ok ? afterApply.value.bodyMarkdown : "";
      checks.bodyAfterApply = bodyAfterApply;
      assert.match(bodyAfterApply, /Health newer\./, "the merge resurrected the stale health prose");
      assert.equal(bodyAfterApply.includes("Health proposed."), false, "the merge took the stale health heading");
      assert.match(bodyAfterApply, /Mind proposed\./, "the merge did not apply the mind heading it was based on");
      assert.equal(bodyAfterApply.includes("Mind original."), false, "the merge left the old mind prose");

      // A new area cannot be planted into a finished document either. This runs
      // last: unlocking an area changes the live set every later mark-done gate
      // counts, so it must not happen before the periods above are complete.
      check(await unlockDomain(vaultRoot, "business"), "unlockDomain(business) failed");
      const lateSection = await ensureReview(vaultRoot, {
        cadence: "weekly",
        period: period2,
        scope: "business",
      });
      assert.equal(lateSection.ok, false, "a locked review grew a new area section");
      (checks.lockedRefusals as Record<string, unknown>).section = lateSection.ok ? "" : lateSection.error;

      // ── 6. the snapshot pass does not revert an area written under it ─────
      const period3 = "2026-10-12";
      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period: period3, scope: "overall" }),
        "ensureReview(period3) failed",
      );
      const kit = await installFinanceKit(vaultRoot, ACTOR);
      check(kit, "the finance kit did not install");
      check(
        await insertRows(vaultRoot, "financial", "finance:accounts", [
          { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
        ]),
        "the rig could not create an account",
      );
      check(
        await insertRows(vaultRoot, "financial", "finance:transactions", [
          {
            id: "t-1",
            cells: {
              date: "2026-10-13",
              amount: 120.5,
              payee: "Checkers",
              account: "acc-1",
            },
          },
        ]),
        "the rig could not post a transaction",
      );
      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period: period3, scope: "financial" }),
        "the financial section was not planted for the snapshot pass",
      );
      const racingHealth = page("Health", {
        "Look-back": "Health written while the figures were read.",
        Keep: "Keep racing.",
        Change: "Change racing.",
        "Next-period intent": "Intent racing.",
      });
      const [, raced] = await Promise.all([
        prepopulateReview(vaultRoot, {
          cadence: "weekly",
          period: period3,
          scope: "financial",
          actor: ACTOR,
        }),
        writeReviewPage(vaultRoot, {
          cadence: "weekly",
          period: period3,
          scope: "health",
          bodyMarkdown: racingHealth,
          actor: ACTOR,
        }),
      ]);
      check(raced, "the racing health write failed");
      const afterPass = await getReview(vaultRoot, "weekly", period3);
      const bodyAfterPass = afterPass.ok ? afterPass.value.bodyMarkdown : "";
      checks.bodyAfterPass = bodyAfterPass;
      assert.match(
        bodyAfterPass,
        /Health written while the figures were read\./,
        "the snapshot pass reverted the area written while it was reading",
      );
      assert.match(
        bodyAfterPass,
        /<!-- lifequest:snapshot:finance-spend -->/,
        "the snapshot pass did not write its figure",
      );

      // ── artifact (only a run that held this far reaches this line) ────────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(
        ARTIFACT,
        `${JSON.stringify(
          {
            spec: "review write guards",
            period,
            checks,
            summary:
              "two concurrent area pages kept; stale editor save refused with CONFLICT; " +
              "locked review refused page/editor/mark/new-section writes; Decision merge kept " +
              "newer health prose and applied the mind heading; snapshot pass kept the area " +
              "written while it read its figures",
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
