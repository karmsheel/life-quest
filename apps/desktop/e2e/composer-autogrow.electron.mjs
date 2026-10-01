/**
 * Drives the composer autogrow harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/composer-autogrow.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/run-composer-autogrow.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";

/** Matches ChatPanel: cap is half the panel, with a floor for short panels. */
const CAP_RATIO = 0.5;
const CAP_FLOOR_PX = 72;
// Each rig gets its own Electron profile. The app keeps its last-opened chat
// (and other window state) in localStorage, so two rigs sharing one profile can
// see each other's writes -- which is how a rig ends up starting on the chat a
// previous run left open, and why a switch-to-the-other-chat check can pass
// alone and fail when the whole suite runs the rigs side by side.
const userDataDir = path.join(artifactsDir, "userdata", "composer-autogrow");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };
/** Width the removed side-by-side send button + row gap used to occupy. */
const OLD_SEND_COLUMN_PX = Math.round(3.25 * 16 + 0.4 * 16);

/**
 * The first frame of a session stream, byte-for-byte the shape the gateway
 * sends: `api_server.py` enqueues `("run.started", {user_message, runtime})`
 * and `_SessionEventQueue.payload` stamps session_id/run_id/seq/ts onto it.
 */
const RUN_STARTED_FRAME =
  'event: run.started\ndata: {"user_message":{"role":"user","content":"hi"},"runtime":{"route_source":"global"},"session_id":"harness-session","run_id":"run_harness_1","seq":1,"ts":1700000000.1}\n\n';

/**
 * The two terminal frames, same source: the run ends as `cancelled` with
 * `interrupted: true` (stop endpoint), or as `failed` with the reason the turn
 * stopped short (`api_server_runs.terminal_run_status` fields).
 */
const RUN_CANCELLED_FRAME =
  'event: run.cancelled\ndata: {"session_id":"harness-session","message_id":"msg_1","completed":false,"partial":true,"interrupted":true,"usage":{},"runtime":{"route_source":"global"},"run_id":"run_harness_1","seq":9,"ts":1700000009.1}\n\n';
const RUN_FAILED_FRAME =
  'event: run.failed\ndata: {"session_id":"harness-session","message_id":"msg_1","completed":false,"partial":false,"interrupted":false,"turn_exit_reason":"iteration budget","run_id":"run_harness_2","seq":4,"ts":1700000010.2}\n\n';

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

/** Steps are ordered: height must never fall as text grows, unless flagged. */
const STEPS = [
  { label: "rest", text: "" },
  { label: "one-line", text: "Short prompt." },
  { label: "two-lines", text: "Short prompt.\nSecond line." },
  { label: "three-lines", text: lines(3) },
  { label: "wrapped-160", text: "w".repeat(160) },
  { label: "eight-lines", text: lines(8) },
  { label: "twenty-lines", text: lines(20) },
  { label: "sixty-lines", text: lines(60) },
  { label: "paste-200-lines", text: lines(200) },
  { label: "back-to-one-line", text: "Short prompt.", expectShrink: true },
  { label: "cleared", text: "", expectShrink: true },
];

/** Steps whose content genuinely outgrows the half-panel cap. */
const CAPPED_STEPS = ["sixty-lines", "paste-200-lines"];

const SAMPLE = `(() => {
  const el = document.querySelector(".chat-panel__composer-input");
  const panel = document.querySelector(".chat-panel");
  const body = document.querySelector(".chat-panel__body");
  const footer = document.querySelector(".chat-panel__footer");
  const header = document.querySelector(".chat-panel__header");
  const send = document.querySelector(".chat-panel__send");
  if (!el || !panel) return null;
  const styles = getComputedStyle(el);
  const fieldBox = el.getBoundingClientRect();
  const sendBox = send ? send.getBoundingClientRect() : null;
  const row = el.parentElement;
  return {
    draftChars: el.value.length,
    draftLines: el.value ? el.value.split("\\n").length : 0,
    fieldHeight: el.offsetHeight,
    fieldScrollHeight: el.scrollHeight,
    fieldClientHeight: el.clientHeight,
    fieldOverflowY: getComputedStyle(el).overflowY,
    fieldInlineHeight: el.style.height || null,
    fieldDisabled: el.disabled,
    fieldWidth: el.offsetWidth,
    fieldUsableWidth: Math.round(
      el.clientWidth - (parseFloat(styles.paddingLeft) || 0) - (parseFloat(styles.paddingRight) || 0)
    ),
    fieldPaddingRight: Math.round(parseFloat(styles.paddingRight) || 0),
    fieldPaddingLeft: Math.round(parseFloat(styles.paddingLeft) || 0),
    rowWidth: row ? row.clientWidth : 0,
    fieldSpansRow: row ? el.offsetWidth === row.clientWidth : false,
    sendPresent: Boolean(send),
    sendIconOnly: send ? send.textContent.trim().length === 0 : null,
    sendLabel: send ? send.getAttribute("aria-label") : null,
    sendDisabled: send ? send.disabled : null,
    sendSize: send ? send.offsetWidth : null,
    sendSquare: send ? send.offsetWidth === send.offsetHeight : null,
    sendRadius: send ? parseFloat(getComputedStyle(send).borderRadius) || 0 : null,
    sendInsideField: sendBox
      ? {
          left: Math.round(sendBox.left - fieldBox.left),
          bottom: Math.round(fieldBox.bottom - sendBox.bottom),
          inside:
            sendBox.right <= fieldBox.right + 0.5 &&
            sendBox.left >= fieldBox.left - 0.5 &&
            sendBox.bottom <= fieldBox.bottom + 0.5 &&
            sendBox.top >= fieldBox.top - 0.5
        }
      : null,
    panelHeight: panel.clientHeight,
    panelBodyHeight: body ? body.clientHeight : 0,
    panelFooterHeight: footer ? footer.offsetHeight : 0,
    panelHeaderHeight: header ? header.offsetHeight : 0,
    scrolls: el.scrollHeight > el.clientHeight + 1,
    viewportHeight: window.innerHeight
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  let report;
  const timeout = setTimeout(() => {
    console.error("composer-autogrow: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");

    // Fixed content size so the panel height — and therefore the cap — is a
    // known quantity rather than whatever the WM decided.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    const sampleAfter = async (text) => {
      const value = await run(`(async () => {
        const el = document.querySelector(".chat-panel__composer-input");
        if (!el) return null;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
        return ${SAMPLE};
      })()`);
      if (!value) throw new Error("composer input disappeared mid-run");
      return value;
    };

    const samples = [];
    for (const step of STEPS) {
      const sample = await sampleAfter(step.text);
      samples.push({ step: step.label, ...sample });
    }

    const rest = samples[0];
    const capPx = Math.max(
      Math.round(rest.panelHeight * CAP_RATIO),
      CAP_FLOOR_PX,
    );

    // 1/8 — no sample is shorter than the resting composer, the panel height
    // never moves, and the transcript keeps real room throughout.
    const tallest = Math.max(...samples.map((s) => s.fieldHeight));
    check(
      "resting floor",
      samples.every((s) => s.fieldHeight >= rest.fieldHeight),
      `some step dipped under the resting height ${rest.fieldHeight}px`,
    );
    check(
      "panel stability",
      samples.every((s) => s.panelHeight === rest.panelHeight),
      `panel height moved from ${rest.panelHeight}px`,
    );
    check(
      "transcript room",
      samples.every((s) => s.panelBodyHeight > 0),
      "panel body collapsed while the composer grew",
    );
    check(
      "no overshoot",
      samples.every((s) => s.fieldHeight <= capPx + 1),
      `tallest field ${tallest}px exceeded the ${capPx}px cap`,
    );

    // 2 — growth is monotonic over the ordered steps (the two deliberate
    // shrink steps are checked on their own below).
    for (let i = 1; i < samples.length; i += 1) {
      const step = STEPS[i];
      const previous = samples[i - 1];
      const current = samples[i];
      if (step.expectShrink) continue;
      check(
        `monotonic:${current.step}`,
        current.fieldHeight >= previous.fieldHeight,
        `${previous.step} ${previous.fieldHeight}px then ${current.step} ${current.fieldHeight}px`,
      );
    }

    // 3 — the tall steps sit exactly on the cap and scroll in place.
    for (const step of CAPPED_STEPS) {
      const sample = samples.find((s) => s.step === step);
      if (!sample) continue;
      check(
        `cap:${step}`,
        Math.abs(sample.fieldHeight - capPx) <= 1,
        `${sample.fieldHeight}px vs cap ${capPx}px`,
      );
      check(
        `overflow:${step}`,
        sample.fieldOverflowY === "auto",
        `overflowY was ${sample.fieldOverflowY}`,
      );
      check(`scrolls:${step}`, sample.scrolls, "field reported no internal scroll at the cap");
    }

    // 4 — below the cap the field hugs its content: a long *unbroken* line has
    // to wrap the field taller (not only explicit newlines), and the middle of
    // the ladder stays unclamped instead of jumping straight to the cap.
    const eight = samples.find((s) => s.step === "eight-lines");
    const twenty = samples.find((s) => s.step === "twenty-lines");
    const wrapped = samples.find((s) => s.step === "wrapped-160");
    check(
      "wraps without newlines",
      wrapped.draftLines === 1 && wrapped.fieldHeight > rest.fieldHeight,
      `160-char single line stayed at ${wrapped.fieldHeight}px (resting ${rest.fieldHeight}px)`,
    );
    check(
      "unclamped below cap",
      eight.fieldHeight > rest.fieldHeight &&
        eight.fieldHeight < capPx &&
        twenty.fieldHeight < capPx &&
        twenty.fieldHeight > eight.fieldHeight,
      `eight ${eight.fieldHeight}px / twenty ${twenty.fieldHeight}px vs cap ${capPx}px`,
    );
    check(
      "no premature scroll",
      !eight.scrolls && !twenty.scrolls,
      "field scrolled internally before reaching the cap",
    );

    // 5 — the field is short again the moment the text is: no latched clamp.
    const backToOne = samples.find((s) => s.step === "back-to-one-line");
    const cleared = samples.find((s) => s.step === "cleared");
    check(
      "shrinks back",
      backToOne.fieldHeight === rest.fieldHeight,
      `one-line field is ${backToOne.fieldHeight}px, resting is ${rest.fieldHeight}px`,
    );
    check(
      "cleared resets",
      cleared.fieldHeight === rest.fieldHeight && cleared.fieldOverflowY === "hidden",
      `cleared field ${cleared.fieldHeight}px / overflowY ${cleared.fieldOverflowY}`,
    );

    // 6 — the inline send control. The old layout paid for it with a sibling
    // column (3.25rem button + 0.4rem gap = 58px); the field now owns the whole
    // composer width and the control sits inside it, costing only a gutter.
    const withText = samples.find((s) => s.step === "one-line");
    check(
      "send hidden while empty",
      rest.sendPresent === false,
      "the send control rendered on an empty composer",
    );
    check(
      "field spans the row",
      samples.every((s) => s.fieldSpansRow),
      "the textarea did not own the full composer width",
    );
    check("send appears with text", withText.sendPresent === true, "no send control with text in the field");
    check("send is icon-only", withText.sendIconOnly === true, `button carried text: ${withText.sendLabel}`);
    check(
      "send is a round 26px control",
      withText.sendSize === 26 && withText.sendSquare === true && withText.sendRadius >= 12.5,
      `size ${withText.sendSize}px / square ${withText.sendSquare} / radius ${withText.sendRadius}px`,
    );
    check(
      "send sits inside the field",
      withText.sendInsideField?.inside === true,
      `send box ${JSON.stringify(withText.sendInsideField)}`,
    );
    check(
      "send enabled with text",
      withText.sendDisabled === false,
      "the send control was disabled with text in the field and a session",
    );
    check(
      "gutter costs less than the old column",
      withText.fieldPaddingRight < OLD_SEND_COLUMN_PX,
      `gutter ${withText.fieldPaddingRight}px vs the removed ${OLD_SEND_COLUMN_PX}px column`,
    );
    check(
      "no gutter while empty",
      rest.fieldPaddingRight < withText.fieldPaddingRight,
      `empty field kept the ${rest.fieldPaddingRight}px gutter`,
    );
    check(
      "control never overlaps text",
      // Text runs from the left padding to the left padding + usable width; the
      // control's left edge has to start at or after that, or the last wrapped
      // line disappears under the button.
      withText.fieldPaddingLeft + withText.fieldUsableWidth <= withText.sendInsideField.left,
      `text reaches ${withText.fieldPaddingLeft + withText.fieldUsableWidth}px, control starts at ${withText.sendInsideField.left}px`,
    );

    const sendText = "Sent with the inline icon button";
    const sendClick = await run(`(async () => {
      window.__lqChatCalls = [];
      const el = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(sendText)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      const button = document.querySelector(".chat-panel__send");
      const present = Boolean(button);
      const enabled = present && !button.disabled;
      if (button) button.click();
      await new Promise((r) => setTimeout(r, 300));
      return {
        present,
        enabled,
        calls: (window.__lqChatCalls || []).map((call) => call.input),
        draftAfter: document.querySelector(".chat-panel__composer-input").value,
        sendPresentAfter: Boolean(document.querySelector(".chat-panel__send")),
      };
    })()`);
    check(
      "icon button submits the draft",
      sendClick.calls.length === 1 && sendClick.calls[0] === sendText,
      `calls ${JSON.stringify(sendClick.calls)}`,
    );
    check("draft clears after send", sendClick.draftAfter === "", `draft was "${sendClick.draftAfter}"`);
    check(
      "send hides again once sent",
      sendClick.sendPresentAfter === false,
      "the send control stayed on screen after the draft cleared",
    );

    // 7 — the same control in its streaming state. The stub holds the turn open
    // and the driver feeds the wire's own `run.started` frame through the real
    // SSE decoder, so this exercises main's mapping and the panel together.
    const streamText = "Start a run I can stop";
    const stream = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const readControl = () => {
        const button = document.querySelector(".chat-panel__send");
        const field = document.querySelector(".chat-panel__composer-input");
        const note = document.querySelector(".chat-panel__turn-note");
        return {
          present: Boolean(button),
          state: button ? button.getAttribute("data-state") : null,
          label: button ? button.getAttribute("aria-label") : null,
          disabled: button ? button.disabled : null,
          square: Boolean(button && button.querySelector(".chat-panel__send-stop")),
          arrow: Boolean(button && button.querySelector("svg")),
          fieldDisabled: field.disabled,
          note: note ? note.textContent.trim() : null,
          noteRole: note ? note.getAttribute("role") : null,
        };
      };
      window.__lqChatCalls = [];
      window.__lqStopCalls = [];
      window.__lqChatDelay = 2500;
      const form = document.querySelector(".chat-panel__composer");
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, ${JSON.stringify(streamText)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(60);
      document.querySelector(".chat-panel__send").click();
      await wait(160);
      const live = readControl();
      const decoded = window.__lqParseSse(${JSON.stringify(RUN_STARTED_FRAME)});
      if (decoded) window.__lqEmit(decoded);
      await wait(90);
      const afterRunStarted = readControl();
      // Count submit events only from here on: the stop click must not route
      // through the form, and a stop button still carrying type="submit" would.
      let submits = 0;
      const countSubmit = () => {
        submits += 1;
      };
      form.addEventListener("submit", countSubmit);
      document.querySelector(".chat-panel__send").click();
      await wait(160);
      const afterStopClick = { stops: (window.__lqStopCalls || []).slice(), ...readControl() };
      // The gateway closes a stopped run as run.cancelled, through the same decode.
      const decodedTerminal = window.__lqParseSse(${JSON.stringify(RUN_CANCELLED_FRAME)});
      const decodedFailed = window.__lqParseSse(${JSON.stringify(RUN_FAILED_FRAME)});
      if (decodedTerminal) window.__lqEmit(decodedTerminal);
      await wait(90);
      const afterCancelled = readControl();
      await wait(2600);
      const settled = readControl();
      form.removeEventListener("submit", countSubmit);
      window.__lqChatDelay = 0;
      return {
        live,
        decoded,
        afterRunStarted,
        afterStopClick,
        decodedTerminal,
        decodedFailed,
        afterCancelled,
        settled,
        submits,
        draft: field.value,
      };
    })()`);

    check(
      "stop square replaces the arrow while streaming",
      stream.live.present === true &&
        stream.live.state === "stop" &&
        stream.live.square === true &&
        stream.live.arrow === false,
      `live control ${JSON.stringify(stream.live)}`,
    );
    check(
      "stop square waits for a run id",
      stream.live.disabled === true && stream.live.label === "Stop this run",
      `before run.started: ${JSON.stringify(stream.live)}`,
    );
    check(
      "wire frame decodes to the run.started event",
      stream.decoded?.type === "run.started" && stream.decoded?.runId === "run_harness_1",
      `parseSseBlock gave ${JSON.stringify(stream.decoded)}`,
    );
    check(
      "stop square arms once the run is named",
      stream.afterRunStarted.disabled === false &&
        stream.afterRunStarted.state === "stop" &&
        stream.afterRunStarted.square === true,
      `after run.started: ${JSON.stringify(stream.afterRunStarted)}`,
    );
    check(
      "stop square calls the stop IPC with the run id",
      stream.afterStopClick.stops.length === 1 && stream.afterStopClick.stops[0] === "run_harness_1",
      `stops ${JSON.stringify(stream.afterStopClick.stops)}`,
    );
    check(
      "stopping does not fake the end of the turn",
      stream.afterStopClick.state === "stop" && stream.afterStopClick.fieldDisabled === true,
      `control while the gateway is still working: ${JSON.stringify(stream.afterStopClick)}`,
    );
    check(
      "control clears when the stream actually ends",
      stream.settled.present === false && stream.settled.fieldDisabled === false,
      `after the stream closed: ${JSON.stringify(stream.settled)}`,
    );
    check(
      "no phantom second send",
      stream.draft === "" && (await run("(window.__lqChatCalls || []).length")) === 1,
      "the stop click submitted the form",
    );
    check(
      "stop never routes through the form",
      stream.submits === 0,
      `the stop click fired ${stream.submits} form submit event(s)`,
    );

    // 8 — the gap this closes: a stopped turn must not read like a finished one.
    check(
      "terminal frames decode to turn outcomes",
      stream.decodedTerminal?.type === "run.stopped" &&
        stream.decodedFailed?.type === "run.incomplete" &&
        stream.decodedFailed?.reason === "iteration budget",
      `cancelled ${JSON.stringify(stream.decodedTerminal)} / failed ${JSON.stringify(stream.decodedFailed)}`,
    );
    check(
      "stopped turn is marked in the transcript",
      typeof stream.afterCancelled.note === "string" &&
        stream.afterCancelled.note.startsWith("Stopped") &&
        stream.afterCancelled.noteRole === "status",
      `note ${JSON.stringify(stream.afterCancelled.note)} / role ${stream.afterCancelled.noteRole}`,
    );
    check(
      "the marker outlives the stream it describes",
      stream.settled.note === stream.afterCancelled.note,
      `note after the stream closed: ${JSON.stringify(stream.settled.note)}`,
    );

    const nextTurn = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "Next turn");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(60);
      document.querySelector(".chat-panel__send").click();
      await wait(120);
      const note = document.querySelector(".chat-panel__turn-note");
      return { note: note ? note.textContent.trim() : null };
    })()`);
    check(
      "a new turn clears the previous outcome",
      nextTurn.note === null,
      `stale note survived into the next turn: ${JSON.stringify(nextTurn.note)}`,
    );

    const shot = async (name, text) => {
      const sample = await sampleAfter(text);
      const image = await win.webContents.capturePage();
      const file = path.join(artifactsDir, `composer-autogrow-${name}.png`);
      fs.writeFileSync(file, image.toPNG());
      return { sample, file };
    };

    // Capture the lifecycle: the stop square while a run is live, then the same
    // turn once the gateway has closed it as cancelled.
    await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.__lqChatDelay = 2000;
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "Hold this run open so the stop square is on screen");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(60);
      document.querySelector(".chat-panel__send").click();
      await wait(140);
      window.__lqEmit({ type: "run.started", runId: "run_screenshot" });
      await wait(90);
      return true;
    })()`);
    const streamingShot = path.join(artifactsDir, "composer-autogrow-streaming.png");
    fs.writeFileSync(streamingShot, (await win.webContents.capturePage()).toPNG());

    await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelector(".chat-panel__send").click();
      await wait(120);
      window.__lqEmit({ type: "run.stopped" });
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const stoppedShot = path.join(artifactsDir, "composer-autogrow-stopped.png");
    fs.writeFileSync(stoppedShot, (await win.webContents.capturePage()).toPNG());

    const shots = [
      await shot("rest", ""),
      await shot("mid", lines(4)),
      await shot("capped", lines(60)),
    ];

    // 5 — a panel resize re-clamps: the cap follows the panel, not the draft.
    const resizeChecks = [];
    const resizeText = lines(60);
    for (const size of [
      { label: "short-panel", width: 1100, height: 620 },
      { label: "tall-panel", width: 1100, height: 1400 },
      { label: "restored", ...DEFAULT_SIZE },
    ]) {
      win.setContentSize(size.width, size.height);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const sample = await sampleAfter(resizeText);
      const expected = Math.max(Math.round(sample.panelHeight * CAP_RATIO), CAP_FLOOR_PX);
      resizeChecks.push({ step: size.label, expectedCap: expected, ...sample });
      check(
        `resize-cap:${size.label}`,
        Math.abs(sample.fieldHeight - expected) <= 1,
        `field ${sample.fieldHeight}px vs cap ${expected}px for a ${sample.panelHeight}px panel`,
      );
    }
    check(
      "resize-cap-moves",
      resizeChecks[0].fieldHeight < resizeChecks[1].fieldHeight,
      `cap did not follow the panel (${resizeChecks[0].fieldHeight}px then ${resizeChecks[1].fieldHeight}px)`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      capRatio: CAP_RATIO,
      capFloorPx: CAP_FLOOR_PX,
      restHeightPx: rest.fieldHeight,
      capPx,
      restPanelHeight: rest.panelHeight,
      send: {
        hiddenWhileEmpty: rest.sendPresent === false,
        controlPx: withText.sendSize,
        gutterPx: withText.fieldPaddingRight,
        idleGutterPx: rest.fieldPaddingRight,
        removedColumnPx: OLD_SEND_COLUMN_PX,
        fieldWidthPx: withText.fieldWidth,
        fieldUsableWidthPx: withText.fieldUsableWidth,
        insideField: withText.sendInsideField,
        click: sendClick,
        stream,
      },
      samples,
      resizeChecks,
      screenshots: [...shots.map((entry) => entry.file), streamingShot, stoppedShot],
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

  const reportFile = path.join(artifactsDir, "composer-autogrow.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = (report.samples ?? []).map((s) => [
    s.step,
    String(s.draftLines),
    `${s.fieldHeight}px`,
    `${s.fieldScrollHeight}px`,
    s.fieldOverflowY,
    s.scrolls ? "yes" : "no",
    `${s.panelHeight}px`,
    `${s.panelBodyHeight}px`,
    `${s.panelFooterHeight}px`,
  ]);
  const header = [
    "step",
    "lines",
    "field",
    "content",
    "overflow",
    "scrolls",
    "panel",
    "body",
    "footer",
  ];
  const widths = header.map((_, i) =>
    Math.max(header[i].length, ...rows.map((row) => row[i].length)),
  );
  const format = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(format(row));
  console.log("");
  if (report.send) {
    console.log(
      `send: ${report.send.controlPx}px round control, ${report.send.gutterPx}px gutter ` +
        `(idle ${report.send.idleGutterPx}px), field ${report.send.fieldWidthPx}px → ` +
        `${report.send.fieldUsableWidthPx}px usable; the removed column cost ${report.send.removedColumnPx}px`,
    );
    console.log(
      `send click: submitted ${JSON.stringify(report.send.click.calls)} — button present ${report.send.click.present}/${report.send.click.enabled ? "enabled" : "disabled"}, ` +
        `gone after send ${report.send.click.sendPresentAfter}`,
    );
    console.log(
      `stream: frame → ${JSON.stringify(report.send.stream.decoded)}; live control ` +
        `${JSON.stringify(report.send.stream.live)}; armed ${JSON.stringify(report.send.stream.afterRunStarted)}; ` +
        `stop calls ${JSON.stringify(report.send.stream.afterStopClick.stops)}; settled ${JSON.stringify(report.send.stream.settled)}`,
    );
    console.log("");
  }
  if (report.resizeChecks) {
    for (const entry of report.resizeChecks) {
      console.log(
        `resize ${entry.step}: panel ${entry.panelHeight}px → cap ${entry.expectedCap}px, field ${entry.fieldHeight}px`,
      );
    }
    console.log("");
  }
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "composer autogrow: PASS" : "composer autogrow: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`composer-autogrow: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
