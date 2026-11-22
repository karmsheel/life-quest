import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  SIGNAL_PRIORITIES,
  SIGNAL_STATUSES,
  SIGNAL_TOOL_DEFS,
  USER_ACTOR,
  createSignal,
  createVault,
  executeSignalTool,
  listSignals,
  projectCreate,
  updateSignal,
  vaultPaths,
} from "@lifequest/vault-core";
import * as vaultCore from "@lifequest/vault-core";

/**
 * The Notebox is the vault's Inbox: the signal store gains triage fields
 * (`projectId`, `status`, `priority`, `capturedFrom`) and the MCP door gains
 * `update_signal` (a direct write, not Decision-gated) plus status/project
 * filters on `list_signals`. A capture may also carry one general FILE
 * attachment — any file, not only a picture — stored as bytes under
 * `.lifequest/signal-chain/files/` and named by the record.
 *
 * WRITTEN BEFORE THE BACKEND, ON PURPOSE (AGENTS.md: "Never write unit tests
 * after you write code"). The model fields exist in `types.ts`; the writer
 * validation/defaults and the tools land separately. Until they do, this file
 * is expected to fail. A failure here is a contract gap to report, not a test
 * to loosen: if the product's error message names a different value, the test
 * gets fixed when the contract genuinely differs — anything else is a product
 * bug.
 *
 * ── The ways this could pass while proving nothing (written down first) ──────
 *
 *  1. The fields are returned by `createSignal` out of the input object but
 *     never reach disk. The round trip therefore reads them back through
 *     `listSignals` (a fresh parse of the JSON file) and, separately, parses
 *     the record file itself.
 *  2. An update silently rewrites the record with defaults, or with only the
 *     patched keys. Every assertion after an update also asserts the fields the
 *     patch did NOT name are intact (`capturedFrom` in particular).
 *  3. The MCP filters pass because every record matches the filter. `list_
 *     signals` is asked for the one status/project that should EXCLUDE a second
 *     record, and for a status that matches nothing.
 *  4. A refusal "passes" because the call returned an error but left a record
 *     or a file behind. Every refusal asserts the listed record count and the
 *     raw `.json` file count are unchanged, and the combined-refusal case
 *     compares the record file byte for byte.
 *  5. The legacy case passes because the old file was silently skipped. The
 *     listed result's `skipped` must be 0 and the record must be the same body
 *     that was written.
 *  6. The door's refusal is satisfied by any string. The message must name the
 *     offending value or the allowed set, and the word for the field.
 *  7. A file attachment "works" because the bytes were written somewhere. The
 *     cases read the bytes back at the record's own `relPath`, compare them to
 *     the uploaded bytes, and fetch them again through `readSignalFile`, so a
 *     record naming an unwritten path cannot pass.
 *  8. A refused file (empty, over the ceiling, active content) leaves an orphan
 *     in `signal-chain/files/`. Every refusal counts BOTH the records and the
 *     expected-to-be-written files directory, not just the record list.
 *  9. The extensionless case passes because the store secretly appended a type.
 *     The `relPath` regex for it requires the bare uuid with no dot suffix.
 * 10. A file attachment is lost by `listSignals` or by an unrelated update. Both
 *     are asserted to keep the same attachment object.
 *
 * Deterministic and offline: each case builds a throwaway vault with
 * `fs.mkdtempSync` + `createVault`, talks only to the store on local disk, and
 * needs no dev server, network, Electron or e2e rig. Run it with:
 *
 *   cd apps/desktop && node --experimental-strip-types --test tests/signal-inbox-unit.test.ts
 */

/**
 * Where a refused write must not have left anything: count BOTH the records the
 * chain lists and the JSON files on disk. Used by the triage refusals.
 */
async function chainCounts(root: string) {
  const listed = await listSignals(root);
  assert.equal(listed.ok, true, `listSignals failed: ${listed.ok ? "" : listed.error}`);
  const dir = vaultPaths(root).signalChainDir;
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length
    : 0;
  return { records: listed.ok ? listed.value.records.length : -1, files };
}

/**
 * Where a refused attachment must not have left anything: the records the chain
 * lists plus the ATTACHMENT files directory, so an orphan byte file is caught
 * even when no record was written.
 */
async function storeCounts(root: string) {
  const listed = await listSignals(root);
  assert.equal(listed.ok, true, `listSignals failed: ${listed.ok ? "" : listed.error}`);
  return {
    records: listed.ok ? listed.value.records.length : -1,
    files: attachmentFiles(root).length,
  };
}

/** The bytes the store keeps: `.lifequest/signal-chain/files/`. */
function attachmentFiles(root: string): string[] {
  const dir = vaultPaths(root).signalChainFilesDir;
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** Typed-array identity is a prototype question; the bytes are what matters. */
function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, message: string): void {
  assert.equal(
    Buffer.from(actual).equals(Buffer.from(expected)),
    true,
    message,
  );
}

/**
 * The generic-file surface (`readSignalFile`, `SIGNAL_FILE_MAX_BYTES`, the
 * `file` attachment kind) lands separately from the triage surface, in parallel
 * on this shared tree. It is read off the namespace import so that while it is
 * still landing, cases A-E keep running and the FILE cases fail BY NAME with
 * "vault-core does not export ...", instead of a missing named import failing
 * the whole module before any case runs.
 */
function vaultExport(name: string): unknown {
  return (vaultCore as unknown as Record<string, unknown>)[name];
}

type FileReadResult =
  | { ok: true; value: { bytes: Uint8Array; mime: string } }
  | { ok: false; error: string };

function requireFileRead(): (root: string, relPath: string) => Promise<FileReadResult> {
  const read = vaultExport("readSignalFile");
  assert.equal(
    typeof read,
    "function",
    "vault-core does not export readSignalFile — the generic-file writer has not landed",
  );
  return read as (root: string, relPath: string) => Promise<FileReadResult>;
}

function requireFileMax(): number {
  const max = vaultExport("SIGNAL_FILE_MAX_BYTES");
  assert.equal(
    typeof max,
    "number",
    "vault-core does not export SIGNAL_FILE_MAX_BYTES — the generic-file writer has not landed",
  );
  return max as number;
}

/** `readSignalFile` that must succeed, with the bytes it returned. */
async function readFileOk(root: string, relPath: string) {
  const result = await requireFileRead()(root, relPath);
  assert.equal(
    result.ok,
    true,
    `readSignalFile refused ${relPath}: ${result.ok ? "" : result.error}`,
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function chainFiles(root: string): string[] {
  const dir = vaultPaths(root).signalChainDir;
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
    : [];
}

function recordFile(root: string, id: string): string {
  return vaultPaths(root).signalChainJson(id);
}

function readRecordFile(root: string, id: string) {
  return JSON.parse(fs.readFileSync(recordFile(root, id), "utf8")) as Record<
    string,
    unknown
  >;
}

/** A fresh vault for one case: nothing another case writes can reach it. */
async function openRig(label: string): Promise<{ dir: string; root: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-signal-inbox-"));
  const root = path.join(dir, "vault");
  const created = await createVault(root, label);
  assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
  if (!created.ok) throw new Error(created.error);
  return { dir, root };
}

function closeRig(rig: { dir: string }): void {
  fs.rmSync(rig.dir, { recursive: true, force: true });
}

/**
 * The throwaway vaults are built once, concurrently, before the first case:
 * `createVault` seeds areas and documents and is the only costly part of this
 * file, and building them in parallel keeps the whole run a few seconds even on
 * a loaded machine. Each case still gets its own vault — nothing one case writes
 * can reach another — and closes it when done.
 */
const RIG_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const rigPool: Record<string, { dir: string; root: string }> = {};

before(async () => {
  await Promise.all(
    RIG_LABELS.map(async (label) => {
      rigPool[label] = await openRig(`Signal inbox rig ${label}`);
    }),
  );
});

after(() => {
  for (const rig of Object.values(rigPool)) closeRig(rig);
});

function rigFor(label: string): { dir: string; root: string } {
  const rig = rigPool[label];
  assert.ok(rig, `no throwaway vault was built for case ${label}`);
  return rig!;
}

async function listedRecords(root: string) {
  const listed = await listSignals(root);
  assert.equal(listed.ok, true, `listSignals failed: ${listed.ok ? "" : listed.error}`);
  if (!listed.ok) throw new Error(listed.error);
  return listed.value;
}

function recordOf(records: { id: string }[], id: string) {
  const record = records.find((candidate) => candidate.id === id);
  assert.ok(record, `signal ${id} is not on the chain (${records.length} records)`);
  return record!;
}

/** A live project, made the operator's way (writes `projects/<id>.md`). */
async function makeProject(root: string, title: string) {
  const project = await projectCreate(root, { title });
  assert.equal(project.ok, true, `projectCreate failed: ${project.ok ? "" : project.error}`);
  if (!project.ok) throw new Error(project.error);
  return project.value;
}

async function createOk(root: string, input: Record<string, unknown>) {
  const created = await createSignal(root, input as never);
  assert.equal(
    created.ok,
    true,
    `createSignal was refused: ${created.ok ? "" : created.error}`,
  );
  if (!created.ok) throw new Error(created.error);
  return created.value;
}

async function updateOk(root: string, id: string, patch: Record<string, unknown>) {
  const updated = await updateSignal(root, id, patch as never);
  assert.equal(
    updated.ok,
    true,
    `updateSignal was refused: ${updated.ok ? "" : updated.error}`,
  );
  if (!updated.ok) throw new Error(updated.error);
  return updated.value;
}

/** A door read/create that must succeed: any `{ error }` shape is a failure. */
async function toolOk(root: string, name: string, args: Record<string, unknown>) {
  const result = await executeSignalTool(root, USER_ACTOR, name, args);
  assert.equal(
    "error" in result,
    false,
    `${name} was refused: ${"error" in result ? JSON.stringify(result.error) : ""}`,
  );
  return result as Record<string, unknown>;
}

/** A door refusal: `{ error: { code, message } }`, message must be a string. */
function toolRefusalMessage(result: Record<string, unknown> | { error: unknown }): string {
  assert.ok(
    result !== null && typeof result === "object" && "error" in result,
    `the door accepted input it should have refused: ${JSON.stringify(result)}`,
  );
  const error = (result as { error?: unknown }).error;
  assert.ok(error !== null && typeof error === "object", "the refusal carries no error object");
  const message = (error as { message?: unknown }).message;
  assert.equal(typeof message, "string", "the refusal carries no message");
  assert.ok((message as string).length > 0, "the refusal message is empty");
  return message as string;
}

/**
 * "Refused by name": the message must mention the field, and either the value it
 * was handed or a member of the set it should have been one of.
 */
function assertNamesRefusal(
  message: string,
  field: string,
  value: string,
  allowed: readonly string[],
): void {
  assert.match(
    message.toLowerCase(),
    new RegExp(field.toLowerCase()),
    `the refusal does not name the ${field} it refused: ${JSON.stringify(message)}`,
  );
  const namesValue = message.includes(value);
  const namesAllowed = allowed.some((name) => message.includes(name));
  assert.ok(
    namesValue || namesAllowed,
    `the refusal names neither the offending ${field} (${JSON.stringify(value)}) nor the allowed set (${allowed.join(", ")}): ${JSON.stringify(message)}`,
  );
}

describe("Notebox inbox: the signal store's triage fields, the MCP door, and generic file attachments", () => {
  it("A. creates with project/status/priority/capturedFrom, updates them, and persists them in the store file", async () => {
    const rig = rigFor("A");
    try {
      const project = await makeProject(rig.root, "Desk rebuild");
      const capturedFrom = "Chrome — AI tab group";

      // ── create: the fields come back on the returned record ─────────────
      const created = await createOk(rig.root, {
        type: "idea",
        body: "Rebuild the desk from one slab of oak.",
        projectId: project.id,
        status: "acting",
        priority: "high",
        capturedFrom,
      });
      assert.equal(created.projectId, project.id, "projectId did not come back from the write");
      assert.equal(created.status, "acting", "status did not come back from the write");
      assert.equal(created.priority, "high", "priority did not come back from the write");
      assert.equal(created.capturedFrom, capturedFrom, "capturedFrom did not come back from the write");

      // ── the record lives where the store says it does ────────────────────
      assert.equal(
        path.relative(rig.root, recordFile(rig.root, created.id)),
        path.join(".lifequest", "signal-chain", `${created.id}.json`),
        "the capture is not stored at .lifequest/signal-chain/<id>.json",
      );

      // ── the write reached disk: the file itself carries the fields ───────
      const createdOnDisk = readRecordFile(rig.root, created.id);
      assert.equal(createdOnDisk.projectId, project.id, "the record file does not carry projectId");
      assert.equal(createdOnDisk.status, "acting", "the record file does not carry status");
      assert.equal(createdOnDisk.priority, "high", "the record file does not carry priority");
      assert.equal(createdOnDisk.capturedFrom, capturedFrom, "the record file does not carry capturedFrom");

      // ── read: a fresh parse of the store file carries the same values ────
      const listed = await listedRecords(rig.root);
      assert.equal(listed.skipped, 0, "the store skipped a record it wrote itself");
      assert.equal(listed.records.length, 1);
      const readBack = recordOf(listed.records, created.id);
      assert.equal(readBack.projectId, project.id, "listSignals lost projectId after the round trip");
      assert.equal(readBack.status, "acting", "listSignals lost status after the round trip");
      assert.equal(readBack.priority, "high", "listSignals lost priority after the round trip");
      assert.equal(readBack.capturedFrom, capturedFrom, "listSignals lost capturedFrom after the round trip");
      assert.equal(
        fs.existsSync(recordFile(rig.root, created.id)),
        true,
        `no record written at .lifequest/signal-chain/${created.id}.json`,
      );

      // ── update: status, priority and clearing the project ───────────────
      const updated = await updateOk(rig.root, created.id, {
        status: "done",
        priority: "low",
        projectId: null,
      });
      assert.equal(updated.id, created.id, "the update changed the id");
      assert.equal(updated.status, "done", "the update did not apply status");
      assert.equal(updated.priority, "low", "the update did not apply priority");
      assert.equal(updated.projectId, null, "the update did not clear projectId");
      assert.equal(
        updated.capturedFrom,
        capturedFrom,
        "an update that did not mention capturedFrom dropped it",
      );

      const onDisk = readRecordFile(rig.root, created.id);
      assert.equal(onDisk.status, "done", "the record file does not carry the updated status");
      assert.equal(onDisk.priority, "low", "the record file does not carry the updated priority");
      assert.equal(onDisk.projectId, null, "the record file still names the cleared project");
      assert.equal(
        onDisk.capturedFrom,
        capturedFrom,
        "the record file lost capturedFrom on an unrelated update",
      );

      const reread = recordOf((await listedRecords(rig.root)).records, created.id);
      assert.equal(reread.status, "done", "listSignals lost the updated status");
      assert.equal(reread.priority, "low", "listSignals lost the updated priority");
      assert.equal(reread.projectId, null, "listSignals still shows the cleared project");

      // ── default: a capture that says nothing about triage lands in inbox ─
      const bare = await createOk(rig.root, {
        type: "thought",
        body: "A thought with no triage fields.",
      });
      assert.equal(bare.status, "inbox", "a bare capture did not land in the inbox");
      assert.equal(bare.projectId, null, "a bare capture was filed under some project");
      assert.equal(bare.priority, null, "a bare capture was given a priority");
      assert.equal(bare.capturedFrom, null, "a bare capture was given an origin");
      const bareListed = recordOf((await listedRecords(rig.root)).records, bare.id);
      assert.equal(bareListed.status, "inbox", "a bare capture does not read back as inbox");
      assert.equal(bareListed.projectId, null);
      assert.equal(bareListed.priority, null);
      assert.equal(bareListed.capturedFrom, null);
    } finally {
      closeRig(rig);
    }
  });

  it("B. reads a record written before the inbox as status inbox with project, priority and origin unset", async () => {
    const rig = rigFor("B");
    try {
      const chainDir = vaultPaths(rig.root).signalChainDir;
      fs.mkdirSync(chainDir, { recursive: true });

      // The exact old shape: none of the four new keys exist on disk.
      const legacyId = "00000000-0000-4000-8000-0000000000b1";
      const legacy = {
        id: legacyId,
        createdAt: "2025-12-01T09:00:00.000Z",
        updatedAt: "2025-12-01T09:00:00.000Z",
        deletedAt: null,
        type: "thought",
        source: "manual",
        sourceRef: null,
        title: null,
        body: "A capture from before the inbox existed.",
        domainSlug: null,
        attachment: null,
      };
      fs.writeFileSync(
        path.join(chainDir, `${legacyId}.json`),
        `${JSON.stringify(legacy, null, 2)}\n`,
      );

      const listed = await listedRecords(rig.root);
      assert.equal(listed.skipped, 0, "an old-shape record was skipped as malformed");
      assert.equal(listed.records.length, 1);
      const readBack = recordOf(listed.records, legacyId);
      assert.equal(readBack.body, legacy.body, "the old record's body was not read back");
      assert.equal(readBack.status, "inbox", "an absent status does not read as inbox");
      assert.equal(readBack.projectId, null, "an absent projectId does not read as null");
      assert.equal(readBack.priority, null, "an absent priority does not read as null");
      assert.equal(readBack.capturedFrom, null, "an absent capturedFrom does not read as null");
    } finally {
      closeRig(rig);
    }
  });

  it("C. the MCP door creates, updates, filters and reads the triage fields", async () => {
    const rig = rigFor("C");
    try {
      const desk = await makeProject(rig.root, "Desk rebuild");
      const shed = await makeProject(rig.root, "Shed wiring");

      // ── the door advertises what this test relies on ────────────────────
      assert.equal(SIGNAL_TOOL_DEFS.length > 0, true, "SIGNAL_TOOL_DEFS is empty");
      const names = SIGNAL_TOOL_DEFS.map((definition) => definition.name);
      for (const name of ["list_signals", "get_signal", "create_signal", "update_signal"]) {
        assert.ok(names.includes(name), `the MCP door does not advertise ${name}`);
      }
      const propertiesOf = (name: string) =>
        SIGNAL_TOOL_DEFS.find((definition) => definition.name === name)!.parameters
          .properties;
      for (const field of ["projectId", "status", "priority", "capturedFrom"]) {
        assert.ok(
          Object.hasOwn(propertiesOf("create_signal"), field),
          `create_signal does not accept ${field}`,
        );
      }
      const updateDef = SIGNAL_TOOL_DEFS.find((definition) => definition.name === "update_signal")!;
      for (const field of ["id", "domainSlug", "projectId", "status", "priority", "title", "body"]) {
        assert.ok(
          Object.hasOwn(updateDef.parameters.properties, field),
          `update_signal does not accept ${field}`,
        );
      }
      assert.deepEqual(
        updateDef.parameters.required ?? [],
        ["id"],
        "update_signal's only required argument must be id",
      );

      // ── create through the door keeps every field ───────────────────────
      const capturedFrom = "Notion — Action Items";
      const created = await toolOk(rig.root, "create_signal", {
        type: "notice",
        body: "The oak slab is ready for pickup.",
        projectId: desk.id,
        status: "triaged",
        priority: "normal",
        capturedFrom,
      });
      assert.ok(created.signal, "create_signal returned no { signal }");
      const signal = created.signal as Record<string, unknown>;
      assert.equal(signal.projectId, desk.id, "create_signal lost projectId");
      assert.equal(signal.status, "triaged", "create_signal lost status");
      assert.equal(signal.priority, "normal", "create_signal lost priority");
      assert.equal(signal.capturedFrom, capturedFrom, "create_signal lost capturedFrom");

      // A second capture, so the filters below are proven by exclusion rather
      // than by every record matching.
      const other = (await toolOk(rig.root, "create_signal", {
        type: "idea",
        body: "A second capture filed elsewhere.",
        projectId: shed.id,
        status: "done",
        priority: "low",
      })).signal as Record<string, unknown>;
      assert.ok(other.id, "the second create_signal returned no id");

      // ── update by id changes the existing record, nothing else ──────────
      const updated = (await toolOk(rig.root, "update_signal", {
        id: signal.id,
        status: "acting",
        priority: "high",
      })).signal as Record<string, unknown>;
      assert.equal(updated.id, signal.id, "update_signal changed the id");
      assert.equal(updated.status, "acting", "update_signal did not apply status");
      assert.equal(updated.priority, "high", "update_signal did not apply priority");
      assert.equal(updated.projectId, desk.id, "an update that did not mention the project dropped it");
      assert.equal(
        updated.capturedFrom,
        capturedFrom,
        "an update that did not mention capturedFrom dropped it",
      );

      const all = await listedRecords(rig.root);
      assert.equal(all.records.length, 2, "update_signal wrote a new record instead of changing the existing one");
      assert.equal(recordOf(all.records, String(signal.id)).status, "acting", "the store did not keep the update");

      // ── list_signals filters by status and projectId ────────────────────
      const acting = await toolOk(rig.root, "list_signals", { status: "acting" });
      assert.deepEqual(
        (acting.signals as { id: string }[]).map((row) => row.id),
        [signal.id],
        "the status filter returned more than the acting capture",
      );
      assert.equal(acting.total, 1, "the status filter's total is wrong");

      const deskOnly = await toolOk(rig.root, "list_signals", { projectId: desk.id });
      assert.deepEqual(
        (deskOnly.signals as { id: string }[]).map((row) => row.id),
        [signal.id],
        "the project filter returned the capture filed under the other project",
      );

      const done = await toolOk(rig.root, "list_signals", { status: "done" });
      assert.deepEqual(
        (done.signals as { id: string }[]).map((row) => row.id),
        [other.id],
        "the done filter did not exclude the acting capture",
      );

      const none = await toolOk(rig.root, "list_signals", { status: "dropped" });
      assert.deepEqual(none.signals, [], "a filter that matches nothing returned rows");
      assert.equal(none.total, 0, "a filter that matches nothing reported a total");

      // ── get_signal shows the fields ─────────────────────────────────────
      const got = (await toolOk(rig.root, "get_signal", { id: signal.id })).signal as Record<
        string,
        unknown
      >;
      assert.equal(got.status, "acting", "get_signal did not show status");
      assert.equal(got.priority, "high", "get_signal did not show priority");
      assert.equal(got.projectId, desk.id, "get_signal did not show projectId");
      assert.equal(got.capturedFrom, capturedFrom, "get_signal did not show capturedFrom");

      // ── a door capture with no triage fields lands in the inbox ─────────
      const bare = (await toolOk(rig.root, "create_signal", {
        type: "thought",
        body: "Captured with no triage yet.",
      })).signal as Record<string, unknown>;
      assert.equal(bare.status, "inbox", "a door capture with no status did not land in the inbox");
      assert.equal(bare.projectId, null, "a door capture with no project was filed somewhere");
      assert.equal(bare.priority, null, "a door capture with no priority was given one");
      assert.equal(bare.capturedFrom, null, "a door capture with no origin was given one");
      const inbox = await toolOk(rig.root, "list_signals", { status: "inbox" });
      assert.deepEqual(
        (inbox.signals as { id: string }[]).map((row) => row.id),
        [bare.id],
        "list_signals { status: 'inbox' } did not return the untriaged capture",
      );
    } finally {
      closeRig(rig);
    }
  });

  it("D. refuses an unknown project, and a status or priority outside the set, by name and writes nothing", async () => {
    const rig = rigFor("D");
    try {
      const project = await makeProject(rig.root, "Desk rebuild");
      const base = await createOk(rig.root, {
        type: "thought",
        body: "A capture that must stay exactly put.",
        projectId: project.id,
        status: "inbox",
        priority: "normal",
        capturedFrom: "Chrome — AI tab group",
      });
      const unknownProjectId = "8f0d6c1a-0000-4000-8000-00000000dead";
      const before = await chainCounts(rig.root);

      // (1) an unknown project: refused by the id it was handed, nothing written.
      const badProject = await createSignal(rig.root, {
        type: "idea",
        body: "Filed under a project that does not exist.",
        projectId: unknownProjectId,
      });
      assert.equal(badProject.ok, false, "a capture was filed under a project that does not exist");
      if (!badProject.ok) {
        assert.match(badProject.error, /project/i, `the refusal does not name the project: ${JSON.stringify(badProject.error)}`);
        assert.ok(badProject.error.includes(unknownProjectId), `the refusal does not name the offending id: ${JSON.stringify(badProject.error)}`);
      }
      assert.deepEqual(await chainCounts(rig.root), before, "a refused create with an unknown project wrote a record");

      // (2) a status outside the five: refused by the value or the allowed set.
      const badStatus = await updateSignal(rig.root, base.id, { status: "archived" });
      assert.equal(badStatus.ok, false, "a status outside the five was stored");
      if (!badStatus.ok) assertNamesRefusal(badStatus.error, "status", "archived", SIGNAL_STATUSES);
      assert.deepEqual(await chainCounts(rig.root), before, "a refused update with a bad status wrote a record");

      // (3) a priority outside the three: likewise.
      const badPriority = await createSignal(rig.root, {
        type: "idea",
        body: "Urgent-ish, but not a priority this store has.",
        priority: "urgent",
      });
      assert.equal(badPriority.ok, false, "a priority outside the three was stored");
      if (!badPriority.ok) assertNamesRefusal(badPriority.error, "priority", "urgent", SIGNAL_PRIORITIES);
      assert.deepEqual(await chainCounts(rig.root), before, "a refused create with a bad priority wrote a record");

      // The MCP door refuses the same three, in the model's vocabulary, and
      // writes nothing either: the door is a second writer, not a bypass.
      const doorBadProject = await executeSignalTool(rig.root, USER_ACTOR, "create_signal", {
        type: "idea",
        body: "Filed under a project that does not exist, through the door.",
        projectId: unknownProjectId,
      });
      const projectMessage = toolRefusalMessage(doorBadProject);
      assert.match(projectMessage, /project/i, `the door's refusal does not name the project: ${JSON.stringify(projectMessage)}`);
      assert.ok(projectMessage.includes(unknownProjectId), `the door's refusal does not name the offending id: ${JSON.stringify(projectMessage)}`);
      assert.deepEqual(await chainCounts(rig.root), before, "a refused create_signal with an unknown project wrote a record");

      const doorBadStatus = await executeSignalTool(rig.root, USER_ACTOR, "update_signal", {
        id: base.id,
        status: "archived",
      });
      const statusMessage = toolRefusalMessage(doorBadStatus);
      assertNamesRefusal(statusMessage, "status", "archived", SIGNAL_STATUSES);
      assert.deepEqual(await chainCounts(rig.root), before, "a refused update_signal with a bad status wrote a record");

      const doorBadPriority = await executeSignalTool(rig.root, USER_ACTOR, "create_signal", {
        type: "idea",
        body: "Urgent-ish, but not a priority this store has, through the door.",
        priority: "urgent",
      });
      const priorityMessage = toolRefusalMessage(doorBadPriority);
      assertNamesRefusal(priorityMessage, "priority", "urgent", SIGNAL_PRIORITIES);
      assert.deepEqual(await chainCounts(rig.root), before, "a refused create_signal with a bad priority wrote a record");

      // Nothing above rewrote the record that already existed.
      assert.equal(chainFiles(rig.root).length, before.files, "a refusal added a chain file");
      const unchanged = recordOf((await listedRecords(rig.root)).records, base.id);
      assert.equal(unchanged.status, "inbox", "a refused write changed the stored status");
      assert.equal(unchanged.priority, "normal", "a refused write changed the stored priority");
    } finally {
      closeRig(rig);
    }
  });

  it("E. a refused update leaves the stored record byte-for-byte untouched", async () => {
    const rig = rigFor("E");
    try {
      const project = await makeProject(rig.root, "Desk rebuild");
      const created = await createOk(rig.root, {
        type: "idea",
        body: "Keep this exactly as written.",
        projectId: project.id,
        status: "triaged",
        priority: "normal",
        capturedFrom: "Notion — Action Items",
      });
      const file = recordFile(rig.root, created.id);
      const beforeBytes = fs.readFileSync(file, "utf8");
      const beforeRecord = recordOf((await listedRecords(rig.root)).records, created.id);
      const beforeCounts = await chainCounts(rig.root);
      const unknownProjectId = "00000000-0000-4000-8000-0000000000ee";

      // Engine refusals and door refusals in one run, then one re-read.
      const refusals: unknown[] = [
        await updateSignal(rig.root, created.id, { status: "inboxed" }),
        await updateSignal(rig.root, created.id, { priority: "critical" }),
        await updateSignal(rig.root, created.id, { projectId: unknownProjectId }),
        await executeSignalTool(rig.root, USER_ACTOR, "update_signal", {
          id: created.id,
          status: "inboxed",
        }),
        await executeSignalTool(rig.root, USER_ACTOR, "update_signal", {
          id: created.id,
          priority: "critical",
        }),
        await executeSignalTool(rig.root, USER_ACTOR, "update_signal", {
          id: created.id,
          projectId: unknownProjectId,
        }),
      ];
      for (const refusal of refusals) {
        const result = refusal as { ok?: boolean; error?: unknown };
        if (result.ok !== undefined) {
          assert.equal(result.ok, false, `a refused engine update was accepted: ${JSON.stringify(result)}`);
          assert.equal(typeof result.error, "string", "an engine refusal carries no error text");
        } else {
          const message = toolRefusalMessage(refusal as { error: unknown });
          assert.ok(message.length > 0);
        }
      }

      assert.equal(
        fs.readFileSync(file, "utf8"),
        beforeBytes,
        "a refused update rewrote the record file",
      );
      const afterRecord = recordOf((await listedRecords(rig.root)).records, created.id);
      assert.deepEqual(afterRecord, beforeRecord, "a refused update changed the stored record");
      assert.deepEqual(await chainCounts(rig.root), beforeCounts, "a refused update changed the chain");
    } finally {
      closeRig(rig);
    }
  });

  it("F. keeps a generic file attachment: bytes on disk, list and update keep it, readSignalFile returns it", async () => {
    const rig = rigFor("F");
    try {
      // Fail by name (not at module load) while the generic-file writer lands.
      requireFileRead();
      const bytes = new Uint8Array(
        Buffer.from(
          "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF\n",
          "utf8",
        ),
      );

      // body is empty: a file attachment is the whole capture, like an image.
      const created = await createOk(rig.root, {
        type: "idea",
        body: "",
        attachment: { kind: "file", bytes, name: "brief.pdf", mime: "application/pdf" },
      });
      const attachment = created.attachment as {
        kind: string;
        relPath: string;
        name: string;
        mime: string;
        size: number;
      };
      assert.ok(attachment, "the file attachment was dropped from the returned record");
      assert.equal(attachment.kind, "file", "the attachment came back as the wrong kind");
      assert.equal(attachment.name, "brief.pdf", "the stored name is not the uploaded name");
      assert.equal(attachment.mime, "application/pdf", "the stored mime is not the uploaded mime");
      assert.equal(attachment.size, bytes.byteLength, "the stored size is not the uploaded byte length");
      assert.match(
        attachment.relPath,
        /^\.lifequest\/signal-chain\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
        `the stored path is not the minted signal-chain file path: ${attachment.relPath}`,
      );

      // The bytes are really in the vault, at the path the record names.
      const diskPath = path.join(rig.root, ...attachment.relPath.split("/"));
      assert.equal(fs.existsSync(diskPath), true, `no bytes were stored at ${attachment.relPath}`);
      assertBytesEqual(fs.readFileSync(diskPath), bytes, "the bytes on disk differ from the uploaded file");

      // The record FILE itself carries the attachment, not only the return value.
      const onDiskAttachment = readRecordFile(rig.root, created.id).attachment as Record<string, unknown>;
      assert.equal(onDiskAttachment.kind, "file", "the record file does not carry a file attachment");
      assert.equal(onDiskAttachment.size, bytes.byteLength, "the record file's size is not the byte length");
      assert.equal(onDiskAttachment.mime, "application/pdf", "the record file's mime is not the uploaded mime");

      // A fresh parse of the store keeps the same attachment.
      assert.deepEqual(
        recordOf((await listedRecords(rig.root)).records, created.id).attachment,
        created.attachment,
        "listSignals lost or changed the file attachment",
      );

      // An update that does not mention the attachment keeps it.
      const updated = await updateOk(rig.root, created.id, { title: "Brief for the desk rebuild" });
      assert.deepEqual(updated.attachment, created.attachment, "a title update dropped the file attachment");
      assert.deepEqual(
        recordOf((await listedRecords(rig.root)).records, created.id).attachment,
        created.attachment,
        "the store lost the file attachment after an update",
      );

      // The guarded read path returns the same bytes for the minted relPath.
      const readBack = await readFileOk(rig.root, attachment.relPath);
      assertBytesEqual(readBack.bytes, bytes, "readSignalFile returned different bytes");
      assert.equal(typeof readBack.mime, "string", "readSignalFile returned no mime");
      assert.ok(readBack.mime.length > 0, "readSignalFile returned an empty mime");

      // A path the store did not mint is refused by name, never reparsed.
      const foreign = await requireFileRead()(rig.root, "../../../etc/passwd");
      assert.equal(foreign.ok, false, "readSignalFile read a path outside the signal-chain files dir");
      if (!foreign.ok) {
        assert.match(
          foreign.error,
          /invalid|path|file/i,
          `the foreign-path refusal does not name the path: ${JSON.stringify(foreign.error)}`,
        );
      }

      // A minted-SHAPE path with no file behind it reports the file is missing,
      // not an empty read.
      const missing = await requireFileRead()(
        rig.root,
        ".lifequest/signal-chain/files/00000000-0000-4000-8000-0000000000ff.pdf",
      );
      assert.equal(missing.ok, false, "readSignalFile invented bytes for a missing file");
      if (!missing.ok) {
        assert.match(
          missing.error,
          /missing/i,
          `the missing-file refusal does not say the file is missing: ${JSON.stringify(missing.error)}`,
        );
      }
    } finally {
      closeRig(rig);
    }
  });

  it("G. a name with no extension stores with no extension in relPath and reads back", async () => {
    const rig = rigFor("G");
    try {
      requireFileRead();
      const bytes = new Uint8Array(Buffer.from("notes with no extension", "utf8"));

      // The renderer sends `mime: file.type || ""`, so an empty mime is normal
      // for an unknown type; the store must fall back, not write "".
      const created = await createOk(rig.root, {
        type: "other",
        body: "",
        attachment: { kind: "file", bytes, name: "notes", mime: "" },
      });
      const attachment = created.attachment as {
        kind: string;
        relPath: string;
        name: string;
        mime: string;
        size: number;
      };
      assert.ok(attachment, "the extensionless file attachment was dropped");
      assert.equal(attachment.kind, "file");
      assert.equal(attachment.name, "notes");
      assert.equal(
        attachment.mime,
        "application/octet-stream",
        "an empty mime did not fall back to application/octet-stream",
      );
      assert.match(
        attachment.relPath,
        /^\.lifequest\/signal-chain\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        `an extensionless name did not store as the bare uuid: ${attachment.relPath}`,
      );

      const diskPath = path.join(rig.root, ...attachment.relPath.split("/"));
      assert.equal(fs.existsSync(diskPath), true, `no extensionless bytes were stored at ${attachment.relPath}`);
      assertBytesEqual(fs.readFileSync(diskPath), bytes, "the extensionless bytes on disk differ");
      const readBack = await readFileOk(rig.root, attachment.relPath);
      assertBytesEqual(readBack.bytes, bytes, "readSignalFile did not read the extensionless file back");
    } finally {
      closeRig(rig);
    }
  });

  it("H. refuses an empty file and a file over the 25 MB ceiling, writing nothing", async () => {
    const rig = rigFor("H");
    try {
      const max = requireFileMax();
      assert.equal(
        max,
        25 * 1024 * 1024,
        "SIGNAL_FILE_MAX_BYTES is not the 25 MB ceiling in the contract",
      );

      // A stored file first, so "unchanged" is a non-zero count.
      await createOk(rig.root, {
        type: "idea",
        body: "",
        attachment: {
          kind: "file",
          bytes: new Uint8Array([1, 2, 3]),
          name: "keep.bin",
          mime: "application/octet-stream",
        },
      });
      const before = await storeCounts(rig.root);
      assert.equal(before.records, 1, "the baseline capture is not listed");
      assert.equal(before.files, 1, "the baseline file is not in the files directory");

      const empty = await createSignal(rig.root, {
        type: "idea",
        body: "",
        attachment: { kind: "file", bytes: new Uint8Array(0), name: "empty.pdf", mime: "application/pdf" },
      });
      assert.equal(empty.ok, false, "an empty file was stored");
      if (!empty.ok) {
        assert.match(empty.error, /empty/i, `the refusal does not name an empty file: ${JSON.stringify(empty.error)}`);
      }
      assert.deepEqual(await storeCounts(rig.root), before, "a refused empty file wrote a record or a stored file");

      // 25 MB + 1 byte. The size check runs before the bytes are copied, so the
      // zero-filled array is never touched; one 25 MB allocation stays cheap.
      const oversized = await createSignal(rig.root, {
        type: "idea",
        body: "",
        attachment: {
          kind: "file",
          bytes: new Uint8Array(max + 1),
          name: "huge.bin",
          mime: "application/octet-stream",
        },
      });
      assert.equal(oversized.ok, false, "a file over the 25 MB ceiling was stored");
      if (!oversized.ok) {
        assert.match(
          oversized.error,
          /larger|too (big|large)|exceed|25/i,
          `the refusal does not name the ceiling: ${JSON.stringify(oversized.error)}`,
        );
      }
      assert.deepEqual(await storeCounts(rig.root), before, "a refused oversized file wrote a record or a stored file");
    } finally {
      closeRig(rig);
    }
  });

  it("I. refuses active content by name, writing nothing", async () => {
    const rig = rigFor("I");
    try {
      // Baseline: one stored file, so the counts below can only be unchanged if
      // the refusals wrote nothing at all.
      await createOk(rig.root, {
        type: "idea",
        body: "",
        attachment: { kind: "file", bytes: new Uint8Array([7, 7, 7]), name: "keep.txt", mime: "text/plain" },
      });
      const before = await storeCounts(rig.root);

      // Both triggers matter independently: a forbidden extension under an
      // innocent mime, and a forbidden mime behind an innocent name.
      const active = [
        { name: "page.html", mime: "text/plain", why: "forbidden extension with an innocent mime" },
        { name: "icon.svg", mime: "image/svg+xml", why: "the active SVG type" },
        { name: "harmless.txt", mime: "text/html", why: "forbidden mime behind an innocent name" },
      ];
      for (const candidate of active) {
        const refused = await createSignal(rig.root, {
          type: "idea",
          body: "",
          attachment: {
            kind: "file",
            bytes: new Uint8Array(Buffer.from("<script>alert(1)</script>", "utf8")),
            name: candidate.name,
            mime: candidate.mime,
          },
        });
        assert.equal(refused.ok, false, `active content was stored: ${candidate.name} (${candidate.why})`);
        if (!refused.ok) {
          assert.match(
            refused.error,
            /file type|cannot be kept|not allowed|refus|unsupported/i,
            `the refusal does not say the file type is refused: ${JSON.stringify(refused.error)}`,
          );
        }
        assert.deepEqual(await storeCounts(rig.root), before, `a refused active file wrote something: ${candidate.name}`);
      }
    } finally {
      closeRig(rig);
    }
  });
});
