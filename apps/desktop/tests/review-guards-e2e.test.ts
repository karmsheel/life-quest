import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createVault,
  ensureReview,
  executeReviewTool,
  getReview,
  getReviewNotebook,
  getReviewPageBody,
  installFinanceKit,
  insertRows,
  getReviewAreaChecklist,
  markReviewDone,
  prepopulateReview,
  resolveDecision,
  shiftLocalIsoDate,
  todayLocalIso,
  unlockDomain,
  unlockReview,
  weekStartOnOrBefore,
  writeReview,
  writeReviewPage,
} from "@lifequest/vault-core";

/**
 * The review notebook's write guards, end to end, against a real vault on disk.
 *
 * A review period is a notebook: a manifest plus one markdown page per scope.
 * Four writers share it — the page's autosave, the companion's area sessions,
 * the snapshot pass, and a Decision apply. Phase 1 moves the compare-and-swap
 * from the file onto each page, and this rig is the evidence the contract holds:
 *
 *  1. one mutex per notebook, so read-merge-write is never interleaved;
 *  2. a page `rev` and compare-and-swap per page, so two area interviews never
 *     see a false conflict while two writes to one page do;
 *  3. the compatibility whole-body write still CASes (on the composite notebook
 *     rev) and splits only the pages whose body changed;
 *  4. lock/gating at the notebook level, with every page write refused;
 *  5. a locked page's write becomes a `review-page` Decision, applied with the
 *     page rev recorded at propose time — a page that moved refuses as STALE and
 *     keeps the Decision pending;
 *  6. the snapshot pass writes only its page and never reverts another page.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. Two concurrent page writes serialized but both composing from one read —
 *     one area's prose disappears.
 *  2. A page write accepted with a stale `baseRev`; the stale text replaces the
 *     newer page and reports success.
 *  3. A refused write still changing the page or bumping its rev, so a retry
 *     loop never converges (including the canonicaliser not being a fixed point).
 *  4. A locked notebook accepting a page write, a compatibility save, a
 *     mark-done, or a page creation.
 *  5. A Decision apply ignoring the page rev it was filed against (the stale
 *     resurrection bug), or one that applies and leaves the Decision pending.
 *  6. The snapshot pass replacing the whole notebook and reverting a page any
 *     other writer touched while the figures were read.
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
  return lines.join("\n").replace(/\n+$/, "");
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function check(result: { ok: boolean; error?: string }, message: string): void {
  assert.equal(result.ok, true, `${message}: ${result.ok ? "" : result.error}`);
}

describe("review notebook guards e2e", () => {
  it("keeps concurrent page writes, CASes each page, locks the notebook, and applies page Decisions", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-notebook-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};
    fs.rmSync(ARTIFACT, { force: true });

    try {
      check(await createVault(vaultRoot, "Review Notebook Rig"), "createVault failed");
      for (const slug of ["health", "mind", "financial"]) {
        check(await unlockDomain(vaultRoot, slug), `unlockDomain(${slug}) failed`);
      }

      const today = todayLocalIso();
      const period = weekStartOnOrBefore(shiftLocalIsoDate(today, -21)!, "monday");
      checks.period = period;

      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period, scope: "overall" }),
        "ensureReview(overall) failed",
      );
      // Each page exists before its interview starts; a page write quotes its rev.
      for (const [scope, title] of [
        ["health", "Health"],
        ["mind", "Mind"],
      ] as const) {
        check(
          await ensureReview(vaultRoot, { cadence: "weekly", period, scope }),
          `ensureReview(${scope}) failed`,
        );
        const read = await getReviewPageBody(vaultRoot, "weekly", period, scope);
        check(read, `getReviewPageBody(${scope}) failed`);
        assert.equal(read.ok && read.value.title, title, "the page title is not the area's name");
      }

      const notebook = await getReviewNotebook(vaultRoot, "weekly", period);
      checks.notebook = notebook.ok ? notebook.value : null;
      assert.equal(notebook.ok, true, "the notebook could not be read");
      assert.deepEqual(
        notebook.ok ? notebook.value.order : [],
        ["overall", "health", "mind"],
        "the manifest order is not overall + the pages in creation order",
      );

      const healthBefore = await getReviewPageBody(vaultRoot, "weekly", period, "health");
      assert.equal(healthBefore.ok && healthBefore.value.rev, 1, "a fresh page does not start at rev 1");

      // ── 1. two area sessions write concurrently; both reports survive ─────
      const [healthWrite, mindWrite] = await Promise.all([
        writeReviewPage(vaultRoot, {
          cadence: "weekly",
          period,
          scope: "health",
          bodyMarkdown: page("Health", {
            "Look-back": "Two walks and three early nights.",
            Keep: "Walks at lunch.",
            Change: "Phone out of the bedroom.",
            "Next-period intent": "Four walks next week.",
          }),
          baseRev: 1,
          actor: ACTOR,
        }),
        writeReviewPage(vaultRoot, {
          cadence: "weekly",
          period,
          scope: "mind",
          bodyMarkdown: page("Mind", {
            "Look-back": "Read three evenings.",
            Keep: "A chapter before bed.",
            Change: "Less scrolling in the morning.",
            "Next-period intent": "Finish the book.",
          }),
          baseRev: 1,
          actor: ACTOR,
        }),
      ]);
      assert.equal(healthWrite.ok, true, "the health session's write was refused");
      assert.equal(mindWrite.ok, true, "the mind session's write was refused");
      checks.concurrent = { health: healthWrite.ok, mind: mindWrite.ok };

      const afterAreas = await getReview(vaultRoot, "weekly", period);
      check(afterAreas, "the review could not be read after the two area writes");
      const bodyAfterAreas = afterAreas.ok ? afterAreas.value.bodyMarkdown : "";
      checks.bodyAfterAreas = bodyAfterAreas;
      assert.match(bodyAfterAreas, /Two walks and three early nights\./, "the health page's prose is gone");
      assert.match(bodyAfterAreas, /Read three evenings\./, "the mind page's prose is gone");
      assert.equal(countOf(bodyAfterAreas, "## Health"), 1, "the health page appears twice");
      assert.equal(countOf(bodyAfterAreas, "## Mind"), 1, "the mind page appears twice");

      // Every page is its own file, and the manifest lists exactly them.
      const dir = path.join(vaultRoot, "reviews", "weekly", period);
      assert.deepEqual(
        fs.readdirSync(dir).sort(),
        ["health.md", "mind.md", "overall.md", "review.json"],
        "the notebook is not one manifest plus one file per page",
      );

      // ── 2. the companion reads back its own page and the rev to quote ─────
      const readHealth = await getReviewPageBody(vaultRoot, "weekly", period, "health");
      check(readHealth, "the health page could not be read");
      const healthPage = readHealth.ok ? readHealth.value : null;
      checks.page = healthPage;
      assert.ok(healthPage, "no health page");
      assert.match(healthPage!.bodyMarkdown, /^# Health\n\n## Look-back/, "the page is not one H1 and the four H2s");
      assert.match(healthPage!.bodyMarkdown, /Two walks and three early nights\./, "the page lost its prose");
      assert.equal(
        (healthPage!.bodyMarkdown.match(/^## /gm) ?? []).length,
        4,
        "the page does not hold exactly the four required headings",
      );
      assert.equal(healthPage!.rev, 2, "the page rev did not move with its body");

      const scopedRead = (await executeReviewTool(vaultRoot, ACTOR, "get_review", {
        cadence: "weekly",
        period,
        scope: "health",
      })) as { page?: { rev: number; bodyMarkdown: string; title: string } };
      assert.ok(scopedRead.page, "get_review with a scope did not return a page");
      assert.equal(scopedRead.page!.rev, healthPage!.rev, "the tool's page rev does not match the file's");

      // The agent tool now demands the page identity it writes.
      const noScope = (await executeReviewTool(vaultRoot, ACTOR, "write_review", {
        cadence: "weekly",
        period,
        body: page("Health", { "Look-back": "x" }),
      })) as { error?: { code?: string } };
      assert.equal(noScope.error?.code, "MALFORMED", "write_review accepted a body with no scope");
      const noRev = (await executeReviewTool(vaultRoot, ACTOR, "write_review", {
        cadence: "weekly",
        period,
        scope: "health",
        body: page("Health", { "Look-back": "x" }),
      })) as { error?: { code?: string } };
      assert.equal(noRev.error?.code, "MALFORMED", "write_review accepted a body with no baseRev");

      // ── 3. a second write to the same page with a stale rev is refused ────
      const stalePage = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period,
        scope: "health",
        bodyMarkdown: page("Health", {
          "Look-back": "Health stale write.",
          Keep: "Keep stale.",
          Change: "Change stale.",
          "Next-period intent": "Intent stale.",
        }),
        baseRev: 1,
        actor: ACTOR,
      });
      checks.stalePage = stalePage;
      assert.equal(stalePage.ok, false, "a stale page write was accepted");
      assert.equal(stalePage.ok ? "" : stalePage.code, "CONFLICT", "the stale page write was not a CONFLICT");
      assert.equal(
        stalePage.ok ? null : stalePage.current?.rev,
        healthPage!.rev,
        "the conflict did not carry the page as it now stands",
      );
      const afterStalePage = await getReviewPageBody(vaultRoot, "weekly", period, "health");
      assert.equal(
        afterStalePage.ok ? afterStalePage.value.bodyMarkdown : "",
        healthPage!.bodyMarkdown,
        "a refused write changed the page",
      );

      // ── 4. the canonicaliser is a fixed point ─────────────────────────────
      const sameBody = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period,
        scope: "health",
        bodyMarkdown: healthPage!.bodyMarkdown,
        baseRev: healthPage!.rev,
        actor: ACTOR,
      });
      check(sameBody, "re-writing the page's own body failed");
      assert.equal(sameBody.ok ? sameBody.page.rev : -1, healthPage!.rev, "a no-op write bumped the page rev");

      // ── 5. a compatibility save CASes on the composite notebook rev ───────
      const beforeCompat = await getReview(vaultRoot, "weekly", period);
      check(beforeCompat, "the review could not be read before the compatibility save");
      const compatRecord = beforeCompat.ok ? beforeCompat.value : null;
      assert.ok(compatRecord, "no compatibility record");
      const compatBody = compatRecord!.bodyMarkdown.replace(
        "Read three evenings.",
        "Read four evenings.",
      );
      const compatWrite = await writeReview(vaultRoot, {
        cadence: "weekly",
        period,
        bodyMarkdown: compatBody,
        actor: ACTOR,
        baseRev: compatRecord!.rev,
      });
      check(compatWrite, "the compatibility save failed");
      assert.equal(
        compatWrite.ok ? compatWrite.value.rev : -1,
        compatRecord!.rev + 1,
        "the composite rev did not move by exactly one page's rev",
      );
      const staleCompat = await writeReview(vaultRoot, {
        cadence: "weekly",
        period,
        bodyMarkdown: compatRecord!.bodyMarkdown,
        actor: ACTOR,
        baseRev: compatRecord!.rev,
      });
      checks.staleCompat = staleCompat;
      assert.equal(staleCompat.ok, false, "a stale compatibility save was accepted");
      assert.equal(staleCompat.ok ? "" : staleCompat.code, "CONFLICT", "the stale save was not a CONFLICT");
      assert.equal(
        staleCompat.ok ? null : staleCompat.current?.rev,
        compatRecord!.rev + 1,
        "the conflict did not carry the notebook as it now stands",
      );
      const afterStaleCompat = await getReview(vaultRoot, "weekly", period);
      const bodyAfterStaleCompat = afterStaleCompat.ok ? afterStaleCompat.value.bodyMarkdown : "";
      assert.match(bodyAfterStaleCompat, /Read four evenings\./, "the stale save reverted the newer mind prose");
      assert.match(bodyAfterStaleCompat, /Two walks and three early nights\./, "the health prose was lost in the stale save");

      // ── 6. a locked notebook refuses every write path ─────────────────────
      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period, scope: "financial" }),
        "ensureReview(financial) failed",
      );
      const financialRead = await getReviewPageBody(vaultRoot, "weekly", period, "financial");
      assert.equal(financialRead.ok && financialRead.value.rev, 1, "the financial page is not fresh");
      check(
        await writeReviewPage(vaultRoot, {
          cadence: "weekly",
          period,
          scope: "financial",
          bodyMarkdown: page("Finance", { "Look-back": "Spent less than planned." }),
          baseRev: 1,
          actor: ACTOR,
        }),
        "the finance page write failed",
      );

      // The overall review is gated until every live area page is done.
      const gated = await markReviewDone(vaultRoot, { cadence: "weekly", period, scope: "overall" });
      checks.gated = gated.ok ? null : gated.error;
      assert.equal(gated.ok, false, "the life review ignored the area gate");
      for (const name of ["Health", "Mind", "Finance"]) {
        assert.match(
          gated.ok ? "" : gated.error,
          new RegExp(`${name}: in progress`),
          `the gate does not name ${name} as still open`,
        );
      }
      for (const scope of ["health", "mind", "financial"]) {
        check(await markReviewDone(vaultRoot, { cadence: "weekly", period, scope }), `markReviewDone(${scope}) failed`);
      }
      check(
        await markReviewDone(vaultRoot, { cadence: "weekly", period, scope: "overall" }),
        "the life review could not be completed",
      );
      const lockedRecord = await getReview(vaultRoot, "weekly", period);
      assert.equal(lockedRecord.ok ? lockedRecord.value.locked : false, true, "the notebook did not lock");
      const lockedPageWrite = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period,
        scope: "health",
        bodyMarkdown: page("Health", { "Look-back": "After the lock." }),
        baseRev: 2,
        actor: ACTOR,
      });
      assert.equal(lockedPageWrite.ok, false, "a locked notebook accepted a page write");
      assert.equal(lockedPageWrite.ok ? "" : lockedPageWrite.code, "LOCKED", "the page refusal was not LOCKED");
      const lockedCompat = await writeReview(vaultRoot, {
        cadence: "weekly",
        period,
        bodyMarkdown: bodyAfterStaleCompat,
        actor: ACTOR,
      });
      assert.equal(lockedCompat.ok, false, "a locked notebook accepted a compatibility save");
      assert.equal(lockedCompat.ok ? "" : lockedCompat.code, "LOCKED", "the compatibility refusal was not LOCKED");
      const lockedMark = await markReviewDone(vaultRoot, { cadence: "weekly", period, scope: "overall" });
      assert.equal(lockedMark.ok, false, "a locked notebook accepted a second mark-done");
      check(await unlockDomain(vaultRoot, "business"), "unlockDomain(business) failed");
      const latePage = await ensureReview(vaultRoot, { cadence: "weekly", period, scope: "business" });
      assert.equal(latePage.ok, false, "a locked notebook grew a new page");
      assert.match(
        latePage.ok ? "" : latePage.error,
        /locked/i,
        "the new-page refusal does not say the notebook is locked",
      );
      checks.lockedRefusals = {
        page: lockedPageWrite.ok ? "" : lockedPageWrite.code,
        whole: lockedCompat.ok ? "" : lockedCompat.code,
        mark: lockedMark.ok ? "" : lockedMark.error,
        page_creation: latePage.ok ? "" : latePage.error,
      };

      // ── 7. a locked page write becomes a Decision applied at its rev ──────
      const period2 = weekStartOnOrBefore(shiftLocalIsoDate(today, -28)!, "monday");
      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period: period2, scope: "overall" }),
        "ensureReview(overall, period2) failed",
      );
      // Every live area (business was unlocked above) gets a page and is marked
      // done, so the overall page is allowed to lock.
      const liveAreas = await getReviewAreaChecklist(vaultRoot, "weekly", period2);
      check(liveAreas, "the checklist could not be read for period2");
      for (const area of liveAreas.ok ? liveAreas.value.areas : []) {
        const scope = area.slug;
        check(
          await ensureReview(vaultRoot, { cadence: "weekly", period: period2, scope }),
          `ensureReview(${scope}, period2) failed`,
        );
        const read = await getReviewPageBody(vaultRoot, "weekly", period2, scope);
        check(read, `getReviewPageBody(${scope}, period2) failed`);
        check(
          await writeReviewPage(vaultRoot, {
            cadence: "weekly",
            period: period2,
            scope,
            bodyMarkdown: page(area.name, {
              "Look-back": `${area.name} original.`,
              Keep: "Keep original.",
              Change: "Change original.",
              "Next-period intent": "Intent original.",
            }),
            baseRev: read.ok ? read.value.rev : 0,
            actor: ACTOR,
          }),
          `writeReviewPage(${scope}, period2) failed`,
        );
        check(await markReviewDone(vaultRoot, { cadence: "weekly", period: period2, scope }), `markReviewDone(${scope}, period2) failed`);
      }
      check(
        await markReviewDone(vaultRoot, { cadence: "weekly", period: period2, scope: "overall" }),
        "period2 did not lock",
      );

      const healthLocked = await getReviewPageBody(vaultRoot, "weekly", period2, "health");
      assert.equal(healthLocked.ok, true, "the locked health page could not be read");
      const proposed = page("Health", {
        "Look-back": "Health proposed.",
        Keep: "Keep proposed.",
        Change: "Change proposed.",
        "Next-period intent": "Intent proposed.",
      });
      const filed = (await executeReviewTool(vaultRoot, ACTOR, "write_review", {
        cadence: "weekly",
        period: period2,
        scope: "health",
        body: proposed,
        baseRev: healthLocked.ok ? healthLocked.value.rev : 0,
      })) as { decision?: boolean; id?: string; status?: string; error?: unknown };
      checks.filedDecision = filed;
      assert.equal(filed.decision, true, "a locked page write did not file a Decision");
      assert.ok(filed.id, "the filed Decision has no id");
      check(await resolveDecision(vaultRoot, filed.id!, "approved"), "the page Decision was not approved");
      const afterDecision = await getReviewPageBody(vaultRoot, "weekly", period2, "health");
      assert.equal(
        afterDecision.ok ? afterDecision.value.bodyMarkdown : "",
        proposed,
        "the approved Decision did not write the page body",
      );
      assert.equal(afterDecision.ok ? afterDecision.value.locked : false, true, "applying the Decision unlocked the review");
      const recordAfterDecision = await getReview(vaultRoot, "weekly", period2);
      assert.equal(recordAfterDecision.ok ? recordAfterDecision.value.locked : false, true, "the notebook lost its lock");

      // ── 8. a Decision whose page moved refuses as STALE and stays pending ─
      const freshHealth = await getReviewPageBody(vaultRoot, "weekly", period2, "health");
      assert.equal(freshHealth.ok, true, "the health page could not be read before the stale proposal");
      const staleProposal = page("Health", {
        "Look-back": "Health stale proposal.",
        Keep: "Keep stale proposal.",
        Change: "Change stale proposal.",
        "Next-period intent": "Intent stale proposal.",
      });
      const staleFiled = (await executeReviewTool(vaultRoot, ACTOR, "write_review", {
        cadence: "weekly",
        period: period2,
        scope: "health",
        body: staleProposal,
        baseRev: freshHealth.ok ? freshHealth.value.rev : 0,
      })) as { decision?: boolean; id?: string };
      assert.equal(staleFiled.decision, true, "the stale proposal was not filed as a Decision");

      // The page moves before the Decision is approved.
      check(await unlockReview(vaultRoot, "weekly", period2, ACTOR), "period2 did not unlock");
      const newerHealth = page("Health", {
        "Look-back": "Health newer.",
        Keep: "Keep newer.",
        Change: "Change newer.",
        "Next-period intent": "Intent newer.",
      });
      check(
        await writeReviewPage(vaultRoot, {
          cadence: "weekly",
          period: period2,
          scope: "health",
          bodyMarkdown: newerHealth,
          baseRev: freshHealth.ok ? freshHealth.value.rev : 0,
          actor: ACTOR,
        }),
        "the newer health write failed",
      );
      check(
        await markReviewDone(vaultRoot, { cadence: "weekly", period: period2, scope: "overall" }),
        "period2 did not re-lock",
      );
      const staleApproval = await resolveDecision(vaultRoot, staleFiled.id!, "approved");
      checks.staleApproval = staleApproval.ok ? null : staleApproval.error;
      assert.equal(staleApproval.ok, false, "a Decision filed against a stale page rev was applied");
      const afterStaleApproval = await getReviewPageBody(vaultRoot, "weekly", period2, "health");
      assert.equal(
        afterStaleApproval.ok ? afterStaleApproval.value.bodyMarkdown : "",
        newerHealth,
        "the stale Decision overwrote the newer page",
      );

      // ── 9. the snapshot pass writes its own page, never another ───────────
      const period3 = "2026-10-12";
      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period: period3, scope: "overall" }),
        "ensureReview(period3) failed",
      );
      check(await installFinanceKit(vaultRoot, ACTOR), "the finance kit did not install");
      check(
        await insertRows(vaultRoot, "financial", "finance:accounts", [
          { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
        ]),
        "the rig could not create an account",
      );
      check(
        await insertRows(vaultRoot, "financial", "finance:transactions", [
          { id: "t-1", cells: { date: "2026-10-13", amount: 120.5, payee: "Checkers", account: "acc-1" } },
        ]),
        "the rig could not post a transaction",
      );
      const healthPage3 = await getReviewPageBody(vaultRoot, "weekly", period3, "health");
      assert.equal(healthPage3.ok, true, "a page that does not exist reads as an error");
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
          baseRev: healthPage3.ok ? healthPage3.value.rev : 0,
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
        "the snapshot pass reverted the page written while it was reading",
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
            spec: "review notebook guards",
            period,
            checks,
            summary:
              "two concurrent page writes kept; stale page write CONFLICT with current; canonicaliser " +
              "fixed point; composite compatibility CAS; locked notebook refused every write; a locked " +
              "page write filed a review-page Decision that applied at its rev; a moved page left the " +
              "Decision pending; the snapshot pass wrote only its page",
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
