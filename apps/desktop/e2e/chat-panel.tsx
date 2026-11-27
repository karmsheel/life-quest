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
 *    attachment chips and the steer/queue gestures. It ends by storing Settings
 *    → Composer's "enter" keyboard and reloading this page — its final leg, so
 *    it is the last thing measured and no later leg sees the other keyboard.
 *  - `chat-bubble-meta.electron.mjs` and `companion-paused.electron.mjs` — the
 *    message presentation and the paused-companion surface (their own files).
 *  - `receipt-attach.electron.mjs` — the picture the composer's chip promotes
 *    into a receipt, and the turn it rides. Its composer leg ends at this
 *    page's stubbed bridge: a dev-server page has no preload, so the real
 *    `receipt:promote` handler is exercised in that rig's other leg, against a
 *    real vault. Failure modes listed there.
 *  - `turn-timeline.electron.mjs` — the whole turn: reasoning, tool rows,
 *    narration, answer, fold/footer and what history replays. It is the only
 *    rig that turns a capability descriptor on through `?caps=` and the only
 *    one that asks history for structured rows through `?history=timeline`;
 *    both are absent by default so the four rigs above keep the page they had.
 *  - `dock-chrome.electron.mjs` — the dock's own chrome: the thread's name chip
 *    under the tab strip, the composer's side gutters as the dock widens, and
 *    where the agent switcher stands in them. It is the only rig that mounts
 *    `AgentsProvider` (`?agents=1`) so the real switcher draws in the footer;
 *    absent by default so every other rig's page is unchanged. Failure modes
 *    listed there.
 *  - `chat-display.electron.mjs` — the reading settings the transcript wears:
 *    the shipped 1.5 line spacing, the Ctrl+wheel / Ctrl+= / Ctrl+- / Ctrl+0
 *    zoom, and the localStorage pair shared with Settings → Chat display. It is
 *    the only rig that mounts `ChatDisplayProvider` (`?reading=1`); absent by
 *    default so every other rig's page is unchanged. Failure modes listed
 *    there.
 *  - `chat-images.electron.mjs` — pictures in the thread: the markdown picture
 *    an answer names, the gateway's `[Image attached at: …]` / `[screenshot]`
 *    markers a reloaded operator row carries, the quiet missing chip, the
 *    thumbnail overlay, a live answer's picture and the composer's sent
 *    thumbnail. It is the only rig that opens the page with `?images=1` and the
 *    only one that answers `chatImageRead`; both are absent by default so every
 *    other rig's page answers exactly what it answered before. Failure modes
 *    listed there.
 *
 * The agent picker's recipe modes are opt-in through `?picker=<mode>` (see the
 * flag itself below): the mode is the theme's chrome, so that page — and only
 * that page — mounts the real `ThemeProvider` and forces the pick through
 * `setChromeOverride`, the same door Settings → Appearance uses. Pair it with
 * `?agents=1`, because the switcher reads the agents provider.
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
 *  4. Recorded writes — a session patch (rename, pin, archive) is a durable
 *     Hermes flag the panel asks main to write; the rig's bridge records it so
 *     a driver can prove the name chip's field really committed the name it
 *     held, rather than reading the panel's own optimistic copy.
 */
import { StrictMode, useEffect, useState, type ReactNode } from "react";
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
import { AgentsProvider } from "@/state/AgentsProvider";
import { ChatDisplayProvider } from "@/state/ChatDisplayProvider";
import { VaultProvider } from "@/state/VaultProvider";
import {
  ThemeProvider,
  useTheme,
} from "@/components/theme/ThemeProvider";
import {
  AGENT_PICKER_CHOICES,
  AGENT_PICKER_LABELS,
  AGENT_PICKER_RINGS,
  AGENT_PICKER_ROSTERS,
  AGENT_PICKER_SIZES,
  type AgentPickerChoice,
  type AgentPickerChoiceMode,
  type AgentPickerRecipe,
} from "../shared/agent-picker.ts";
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
  instructionsContext?: {
    phoneDrafts?: Array<{ clientId: string; text: string; captureDate: string }>;
  };
  attachments?: Array<{
    id: string;
    kind: "image" | "video" | "audio" | "file";
    name: string;
    mime: string;
    size: number;
  }> | null;
};

/**
 * Where the stubbed `receipt:promote` says the finance store put the picture.
 *
 * The directory is the shape main mints and the file keeps the attachment's own
 * name, so a driver can assert the panel put exactly that string on the turn.
 * `?attachfail=1` is the refusal case: a promotion that fails must show on the
 * composer and leave the attachment chip exactly where it was. `?attachfail=second`
 * promotes the first picture, then refuses the next: the receipt slot already
 * holds a picture the operator chose, and a later refusal must not clear it.
 */
const PROMOTED_DIR =
  "domains/financial/data/files/11111111-2222-3333-4444-555555555555";
const QUERY = new URLSearchParams(window.location.search);
const ATTACH_FAIL_MODE = QUERY.get("attachfail");
/** Every promotion on this page is refused (`?attachfail=1`). */
const ATTACH_FAILS = ATTACH_FAIL_MODE !== null && ATTACH_FAIL_MODE !== "second";
/** The first promotion succeeds; later ones are refused (`?attachfail=second`). */
const ATTACH_FAILS_AFTER_FIRST = ATTACH_FAIL_MODE === "second";

/**
 * `?nokit=1` answers the receipt-readiness read `false`, which is a vault whose
 * Finance kit is missing or whose Financial area is not live: a picture's chip
 * must then offer no "Use as receipt", because there is no finance file store to
 * cite. The default answer is ready, so the action is on screen in every rig
 * that does not ask otherwise — the generic stub would answer `ok(null)`, which
 * reads as not ready and would hide the action everywhere.
 */
const NO_KIT = QUERY.has("nokit");

/**
 * What the phone door answers with when the page is loaded with `?phone=1`.
 * The draft's id is a real UUID because the renderer only forbids nothing —
 * the point of the leg is that the panel hands the turn the id it was shown.
 */
const PHONE_DRAFTS = new URLSearchParams(window.location.search).has("phone")
  ? [
      {
        clientId: "00000000-0000-4000-8000-000000000001",
        text: "R85 Pick n Pay food",
        captureDate: "2026-10-25",
        deviceName: "iPhone",
      },
    ]
  : [];

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
 * `?decisionfence=1` answers the first chat with a reply that ends in a
 * `lifequest-decision` fence — the prose the operator reads, then the block main
 * parses and files. The fence has to stay in the stored content (stripping it
 * would file nothing), so the panel must hide it at display time: one card
 * reading DECISION: and what it changes, opening on demand. The body is the
 * shape the companion emits for a library note, so a driver can compare the
 * summary line against a real proposal rather than a stub of one.
 */
const DECISION_FENCE_REPLY = [
  "Two things came out of the week, and one change is waiting for you to approve.",
  "",
  "```lifequest-decision",
  JSON.stringify({
    kind: "library",
    title: "Project rule — build at level 2 dev by default",
    domainSlugs: ["intellectual"],
    body: "Default to level 2 dev: worktrees per workstream, e2e tests, remote build tested locally.",
  }),
  "```",
].join("\n");

const WITH_DECISION_FENCE = new URLSearchParams(window.location.search).has("decisionfence");


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
 * `?agents=1` mounts the real agents provider, so the dock's agent switcher
 * draws the two companions main's registry publishes.
 *
 * The switcher reads `useOptionalAgents`, so without this provider it draws
 * nothing at all — which is the page every other rig was written against and
 * must keep. Opt-in for the same reason `?caps=` is: this page is shared, and a
 * provider that put a control on the screen would change what the other rigs
 * measure. The dock-chrome rig is the only one that asks.
 */
const AGENTS_MODE = new URLSearchParams(window.location.search).has("agents");

/**
 * `?reading=1` mounts the reading-settings provider, so the transcript wears the
 * size and line spacing Settings → Chat display holds, and `Ctrl`/`Cmd` + wheel
 * and `Ctrl` `+`/`-`/`0` step it.
 *
 * The dock reads `useOptionalChatDisplay`, so without this provider it draws the
 * shipped defaults and answers no zoom gesture — which is the page every other
 * rig was written against and must keep. Opt-in for the same reason `?caps=` and
 * `?agents=` are: this page is shared, and a provider that moved the transcript's
 * type would change what the other rigs measure. The chat-display rig is the
 * only one that asks.
 */
const READING_MODE = new URLSearchParams(window.location.search).has("reading");

/**
 * `?picker=<mode>` wears one of the agent picker's recipes on the dock, so a rig
 * can measure every mode the theme contract names instead of only the default.
 *
 * The picker's shape *is* the worn theme's chrome, so a page that shows anything
 * other than the shipped `one-mark` needs the real `ThemeProvider` above the
 * dock. It is opt-in for the same reason `?agents=` is: the provider repaints the
 * document with a skin and writes the shell's chrome onto `<html>`, and every
 * older rig was written against the page without it. Mount it together with
 * `?agents=1` — without the agents provider the switcher draws nothing.
 *
 * The mode is applied through the provider's own `setChromeOverride`, the door
 * Settings → Appearance uses, so the page proves the recipe path the operator
 * gets rather than a harness-only shortcut. `custom` takes the four axes as
 * extra params: `?picker=custom&roster=inline&labels=all&ring=hairline&size=large`.
 * A shipped mode accepts axes too (a mode is a preset, and a choice may layer
 * one axis over it) — the same shape a theme file is parsed into.
 */
const PICKER_QUERY = new URLSearchParams(window.location.search);
const PICKER_MODE = PICKER_QUERY.get("picker");
const WITH_PICKER_THEME = PICKER_MODE !== null;

/** One axis from the URL, or `undefined` for "the preset's own value". */
function pickerAxis<T extends string>(name: string, allowed: readonly T[]): T | undefined {
  const raw = PICKER_QUERY.get(name);
  return raw !== null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;
}

/**
 * The choice a `?picker=` page forces, validated against the closed vocabulary
 * the theme parser uses. A typo is a loud failure rather than a page that
 * silently measures the default mode — the whole point of the flag is to prove
 * the *other* modes.
 */
const FORCED_PICKER: AgentPickerChoice = (() => {
  const raw = PICKER_MODE ?? "one-mark";
  if (!(AGENT_PICKER_CHOICES as readonly string[]).includes(raw)) {
    throw new Error(
      `?picker=${raw} is not one of ${AGENT_PICKER_CHOICES.join(", ")}`,
    );
  }
  const mode = raw as AgentPickerChoiceMode;
  const recipe: Partial<AgentPickerRecipe> = {};
  const roster = pickerAxis("roster", AGENT_PICKER_ROSTERS);
  if (roster) recipe.roster = roster;
  const labels = pickerAxis("labels", AGENT_PICKER_LABELS);
  if (labels) recipe.labels = labels;
  const ring = pickerAxis("ring", AGENT_PICKER_RINGS);
  if (ring) recipe.ring = ring;
  const size = pickerAxis("size", AGENT_PICKER_SIZES);
  if (size) recipe.size = size;
  return Object.keys(recipe).length > 0 ? { mode, recipe } : { mode };
})();

/**
 * Paint the forced pick through the theme provider, once, on mount.
 *
 * `setChromeOverride` is the real Settings door (`layerAgentPicker` in
 * `ThemeProvider`), so a rig can prove the same path the operator's own pick
 * takes. The pick is constant for the page's lifetime; a `?picker=` page that
 * could change it would be a second feature, and the reload is cheap.
 */
function ForcedPicker() {
  const { setChromeOverride } = useTheme();
  useEffect(() => {
    setChromeOverride({ agentPicker: FORCED_PICKER });
  }, [setChromeOverride]);
  return null;
}

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

/**
 * `?images=1` answers the first chat with the gateway's persisted picture shape,
 * and serves `chatImageRead` from the page instead of from main.
 *
 * A reloaded Hermes row keeps the operator's picture as two markers — the
 * absolute hint of the copy the gateway retained, then `[screenshot]` — and the
 * agent's reply keeps a picture as markdown. The fixture is those exact shapes
 * run through `messagesFromPayload`, the shipping parser, so a rig proves the
 * marker pairing and the stripping rather than handing the panel rows it could
 * not have produced itself. Opt-in for the same reason `?caps=` and `?reading=`
 * are: this page is shared, and a thread with pictures would change what every
 * other rig measures.
 */
const IMAGES_MODE = new URLSearchParams(window.location.search).has("images");

/**
 * The bytes the stubbed read door returns: a real 120×80 PNG, carried as base64
 * because a dev-server page has no filesystem. It is big enough that the
 * artifact's picture is a picture and not a one-pixel speck — which matters,
 * because the run's screenshot is the artifact the operator opens — and it is
 * a decoded real PNG, so the renderer builds a blob an `<img>` can actually
 * paint rather than a fixture that only looks like one.
 */
const CHAT_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAYAAADSm7GJAAAA8klEQVR42u3doQ2AMBRF0S6GrGEKJkB3PDbAsQ4EhSGhCAQvR9wqTHtQvwmUsQ67civnsq2LAgMMWIAFWIAFWJ8At3mK6OkwEvfVDfz3N7kXOG1fgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwY8PWMzygFAycGGDBgwIABAwYMGDBgwIABG3QYVRpVAgYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABvwL2e9ng60KFX/gLsAALsAALsO6AldsBUAl2ewlaRXQAAAAASUVORK5CYII=";
const CHAT_IMAGE_BYTES = Uint8Array.from(atob(CHAT_IMAGE_BASE64), (char) =>
  char.charCodeAt(0),
);

/** The pictures fixture, in the gateway's own persisted shape (see IMAGES_MODE). */
const IMAGES_MESSAGES = {
  data: [
    {
      // A row that carried a picture: the words, a blank line, the absolute hint
      // of the gateway's retained copy, then the marker that says "and this one
      // was a picture". A parser that pairs them strips both lines and hands the
      // renderer the picture; the words survive exactly.
      role: "user",
      content:
        "look at this\n\n[Image attached at: /tmp/lifequest-e2e/native-inputs/present-user.png]\n[screenshot]",
      timestamp: 1_700_002_000,
    },
    {
      // An answer that names one picture the vault holds and one it does not:
      // the first must draw, the second must be the quiet missing chip rather
      // than the raw markdown or a broken-image glyph.
      role: "assistant",
      content:
        "Here is the plan:\n\n![the floor plan](attachments/chat/present-plan.png)\n\nand a missing one ![gone](attachments/chat/missing-plan.png)",
      timestamp: 1_700_002_004,
    },
  ],
};

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
  /** Every `receiptPromote` the panel made, in order, with the id it named. */
  __lqPromoteCalls?: { id: string }[];
  /** Every `attachmentAttach` the panel made, in order, with the id it minted. */
  __lqAttachmentCalls?: { id: string; mime: string; name: string; bytes: number }[];
  /**
   * Every `chatImageRead` the bubbles made, in order. The door itself is main's;
   * this page answers it from CHAT_IMAGE_BYTES, so the record is how a driver
   * proves which refs the thread actually named — including a refused one, which
   * must have been asked for exactly once.
   */
  __lqChatImageCalls?: { ref: string }[];
  /** Every `companionRunSteer` the panel made, in order. */
  __lqSteerCalls?: { runId: string; text: string }[];
  /**
   * Every `companionSessionPatch` the panel made, in order: the durable
   * rename/pin/archive flags. The dock-chrome rig reads the title patch after
   * pressing Enter in the name chip's own field.
   */
  __lqPatchCalls?: {
    id: string;
    patch: { title?: string; pinned?: boolean; archived?: boolean };
  }[];
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
harness.__lqPromoteCalls = [];
harness.__lqAttachmentCalls = [];
harness.__lqChatImageCalls = [];
harness.__lqSteerCalls = [];
harness.__lqPatchCalls = [];

/**
 * The chat the panel has open, as far as the bridge can see: its transcript was
 * the last one asked for. Main stamps every frame with the chat it belongs to,
 * so the harness's single-chat emitters use this to name the same one.
 */
let openSessionId = SESSION.id;

/**
 * What each stored attachment was, by the id the panel was handed.
 *
 * The promote stub answers with the name and size of the attachment the panel
 * named — the way main answers from the file it stored — so a rig that promotes
 * the wrong id cannot pass on a name nobody checked. It is the page's own
 * bookkeeping, kept out of `__lqAttachmentCalls` so that record stays the shape
 * the older rigs read.
 */
const attachmentFacts = new Map<string, { name: string; size: number }>();

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(null),
  vaultListRecent: () => Promise.resolve([]),
  // The real `ThemeProvider` reads these on mount on a `?picker=` page: an empty
  // themes folder, no kept file, and a watcher that answers a real teardown —
  // the provider calls the return value as a function and the Proxy fallback
  // would hand it a Promise. `windowChrome: null` is the caption-strip sync
  // saying "there is no native strip on this page"; the Proxy's fallback object
  // has no `setTitleBarOverlay`, and the sync would throw into the paint.
  themesList: () => ok([]),
  themeGetState: () => ok({ keptFile: null }),
  onThemesChanged: () => () => {},
  windowChrome: null,
  // The chain's read, only on request: `?longchain=1` answers with the long
  // fixture so the anchor rig can grow Notebox' composer over a scrolled
  // transcript. Every other rig keeps the stubbed fallback an empty chain.
  ...(LONG_CHAIN
    ? {
        signalChainList: () =>
          ok({ records: LONG_CHAIN_SIGNALS, skipped: 0 }),
      }
    : {}),
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: () => () => {},
  phone: {
    // Not `ok(...)`: `phone:queue` answers with the queue itself, unlike the
    // Result-returning calls around it. A stub that wraps it would hand the
    // panel `undefined` drafts and prove nothing.
    queue: () =>
      Promise.resolve({ drafts: PHONE_DRAFTS, count: PHONE_DRAFTS.length }),
    onChanged: () => () => {},
  },
  companionSessionsList: () => ok([SESSION, OTHER_SESSION]),
  // The durable session flags main writes (rename / pin / archive), recorded so
  // a driver can prove the name chip's field committed the name it held. The
  // reply is the session main mints; the store patches its row from the patch,
  // never from the reply, so the flags are the only thing a rig reads back.
  companionSessionPatch: async (
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ) => {
    harness.__lqPatchCalls = [...(harness.__lqPatchCalls ?? []), { id, patch }];
    return ok({ ...SESSION, ...patch });
  },
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
    // The pictures page answers the first chat with the marker-shaped fixture,
    // parsed by the shipping parser: the second chat keeps its plain transcript
    // so a driver can prove a picture-free thread draws no picture at all.
    if (IMAGES_MODE && id !== OTHER_SESSION.id) {
      return ok(messagesFromPayload(IMAGES_MESSAGES));
    }
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
                  ...(WITH_DECISION_FENCE
                    ? [{ role: "assistant", content: DECISION_FENCE_REPLY, timestamp: 1_700_000_003 }]
                    : []),
                ],
        }),
      );
  },
  // The picture read door. Main answers a refusal with one operator sentence —
  // the bubble's quiet missing chip — and this stub keeps that shape, deciding
  // by the file name: a `present…` picture reads, anything else does not. The
  // page has no vault, so the bytes are the fixture above; what a driver proves
  // here is the control's states and the refs the thread asked for, not main's
  // own guards (those are `chat-images.electron.mjs`'s other leg).
  chatImageRead: async (ref: string) => {
    const asked = String(ref ?? "");
    harness.__lqChatImageCalls = [
      ...(harness.__lqChatImageCalls ?? []),
      { ref: asked },
    ];
    const name = asked.split(/[\\/]/).pop() ?? "";
    return name.startsWith("present")
      ? ok({ bytes: CHAT_IMAGE_BYTES, mime: "image/png" })
      : { ok: false as const, error: "That picture could not be read." };
  },
  // Recorded so a rig can prove the inline control really submits, and held
  // open long enough to observe the streaming state.
  companionChatStream: async (payload: ChatCall) => {
    harness.__lqChatCalls = [...(harness.__lqChatCalls ?? []), payload];
    await new Promise((resolve) => setTimeout(resolve, harness.__lqChatDelay ?? 0));
    return ok(true);
  },
  // The bridge's answer to main's receipt-store predicate (`receipt:ready`):
  // the Finance kit installed AND the Financial area live. The panel asks this
  // before a picture's chip may offer "Use as receipt"; a page whose vault has
  // neither (`?nokit=1`) must answer false so the offer is absent, and every
  // other page answers true. The generic stub's `ok(null)` would read as not
  // ready for every rig, which would hide the action everywhere.
  receiptReady: () => ok(!NO_KIT),
  // Answers the way main does: the stored path back, never the bytes. Records
  // the id the panel named and answers with the name and size of the attachment
  // the page stored under it, so a driver can prove the chip's press names the
  // file the operator attached. `?attachfail=1` refuses every press with the
  // format message; `?attachfail=second` lets the first through and refuses the
  // next with the pixel-ceiling message, the refusal a second picture must get
  // while the receipt slot already holds the first.
  receiptPromote: async (input: { id: string }) => {
    harness.__lqPromoteCalls = [...(harness.__lqPromoteCalls ?? []), { id: input.id }];
    const attempts = (harness.__lqPromoteCalls ?? []).length;
    if (ATTACH_FAILS) {
      return { ok: false as const, error: "Receipts must be JPEG or PNG images." };
    }
    if (ATTACH_FAILS_AFTER_FIRST && attempts > 1) {
      return { ok: false as const, error: "That picture has more pixels than a receipt can hold." };
    }
    const held = attachmentFacts.get(input.id);
    if (!held) {
      return { ok: false as const, error: "That attachment is no longer waiting." };
    }
    return ok({
      relPath: `${PROMOTED_DIR}/${held.name}`,
      fileId: "11111111-2222-3333-4444-555555555555",
      name: held.name,
      size: held.size,
    });
  },
  companionRunStop: async (runId: string) => {
    harness.__lqStopCalls = [...(harness.__lqStopCalls ?? []), runId];
    return ok(true);
  },
  // The general attachment: any media or file, stored in main and named back
  // by an id the turn can carry. This stub decides the kind from the DECLARED
  // mime because the page already holds the operator's File and only needs the
  // chip's shape. Real main sniffs the bytes instead, so a mislabeled file is
  // classified by what it is — and that refusal is proved against the real
  // store in receipt-attach's main leg, not against this page.
  attachmentAttach: async (input: { bytes: Uint8Array; mime: string; name: string }) => {
    const calls = [
      ...(harness.__lqAttachmentCalls ?? []),
      { id: "", mime: input.mime, name: input.name, bytes: input.bytes?.byteLength ?? 0 },
    ];
    // The id is minted here the way main mints one, and recorded with the call
    // so a driver can check the id a promotion named is the id of the file it
    // attached.
    const id = `att-${calls.length}`;
    calls[calls.length - 1].id = id;
    harness.__lqAttachmentCalls = calls;
    const mime = input.mime ?? "";
    const kind = mime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
          ? "audio"
          : "file";
    const size = input.bytes?.byteLength ?? 0;
    attachmentFacts.set(id, { name: input.name, size });
    return ok({
      id,
      kind,
      name: input.name,
      size,
      mime,
      relPath: `attachments/files/${id}/${input.name}`,
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

/**
 * The dock with the providers it lives under, below the two that belong above
 * it. `AgentsProvider` is a child of `VaultProvider` because the switcher it
 * feeds reads the vault's agent scopes — the same order `App.tsx` mounts them
 * in — and only a page opened with `?agents=1` mounts it. Without the flag the
 * tree below the gate is exactly the page every older rig was written against.
 */
const dockProviders = (
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
);

function WhenHarnessesAreKnown({ children }: { children: ReactNode }) {
  const companion = useOptionalCompanion();
  const known = (companion?.harnesses?.length ?? 0) > 0;
  return known ? <>{children}</> : null;
}

/**
 * The provider stack the app gives the dock. `CompanionProvider` is mounted
 * only when a rig asked for a capability descriptor (`?caps=`) or the agents
 * provider (`?agents=1`), because it is the provider that tells the dock which
 * harness is answering — and the four older rigs were written against a page
 * that has none, where the dock's full-capability fallback is what they see.
 * Same tree either way, so every rig is still measuring the app's own layout.
 */
const shell = (
  <MemoryRouter>
    <VaultProvider>
      {AGENTS_MODE ? (
        <AgentsProvider>{dockProviders}</AgentsProvider>
      ) : (
        dockProviders
      )}
    </VaultProvider>
  </MemoryRouter>
);

/**
 * The same tree with the reading settings on top, when a rig asked for them.
 * The provider publishes the two custom properties the transcript multiplies its
 * type by and adds no markup of its own, so the page below the flag is the tree
 * every other rig measures.
 */
const readingShell = READING_MODE ? (
  <ChatDisplayProvider>{shell}</ChatDisplayProvider>
) : (
  shell
);

/**
 * The same page under the shell's real theme provider, only when a rig asked for
 * an agent-picker mode. `ThemeProvider` is where the picker's recipe lives, so
 * this is the one flag that needs it; a page without the flag keeps exactly the
 * tree every older rig measures. `ForcedPicker` sits beside the dock rather than
 * around it — chrome is a document-level layer, and the pick is an effect on the
 * provider, not a wrapper on the surface.
 */
const themedShell = WITH_PICKER_THEME ? (
  <ThemeProvider>
    <ForcedPicker />
    {readingShell}
  </ThemeProvider>
) : (
  readingShell
);

createRoot(root).render(
  <StrictMode>
    {WITH_CAPABILITIES || AGENTS_MODE ? (
      <CompanionProvider>
        {/* The app mounts this provider long before the dock opens; this page
            opens the dock immediately, so the dock store must not mount until
            the harness list has arrived. Otherwise the switch-reset a real
            companion change triggers fires on the first read and clears the
            landing the dock just resumed. The gate is a property of the
            companion provider being above the dock, so it wraps the agents
            provider too. */}
        <WhenHarnessesAreKnown>{themedShell}</WhenHarnessesAreKnown>
      </CompanionProvider>
    ) : (
      themedShell
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
  // A picker page is ready only once the forced recipe has landed on the
  // dock's root: the provider applies the pick one effect after the first
  // render, and a rig that measured before it would be measuring `one-mark`.
  // Only asked for when the switcher can draw at all (`?agents=1`), so a page
  // opened with `?picker=` alone can still settle.
  const pickerReady =
    !WITH_PICKER_THEME || !AGENTS_MODE
      ? true
      : document.querySelector(".agent-switcher[data-mode]") !== null;
  if (!composer || rows === 0 || !pickerReady) {
    requestAnimationFrame(waitForSurface);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForSurface);

(window as unknown as { chatPanelHarnessReady: Promise<void> }).chatPanelHarnessReady = ready;
