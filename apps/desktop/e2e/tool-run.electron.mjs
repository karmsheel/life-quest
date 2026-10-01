/**
 * Drives the chat panel harness through a tool-heavy turn and turns what the
 * transcript did with it into `e2e/artifacts/tool-run.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   npx electron e2e/tool-run.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * A system-in-isolation rig, so the failure modes it exists to expose are
 * written down before the assertions:
 *
 *  1. One bubble per tool event — the regression this rig was built for. Eight
 *     calls used to push sixteen `tool:` / `tool done:` bubbles into the
 *     transcript, burying the conversation under its own plumbing.
 *  2. Tool call shown as if Hermes said it — tool activity belongs beside the
 *     reply, not as an assistant message. Asserted by the absence of `tool:`
 *     pseudo-messages AND by the message count not moving.
 *  3. Run not collapsed by default — the whole point is one line; an expanded
 *     list on arrival is the original problem in a smaller font.
 *  4. Nothing to open — a run of many calls must be openable, with one row per
 *     call, and the row must name what the call acted on.
 *  5. Wrong tense — a call still running narrates in the present ("Running
 *     npm run test"), everything settled reads as done ("Ran 1 command"). A
 *     finished run narrating work in progress is the panel lying about state.
 *  6. Wire mapping: `api_server._tool_progress` sends `tool_name` and `args`,
 *     not `name`/`ok`. Reading the wrong key is why every row used to say the
 *     literal word "tool" and why every row claimed success.
 *  7. Unbounded target — the target on the line is bounded (48 chars, path
 *     reduced to its basename), so a pasted 200-line command cannot stretch the
 *     activity line into the transcript.
 *  8. Same-name pairing — two `terminal` calls and one completion must leave
 *     the SECOND pending, oldest-first, or the tense flips a running call to
 *     finished.
 *  9. Stale activity — the line must not outlive its turn: a new send, or
 *     opening another chat, starts with a clean transcript.
 * 10. Thinking row duplication — before the first tool frame the panel shows
 *     `Thinking…`; once there is activity to read, both would say the same
 *     thing twice.
 *
 * The frames are byte-for-byte the shape the gateway sends, fed through the
 * app's own `parseSseBlock` — the driver never hand-builds an event object, so
 * failures 6 and 7 are asserted against the wire format rather than against the
 * panel's idea of it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";

// Each rig gets its own Electron profile. The app keeps its last-opened chat
// (and other window state) in localStorage, so two rigs sharing one profile can
// see each other's writes -- which is how a rig ends up starting on the chat a
// previous run left open, and why a switch-to-the-other-chat check can pass
// alone and fail when the whole suite runs the rigs side by side.
const userDataDir = path.join(artifactsDir, "userdata", "tool-run");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `_SessionEventQueue.payload` stamps message_id onto every tool frame. */
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const started = (tool, args, preview = "") =>
  frame("tool.started", { message_id: "msg_1", tool_name: tool, preview, args });
const completed = (tool, args, preview = "") =>
  frame("tool.completed", { message_id: "msg_1", tool_name: tool, preview, args });

const AGENTS_PATH = "C:/Users/karms/Projects/life-quest/AGENTS.md";
const PANEL_PATH = "src/components/hermes/ChatPanel.tsx";
const STYLES_PATH = "C:/Users/karms/Projects/life-quest/apps/desktop/src/styles/global.css";
const TEST_COMMAND = "npm run test -w @lifequest/desktop";

/**
 * The turn the rig builds: seven calls across all five categories, reported the
 * way an agent makes them — one tool at a time, so at most one call is ever in
 * flight. Stage A stops with the command still running, which is the only way to
 * see the present tense.
 */
const STAGE_A = [
  started("read_file", { path: AGENTS_PATH }),
  completed("read_file", { path: AGENTS_PATH }),
  started("search_files", { query: "composer" }),
  completed("search_files", { query: "composer" }),
  started("terminal", { command: TEST_COMMAND }),
];
const STAGE_B = [completed("terminal", { command: TEST_COMMAND })];
const STAGE_C_CALLS = [
  { args: { mode: "replace", path: STYLES_PATH }, tool: "patch" },
  {
    args: { content: "x".repeat(400), path: "e2e/tool-run.electron.mjs" },
    tool: "write_file",
  },
  { args: { goal: "Review the composer diff" }, tool: "delegate_task" },
  // `clarify` is the "other" bucket: nothing to edit, explore or run.
  { args: { question: "Which chat?" }, tool: "clarify" },
];
const STAGE_C = STAGE_C_CALLS.flatMap(({ args, tool }) => [
  started(tool, args),
  completed(tool, args),
]);
/** Every call the turn makes, in order: the rows the disclosure must show. */
const TURN_CALLS = [
  { args: { path: AGENTS_PATH }, tool: "read_file" },
  { args: { query: "composer" }, tool: "search_files" },
  { args: { command: TEST_COMMAND }, tool: "terminal" },
  ...STAGE_C_CALLS,
];
/**
 * A live turn long enough to observe, short enough not to slow the rig down.
 * All three sends use it, and the switch at the end waits the last one out.
 */
const LIVE_MS = 3000;


/** What the transcript is doing, read off the DOM the user is looking at. */
const STATE = `(() => {
  const line = document.querySelector(".chat-panel__activity-line");
  const list = document.querySelector(".chat-panel__activity-list");
  const rows = list ? [...list.querySelectorAll(".chat-panel__activity-row")] : [];
  // The thinking row is a bubble too, and tool pseudo-messages used to be: the
  // transcript is what a reload would show, so those are counted apart.
  const bubbles = [...document.querySelectorAll(".chat-panel__message")]
    .filter((el) => !el.querySelector(".chat-panel__thinking"))
    .map((el) => el.querySelector(".chat-panel__message-content")?.textContent ?? "");
  return {
    lineText: line ? line.textContent.trim() : null,
    lineTag: line ? line.tagName : null,
    expandable: line ? line.hasAttribute("aria-expanded") : false,
    expanded: line ? line.getAttribute("aria-expanded") : null,
    caretOpen: Boolean(document.querySelector(".chat-panel__activity-caret--open")),
    // The line is one row by contract: a long summary must ellipsize inside the
    // panel, never widen the transcript.
    lineFits: line ? line.scrollWidth <= line.clientWidth + 1 : null,
    listFits: list ? list.scrollWidth <= list.clientWidth + 1 : null,
    listVisible: Boolean(list),
    rows: rows.map((row) => row.textContent.trim()),
    bubbles,
    toolBubbles: bubbles.filter((text) => /^tool( done| failed)?:/.test(text)).length,
    thinking: Boolean(document.querySelector(".chat-panel__thinking")),
    activityBlocks: document.querySelectorAll(".chat-panel__activity").length,
    activeTitle:
      document.querySelector(".chat-panel__heading--thread")?.textContent.trim() ?? null
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/** Send a prompt through the real composer, exactly as a user would. */
const SEND = (text, delayMs) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.__lqChatDelay = ${delayMs};
  const el = document.querySelector(".chat-panel__composer-input");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(60);
  document.querySelector(".chat-panel__send").click();
  await wait(120);
  return true;
})()`;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  /** Decode a wire frame with the app's own parser, then hand it to the panel. */
  const emit = async (raw) => {
    const decoded = await run(
      `(() => {
        const evt = window.__lqParseSse(${JSON.stringify(raw)});
        if (evt) window.__lqEmit(evt);
        return evt;
      })()`,
    );
    if (!decoded) throw new Error(`frame did not decode: ${raw.split("\n")[0]}`);
    return decoded;
  };
  const emitAll = async (frames) => {
    for (const raw of frames) await emit(raw);
  };

  const state = () => run(STATE);

  const waitFor = async (expression, label, timeoutMs = 8000) => {
    const from = Date.now();
    while (Date.now() - from < timeoutMs) {
      if (await run(expression)) return true;
      await sleep(120);
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  /** A send while a turn is live lands on the stop square, not the composer. */
  const settle = () =>
    waitFor(
      `document.querySelector(".chat-panel__composer-input").disabled === false`,
      "the running turn to close",
      12_000,
    );

  const shoot = async (name) => {
    const file = path.join(artifactsDir, `tool-run-${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return file;
  };

  let report;
  const timeout = setTimeout(() => {
    console.error("tool-run: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    // The panel remembers the last chat it opened in localStorage, which the
    // Electron profile keeps between runs — so the rig would start on whichever
    // chat the previous run ended on, and "switch to the other chat" would
    // sometimes be a no-op. Clear the pointer and reload: `sessions[0]` it is.
    await run(`localStorage.removeItem("lifequest.companion.lastSessionId")`);
    const reloaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    win.webContents.reload();
    await reloaded;
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);
    win.showInactive();
    await waitFor(
      `document.querySelectorAll(".chat-panel__message").length >= 2`,
      "the open chat's transcript",
    );

    // --- wire mapping (no UI): the fields the gateway actually sends ---------
    const decodedPath = await run(
      `window.__lqParseSse(${JSON.stringify(started("read_file", { path: AGENTS_PATH }))})`,
    );
    const decodedQuery = await run(
      `window.__lqParseSse(${JSON.stringify(started("search_files", { query: "composer" }))})`,
    );
    const decodedLong = await run(
      `window.__lqParseSse(${JSON.stringify(started("terminal", { command: "x".repeat(200) }))})`,
    );
    const decodedStringArgs = await run(
      `window.__lqParseSse(${JSON.stringify(started("terminal", JSON.stringify({ command: "ls -la" })))})`,
    );
    const decodedLegacyName = await run(
      `window.__lqParseSse(${JSON.stringify(frame("tool.started", { name: "read_file" }))})`,
    );
    const decodedCompletion = await run(
      `window.__lqParseSse(${JSON.stringify(completed("terminal", { command: TEST_COMMAND }))})`,
    );

    check(
      "wire: tool_name carries the name",
      decodedPath?.name === "read_file",
      `decoded ${JSON.stringify(decodedPath)} — the wire key is tool_name, not name`,
    );
    check(
      "wire: args name the target",
      decodedPath?.target === "AGENTS.md" && decodedQuery?.target === "composer",
      `path target ${JSON.stringify(decodedPath?.target)}, query target ${JSON.stringify(decodedQuery?.target)}`,
    );
    check(
      "wire: the target is bounded",
      typeof decodedLong?.target === "string" &&
        decodedLong.target.length === 48 &&
        decodedLong.target.endsWith("\u2026"),
      `200-char command produced a ${decodedLong?.target?.length}-char target`,
    );
    check(
      "wire: string args still parse",
      decodedStringArgs?.target === "ls -la",
      `decoded ${JSON.stringify(decodedStringArgs)}`,
    );
    check(
      "wire: a name-only frame still works",
      decodedLegacyName?.name === "read_file" && decodedLegacyName?.target === "",
      `decoded ${JSON.stringify(decodedLegacyName)}`,
    );
    check(
      "wire: completion carries no status claim",
      decodedCompletion?.type === "tool.completed" &&
        decodedCompletion?.ok === undefined &&
        decodedCompletion?.name === "terminal",
      `decoded ${JSON.stringify(decodedCompletion)}`,
    );

    // --- a live turn, before any tool has run -------------------------------
    const rest = await state();
    await run(SEND("Do the thing", LIVE_MS));
    await waitFor(`Boolean(document.querySelector(".chat-panel__thinking"))`, "the thinking row");
    const beforeTools = await state();

    // --- stage A: three calls in flight -------------------------------------
    await emitAll(STAGE_A);
    await sleep(120);
    const stageA = await state();
    const collapsedShot = await shoot("collapsed");

    // --- stage B: all three settle ------------------------------------------
    await emitAll(STAGE_B);
    await sleep(120);
    const stageB = await state();

    // --- stage C: five more calls, all settled ------------------------------
    await emitAll(STAGE_C);
    await sleep(120);
    const stageC = await state();

    // --- the disclosure -----------------------------------------------------
    await run(`document.querySelector(".chat-panel__activity-line").click()`);
    await sleep(120);
    const opened = await state();
    const expandedShot = await shoot("expanded");

    // --- the ellipsis surface, measured not gated ---------------------------
    // How far the closed line's text runs past its own box: with the ellipsis
    // surface in place this is 0 and the text is clipped instead. Measured rather
    // than asserted because the summary at this text length overflows by about a
    // pixel, which is a coin flip, not a contract.
    const overflow = await run(`(() => {
      const line = document.querySelector(".chat-panel__activity-line");
      const span = line ? line.querySelector("span") : null;
      return {
        lineOverflowPx: line ? Math.max(0, line.scrollWidth - line.clientWidth) : null,
        textClipped: span ? span.scrollWidth > span.clientWidth : null
      };
    })()`);

    // --- oldest-first pairing on a repeated tool ----------------------------
    // Two `terminal` calls with a `read_file` between them, then one completion:
    // oldest-first leaves the READ pending, so the read is what narrates. Pairing
    // newest-first would leave a terminal pending and flip the tense the other
    // way — the two readings differ, which is the only way this rule is visible.
    await settle();
    await run(SEND("Again", LIVE_MS));
    await emitAll([
      started("terminal", { command: "ls" }),
      started("read_file", { path: AGENTS_PATH }),
      started("terminal", { command: "pwd" }),
    ]);
    await emit(completed("terminal", { command: "ls" }));
    await sleep(120);
    const sameName = await state();

    // --- a new turn starts clean --------------------------------------------
    await settle();
    await run(SEND("Once more", LIVE_MS));
    await sleep(120);
    const nextTurn = await state();
    await emit(started("read_file", { path: PANEL_PATH }));
    await sleep(120);
    const afterNextFrame = await state();

    // --- opening another chat drops the turn's evidence ---------------------
    // The chat rows live in the list view, and they are disabled while a turn is
    // live — exactly as in the app — so the last stream is waited out first.
    await settle();
    const switched = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelector('.chat-panel__icon-btn[aria-label="All chats"]').click();
      await wait(160);
      const rows = [...document.querySelectorAll(".chat-panel__session")];
      // Select by the chat's own title, not by which row looks unselected: the
      // active marker depends on state the rig should not have to guess at.
      const other = rows.find((el) =>
        (el.getAttribute("title") || el.textContent).includes("Second chat")
      );
      if (!other) {
        return { clicked: false, reason: "no second chat among " + rows.length + " rows" };
      }
      other.click();
      await wait(200);
      const afterClick = [...document.querySelectorAll(".chat-panel__message-content")].map(
        (el) => el.textContent
      );
      // Wait for the clear rather than for a fixed time: what is asserted is that
      // the old turn's activity stops being rendered, and polling for that is the
      // difference between a signal and a race.
      let activityGone = false;
      for (let i = 0; i < 50; i += 1) {
        if (!document.querySelector(".chat-panel__activity")) {
          activityGone = true;
          break;
        }
        await wait(80);
      }
      return {
        activityGone,
        afterClick,
        clicked: true,
        rows: rows.length,
        activity: Boolean(document.querySelector(".chat-panel__activity")),
        lineText: document.querySelector(".chat-panel__activity-line")?.textContent.trim() ?? null,
        transcript: [...document.querySelectorAll(".chat-panel__message-content")].map(
          (el) => el.textContent
        ),
      };
    })()`);

    // --- assertions ---------------------------------------------------------
    check(
      "one line, not one bubble per event",
      stageC.activityBlocks === 1 && stageC.toolBubbles === 0,
      `${stageC.activityBlocks} activity blocks, ${stageC.toolBubbles} tool pseudo-bubbles after 8 calls`,
    );
    check(
      "tool activity is not written into the transcript",
      beforeTools.bubbles.length === rest.bubbles.length + 1 &&
        stageC.bubbles.length === rest.bubbles.length + 1,
      `transcript went ${rest.bubbles.length} → ${beforeTools.bubbles.length} (after the send) → ${stageC.bubbles.length} (after ${TURN_CALLS.length} calls)`,
    );
    check(
      "a running call narrates in the present",
      stageA.lineText === "Explored 2 files, running " + TEST_COMMAND,
      `line said ${JSON.stringify(stageA.lineText)}`,
    );
    check(
      "a settled call reads as done",
      stageB.lineText === "Explored 2 files, ran 1 command",
      `line said ${JSON.stringify(stageB.lineText)}`,
    );
    check(
      "the whole run reads as one clause per category",
      stageC.lineText ===
        "Edited 2 files, explored 2 files, ran 1 command, delegated Review the composer diff, used 1 tool",
      `line said ${JSON.stringify(stageC.lineText)}`,
    );
    check(
      "collapsed by default",
      stageC.lineTag === "BUTTON" &&
        stageC.expandable &&
        stageC.expanded === "false" &&
        stageC.listVisible === false &&
        stageC.rows.length === 0 &&
        stageC.caretOpen === false,
      `line ${stageC.lineTag} expanded=${stageC.expanded}, list ${stageC.listVisible}, ${stageC.rows.length} rows`,
    );
    check(
      "opening it shows every call, with what it acted on",
      opened.expanded === "true" &&
        opened.listVisible &&
        opened.caretOpen &&
        opened.rows.length === TURN_CALLS.length &&
        opened.rows[0] === "read_file \u00b7 AGENTS.md" &&
        opened.rows[2] === `terminal \u00b7 ${TEST_COMMAND}`,
      `${opened.rows.length} of ${TURN_CALLS.length} rows: ${JSON.stringify(opened.rows.slice(0, 3))}`,
    );
    check(
      "the thinking row gives way to real activity",
      beforeTools.thinking === true &&
        stageA.thinking === false &&
        nextTurn.thinking === true,
      `thinking before tools ${beforeTools.thinking}, during ${stageA.thinking}, after the next send ${nextTurn.thinking}`,
    );
    check(
      "same name, oldest first",
      sameName.lineText === "Exploring AGENTS.md, ran 2 commands",
      `line said ${JSON.stringify(sameName.lineText)} — a repeated tool must resolve the call that started first`,
    );
    check(
      "a new turn starts with no activity",
      nextTurn.activityBlocks === 0 && afterNextFrame.rows.length === 0,
      `${nextTurn.activityBlocks} blocks survived the send, ${afterNextFrame.rows.length} rows`,
    );
    check(
      "the rig starts on a known chat",
      rest.activeTitle === "Harness",
      `the panel opened ${JSON.stringify(rest.activeTitle)}`,
    );
    check(
      "another chat drops the previous turn's activity",
      switched.clicked && switched.activityGone === true && switched.activity === false,
      `switched=${switched.clicked} among ${switched.rows} rows, cleared=${switched.activityGone}, activity=${switched.activity}${
        switched.reason ? ` (${switched.reason})` : ""
      }`,
    );
    check(
      "the switch really landed",
      Array.isArray(switched.transcript) &&
        switched.transcript.some((text) => text.includes("Loaded the other chat")),
      `transcript after the switch: ${JSON.stringify(switched.transcript)}`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      calls: TURN_CALLS.length,
      frames: STAGE_A.length + STAGE_B.length + STAGE_C.length,
      transcript: {
        rest: rest.bubbles,
        afterSend: beforeTools.bubbles,
        afterCalls: stageC.bubbles,
        toolBubbles: stageC.toolBubbles,
      },
      decode: {
        path: decodedPath,
        query: decodedQuery,
        longCommand: decodedLong,
        stringArgs: decodedStringArgs,
        nameOnly: decodedLegacyName,
        completion: decodedCompletion,
      },
      line: {
        livePartiallySettled: stageA.lineText,
        settled: stageB.lineText,
        wholeRun: stageC.lineText,
        sameName: sameName.lineText,
      },
      ellipsis: overflow,
      disclosure: {
        collapsed: {
          tag: stageC.lineTag,
          expanded: stageC.expanded,
          rows: stageC.rows.length,
          caretOpen: stageC.caretOpen,
        },
        opened: {
          expanded: opened.expanded,
          rows: opened.rows,
          caretOpen: opened.caretOpen,
        },
      },
      thinking: {
        beforeTools: beforeTools.thinking,
        withActivity: stageA.thinking,
        nextTurn: nextTurn.thinking,
      },
      reset: {
        newTurnBlocks: nextTurn.activityBlocks,
        switchedActivity: switched.activity,
        switchedAfterClick: switched.afterClick,
        switchedTranscript: switched.transcript,
      },
      screenshots: [collapsedShot, expandedShot],
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [...failures, `threw: ${error instanceof Error ? error.message : String(error)}`],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "tool-run.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`calls: ${report.calls ?? "?"}`);
  console.log(`transcript: ${JSON.stringify(report.transcript ?? {})}`);
  console.log(`line: ${JSON.stringify(report.line ?? {})}`);
  console.log(`disclosure: ${JSON.stringify(report.disclosure ?? {})}`);
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "tool run: PASS" : "tool run: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`tool-run: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
