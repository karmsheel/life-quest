import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createVault,
  currentPeriod,
  ensureReview,
  executeReviewTool,
  getReview,
  getReviewSkill,
  insertRows,
  installFinanceKit,
  parseSnapshotDirectives,
  prepopulateReview,
  readLog,
  shiftLocalIsoDate,
  upsertSnapshotBlock,
  unlockDomain,
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
// The daily case is a second, separately repeatable artifact so a failure in one
// cadence cannot be read as a failure in the other.
const DAILY_ARTIFACT = path.join(desktopRoot, "e2e/artifacts/review-snapshot-daily.json");
// And a third: the plant decision is the one place the weekly and daily shapes
// deliberately differ, so it gets its own evidence rather than a comment.
const PLANT_ARTIFACT = path.join(desktopRoot, "e2e/artifacts/review-snapshot-plant.json");
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
      const unlockFinancial = await unlockDomain(vaultRoot, "financial");
      assert.equal(
        unlockFinancial.ok,
        true,
        `unlockDomain(financial) failed: ${unlockFinancial.ok ? "" : unlockFinancial.error}`,
      );

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
          id: "t-out-2",
          cells: {
            date: "2026-10-17",
            amount: -79.5,
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
        "## Finance",
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
      assert.deepEqual(
        shipped.snapshots.map((directive) => directive.id),
        ["finance-in", "finance-out", "finance-net"],
        "the shipped weekly skill no longer declares cash in / cash out / net",
      );
      for (const directive of shipped.snapshots) {
        assert.equal(directive.domain, "financial");
        assert.equal(directive.section, "Look-back");
        assert.equal(directive.window, "period");
      }
      assert.equal(shipped.snapshots[1]!.magnitude, "abs", "cash out lost its display-only magnitude");
      assert.match(
        shipped.markdown,
        /lifequest-snapshot/,
        "the shipped skill carries no directive fence",
      );

      // ── 2. the pass fills the Financial Look-back ──────────────────────────
      const first = await prepopulateReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
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
      assert.equal(pass.applied, 3, "the snapshot pass wrote fewer than three figures");
      assert.deepEqual(
        pass.planted,
        [],
        "the pass planted a section the review already had",
      );
      const body = pass.bodyMarkdown;
      checks.body = body;

      const lookback = body.indexOf("### Look-back");
      const markers = [
        "<!-- lifequest:snapshot:finance-in -->",
        "<!-- lifequest:snapshot:finance-out -->",
        "<!-- lifequest:snapshot:finance-net -->",
      ];
      const keep = body.indexOf("### Keep");
      for (const marker of markers) {
        const at = body.indexOf(marker);
        assert.ok(lookback !== -1 && at > lookback, `${marker} is not under Financial's Look-back`);
        assert.ok(at < keep, `${marker} landed outside its own section`);
      }
      assert.match(body, /2026-10-12 → 2026-10-18/, "the figures do not name the window they cover");

      // Gross cash in 120.5, gross cash out 79.5 (the ledger row is -79.5 and the
      // figure prints its size), net 41. The September row is outside the week and
      // must not be in any figure: a snapshot that read all time would show 1,199.
      assert.match(body, /(^|\n)120\.50 \(ZAR\)(\n|$)/, "cash in is not 120.50");
      assert.match(body, /(^|\n)79\.50 \(ZAR\)(\n|$)/, "cash out is not the gross 79.50");
      assert.match(body, /(^|\n)41 \(ZAR\)(\n|$)/, "net is not 120.5 - 79.5");
      assert.doesNotMatch(body, /1,199/, "a figure read outside its period");
      assert.doesNotMatch(body, /-79\.50?/, "cash out printed the ledger's sign instead of its size");

      // The operator's own writing, in the same section and in every other one,
      // is still exactly where they left it.
      assert.match(body, /Two walks/, "the pass took the operator's prose from the overall section");
      assert.match(
        body,
        /Kept the grocery run to one trip\./,
        "the pass took the operator's prose from the section it filled",
      );
      assert.match(body, /A heading outside the skeleton\./, "the pass dropped an extra section");
      const snapshotAt = body.indexOf("<!-- lifequest:snapshot:finance-in -->");
      const proseAt = body.indexOf("Kept the grocery run to one trip.");
      assert.ok(
        snapshotAt < proseAt,
        "the figures did not open the section, so the operator's prose does not read under them",
      );

      // ── 3. the pass is a fixed point ──────────────────────────────────────
      const second = await prepopulateReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
        actor: ACTOR,
      });
      assert.equal(second.ok, true, "the second pass failed");
      const twice = second.ok ? second.value : null;
      assert.ok(twice, "no second pass");
      checks.secondPass = { applied: twice.applied, identical: twice.bodyMarkdown === body };
      assert.equal(twice.applied, 0, "a second Start wrote the snapshot again");
      assert.equal(twice.bodyMarkdown, body, "a second Start changed the review's body");
      for (const marker of markers) {
        assert.equal(
          body.split(marker).length - 1,
          1,
          `${marker} is in the file more than once`,
        );
      }

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
        /<!-- lifequest:snapshot:finance-in -->/,
        "the writer dropped a figure's own markers",
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
        "# T\n\n## Finance\n\n### Look-back\n\nmine\n",
        {
          id: "nowhere",
          domain: "financial",
          section: "Next-period intent",
          title: "n",
          window: "period",
          spec: {} as never,
        },
        "Finance",
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
      assert.equal(
        toolRead.skill!.snapshots.length,
        3,
        "get_review_skill did not list the three finance figures",
      );

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
      // The overall review is gated on every live area's section being done.
      // This vault has one live area, Financial, and the snapshot pass left its
      // scope in draft — so complete that area first; the overall mark below
      // must then succeed and lock, which is what this step is about.
      const financeDone = await executeReviewTool(vaultRoot, ACTOR, "mark_review_done", {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
      });
      assert.equal(
        (financeDone as { error?: unknown }).error,
        undefined,
        "the Financial review could not be marked done",
      );
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

  it("fills a daily review's snapshot under the overall Look-back, once, and logs the pass", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-daily-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    try {
      // A daily review is one general review: `ensureReview` refuses an area
      // scope on this cadence, so its file is `# Daily review · <date>` and the
      // four overall H2s — no `## Finance`, no `### Look-back`. The shipped
      // rule names the Financial Look-back, so on a daily review it has only
      // the overall `## Look-back` to resolve against. That is the coverage
      // this case adds: before the overall path existed the rule skipped every
      // daily review, silently, and the figure the directive promises was never
      // there.
      const created = await createVault(vaultRoot, "Daily Review Rig");
      assert.equal(created.ok, true, "the rig could not create a vault");
      const unlockFinancial = await unlockDomain(vaultRoot, "financial");
      assert.equal(
        unlockFinancial.ok,
        true,
        `unlockDomain(financial) failed: ${unlockFinancial.ok ? "" : unlockFinancial.error}`,
      );

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

      // A past day is always open on the daily cadence: its window opens on its
      // own day at 18:00 and never closes, so yesterday opened yesterday
      // evening whatever the wall clock says now. No settings edit and no
      // dependence on the run happening after 18:00 today.
      const today = currentPeriod("daily", "monday");
      const period = shiftLocalIsoDate(today, -1);
      assert.ok(period, "the rig could not name yesterday");
      const outside = shiftLocalIsoDate(period, -1);
      assert.ok(outside, "the rig could not name the day before");
      checks.period = period;

      // The day's own figures: 100 in, 42.50 out, 57.50 net. The 999 spend is a
      // day earlier, so a pass that ignored its window would report it and net
      // would be negative — a visibly wrong number, not merely a different one.
      const inserted = await insertRows(vaultRoot, "financial", "finance:transactions", [
        {
          id: "t-day-in",
          cells: {
            date: period,
            amount: 100,
            payee: "Employer",
            account: "acc-1",
            category: "cat-groceries",
          },
        },
        {
          id: "t-day-spend",
          cells: {
            date: period,
            amount: -42.5,
            payee: "Checkers",
            account: "acc-1",
            category: "cat-transport",
          },
        },
        {
          id: "t-day-out",
          cells: {
            date: outside,
            amount: -999,
            payee: "Yesterday's rent",
            account: "acc-1",
            category: "cat-transport",
          },
        },
      ]);
      assert.equal(inserted.ok, true, "the rig could not post the transactions");

      const ensured = await ensureReview(vaultRoot, {
        cadence: "daily",
        period,
        scope: "overall",
      });
      assert.equal(
        ensured.ok,
        true,
        `the daily review was not planted: ${ensured.ok ? "" : ensured.error}`,
      );
      checks.plantedBody = ensured.ok ? ensured.value.bodyMarkdown : null;

      // The operator's own writing: prose in Look-back, prose in Keep, and the
      // four H2s of the daily skeleton. Write it the way the page autosaves —
      // one markdown body — so the pass has to insert above the prose rather
      // than replace the section.
      const operatorWrote = [
        `# Daily review · ${period}`,
        "## Look-back",
        "Walked in the morning, twice.",
        "## Keep",
        "Kept the evening screen-free.",
        "## Change",
        "## Next-period intent",
      ].join("\n\n");
      const seeded = await writeReview(vaultRoot, {
        cadence: "daily",
        period,
        bodyMarkdown: operatorWrote,
        actor: ACTOR,
      });
      assert.equal(seeded.ok, true, "the rig could not seed the operator's prose");
      checks.seededBody = seeded.ok ? seeded.value.bodyMarkdown : null;

      // ── 1. the pass fills the OVERALL Look-back ───────────────────────────
      const first = await prepopulateReview(vaultRoot, {
        cadence: "daily",
        period,
        scope: "overall",
        actor: ACTOR,
      });
      assert.equal(first.ok, true, `the daily snapshot pass failed: ${first.ok ? "" : first.error}`);
      const pass = first.ok ? first.value : null;
      assert.ok(pass, "no daily pass");
      checks.firstPass = {
        applied: pass.applied,
        planted: pass.planted,
        outcomes: pass.outcomes,
      };
      assert.equal(pass.applied, 3, "the daily snapshot pass wrote fewer than three figures");
      assert.deepEqual(
        pass.planted,
        [],
        "the pass planted an area section the daily review cannot have",
      );
      assert.deepEqual(
        pass.outcomes.map((entry) => [entry.id, entry.status]),
        [
          ["finance-in", "written"],
          ["finance-out", "written"],
          ["finance-net", "written"],
        ],
        "a shipped figure was skipped on a daily review: the overall Look-back was not resolved",
      );
      const body = pass.bodyMarkdown;
      checks.body = body;

      // The three figures open the section above the operator's prose, in the
      // order they are declared.
      const lookback = body.indexOf("## Look-back");
      const markers = [
        "<!-- lifequest:snapshot:finance-in -->",
        "<!-- lifequest:snapshot:finance-out -->",
        "<!-- lifequest:snapshot:finance-net -->",
      ];
      const prose = body.indexOf("Walked in the morning, twice.");
      let previousAt = -1;
      for (const marker of markers) {
        const at = body.indexOf(marker);
        assert.ok(lookback !== -1 && at > lookback, `${marker} is not under the overall Look-back`);
        assert.ok(at < prose, `${marker} landed under the operator's prose, not above it`);
        assert.ok(at > previousAt, "the figures are not in their declared reading order");
        previousAt = at;
        // Both halves of the pair, once each: the block is delimited, not merely
        // opened, which is what lets a second Start find and replace it in place.
        const close = marker.replace("<!-- lifequest:snapshot:", "<!-- /lifequest:snapshot:");
        assert.equal(body.split(marker).length - 1, 1, `${marker} is in the file more than once`);
        assert.equal(body.split(close).length - 1, 1, `${close} is missing or duplicated`);
        assert.ok(body.indexOf(close) > at, `${close} precedes its opening marker`);
      }

      assert.match(body, /(^|\n)100 \(ZAR\)(\n|$)/, "cash in is not the day's own income");
      assert.match(body, /(^|\n)42\.50 \(ZAR\)(\n|$)/, "cash out is not the day's own gross spend");
      assert.doesNotMatch(body, /-42\.5/, "cash out printed the ledger's sign instead of its size");
      assert.match(body, /(^|\n)57\.50 \(ZAR\)(\n|$)/, "net is not 100 - 42.50");
      assert.doesNotMatch(body, /999/, "a figure read outside the daily period");
      assert.match(
        body,
        new RegExp(`${period} → ${period}`),
        "the figures do not name the window they cover",
      );

      // A daily review has no area sections, and the pass must not invent one:
      // a `## Finance` here would be a heading the page never shows.
      assert.equal(body.includes("\n### "), false, "the daily review grew a ### section");
      assert.equal(body.includes("## Finance"), false, "the daily review grew an area section");
      assert.equal(body.includes("## Financial"), false, "the daily review grew an area section");

      // ── 2. the pass left one audit line, naming the operator ──────────────
      const logAfterFirst = await readLog(vaultRoot);
      assert.equal(logAfterFirst.ok, true, "the vault's log could not be read");
      const events = logAfterFirst.ok ? logAfterFirst.value : [];
      const snapshotLines = events.filter((event) => event.type === "review.snapshots");
      checks.firstLog = snapshotLines.map((event) => ({
        payload: event.payload,
        actor: event.actor,
      }));
      assert.equal(
        snapshotLines.length,
        1,
        "a pass that changed the body appended no review.snapshots line, or more than one",
      );
      const line = snapshotLines[0]!;
      assert.deepEqual(
        line.payload,
        { cadence: "daily", period, scope: "overall", written: 3, skipped: 0, failed: 0 },
        "the audit line does not carry the pass's own counts",
      );
      assert.deepEqual(
        line.actor,
        { type: "user" },
        "the audit line does not name the operator who ran the pass",
      );

      // ── 3. the pass is a fixed point, and a no-op appends nothing ──────────
      const second = await prepopulateReview(vaultRoot, {
        cadence: "daily",
        period,
        scope: "overall",
        actor: ACTOR,
      });
      assert.equal(second.ok, true, "the second daily pass failed");
      const twice = second.ok ? second.value : null;
      assert.ok(twice, "no second daily pass");
      checks.secondPass = { applied: twice.applied, identical: twice.bodyMarkdown === body };
      assert.equal(twice.applied, 0, "a second Start wrote the daily snapshot again");
      assert.equal(twice.bodyMarkdown, body, "a second Start changed the daily review's body");
      for (const marker of markers) {
        assert.equal(
          twice.bodyMarkdown.split(marker).length - 1,
          1,
          `the second pass duplicated ${marker}`,
        );
      }
      assert.match(
        twice.bodyMarkdown,
        /Walked in the morning, twice\./,
        "the second pass took the operator's prose",
      );

      const logAfterSecond = await readLog(vaultRoot);
      assert.equal(logAfterSecond.ok, true, "the vault's log could not be read again");
      const linesAfterSecond = (logAfterSecond.ok ? logAfterSecond.value : []).filter(
        (event) => event.type === "review.snapshots",
      );
      checks.secondLogCount = linesAfterSecond.length;
      assert.equal(
        linesAfterSecond.length,
        1,
        "a pass that wrote nothing appended a review.snapshots line",
      );

      // ── the artifact ──────────────────────────────────────────────────────
      fs.mkdirSync(path.dirname(DAILY_ARTIFACT), { recursive: true });
      const report = {
        pass: true,
        what:
          "a daily review — which has no area sections — gets the shipped finance snapshot " +
          "under its overall Look-back, above the operator's prose, once, with one audit line",
        command: "node --experimental-strip-types --test tests/review-snapshot-e2e.test.ts",
        vault: vaultRoot,
        checks,
        generatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(DAILY_ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
      assert.equal(fs.existsSync(DAILY_ARTIFACT), true, "the run wrote no daily artifact");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("creates the Financial page and fills it on a weekly review that has only the overall page", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-plant-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    try {
      // The page-scoped contract: a weekly review with only the overall page gets
      // the Financial page created on the first financial Start, and the figure
      // lands on that page — never in the overall page's Look-back, even though
      // that section exists and could take the block.
      const created = await createVault(vaultRoot, "Plant Rig");
      assert.equal(created.ok, true, "the rig could not create a vault");
      const unlockFinancial = await unlockDomain(vaultRoot, "financial");
      assert.equal(
        unlockFinancial.ok,
        true,
        `unlockDomain(financial) failed: ${unlockFinancial.ok ? "" : unlockFinancial.error}`,
      );
      const kit = await installFinanceKit(vaultRoot, ACTOR);
      assert.equal(kit.ok, true, `the finance kit did not install: ${kit.ok ? "" : kit.error}`);
      await insertRows(vaultRoot, "financial", "finance:accounts", [
        { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
      ]);
      await insertRows(vaultRoot, "financial", "finance:categories", [
        { id: "cat-groceries", cells: { name: "Groceries" } },
      ]);
      const inserted = await insertRows(vaultRoot, "financial", "finance:transactions", [
        {
          id: "t-week",
          cells: {
            date: "2026-10-13",
            amount: 120.5,
            payee: "Checkers",
            account: "acc-1",
            category: "cat-groceries",
          },
        },
      ]);
      assert.equal(inserted.ok, true, "the rig could not post the transaction");

      // Overall only: no Financial page has been started, so the notebook has
      // the overall page and no financial page.
      const ensured = await ensureReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
      });
      assert.equal(ensured.ok, true, "the weekly review was not planted");
      const seeded = await writeReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        actor: ACTOR,
        bodyMarkdown: [
          "# Weekly review",
          "## Look-back",
          "The week in one line.",
          "## Keep",
          "## Change",
          "## Next-period intent",
        ].join("\n\n"),
      });
      assert.equal(seeded.ok, true, "the rig could not seed the operator's prose");
      checks.seededHasFinance = seeded.ok
        ? seeded.value.bodyMarkdown.includes("## Finance")
        : null;

      const pass = await prepopulateReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
        actor: ACTOR,
      });
      assert.equal(pass.ok, true, `the snapshot pass failed: ${pass.ok ? "" : pass.error}`);
      const value = pass.ok ? pass.value : null;
      assert.ok(value, "no pass");
      checks.planted = value.planted;
      checks.outcomes = value.outcomes;
      assert.equal(value.applied, 3, "the pass wrote fewer than three figures to the financial page");
      assert.deepEqual(value.planted, [], "the pass reported a plant: the page is the unit now");

      const body = value.bodyMarkdown;
      checks.body = body;
      const financeAt = body.indexOf("## Finance");
      const keepAt = body.indexOf("### Keep");
      assert.ok(financeAt !== -1, "the financial page exists but is not in the compatibility body");
      for (const marker of [
        "<!-- lifequest:snapshot:finance-in -->",
        "<!-- lifequest:snapshot:finance-out -->",
        "<!-- lifequest:snapshot:finance-net -->",
      ]) {
        assert.ok(
          body.indexOf(marker) > financeAt && body.indexOf(marker) > body.indexOf("### Look-back"),
          `${marker} did not land under the financial page's Look-back`,
        );
        assert.ok(body.indexOf(marker) < keepAt, `${marker} landed outside the Look-back`);
      }
      // The overall Look-back took the operator's prose and NOT the figures, even
      // though it could have resolved the rules.
      const overallLookback = body.slice(
        body.indexOf("## Look-back"),
        body.indexOf("## Keep"),
      );
      assert.match(overallLookback, /The week in one line\./, "the overall Look-back lost its prose");
      assert.doesNotMatch(
        overallLookback,
        /lifequest:snapshot:finance-/,
        "the figures drifted from the area section into the overall one",
      );

      // The pass created a real page, with the area's page status.
      const reread = await getReview(vaultRoot, "weekly", PERIOD);
      assert.equal(reread.ok, true, "the review could not be read back");
      checks.scopes = reread.ok ? reread.value.scopes : null;
      assert.equal(
        reread.ok && reread.value.scopes.financial?.status,
        "draft",
        "the financial page is missing from the compatibility scopes",
      );

      fs.mkdirSync(path.dirname(PLANT_ARTIFACT), { recursive: true });
      const report = {
        pass: true,
        what:
          "a weekly overall review with no Financial section gets that section planted " +
          "and the figure written under it, not under the overall Look-back",
        command: "node --experimental-strip-types --test tests/review-snapshot-e2e.test.ts",
        vault: vaultRoot,
        checks,
        generatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(PLANT_ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
      assert.equal(fs.existsSync(PLANT_ARTIFACT), true, "the run wrote no plant artifact");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
