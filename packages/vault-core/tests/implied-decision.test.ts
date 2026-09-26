import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { getDocument, saveDocument } from "../src/domain-documents.ts";
import { listDecisions, resolveDecision } from "../src/decisions.ts";
import { loadGoals } from "../src/goals.ts";
import { loadMapState } from "../src/map/persist.ts";
import { libraryList } from "../src/library-documents.ts";
import {
  COMPANION_ACTOR,
  fileImpliedChange,
  shouldFileImpliedTurn,
} from "../src/implied-decision.ts";

function fence(body: unknown): string {
  return [
    "Here is what I would change.",
    "```lifequest-decision",
    JSON.stringify(body),
    "```",
    "Prose after the fence is not a change.",
  ].join("\n");
}

async function pendingCount(root: string): Promise<number> {
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
  if (!listed.ok) return -1;
  return listed.value.filter((d) => d.status === "pending").length;
}

async function goalNames(root: string): Promise<string[]> {
  const loaded = await loadGoals(root);
  assert.equal(loaded.ok, true, loaded.ok ? "" : loaded.error);
  if (!loaded.ok) return [];
  return loaded.value.map((g) => g.name);
}

async function dayTypeNames(root: string): Promise<string[]> {
  const state = await loadMapState(root);
  assert.equal(state.ok, true, state.ok ? "" : state.error);
  if (!state.ok) return [];
  return state.value.dayTypes.map((d) => d.name);
}

describe("implied decisions from a companion turn", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-implied-decision-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "Implied")).ok, true);
    const seeded = await saveDocument(
      root,
      "health",
      "why",
      "original purpose",
      "Purpose",
      { type: "user", id: "u1", name: "Operator" },
    );
    assert.equal(seeded.ok, true, seeded.ok ? "" : seeded.error);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("a doctrine fence files one pending Decision and leaves the document alone", async () => {
    const before = await pendingCount(root);
    const turn = fence({
      kind: "doctrine",
      domainSlug: "health",
      documentKind: "why",
      title: "Purpose",
      body: "new purpose",
    });
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: turn,
      completedToolNames: ["get_state"],
    });
    assert.equal(verdict.reason, "ok");
    assert.ok(verdict.change);
    if (!verdict.change) return;

    const filed = await fileImpliedChange(root, verdict.change, COMPANION_ACTOR);
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok) return;
    assert.equal(filed.value.status, "pending", "filing never approves");
    assert.equal(filed.value.target.type, "doctrine");
    assert.equal(filed.value.proposedBodyMarkdown, "new purpose");
    assert.equal(filed.value.previousBodyMarkdown?.trim(), "original purpose");
    assert.equal(filed.value.previousTitle, "Purpose");
    assert.deepEqual(filed.value.actor, COMPANION_ACTOR);
    assert.equal(await pendingCount(root), before + 1, "exactly one Decision per turn");

    const doc = await getDocument(root, "health", "why");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.bodyMarkdown.trim(), "original purpose", "file not written before approve");

    // Approve still goes through the KAR-5 resolve path.
    const approved = await resolveDecision(root, filed.value.id, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    const after = await getDocument(root, "health", "why");
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.bodyMarkdown.trim(), "new purpose", "approve still writes");
  });

  it("fileUnsolicited false returns disabled and files nothing", async () => {
    const before = await pendingCount(root);
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: false,
      assistantText: fence({
        kind: "doctrine",
        domainSlug: "health",
        documentKind: "what",
        body: "quietly changed",
      }),
      completedToolNames: [],
    });
    assert.equal(verdict.reason, "disabled");
    assert.equal(verdict.change, null);
    assert.equal(await pendingCount(root), before);
  });

  it("a fence after a completed write tool returns write-tool", async () => {
    const before = await pendingCount(root);
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: fence({
        kind: "doctrine",
        domainSlug: "health",
        documentKind: "how",
        body: "second write",
      }),
      completedToolNames: ["get_state", "update_document"],
    });
    assert.equal(verdict.reason, "write-tool");
    assert.equal(verdict.change, null);
    assert.equal(await pendingCount(root), before);
  });

  it("a read tool with no fence files nothing", async () => {
    const before = await pendingCount(root);
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: "Your health doctrine says the original purpose.",
      completedToolNames: ["get_document", "list_goals", "get_state"],
    });
    assert.equal(verdict.reason, "none");
    assert.equal(verdict.change, null);
    assert.equal(await pendingCount(root), before);
  });

  it("a project fence files nothing", async () => {
    const before = await pendingCount(root);
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: fence({ kind: "project", title: "Later", body: "later" }),
      completedToolNames: [],
    });
    assert.equal(verdict.reason, "project");
    assert.equal(verdict.change, null);
    assert.equal(await pendingCount(root), before);
  });

  it("a goal fence leaves goals.json unchanged until the test approves", async () => {
    const before = await pendingCount(root);
    const names = await goalNames(root);
    const command = {
      type: "createGoal",
      name: "Implied goal",
      domainSlug: "health",
    };
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: fence({ kind: "goal", command }),
      completedToolNames: [],
    });
    assert.equal(verdict.reason, "ok");
    assert.ok(verdict.change);
    if (!verdict.change) return;

    const filed = await fileImpliedChange(root, verdict.change, COMPANION_ACTOR);
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok) return;
    assert.equal(filed.value.target.type, "goal");
    assert.equal(filed.value.proposedBodyMarkdown, JSON.stringify(command));
    assert.deepEqual(filed.value.domainSlugs, ["health"]);
    assert.deepEqual(await goalNames(root), names, "goals.json unchanged before approve");
    assert.equal(await pendingCount(root), before + 1);

    const approved = await resolveDecision(root, filed.value.id, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    assert.ok((await goalNames(root)).includes("Implied goal"));
  });

  it("a day-template fence files a Decision; a createTask command files nothing", async () => {
    const templateVerdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: fence({
        kind: "day-template",
        command: { type: "createDayType", name: "Deep work", color: "teal" },
      }),
      completedToolNames: [],
    });
    assert.equal(templateVerdict.reason, "ok");
    assert.ok(templateVerdict.change);
    if (!templateVerdict.change) return;
    const names = await dayTypeNames(root);
    const filed = await fileImpliedChange(root, templateVerdict.change, COMPANION_ACTOR);
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok) return;
    assert.equal(filed.value.target.type, "day-template");
    assert.deepEqual(await dayTypeNames(root), names, "dayTypes unchanged before approve");
    const approved = await resolveDecision(root, filed.value.id, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    assert.ok((await dayTypeNames(root)).includes("Deep work"));

    const before = await pendingCount(root);
    const notTemplate = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: fence({
        kind: "day-template",
        command: { type: "createTask", title: "not a template" },
      }),
      completedToolNames: [],
    });
    assert.equal(notTemplate.reason, "not-template");
    assert.equal(notTemplate.change, null);
    assert.equal(await pendingCount(root), before);
  });

  it("a library fence with no id is a create that writes no file", async () => {
    const before = await pendingCount(root);
    const notes = await libraryList(root);
    assert.equal(notes.ok, true);
    if (!notes.ok) return;
    const count = notes.value.records.length;
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: fence({
        kind: "library",
        title: "Implied note",
        body: "note body",
        domainSlugs: ["health"],
      }),
      completedToolNames: [],
    });
    assert.equal(verdict.reason, "ok");
    assert.ok(verdict.change);
    if (!verdict.change) return;
    const filed = await fileImpliedChange(root, verdict.change, COMPANION_ACTOR);
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok) return;
    assert.equal(filed.value.target.type, "library");
    assert.equal(filed.value.proposedTitle, "Implied note");
    assert.deepEqual(filed.value.domainSlugs, ["health"]);
    const after = await libraryList(root);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.records.length, count, "no library file before approve");
    assert.equal(await pendingCount(root), before + 1);
  });

  it("malformed fence JSON files nothing and does not throw", () => {
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: "```lifequest-decision\n{not json\n```",
      completedToolNames: [],
    });
    assert.equal(verdict.reason, "malformed");
    assert.equal(verdict.change, null);
  });

  it("the last valid fence wins", () => {
    const text = [
      fence({ kind: "doctrine", domainSlug: "health", documentKind: "why", body: "first" }),
      fence({ kind: "doctrine", domainSlug: "health", documentKind: "what", body: "second" }),
    ].join("\n\n");
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: text,
      completedToolNames: [],
    });
    assert.equal(verdict.reason, "ok");
    assert.ok(verdict.change);
    if (!verdict.change) return;
    assert.equal(verdict.change.kind, "doctrine");
    assert.equal(
      verdict.change.kind === "doctrine" ? verdict.change.documentKind : null,
      "what",
    );
  });

  it("a fence with a different info string is prose", () => {
    const verdict = shouldFileImpliedTurn({
      fileUnsolicited: true,
      assistantText: '```json\n{"kind":"doctrine"}\n```',
      completedToolNames: [],
    });
    assert.equal(verdict.reason, "none");
    assert.equal(verdict.change, null);
  });
});
