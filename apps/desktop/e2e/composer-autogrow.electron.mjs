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
import { app, BrowserWindow, nativeTheme } from "electron";

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
    fieldBorderWidth: styles.borderTopWidth,
    fieldBorderColor: styles.borderTopColor,
    fieldBoxShadow: styles.boxShadow,
    footerBackground: footer ? getComputedStyle(footer).backgroundColor : null,
    footerBorderTopWidth: footer ? getComputedStyle(footer).borderTopWidth : null,
    footerPaddingTop: footer ? Math.round(parseFloat(getComputedStyle(footer).paddingTop) || 0) : null,
    scrolls: el.scrollHeight > el.clientHeight + 1,
    viewportHeight: window.innerHeight
  };
})()`;

/** Alpha channel of a computed colour; 1 when the string carries none. */
const alphaOfPx = (color) => {
  const numbers = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return numbers.length >= 4 ? numbers[3] : 1;
};

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to (tokens.css, [data-theme="dark"]) so a
  // test run is not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
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

    // 9 — the composer's own chrome. The field wears the skin's accent as a 2px
    // ring of its own, the band around it paints nothing (no fill, no hairline),
    // and selecting the field adds the glow rather than changing the ring, so
    // "selected" reads as extra light and not as a second colour.
    //
    // `:focus` does not match while the window itself is unfocused, even though
    // `document.activeElement` is set — the driver showed `showInactive()` alone
    // leaves `:focus=false` and the glow invisible. Give the window real focus
    // first, or this measures a state the app never renders.
    win.show();
    win.focus();
    win.webContents.focus();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const chrome = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const el = document.querySelector(".chat-panel__composer-input");
      const footer = document.querySelector(".chat-panel__footer");
      if (!el || !footer) return null;
      const read = () => {
        const styles = getComputedStyle(el);
        return {
          borderWidth: styles.borderTopWidth,
          borderStyle: styles.borderTopStyle,
          borderColor: styles.borderTopColor,
          boxShadow: styles.boxShadow,
          outlineStyle: styles.outlineStyle,
          focused: document.activeElement === el,
          matchesFocus: el.matches(":focus"),
          matchesFocusVisible: el.matches(":focus-visible"),
          documentFocused: document.hasFocus(),
        };
      };
      // Resolve the tokens the way the browser does: computed custom properties
      // return their literal text (--accent is literally "var(--primary)"), so
      // each one is painted onto a probe and read back as a colour.
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const resolve = (token) => {
        probe.style.background = "none";
        probe.style.background = token;
        return getComputedStyle(probe).backgroundColor;
      };
      const accent = resolve("var(--accent)");
      const border = resolve("var(--border)");
      probe.remove();
      // Chromium snaps a used border width down to whole device pixels, so the
      // computed width of a 2px border is not "2px" on a scaled display (125%
      // scale floors 2.5 device px to 2, i.e. 1.6 CSS px). Measure the same
      // snapping on reference elements instead of hard-coding the number, which
      // is what makes "thicker than the hairline it replaced" a portable claim.
      const reference = (width) => {
        const ref = document.createElement("div");
        ref.style.cssText =
          "position:absolute;width:10px;height:10px;border-style:solid;border-width:" + width;
        document.body.appendChild(ref);
        const used = getComputedStyle(ref).borderTopWidth;
        ref.remove();
        return used;
      };
      const ring = { reference1px: reference("1px"), reference2px: reference("2px") };
      const devicePixelRatio = window.devicePixelRatio;
      // The dock hands the caret back to its composer once a turn ends, so the
      // field is usually focused when this step starts: the blur below is a real
      // 120ms transition and not a no-op. Both reads wait it out — the resting
      // one has to be at rest, or it catches the glow mid-fade and the equality
      // with "none" fails on a value that is 98% of the way there.
      el.blur();
      await wait(260);
      const blurred = read();
      el.focus();
      // Past the 120ms box-shadow transition, or the read catches it mid-flight.
      await wait(260);
      const focused = read();
      const footerStyles = getComputedStyle(footer);
      return {
        blurred,
        focused,
        accent,
        border,
        ring,
        devicePixelRatio,
        borderWidthDevicePx: Math.round(parseFloat(blurred.borderWidth) * devicePixelRatio),
        footerBackground: footerStyles.backgroundColor,
        footerBorderTopWidth: footerStyles.borderTopWidth,
        footerPaddingTop: Math.round(parseFloat(footerStyles.paddingTop) || 0),
      };
    })()`);
    if (!chrome) throw new Error("composer chrome disappeared mid-run");

    // The old look: the accent was painted AROUND the field as the footer's tinted
    // band, and the field itself wore the neutral hairline. Both halves are gone.
    check(
      "the band paints nothing of its own",
      alphaOfPx(chrome.footerBackground) === 0 && chrome.footerBorderTopWidth === "0px",
      `footer background ${chrome.footerBackground} / top border ${chrome.footerBorderTopWidth}`,
    );
    check(
      "the band keeps only the gutter",
      chrome.footerPaddingTop > 0,
      `footer top padding ${chrome.footerPaddingTop}px`,
    );
    check(
      "the field wears the accent as a ring thicker than the hairline it replaced",
      chrome.blurred.borderStyle === "solid" &&
        chrome.blurred.borderWidth === chrome.ring.reference2px &&
        parseFloat(chrome.ring.reference2px) > parseFloat(chrome.ring.reference1px) &&
        chrome.blurred.borderColor === chrome.accent &&
        chrome.blurred.borderColor !== chrome.border,
      `resting ring ${chrome.blurred.borderWidth} ${chrome.blurred.borderStyle} ${chrome.blurred.borderColor}` +
        ` (references 1px→${chrome.ring.reference1px}, 2px→${chrome.ring.reference2px} at dpr ${chrome.devicePixelRatio};` +
        ` accent ${chrome.accent}, neutral border ${chrome.border})`,
    );
    check(
      "selecting the field adds a glow",
      chrome.focused.focused === true &&
        chrome.focused.matchesFocus === true &&
        chrome.blurred.boxShadow === "none" &&
        /0px 0px 0px 3px/.test(chrome.focused.boxShadow) &&
        /0px 0px 14px 2px/.test(chrome.focused.boxShadow),
      `blurred ${chrome.blurred.boxShadow} → focused ${chrome.focused.boxShadow}` +
        ` (focused=${chrome.focused.focused}, :focus=${chrome.focused.matchesFocus},` +
        ` document focused=${chrome.focused.documentFocused})`,
    );
    check(
      "the glow is the only thing selection changes",
      chrome.focused.borderColor === chrome.blurred.borderColor &&
        chrome.focused.borderWidth === chrome.blurred.borderWidth &&
        chrome.focused.outlineStyle === "none",
      `ring ${chrome.blurred.borderColor} → ${chrome.focused.borderColor}, outline ${chrome.focused.outlineStyle}`,
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
    //
    // Both waits here poll for the state they need instead of sleeping for it.
    // The send click and the stop click sit in two `run()` calls with the
    // screenshot -- a `capturePage()`, arbitrarily slow on a loaded machine --
    // between them, so the gap between them is driver time, not page time, while
    // the stub holds the run open on a page-time timer. A fixed 2000ms window
    // therefore closed while the driver was still outside the page, taking the
    // stop square with it, and the next click threw on a null selector. The
    // window is now 3x what any capture needs and the polls carry the slack; if
    // it ever overruns, the check below fails by name.
    const held = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const control = () => document.querySelector(".chat-panel__send");
      const armed = () => {
        const button = control();
        return button &&
          button.getAttribute("data-state") === "stop" &&
          button.disabled === false
          ? button
          : null;
      };
      const until = async (read, budget) => {
        const deadline = Date.now() + budget;
        for (;;) {
          const value = read();
          if (value) return value;
          if (Date.now() >= deadline) return null;
          await wait(25);
        }
      };
      window.__lqChatDelay = 6000;
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "Hold this run open so the stop square is on screen");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      const send = await until(() => control(), 2000);
      if (!send) return { armed: false, polledMs: 0, reason: "the send control never rendered" };
      send.click();
      await wait(140);
      if (typeof window.__lqEmit === "function") {
        window.__lqEmit({ type: "run.started", runId: "run_screenshot" });
      }
      const started = Date.now();
      const button = await until(armed, 4000);
      return { armed: Boolean(button), polledMs: Date.now() - started };
    })()`);
    check(
      "the streaming screenshot is of an armed stop square",
      held.armed === true,
      `the stop square never armed for the screenshot: ${JSON.stringify(held)}`,
    );
    const streamingShot = path.join(artifactsDir, "composer-autogrow-streaming.png");
    fs.writeFileSync(streamingShot, (await win.webContents.capturePage()).toPNG());

    const stopped = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const control = () => document.querySelector(".chat-panel__send");
      const until = async (read, budget) => {
        const deadline = Date.now() + budget;
        for (;;) {
          const value = read();
          if (value) return value;
          if (Date.now() >= deadline) return null;
          await wait(25);
        }
      };
      const square = await until(() => {
        const button = control();
        return button &&
          button.getAttribute("data-state") === "stop" &&
          button.disabled === false
          ? button
          : null;
      }, 4000);
      if (square) square.click();
      if (typeof window.__lqEmit === "function") window.__lqEmit({ type: "run.stopped" });
      // The control clears when the stream itself closes, not when the stop frame
      // lands, so this waits on the stub's own window rather than guessing at it.
      const started = Date.now();
      const cleared = await until(() => (control() ? null : true), 12000);
      return { clicked: Boolean(square), cleared: cleared === true, waitedMs: Date.now() - started };
    })()`);
    check(
      "the stopped screenshot is of a settled composer",
      stopped.clicked === true && stopped.cleared === true,
      `stop square clicked=${stopped.clicked}, control cleared=${stopped.cleared} after ${stopped.waitedMs}ms`,
    );
    const stoppedShot = path.join(artifactsDir, "composer-autogrow-stopped.png");
    fs.writeFileSync(stoppedShot, (await win.webContents.capturePage()).toPNG());

    const shots = [
      await shot("rest", ""),
      await shot("mid", lines(4)),
      await shot("capped", lines(60)),
    ];

    // The selected state, as a picture: the accent ring stays where it was and the
    // glow is the extra. The ring is asserted above; this is for the operator.
    await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const el = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, "Selected composer");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(80);
      el.focus();
      await wait(180);
      return document.activeElement === el;
    })()`);
    const focusedShot = path.join(artifactsDir, "composer-autogrow-focused.png");
    fs.writeFileSync(focusedShot, (await win.webContents.capturePage()).toPNG());

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
        shots: { held, stopped },
        stream,
      },
      composer: {
        restingRing: chrome.blurred,
        focused: chrome.focused,
        accent: chrome.accent,
        border: chrome.border,
        ring: chrome.ring,
        devicePixelRatio: chrome.devicePixelRatio,
        borderWidthDevicePx: chrome.borderWidthDevicePx,
        footerBackground: chrome.footerBackground,
        footerBorderTopWidth: chrome.footerBorderTopWidth,
        footerPaddingTop: chrome.footerPaddingTop,
      },
      samples,
      resizeChecks,
      screenshots: [
        ...shots.map((entry) => entry.file),
        focusedShot,
        streamingShot,
        stoppedShot,
      ],
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
  if (report.composer) {
    console.log(
      `composer chrome: ring ${report.composer.restingRing.borderWidth} ${report.composer.restingRing.borderStyle} ` +
        `${report.composer.restingRing.borderColor} (accent ${report.composer.accent}, neutral border ${report.composer.border}); ` +
        `band ${report.composer.footerBackground} / top border ${report.composer.footerBorderTopWidth} / pad ${report.composer.footerPaddingTop}px`,
    );
    console.log(
      `composer selected: outline ${report.composer.focused.outlineStyle}, ring ${report.composer.focused.borderColor} ` +
        `(unchanged), glow ${report.composer.focused.boxShadow}`,
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
