/**
 * Drives the daily-note harness in a real Electron window and turns what the rail
 * and the page actually render into `e2e/artifacts/daily-note.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/daily-note.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same claims, no eyeballing the app required. It ships with three
 * pictures of the same run: the day's page holding a written note
 * (`daily-note.png`), the box with one paragraph open as its own markdown
 * (`daily-note-editing.png`), and the Review panel (`daily-note-panel.png`).
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. The rail carries Daily Note *directly under Decisions*, in the top group,
 *     with an icon, a label and an href of `#/notes`, and it is the active link
 *     on this route. Reading the rail's own DOM order is what makes "under
 *     Decisions" a fact rather than an intention: move the entry in
 *     `NAV_ITEMS` and the array this rig reads changes.
 *  2. The note is ONE box. The page draws exactly one editor, no split grid and
 *     no preview pane, and at most one paragraph is open as markdown at a time.
 *     Counting the page's own `.note-live` / `.doc-editor__split` /
 *     `.doc-editor__preview` nodes is what makes "one box" falsifiable: put the
 *     second column back and these counts change.
 *  3. The page lands on the local today, and an empty day opens its writing line
 *     with an invitation in it: blank body, "No note for this day yet", Save
 *     inert, Next day inert (the future is closed) and Prev day live.
 *  4. Live preview. What is typed reaches the file as markdown and the box as
 *     prose, in the same box: the ledger of writes carries `**Live preview**`,
 *     the DOM carries a `<strong>`, and no `*`/`_`/backtick is painted. The
 *     paragraph under the caret is the exception, and it is *its own* markdown —
 *     so opening the second paragraph leaves the first one rendered.
 *  5. That open paragraph sits in the same column the prose it replaced sat in,
 *     so the swap is in place rather than a pane appearing beside it.
 *  6. Save writes exactly one call carrying that day and that body; the editor
 *     then holds the file's own canonical body; the day appears in the journal
 *     strip; Save goes inert again.
 *  7. An existing day loads: Prev day reads that date from the bridge and shows
 *     the seeded body, as prose rather than as an open writing line.
 *  8. A blank save writes nothing at all and says why.
 *  9. A refused write keeps the operator's draft — all of it, both paragraphs —
 *     and says so; the retry then lands. This is the one failure that must never
 *     lose text.
 * 10. A future-dated file is never offered in the strip, and a file that names no
 *     real day is reported as unreadable where it sits rather than as a link.
 * 11. No bridge call this rig does not model, and no console error.
 *
 * NOT covered here: that the note reaches disk as `notes/daily/{date}.md`, that a
 * second write edits one file, and that a review's period pack reads the window
 * back. Those are the vault-core half, in `daily-note-e2e`, which runs the same
 * writes against a real vault on disk.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/daily-note.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** Read the rail and the page straight off the rendered DOM. */
const SAMPLE = `(() => {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || "").trim() : null;
  };
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const topGroup = document.querySelectorAll(".nav-rail__section")[0] ?? null;
  const links = topGroup
    ? Array.from(topGroup.querySelectorAll(".nav-rail__link")).map((el) => ({
        label: (el.textContent || "").trim(),
        href: el.getAttribute("href"),
        icon: Boolean(el.querySelector("svg")),
        active: el.classList.contains("nav-rail__link--active"),
      }))
    : [];
  const box = document.querySelector(".note-live");
  const input = document.querySelector('[data-testid="daily-note-editor-input"]');
  const blocks = box ? Array.from(box.querySelectorAll("[data-note-block]")) : [];
  // What the operator reads as the note: the writing line as the raw markdown it
  // is, every other paragraph as the prose it renders to. An empty paragraph
  // shows its placeholder, which is not part of the note.
  const body = blocks
    .map((el) => {
      const area = el.querySelector("textarea");
      if (area) return area.value;
      if (el.querySelector(".note-live__placeholder")) return "";
      return el.textContent || "";
    })
    .join("\\n\\n")
    .trim();
  const rendered = blocks.filter((el) => !el.querySelector("textarea"));
  const save = document.querySelector('[data-testid="daily-note-save"]');
  const next = document.querySelector('[data-testid="daily-note-next"]');
  const prev = document.querySelector('[data-testid="daily-note-prev"]');
  const rows = Array.from(document.querySelectorAll(".daily-note__history-row")).map((el) => ({
    text: (el.textContent || "").trim(),
    link: Boolean(el.querySelector("button.daily-note__history-day")),
    current: el.querySelector('[aria-current="true"]') !== null,
  }));
  return {
    links,
    heading: text(".daily-note__header h1"),
    day: text('[data-testid="daily-note-day"]'),
    body,
    status: text('[data-testid="daily-note-status"]'),
    saveDisabled: save ? save.disabled : null,
    nextDisabled: next ? next.disabled : null,
    prevDisabled: prev ? prev.disabled : null,
    todayButton: Boolean(document.querySelector('[data-testid="daily-note-today"]')),
    error: text(".form-error"),
    rows,
    // The box: one editor, one writing line, and no second surface anywhere.
    boxes: document.querySelectorAll(".note-live").length,
    splits: document.querySelectorAll(".doc-editor__split").length,
    previews: document.querySelectorAll(".doc-editor__preview").length,
    writingLines: document.querySelectorAll('[data-testid="daily-note-editor-input"]').length,
    blockCount: blocks.length,
    rendering: rendered.length,
    editing: Boolean(input),
    inputValue: input ? input.value : null,
    inputPlaceholder: input ? input.placeholder : null,
    placeholderShown: Boolean(document.querySelector(".note-live__placeholder")),
    strong: text(".note-live .md-view strong"),
    renderedText: box ? (box.textContent || "").trim() : null,
    showsMarkers: box ? /\\*\\*|__|\`/.test(box.textContent || "") : null,
    boxRect: box ? rect(box) : null,
    inputRect: input ? rect(input) : null,
    renderedRect: rendered[0] ? rect(rendered[0]) : null,
  };
})()`;

/** Read the Review page's Daily Note panel off the rendered DOM. */
const PANEL_SAMPLE = `(() => {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || "").trim() : null;
  };
  const rows = Array.from(document.querySelectorAll(".review-notes__item")).map((el) => {
    const button = el.querySelector(".review-notes__day");
    const body = el.querySelector(".review-notes__body");
    return {
      testId: button ? button.getAttribute("data-testid") : null,
      label: button ? (button.querySelector(".review-notes__label")?.textContent || "").trim() : null,
      excerpt: button ? (button.querySelector(".review-notes__excerpt")?.textContent || "").trim() : null,
      expanded: button ? button.getAttribute("aria-expanded") : null,
      body: body ? (body.textContent || "").trim() : null,
    };
  });
  return {
    heading: text(".review-notes__header h2"),
    count: text(".review-notes__header .muted"),
    empty: text(".review-notes .muted"),
    rows,
    noteLinks: Array.from(document.querySelectorAll('.review-notes a[href]')).map((a) => a.getAttribute("href")),
    reviewPeriod: text(".review-page__period"),
    onFire: text(".form-error"),
  };
})()`;

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

function waitFor(win, expression, label, timeoutMs = 10_000) {
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

const INPUT = `[data-testid="daily-note-editor-input"]`;

/**
 * Open a paragraph the way a person does — a click on the prose — and wait for
 * its writing line. The pointer route matters: this is the gesture the page's own
 * mousedown handling exists for, and it must not be skipped for a shortcut.
 */
async function openBlock(win, index) {
  await win.webContents.executeJavaScript(`(() => {
    const block = document.querySelectorAll("[data-note-block]")[${index}];
    if (!block) return false;
    block.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
    );
    return true;
  })()`);
  await waitFor(win, `Boolean(document.querySelector('${INPUT}'))`, `paragraph ${index} to open`);
}

/** Type into the writing line the way a person would, opening it if it is closed. */
async function type(win, value) {
  const open = await win.webContents.executeJavaScript(`Boolean(document.querySelector('${INPUT}'))`);
  if (!open) await openBlock(win, 0);
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`);
}

/** Leave the writing line the way clicking away would: the paragraph renders. */
async function leaveTheLine(win) {
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return;
    el.blur();
    // This window is shown without taking focus, so Chromium suppresses the
    // blur/focusout a real click-away delivers: a bare blur() moves the caret
    // out and fires nothing. The page is wired to the event, not to the move,
    // so the event is what this dispatches — the same one, on the same node.
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  })()`);
  await waitFor(win, `!document.querySelector('${INPUT}')`, "the writing line to close");
}

/** Press a key in the writing line the way a person would. */
function press(win, key) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }),
    );
    return true;
  })()`);
}

function click(win, testId) {
  return win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) return false; el.click(); return true; })()`,
  );
}

function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

async function main() {
  const sessionPartition = `daily-note-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionPartition,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.dailyNoteReady)", "dailyNoteReady");

  const today = await win.webContents.executeJavaScript("window.dailyNoteToday");
  const yesterday = await win.webContents.executeJavaScript(
    "window.dailyNoteYesterday",
  );
  const checks = { today, yesterday };

  // A harness that never applied the skin would draw a palette the operator does
  // not run, and every layout claim below would be about the wrong theme.
  checks.skin = await win.webContents.executeJavaScript(
    "({ name: window.dailyNoteSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
  }

  // ── 1. the rail: Daily Note, directly under Decisions ─────────────────────
  const landing = await sample(win);
  checks.rail = landing.links;
  const labels = landing.links.map((entry) => entry.label);
  if (labels[labels.length - 1] !== "Daily Note") {
    failure(`the top group does not end with Daily Note: ${JSON.stringify(labels)}`);
  }
  if (labels[labels.length - 2] !== "Decisions") {
    failure(`Daily Note is not directly under Decisions: ${JSON.stringify(labels)}`);
  }
  const noteLink = landing.links.find((entry) => entry.label === "Daily Note");
  if (!noteLink) {
    failure("the rail carries no Daily Note entry at all");
  } else {
    // The href is read as the route it names: this rig mounts MemoryRouter, so
    // the studio's HashRouter `#/notes` appears here as `/notes`.
    if (!(noteLink.href ?? "").endsWith("/notes")) {
      failure(`the rail entry points at ${JSON.stringify(noteLink.href)}, expected the notes route`);
    }
    if (!noteLink.icon) failure("the rail entry drew no icon");
    if (!noteLink.active) failure("the rail did not mark Daily Note active on its own route");
  }
  const decisionsLink = landing.links.find((entry) => entry.label === "Decisions");
  if (decisionsLink && !decisionsLink.icon) failure("the Decisions entry lost its icon");

  // ── 2. the page lands on today, in ONE box, empty ────────────────────────
  checks.landing = landing;
  if (landing.heading !== "Daily Note") {
    failure(`the page heading read ${JSON.stringify(landing.heading)}`);
  }
  if (!/^Today · \w+day, \d{1,2} \w{3} \d{4}$/.test(landing.day ?? "")) {
    failure(`the day label read ${JSON.stringify(landing.day)}`);
  }
  if (landing.body !== "") {
    failure(`today's editor did not open empty: ${JSON.stringify(landing.body)}`);
  }
  if (landing.status !== "No note for this day yet") {
    failure(`an empty day reported ${JSON.stringify(landing.status)}`);
  }
  if (landing.saveDisabled !== true) {
    failure("Save was live on a day with nothing to save");
  }
  if (landing.nextDisabled !== true) {
    failure("Next day was live on today — the future is reachable");
  }
  if (landing.prevDisabled !== false) {
    failure("Prev day was inert on today, so no past day can be opened");
  }
  if (landing.todayButton) {
    failure("the Today control was offered while already on today");
  }
  if (landing.error) failure(`an error was on screen at landing: ${JSON.stringify(landing.error)}`);

  // One box: exactly one editor, no split grid, no second pane, one writing
  // line. The operator writes on one surface or the page is wrong.
  checks.box = {
    boxes: landing.boxes,
    splits: landing.splits,
    previews: landing.previews,
    writingLines: landing.writingLines,
  };
  if (landing.boxes !== 1) {
    failure(`the page drew ${landing.boxes} editor boxes, expected exactly 1`);
  }
  if (landing.splits !== 0) {
    failure("the split editor grid is still on the page");
  }
  if (landing.previews !== 0) {
    failure("a preview pane is still on the page; the note should render in place");
  }
  if (landing.writingLines > 1) {
    failure(`the box opened ${landing.writingLines} writing lines at once`);
  }
  // An empty page is an invitation: the line is open and it says what to do.
  if (landing.editing !== true) {
    failure("an empty day did not open its writing line");
  }
  if (landing.inputValue !== "") {
    failure(`the empty day's writing line held ${JSON.stringify(landing.inputValue)}`);
  }
  if (!landing.inputPlaceholder) {
    failure("the empty day's writing line carried no invitation to write");
  }

  // ── 3. type, leave the line, and the box renders what was written ────────
  const typed =
    "Rig day: wrote the note, and the review read it back.\n\n**Live preview**: the box renders as it is written.";
  const firstParagraph = "Rig day: wrote the note, and the review read it back.";
  const secondParagraph = "Live preview: the box renders as it is written.";
  const secondSource = "**Live preview**: the box renders as it is written.";
  await type(win, typed);
  const dirty = await sample(win);
  checks.afterTyping = dirty;
  if (dirty.status !== "Unsaved changes") {
    failure(`typing did not mark the day dirty: ${JSON.stringify(dirty.status)}`);
  }
  if (dirty.saveDisabled !== false) failure("Save stayed inert after typing");
  if (dirty.inputValue !== typed) {
    failure(
      `the writing line does not hold the note's own markdown: ${JSON.stringify(dirty.inputValue)}`,
    );
  }
  if (dirty.boxes !== 1 || dirty.rendering !== 0) {
    failure(
      `a newly written note is not one open line: boxes ${dirty.boxes}, rendered ${dirty.rendering}`,
    );
  }

  await leaveTheLine(win);
  const written = await sample(win);
  checks.afterWriting = written;
  // Live preview, in the same box: the markdown became prose. Two paragraphs on
  // the page, a real <strong> where the asterisks were, and no marker left over.
  if (written.blockCount !== 2) {
    failure(`the note settled into ${written.blockCount} paragraph(s), expected 2`);
  }
  if (written.editing) failure("the writing line stayed open after the operator left it");
  if (written.strong !== "Live preview") {
    failure(`the box did not render the bold span: ${JSON.stringify(written.strong)}`);
  }
  if (written.showsMarkers) {
    failure("raw markdown markers are painted in the box");
  }
  if (!(written.renderedText ?? "").includes(secondParagraph)) {
    failure(`the rendered paragraph read ${JSON.stringify(written.renderedText)}`);
  }

  await click(win, "daily-note-save");
  await waitFor(
    win,
    "(window.dailyNoteWrites ?? []).length > 0",
    "the first save to reach the bridge",
  );
  const writes = await win.webContents.executeJavaScript("window.dailyNoteWrites");
  // The first save's own ledger, read now; `checks.writes` is re-read at the end
  // so it carries every write the run made rather than this early snapshot.
  checks.firstWrite = writes;
  if (writes.length !== 1) failure(`the first save wrote ${writes.length} times, expected 1`);
  if (writes[0]?.date !== today) {
    failure(`the save wrote ${JSON.stringify(writes[0]?.date)} instead of today (${today})`);
  }
  // The file gets the markdown, the box got the prose: one note, two readings,
  // and neither is a copy of the other.
  if ((writes[0]?.body ?? "").trimEnd() !== typed) {
    failure(`the save carried the wrong body: ${JSON.stringify(writes[0]?.body)}`);
  }

  await waitFor(
    win,
    `document.querySelector('[data-testid="daily-note-status"]').textContent.startsWith("Saved")`,
    "the page to report the save",
  );
  const saved = await sample(win);
  checks.afterSave = saved;
  if (!(saved.body ?? "").includes(firstParagraph)) {
    failure(`the editor lost the note after saving: ${JSON.stringify(saved.body)}`);
  }
  if (!(saved.body ?? "").includes(secondParagraph)) {
    failure(`the editor lost a paragraph after saving: ${JSON.stringify(saved.body)}`);
  }
  if (saved.saveDisabled !== true) failure("Save stayed live after a clean save");
  if (!/^Saved \d{1,2} \w{3} \d{4}\.$/.test(saved.status ?? "")) {
    failure(`the saved day reported ${JSON.stringify(saved.status)}`);
  }
  if (!saved.rows.some((row) => row.text.startsWith("Today"))) {
    failure(`the journal strip does not list the day just written: ${JSON.stringify(saved.rows)}`);
  }

  // ── 3b. opening one paragraph leaves the rest prose ─────────────────────
  // The heart of one box with live preview: the line under the caret shows its
  // own markdown, and only that line.
  await openBlock(win, 1);
  const opened = await sample(win);
  checks.openedParagraph = opened;
  if (opened.inputValue !== secondSource) {
    failure(
      `the opened paragraph is not its own markdown: ${JSON.stringify(opened.inputValue)}`,
    );
  }
  if (opened.writingLines !== 1) {
    failure(`opening a paragraph opened ${opened.writingLines} writing lines`);
  }
  if (opened.rendering !== 1) {
    failure(`opening one paragraph left ${opened.rendering} rendered, expected 1`);
  }
  if (!(opened.renderedText ?? "").includes(firstParagraph)) {
    failure("the paragraph above went raw along with the one under the caret");
  }
  // In place, not beside: the writing line occupies the column the prose held.
  if (!opened.inputRect || !opened.renderedRect) {
    failure("the box did not report both a writing line and a rendered paragraph");
  } else {
    if (opened.inputRect.left !== opened.renderedRect.left) {
      failure(
        `the writing line sits at x=${opened.inputRect.left} and the prose at x=${opened.renderedRect.left}: two columns`,
      );
    }
    if (opened.inputRect.left < (opened.boxRect?.left ?? 0)) {
      failure("the writing line escaped the box it belongs to");
    }
  }
  // The swap caught on camera: the second paragraph is its own markdown while the
  // first is still prose, in the one box.
  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const editingShot = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "daily-note-editing.png"), editingShot.toPNG());
  await leaveTheLine(win);

  // ── 3c. Enter starts the next paragraph, in the same box ────────────────
  // The structural half of writing: a paragraph break is a new block, so the
  // file gets the blank line markdown needs without the operator typing one.
  const writesBeforeEnter = (await win.webContents.executeJavaScript("window.dailyNoteWrites")).length;
  await openBlock(win, 1);
  await press(win, "Enter");
  const afterEnter = await sample(win);
  checks.afterEnter = afterEnter;
  if (afterEnter.blockCount !== 3) {
    failure(`Enter made ${afterEnter.blockCount} blocks, expected 3`);
  }
  if (afterEnter.inputValue !== "") {
    failure(`Enter did not open an empty paragraph: ${JSON.stringify(afterEnter.inputValue)}`);
  }
  const third = "A third paragraph, written after Enter.";
  await type(win, third);
  await leaveTheLine(win);
  const threeUp = await sample(win);
  checks.afterThirdParagraph = threeUp;
  if (threeUp.blockCount !== 3 || threeUp.rendering !== 3) {
    failure(
      `the note did not settle into three rendered paragraphs: ${threeUp.blockCount} block(s), ${threeUp.rendering} rendered`,
    );
  }
  if (!(threeUp.renderedText ?? "").includes(third)) {
    failure(`the third paragraph did not render: ${JSON.stringify(threeUp.renderedText)}`);
  }
  const writesAfterEnter = (await win.webContents.executeJavaScript("window.dailyNoteWrites")).length;
  if (writesAfterEnter !== writesBeforeEnter) {
    failure("writing a paragraph wrote to the vault without the operator saving");
  }

  // ── 4. an existing day loads, as prose ──────────────────────────────────
  await click(win, "daily-note-prev");
  await waitFor(
    win,
    `(document.querySelector('[data-testid="daily-note-editor"]')?.textContent ?? "").includes("Yesterday: a walk")`,
    "yesterday's note to load",
  );
  const previous = await sample(win);
  checks.previousDay = previous;
  if (previous.body !== "Yesterday: a walk, then the rig.") {
    failure(`yesterday's note did not load: ${JSON.stringify(previous.body)}`);
  }
  if (previous.status !== "Saved") {
    failure(`a day with a saved note reported ${JSON.stringify(previous.status)}`);
  }
  if (previous.saveDisabled !== true) failure("Save was live on a day with no changes");
  if (previous.nextDisabled !== false) {
    failure("Next day was inert on a past day, so today cannot be reached forward");
  }
  if (previous.editing) {
    failure("a day with a note opened its writing line instead of reading as prose");
  }

  // ── 5. an empty day cannot be made to hold an empty note ────────────────
  // Save is inert on a day with nothing typed, and typing then clearing returns
  // the day to exactly that state — so there is no route from the page to an
  // empty note on a day the operator never opened.
  await click(win, "daily-note-prev");
  await waitFor(
    win,
    `Boolean(document.querySelector(".note-live__placeholder"))`,
    "an empty day two days back",
  );
  const emptyDay = await sample(win);
  if (emptyDay.body !== "") failure(`an empty day read ${JSON.stringify(emptyDay.body)}`);
  if (emptyDay.editing) failure("an empty day opened its writing line before it was clicked");
  if (emptyDay.placeholderShown !== true) {
    failure("an empty day offered no invitation to write");
  }
  const writesBeforeBlank = (await win.webContents.executeJavaScript("window.dailyNoteWrites")).length;
  await type(win, "typo");
  await type(win, "");
  const clearedBack = await sample(win);
  checks.emptyDay = clearedBack;
  if (clearedBack.saveDisabled !== true) {
    failure("Save was live on an empty day with nothing typed");
  }
  await click(win, "daily-note-save");
  const writesAfterBlank = (await win.webContents.executeJavaScript("window.dailyNoteWrites")).length;
  if (writesAfterBlank !== writesBeforeBlank) {
    failure("an empty day wrote a note without the operator typing anything");
  }

  // ── 5b. clearing a day's prose is refused, and the refusal keeps the draft ─
  // The vault's rule, seen from the page: a note must have something in it. The
  // day keeps its prose on disk, and the operator is told why in words.
  await click(win, "daily-note-today");
  await waitFor(
    win,
    `document.querySelector('[data-testid="daily-note-day"]').textContent.startsWith("Today")`,
    "the Today control to return to today",
  );
  await click(win, "daily-note-prev");
  await waitFor(
    win,
    `(document.querySelector('[data-testid="daily-note-editor"]')?.textContent ?? "").includes("Yesterday: a walk")`,
    "yesterday's note to load again",
  );
  await type(win, "");
  await leaveTheLine(win);
  await click(win, "daily-note-save");
  await waitFor(
    win,
    `(window.dailyNoteWrites ?? []).length > ${writesAfterBlank}`,
    "the clear attempt to reach the bridge",
  );
  await waitFor(
    win,
    "Boolean(document.querySelector('.form-error'))",
    "the refusal to be shown",
  );
  const cleared = await sample(win);
  checks.clearRefused = cleared;
  if (!(cleared.error ?? "").includes("needs something written")) {
    failure(`clearing a note was refused without the reason: ${JSON.stringify(cleared.error)}`);
  }
  if (cleared.body !== "") {
    failure(`the cleared draft was not kept as the operator left it: ${JSON.stringify(cleared.body)}`);
  }
  const stillThere = await win.webContents.executeJavaScript(
    `(window.dailyNoteJournal.get(${JSON.stringify(yesterday)}) ?? {}).bodyMarkdown ?? null`,
  );
  checks.afterClearAttempt = stillThere;
  if (!(stillThere ?? "").includes("Yesterday: a walk")) {
    failure("a refused clear emptied the day on disk anyway");
  }
  // Put the day back as it was, so the rest of the run reads a written day.
  await win.webContents.executeJavaScript(
    `window.dailyNoteSeed(${JSON.stringify(yesterday)}, "Yesterday: a walk, then the rig.")`,
  );

  // ── 6. the future is closed, and unreadable days are not links ───────────
  // The wait is on the note, not on the day label: the label flips the moment the
  // date changes, so waiting on it would sample the box before the read landed.
  await click(win, "daily-note-today");
  await waitFor(
    win,
    `(document.querySelector('[data-testid="daily-note-editor"]')?.textContent ?? "").includes("Rig day: wrote the note")`,
    "today's note to come back",
  );
  const back = await sample(win);
  checks.backToToday = back;
  if (!(back.day ?? "").startsWith("Today")) {
    failure(`returning to today landed on ${JSON.stringify(back.day)}`);
  }
  if (back.nextDisabled !== true) failure("Next day was live again on today");
  if (!(back.body ?? "").includes(firstParagraph)) {
    failure(`returning to today lost the note: ${JSON.stringify(back.body)}`);
  }
  if (!(back.body ?? "").includes(secondParagraph)) {
    failure(`returning to today lost a paragraph: ${JSON.stringify(back.body)}`);
  }
  const futureRow = back.rows.find((row) => row.text.includes("Tomorrow"));
  if (futureRow) {
    failure(`a future-dated note was offered in the strip: ${JSON.stringify(futureRow)}`);
  }
  const unreadable = back.rows.find((row) => row.text.includes("unreadable"));
  checks.unreadableRow = unreadable ?? null;
  if (!unreadable) {
    failure("the file that names no real day was not reported as unreadable");
  } else if (unreadable.link) {
    failure("the unreadable day was offered as a link");
  }

  // ── 7. a refused write keeps the draft ───────────────────────────────────
  // The operator opens today's first paragraph and replaces it. The rest of the
  // note must survive the refusal too: "keeps the draft" means all of it.
  const refused = "Rig day: the vault refused this once.";
  const beforeRefusal = (await win.webContents.executeJavaScript("window.dailyNoteWrites")).length;
  await type(win, refused);
  await win.webContents.executeJavaScript("window.dailyNoteFailWrite = true");
  await click(win, "daily-note-save");
  await waitFor(
    win,
    `(window.dailyNoteWrites ?? []).length > ${beforeRefusal}`,
    "the refused write to reach the bridge",
  );
  await waitFor(
    win,
    "Boolean(document.querySelector('.form-error'))",
    "the refusal to be shown",
  );
  const refusedSample = await sample(win);
  checks.refusedWrite = refusedSample;
  if (!(refusedSample.error ?? "").includes("refused")) {
    failure(`the refusal was not reported in words: ${JSON.stringify(refusedSample.error)}`);
  }
  if (!(refusedSample.body ?? "").startsWith(refused)) {
    failure(`a refused write lost the operator's text: ${JSON.stringify(refusedSample.body)}`);
  }
  if (!(refusedSample.body ?? "").includes(secondParagraph)) {
    failure(`a refused write lost the rest of the note: ${JSON.stringify(refusedSample.body)}`);
  }

  const beforeRetry = (await win.webContents.executeJavaScript("window.dailyNoteWrites")).length;
  await win.webContents.executeJavaScript("window.dailyNoteFailWrite = false");
  await click(win, "daily-note-save");
  await waitFor(
    win,
    `(window.dailyNoteWrites ?? []).length > ${beforeRetry}`,
    "the retry to land",
  );
  const retried = await sample(win);
  checks.afterRetry = retried;
  if (!(retried.body ?? "").startsWith(refused)) {
    failure(`the retry did not keep the operator's text: ${JSON.stringify(retried.body)}`);
  }
  if (retried.error) failure(`the refusal stayed on screen after a successful save`);

  // ── 8. the Review page shows the days the period covers ──────────────────
  // The same journal, read through the window the review's period names: the
  // operator sees the days the companion's period pack was given, and only those.
  await win.webContents.executeJavaScript(`window.dailyNoteGoto("/review/weekly")`);
  await waitFor(
    win,
    `Boolean(document.querySelector(".review-notes__header"))`,
    "the review panel to render",
  );
  await waitFor(
    win,
    `(() => { const el = document.querySelector(".review-notes .muted"); return !el || !el.textContent.includes("Reading"); })()`,
    "the panel's window read to settle",
  );
  const panel = await win.webContents.executeJavaScript(PANEL_SAMPLE);
  checks.panel = panel;
  const windowCall = await win.webContents.executeJavaScript(
    "window.dailyNoteWindowCalls[window.dailyNoteWindowCalls.length - 1]",
  );
  checks.panelWindow = windowCall;
  // What the panel must show, computed from the journal and the window the page
  // itself asked for: the set is a fact about the run's own day, not a constant.
  const journalDates = await win.webContents.executeJavaScript(
    "[...window.dailyNoteJournal.keys()]",
  );
  const expectedDays = journalDates
    .filter((date) => date >= windowCall.start && date <= windowCall.end)
    .filter((date) => date <= today)
    .sort()
    .reverse();
  checks.panelExpectedDays = expectedDays;
  if (panel.heading !== "Daily notes in this period") {
    failure(`the panel heading read ${JSON.stringify(panel.heading)}`);
  }
  if (panel.rows.length !== expectedDays.length) {
    failure(
      `the panel listed ${panel.rows.length} day(s), expected ${expectedDays.length} (${JSON.stringify(expectedDays)})`,
    );
  }
  if (
    JSON.stringify(panel.rows.map((row) => row.testId)) !==
    JSON.stringify(expectedDays.map((date) => `review-note-${date}`))
  ) {
    failure(
      `the panel's days are not the period's, newest first: ${JSON.stringify(panel.rows.map((r) => r.testId))}`,
    );
  }
  if (panel.rows.some((row) => row.body !== null)) {
    failure("a collapsed day had already rendered its body");
  }
  if (panel.rows.some((row) => !row.excerpt)) {
    failure("a collapsed day showed no excerpt");
  }
  if (String(panel.count) !== String(expectedDays.length)) {
    failure(`the panel's count read ${JSON.stringify(panel.count)}`);
  }
  if (panel.onFire !== null) {
    failure(`the review panel reported an error: ${JSON.stringify(panel.onFire)}`);
  }

  // Opening a day renders that day's markdown and nothing else's. The expected
  // text is the journal's own body for that date, read from the harness, so the
  // claim is about the note the page was given rather than a string in the rig.
  const firstDay = expectedDays[0];
  const firstBody = await win.webContents.executeJavaScript(
    `(window.dailyNoteJournal.get(${JSON.stringify(firstDay)}) ?? {}).bodyMarkdown ?? ""`,
  );
  const firstLine = String(firstBody).split("\n").find((line) => line.trim() !== "") ?? "";
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="review-note-${firstDay}"]').click()`,
  );
  await waitFor(
    win,
    `document.querySelector('[data-testid="review-note-${firstDay}"]').getAttribute("aria-expanded") === "true"`,
    "the day to open",
  );
  const openedPanel = await win.webContents.executeJavaScript(PANEL_SAMPLE);
  checks.panelOpened = openedPanel;
  const openedRow = openedPanel.rows.find((row) => row.testId === `review-note-${firstDay}`);
  const stillClosed = openedPanel.rows.filter((row) => row.testId !== `review-note-${firstDay}`);
  if (!(openedRow?.body ?? "").includes(firstLine.replace(/^#\s*/, ""))) {
    failure(
      `an opened day did not render its note: ${JSON.stringify(openedRow?.body)} for ${JSON.stringify(firstLine)}`,
    );
  }
  if (stillClosed.some((row) => row.body !== null)) {
    failure("opening one day rendered another day's body");
  }

  // The panel's own artifact: one day open, the rest one line each. Written here
  // rather than at the end so it shows the state this rig just proved.
  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const panelShot = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "daily-note-panel.png"), panelShot.toPNG());

  // ── 8b. a period with no notes says so, and offers the way in ────────────
  await win.webContents.executeJavaScript("window.dailyNoteEmptyWindow = true");
  await win.webContents.executeJavaScript(`window.dailyNoteGoto("/review/monthly")`);
  await waitFor(
    win,
    `(() => { const el = document.querySelector(".review-notes"); return el && /No daily notes in this period/.test(el.textContent); })()`,
    "the empty period to be reported",
  );
  const empty = await win.webContents.executeJavaScript(PANEL_SAMPLE);
  checks.panelEmpty = empty;
  if (empty.rows.length !== 0) failure("an empty period listed days");
  if (!empty.noteLinks.some((href) => (href ?? "").endsWith("/notes"))) {
    failure(`the empty panel offered no way to the day's page: ${JSON.stringify(empty.noteLinks)}`);
  }
  await win.webContents.executeJavaScript("window.dailyNoteEmptyWindow = false");

  // Back to the day's own page: the screenshot is the surface the feature exists
  // for, and the panel's claim is already in the report.
  await win.webContents.executeJavaScript(`window.dailyNoteGoto("/notes")`);
  await waitFor(
    win,
    `Boolean(document.querySelector(".note-live"))`,
    "the day's page to come back",
  );

  // ── 9. nothing unexpected, nothing on fire ───────────────────────────────
  // The full ledger of writes this run made, read after the last one.
  checks.writes = await win.webContents.executeJavaScript("window.dailyNoteWrites");
  // What the journal holds at the end, keyed by day: the writes above say what
  // the page asked for, this says what the vault kept.
  checks.journal = await win.webContents.executeJavaScript(
    "Object.fromEntries([...window.dailyNoteJournal].map(([date, note]) => [date, note.bodyMarkdown]))",
  );
  const unexpected = await win.webContents.executeJavaScript("window.dailyNoteUnexpectedCalls");
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  checks.calls = await win.webContents.executeJavaScript("window.dailyNoteCalls");
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  // The screenshot is today's page holding a written note — the state the
  // feature exists for.
  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "daily-note.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "daily-note.png"), image.toPNG());

  console.log(`rail:      ${JSON.stringify(labels)}`);
  console.log(
    `box:       ${landing.boxes} editor, ${landing.splits} split, ${landing.previews} preview pane`,
  );
  console.log(`landing:   ${JSON.stringify(landing.day)} — ${JSON.stringify(landing.status)}`);
  console.log(`written:   ${written.blockCount} paragraph(s), <strong> ${JSON.stringify(written.strong)}`);
  console.log(`saved:     ${JSON.stringify(saved.status)} in ${writes.length} write(s)`);
  console.log(`opened:    ${JSON.stringify(opened.inputValue)}`);
  console.log(`clear:     ${JSON.stringify(cleared.error)}`);
  console.log(`refused:   ${JSON.stringify(refusedSample.error)}`);
  console.log(`panel:     ${JSON.stringify(windowCall)} → ${JSON.stringify(panel.rows.map((r) => r.testId))}`);
  console.log(`panel 0:   ${JSON.stringify(empty.empty)}`);
  console.log(`failures:  ${errors.length === 0 ? "none" : errors.join("; ")}`);

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
  console.error("daily-note rig timed out");
  app.exit(1);
}, 90_000);
