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

describe("implied filing shell wiring", () => {
  it("companionChatStreamWithPack mentions shouldFileImpliedTurn and fileImpliedChange", () => {
    const service = read("electron/vault-service.ts");
    const fn = service.slice(service.indexOf("export async function companionChatStreamWithPack"));
    assert.match(fn, /shouldFileImpliedTurn/);
    assert.match(fn, /fileImpliedChange/);
  });

  it("the chat path never calls resolveDecision", () => {
    const service = read("electron/vault-service.ts");
    const fn = service.slice(service.indexOf("export async function companionChatStreamWithPack"));
    assert.equal(fn.includes("resolveDecision"), false);
  });

  it("stores the session pref in companion-filing.json", () => {
    const filing = read("electron/companion-filing.ts");
    assert.match(filing, /companion-filing\.json/);
    assert.match(filing, /getFileUnsolicited/);
    assert.match(filing, /setFileUnsolicited/);
  });

  it("wires companion:getFiling and companion:setFiling", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    assert.match(main, /companion:getFiling/);
    assert.match(main, /companion:setFiling/);
    assert.match(preload, /companion:getFiling/);
    assert.match(preload, /companion:setFiling/);
    assert.match(viteEnv, /companionGetFiling/);
    assert.match(viteEnv, /companionSetFiling/);
  });

  it("ChatPanel offers a File implied changes checkbox", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.match(chat, /aria-label="File implied changes"/);
    assert.match(chat, /companionGetFiling/);
    assert.match(chat, /companionSetFiling/);
  });

  it("allow: true stays only on the Allow once button", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    const occurrences = chat.split("allow: true").length - 1;
    assert.equal(occurrences, 1);
    const allowIndex = chat.indexOf("allow: true");
    const allowOnceIndex = chat.indexOf("Allow once");
    assert.ok(allowIndex !== -1);
    assert.ok(allowIndex > allowOnceIndex - 400, "allow: true sits next to Allow once");
  });

  it("ChatPanel gains no setTimeout", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.equal(chat.includes("setTimeout"), false);
  });

  it("recent-vaults.ts has no fileUnsolicited", () => {
    const recent = read("electron/recent-vaults.ts");
    assert.equal(recent.includes("fileUnsolicited"), false);
  });
});
