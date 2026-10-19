/**
 * Drives the review harness in a real Electron window and turns what the Review
 * page actually renders into `e2e/artifacts/review.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/review.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims. It ships with three pictures of the same
 * run: the review document as the page opens (`review-document.png`), the same
 * page after Start filled it in (`review-started.png`), and the cadence's rules
 * panel open (`review-rules.png`).
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. The review IS the document: one `.note-live` on arrival, no Edit control
 *     to press first and no Save control to press after, and the file's own
 *     prose rendered as prose.
 *  2. A blank line the operator typed survives being written down. The file is
 *     read straight off the stub after a real edit elsewhere in the note, so a
 *     parser that eats the empty block fails here and nowhere else.
 *  3. The formatting keys work on the selection: Ctrl+B wraps it, Ctrl+U writes
 *     the one mark markdown has no syntax for, and Ctrl+2 replaces a heading
 *     rather than stacking one.
 *  4. Start fills the cadence's snapshot under the right heading, inside its own
 *     marker pair, and clicking Start twice fills it once — the second pass
 *     rewrites the block in place rather than appending a second copy.
 *  5. An agent that is not answering does NOT take the document down with it:
 *     the review stays open, keeps the figures Start just filled, and the page
 *     says where to fix the agent. This is the reported `fetch failed` failure.
 *  6. The cadence's own rules can be read and written from the page, so "add a
 *     rule over time" does not depend on the agent being reachable.
 *  7. The snapshot markers the app writes are not printed: they are comments,
 *     and a review that showed them would be showing its own bookkeeping.
 *  8. No bridge call this rig does not model, and no console error.
 *
 * NOT covered here: that any of it reaches disk (that is the vault-core half,
 * `tests/review-snapshot-e2e.test.ts`) and the companion's own transport rules
 * (that is `tests/companion-*`).
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
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/review.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const INPUT = ".note-live textarea";

/** Read the review page and the box straight off the rendered DOM. */
const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const box = document.querySelector(".note-live");
  const input = box ? box.querySelector("textarea") : null;
  const blocks = box ? Array.from(box.querySelectorAll("[data-note-block]")) : [];
  const parts = blocks.map((el) => {
    const area = el.querySelector("textarea");
    if (area) return area.value;
    if (el.querySelector(".note-live__placeholder")) return "";
    if (el.querySelector(".note-live__blank")) return "";
    return el.textContent || "";
  });
  return {
    boxes: document.querySelectorAll(".note-live").length,
    blockCount: blocks.length,
    blanks: box ? box.querySelectorAll(".note-live__blank").length : 0,
    writingLines: box ? box.querySelectorAll("textarea").length : 0,
    editing: Boolean(input),
    inputValue: input ? input.value : null,
    boxMarkdown: parts.join("\\n\\n").trim(),
    boxText: box ? box.textContent || "" : "",
    readOnly: box ? box.getAttribute("data-read-only") === "true" : null,
    strong: box ? box.querySelectorAll("strong").length : 0,
    underlines: box ? box.querySelectorAll("u").length : 0,
    tables: box ? box.querySelectorAll("table").length : 0,
    headers: box
      ? Array.from(box.querySelectorAll("th")).map((th) => (th.textContent || "").trim())
      : [],
    headings: box ? box.querySelectorAll("h1, h2, h3, h4, h5, h6").length : 0,
    title: text(document.querySelector(".review-page__title")),
    period: text(document.querySelector(".review-page__period")),
    notice: text(document.querySelector(".review-page__notice")),
    error: text(document.querySelector(".form-error")),
    status: text(document.querySelector(".review-page__status")),
    actions: Array.from(document.querySelectorAll(".review-page__actions button")).map(
      (b) => (b.textContent || "").trim(),
    ),
    modes: Array.from(document.querySelectorAll(".review-page__modes button")).map(
      (b) => (b.textContent || "").trim(),
    ),
    previewShown: Boolean(document.querySelector('[data-testid="review-preview"]')),
    skillOpen: Boolean(document.querySelector('[data-testid="review-skill-editor"]')),
    skillValue: (() => {
      const el = document.querySelector('[data-testid="review-skill-editor"]');
      if (!el) return null;
      const area = el.querySelector("textarea");
      if (area) return area.value;
      return Array.from(el.querySelectorAll("[data-note-block]"))
        .map((n) => n.textContent || "")
        .join("\\n\\n")
        .trim();
    })(),
  };
})()`;

const errors = [];
/**
 * Everything sampled so far. Module-level rather than local to `main`, so a run
 * that throws part way still writes what it had already seen: a report with only
 * a message is a report nobody can diagnose from.
 */
const checks = {};
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

function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

/** The review body as the file holds it, off the stub that stands in for disk. */
function fileBody(win) {
  return win.webContents.executeJavaScript("window.reviewRigBody()");
}

/** Open a paragraph the way a person does — a click on the prose. */
async function openBlock(win, index) {
  await win.webContents.executeJavaScript(`(() => {
    const block = document.querySelectorAll(".note-live [data-note-block]")[${index}];
    if (!block) return false;
    block.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
    );
    return true;
  })()`);
  try {
    await waitFor(win, `Boolean(document.querySelector('${INPUT}'))`, `paragraph ${index} to open`);
  } catch (error) {
    // A paragraph that will not open is diagnosed by what the box was holding:
    // the block count, which one was aimed at, and whether the page locked it.
    const state = await win.webContents.executeJavaScript(`(() => {
      const box = document.querySelector(".note-live");
      return {
        boxes: document.querySelectorAll(".note-live").length,
        blocks: box ? box.querySelectorAll("[data-note-block]").length : 0,
        readOnly: box ? box.getAttribute("data-read-only") : null,
        aimed: document.querySelectorAll(".note-live [data-note-block]")[${index}]
          ? (document.querySelectorAll(".note-live [data-note-block]")[${index}].textContent || "").slice(0, 60)
          : null,
        writingLines: box ? box.querySelectorAll("textarea").length : 0,
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)} — ${JSON.stringify(state)}`);
  }
}

/** Replace the open writing line's text the way typing would. */
function type(win, value) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`);
}

/** Select a run of characters in the open writing line. */
function select(win, start, end) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return null;
    el.focus();
    el.setSelectionRange(${start}, ${end});
    return [el.selectionStart, el.selectionEnd];
  })()`);
}

/**
 * Press a formatting key on the open writing line.
 *
 * The page's handler is a React `onKeyDown`, which is a listener on the root
 * container: a real `keydown` dispatched on the textarea bubbles to it, which is
 * what makes this the same path an operator's keystroke takes.
 */
function pressKey(win, key, modifiers = {}) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return null;
    el.focus();
    const event = new KeyboardEvent("keydown", {
      key: ${JSON.stringify(key)},
      bubbles: true,
      cancelable: true,
      ctrlKey: ${modifiers.ctrl ? "true" : "false"},
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });
    el.dispatchEvent(event);
    return { value: el.value, start: el.selectionStart, end: el.selectionEnd, prevented: event.defaultPrevented };
  })()`);
}

/** Leave the writing line the way clicking away would: the paragraph renders. */
async function leaveTheLine(win) {
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return;
    el.blur();
    // This window is shown without taking focus, so Chromium suppresses the
    // blur/focusout a real click-away delivers. The page is wired to the event,
    // so the event is what this dispatches — the same one, on the same node.
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  })()`);
  await waitFor(win, `!document.querySelector('${INPUT}')`, "the writing line to close");
}

function click(win, selector) {
  return win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  );
}

function setHarness(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

function frames(win) {
  return win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}

async function shot(win, name) {
  await frames(win);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, name), image.toPNG());
}

/** How many times a literal appears — the count, not a boolean. */
function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function main() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `review-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();
  const consoleErrors = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") consoleErrors.push(e.message);
  });
  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.reviewRigReady)", "reviewRigReady");

  // ── 1. the review is the document, on arrival ────────────────────────────
  const opened = await sample(win);
  checks.opened = opened;
  if (opened.boxes !== 1) failure(`the review page drew ${opened.boxes} editor boxes`);
  if (opened.editing) failure("the review opened a writing line on arrival");
  if (opened.blockCount !== 15) {
    failure(`the review opened with ${opened.blockCount} block(s), expected 15`);
  }
  // The blank line between the two Look-back paragraphs is one block of its own,
  // and it draws as a blank line rather than as nothing.
  if (opened.blanks !== 1) {
    failure(`the review drew ${opened.blanks} blank line(s), expected 1`);
  }
  if (!opened.boxText.includes("Two walks, and one late night.")) {
    failure(`the rendered review read ${JSON.stringify(opened.boxText.slice(0, 160))}`);
  }
  if (opened.boxText.includes("**")) {
    failure("raw markdown markers are painted in the review box");
  }
  if (opened.actions.includes("Edit") || opened.actions.includes("Save")) {
    failure(`the review page still offers an Edit/Save pair: ${JSON.stringify(opened.actions)}`);
  }
  if (opened.title !== "Weekly review") {
    failure(`the review's title read ${JSON.stringify(opened.title)}`);
  }
  await shot(win, "review-document.png");

  // ── 2. a blank line the operator typed reaches the file ──────────────────
  // Edited at the paragraph BELOW the blank line, so the write is caused by a
  // real change and the blank line has to survive the box's own re-cut of the
  // note — which is exactly what used to collapse it.
  await openBlock(win, 4);
  await type(win, "Slept badly, and it showed at work.");
  await leaveTheLine(win);
  await waitFor(
    win,
    "(window.reviewRigWrites ?? []).length > 0",
    "the autosave to reach the bridge",
  );
  const afterBlankLine = await fileBody(win);
  checks.blankLineBody = afterBlankLine;
  if (
    !afterBlankLine.includes(
      "Two walks, and **one** late night.\n\n\n\nSlept badly, and it showed at work.",
    )
  ) {
    failure(
      `the blank line the operator typed did not survive the write: ${JSON.stringify(afterBlankLine.slice(0, 220))}`,
    );
  }
  const blanksAfter = await sample(win);
  checks.blankLineBlocks = blanksAfter.blanks;
  if (blanksAfter.blanks !== 1) {
    failure(`the blank line disappeared from the box: ${blanksAfter.blanks} drawn`);
  }

  // ── 3. the formatting keys ───────────────────────────────────────────────
  await openBlock(win, 2);
  await type(win, "alpha beta gamma");
  await select(win, 6, 10);
  const bolded = await pressKey(win, "b", { ctrl: true });
  checks.bolded = bolded;
  if (!bolded || !bolded.prevented) failure("Ctrl+B was not claimed by the editor");
  if (bolded?.value !== "alpha **beta** gamma") {
    failure(`Ctrl+B wrote ${JSON.stringify(bolded?.value)}`);
  }
  if (bolded?.start !== 8 || bolded?.end !== 12) {
    failure(`Ctrl+B left the selection at ${bolded?.start}-${bolded?.end}, expected 8-12`);
  }
  await select(win, 0, 5);
  const underlined = await pressKey(win, "u", { ctrl: true });
  checks.underlined = underlined;
  if (underlined?.value !== "<u>alpha</u> **beta** gamma") {
    failure(`Ctrl+U wrote ${JSON.stringify(underlined?.value)}`);
  }
  await select(win, 0, 0);
  const headed = await pressKey(win, "2", { ctrl: true });
  checks.headed = headed;
  if (headed?.value !== "## <u>alpha</u> **beta** gamma") {
    failure(`Ctrl+2 wrote ${JSON.stringify(headed?.value)}`);
  }
  // Pressing it again replaces the heading rather than stacking a second one.
  const reheaded = await pressKey(win, "3", { ctrl: true });
  checks.reheaded = reheaded;
  if (reheaded?.value !== "### <u>alpha</u> **beta** gamma") {
    failure(`Ctrl+3 on an H2 wrote ${JSON.stringify(reheaded?.value)}`);
  }
  await leaveTheLine(win);
  await frames(win);
  const formatted = await sample(win);
  checks.formatted = formatted;
  if (formatted.underlines < 1) failure("the underline mark did not render as <u>");
  if (formatted.strong < 1) failure("the bold mark did not render as <strong>");
  if (formatted.headings < 5) {
    failure(`the review drew ${formatted.headings} headings, expected at least 5`);
  }
  if (!formatted.boxText.includes("alpha beta gamma")) {
    failure("the heading the formatting keys wrote is not rendered");
  }
  if (formatted.boxText.includes("<u>")) {
    failure("the underline tag is printed literally in the box");
  }

  // ── 4. Start fills the snapshot, with the agent down ─────────────────────
  await setHarness(win, "window.reviewRigAgentDown = true");
  await click(win, '[data-testid="review-start"]');
  await waitFor(win, `Boolean(document.querySelector(".form-error"))`, "the agent error");
  await waitFor(
    win,
    "(window.reviewRigSnapshotCalls ?? []).length > 0",
    "the snapshot pass to run",
  );
  const agentDown = await sample(win);
  checks.agentDown = agentDown;
  if (!agentDown.error || !agentDown.error.includes("Settings › Hermes")) {
    failure(`the agent failure did not say where to fix it: ${JSON.stringify(agentDown.error)}`);
  }
  if (agentDown.error && /fetch failed/i.test(agentDown.error)) {
    failure("the page reported the transport's own words instead of the failure");
  }
  if (agentDown.boxes !== 1 || agentDown.editing) {
    failure("an agent that is not answering took the review document away");
  }
  const filledBody = await fileBody(win);
  checks.filledBody = filledBody;
  if (occurrences(filledBody, "<!-- lifequest:snapshot:finance-spend -->") !== 1) {
    failure("the snapshot marker is not in the file exactly once");
  }
  if (!filledBody.includes("| Groceries | 1,234.56 |")) {
    failure("the snapshot did not carry the figure the rule asked for");
  }
  const lookback = filledBody.indexOf("### Look-back");
  const snapshotAt = filledBody.indexOf("<!-- lifequest:snapshot:finance-spend -->");
  const keepAt = filledBody.indexOf("### Keep");
  if (!(lookback !== -1 && snapshotAt > lookback && snapshotAt < keepAt)) {
    failure(
      `the snapshot did not land in the Financial Look-back section (lookback ${lookback}, snapshot ${snapshotAt}, keep ${keepAt})`,
    );
  }
  // The markers are comments: the box prints the figure and hides the machinery.
  if (!agentDown.boxText.includes("Spending this period")) {
    failure("the filled snapshot is not visible in the review");
  }
  if (agentDown.boxText.includes("lifequest:snapshot")) {
    failure("the snapshot marker is printed in the review");
  }
  // And the figure is a TABLE, not a paragraph of pipes: a snapshot drawn as
  // `| Category | Total | | --- | --- |` is worse than no snapshot at all.
  if (agentDown.tables < 1) {
    failure("the snapshot's table is not drawn as a table");
  }
  if (!agentDown.headers.includes("Category") || !agentDown.headers.includes("Total (ZAR)")) {
    failure(`the snapshot's table headers read ${JSON.stringify(agentDown.headers)}`);
  }
  if (agentDown.boxText.includes("| --- |")) {
    failure("the snapshot's table is painted as markdown pipes");
  }
  await shot(win, "review-started.png");

  // ── 5. the second Start fills once, and opens the interview ──────────────
  await setHarness(win, "window.reviewRigAgentDown = false");
  await click(win, '[data-testid="review-start"]');
  await waitFor(
    win,
    "(window.reviewRigStarts ?? []).length > 0",
    "the review session to be requested",
  );
  await frames(win);
  const started = await sample(win);
  checks.started = started;
  if (started.error) failure(`the second Start reported ${JSON.stringify(started.error)}`);
  if (!started.notice || !/snapshot/i.test(started.notice)) {
    failure(`the page did not say what it filled: ${JSON.stringify(started.notice)}`);
  }
  if (!started.notice || !/chat/i.test(started.notice)) {
    failure(`the page did not say the interview opened: ${JSON.stringify(started.notice)}`);
  }
  const twice = await fileBody(win);
  checks.startedTwiceBody = twice;
  if (occurrences(twice, "<!-- lifequest:snapshot:finance-spend -->") !== 1) {
    failure("a second Start appended a second snapshot block");
  }
  if (occurrences(twice, "| Groceries | 1,234.56 |") !== 1) {
    failure("a second Start appended the snapshot's own table again");
  }
  const starts = await setHarness(win, "window.reviewRigStarts");
  checks.starts = starts;
  if (starts.length !== 1) failure(`Start requested ${starts.length} sessions, expected 1`);

  // ── 6. Preview shows the whole document, markers and all hidden ──────────
  await click(win, '[data-testid="review-mode-preview"]');
  await waitFor(win, `Boolean(document.querySelector('[data-testid="review-preview"]'))`, "the preview");
  const preview = await sample(win);
  checks.preview = preview;
  if (!preview.previewShown) failure("the preview mode drew no preview");
  if (preview.boxes !== 0) failure("the preview mode left the editor box on the page");
  const previewText = await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="review-preview"]').textContent`,
  );
  checks.previewText = previewText.slice(0, 600);
  // The sectioned summary this page used to draw extracted the four required
  // headings and nothing else, so this paragraph — and the `## Notes` heading
  // above it — were simply not there. The preview is the whole file now.
  if (!previewText.includes("A note outside the skeleton.")) {
    failure("the preview dropped a section the operator wrote");
  }
  // The heading the formatting keys wrote, one section up, in the same file.
  if (!previewText.includes("alpha beta gamma")) {
    failure("the preview dropped the heading the operator wrote");
  }
  if (previewText.includes("lifequest:snapshot")) {
    failure("the preview printed the snapshot marker");
  }
  await click(win, '[data-testid="review-mode-document"]');
  await waitFor(win, `Boolean(document.querySelector(".note-live"))`, "the document mode");

  // ── 7. the cadence's rules, read and written from the page ───────────────
  await click(win, '[data-testid="review-skill-toggle"]');
  await waitFor(win, `Boolean(document.querySelector('[data-testid="review-skill-editor"]'))`, "the rules panel");
  // The panel opens before the file is read, so the wait is on the rules being
  // IN it rather than on the box existing.
  await waitFor(
    win,
    `(document.querySelector('[data-testid="review-skill-editor"]')?.textContent ?? "").includes("Keep it to a page.")`,
    "the cadence's rules to arrive",
  );
  const rules = await sample(win);
  checks.rules = rules;
  if (!(rules.skillValue ?? "").includes("Keep it to a page.")) {
    failure(`the rules panel did not show the cadence's rules: ${JSON.stringify(rules.skillValue)}`);
  }
  await shot(win, "review-rules.png");
  const nextRules = "# Weekly review skill\n\n- Always ask about sleep.\n";
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="review-skill-editor"] textarea')
      ?? document.querySelector('[data-testid="review-skill-editor"] [data-note-block]');
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    return true;
  })()`);
  await waitFor(win, `Boolean(document.querySelector('[data-testid="review-skill-editor"] textarea'))`, "the rules writing line");
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="review-skill-editor"] textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(nextRules)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`);
  await click(win, '[data-testid="review-skill-save"]');
  await waitFor(
    win,
    "(window.reviewRigSkillWrites ?? []).length > 0",
    "the rules write to reach the bridge",
  );
  const skillWrites = await setHarness(win, "window.reviewRigSkillWrites");
  checks.skillWrites = skillWrites;
  if (skillWrites.length !== 1) failure(`the rules were written ${skillWrites.length} times`);
  if (!String(skillWrites[0] ?? "").includes("Always ask about sleep.")) {
    failure(`the rules write carried ${JSON.stringify(skillWrites[0])}`);
  }

  // ── 8. nothing unexpected, nothing on fire ───────────────────────────────
  checks.kickoffs = await setHarness(win, "window.reviewRigKickoffs");
  const unexpected = await setHarness(win, "window.reviewRigUnexpectedCalls");
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  checks.calls = await setHarness(win, "window.reviewRigCalls");
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "review.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `[review] ${errors.length === 0 ? "PASS" : "FAIL"} — ${errors.length} failure(s)`,
  );
  for (const message of errors) console.log(`  ✗ ${message}`);
  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

setTimeout(() => {
  console.error("review rig timed out");
  app.exit(1);
}, 90_000);

app
  .whenReady()
  .then(main)
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`review rig threw: ${message}`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "review.json"),
      `${JSON.stringify(
        {
          pass: false,
          failures: [...errors, message],
          checks,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    app.exit(1);
  });
