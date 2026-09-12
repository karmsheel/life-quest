import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { setDocumentLocked, getDocument } from "../src/domain-documents.ts";
import { DOCUMENT_TOOL_DEFS, executeDocumentTool } from "../src/document-tools.ts";
import { listDecisions } from "../src/decisions.ts";

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

  it("create_library_document then update unlocked writes", async () => {
    const created = await executeDocumentTool(root, agent, "create_library_document", {
      title: "From agent",
      body: "v1",
      domainSlugs: ["health"],
    });
    const rec = created as { record?: { id: string; locked: boolean } };
    assert.equal(rec.record?.locked, false);
    const updated = await executeDocumentTool(root, agent, "update_document", {
      id: rec.record!.id,
      body: "v2",
    });
    assert.equal((updated as { record?: { bodyMarkdown: string } }).record?.bodyMarkdown, "v2");
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
