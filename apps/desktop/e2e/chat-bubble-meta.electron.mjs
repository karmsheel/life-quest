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
 *  1. Same side — both roles start at the transcript's leading edge (or both at
 *     the trailing one), so whose turn it is is not readable.
 *  2. The operator is not a bubble — their row is not pushed to the trailing
 *     edge, wears no accent tint, or has no border.
 *  3. The companion's answer is still a bubble — it carries a fill, a border or
 *     padding instead of resting on the panel as plain prose.
 *  4. The answer is inset — its text does not start at the transcript's leading
 *     edge, or it is narrower than the transcript column.
 *  5. The roles are unlabelled — "You" is missing, or the answer is not labelled
 *     with the companion's own name.
 *  6. No stamp — a row renders without a `time`, so the operator cannot tell
 *     when it arrived.
 *  7. Wrong stamp — a loaded timestamp is dropped or shifted, so the visible
 *     time does not describe the row the gateway sent.
 *  8. No copy control — a stamp has no button beside it, the control is not the
 *     stamp's right neighbour, or the metadata does not sit under its message.
 *  9. Dead copy — clicking the control leaves the clipboard unchanged, or the
 *     "Copied" state is never announced.
 * 10. The empty agent bubble — whitespace-only assistant deltas ("\n\n") during
 *     a live turn paint a tall, empty answer bubble; a turn that has not said
 *     anything must show only its work log.
 * 11. The whitespace veto — the real reply deltas never produce the plain answer
 *     row, or the row copies the whitespace the deltas leaked.
 * 12. The live turn is left out — a sent message or a streamed reply carries no
 *     stamp or copy control, because only loaded history was wired.
 * 13. The live turn changes sides — the sent prompt and the streamed answer do
 *     not sit where their loaded counterparts do.
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
const LOADED_USER_TEXT = "Composer harness";
const LOADED_ASSISTANT_TEXT = "Ready.";
const LIVE_PROMPT = "Live prompt";
const LIVE_REPLY = "Live reply. Still here.";
// What a streaming model sends before it has said anything. The panel must not
// turn these into an answer; see failure modes 10 and 11.
const WHITESPACE_DELTAS = ["\n\n", "  ", "\n"];

/**
 * One read of the transcript's geometry, colours and controls.
 *
 * `contentStyle` is the computed box the operator sees: the operator's bubble
 * must carry a fill and a border, the answer's must carry neither and no
 * padding. `companionName` is read from the composer's own aria-label ("Message
 * Hermes"), so the role-label assertion is against the name the dock is visibly
 * using rather than a hard-coded fixture string.
 */
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
  const styleOf = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      borderTopWidth: cs.borderTopWidth,
      borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth,
      borderLeftWidth: cs.borderLeftWidth,
      borderTopStyle: cs.borderTopStyle,
      borderColor: cs.borderColor,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft
    };
  };
  const composer = document.querySelector(".chat-panel__composer-input");
  const composerLabel = composer ? composer.getAttribute("aria-label") : null;
  const companionName =
    typeof composerLabel === "string" && composerLabel.indexOf("Message ") === 0
      ? composerLabel.slice("Message ".length).trim()
      : null;
  const container = document.querySelector(".chat-panel__messages");
  const rows = Array.from(document.querySelectorAll(".chat-panel__message"))
    .filter((el) => el.querySelector(".chat-panel__message-content"))
    .map((el) => {
      const content = el.querySelector(".chat-panel__message-content");
      const meta = el.querySelector(".chat-panel__message-meta");
      const time = el.querySelector(".chat-panel__message-time");
      const copy = el.querySelector(".chat-panel__message-copy");
      const role = el.querySelector(".chat-panel__message-role");
      return {
        role: el.classList.contains("chat-panel__message--user") ? "user" : "assistant",
        testId: el.getAttribute("data-testid"),
        roleLabel: role ? role.textContent.trim() : null,
        text: content.textContent.trim(),
        rawText: content.textContent,
        content: box(content),
        contentStyle: styleOf(content),
        alignSelf: getComputedStyle(el).alignSelf,
        alignItems: getComputedStyle(el).alignItems,
        meta: box(meta),
        timeText: time ? time.textContent.trim() : null,
        timeIso: time ? time.getAttribute("datetime") : null,
        timeBox: box(time),
        copyPresent: Boolean(copy),
        copyBox: box(copy),
        copyState: copy ? copy.getAttribute("data-copy-state") : null,
        copyLabel: copy ? copy.getAttribute("aria-label") : null
      };
    });
  return { container: box(container), companionName, rows };
})()`;

/**
 * The live turn while only whitespace has streamed: the turn has to be open and
 * its work log visible, and there must be no answer row and no agent content
 * element inside it. The count is over the whole document so the loaded
 * transcript's own answer can prove the probe is not looking at nothing.
 */
const pendingProbe = (userText) => `(() => {
  const wanted = ${JSON.stringify(userText)};
  const turns = Array.from(document.querySelectorAll('[data-testid="turn"]'));
  const turn = turns.find((el) =>
    ((el.querySelector('[data-testid="turn-user"]')?.textContent ?? "").includes(wanted)));
  const send = document.querySelector(".chat-panel__send");
  if (!turn) {
    return {
      turnPresent: false,
      turnStatus: null,
      sendState: send ? send.getAttribute("data-state") : null,
      userPresent: false,
      answerPresent: false,
      agentContentPresent: false,
      agentContentCount: document.querySelectorAll(
        ".chat-panel__message--assistant .chat-panel__message-content"
      ).length,
      answerText: null,
      roleLabels: [],
      processPresent: false
    };
  }
  const answer = turn.querySelector('[data-testid="turn-answer"]');
  return {
    turnPresent: true,
    turnStatus: turn.getAttribute("data-turn-status"),
    sendState: send ? send.getAttribute("data-state") : null,
    userPresent: Boolean(turn.querySelector('[data-testid="turn-user"]')),
    answerPresent: Boolean(answer),
    agentContentPresent: Boolean(
      turn.querySelector(".chat-panel__message--assistant .chat-panel__message-content")
    ),
    agentContentCount: document.querySelectorAll(
      ".chat-panel__message--assistant .chat-panel__message-content"
    ).length,
    answerText: answer
      ? (answer.querySelector(".chat-panel__message-content")?.textContent ?? null)
      : null,
    roleLabels: Array.from(turn.querySelectorAll(".chat-panel__message-role")).map((el) =>
      el.textContent.trim()
    ),
    processPresent: Boolean(turn.querySelector('[data-testid="turn-process"]'))
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/** Alpha channel of a computed colour; 1 when the string carries none. */
function alphaOf(color) {
  const text = String(color ?? "");
  if (!text || text === "transparent") return 0;
  const percent = text.match(/\/\s*([\d.]+)\s*%/);
  if (percent) return Number(percent[1]) / 100;
  const numbers = (text.match(/[\d.]+/g) ?? []).map(Number);
  return numbers.length >= 4 ? numbers[3] : 1;
}

const px = (value) => Number.parseFloat(String(value ?? "0"));
const borderWidths = (style) =>
  [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(px);
const paddings = (style) =>
  [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(px);
const allZero = (values) => values.every((value) => Math.abs(value) < 0.5);
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

/**
 * A: the operator speaks in a bubble against the transcript's trailing edge,
 * wearing the accent scheme the agent's bubble used to wear.
 */
function checkOperatorBubble(prefix, row, container) {
  check(
    `${prefix} sits on the trailing edge`,
    row.alignSelf === "flex-end",
    `align-self ${JSON.stringify(row.alignSelf)}`,
  );
  check(
    `${prefix} touches the transcript's right edge`,
    near(row.content.right, container.right),
    `bubble right ${row.content.right}px, transcript right ${container.right}px`,
  );
  check(
    `${prefix} starts clearly inside the transcript`,
    row.content.left > container.left + 4,
    `bubble left ${row.content.left}px, transcript left ${container.left}px`,
  );
  check(
    `${prefix} wears the accent tint`,
    alphaOf(row.contentStyle.background) > 0.05,
    `background ${row.contentStyle.background}`,
  );
  check(
    `${prefix} has a visible border`,
    borderWidths(row.contentStyle).every((width) => width >= 1) &&
      row.contentStyle.borderTopStyle !== "none",
    `border ${JSON.stringify(borderWidths(row.contentStyle))} ${row.contentStyle.borderTopStyle}`,
  );
}

/**
 * B: the companion's answer is not a bubble — plain prose on the panel, starting
 * at the transcript's leading edge and filling its width.
 */
function checkPlainAnswer(prefix, row, container) {
  check(
    `${prefix} has no fill`,
    alphaOf(row.contentStyle.background) <= 0.001,
    `background ${row.contentStyle.background} (alpha ${alphaOf(row.contentStyle.background)})`,
  );
  check(
    `${prefix} has no border`,
    allZero(borderWidths(row.contentStyle)),
    `border ${JSON.stringify(borderWidths(row.contentStyle))}`,
  );
  check(
    `${prefix} has no padding`,
    allZero(paddings(row.contentStyle)),
    `padding ${JSON.stringify(paddings(row.contentStyle))}`,
  );
  check(
    `${prefix} starts at the transcript's leading edge`,
    near(row.content.left, container.left),
    `content left ${row.content.left}px, transcript left ${container.left}px`,
  );
  check(
    `${prefix} spans the transcript's width`,
    near(row.content.width, container.width, 2),
    `content width ${row.content.width}px, transcript width ${container.width}px`,
  );
  check(
    `${prefix} is not pushed to the trailing edge`,
    row.alignSelf !== "flex-end",
    `align-self ${JSON.stringify(row.alignSelf)}`,
  );
}

/** C: the role label rides each row and names the speaker. */
function checkRoleLabel(prefix, row, companionName) {
  if (row.role === "user") {
    check(`${prefix} is labelled You`, row.roleLabel === "You", `label ${JSON.stringify(row.roleLabel)}`);
    return;
  }
  check(
    `${prefix} is labelled with the companion's own name`,
    Boolean(companionName) && row.roleLabel === companionName,
    `label ${JSON.stringify(row.roleLabel)}, companion ${JSON.stringify(companionName)}`,
  );
}

/** C: the stamp and its copy control are a footer under the message. */
function checkRowMeta(prefix, row) {
  check(
    `${prefix} stamp sits under its message`,
    Boolean(row.meta && row.content) && row.meta.top >= row.content.bottom - 1,
    `meta top ${row.meta?.top}px, content bottom ${row.content?.bottom}px`,
  );
  check(
    `${prefix} stamp is visible`,
    typeof row.timeText === "string" && row.timeText.length > 0 && /[:\d]/.test(row.timeText),
    `stamp ${JSON.stringify(row.timeText)}`,
  );
  check(
    `${prefix} has a copy control to the stamp's right`,
    row.copyPresent &&
      Boolean(row.timeBox && row.copyBox && row.meta) &&
      row.copyBox.left >= row.timeBox.right - 1 &&
      row.copyBox.top < row.meta.bottom &&
      row.copyBox.bottom > row.meta.top,
    `copy ${JSON.stringify(row.copyBox)}, stamp ${JSON.stringify(row.timeBox)}`,
  );
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

  /**
   * Click one row's copy control, wait for its announced state, and read back
   * what the clipboard now holds and what the button says it copied.
   */
  const copyAt = async (target, label) => {
    await clipboard.writeText("sentinel");
    const clicked = await run(
      `(() => { const button = ${target}; if (!button) return false; button.click(); return true; })()`,
    );
    check(`the ${label} copy control exists`, clicked === true, target);
    if (!clicked) return { text: null, label: null };
    await waitFor(
      `${target}?.getAttribute("data-copy-state") === "copied"`,
      `the ${label} copy state`,
    );
    const text = await clipboard.readText();
    const aria = await run(`${target}?.getAttribute("aria-label")`);
    return { text, label: aria };
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
      "both loaded rows are present",
      Boolean(initial.container && initial.companionName && user && assistant),
      `container ${Boolean(initial.container)}, companion ${JSON.stringify(initial.companionName)}, rows ${JSON.stringify(initial.rows.map((row) => row.role))}`,
    );

    if (initial.container && user && assistant) {
      checkOperatorBubble("the operator's loaded turn", user, initial.container);
      checkPlainAnswer("the companion's loaded answer", assistant, initial.container);
      checkRoleLabel("the operator's loaded row", user, initial.companionName);
      checkRoleLabel("the companion's loaded row", assistant, initial.companionName);
      checkRowMeta("the operator's loaded row", user);
      checkRowMeta("the companion's loaded row", assistant);

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
      check(
        "the loaded transcript carries the two fixture turns",
        user.text === LOADED_USER_TEXT && assistant.text === LOADED_ASSISTANT_TEXT,
        `texts ${JSON.stringify(initial.rows.map((row) => row.text))}`,
      );
    }

    // ── Copy, one control per row ──────────────────────────────────────────
    const loadedAssistantCopy = await copyAt(
      `document.querySelectorAll(".chat-panel__message--assistant .chat-panel__message-copy")[0]`,
      "loaded answer",
    );
    check(
      "the loaded answer's copy control copies its own words",
      loadedAssistantCopy.text === LOADED_ASSISTANT_TEXT,
      JSON.stringify(loadedAssistantCopy.text),
    );
    check(
      "the loaded answer's copied state is announced",
      typeof loadedAssistantCopy.label === "string" &&
        loadedAssistantCopy.label.startsWith("Copied"),
      JSON.stringify(loadedAssistantCopy.label),
    );

    const loadedUserCopy = await copyAt(
      `document.querySelectorAll(".chat-panel__message--user .chat-panel__message-copy")[0]`,
      "loaded operator turn",
    );
    check(
      "the loaded operator's copy control copies their own words",
      loadedUserCopy.text === LOADED_USER_TEXT,
      JSON.stringify(loadedUserCopy.text),
    );
    check(
      "the loaded operator's copied state is announced",
      typeof loadedUserCopy.label === "string" && loadedUserCopy.label.startsWith("Copied"),
      JSON.stringify(loadedUserCopy.label),
    );

    // ── The live turn: whitespace first, then the real reply ───────────────
    await run(`window.__lqChatDelay = 2500`);
    await run(`(async () => {
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, ${JSON.stringify(LIVE_PROMPT)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector(".chat-panel__send").click();
      return true;
    })()`);
    await waitFor(
      `(() => {
        const turn = [...document.querySelectorAll('[data-testid="turn"]')].find((el) =>
          ((el.querySelector('[data-testid="turn-user"]')?.textContent ?? "").includes(${JSON.stringify(LIVE_PROMPT)})));
        return Boolean(turn) &&
          document.querySelector(".chat-panel__send")?.getAttribute("data-state") === "stop";
      })()`,
      "the live turn to open",
    );

    const whitespaceEmit = WHITESPACE_DELTAS.map(
      (text) => `emit({ type: "assistant.delta", text: ${JSON.stringify(text)} });`,
    ).join("\n        ");
    await run(`(() => {
        const emit = window.__lqEmit;
        if (!emit) throw new Error("the panel never registered its stream listener");
        ${whitespaceEmit}
        return true;
      })()`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const pending = await run(pendingProbe(LIVE_PROMPT));
    check(
      "the live turn is open while only whitespace has arrived",
      pending.turnPresent === true && pending.turnStatus === "running",
      `turn ${pending.turnPresent} status ${JSON.stringify(pending.turnStatus)}`,
    );
    check(
      "the live turn still shows its operator row",
      pending.userPresent === true,
      JSON.stringify(pending.userPresent),
    );
    check(
      "whitespace-only deltas paint no answer row",
      pending.answerPresent === false,
      `answer ${pending.answerPresent}, text ${JSON.stringify(pending.answerText)}`,
    );
    check(
      "whitespace-only deltas paint no agent content",
      pending.agentContentPresent === false,
      JSON.stringify(pending.agentContentPresent),
    );
    check(
      "the loaded answer is still the only agent content",
      pending.agentContentCount === 1,
      `${pending.agentContentCount} agent content elements`,
    );
    check(
      "the empty live turn still shows its work log",
      pending.processPresent === true,
      JSON.stringify(pending.processPresent),
    );

    await run(`(() => {
      const emit = window.__lqEmit;
      emit({ type: "assistant.delta", text: "Live reply." });
      emit({ type: "assistant.delta", text: " Still here." });
      return true;
    })()`);
    await waitFor(
      `document.querySelector(".chat-panel__send[data-state='stop']") === null`,
      "the live run to settle",
    );
    await new Promise((resolve) => setTimeout(resolve, 120));

    const after = await run(SAMPLE);
    const liveUser = after.rows.find(
      (row) => row.role === "user" && row.text === LIVE_PROMPT,
    );
    const liveReply = after.rows.find(
      (row) => row.role === "assistant" && row.text === LIVE_REPLY,
    );

    check(
      "both sides of the live turn rendered",
      Boolean(liveUser && liveReply),
      `rows ${JSON.stringify(after.rows.map((row) => `${row.role}:${row.text}`))}`,
    );
    check(
      "the live turn did not grow a third row",
      after.rows.length === 4,
      `${after.rows.length} rows`,
    );

    if (after.container && liveUser && liveReply) {
      // E: the live turn follows the same sides as loaded history.
      checkOperatorBubble("the live operator turn", liveUser, after.container);
      checkPlainAnswer("the live reply", liveReply, after.container);
      checkRoleLabel("the live operator row", liveUser, after.companionName);
      checkRoleLabel("the live reply", liveReply, after.companionName);
      checkRowMeta("the live operator row", liveUser);
      checkRowMeta("the live reply", liveReply);

      const now = Date.now();
      for (const row of [liveUser, liveReply]) {
        check(
          `${row.role} live stamp describes now`,
          Boolean(row.timeIso) && Math.abs(Date.parse(row.timeIso) - now) < 60_000,
          `${row.timeIso} around ${new Date(now).toISOString()}`,
        );
      }

      // D: the words are the reply's own — the whitespace deltas never leaked
      // into the answer the operator can copy.
      const liveUserCopy = await copyAt(
        `document.querySelectorAll(".chat-panel__message--user .chat-panel__message-copy")[1]`,
        "live operator turn",
      );
      check(
        "the live operator's copy control copies their own words",
        liveUserCopy.text === LIVE_PROMPT,
        JSON.stringify(liveUserCopy.text),
      );
      check(
        "the live operator's copied state is announced",
        typeof liveUserCopy.label === "string" && liveUserCopy.label.startsWith("Copied"),
        JSON.stringify(liveUserCopy.label),
      );

      const liveReplyCopy = await copyAt(
        `document.querySelectorAll(".chat-panel__message--assistant .chat-panel__message-copy")[1]`,
        "live reply",
      );
      check(
        "the live reply's copy control copies its own words",
        liveReplyCopy.text === LIVE_REPLY,
        JSON.stringify(liveReplyCopy.text),
      );
      check(
        "the live reply's copied state is announced",
        typeof liveReplyCopy.label === "string" && liveReplyCopy.label.startsWith("Copied"),
        JSON.stringify(liveReplyCopy.label),
      );

      check(
        "every settled row still has a stamp",
        after.rows.every(
          (row) => typeof row.timeText === "string" && row.timeText.length > 0,
        ),
        JSON.stringify(after.rows.map((row) => row.timeText)),
      );

      const shot = path.join(artifactsDir, "chat-bubble-meta.png");
      const image = await win.webContents.capturePage();
      fs.writeFileSync(shot, image.toPNG());
      const size = image.getSize();

      const report = {
        pass: failures.length === 0,
        failures,
        initial: {
          container: initial.container,
          companionName: initial.companionName,
          rows: initial.rows,
          colours: {
            user: user?.contentStyle.background ?? null,
            assistant: assistant?.contentStyle.background ?? null,
            userAlpha: user ? alphaOf(user.contentStyle.background) : null,
            assistantAlpha: assistant ? alphaOf(assistant.contentStyle.background) : null,
          },
        },
        whitespace: pending,
        live: {
          container: after.container,
          companionName: after.companionName,
          rows: after.rows,
        },
        copies: {
          loadedAssistant: loadedAssistantCopy,
          loadedUser: loadedUserCopy,
          liveUser: liveUserCopy,
          liveReply: liveReplyCopy,
        },
        shots: { thread: shot, width: size.width, height: size.height },
      };

      const reportFile = path.join(artifactsDir, "chat-bubble-meta.json");
      fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

      console.log(
        `chat bubbles: ${initial.rows.length} loaded, ${after.rows.length} after the live turn`,
      );
      console.log(`report: ${reportFile}`);
      console.log(`shot: ${shot} (${size.width}x${size.height})`);
      for (const failure of failures) console.log(`FAIL ${failure}`);
      console.log(report.pass ? "chat bubble meta: PASS" : "chat bubble meta: FAIL");

      clearTimeout(timeout);
      app.exit(report.pass ? 0 : 1);
    } else {
      // Without a settled live turn there is no report to write: fail with the
      // samples so the run says what the transcript actually showed.
      console.error(
        `chat-bubble-meta: the live turn did not settle into two rows: ${JSON.stringify(after.rows)}`,
      );
      clearTimeout(timeout);
      app.exit(1);
    }
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
