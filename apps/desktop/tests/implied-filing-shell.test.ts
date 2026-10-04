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

  it("Settings Hermes lists apply-assistant-inserts checkboxes and the decision card names a batch", () => {
    const hermes = read("src/components/settings/SettingsHermes.tsx");
    const inbox = read("src/components/decisions/DecisionsInbox.tsx");
    const body = read("src/components/decisions/DecisionBody.tsx");
    assert.match(hermes, /Apply assistant inserts immediately/);
    assert.match(hermes, /aria-label=\{`Apply assistant inserts immediately: /);
    assert.match(inbox, /database-batch/);
    assert.match(inbox, /Database rows/);
    assert.match(inbox, /New row in/);
    assert.match(inbox, /Row in/);
    assert.match(inbox, /Database in/);
    assert.match(inbox, /proposedTitle \?\? /);
    assert.match(body, /database-batch/);
    assert.match(body, /insert-rows/);
    assert.equal(
      hermes.includes("setDatabases([])"),
      false,
      "a failed database list must not be stored as an empty catalog",
    );
    const loadingAt = hermes.indexOf("Loading databases…");
    assert.ok(loadingAt !== -1);
    const loadingWindow = hermes.slice(Math.max(0, loadingAt - 180), loadingAt);
    assert.equal(
      loadingWindow.includes("error"),
      false,
      "loading sentence must not depend on the shared error that Recheck clears",
    );
    assert.match(loadingWindow, /listStatus === "loading"/);
    const listLoad = hermes.slice(
      hermes.indexOf("api().dbList"),
      hermes.indexOf("function onToggleInsert"),
    );
    assert.match(listLoad, /setListStatus\("failed"\)/);
    assert.match(listLoad, /setListError\(/);
    assert.equal(
      /\bsetError\(/.test(listLoad),
      false,
      "a failed list must keep its own error so Recheck cannot clear it",
    );
    assert.match(listLoad, /setListStatus\("ready"\)/);
    assert.match(hermes, /listError \? \([\s\S]{0,240}className="form-error"/);
    const recheck = hermes.slice(hermes.indexOf("function onRecheck"), hermes.indexOf("const ready"));
    assert.match(recheck, /setError\(null\)/);
    assert.equal(/setListError|setListStatus|setDatabases/.test(recheck), false);
    const toggle = hermes.slice(
      hermes.indexOf("function onToggleInsert"),
      hermes.indexOf("function onRecheck"),
    );
    assert.match(toggle, /setError\(result\.error\)/);
    assert.equal(/setListStatus|setListError|setDatabases/.test(toggle), false);
    assert.match(
      hermes,
      /\{databases != null && groups\.length === 0 && stalePairs\.length === 0 \? \([\s\S]*?No databases in live domains\./,
      "empty-catalog sentence requires a loaded list",
    );
  });

  it("overlapping insert toggles compose on the list already being saved", () => {
    const hermes = read("src/components/settings/SettingsHermes.tsx");
    const toggle = hermes.slice(
      hermes.indexOf("function onToggleInsert"),
      hermes.indexOf("function onRecheck"),
    );
    assert.equal(
      /const current = snapshot\.settings\.autoApproveInserts \?\? \[\]/.test(toggle),
      false,
      "onToggleInsert must not read only snapshot.settings.autoApproveInserts as the base list",
    );
    const prelude = hermes.slice(
      hermes.indexOf("export function SettingsHermes"),
      hermes.indexOf("function onToggleInsert"),
    );
    assert.match(prelude, /const insertFlight = useRef/);
    assert.equal(
      prelude.includes("insertPending"),
      false,
      "the saved list for this vault outlives the in-flight count",
    );
    assert.match(prelude, /const insertSave = useRef\(Promise\.resolve\(\)\)/);
    assert.equal(
      /insertPending/.test(toggle),
      false,
      "a click after the save queue drains must still use the list last saved for this vault",
    );
    assert.match(toggle, /insertSave\.current = insertSave\.current\s*\.then/);
    assert.match(
      toggle,
      /insertFlight\.current\?\.rootPath === rootPath\s*\?\s*insertFlight\.current\.list\s*:\s*fromRender/,
    );
    assert.match(toggle, /snapshot\.settings\.autoApproveInserts \?\? \[\]/);
    const failed = toggle.slice(toggle.indexOf("if (!result.ok)"), toggle.indexOf("setError(null)"));
    assert.match(failed, /insertFlight\.current = \{ rootPath, list: current \}/);
    assert.equal(failed.includes("list: next"), false);
    assert.match(toggle, /insertFlight\.current = \{ rootPath, list: next \}/);
  });
});
