import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ANALYZE_NOTE_AUTOMATION_ID,
  automationContextFor,
  automationIsDue,
  createAutomation,
  createVault,
  deleteAutomation,
  formatAutomationSchedule,
  loadAutomations,
  markAutomationRun,
  renderAutomationPrompt,
  updateAutomation,
  type AutomationInput,
} from "@lifequest/vault-core";

/**
 * The automation store, end to end, against a real vault on disk.
 *
 * This is the engine behind the shelf page: the built-in defaults a fresh vault
 * reads, the create/update/delete writes that land in
 * `.lifequest/automations.json`, the last-run record a scheduled tick writes,
 * and the due rule that decides whether a schedule fires. The render half — the
 * editor, the grouped rows and the run-now button — is the `automation` rig.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A fresh vault reporting no automations instead of the built-in.
 *  2. A create that never reaches the file, or writes a second store.
 *  3. A schedule or prompt silently dropped by the round trip.
 *  4. Invalid input stored (empty name, impossible time, unknown host).
 *  5. A malformed store treated as empty, hiding the operator's records.
 *  6. An explicit empty shelf refilled with the built-in, so a delete undoes
 *     itself on the next read.
 *  7. A schedule firing at 10:00 for a 09:00 job created at 10:00.
 *  8. A schedule firing twice after a run, or not firing when a new day's
 *     occurrence has arrived.
 *  9. A changed schedule keeping the old run's floor and firing immediately.
 * 10. A run record not naming its status or session.
 * 11. The note prompt tokens left unsubstituted, or the note context losing the
 *     note's first or last line.
 * 12. A `none` host claiming a Daily Note context it never read.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/automation-engine.json");

function input(overrides: Partial<AutomationInput>): AutomationInput {
  return {
    name: "Morning sweep",
    description: "Reads the day's note.",
    prompt: "Sweep {{dateLabel}}.",
    host: "daily-note",
    trigger: { type: "manual" },
    enabled: true,
    ...overrides,
  };
}

describe("automation store e2e", () => {
  it("persists the shelf, its schedule rule and its runs", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-automations-"));
    const vaultRoot = path.join(workDir, "vault");
    const store = path.join(vaultRoot, ".lifequest", "automations.json");
    const checks: Record<string, unknown> = {};

    const created = await createVault(vaultRoot, "Automation Rig");
    assert.equal(created.ok, true, "createVault failed");
    checks.vaultRoot = vaultRoot;

    // ── 1. a fresh vault sees the built-in, without a file ──────────────────
    const fresh = await loadAutomations(vaultRoot);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.ok ? fresh.value.length : 0, 1);
    assert.equal(fresh.ok ? fresh.value[0]?.id : null, ANALYZE_NOTE_AUTOMATION_ID);
    assert.equal(fresh.ok ? fresh.value[0]?.trigger.type : null, "manual");
    assert.equal(fs.existsSync(store), false, "a read wrote the store");
    checks.fresh = fresh.ok ? fresh.value : null;

    // ── 2. create lands one record in one file ──────────────────────────────
    const made = await createAutomation(
      vaultRoot,
      input({
        name: "Weekly review prep",
        description: "Sets up the weekly review.",
        prompt: "Set up the weekly review for {{dateLabel}}.",
        host: "none",
        trigger: {
          type: "schedule",
          frequency: "weekly",
          time: "18:30",
          weekday: 1,
        },
      }),
    );
    assert.equal(made.ok, true, made.ok ? "" : made.error);
    assert.equal(fs.existsSync(store), true, "create wrote no store");
    const madeList = made.ok ? made.value : [];
    assert.equal(madeList.length, 2);
    const scheduled = madeList.find((record) => record.name === "Weekly review prep");
    assert.ok(scheduled, "the created record is missing");
    assert.equal(scheduled!.host, "none");
    assert.deepEqual(scheduled!.trigger, {
      type: "schedule",
      frequency: "weekly",
      time: "18:30",
      weekday: 1,
    });
    assert.equal(formatAutomationSchedule(scheduled!.trigger), "Mondays at 18:30");
    checks.created = scheduled;

    // ── 3. the file is the store, and a second read is the same shelf ───────
    const reread = await loadAutomations(vaultRoot);
    assert.equal(reread.ok, true);
    assert.deepEqual(
      reread.ok ? reread.value.map((record) => record.id) : [],
      madeList.map((record) => record.id),
      "the store changed between two reads",
    );
    const raw = JSON.parse(fs.readFileSync(store, "utf8")) as {
      automations?: { id: string }[];
    };
    assert.equal(raw.automations?.length, 2, "the store does not hold one array");

    // ── 4. invalid input is refused, not stored ─────────────────────────────
    for (const [label, value] of [
      ["an empty name", input({ name: "  " })],
      ["an impossible time", input({ trigger: { type: "schedule", frequency: "daily", time: "24:00", weekday: null } })],
      ["an unknown host", input({ host: "elsewhere" as never })],
    ] as const) {
      const refused = await createAutomation(vaultRoot, value);
      assert.equal(refused.ok, false, `${label} was accepted`);
    }
    const unchanged = await loadAutomations(vaultRoot);
    assert.equal(unchanged.ok ? unchanged.value.length : -1, 2);

    // ── 5. an update persists, and a schedule change resets the floor ───────
    const before = scheduled!;
    const renamed = await updateAutomation(vaultRoot, before.id, {
      ...input({
        name: "Weekly review setup",
        description: before.description,
        prompt: before.prompt,
        host: before.host,
        trigger: before.trigger,
      }),
    });
    assert.equal(renamed.ok, true);
    const afterRename = renamed.ok
      ? renamed.value.find((record) => record.id === before.id)
      : null;
    assert.equal(afterRename?.name, "Weekly review setup");
    assert.equal(afterRename?.lastRunAt, before.lastRunAt);
    const changedSchedule = await updateAutomation(vaultRoot, before.id, {
      ...input({
        name: "Weekly review setup",
        description: before.description,
        prompt: before.prompt,
        host: before.host,
        trigger: { type: "schedule", frequency: "daily", time: "09:00", weekday: null },
      }),
    });
    assert.equal(changedSchedule.ok, true);
    const afterSchedule = changedSchedule.ok
      ? changedSchedule.value.find((record) => record.id === before.id)
      : null;
    assert.ok(afterSchedule?.lastRunAt, "a changed schedule did not reset its floor");
    checks.updated = afterSchedule;

    // ── 6. a run writes its status and session ──────────────────────────────
    const marked = await markAutomationRun(vaultRoot, before.id, {
      status: "succeeded",
      sessionId: "session-42",
      at: "2026-10-24T09:00:01.000Z",
    });
    assert.equal(marked.ok, true);
    const afterRun = marked.ok
      ? marked.value.find((record) => record.id === before.id)
      : null;
    assert.equal(afterRun?.lastRunStatus, "succeeded");
    assert.equal(afterRun?.lastRunSessionId, "session-42");
    assert.equal(afterRun?.lastRunAt, "2026-10-24T09:00:01.000Z");
    checks.run = afterRun;

    // ── 7. the due rule: a created job does not fire for a past time ────────
    const mondayMorning = new Date(2026, 9, 19, 10, 0, 0); // local Monday 10:00
    const createdAfterNine = {
      ...afterRun!,
      createdAt: new Date(2026, 9, 19, 10, 0, 0).toISOString(),
      updatedAt: new Date(2026, 9, 19, 10, 0, 0).toISOString(),
      lastRunAt: null,
      lastRunStatus: null,
      lastRunSessionId: null,
    };
    assert.equal(
      automationIsDue(createdAfterNine, mondayMorning),
      false,
      "a 09:00 job created at 10:00 fired for the same morning",
    );
    const older = {
      ...createdAfterNine,
      createdAt: new Date(2026, 9, 18, 8, 0, 0).toISOString(),
    };
    assert.equal(
      automationIsDue(older, mondayMorning),
      true,
      "yesterday's 09:00 job was not due on Monday at 10:00",
    );
    assert.equal(
      automationIsDue({ ...older, lastRunAt: "2026-10-19T09:00:01.000Z" }, mondayMorning),
      false,
      "the same occurrence fired twice",
    );
    assert.equal(
      automationIsDue(
        {
          ...older,
          createdAt: new Date(2026, 9, 19, 9, 0, 0).toISOString(),
          trigger: { type: "schedule", frequency: "daily", time: "11:00", weekday: null },
        },
        mondayMorning,
      ),
      false,
      "a job created this morning with a later time fired for yesterday",
    );
    checks.due = {
      createdAfterNine: automationIsDue(createdAfterNine, mondayMorning),
      older: automationIsDue(older, mondayMorning),
      rerun: automationIsDue(
        { ...older, lastRunAt: "2026-10-19T09:00:01.000Z" },
        mondayMorning,
      ),
      laterToday: automationIsDue(
        {
          ...older,
          createdAt: new Date(2026, 9, 19, 9, 0, 0).toISOString(),
          trigger: { type: "schedule", frequency: "daily", time: "11:00", weekday: null },
        },
        mondayMorning,
      ),
    };

    // ── 8. prompt tokens and the note context ───────────────────────────────
    assert.equal(
      renderAutomationPrompt("Sweep {{dateLabel}} ({{date}}) for {{dateLabel}}.", {
        date: "2026-10-24",
        dateLabel: "24 Oct 2026",
      }),
      "Sweep 24 Oct 2026 (2026-10-24) for 24 Oct 2026.",
    );
    const note = "First line of the day.\n\nLast line of the day.";
    const dailyNoteAutomation = fresh.ok ? fresh.value[0]! : null;
    const context = dailyNoteAutomation
      ? automationContextFor(dailyNoteAutomation, {
          date: "2026-10-24",
          dateLabel: "24 Oct 2026",
          body: note,
        })
      : null;
    assert.ok(context, "the Daily Note context is missing");
    assert.match(context!, /AUTOMATION — ANALYZE NOTE/);
    assert.match(context!, /First line of the day\./);
    assert.match(context!, /Last line of the day\./);
    assert.match(context!, /--- DAILY NOTE \(2026-10-24\) ---/);
    assert.equal(
      automationContextFor(
        { ...dailyNoteAutomation!, host: "none" },
        { date: "2026-10-24", dateLabel: "24 Oct 2026", body: note },
      ),
      undefined,
      "a prompt-only job claimed a note context",
    );
    checks.context = context;

    // ── 9. delete the built-in, and an empty shelf stays empty ─────────────
    const emptied = await deleteAutomation(vaultRoot, ANALYZE_NOTE_AUTOMATION_ID);
    assert.equal(emptied.ok, true);
    assert.equal(emptied.ok ? emptied.value.length : -1, 1);
    const afterDelete = await deleteAutomation(vaultRoot, before.id);
    assert.equal(afterDelete.ok, true);
    assert.deepEqual(afterDelete.ok ? afterDelete.value : null, []);
    const stillEmpty = await loadAutomations(vaultRoot);
    assert.deepEqual(stillEmpty.ok ? stillEmpty.value : null, [], "an empty shelf refilled itself");
    checks.afterDelete = afterDelete.ok ? afterDelete.value : null;

    // ── 10. a malformed store is reported, not mistaken for a fresh vault ──
    fs.writeFileSync(store, "{ not json");
    const broken = await loadAutomations(vaultRoot);
    assert.equal(broken.ok, false, "a malformed store was read as a shelf");
    assert.match(broken.ok ? "" : broken.error, /not valid JSON/);
    checks.brokenError = broken.ok ? null : broken.error;

    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    fs.writeFileSync(
      ARTIFACT,
      `${JSON.stringify({ pass: true, checks, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    assert.equal(fs.existsSync(ARTIFACT), true);
    assert.equal(fs.existsSync(store), true);
  });
});
