/**
 * Drives the automations harness in a real Electron window and turns what the
 * rail, the Automations page and the Daily Note's trigger actually render into
 * `e2e/artifacts/automation.{json,png}` — plus `automation-chat.png`, the day's
 * page with the automation's new chat open and its prompt in the transcript.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/automation.electron.mjs
 *
 * Exit code 0 = every invariant held. What this rig claims:
 *
 *  1. The governed shelf is one cordoned group at the foot of the rail:
 *     Life-Chain, Decisions, Daily Note, Automations, with a divider above the
 *     shelf and another between it and the Log. Reading the rail's own DOM order
 *     and its direct dividers is what makes "cordoned" falsifiable.
 *  2. Automations sits directly under Daily Note and is the active row on its
 *     route; the Daily Note is directly under Decisions.
 *  3. The Automations page names the one automation, says what it does, and
 *     links back to the page that owns its trigger.
 *  4. The Daily Note's Analyze note control is present and usable while a note
 *     is on screen.
 *  5. Clicking it creates a fresh chat, opens the dock on it, and sends the
 *     automation prompt as the visible first turn.
 *  6. The note is fed whole. The seeded day is longer than the page-context
 *     budget; its first and last words must both appear in the turn's
 *     `automationContext`, and the prompt must ask for tasks, goals and details.
 *  7. No bridge call this rig does not model, and no console error.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/automation.html";
const SIZE = { width: 1280, height: 900 };

const errors = [];
function failure(message) {
  errors.push(message);
}
function check(label, condition, detail) {
  if (condition) return true;
  failure(`${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

const SAMPLE = `(() => {
  const text = (el) => (el ? (el.textContent || "").trim() : null);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const links = (root) =>
    root
      ? Array.from(root.querySelectorAll(".nav-rail__link")).map((a) => ({
          label: text(a.querySelector(".nav-rail__label")),
          href: a.getAttribute("href"),
          icon: Boolean(a.querySelector("svg")),
          active: a.classList.contains("nav-rail__link--active"),
        }))
      : [];
  const bottom = document.querySelector(".nav-rail__section--bottom");
  const shelf = document.querySelector('[data-nav-group="governance"]');
  const footer = document.querySelector('[data-nav-group="footer"]');
  const wing = document.querySelector('[data-nav-group="wing"]');
  const rows = Array.from(document.querySelectorAll(".automation-row")).map((row) => {
    const action = row.querySelector(".automation-row__open");
    return {
      name: text(row.querySelector(".automation-row__name")),
      description: text(row.querySelector(".automation-row__desc")),
      action: text(action),
      actionHref: action ? action.getAttribute("href") : null,
      testId: row.getAttribute("data-testid"),
    };
  });
  const analyze = document.querySelector('[data-testid="daily-note-analyze"]');
  const editor = document.querySelector(".daily-note__editor");
  const noteBody = editor
    ? Array.from(editor.querySelectorAll("[data-note-block]"))
        .map((el) => {
          const area = el.querySelector("textarea");
          return area ? area.value : (el.textContent || "");
        })
        .join("\\n\\n")
        .trim()
    : null;
  const userMessages = Array.from(
    document.querySelectorAll(
      ".chat-panel__message--user .chat-panel__message-content",
    ),
  ).map((el) => (el.textContent || "").trim());
  return {
    route: window.automationRoute ?? null,
    rail: {
      wing: links(wing),
      shelf: links(shelf),
      footer: links(footer),
      dividers: bottom
        ? bottom.querySelectorAll(":scope > .nav-rail__divider").length
        : 0,
      dividerRole: bottom
        ? Array.from(bottom.querySelectorAll(":scope > .nav-rail__divider")).every(
            (el) => el.getAttribute("role") === "separator",
          )
        : false,
      wingBox: box(wing),
      shelfBox: box(shelf),
      footerBox: box(footer),
      bottomBox: box(bottom),
    },
    automations: {
      heading: text(document.querySelector("[data-page-context-root] h1")),
      groupTitle: text(document.querySelector(".automations-page__group-title")),
      rows,
    },
    note: {
      heading: text(document.querySelector("[data-page-context-root] h1")),
      day: text(document.querySelector('[data-testid="daily-note-day"]')),
      analyze: analyze
        ? {
            label: text(analyze),
            disabled: analyze.disabled,
            title: analyze.getAttribute("title"),
          }
        : null,
      bodyLength: noteBody ? noteBody.length : null,
      bodyTail: noteBody ? noteBody.slice(-80) : null,
    },
    chat: {
      open: document
        .querySelector(".shell")
        ?.classList.contains("shell--chat-open")
        ? true
        : false,
      title: text(document.querySelector(".chat-panel__heading--thread")),
      userMessages,
      thinking: Boolean(document.querySelector(".chat-panel__thinking")),
    },
    sessionCalls: window.automationSessionCalls ?? [],
    chatCalls: window.automationChatCalls ?? [],
  };
})()`;

function waitFor(win, expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
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

function idle(win, ms) {
  return win.webContents.executeJavaScript(
    `new Promise((resolve) => setTimeout(resolve, ${ms}))`,
  );
}

function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

async function shoot(win, name) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const image = await win.webContents.capturePage();
  const file = path.join(artifactsDir, name);
  fs.writeFileSync(file, image.toPNG());
  return file;
}

/** The same label the page prints for a local ISO day: `23 Oct 2026`. */
function dayLabel(iso) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${months[month - 1]} ${iso.slice(0, 4)}`;
}

async function main() {
  const sessionPartition = `automation-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: SIZE.width,
    height: SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionPartition,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(SIZE.width, SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const checks = {};
  const screenshots = [];

  try {
    await win.loadURL(`${url}?v=${Date.now()}`);
    await waitFor(win, "Boolean(window.automationReady)", "automationReady");

    const today = await win.webContents.executeJavaScript(
      "window.automationToday",
    );
    const note = await win.webContents.executeJavaScript(
      "window.automationNote",
    );
    checks.today = today;
    checks.noteLength = note.length;
    if (note.length <= 4000) {
      failure(
        `the rig's note is only ${note.length} characters, so it proves nothing about the 4000-character page-context budget`,
      );
    }

    const skin = await win.webContents.executeJavaScript(
      "({ name: window.automationSkin, applied: document.documentElement.dataset.skin ?? null })",
    );
    checks.skin = skin;
    check(
      "the harness paints in the app's skin",
      Boolean(skin.name) && skin.applied === skin.name,
      JSON.stringify(skin),
    );

    // ── 1. the rail: a cordoned shelf above the Log ────────────────────────
    const landing = await sample(win);
    checks.landing = landing;
    check("the harness landed on /automations", landing.route === "/automations", landing.route);
    check(
      "the shelf is Life-Chain, Decisions, Daily Note, Automations",
      JSON.stringify(landing.rail.shelf.map((l) => l.label)) ===
        JSON.stringify(["Life-Chain", "Decisions", "Daily Note", "Automations"]),
      JSON.stringify(landing.rail.shelf.map((l) => l.label)),
    );
    check(
      "Daily Note is directly under Decisions and Automations directly under it",
      landing.rail.shelf[2]?.label === "Daily Note" &&
        landing.rail.shelf[3]?.label === "Automations",
      JSON.stringify(landing.rail.shelf.map((l) => l.label)),
    );
    check(
      "Automations is the active row on its own route",
      landing.rail.shelf[3]?.active === true,
      JSON.stringify(landing.rail.shelf[3]),
    );
    check(
      "Automations points at /automations",
      (landing.rail.shelf[3]?.href ?? "").endsWith("/automations"),
      landing.rail.shelf[3]?.href,
    );
    check(
      "the shelf carries icons",
      landing.rail.shelf.every((l) => l.icon),
      JSON.stringify(landing.rail.shelf.map((l) => l.icon)),
    );
    check(
      "the Log is the footer's only row",
      JSON.stringify(landing.rail.footer.map((l) => l.label)) === '["Log"]',
      JSON.stringify(landing.rail.footer.map((l) => l.label)),
    );
    check(
      "the governed shelf has a divider above it and another above the Log",
      landing.rail.dividers === 2 && landing.rail.dividerRole === true,
      `dividers ${landing.rail.dividers}, separators ${landing.rail.dividerRole}`,
    );
    const wingBox = landing.rail.wingBox;
    const shelfBox = landing.rail.shelfBox;
    const footerBox = landing.rail.footerBox;
    check(
      "the shelf sits below the wing's rows and above the Log",
      Boolean(wingBox && shelfBox && footerBox) &&
        shelfBox.top >= wingBox.bottom - 2 &&
        footerBox.top >= shelfBox.bottom - 2,
      JSON.stringify({ wingBox, shelfBox, footerBox }),
    );
    check(
      "the shelf is at the foot of the rail, not the top",
      Boolean(shelfBox) && shelfBox.top > 200,
      JSON.stringify(shelfBox),
    );

    // ── 2. the Automations page: one line ──────────────────────────────────
    check(
      "the Automations page is headed Automations",
      landing.automations.heading === "Automations",
      JSON.stringify(landing.automations.heading),
    );
    check(
      "the one row is grouped under Daily Note",
      landing.automations.groupTitle === "Daily Note",
      JSON.stringify(landing.automations.groupTitle),
    );
    check(
      "the page lists exactly one automation",
      landing.automations.rows.length === 1,
      JSON.stringify(landing.automations.rows),
    );
    const row = landing.automations.rows[0] ?? {};
    check(
      "the row is the Analyze note automation",
      row.name === "Analyze note" && row.testId === "automation-daily-note-analyze",
      JSON.stringify(row),
    );
    check(
      "the row says what it does",
      /Kanban/.test(row.description ?? "") && /goals/i.test(row.description ?? ""),
      JSON.stringify(row.description),
    );
    check(
      "the row leads back to the Daily Note",
      (row.actionHref ?? "").endsWith("/notes") &&
        /Daily Note/.test(row.action ?? ""),
      JSON.stringify({ action: row.action, href: row.actionHref }),
    );
    screenshots.push(await shoot(win, "automation.png"));

    // ── 3. the Daily Note's trigger ────────────────────────────────────────
    await win.webContents.executeJavaScript(
      `window.automationGoto("/notes")`,
    );
    await waitFor(
      win,
      `window.automationRoute === "/notes" && Boolean(document.querySelector('[data-testid="daily-note-analyze"]')) && !document.querySelector('[data-testid="daily-note-analyze"]').disabled`,
      "the Analyze note trigger to become available",
    );
    const dayPage = await sample(win);
    checks.dayPage = dayPage;
    check(
      "the Daily Note page is on screen",
      dayPage.note.heading === "Daily Note" && dayPage.note.bodyLength > 4000,
      JSON.stringify({ heading: dayPage.note.heading, bodyLength: dayPage.note.bodyLength }),
    );
    check(
      "the Analyze note control is on the page and usable",
      dayPage.note.analyze?.label === "Analyze note" &&
        dayPage.note.analyze?.disabled === false,
      JSON.stringify(dayPage.note.analyze),
    );
    check(
      "Daily Note is the active rail row on its route",
      dayPage.rail.shelf.find((l) => l.label === "Daily Note")?.active === true,
      JSON.stringify(dayPage.rail.shelf),
    );

    // ── 4. the click: a fresh chat, fed the whole note ─────────────────────
    const clicked = await win.webContents.executeJavaScript(
      `(() => { const el = document.querySelector('[data-testid="daily-note-analyze"]'); if (!el) return false; el.click(); return true; })()`,
    );
    check("the Analyze note control was clicked", clicked === true, String(clicked));
    await waitFor(
      win,
      `(window.automationChatCalls ?? []).length > 0`,
      "the automation's first turn",
    );
    await waitFor(
      win,
      `Boolean(document.querySelector(".chat-panel__message--user"))`,
      "the prompt bubble",
    );
    await idle(win, 250);
    const after = await sample(win);
    checks.after = after;

    const session = after.sessionCalls[0];
    const expectedTitle = `Analyze note · ${dayLabel(today)}`;
    check(
      "one fresh chat was created for the run",
      after.sessionCalls.length === 1,
      JSON.stringify(after.sessionCalls),
    );
    check(
      "the chat is named after the automation and the day",
      session?.title === expectedTitle,
      JSON.stringify({ got: session?.title, want: expectedTitle }),
    );
    check(
      "the dock opened on that chat",
      after.chat.open === true && after.chat.title === expectedTitle,
      JSON.stringify({ open: after.chat.open, title: after.chat.title }),
    );
    check(
      "the visible turn is the automation's prompt",
      after.chat.userMessages.length === 1 &&
        /Break down the Daily Note/.test(after.chat.userMessages[0] ?? "") &&
        /Kanban/.test(after.chat.userMessages[0] ?? "") &&
        /goals at different timeframes/.test(after.chat.userMessages[0] ?? "") &&
        /personal and project details/.test(after.chat.userMessages[0] ?? ""),
      JSON.stringify(after.chat.userMessages),
    );

    const call = after.chatCalls[0];
    check(
      "the turn was sent on the new chat",
      call?.sessionId === session?.id,
      JSON.stringify({ call: call?.sessionId, session: session?.id }),
    );
    const prompt = call?.input ?? "";
    check(
      "the prompt names tasks, goals and details without pasting the note",
      /tasks/i.test(prompt) &&
        /goals/i.test(prompt) &&
        /details/i.test(prompt) &&
        !prompt.includes("Context note 1:"),
      JSON.stringify(prompt.slice(0, 400)),
    );
    const context = call?.instructionsContext?.automationContext ?? "";
    check(
      "the turn carries an automation context",
      context.includes("DAILY NOTE AUTOMATION — ANALYZE NOTE"),
      context.slice(0, 200),
    );
    check(
      "the automation context carries the whole note, head and tail",
      context.includes("Friday: a long day, and a lot of it belongs somewhere else in LifeQuest.") &&
        context.includes("Context note 1:") &&
        context.includes("Context note 55:") &&
        context.includes(
          "Last line: the tail of the note must reach the agent's context",
        ) &&
        context.length > 4000,
      JSON.stringify({
        length: context.length,
        hasHead: context.includes("Friday: a long day"),
        hasTail: context.includes("Last line: the tail of the note"),
        hasContext1: context.includes("Context note 1:"),
        hasContext55: context.includes("Context note 55:"),
      }),
    );
    check(
      "the automation context is told to file tasks, goals and details",
      /Kanban board/.test(context) &&
        /Goals at different timeframes/.test(context) &&
        /Personal, contextual and project details/.test(context),
      context.slice(0, 600),
    );
    check(
      "the automation context names the page's own day",
      context.includes(`--- DAILY NOTE (${today}) ---`) &&
        context.includes(`--- END DAILY NOTE ---`),
      JSON.stringify({ today }),
    );
    check(
      "the page-context pill still rides the turn as the screen",
      call?.instructionsContext?.pageContext?.route === "/notes",
      JSON.stringify(call?.instructionsContext?.pageContext?.route),
    );

    screenshots.push(await shoot(win, "automation-chat.png"));

    const unexpected = await win.webContents.executeJavaScript(
      "window.automationUnexpectedCalls",
    );
    checks.unexpectedBridgeCalls = unexpected;
    check(
      "the pages called no bridge method this rig does not model",
      unexpected.length === 0,
      unexpected.join(", "),
    );
    checks.consoleErrors = consoleErrors;
    check(
      "the pages logged no console error",
      consoleErrors.length === 0,
      consoleErrors.join(" | "),
    );
  } catch (err) {
    failure(`the driver stopped: ${err instanceof Error ? err.message : String(err)}`);
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks,
    screenshots,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "automation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`route:     ${checks.landing?.route}`);
  console.log(
    `rail:      ${JSON.stringify(checks.landing?.rail?.shelf?.map((l) => l.label))} / ${JSON.stringify(checks.landing?.rail?.footer?.map((l) => l.label))}`,
  );
  console.log(
    `automations: ${JSON.stringify(checks.landing?.automations?.rows?.map((r) => r.name))}`,
  );
  console.log(
    `session:   ${JSON.stringify(checks.after?.sessionCalls?.[0]?.title)}`,
  );
  console.log(
    `note:      ${checks.noteLength} chars, fed ${checks.after?.chatCalls?.[0]?.instructionsContext?.automationContext?.length ?? 0} chars`,
  );
  console.log(`failures:  ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

void app.whenReady().then(main);
