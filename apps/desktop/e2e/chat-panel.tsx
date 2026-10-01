/**
 * E2E harness for the Chat panel, driven by two scripts:
 *
 *  - `composer-autogrow.electron.mjs` — the composer's growth, its inline
 *    send/stop control and the turn-outcome note. Failure modes listed there.
 *  - `tool-run.electron.mjs` — how a turn's tool calls are shown. Failure modes
 *    listed there.
 *
 * This is a system-in-isolation rig: the real ChatPanel, the real CSS, the real
 * layout engine and ResizeObserver, with only the IPC bridge stubbed (there is
 * no Electron preload on a dev-server page). The bridge records what the panel
 * calls and hands the driver a handle to push stream events back in, so nothing
 * here asserts against a mock of the panel's own logic.
 *
 * Stub rules:
 *  1. Bridge stubs masking real calls — anything ChatPanel reaches for that is
 *     not named here must not throw (hence the Proxy fallback).
 *  2. One session only — a second one exists so a driver can prove that opening
 *     another chat clears the previous turn's in-flight evidence, and each
 *     session answers with its own transcript so the switch is visible.
 *  3. Ready flag — the runner waits on `chatPanelHarnessReady` rather than a
 *     timer, so a slow first Vite transform cannot be mistaken for "the panel
 *     never rendered".
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";
// The real SSE decoder main uses, so a rig can feed a wire frame through the
// same function the stream does instead of hand-building the event object.
import { parseSseBlock } from "../electron/companion-client.ts";

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Composer autogrow harness",
  lastActive: 1_700_000_000,
};

/** The chat a driver switches to when proving a switch drops the old state. */
const OTHER_SESSION = {
  id: "harness-session-2",
  title: "Second chat",
  preview: "Another chat",
  lastActive: 1_700_000_100,
};

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

type ChatCall = { sessionId: string; input: string };

/** The rig's handles on the stubbed main process, driven from a driver script. */
type HarnessWindow = {
  __lqChatCalls?: ChatCall[];
  __lqStopCalls?: string[];
  /** Delay before the chat stream promise resolves, so a run can be observed live. */
  __lqChatDelay?: number;
  /** The callback ChatPanel registered for `companion:stream` events. */
  __lqEmit?: (evt: unknown) => void;
  /** The real SSE decoder, so a driver can prove a wire frame maps to an event. */
  __lqParseSse?: (raw: string) => unknown;
  chatPanelHarnessReady?: Promise<void>;
};

const harness = window as unknown as HarnessWindow;
harness.__lqChatDelay = 0;
harness.__lqParseSse = parseSseBlock;

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(null),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION, OTHER_SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: (id: string) =>
    ok(
      id === OTHER_SESSION.id
        ? [
            { role: "user" as const, content: "Second chat" },
            { role: "assistant" as const, content: "Loaded the other chat." },
          ]
        : [
            { role: "user" as const, content: "Composer harness" },
            { role: "assistant" as const, content: "Ready." },
          ],
    ),
  // Recorded so a rig can prove the inline control really submits, and held
  // open long enough to observe the streaming state.
  companionChatStream: async (payload: ChatCall) => {
    harness.__lqChatCalls = [...(harness.__lqChatCalls ?? []), payload];
    await new Promise((resolve) => setTimeout(resolve, harness.__lqChatDelay ?? 0));
    return ok(true);
  },
  companionRunStop: async (runId: string) => {
    harness.__lqStopCalls = [...(harness.__lqStopCalls ?? []), runId];
    return ok(true);
  },
  onCompanionStream: (cb: (evt: unknown) => void) => {
    harness.__lqEmit = cb;
    return () => {
      if (harness.__lqEmit === cb) harness.__lqEmit = undefined;
    };
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return () => ok(null);
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chat-panel.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <VaultProvider>
        <ChatDockProvider>
          <div className="shell">
            <div className="nav-rail" />
            <div className="shell__main" />
            <ChatPanel open onOpenChange={() => {}} />
          </div>
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the panel never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForComposer = () => {
  const el = document.querySelector(".chat-panel__composer-input");
  if (!el) {
    requestAnimationFrame(waitForComposer);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForComposer);

(window as unknown as { chatPanelHarnessReady: Promise<void> }).chatPanelHarnessReady = ready;
