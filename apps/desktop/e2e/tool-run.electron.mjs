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
 * 11. A squeezed disclosure — the block is bounded and scrolls, so the cap has
 *     to stay off the rows: a row clips itself to ellipsize, which drops its
 *     automatic minimum height to 0, and a capped column then pressed 16.5px
 *     lines into 3.6px instead of scrolling them out of sight (measured). The
 *     invariants claimed here: the block never exceeds its `max-height`, it
 *     scrolls its own overflow rather than growing, every row keeps its line
 *     box, and the newest call is reachable by scrolling the block.
 * * The frames are byte-for-byte the shape the gateway sends, fed through the
 * app's own `parseSseBlock` — the driver never hand-builds an event object, so
 * failures 6 and 7 are asserted against the wire format rather than against the
 * panel's idea of it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

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
/** The row the ink assertions pick out of the open list (see STAGE_C_CALLS). */
const PROBE_NEEDLE = "gap_pqy";

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
  // The row the ink assertions read: a bridged MCP name (underscores) over a
  // target with descenders (g, p, y, q), short enough never to ellipsize --
  // so every character's full glyph box must paint. Long enough to matter:
  // this is the shape that read as "mcn lifequest get database" when the row
  // clipped at the baseline.
  { args: { path: "src/mcp/gap_pqy.ts" }, tool: "mcp__lq__get_pq" },
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

/**
 * The growth stage's turn: the disclosure is opened on a short run and then the
 * run keeps calling tools, so what the block does as lines arrive is observable
 * rather than assumed. Held open long enough that every frame lands on a live
 * stream, short enough that the next send's `settle()` still catches it.
 */
/**
 * A block taller than this many rows is not a cap any more, whatever the
 * stylesheet calls it: the growth check holds the block to its own
 * `max-height` *and* to this, so raising the number to `100rem` cannot quietly
 * hand the transcript back the whole run.
 */
const GROWTH_MAX_LINES = 12;
const GROWTH_MS = 8000;
const GROWTH_CALLS = Array.from({ length: 9 }, (_, i) => {
  const tools = ["read_file", "search_files", "terminal", "patch"];
  const tool = tools[i % tools.length];
  return {
    args: tool === "read_file" || tool === "patch" ? { path: `src/grown/file_${i}.ts` } : { query: `grown_${i}` },
    tool,
  };
});
/** The short run the block is opened on, before the growth stage continues it. */
const GROWTH_SEED = [
  started("read_file", { path: AGENTS_PATH }),
  completed("read_file", { path: AGENTS_PATH }),
  started("search_files", { query: "composer" }),
  completed("search_files", { query: "composer" }),
  started("terminal", { command: TEST_COMMAND }),
  completed("terminal", { command: TEST_COMMAND }),
];
const GROWTH_FRAMES = GROWTH_CALLS.flatMap(({ args, tool }) => [started(tool, args), completed(tool, args)]);



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

/**
 * What the open disclosure is doing after the run grew under it.
 *
 * The row is `overflow: hidden` so it can ellipsize, which drops its automatic
 * minimum height to 0: a height-capped flex column then squeezes the rows to fit
 * instead of overflowing, and a squeezed row paints a sliver of its text with
 * nothing in the DOM admitting it. Measured under the old `max-height: 10rem`:
 * 24 rows at 3.6px each inside a block still exactly 160px tall.
 */
const GROWTH = `(() => {
  const list = document.querySelector(".chat-panel__activity-list");
  if (!list) return { missing: true, rows: 0 };
  const rows = [...list.querySelectorAll(".chat-panel__activity-row")];
  const body = document.querySelector(".chat-panel__body");
  const listRect = list.getBoundingClientRect();
  const bodyRect = body ? body.getBoundingClientRect() : null;
  const heights = rows.map((el) => el.getBoundingClientRect().height);
  const style = rows.length ? getComputedStyle(rows[0]) : null;
  const last = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null;
  const round = (value) => Number(value.toFixed(2));
  return {
    missing: false,
    rows: rows.length,
    rowLineHeight: style ? parseFloat(style.lineHeight) : null,
    rowHeightMin: heights.length ? round(Math.min(...heights)) : null,
    rowHeightMax: heights.length ? round(Math.max(...heights)) : null,
    blockHeight: round(listRect.height),
    blockClientHeight: list.clientHeight,
    blockScrollHeight: list.scrollHeight,
    blockScrollTop: round(list.scrollTop),
    boxTop: round(listRect.top),
    boxBottom: round(listRect.bottom),
    scrollbarWidth: list.offsetWidth - list.clientWidth,
    blockMaxHeight: getComputedStyle(list).maxHeight,
    blockOverflowY: getComputedStyle(list).overflowY,
    body: body
      ? {
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight,
          top: round(bodyRect.top),
          bottom: round(bodyRect.bottom),
        }
      : null,
    lastRowTop: last ? round(last.top) : null,
    lastRowBottom: last ? round(last.bottom) : null,
    innerHeight: window.innerHeight
  };
})()`;

/**
 * Scroll the block to its own bottom and read where the newest row lands.
 *
 * With a cap the newest call is not simply in view any more -- it is one
 * scroll away, inside the block and inside the transcript. So the claim the
 * cap has to earn is reachability: after scrolling the block, the row sits in
 * the block's box, and the block's box sits in the transcript's.
 */
const SCROLL_BLOCK = `(() => {
  const list = document.querySelector(".chat-panel__activity-list");
  const rows = list ? [...list.querySelectorAll(".chat-panel__activity-row")] : [];
  if (!list || rows.length === 0) return { missing: true };
  list.scrollTop = list.scrollHeight;
  const last = rows[rows.length - 1].getBoundingClientRect();
  const box = list.getBoundingClientRect();
  const body = document.querySelector(".chat-panel__body").getBoundingClientRect();
  const round = (value) => Number(value.toFixed(2));
  return {
    missing: false,
    scrollTop: round(list.scrollTop),
    maxScrollTop: round(list.scrollHeight - list.clientHeight),
    lastRowTop: round(last.top),
    lastRowBottom: round(last.bottom),
    boxTop: round(box.top),
    boxBottom: round(box.bottom),
    inside: last.top >= box.top - 1 && last.bottom <= box.bottom + 1,
    insideTranscript: last.top >= body.top - 1 && last.bottom <= body.bottom + 1
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

  /**
   * What a row actually paints, read off the window's own pixels.
   *
   * A row is `overflow: hidden` (that is how it ellipsizes), so a line box
   * shorter than the font's glyph box silently cuts the bottoms off letters:
   * `p` reads as `n`, `_` disappears, and the row only "looks" wrong in a
   * screenshot nobody diffs. So this measures the ink instead of trusting the
   * box: the page hands back the row's rect, its computed font and the canvas
   * metrics for the row's own text, and this scans the capture for the top and
   * bottom pixel the row paints.
   */
  const ROW_INK = `(needle) => {
    const rows = [...document.querySelectorAll(".chat-panel__activity-row")];
    const row = rows.find((el) => el.textContent.includes(needle));
    if (!row) return { missing: true, rows: rows.map((el) => el.textContent.trim()) };
    const rect = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    const ctx = document.createElement("canvas").getContext("2d");
    // Measured at 10x and scaled back: canvas metrics come back as whole
    // pixels, and the whole question here is a fraction of one.
    const zoom = style.font.replace(/^([\\d.]+)px/, (m, n) => \`\${Number(n) * 10}px\`);
    ctx.font = zoom || \`\${parseFloat(style.fontSize) * 10}px \${style.fontFamily}\`;
    // The same characters the row draws: the font box and the ink box, in CSS
    // pixels. The ink box is the floor a full line of text has to reach.
    const font = ctx.measureText("pqyj_g");
    const text = ctx.measureText(row.textContent);
    const ink = (value) => value / 10;
    return {
      text: row.textContent.trim(),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      boxHeight: row.clientHeight,
      truncated: row.scrollWidth > row.clientWidth + 1,
      font: style.font,
      lineHeight: style.lineHeight,
      glyphBox: ink(font.fontBoundingBoxAscent + font.fontBoundingBoxDescent),
      inkBox: ink(font.actualBoundingBoxAscent + font.actualBoundingBoxDescent),
      descender: ink(font.actualBoundingBoxDescent),
      textInk: ink(text.actualBoundingBoxAscent + text.actualBoundingBoxDescent),
      innerWidth: window.innerWidth,
      dpr: window.devicePixelRatio
    };
  }`;

  /**
   * Scan a capture for the top and bottom row of ink inside a rect (CSS px).
   *
   * Ink means "painted on the surface", not "dark". The row has no background
   * of its own, so the rect's modal colour *is* the surface it sits on, and a
   * pixel's distance from that is what marks a glyph. A fixed dark-glyph
   * threshold only holds in one theme: in the app's dark theme the panel is
   * itself under it, every pixel of the strip reads as ink, and the row is
   * reported as clipped when it is not (measured: 17.60px of "ink" for a
   * 10.10px ink box, -1.05px of clearance). 85 is the separation the old
   * `mean < 170` test drew against a white panel, so light-mode numbers are
   * unchanged by this.
   */
  const scanInk = (image, info) => {
    const size = image.getSize();
    const bitmap = image.getBitmap();
    const scale = size.width / info.innerWidth;
    const stride = size.width * 4;
    const x0 = Math.max(0, Math.floor(info.rect.left * scale));
    const x1 = Math.min(size.width - 1, Math.ceil(info.rect.right * scale));
    const y0 = Math.max(0, Math.floor(info.rect.top * scale));
    const y1 = Math.min(size.height - 1, Math.ceil(info.rect.bottom * scale));
    // The surface: the colour most of the rect is painted in. BGRA on Windows,
    // packed whole so the tally counts pixels rather than channels.
    const tally = new Map();
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = y * stride + x * 4;
        const key = (bitmap[i] << 16) | (bitmap[i + 1] << 8) | bitmap[i + 2];
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }
    let surface = 0;
    let seen = 0;
    for (const [key, count] of tally) {
      if (count > seen) {
        seen = count;
        surface = key;
      }
    }
    const red = (surface >> 16) & 255;
    const green = (surface >> 8) & 255;
    const blue = surface & 255;
    /** How far a pixel has to sit from the surface to count as painted. */
    const INK_DISTANCE = 85;

    let top = null;
    let bottom = null;
    for (let y = y0; y <= y1; y += 1) {
      let painted = 0;
      for (let x = x0; x <= x1; x += 1) {
        const i = y * stride + x * 4;
        const distance =
          (Math.abs(bitmap[i] - blue) +
            Math.abs(bitmap[i + 1] - green) +
            Math.abs(bitmap[i + 2] - red)) /
          3;
        if (distance > INK_DISTANCE) painted += 1;
      }
      if (painted > 0) {
        if (top === null) top = y;
        bottom = y;
      }
    }
    return {
      scale,
      surface: `rgb(${red}, ${green}, ${blue})`,
      inkDistance: INK_DISTANCE,
      inkTop: top === null ? null : top / scale,
      inkBottom: bottom === null ? null : (bottom + 1) / scale,
    };
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

    // --- what the rows paint -------------------------------------------------
    // The one row that carries underscores and descenders, measured against the
    // window's own pixels: the row's box, the font's glyph/ink boxes (canvas
    // metrics for the row's own text), and the top and bottom pixel it paints.
    // The scan and the crop come from the same capture — the panel scrolls as
    // the list settles, and a later capture is a different frame.
    const rowInk = await run(`(${ROW_INK})(${JSON.stringify(PROBE_NEEDLE)})`);
    let ink = { inkTop: null, inkBottom: null, scale: 1, surface: null, inkDistance: null };
    const rowInkShot = path.join(artifactsDir, "tool-run-row-ink.png");
    if (!rowInk.missing) {
      const shot = await win.webContents.capturePage();
      ink = scanInk(shot, rowInk);
      // The capture is device pixels (this display is 125%), while the row's
      // rect is CSS pixels — crop with the same scale the scan used.
      const s = ink.scale;
      fs.writeFileSync(
        rowInkShot,
        shot
          .crop({
            x: Math.max(0, Math.floor((rowInk.rect.left - 2) * s)),
            y: Math.max(0, Math.floor((rowInk.rect.top - 2) * s)),
            width: Math.ceil((rowInk.rect.width + 4) * s),
            height: Math.ceil((rowInk.rect.height + 4) * s),
          })
          .toPNG(),
      );
    }

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

    // --- the disclosure grows with the run ----------------------------------
    // The reported defect: the block opens correctly on a short run, then the
    // run keeps calling tools, and the lines get squeezed into the block instead
    // of the block growing. So open it on three calls, keep calling, and read
    // the rows' boxes again — a squeezed row still reports a height, it just is
    // not its line box any more.
    await settle();
    await run(SEND("Keep going", GROWTH_MS));
    await emitAll(GROWTH_SEED);
    await sleep(120);
    await run(`document.querySelector(".chat-panel__activity-line").click()`);
    await sleep(160);
    const grownShort = await run(GROWTH);
    await emitAll(GROWTH_FRAMES);
    await sleep(220);
    const grownLong = await run(GROWTH);
    const grownShot = await shoot("grown");
    const grownScrolled = await run(SCROLL_BLOCK);

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
        "Edited 2 files, explored 2 files, ran 1 command, delegated Review the composer diff, used 2 tools",
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
      "a row names the call and its target verbatim",
      opened.rows[3] === "mcp__lq__get_pq \u00b7 gap_pqy.ts",
      `row 3 read ${JSON.stringify(opened.rows[3])} — a bridged MCP name keeps its underscores`,
    );
    // The row is `overflow: hidden` so it can ellipsize; a line box that only
    // just contains the font's glyph box then shaves the descent at any
    // fractional device scale — `p` reads as `n`, `_` disappears. So: a whole
    // pixel of headroom around the glyph box, and the ink that reaches into it
    // must land inside the clip.
    const inkClearance = ink.inkBottom === null ? -Infinity : rowInk.rect.bottom - ink.inkBottom;
    check(
      "the row's line box leaves the font's glyph box room",
      !rowInk.missing && rowInk.rect.height >= rowInk.glyphBox + 1,
      rowInk.missing
        ? `no row matched ${PROBE_NEEDLE}: ${JSON.stringify(rowInk.rows)}`
        : `row is ${rowInk.rect.height.toFixed(2)}px tall (line-height ${rowInk.lineHeight}, font ${rowInk.font}) with a ${rowInk.glyphBox.toFixed(2)}px glyph box`,
    );
    const painted = ink.inkTop === null || ink.inkBottom === null ? 0 : ink.inkBottom - ink.inkTop;
    check(
      "a row paints its descenders and underscores clear of the clip",
      !rowInk.missing && !rowInk.truncated && painted >= rowInk.inkBox * 0.85 && inkClearance >= 1,
      `${rowInk.text ?? "no probe row"}: painted ${painted.toFixed(2)}px of the ${rowInk.inkBox.toFixed(2)}px ink box ` +
        `(descender ${rowInk.descender.toFixed(2)}px), ink y ${ink.inkTop === null ? "none" : `${ink.inkTop.toFixed(2)}→${ink.inkBottom.toFixed(2)}`} ` +
        `in a box ending at ${rowInk.rect.bottom.toFixed(2)} — ${inkClearance.toFixed(2)}px of clearance`,
    );
    // The reported defect, as geometry: the block is bounded and scrolls, and no
    // row gives up its line box to fit inside it. Both halves are asserted
    // because either can come undone alone -- drop the cap and the transcript
    // grows without bound (the ceiling in the first check), drop the row's
    // `flex-shrink: 0` and the cap presses 16.5px rows into 3.6px instead of
    // scrolling them out of sight (the second check), which is the bug as it
    // was reported.
    check(
      "the block is capped and scrolls its own overflow",
      !grownLong.missing &&
        grownLong.rows === grownShort.rows + GROWTH_CALLS.length &&
        grownLong.blockClientHeight <= parseFloat(grownLong.blockMaxHeight) + 1 &&        grownLong.blockClientHeight <= GROWTH_MAX_LINES * grownLong.rowLineHeight &&
        grownLong.blockScrollHeight > grownLong.blockClientHeight + 1 &&
        grownLong.blockOverflowY === "auto",
      `${grownLong.rows} rows of ${grownLong.blockScrollHeight}px in a ${grownLong.blockClientHeight}px block ` +
        `(max-height ${grownLong.blockMaxHeight}, overflow-y ${grownLong.blockOverflowY}, ` +
        `${(grownLong.blockClientHeight / grownLong.rowLineHeight).toFixed(1)} of ${GROWTH_MAX_LINES} lines; ` +
        `${grownShort.rows} rows opened at ${grownShort.blockClientHeight}px)`,
    );
    check(
      "no row squeezes to fit the cap",
      !grownLong.missing &&
        grownLong.rowHeightMin >= grownLong.rowLineHeight - 0.5 &&
        grownLong.rowHeightMax - grownLong.rowHeightMin <= 0.5,
      `rows ${grownLong.rowHeightMin}-${grownLong.rowHeightMax}px in a ${grownLong.rowLineHeight}px line box`,
    );
    // The cap only reads right if the block shows what it is for: the newest
    // call. The panel takes the same stick-to-the-newest pass as the transcript
    // it sits in, so the newest row is expected in view without the driver
    // scrolling anything itself.
    check(
      "the block follows the newest call",
      !grownLong.missing &&
        grownLong.blockScrollTop > 0 &&
        grownLong.lastRowBottom <= grownLong.boxBottom + 1 &&
        grownLong.lastRowTop >= grownLong.boxTop,
      `block scrolled ${grownLong.blockScrollTop}px of ` +
        `${grownLong.blockScrollHeight - grownLong.blockClientHeight}px; last row ` +
        `${grownLong.lastRowTop}-${grownLong.lastRowBottom} in a block ${grownLong.boxTop}-${grownLong.boxBottom}, ` +
        `scrollbar ${grownLong.scrollbarWidth}px`,
    );
    check(
      "the newest call is reachable inside the block",
      !grownScrolled.missing &&
        grownScrolled.scrollTop > 0 &&
        grownScrolled.inside &&
        grownScrolled.insideTranscript,
      `scrolled the block to ${grownScrolled.scrollTop} of ${grownScrolled.maxScrollTop}px: last row ` +
        `${grownScrolled.lastRowTop}-${grownScrolled.lastRowBottom} in a block ${grownScrolled.boxTop}-${grownScrolled.boxBottom}`,
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
      growth: {
        added: GROWTH_CALLS.length,
        opened: grownShort,
        grown: grownLong,
        scrolled: grownScrolled,
      },
      rowInk: rowInk.missing
        ? { missing: true, rows: rowInk.rows }
        : {
            text: rowInk.text,
            boxHeight: rowInk.boxHeight,
            rowHeight: rowInk.rect.height,
            lineHeight: rowInk.lineHeight,
            font: rowInk.font,
            glyphBox: rowInk.glyphBox,
            inkBox: rowInk.inkBox,
            descender: rowInk.descender,
            truncated: rowInk.truncated,
            scale: ink.scale,
            surface: ink.surface,
            inkDistance: ink.inkDistance,
            inkTop: ink.inkTop,
            inkBottom: ink.inkBottom,
            painted: ink.inkTop === null || ink.inkBottom === null ? 0 : ink.inkBottom - ink.inkTop,
            boxBottom: rowInk.rect.bottom,
          },
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
      screenshots: [collapsedShot, expandedShot, rowInkShot, grownShot],
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
  console.log(`growth: ${JSON.stringify(report.growth ?? {})}`);
  console.log(`rowInk: ${JSON.stringify(report.rowInk ?? {})}`);
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
