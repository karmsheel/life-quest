import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { setDocumentLocked, getDocument, saveDocument } from "../src/domain-documents.ts";
import { DOCUMENT_TOOL_DEFS, executeDocumentTool } from "../src/document-tools.ts";
import { listDecisions, resolveDecision } from "../src/decisions.ts";
import { libraryCreate, libraryGet, libraryList } from "../src/library-documents.ts";
import { USER_ACTOR } from "../src/types.ts";

const agent = { type: "agent" as const, id: "a1", name: "Hermes" };

describe("document tools", () => {
  let dir: string;
  let root: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-doc-tools-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "Tools")).ok, true);
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exports list_documents get_document create_library_document update_document and no lock tool", () => {
    const names = DOCUMENT_TOOL_DEFS.map((t) => t.name);
    assert.deepEqual(
      names.sort(),
      ["create_library_document", "get_document", "list_documents", "update_document"].sort(),
    );
    assert.equal(names.includes("lock_document"), false);
    assert.equal(names.includes("set_document_locked"), false);
  });

  it("agent create_library_document files a pending decision and writes no file", async () => {
    const created = await executeDocumentTool(root, agent, "create_library_document", {
      title: "From agent",
      body: "v1",
      domainSlugs: ["health"],
    });
    const pending = created as { decisionId?: string; status?: string; record?: unknown };
    assert.equal(pending.status, "pending");
    assert.ok(pending.decisionId, "agent create must return a decisionId");
    assert.equal(pending.record, undefined, "agent create must not write the note");
    const listed = await libraryList(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(
      listed.value.records.some((r) => r.title === "From agent"),
      false,
      "note must not exist before approve",
    );
    const approved = await resolveDecision(root, pending.decisionId!, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    const after = await libraryList(root);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    const note = after.value.records.find((r) => r.title === "From agent");
    assert.ok(note, "approve must create the note");
    assert.equal(note!.bodyMarkdown.trim(), "v1");
    assert.deepEqual(note!.domainSlugs, ["health"]);
    assert.equal(after.value.records.length, listed.value.records.length + 1);
  });

  it("agent create_library_document reject creates nothing", async () => {
    const created = await executeDocumentTool(root, agent, "create_library_document", {
      title: "Rejected agent note",
      body: "nope",
    });
    const pending = created as { decisionId?: string };
    assert.ok(pending.decisionId);
    const rejected = await resolveDecision(root, pending.decisionId!, "rejected");
    assert.equal(rejected.ok, true);
    const listed = await libraryList(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(
      listed.value.records.some((r) => r.title === "Rejected agent note"),
      false,
      "reject must not create the note",
    );
  });

  it("agent update_document on an unlocked library note leaves the body until approve", async () => {
    const seeded = await libraryCreate(root, { title: "Unlocked note", bodyMarkdown: "v1" });
    assert.equal(seeded.ok, true);
    if (!seeded.ok) return;
    const id = seeded.value.id;
    const updated = await executeDocumentTool(root, agent, "update_document", {
      id,
      body: "v2",
    });
    const pending = updated as { decisionId?: string; status?: string; record?: unknown };
    assert.equal(pending.status, "pending");
    assert.ok(pending.decisionId);
    assert.equal(pending.record, undefined, "agent update must not write the note");
    const before = await libraryGet(root, id);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    // serializeFrontmatter appends a trailing newline, so compare the canonical body.
    assert.equal(before.value.bodyMarkdown.includes("v2"), false, "body unchanged until approve");
    const approved = await resolveDecision(root, pending.decisionId!, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    const after = await libraryGet(root, id);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.bodyMarkdown.trim(), "v2");
  });

  it("user create_library_document then update unlocked writes", async () => {
    const created = await executeDocumentTool(root, USER_ACTOR, "create_library_document", {
      title: "From user",
      body: "v1",
      domainSlugs: ["health"],
    });
    const rec = created as { record?: { id: string; locked: boolean } };
    assert.equal(rec.record?.locked, false);
    const updated = await executeDocumentTool(root, USER_ACTOR, "update_document", {
      id: rec.record!.id,
      body: "v2",
    });
    assert.equal((updated as { record?: { bodyMarkdown: string } }).record?.bodyMarkdown, "v2");
  });

  it("agent update_document on unlocked doctrine files a decision; approve writes, reject does not", async () => {
    assert.equal((await saveDocument(root, "health", "premise", "original premise")).ok, true);
    const doc = await getDocument(root, "health", "premise");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.locked, false, "precondition: premise is unlocked");
    // serializeFrontmatter appends a trailing newline; keep the canonical stored body.
    const originalBody = doc.value.bodyMarkdown;

    const proposed = await executeDocumentTool(root, agent, "update_document", {
      domainSlug: "health",
      kind: "premise",
      body: "agent premise proposal",
    });
    const pending = proposed as { decisionId?: string; status?: string; record?: unknown };
    assert.equal(pending.status, "pending");
    assert.ok(pending.decisionId);
    assert.equal(pending.record, undefined, "agent must not write the doctrine file");
    const unchanged = await getDocument(root, "health", "premise");
    assert.equal(unchanged.ok, true);
    if (!unchanged.ok) return;
    assert.equal(unchanged.value.bodyMarkdown, originalBody);

    const rejected = await resolveDecision(root, pending.decisionId!, "rejected");
    assert.equal(rejected.ok, true);
    const stillOld = await getDocument(root, "health", "premise");
    assert.equal(stillOld.ok, true);
    if (!stillOld.ok) return;
    assert.equal(stillOld.value.bodyMarkdown, originalBody, "reject must not write");

    const second = await executeDocumentTool(root, agent, "update_document", {
      domainSlug: "health",
      kind: "premise",
      body: "agent premise proposal",
    });
    const secondPending = second as { decisionId?: string };
    assert.ok(secondPending.decisionId);
    const approved = await resolveDecision(root, secondPending.decisionId!, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    const written = await getDocument(root, "health", "premise");
    assert.equal(written.ok, true);
    if (!written.ok) return;
    assert.equal(written.value.bodyMarkdown.trim(), "agent premise proposal");
    assert.equal(written.value.locked, false, "approve keeps the existing locked flag");
  });

  it("list_documents returns 4 doctrine items per live domain with correct domainSlug", async () => {
    // health is a seeded domain; all four kinds exist.
    const result = await executeDocumentTool(root, agent, "list_documents", {});
    assert.equal(result.error, undefined, "list_documents should succeed");
    const recs = (result as { records: unknown[] }).records;
    const healthDoctrine = recs.filter(
      (r) =>
        (r as Record<string, unknown>).type === "doctrine" &&
        String((r as Record<string, unknown>).domainSlug) === "health",
    );
    assert.equal(healthDoctrine.length, 4, "health should have 4 doctrine items");
    const kinds = healthDoctrine.map((r) => (r as Record<string, unknown>).kind).sort();
    assert.deepEqual(kinds, ["how", "premise", "what", "why"]);
    for (const r of healthDoctrine) {
      assert.equal(
        String((r as Record<string, unknown>).domainSlug),
        "health",
        "domainSlug must be the domain, not the kind",
      );
      assert.ok((r as Record<string, unknown>).title, "each doctrine item should have a title");
      assert.ok(
        typeof (r as Record<string, unknown>).locked === "boolean",
        "each doctrine item should carry locked",
      );
    }
  });

  it("update_document on locked doctrine creates a pending decision", async () => {
    assert.equal((await setDocumentLocked(root, "health", "why", true)).ok, true);
    const result = await executeDocumentTool(root, agent, "update_document", {
      domainSlug: "health",
      kind: "why",
      title: "Purpose",
      body: "agent proposal",
    });
    const pending = result as { decisionId?: string; status?: string };
    assert.equal(pending.status, "pending");
    assert.ok(pending.decisionId);
    const doc = await getDocument(root, "health", "why");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.bodyMarkdown.includes("agent proposal"), false);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.ok(listed.value.some((d) => d.id === pending.decisionId && d.actor.type === "agent"));
  });
});
