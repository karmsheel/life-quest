import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  countWeeklyVaultFiles,
  createVault,
  getReview,
  getReviewAreaChecklist,
  getReviewNotebook,
  listReviewIndex,
  migrateLegacyReviews,
  openVault,
  unlockDomain,
} from "@lifequest/vault-core";

/**
 * The one-release notebook migration, end to end, over fixture vaults.
 *
 * The legacy layout is one markdown file per review period, with the overall
 * skeleton and every area section in it. The notebook layout is a directory per
 * period: `review.json` plus one page per scope. This rig is the evidence that
 * `migrateLegacyReviews` splits a vault without losing a word:
 *
 *  1. every prose chunk, heading (level changes excepted), status, session id,
 *     lock and extra heading survives the split;
 *  2. a locked file stays locked, a `done` scope stays done, a scope with state
 *     but no section still gets a page;
 *  3. the legacy file is archived under `.lifequest/legacy-reviews/` only after
 *     the split verifies, so it is neither re-read as a phantom period nor lost;
 *  4. a split that does not verify is reported and deleted: the legacy file stays
 *     where it was, and the app keeps reading it through the projection;
 *  5. a marker makes the second open a no-op, and the index/weekly count see one
 *     period per notebook — not one per page, not one per legacy file;
 *  6. `openVault` runs the migration before its first index read.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. Splitting by heading name alone loses the prose of an extra heading, or
 *     duplicates it onto two pages.
 *  2. A scope key with no section is dropped, so the checklist forgets an area
 *     the review said was done.
 *  3. The verification compares the wrong thing (e.g. ignores prose) and archives
 *     a file whose text did not survive.
 *  4. The legacy file stays in a scanned directory after the notebook exists, so
 *     the index reports two periods for one review.
 *  5. The marker is written after a failure, so the un-migrated periods stop
 *     being retried.
 *  6. The weekly count counts page files (or directories) instead of periods.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/review-migration.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

const HEADINGS = ["Look-back", "Keep", "Change", "Next-period intent"] as const;

/**
 * Write one legacy review file: the pre-notebook shape (`scopes` is inline JSON,
 * the body is the overall skeleton plus `## <Area>` sections with `###` heads).
 */
function writeLegacyReview(
  vaultRoot: string,
  cadence: string,
  period: string,
  input: {
    title: string;
    weekStartDay?: string;
    locked?: boolean;
    scopes: Record<string, { status: string; sessionId: string | null }>;
    body: string;
    updatedAt?: string;
  },
): void {
  const dir = path.join(vaultRoot, "reviews", cadence);
  fs.mkdirSync(dir, { recursive: true });
  const updatedAt = input.updatedAt ?? "2026-10-20T06:00:00.000Z";
  const raw = [
    "---",
    `cadence: ${cadence}`,
    `period: ${period}`,
    `weekStartDay: ${input.weekStartDay ?? "monday"}`,
    `locked: ${input.locked === true ? "true" : "false"}`,
    `updatedAt: ${updatedAt}`,
    `title: ${JSON.stringify(input.title)}`,
    `scopes: ${JSON.stringify(input.scopes)}`,
    "rev: 4",
    "---",
    input.body,
  ].join("\n");
  fs.writeFileSync(path.join(dir, `${period}.md`), raw);
}

function h2(name: string, text?: string): string {
  return text === undefined ? `## ${name}` : `## ${name}\n\n${text}`;
}

function h3(name: string, text?: string): string {
  return text === undefined ? `### ${name}` : `### ${name}\n\n${text}`;
}

function areaSection(name: string, prose: Record<string, string>, extras: string[] = []): string {
  const lines = [`## ${name}`];
  for (const heading of HEADINGS) lines.push(h3(heading, prose[heading]));
  for (const extra of extras) lines.push(extra);
  return lines.join("\n\n");
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

describe("review notebook migration e2e", () => {
  it("splits, verifies and archives every legacy period once, and never loses a word", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-migration-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};
    fs.rmSync(ARTIFACT, { force: true });

    try {
      const created = await createVault(vaultRoot, "Migration Rig");
      assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
      // A vault made by a pre-notebook release has no marker; this rig plants the
      // legacy files after creation, so drop the marker creation wrote to model
      // that upgrade honestly.
      fs.rmSync(path.join(vaultRoot, ".lifequest", "migrations", "reviews-notebook-v1.json"), {
        force: true,
      });
      for (const slug of ["health", "mind", "financial"]) {
        const unlocked = await unlockDomain(vaultRoot, slug);
        assert.equal(unlocked.ok, true, `unlockDomain(${slug}) failed: ${unlocked.ok ? "" : unlocked.error}`);
      }

      // ── fixture: a plain file with extras, a locked file, a scope with no section, a broken file ──
      const plainPeriod = "2026-10-12";
      const plainBody = [
        "# W42 Review: 12-18 Oct '26",
        h2("Look-back", "The week in one line."),
        h2("Keep", "Kept the morning walk."),
        h2("Change", "Move the phone out of the bedroom."),
        h2("Next-period intent", "Four walks."),
        areaSection("Health", {
          "Look-back": "Two walks and three early nights.",
          Keep: "Walks at lunch.",
          Change: "Phone out of the bedroom.",
          "Next-period intent": "Four walks next week.",
        }, [h3("Extra note", "An operator heading inside the area.")]),
        areaSection("Mind", {
          "Look-back": "Read three evenings.",
          Keep: "A chapter before bed.",
          Change: "Less scrolling in the morning.",
          "Next-period intent": "Finish the book.",
        }),
        h2("Notes", "A heading outside the skeleton."),
      ].join("\n\n");
      writeLegacyReview(vaultRoot, "weekly", plainPeriod, {
        title: "W42 Review: 12-18 Oct '26",
        scopes: {
          overall: { status: "draft", sessionId: null },
          health: { status: "done", sessionId: "sess-health" },
          mind: { status: "draft", sessionId: null },
        },
        body: plainBody,
      });

      const lockedPeriod = "2026-10-05";
      const lockedBody = [
        "# W41 Review: 5-11 Oct '26",
        h2("Look-back", "A quieter week."),
        h2("Keep", ""),
        h2("Change", ""),
        h2("Next-period intent", ""),
        areaSection("Health", { "Look-back": "One walk." }),
        areaSection("Finance", { "Look-back": "Spent less than planned." }),
      ].join("\n\n");
      writeLegacyReview(vaultRoot, "weekly", lockedPeriod, {
        title: "W41 Review: 5-11 Oct '26",
        locked: true,
        scopes: {
          overall: { status: "done", sessionId: "sess-overall" },
          health: { status: "done", sessionId: "sess-health-2" },
          financial: { status: "done", sessionId: null },
        },
        body: lockedBody,
      });

      // A scope with state but no section: the page must exist with the empty skeleton.
      const stateOnlyPeriod = "2026-09";
      writeLegacyReview(vaultRoot, "monthly", stateOnlyPeriod, {
        title: "September 2026 review",
        scopes: {
          overall: { status: "done", sessionId: null },
          health: { status: "done", sessionId: "sess-health-3" },
        },
        body: [
          "# September 2026 review",
          h2("Look-back", "September, told straight."),
          h2("Keep", ""),
          h2("Change", ""),
          h2("Next-period intent", ""),
        ].join("\n\n"),
      });

      // A split that cannot verify: the required heading appears twice, so the
      // second one's prose has nowhere to go. The migration must refuse it.
      const brokenPeriod = "2026-09-28";
      const brokenBody = [
        "# W40 Review: 28 Sep-4 Oct '26",
        h2("Look-back", "First look-back."),
        h2("Keep", ""),
        h2("Change", ""),
        h2("Next-period intent", ""),
        h2("Look-back", "A second look-back that would be dropped."),
      ].join("\n\n");
      writeLegacyReview(vaultRoot, "weekly", brokenPeriod, {
        title: "W40 Review: 28 Sep-4 Oct '26",
        scopes: { overall: { status: "draft", sessionId: null } },
        body: brokenBody,
      });

      const before = await listReviewIndex(vaultRoot);
      assert.equal(before.ok, true, "the pre-migration index could not be read");
      checks.beforeIndex = before.ok ? before.value : null;

      // ── 1. the migration ─────────────────────────────────────────────────
      const report = await migrateLegacyReviews(vaultRoot);
      assert.equal(report.ok, true, `migrateLegacyReviews failed: ${report.ok ? "" : report.error}`);
      const value = report.ok ? report.value : null;
      assert.ok(value, "no migration report");
      checks.report = value;
            const byPeriod = new Map(value.periods.map((entry) => [`${entry.cadence}/${entry.period}`, entry]));
      assert.equal(byPeriod.get("weekly/2026-10-12")?.status, "migrated", "the plain weekly file did not migrate");
      assert.equal(byPeriod.get("weekly/2026-10-05")?.status, "migrated", "the locked weekly file did not migrate");
      assert.equal(byPeriod.get("monthly/2026-09")?.status, "migrated", "the state-only monthly file did not migrate");
      assert.equal(byPeriod.get("weekly/2026-09-28")?.status, "failed", "the un-verifiable file was not reported");
      assert.match(
        byPeriod.get("weekly/2026-09-28")?.reason ?? "",
        /prose differs|text blocks/,
        "the failed period does not say why it did not verify",
      );

      // ── 2. every word, status, session and lock survived ─────────────────
      const plainNotebook = await getReviewNotebook(vaultRoot, "weekly", plainPeriod);
      assert.equal(plainNotebook.ok, true, "the plain notebook could not be read");
      const plain = plainNotebook.ok ? plainNotebook.value : null;
      checks.plainNotebook = plain;
      assert.ok(plain, "no plain notebook");
      assert.equal(plain!.locked, false, "the plain notebook came back locked");
      assert.deepEqual(plain!.order, ["overall", "health", "mind"], "the manifest order is not insertion order");
      assert.equal(plain!.pages.find((page) => page.scope === "overall")?.status, "draft", "overall status changed");
      assert.equal(plain!.pages.find((page) => page.scope === "health")?.status, "done", "health status changed");
      assert.equal(plain!.pages.find((page) => page.scope === "health")?.sessionId, "sess-health", "health session changed");
      assert.equal(plain!.pages.find((page) => page.scope === "mind")?.status, "draft", "mind status changed");
      const pageFiles = fs.readdirSync(path.join(vaultRoot, "reviews", "weekly", plainPeriod)).sort();
      assert.deepEqual(
        pageFiles,
        ["health.md", "mind.md", "overall.md", "review.json"],
        "the plain notebook is not a manifest plus one page per scope",
      );

      const plainCompat = await getReview(vaultRoot, "weekly", plainPeriod);
      assert.equal(plainCompat.ok, true, "the plain notebook's compatibility read failed");
      const compatBody = plainCompat.ok ? plainCompat.value.bodyMarkdown : "";
      checks.compatBody = compatBody;
      for (const chunk of [
        "The week in one line.",
        "Kept the morning walk.",
        "Move the phone out of the bedroom.",
        "Four walks.",
        "Two walks and three early nights.",
        "Walks at lunch.",
        "Phone out of the bedroom.",
        "Four walks next week.",
        "Read three evenings.",
        "Finish the book.",
        "An operator heading inside the area.",
        "A heading outside the skeleton.",
      ]) {
        assert.ok(compatBody.includes(chunk), `the split lost a prose chunk: ${chunk}`);
      }
      assert.equal(
        (compatBody.match(/Extra note/g) ?? []).length,
        1,
        "the area's extra heading was duplicated or dropped",
      );

      const lockedNotebook = await getReviewNotebook(vaultRoot, "weekly", lockedPeriod);
      assert.equal(lockedNotebook.ok, true, "the locked notebook could not be read");
      assert.equal(lockedNotebook.ok ? lockedNotebook.value.locked : false, true, "the locked file came back unlocked");

      const stateOnly = await getReviewNotebook(vaultRoot, "monthly", stateOnlyPeriod);
      assert.equal(stateOnly.ok, true, "the state-only notebook could not be read");
      const stateOnlyHealth = await getReview(vaultRoot, "monthly", stateOnlyPeriod);
      assert.equal(stateOnlyHealth.ok, true, "the state-only notebook's projection failed");
      assert.equal(
        stateOnlyHealth.ok ? stateOnlyHealth.value.scopes.health?.status : "",
        "done",
        "a done scope with no section lost its status",
      );
      const healthPage = fs.readFileSync(
        path.join(vaultRoot, "reviews", "monthly", stateOnlyPeriod, "health.md"),
        "utf8",
      );
      assert.match(healthPage, /^---[\s\S]*scope: health/, "the state-only page has no scope frontmatter");
      for (const heading of HEADINGS) {
        assert.ok(healthPage.includes(`## ${heading}`), `the state-only page is missing ## ${heading}`);
      }

      const checklist = await getReviewAreaChecklist(vaultRoot, "weekly", plainPeriod);
      assert.equal(checklist.ok, true, "the post-migration checklist failed");
      assert.equal(checklist.ok && checklist.value.areas.find((area) => area.slug === "health")?.status, "done", "the checklist lost the migrated done area");

      // ── 3. legacy files archived, not left as phantom periods ────────────
      assert.equal(
        fs.existsSync(path.join(vaultRoot, "reviews", "weekly", `${plainPeriod}.md`)),
        false,
        "the plain legacy file was not moved out of the scanned directory",
      );
      assert.equal(
        fs.existsSync(path.join(vaultRoot, ".lifequest", "legacy-reviews", "weekly", `${plainPeriod}.md`)),
        true,
        "the plain legacy file was not archived",
      );
      assert.equal(
        fs.existsSync(path.join(vaultRoot, "reviews", "weekly", `${brokenPeriod}.md`)),
        true,
        "a period whose split failed was moved or deleted",
      );
      assert.equal(
        fs.existsSync(path.join(vaultRoot, "reviews", "weekly", brokenPeriod)),
        false,
        "a failed split left a half-written notebook behind",
      );

      const markerPath = path.join(vaultRoot, ".lifequest", "migrations", "reviews-notebook-v1.json");
      assert.equal(fs.existsSync(markerPath), true, "the migration marker was not written");
      const marker = readJson<{ periods: { cadence: string; period: string; status: string }[] }>(markerPath);
      checks.marker = marker;
      assert.equal(marker.periods.length, value.periods.length, "the marker does not hold the report's periods");

      // ── 4. index and weekly count see one period per notebook ────────────
      const after = await listReviewIndex(vaultRoot);
      assert.equal(after.ok, true, "the post-migration index could not be read");
      const entries = after.ok ? after.value : [];
      checks.afterIndex = entries;
      const weeklyEntries = entries.filter((entry) => entry.cadence === "weekly");
      assert.equal(
        weeklyEntries.filter((entry) => entry.period === plainPeriod).length,
        1,
        "the index reports the migrated period twice",
      );
      // A period whose split failed still reads through the legacy projection, so
      // the index lists it once rather than hiding it or showing it twice.
      const brokenEntry = weeklyEntries.find((entry) => entry.period === brokenPeriod);
      assert.ok(brokenEntry, "the failed period is missing from the index");
      assert.equal(
        brokenEntry!.scopes.overall?.status,
        "draft",
        "the failed period's legacy state is not readable through the index",
      );
      const weeklyCount = await countWeeklyVaultFiles(vaultRoot);
      checks.weeklyCount = weeklyCount;
      assert.equal(weeklyCount, 3, "the weekly count is not the number of weekly periods (2 notebooks + 1 failed legacy)");

      // ── 5. idempotent: a second run writes nothing ───────────────────────
      const snapshot = (): string => {
        const files: string[] = [];
        const walk = (dir: string): void => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else files.push(`${path.relative(vaultRoot, full)}:${fs.readFileSync(full, "utf8").length}:${fs.statSync(full).mtimeMs}`);
          }
        };
        walk(path.join(vaultRoot, "reviews"));
        walk(path.join(vaultRoot, ".lifequest", "legacy-reviews"));
        return files.join("|");
      };
      const beforeSecond = snapshot();
      const second = await migrateLegacyReviews(vaultRoot);
      assert.equal(second.ok, true, "the second migration run failed");
      assert.equal(second.ok ? second.value.alreadyDone : false, true, "the second run did not report the marker");
      assert.equal(snapshot(), beforeSecond, "a second migration run changed the vault");

      // ── 6. openVault migrates before its first index read ────────────────
      const openWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-open-"));
      const openVaultRoot = path.join(openWorkDir, "vault");
      try {
        const opened = await createVault(openVaultRoot, "Open Rig");
        assert.equal(opened.ok, true, "the open rig could not create a vault");
        fs.rmSync(path.join(openVaultRoot, ".lifequest", "migrations", "reviews-notebook-v1.json"), {
          force: true,
        });
        writeLegacyReview(openVaultRoot, "weekly", plainPeriod, {
          title: "W42 Review: 12-18 Oct '26",
          scopes: { overall: { status: "done", sessionId: null } },
          body: ["# W42 Review: 12-18 Oct '26", h2("Look-back", "Opened, not prepared."), h2("Keep", ""), h2("Change", ""), h2("Next-period intent", "")].join("\n\n"),
        });
        const openedSnapshot = await openVault(openVaultRoot);
        assert.equal(openedSnapshot.ok, true, `openVault failed: ${openedSnapshot.ok ? "" : openedSnapshot.error}`);
        const vaultSnapshot = openedSnapshot.ok ? openedSnapshot.value : null;
        assert.ok(vaultSnapshot, "no vault snapshot");
        checks.openVault = {
          reviews: vaultSnapshot!.reviews,
          migrated: fs.existsSync(path.join(openVaultRoot, ".lifequest", "migrations", "reviews-notebook-v1.json")),
        };
        assert.equal(vaultSnapshot!.reviews.length, 1, "openVault did not report the migrated period once");
        assert.equal(vaultSnapshot!.reviews[0]?.period, plainPeriod, "openVault reported the wrong period");
        assert.equal(
          fs.existsSync(path.join(openVaultRoot, "reviews", "weekly", plainPeriod, "review.json")),
          true,
          "openVault did not split the legacy file before its index read",
        );
      } finally {
        fs.rmSync(openWorkDir, { recursive: true, force: true });
      }

      // ── artifact ──────────────────────────────────────────────────────────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(
        ARTIFACT,
        `${JSON.stringify(
          {
            spec: "review notebook migration",
            checks,
            summary:
              "three legacy periods split and archived with prose/status/session/lock/extra headings " +
              "preserved; a duplicated-heading period refused and left in place; marker written once; " +
              "second run changed nothing; index and weekly count see one period per notebook; " +
              "openVault migrated before its first index read",
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
