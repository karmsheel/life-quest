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
 *     shelf and another between it and the Log.
 *  2. Automations sits directly under Daily Note and is the active row on its
 *     route; the Daily Note is directly under Decisions.
 *  3. The Automations page groups the shelf by trigger type. The built-in is a
 *     manual job; the editor creates a scheduled one with a day and time.
 *  4. The editor edits an existing job and its changes reach the bridge.
 *  5. Run now, and the Daily Note's own button, each open a fresh chat with the
 *     resolved prompt and the whole note in the hidden context.
 *  6. A scheduled job that is already due runs once, writes its last run back,
 *     and does not open the dock.
 *  7. The Analyze note prompt asks for a place to track anything the note
 *     mentions that LifeQuest has no home for yet.
 *  8. No bridge call this rig does not model, and no console error.
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
  const rows = Array.from(document.querySelectorAll(".automation-row")).map((row) => ({
    testId: row.getAttribute("data-testid"),
    name: text(row.querySelector(".automation-row__name")),
    description: text(row.querySelector(".automation-row__desc")),
    trigger: row.getAttribute("data-trigger"),
    meta: text(row.querySelector(".automation-row__meta")),
    badge: text(row.querySelector(".automation-row__badge")),
    actions: Array.from(row.querySelectorAll("button")).map((b) => text(b)),
    error: text(row.querySelector(".automation-row__error")),
  }));
  const groups = Array.from(document.querySelectorAll(".automations-page__group")).map(
    (group) => ({
      title: text(group.querySelector(".automations-page__group-title")),
      description: text(group.querySelector(".automations-page__group-desc")),
      rows: group.querySelectorAll(".automation-row").length,
    }),
  );
  const editor = document.querySelector('[data-testid="automation-editor"]');
  const editorField = (id) => {
    const el = document.querySelector('[data-testid="' + id + '"]');
    if (!el) return null;
    return el.type === "checkbox" ? el.checked : el.value;
  };
  const analyze = document.querySelector('[data-testid="daily-note-analyze"]');
  const editorBox = document.querySelector(".daily-note__editor");
  const noteBody = editorBox
    ? Array.from(editorBox.querySelectorAll("[data-note-block]"))
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
  const chatHeading = document.querySelector(".chat-panel__heading--thread");
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
      firstWingBox: box(wing ? wing.querySelector(".nav-rail__link") : null),
      topBarBox: box(document.querySelector(".top-bar")),
      shelfBox: box(shelf),
      footerBox: box(footer),
      bottomBox: box(bottom),
    },
    automations: {
      heading: text(document.querySelector("[data-page-context-root] h1")),
      groups,
      rows,
      editorOpen: Boolean(editor),
      editor: editor
        ? {
            name: editorField("automation-name"),
            description: editorField("automation-description"),
            host: editorField("automation-host"),
            triggerManual:
              document
                .querySelector('[data-testid="automation-trigger-manual"]')
                ?.getAttribute("aria-checked") === "true",
            triggerSchedule:
              document
                .querySelector('[data-testid="automation-trigger-schedule"]')
                ?.getAttribute("aria-checked") === "true",
            frequency: editorField("automation-frequency"),
            weekday: editorField("automation-weekday"),
            time: editorField("automation-time"),
            prompt: editorField("automation-prompt"),
            enabled: editorField("automation-enabled"),
          }
        : null,
    },
    note: {
      heading: text(document.querySelector("[data-page-context-root] h1")),
      day: text(document.querySelector('[data-testid="daily-note-day"]')),
      automationButtons: Array.from(
        document.querySelectorAll(".daily-note__automations button"),
      ).map((button) => text(button)),
      analyze: analyze
        ? {
            label: text(analyze),
            disabled: analyze.disabled,
            title: analyze.getAttribute("title"),
          }
        : null,
      bodyLength: noteBody ? noteBody.length : null,
    },
    chat: {
      open: document
        .querySelector(".shell")
        ?.classList.contains("shell--chat-open")
        ? true
        : false,
      title: chatHeading ? text(chatHeading) : null,
      userMessages,
      thinking: Boolean(document.querySelector(".chat-panel__thinking")),
    },
    sessionCalls: window.automationSessionCalls ?? [],
    chatCalls: window.automationChatCalls ?? [],
    createCalls: window.automationCreateCalls ?? [],
    updateCalls: window.automationUpdateCalls ?? [],
    deleteCalls: window.automationDeleteCalls ?? [],
    markCalls: window.automationMarkCalls ?? [],
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

function click(win, testId) {
  return win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) return false; el.click(); return true; })()`,
  );
}

/** Set a controlled input's value the way a keystroke would. */
function setField(win, testId, value) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return false;
    const proto = el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    return true;
  })()`);
}

function setChecked(win, testId, checked) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked").set;
    setter.call(el, ${checked ? "true" : "false"});
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
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
      "the wing's first icon starts below the top bar's bottom hairline",
      Boolean(landing.rail.firstWingBox && landing.rail.topBarBox) &&
        landing.rail.firstWingBox.top >= landing.rail.topBarBox.bottom,
      JSON.stringify({
        first: landing.rail.firstWingBox,
        topBar: landing.rail.topBarBox,
      }),
    );

    // ── 2. the shelf groups by type, and the built-in is manual ────────────
    check(
      "the Automations page is headed Automations",
      landing.automations.heading === "Automations",
      JSON.stringify(landing.automations.heading),
    );
    check(
      "the page groups jobs into Manual and Scheduled",
      JSON.stringify(landing.automations.groups.map((g) => g.title)) ===
        JSON.stringify(["Manual 1", "Scheduled 0"]),
      JSON.stringify(landing.automations.groups),
    );
    const builtIn = landing.automations.rows.find(
      (row) => row.testId === "automation-daily-note-analyze",
    );
    check("the built-in row is on the shelf", Boolean(builtIn), JSON.stringify(landing.automations.rows));
    check(
      "the built-in is a manual job that reads the Daily Note",
      builtIn?.trigger === "manual" &&
        /Manual/.test(builtIn?.meta ?? "") &&
        /Daily Note/.test(builtIn?.meta ?? ""),
      JSON.stringify(builtIn),
    );
    check(
      "the row offers Run now, Edit, Pause and Delete",
      ["Run now", "Edit", "Pause", "Delete"].every((label) =>
        builtIn?.actions?.some((action) => action.includes(label)),
      ),
      JSON.stringify(builtIn?.actions),
    );
    check(
      "the built-in description names tasks and goals",
      /Kanban/.test(builtIn?.description ?? "") &&
        /goals/i.test(builtIn?.description ?? ""),
      JSON.stringify(builtIn?.description),
    );

    // ── 3. create a scheduled automation through the editor ────────────────
    await click(win, "automation-new");
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="automation-editor"]'))`,
      "the new-automation editor",
    );
    await setField(win, "automation-name", "Weekly review prep");
    await setField(
      win,
      "automation-description",
      "Sets up the weekly review thread before I sit down.",
    );
    await setField(win, "automation-host", "none");
    await click(win, "automation-trigger-schedule");
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="automation-frequency"]'))`,
      "the schedule fields",
    );
    await setField(win, "automation-frequency", "weekly");
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="automation-weekday"]'))`,
      "the weekday field",
    );
    await setField(win, "automation-weekday", "1");
    await setField(win, "automation-time", "23:59");
    await setField(
      win,
      "automation-prompt",
      "Set up the weekly review for {{dateLabel}} and list what changed since last week.",
    );
    const editing = await sample(win);
    checks.editor = editing.automations;
    check(
      "the editor holds the scheduled fields",
      editing.automations.editor?.triggerSchedule === true &&
        editing.automations.editor?.frequency === "weekly" &&
        editing.automations.editor?.weekday === "1" &&
        editing.automations.editor?.time === "23:59" &&
        editing.automations.editor?.host === "none",
      JSON.stringify(editing.automations.editor),
    );
    await click(win, "automation-save");
    await waitFor(
      win,
      "(window.automationCreateCalls ?? []).length > 0",
      "the create to reach the bridge",
    );
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="automation-automation-created-1"]'))`,
      "the new scheduled row",
    );
    const created = await sample(win);
    checks.created = { ...created.automations, createCalls: created.createCalls };
    const createInput = created.createCalls[0];
    check(
      "the created job is the scheduled one the editor held",
      createInput?.name === "Weekly review prep" &&
        createInput?.host === "none" &&
        createInput?.trigger?.type === "schedule" &&
        createInput?.trigger?.frequency === "weekly" &&
        createInput?.trigger?.weekday === 1 &&
        createInput?.trigger?.time === "23:59" &&
        createInput?.enabled === true,
      JSON.stringify(createInput),
    );
    check(
      "the new job is grouped as Scheduled and shows its cadence",
      created.automations.groups[1]?.rows === 1 &&
        created.automations.rows.some(
          (row) =>
            row.testId === "automation-automation-created-1" &&
            /Scheduled/.test(row.meta ?? "") &&
            /Mondays at 23:59/.test(row.meta ?? "") &&
            /No page/.test(row.meta ?? ""),
        ),
      JSON.stringify(created.automations.rows),
    );
    screenshots.push(await shoot(win, "automation.png"));

    // ── 4. edit the built-in, and delete the new one ───────────────────────
    await click(win, "automation-edit-daily-note-analyze");
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="automation-editor"]'))`,
      "the built-in's editor",
    );
    const beforeEdit = await sample(win);
    const promptBefore = beforeEdit.automations.editor?.prompt ?? "";
    await setField(
      win,
      "automation-description",
      "Edited: breaks the day down, and proposes places to track what has no home.",
    );
    await setField(
      win,
      "automation-prompt",
      `${promptBefore}\nAlso name one thing I should stop doing.`,
    );
    await click(win, "automation-save");
    await waitFor(
      win,
      "(window.automationUpdateCalls ?? []).length > 0",
      "the edit to reach the bridge",
    );
    const edits = await sample(win);
    checks.edits = { ...edits.automations, updateCalls: edits.updateCalls };
    const update = edits.updateCalls[0];
    check(
      "the edit kept the built-in's manual trigger and its new prompt step",
      update?.id === "daily-note-analyze" &&
        update?.input?.trigger?.type === "manual" &&
        /propose the document, page or database/.test(update?.input?.prompt ?? "") &&
        /no place for yet/.test(update?.input?.prompt ?? "") &&
        /Also name one thing I should stop doing\./.test(
          update?.input?.prompt ?? "",
        ),
      JSON.stringify(update),
    );
    check(
      "the edited row's description is on the shelf",
      edits.automations.rows.some(
        (row) =>
          row.testId === "automation-daily-note-analyze" &&
          /Edited: breaks the day down/.test(row.description ?? ""),
      ),
      JSON.stringify(edits.automations.rows),
    );

    await click(win, "automation-delete-automation-created-1");
    await waitFor(
      win,
      `Boolean(document.querySelector(".confirm-dialog__confirm"))`,
      "the delete confirmation",
    );
    await win.webContents.executeJavaScript(
      `document.querySelector(".confirm-dialog__confirm").click()`,
    );
    await waitFor(
      win,
      "(window.automationDeleteCalls ?? []).length > 0",
      "the delete to reach the bridge",
    );
    await waitFor(
      win,
      `!document.querySelector('[data-testid="automation-automation-created-1"]')`,
      "the deleted row to leave the shelf",
    );
    const deleted = await sample(win);
    checks.deleted = { ...deleted.automations, deleteCalls: deleted.deleteCalls };
    check(
      "the built-in remains alone after the delete",
      deleted.automations.rows.length === 1 &&
        deleted.automations.rows[0]?.testId === "automation-daily-note-analyze",
      JSON.stringify(deleted.automations.rows),
    );

    // ── 4b. a manual job created for the Daily Note becomes a button there ──
    await click(win, "automation-new");
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="automation-editor"]'))`,
      "the manual job's editor",
    );
    await setField(win, "automation-name", "Morning focus");
    await setField(
      win,
      "automation-description",
      "Names the one thing the day should start with.",
    );
    await setField(
      win,
      "automation-prompt",
      "Name the one thing I should do first on {{dateLabel}}.",
    );
    await click(win, "automation-save");
    await waitFor(
      win,
      "(window.automationCreateCalls ?? []).length > 1",
      "the manual job to reach the bridge",
    );
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="automation-automation-created-2"]'))`,
      "the new manual row",
    );
    const manualCreated = await sample(win);
    checks.manualCreated = manualCreated.automations;
    check(
      "the manual job lands in the Manual group on the Daily Note",
      manualCreated.automations.groups[0]?.title === "Manual 2" &&
        manualCreated.automations.rows.some(
          (row) =>
            row.testId === "automation-automation-created-2" &&
            row.trigger === "manual" &&
            /Daily Note/.test(row.meta ?? ""),
        ),
      JSON.stringify(manualCreated.automations),
    );

    // ── 5. a due schedule runs once and records itself ─────────────────────
    await idle(win, 300);
    await win.webContents.executeJavaScript("window.automationSeedScheduled()");
    try {
      await waitFor(
        win,
        `(window.automationMarkCalls ?? []).some((call) => call.id === "scheduled-sweep")`,
        "the scheduled run to record itself",
        15_000,
      );
    } catch {
      await win.webContents.executeJavaScript(
        `window.dispatchEvent(new Event("lifequest:automations-changed"))`,
      );
      await waitFor(
        win,
        `(window.automationMarkCalls ?? []).some((call) => call.id === "scheduled-sweep")`,
        "the scheduled run after a nudge",
        15_000,
      );
    }
    const scheduled = await sample(win);
    checks.scheduled = scheduled;
    const scheduledChat = scheduled.chatCalls.find((call) =>
      call.input.includes("Sweep"),
    );
    const scheduledMark = scheduled.markCalls.find(
      (call) => call.id === "scheduled-sweep",
    );
    check(
      "the scheduled job ran its own prompt and passed the note",
      Boolean(scheduledChat) &&
        /Sweep \d{1,2} \w{3} \d{4}/.test(scheduledChat?.input ?? "") &&
        (scheduledChat?.instructionsContext?.automationContext ?? "").includes(
          "Context note 55:",
        ),
      JSON.stringify({
        input: scheduledChat?.input?.slice(0, 120),
        context: (scheduledChat?.instructionsContext?.automationContext ?? "").length,
      }),
    );
    check(
      "the scheduled run recorded a success and its session",
      scheduledMark?.patch?.status === "succeeded" &&
        typeof scheduledMark?.patch?.sessionId === "string",
      JSON.stringify(scheduledMark),
    );
    const scheduledTitle = `Scheduled sweep · ${dayLabel(today)}`;
    check(
      "the scheduled run did not open its chat",
      scheduled.chat.title !== scheduledTitle &&
        !scheduled.chat.userMessages.some((message) =>
          message.startsWith("Sweep "),
        ),
      JSON.stringify({
        title: scheduled.chat.title,
        messages: scheduled.chat.userMessages.map((message) => message.slice(0, 40)),
      }),
    );
    check(
      "the due state is persisted on the row",
      /Last run/.test(
        scheduled.automations.rows.find((row) => row.testId === "automation-scheduled-sweep")
          ?.meta ?? "",
      ),
      JSON.stringify(scheduled.automations.rows),
    );

    // ── 6. the Daily Note's own manual button ──────────────────────────────
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
      "the page draws a button for every manual job that reads it",
      JSON.stringify(dayPage.note.automationButtons) ===
        JSON.stringify(["Analyze note", "Morning focus"]),
      JSON.stringify(dayPage.note.automationButtons),
    );
    check(
      "Daily Note is the active rail row on its route",
      dayPage.rail.shelf.find((l) => l.label === "Daily Note")?.active === true,
      JSON.stringify(dayPage.rail.shelf),
    );

    const clicked = await click(win, "daily-note-analyze");
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

    const session = after.sessionCalls.find(
      (call) => call.title === `Analyze note · ${dayLabel(today)}`,
    );
    check(
      "a fresh chat was created for the run",
      Boolean(session),
      JSON.stringify(after.sessionCalls),
    );
    check(
      "the dock opened on that chat",
      after.chat.open === true &&
        after.chat.title === `Analyze note · ${dayLabel(today)}`,
      JSON.stringify({ open: after.chat.open, title: after.chat.title }),
    );
    check(
      "the visible turn is the automation's prompt",
      after.chat.userMessages.length === 1 &&
        /Analyze the Daily Note for/.test(after.chat.userMessages[0] ?? "") &&
        /Kanban board/.test(after.chat.userMessages[0] ?? "") &&
        /Goals at different timeframes/.test(after.chat.userMessages[0] ?? "") &&
        /propose the document, page or database/.test(
          after.chat.userMessages[0] ?? "",
        ) &&
        /Also name one thing I should stop doing\./.test(
          after.chat.userMessages[0] ?? "",
        ),
      JSON.stringify(after.chat.userMessages),
    );

    const call = after.chatCalls.find(
      (candidate) => candidate.sessionId === session?.id,
    );
    check(
      "the turn was sent on the new chat",
      Boolean(call),
      JSON.stringify({ call: call?.sessionId, session: session?.id }),
    );
    const prompt = call?.input ?? "";
    check(
      "the prompt asks for the new-tracking step and does not paste the note",
      /no place for yet/i.test(prompt) &&
        /propose the document, page or database/i.test(prompt) &&
        /Also name one thing I should stop doing\./i.test(prompt) &&
        !prompt.includes("Context note 1:"),
      JSON.stringify(prompt.slice(0, 600)),
    );
    const context = call?.instructionsContext?.automationContext ?? "";
    check(
      "the turn carries an automation context",
      context.includes("AUTOMATION — ANALYZE NOTE"),
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
        hasContext55: context.includes("Context note 55:"),
      }),
    );
    check(
      "the automation context names the page's own day",
      context.includes(`--- DAILY NOTE (${today}) ---`) &&
        context.includes("--- END DAILY NOTE ---"),
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
    `groups:    ${JSON.stringify(checks.landing?.automations?.groups)}`,
  );
  console.log(`created:   ${JSON.stringify(checks.created?.createCalls?.[0]?.name)}`);
  console.log(`scheduled: ${JSON.stringify(checks.scheduled?.markCalls)}`);
  console.log(
    `note:      ${checks.noteLength} chars, fed ${checks.after?.chatCalls?.find((c) => c.input.startsWith("Analyze the Daily Note"))?.instructionsContext?.automationContext?.length ?? 0} chars`,
  );
  console.log(`failures:  ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

void app.whenReady().then(main);
