/**
 * Drives the images-board harness — Images under Define, and the Vision board on
 * the Vision page — in a real Electron window and writes
 * `e2e/artifacts/images-board.json`, `images-board-*.png` and `vision-board.png`.
 *
 * Run with the dev server up (`lifequest-e2e <checkout> tests/images-board-ui-e2e.test.ts`
 * in this project, or `npm run dev` and then `node e2e/images-board.electron.mjs`).
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims, no eyeballing the app required.
 *
 * What this rig claims:
 *
 *  1. Define's rail carries Images at `/images` and Vision at `/vision`; the
 *     Images page is the picture library and nothing else — the board is NOT
 *     there, which is the placement the operator asked for.
 *  2. An empty vault shows the library's own empty state, the count says zero,
 *     and the page offers the way to the Vision page.
 *  3. Dropped pictures upload: cards appear, the count/summary follow, and every
 *     picture decodes from a real blob URL (naturalWidth > 0) — the renderer
 *     read bytes back through the bridge rather than trusting the drop.
 *  4. A caption edit reaches the library through `imagesUpdate`.
 *  5. Removing a picture asks by name, Cancel keeps it, Confirm deletes it from
 *     the vault, and the count follows.
 *  6. The Vision page still carries its doctrine card, and below it the vision
 *     board with its own empty state — the board did not replace the page.
 *  7. Text is typed and split with Enter; heading and bullets are added; the
 *     document autosaves and the blocks the vault holds are the blocks on screen.
 *  8. The picture picker reads the Images library and adds the chosen picture;
 *     a picture dropped straight into the board is uploaded to the library and
 *     inserted as a block.
 *  9. Reordering moves a block; Backspace removes an empty one; both persist.
 * 10. A refused autosave says "Not saved", names the refusal, and Ctrl+S is what
 *     writes it for real.
 * 11. A picture deleted on Images leaves the board's block in place drawing as
 *     missing after the operator returns to Vision — pictures and prose are
 *     joined by id, so pruning the library never edits the document.
 * 12. With room the library is one full-width surface reflowing in columns; at a
 *     760-wide window it reflows to one column and still draws no board.
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
  const library = q('[data-testid="images-library"]');
  const grid = q('[data-testid="images-grid"]');
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
  const wings = all(".nav-rail__wings .ui-segmented__option").map((el) => ({
    label: text(el),
    selected: el.getAttribute("aria-selected") === "true",
  }));
  const doctrineCard = q(".doctrine-index__card");
  const crosslink = q(".images-studio__crosslink a");
  return {
    route: window.imagesBoardRoute ?? null,
    rail: railItems,
    activeRail: railItems.find((item) => item.active)?.label ?? null,
    wings,
    eyebrow: text(q(".images-studio__eyebrow")),
    imagesTitle: text(q(".images-studio__title")),
    visionTitle: text(q(".doctrine-page h1")),
    crosslink: crosslink ? crosslink.getAttribute("href") : null,
    presence: {
      library: Boolean(library),
      board: all('[data-testid="vision-board"]').length,
      boardPanel: all('[data-testid="vision-board-panel"]').length,
      loading: all('[data-testid="vision-board-loading"]').length,
    },
    counts: {
      cards: all('[data-testid^="image-card-"]').length,
      badge: text(q('[data-testid="images-count"]')),
      summary: text(q(".images-library__summary")),
      blocks: blocks.length,
      picker: all('[data-testid="image-picker"]').length,
      doctrineCards: all(".doctrine-index__card").length,
    },
    states: {
      libraryEmpty: text(q('[data-testid="images-empty"]')),
      libraryLoading: text(q('[data-testid="images-loading"]')),
      boardEmpty: text(q('[data-testid="vision-board-empty"]')),
      boardHeading: text(q("#vision-board-heading")),
      status: text(q('[data-testid="vision-board-status"]')),
      statusValue: q('[data-testid="vision-board-status"]')?.getAttribute("data-status") ?? null,
      error: text(q('[data-testid="images-error"]')),
      boardError: text(q('[data-testid="vision-board-error"]')),
      notice: text(q('[data-testid="images-notice"]')),
      pickerOptions: all('[data-testid^="picker-image-"]').length,
      doctrineHeading: text(q(".doctrine-index__heading")),
      doctrineCardTitle: text(doctrineCard?.querySelector(".doctrine-index__card-title")),
      doctrineCardBody: text(doctrineCard?.querySelector(".doctrine-index__card-body")),
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
      gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      library: rect(library),
      board: rect(q('[data-testid="vision-board"]')),
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

/** Click a rail row by its visible label, the way the operator moves wings. */
const clickRail = (label) => `(() => {
  const links = Array.from(document.querySelectorAll(".nav-rail__link"));
  const link = links.find((el) => (el.querySelector(".nav-rail__label")?.textContent ?? "").trim() === ${JSON.stringify(label)});
  if (!link) return false;
  link.click();
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

const PICTURE_MAKER = `(name, a, b, dot) => new Promise((resolve) => {
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
})`;

/**
 * Drop real PNGs on a target. The pictures are drawn on a canvas in the page,
 * so the bytes are a genuine decodable PNG of a recognisable size rather than a
 * hand-written header a browser might refuse to paint.
 */
const dropPictures = (targetSelector, specs) => `(async () => {
  const make = ${PICTURE_MAKER};
  const files = await Promise.all(${JSON.stringify(specs)}.map((spec) => make(spec.name, spec.a, spec.b, spec.dot)));
  const data = new DataTransfer();
  for (const file of files) if (file) data.items.add(file);
  const target = document.querySelector(${JSON.stringify(targetSelector)});
  if (!target) return "no target";
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }
  return files.filter(Boolean).length;
})()`;

const MORNING = { name: "morning.png", a: "#dfceb0", b: "#8a6f4d", dot: "#f6efe2" };
const HILLS = { name: "hills.png", a: "#7d9b76", b: "#2f4a3a", dot: "#dbe7cc" };
const COAST = { name: "coast.png", a: "#9ec4d6", b: "#2e5a74", dot: "#eef6fa" };

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

  // ── 1. Images is the library, and the board is not here ──────────────────
  const first = await sample();
  checks.rail = first.rail;
  checks.activeRail = first.activeRail;
  checks.route = first.route;
  checks.imagesPage = {
    eyebrow: first.eyebrow,
    title: first.imagesTitle,
    crosslink: first.crosslink,
    presence: first.presence,
    states: first.states,
  };
  check(
    "images rail row",
    first.rail.some((item) => item.label === "Images" && item.href === "/images"),
    `no Images row at /images in ${JSON.stringify(first.rail)}`,
  );
  check(
    "vision rail row",
    first.rail.some((item) => item.label === "Vision" && item.href === "/vision"),
    `no Vision row at /vision in ${JSON.stringify(first.rail)}`,
  );
  check("active rail row", first.activeRail === "Images", `active row is ${JSON.stringify(first.activeRail)}`);
  check("images route", first.route === "/images", `route is ${JSON.stringify(first.route)}`);
  check(
    "define wing",
    first.wings.some((wing) => wing.label === "Define" && wing.selected),
    `wing tabs ${JSON.stringify(first.wings)}`,
  );
  check("images eyebrow", first.eyebrow === "Define", `eyebrow read ${JSON.stringify(first.eyebrow)}`);
  check("images title", first.imagesTitle === "Images", `title read ${JSON.stringify(first.imagesTitle)}`);
  check("library on images", first.presence.library, "the Images page drew no library");
  check(
    "board is NOT on images",
    first.presence.board === 0 && first.presence.boardPanel === 0,
    `the Images page still carries ${first.presence.board} vision board(s)`,
  );
  check("crosslink to vision", first.crosslink === "/vision", `crosslink pointed at ${JSON.stringify(first.crosslink)}`);

  // ── 2. an empty vault has its own empty state ────────────────────────────
  checks.empty = { ...first.states, count: first.counts.badge };
  check("empty library", /No pictures yet/.test(first.states.libraryEmpty ?? ""), `library said ${JSON.stringify(first.states.libraryEmpty)}`);
  check("empty count", first.counts.badge === "0", `count badge read ${JSON.stringify(first.counts.badge)}`);
  await capture(win, "empty");

  // ── 3. two dropped pictures upload and decode ────────────────────────────
  const dropped = await js(dropPictures('[data-testid="images-studio"]', [MORNING, HILLS]));
  check("drop reached the library", dropped === 2, `the drop expression returned ${JSON.stringify(dropped)}`);
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
  const firstId = uploaded.store?.images[0]?.id;
  const secondId = uploaded.store?.images[1]?.id;
  checks.uploaded = {
    cards: uploaded.counts.cards,
    badge: uploaded.counts.badge,
    summary: uploaded.counts.summary,
    pictures: uploaded.pictures.inLibrary,
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
  check("uuid image ids", Boolean(firstId && /^[0-9a-f-]{36}$/.test(firstId)), `first id ${JSON.stringify(firstId)}`);
  await capture(win, "library");

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
    stored: captioned.store?.images[0]?.caption,
    updateWrites: captioned.writes.filter((write) => write.op === "update"),
  };
  check("caption stored", captioned.store?.images[0]?.caption === "Light before the house wakes.", `stored ${JSON.stringify(captioned.store?.images[0]?.caption)}`);

  // ── 5. removing a picture asks first ─────────────────────────────────────
  const secondRemove = `[data-testid="image-card-${secondId}"] .image-card__action--quiet`;
  await js(click(secondRemove));
  await waitFor(win, `Boolean(document.querySelector(".confirm-dialog"))`, "the remove question");
  const asked = await sample();
  checks.confirm = {
    title: asked.numbered.confirmTitle,
    message: asked.numbered.confirmMessage,
  };
  check("the question names the picture", /hills\.png/.test(asked.numbered.confirmMessage ?? ""), `message ${JSON.stringify(asked.numbered.confirmMessage)}`);
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
    `the dialog sits at ${JSON.stringify(box)} in ${JSON.stringify(viewport)}`,
  );
  await sleep(250);
  await capture(win, "delete-question");
  await js(click(".confirm-dialog__cancel"));
  await waitFor(win, `document.querySelectorAll('[data-testid^="image-card-"]').length === 2`, "Cancel to keep the picture");
  await js(click(secondRemove));
  await waitFor(win, `Boolean(document.querySelector(".confirm-dialog"))`, "the remove question again");
  await js(click(".confirm-dialog__confirm"));
  await waitFor(win, `document.querySelectorAll('[data-testid^="image-card-"]').length === 1`, "Confirm to remove the picture");
  const removed = await sample();
  checks.removed = {
    cards: removed.counts.cards,
    badge: removed.counts.badge,
    deleteWrites: removed.writes.filter((write) => write.op === "delete"),
    storedImages: removed.store?.images.length,
  };
  check("picture removed from the vault", removed.store?.images.length === 1, `vault still holds ${removed.store?.images.length}`);

  // ── 6. the board is on the Vision page, under the doctrine card ─────────
  await js(clickRail("Vision"));
  await waitFor(win, `window.imagesBoardRoute === "/vision"`, "the Vision route");
  await waitFor(win, `Boolean(document.querySelector('[data-testid="vision-board"]'))`, "the vision board");
  await waitFor(
    win,
    `document.querySelector('[data-testid="vision-board-status"]')?.textContent.trim() === "Saved"`,
    "the board to finish loading",
  );
  const vision = await sample();
  checks.visionPage = {
    route: vision.route,
    title: vision.visionTitle,
    doctrineHeading: vision.states.doctrineHeading,
    doctrineCardTitle: vision.states.doctrineCardTitle,
    doctrineCards: vision.counts.doctrineCards,
    boardHeading: vision.states.boardHeading,
    boardEmpty: vision.states.boardEmpty,
    boardPresent: vision.presence.board,
    libraryPresent: vision.presence.library,
  };
  check("vision route", vision.route === "/vision", `route ${JSON.stringify(vision.route)}`);
  check("vision page title", vision.visionTitle === "Vision", `title ${JSON.stringify(vision.visionTitle)}`);
  check(
    "doctrine card still on the page",
    vision.counts.doctrineCards === 1 && vision.states.doctrineCardTitle === "Vision & Desire",
    `cards ${JSON.stringify(vision.states.doctrineCardTitle)}`,
  );
  check("board heading", vision.states.boardHeading === "Vision board", `heading ${JSON.stringify(vision.states.boardHeading)}`);
  check("board empty state", /empty/i.test(vision.states.boardEmpty ?? ""), `board said ${JSON.stringify(vision.states.boardEmpty)}`);
  check("library not on the vision page", vision.presence.library === false, "the Vision page also drew the library");

  // ── 7. text, split with Enter, autosave ──────────────────────────────────
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
  };
  check("two text blocks", split.blocks.filter((block) => block.kind === "text").length === 2, `blocks ${JSON.stringify(split.blocks)}`);
  check("first sentence kept", split.blocks.filter((block) => block.kind === "text")[0]?.text === "A quiet house, morning light, and work that is mine.", `text ${JSON.stringify(split.blocks.filter((b) => b.kind === "text")[0]?.text)}`);
  check(
    "autosaved text",
    JSON.stringify((split.store?.blocks ?? []).filter((block) => block.kind === "text").map((block) => block.text)) ===
      JSON.stringify(split.blocks.filter((block) => block.kind === "text").map((block) => block.text)),
    `vault text ${JSON.stringify((split.store?.blocks ?? []).filter((block) => block.kind === "text").map((block) => block.text))}`,
  );

  // ── 8. heading and bullets, including a bullet Enter ─────────────────────
  await js(click('[data-testid="board-add-heading"]'));
  await waitFor(win, `document.querySelectorAll('[data-testid="block-heading"]').length === 1`, "the heading block");
  await js(setValue('[data-testid="block-heading"]', "The life I'm reaching for"));
  await js(click('[data-testid="board-add-bullets"]'));
  await waitFor(win, `document.querySelectorAll('[data-kind="bullets"]').length === 1`, "the bullets block");
  await js(setValue('[data-testid="block-bullet"]', "Walk before the house wakes"));
  await js(pressEnter('[data-testid="block-bullet"]'));
  await waitFor(win, `document.querySelectorAll('[data-testid="block-bullet"]').length === 2`, "a second bullet line");
  await js(`(() => {
    const els = document.querySelectorAll('[data-testid="block-bullet"]');
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

  // ── 9. the picture picker reads the Images library ──────────────────────
  await js(click('[data-testid="board-add-image"]'));
  await waitFor(win, `Boolean(document.querySelector('[data-testid="image-picker"]'))`, "the picture picker");
  const picker = await sample();
  checks.picker = { options: picker.states.pickerOptions, images: picker.store?.images.length };
  check("picker lists the library", picker.states.pickerOptions === 1, `picker offered ${picker.states.pickerOptions} pictures`);
  await js(click(`[data-testid="picker-image-${firstId}"]`));
  await waitFor(win, `document.querySelectorAll('[data-kind="image"]').length === 1`, "the picked image block");
  await waitFor(
    win,
    `(window.imagesBoardSnapshot().blocks.filter((block) => block.kind === "image")).length === 1`,
    "the picked image block to be saved",
  );
  await waitFor(
    win,
    `[...document.querySelectorAll('[data-kind="image"] img')].every((img) => img.complete && img.naturalWidth > 0)`,
    "the board picture to decode",
  );
  const picked = await sample();
  checks.picked = {
    imageBlocks: picked.blocks.filter((block) => block.kind === "image").length,
    pickerOpen: picked.counts.picker,
    imageIds: (picked.store?.blocks ?? []).filter((block) => block.kind === "image").map((block) => block.imageId),
  };
  check("picker closed after choosing", picked.counts.picker === 0, `picker still open: ${picked.counts.picker}`);
  check(
    "picked picture is in the document",
    JSON.stringify(checks.picked.imageIds) === JSON.stringify([firstId]),
    `image ids ${JSON.stringify(checks.picked.imageIds)}`,
  );

  // ── 10. a picture dropped into the board uploads and inserts ────────────
  const droppedOnBoard = await js(dropPictures('[data-testid="vision-board"]', [COAST]));
  check("drop reached the board", droppedOnBoard === 1, `the drop expression returned ${JSON.stringify(droppedOnBoard)}`);
  await waitFor(win, `document.querySelectorAll('[data-kind="image"]').length === 2`, "the dropped picture block");
  await waitFor(
    win,
    `window.imagesBoardSnapshot().images.length === 2`,
    "the dropped picture to join the library",
  );
  await waitFor(win, `document.querySelector('[data-testid="vision-board-status"]')?.textContent.trim() === "Saved"`, "the autosave of the dropped picture");
  const droppedBoard = await sample();
  checks.boardDrop = {
    imageBlocks: droppedBoard.blocks.filter((block) => block.kind === "image").length,
    library: droppedBoard.store?.images.length,
    decoded: droppedBoard.pictures.inDocument,
    storedKinds: (droppedBoard.store?.blocks ?? []).map((block) => block.kind),
  };
  check("drop inserted a picture block", droppedBoard.blocks.filter((block) => block.kind === "image").length === 2, `kinds ${JSON.stringify(droppedBoard.blocks.map((block) => block.kind))}`);
  check("drop joined the library", droppedBoard.store?.images.length === 2, `library holds ${droppedBoard.store?.images.length}`);

  // ── 11. reorder and Backspace persist ────────────────────────────────────
  const headingBlockId = (droppedBoard.store?.blocks ?? []).find((block) => block.kind === "heading")?.id;
  check("heading block id", Boolean(headingBlockId), `no heading id in ${JSON.stringify((droppedBoard.store?.blocks ?? []).map((block) => block.kind))}`);
  await js(click(`[data-testid="vblock-${headingBlockId}"] [data-testid="block-move-up"]`));
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid="vision-board"] .vblock')[1]?.getAttribute("data-kind") === "heading"`,
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
    JSON.stringify(reordered.blocks.map((block) => block.kind)) === JSON.stringify(["text", "heading", "text", "bullets", "image", "image"]),
    `kinds after move ${JSON.stringify(reordered.blocks.map((block) => block.kind))}`,
  );
  check(
    "reorder persisted",
    JSON.stringify((reordered.store?.blocks ?? []).map((block) => block.kind)) === JSON.stringify(["text", "heading", "text", "bullets", "image", "image"]),
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
  check(
    "Backspace persisted",
    JSON.stringify(trimmed.blocks.map((block) => block.kind)) === JSON.stringify((trimmed.store?.blocks ?? []).map((block) => block.kind)),
    `screen ${JSON.stringify(trimmed.blocks.map((block) => block.kind))} / vault ${JSON.stringify((trimmed.store?.blocks ?? []).map((block) => block.kind))}`,
  );

  // ── 12. a refused autosave says so; Ctrl+S writes it ────────────────────
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
    error: refused.states.boardError,
  };
  check("refusal named", /refused/i.test(refused.states.boardError ?? ""), `error ${JSON.stringify(refused.states.boardError)}`);
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
  await js("document.querySelector('.shell__content')?.scrollTo(0, 0)");
  await sleep(250);
  await capture(win, "vision");

  // ── 13. deleting the picture leaves the board's block in place ──────────
  await js(clickRail("Images"));
  await waitFor(win, `window.imagesBoardRoute === "/images"`, "the Images route again");
  await waitFor(win, `document.querySelectorAll('[data-testid^="image-card-"]').length === 2`, "the library after the board drop");
  await js(click(`[data-testid="image-card-${firstId}"] .image-card__action--quiet`));
  await waitFor(win, `Boolean(document.querySelector(".confirm-dialog"))`, "the remove question for the used picture");
  await js(click(".confirm-dialog__confirm"));
  await waitFor(win, `document.querySelectorAll('[data-testid^="image-card-"]').length === 1`, "the used picture to leave the library");

  await js(clickRail("Vision"));
  await waitFor(win, `window.imagesBoardRoute === "/vision"`, "the Vision route after the delete");
  await waitFor(win, `Boolean(document.querySelector('[data-testid="vision-board"]'))`, "the board after returning");
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid="block-image-missing"]').length === 1`,
    "the board to draw the deleted picture as missing",
  );
  const missing = await sample();
  checks.missingPicture = {
    missingBlocks: missing.pictures.missingBlocks,
    blocks: missing.blocks.map((block) => block.kind),
    storedImages: missing.store?.images.length,
    storedKinds: (missing.store?.blocks ?? []).map((block) => block.kind),
  };
  check("board kept its block", missing.blocks.filter((block) => block.kind === "image").length === 2, `blocks ${JSON.stringify(missing.blocks.map((block) => block.kind))}`);
  check("deleted picture draws as missing", missing.pictures.missingBlocks === 1, `missing blocks ${missing.pictures.missingBlocks}`);
  check("the other picture still draws", missing.pictures.inDocument.length === 1, `decoded board pictures ${JSON.stringify(missing.pictures.inDocument)}`);

  // ── 14. no Save control, no bridge hole, no console error ───────────────
  const final = await sample();
  checks.final = {
    route: final.route,
    status: final.states.status,
    unexpected: final.unexpected,
    calls: final.calls.length,
    saveControls: final.numbered.saveControls,
    boardBlocks: final.blocks.length,
  };
  check("no Save control", final.numbered.saveControls === 0, `found ${final.numbered.saveControls} Save control(s)`);
  check("no unmodelled bridge call", final.unexpected.length === 0, `unmodelled: ${JSON.stringify(final.unexpected)}`);
  check("no console errors", consoleErrors.length === 0, `console errors: ${JSON.stringify(consoleErrors.slice(0, 4))}`);

  // ── 15. the narrow window keeps the library, still no board ─────────────
  const narrowWin = await openWindow(NARROW);
  const narrowJs = (expression) => narrowWin.webContents.executeJavaScript(expression, true);
  await narrowJs(dropPictures('[data-testid="images-studio"]', [MORNING]));
  await waitFor(narrowWin, `document.querySelectorAll('[data-testid^="image-card-"]').length === 1`, "the narrow library picture");
  await waitFor(narrowWin, `Boolean(document.querySelector('[data-testid="images-grid"]'))`, "the narrow gallery");
  const narrow = await narrowJs(SAMPLE);
  checks.narrow = {
    columns: narrow.layout.gridColumns,
    library: narrow.layout.library,
    board: narrow.presence.board,
    viewport: narrow.layout.viewport,
  };
  check(
    "narrow library still has no board",
    narrow.presence.board === 0,
    `the narrow Images page drew ${narrow.presence.board} vision board(s)`,
  );
  check(
    "narrow gallery reflows",
    (narrow.layout.gridColumns ?? "").trim().split(/\s+/).filter(Boolean).length === 1,
    `at 760 the gallery resolved to ${narrow.layout.gridColumns}`,
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
