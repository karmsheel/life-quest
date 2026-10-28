import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createManualDecision,
  createVault,
  listDecisions,
  listManualDecisions,
  openVault,
  readLog,
  vaultPaths,
} from "@lifequest/vault-core";

/**
 * Manual decisions, end to end, against a real vault on disk.
 *
 * This is the whole product path behind the new Manual tab: the operator's
 * sentence goes through the same `createManualDecision` the IPC handler calls,
 * lands as a real file in the vault, is read back by the same
 * `listManualDecisions` the page calls, and appears in the Life log. It also
 * proves the safety property the tab rests on — a logged decision is NOT a
 * proposal, so the approval inbox, the vault snapshot's pending list, and the
 * approve path never see one.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`), so it
 * needs no Electron and no dev server: vault-core is plain Node.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A record with a blank sentence is accepted, putting a row in History the
 *     operator cannot edit (the store is append-only).
 *  2. The record lands outside `.lifequest/manual-decisions/<id>.json`, so a
 *     backup, a sync, or a hand repair looks in the wrong place.
 *  3. The writer's answer and the next read disagree about the same record —
 *     the page would draw something other than what was stored.
 *  4. A field is dropped on the round trip: rationale, domain, createdAt, id.
 *  5. The list is not newest-first, so History and the form's recent list show
 *     the oldest decision as the latest.
 *  6. A manual decision leaks into the approval inbox, the snapshot's pending
 *     list, or the Decisions directory — the one cardinal rule of the split.
 *  7. The Life log misses the act, or names the wrong actor and domain.
 *  8. A domain that is gone or archived is accepted, filing the record where no
 *     lens can show it.
 *  9. A fresh vault with no manual-decisions directory errors instead of
 *     answering an empty history.
 * 10. One hand-broken file blanks the whole manual history, or is silently
 *     rewritten/deleted, or is reported on every read instead of once.
 * 11. A hand-edited file names an agent, and the read path lets a manual record
 *     claim a proposer — there is no proposer to name.
 * 12. The artifact is written by a failing run. Failures throw, so the artifact
 *     only exists for a run that held.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT = path.join(
  desktopRoot,
  "e2e/artifacts/manual-decisions-engine.json",
);

const roots: string[] = [];

async function freshVault(label: string): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), `lifequest-manual-${label}-`),
  );
  roots.push(root);
  const created = await createVault(root, "Manual decisions E2E");
  assert.equal(
    created.ok,
    true,
    created.ok ? "" : `createVault failed: ${created.error}`,
  );
  return root;
}

/** A moment's pause, so two createdAt stamps can differ at millisecond grain. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe("manual decisions, end to end", () => {
  it("logs, reads back, stays out of the inbox, and survives a broken file", async () => {
    const checks: Record<string, unknown> = {};
    const root = await freshVault("main");
    const paths = vaultPaths(root);

    // 1. The operator's sentence, with the edges trimmed and a named domain.
    const first = await createManualDecision(root, {
      title: "  Stop the gym membership  ",
      rationale: "  The ledger says it costs more than it returns.  ",
      domainSlug: "financial",
    });
    assert.equal(first.ok, true, first.ok ? "" : first.error);
    if (!first.ok) return;
    const record = first.value;

    assert.equal(record.title, "Stop the gym membership");
    assert.equal(
      record.rationale,
      "The ledger says it costs more than it returns.",
    );
    assert.equal(record.domainSlug, "financial");
    assert.deepEqual(record.actor, { type: "user" });
    assert.match(
      record.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    assert.ok(!Number.isNaN(Date.parse(record.createdAt)));
    checks.created = {
      title: record.title,
      domainSlug: record.domainSlug,
      rationaleStored: record.rationale,
      actor: record.actor,
    };

    // 2. The record is a real file at the path the store owns, and its bytes are
    //    the record — no second representation that could drift.
    const filePath = paths.manualDecisionJson(record.id);
    assert.equal(path.dirname(filePath), paths.manualDecisionsDir);
    const onDisk = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(onDisk, record);

    // 3. The read the page calls answers the same record.
    const afterFirst = await listManualDecisions(root);
    assert.equal(afterFirst.ok, true, afterFirst.ok ? "" : afterFirst.error);
    if (!afterFirst.ok) return;
    assert.deepEqual(afterFirst.value, [record]);

    // 4. A second decision with no rationale and no domain — those are optional,
    //    and the newest must come first.
    await tick();
    const second = await createManualDecision(root, {
      title: "Take the longer route to work",
    });
    assert.equal(second.ok, true, second.ok ? "" : second.error);
    if (!second.ok) return;
    assert.equal(second.value.rationale, null);
    assert.equal(second.value.domainSlug, null);

    const afterSecond = await listManualDecisions(root);
    assert.equal(afterSecond.ok, true, afterSecond.ok ? "" : afterSecond.error);
    if (!afterSecond.ok) return;
    assert.equal(afterSecond.value.length, 2);
    assert.equal(afterSecond.value[0]?.id, second.value.id);
    assert.equal(afterSecond.value[1]?.id, record.id);
    checks.newestFirst = afterSecond.value.map((d) => d.title);

    // 5. A blank sentence is refused, and nothing is written.
    const filesBefore = (await fs.readdir(paths.manualDecisionsDir)).length;
    const blank = await createManualDecision(root, { title: "   " });
    assert.equal(blank.ok, false);
    if (!blank.ok) {
      assert.match(blank.error, /Say what you decided/);
    }
    assert.equal(
      (await fs.readdir(paths.manualDecisionsDir)).length,
      filesBefore,
    );
    checks.blankRejected = true;

    // 6. A domain that does not exist, and one that is archived, are both
    //    refused: a record filed where the lens can never show it is a record
    //    the operator cannot find again.
    const unknown = await createManualDecision(root, {
      title: "Move to a city that does not exist",
      domainSlug: "travel",
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) {
      assert.match(unknown.error, /Domain not found or archived: travel/);
    }
    const healthPath = paths.domainJson("health");
    const health = JSON.parse(await fs.readFile(healthPath, "utf8")) as Record<
      string,
      unknown
    >;
    await fs.writeFile(
      healthPath,
      `${JSON.stringify(
        { ...health, archivedAt: new Date().toISOString() },
        null,
        2,
      )}\n`,
    );
    const archived = await createManualDecision(root, {
      title: "Renew the archived domain's membership",
      domainSlug: "health",
    });
    assert.equal(archived.ok, false);
    if (!archived.ok) {
      assert.match(archived.error, /Domain not found or archived: health/);
    }
    checks.domainGuards = { unknown: true, archived: true };

    // 7. The cardinal rule: the approval inbox is untouched. Not one manual
    //    decision is a pending proposal, in the directory, the list, or the
    //    snapshot the app boots with.
    const inbox = await listDecisions(root);
    assert.equal(inbox.ok, true, inbox.ok ? "" : inbox.error);
    if (!inbox.ok) return;
    assert.deepEqual(inbox.value, []);
    assert.deepEqual(await fs.readdir(paths.decisionsDir), []);
    const snapshot = await openVault(root);
    assert.equal(snapshot.ok, true, snapshot.ok ? "" : snapshot.error);
    if (!snapshot.ok) return;
    assert.deepEqual(snapshot.value.decisions, []);
    checks.inboxUntouched = true;

    // 8. The Life log has the act, with the operator as actor and the record's
    //    domain on the line.
    const log = await readLog(root);
    assert.equal(log.ok, true, log.ok ? "" : log.error);
    if (!log.ok) return;
    const logged = log.value.filter((e) => e.type === "manual-decision.logged");
    assert.equal(logged.length, 2);
    assert.equal(logged[0]?.domainSlug, "financial");
    assert.deepEqual(logged[0]?.actor, { type: "user" });
    assert.match(logged[0]?.summary ?? "", /Stop the gym membership/);
    assert.deepEqual(
      (logged[0]?.payload as { id?: string } | null)?.id,
      record.id,
    );
    checks.logLines = logged.map((e) => ({
      type: e.type,
      domainSlug: e.domainSlug,
      actor: e.actor,
    }));

    // 9. A hand-edited file that names an agent is still the operator's record:
    //    a manual decision has no proposer to name, so the actor cannot drift.
    await fs.writeFile(
      paths.manualDecisionJson("hand-edited"),
      `${JSON.stringify({
        id: "hand-edited",
        title: "A decision typed onto disk by hand",
        actor: { type: "agent", id: "companion", name: "Hermes" },
      })}\n`,
    );
    const withHandEdit = await listManualDecisions(root);
    assert.equal(
      withHandEdit.ok,
      true,
      withHandEdit.ok ? "" : withHandEdit.error,
    );
    if (!withHandEdit.ok) return;
    const handEdited = withHandEdit.value.find((d) => d.id === "hand-edited");
    assert.ok(handEdited);
    assert.deepEqual(handEdited?.actor, { type: "user" });
    assert.ok(!Number.isNaN(Date.parse(handEdited?.createdAt ?? "")));
    checks.handEditedActor = handEdited?.actor;

    // 10. One broken file must not blank the rest, must be left exactly as it is,
    //     and must be reported once rather than on every read.
    const brokenPath = paths.manualDecisionJson("broken");
    await fs.writeFile(brokenPath, "{ this is not json");
    const brokenBefore = await fs.readFile(brokenPath, "utf8");
    const withBroken = await listManualDecisions(root);
    assert.equal(withBroken.ok, true, withBroken.ok ? "" : withBroken.error);
    if (!withBroken.ok) return;
    assert.equal(withBroken.value.length, 3);
    assert.equal(
      brokenBefore,
      await fs.readFile(brokenPath, "utf8"),
      "a file the read path cannot parse must never be rewritten",
    );
    const logAfterBreak = await readLog(root);
    assert.equal(logAfterBreak.ok, true);
    if (!logAfterBreak.ok) return;
    const unreadableOnce = logAfterBreak.value.filter(
      (e) => e.type === "manual-decision.unreadable",
    );
    assert.equal(unreadableOnce.length, 1);
    // A second read says nothing new.
    await listManualDecisions(root);
    const logAfterSecondRead = await readLog(root);
    assert.equal(logAfterSecondRead.ok, true);
    if (!logAfterSecondRead.ok) return;
    assert.equal(
      logAfterSecondRead.value.filter(
        (e) => e.type === "manual-decision.unreadable",
      ).length,
      1,
    );
    checks.brokenFile = {
      stillOnDisk: true,
      otherRecordsStillRead: withBroken.value.length,
      reportedOnce: true,
    };

    // 11. A fresh vault with the directory removed answers an empty history, and
    //     logging into it brings the directory back.
    const emptyRoot = await freshVault("empty");
    const emptyPaths = vaultPaths(emptyRoot);
    await fs.rm(emptyPaths.manualDecisionsDir, { recursive: true, force: true });
    const emptyList = await listManualDecisions(emptyRoot);
    assert.equal(emptyList.ok, true, emptyList.ok ? "" : emptyList.error);
    if (!emptyList.ok) return;
    assert.deepEqual(emptyList.value, []);
    const recreated = await createManualDecision(emptyRoot, {
      title: "The first decision in a fresh vault",
    });
    assert.equal(recreated.ok, true, recreated.ok ? "" : recreated.error);
    if (!recreated.ok) return;
    const recreatedList = await listManualDecisions(emptyRoot);
    assert.equal(
      recreatedList.ok,
      true,
      recreatedList.ok ? "" : recreatedList.error,
    );
    if (!recreatedList.ok) return;
    assert.deepEqual(recreatedList.value, [recreated.value]);
    checks.freshVault = { emptyList: [], recreatedDirectory: true };

    // 12. The repeatable artifact: only a run that held writes one.
    const report = {
      pass: true,
      vaultRoot: "<temporary, removed after the run>",
      claims: 11,
      checks,
      files: {
        manualDecisionsDir: ".lifequest/manual-decisions/<id>.json",
        recordKeys: Object.keys(record),
      },
    };
    await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
    await fs.writeFile(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);

    for (const dir of roots) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
