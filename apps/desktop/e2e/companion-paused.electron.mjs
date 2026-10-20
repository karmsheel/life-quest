/**
 * Drives the chat-panel harness and turns the banner the dock really paints into
 * `e2e/artifacts/companion-paused.json`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   npx electron e2e/companion-paused.electron.mjs
 *
 * WHY THIS RIG EXISTS
 *
 * On 2026-10-19 an operator sent two messages into a conversation Hermes had
 * paused and got nothing back, twice:
 *
 *   WARNING gateway.session_authority: Session api_1792412141_61198922 paused: unknown_execution
 *   ERROR   gateway.platforms.api_server: [api_server] session chat stream failed
 *
 * The turn raises `RuntimeStoreError: unknown_execution`; api_server catches it
 * and emits that runtime token as the message of an `error` SSE frame. The dock
 * painted the token verbatim, so the screen said `unknown_execution` — a string
 * that names neither the cause (a turn was interrupted when the app was killed
 * mid-run) nor the one control that recovers (a new chat, because a paused
 * conversation can never answer again). The frame shape below is the host's own:
 * `event: <name>` then `data: <json>` then a blank line.
 *
 * THE WAYS THIS COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 *  1. THE RIG PARSES NOTHING REAL. A frame this file invented would prove only
 *     that it agrees with itself. The parse step therefore goes through
 *     `window.__lqParseSse`, which the harness page binds to the real
 *     `parseSseBlock` from `electron/companion-client.ts` — the same function the
 *     live stream runs every frame through.
 *  2. THE BANNER IS STUBBED. The panel under test is the real `ChatPanel` with
 *     the real CSS; only the IPC bridge is stubbed (a dev-server page has no
 *     preload). The event is pushed through the callback the panel itself
 *     registered with `onCompanionStream`, so the assertion is about the panel's
 *     own state, not a fixture's.
 *  3. IT TRANSLATES EVERYTHING. A mapper that answered every error with the
 *     pause sentence would pass check 1 and destroy real diagnoses. The control
 *     frame below carries an ordinary failure and must arrive untouched, on the
 *     wire and on the screen.
 *  4. IT PASSES WITHOUT THE PANEL RENDERING. Both reads poll for the banner's
 *     own text rather than sleeping, and every read is against the DOM the
 *     operator reads.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";
const SIZE = { width: 1280, height: 900 };

/** The sentence the dock must paint for a paused conversation. */
const PAUSED_SENTENCE =
  "This conversation is paused because a turn was interrupted — start a new chat.";

/**
 * The host's frame for a paused conversation, byte for byte: `_sse_frame` writes
 * the event name, the payload, then the blank line that ends the frame.
 */
const PAUSED_FRAME = 'event: error\ndata: {"message": "unknown_execution"}\n\n';

/**
 * An ordinary failure, which is the control: it must reach the screen saying
 * what it said. A translation that swallowed this would be a worse bug than the
 * one being fixed.
 */
const OTHER_FRAME = 'event: error\ndata: {"message": "provider said no"}\n\n';
const OTHER_SENTENCE = "provider said no";

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

/**
 * Poll for a state, never sleep a fixed interval and never wait on a frame: a
 * hidden window suspends rAF and the wait then never returns.
 */
function waitFor(win, expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
        // Vite can reload the page mid-wait (it re-optimises a new import),
        // which clears the harness globals: that is "not ready yet".
        value = undefined;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 50);
    };
    void poll();
  });
}

/** The text inside the dock's error banner, or null when it is not showing. */
const BANNER = `(() => {
  const p = document.querySelector(".chat-panel__error p");
  return p ? (p.textContent || "").trim() : null;
})()`;

async function readBanner(win, expected, label) {
  return waitFor(
    win,
    `(() => { const p = document.querySelector(".chat-panel__error p");
      const t = p ? (p.textContent || "").trim() : "";
      return t === ${JSON.stringify(expected)} ? t : false; })()`,
    label,
  );
}

async function main() {
  // A rig opens a real window on the operator's desktop: paint it in the theme
  // the app itself defaults to so a run is not a white sheet flashing past.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: SIZE.width,
    height: SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(SIZE.width, SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(url);
  await waitFor(win, "Boolean(window.chatPanelHarnessReady)", "chatPanelHarnessReady");
  // The panel registers its stream callback on mount; until it exists there is
  // nowhere to push a frame, and pushing into nothing would pass silently.
  await waitFor(win, "typeof window.__lqEmit === 'function'", "__lqEmit");
  await waitFor(
    win,
    "Boolean(document.querySelector('.chat-panel__composer-input'))",
    "the composer input",
  );

  const checks = {};

  // ── the real decoder, on the host's own frame ─────────────────────────────
  // `__lqParseSse` is `parseSseBlock`, the function the live stream calls. If
  // the token survives this, the dock gets the token.
  const parsedPaused = await win.webContents.executeJavaScript(
    `window.__lqParseSse(${JSON.stringify(PAUSED_FRAME)})`,
  );
  checks.pausedFrame = PAUSED_FRAME;
  checks.parsedPaused = parsedPaused;
  checks.parsedPausedIsError = parsedPaused?.type === "error";
  checks.parsedPausedMessage = parsedPaused?.message ?? null;
  if (!checks.parsedPausedIsError) {
    failure(`the paused frame parsed as ${JSON.stringify(parsedPaused)}, expected an error event`);
  }
  if (checks.parsedPausedMessage !== PAUSED_SENTENCE) {
    failure(
      `the paused frame parsed to ${JSON.stringify(checks.parsedPausedMessage)}, expected the pause sentence`,
    );
  }

  // ── the dock paints it ───────────────────────────────────────────────────
  // Pushed through the callback ChatPanel itself registered, so this asserts the
  // panel's own state and not a fixture's.
  await win.webContents.executeJavaScript(
    `window.__lqEmit(${JSON.stringify(parsedPaused)})`,
  );
  const pausedBanner = await readBanner(win, PAUSED_SENTENCE, "the pause banner");
  checks.pausedBanner = pausedBanner;
  checks.pausedBannerIsSentence = pausedBanner === PAUSED_SENTENCE;
  if (!checks.pausedBannerIsSentence) {
    failure(`the dock painted ${JSON.stringify(pausedBanner)}, expected the pause sentence`);
  }
  // The token must not survive anywhere the operator can read.
  checks.pausedBannerHoldsToken = /unknown_execution/i.test(pausedBanner ?? "");
  if (checks.pausedBannerHoldsToken) {
    failure(`the dock still shows the runtime token: ${pausedBanner}`);
  }
  const pausedShot = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "companion-paused.png"),
    pausedShot.toPNG(),
  );

  // ── the control: an ordinary failure is left alone ────────────────────────
  const parsedOther = await win.webContents.executeJavaScript(
    `window.__lqParseSse(${JSON.stringify(OTHER_FRAME)})`,
  );
  checks.otherFrame = OTHER_FRAME;
  checks.parsedOther = parsedOther;
  checks.parsedOtherMessage = parsedOther?.message ?? null;
  if (parsedOther?.message !== OTHER_SENTENCE) {
    failure(
      `an ordinary error parsed to ${JSON.stringify(parsedOther?.message)}, expected it untouched`,
    );
  }
  await win.webContents.executeJavaScript(`window.__lqEmit(${JSON.stringify(parsedOther)})`);
  const otherBanner = await readBanner(win, OTHER_SENTENCE, "the control banner");
  checks.otherBanner = otherBanner;
  if (otherBanner !== OTHER_SENTENCE) {
    failure(
      `an ordinary error painted ${JSON.stringify(otherBanner)}, expected ${JSON.stringify(OTHER_SENTENCE)}`,
    );
  }

  checks.consoleErrors = consoleErrors;

  const report = {
    pass: errors.length === 0,
    failures: errors,
    expected: { pausedSentence: PAUSED_SENTENCE, otherSentence: OTHER_SENTENCE },
    frames: { paused: PAUSED_FRAME, control: OTHER_FRAME },
    viewport: await win.webContents.executeJavaScript(
      "({ width: window.innerWidth, height: window.innerHeight })",
    ),
    checks,
  };

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "companion-paused.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`paused frame  -> ${JSON.stringify(checks.parsedPausedMessage)}`);
  console.log(`paused banner -> ${JSON.stringify(pausedBanner)}`);
  console.log(`control frame -> ${JSON.stringify(checks.parsedOtherMessage)}`);
  console.log(`control banner -> ${JSON.stringify(otherBanner)}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("companion-paused rig timed out");
  app.exit(1);
}, 90_000);
