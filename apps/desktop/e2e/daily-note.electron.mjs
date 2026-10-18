/**
 * Drives the daily-note harness in a real Electron window and turns what the rail
 * and the page actually render into `e2e/artifacts/daily-note.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/daily-note.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same claims, no eyeballing the app required. It ships with four
 * pictures of the same run: the day's page holding a written note
 * (`daily-note.png`), the box with one paragraph open as its own markdown
 * (`daily-note-editing.png`), the writing line a save landed in without touching
 * it (`daily-note-midsentence.png`), and the Review panel (`daily-note-panel.png`).
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
 *  3. There is no save control, and nothing is written by landing on a day: the
 *     page draws no `[data-testid="daily-note-save"]` and the bridge's write
 *     ledger is empty after the first paint. Counting the control and the ledger
 *     is what makes "the day saves itself" falsifiable.
 *  4. The page lands on the local today, and an empty day opens its writing line
 *     with an invitation in it: blank body, "No note for this day yet", Next day
 *     inert (the future is closed) and Prev day live.
 *  5. The day's chrome is the page's own, not the engine's: the earlier-notes
 *     rows paint no fill at rest, carry no bullets, and every button on the page
 *     wears the design's `--radius-xs` step rather than a pill. Reading the
 *     *computed* radius and background of those nodes is what makes it
 *     falsifiable — the platform's default button fill is what the operator saw
 *     before this rule existed.
 *  6. Autosave. What is typed reaches the vault with no control pressed, inside
 *     the bridge's own ledger: one write, carrying that day and that body, made
 *     while the page was showing that day. Typing more writes again, and an idle
 *     page writes nothing at all — a write storm is the failure mode of an
 *     autosave, so the ledger is read twice with nothing in between.
 *  7. Live preview. What is typed reaches the file as markdown and the box as
 *     prose, in the same box: the ledger of writes carries `**Live preview**`,
 *     the DOM carries a `<strong>`, and no `*`/`_`/backtick is painted. The
 *     paragraph under the caret is the exception, and it is *its own* markdown —
 *     so opening the second paragraph leaves the first one rendered.
 *  8. That open paragraph sits in the same column the prose it replaced sat in,
 *     so the swap is in place rather than a pane appearing beside it.
 *  9. The write settles: the editor then holds the file's own canonical body, the
 *     status reads "Saved", and the day appears in the journal strip.
 * 10. A save that lands mid-sentence does not disturb the writing line. The
 *     operator paused, so the day was written under their hands: the line is
 *     still the line — open, holding the keystroke they left in it, caret and
 *     all — while the file holds the vault's own trimmed body and the page
 *     writes nothing more until they type again.
 * 11. An existing day loads: Prev day reads that date from the bridge and shows
 *     the seeded body, as prose rather than as an open writing line.
 * 12. A draft typed and cleared before the page writes leaves the day exactly as
 *     it was: no write at all reaches the bridge.
 * 13. Clearing a day that has a note is refused by the vault with a reason, the
 *     operator's draft is kept and the file is untouched — and the refusal is an
 *     *answer*, not a loss, so it does not hold the operator on the day.
 * 14. A write that *fails* is the other thing entirely. Nobody knows what reached
 *     the disk, so the page keeps the operator on the day they were writing until
 *     it lands, and Ctrl+S is the write that releases them.
 * 15. A refused write keeps the operator's draft — all of it — and says so; the
 *     page then stops asking the vault by itself, and Ctrl+S is what retries it.
 * 16. A future-dated file is never offered in the strip, and a file that names no
 *     real day is reported as unreadable where it sits rather than as a link.
 * 17. No bridge call this rig does not model, and no console error.
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
  const px = (value) => Number.parseFloat(value) || 0;
  const corners = (el) => {
    const style = getComputedStyle(el);
    return {
      radius: px(style.borderTopLeftRadius),
      height: Math.round(el.getBoundingClientRect().height),
      background: style.backgroundColor,
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
  const day = document.querySelector('[data-testid="daily-note-day"]');
  const next = document.querySelector('[data-testid="daily-note-next"]');
  const prev = document.querySelector('[data-testid="daily-note-prev"]');
  const status = document.querySelector('[data-testid="daily-note-status"]');
  const historyList = document.querySelector(".daily-note__history-list");
  const historyHeading = document.querySelector(".daily-note__history h2");
  const historyDay = document.querySelector(".daily-note__history-day");
  const cell = (el, sel) => {
    const found = el.querySelector(sel);
    return found ? (found.textContent || "").trim() : null;
  };
  const rows = Array.from(document.querySelectorAll(".daily-note__history-row")).map((el) => {
    const cells = [
      cell(el, ".daily-note__history-date"),
      cell(el, ".daily-note__history-weekday"),
      cell(el, ".daily-note__history-edited"),
    ];
    return {
      // The row as the operator reads it, with the three columns kept apart so a
      // claim can name the one it is about.
      text: cells.filter((value) => value !== null).join(" · "),
      date: cells[0],
      weekday: cells[1],
      edited: cells[2],
      // The day the row stands for, as its file names it.
      isoDate: el.getAttribute("data-date"),
      link: Boolean(el.querySelector("button.daily-note__history-day")),
      current: el.querySelector('[aria-current="true"]') !== null,
    };
  });
  return {
    links,
    heading: text(".daily-note__header h1"),
    day: text('[data-testid="daily-note-day"]'),
    dayDate: day ? day.getAttribute("data-date") : null,
    body,
    status: status ? (status.textContent || "").trim() : null,
    // The page's chrome, as the engine resolves it: corner radius, fill at rest,
    // list markers, the strip's own columns and the size of the heading over them.
    // A pill, the platform's button fill, a bullet or a heading that never grew
    // all show up here and nowhere else.
    chrome: {
      saveControls: document.querySelectorAll('[data-testid="daily-note-save"]').length,
      statusLine: Boolean(status),
      step: px(
        getComputedStyle(document.documentElement).getPropertyValue("--radius-xs"),
      ),
      pager: Array.from(document.querySelectorAll(".daily-note__pager .btn")).map(corners),
      history: Array.from(document.querySelectorAll(".daily-note__history-day")).map(corners),
      historyListStyle: historyList ? getComputedStyle(historyList).listStyleType : null,
      historyHead: Array.from(
        document.querySelectorAll(".daily-note__history-head > *"),
      ).map((el) => (el.textContent || "").trim()),
      historyHeadingSize: historyHeading
        ? px(getComputedStyle(historyHeading).fontSize)
        : null,
      historyRowSize: historyDay ? px(getComputedStyle(historyDay).fontSize) : null,
    },
    // The bridge's own ledger, read as a count so a step can prove the page wrote
    // nothing while it sat still.
    writes: (window.dailyNoteWrites ?? []).length,
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
    // Where the caret is, which is the whole of what a save must not take. An
    // unfocused window still sets document.activeElement on a focused node, so
    // this is a real reading rather than a proxy for one.
    caretInBox: input ? document.activeElement === input : false,
    // An empty paragraph prints the page's placeholder, or nothing at all.
    placeholders: document.querySelectorAll(".note-live__placeholder").length,
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

/** Let the page sit still, so "nothing happened" is a claim about real time. */
function idle(win, ms) {
  return win.webContents.executeJavaScript(
    `new Promise((resolve) => setTimeout(resolve, ${ms}))`,
  );
}

const INPUT = `[data-testid="daily-note-editor-input"]`;
/** The page's autosave waits this long after the last keystroke; a rig that
 *  waits less than this would read a write as missing rather than as pending. */
const AUTOSAVE_SETTLE_MS = 2_000;

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

/**
 * Type into the writing line with the caret in it, the way a person does when
 * they pause mid-sentence: `type` above writes the value without ever focusing
 * the box, which is right for the claims about what the vault receives and wrong
 * for this one — a save can only take a caret that is there to take.
 */
async function typeWithCaret(win, value) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return null;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { value: el.value, focused: document.activeElement === el };
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

/** Press a page shortcut, which the page listens for on the window. */
function pressShortcut(win, key) {
  return win.webContents.executeJavaScript(`(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ${JSON.stringify(key)},
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
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

function writesOf(win) {
  return win.webContents.executeJavaScript("window.dailyNoteWrites");
}

/** The page's autosave is a timer: wait for the write it owes, not for a button. */
async function waitForWrite(win, count, label) {
  await waitFor(
    win,
    `(window.dailyNoteWrites ?? []).length > ${count}`,
    label,
    AUTOSAVE_SETTLE_MS + 8_000,
  );
  return writesOf(win);
}

/**
 * The chrome claim, in one place because three steps read it. Every button the
 * page draws wears the design's small radius step rather than the primitive's
 * pill, the earlier-notes rows paint no fill of their own, and the list carries
 * no markers — a row that is a platform button shows all three at once.
 */
function assertChrome(chrome, when) {
  if (chrome.saveControls !== 0) {
    failure(`${when}: the page draws ${chrome.saveControls} save control(s)`);
  }
  if (!chrome.statusLine) failure(`${when}: the page draws no autosave status line`);
  if (!chrome.step) {
    failure(`${when}: the design's --radius-xs step could not be read`);
    return;
  }
  const buttons = [...chrome.pager, ...chrome.history];
  if (buttons.length === 0) failure(`${when}: the page drew no buttons to measure`);
  for (const button of buttons) {
    if (button.radius > chrome.step) {
      failure(
        `${when}: a button on the page is rounded to ${button.radius}px, past the ${chrome.step}px step — a pill`,
      );
    }
  }
  if (chrome.historyListStyle !== "none") {
    failure(`${when}: the earlier-notes list carries markers (${chrome.historyListStyle})`);
  }
  for (const row of chrome.history) {
    if (row.background !== "rgba(0, 0, 0, 0)") {
      failure(`${when}: an earlier-notes row paints ${row.background} at rest`);
    }
  }
}

/** The seven weekday names the page may print in its Day column. */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * The strip's own table, read as one claim about every row in it.
 *
 * Three columns on every row; no day that has not happened; and — the part worth
 * having — each readable row's Day column recomputed from that row's own date
 * rather than trusted, so a weekday drawn from the wrong day, or from the day the
 * page is showing instead of the day the row is about, shows up here.
 */
function assertRows(rows, today, when) {
  if (rows.length === 0) return failure(`${when}: the strip listed no day at all`);
  for (const row of rows) {
    if (!row.isoDate) {
      failure(`${when}: a row names no day: ${JSON.stringify(row.text)}`);
      continue;
    }
    if (row.isoDate > today) {
      failure(`${when}: a note for ${row.isoDate} was offered, and that day has not happened`);
    }
    if (!row.date) failure(`${when}: the row for ${row.isoDate} has no date cell`);
    if (!row.weekday) failure(`${when}: the row for ${row.isoDate} has no day cell`);
    if (!row.edited) failure(`${when}: the row for ${row.isoDate} has no last-edited cell`);
    if (!row.link) {
      // A file that names no usable day: reported where it sits, and not as a day.
      if (row.weekday !== "—") {
        failure(
          `${when}: the unreadable row claims ${JSON.stringify(row.weekday)} as its weekday`,
        );
      }
      continue;
    }
    const expected = WEEKDAYS[new Date(`${row.isoDate}T00:00:00`).getDay()];
    if (row.weekday !== expected) {
      failure(
        `${when}: ${row.isoDate} is a ${expected} and the row's Day column reads ${JSON.stringify(row.weekday)}`,
      );
    }
  }
  return undefined;
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
  const twoBack = await win.webContents.executeJavaScript("window.dailyNoteTwoBack");
  const tomorrow = await win.webContents.executeJavaScript("window.dailyNoteTomorrow");
  const farDay = await win.webContents.executeJavaScript("window.dailyNoteFarDay");
  // The far day is seeded with a stamp from another year, so the strip's third
  // column can be read back against the journal without parsing a locale's date.
  const farDayYear = await win.webContents.executeJavaScript("window.dailyNoteFarDayYear");
  const checks = { today, yesterday, twoBack, tomorrow, farDay, farDayYear };

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

  // ── 2. the page lands on today, in ONE box, empty, and writes nothing ────
  checks.landing = landing;
  if (landing.heading !== "Daily Note") {
    failure(`the page heading read ${JSON.stringify(landing.heading)}`);
  }
  if (!/^Today · \w+day, \d{1,2} \w{3} \d{4}$/.test(landing.day ?? "")) {
    failure(`the day label read ${JSON.stringify(landing.day)}`);
  }
  if (landing.dayDate !== today) {
    failure(`the page landed on ${JSON.stringify(landing.dayDate)}, not today (${today})`);
  }
  if (landing.body !== "") {
    failure(`today's editor did not open empty: ${JSON.stringify(landing.body)}`);
  }
  if (landing.status !== "No note for this day yet") {
    failure(`an empty day reported ${JSON.stringify(landing.status)}`);
  }
  // A day saves itself: the page offers no control to press, and landing on a
  // day nobody has typed on writes nothing at all.
  assertChrome(landing.chrome, "at landing");
  if (landing.chrome.history.length === 0) {
    failure("the strip of earlier notes drew no day to measure");
  }
  // The strip is a table of three: the date the note is for, that date's weekday,
  // and when it was last written — and its heading stands a step over the rows.
  if (landing.chrome.historyHead.length !== 3) {
    failure(`the strip's header drew ${landing.chrome.historyHead.length} column(s), expected 3`);
  }
  if (!(landing.chrome.historyHeadingSize > landing.chrome.historyRowSize)) {
    failure(
      `the "Earlier notes" heading is ${landing.chrome.historyHeadingSize}px over ${landing.chrome.historyRowSize}px rows — not larger`,
    );
  }
  assertRows(landing.rows, today, "at landing");
  // The last-edited column is the note's own stamp rather than a date the page
  // made up: the far day was seeded from 2019, which no page could invent from
  // today's clock.
  const farRow = landing.rows.find((row) => row.isoDate === farDay);
  if (!farRow) {
    failure(`the far day (${farDay}) is missing from the strip`);
  } else if (!(farRow.edited ?? "").includes(farDayYear)) {
    failure(
      `the last-edited column reads ${JSON.stringify(farRow.edited)} for a note stamped ${farDayYear}`,
    );
  }
  if (landing.writes !== 0) {
    failure(`the page wrote ${landing.writes} time(s) before anything was typed`);
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
  // An empty page is an invitation because the caret is already in it, and because
  // it says nothing: the page carries no placeholder text, so a blank paragraph is
  // a blank line rather than another copy of an instruction.
  if (landing.editing !== true) {
    failure("an empty day did not open its writing line");
  }
  if (landing.inputValue !== "") {
    failure(`the empty day's writing line held ${JSON.stringify(landing.inputValue)}`);
  }
  if (landing.inputPlaceholder) {
    failure(`the writing line carries a placeholder: ${JSON.stringify(landing.inputPlaceholder)}`);
  }
  if (landing.placeholders !== 0) {
    failure(`an empty day printed the page's placeholder ${landing.placeholders} time(s)`);
  }

  // ── 2b. a blank paragraph is blank, however many there are ───────────────
  // The operator opens two more blank paragraphs, which is where a placeholder
  // used to be repeated once per line. Nothing is printed, and nothing is written:
  // opening a line is not writing a note.
  await press(win, "Enter");
  await waitFor(
    win,
    `document.querySelectorAll("[data-note-block]").length === 2`,
    "a second blank paragraph",
  );
  await press(win, "Enter");
  await waitFor(
    win,
    `document.querySelectorAll("[data-note-block]").length === 3`,
    "a third blank paragraph",
  );
  const blanks = await sample(win);
  checks.emptyParagraphs = blanks;
  if (blanks.placeholders !== 0) {
    failure(`a blank paragraph printed the page's placeholder ${blanks.placeholders} time(s)`);
  }
  if ((blanks.renderedText ?? "") !== "") {
    failure(`an empty note painted ${JSON.stringify(blanks.renderedText)}`);
  }
  if (blanks.inputPlaceholder) {
    failure(`the open blank paragraph carries a placeholder: ${JSON.stringify(blanks.inputPlaceholder)}`);
  }
  if (blanks.writes !== 0) {
    failure(`opening blank paragraphs wrote the day (${blanks.writes} write(s))`);
  }
  await leaveTheLine(win);
  const collapsed = await sample(win);
  if (collapsed.blockCount !== 1) {
    failure(`an empty note settled into ${collapsed.blockCount} blocks, expected 1`);
  }

  // ── 3. typing writes the day with nothing pressed ────────────────────────
  const typed =
    "Rig day: wrote the note, and the review read it back.\n\n**Live preview**: the box renders as it is written.";
  const firstParagraph = "Rig day: wrote the note, and the review read it back.";
  const secondParagraph = "Live preview: the box renders as it is written.";
  const secondSource = "**Live preview**: the box renders as it is written.";
  await type(win, typed);
  const dirty = await sample(win);
  checks.afterTyping = dirty;
  // Nothing was pressed between the keystroke and this read: a page that needs a
  // control says so here, as "No note for this day yet" or as a live Save.
  if (dirty.status !== "Saving…") {
    failure(`typing did not mark the day as on its way to the vault: ${JSON.stringify(dirty.status)}`);
  }
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

  const firstWrites = await waitForWrite(win, 0, "the day to write itself");
  checks.firstWrite = firstWrites;
  if (firstWrites.length !== 1) {
    failure(`the first autosave wrote ${firstWrites.length} times, expected 1`);
  }
  if (firstWrites[0]?.date !== today) {
    failure(`the autosave wrote ${JSON.stringify(firstWrites[0]?.date)} instead of today (${today})`);
  }
  // The write names the day the page was showing when it made it: prose carried
  // onto another date is the one way an autosave can lose a day.
  if (firstWrites[0]?.shown !== firstWrites[0]?.date) {
    failure(
      `a write landed on ${JSON.stringify(firstWrites[0]?.date)} while the page showed ${JSON.stringify(firstWrites[0]?.shown)}`,
    );
  }
  // The file gets the markdown, the box got the prose: one note, two readings,
  // and neither is a copy of the other.
  if ((firstWrites[0]?.body ?? "").trimEnd() !== typed) {
    failure(`the autosave carried the wrong body: ${JSON.stringify(firstWrites[0]?.body)}`);
  }

  await waitFor(
    win,
    `document.querySelector('[data-testid="daily-note-status"]').textContent.trim() === "Saved"`,
    "the page to report the write",
  );
  const saved = await sample(win);
  checks.afterSave = saved;
  if (!saved.rows.some((row) => row.text.startsWith("Today"))) {
    failure(`the journal strip does not list the day just written: ${JSON.stringify(saved.rows)}`);
  }

  // The operator leaves the line, and the note settles into the paragraphs the
  // file holds: what was typed as markdown is now prose in the same box.
  await leaveTheLine(win);
  const written = await sample(win);
  checks.afterWriting = written;
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

  // ── 3c. Enter starts the next paragraph, and that paragraph writes itself ──
  // The structural half of writing: a paragraph break is a new block, so the
  // file gets the blank line markdown needs without the operator typing one. The
  // paragraph then reaches the vault the same way the first one did.
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
  const thirdWrites = await waitForWrite(win, firstWrites.length, "the third paragraph to write itself");
  checks.afterThirdParagraph = await sample(win);
  const threeUp = checks.afterThirdParagraph;
  if (thirdWrites.length !== firstWrites.length + 1) {
    failure(
      `writing one paragraph made ${thirdWrites.length - firstWrites.length} write(s), expected 1`,
    );
  }
  if (threeUp.blockCount !== 3 || threeUp.rendering !== 3) {
    failure(
      `the note did not settle into three rendered paragraphs: ${threeUp.blockCount} block(s), ${threeUp.rendering} rendered`,
    );
  }
  if (!(threeUp.renderedText ?? "").includes(third)) {
    failure(`the third paragraph did not render: ${JSON.stringify(threeUp.renderedText)}`);
  }
  if (!(thirdWrites[thirdWrites.length - 1]?.body ?? "").includes(third)) {
    failure(
      `the third paragraph did not reach the vault: ${JSON.stringify(thirdWrites[thirdWrites.length - 1]?.body)}`,
    );
  }

  // ── 3d. an idle page writes nothing ─────────────────────────────────────
  // The failure mode of an autosave is a write storm: a render, a focus move or
  // a timer that re-fires would show up as a growing ledger with no operator.
  const idleBefore = (await writesOf(win)).length;
  await idle(win, AUTOSAVE_SETTLE_MS);
  const idleAfter = (await writesOf(win)).length;
  checks.idleWrites = { before: idleBefore, after: idleAfter };
  if (idleAfter !== idleBefore) {
    failure(`an untouched page wrote ${idleAfter - idleBefore} more time(s) on its own`);
  }

  // ── 3e. a save landing mid-sentence leaves the writing line alone ────────
  // The debounce fires because the operator paused, and the ordinary pause is
  // mid-sentence: the line under the caret ends in a space that is not a typo,
  // it is the next word not being typed yet. The vault trims the end of a body —
  // that is the vault's business — and the page must not hand that trim back to
  // the box. A body the box did not emit is a body it re-cuts: the paragraph
  // closes, the prose renders, and the caret is gone in the middle of a sentence.
  //
  // The caret is read as `document.activeElement`, so the field is focused first:
  // this is the one claim in the rig that is about the writing line itself rather
  // than about what reached the vault.
  await openBlock(win, 2);
  const midSentence = "Mid-sentence: the day was written before the word was.";
  const typedMid = `${midSentence} `;
  const beforeMid = (await writesOf(win)).length;
  const midCaret = await typeWithCaret(win, typedMid);
  checks.midSentenceTyping = midCaret;
  if (!midCaret?.focused) {
    failure("the writing line never took the caret, so this step would prove nothing");
  }
  if (midCaret?.value !== typedMid) {
    failure(
      `the writing line did not take what was typed: ${JSON.stringify(midCaret?.value)}`,
    );
  }
  const midWrites = await waitForWrite(win, beforeMid, "the mid-sentence save to land");
  checks.midSentenceWrites = midWrites;
  if (midWrites.length !== beforeMid + 1) {
    failure(
      `a pause mid-sentence made ${midWrites.length - beforeMid} write(s), expected 1`,
    );
  }
  await waitFor(
    win,
    `document.querySelector('[data-testid="daily-note-status"]').textContent.trim() === "Saved"`,
    "the mid-sentence save to be reported",
  );
  const midSaved = await sample(win);
  checks.midSentenceAfterSave = midSaved;
  if (!midSaved.editing) {
    failure("a save landing mid-sentence closed the writing line the operator was in");
  }
  if (midSaved.inputValue !== typedMid) {
    failure(
      `a save landing mid-sentence rewrote the operator's line: ${JSON.stringify(midSaved.inputValue)}`,
    );
  }
  if (!midSaved.caretInBox) {
    failure("a save landing mid-sentence took the caret out of the box");
  }
  // The file still holds the note in the vault's own form: the trailing space is
  // trimmed out of the *file*, which is the vault's answer, while the box keeps
  // the keystroke that is still being typed on.
  const midOnDisk = await win.webContents.executeJavaScript(
    `(window.dailyNoteJournal.get(${JSON.stringify(today)}) ?? {}).bodyMarkdown ?? null`,
  );
  checks.midSentenceOnDisk = midOnDisk;
  const midExpected = `${firstParagraph}\n\n${secondSource}\n\n${midSentence}\n`;
  if (midOnDisk !== midExpected) {
    failure(
      `the mid-sentence save wrote ${JSON.stringify(midOnDisk)}, expected ${JSON.stringify(midExpected)}`,
    );
  }
  // And the trim the vault applied is not a change the page owes it back: a box
  // left "dirty" by a trailing space would write the same day again every
  // `AUTOSAVE_DELAY_MS` for as long as the operator thought about the next word.
  const midQuietBefore = (await writesOf(win)).length;
  await idle(win, AUTOSAVE_SETTLE_MS);
  const midQuietAfter = (await writesOf(win)).length;
  checks.midSentenceQuiet = { before: midQuietBefore, after: midQuietAfter };
  if (midQuietAfter !== midQuietBefore) {
    failure(
      `a line the vault trimmed was written ${midQuietAfter - midQuietBefore} more time(s) on its own`,
    );
  }
  // The moment on camera: the writing line still open with the operator's own
  // keystroke in it and the caret in it, over a status line that already reads
  // "Saved" — the day written without the box being touched.
  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const midShot = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "daily-note-midsentence.png"), midShot.toPNG());
  await leaveTheLine(win);

  // ── 4. an existing day loads, as prose ──────────────────────────────────
  await click(win, "daily-note-prev");
  await waitFor(
    win,
    `(document.querySelector('[data-testid="daily-note-editor"]')?.textContent ?? "").includes("Yesterday: a walk")`,
    "yesterday's note to load",
  );
  const previous = await sample(win);
  checks.previousDay = previous;
  if (previous.dayDate !== yesterday) {
    failure(`Prev day landed on ${JSON.stringify(previous.dayDate)}, not ${yesterday}`);
  }
  if (previous.body !== "Yesterday: a walk, then the rig.") {
    failure(`yesterday's note did not load: ${JSON.stringify(previous.body)}`);
  }
  if (previous.status !== "Saved") {
    failure(`a day with a saved note reported ${JSON.stringify(previous.status)}`);
  }
  if (previous.nextDisabled !== false) {
    failure("Next day was inert on a past day, so today cannot be reached forward");
  }
  if (previous.editing) {
    failure("a day with a note opened its writing line instead of reading as prose");
  }

  // ── 5. a draft typed and cleared leaves the day exactly as it was ────────
  // Autosave is a timer, not a keystroke: prose that is gone before the timer
  // fires must never reach the disk, or "I changed my mind" would write a note.
  await click(win, "daily-note-prev");
  // The wait is on the day being loaded, not on any decoration in the box: an
  // empty day is empty, and it says so by painting nothing at all.
  await waitFor(
    win,
    `document.querySelector('[data-testid="daily-note-day"]').getAttribute("data-date") === ${JSON.stringify(twoBack)}` +
      ` && (document.querySelector('[data-testid="daily-note-editor"]')?.textContent ?? "").trim() === ""`,
    "an empty day two days back",
  );
  const emptyDay = await sample(win);
  checks.emptyDay = emptyDay;
  if (emptyDay.body !== "") failure(`an empty day read ${JSON.stringify(emptyDay.body)}`);
  if (emptyDay.editing) failure("an empty day opened its writing line before it was clicked");
  if (emptyDay.placeholders !== 0) {
    failure(`an empty day printed the page's placeholder ${emptyDay.placeholders} time(s)`);
  }
  const writesBeforeBlank = (await writesOf(win)).length;
  await type(win, "typo");
  await type(win, "");
  await idle(win, AUTOSAVE_SETTLE_MS);
  const clearedBack = await sample(win);
  checks.afterClearedDraft = clearedBack;
  const writesAfterBlank = (await writesOf(win)).length;
  if (writesAfterBlank !== writesBeforeBlank) {
    failure(
      `a draft typed and cleared still wrote the day (${writesAfterBlank - writesBeforeBlank} write(s))`,
    );
  }
  if (clearedBack.body !== "") {
    failure(`a draft typed and cleared left ${JSON.stringify(clearedBack.body)} on the page`);
  }
  if (clearedBack.status !== "No note for this day yet") {
    failure(`an untouched empty day reported ${JSON.stringify(clearedBack.status)}`);
  }

  // ── 5b. clearing a day's prose is refused ────────────────────────────────
  // The vault's rule, seen from the page: a note must have something in it. The
  // day keeps its prose on disk and the operator is told why in words.
  await click(win, "daily-note-today");
  await waitFor(
    win,
    `document.querySelector('[data-testid="daily-note-day"]').getAttribute("data-date") === ${JSON.stringify(today)}`,
    "the Today control to return to today",
  );
  await click(win, "daily-note-prev");
  await waitFor(
    win,
    `(document.querySelector('[data-testid="daily-note-editor"]')?.textContent ?? "").includes("Yesterday: a walk")`,
    "yesterday's note to load again",
  );
  const beforeClear = (await writesOf(win)).length;
  await type(win, "");
  await leaveTheLine(win);
  await waitFor(
    win,
    `(window.dailyNoteWrites ?? []).length > ${beforeClear}`,
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
  if (cleared.status !== "Not saved") {
    failure(`a refused day reported ${JSON.stringify(cleared.status)} instead of "Not saved"`);
  }
  const stillThere = await win.webContents.executeJavaScript(
    `(window.dailyNoteJournal.get(${JSON.stringify(yesterday)}) ?? {}).bodyMarkdown ?? null`,
  );
  checks.afterClearAttempt = stillThere;
  if (!(stillThere ?? "").includes("Yesterday: a walk")) {
    failure("a refused clear emptied the day on disk anyway");
  }

  // ── 5b. clearing a day's prose is refused, and the day is left as it was ──
  // The vault's rule, seen from the page: a note must have something in it. The
  // day keeps its prose on disk and the operator is told why in words. A refusal
  // is an *answer*, not a loss — the file is untouched — so the page does not
  // hold the operator on the day; leaving is the test, and the day's own file is
  // where "nothing was lost" is read.
  await click(win, "daily-note-prev");
  await waitFor(
    win,
    `document.querySelector('[data-testid="daily-note-day"]').getAttribute("data-date") !== ${JSON.stringify(yesterday)}`,
    "the operator to leave a day the vault refused",
  );
  // The refusal was about the day that was left: it goes with the day rather than
  // following the operator onto the next one.
  await waitFor(
    win,
    "!document.querySelector('.form-error')",
    "the refusal to clear as its day is left",
  );
  const left = await sample(win);
  checks.afterRefusedLeave = left;
  if (left.dayDate !== twoBack) {
    failure(
      `leaving a refused day landed on ${JSON.stringify(left.dayDate)}, expected ${twoBack}`,
    );
  }
  if (left.error) {
    failure(`a refusal followed the operator off the day: ${JSON.stringify(left.error)}`);
  }
  const keptOnDisk = await win.webContents.executeJavaScript(
    `(window.dailyNoteJournal.get(${JSON.stringify(yesterday)}) ?? {}).bodyMarkdown ?? null`,
  );
  if (!(keptOnDisk ?? "").includes("Yesterday: a walk")) {
    failure("the refused clear was still on disk after the operator left the day");
  }

  // ── 5c. a write that *fails* is not an answer, so the day is held ────────
  // The vault declining a body is a fact; a bridge that drops the call is not, and
  // nobody knows what reached the disk. This is the one case where leaving could
  // lose prose, so it is the one case where leaving is refused.
  const heldProse = "Two days back: the bridge dropped this once.";
  const beforeFailure = (await writesOf(win)).length;
  await win.webContents.executeJavaScript("window.dailyNoteThrowWrite = true");
  await type(win, heldProse);
  await waitFor(
    win,
    `(window.dailyNoteWrites ?? []).length > ${beforeFailure}`,
    "the dropped write to reach the bridge",
  );
  await waitFor(
    win,
    "Boolean(document.querySelector('.form-error'))",
    "the dropped write to be reported",
  );
  const failed = await sample(win);
  checks.writeFailed = failed;
  if (!(failed.error ?? "").includes("dropped")) {
    failure(`a dropped write was not reported in words: ${JSON.stringify(failed.error)}`);
  }
  if (!(failed.body ?? "").startsWith(heldProse)) {
    failure(`a dropped write lost the operator's text: ${JSON.stringify(failed.body)}`);
  }
  await click(win, "daily-note-today");
  await idle(win, 800);
  const held = await sample(win);
  checks.dayHeld = held;
  if (held.dayDate !== twoBack) {
    failure(
      `the page left a day whose write had failed: it is on ${JSON.stringify(held.dayDate)}, expected ${twoBack}`,
    );
  }
  if (!(held.body ?? "").startsWith(heldProse)) {
    failure("a held-back day did not keep the draft the operator typed");
  }

  // The bridge comes back, and Ctrl+S is the write that releases the day.
  await win.webContents.executeJavaScript("window.dailyNoteThrowWrite = false");
  const beforeRecovery = (await writesOf(win)).length;
  await pressShortcut(win, "s");
  await waitFor(
    win,
    `(window.dailyNoteWrites ?? []).length > ${beforeRecovery}`,
    "the re-sent write to land",
  );
  await waitFor(win, `!document.querySelector('.form-error')`, "the failure to clear");
  const recovered = await sample(win);
  checks.writeRecovered = recovered;
  if (!(recovered.body ?? "").startsWith(heldProse)) {
    failure(`the re-sent write lost the operator's text: ${JSON.stringify(recovered.body)}`);
  }
  if (recovered.status !== "Saved") {
    failure(`the re-sent write left the day reporting ${JSON.stringify(recovered.status)}`);
  }
  const heldOnDisk = await win.webContents.executeJavaScript(
    `(window.dailyNoteJournal.get(${JSON.stringify(twoBack)}) ?? {}).bodyMarkdown ?? null`,
  );
  if (!(heldOnDisk ?? "").startsWith(heldProse)) {
    failure("the re-sent write never reached the day's file");
  }
  // Released: the day the write failed on can now be left.
  await click(win, "daily-note-today");
  await waitFor(
    win,
    `document.querySelector('[data-testid="daily-note-day"]').getAttribute("data-date") === ${JSON.stringify(today)}`,
    "the operator to reach today once the write landed",
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
  if (back.dayDate !== today) {
    failure(`returning to today landed on ${JSON.stringify(back.dayDate)}`);
  }
  if (back.nextDisabled !== true) failure("Next day was live again on today");
  if (!(back.body ?? "").includes(firstParagraph)) {
    failure(`returning to today lost the note: ${JSON.stringify(back.body)}`);
  }
  if (!(back.body ?? "").includes(secondParagraph)) {
    failure(`returning to today lost a paragraph: ${JSON.stringify(back.body)}`);
  }
  const futureRow = back.rows.find((row) => row.isoDate === tomorrow);
  if (futureRow) {
    failure(`a future-dated note was offered in the strip: ${JSON.stringify(futureRow)}`);
  }
  assertRows(back.rows, today, "after returning to today");
  const unreadable = back.rows.find((row) => row.link === false);
  checks.unreadableRow = unreadable ?? null;
  if (!unreadable) {
    failure("the file that names no real day was not reported as unreadable");
  } else if (unreadable.link) {
    failure("the unreadable day was offered as a link");
  }

  // ── 7. a refused write keeps the draft, and Ctrl+S is the retry ──────────
  // The operator opens today's first paragraph and replaces it. The rest of the
  // note must survive the refusal too: "keeps the draft" means all of it.
  const refused = "Rig day: the vault refused this once.";
  const beforeRefusal = (await writesOf(win)).length;
  await win.webContents.executeJavaScript("window.dailyNoteFailWrite = true");
  await type(win, refused);
  await waitFor(
    win,
    `(window.dailyNoteWrites ?? []).length > ${beforeRefusal}`,
    "the refused autosave to reach the bridge",
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
  if (refusedSample.status !== "Not saved") {
    failure(`a refused day reported ${JSON.stringify(refusedSample.status)} instead of "Not saved"`);
  }

  // And it stops there. The vault said no to this exact body: a page that keeps
  // asking is a page that will hammer a broken vault.
  const refusedWrites = (await writesOf(win)).length;
  await idle(win, AUTOSAVE_SETTLE_MS);
  const quiet = (await writesOf(win)).length;
  checks.refusedQuiet = { before: refusedWrites, after: quiet };
  if (quiet !== refusedWrites) {
    failure(`the page retried a body the vault had refused ${quiet - refusedWrites} more time(s)`);
  }

  const beforeRetry = (await writesOf(win)).length;
  await win.webContents.executeJavaScript("window.dailyNoteFailWrite = false");
  await pressShortcut(win, "s");
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
  if (retried.error) failure(`the refusal stayed on screen after a successful write`);
  if (retried.status !== "Saved") {
    failure(`the retry left the day reporting ${JSON.stringify(retried.status)}`);
  }

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
  checks.writes = await writesOf(win);
  // Every write names the day the page was showing when it made it, for the whole
  // run rather than for the first write alone.
  const strayedWrite = checks.writes.find((write) => write.shown !== write.date);
  if (strayedWrite) {
    failure(
      `a write landed on a day the page was not showing: ${JSON.stringify(strayedWrite)}`,
    );
  }
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
  console.log(`chrome:    ${landing.chrome.saveControls} save control, radius step ${landing.chrome.step}px`);
  console.log(`landing:   ${JSON.stringify(landing.day)} — ${JSON.stringify(landing.status)}`);
  console.log(`written:   ${threeUp.blockCount} paragraph(s), <strong> ${JSON.stringify(threeUp.strong)}`);
  console.log(`autosave:  ${checks.writes.length} write(s) over the run, ${checks.afterSave.status}`);
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
}, 120_000);
