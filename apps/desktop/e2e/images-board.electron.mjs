/**
 * Drives the images-board harness in a real Electron window and writes
 * `e2e/artifacts/images-board.{json,png}` plus the pictures the claims name.
 *
 * Run with the dev server up (`lifequest-e2e <checkout> tests/images-board-ui-e2e.test.ts`
 * in this project, or `npm run dev` and then `node e2e/images-board.electron.mjs`).
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims, no eyeballing the app required.
 *
 * What this rig claims:
 *
 *  1. Define's rail carries Images at `/images`, the page is that route, the
 *     eyebrow says Define, and the page is one sheet of two surfaces: the
 *     picture library and the vision document.
 *  2. An empty vault shows the library's and the document's own empty states,
 *     and the counts say zero.
 *  3. Dropped pictures upload: each card appears, the count/summary follow, and
 *     every picture decodes from a real blob URL (naturalWidth > 0) — the
 *     renderer read bytes back through the bridge rather than trusting the drop.
 *  4. A caption edit reaches the library through `imagesUpdate`, and the stored
 *     row carries it after a re-render.
 *  5. Clicking a picture puts an image block in the document, and that block
 *     draws the same decoded picture.
 *  6. A text block is added and typed into; Enter splits it into two blocks; the
 *     document autosaves to the vault after the last keystroke and reports
 *     "Saved". The blocks the vault holds are exactly the blocks on screen.
 *  7. Heading and bullet blocks are added, a bullet Enter adds the next line,
 *     and both survive the JSON round trip.
 *  8. Reordering moves a block, and an empty block is removed with Backspace.
 *  9. The picture picker lists the library and adds the chosen picture; it
 *     closes after choosing.
 * 10. Removing a picture asks first, Cancel keeps it, Confirm deletes it from
 *     the vault, and the document keeps its image block drawn as missing — the
 *     operator can replace a picture without losing the sentence around it.
 * 11. A refused autosave says "Not saved", names the refusal, and Ctrl+S is
 *     what writes it for real; an idle page writes nothing.
 * 12. With room — the 1600-wide rig, and the operator's maximised window — the
 *     two surfaces sit side by side with the library on the leading edge; at 760
 *     they stack with the library on top.
 * 13. No Save control, no unmodelled bridge call, no console error.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame and throttles timers: a rig that waits on either
// then hangs until its watchdog instead of failing. A rig runs hidden beside
// every other rig in the suite.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/images-board.html";
const WIDE = { width: 1600, height: 950 };
const NARROW = { width: 760, height: 900 };
const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}
function check(name, condition, detail) {
  if (!condition) fail(`${name} — ${detail}`);
  return Boolean(condition);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Everything the report needs from the page, in one read. The picture counts
 * are deliberately taken from the drawn <img>s rather than from the stub: a blob
 * URL that is made but never painted is the failure this rig is for.
 */
const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const q = (selector) => document.querySelector(selector);
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const layout = q(".images-studio__layout");
  const library = q('[data-testid="images-library"]');
  const board = q('[data-testid="vision-board"]');
  const blocks = all('[data-testid="vision-board"] .vblock').map((el) => ({
    kind: el.getAttribute("data-kind"),
    text: el.querySelector('[data-testid="block-text"]')?.value ?? null,
    heading: el.querySelector('[data-testid="block-heading"]')?.value ?? null,
    caption: el.querySelector('[data-testid="block-image-caption"]')?.value ?? null,
  }));
  const bulletBlocks = all('[data-testid="vision-board"] .vblock[data-kind="bullets"]').map(
    (el) => all('[data-testid="block-bullet"]').filter((input) => el.contains(input)).map((input) => input.value),
  );
  const railItems = all(".nav-rail__link").map((el) => ({
    label: text(el.querySelector(".nav-rail__label")),
    href: el.getAttribute("href"),
    active: el.classList.contains("nav-rail__link--active"),
  }));
  const wings = all(".top-bar__wings .ui-segmented__option").map((el) => ({
    label: text(el),
    selected: el.getAttribute("aria-selected") === "true",
  }));
  return {
    route: window.imagesBoardRoute ?? null,
    rail: railItems,
    activeRail: railItems.find((item) => item.active)?.label ?? null,
    wings,
    eyebrow: text(q(".images-studio__eyebrow")),
    heading: text(q(".images-studio__title")),
    lead: text(q(".images-studio__lead")),
    counts: {
      cards: all('[data-testid^="image-card-"]').length,
      badge: text(q('[data-testid="images-count"]')),
      summary: text(q(".images-library__summary")),
      blocks: blocks.length,
      picker: all('[data-testid="image-picker"]').length,
    },
    states: {
      libraryEmpty: text(q('[data-testid="images-empty"]')),
      libraryLoading: text(q('[data-testid="images-loading"]')),
      boardEmpty: text(q('[data-testid="vision-board-empty"]')),
      status: text(q('[data-testid="vision-board-status"]')),
      statusValue: q('[data-testid="vision-board-status"]')?.getAttribute("data-status") ?? null,
      error: text(q('[data-testid="images-error"]')),
      notice: text(q('[data-testid="images-notice"]')),
      pickerOptions: all('[data-testid^="picker-image-"]').length,
    },
    blocks,
    bulletBlocks,
    pictures: {
      inLibrary: all('[data-testid^="image-card-"] img').map((img) => ({
        complete: img.complete,
        width: img.naturalWidth,
      })),
      inDocument: all('[data-kind="image"] img').map((img) => ({
        complete: img.complete,
        width: img.naturalWidth,
      })),
      missingBlocks: all('[data-testid="block-image-missing"]').length,
      captions: all('[data-testid^="image-caption-"]').map((input) => input.value),
    },
    numbered: {
      saveControls: all("button").filter((el) => /^save$/i.test(text(el) ?? "")).length,
      confirmDialogs: all(".confirm-dialog").length,
      confirmTitle: text(q(".confirm-dialog__title")),
      confirmMessage: text(q(".confirm-dialog__message")),
      confirmBox: rect(q(".confirm-dialog")),
    },
    layout: {
      columns: layout ? getComputedStyle(layout).gridTemplateColumns : null,
      library: rect(library),
      board: rect(board),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    calls: (window.imagesBoardCalls ?? []).slice(),
    unexpected: (window.imagesBoardUnexpectedCalls ?? []).slice(),
    writes: (window.imagesBoardWrites ?? []).slice(),
    store: window.imagesBoardSnapshot ? window.imagesBoardSnapshot() : null,
  };
})()`;

async function waitFor(win, expression, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await win.webContents.executeJavaScript(expression, true);
      if (last) return last;
    } catch (error) {
      last = String(error);
    }
    await sleep(100);
  }
  fail(`wait: ${label} never became true (last ${JSON.stringify(last)})`);
  return false;
}

/** A React-controlled input, set the way a user would. */
const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;

const click = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.click();
  return true;
})()`;

const pressEnter = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  return true;
})()`;

const blur = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.focus();
  el.blur();
  return true;
})()`;

const saveShortcut = `(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  return true;
})()`;

/**
 * Drop two real PNGs on the page. The pictures are drawn on a canvas in the
 * page, so the bytes are a genuine decodable PNG of a recognisable size rather
 * than a hand-written header a browser might refuse to paint.
 */
const DROP_TWO_PICTURES = `(async () => {
  const make = (name, a, b, dot) => new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) { resolve(null); return; }
    const gradient = ctx.createLinearGradient(0, 0, 640, 480);
    gradient.addColorStop(0, a);
    gradient.addColorStop(1, b);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(330, 220, 140, 0, Math.PI * 2);
    ctx.fill();
    canvas.toBlob((blob) => {
      if (!blob) { resolve(null); return; }
      blob.arrayBuffer().then((buffer) => resolve(new File([buffer], name, { type: "image/png" })));
    }, "image/png");
  });
  const files = await Promise.all([
    make("morning.png", "#dfceb0", "#8a6f4d", "#f6efe2"),
    make("hills.png", "#7d9b76", "#2f4a3a", "#dbe7cc"),
  ]);
  const data = new DataTransfer();
  for (const file of files) if (file) data.items.add(file);
  const target = document.querySelector('[data-testid="images-studio"]');
  if (!target) return "no target";
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }
  return files.filter(Boolean).length;
})()`;

/** Open a window sized for the case it measures. */
async function openWindow(size) {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(size.width, size.height);
  win.showInactive();
  await win.loadURL(url);
  await waitFor(win, "Boolean(window.imagesBoardReady)", "imagesBoardReady", 30_000);
  return win;
}

async function capture(win, name) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const file = path.join(artifactsDir, `images-board-${name}.png`);
  fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
  return file;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const checks = {};
  const win = await openWindow(WIDE);
  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });
  const js = (expression) => win.webContents.executeJavaScript(expression, true);
  const sample = () => js(SAMPLE);

  // ── 1. the rail, the route, and one sheet of two surfaces ────────────────
  const first = await sample();
  checks.rail = first.rail;
  checks.activeRail = first.activeRail;
  checks.route = first.route;
  checks.eyebrow = first.eyebrow;
  check(
    "images rail row",
    first.rail.some((item) => item.label === "Images" && item.href === "/images"),
    `no Images row at /images in ${JSON.stringify(first.rail)}`,
  );
  check("active rail row", first.activeRail === "Images", `active row is ${JSON.stringify(first.activeRail)}`);
  check("route", first.route === "/images", `route is ${JSON.stringify(first.route)}`);
  check("define wing", first.wings.some((wing) => wing.label === "Define" && wing.selected), `wing tabs ${JSON.stringify(first.wings)}`);
  check("eyebrow", first.eyebrow === "Define", `eyebrow read ${JSON.stringify(first.eyebrow)}`);
  check("title", first.heading === "Images", `title read ${JSON.stringify(first.heading)}`);
  check(
    "two surfaces",
    Boolean(first.layout.library && first.layout.board),
    `library ${JSON.stringify(first.layout.library)} / board ${JSON.stringify(first.layout.board)}`,
  );
  const wideTracks = (first.layout.columns ?? "").trim().split(/\s+/).filter(Boolean).length;
  check("wide side by side", wideTracks === 2, `at 1600 the sheets resolved to ${wideTracks} column(s): ${first.layout.columns}`);
  checks.wide = {
    columns: first.layout.columns,
    library: first.layout.library,
    board: first.layout.board,
  };
  check(
    "library on the leading edge",
    Boolean(
      first.layout.library &&
        first.layout.board &&
        first.layout.library.left < first.layout.board.left,
    ),
    `library ${JSON.stringify(first.layout.library)} / board ${JSON.stringify(first.layout.board)}`,
  );

  // ── 2. an empty vault has its own empty states ───────────────────────────
  checks.empty = first.states;
  check("empty library", /No pictures yet/.test(first.states.libraryEmpty ?? ""), `library said ${JSON.stringify(first.states.libraryEmpty)}`);
  check("empty document", /document is empty/i.test(first.states.boardEmpty ?? ""), `board said ${JSON.stringify(first.states.boardEmpty)}`);
  check("empty count", first.counts.badge === "0", `count badge read ${JSON.stringify(first.counts.badge)}`);
  check("empty status", first.states.status === "Saved", `status read ${JSON.stringify(first.states.status)}`);
  await capture(win, "empty");

  // ── 3. two dropped pictures upload and decode ────────────────────────────
  const dropped = await js(DROP_TWO_PICTURES);
  check("drop reached the page", dropped === 2, `the drop expression returned ${JSON.stringify(dropped)}`);
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid^="image-card-"]').length === 2`,
    "two picture cards",
  );
  await waitFor(
    win,
    `[...document.querySelectorAll('[data-testid^="image-card-"] img')].length === 2 && [...document.querySelectorAll('[data-testid^="image-card-"] img')].every((img) => img.complete && img.naturalWidth > 0)`,
    "both library pictures to decode",
  );
  const uploaded = await sample();
  checks.uploaded = {
    cards: uploaded.counts.cards,
    badge: uploaded.counts.badge,
    summary: uploaded.counts.summary,
    pictures: uploaded.pictures.inLibrary,
    writes: uploaded.writes,
    store: uploaded.store?.images.map((image) => ({ id: image.id, name: image.name, bytes: image.bytes })),
  };
  check("two cards", uploaded.counts.cards === 2, `cards ${uploaded.counts.cards}`);
  check("count badge follows", uploaded.counts.badge === "2", `badge ${JSON.stringify(uploaded.counts.badge)}`);
  check("summary follows", uploaded.counts.summary === "2 pictures", `summary ${JSON.stringify(uploaded.counts.summary)}`);
  check(
    "library pictures decoded",
    uploaded.pictures.inLibrary.length === 2 && uploaded.pictures.inLibrary.every((img) => img.width === 640),
    `decoded ${JSON.stringify(uploaded.pictures.inLibrary)}`,
  );
  const firstId = uploaded.store?.images[0]?.id;
  const secondId = uploaded.store?.images[1]?.id;
  check("uuid image ids", Boolean(firstId && /^[0-9a-f-]{36}$/.test(firstId)), `first id ${JSON.stringify(firstId)}`);

  // ── 4. a caption reaches the library ─────────────────────────────────────
  await js(setValue(`[data-testid="image-caption-${firstId}"]`, "Light before the house wakes."));
  await js(blur(`[data-testid="image-caption-${firstId}"]`));
  await waitFor(
    win,
    `(window.imagesBoardSnapshot().images.find((image) => image.id === ${JSON.stringify(firstId)}) ?? {}).caption === "Light before the house wakes."`,
    "the caption write to reach the vault",
  );
  const captioned = await sample();
  checks.caption = {
    shown: captioned.pictures.captions,
    stored: captioned.store?.images[0]?.caption,
    updateWrites: captioned.writes.filter((write) => write.op === "update"),
  };
  check("caption stored", captioned.store?.images[0]?.caption === "Light before the house wakes.", `stored ${JSON.stringify(captioned.store?.images[0]?.caption)}`);

  // ── 5. a click puts a picture in the document ────────────────────────────
  await js(click(`[data-testid="image-insert-${firstId}"]`));
  await waitFor(win, `document.querySelectorAll('[data-kind="image"]').length === 1`, "the image block");
  await waitFor(
    win,
    `[...document.querySelectorAll('[data-kind="image"] img')].every((img) => img.complete && img.naturalWidth > 0)`,
    "the document picture to decode",
  );
  await waitFor(win, `document.querySelector('[data-testid="vision-board-status"]')?.textContent.trim() === "Saved"`, "the board save of the image block");
  const inserted = await sample();
  checks.inserted = {
    blocks: inserted.blocks,
    pictures: inserted.pictures.inDocument,
    writes: inserted.writes.filter((write) => write.op === "board"),
  };
  check("image block in document", inserted.blocks.length === 1 && inserted.blocks[0].kind === "image", `blocks ${JSON.stringify(inserted.blocks)}`);
  check("document picture decoded", inserted.pictures.inDocument[0]?.width === 640, `decoded ${JSON.stringify(inserted.pictures.inDocument)}`);

  // ── 6. text blocks: type, split with Enter, autosave ─────────────────────
  await js(click('[data-testid="board-add-text"]'));
  await waitFor(win, `document.querySelectorAll('[data-testid="block-text"]').length === 1`, "the text block");
  await js(setValue('[data-testid="block-text"]', "A quiet house, morning light, and work that is mine."));
  await js(pressEnter('[data-testid="block-text"]'));
  await waitFor(win, `document.querySelectorAll('[data-testid="block-text"]').length === 2`, "Enter to split the text block");
  await waitFor(win, `document.querySelector('[data-testid="vision-board-status"]')?.textContent.trim() === "Saved"`, "the autosave of the split text");
  const split = await sample();
  checks.text = {
    blocks: split.blocks,
    stored: split.store?.blocks,
    boardWrites: split.writes.filter((write) => write.op === "board").length,
  };
  check("two text blocks", split.blocks.filter((block) => block.kind === "text").length === 2, `blocks ${JSON.stringify(split.blocks)}`);
  check("first sentence kept", split.blocks.filter((block) => block.kind === "text")[0]?.text === "A quiet house, morning light, and work that is mine.", `text ${JSON.stringify(split.blocks.filter((b) => b.kind === "text")[0]?.text)}`);
  check("second block opened empty", split.blocks.filter((block) => block.kind === "text")[1]?.text === "", `second text ${JSON.stringify(split.blocks.filter((b) => b.kind === "text")[1]?.text)}`);
  check(
    "autosaved kinds",
    JSON.stringify((split.store?.blocks ?? []).map((block) => block.kind)) === JSON.stringify(split.blocks.map((block) => block.kind)),
    `vault has ${JSON.stringify((split.store?.blocks ?? []).map((block) => block.kind))}, screen has ${JSON.stringify(split.blocks.map((block) => block.kind))}`,
  );
  check(
    "autosaved text",
    JSON.stringify((split.store?.blocks ?? []).filter((block) => block.kind === "text").map((block) => block.text)) ===
      JSON.stringify(split.blocks.filter((block) => block.kind === "text").map((block) => block.text)),
    `vault text ${JSON.stringify((split.store?.blocks ?? []).filter((block) => block.kind === "text").map((block) => block.text))}`,
  );

  // ── 7. heading and bullets, including a bullet Enter ─────────────────────
  await js(click('[data-testid="board-add-heading"]'));
  await waitFor(win, `document.querySelectorAll('[data-testid="block-heading"]').length === 1`, "the heading block");
  await js(setValue('[data-testid="block-heading"]', "The life I'm reaching for"));
  await js(click('[data-testid="board-add-bullets"]'));
  await waitFor(win, `document.querySelectorAll('[data-kind="bullets"]').length === 1`, "the bullets block");
  await js(setValue('[data-testid="block-bullet"]', "Walk before the house wakes"));
  await js(pressEnter('[data-testid="block-bullet"]'));
  await waitFor(win, `document.querySelectorAll('[data-testid="block-bullet"]').length === 2`, "a second bullet line");
  const bulletInputs = `document.querySelectorAll('[data-testid="block-bullet"]')`;
  await js(`(() => {
    const els = ${bulletInputs};
    const second = els[1];
    if (!second) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(second, "Build one thing well");
    second.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await waitFor(win, `document.querySelector('[data-testid="vision-board-status"]')?.textContent.trim() === "Saved"`, "the autosave of heading and bullets");
  const structured = await sample();
  checks.structure = {
    kinds: structured.blocks.map((block) => block.kind),
    heading: structured.blocks.find((block) => block.kind === "heading")?.heading,
    bullets: structured.bulletBlocks,
    storedKinds: (structured.store?.blocks ?? []).map((block) => block.kind),
  };
  check("heading block", structured.blocks.some((block) => block.kind === "heading" && block.heading === "The life I'm reaching for"), `heading ${JSON.stringify(structured.blocks.find((block) => block.kind === "heading"))}`);
  const storedBullets = (structured.store?.blocks ?? []).find((block) => block.kind === "bullets");
  check(
    "bullet lines stored",
    JSON.stringify(storedBullets?.items) === JSON.stringify(["Walk before the house wakes", "Build one thing well"]),
    `vault bullets ${JSON.stringify(storedBullets?.items)}`,
  );
  check("all five kinds", JSON.stringify(structured.blocks.map((block) => block.kind)) === JSON.stringify(["image", "text", "text", "heading", "bullets"]), `kinds ${JSON.stringify(structured.blocks.map((block) => block.kind))}`);

  // ── 8. reorder, and Backspace on an empty block ─────────────────────────
  const headingBlockId = structured.store?.blocks?.[3]?.id;
  check("heading block id", Boolean(headingBlockId), `no heading id in ${JSON.stringify((structured.store?.blocks ?? []).map((block) => block.kind))}`);
  await js(click(`[data-testid="vblock-${headingBlockId}"] [data-testid="block-move-up"]`));
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid="vision-board"] .vblock')[2]?.getAttribute("data-kind") === "heading"`,
    "the heading to move up one place",
  );
  await waitFor(win, `document.querySelector('[data-testid="vision-board-status"]')?.textContent.trim() === "Saved"`, "the autosave of the reorder");
  const reordered = await sample();
  checks.reorder = {
    screen: reordered.blocks.map((block) => block.kind),
    stored: (reordered.store?.blocks ?? []).map((block) => block.kind),
  };
  check(
    "reorder moved the heading",
    JSON.stringify(reordered.blocks.map((block) => block.kind)) === JSON.stringify(["image", "text", "heading", "text", "bullets"]),
    `kinds after move ${JSON.stringify(reordered.blocks.map((block) => block.kind))}`,
  );
  check(
    "reorder persisted",
    JSON.stringify((reordered.store?.blocks ?? []).map((block) => block.kind)) === JSON.stringify(["image", "text", "heading", "text", "bullets"]),
    `vault order ${JSON.stringify((reordered.store?.blocks ?? []).map((block) => block.kind))}`,
  );

  await js(click('[data-testid="board-add-text"]'));
  await waitFor(win, `document.querySelectorAll('[data-testid="block-text"]').length === 3`, "the throwaway text block");
  await js(`(() => {
    const texts = document.querySelectorAll('[data-testid="block-text"]');
    const last = texts[texts.length - 1];
    if (!last) return false;
    last.focus();
    last.setSelectionRange(0, 0);
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(win, `document.querySelectorAll('[data-testid="block-text"]').length === 2`, "Backspace to remove the empty block");
  await waitFor(win, `document.querySelector('[data-testid="vision-board-status"]')?.textContent.trim() === "Saved"`, "the autosave of the removal");
  const trimmed = await sample();
  checks.backspace = {
    blocks: trimmed.blocks.map((block) => block.kind),
    stored: (trimmed.store?.blocks ?? []).map((block) => block.kind),
  };

  // ── 9. the picture picker ────────────────────────────────────────────────
  await js(click('[data-testid="board-add-image"]'));
  await waitFor(win, `Boolean(document.querySelector('[data-testid="image-picker"]'))`, "the picture picker");
  const picker = await sample();
  checks.picker = { options: picker.states.pickerOptions, images: picker.store?.images.length };
  check("picker lists the library", picker.states.pickerOptions === 2, `picker offered ${picker.states.pickerOptions} pictures`);
  await js(click(`[data-testid="picker-image-${secondId}"]`));
  await waitFor(win, `document.querySelectorAll('[data-kind="image"]').length === 2`, "the picked image block");
  await waitFor(
    win,
    `(window.imagesBoardSnapshot().blocks.filter((block) => block.kind === "image")).length === 2`,
    "the picked image block to be saved",
  );
  const picked = await sample();
  checks.picked = {
    imageBlocks: picked.blocks.filter((block) => block.kind === "image").length,
    pickerOpen: picked.counts.picker,
    imageIds: (picked.store?.blocks ?? []).filter((block) => block.kind === "image").map((block) => block.imageId),
  };
  check("picker closed after choosing", picked.counts.picker === 0, `picker still open: ${picked.counts.picker}`);
  check("picked picture is in the document", JSON.stringify((picked.store?.blocks ?? []).filter((block) => block.kind === "image").map((block) => block.imageId)) === JSON.stringify([firstId, secondId]), `image ids ${JSON.stringify((picked.store?.blocks ?? []).filter((block) => block.kind === "image").map((block) => block.imageId))}`);

  // ── 10. removing a picture asks first, and the document keeps its place ──
  const removeButton = `[data-testid="image-card-${firstId}"] .image-card__action--quiet`;
  await js(click(removeButton));
  await waitFor(win, `Boolean(document.querySelector(".confirm-dialog"))`, "the remove question");
  const asked = await sample();
  checks.confirm = {
    title: asked.numbered.confirmTitle,
    message: asked.numbered.confirmMessage,
  };
  check("the question names the picture", /morning\.png/.test(asked.numbered.confirmMessage ?? ""), `message ${JSON.stringify(asked.numbered.confirmMessage)}`);
  const box = asked.numbered.confirmBox;
  const viewport = asked.layout.viewport;
  check(
    "the question is on screen",
    Boolean(
      box &&
        viewport &&
        box.left >= 0 &&
        box.top >= 0 &&
        box.left + box.width <= viewport.width &&
        box.top + box.height <= viewport.height,
    ),
    `the dialog sits at ${JSON.stringify(box)} in ${JSON.stringify(viewport)} — a size container must not trap it`,
  );
  // Let the compositor present the question: capturePage grabs the last
  // presented frame, and a hidden window can lag one React commit behind.
  await sleep(250);
  await capture(win, "delete-question");
  await js(click(".confirm-dialog__cancel"));
  await waitFor(win, `document.querySelectorAll('[data-testid^="image-card-"]').length === 2`, "Cancel to keep the picture");
  const kept = await sample();
  checks.cancel = { cards: kept.counts.cards, deleteWrites: kept.writes.filter((write) => write.op === "delete").length };
  check("Cancel kept the picture", kept.counts.cards === 2, `cards after cancel ${kept.counts.cards}`);

  await js(click(removeButton));
  await waitFor(win, `Boolean(document.querySelector(".confirm-dialog"))`, "the remove question again");
  await js(click(".confirm-dialog__confirm"));
  await waitFor(win, `document.querySelectorAll('[data-testid^="image-card-"]').length === 1`, "Confirm to remove the picture");
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid="block-image-missing"]').length === 1`,
    "the document to draw the deleted picture as missing",
  );
  const removed = await sample();
  checks.removed = {
    cards: removed.counts.cards,
    badge: removed.counts.badge,
    deleteWrites: removed.writes.filter((write) => write.op === "delete"),
    missingBlocks: removed.pictures.missingBlocks,
    blocks: removed.blocks.map((block) => block.kind),
    storedImages: removed.store?.images.length,
  };
  check("picture removed from the vault", removed.store?.images.length === 1, `vault still holds ${removed.store?.images.length}`);
  check("document kept its block", removed.pictures.missingBlocks === 1, `missing blocks ${removed.pictures.missingBlocks}`);
  check("image blocks stay in place", removed.blocks.filter((block) => block.kind === "image").length === 2, `blocks ${JSON.stringify(removed.blocks.map((block) => block.kind))}`);

  // ── 11. a refused autosave says so; Ctrl+S writes it ────────────────────
  const writesBeforeRefusal = (await sample()).writes.filter((write) => write.op === "board").length;
  await js("window.imagesBoardFailNextWrite = true");
  await js(setValue('[data-testid="block-heading"]', "The life I'm actually reaching for"));
  await waitFor(
    win,
    `document.querySelector('[data-testid="vision-board-status"]')?.getAttribute("data-status") === "error"`,
    "the refused autosave to report itself",
  );
  const refused = await sample();
  checks.refused = {
    status: refused.states.status,
    error: refused.states.error,
  };
  check("refusal named", /refused/i.test(refused.states.error ?? ""), `error ${JSON.stringify(refused.states.error)}`);
  check("refused write not landed", (refused.writes.filter((write) => write.op === "board").length) === writesBeforeRefusal, "a refused write reached the store");
  await js(saveShortcut);
  await waitFor(win, `document.querySelector('[data-testid="vision-board-status"]')?.textContent.trim() === "Saved"`, "Ctrl+S to write for real");
  const recovered = await sample();
  checks.recovered = {
    status: recovered.states.status,
    heading: (recovered.store?.blocks ?? []).find((block) => block.kind === "heading")?.text,
  };
  check(
    "Ctrl+S wrote the edit",
    (recovered.store?.blocks ?? []).find((block) => block.kind === "heading")?.text === "The life I'm actually reaching for",
    `vault heading ${JSON.stringify((recovered.store?.blocks ?? []).find((block) => block.kind === "heading")?.text)}`,
  );

  // ── 12. the wrong window is not this one: no Save control, clean console ─
  const final = await sample();
  checks.final = {
    cards: final.counts.cards,
    blocks: final.blocks.map((block) => block.kind),
    status: final.states.status,
    unexpected: final.unexpected,
    calls: final.calls.length,
    saveControls: final.numbered.saveControls,
    libraryCaption: final.store?.images[0]?.caption,
  };
  check("no Save control", final.numbered.saveControls === 0, `found ${final.numbered.saveControls} Save control(s)`);
  check("no unmodelled bridge call", final.unexpected.length === 0, `unmodelled: ${JSON.stringify(final.unexpected)}`);
  check("no console errors", consoleErrors.length === 0, `console errors: ${JSON.stringify(consoleErrors.slice(0, 4))}`);
  // Capture the page from the top: the header names the wing and the page, and
  // both surfaces should be in one picture.
  await js("document.querySelector('.shell__content')?.scrollTo(0, 0)");
  await sleep(250);
  await capture(win, "wide");

  // ── 13. the narrow window stacks the two surfaces ────────────────────────
  const narrowWin = await openWindow(NARROW);
  const narrow = await narrowWin.webContents.executeJavaScript(SAMPLE, true);
  checks.narrow = {
    columns: narrow.layout.columns,
    library: narrow.layout.library,
    board: narrow.layout.board,
    viewport: narrow.layout.viewport,
  };
  const narrowTracks = (narrow.layout.columns ?? "").trim().split(/\s+/).filter(Boolean).length;
  check("narrow stacks", narrowTracks === 1, `at 760 the layout resolved to ${narrowTracks} column(s): ${narrow.layout.columns}`);
  check(
    "narrow library on top",
    Boolean(narrow.layout.library && narrow.layout.board && narrow.layout.library.top < narrow.layout.board.top),
    `library ${JSON.stringify(narrow.layout.library)} / board ${JSON.stringify(narrow.layout.board)}`,
  );
  await capture(narrowWin, "narrow");

  // ── report ───────────────────────────────────────────────────────────────
  const report = {
    pass: failures.length === 0,
    failures,
    checks,
    consoleErrors,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(artifactsDir, "images-board.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  win.destroy();
  narrowWin.destroy();
  if (failures.length > 0) {
    app.exit(1);
  } else {
    app.exit(0);
  }
}

app.whenReady().then(() => {
  main().catch((error) => {
    fail(`the rig threw: ${error instanceof Error ? error.stack : String(error)}`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "images-board.json"),
      `${JSON.stringify({ pass: false, failures, thrown: String(error) }, null, 2)}\n`,
    );
    app.exit(1);
  });
});
