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
  getReviewSkill,
  insertRows,
  installFinanceKit,
  parseSnapshotDirectives,
  prepopulateReview,
  upsertSnapshotBlock,
  writeReview,
  writeReviewSkill,
} from "@lifequest/vault-core";
import { formatReviewContext } from "../electron/review-sessions.ts";

/**
 * The review skill and its snapshots, end to end, against a real vault on disk.
 *
 * This is the whole product path behind Start, minus the window: a weekly review
 * is planted by the same `ensureReview` the IPC handler calls, the cadence's
 * rules are read and executed, a figure is read out of the operator's own finance
 * database by the same `runView` a dashboard card uses, and the result lands in
 * the review file. Then the file is read back by the two things that have to
 * agree with it — the next Start, which must find nothing left to do, and the
 * companion instruction payload, which must carry the rules.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`), so it
 * needs no Electron and no dev server.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A rule that never runs: the shipped weekly skill names the Financial
 *     Look-back, and a review without that section silently skips it — which is
 *     the difference between a snapshot and a note to self.
 *  2. A rule that runs twice: clicking Start again appends a second copy instead
 *     of rewriting the block its own markers delimit.
 *  3. The window ignored: the period's spending is the week's, not the month's
 *     and not all time. A snapshot with the wrong figure is worse than none.
 *  4. The operator's own prose damaged: the block is inserted inside one section
 *     and must leave the surrounding text, and every other section, untouched.
 *  5. The file growing on every save: the review writer has to be a fixed point
 *     on its own output, or a page that autosaves rewrites the file forever.
 *  6. The markers lost by the writer, which would make the next Start append a
 *     duplicate rather than refresh the block.
 *  7. A broken directive taking the good ones down with it: one unparseable
 *     fence must be reported and skipped, not thrown.
 *  8. The rules never reaching the agent: `formatReviewContext` has to carry the
 *     skill verbatim, or "ask the companion to add a rule" writes a file nobody
 *     reads.
 *  9. A locked review rewritten: locking means finished.
 * 10. The companion's own tools unable to read or write the rules.
 * 11. An artifact written by a failing run. Failures throw, so the artifact only
 *     exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/review-snapshot.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

const PERIOD = "2026-10-12";

describe("review snapshot e2e", () => {
  it("fills a weekly review's snapshot from the vault, once, and keeps the operator's own prose", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    try {
      const created = await createVault(vaultRoot, "Review Rig");
      assert.equal(created.ok, true, "the rig could not create a vault");

      // The finance kit, then three rows: two inside the review's week and one
      // in the month before it, so a snapshot that ignores its window reports a
      // number that is visibly wrong rather than merely different.
      const kit = await installFinanceKit(vaultRoot, ACTOR);
      assert.equal(kit.ok, true, `the finance kit did not install: ${kit.ok ? "" : kit.error}`);
      const accounts = await insertRows(vaultRoot, "financial", "finance:accounts", [
        { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
      ]);
      assert.equal(accounts.ok, true, "the rig could not create an account");
      const categories = await insertRows(vaultRoot, "financial", "finance:categories", [
        { id: "cat-groceries", cells: { name: "Groceries" } },
        { id: "cat-transport", cells: { name: "Transport" } },
      ]);
      assert.equal(categories.ok, true, "the rig could not create the categories");
      const inserted = await insertRows(vaultRoot, "financial", "finance:transactions", [
        {
          id: "t-in-1",
          cells: {
            date: "2026-10-13",
            amount: 120.5,
            payee: "Checkers",
            account: "acc-1",
            category: "cat-groceries",
          },
        },
        {
          id: "t-in-2",
          cells: {
            date: "2026-10-17",
            amount: 79.5,
            payee: "Uber",
            account: "acc-1",
            category: "cat-transport",
          },
        },
        {
          id: "t-out",
          cells: {
            date: "2026-09-01",
            amount: 999,
            payee: "Last month",
            account: "acc-1",
            category: "cat-groceries",
          },
        },
      ]);
      assert.equal(inserted.ok, true, "the rig could not post the transactions");

      const ensured = await ensureReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
      });
      assert.equal(ensured.ok, true, "the review was not planted");
      // The Financial section is planted by the domain scope first, so the pass
      // below has a section to fill AND a section that already holds the
      // operator's own prose — which is the thing the pass must not touch.
      const financial = await ensureReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
      });
      assert.equal(financial.ok, true, "the Financial section was not planted");
      checks.plantedBody = financial.ok ? financial.value.bodyMarkdown : null;

      const operatorWrote = [
        "# Weekly review · Week of 12 Oct 2026",
        "## Look-back",
        "Two walks, and **one** late night.",
        "## Keep",
        "## Change",
        "## Next-period intent",
        "## Financial",
        "### Look-back",
        "Kept the grocery run to one trip.",
        "### Keep",
        "### Change",
        "### Next-period intent",
        "## Notes",
        "A heading outside the skeleton.",
      ].join("\n\n");
      const seeded = await writeReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        bodyMarkdown: operatorWrote,
        actor: ACTOR,
      });
      assert.equal(seeded.ok, true, "the rig could not seed the operator's prose");

      // ── 1. the cadence's rules, as shipped ────────────────────────────────
      const skill = await getReviewSkill(vaultRoot, "weekly");
      assert.equal(skill.ok, true, "the weekly skill could not be read");
      const shipped = skill.ok ? skill.value : null;
      assert.ok(shipped, "no skill");
      checks.skillExists = shipped.exists;
      assert.equal(
        shipped.exists,
        false,
        "reading a skill wrote a file: the default must stay replaceable by a release",
      );
      assert.deepEqual(shipped.problems, [], "the shipped weekly skill does not parse");
      assert.equal(shipped.snapshots.length, 1, "the shipped weekly skill declares no snapshot");
      assert.equal(shipped.snapshots[0]!.id, "finance-spend");
      assert.equal(shipped.snapshots[0]!.domain, "financial");
      assert.equal(shipped.snapshots[0]!.section, "Look-back");
      assert.equal(shipped.snapshots[0]!.window, "period");
      assert.match(
        shipped.markdown,
        /lifequest-snapshot/,
        "the shipped skill carries no directive fence",
      );

      // ── 2. the pass fills the Financial Look-back ──────────────────────────
      const first = await prepopulateReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
        actor: ACTOR,
      });
      assert.equal(first.ok, true, `the snapshot pass failed: ${first.ok ? "" : first.error}`);
      const pass = first.ok ? first.value : null;
      assert.ok(pass, "no pass");
      checks.firstPass = {
        applied: pass.applied,
        planted: pass.planted,
        outcomes: pass.outcomes,
      };
      assert.equal(pass.applied, 1, "the snapshot pass wrote nothing");
      assert.deepEqual(
        pass.planted,
        [],
        "the pass planted a section the review already had",
      );
      const body = pass.bodyMarkdown;
      checks.body = body;

      const lookback = body.indexOf("### Look-back");
      const marker = body.indexOf("<!-- lifequest:snapshot:finance-spend -->");
      const keep = body.indexOf("### Keep");
      assert.ok(lookback !== -1 && marker > lookback, "the snapshot is not under Financial's Look-back");
      assert.ok(marker < keep, "the snapshot landed outside its own section");
      assert.match(body, /\| Groceries \| /, "the snapshot drew no category rows");
      assert.match(body, /\| Transport \| /, "the snapshot dropped a category the week held");
      assert.match(body, /2026-10-12 → 2026-10-18/, "the snapshot does not name the window it covers");

      // 200 = 120.5 + 79.5. The September row is outside the week and must not be
      // in the figure: a snapshot that reads all time says 1,199.
      assert.match(
        body,
        /(^|\n)200 \(ZAR\)(\n|$)/,
        "the period total is not the week's own total",
      );
      assert.doesNotMatch(body, /1,199/, "the snapshot read outside its period");

      // The operator's own writing, in the same section and in every other one,
      // is still exactly where they left it.
      assert.match(body, /Two walks/, "the pass took the operator's prose from the overall section");
      assert.match(
        body,
        /Kept the grocery run to one trip\./,
        "the pass took the operator's prose from the section it filled",
      );
      assert.match(body, /A heading outside the skeleton\./, "the pass dropped an extra section");
      const snapshotAt = body.indexOf("<!-- lifequest:snapshot:finance-spend -->");
      const proseAt = body.indexOf("Kept the grocery run to one trip.");
      assert.ok(
        snapshotAt < proseAt,
        "the snapshot did not open the section, so the operator's prose reads under it",
      );

      // ── 3. the pass is a fixed point ──────────────────────────────────────
      const second = await prepopulateReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
        actor: ACTOR,
      });
      assert.equal(second.ok, true, "the second pass failed");
      const twice = second.ok ? second.value : null;
      assert.ok(twice, "no second pass");
      checks.secondPass = { applied: twice.applied, identical: twice.bodyMarkdown === body };
      assert.equal(twice.applied, 0, "a second Start wrote the snapshot again");
      assert.equal(twice.bodyMarkdown, body, "a second Start changed the review's body");
      assert.equal(
        body.split("<!-- lifequest:snapshot:finance-spend -->").length - 1,
        1,
        "the marker is in the file more than once",
      );

      // ── 4. writing the same body does not grow the file ───────────────────
      const written = await writeReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        bodyMarkdown: body,
        actor: ACTOR,
      });
      assert.equal(written.ok, true, "the review could not be written");
      const writtenBody = written.ok ? written.value.bodyMarkdown : "";
      const writtenAgain = await writeReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        bodyMarkdown: writtenBody,
        actor: ACTOR,
      });
      assert.equal(writtenAgain.ok, true, "the review could not be written twice");
      checks.writerIsFixedPoint =
        writtenAgain.ok && writtenAgain.value.bodyMarkdown === writtenBody;
      assert.equal(
        writtenAgain.ok && writtenAgain.value.bodyMarkdown === writtenBody,
        true,
        "the review writer is not a fixed point: the file grows on every save",
      );
      assert.equal(
        writtenBody,
        (await getReview(vaultRoot, "weekly", PERIOD)).ok
          ? ((await getReview(vaultRoot, "weekly", PERIOD)) as { value: { bodyMarkdown: string } })
              .value.bodyMarkdown
          : "",
        "the writer's answer and the next read disagree about the same file",
      );
      assert.match(
        writtenBody,
        /<!-- lifequest:snapshot:finance-spend -->/,
        "the writer dropped the snapshot's own markers",
      );

      // ── 5. a broken directive is reported, not thrown ─────────────────────
      const broken = parseSnapshotDirectives(
        [
          "```lifequest-snapshot",
          "{ not json",
          "```",
          "",
          "```lifequest-snapshot",
          '{"id":"ok-rule","domain":"financial","section":"Keep","window":"period","spec":{"databaseId":"finance:transactions","title":"x","presentation":"metric","groupBy":null,"timeBucket":null,"timeColumnId":"date","timeWindow":"all","filters":[],"measure":"sum","measureColumnId":"amount","per":null,"sort":{"by":"value","dir":"desc"},"limit":12,"convertToZar":true,"columns":[]}}',
          "```",
        ].join("\n"),
      );
      checks.brokenDirective = { kept: broken.directives.length, problems: broken.problems };
      assert.equal(broken.directives.length, 1, "a broken fence took a good one down with it");
      assert.equal(broken.problems.length, 1, "a broken fence was not reported");
      assert.match(broken.problems[0]!, /not valid JSON/, "the broken fence was not named as such");

      // A directive whose section is not in the review is skipped, not forced in.
      const orphan = upsertSnapshotBlock(
        "# T\n\n## Financial\n\n### Look-back\n\nmine\n",
        {
          id: "nowhere",
          domain: "financial",
          section: "Next-period intent",
          title: "n",
          window: "period",
          spec: {} as never,
        },
        "Financial",
        "**x**",
      );
      checks.orphan = orphan.status;
      assert.equal(orphan.status, "skipped", "a directive with no section was written anyway");

      // ── 6. the rules reach the agent ──────────────────────────────────────
      const context = formatReviewContext({
        kind: "review",
        pack: {
          ok: true,
          value: {
            cadence: "weekly",
            period: PERIOD,
            scope: "overall",
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
        },
        skill: { markdown: shipped.markdown, problems: shipped.problems },
      });
      checks.contextHasSkill = context.includes("A week is where patterns start to show.");
      assert.match(
        context,
        /A week is where patterns start to show\./,
        "the agent's instructions do not carry the cadence's own rules",
      );
      assert.match(
        context,
        /lifequest-snapshot/,
        "the agent's instructions do not carry the snapshot rules",
      );

      // ── 7. the companion's own tools ──────────────────────────────────────
      const toolRead = (await executeReviewTool(vaultRoot, ACTOR, "get_review_skill", {
        cadence: "weekly",
      })) as { skill?: { markdown: string; snapshots: unknown[] }; error?: unknown };
      checks.toolRead = Boolean(toolRead.skill);
      assert.ok(toolRead.skill, "get_review_skill returned nothing");
      assert.equal(toolRead.skill!.snapshots.length, 1, "get_review_skill listed no snapshot");

      const nextRules = `${shipped.markdown}\n- Always ask about sleep.\n`;
      const toolWrite = (await executeReviewTool(vaultRoot, ACTOR, "write_review_skill", {
        cadence: "weekly",
        markdown: nextRules,
      })) as { skill?: { markdown: string; fileWritten?: boolean }; error?: unknown };
      checks.toolWrite = Boolean(toolWrite.skill);
      assert.ok(toolWrite.skill, "write_review_skill returned nothing");
      const onDisk = await getReviewSkill(vaultRoot, "weekly");
      assert.equal(onDisk.ok && onDisk.value.exists, true, "the skill file was not created");
      assert.match(
        onDisk.ok ? onDisk.value.markdown : "",
        /Always ask about sleep\./,
        "the rule the operator added is not in the file",
      );

      // ── 8. a locked review is left alone ─────────────────────────────────
      const marked = await executeReviewTool(vaultRoot, ACTOR, "mark_review_done", {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
      });
      assert.equal(
        (marked as { error?: unknown }).error,
        undefined,
        "the review could not be marked done",
      );
      const lockedPass = await prepopulateReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
        actor: ACTOR,
      });
      assert.equal(lockedPass.ok, true, "the pass on a locked review failed");
      const lockedValue = lockedPass.ok ? lockedPass.value : null;
      checks.locked = lockedValue ? { locked: lockedValue.locked, applied: lockedValue.applied } : null;
      assert.equal(lockedValue?.locked, true, "a locked review was not reported as locked");
      assert.equal(lockedValue?.applied, 0, "a locked review was rewritten");

      // ── the artifact ──────────────────────────────────────────────────────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      const report = {
        pass: true,
        what:
          "a weekly review's snapshot is read from the vault's own finance database, " +
          "lands under Financial's Look-back inside its own markers, and survives a second Start",
        command: "npm test  (this file: tests/review-snapshot-e2e.test.ts)",
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
