/**
 * Drives the live-editor harness in a real Electron window and turns what the
 * document editor and the review editor actually render into
 * `e2e/artifacts/live-editor.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/live-editor.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same claims. It ships with three pictures of the same run: the
 * document editor with a paragraph open as its own markdown
 * (`live-editor-document.png`), the same document locked
 * (`live-editor-locked.png`), and the review editor (`live-editor-review.png`).
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. The document editor IS the one box: exactly one `.note-live`, zero
 *     `.doc-editor__split` and zero `.doc-editor__preview` nodes anywhere on the
 *     page. Counting the page's own nodes is what makes "one box" falsifiable:
 *     put the second column back and these counts change.
 *  2. The document reads as prose: two paragraphs rendered, no `*`/`_`/backtick
 *     painted, and the file's own markdown is what the ledger holds.
 *  3. Opening the second paragraph shows *its* markdown — and only it: one
 *     writing line, the first paragraph still rendered, in the column the prose
 *     held.
 *  4. Save carries what the box holds, exactly: the draft the operator typed,
 *     blank line and all, is the body `documentSave` receives.
 *  5. A locked document has no writing line at all, and a click on its prose
 *     opens none: the engine refuses a locked write, so the UI must not offer one.
 *  6. A pasted image is saved once, and its markdown lands in the note as its own
 *     paragraph, which the box then renders as an `<img>` resolved through
 *     `documentMediaRead`.
 *  7. The review editor is the same widget: one box, prose, a paragraph opening
 *     as its own source, and Save writing exactly that body through `reviewWrite`.
 *  8. No bridge call this rig does not model, and no console error.
 *
 * NOT covered here: the Daily Note's own page, which has its own rig
 * (`daily-note.electron.mjs`), and that any of it reaches disk — that is the
 * vault-core half.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/live-editor.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** Read the editor box and the page chrome straight off the rendered DOM. */
const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) };
  };
  const box = document.querySelector(".note-live");
  const input = box ? box.querySelector("textarea") : null;
  const blocks = box ? Array.from(box.querySelectorAll("[data-note-block]")) : [];
  const parts = blocks.map((el) => {
    const area = el.querySelector("textarea");
    if (area) return area.value;
    if (el.querySelector(".note-live__placeholder")) return "";
    return el.textContent || "";
  });
  const rendered = blocks.filter((el) => !el.querySelector("textarea"));
  const button = (rootSel, label) =>
    Array.from(document.querySelectorAll((rootSel ?? "") + " button")).find(
      (b) => (b.textContent || "").trim() === label,
    ) ?? null;
  const save = button(".doc-editor__actions", "Save");
  const edit = button(".review-page__actions", "Edit");
  const reviewSave = button(".review-page__actions", "Save");
  return {
    heading: text(document.querySelector(".doc-editor__title")),
    body: parts.join("\\n\\n").trim(),
    blockCount: blocks.length,
    rendering: rendered.length,
    writingLines: box ? box.querySelectorAll("textarea").length : 0,
    editing: Boolean(input),
    inputValue: input ? input.value : null,
    readOnly: box ? box.getAttribute("data-read-only") === "true" : null,
    boxes: document.querySelectorAll(".note-live").length,
    splits: document.querySelectorAll(".doc-editor__split").length,
    previews: document.querySelectorAll(".doc-editor__preview").length,
    showsMarkers: box ? /\\*\\*|__|\`/.test(box.textContent || "") : null,
    images: box ? box.querySelectorAll("img[data-media]").length : 0,
    imageSrc: box && box.querySelector("img") ? box.querySelector("img").getAttribute("data-media") : null,
    inputRect: input ? rect(input) : null,
    renderedRect: rendered[0] ? rect(rendered[0]) : null,
    boxRect: box ? rect(box) : null,
    saveDisabled: save ? save.disabled : null,
    reviewEditing: Boolean(document.querySelector(".review-page__actions")),
    reviewSaveDisabled: reviewSave ? reviewSave.disabled : null,
    reviewPeriod: text(document.querySelector(".review-page__period")),
    error: text(document.querySelector(".form-error")),
    unexpected: (window.liveEditorUnexpectedCalls ?? []).slice(),
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

const INPUT = ".note-live textarea";

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

/** Click a button by its label inside a named region. */
function clickLabel(win, rootSelector, label) {
  return win.webContents.executeJavaScript(`(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(rootSelector)} + " button"))
      .find((b) => (b.textContent || "").trim() === ${JSON.stringify(label)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

async function main() {
  const sessionPartition = `live-editor-${Date.now()}`;
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
  await waitFor(win, "Boolean(window.liveEditorReady)", "liveEditorReady");

  const checks = {};

  // A harness that never applied the skin would draw a palette the operator does
  // not run, and every layout claim below would be about the wrong theme.
  checks.skin = await win.webContents.executeJavaScript(
    "({ name: window.liveEditorSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
  }

  // ── 1. the document editor is ONE box, reading as prose ──────────────────
  const document = await sample(win);
  checks.document = document;
  if (document.heading !== "Vision & Desire · Health") {
    failure(`the document editor headed ${JSON.stringify(document.heading)}`);
  }
  if (document.boxes !== 1) {
    failure(`the page drew ${document.boxes} editor boxes, expected exactly 1`);
  }
  if (document.splits !== 0 || document.previews !== 0) {
    failure(
      `a split editor is still on the page: ${document.splits} grid(s), ${document.previews} preview pane(s)`,
    );
  }
  if (document.editing) {
    failure("the document opened its writing line before it was clicked");
  }
  if (document.readOnly !== false) {
    failure("an unlocked document came up read-only");
  }
  if (document.blockCount !== 2) {
    failure(`the document rendered ${document.blockCount} block(s), expected 2`);
  }
  if (document.showsMarkers) {
    failure("raw markdown markers are painted in the box");
  }
  if (!(document.body ?? "").includes("Three sessions a week, no exceptions.")) {
    failure(`the rendered document read ${JSON.stringify(document.body)}`);
  }

  // ── 2. opening one paragraph leaves the rest prose ───────────────────────
  await openBlock(win, 1);
  const opened = await sample(win);
  checks.openedParagraph = opened;
  if (opened.inputValue !== "**Three sessions** a week, no exceptions.") {
    failure(`the opened paragraph is not its own markdown: ${JSON.stringify(opened.inputValue)}`);
  }
  if (opened.writingLines !== 1) {
    failure(`opening a paragraph opened ${opened.writingLines} writing lines`);
  }
  if (opened.rendering !== 1) {
    failure(`opening one paragraph left ${opened.rendering} rendered, expected 1`);
  }
  if (!(opened.body ?? "").includes("A calm, strong body at 60.")) {
    failure("the paragraph above went raw along with the one under the caret");
  }
  if (!opened.inputRect || !opened.renderedRect) {
    failure("the box did not report both a writing line and a rendered paragraph");
  } else if (opened.inputRect.left !== opened.renderedRect.left) {
    failure(
      `the writing line sits at x=${opened.inputRect.left} and the prose at x=${opened.renderedRect.left}: two columns`,
    );
  }

  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const documentShot = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "live-editor-document.png"), documentShot.toPNG());

  // ── 3. Save carries exactly what the box holds ───────────────────────────
  // The paragraph opened above is the one being written, so this claims both the
  // boundary (two blocks join as one blank line in the file) and the content:
  // what Save sends is the note the box holds, not what it drew.
  const second = "Walking daily, and **three sessions** a week.";
  const expected = "A calm, strong body at 60.\n\n" + second;
  await type(win, second);
  await leaveTheLine(win);
  await clickLabel(win, ".doc-editor__actions", "Save");
  await waitFor(win, "(window.liveEditorSaves ?? []).length > 0", "the save to reach the bridge");
  const saves = await win.webContents.executeJavaScript("window.liveEditorSaves");
  checks.saves = saves;
  if (saves.length !== 1) failure(`the save wrote ${saves.length} times, expected 1`);
  if (saves[0]?.slug !== "health" || saves[0]?.kind !== "what") {
    failure(`the save landed on ${JSON.stringify(saves[0])}`);
  }
  if ((saves[0]?.body ?? "").trimEnd() !== expected) {
    failure(
      `the save carried ${JSON.stringify(saves[0]?.body)}, expected ${JSON.stringify(expected)}`,
    );
  }
  const saved = await sample(win);
  checks.saved = saved;
  if (!(saved.body ?? "").includes("Walking daily, and three sessions a week.")) {
    failure(`the box lost the note after saving: ${JSON.stringify(saved.body)}`);
  }

  // ── 4. a pasted image is saved, and its markdown lands in the note ───────
  await openBlock(win, 0);
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    const file = new File([new Uint8Array([1, 2, 3, 4])], "rig-shot.png", { type: "image/png" });
    const data = new DataTransfer();
    data.items.add(file);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  })()`);
  await waitFor(win, "(window.liveEditorMedia ?? []).length > 0", "the pasted image to be saved");
  const media = await win.webContents.executeJavaScript("window.liveEditorMedia");
  checks.media = media;
  if (media.length !== 1) failure(`the paste saved ${media.length} file(s), expected 1`);
  if (media[0]?.slug !== "health" || media[0]?.mime !== "image/png") {
    failure(`the paste saved ${JSON.stringify(media[0])}`);
  }
  if (media[0]?.bytes !== 4) {
    failure(`the paste saved ${media[0]?.bytes} byte(s), expected 4`);
  }
  await waitFor(
    win,
    `(document.querySelector('${INPUT}')?.value ?? "").includes("![](media/rig-shot.png)")`,
    "the image markdown to reach the writing line",
  );
  const pasted = await sample(win);
  checks.pasted = pasted;
  if (!(pasted.inputValue ?? "").includes("![](media/rig-shot.png)")) {
    failure(`the pasted markdown is not in the note: ${JSON.stringify(pasted.inputValue)}`);
  }
  await leaveTheLine(win);
  await waitFor(
    win,
    `Boolean(document.querySelector('.note-live img[data-media="media/rig-shot.png"]'))`,
    "the box to render the pasted image",
  );
  const withImage = await sample(win);
  checks.withImage = withImage;
  if (withImage.images !== 1 || withImage.imageSrc !== "media/rig-shot.png") {
    failure(
      `the box rendered ${withImage.images} image(s), src ${JSON.stringify(withImage.imageSrc)}`,
    );
  }
  const mediaReads = await win.webContents.executeJavaScript(
    "(window.liveEditorCalls ?? []).filter((c) => c.startsWith('documentMediaRead'))",
  );
  checks.mediaReads = mediaReads;
  if (!mediaReads.some((call) => call.endsWith("media/rig-shot.png"))) {
    failure(`the box did not resolve the image it was given: ${JSON.stringify(mediaReads)}`);
  }

  // ── 5. a locked document has no writing line at all ─────────────────────
  await win.webContents.executeJavaScript("window.liveEditorLocked = true");
  await win.webContents.executeJavaScript(`window.liveEditorGoto("/review/weekly")`);
  await waitFor(win, `Boolean(document.querySelector(".review-page__actions"))`, "the review page");
  await win.webContents.executeJavaScript(`window.liveEditorGoto("/vision/health/what")`);
  await waitFor(
    win,
    `document.querySelector('.note-live')?.getAttribute("data-read-only") === "true"`,
    "the locked document",
  );
  const locked = await sample(win);
  checks.locked = locked;
  if (locked.editing) failure("a locked document opened a writing line");
  if (locked.readOnly !== true) failure("the box did not report itself read-only");
  if (locked.blockCount < 1) failure("the locked document rendered nothing");
  // A click on locked prose opens nothing: the engine refuses a locked write, so
  // the surface must not offer one.
  await win.webContents.executeJavaScript(`(() => {
    const block = document.querySelector(".note-live [data-note-block]");
    if (block) {
      block.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
    }
  })()`);
  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const afterClick = await sample(win);
  checks.lockedAfterClick = afterClick;
  if (afterClick.editing || afterClick.writingLines !== 0) {
    failure("a click on a locked document opened a writing line");
  }

  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const lockedShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "live-editor-locked.png"), lockedShot.toPNG());

  // ── 6. the review editor is the same box ────────────────────────────────
  await win.webContents.executeJavaScript("window.liveEditorLocked = false");
  await win.webContents.executeJavaScript(`window.liveEditorGoto("/review/weekly")`);
  await waitFor(win, `Boolean(document.querySelector(".review-page__actions"))`, "the review page");
  await clickLabel(win, ".review-page__actions", "Edit");
  await waitFor(win, `Boolean(document.querySelector(".note-live"))`, "the review editor");
  const review = await sample(win);
  checks.review = review;
  if (review.boxes !== 1) failure(`the review page drew ${review.boxes} editor boxes`);
  if (review.splits !== 0 || review.previews !== 0) {
    failure("the review page still draws the split editor");
  }
  if (review.blockCount !== 3) {
    failure(`the review rendered ${review.blockCount} block(s), expected 3`);
  }
  if (review.showsMarkers) {
    failure("raw markdown markers are painted in the review box");
  }
  if (!(review.body ?? "").includes("Two walks, and one late night.")) {
    failure(`the rendered review read ${JSON.stringify(review.body)}`);
  }
  await openBlock(win, 2);
  const reviewOpened = await sample(win);
  checks.reviewOpened = reviewOpened;
  if (reviewOpened.inputValue !== "Two walks, and **one** late night.") {
    failure(`the opened review paragraph is not its own markdown: ${JSON.stringify(reviewOpened.inputValue)}`);
  }
  if (reviewOpened.rendering !== 2) {
    failure(`opening one review paragraph left ${reviewOpened.rendering} rendered, expected 2`);
  }

  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const reviewShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "live-editor-review.png"), reviewShot.toPNG());

  const reviewNext = "Two walks, and three late nights.";
  const expectedReview = "# Week of 12 Oct 2026\n\n## Health\n\n" + reviewNext;
  await type(win, reviewNext);
  await leaveTheLine(win);
  await clickLabel(win, ".review-page__actions", "Save");
  await waitFor(
    win,
    "(window.liveEditorReviewWrites ?? []).length > 0",
    "the review write to reach the bridge",
  );
  const writes = await win.webContents.executeJavaScript("window.liveEditorReviewWrites");
  checks.reviewWrites = writes;
  if (writes.length !== 1) failure(`the review save wrote ${writes.length} times, expected 1`);
  if (writes[0]?.cadence !== "weekly") failure(`the review write landed on ${JSON.stringify(writes[0])}`);
  if ((writes[0]?.body ?? "").trimEnd() !== expectedReview) {
    failure(
      `the review write carried ${JSON.stringify(writes[0]?.body)}, expected ${JSON.stringify(expectedReview)}`,
    );
  }

  // ── 7. nothing unexpected, nothing on fire ──────────────────────────────
  const unexpected = await win.webContents.executeJavaScript("window.liveEditorUnexpectedCalls");
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the pages called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  checks.calls = await win.webContents.executeJavaScript("window.liveEditorCalls");
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
    path.join(artifactsDir, "live-editor.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`document:  ${document.blockCount} block(s), ${document.boxes} box, ${document.splits} split`);
  console.log(`opened:    ${JSON.stringify(opened.inputValue)}`);
  console.log(`saved:     ${JSON.stringify(saves[0]?.body)}`);
  console.log(`pasted:    ${JSON.stringify(media[0])} → ${withImage.images} image(s)`);
  console.log(`locked:    readOnly=${locked.readOnly} writingLines=${afterClick.writingLines}`);
  console.log(`review:    ${review.blockCount} block(s), opened ${JSON.stringify(reviewOpened.inputValue)}`);
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
  console.error("live-editor rig timed out");
  app.exit(1);
}, 90_000);
