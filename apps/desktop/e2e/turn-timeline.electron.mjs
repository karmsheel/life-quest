/**
 * Drives the chat panel harness through whole turned sessions and turns what the
 * dock's new turn timeline did with them into `e2e/artifacts/turn-timeline.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   npx electron e2e/turn-timeline.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same checks, no eyeballing the app required.
 *
 * A system-in-isolation rig (the real ChatPanel, reducer, CSS and layout engine
 * over `e2e/chat-panel.html`; only the IPC bridge is stubbed), so the failure
 * modes it exists to expose are written down before the assertions:
 *
 *  1. A turn is not a pile of messages. The work log (reasoning, tool rows,
 *     narration) belongs in the process group; the answer belongs outside it and
 *     is never a row. A regression that writes tool frames into the transcript,
 *     or folds the answer into the work log, is the original bug this feature
 *     replaces.
 *  2. The wire is the input. Every frame below is a raw SSE block, fed through
 *     the app's own `parseSseBlock` before the panel sees it, so a key rename
 *     (`text` -> `delta`, `tool_name` -> `name`) fails here rather than in the
 *     operator's browser. The rig sends the real Hermes 0.22.5 frame names the
 *     adapter maps: `tool.progress(_thinking)` is the reasoning preview,
 *     `assistant.completed` is the answer of record, `tool.failed` is what
 *     closes a failed row, `run.cancelled`/`run.failed` are the non-complete
 *     terminals, and the terminal frame's `messages` is the snapshot.
 *  3. Done, failed and still-running are three different rows. A failed call
 *     must close as failed, be marked failed, and must not be counted in the
 *     fold header's "did" clause ("ran 1 command" for a command that failed is
 *     the panel lying about work it never did).
 *  4. The live turn is open and the settled turn folds. A completed turn folds
 *     to one header (`Worked for 1m 12s · <activity>`); a stopped, failed,
 *     incomplete or running turn never folds; the answer is visible either way.
 *     Fold state is per turn: opening one turn's header cannot open another's.
 *  5. A stream that dies is not a finished turn. `run.incomplete` must read
 *     "Ended before finishing", never "Completed". Same for an explicit stop:
 *     the answer is the partial text and the footer says stopped.
 *  6. History is the same turn. Reloading from a structured transcript (user,
 *     assistant with toolCalls, tool rows with ids/content/isError, final
 *     assistant with usage) and no stream frames at all must rebuild the same
 *     rows, fold, footer and answer. If live and history diverge, a reloaded
 *     chat is a different product.
 *  7. A capability is omitted, never faked. Under the Hermes descriptor
 *     (`toolResultsLive:false, toolResultsOnSettle:true, toolDurations:false,
 *     reasoning:"preview"`) no live result is disclosed, results appear when the
 *     snapshot lands, the thinking row says "preview", and no harness-measured
 *     duration is claimed. Under the floor descriptor (`reasoning:"none"`,
 *     `usage:false`, no args/results) the UI claims none of them. The rig proves
 *     the absence as loudly as the presence: no empty placeholder rows, no
 *     fabricated "0 tokens", no invented result disclosure.
 *
 * The descriptor is chosen with `?caps=` and the structured transcript with
 * `?history=timeline` on the shared harness page; both are absent by default so
 * the four older rigs keep the page they always measured.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on. A rig runs
// hidden beside every other rig in the suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";

// Each rig gets its own Electron profile. The app keeps its last-opened chat
// (and the tab strip) in localStorage, so two rigs sharing one profile can see
// each other's writes -- which is how a rig ends up starting on the chat a
// previous run left open. The page clears the dock's pointer itself, but the
// profile also carries state the page does not touch, so keep it per-rig.
const userDataDir = path.join(artifactsDir, "userdata", "turn-timeline");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };
const WATCHDOG_MS = 90_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// The script the rig plays. These are wire frames -- the exact `event:`/`data:`
// blocks a gateway sends -- not pre-built event objects. `parseSseBlock` is what
// turns them into the ChatStreamEvent the panel receives, so the frame shapes
// below are part of what is asserted.
// ---------------------------------------------------------------------------

/** One SSE block, the way Hermes' event queue writes it. */
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const SESSION_ID = "harness-session";
const AGENTS_PATH = "C:/Users/karms/Projects/life-quest/AGENTS.md";
const TEST_COMMAND = "npm test";
const SEARCH_QUERY = "composer";
const SECOND_TARGET = "src/components/hermes/ChatPanel.tsx";

/** The answer of record: what `assistant.completed` names and the dock shows. */
const FINAL_ANSWER = "The composer is wired.";
const SECOND_ANSWER = "Second answer stands.";
const NARRATION_TEXT = "Checking the composer now.";
const COMMENTARY_TEXT = "I'll look at the dock before changing it.";
const REASONING_TEXT = "Considering the dock subscription.";
const PREVIEW_TEXT = "Preview of a sampled thought.";
const INCOMPLETE_REASON = "iteration budget";
const INCOMPLETE_PARTIAL = "Half a reply";
const STOPPED_PARTIAL = "Only what arrived";
/** Exact accounting: the footer may show it, and may not invent more than it. */
const USAGE = { input: 1200, output: 240, total: 1440 };

/** The row labels the wire's args must produce (companion-client's target line). */
const EXPECTED_ROWS = [
  "read_file \u00b7 AGENTS.md",
  "search_files \u00b7 composer",
  "terminal \u00b7 npm test",
];

/**
 * The terminal snapshot: the authoritative transcript rows Hermes attaches to
 * `run.completed`. This is where live results/errors are reconciled from, and
 * where a floor harness has nothing to offer.
 *
 * `messagesFromPayload` reads OpenAI-shaped rows: assistant `tool_calls` (args
 * under `function.arguments`), `role:"tool"` results keyed by `tool_call_id`,
 * and `is_error` on the failed one.
 */
const toolCallRows = (calls) =>
  calls.map(({ id, name, args }) => ({
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  }));
const SNAPSHOT_ROWS = [
  {
    role: "assistant",
    content: "",
    tool_calls: toolCallRows([
      { id: "call_read", name: "read_file", args: { path: AGENTS_PATH } },
      { id: "call_search", name: "search_files", args: { query: SEARCH_QUERY } },
      { id: "call_term", name: "terminal", args: { command: TEST_COMMAND } },
    ]),
  },
  {
    role: "tool",
    tool_call_id: "call_read",
    tool_name: "read_file",
    content: "Read 42 lines.",
  },
  {
    role: "tool",
    tool_call_id: "call_search",
    tool_name: "search_files",
    content: "3 matches in src/components/hermes.",
  },
  {
    role: "tool",
    tool_call_id: "call_term",
    tool_name: "terminal",
    content: "Command failed: exit 1",
    is_error: true,
  },
  { role: "assistant", content: FINAL_ANSWER },
];
const SECOND_SNAPSHOT_ROWS = [
  {
    role: "assistant",
    content: "",
    tool_calls: toolCallRows([
      { id: "call_panel", name: "read_file", args: { path: SECOND_TARGET } },
    ]),
  },
  {
    role: "tool",
    tool_call_id: "call_panel",
    tool_name: "read_file",
    content: "Read 120 lines.",
  },
  { role: "assistant", content: SECOND_ANSWER },
];

/** The frames of turn one, in the order a Hermes session stream sends them. */
const TURN_ONE = {
  runStarted: frame("run.started", { run_id: "run_turn_1" }),
  // Hermes' thinking channel is a sampled preview named `_thinking`.
  reasoning: frame("tool.progress", { tool_name: "_thinking", text: REASONING_TEXT }),
  startRead: frame("tool.started", { tool_name: "read_file", args: { path: AGENTS_PATH } }),
  startSearch: frame("tool.started", { tool_name: "search_files", args: { query: SEARCH_QUERY } }),
  completeRead: frame("tool.completed", { tool_name: "read_file" }),
  completeSearch: frame("tool.completed", { tool_name: "search_files" }),
  // Assistant text BETWEEN tool events is narration inside the process, never
  // the answer: the next tool boundary is what closes the text block.
  narration: frame("assistant.delta", { text: NARRATION_TEXT }),
  startTerm: frame("tool.started", { tool_name: "terminal", args: { command: TEST_COMMAND } }),
  // A failed call closes as failed; without `tool.failed` the old dock spun a
  // row forever and the turn read as if it were still working.
  failTerm: frame("tool.failed", { tool_name: "terminal" }),
  commentary: frame("assistant.commentary", { text: COMMENTARY_TEXT }),
  final: frame("assistant.completed", { content: FINAL_ANSWER }),
  terminal: frame("run.completed", { usage: USAGE, messages: SNAPSHOT_ROWS }),
};

const TURN_TWO = {
  runStarted: frame("run.started", { run_id: "run_turn_2" }),
  startRead: frame("tool.started", { tool_name: "read_file", args: { path: SECOND_TARGET } }),
  completeRead: frame("tool.completed", { tool_name: "read_file" }),
  delta: frame("assistant.delta", { text: "One moment." }),
  final: frame("assistant.completed", { content: SECOND_ANSWER }),
  terminal: frame("run.completed", {
    usage: { input: 600, output: 120, total: 720 },
    messages: SECOND_SNAPSHOT_ROWS,
  }),
};

const STOPPED_TURN = {
  runStarted: frame("run.started", { run_id: "run_stopped" }),
  // Interrupted mid-call: the work log exists, so the turn has a process group
  // that must stay open with the cut-short reply.
  startRead: frame("tool.started", { tool_name: "read_file", args: { path: AGENTS_PATH } }),
  delta: frame("assistant.delta", { text: STOPPED_PARTIAL }),
  // `run.cancelled` is the gateway's interrupt terminal; the adapter maps it to
  // `run.stopped`, whose answer is only what arrived.
  terminal: frame("run.cancelled", { usage: { input: 80, output: 20, total: 100 } }),
};

const INCOMPLETE_TURN = {
  runStarted: frame("run.started", { run_id: "run_incomplete" }),
  startRead: frame("tool.started", { tool_name: "read_file", args: { path: AGENTS_PATH } }),
  completeRead: frame("tool.completed", { tool_name: "read_file" }),
  delta: frame("assistant.delta", { text: INCOMPLETE_PARTIAL }),
  terminal: frame("run.failed", { turn_exit_reason: INCOMPLETE_REASON }),
};

/**
 * The capability legs replay a smaller script under a descriptor that cannot
 * honour parts of it. A Hermes-shaped turn: a preview reasoning row, one call
 * that closes, then the terminal snapshot that is the only place a result can
 * come from.
 */
const CAPABILITY_TURN = {
  runStarted: frame("run.started", { run_id: "run_capability" }),
  reasoning: frame("tool.progress", { tool_name: "_thinking", text: PREVIEW_TEXT }),
  startRead: frame("tool.started", { tool_name: "read_file", args: { path: AGENTS_PATH } }),
  completeRead: frame("tool.completed", { tool_name: "read_file" }),
  terminal: frame("run.completed", {
    usage: USAGE,
    messages: [
      {
        role: "assistant",
        content: "",
        tool_calls: toolCallRows([
          { id: "call_read", name: "read_file", args: { path: AGENTS_PATH } },
        ]),
      },
      {
        role: "tool",
        tool_call_id: "call_read",
        tool_name: "read_file",
        content: "Read 42 lines.",
      },
      { role: "assistant", content: "Snapshot answer." },
    ],
  }),
};

/**
 * What the DOM is showing, read off the elements the user sees.
 *
 * The process body is unmounted when a turn is folded, so its absence is part of
 * the reading: a closed turn has `process.state === "closed"` and no status
 * line, rows or narration. The legacy `.chat-panel__activity` block keeps its
 * own disclosure inside the process body -- collapsed until a driver clicks its
 * line, exactly the tool-run contract -- so rows only appear after the rig has
 * opened it (see EXPAND_TOOLS).
 */
const STATE = `(() => {
  const text = (el) => (el ? (el.textContent ?? "").trim() : null);
  const one = (root, sel) => (root ? root.querySelector(sel) : null);
  const all = (root, sel) => (root ? [...root.querySelectorAll(sel)] : []);
  // The user/answer test-ids sit on the bubble, whose text also carries the role
  // label and the stamp; the prose is the bubble's content element.
  const bubble = (el) => (el ? text(one(el, ".chat-panel__message-content")) ?? text(el) : null);
  const turns = all(document, '[data-testid="turn"]').map((turn, index) => {
    const process = one(turn, '[data-testid="turn-process"]');
    const answer = one(turn, '[data-testid="turn-answer"]');
    const footer = one(turn, '[data-testid="turn-footer"]');
    const activities = all(turn, ".chat-panel__activity").map((block) => {
      const line = one(block, ".chat-panel__activity-line");
      return {
        line: text(line),
        tag: line ? line.tagName : null,
        expanded: line ? line.getAttribute("aria-expanded") : null,
        caretOpen: Boolean(one(block, ".chat-panel__activity-caret--open")),
        rows: all(block, ".chat-panel__activity-row").map((row) => ({
          text: text(row),
          status: row.getAttribute("data-tool-status"),
          durationMs: row.getAttribute("data-tool-duration-ms"),
          durationSource: row.getAttribute("data-tool-duration-source"),
        })),
      };
    });
    return {
      index,
      status: turn.getAttribute("data-turn-status"),
      user: bubble(one(turn, '[data-testid="turn-user"]')),
      answer: bubble(answer),
      answerOutsideProcess: Boolean(answer) && !(process && process.contains(answer)),
      process: process
        ? {
            state: process.getAttribute("data-process-state"),
            header: text(one(process, '[data-testid="process-header"]')),
            statusLine: text(one(process, '[data-testid="turn-status"]')),
            reasoning: all(process, '[data-testid="reasoning-row"]').map((el) => ({
              text: text(el),
              fidelity: el.getAttribute("data-reasoning-fidelity"),
            })),
            commentary: all(process, '[data-testid="commentary"]').map(text),
            narration: all(process, '[data-testid="narration"]').map(text),
            toolArgs: all(process, '[data-testid="tool-args"]').map(text),
            toolResults: all(process, '[data-testid="tool-result"]').map(text),
            // Every legacy tool run in the turn, in DOM order. A turn that
            // narrates between steps has more than one, and the rows still read
            // in the order they were called.
            rows: activities.flatMap((block) => block.rows),
            activities,
          }
        : null,
      footer: footer
        ? { status: footer.getAttribute("data-footer-status"), text: text(footer) }
        : null,
      usage: text(one(turn, '[data-testid="turn-usage"]')),
      notes: all(turn, '[data-testid="turn-note"]').map((el) => ({
        kind: el.getAttribute("data-note-kind"),
        text: text(el),
      })),
    };
  });
  return {
    turnCount: turns.length,
    turns,
    bubbles: all(document, ".chat-panel__message-content").map(text),
    sendState: document.querySelector(".chat-panel__send")?.getAttribute("data-state") ?? null,
  };
})()`;

/**
 * Find the turn whose prompt contains this text (the initial history turn is not
 * ours). Returns a boolean: a DOM node cannot cross `executeJavaScript`, so a
 * wait on this expression has to be answerable as a value.
 */
const hasTurn = (userText) => `[...document.querySelectorAll('[data-testid="turn"]')].some((turn) =>
  ((turn.querySelector('[data-testid="turn-user"]')?.textContent ?? "").includes(${JSON.stringify(userText)})))`;

/**
 * Open every legacy tool disclosure in one turn, oldest first.
 *
 * Clicking re-renders, so the helper re-queries after each click and gives up
 * after a few passes; the row list only exists while a line is expanded, which
 * is the contract the tool-run rig also measures.
 */
const EXPAND_TOOLS = (userText) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const find = () => [...document.querySelectorAll('[data-testid="turn"]')].find((turn) =>
    ((turn.querySelector('[data-testid="turn-user"]')?.textContent ?? "").includes(${JSON.stringify(userText)})));
  let clicked = 0;
  for (let pass = 0; pass < 6; pass += 1) {
    const turn = find();
    if (!turn) break;
    const line = [...turn.querySelectorAll(".chat-panel__activity-line")]
      .find((el) => el.getAttribute("aria-expanded") !== "true");
    if (!line) break;
    line.click();
    clicked += 1;
    await wait(90);
  }
  return { clicked };
})()`;

/** Open one turn's process fold (only a folded turn has the header button). */
const OPEN_FOLD = (userText) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const turn = [...document.querySelectorAll('[data-testid="turn"]')].find((candidate) =>
    ((candidate.querySelector('[data-testid="turn-user"]')?.textContent ?? "").includes(${JSON.stringify(userText)})));
  if (!turn) return { clicked: false, reason: "no turn" };
  const process = turn.querySelector('[data-testid="turn-process"]');
  if (!process) return { clicked: false, reason: "no process" };
  const state = process.getAttribute("data-process-state");
  if (state === "open") return { clicked: false, alreadyOpen: true, state };
  const header = process.querySelector('[data-testid="process-header"]');
  if (!header) return { clicked: false, reason: "no header while closed", state };
  header.click();
  await wait(200);
  return { clicked: true, state };
})()`;

/** The composer gesture a driver uses, with the outbound call held open for the
 *  rig's whole run so only a terminal frame can ever end a turn. */
const SEND = (text) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.__lqChatDelay = 600000;
  const el = document.querySelector(".chat-panel__composer-input");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(60);
  document.querySelector(".chat-panel__send").click();
  await wait(140);
  return true;
})()`;

const failures = [];
const checks = [];
const check = (name, condition, detail) => {
  const pass = Boolean(condition);
  checks.push({ name, pass, detail });
  if (!pass) failures.push(`${name}: ${detail}`);
  return pass;
};
/** The first turn whose prompt contains this text, from a STATE sample. */
const turnOf = (state, userText) =>
  (state?.turns ?? []).find((turn) => (turn.user ?? "").includes(userText)) ?? null;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // Paint in the theme the app itself defaults to so a test run is not a white
  // sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  /** Load the harness page, optionally under a descriptor/history fixture. */
  const openPage = async (query, { first = false } = {}) => {
    await win.loadURL(`${url}${query}`);
    await run("window.chatPanelHarnessReady.then(() => true)");
    if (first) {
      // The dock remembers the last chat it opened in this Electron profile;
      // clearing the pointer and reloading makes the landing deterministic.
      await run(`localStorage.removeItem("lifequest.companion.lastSessionId")`);
      const reloaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      win.webContents.reload();
      await reloaded;
      await run("window.chatPanelHarnessReady.then(() => true)");
    }
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(200);
    win.showInactive();
  };

  /**
   * Feed one raw wire block: the page parses it with the app's real
   * `parseSseBlock` and hands the decoded event to the panel's subscriber. A
   * block the app cannot decode is a rig error, not a silent no-op.
   */
  let emittedFrames = 0;
  const emit = async (raw) => {
    const decoded = await run(
      `window.__lqEmitSseFor(${JSON.stringify(SESSION_ID)}, ${JSON.stringify(raw)})`,
    );
    if (!decoded || typeof decoded !== "object" || !decoded.type) {
      throw new Error(`the app did not decode this frame: ${raw.split("\n")[0]}`);
    }
    emittedFrames += 1;
    return decoded;
  };
  const emitAll = async (frames) => {
    const decoded = [];
    for (const raw of frames) decoded.push(await emit(raw));
    return decoded;
  };
  /** Decode without emitting: proves the wire mapping with no turn on screen. */
  const decode = (raw) => run(`window.__lqParseSse(${JSON.stringify(raw)})`);

  const state = () => run(STATE);
  const turn = async (userText) => turnOf(await state(), userText);

  const waitFor = async (expression, label, timeoutMs = 10_000) => {
    const from = Date.now();
    while (Date.now() - from < timeoutMs) {
      if (await run(expression)) return true;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const waitForTurn = (userText) =>
    waitFor(hasTurn(userText), `the turn for ${JSON.stringify(userText)}`);
  /**
   * The page's first paint and its first transcript read are different events,
   * and a `?caps=` page is one more: its CompanionProvider summary arrives a
   * tick after the first read, and the dock resets its chat store when it learns
   * which harness is answering. Waiting through that tick keeps the rig's first
   * send out of a store that is about to be replaced.
   */
  const TRANSCRIPT_READY = `document.querySelectorAll(".chat-panel__message-content").length >= 2 || Boolean(document.querySelector('[data-testid="turn"]'))`;
  const waitForTranscript = async (label) => {
    await waitFor(TRANSCRIPT_READY, label);
    await sleep(300);
    await waitFor(TRANSCRIPT_READY, `${label} (after the harness summary landed)`);
  };
  /**
   * A send is the operator's gesture through the real composer. The outbound
   * call is held open for the turn's whole duration (see SEND), so only the
   * terminal frame the rig emits can end it — no timer can settle a turn here.
   */
  let sentTurns = 0;
  const sendTurn = async (text) => {
    sentTurns += 1;
    await run(SEND(text));
    await waitForTurn(text);
  };
  const waitForFooter = async (userText, status, timeoutMs = 10_000) => {
    const from = Date.now();
    while (Date.now() - from < timeoutMs) {
      const sample = await turn(userText);
      if (sample?.footer?.status === status) return sample;
      await sleep(100);
    }
    throw new Error(`timed out waiting for the ${JSON.stringify(userText)} footer to read ${status}`);
  };

  const expandTools = async (userText) => {
    await run(EXPAND_TOOLS(userText));
    await sleep(140);
    return turn(userText);
  };
  const openFold = async (userText) => {
    const opened = await run(OPEN_FOLD(userText));
    await sleep(120);
    return { opened, sample: await turn(userText) };
  };

  const shoot = async (name) => {
    const file = path.join(artifactsDir, `turn-timeline-${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return file;
  };

  /** A compact, report-sized view of one turn. */
  const summaryOf = (sample) =>
    sample
      ? {
          status: sample.status,
          user: sample.user,
          answer: sample.answer,
          answerOutsideProcess: sample.answerOutsideProcess,
          process: sample.process
            ? {
                state: sample.process.state,
                header: sample.process.header,
                statusLine: sample.process.statusLine,
                reasoning: sample.process.reasoning,
                commentary: sample.process.commentary,
                narration: sample.process.narration,
                toolArgs: sample.process.toolArgs,
                toolResults: sample.process.toolResults,
                rows: sample.process.rows,
                activityLines: sample.process.activities.map((block) => block.line),
              }
            : null,
          footer: sample.footer,
          usage: sample.usage,
          notes: sample.notes,
        }
      : null;

  let report;
  const timeout = setTimeout(() => {
    console.error(`turn-timeline: timed out after ${WATCHDOG_MS / 1000}s`);
    app.exit(1);
  }, WATCHDOG_MS);

  const screenshots = [];
  try {
    await openPage("", { first: true });
    await waitForTranscript("the open chat's transcript");

    // --- wire mapping (no UI): what the gateway's frames decode to -----------
    // Every frame the rig is about to send is decoded first, so a frame shape
    // the app no longer understands fails here with the decoded object, not as
    // a mysterious missing row twenty steps later.
    const wire = {
      reasoning: await decode(TURN_ONE.reasoning),
      started: await decode(TURN_ONE.startRead),
      completed: await decode(TURN_ONE.completeRead),
      failed: await decode(TURN_ONE.failTerm),
      commentary: await decode(TURN_ONE.commentary),
      delta: await decode(TURN_ONE.narration),
      final: await decode(TURN_ONE.final),
      terminal: await decode(TURN_ONE.terminal),
      cancelled: await decode(STOPPED_TURN.terminal),
      incomplete: await decode(INCOMPLETE_TURN.terminal),
    };

    check(
      "wire: the thinking channel decodes as a reasoning preview",
      wire.reasoning?.type === "reasoning.delta" && wire.reasoning?.text === REASONING_TEXT,
      `decoded ${JSON.stringify(wire.reasoning)}`,
    );
    check(
      "wire: tool.started names the call and a bounded target",
      wire.started?.type === "tool.started" &&
        wire.started?.name === "read_file" &&
        wire.started?.target === "AGENTS.md" &&
        wire.started?.args &&
        typeof wire.started.args === "object",
      `decoded ${JSON.stringify(wire.started)}`,
    );
    check(
      "wire: tool.completed closes the named call",
      wire.completed?.type === "tool.completed" && wire.completed?.name === "read_file",
      `decoded ${JSON.stringify(wire.completed)}`,
    );
    check(
      "wire: tool.failed closes the call as failed",
      wire.failed?.type === "tool.completed" &&
        wire.failed?.isError === true &&
        wire.failed?.name === "terminal",
      `decoded ${JSON.stringify(wire.failed)}`,
    );
    check(
      "wire: commentary is narration, not the answer",
      wire.commentary?.type === "assistant.commentary" &&
        wire.commentary?.text === COMMENTARY_TEXT,
      `decoded ${JSON.stringify(wire.commentary)}`,
    );
    check(
      "wire: assistant deltas decode as deltas",
      wire.delta?.type === "assistant.delta" && wire.delta?.text === NARRATION_TEXT,
      `decoded ${JSON.stringify(wire.delta)}`,
    );
    check(
      "wire: assistant.completed is the answer of record",
      wire.final?.type === "assistant.final" && wire.final?.text === FINAL_ANSWER,
      `decoded ${JSON.stringify(wire.final)}`,
    );
    check(
      "wire: the terminal frame carries usage and the snapshot",
      wire.terminal?.type === "run.completed" &&
        wire.terminal?.usage?.total === USAGE.total &&
        Array.isArray(wire.terminal?.snapshot) &&
        wire.terminal.snapshot.length === SNAPSHOT_ROWS.length &&
        wire.terminal.snapshot.some((row) => row.role === "tool" && row.isError === true),
      `decoded ${JSON.stringify(wire.terminal)}`,
    );
    check(
      "wire: cancelled and failed decode to non-complete terminals",
      wire.cancelled?.type === "run.stopped" &&
        wire.incomplete?.type === "run.incomplete" &&
        wire.incomplete?.reason === INCOMPLETE_REASON,
      `cancelled ${JSON.stringify(wire.cancelled)} / failed ${JSON.stringify(wire.incomplete)}`,
    );

    // =========================================================================
    // 1. LIVE — turn one runs: reasoning, three calls (one fails), narration,
    // commentary, then the answer and its terminal frame.
    // =========================================================================
    await sendTurn("Do the thing");
    await emitAll([TURN_ONE.runStarted, TURN_ONE.reasoning]);
    await emitAll([TURN_ONE.startRead, TURN_ONE.startSearch]);

    const liveRunning = await expandTools("Do the thing");
    screenshots.push(await shoot("live"));

    await emitAll([TURN_ONE.completeRead, TURN_ONE.completeSearch]);
    await emit(TURN_ONE.narration);
    // The next tool boundary is what closes the narration text block and keeps
    // it inside the process rather than letting it become the answer.
    await emitAll([TURN_ONE.startTerm, TURN_ONE.failTerm]);
    await emit(TURN_ONE.commentary);
    const beforeFinal = await turn("Do the thing");

    await emitAll([TURN_ONE.final, TURN_ONE.terminal]);
    const settledOne = await waitForFooter("Do the thing", "completed");
    screenshots.push(await shoot("settled"));

    check(
      "live: the status line names work and elapsed time",
      typeof liveRunning?.process?.statusLine === "string" &&
        /working/i.test(liveRunning.process.statusLine) &&
        /\d+\s*s/.test(liveRunning.process.statusLine),
      `status line ${JSON.stringify(liveRunning?.process?.statusLine)}`,
    );
    check(
      "live: the process is open while the turn runs",
      liveRunning?.status === "running" && liveRunning?.process?.state === "open",
      `turn status ${JSON.stringify(liveRunning?.status)}, process ${JSON.stringify(liveRunning?.process?.state)}`,
    );
    check(
      "live: the reasoning row renders while thinking arrived",
      liveRunning?.process?.reasoning?.length === 1 &&
        (liveRunning.process.reasoning[0].text ?? "").includes(REASONING_TEXT),
      `reasoning ${JSON.stringify(liveRunning?.process?.reasoning)}`,
    );
    check(
      "live: a running call is marked running",
      liveRunning?.process?.rows?.length === 2 &&
        liveRunning.process.rows.every((row) => row.status === "running"),
      `rows ${JSON.stringify(liveRunning?.process?.rows)}`,
    );
    check(
      "live: the answer is not claimed before the harness names it",
      !beforeFinal?.answer || beforeFinal.answer.length === 0,
      `answer before assistant.completed: ${JSON.stringify(beforeFinal?.answer)}`,
    );
    check(
      "live: the answer is the final answer and stays outside the process",
      (settledOne?.answer ?? "").trim() === FINAL_ANSWER && settledOne?.answerOutsideProcess === true,
      `answer ${JSON.stringify(settledOne?.answer)}, outside process ${JSON.stringify(settledOne?.answerOutsideProcess)}`,
    );

    // =========================================================================
    // 2. SETTLED — the process folds, the header recaps honestly, the footer
    //    states the outcome; a second turn's fold is its own.
    // =========================================================================
    const settledFold = await turn("Do the thing");
    check(
      "settled: a completed turn folds and the answer survives the fold",
      settledFold?.process?.state === "closed" &&
        (settledFold?.process?.activities?.length ?? 0) === 0 &&
        (settledFold?.answer ?? "").trim() === FINAL_ANSWER &&
        settledFold?.answerOutsideProcess === true,
      `process ${JSON.stringify(settledFold?.process?.state)}, activities ${JSON.stringify(
        settledFold?.process?.activities?.length,
      )}, answer ${JSON.stringify(settledFold?.answer)}`,
    );
    const foldHeader = settledFold?.process?.header ?? "";
    check(
      "settled: the fold header names duration and activity",
      /worked for/i.test(foldHeader) &&
        /\d+(?:\.\d+)?\s*(?:s|m\s*\d+\s*s)/i.test(foldHeader) &&
        /(read|search|explore|ran|used)/i.test(foldHeader),
      `header ${JSON.stringify(foldHeader)}`,
    );
    check(
      "settled: the footer states completion, duration and exact usage",
      settledFold?.footer?.status === "completed" &&
        /completed/i.test(settledFold?.footer?.text ?? "") &&
        /\d+(?:\.\d+)?\s*(?:s|m\s*\d+\s*s)/i.test(settledFold?.footer?.text ?? "") &&
        /tokens/i.test(settledFold?.footer?.text ?? "") &&
        (settledFold?.usage ?? "").length > 0,
      `footer ${JSON.stringify(settledFold?.footer)}, usage ${JSON.stringify(settledFold?.usage)}`,
    );

    // A second settled turn, so the per-turn fold claim has two witnesses.
    await sendTurn("And again");
    await emitAll([TURN_TWO.runStarted, TURN_TWO.startRead, TURN_TWO.completeRead]);
    await emitAll([TURN_TWO.delta, TURN_TWO.final, TURN_TWO.terminal]);
    const settledTwo = await waitForFooter("And again", "completed");

    const bothFolded = await state();
    const firstFold = await openFold("Do the thing");
    const afterFirstOpen = await turn("Do the thing");
    const secondAfterFirstOpen = await turn("And again");
    await openFold("And again");
    const afterSecondOpen = await turn("And again");

    check(
      "settled: each turn folds on its own",
      turnOf(bothFolded, "Do the thing")?.process?.state === "closed" &&
        turnOf(bothFolded, "And again")?.process?.state === "closed" &&
        firstFold.opened.clicked === true &&
        afterFirstOpen?.process?.state === "open" &&
        secondAfterFirstOpen?.process?.state === "closed" &&
        afterSecondOpen?.process?.state === "open",
      `before ${JSON.stringify(
        (bothFolded.turns ?? []).map((t) => t.process?.state),
      )}, after opening turn one ${JSON.stringify(
        (afterFirstOpen ? [afterFirstOpen.process?.state] : []),
      )} / second ${JSON.stringify(secondAfterFirstOpen?.process?.state)}, after opening turn two ${JSON.stringify(
        afterSecondOpen?.process?.state,
      )}`,
    );

    // The fold is a disclosure, not a deletion: with both folds open, the rows,
    // narration and commentary turn one accumulated are readable again — and the
    // order is the order the calls were made in, across the step boundary that
    // the narration split.
    const settledOneOpen = await expandTools("Do the thing");
    const settledRows = settledOneOpen?.process?.rows ?? [];
    check(
      "live: one row per started call, in start order",
      settledRows.length === EXPECTED_ROWS.length &&
        settledRows.every((row, index) => row.text === EXPECTED_ROWS[index]),
      `rows ${JSON.stringify(settledRows.map((row) => row.text))}`,
    );
    check(
      "live: completed calls close and the failed one is marked failed",
      settledRows.length === EXPECTED_ROWS.length &&
        settledRows[0].status === "completed" &&
        settledRows[1].status === "completed" &&
        settledRows[2].status === "failed",
      `row statuses ${JSON.stringify(settledRows.map((row) => row.status))}`,
    );
    check(
      "live: narration renders inside the process",
      settledOneOpen?.process?.narration?.some((line) => line.includes(NARRATION_TEXT)),
      `narration ${JSON.stringify(settledOneOpen?.process?.narration)}`,
    );
    check(
      "live: commentary renders inside the process",
      settledOneOpen?.process?.commentary?.some((line) => line.includes(COMMENTARY_TEXT)),
      `commentary ${JSON.stringify(settledOneOpen?.process?.commentary)}`,
    );
    const afterLiveBubbles = (await state()).bubbles;
    check(
      "evidence: tool work never becomes a transcript bubble",
      settledRows.length === EXPECTED_ROWS.length &&
        !afterLiveBubbles.some((line) => /^tool( done| failed)?:/i.test(line ?? "")),
      `bubbles ${JSON.stringify(afterLiveBubbles)}`,
    );

    // =========================================================================
    // 3. STREAM DEATH — deltas then run.incomplete must never read as complete.
    // =========================================================================
    await sendTurn("Keep going");
    await emitAll([
      INCOMPLETE_TURN.runStarted,
      INCOMPLETE_TURN.startRead,
      INCOMPLETE_TURN.completeRead,
      INCOMPLETE_TURN.delta,
    ]);
    await emit(INCOMPLETE_TURN.terminal);
    const incomplete = await waitForFooter("Keep going", "incomplete");
    check(
      "incomplete: a dead stream ends before finishing",
      incomplete?.footer?.status === "incomplete" &&
        /ended before finishing/i.test(incomplete?.footer?.text ?? "") &&
        /iteration budget/i.test(incomplete?.footer?.text ?? "") &&
        !/completed/i.test(incomplete?.footer?.text ?? ""),
      `footer ${JSON.stringify(incomplete?.footer)}`,
    );
    check(
      "incomplete: the process stays open",
      incomplete?.process?.state === "open",
      `process ${JSON.stringify(incomplete?.process?.state)}`,
    );
    check(
      "incomplete: the partial reply is kept",
      (incomplete?.answer ?? "").includes(INCOMPLETE_PARTIAL),
      `answer ${JSON.stringify(incomplete?.answer)}`,
    );

    // =========================================================================
    // 4. STOPPED — the operator interrupted; the reply above is partial.
    // =========================================================================
    await sendTurn("Stop that");
    await emitAll([STOPPED_TURN.runStarted, STOPPED_TURN.startRead, STOPPED_TURN.delta]);
    await emit(STOPPED_TURN.terminal);
    const stopped = await waitForFooter("Stop that", "stopped");
    check(
      "stopped: the footer states the stop",
      stopped?.footer?.status === "stopped" &&
        /stopped/i.test(stopped?.footer?.text ?? "") &&
        stopped?.notes?.some((note) => /stopped/i.test(`${note.kind} ${note.text}`)),
      `footer ${JSON.stringify(stopped?.footer)}, notes ${JSON.stringify(stopped?.notes)}`,
    );
    check(
      "stopped: the answer is the partial reply",
      (stopped?.answer ?? "").includes(STOPPED_PARTIAL),
      `answer ${JSON.stringify(stopped?.answer)}`,
    );
    check(
      "stopped: an interrupted turn never folds",
      stopped?.process?.state === "open",
      `process ${JSON.stringify(stopped?.process?.state)}`,
    );

    // =========================================================================
    // 5. EVIDENCE — no rows or did-claims for work that did not happen.
    // =========================================================================
    check(
      "evidence: no rows for calls that never started",
      settledRows.length === EXPECTED_ROWS.length &&
        settledRows.every((row) => ["read_file", "search_files", "terminal"].some((name) => (row.text ?? "").startsWith(name))),
      `rows ${JSON.stringify(settledRows.map((row) => row.text))}`,
    );
    check(
      "evidence: the failed call is counted apart, never as did",
      /failed/i.test(foldHeader) && !/ran \d+/i.test(foldHeader),
      `header ${JSON.stringify(foldHeader)}`,
    );

    // =========================================================================
    // 6. CAPABILITY OMISSION (Hermes descriptor) — results arrive only with the
    //    snapshot, reasoning says it is a preview, durations are the app clock.
    // =========================================================================
    await openPage("?caps=hermes");
    await waitForTranscript("the hermes-caps transcript");
    await sendTurn("Capability probe");
    await emitAll([CAPABILITY_TURN.runStarted, CAPABILITY_TURN.reasoning]);
    await emitAll([CAPABILITY_TURN.startRead, CAPABILITY_TURN.completeRead]);
    const hermesLive = await expandTools("Capability probe");
    screenshots.push(await shoot("capability-live"));

    await emit(CAPABILITY_TURN.terminal);
    const hermesSettledFolded = await waitForFooter("Capability probe", "completed");
    await openFold("Capability probe");
    const hermesSettled = await expandTools("Capability probe");
    const hermesRows = hermesSettled?.process?.rows ?? [];

    check(
      "capability: no live result disclosure when the harness has none",
      (hermesLive?.process?.toolResults?.length ?? 0) === 0,
      `live results ${JSON.stringify(hermesLive?.process?.toolResults)}`,
    );
    check(
      "capability: the reasoning row says it is a preview",
      hermesLive?.process?.reasoning?.length === 1 &&
        hermesLive.process.reasoning[0].fidelity === "preview" &&
        /preview/i.test(hermesLive.process.reasoning[0].text ?? ""),
      `reasoning ${JSON.stringify(hermesLive?.process?.reasoning)}`,
    );
    check(
      "capability: results arrive with the terminal snapshot",
      hermesSettled?.process?.toolResults?.some((line) => (line ?? "").includes("Read 42 lines.")) === true,
      `settled results ${JSON.stringify(hermesSettled?.process?.toolResults)}`,
    );
    check(
      "capability: no harness-measured duration is claimed",
      // The essential claim: nothing here says the harness timed the call. The
      // app clock (source "app") is measured and allowed; omission is allowed;
      // a row claiming a harness duration is the fabricated evidence.
      hermesRows.length > 0 &&
        hermesRows.every((row) => row.durationSource !== "harness") &&
        !/harness/i.test(`${hermesSettled?.process?.header ?? ""} ${hermesSettled?.footer?.text ?? ""}`),
      `rows ${JSON.stringify(hermesRows)}, header ${JSON.stringify(hermesSettled?.process?.header)}`,
    );
    check(
      "capability: the settled hermes turn still shows status and usage",
      hermesSettledFolded?.footer?.status === "completed" &&
        (hermesSettledFolded?.usage ?? "").length > 0,
      `footer ${JSON.stringify(hermesSettledFolded?.footer)}, usage ${JSON.stringify(hermesSettledFolded?.usage)}`,
    );
    screenshots.push(await shoot("capability-settled"));

    // =========================================================================
    // 7. CAPABILITY OMISSION (floor descriptor) — the UI claims nothing the
    //    harness cannot honour: no reasoning row, no usage line, no disclosures.
    // =========================================================================
    await openPage("?caps=floor");
    await waitForTranscript("the floor-caps transcript");
    await sendTurn("Floor probe");
    await emitAll([CAPABILITY_TURN.runStarted, CAPABILITY_TURN.reasoning]);
    await emitAll([CAPABILITY_TURN.startRead, CAPABILITY_TURN.completeRead]);
    await emitAll([CAPABILITY_TURN.terminal]);
    const floorFolded = await waitForFooter("Floor probe", "completed");
    await openFold("Floor probe");
    const floor = await expandTools("Floor probe");
    const floorRows = floor?.process?.rows ?? [];

    check(
      "floor: no reasoning row when the descriptor says reasoning is none",
      (floorFolded?.process?.reasoning?.length ?? 0) === 0 &&
        (floor?.process?.reasoning?.length ?? 0) === 0,
      `reasoning rows ${JSON.stringify(floor?.process?.reasoning)}`,
    );
    check(
      "floor: no usage line when the harness does not account for tokens",
      floorFolded?.usage === null && !/tokens/i.test(floorFolded?.footer?.text ?? ""),
      `usage ${JSON.stringify(floorFolded?.usage)}, footer ${JSON.stringify(floorFolded?.footer)}`,
    );
    check(
      "floor: no args or result disclosures the harness cannot honour",
      (floor?.process?.toolArgs?.length ?? 0) === 0 && (floor?.process?.toolResults?.length ?? 0) === 0,
      `args ${JSON.stringify(floor?.process?.toolArgs)}, results ${JSON.stringify(floor?.process?.toolResults)}`,
    );
    check(
      "floor: tool rows still render from the floor frames",
      floorRows.length === 1 && floorRows[0].text === "read_file \u00b7 AGENTS.md",
      `rows ${JSON.stringify(floorRows.map((row) => row.text))}`,
    );
    screenshots.push(await shoot("floor-settled"));

    // =========================================================================
    // 8. HISTORY — a reload rebuilds the settled turn from the transcript alone
    //    (no stream frames at all), and it must be the same turn.
    // =========================================================================
    await openPage("?history=timeline&caps=full");
    await waitForTranscript("the history transcript");
    await waitForTurn("Do the thing");
    const historyInitial = await state();
    const historyFolded = turnOf(historyInitial, "Do the thing");
    await openFold("Do the thing");
    const history = await expandTools("Do the thing");
    const historyRows = history?.process?.rows ?? [];
    screenshots.push(await shoot("history"));

    check(
      "history: a reload rebuilds one settled turn from the transcript",
      historyInitial.turnCount === 1 &&
        historyFolded?.status === "completed" &&
        historyFolded?.process?.state === "closed" &&
        historyFolded?.user === "Do the thing",
      `turns ${historyInitial.turnCount}, status ${JSON.stringify(historyFolded?.status)}, process ${JSON.stringify(historyFolded?.process?.state)}`,
    );
    check(
      "history: the reloaded rows are the live rows",
      historyRows.length === EXPECTED_ROWS.length &&
        historyRows.every((row, index) => row.text === EXPECTED_ROWS[index]) &&
        historyRows[2]?.status === "failed",
      `history rows ${JSON.stringify(historyRows)}, live rows ${JSON.stringify(settledRows)}`,
    );
    check(
      "history: the footer status and usage come from the transcript",
      history?.footer?.status === "completed" &&
        /completed/i.test(history?.footer?.text ?? "") &&
        /tokens/i.test(history?.footer?.text ?? "") &&
        (history?.usage ?? "").length > 0,
      `footer ${JSON.stringify(history?.footer)}, usage ${JSON.stringify(history?.usage)}`,
    );
    check(
      "history: the answer of record comes from the transcript",
      (history?.answer ?? "").trim() === FINAL_ANSWER && history?.answerOutsideProcess === true,
      `answer ${JSON.stringify(history?.answer)}`,
    );
    check(
      "history: the header recaps from the transcript timestamps",
      /worked for/i.test(history?.process?.header ?? "") &&
        /\d+(?:\.\d+)?\s*(?:s|m\s*\d+\s*s)/i.test(history?.process?.header ?? "") &&
        /(explor|read|search|ran|used)/i.test(history?.process?.header ?? ""),
      `header ${JSON.stringify(history?.process?.header)}`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      session: SESSION_ID,
      script: {
        calls: 3,
        rows: EXPECTED_ROWS,
        answer: FINAL_ANSWER,
        narration: NARRATION_TEXT,
        commentary: COMMENTARY_TEXT,
        usage: USAGE,
      },
      decode: wire,
      live: {
        running: summaryOf(liveRunning),
        beforeFinal: summaryOf(beforeFinal),
        // The settled sample is taken folded (what the operator first sees);
        // `opened` is the same turn with its disclosure opened, where the rows
        // and narration live after the fold unmounted the body.
        settled: summaryOf(settledOne),
        opened: summaryOf(settledOneOpen),
      },
      settled: {
        fold: summaryOf(settledFold),
        secondTurn: summaryOf(settledTwo),
        bothFolded: (bothFolded.turns ?? []).map((entry) => ({
          user: entry.user,
          process: entry.process?.state ?? null,
        })),
        afterFirstOpen: summaryOf(afterFirstOpen),
        afterSecondOpen: summaryOf(afterSecondOpen),
      },
      incomplete: summaryOf(incomplete),
      stopped: summaryOf(stopped),
      capability: {
        hermes: { live: summaryOf(hermesLive), settled: summaryOf(hermesSettled) },
        floor: summaryOf(floor),
      },
      history: {
        initial: summaryOf(historyFolded),
        opened: summaryOf(history),
        sameRows: JSON.stringify(historyRows.map((row) => row.text)) ===
          JSON.stringify(settledRows.map((row) => row.text)),
      },
      screenshots,
      checks,
      counts: {
        checks: checks.length,
        passed: checks.filter((entry) => entry.pass).length,
        failed: failures.length,
        turnsPlayed: sentTurns,
        framesPlayed: emittedFrames,
        toolCalls: 3,
        rows: EXPECTED_ROWS.length,
      },
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      checks,
      counts: { checks: checks.length, passed: checks.filter((entry) => entry.pass).length, failed: failures.length },
      failures: [...failures, `threw: ${error instanceof Error ? error.message : String(error)}`],
      screenshots,
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "turn-timeline.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`checks: ${report.counts?.passed ?? 0}/${report.counts?.checks ?? 0}`);
  console.log(`script: ${JSON.stringify(report.script ?? {})}`);
  // The folded settled sample has no rows by design; print the reopened one.
  console.log(`live: ${JSON.stringify(report.live?.opened?.process?.rows ?? null)}`);
  console.log(`settled: ${JSON.stringify(report.settled?.fold?.process?.header ?? null)}`);
  console.log(`footer: ${JSON.stringify(report.settled?.fold?.footer ?? null)}`);
  console.log(`incomplete: ${JSON.stringify(report.incomplete?.footer ?? null)}`);
  console.log(`stopped: ${JSON.stringify(report.stopped?.footer ?? null)}`);
  console.log(`history: ${JSON.stringify(report.history?.opened?.process?.rows ?? null)}`);
  console.log(`screenshots: ${JSON.stringify(report.screenshots ?? [])}`);
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "turn timeline: PASS" : "turn timeline: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`turn-timeline: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
