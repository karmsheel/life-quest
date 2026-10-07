/**
 * E2E harness for the Chat panel, driven by four scripts:
 *
 *  - `composer-autogrow.electron.mjs` — the composer's growth, its inline
 *    send/stop control and the turn-outcome note. Failure modes listed there.
 *  - `tool-run.electron.mjs` — how a turn's tool calls are shown. Failure modes
 *    listed there.
 *  - `composer-model-pills.electron.mjs` — the model and thinking pills.
 *  - `receipt-attach.electron.mjs` — the receipt the composer attaches, and the
 *    turn it rides. Its composer leg ends at this page's stubbed bridge: a
 *    dev-server page has no preload, so the real `receipt:attach` handler is
 *    exercised in that rig's other leg, against a real vault. Failure modes
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

type ChatCall = {
  sessionId: string;
  input: string;
  runtime?: unknown;
  receiptRelPath?: string | null;
};

/**
 * What the stubbed `receipt:attach` answers with, and the case a driver asks
 * for with `?attachfail=1`: a refusal must show on the composer and leave no
 * chip behind. The path is the shape main mints, so a driver can assert the
 * panel put exactly that string on the turn.
 */
const ATTACHED_REL_PATH =
  "domains/financial/data/files/11111111-2222-3333-4444-555555555555/receipt.jpg";
const ATTACH_FAILS = new URLSearchParams(window.location.search).has("attachfail");

/**
 * The composer control row's fixture: the shape `GET /api/model/options` answers
 * with (providers → models, plus each model's own capability flags), trimmed to
 * the cases the pills branch on —
 *
 *   - `space-bunny-alpha` (the profile default): thinking, but it cannot be
 *     switched off, so the pill shows and "Off" does not.
 *   - `gpt-6-sol`: thinking that may be switched off.
 *   - `kimi-linear`: no reasoning control at all, so the thinking pill is gone.
 *   - `fireworks`: a provider with no credential — offered, inert.
 *
 * Loaded from the page's query string so a driver can also prove the *absence*
 * state: `?nocatalog=1` answers with a failure, which is what a companion that
 * is not up yet looks like to the panel.
 */
const MODEL_CATALOG = {
  providers: [
    {
      slug: "nous",
      name: "Nous Portal",
      authenticated: true,
      models: [
        { id: "stealth/space-bunny-alpha", reasoning: true, canDisableReasoning: false, fast: false },
        { id: "openai/gpt-6-sol", reasoning: true, canDisableReasoning: true, fast: true },
        { id: "moonshotai/kimi-linear", reasoning: false, canDisableReasoning: false, fast: false },
      ],
    },
    {
      slug: "anthropic",
      name: "Anthropic",
      authenticated: true,
      models: [
        { id: "anthropic/claude-opus-5", reasoning: true, canDisableReasoning: true, fast: true },
      ],
    },
    {
      slug: "fireworks",
      name: "Fireworks",
      authenticated: false,
      models: [{ id: "fireworks/llama-4", reasoning: false, canDisableReasoning: false, fast: false }],
    },
  ],
  current: { model: "stealth/space-bunny-alpha", provider: "nous" },
};

const NO_CATALOG = new URLSearchParams(window.location.search).has("nocatalog");

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
  /** Every `receiptAttach` the panel made, in order. */
  __lqAttachCalls?: { mime: string; name: string; bytes: number }[];
  chatPanelHarnessReady?: Promise<void>;
};

const harness = window as unknown as HarnessWindow;
harness.__lqChatDelay = 0;
harness.__lqParseSse = parseSseBlock;
harness.__lqAttachCalls = [];

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(null),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION, OTHER_SESSION]),
  // The composer's pills read this. `?nocatalog=1` is the companion-not-up
  // state: the panel must then render no row at all.
  companionModelOptions: () =>
    NO_CATALOG
      ? Promise.resolve({ ok: false as const, error: "no catalog" })
      : ok(MODEL_CATALOG),
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
  // Answers the way main does: the stored path back, never the bytes. Records
  // what the panel sent so a driver can prove the file it picked is the file it
  // asked about.
  receiptAttach: async (input: { bytes: Uint8Array; mime: string; name: string }) => {
    harness.__lqAttachCalls = [
      ...(harness.__lqAttachCalls ?? []),
      { mime: input.mime, name: input.name, bytes: input.bytes?.byteLength ?? 0 },
    ];
    if (ATTACH_FAILS) {
      return { ok: false as const, error: "Receipts must be JPEG or PNG images." };
    }
    return ok({
      relPath: ATTACHED_REL_PATH,
      fileId: "11111111-2222-3333-4444-555555555555",
      name: input.name,
      size: input.bytes?.byteLength ?? 0,
    });
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
