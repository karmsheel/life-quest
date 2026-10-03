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

  it("attaches to the host multiplexer instead of spawning a lifequest gateway", () => {
    const companion = read("electron/companion.ts");
    const lifecycle = read("electron/companion-lifecycle.ts");
    assert.doesNotMatch(companion, /"-p",\s*"lifequest",\s*"gateway"/);
    assert.match(companion, /gateway["'],\s*["']start["']/);
    assert.match(companion, /gateway["'],\s*["']restart["']/);
    assert.match(companion, /multiplex_profiles/);
    assert.match(lifecycle, /ensureHostGateway/);
    assert.doesNotMatch(lifecycle, /spawnGateway\(/);
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

  it("every chat row carries its own 3-dot menu, and Delete is the gateway's own", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    // One 3-dot control per row, and the menu it opens is the only place a chat
    // is renamed, archived or deleted without opening it first.
    assert.match(chat, /className="chat-panel__session-menu-btn"/);
    assert.match(chat, /aria-label="Chat actions"/);
    assert.match(chat, /aria-label="Edit chat"/);
    assert.match(chat, /aria-label="Archive chat"/);
    assert.match(chat, /aria-label="Delete chat"/);
    // Edit puts the field in the row's own place, in the list.
    assert.match(chat, /className="chat-panel__session-rename"/);
    // Delete is irreversible, so it asks first — through the app's own dialog,
    // which is drawn over the window (a platform `window.confirm` centres on the
    // display) — and it is the store's own DELETE, not a second local list that
    // would drift from Hermes.
    assert.equal(
      /window\.confirm\s*\(/.test(chat),
      false,
      "the dock asks through window.confirm instead of its own dialog",
    );
    // The dock asks through the shared hook and draws what it hands back; the
    // dialog itself is `src/components/ui/ConfirmDialog.tsx`.
    assert.match(chat, /const \{ ask, dialog \} = useConfirm\(open\)/);
    assert.match(chat, /^      \{dialog\}$/m);
    assert.match(chat, /useConfirm\(open\)/);
    assert.match(chat, /companionSessionDelete\(id\)/);
    const confirmDialog = read("src/components/ui/ConfirmDialog.tsx");
    assert.match(confirmDialog, /className="confirm-dialog-backdrop"/);
    assert.match(confirmDialog, /role="dialog"/);
    assert.match(confirmDialog, /aria-modal="true"/);
    // The whole chain, so a missing hop is a suite failure rather than an
    // undefined bridge method at runtime.
    assert.match(read("electron/companion.ts"), /method: "DELETE"/);
    assert.match(read("electron/main.ts"), /companion:sessionDelete/);
    assert.match(read("electron/preload.ts"), /companion:sessionDelete/);
    assert.match(read("src/vite-env.d.ts"), /companionSessionDelete/);
    // The menu is positioned against the row it belongs to and paints a surface
    // of its own; without both, the popover lands in the row's flow.
    const css = read("src/styles/global.css");
    assert.match(css, /\.chat-panel__session-item\s*\{[\s\S]*?position:\s*relative/);
    assert.match(css, /\.chat-panel__session-menu\s*\{[\s\S]*?background:\s*var\(--card\)/);
    // The dialog is fixed to the viewport: that is what centres it in the window
    // the app runs in, rather than on the dock or the display.
    assert.match(css, /\.confirm-dialog-backdrop\s*\{[\s\S]*?position:\s*fixed/);
    assert.match(css, /\.confirm-dialog-backdrop\s*\{[\s\S]*?inset:\s*0/);
    // Delete is the one item in that menu the app cannot undo, so it is the one
    // that wears the destructive token.
    assert.match(
      css,
      /\.chat-panel__session-menu button\.chat-panel__session-menu-danger\s*\{[\s\S]*?color:\s*var\(--danger\)/,
    );
  });

  it("ChatPanel lists previous chats instead of a session dropdown", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.match(chat, /chat-panel__sessions/);
    assert.match(chat, /sessionLabel/);
    assert.match(chat, /formatSessionWhen/);
    assert.equal(chat.includes("chat-panel__session-select"), false);
    // No dropdown for choosing a chat: the list is the picker. The chain's rows
    // do carry one `<select>`, and it assigns a signal to a domain — the control
    // the Life-Chain page uses, not a second way to choose a chat. Pin both
    // halves, so neither a session select nor a second control slips in.
    assert.equal(
      (chat.match(/<select/g) ?? []).length,
      1,
      "the dock gained or lost a dropdown",
    );
    assert.match(
      chat,
      /className="chat-panel__chain-assign"[\s\S]{0,120}aria-label="Assign to domain"/,
    );
  });
});
