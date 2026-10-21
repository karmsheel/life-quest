/**
 * Drives the chat-panel harness in a real Electron window and turns the message
 * presentation into `e2e/artifacts/chat-bubble-meta.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/chat-bubble-meta.electron.mjs
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. Stacked the same way — both roles still start at the transcript's leading
 *     edge (or both at the trailing one), so the side is not readable.
 *  2. The wrong side — the operator's turn sits right and Hermes's sits left.
 *  3. No stamp — a bubble renders without a `time`, so the operator cannot tell
 *     when it arrived.
 *  4. Wrong stamp — the loaded transcript's timestamp is dropped or shifted, so
 *     the visible time does not describe the row the gateway sent.
 *  5. No copy control — the stamp has no button beside it.
 *  6. Dead copy — clicking the control leaves the clipboard unchanged.
 *  7. Copied text is the wrong bubble — the assistant button copies the
 *     operator's turn, or the label/role is included in the text.
 *  8. The schemes did not trade places — the operator's bubble is not the
 *     stronger fill, or Hermes's is not the quieter one.
 *  9. The live turn is left out — a sent message or a streamed reply carries no
 *     stamp or copy control, because only loaded history was wired.
 * 10. The stamp is not under its bubble, or the copy control is not beside the
 *     stamp, so the layout only looks right by accident.
 *
 * The IPC bridge, the stream and the clock are stubbed/driven from here; the
 * real ChatPanel, the real CSS and the real layout engine are shipping code.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";

// Each rig gets its own Electron profile: the panel remembers the last chat it
// opened in localStorage, and a shared profile makes one rig start on another
// rig's session.
const userDataDir = path.join(artifactsDir, "userdata", "chat-bubble-meta");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };
const LOADED_USER_AT = 1_700_000_000_000;
const LOADED_ASSISTANT_AT = 1_700_000_002_000;

/** One read of the transcript's geometry, colours and controls. */
const SAMPLE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  };
  const container = document.querySelector(".chat-panel__messages");
  const rows = Array.from(document.querySelectorAll(".chat-panel__message"))
    .filter((el) => el.querySelector(".chat-panel__message-content"))
    .map((el) => {
      const content = el.querySelector(".chat-panel__message-content");
      const meta = el.querySelector(".chat-panel__message-meta");
      const time = el.querySelector(".chat-panel__message-time");
      const copy = el.querySelector(".chat-panel__message-copy");
      return {
        role: el.classList.contains("chat-panel__message--user") ? "user" : "assistant",
        text: content.textContent.trim(),
        bubble: box(content),
        alignSelf: getComputedStyle(el).alignSelf,
        meta: box(meta),
        timeText: time ? time.textContent.trim() : null,
        timeIso: time ? time.getAttribute("datetime") : null,
        timeBox: box(time),
        copyPresent: Boolean(copy),
        copyBox: box(copy),
        copyState: copy ? copy.getAttribute("data-copy-state") : null,
        copyLabel: copy ? copy.getAttribute("aria-label") : null,
        background: getComputedStyle(content).backgroundColor,
        borderColor: getComputedStyle(content).borderColor
      };
    });
  return { container: box(container), rows };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/** Alpha channel of a computed colour; 1 when the string carries none. */
function alphaOf(color) {
  const numbers = (String(color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return numbers.length >= 4 ? numbers[3] : 1;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
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
  const waitFor = async (expression, label, timeoutMs = 8_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await run(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  const timeout = setTimeout(() => {
    console.error("chat-bubble-meta: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();
    win.webContents.focus();

    // ── Loaded transcript ──────────────────────────────────────────────────
    const initial = await run(SAMPLE);
    const user = initial.rows.find((row) => row.role === "user");
    const assistant = initial.rows.find((row) => row.role === "assistant");

    check(
      "both loaded bubbles are present",
      Boolean(initial.container && user && assistant),
      `rows ${JSON.stringify(initial.rows.map((row) => row.role))}`,
    );

    if (user && assistant) {
      check(
        "the operator's turn starts at the transcript's left edge",
        Math.abs(user.bubble.left - initial.container.left) <= 1,
        `bubble ${user.bubble.left}px vs transcript ${initial.container.left}px`,
      );
      check(
        "the operator's turn stops short of the right edge",
        user.bubble.right < initial.container.right - 4,
        `bubble right ${user.bubble.right}px, transcript right ${initial.container.right}px`,
      );
      check(
        "Hermes's turn ends at the transcript's right edge",
        Math.abs(assistant.bubble.right - initial.container.right) <= 1,
        `bubble ${assistant.bubble.right}px vs transcript ${initial.container.right}px`,
      );
      check(
        "Hermes's turn starts away from the left edge",
        assistant.bubble.left > initial.container.left + 4,
        `bubble left ${assistant.bubble.left}px, transcript left ${initial.container.left}px`,
      );
      check(
        "the roles really use opposite alignment",
        user.alignSelf === "flex-start" && assistant.alignSelf === "flex-end",
        `user ${user.alignSelf} / assistant ${assistant.alignSelf}`,
      );

      const userAlpha = alphaOf(user.background);
      const assistantAlpha = alphaOf(assistant.background);
      check(
        "the colour schemes traded places",
        userAlpha > assistantAlpha + 0.1,
        `operator fill ${user.background} (alpha ${userAlpha}) vs Hermes fill ${assistant.background} (alpha ${assistantAlpha})`,
      );

      for (const row of [user, assistant]) {
        check(
          `${row.role} stamp is under its bubble`,
          row.meta && row.meta.top >= row.bubble.bottom - 1,
          `meta top ${row.meta?.top}px, bubble bottom ${row.bubble.bottom}px`,
        );
        check(
          `${row.role} stamp is visible`,
          typeof row.timeText === "string" && row.timeText.length > 0 && /[:\d]/.test(row.timeText),
          `stamp ${JSON.stringify(row.timeText)}`,
        );
        check(
          `${row.role} has a copy control beside the stamp`,
          row.copyPresent &&
            row.timeBox &&
            row.copyBox &&
            row.copyBox.left >= row.timeBox.right - 1 &&
            row.copyBox.top < row.meta.bottom &&
            row.copyBox.bottom > row.meta.top,
          `copy ${JSON.stringify(row.copyBox)}, stamp ${JSON.stringify(row.timeBox)}`,
        );
      }

      check(
        "the loaded operator stamp is the gateway's own instant",
        user.timeIso === new Date(LOADED_USER_AT).toISOString(),
        `${user.timeIso} vs ${new Date(LOADED_USER_AT).toISOString()}`,
      );
      check(
        "the loaded reply stamp is the gateway's own instant",
        assistant.timeIso === new Date(LOADED_ASSISTANT_AT).toISOString(),
        `${assistant.timeIso} vs ${new Date(LOADED_ASSISTANT_AT).toISOString()}`,
      );
    }

    // ── Copy, from the bubble itself ───────────────────────────────────────
    await clipboard.writeText("sentinel");
    await run(
      `document.querySelector(".chat-panel__message--assistant .chat-panel__message-copy").click()`,
    );
    await waitFor(
      `document.querySelector(".chat-panel__message--assistant .chat-panel__message-copy")?.getAttribute("data-copy-state") === "copied"`,
      "the assistant copy state",
    );
    const copiedAssistant = await clipboard.readText();
    check("the assistant copy control copies the reply", copiedAssistant === "Ready.", JSON.stringify(copiedAssistant));
    const copiedAssistantLabel = await run(
      `document.querySelector(".chat-panel__message--assistant .chat-panel__message-copy").getAttribute("aria-label")`,
    );
    check(
      "the copied state is announced",
      typeof copiedAssistantLabel === "string" && copiedAssistantLabel.startsWith("Copied"),
      JSON.stringify(copiedAssistantLabel),
    );

    await run(
      `document.querySelector(".chat-panel__message--user .chat-panel__message-copy").click()`,
    );
    await waitFor(
      `document.querySelector(".chat-panel__message--user .chat-panel__message-copy")?.getAttribute("data-copy-state") === "copied"`,
      "the operator copy state",
    );
    const copiedUser = await clipboard.readText();
    check(
      "the operator copy control copies their turn",
      copiedUser === "Composer harness",
      JSON.stringify(copiedUser),
    );

    // ── The live turn: sent and received ───────────────────────────────────
    await run(`window.__lqChatDelay = 900`);
    await run(`(async () => {
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "Live prompt");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector(".chat-panel__send").click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const emit = window.__lqEmit;
      if (!emit) throw new Error("the panel never registered its stream listener");
      emit({ type: "assistant.delta", text: "Live reply." });
      emit({ type: "assistant.delta", text: " Still here." });
      return true;
    })()`);
    await waitFor(
      `document.querySelector(".chat-panel__send[data-state='stop']") === null`,
      "the live run to settle",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const after = await run(SAMPLE);
    const liveUser = after.rows.find((row) => row.text === "Live prompt");
    const liveReply = after.rows.find((row) => row.text === "Live reply. Still here.");

    check(
      "both sides of the live turn rendered",
      Boolean(liveUser && liveReply),
      `rows ${JSON.stringify(after.rows.map((row) => row.text))}`,
    );
    if (liveUser && liveReply) {
      check(
        "the live operator turn is on the left",
        Math.abs(liveUser.bubble.left - after.container.left) <= 1,
        `bubble ${liveUser.bubble.left}px vs transcript ${after.container.left}px`,
      );
      check(
        "the live reply is on the right",
        Math.abs(liveReply.bubble.right - after.container.right) <= 1,
        `bubble ${liveReply.bubble.right}px vs transcript ${after.container.right}px`,
      );

      const now = Date.now();
      for (const row of [liveUser, liveReply]) {
        check(
          `${row.role} live stamp is present`,
          row.timeIso && Math.abs(Date.parse(row.timeIso) - now) < 60_000,
          `${row.timeIso} around ${new Date(now).toISOString()}`,
        );
        check(
          `${row.role} live copy control is present`,
          row.copyPresent && row.copyState === "idle",
          `copy ${row.copyPresent} state ${row.copyState}`,
        );
      }

      await run(
        `document.querySelectorAll(".chat-panel__message--assistant .chat-panel__message-copy")[1].click()`,
      );
      await waitFor(
        `document.querySelectorAll(".chat-panel__message--assistant .chat-panel__message-copy")[1]?.getAttribute("data-copy-state") === "copied"`,
        "the live reply copy state",
      );
      const copiedLive = await clipboard.readText();
      check(
        "the live reply copies its own text",
        copiedLive === "Live reply. Still here.",
        JSON.stringify(copiedLive),
      );
    }

    check(
      "every bubble in the settled transcript has a stamp",
      after.rows.every((row) => typeof row.timeText === "string" && row.timeText.length > 0),
      JSON.stringify(after.rows.map((row) => row.timeText)),
    );

    const shot = path.join(artifactsDir, "chat-bubble-meta.png");
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());

    const report = {
      pass: failures.length === 0,
      failures,
      initial: {
        container: initial.container,
        rows: initial.rows,
        colours: {
          user: user?.background ?? null,
          assistant: assistant?.background ?? null,
          userAlpha: user ? alphaOf(user.background) : null,
          assistantAlpha: assistant ? alphaOf(assistant.background) : null,
        },
      },
      live: {
        rows: after.rows.map((row) => ({
          role: row.role,
          text: row.text,
          bubble: row.bubble,
          timeText: row.timeText,
          timeIso: row.timeIso,
          copyPresent: row.copyPresent,
          copyState: row.copyState,
        })),
      },
      shots: { thread: shot },
    };

    const reportFile = path.join(artifactsDir, "chat-bubble-meta.json");
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`chat bubbles: ${initial.rows.length} loaded, ${after.rows.length} after the live turn`);
    console.log(`report: ${reportFile}`);
    console.log(`shot: ${shot}`);
    for (const failure of failures) console.log(`FAIL ${failure}`);
    console.log(report.pass ? "chat bubble meta: PASS" : "chat bubble meta: FAIL");

    clearTimeout(timeout);
    app.exit(report.pass ? 0 : 1);
  } catch (error) {
    clearTimeout(timeout);
    console.error(`chat-bubble-meta: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  }
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-bubble-meta: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
