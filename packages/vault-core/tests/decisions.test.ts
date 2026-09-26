import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { USER_ACTOR } from "../src/types.ts";
import { setDocumentLocked, getDocument, saveDocument } from "../src/domain-documents.ts";
import { libraryCreate, libraryGet, libraryList, setLibraryLocked } from "../src/library-documents.ts";
import { createDecision, listDecisions, resolveDecision } from "../src/decisions.ts";

const agent = { type: "agent" as const, id: "a1", name: "Hermes" };

describe("decisions", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-decisions-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "DecisionsTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("approve locked doctrine: body and title apply, locked stays true", async () => {
    assert.equal((await saveDocument(root, "health", "why", "original")).ok, true);
    assert.equal((await setDocumentLocked(root, "health", "why", true)).ok, true);
    const created = await createDecision(root, {
      target: { type: "doctrine", domainSlug: "health", kind: "why" },
      rationale: "Better framing",
      proposedTitle: "Purpose v2",
      previousTitle: "Purpose",
      proposedBodyMarkdown: "proposed why body from decision",
      previousBodyMarkdown: "original\n",
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.status, "pending");
    assert.equal(created.value.target.type, "doctrine");
    assert.equal(created.value.actor.type, "user");
    assert.match(created.value.title, /Purpose/);

    const resolved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(resolved.ok, true);
    const doc = await getDocument(root, "health", "why");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.locked, true);
    assert.equal(doc.value.title, "Purpose v2");
    assert.match(doc.value.bodyMarkdown, /proposed why body from decision/);
  });

  it("createDecision rejects unlocked documents", async () => {
    const created = await createDecision(root, {
      target: { type: "doctrine", domainSlug: "health", kind: "what" },
      proposedTitle: "Vision",
      proposedBodyMarkdown: "nope",
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, false);
    if (created.ok) return;
    assert.match(created.error, /locked/i);
  });

  it("createDecision rejects an unlocked library note for a user actor", async () => {
    const note = await libraryCreate(root, { title: "Unlocked user note", bodyMarkdown: "v1" });
    assert.equal(note.ok, true);
    if (!note.ok) return;
    const created = await createDecision(root, {
      target: { type: "library", id: note.value.id },
      proposedTitle: "Unlocked user note",
      proposedBodyMarkdown: "v2",
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, false, "a user actor must still hit the lock check");
    if (created.ok) return;
    assert.match(created.error, /locked/i);
  });

  it("createDecision rejects a library target with a missing file for a user actor", async () => {
    const created = await createDecision(root, {
      target: { type: "library", id: "00000000-0000-4000-8000-000000000000" },
      proposedTitle: "Ghost",
      proposedBodyMarkdown: "body",
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, false, "a user actor may not propose a brand new note");
    if (created.ok) return;
    assert.match(created.error, /not found|no such|not exist/i);
  });

  it("agent may propose against an unlocked doctrine document", async () => {
    const created = await createDecision(root, {
      target: { type: "doctrine", domainSlug: "health", kind: "how" },
      proposedTitle: "Strategy",
      proposedBodyMarkdown: "agent proposal on unlocked doctrine",
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    assert.equal(created.value.status, "pending");
  });

  it("agent may propose a library note whose file does not exist yet", async () => {
    const created = await createDecision(root, {
      target: { type: "library", id: "11111111-1111-4111-8111-111111111111" },
      proposedTitle: "Brand new note",
      proposedBodyMarkdown: "the body",
      domainSlugs: ["health"],
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    assert.deepEqual(created.value.domainSlugs, ["health"]);
    const listed = await libraryList(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(
      listed.value.records.some((r) => r.title === "Brand new note"),
      false,
      "no file is created at propose time",
    );
  });

  it("reject leaves library body unchanged; approve writes through lock", async () => {
    const note = await libraryCreate(root, { title: "Budget", bodyMarkdown: "keep" });
    assert.equal(note.ok, true);
    if (!note.ok) return;
    // Re-read to get the canonical stored body (serializeFrontmatter appends a trailing newline).
    const refreshed = await libraryGet(root, note.value.id);
    assert.equal(refreshed.ok, true);
    if (!refreshed.ok) return;
    const keepBody = refreshed.value.bodyMarkdown;
    assert.equal((await setLibraryLocked(root, note.value.id, true)).ok, true);
    const created = await createDecision(root, {
      target: { type: "library", id: note.value.id },
      proposedTitle: "Budget",
      previousTitle: "Budget",
      proposedBodyMarkdown: "should never land",
      previousBodyMarkdown: keepBody,
      actor: agent,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.actor.type, "agent");
    assert.equal((await resolveDecision(root, created.value.id, "rejected")).ok, true);
    const after = await libraryGet(root, note.value.id);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.bodyMarkdown, keepBody);
    assert.equal(after.value.locked, true);
  });

  it("approve writes library title and body through lock", async () => {
    const note = await libraryCreate(root, { title: "Budget", bodyMarkdown: "keep" });
    assert.equal(note.ok, true);
    if (!note.ok) return;
    const refreshed = await libraryGet(root, note.value.id);
    assert.equal(refreshed.ok, true);
    if (!refreshed.ok) return;
    const keepBody = refreshed.value.bodyMarkdown;
    assert.equal((await setLibraryLocked(root, note.value.id, true)).ok, true);
    const created = await createDecision(root, {
      target: { type: "library", id: note.value.id },
      proposedTitle: "Budget v2",
      previousTitle: "Budget",
      proposedBodyMarkdown: "approved new body",
      previousBodyMarkdown: keepBody,
      actor: agent,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.actor.type, "agent");
    const resolved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const after = await libraryGet(root, note.value.id);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.title, "Budget v2");
    assert.equal(after.value.bodyMarkdown, "approved new body\n");
    assert.equal(after.value.locked, true);
  });

  it("reads legacy decision JSON without target as doctrine", async () => {
    const { vaultPaths } = await import("../src/paths.ts");
    const paths = vaultPaths(root);
    await fs.mkdir(paths.decisionsDir, { recursive: true });
    const id = "legacy-decision-id";
    await fs.writeFile(
      paths.decisionJson(id),
      JSON.stringify({
        id,
        domainSlug: "health",
        documentKind: "how",
        status: "pending",
        title: "Old forge proposal",
        rationale: null,
        proposedBodyMarkdown: "legacy body",
        previousBodyMarkdown: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        resolvedAt: null,
      }) + "\n",
      "utf8",
    );
    assert.equal((await setDocumentLocked(root, "health", "how", true)).ok, true);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const legacy = listed.value.find((d) => d.id === id);
    assert.ok(legacy);
    assert.equal(legacy.target.type, "doctrine");
    if (legacy.target.type === "doctrine") {
      assert.equal(legacy.target.kind, "how");
      assert.equal(legacy.target.domainSlug, "health");
    }
    assert.equal(legacy.actor.type, "user");
    assert.equal(legacy.proposedTitle, null);
    const resolved = await resolveDecision(root, id, "approved");
    assert.equal(resolved.ok, true);
    const doc = await getDocument(root, "health", "how");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.match(doc.value.bodyMarkdown, /legacy body/);
    assert.equal(doc.value.title, "Strategy (How)");
  });

  it("reject leaves doctrine body unchanged", async () => {
    const saved = await saveDocument(root, "intellectual", "what", "keep this body");
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const beforeBody = saved.value.bodyMarkdown;
    assert.equal((await setDocumentLocked(root, "intellectual", "what", true)).ok, true);
    const created = await createDecision(root, {
      target: { type: "doctrine", domainSlug: "intellectual", kind: "what" },
      proposedTitle: "Bad proposal",
      proposedBodyMarkdown: "should never land",
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const rejected = await resolveDecision(root, created.value.id, "rejected");
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    const doc = await getDocument(root, "intellectual", "what");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.bodyMarkdown, beforeBody);
    assert.equal(doc.value.locked, true);
  });

  it("cannot resolve already-resolved decision", async () => {
    assert.equal((await saveDocument(root, "emotional", "how", "how body")).ok, true);
    assert.equal((await setDocumentLocked(root, "emotional", "how", true)).ok, true);
    const created = await createDecision(root, {
      target: { type: "doctrine", domainSlug: "emotional", kind: "how" },
      proposedTitle: "Double resolve",
      proposedBodyMarkdown: "x",
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const first = await resolveDecision(root, created.value.id, "rejected");
    assert.equal(first.ok, true);
    const second = await resolveDecision(root, created.value.id, "approved");
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.error, /already|resolved|pending/i);
  });

  it("createDecision rejects missing document", async () => {
    const created = await createDecision(root, {
      target: { type: "doctrine", domainSlug: "no-such-domain", kind: "why" },
      proposedTitle: "Missing",
      proposedBodyMarkdown: "x",
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, false);
    if (created.ok) return;
    assert.match(created.error, /not found/i);
  });
});
