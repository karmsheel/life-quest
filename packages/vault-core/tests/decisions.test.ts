import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { setDocumentStatus, getDocument, saveDocument } from "../src/domain-documents.ts";
import {
  createDecision,
  listDecisions,
  resolveDecision,
} from "../src/decisions.ts";
import { readLog } from "../src/log.ts";

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

  it("approve: forge why, createDecision, resolve approved → body equals proposed", async () => {
    // Seed body then forge health/why
    const seeded = await saveDocument(root, "health", "why", "original why body");
    assert.equal(seeded.ok, true);

    const refined = await setDocumentStatus(root, "health", "why", "refined");
    assert.equal(refined.ok, true);
    const forged = await setDocumentStatus(root, "health", "why", "forged");
    assert.equal(forged.ok, true);
    if (!forged.ok) return;

    const proposed = "proposed why body from decision";
    const created = await createDecision(root, {
      domainSlug: "health",
      documentKind: "why",
      title: "Update health why",
      rationale: "Better framing",
      proposedBodyMarkdown: proposed,
      previousBodyMarkdown: forged.value.bodyMarkdown,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.status, "pending");
    assert.equal(created.value.resolvedAt, null);
    assert.equal(created.value.proposedBodyMarkdown, proposed);
    assert.ok(created.value.id);

    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.ok(listed.value.some((d) => d.id === created.value.id));

    const resolved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.value.status, "approved");
    assert.ok(resolved.value.resolvedAt);

    const doc = await getDocument(root, "health", "why");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.status, "forged");
    assert.match(doc.value.bodyMarkdown, /proposed why body from decision/);

    const raw = await fs.readFile(path.join(root, "domains", "health", "why.md"), "utf8");
    assert.match(raw, /status: forged/);
    assert.match(raw, /proposed why body from decision/);

    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    const evt = log.value.find(
      (e) => e.type === "decision.resolved" && (e.payload as { id?: string })?.id === created.value.id,
    );
    assert.ok(evt, "expected decision.resolved log entry");
    assert.equal((evt!.payload as { resolution?: string }).resolution, "approved");
  });

  it("reject path leaves body unchanged", async () => {
    // Use intellectual what: seed, refine, forge
    const seeded = await saveDocument(root, "intellectual", "what", "keep this body");
    assert.equal(seeded.ok, true);
    assert.equal((await setDocumentStatus(root, "intellectual", "what", "refined")).ok, true);
    const forged = await setDocumentStatus(root, "intellectual", "what", "forged");
    assert.equal(forged.ok, true);
    if (!forged.ok) return;

    const beforeBody = forged.value.bodyMarkdown;

    const created = await createDecision(root, {
      domainSlug: "intellectual",
      documentKind: "what",
      title: "Bad proposal",
      rationale: null,
      proposedBodyMarkdown: "should never land",
      previousBodyMarkdown: beforeBody,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const rejected = await resolveDecision(root, created.value.id, "rejected");
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    assert.equal(rejected.value.status, "rejected");
    assert.ok(rejected.value.resolvedAt);

    const doc = await getDocument(root, "intellectual", "what");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.bodyMarkdown, beforeBody);
    assert.match(doc.value.bodyMarkdown, /keep this body/);
    assert.equal(doc.value.status, "forged");

    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    const evt = log.value.find(
      (e) =>
        e.type === "decision.resolved" &&
        (e.payload as { id?: string })?.id === created.value.id &&
        (e.payload as { resolution?: string }).resolution === "rejected",
    );
    assert.ok(evt, "expected rejected decision.resolved log");
  });

  it("cannot resolve already-resolved decision", async () => {
    // Target must be forged before createDecision is allowed.
    assert.equal((await saveDocument(root, "emotional", "how", "how body")).ok, true);
    assert.equal((await setDocumentStatus(root, "emotional", "how", "refined")).ok, true);
    assert.equal((await setDocumentStatus(root, "emotional", "how", "forged")).ok, true);

    const created = await createDecision(root, {
      domainSlug: "emotional",
      documentKind: "how",
      title: "Double resolve",
      rationale: null,
      proposedBodyMarkdown: "x",
      previousBodyMarkdown: null,
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

  it("createDecision rejects draft (non-forged) documents", async () => {
    // health/what is still draft by default after createVault
    const draft = await getDocument(root, "health", "what");
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    assert.equal(draft.value.status, "draft");

    const created = await createDecision(root, {
      domainSlug: "health",
      documentKind: "what",
      title: "Should fail",
      rationale: null,
      proposedBodyMarkdown: "nope",
      previousBodyMarkdown: draft.value.bodyMarkdown,
    });
    assert.equal(created.ok, false);
    if (created.ok) return;
    assert.match(created.error, /forged/i);

    // refined also fails
    assert.equal((await saveDocument(root, "health", "what", "refined body")).ok, true);
    assert.equal((await setDocumentStatus(root, "health", "what", "refined")).ok, true);
    const refinedAttempt = await createDecision(root, {
      domainSlug: "health",
      documentKind: "what",
      title: "Still should fail",
      rationale: null,
      proposedBodyMarkdown: "nope",
      previousBodyMarkdown: null,
    });
    assert.equal(refinedAttempt.ok, false);
    if (refinedAttempt.ok) return;
    assert.match(refinedAttempt.error, /forged/i);
  });

  it("createDecision rejects missing document", async () => {
    const created = await createDecision(root, {
      domainSlug: "no-such-domain",
      documentKind: "why",
      title: "Missing",
      rationale: null,
      proposedBodyMarkdown: "x",
      previousBodyMarkdown: null,
    });
    assert.equal(created.ok, false);
    if (created.ok) return;
    assert.match(created.error, /not found/i);
  });
});
