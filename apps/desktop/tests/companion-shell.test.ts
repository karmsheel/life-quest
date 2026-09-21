import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("companion shell wiring", () => {
  it("registers companion IPC and shuts the gateway on quit", () => {
    const main = read("electron/main.ts");
    assert.match(main, /companion:ensure/);
    assert.match(main, /companionShutdown/);
    assert.match(main, /companion:stream/);
  });

  it("exposes companion methods and stream on the preload bridge", () => {
    const preload = read("electron/preload.ts");
    assert.match(preload, /companionEnsure/);
    assert.match(preload, /companion:stream/);
    assert.match(preload, /onCompanionStream/);
  });

  it("gates Welcome behind CompanionSetupScreen", () => {
    const app = read("src/App.tsx");
    assert.match(app, /CompanionProvider/);
    assert.match(app, /CompanionSetupScreen/);
    assert.match(app, /status\.kind !== ["']ready["']/);
  });

  it("setup screen covers needs_install and Recheck", () => {
    const src = read("src/components/hermes/CompanionSetupScreen.tsx");
    assert.match(src, /needs_install/);
    assert.match(src, /Recheck/);
    assert.match(src, /hermes-agent\.nousresearch\.com/);
  });

  it("ChatPanel uses companion sessions instead of the planner loop", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.match(chat, /companionChatStream/);
    assert.equal(chat.includes("hermesChatTools"), false);
  });

  it("Settings Hermes shows companion status not an arbitrary gateway form", () => {
    const hermes = read("src/components/settings/SettingsHermes.tsx");
    assert.match(hermes, /companionEnsure|companionStatus|useCompanion/);
    assert.match(hermes, /Open profile folder/);
    assert.equal(hermes.includes("Base URL"), false);
  });

  it("wires review/plan startOrResume IPC", () => {
    const service = read("electron/vault-service.ts");
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    assert.match(
      service,
      /startOrResumeReviewSession|review:startOrResume/,
    );
    assert.match(service, /planning:startOrResume|startOrResumePlanSession/);
    assert.match(main, /review:startOrResume/);
    assert.match(main, /planning:startOrResume/);
    assert.match(preload, /review:startOrResume/);
    assert.match(preload, /planning:startOrResume/);
    assert.match(viteEnv, /startOrResumeReviewSession|reviewStartOrResume/);
    assert.match(viteEnv, /startOrResumePlanSession|planningStartOrResume/);
  });

  it("ChatDockProvider exposes requestSession and requestedSessionId", () => {
    const dock = read("src/state/ChatDockProvider.tsx");
    assert.match(dock, /requestSession/);
    assert.match(dock, /requestedSessionId/);
    assert.match(dock, /requestedKickoff/);
    assert.match(dock, /clearRequestedSession/);
  });

  it("ChatPanel reads requestedSessionId", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.match(chat, /requestedSessionId/);
  });
});
