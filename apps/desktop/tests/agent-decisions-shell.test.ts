import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { documentTargetLabel } from "@lifequest/vault-core";
import type { DocumentTarget } from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

const DAY_TEMPLATE_TOOLS = [
  "create_day_type",
  "update_day_type",
  "delete_day_type",
  "set_default_weekday_type",
  "set_default_weekly_items",
];

/** Extract the body of executeTool so we can assert on the agent tool path only. */
function executeToolBody(src: string): string {
  const start = src.indexOf("export async function executeTool");
  assert.notEqual(start, -1, "executeTool must exist in map-tools.ts");
  return src.slice(start);
}

describe("agent map tools file Decisions", () => {
  it("goal tools are not applied via applyGoalsCommand on the agent path", () => {
    const body = executeToolBody(read("electron/map-tools.ts"));
    // commandForGoalTool still builds the command, but the agent path must propose
    // instead of calling applyGoalsCommand.
    assert.equal(/applyGoalsCommand\s*\(/.test(body), false);
    assert.match(body, /commandForGoalTool/);
    assert.match(body, /type: "goal"/);
  });

  it("the five day-template tools are not applied via applyMapCommand on the agent path", () => {
    const body = executeToolBody(read("electron/map-tools.ts"));
    for (const tool of DAY_TEMPLATE_TOOLS) {
      assert.ok(
        body.includes(`"${tool}"`),
        `${tool} must be listed on the agent day-template path`,
      );
    }
    assert.match(body, /type: "day-template"/);
  });

  it("create_task is not gated and still falls through to applyMapCommand", () => {
    const body = executeToolBody(read("electron/map-tools.ts"));
    // KAR-9 added the vault actor after `today`; the map actor stays "agent".
    assert.match(body, /applyMapCommand\(root, command, "agent", undefined, actor\)/);
    // create_task must not be captured by the day-template gate, and it is not routed
    // through a Decision proposer: only goals and the five day templates are.
    const gate = body.slice(body.indexOf("DAY_TEMPLATE_TOOLS.has(name)"));
    assert.equal(/create_task/.test(gate.slice(0, gate.indexOf("applyMapCommand"))), false);
    assert.equal(/createDecision/.test(gate.slice(0, gate.indexOf("applyMapCommand"))), false);
    const proposer = body.slice(body.indexOf("async function proposeDayTemplateDecision"));
    assert.equal(/create_task/.test(proposer), false);
  });
});

describe("operator IPC writes stay direct", () => {
  it("vault-service goalsApply calls applyGoalsCommand and mapApply calls applyMapCommand", () => {
    const src = read("electron/vault-service.ts");
    const goalsApply = src.slice(
      src.indexOf("export async function goalsApply"),
      src.indexOf("export async function goalsApply") + 400,
    );
    assert.match(goalsApply, /applyGoalsCommand\(root, command\)/);
    const mapApply = src.slice(
      src.indexOf("export async function mapApply"),
      src.indexOf("export async function mapApply") + 400,
    );
    // KAR-9: the operator IPC names the operator on the life-log line.
    assert.match(
      mapApply,
      /applyMapCommand\(root, command, actor, undefined, USER_ACTOR\)/,
    );
  });

  it("vault-service does not route operator writes through createDecision", () => {
    const src = read("electron/vault-service.ts");
    const goalsApply = src.slice(
      src.indexOf("export async function goalsApply"),
      src.indexOf("export async function goalsApply") + 400,
    );
    const mapApply = src.slice(
      src.indexOf("export async function mapApply"),
      src.indexOf("export async function mapApply") + 400,
    );
    assert.equal(/createDecision/.test(goalsApply), false);
    assert.equal(/createDecision/.test(mapApply), false);
  });
});

// KAR-64 spec Test Plan case 12: label and rendering. documentTargetLabel must
// return a non-empty subject for both new target types, the inbox must render a
// database-row target, and it must render `reason` for a rejected-on-apply
// Decision and label it distinctly from an operator rejection.
describe("KAR-64 database Decision labels and rendering", () => {
  const ROW_TARGETS: DocumentTarget[] = [
    { type: "database-row", domainSlug: "financial", databaseId: "finance:accounts", rowId: "r1" },
    { type: "database-row", domainSlug: "health", databaseId: "db-1", rowId: null },
  ];
  const DB_TARGETS: DocumentTarget[] = [
    { type: "database", domainSlug: "intellectual", databaseId: "minted-1" },
  ];

  it("documentTargetLabel returns a non-empty subject for both new targets", () => {
    for (const target of ROW_TARGETS) {
      const label = documentTargetLabel(target, "");
      assert.ok(label.length > 0, `database-row label must not be empty: ${JSON.stringify(target)}`);
      // Even with a fallback title it must never collapse to the bare prefix.
      assert.doesNotMatch(label, /^$/);
    }
    for (const target of DB_TARGETS) {
      const label = documentTargetLabel(target, "");
      assert.ok(label.length > 0, `database label must not be empty: ${JSON.stringify(target)}`);
    }
  });

  it("documentTargetLabel prefers the proposer-supplied title when present", () => {
    const withTitle = documentTargetLabel(
      { type: "database-row", domainSlug: "financial", databaseId: "finance:accounts", rowId: "r1" },
      "Cheque account · 2026-09-27",
    );
    assert.equal(withTitle, "Cheque account · 2026-09-27");
  });

  it("the inbox renders a database-row target and its reason", () => {
    const src = read("src/components/decisions/DecisionsInbox.tsx");
    // The target is rendered, not filtered out or crashed on.
    assert.match(src, /database-row|database/);
    // reason is rendered when present.
    assert.match(src, /d\.reason/);
    // …and the two rejection kinds are labelled differently, so an operator who
    // *approved* a Decision that then failed does not read it as their own refusal.
    assert.match(src, /proposal no longer applies/);
  });

  it("the inbox does not treat a rejected-on-apply Decision as a plain rejection", () => {
    const src = read("src/components/decisions/DecisionsInbox.tsx");
    // The reason block is distinct from the status span.
    assert.match(src, /decision-card__reason/);
    // reason is optional: null/empty records must still render without it.
    assert.match(src, /\{d\.reason \?/);
  });
});
