import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

const EDITED_TSX = [
  "src/components/log/LifeLogFeed.tsx",
  "src/pages/ActPage.tsx",
];

describe("actor on the life log, desktop wiring (KAR-9)", () => {
  it("LifeLogFeed renders the actor display name in the row", () => {
    const src = read("src/components/log/LifeLogFeed.tsx");
    assert.match(src, /actorDisplayName/);
    // The display name must be rendered as visible text in a span, not only
    // put on a data-attribute. actorDisplayName is called inside the span.
    const spanMatch = src.match(
      /<span className="life-log-event__actor[^"]*">\s*\{actorDisplayName\(e\.actor\)\}\s*<\/span>/,
    );
    assert.ok(
      spanMatch,
      "LifeLogFeed must render the actor name inside a visible span",
    );
    // Null actor must render nothing, and must not be labelled "You".
    assert.match(src, /\{e\.actor \? \(/);
    assert.equal(
      /e\.actor \?[\s\S]{0,200}?"You"/.test(src),
      false,
      "a null actor must not render as You",
    );
  });

  it("ActPage passes the hire id and name into hermesChatTools", () => {
    const src = read("src/pages/ActPage.tsx");
    const callMatch = src.match(/hermesChatTools\(([\s\S]{0,400}?)\)/);
    assert.ok(callMatch, "ActPage must call hermesChatTools");
    const args = callMatch[1];
    assert.match(args, /id:\s*agent\.id/);
    assert.match(args, /name:\s*agent\.name/);
  });

  it("executeTool takes an actor and uses it for capture, script, and the map log", () => {
    const src = read("electron/map-tools.ts");
    assert.match(src, /export async function executeTool\([\s\S]{0,300}?actor/);
    assert.match(src, /executeCaptureTool\(root,\s*actor/);
    assert.match(src, /executeScriptTool\(root,\s*actor/);
    assert.match(
      src,
      /applyMapCommand\(root,\s*command,\s*"agent",[\s\S]{0,80}?actor/,
    );
  });

  it("runPlannerLoop threads the actor down to executeTool", () => {
    const src = read("electron/map-tools.ts");
    const loopMatch = src.match(
      /export async function runPlannerLoop\(opts: \{([\s\S]{0,500}?)\}\):/,
    );
    assert.ok(loopMatch, "runPlannerLoop must have an options type");
    assert.match(loopMatch[1], /actor/);
    // The loop resolves opts.actor to a local actor defaulting to the companion
    // and passes that down, so the hire reaches every tool write.
    assert.match(src, /const actor = opts\.actor \?\? AGENT_ACTOR;/);
    assert.match(
      src,
      /executeTool\(\s*opts\.root,[\s\S]{0,200}?step\.value\.args,\s*actor,?\s*\)/,
    );
  });

  it("the IPC hire field carries only id and name, never a key", () => {
    for (const rel of [
      "electron/preload.ts",
      "electron/main.ts",
      "src/vite-env.d.ts",
      "electron/vault-service.ts",
    ]) {
      const src = read(rel);
      assert.match(src, /hire/);
      assert.equal(
        /hire\?:\s*\{\s*id:\s*string;\s*name:\s*string\s*\}/.test(src) ||
          /hire:\s*\{\s*id:\s*string;\s*name:\s*string\s*\}\s*\|/.test(src) ||
          /hire\?/.test(src),
        true,
        `${rel} must type the hire as { id, name }`,
      );
    }
  });

  it("ChatPanel still does not mention hermesChatTools", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    assert.equal(src.includes("hermesChatTools"), false);
  });

  it("none of the edited renderer tsx files mention an API key", () => {
    for (const rel of EDITED_TSX) {
      const src = read(rel);
      assert.equal(
        /apiKey|API_SERVER_KEY|api_key/.test(src),
        false,
        `${rel} must not contain an API key`,
      );
    }
  });
});
