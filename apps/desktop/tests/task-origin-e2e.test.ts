import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { applyMapCommand, createVault, loadMapState } from "@lifequest/vault-core";
import type { MapStoreState } from "@lifequest/vault-core";
import type { TaskOrigin } from "@lifequest/vault-core/map";

/**
 * Task provenance, end to end, against a real vault on disk.
 *
 * The Act board needs to draw an "Added by agent" icon on the cards an agent
 * created, so the map store now carries `Task.origin`. This rig proves the
 * whole path with no stubs: a real temp vault from `createVault`, real
 * `applyMapCommand` writes to `.lifequest/map.json`, and a real `loadMapState`
 * read back from that file. The UI half — the icon on the card — is the
 * `task-board` rig the Lead owns; this one owns the data.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. `createTask` ignoring the command's actor, so both actors write one
 *     origin (or neither).
 *  2. `createTask` hard-coding "operator", losing the agent's provenance.
 *  3. `toFile` serializing a different shape and dropping `origin` on write,
 *     so the fact exists only in memory.
 *  4. `fromFile` dropping `origin` on read, so a restart loses it.
 *  5. `updateTask` replacing the task object and wiping `origin` (the card
 *     would lose its badge when renamed).
 *  6. `moveTask` wiping `origin` on drag (the badge would vanish on move).
 *  7. A legacy/hand-edited task with no `origin` staying `undefined` instead
 *     of defaulting to "operator".
 *  8. An unknown hand-typed origin (e.g. "robot") leaking through instead of
 *     normalizing to "operator".
 *  9. Normalization flattening an explicit "agent" to "operator", i.e. over-
 *     normalizing the one value that must survive a hand-edited file.
 * 10. `ensureMapOnOpen` rewriting old map files on upgrade and dropping the
 *     provenance of the tasks that already exist.
 *
 * Artifact: `e2e/artifacts/task-origin.json` — pass/fail, the scenario list,
 * and the tasks observed at each stage (as the vault actually read them back).
 * The assertions at the end run against that same JSON on disk.
 *
 * Runs under `node --experimental-strip-types --test
 * tests/task-origin-e2e.test.ts`, which needs no Electron and no dev server.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/task-origin.json");

type Scenario = { name: string; pass: boolean; detail: string | null };

/** The tasks as the store exposes them, reduced to what this rig observes. */
function observed(state: MapStoreState): { id: string; title: string; origin: TaskOrigin | undefined }[] {
  return state.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    origin: task.origin,
  }));
}

function originOf(state: MapStoreState, title: string): TaskOrigin | undefined {
  return state.tasks.find((task) => task.title === title)?.origin;
}

function idOf(state: MapStoreState, title: string): string {
  const task = state.tasks.find((candidate) => candidate.title === title);
  assert.ok(task, `no task titled ${title}: ${JSON.stringify(observed(state))}`);
  return task.id;
}

/** The raw map file, read the way a hand would edit it. */
function readRawMap(vaultRoot: string): { tasks: Record<string, unknown>[] } {
  const file = path.join(vaultRoot, ".lifequest", "map.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as { tasks: Record<string, unknown>[] };
}

function writeRawMap(vaultRoot: string, raw: { tasks: Record<string, unknown>[] }): void {
  const file = path.join(vaultRoot, ".lifequest", "map.json");
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
}

describe("task origin e2e", () => {
  it("records who added a task and keeps it through writes, moves and the file", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-task-origin-"));
    const vaultRoot = path.join(workDir, "vault");
    const scenarios: Scenario[] = [];
    const scenario = (name: string, pass: boolean, detail: string | null = null): void => {
      scenarios.push({ name, pass, detail });
      assert.equal(pass, true, `${name}: ${detail ?? "failed"}`);
    };

    try {
      const created = await createVault(vaultRoot, "Task Origin Rig");
      assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);

      // ── 1. an agent-created task records the agent ─────────────────────
      const agentCreated = await applyMapCommand(
        vaultRoot,
        {
          type: "createTask",
          title: "Draft the offsite plan",
          notes: "Agent-authored card",
          column: "backlog",
        },
        "agent",
      );
      assert.equal(agentCreated.ok, true, agentCreated.ok ? "" : `createTask failed: ${agentCreated.error}`);
      const afterAgentCreate = agentCreated.ok ? agentCreated.value : null;
      assert.ok(afterAgentCreate, "createTask returned no state");
      const agentOrigin = originOf(afterAgentCreate!, "Draft the offsite plan");
      scenario(
        "agent-create-origin",
        agentOrigin === "agent",
        `the agent-created task reports origin ${JSON.stringify(agentOrigin)}`,
      );

      // ── 2. an operator-created task records the operator ──────────────
      const operatorCreated = await applyMapCommand(
        vaultRoot,
        { type: "createTask", title: "Book the room", column: "today" },
        "user",
      );
      assert.equal(operatorCreated.ok, true, operatorCreated.ok ? "" : `createTask failed: ${operatorCreated.error}`);
      const afterOperatorCreate = operatorCreated.ok ? operatorCreated.value : null;
      assert.ok(afterOperatorCreate, "createTask returned no state");
      const operatorOrigin = originOf(afterOperatorCreate!, "Book the room");
      scenario(
        "operator-create-origin",
        operatorOrigin === "operator",
        `the operator-created task reports origin ${JSON.stringify(operatorOrigin)}`,
      );

      const agentTaskId = idOf(afterOperatorCreate!, "Draft the offsite plan");
      const operatorTaskId = idOf(afterOperatorCreate!, "Book the room");

      // ── 3. the value is in the file, not only in memory ───────────────
      const rawAfterCreate = readRawMap(vaultRoot);
      const rawAgent = rawAfterCreate.tasks.find((task) => task.id === agentTaskId);
      const rawOperator = rawAfterCreate.tasks.find((task) => task.id === operatorTaskId);
      scenario(
        "create-writes-origin",
        rawAgent?.origin === "agent" && rawOperator?.origin === "operator",
        `the map file holds agent=${JSON.stringify(rawAgent?.origin)} operator=${JSON.stringify(rawOperator?.origin)}`,
      );

      // ── 4. a fresh read from disk carries both back ────────────────────
      const reloadedAfterCreate = await loadMapState(vaultRoot);
      assert.equal(reloadedAfterCreate.ok, true, "loadMapState failed");
      const stateAfterCreate = reloadedAfterCreate.ok ? reloadedAfterCreate.value : null;
      assert.ok(stateAfterCreate, "loadMapState returned no state");
      scenario(
        "reload-round-trip",
        originOf(stateAfterCreate!, "Draft the offsite plan") === "agent" &&
          originOf(stateAfterCreate!, "Book the room") === "operator",
        `the re-read store has ${JSON.stringify(observed(stateAfterCreate!))}`,
      );

      // ── 5. moving the agent's card keeps its provenance ───────────────
      const moved = await applyMapCommand(
        vaultRoot,
        { type: "moveTask", id: agentTaskId, column: "this-week" },
        "user",
      );
      assert.equal(moved.ok, true, moved.ok ? "" : `moveTask failed: ${moved.error}`);
      const afterMove = moved.ok ? moved.value : null;
      assert.ok(afterMove, "moveTask returned no state");
      const reloadedAfterMove = await loadMapState(vaultRoot);
      assert.equal(reloadedAfterMove.ok, true, "loadMapState after move failed");
      const stateAfterMove = reloadedAfterMove.ok ? reloadedAfterMove.value : null;
      assert.ok(stateAfterMove, "loadMapState after move returned no state");
      scenario(
        "move-preserves-origin",
        originOf(afterMove!, "Draft the offsite plan") === "agent" &&
          originOf(stateAfterMove!, "Draft the offsite plan") === "agent" &&
          stateAfterMove!.tasks.find((task) => task.id === agentTaskId)?.column === "this-week",
        `after the drag the card reads ${JSON.stringify(observed(stateAfterMove!))}`,
      );

      // ── 6. renaming/retitling the operator's card keeps its origin ────
      const updated = await applyMapCommand(
        vaultRoot,
        {
          type: "updateTask",
          id: operatorTaskId,
          title: "Book the room and the projector",
          notes: "Renamed after an agent edit",
        },
        "agent",
      );
      assert.equal(updated.ok, true, updated.ok ? "" : `updateTask failed: ${updated.error}`);
      const afterUpdate = updated.ok ? updated.value : null;
      assert.ok(afterUpdate, "updateTask returned no state");
      const reloadedAfterUpdate = await loadMapState(vaultRoot);
      assert.equal(reloadedAfterUpdate.ok, true, "loadMapState after update failed");
      const stateAfterUpdate = reloadedAfterUpdate.ok ? reloadedAfterUpdate.value : null;
      assert.ok(stateAfterUpdate, "loadMapState after update returned no state");
      scenario(
        "update-preserves-origin",
        originOf(afterUpdate!, "Book the room and the projector") === "operator" &&
          originOf(stateAfterUpdate!, "Book the room and the projector") === "operator",
        `after the edit the card reads ${JSON.stringify(observed(stateAfterUpdate!))}`,
      );

      // ── 7. a hand-edited file: legacy, unknown and explicit origins ────
      // The three shapes an operator can produce in the file: a task from
      // before provenance existed, a hand-typed value nobody defined, and an
      // explicit "agent" someone (or an older build) wrote by hand.
      const handEdited = readRawMap(vaultRoot);
      handEdited.tasks.push({
        id: "legacy-import",
        title: "Legacy import",
        notes: "",
        column: "backlog",
        links: {},
      });
      handEdited.tasks.push({
        id: "unknown-origin",
        title: "Imported from a robot?",
        notes: "",
        column: "backlog",
        links: {},
        origin: "robot",
      });
      handEdited.tasks.push({
        id: "hand-agent",
        title: "Hand-tagged agent note",
        notes: "",
        column: "backlog",
        links: {},
        origin: "agent",
      });
      writeRawMap(vaultRoot, handEdited);

      const reloadedAfterHandEdit = await loadMapState(vaultRoot);
      assert.equal(reloadedAfterHandEdit.ok, true, "loadMapState after hand edit failed");
      const stateAfterHandEdit = reloadedAfterHandEdit.ok ? reloadedAfterHandEdit.value : null;
      assert.ok(stateAfterHandEdit, "loadMapState after hand edit returned no state");
      scenario(
        "hand-edited-missing-origin-operator",
        originOf(stateAfterHandEdit!, "Legacy import") === "operator",
        `a task with no origin read back as ${JSON.stringify(originOf(stateAfterHandEdit!, "Legacy import"))}`,
      );
      scenario(
        "hand-edited-unknown-origin-operator",
        originOf(stateAfterHandEdit!, "Imported from a robot?") === "operator",
        `origin "robot" read back as ${JSON.stringify(originOf(stateAfterHandEdit!, "Imported from a robot?"))}`,
      );
      scenario(
        "hand-edited-agent-origin-preserved",
        originOf(stateAfterHandEdit!, "Hand-tagged agent note") === "agent",
        `origin "agent" read back as ${JSON.stringify(originOf(stateAfterHandEdit!, "Hand-tagged agent note"))}`,
      );

      // ── 8. the upgrade write on open keeps the normalized values ───────
      // `applyMapCommand` opens the map first; an older file with no origin is
      // normalized and written back. That upgrade must not wipe provenance on
      // the cards that already had it.
      const migrated = await applyMapCommand(
        vaultRoot,
        { type: "updateTask", id: "legacy-import", notes: "Touched after import" },
        "user",
      );
      assert.equal(migrated.ok, true, migrated.ok ? "" : `updateTask failed: ${migrated.error}`);
      const rawAfterMigration = readRawMap(vaultRoot);
      const rawByTitle = (title: string): Record<string, unknown> | undefined =>
        rawAfterMigration.tasks.find((task) => task.title === title);
      scenario(
        "migration-write-keeps-origins",
        rawByTitle("Legacy import")?.origin === "operator" &&
          rawByTitle("Hand-tagged agent note")?.origin === "agent" &&
          rawByTitle("Draft the offsite plan")?.origin === "agent" &&
          rawByTitle("Book the room and the projector")?.origin === "operator",
        `the rewritten map holds ${JSON.stringify(
          rawAfterMigration.tasks.map((task) => ({ title: task.title, origin: task.origin })),
        )}`,
      );

      // ── 9. deleting a card leaves its siblings' provenance alone ───────
      const deleted = await applyMapCommand(
        vaultRoot,
        { type: "deleteTask", id: "unknown-origin" },
        "agent",
      );
      assert.equal(deleted.ok, true, deleted.ok ? "" : `deleteTask failed: ${deleted.error}`);
      const reloadedAfterDelete = await loadMapState(vaultRoot);
      assert.equal(reloadedAfterDelete.ok, true, "loadMapState after delete failed");
      const stateAfterDelete = reloadedAfterDelete.ok ? reloadedAfterDelete.value : null;
      assert.ok(stateAfterDelete, "loadMapState after delete returned no state");
      scenario(
        "delete-keeps-siblings",
        originOf(stateAfterDelete!, "Hand-tagged agent note") === "agent" &&
          originOf(stateAfterDelete!, "Legacy import") === "operator" &&
          originOf(stateAfterDelete!, "Draft the offsite plan") === "agent" &&
          !stateAfterDelete!.tasks.some((task) => task.id === "unknown-origin"),
        `after the delete the vault holds ${JSON.stringify(observed(stateAfterDelete!))}`,
      );

      // ── the artifact, and the assertions on the artifact itself ────────
      const report = {
        pass: true,
        what:
          "Task.origin provenance through the real map store: temp vault on disk, real " +
          "applyMapCommand actor writes, real loadMapState reads, and hand-edited map files",
        command: "cd apps/desktop && node --experimental-strip-types --test tests/task-origin-e2e.test.ts",
        semantics: {
          type: 'TaskOrigin = "agent" | "operator"',
          created: 'createTask writes origin from ApplyContext.actor ("agent" stays "agent", every other actor becomes "operator")',
          preserved: "updateTask and moveTask carry the existing origin untouched",
          loaded: 'only the literal "agent" survives a read; missing or unknown values normalize to "operator"',
          stored: "map.json stores the field beside the task; the open-time upgrade writes normalized values back",
        },
        vault: { temp: true, name: "Task Origin Rig" },
        scenarios,
        stages: {
          afterCreate: observed(stateAfterCreate!),
          afterMove: observed(stateAfterMove!),
          afterUpdate: observed(stateAfterUpdate!),
          afterHandEditRead: observed(stateAfterHandEdit!),
          afterDelete: observed(stateAfterDelete!),
        },
        ids: {
          agentTaskId,
          operatorTaskId,
          legacyTaskId: "legacy-import",
          handAgentTaskId: "hand-agent",
        },
        generatedAt: new Date().toISOString(),
      };

      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);

      // The file on disk is the artifact a reader will open: assert on what was
      // WRITTEN, not on the object still in memory.
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
      const written = JSON.parse(fs.readFileSync(ARTIFACT, "utf8")) as typeof report;
      assert.equal(written.pass, true);
      assert.deepEqual(
        written.scenarios.map((entry) => entry.name),
        scenarios.map((entry) => entry.name),
        "the written scenario list moved",
      );
      assert.deepEqual(
        written.scenarios.filter((entry) => !entry.pass),
        [],
        "the written artifact carries a failed scenario",
      );
      assert.equal(
        written.stages.afterHandEditRead.find((task) => task.id === "legacy-import")?.origin,
        "operator",
      );
      assert.equal(
        written.stages.afterHandEditRead.find((task) => task.id === "hand-agent")?.origin,
        "agent",
      );
      assert.equal(
        written.stages.afterUpdate.find((task) => task.id === operatorTaskId)?.origin,
        "operator",
      );
      assert.equal(
        written.stages.afterMove.find((task) => task.id === agentTaskId)?.origin,
        "agent",
      );
      assert.deepEqual(
        written.stages.afterDelete.find((task) => task.id === "unknown-origin"),
        undefined,
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
