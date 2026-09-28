// KAR-63 — the MCP boundary. Spec Test Plan case 1: a two-cell upsert_row
// argument survives buildShape/toZod with both cells intact. Without the
// additionalProperties branch, toZod compiles `cells` to z.object({}) and Zod
// silently strips every key on the way in — a data-loss bug that validateCells
// then passes vacuously, because it only rejects *unknown* keys.
//
// Also covers test 11's spread-site half: mcp-server and the planner both
// iterate the one composed ALL_TOOL_DEFS constant.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { z } from "zod";
import { ALL_TOOL_DEFS, DATABASE_TOOL_DEFS } from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

// ─── toZod / buildShape, transcribed from electron/mcp-server.ts ───────────────
// Transcribed rather than imported: mcp-server.ts starts an HTTP listener at
// import time. The source-shape assertions below keep this copy honest.
type Prop = {
  type?: string | string[];
  enum?: unknown[];
  items?: unknown;
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;
};

function toZod(prop: unknown): z.ZodTypeAny {
  const p = prop as Prop;
  if (Array.isArray(p.enum)) {
    const vals = p.enum;
    if (vals.length > 0 && vals.every((v) => typeof v === "string")) {
      return z.enum(vals as [string, ...string[]]);
    }
    return z.unknown();
  }
  if (Array.isArray(p.type)) {
    const nonNull = p.type.filter((t) => t !== "null");
    if (nonNull.length === 1) return z.nullable(toZod({ ...p, type: nonNull[0] }));
    return z.nullable(z.unknown());
  }
  switch (p.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(p.items ? toZod(p.items) : z.unknown());
    case "object":
      if (!p.properties && p.additionalProperties) {
        return z.record(z.string(), z.unknown());
      }
      return z.object(buildShape(p.properties ?? {}));
    default:
      return z.unknown();
  }
}

function buildShape(properties: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(properties)) {
    shape[key] = toZod(value).optional();
  }
  return shape;
}

describe("KAR-63 MCP boundary", () => {
  // The cells contract belongs to upsert_row, which lands with the write tools in
  // KAR-65. The boundary plumbing it depends on (the additionalProperties branch
  // in toZod) is what ships in KAR-63, so these assertions are conditional on the
  // tool being present and run unconditionally from KAR-65 onward.
  const upsert = DATABASE_TOOL_DEFS.find((t) => t.name === "upsert_row");
  const cellsShape = () =>
    buildShape((upsert!.parameters as { properties?: Record<string, unknown> }).properties ?? {});

  it("a two-cell upsert_row argument keeps both cells through buildShape/toZod", (t) => {
    if (!upsert) return t.skip("upsert_row ships with the write tools in KAR-65");
    const parsed = cellsShape().cells.parse({ amount: -85, payee: "Coffee" });
    // The silent-{} strip this guards: both keys must survive.
    assert.deepEqual(parsed, { amount: -85, payee: "Coffee" });
    assert.equal(Object.keys(parsed as object).length, 2);
    assert.equal((parsed as Record<string, unknown>).amount, -85);
    assert.equal((parsed as Record<string, unknown>).payee, "Coffee");
  });

  it("a three-key cells map round-trips in full, including non-string values", (t) => {
    if (!upsert) return t.skip("upsert_row ships with the write tools in KAR-65");
    const cells = { amount: -1234.56, date: "2026-09-27", cleared: true };
    const parsed = cellsShape().cells.parse(cells) as Record<string, unknown>;
    assert.deepEqual(parsed, cells);
    assert.equal(typeof parsed.amount, "number");
    assert.equal(typeof parsed.cleared, "boolean");
  });

  it("a free-form object keeps every key; a declared-shape object does not gain any", () => {
    // The branch itself, independent of which tool declares it: this is the
    // behaviour KAR-63 ships, and it is what the cells round trip rests on.
    const freeForm = toZod({ type: "object", additionalProperties: true });
    const cells = { amount: -85, payee: "Coffee", cleared: true };
    assert.deepEqual(freeForm.parse(cells), cells);

    // A declared-shape object still strips unknown keys, as Zod always does —
    // which is why a cells map must be free-form rather than declared.
    const declared = toZod({ type: "object", properties: { amount: { type: "number" } } });
    assert.deepEqual(declared.parse({ amount: -85, payee: "Coffee" }), { amount: -85 });
  });

  it("a property-less object with no additionalProperties still yields an empty shape", () => {
    // The guard is `!p.properties`, not an emptiness check, so a tool that
    // legitimately takes no arguments is unaffected.
    const listDoc = ALL_TOOL_DEFS.find((t) => t.name === "list_documents")!;
    const props = (listDoc.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    const shape = buildShape(props);
    assert.deepEqual(Object.keys(shape), []);
  });

  it("every registered tool compiles to a shape without throwing", () => {
    // registerTools calls buildShape on every def; a bad def would break startup.
    for (const def of ALL_TOOL_DEFS) {
      const props = (def.parameters as { properties?: Record<string, unknown> }).properties ?? {};
      const shape = buildShape(props);
      assert.equal(typeof shape, "object", `${def.name} failed to compile`);
    }
  });

  it("mcp-server's toZod has the additionalProperties branch and the widened cast", () => {
    const src = read("electron/mcp-server.ts");
    // The cast at the top of toZod must declare the field, or the branch will
    // not typecheck.
    assert.match(src, /additionalProperties\?: boolean/);
    assert.match(src, /z\.record\(z\.string\(\), z\.unknown\(\)\)/);
    assert.match(src, /if \(!p\.properties && p\.additionalProperties\)/);
  });
});

describe("KAR-63 tool list parity at both spread sites", () => {
  it("mcp-server registers the composed constant, not a literal array", () => {
    const src = read("electron/mcp-server.ts");
    assert.match(src, /for \(const def of ALL_TOOL_DEFS\)/);
    // The old literal seven-array spread must be gone: it is two edits that drift.
    assert.doesNotMatch(src, /MAP_TOOL_DEFS,\s*\.\.\.GOALS_TOOL_DEFS/);
  });

  it("the planner's tool list is the same composed constant", () => {
    const src = read("electron/map-tools.ts");
    assert.match(src, /ALL_TOOL_DEFS\.map\(/);
    assert.doesNotMatch(src, /\.\.\.MAP_TOOL_DEFS,\s*\.\.\.GOALS_TOOL_DEFS/);
  });

  it("executeTool routes the database tools to executeDatabaseTool", () => {
    const src = read("electron/map-tools.ts");
    const start = src.indexOf("export async function executeTool");
    assert.notEqual(start, -1, "executeTool must exist");
    const body = src.slice(start, src.indexOf("/** Agent map tools that write"));
    assert.match(body, /DATABASE_TOOL_DEFS\.some\(\(t\) => t\.name === name\)/);
    assert.match(body, /executeDatabaseTool\(root, actor, name, rec\)/);
  });

  it("the capture expense path is untouched", () => {
    // capture_transaction, undo_capture, and correct_capture stay the direct
    // path: this series must not route them through Decisions.
    const src = read("electron/map-tools.ts");
    assert.match(src, /CAPTURE_TOOL_DEFS\.some\(\(t\) => t\.name === name\)/);
    assert.match(src, /executeCaptureTool\(root, actor, name, rec\)/);
  });
});
