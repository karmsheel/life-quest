/**
 * E2E for a library note's domain list as something an agent can propose.
 *
 * Until this change a note's tags lived in its frontmatter, and the MCP surface
 * could only propose a title and a body: `update_document` had no domain field,
 * and the Decision record that approval applies had nowhere to carry one. An
 * agent asked to re-tag a note therefore had no tool and no Decision to file —
 * the operator's eight notes had to be edited on disk, outside the approval
 * path, the lock check and the life log.
 *
 * This drives the real vault-core against a real temp vault (`createVault`), the
 * real `executeDocumentTool` the MCP door calls, the real Decision files on
 * disk, and the same `listDecisions` + `withDecisionDisplayLabels` read path the
 * Decisions page uses. `npm test` runs it without a dev server. The Electron rig
 * (`decision-body.electron.mjs`) proves the card shows the change; this proves
 * the write and the approval.
 *
 * Ways this can fail (written before the assertions, per AGENTS.md):
 *  1. the agent's domain change writes the note directly instead of filing a
 *     pending Decision — the whole mechanism being fixed;
 *  2. the Decision is filed but its record drops the proposed or previous
 *     domains, so the inbox can neither show nor apply the change;
 *  3. the filed Decision is invisible in one of the two lenses it touches;
 *  4. approving applies the title/body but leaves the old tags in place;
 *  5. approving rewrites or loses the note's title, body, createdAt, locked or
 *     deletedAt;
 *  6. untagging to [] is read back as "no domain change" (null and [] confused),
 *     so approve keeps the old tags;
 *  7. a domain-only update is refused as "No changes provided" — the exact
 *     update the tool was missing;
 *  8. an unknown area is accepted at propose time and only fails after the
 *     operator has answered the card;
 *  9. a doctrine document accepts `domainSlugs` and silently drops them;
 * 10. a locked note's approved domain change loses its lock;
 * 11. the operator's own tool call applies domains without bumping updatedAt or
 *     logging `document.updated`;
 * 12. a Decision filed before this change (no domain keys) crashes the inbox
 *     read or reads as [] instead of null.
 *
 * Artifact: `e2e/artifacts/library-document-domains.json` — per-scenario
 * pass/fail, the before/after frontmatter, the filed Decision fields, and the
 * log lines. The assertion runs on the same JSON it writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DOCUMENT_TOOL_DEFS,
  USER_ACTOR,
  createVault,
  executeDocumentTool,
  libraryCreate,
  libraryGet,
  listDecisions,
  readLog,
  resolveDecision,
  setLibraryLocked,
  unlockDomain,
  vaultPaths,
  withDecisionDisplayLabels,
} from "@lifequest/vault-core";
import type { DecisionRecord, LifeEvent } from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(desktopRoot, "e2e/artifacts/library-document-domains.json");

const AGENT = { type: "agent" as const, id: "e2e", name: "E2E" };

type ScenarioResult = {
  name: string;
  pass: boolean;
  error: string | null;
  [detail: string]: unknown;
};

const roots: string[] = [];
const results: ScenarioResult[] = [];

async function freshVault(label: string): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lq-library-domains-"));
  roots.push(root);
  const created = await createVault(root, `Library domains ${label}`);
  assert.equal(created.ok, true, created.ok ? "" : created.error);
  for (const area of ["business", "financial"]) {
    const unlocked = await unlockDomain(root, area);
    assert.equal(
      unlocked.ok,
      true,
      unlocked.ok ? "" : `unlockDomain(${area}) failed: ${unlocked.error}`,
    );
  }
  return root;
}

async function note(root: string, id: string) {
  const got = await libraryGet(root, id);
  assert.equal(got.ok, true, got.ok ? "" : got.error);
  return got.ok ? got.value : assert.fail("libraryGet failed");
}

function notePath(root: string, id: string): string {
  return vaultPaths(root).libraryDocumentMd(id);
}

function noteFile(root: string, id: string): string {
  return fs.readFileSync(notePath(root, id), "utf8");
}

async function decisions(root: string): Promise<DecisionRecord[]> {
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
  return listed.ok ? listed.value : [];
}

async function logTypes(root: string): Promise<string[]> {
  const log = await readLog(root);
  assert.equal(log.ok, true, log.ok ? "" : log.error);
  return (log.ok ? log.value : []).map((event: LifeEvent) => event.type);
}

function decisionJson(root: string, id: string): string {
  return path.join(vaultPaths(root).decisionsDir, `${id}.json`);
}

/** Run one scenario; record pass/fail instead of aborting the remaining ones. */
async function scenario(
  name: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<void> {
  try {
    const detail = await run();
    results.push({ name, pass: true, error: null, ...detail });
  } catch (e) {
    results.push({
      name,
      pass: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

describe("a library note's domains travel through a Decision", () => {
  it("files, reads, and applies a domain change without touching the note", async () => {
    try {
      await scenario("tool schema exposes domainSlugs on update_document", async () => {
        const update = DOCUMENT_TOOL_DEFS.find((tool) => tool.name === "update_document");
        assert.ok(update, "update_document is not in DOCUMENT_TOOL_DEFS");
        const properties = (update.parameters as { properties?: Record<string, unknown> })
          .properties;
        assert.deepEqual(properties?.domainSlugs, {
          type: "array",
          items: { type: "string" },
        });
        return { properties: Object.keys(properties ?? {}) };
      });

      await scenario("agent domain-only update files a pending Decision and writes nothing", async () => {
        const root = await freshVault("propose");
        const created = await libraryCreate(
          root,
          { title: "Ledger note", bodyMarkdown: "Body the agent must not touch.\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const before = await note(root, created.ok ? created.value.id : "");
        const beforeFile = noteFile(root, before.id);

        const filed = await executeDocumentTool(root, AGENT, "update_document", {
          id: before.id,
          domainSlugs: ["financial"],
        });
        assert.equal("decisionId" in filed, true, JSON.stringify(filed));
        if (!("decisionId" in filed) || typeof filed.decisionId !== "string") {
          throw new Error(`no decisionId in ${JSON.stringify(filed)}`);
        }

        // Nothing was written: the note still carries the old tags, byte for byte
        // the same file, and the only new event is the Decision being filed.
        const after = await note(root, before.id);
        assert.deepEqual(after.domainSlugs, ["business"]);
        assert.equal(noteFile(root, before.id), beforeFile, "the propose path rewrote the note");
        const log = await logTypes(root);
        assert.equal(log.filter((type) => type === "document.updated").length, 0);

        const pending = await decisions(root);
        assert.equal(pending.length, 1);
        const decision = pending[0]!;
        assert.equal(decision.status, "pending");
        assert.deepEqual(decision.target, { type: "library", id: before.id });
        assert.deepEqual(decision.proposedDomainSlugs, ["financial"]);
        assert.deepEqual(decision.previousDomainSlugs, ["business"]);
        assert.equal(decision.proposedTitle, before.title, "a domain-only change proposed a new title");
        assert.equal(decision.proposedBodyMarkdown, before.bodyMarkdown);
        // Both lenses see a re-tag while it is pending: the one it is leaving and
        // the one it is moving to.
        assert.deepEqual([...decision.domainSlugs].sort(), ["business", "financial"]);

        const stored = JSON.parse(fs.readFileSync(decisionJson(root, decision.id), "utf8")) as Record<
          string,
          unknown
        >;
        assert.deepEqual(stored.proposedDomainSlugs, ["financial"]);
        assert.deepEqual(stored.previousDomainSlugs, ["business"]);

        return {
          noteBefore: before.domainSlugs,
          noteAfter: after.domainSlugs,
          decision: {
            id: decision.id,
            status: decision.status,
            proposedDomainSlugs: decision.proposedDomainSlugs,
            previousDomainSlugs: decision.previousDomainSlugs,
            domainSlugs: decision.domainSlugs,
            log,
          },
        };
      });

      await scenario("the read path carries the domain change to the inbox", async () => {
        const root = await freshVault("read");
        const created = await libraryCreate(
          root,
          { title: "Read path", bodyMarkdown: "x\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const id = created.ok ? created.value.id : "";
        const filed = await executeDocumentTool(root, AGENT, "update_document", {
          id,
          domainSlugs: ["financial"],
        });
        assert.equal("decisionId" in filed, true, JSON.stringify(filed));

        const listed = await decisions(root);
        const labelled = await withDecisionDisplayLabels(root, listed);
        const decision = labelled[0]!;
        assert.deepEqual(decision.proposedDomainSlugs, ["financial"]);
        assert.deepEqual(decision.previousDomainSlugs, ["business"]);
        return {
          proposedDomainSlugs: decision.proposedDomainSlugs,
          previousDomainSlugs: decision.previousDomainSlugs,
        };
      });

      await scenario("approving applies the tags and leaves the rest of the note alone", async () => {
        const root = await freshVault("apply");
        const created = await libraryCreate(
          root,
          { title: "Apply me", bodyMarkdown: "Body stays.\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const before = await note(root, created.ok ? created.value.id : "");
        const filed = await executeDocumentTool(root, AGENT, "update_document", {
          id: before.id,
          domainSlugs: ["financial"],
        });
        assert.equal("decisionId" in filed, true, JSON.stringify(filed));
        const decisionId = "decisionId" in filed ? String(filed.decisionId) : "";

        await new Promise((resolve) => setTimeout(resolve, 10));
        const resolved = await resolveDecision(root, decisionId, "approved");
        assert.equal(resolved.ok, true, resolved.ok ? "" : resolved.error);
        assert.equal(resolved.ok ? resolved.value.status : "", "approved");

        const after = await note(root, before.id);
        assert.deepEqual(after.domainSlugs, ["financial"]);
        assert.equal(after.title, before.title);
        assert.equal(after.bodyMarkdown, before.bodyMarkdown);
        assert.equal(after.createdAt, before.createdAt);
        assert.equal(after.locked, before.locked);
        assert.equal(after.deletedAt, before.deletedAt);
        assert.notEqual(after.updatedAt, before.updatedAt, "approve did not move updatedAt");
        assert.match(noteFile(root, before.id), /domains: \["financial"\]/);
        const log = await logTypes(root);
        assert.equal(log.filter((type) => type === "decision.resolved").length, 1);
        return {
          before: { domainSlugs: before.domainSlugs, updatedAt: before.updatedAt },
          after: { domainSlugs: after.domainSlugs, updatedAt: after.updatedAt },
          resolvedStatus: resolved.ok ? resolved.value.status : null,
        };
      });

      await scenario("untagging to [] is a real proposal and clears the list", async () => {
        const root = await freshVault("untag");
        const created = await libraryCreate(
          root,
          { title: "Untag me", bodyMarkdown: "x\n", domainSlugs: ["business", "financial"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const before = await note(root, created.ok ? created.value.id : "");
        const filed = await executeDocumentTool(root, AGENT, "update_document", {
          id: before.id,
          domainSlugs: [],
        });
        assert.equal("decisionId" in filed, true, JSON.stringify(filed));
        const pending = (await decisions(root))[0]!;
        assert.deepEqual(pending.proposedDomainSlugs, [], "[] must not read as no-change");
        assert.deepEqual(pending.previousDomainSlugs, ["business", "financial"]);
        const decisionId = "decisionId" in filed ? String(filed.decisionId) : "";
        const resolved = await resolveDecision(root, decisionId, "approved");
        assert.equal(resolved.ok, true, resolved.ok ? "" : resolved.error);
        const after = await note(root, before.id);
        assert.deepEqual(after.domainSlugs, []);
        assert.match(noteFile(root, before.id), /domains: \[\]/);
        return {
          proposedDomainSlugs: pending.proposedDomainSlugs,
          previousDomainSlugs: pending.previousDomainSlugs,
          after: after.domainSlugs,
        };
      });

      await scenario("a title, body and domain change travel together", async () => {
        const root = await freshVault("together");
        const created = await libraryCreate(
          root,
          { title: "Before", bodyMarkdown: "Old body.\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const before = await note(root, created.ok ? created.value.id : "");
        const filed = await executeDocumentTool(root, AGENT, "update_document", {
          id: before.id,
          title: "After",
          body: "New body.\n",
          domainSlugs: ["financial"],
        });
        assert.equal("decisionId" in filed, true, JSON.stringify(filed));
        const decisionId = "decisionId" in filed ? String(filed.decisionId) : "";
        const resolved = await resolveDecision(root, decisionId, "approved");
        assert.equal(resolved.ok, true, resolved.ok ? "" : resolved.error);
        const after = await note(root, before.id);
        assert.equal(after.title, "After");
        assert.equal(after.bodyMarkdown, "New body.\n");
        assert.deepEqual(after.domainSlugs, ["financial"]);
        return { title: after.title, body: after.bodyMarkdown, domains: after.domainSlugs };
      });

      await scenario("the same domains and no title or body is No changes provided", async () => {
        const root = await freshVault("noop");
        const created = await libraryCreate(
          root,
          { title: "No-op", bodyMarkdown: "x\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const id = created.ok ? created.value.id : "";
        const tool = await executeDocumentTool(root, AGENT, "update_document", {
          id,
          domainSlugs: ["business", " business "],
        });
        assert.equal("error" in tool, true, JSON.stringify(tool));
        assert.match("error" in tool ? tool.error.message : "", /No changes provided/);
        assert.equal((await decisions(root)).length, 0, "a no-op filed a Decision");
        return { result: tool };
      });

      await scenario("an unknown area is refused before the operator sees a card", async () => {
        const root = await freshVault("unknown");
        const created = await libraryCreate(
          root,
          { title: "Unknown area", bodyMarkdown: "x\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const id = created.ok ? created.value.id : "";
        const before = await note(root, id);
        const beforeFile = noteFile(root, id);
        const tool = await executeDocumentTool(root, AGENT, "update_document", {
          id,
          domainSlugs: ["no-such-area"],
        });
        assert.equal("error" in tool, true, JSON.stringify(tool));
        assert.match("error" in tool ? tool.error.message : "", /Unknown domain/);
        assert.equal((await decisions(root)).length, 0);
        assert.equal(noteFile(root, id), beforeFile);
        assert.deepEqual((await note(root, id)).domainSlugs, before.domainSlugs);
        return { result: tool };
      });

      await scenario("a doctrine document refuses domainSlugs instead of dropping them", async () => {
        const root = await freshVault("doctrine");
        const tool = await executeDocumentTool(root, AGENT, "update_document", {
          domainSlug: "business",
          kind: "why",
          domainSlugs: ["financial"],
        });
        assert.equal("error" in tool, true, JSON.stringify(tool));
        assert.match("error" in tool ? tool.error.message : "", /only applies to a library note/);
        assert.equal((await decisions(root)).length, 0);
        return { result: tool };
      });

      await scenario("a locked note's approved domain change keeps the lock and body", async () => {
        const root = await freshVault("locked");
        const created = await libraryCreate(
          root,
          { title: "Locked note", bodyMarkdown: "Locked body.\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const id = created.ok ? created.value.id : "";
        const locked = await setLibraryLocked(root, id, true);
        assert.equal(locked.ok, true, locked.ok ? "" : locked.error);
        const before = await note(root, id);
        assert.equal(before.locked, true);

        const filed = await executeDocumentTool(root, AGENT, "update_document", {
          id,
          domainSlugs: ["financial"],
        });
        assert.equal("decisionId" in filed, true, JSON.stringify(filed));
        const decisionId = "decisionId" in filed ? String(filed.decisionId) : "";
        const resolved = await resolveDecision(root, decisionId, "approved");
        assert.equal(resolved.ok, true, resolved.ok ? "" : resolved.error);
        const after = await note(root, id);
        assert.deepEqual(after.domainSlugs, ["financial"]);
        assert.equal(after.locked, true, "approve dropped the note's lock");
        assert.equal(after.bodyMarkdown, before.bodyMarkdown);
        return { locked: after.locked, domains: after.domainSlugs };
      });

      await scenario("the operator's own tool call applies domains, bumps updatedAt and logs", async () => {
        const root = await freshVault("user");
        const created = await libraryCreate(
          root,
          { title: "User edit", bodyMarkdown: "x\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const before = await note(root, created.ok ? created.value.id : "");
        await new Promise((resolve) => setTimeout(resolve, 10));
        const tool = await executeDocumentTool(root, USER_ACTOR, "update_document", {
          id: before.id,
          domainSlugs: ["financial"],
        });
        assert.equal("record" in tool, true, JSON.stringify(tool));
        const after = await note(root, before.id);
        assert.deepEqual(after.domainSlugs, ["financial"]);
        assert.notEqual(after.updatedAt, before.updatedAt);
        const log = await readLog(root);
        assert.equal(log.ok, true, log.ok ? "" : log.error);
        const updates = (log.ok ? log.value : []).filter(
          (event: LifeEvent) => event.type === "document.updated",
        );
        assert.equal(updates.length, 1, "the direct write did not log document.updated");
        assert.equal(updates[0]?.actor.type, "user");
        return {
          before: before.updatedAt,
          after: after.updatedAt,
          log: updates.map((event: LifeEvent) => ({ type: event.type, actor: event.actor.type })),
        };
      });

      await scenario("a Decision filed before this change reads as no domain change", async () => {
        const root = await freshVault("legacy");
        const created = await libraryCreate(
          root,
          { title: "Legacy", bodyMarkdown: "x\n", domainSlugs: ["business"] },
          USER_ACTOR,
        );
        assert.equal(created.ok, true, created.ok ? "" : created.error);
        const id = created.ok ? created.value.id : "";
        const filed = await executeDocumentTool(root, AGENT, "update_document", {
          id,
          title: "Legacy v2",
        });
        assert.equal("decisionId" in filed, true, JSON.stringify(filed));
        const decisionId = "decisionId" in filed ? String(filed.decisionId) : "";
        const file = decisionJson(root, decisionId);
        const legacy = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        delete legacy.proposedDomainSlugs;
        delete legacy.previousDomainSlugs;
        fs.writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`);

        const read = await decisions(root);
        assert.equal(read.length, 1);
        assert.equal(read[0]!.proposedDomainSlugs, null);
        assert.equal(read[0]!.previousDomainSlugs, null);
        // And approving it leaves the tags alone rather than clearing them.
        const resolved = await resolveDecision(root, decisionId, "approved");
        assert.equal(resolved.ok, true, resolved.ok ? "" : resolved.error);
        const after = await note(root, id);
        assert.deepEqual(after.domainSlugs, ["business"]);
        assert.equal(after.title, "Legacy v2");
        return {
          proposedDomainSlugs: read[0]!.proposedDomainSlugs,
          previousDomainSlugs: read[0]!.previousDomainSlugs,
          after: { title: after.title, domains: after.domainSlugs },
        };
      });

      const report = {
        pass: results.every((result) => result.pass),
        ranAt: new Date().toISOString(),
        command:
          "cd apps/desktop && node --experimental-strip-types --test tests/library-document-domains-e2e.test.ts",
        surface:
          "packages/vault-core/src/document-tools.ts executeDocumentTool + decisions.ts createDecision/applyApprovedBody + library-documents.ts",
        failureModes: [
          "the agent's domain change writes the note directly instead of filing a Decision",
          "the filed Decision drops the proposed or previous domains",
          "the pending Decision is invisible in one of the lenses it touches",
          "approving leaves the old tags in place",
          "approving rewrites the note's title, body, createdAt, lock or deletedAt",
          "untagging to [] reads back as no-change",
          "a domain-only update is refused as No changes provided",
          "an unknown area is accepted at propose time",
          "a doctrine document accepts domainSlugs and drops them",
          "a locked note's approved change loses its lock",
          "a direct user write does not bump updatedAt or log document.updated",
          "a legacy Decision without the domain keys crashes the read or reads []",
        ],
        scenarios: results,
        totals: {
          scenarios: results.length,
          passed: results.filter((result) => result.pass).length,
          failed: results.filter((result) => !result.pass).length,
        },
      };
      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

      // The artifact is the deliverable: assert on the file that was written.
      const written = JSON.parse(fs.readFileSync(REPORT, "utf8")) as typeof report;
      assert.equal(
        written.pass,
        true,
        `scenario failures:\n${written.scenarios
          .filter((result) => !result.pass)
          .map((result) => `  - ${result.name}: ${result.error}`)
          .join("\n")}`,
      );
      assert.equal(written.scenarios.length, 12, "the artifact does not carry all twelve scenarios");
      assert.deepEqual(written.scenarios, results);
      assert.equal(written.totals.failed, 0);
      assert.equal(written.totals.passed, written.totals.scenarios);
    } finally {
      for (const root of roots) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
