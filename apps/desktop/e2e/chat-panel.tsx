/**
 * E2E harness for the Chat panel, driven by five scripts:
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
 *  - `turn-timeline.electron.mjs` — the whole turn: reasoning, tool rows,
 *    narration, answer, fold/footer and what history replays. It is the only
 *    rig that turns a capability descriptor on through `?caps=` and the only
 *    one that asks history for structured rows through `?history=timeline`;
 *    both are absent by default so the four rigs above keep the page they had.
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
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatsSidebar } from "@/components/hermes/ChatsSidebar";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { ChatSessionsProvider } from "@/state/ChatSessionsProvider";
import {
  CompanionProvider,
  useOptionalCompanion,
} from "@/state/CompanionProvider";
import { VaultProvider } from "@/state/VaultProvider";
import type {
  ChatStreamEvent,
  CompanionStreamFrame,
  HarnessSummary,
  HarnessTurnCapabilities,
  TranscriptMessage,
} from "@/vite-env";
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
 * Which capability descriptor this page should announce, chosen by `?caps=`:
 *
 *  - absent / `full` — every capability true, the way the built-in Pi harness
 *    reports itself. This is deliberately also the shape the dock falls back to
 *    when a harness page has no provider at all, so the four older rigs see
 *    exactly the panel they always saw.
 *  - `hermes` — the external sidekick's honest descriptor: results only arrive
 *    with the terminal snapshot, calls have no harness-measured duration, the
 *    thinking row is a sampled preview. The timeline rig proves the UI omits
 *    the live result disclosure rather than drawing an empty one.
 *  - `floor` — the minimum a harness must speak: tool rows, but no args, no
 *    results, no reasoning, no usage. A harness that says nothing gets a UI
 *    that claims nothing.
 */
const CAPABILITIES: Record<string, HarnessTurnCapabilities> = {
  full: {
    toolRows: true,
    toolArgs: true,
    toolCallIds: true,
    toolResultsLive: true,
    toolResultsOnSettle: true,
    toolDurations: true,
    toolProgress: true,
    reasoning: "delta",
    commentary: true,
    steps: true,
    usage: true,
    history: true,
    approvals: true,
    steering: true,
  },
  hermes: {
    toolRows: true,
    toolArgs: true,
    toolCallIds: false,
    toolResultsLive: false,
    toolResultsOnSettle: true,
    toolDurations: false,
    toolProgress: false,
    reasoning: "preview",
    commentary: true,
    steps: false,
    usage: true,
    history: true,
    approvals: true,
    steering: true,
  },
  floor: {
    toolRows: true,
    toolArgs: false,
    toolCallIds: false,
    toolResultsLive: false,
    toolResultsOnSettle: false,
    toolDurations: false,
    toolProgress: false,
    reasoning: "none",
    commentary: false,
    steps: false,
    usage: false,
    history: false,
    approvals: false,
    steering: false,
  },
};

const CAPS_MODE = new URLSearchParams(window.location.search).get("caps");
/** Only the timeline rig asks for a descriptor; the others keep the page they had. */
const WITH_CAPABILITIES = CAPS_MODE !== null;
const capabilities = CAPABILITIES[CAPS_MODE ?? "full"] ?? CAPABILITIES.full!;

/**
 * The two companions main's registry publishes, with this page's descriptor on
 * the active one. The dock reads the active entry's capabilities and nothing
 * else — it never branches on the harness id — so a rig changes the UI by
 * choosing the entry, exactly as switching companion does in the app.
 */
const HARNESS_SUMMARIES: HarnessSummary[] = [
  {
    id: "hermes",
    name: "Hermes",
    blurb: "External sidekick",
    kind: "external",
    active: true,
    icon: "hermes",
    capabilities,
  },
  {
    id: "pi",
    name: "Pi",
    blurb: "Built in",
    kind: "embedded",
    active: false,
    icon: "pi",
    capabilities: CAPABILITIES.full!,
  },
];

/**
 * The structured transcript the history leg reloads from, chosen by
 * `?history=timeline`.
 *
 * This is the shape the sessions API now projects: a user row, the assistant
 * row that requested three calls, one result row per call (ids answer the
 * requests, one FAILED), and the assistant row that is the answer of record
 * with the turn's usage. Reloading with this fixture and no stream frames at
 * all is how the rig proves history rebuilds the same turn the live stream
 * settled — one builder, two sources. Keep the tool names, arguments, failure
 * and answer in step with `e2e/turn-timeline.electron.mjs`; they are compared.
 */
const HISTORY_BASE = 1_700_100_000_000;
const HISTORY_ANSWER = "The composer is wired.";
const HISTORY_TRANSCRIPT: TranscriptMessage[] = [
  { role: "user", content: "Do the thing", at: HISTORY_BASE },
  {
    role: "assistant",
    content: "",
    at: HISTORY_BASE + 400,
    toolCalls: [
      { id: "call_read", name: "read_file", args: { path: "AGENTS.md" } },
      { id: "call_search", name: "search_files", args: { query: "composer" } },
      { id: "call_term", name: "terminal", args: { command: "npm test" } },
    ],
  },
  {
    role: "tool",
    content: "Read 42 lines.",
    at: HISTORY_BASE + 1_600,
    toolCallId: "call_read",
    toolName: "read_file",
  },
  {
    role: "tool",
    content: "3 matches in src/components/hermes.",
    at: HISTORY_BASE + 3_300,
    toolCallId: "call_search",
    toolName: "search_files",
  },
  {
    role: "tool",
    content: "Command failed: exit 1",
    at: HISTORY_BASE + 5_400,
    toolCallId: "call_term",
    toolName: "terminal",
    isError: true,
  },
  {
    role: "assistant",
    content: HISTORY_ANSWER,
    at: HISTORY_BASE + 6_000,
    usage: { input: 1200, output: 240, total: 1440 },
  },
];
const HISTORY_TIMELINE =
  new URLSearchParams(window.location.search).get("history") === "timeline";


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
  /**
   * The real SSE decoder plus the emit, in one call: the timeline rig hands in
   * the raw block the gateway would send and gets back the event the panel
   * received, so its assertions are made against the wire format rather than a
   * hand-built event object.
   */
  __lqEmitSseFor?: (sessionId: string, raw: string) => unknown;
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
harness.__lqEmitSseFor = (sessionId: string, raw: string) => {
  // The app's own decoder, not a fixture: a frame the gateway could send but
  // this function returns null for is a wire gap, and the rig is told so.
  const evt = parseSseBlock(raw);
  if (!evt) return null;
  if (!harness.__lqEmitFor) throw new Error("the chat panel is not subscribed to the stream yet");
  harness.__lqEmitFor(sessionId, evt);
  return evt;
};
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
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION, OTHER_SESSION]),
  // The two companions, the active one carrying this page's descriptor. Only a
  // page opened with `?caps=` mounts the provider that reads this; the same two
  // entries main's registry publishes keep the shape honest.
  companionHarnesses: () => Promise.resolve(HARNESS_SUMMARIES),
  // The provider asks for a status and a profile list on mount. Answers that are
  // true for a harness page (a companion that is up, no Hermes profiles) keep
  // the dock on the same screen the older rigs measure. These three are raw
  // values, not `Result`s: main's preload promises the value itself, and the
  // provider reads them that way.
  companionEnsure: () =>
    Promise.resolve({ kind: "ready" as const, harness: "hermes" as const, detail: "Ready" }),
  companionProfilesList: () => Promise.resolve({ profiles: [], active: "default" }),
  onCompanionStatusChanged: () => () => {},
  // The composer's pills read this. `?nocatalog=1` is the companion-not-up
  // state: the panel must then render no row at all.
  companionModelOptions: () =>
    NO_CATALOG
      ? Promise.resolve({ ok: false as const, error: "no catalog" })
      : ok(MODEL_CATALOG),
  companionSessionCreate: () => ok(SESSION),
  // The shipping parser is what turns the gateway's epoch-seconds `timestamp`
  // into the transcript's own time, so the harness sends wire rows through it.
  // `?history=timeline` swaps the first chat's rows for the structured shape
  // the sessions API now returns, so a reload can be compared with the live
  // turn it settled; every other page keeps the flat bubbles it always had.
  companionSessionMessages: (id: string) => {
    openSessionId = id;
    if (HISTORY_TIMELINE && id !== OTHER_SESSION.id) return ok(HISTORY_TRANSCRIPT);
    return ok(
      messagesFromPayload({
        data:
          id === OTHER_SESSION.id
            ? [
                { role: "user", content: "Second chat", timestamp: 1_700_000_100 },
                { role: "assistant", content: "Loaded the other chat.", timestamp: 1_700_000_101 },
              ]
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
// this page is shared by five rigs. A chat left in front by the previous run
// would decide the landing before a rig clicked anything — enough to make the
// same rig pass on a fresh profile and fail on the next one. Pins are
// deliberately NOT cleared: that memory is what the pills rig proves survives a
// launch, from this same profile.
window.localStorage.removeItem("lifequest.companion.openTabs");
window.localStorage.removeItem("lifequest.companion.lastSessionId");

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chat-panel.html");

/**
 * The provider stack the app gives the dock. `CompanionProvider` is mounted
 * only when a rig asked for a capability descriptor (`?caps=`), because it is
 * the provider that tells the dock which harness is answering — and the four
 * older rigs were written against a page that has none, where the dock's
 * full-capability fallback is what they see. Same tree either way, so the
 * timeline rig is still measuring the app's own layout.
 */
const shell = (
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
            <ChatPanel open onOpenChange={() => {}} />
          </div>
        </ChatSessionsProvider>
      </ChatDockProvider>
    </VaultProvider>
  </MemoryRouter>
);

function WhenHarnessesAreKnown({ children }: { children: ReactNode }) {
  const companion = useOptionalCompanion();
  const known = (companion?.harnesses?.length ?? 0) > 0;
  return known ? <>{children}</> : null;
}

createRoot(root).render(
  <StrictMode>
    {WITH_CAPABILITIES ? (
      <CompanionProvider>
        {/* The app mounts this provider long before the dock opens; this page
            opens the dock immediately, so the dock store must not mount until
            the harness list has arrived. Otherwise the switch-reset a real
            companion change triggers fires on the first read and clears the
            landing the dock just resumed. */}
        <WhenHarnessesAreKnown>{shell}</WhenHarnessesAreKnown>
      </CompanionProvider>
    ) : (
      shell
    )}
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
