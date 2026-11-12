/**
 * E2E harness for the Chat panel, shared by every rig that drives it:
 *
 *  - `composer-autogrow.electron.mjs` — the composer's growth, its inline
 *    send/stop control and the turn-outcome note. Failure modes listed there.
 *  - `transcript-anchor.electron.mjs` — where the transcript's bottom edge sits
 *    while the composer grows (this page's `?longthread=1` and `?longchain=1`),
 *    and that it re-attaches to the thread after the dock is collapsed and
 *    reopened. Failure modes listed there.
 *  - `tool-run.electron.mjs` — how a turn's tool calls are shown. Failure modes
 *    listed there.
 *  - `composer-model-pills.electron.mjs` — the model and thinking pills.
 *  - `composer-keys-attachments.electron.mjs` — the composer's keys, the
 *    attachment chips and the steer/queue gestures.
 *  - `chat-bubble-meta.electron.mjs` and `companion-paused.electron.mjs` — the
 *    message presentation and the paused-companion surface (their own files).
 *  - `receipt-attach.electron.mjs` — the receipt the composer attaches, and the
 *    turn it rides. Its composer leg ends at this page's stubbed bridge: a
 *    dev-server page has no preload, so the real `receipt:attach` handler is
 *    exercised in that rig's other leg, against a real vault. Failure modes
 *    listed there.
 *
 * This is a system-in-isolation rig: the real ChatPanel, the real sidebar, the
 * real CSS, the real layout engine and ResizeObserver, with only the IPC bridge
 * stubbed (there is no Electron preload on a dev-server page). The bridge
 * records what the panel calls and hands the driver a handle to push stream
 * events back in, so nothing here asserts against a mock of the panel's own
 * logic.
 *
 * The sidebar is mounted because the dock no longer carries a history picker:
 * the chats live in `ChatsSidebar` (the rail's list), so a rig that switches
 * chats picks the row the way the operator does. The provider sits above both
 * surfaces so the row and the dock share one store — the same arrangement
 * `AppShell` gives them.
 *
 * Stub rules:
 *  1. Bridge stubs masking real calls — anything ChatPanel or ChatsSidebar
 *     reaches for that is not named here must not throw (hence the Proxy
 *     fallback).
 *  2. One session only — a second one exists so a driver can prove that opening
 *     another chat clears the previous turn's in-flight evidence, and each
 *     session answers with its own transcript so the switch is visible.
 *  3. Ready flag — the runner waits on `chatPanelHarnessReady` rather than a
 *     timer, so a slow first Vite transform cannot be mistaken for "the panel
 *     never rendered".
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatsSidebar } from "@/components/hermes/ChatsSidebar";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { ChatSessionsProvider } from "@/state/ChatSessionsProvider";
import { VaultProvider } from "@/state/VaultProvider";
import type { ChatStreamEvent, CompanionStreamFrame } from "@/vite-env";
import "@/styles/global.css";
// The real SSE decoder main uses, so a rig can feed a wire frame through the
// same function the stream does instead of hand-building the event object.
import {
  messagesFromPayload,
  parseSseBlock,
} from "../electron/companion-client.ts";

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
  attachments?: Array<{
    id: string;
    kind: "image" | "video" | "audio" | "file";
    name: string;
    mime: string;
    size: number;
  }> | null;
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

/**
 * `?longthread=1` answers with a transcript long enough to overflow the body.
 *
 * The transcript-anchor rig is about where the thread's bottom edge sits while
 * the composer grows, and the two-message fixture is short enough that no growth
 * can move anything: a scroll port that never scrolls cannot show whether its
 * end was kept. Opt-in rather than the default, because every other rig shares
 * this page and measures a small, stable transcript.
 */
const LONG_THREAD = new URLSearchParams(window.location.search).has("longthread");

/**
 * The long thread: 24 turns, oldest first, each pair tall enough that a dozen
 * of them overflow the dock's body at any window size the rig uses.
 */
const LONG_THREAD_MESSAGES = Array.from({ length: 24 }, (_, i) => [
  {
    role: "user",
    content: `Long thread turn ${i + 1}`,
    timestamp: 1_700_000_000 + i * 90,
  },
  {
    role: "assistant",
    content: `Reply ${i + 1}. ${"A sentence the operator is reading. ".repeat(3)}`,
    timestamp: 1_700_000_045 + i * 90,
  },
]).flat();

/**
 * `?longchain=1` answers the chain's read with enough signals to overflow its
 * body.
 *
 * The dock has two surfaces with the same composer idiom — the thread and Quick
 * Notes — and the anchor rig has to prove the same end-keeping on both: the
 * chain composer grows exactly like the thread's, so the newest signal must keep
 * sitting just above it. Opt-in for the same reason the long thread is: every
 * other rig shares this page, and the chain read falls through the stubbed
 * bridge to an empty answer otherwise.
 */
const LONG_CHAIN = new URLSearchParams(window.location.search).has("longchain");

/** The long chain: 24 text signals, newest first the way the vault returns them. */
const LONG_CHAIN_SIGNALS = Array.from({ length: 24 }, (_, i) => {
  const at = new Date(1_700_000_000_000 + (24 - i) * 60_000).toISOString();
  return {
    id: `signal-long-${24 - i}`,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    type: "thought",
    source: "manual",
    sourceRef: null,
    title: `Signal ${24 - i}`,
    body: `A note the operator is reading, number ${24 - i}. ${"It carries a sentence. ".repeat(2)}`,
    domainSlug: null,
    attachment: null,
  };
});

/** The rig's handles on the stubbed main process, driven from a driver script. */
type HarnessWindow = {
  __lqChatCalls?: ChatCall[];
  __lqStopCalls?: string[];
  /** Delay before the chat stream promise resolves, so a run can be observed live. */
  __lqChatDelay?: number;
  /** The callback ChatPanel registered for `companion:stream` frames. */
  __lqEmit?: (evt: unknown) => void;
  /** Emit a frame for an explicit chat, so a rig can prove the routing. */
  __lqEmitFor?: (sessionId: string, evt: unknown) => void;
  /** The real SSE decoder, so a driver can prove a wire frame maps to an event. */
  __lqParseSse?: (raw: string) => unknown;
  /** Every `receiptAttach` the panel made, in order. */
  __lqAttachCalls?: { mime: string; name: string; bytes: number }[];
  /** Every `attachmentAttach` the panel made, in order. */
  __lqAttachmentCalls?: { mime: string; name: string; bytes: number }[];
  /** Every `companionRunSteer` the panel made, in order. */
  __lqSteerCalls?: { runId: string; text: string }[];
  chatPanelHarnessReady?: Promise<void>;
};

const harness = window as unknown as HarnessWindow;
harness.__lqChatDelay = 0;
harness.__lqParseSse = parseSseBlock;
harness.__lqAttachCalls = [];
harness.__lqAttachmentCalls = [];
harness.__lqSteerCalls = [];

/**
 * The chat the panel has open, as far as the bridge can see: its transcript was
 * the last one asked for. Main stamps every frame with the chat it belongs to,
 * so the harness's single-chat emitters use this to name the same one.
 */
let openSessionId = SESSION.id;

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(null),
  vaultListRecent: () => Promise.resolve([]),
  // The chain's read, only on request: `?longchain=1` answers with the long
  // fixture so the anchor rig can grow Quick Notes' composer over a scrolled
  // transcript. Every other rig keeps the stubbed fallback an empty chain.
  ...(LONG_CHAIN
    ? {
        signalChainList: () =>
          ok({ records: LONG_CHAIN_SIGNALS, skipped: 0 }),
      }
    : {}),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION, OTHER_SESSION]),
  // The composer's pills read this. `?nocatalog=1` is the companion-not-up
  // state: the panel must then render no row at all.
  companionModelOptions: () =>
    NO_CATALOG
      ? Promise.resolve({ ok: false as const, error: "no catalog" })
      : ok(MODEL_CATALOG),
  companionSessionCreate: () => ok(SESSION),
  // The shipping parser is what turns the gateway's epoch-seconds `timestamp`
  // into the transcript's own time, so the harness sends wire rows through it.
  companionSessionMessages: (id: string) => {
    openSessionId = id;
    return ok(
      messagesFromPayload({
        data:
          id === OTHER_SESSION.id
            ? [
                { role: "user", content: "Second chat", timestamp: 1_700_000_100 },
                { role: "assistant", content: "Loaded the other chat.", timestamp: 1_700_000_101 },
              ]
            : LONG_THREAD
              ? LONG_THREAD_MESSAGES
              : [
                  { role: "user", content: "Composer harness", timestamp: 1_700_000_000 },
                  { role: "assistant", content: "Ready.", timestamp: 1_700_000_002 },
                ],
        }),
      );
  },
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
  // The general attachment: any media or file, stored in main and named back
  // by an id the turn can carry. The kind is decided by the mime, the way main
  // decides it, so a rig that picks a clip gets a clip.
  attachmentAttach: async (input: { bytes: Uint8Array; mime: string; name: string }) => {
    harness.__lqAttachmentCalls = [
      ...(harness.__lqAttachmentCalls ?? []),
      { mime: input.mime, name: input.name, bytes: input.bytes?.byteLength ?? 0 },
    ];
    const mime = input.mime ?? "";
    const kind = mime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
          ? "audio"
          : "file";
    return ok({
      id: `att-${(harness.__lqAttachmentCalls ?? []).length}`,
      kind,
      name: input.name,
      size: input.bytes?.byteLength ?? 0,
      mime,
      relPath: `attachments/${input.name}`,
    });
  },
  // The steer: the words go into the run that is already working.
  companionRunSteer: async (runId: string, text: string) => {
    harness.__lqSteerCalls = [...(harness.__lqSteerCalls ?? []), { runId, text }];
    return ok(true);
  },
  onCompanionStream: (cb: (frame: CompanionStreamFrame) => void) => {
    // The panel's subscriber takes frames, the way main sends them. The
    // single-chat handles below stay raw-event-shaped for the existing rigs and
    // stamp the chat whose transcript was asked for last; `__lqEmitFor` is the
    // explicit form a parallel-run rig uses.
    const emit = (evt: unknown) => cb({ sessionId: openSessionId, event: evt as ChatStreamEvent });
    harness.__lqEmit = emit;
    harness.__lqEmitFor = (sessionId: string, evt: unknown) =>
      cb({ sessionId, event: evt as ChatStreamEvent });
    return () => {
      if (harness.__lqEmit === emit) harness.__lqEmit = undefined;
      if (harness.__lqEmitFor) harness.__lqEmitFor = undefined;
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

// The dock remembers the chat it opened last and its tab strip between runs, and
// this page is shared by four rigs. A chat left in front by the previous run
// would decide the landing before a rig clicked anything — enough to make the
// same rig pass on a fresh profile and fail on the next one. Pins are
// deliberately NOT cleared: that memory is what the pills rig proves survives a
// launch, from this same profile.
window.localStorage.removeItem("lifequest.companion.openTabs");
window.localStorage.removeItem("lifequest.companion.lastSessionId");

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chat-panel.html");

/**
 * The dock with its open state live.
 *
 * The app's shell owns that state (`AppShell` passes it down and the dock's own
 * bar carries the way out), and a harness that hard-coded `open` would make
 * collapse/reopen undrivable — which is how "the transcript's end-keeping
 * re-attaches when the dock comes back" would go untested. The thread-anchor rig
 * collapses the dock and reopens it to prove the watch follows the new body.
 */
function HarnessDock() {
  const [open, setOpen] = useState(true);
  return <ChatPanel open={open} onOpenChange={setOpen} />;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <VaultProvider>
        <ChatDockProvider>
          <ChatSessionsProvider>
            <div className="shell">
              {/* The rail's own column, with the real list in it: switching
                  chats is a sidebar row now, and a driver that reached into
                  the dock for a history picker would be measuring a surface
                  the app no longer ships. */}
              <div className="nav-rail">
                <ChatsSidebar />
              </div>
              <div className="shell__main" />
              <HarnessDock />
            </div>
          </ChatSessionsProvider>
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the panel never rendered". The sidebar rows
// are part of the surface now: a rig that clicks one must not race the list's
// first read, which is the bridge call this page answers from a fixture.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForSurface = () => {
  const composer = document.querySelector(".chat-panel__composer-input");
  const rows = document.querySelectorAll(".chats-rail__row-main").length;
  if (!composer || rows === 0) {
    requestAnimationFrame(waitForSurface);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForSurface);

(window as unknown as { chatPanelHarnessReady: Promise<void> }).chatPanelHarnessReady = ready;
