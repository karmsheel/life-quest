import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  archiveDomain,
  createVault,
  ensureReviewPage,
  executeReviewTool,
  getReviewNotebook,
  getReviewPageBody,
  getReviewPageTemplate,
  readLog,
  unlockDomain,
  unlockReview,
  writeReviewPage,
} from "@lifequest/vault-core";
// The bound-session prompts live in the Electron main process; importing them
// directly is what lets this rig prove the words the companion is handed.
import {
  boundKickoff as kickoffFor,
  formatReviewContext as contextFor,
} from "../electron/review-sessions.ts";

/**
 * Page contracts / tailoring, end to end, against a real vault on disk.
 *
 * This is the whole Phase 3 product path, minus the window: a live area's
 * contract is written with the companion's own tool, a page is seeded from it,
 * a page written out of order is canonicalised into the contract order without
 * losing a word, the contract is changed without touching a finished page, and
 * the prompts the sessions receive quote the contract they must follow.
 *
 * It runs under `node --experimental-strip-types --test`, so it needs no
 * Electron and no dev server.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. An area with no template seeded with more than the four common headings:
 *     a missing template has to mean exactly today's skeleton, not a guess.
 *  2. A template written but not read at seeding: the file on disk must carry
 *     the four common headings first, then the extras in template order.
 *  3. A page written out of order and with an unknown heading: canonicalising
 *     must order the template extras, keep the unknown one after them, and
 *     preserve every prose block verbatim (S4 — extras are first-class).
 *  4. A bad contract accepted: an H3, a duplicate, one of the four common names,
 *     a template with no extras, `overall`, or an archived area must all be
 *     refused with a sentence the operator can act on.
 *  5. A locked notebook's page written anyway: the lock is the finished report.
 *  6. Seeding twice duplicating headings, or a template change rewriting an
 *     existing page: the contract seeds new pages and orders pages when they are
 *     written, never retroactively.
 *  7. The prompt telling the companion something the engine does not support:
 *     the area kickoff must name its page and quote its extras, and the overall
 *     page's context must list every page and carry the synthesis rule.
 *  8. An artifact written by a failing run. Every assertion throws, so the
 *     artifact only exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/review-tailoring.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;
const PERIOD = "2026-10-12";
const COMMON = ["Look-back", "Keep", "Change", "Next-period intent"] as const;

function pagePath(vaultRoot: string, scope: string): string {
  return path.join(vaultRoot, "reviews", "weekly", PERIOD, `${scope}.md`);
}

function bodyOf(raw: string): string {
  const marker = "\n---\n";
  const end = raw.indexOf(marker);
  return (end === -1 ? raw : raw.slice(end + marker.length)).trim();
}

function h2s(body: string): string[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

function headingCount(body: string, heading: string): number {
  return h2s(body).filter((name) => name === heading).length;
}

function packFor(scope: string): {
  ok: true;
  value: import("@lifequest/vault-core").PeriodPack;
} {
  return {
    ok: true,
    value: {
      cadence: "weekly",
      period: PERIOD,
      scope,
      bounds: { start: "2026-10-12", end: "2026-10-18" },
      log: [],
      tasks: [],
      goals: [],
      liveDays: [],
      events: [],
      previousReview: null,
      dailyNotes: [],
      domainSections: [],
      missingSources: [],
      truncated: false,
    },
  };
}

describe("review page tailoring e2e", () => {
  it("seeds, orders and validates an area's page contract without touching finished pages", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-tailoring-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};
    // A stale artifact from an earlier run must not survive a failure of this one.
    fs.rmSync(ARTIFACT, { force: true });

    try {
      const created = await createVault(vaultRoot, "Tailoring Rig");
      assert.equal(created.ok, true, "the rig could not create a vault");
      for (const slug of ["health", "mind"]) {
        const unlocked = await unlockDomain(vaultRoot, slug);
        assert.equal(unlocked.ok, true, `unlockDomain(${slug}) failed`);
      }

      const overall = await ensureReviewPage(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
      });
      assert.equal(overall.ok, true, "the notebook could not be created");

      // ── (a) no template → exactly the four common headings ────────────────
      const mind = await ensureReviewPage(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "mind",
      });
      assert.equal(mind.ok, true, "the Mind page could not be created");
      const mindBody = bodyOf(fs.readFileSync(pagePath(vaultRoot, "mind"), "utf8"));
      checks.noTemplateHeadings = h2s(mindBody);
      assert.deepEqual(
        h2s(mindBody),
        [...COMMON],
        "an area with no template was seeded with something other than the four common headings",
      );
      const noTemplate = await getReviewPageTemplate(vaultRoot, "mind");
      assert.equal(noTemplate.ok, true, "reading a missing template failed");
      assert.equal(noTemplate.ok && noTemplate.value.exists, false, "a missing template read as present");
      assert.deepEqual(
        noTemplate.ok ? noTemplate.value.extras : ["unreadable"],
        [],
        "a missing template yielded extras",
      );

      // ── (b) write the Health template with the TOOL, then seed a new page ──
      const templateMarkdown = [
        "# Health page contract",
        "",
        "## Training",
        "",
        "## Sleep",
        "",
        "## Energy",
      ].join("\n");
      const wroteTemplate = (await executeReviewTool(
        vaultRoot,
        ACTOR,
        "write_review_template",
        { scope: "health", markdown: templateMarkdown },
      )) as {
        template?: { scope: string; extras: string[]; exists: boolean; problems: string[] };
        error?: { code: string; message: string };
      };
      assert.equal(wroteTemplate.error, undefined, `write_review_template failed: ${wroteTemplate.error?.message}`);
      assert.deepEqual(
        wroteTemplate.template?.extras,
        ["Training", "Sleep", "Energy"],
        "the tool did not report the template's extras",
      );
      const templateFile = path.join(vaultRoot, ".lifequest", "reviews", "pages", "health.md");
      assert.equal(fs.existsSync(templateFile), true, "the template file was not written");
      checks.templateFile = fs.readFileSync(templateFile, "utf8");

      const health = await ensureReviewPage(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
      });
      assert.equal(health.ok, true, "the Health page could not be created");
      const seededRaw = fs.readFileSync(pagePath(vaultRoot, "health"), "utf8");
      const seededBody = bodyOf(seededRaw);
      checks.seededBody = seededBody;
      assert.deepEqual(
        h2s(seededBody),
        [...COMMON, "Training", "Sleep", "Energy"],
        "a new Health page was not seeded with the four common headings then its template extras in order",
      );
      assert.match(seededBody, /^# Health$/m, "the seeded page lost its H1");

      // The overall page never takes an area's extras.
      const overallBody = bodyOf(fs.readFileSync(pagePath(vaultRoot, "overall"), "utf8"));
      checks.overallBody = overallBody;
      assert.deepEqual(
        h2s(overallBody),
        [...COMMON],
        "the overall page was seeded with an area's template extras",
      );

      // ── (c) an out-of-order page with an unknown extra canonicalises ──────
      const beforeWrite = await getReviewPageBody(vaultRoot, "weekly", PERIOD, "health");
      assert.equal(beforeWrite.ok, true, "the Health page could not be read");
      const baseRev = beforeWrite.ok ? beforeWrite.value.rev : 0;
      const prose = {
        lookback: "Two runs and a late night.",
        energy: "Energy dipped after lunch.",
        training: "Three sessions, one skipped.",
        sleep: "Six hours average, one long night.",
        unknown: "A heading the template never named.",
      };
      const outOfOrder = [
        "# Health",
        "## Look-back",
        prose.lookback,
        "## Energy",
        prose.energy,
        "## Other",
        prose.unknown,
        "## Training",
        prose.training,
        "## Sleep",
        prose.sleep,
        "## Keep",
        "## Change",
        "## Next-period intent",
      ].join("\n\n");
      const written = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        bodyMarkdown: outOfOrder,
        baseRev,
        actor: ACTOR,
      });
      assert.equal(written.ok, true, `the page write failed: ${written.ok ? "" : written.error}`);
      const writtenBody = written.ok ? written.page.bodyMarkdown : "";
      checks.canonicalBody = writtenBody;
      assert.deepEqual(
        h2s(writtenBody),
        [...COMMON, "Training", "Sleep", "Energy", "Other"],
        "canonicalisation did not put the four common headings first, then template extras in order, then the unknown extra",
      );
      const onDisk = bodyOf(fs.readFileSync(pagePath(vaultRoot, "health"), "utf8"));
      assert.equal(onDisk, writtenBody, "the canonical body on disk differs from the write's answer");
      for (const [name, text] of Object.entries(prose)) {
        assert.equal(
          writtenBody.split(text).length - 1,
          1,
          `the ${name} prose block was lost or duplicated by canonicalisation`,
        );
      }
      // The writer is a fixed point: writing its own answer changes nothing.
      const rewrite = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        bodyMarkdown: writtenBody,
        baseRev: written.ok ? written.page.rev : 0,
        actor: ACTOR,
      });
      assert.equal(rewrite.ok, true, "rewriting the canonical body failed");
      assert.equal(
        rewrite.ok ? rewrite.page.bodyMarkdown : "",
        writtenBody,
        "the writer is not a fixed point on a canonical page",
      );
      checks.fixedPoint = true;

      // A page born from write_review (not ensure) is seeded exactly the same way.
      const unlockedFinance = await unlockDomain(vaultRoot, "financial");
      assert.equal(unlockedFinance.ok, true, "unlockDomain(financial) failed");
      const financeTemplate = await executeReviewTool(
        vaultRoot,
        ACTOR,
        "write_review_template",
        { scope: "financial", markdown: "## Income\n\n## Expenses" },
      );
      assert.equal(
        (financeTemplate as { error?: unknown }).error,
        undefined,
        "the Finance template was refused",
      );
      const direct = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
        bodyMarkdown: [
          "# Finance",
          "## Look-back",
          "## Keep",
          "## Change",
          "## Next-period intent",
        ].join("\n\n"),
        baseRev: 0,
        actor: ACTOR,
      });
      assert.equal(direct.ok, true, "a page created by write_review failed");
      checks.writeReviewSeeding = direct.ok ? h2s(direct.page.bodyMarkdown) : [];
      assert.deepEqual(
        direct.ok ? h2s(direct.page.bodyMarkdown) : [],
        [...COMMON, "Income", "Expenses"],
        "a page created by write_review was not seeded with its area's contract",
      );
      // Keep the gate simple later: Finance is not one of the areas under test.
      const archivedFinance = await archiveDomain(vaultRoot, "financial");
      assert.equal(archivedFinance.ok, true, "the rig could not archive Finance");

      // ── (e) seeding twice is idempotent ───────────────────────────────────
      const healthBefore = fs.readFileSync(pagePath(vaultRoot, "health"), "utf8");
      await ensureReviewPage(vaultRoot, { cadence: "weekly", period: PERIOD, scope: "health" });
      await ensureReviewPage(vaultRoot, { cadence: "weekly", period: PERIOD, scope: "health" });
      assert.equal(
        fs.readFileSync(pagePath(vaultRoot, "health"), "utf8"),
        healthBefore,
        "ensuring an existing page twice changed it",
      );
      const idempotentBody = bodyOf(fs.readFileSync(pagePath(vaultRoot, "health"), "utf8"));
      checks.ensureTwice = {
        headings: h2s(idempotentBody),
        trainingCount: headingCount(idempotentBody, "Training"),
      };
      assert.equal(
        headingCount(idempotentBody, "Training"),
        1,
        "ensuring twice duplicated a template heading",
      );

      // ── (d) validation refusals ───────────────────────────────────────────
      const refusals: Record<string, string> = {};
      const refuse = async (scope: string, markdown: string): Promise<string> => {
        const result = (await executeReviewTool(vaultRoot, ACTOR, "write_review_template", {
          scope,
          markdown,
        })) as { error?: { code: string; message: string } };
        return result.error ? result.error.message : "";
      };
      refusals.h3 = await refuse("health", "## Training\n\n### Details");
      refusals.duplicate = await refuse("health", "## Training\n\n## Training");
      refusals.common = await refuse("health", "## Keep");
      refusals.empty = await refuse("health", "# Health page contract");
      refusals.overall = await refuse("overall", "## Training");
      assert.match(refusals.h3!, /level-3 heading/i, "an H3 was accepted in a template");
      assert.match(refusals.duplicate!, /repeats/i, "a duplicate heading was accepted");
      assert.match(refusals.common!, /common heading/i, "a common heading was accepted as an extra");
      assert.match(refusals.empty!, /names no extra headings/i, "an empty template was accepted");
      assert.match(refusals.overall!, /overall page has no page template/i, "overall was accepted as a template scope");

      const archived = await archiveDomain(vaultRoot, "mind");
      assert.equal(archived.ok, true, "the rig could not archive Mind");
      refusals.archived = await refuse("mind", "## Training");
      refusals.unknownArea = await refuse("nope", "## Training");
      checks.refusals = refusals;
      assert.match(refusals.archived!, /not live/i, "an archived area accepted a template");
      assert.match(refusals.unknownArea!, /not live/i, "an unknown area accepted a template");

      // A locked notebook's page is read-only; the lock is the finished report.
      // Mind is archived, so Health is the only live area in the gate.
      const healthDone = await executeReviewTool(vaultRoot, ACTOR, "mark_review_done", {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
      });
      assert.equal((healthDone as { error?: unknown }).error, undefined, "Health could not be marked done");
      const marked = await executeReviewTool(vaultRoot, ACTOR, "mark_review_done", {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
      });
      assert.equal((marked as { error?: unknown }).error, undefined, "the review could not be marked done");
      const lockedBody = fs.readFileSync(pagePath(vaultRoot, "health"), "utf8");
      const lockedPage = await getReviewPageBody(vaultRoot, "weekly", PERIOD, "health");
      assert.equal(lockedPage.ok && lockedPage.value.locked, true, "the review did not lock");
      const lockedWrite = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        bodyMarkdown: writtenBody.replace(prose.sleep!, "Rewritten after lock."),
        baseRev: lockedPage.ok ? lockedPage.value.rev : 0,
        actor: ACTOR,
      });
      checks.lockedWrite = lockedWrite.ok ? "ok" : lockedWrite.code;
      assert.equal(lockedWrite.ok, false, "a locked notebook's page was written");
      assert.equal(lockedWrite.ok ? "" : lockedWrite.code, "LOCKED", "a locked page write did not answer LOCKED");
      assert.equal(
        fs.readFileSync(pagePath(vaultRoot, "health"), "utf8"),
        lockedBody,
        "a refused locked write changed the page file",
      );

      // ── (f) the prompts carry the page contract ───────────────────────────
      const notebook = await getReviewNotebook(vaultRoot, "weekly", PERIOD);
      assert.equal(notebook.ok, true, "the notebook could not be read for the prompts");
      const pages = notebook.ok ? notebook.value.pages : [];
      const healthTemplate = await getReviewPageTemplate(vaultRoot, "health");
      assert.equal(healthTemplate.ok, true, "the Health template could not be read for the prompt");
      const extras = healthTemplate.ok ? healthTemplate.value.extras : [];

      const areaContext = contextFor({
        kind: "review",
        pack: packFor("health"),
        scope: "health",
        domainName: "Health",
        cadence: "weekly",
        templateExtras: extras,
        pages,
      });
      checks.areaContext = areaContext;
      assert.match(areaContext, /Page contract:/, "the context lost the page-contract rule");
      assert.match(
        areaContext,
        /four common ## headings/,
        "the context does not state that the four common headings are required",
      );
      assert.match(areaContext, /Health/, "the area context does not name its area");
      assert.match(
        areaContext,
        /"Training", "Sleep", "Energy"/,
        "the area context does not quote its template extras in template order",
      );
      assert.match(
        areaContext,
        /never rewrite an area page/,
        "the context does not carry the overall synthesis rule",
      );

      const overallContext = contextFor({
        kind: "review",
        pack: packFor("overall"),
        scope: "overall",
        cadence: "weekly",
        pages,
      });
      checks.overallContext = overallContext;
      for (const page of pages) {
        assert.match(
          overallContext,
          new RegExp(`${page.title} \\(${page.scope}, ${page.status}\\)`),
          `the overall context does not list the ${page.scope} page with its name and status`,
        );
      }
      assert.match(
        overallContext,
        /Read every area page with get_review/,
        "the overall context does not tell the session to read every area page first",
      );
      assert.match(
        overallContext,
        /without copying an area's extras/,
        "the overall context does not forbid copying area extras",
      );

      const areaKickoff = kickoffFor({
        kind: "review",
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        domainName: "Health",
        weekStartDay: "monday",
        templateExtras: extras,
      });
      checks.areaKickoff = areaKickoff;
      assert.match(
        areaKickoff,
        /get_review with scope "health"/,
        "the area kickoff does not name the page by scope",
      );
      assert.match(
        areaKickoff,
        /"Training", "Sleep", "Energy"/,
        "the area kickoff does not quote the page's template extras",
      );
      const overallKickoff = kickoffFor({
        kind: "review",
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
        weekStartDay: "monday",
        areaCount: pages.filter((page) => page.scope !== "overall").length,
        pages,
      });
      checks.overallKickoff = overallKickoff;
      assert.match(
        overallKickoff,
        /Read every area page with get_review first/,
        "the overall kickoff does not tell the session to read every area page first",
      );
      assert.match(
        overallKickoff,
        /never rewrite an area page/,
        "the overall kickoff does not carry the never-rewrite rule",
      );
      for (const page of pages) {
        assert.match(
          overallKickoff,
          new RegExp(`${page.title} \\(${page.scope}, ${page.status}\\)`),
          `the overall kickoff does not list the ${page.scope} page`,
        );
      }

      // ── (g) a template change never rewrites an existing page ─────────────
      const fileBefore = fs.readFileSync(pagePath(vaultRoot, "health"), "utf8");
      const changed = (await executeReviewTool(vaultRoot, ACTOR, "write_review_template", {
        scope: "health",
        markdown: "## Energy\n\n## Training\n\n## Sleep",
      })) as { template?: { extras: string[] }; error?: unknown };
      assert.equal(changed.error, undefined, "the template change was refused");
      assert.deepEqual(
        changed.template?.extras,
        ["Energy", "Training", "Sleep"],
        "the new template order was not stored",
      );
      checks.templateChange = {
        pageUnchanged: fs.readFileSync(pagePath(vaultRoot, "health"), "utf8") === fileBefore,
      };
      assert.equal(
        fs.readFileSync(pagePath(vaultRoot, "health"), "utf8"),
        fileBefore,
        "changing the template rewrote an existing page",
      );
      // The new order applies when the page is next written, and only then.
      const unlocked = await unlockReview(vaultRoot, "weekly", PERIOD);
      assert.equal(unlocked.ok, true, "the rig could not unlock the review");
      const current = await getReviewPageBody(vaultRoot, "weekly", PERIOD, "health");
      assert.equal(current.ok, true, "the unlocked page could not be read");
      const rewritten = await writeReviewPage(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        bodyMarkdown: current.ok ? current.value.bodyMarkdown : "",
        baseRev: current.ok ? current.value.rev : 0,
        actor: ACTOR,
      });
      assert.equal(rewritten.ok, true, "the next write after a template change failed");
      checks.reorderedOnNextWrite = rewritten.ok ? h2s(rewritten.page.bodyMarkdown) : [];
      assert.deepEqual(
        rewritten.ok ? h2s(rewritten.page.bodyMarkdown) : [],
        [...COMMON, "Energy", "Training", "Sleep", "Other"],
        "the template change did not reorder extras at the next write",
      );
      for (const text of Object.values(prose)) {
        assert.equal(
          (rewritten.ok ? rewritten.page.bodyMarkdown : "").split(text).length - 1,
          1,
          "the template change lost prose at the next write",
        );
      }

      // The template write is audited like every other vault write.
      const log = await readLog(vaultRoot);
      assert.equal(log.ok, true, "the log could not be read");
      const templateLines = log.ok ? log.value.filter((e) => e.type === "review.template-written") : [];
      checks.templateLogLines = templateLines.length;
      assert.ok(templateLines.length >= 2, "writing the template left no review.template-written log line");
      assert.match(
        templateLines[0]!.summary,
        /page template/,
        "the template log line does not name what it wrote",
      );

      // ── the artifact, written only once every check held ──────────────────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      const report = {
        pass: true,
        what:
          "a live area's page template seeds a new page with the four common headings then the area's own " +
          "sections in template order; a page written out of order canonicalises to that order with an unknown " +
          "extra preserved after it and every prose block intact; bad templates, overall and archived areas are " +
          "refused; a locked page stays LOCKED; seeding twice is idempotent; the prompts quote the contract; and " +
          "a template change never rewrites an existing page",
        command:
          "cd apps/desktop && env -u ELECTRON_RUN_AS_NODE node --experimental-strip-types --test tests/review-tailoring-e2e.test.ts",
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
