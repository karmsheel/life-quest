/**
 * Drives the Life-Chain page's general capture surface — text, image and link —
 * in a real Electron window and writes `e2e/artifacts/chain-capture.json` plus
 * the `chain-capture-*.png` captures.
 *
 * Run with this checkout's dev server up:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> apps/desktop/tests/chain-capture-e2e.test.ts
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims, no eyeballing the app required. The
 * pictures are the operator-facing half: they show the shipped page with a real
 * uploaded image and a real link row.
 *
 * What this rig claims:
 *
 *  1. `/chain` is the shipped shell page: the rail marks Life-Chain, the page
 *     carries the capture box, the composer textarea and the image/link
 *     controls. Shift+Enter leaves the draft alone, Enter logs a text capture,
 *     and the row carries `data-attachment="text"` with the typed body.
 *  2. A real PNG dropped on the composer becomes a pending thumbnail that
 *     decodes (`naturalWidth > 0`). Typing a description and pressing Log hands
 *     the bridge `attachment.kind === "image"` with the actual bytes, the vault
 *     mints a `signal-chain/files/<uuid>.png` path for them, and the row paints
 *     the bytes back through `signalChainReadImage` at the picture's real size.
 *  3. An image-only capture (empty description) is allowed: the bridge receives
 *     `body: ""` with the image attachment, and the row paints the picture with
 *     no body line.
 *  4. The link control opens a URL field. Text that is not an absolute http(s)
 *     URL leaves an error and no chip; a valid URL becomes a chip that shows the
 *     host. A described link capture hands the bridge `attachment.kind ===
 *     "link"` with the URL unchanged, and the row paints an anchor with that
 *     href and `target="_blank"`.
 *  5. The seeded fixture rows — text, image and link — render on the shipped
 *     page, the seeded picture loading from bytes the bridge serves, the seeded
 *     link anchoring its URL.
 *  6. The composer clears after each capture; no unmodelled bridge call, no
 *     console error, and nothing spills horizontally past the window.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  a. The bridge is the only fake, and it records. Any method the page reaches
 *     that this rig does not model is named in `chainCaptureUnexpectedCalls` and
 *     fails the run — a page that silently renders an empty sheet is the failure
 *     this rig exists to catch.
 *  b. A dropped file is not bytes. The drop carries a real `File` decoded from
 *     the fixture's base64 PNG; a page that paints a filename or a placeholder
 *     never reaches `naturalWidth > 0` and fails.
 *  c. The write mutates only the harness's echo: `signalChainCreate` stores the
 *     record the next `signalChainList` answers with, so "the row is on the
 *     chain" is read back through the bridge, not off the page's own state.
 *  d. The vault lies about storing bytes: the row's picture can only decode if
 *     `signalChainReadImage` served the bytes this bridge kept under the path it
 *     minted. The report carries both the path and the byte count, and the test
 *     checks the row decoded at the fixture's real width.
 *  e. A wait resolves against state that was already true. Every wait is a
 *     predicate chosen to become true only after its action, and it names the
 *     last state it saw when it times out.
 *  f. The hidden window stops painting: `disable-backgrounding-occluded-windows`
 *     plus `backgroundThrottling: false` keep decodes and timers real.
 *  g. React 19 unmounts the tree when a component throws; the driver records
 *     console errors for exactly that and fails on them.
 *  h. Screenshots that are not the shipped page: every capture is taken from
 *     this window's `capturePage` after the page has painted, and the test
 *     refuses a capture under 20 KB (an empty sheet compresses to nothing).
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
// Its own profile: the shell persists dock/nav state in localStorage, and the
// other rigs share this cache. Sharing one makes a landing view depend on
// whichever rig ran last.
app.setPath("userData", path.join(artifactsDir, "userdata", "chain-capture"));

const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chain-capture.html";
const WIDE = { width: 1600, height: 950 };

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
 * Everything the report needs from the page, in one read. The picture
 * measurements are taken from the drawn `<img>`s rather than from the stub: a
 * blob URL that is made but never painted is the failure this rig is for.
 */
const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const q = (selector) => document.querySelector(selector);
  const imageOf = (root) => {
    if (!root) return { present: false, img: false };
    const img = root.tagName === "IMG" ? root : root.querySelector("img");
    if (!img) return { present: true, img: false };
    const src = img.getAttribute("src") || "";
    return {
      present: true,
      img: true,
      complete: img.complete === true,
      width: img.naturalWidth,
      height: img.naturalHeight,
      blob: src.indexOf("blob:") === 0,
      src: src.slice(0, 24),
    };
  };
  const rows = all('[data-testid="signal-row"]').map((row) => {
    const bodyEl =
      row.querySelector('[data-testid="signal-body"]') || row.querySelector(".signal-row__body");
    const linkEl = row.querySelector('[data-testid="signal-link"]');
    return {
      attachment: row.getAttribute("data-attachment"),
      body: bodyEl ? text(bodyEl) : null,
      bodyPresent: Boolean(bodyEl),
      text: text(row),
      image: imageOf(row.querySelector('[data-testid="signal-image"]')),
      link: linkEl
        ? {
            present: true,
            href: linkEl.getAttribute("href"),
            target: linkEl.getAttribute("target"),
            text: text(linkEl),
          }
        : { present: false },
    };
  });
  const composer = q('[data-testid="chain-composer"]');
  const pending = q('[data-testid="chain-pending-image"]');
  const chip = q('[data-testid="chain-link-chip"]');
  const logButton = all("button").find((button) => text(button) === "Log") || null;
  const fileInput = q('[data-testid="chain-file-input"]');
  const textarea = q('[aria-label="Log a signal"]');
  const activeLink = q(".nav-rail__link--active");
  const rail = all(".nav-rail__link").map((link) => ({
    label: text(link.querySelector(".nav-rail__label")),
    href: link.getAttribute("href"),
  }));
  const box = (el) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  const counts = { rows: rows.length };
  for (const row of rows) {
    const key = row.attachment || "none";
    counts[key] = (counts[key] || 0) + 1;
  }
  return {
    route: window.chainCaptureRoute ?? null,
    skin: window.chainCaptureSkin ?? null,
    ready: window.chainCaptureReady === true,
    rail,
    activeRail: text(activeLink && activeLink.querySelector(".nav-rail__label")),
    presence: {
      rail: Boolean(q(".nav-rail")),
      page: Boolean(q(".signal-chain")),
      composer: Boolean(composer),
      composerBox: box(composer),
      textarea: Boolean(textarea),
      attachImage: Boolean(q('[data-testid="chain-attach-image"]')),
      fileInput: Boolean(fileInput),
      attachLink: Boolean(q('[data-testid="chain-attach-link"]')),
      log: Boolean(logButton),
    },
    fileInput: fileInput
      ? {
          present: true,
          type: fileInput.getAttribute("type"),
          accept: fileInput.getAttribute("accept"),
          hidden: fileInput.hidden === true,
          display: getComputedStyle(fileInput).display,
        }
      : { present: false },
    textarea: textarea
      ? {
          value: textarea.value,
          disabled: textarea.disabled === true,
          focused: document.activeElement === textarea,
        }
      : null,
    log: logButton ? { label: text(logButton), disabled: logButton.disabled === true } : null,
    pending: {
      count: all('[data-testid="chain-pending-image"]').length,
      image: imageOf(pending),
      remove: Boolean(q('[aria-label="Remove the attached image"]')),
    },
    link: {
      input: Boolean(q('[aria-label="Link URL"]')),
      // The contract names [data-testid="chain-link-add"]; the shipped button
      // also says "Add link", which the rig falls back to and reports, so a
      // missing testid is a contract failure rather than a hidden behaviour.
      add: Boolean(q('[data-testid="chain-link-add"]')),
      addTestId: Boolean(q('[data-testid="chain-link-add"]')),
      addByLabel: Boolean(
        all("button").find((button) => text(button) === "Add link"),
      ),
      remove: Boolean(q('[aria-label="Remove the attached link"]')),
      chip: chip
        ? {
            present: true,
            text: text(chip),
            title: chip.getAttribute("title"),
          }
        : { present: false },
      error: text(q('[data-testid="chain-link-error"]')),
    },
    rows,
    counts,
    // The shipped composer keeps one attachment per capture: each control is
    // disabled by the other attachment being present, so the rig reads both.
    attach: {
      image: (() => {
        const button = q('[data-testid="chain-attach-image"]');
        return button
          ? {
              present: true,
              disabled:
                button.disabled === true ||
                button.getAttribute("aria-disabled") === "true",
            }
          : { present: false, disabled: false };
      })(),
      link: (() => {
        const button = q('[data-testid="chain-attach-link"]');
        return button
          ? {
              present: true,
              disabled:
                button.disabled === true ||
                button.getAttribute("aria-disabled") === "true",
            }
          : { present: false, disabled: false };
      })(),
    },
    // The dock's own Life-Chain surface, which renders the same records.
    dock: {
      surface: q(".chat-panel")
        ? q(".chat-panel").getAttribute("data-chat-surface")
        : null,
      action: Boolean(q('.chat-panel [aria-label="Life-Chain"]')),
      items: all(".chat-panel__chain-item").map((item) => {
        const linkEl = item.querySelector(".chat-panel__chain-link");
        return {
          body: text(item.querySelector(".chat-panel__chain-body")),
          image: imageOf(item.querySelector(".chat-panel__chain-image")),
          link: linkEl
            ? {
                present: true,
                href: linkEl.getAttribute("href"),
                target: linkEl.getAttribute("target"),
              }
            : { present: false },
        };
      }),
    },
    creates: window.chainCaptureCreates ?? [],
    reads: window.chainCaptureReads ?? [],
    updates: window.chainCaptureUpdates ?? [],
    deletes: window.chainCaptureDeletes ?? [],
    calls: (window.chainCaptureCalls ?? []).slice(),
    unexpected: (window.chainCaptureUnexpectedCalls ?? []).slice(),
    store: window.chainCaptureSnapshot ? window.chainCaptureSnapshot() : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
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

/** A React-controlled field, set the way a user's typing would. */
const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;

/**
 * Switch the dock to its chain surface. The rail carries a Life-Chain link with
 * the same accessible name, so the click is scoped to the chat panel's action
 * bar; clicking the rail row would only stay on the page.
 */
const clickDockChain = `(() => {
  const el = document.querySelector('.chat-panel [aria-label="Life-Chain"]');
  if (!el) return false;
  el.click();
  return true;
})()`;

const click = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.click();
  return true;
})()`;

/** Click the control carrying this accessible name. */
const clickAria = (label) => `(() => {
  const el = Array.from(document.querySelectorAll("[aria-label]")).find(
    (node) => node.getAttribute("aria-label") === ${JSON.stringify(label)},
  );
  if (!el) return false;
  el.click();
  return true;
})()`;

/** Click the button whose visible text is exactly this label. */
const clickText = (label) => `(() => {
  const el = Array.from(document.querySelectorAll("button")).find(
    (button) => (button.textContent || "").trim() === ${JSON.stringify(label)},
  );
  if (!el) return false;
  el.click();
  return true;
})()`;

/**
 * Add the typed link. The selector contract names
 * `[data-testid="chain-link-add"]`; the shipped button also carries the visible
 * label "Add link". The rig prefers the contract selector and falls back to the
 * label, reporting which one it used, so a missing testid fails the contract
 * check without making the behaviour unprovable.
 */
const clickLinkAdd = `(() => {
  const byTestId = document.querySelector('[data-testid="chain-link-add"]');
  if (byTestId) {
    byTestId.click();
    return "testid";
  }
  const byLabel = Array.from(document.querySelectorAll("button")).find(
    (button) => (button.textContent || "").trim() === "Add link",
  );
  if (!byLabel) return false;
  byLabel.click();
  return "label";
})()`;

const pressEnter = (selector, shift = false) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: ${shift},
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
})()`;

/**
 * Drop a real PNG on a target: the bytes are decoded from the fixture's base64
 * and wrapped in a genuine `File`, so the page's own file handling runs.
 */
const dropPng = (targetSelector) => `(async () => {
  const base64 = window.chainCaptureImageBase64;
  if (!base64) return "no fixture picture";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const image = window.chainCaptureImage;
  const file = new File([bytes], image.name, { type: image.mime });
  const data = new DataTransfer();
  data.items.add(file);
  const target = document.querySelector(${JSON.stringify(targetSelector)});
  if (!target) return "no drop target";
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }
  return true;
})()`;

/**
 * Pick a real PNG the way the OS file dialog does: put a `File` on the hidden
 * input and fire the event React listens for. This is the path the Image control
 * opens; no dialog is ever shown to a hidden window.
 */
const pickPng = `(() => {
  const input = document.querySelector('[data-testid="chain-file-input"]');
  if (!input) return "no file input";
  const base64 = window.chainCaptureImageBase64;
  if (!base64) return "no fixture picture";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const image = window.chainCaptureImage;
  const file = new File([bytes], image.name, { type: image.mime });
  const data = new DataTransfer();
  data.items.add(file);
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: WIDE.width,
    height: WIDE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(WIDE.width, WIDE.height);

  // Console errors are the failure mode a broken selector cannot report: React 19
  // unmounts the tree on a throw, and the page would then be an empty sheet that
  // every "is it absent?" check passes.
  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const js = (expression) => win.webContents.executeJavaScript(expression, true);
  const sample = () => js(SAMPLE);
  const screenshots = [];
  const checks = {};

  /**
   * Poll the page state for a predicate, and name the predicate that never came
   * true. A fixed sleep reads as a product bug when it is only a slow render, so
   * every wait carries its own deadline and its last observed state.
   */
  async function waitState(predicate, label, timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await sample();
      } catch (error) {
        last = { sampleError: String(error) };
      }
      if (predicate(last)) return last;
      await sleep(100);
    }
    fail(
      `wait: ${label} never became true within ${timeoutMs}ms (last ${JSON.stringify(last).slice(0, 700)})`,
    );
    return last;
  }

  async function capture(name) {
    fs.mkdirSync(artifactsDir, { recursive: true });
    const file = path.join(artifactsDir, `chain-capture-${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    screenshots.push({ name: path.basename(file), file, bytes: fs.statSync(file).size });
    return file;
  }

  const rowWithBody = (state, body) =>
    (state.rows || []).find((row) => ((row.body ?? row.text) ?? "").includes(body)) ?? null;

  try {
    await win.loadURL(url);
    win.showInactive();
    await waitFor(win, "Boolean(window.chainCaptureReady)", "chainCaptureReady", 30_000);

    const expected = await js("window.chainCaptureExpected");
    const expectedImage = await js("window.chainCaptureImage");
    checks.expected = expected;

    // ── 1. the shipped page and its composer ────────────────────────────────
    const landing = await sample();
    checks.page = {
      route: landing.route,
      skin: landing.skin,
      activeRail: landing.activeRail,
      rail: landing.rail,
      presence: landing.presence,
      fileInput: landing.fileInput,
    };
    check("chain route", landing.route === "/chain", `route is ${JSON.stringify(landing.route)}`);
    check(
      "the rail marks Life-Chain",
      landing.activeRail === "Life-Chain",
      `active rail row is ${JSON.stringify(landing.activeRail)}`,
    );
    check(
      "the rail carries the chain row",
      landing.rail.some((item) => item.label === "Life-Chain" && item.href === "/chain"),
      `rail is ${JSON.stringify(landing.rail)}`,
    );
    check("the chain page is up", landing.presence.page, "no .signal-chain on the page");
    check("the composer is the shipped one", landing.presence.composer, "no [data-testid=chain-composer]");
    check(
      "the composer has its textarea",
      landing.presence.textarea && landing.textarea !== null,
      `textarea ${JSON.stringify(landing.textarea)}`,
    );
    check("the image control is up", landing.presence.attachImage, "no [data-testid=chain-attach-image]");
    check("the link control is up", landing.presence.attachLink, "no [data-testid=chain-attach-link]");
    check("the Log control is up", landing.presence.log, "no button labelled Log");
    check(
      "the file input is a hidden image picker",
      landing.fileInput.present && landing.fileInput.type === "file",
      `file input ${JSON.stringify(landing.fileInput)}`,
    );
    check(
      "the seeded chain is the fixture",
      landing.counts.rows === expected.seeded.count,
      `${landing.counts.rows} rows vs ${expected.seeded.count} seeded`,
    );
    // The seeded picture is only a relPath in the fixture until the row reads
    // its bytes back through `signalChainReadImage`; wait for the decode so the
    // first capture shows a real picture rather than its placeholder.
    const seededPainted = await waitState(
      (state) =>
        state.rows.some(
          (row) => row.attachment === "image" && (row.image?.width ?? 0) > 0,
        ),
      "the seeded fixture picture to decode",
    );
    check(
      "the seeded picture paints on load",
      seededPainted.rows.some(
        (row) => row.attachment === "image" && (row.image?.width ?? 0) > 0,
      ),
      `seeded image rows ${JSON.stringify(
        seededPainted.rows.filter((row) => row.attachment === "image").map((row) => row.image),
      )}`,
    );
    await sleep(250);
    await capture("seeded");

    // ── 2. Shift+Enter keeps the draft; Enter logs a text capture ───────────
    await js(setValue('[aria-label="Log a signal"]', "a draft line"));
    await js(pressEnter('[aria-label="Log a signal"]', true));
    await sleep(300);
    const afterShift = await sample();
    checks.shiftEnter = {
      creates: afterShift.creates.length,
      value: afterShift.textarea?.value,
    };
    check(
      "Shift+Enter does not log",
      afterShift.creates.length === 0,
      `the bridge saw ${afterShift.creates.length} create(s)`,
    );
    check(
      "Shift+Enter leaves the draft in the field",
      (afterShift.textarea?.value ?? "") === "a draft line",
      `field holds ${JSON.stringify(afterShift.textarea?.value)}`,
    );

    await js(setValue('[aria-label="Log a signal"]', "line one\nline two"));
    await js(pressEnter('[aria-label="Log a signal"]'));
    const textLogged = await waitState(
      (state) =>
        state.creates.length === 1 && state.counts.rows === expected.seeded.count + 1,
      "Enter to log the text capture",
    );
    const textCreate = textLogged.creates[0];
    const textRow = textLogged.rows[0];
    checks.textCapture = {
      create: textCreate,
      row: textRow,
    };
    check(
      "Enter logged one signal",
      textLogged.creates.length === 1,
      `the bridge saw ${JSON.stringify(textLogged.creates)}`,
    );
    check(
      "the text capture carried the typed body",
      textCreate?.body === "line one\nline two",
      `body ${JSON.stringify(textCreate?.body)}`,
    );
    check(
      "the text capture carried no attachment",
      textCreate?.attachment === null,
      `attachment ${JSON.stringify(textCreate?.attachment)}`,
    );
    check(
      "the text row is marked text",
      textRow?.attachment === "text",
      `row attachment ${JSON.stringify(textRow?.attachment)}`,
    );
    check(
      "the text row paints the body",
      (textRow?.body ?? "").includes("line one") && (textRow?.body ?? "").includes("line two"),
      `row body ${JSON.stringify(textRow?.body)}`,
    );
    check(
      "the composer cleared after the text capture",
      textLogged.textarea?.value === "" && textLogged.log?.disabled === true,
      `field ${JSON.stringify(textLogged.textarea)}, log ${JSON.stringify(textLogged.log)}`,
    );
    await sleep(250);
    await capture("text");

    // ── 3. a real PNG dropped on the composer, with a description ──────────
    const imageDescription = "The lamp I want on the desk before winter.";
    const dropTarget = '[data-testid="chain-composer"]';
    const dropped = await js(dropPng(dropTarget));
    check("the drop reached the composer", dropped === true, `drop returned ${JSON.stringify(dropped)}`);
    const pending = await waitState(
      (state) => state.pending.count === 1 && (state.pending.image?.width ?? 0) > 0,
      "the pending thumbnail to decode",
    );
    checks.pending = {
      count: pending.pending.count,
      image: pending.pending.image,
      remove: pending.pending.remove,
    };
    check(
      "the dropped picture becomes a pending thumbnail",
      pending.pending.count === 1,
      `${pending.pending.count} pending pictures`,
    );
    check(
      "the pending thumbnail decodes at its real size",
      pending.pending.image?.width === expectedImage.width &&
        pending.pending.image?.height === expectedImage.height,
      `decoded ${JSON.stringify(pending.pending.image)} vs fixture ${JSON.stringify(expectedImage)}`,
    );
    check(
      "the pending image has its remove control",
      pending.pending.remove,
      "no [aria-label=Remove the attached image]",
    );
    checks.exclusivity = {
      linkDisabledWithPicture: pending.attach.link.disabled === true,
    };
    check(
      "the Link control is disabled while a picture is pending",
      pending.attach.link.disabled === true,
      `link control ${JSON.stringify(pending.attach.link)}`,
    );

    // The remove control clears the picture, and a fresh drop puts it back: the
    // capture path below is exercised on an attachment the operator re-chose.
    await js(clickAria("Remove the attached image"));
    const removedImage = await waitState(
      (state) => state.pending.count === 0,
      "the pending image to be removed",
    );
    check(
      "removing the pending image clears it",
      removedImage.pending.count === 0,
      `still ${removedImage.pending.count} pending picture(s)`,
    );
    await js(dropPng(dropTarget));
    await waitState(
      (state) => state.pending.count === 1 && (state.pending.image?.width ?? 0) > 0,
      "the re-dropped thumbnail to decode",
    );

    await js(setValue('[aria-label="Log a signal"]', imageDescription));
    await waitState(
      (state) => state.log !== null && state.log.disabled === false,
      "Log to arm with a described image attached",
    );
    // The capture gesture itself: the preview above the box, the typed
    // description below it, before the write. This is the state the operator
    // sees, not only the finished row.
    await sleep(250);
    await capture("pending");
    await js(clickText("Log"));
    await waitState(
      (state) =>
        state.creates.length === 2 && state.counts.rows === expected.seeded.count + 2,
      "the described image capture to land on the chain",
    );
    const imageLogged = await waitState(
      (state) =>
        state.rows.some(
          (row) =>
            (row.body ?? "").includes(imageDescription) && (row.image?.width ?? 0) > 0,
        ),
      "the uploaded image row to decode its picture",
    );
    const imageCreate = imageLogged.creates[1];
    const imageRow = rowWithBody(imageLogged, imageDescription);
    const imageRelPath = imageCreate?.attachment?.relPath;
    checks.imageCapture = {
      create: imageCreate,
      row: imageRow,
      reads: imageLogged.reads,
      bytes: imageLogged.store?.bytes,
    };
    check(
      "the bridge received an image attachment",
      imageCreate?.attachment?.kind === "image",
      `attachment ${JSON.stringify(imageCreate?.attachment)}`,
    );
    check(
      "the bridge received the image bytes",
      (imageCreate?.attachment?.byteLength ?? 0) > 1_000,
      `byte length ${JSON.stringify(imageCreate?.attachment?.byteLength)}`,
    );
    check(
      "the image keeps the uploaded name",
      imageCreate?.attachment?.name === expectedImage.name,
      `name ${JSON.stringify(imageCreate?.attachment?.name)} vs ${JSON.stringify(expectedImage.name)}`,
    );
    check(
      "the vault minted a signal-chain path for the bytes",
      typeof imageRelPath === "string" &&
        /^\.lifequest\/signal-chain\/files\/[0-9a-f-]+\.(png|jpg|gif|webp)$/.test(
          imageRelPath,
        ),
      `path ${JSON.stringify(imageRelPath)}`,
    );
    check(
      "the vault stored the bytes it minted a path for",
      Boolean(imageRelPath) &&
        imageLogged.store?.bytes?.[imageRelPath] === imageCreate?.attachment?.byteLength,
      `stored ${JSON.stringify(imageLogged.store?.bytes)} for ${JSON.stringify(imageRelPath)}`,
    );
    check(
      "the row read its picture back through the bridge",
      Boolean(imageRelPath) && (imageLogged.reads ?? []).includes(imageRelPath),
      `reads ${JSON.stringify(imageLogged.reads)}`,
    );
    check(
      "the image row paints the stored picture at its real size",
      imageRow?.image?.width === expectedImage.width &&
        imageRow?.image?.height === expectedImage.height &&
        imageRow?.image?.blob === true,
      `row image ${JSON.stringify(imageRow?.image)}`,
    );
    check(
      "the image row paints the description",
      (imageRow?.body ?? "").includes(imageDescription),
      `row body ${JSON.stringify(imageRow?.body)}`,
    );
    check(
      "the row is marked image",
      imageRow?.attachment === "image",
      `row attachment ${JSON.stringify(imageRow?.attachment)}`,
    );
    check(
      "the image capture cleared the composer",
      imageLogged.pending.count === 0 &&
        imageLogged.textarea?.value === "" &&
        imageLogged.log?.disabled === true,
      `pending ${imageLogged.pending.count}, field ${JSON.stringify(imageLogged.textarea)}`,
    );
    await sleep(250);
    await capture("image");

    // ── 4. image-only capture: an empty description is allowed ─────────────
    const picked = await js(pickPng);
    check("the picker handed the page a file", picked === true, `picker returned ${JSON.stringify(picked)}`);
    await waitState(
      (state) => state.pending.count === 1 && (state.pending.image?.width ?? 0) > 0,
      "the picked thumbnail to decode",
    );
    const onlyArmed = await waitState(
      (state) => state.log !== null && state.log.disabled === false,
      "Log to arm with only an image attached",
    );
    check(
      "an image alone arms Log",
      onlyArmed.log?.disabled === false && onlyArmed.textarea?.value === "",
      `log ${JSON.stringify(onlyArmed.log)}, field ${JSON.stringify(onlyArmed.textarea)}`,
    );
    await js(clickText("Log"));
    await waitState(
      (state) =>
        state.creates.length === 3 && state.counts.rows === expected.seeded.count + 3,
      "the image-only capture to land on the chain",
    );
    const onlyLogged = await waitState(
      (state) =>
        state.counts.rows === expected.seeded.count + 3 &&
        state.rows.some(
          (row) =>
            row.attachment === "image" &&
            (row.body ?? "") === "" &&
            (row.image?.width ?? 0) > 0,
        ),
      "the image-only row to decode its picture",
    );
    const onlyCreate = onlyLogged.creates[2];
    const onlyRow = onlyLogged.rows[0];
    const onlyRelPath = onlyCreate?.attachment?.relPath;
    checks.imageOnly = {
      create: onlyCreate,
      row: onlyRow,
      bytes: onlyLogged.store?.bytes,
    };
    check(
      "the image-only capture carried an empty body",
      onlyCreate?.body === "",
      `body ${JSON.stringify(onlyCreate?.body)}`,
    );
    check(
      "the image-only capture carried the image attachment",
      onlyCreate?.attachment?.kind === "image" &&
        (onlyCreate?.attachment?.byteLength ?? 0) > 1_000,
      `attachment ${JSON.stringify(onlyCreate?.attachment)}`,
    );
    check(
      "the image-only capture stored its own bytes",
      Boolean(onlyRelPath) &&
        onlyRelPath !== imageRelPath &&
        onlyLogged.store?.bytes?.[onlyRelPath] === onlyCreate?.attachment?.byteLength,
      `path ${JSON.stringify(onlyRelPath)}, bytes ${JSON.stringify(onlyLogged.store?.bytes)}`,
    );
    check(
      "the image-only row paints the picture",
      onlyRow?.attachment === "image" && onlyRow?.image?.width === expectedImage.width,
      `row ${JSON.stringify({ attachment: onlyRow?.attachment, image: onlyRow?.image })}`,
    );
    check(
      "the image-only row paints no body line",
      (onlyRow?.body ?? "") === "",
      `row body ${JSON.stringify(onlyRow?.body)} (element present: ${onlyRow?.bodyPresent})`,
    );
    await sleep(250);
    await capture("image-only");

    // ── 5. the link control: refusal, chip, and a link capture ─────────────
    const linkUrl = "https://www.are.na/editorial/attention";
    const linkDescription = "What attention costs, and what it buys.";
    await js(click('[data-testid="chain-attach-link"]'));
    const linkOpen = await waitState(
      (state) => state.link.input === true && state.link.add === true,
      "the link URL field to open",
    );
    checks.linkField = {
      input: linkOpen.link.input,
      add: linkOpen.link.add,
      addTestId: linkOpen.link.addTestId,
    };
    check(
      "the link control opens a URL field and an Add control",
      linkOpen.link.input && linkOpen.link.add,
      `link ${JSON.stringify(linkOpen.link)}`,
    );

    await js(setValue('[aria-label="Link URL"]', "ftp://example.com/file"));
    const refusedAdd = await js(clickLinkAdd);
    const linkRefused = await waitState(
      (state) => (state.link.error ?? "") !== "" && state.link.chip.present === false,
      "the invalid URL error",
    );
    checks.linkRefused = {
      error: linkRefused.link.error,
      chip: linkRefused.link.chip,
      creates: linkRefused.creates.length,
    };
    check(
      "an invalid URL leaves an error",
      (linkRefused.link.error ?? "").length > 0,
      `error ${JSON.stringify(linkRefused.link.error)}`,
    );
    check(
      "an invalid URL leaves no chip",
      linkRefused.link.chip.present === false,
      `chip ${JSON.stringify(linkRefused.link.chip)}`,
    );
    check(
      "an invalid URL writes nothing",
      linkRefused.creates.length === 3,
      `the bridge saw ${linkRefused.creates.length} create(s)`,
    );

    await js(setValue('[aria-label="Link URL"]', linkUrl));
    const chippedAdd = await js(clickLinkAdd);
    const linkChipped = await waitState(
      (state) => state.link.chip.present === true,
      "the link chip",
    );
    checks.linkChip = {
      chip: linkChipped.link.chip,
      error: linkChipped.link.error,
      // Which control actually added the link: the contracted testid, or the
      // visible-label fallback. A contract-exact run says "testid" for all three.
      addControl: chippedAdd === "testid" ? "testid" : String(chippedAdd),
      addClicks: [refusedAdd, chippedAdd],
    };
    check(
      "the Add control is the contracted [data-testid=chain-link-add]",
      linkOpen.link.addTestId === true &&
        refusedAdd === "testid" &&
        chippedAdd === "testid",
      `addTestId ${JSON.stringify(linkOpen.link.addTestId)}, clicks ${JSON.stringify([refusedAdd, chippedAdd])}`,
    );
    check(
      "a valid URL becomes a chip that shows the host",
      (linkChipped.link.chip?.text ?? "").includes("are.na"),
      `chip ${JSON.stringify(linkChipped.link.chip)}`,
    );
    check(
      "a valid URL is not an error",
      (linkChipped.link.error ?? "") === "",
      `error ${JSON.stringify(linkChipped.link.error)}`,
    );
    checks.exclusivity.imageDisabledWithLink =
      linkChipped.attach.image.disabled === true;
    check(
      "the Image control is disabled while a link chip is attached",
      linkChipped.attach.image.disabled === true,
      `image control ${JSON.stringify(linkChipped.attach.image)}`,
    );

    // Remove and re-add through the operator's own controls, so the remove arm of
    // the contract is exercised before the capture that follows.
    await js(clickAria("Remove the attached link"));
    const linkRemoved = await waitState(
      (state) => state.link.chip.present === false,
      "the link chip to be removed",
    );
    check(
      "the remove control detaches the link",
      linkRemoved.link.chip.present === false,
      `chip ${JSON.stringify(linkRemoved.link.chip)}`,
    );
    if (!linkRemoved.link.input) {
      await js(click('[data-testid="chain-attach-link"]'));
      await waitState((state) => state.link.input === true, "the URL field to reopen");
    }
    await js(setValue('[aria-label="Link URL"]', linkUrl));
    const readdedAdd = await js(clickLinkAdd);
    checks.linkReadd = { addControl: String(readdedAdd) };
    check(
      "the Add control is the testid on the re-add too",
      readdedAdd === "testid",
      `re-add clicked by ${JSON.stringify(readdedAdd)}`,
    );
    await waitState((state) => state.link.chip.present === true, "the link chip to come back");

    await js(setValue('[aria-label="Log a signal"]', linkDescription));
    await waitState(
      (state) => state.log !== null && state.log.disabled === false,
      "Log to arm with a described link attached",
    );
    await js(clickText("Log"));
    const linkLogged = await waitState(
      (state) =>
        state.creates.length === 4 && state.counts.rows === expected.seeded.count + 4,
      "the link capture to land on the chain",
    );
    const linkCreate = linkLogged.creates[3];
    const linkRow = rowWithBody(linkLogged, linkDescription);
    checks.linkCapture = {
      create: linkCreate,
      row: linkRow,
    };
    check(
      "the bridge received a link attachment",
      linkCreate?.attachment?.kind === "link",
      `attachment ${JSON.stringify(linkCreate?.attachment)}`,
    );
    check(
      "the link reached the bridge unchanged",
      linkCreate?.attachment?.url === linkUrl,
      `url ${JSON.stringify(linkCreate?.attachment?.url)} vs ${JSON.stringify(linkUrl)}`,
    );
    check(
      "the link capture carried the description",
      linkCreate?.body === linkDescription,
      `body ${JSON.stringify(linkCreate?.body)}`,
    );
    check(
      "the link row is marked link",
      linkRow?.attachment === "link",
      `row attachment ${JSON.stringify(linkRow?.attachment)}`,
    );
    check(
      "the link row anchors the URL",
      linkRow?.link?.href === linkUrl,
      `anchor ${JSON.stringify(linkRow?.link)}`,
    );
    check(
      "the link anchor opens externally",
      linkRow?.link?.target === "_blank",
      `target ${JSON.stringify(linkRow?.link?.target)}`,
    );
    check(
      "the link row paints the description",
      (linkRow?.body ?? "").includes(linkDescription),
      `row body ${JSON.stringify(linkRow?.body)}`,
    );
    check(
      "the link capture cleared the composer",
      linkLogged.link.chip.present === false &&
        linkLogged.link.input === false &&
        linkLogged.textarea?.value === "" &&
        linkLogged.log?.disabled === true,
      `link ${JSON.stringify(linkLogged.link)}, field ${JSON.stringify(linkLogged.textarea)}`,
    );
    await sleep(250);
    await capture("link");

    // ── 6. the seeded fixture rows, and the run's hygiene ──────────────────
    const final = await sample();
    const seededImageRow = final.rows.find(
      (row) => row.attachment === "image" && (row.body ?? "").includes(expected.seeded.imageBody),
    );
    const seededLinkRow = final.rows.find(
      (row) => row.attachment === "link" && (row.body ?? "").includes(expected.seeded.linkBody),
    );
    const seededTextRow = final.rows.find(
      (row) => row.attachment === "text" && (row.body ?? "").includes(expected.seeded.textBody),
    );
    checks.seeded = {
      imageRow: seededImageRow,
      linkRow: seededLinkRow,
      textRow: seededTextRow,
      reads: final.reads,
      bytes: final.store?.bytes,
    };
    check(
      "the seeded text row renders",
      Boolean(seededTextRow),
      `no seeded text row in ${JSON.stringify(final.rows.map((row) => row.attachment))}`,
    );
    check(
      "the seeded image row paints its bytes",
      seededImageRow?.image?.width === expectedImage.width,
      `seeded image ${JSON.stringify(seededImageRow?.image)}`,
    );
    check(
      "the seeded link row anchors its URL",
      seededLinkRow?.link?.href === expected.seeded.linkUrl &&
        seededLinkRow?.link?.target === "_blank",
      `seeded link ${JSON.stringify(seededLinkRow?.link)}`,
    );
    check(
      "the seeded image was served by the bridge",
      (final.reads ?? []).includes(expected.seeded.imageRelPath),
      `reads ${JSON.stringify(final.reads)}`,
    );

    checks.final = {
      route: final.route,
      rows: final.counts.rows,
      counts: final.counts,
      creates: final.creates.length,
      reads: final.reads,
      calls: final.calls.length,
      unexpected: final.unexpected,
      viewport: final.viewport,
      overflow: final.overflow,
      screenshots: screenshots.map((shot) => ({ name: shot.name, bytes: shot.bytes })),
    };
    check(
      "every capture is on the chain",
      final.counts.rows === expected.seeded.count + 4,
      `${final.counts.rows} rows vs ${expected.seeded.count + 4}`,
    );
    check(
      "the page is still the shipped chain page",
      final.route === "/chain" && final.presence.page,
      `route ${JSON.stringify(final.route)}`,
    );
    check(
      "no unmodelled bridge call",
      (final.unexpected ?? []).length === 0,
      `unmodelled: ${JSON.stringify(final.unexpected)}`,
    );
    check(
      "no console errors",
      consoleErrors.length === 0,
      `console errors: ${JSON.stringify(consoleErrors.slice(0, 4))}`,
    );
    check(
      "nothing spills past the window",
      final.overflow.scrollWidth <= final.overflow.clientWidth,
      `${final.overflow.scrollWidth}px vs ${final.overflow.clientWidth}px`,
    );
    for (const shot of screenshots) {
      check(
        `capture ${shot.name} is a real picture`,
        shot.bytes > 20_000,
        `${shot.bytes} bytes`,
      );
    }

    // ── 7. the dock's Life-Chain view paints the same attachments ──────────
    // The page is the capture surface; the dock is the second surface the same
    // records appear on, so a picture or a link written here has to draw there
    // too. The dock's own chain read happens when the surface opens.
    const dockClicked = await js(clickDockChain);
    const dockChain = await waitState(
      (state) =>
        state.dock.surface === "chain" &&
        state.dock.items.length === expected.seeded.count + 4,
      "the dock's chain surface to list the chain",
    );
    check(
      "the dock switches to its chain surface",
      dockChain.dock.surface === "chain",
      `surface ${JSON.stringify(dockChain.dock.surface)}`,
    );
    check(
      "the dock lists the same chain",
      dockChain.dock.items.length === expected.seeded.count + 4,
      `${dockChain.dock.items.length} rows vs ${expected.seeded.count + 4}`,
    );
    // The seeded picture is the oldest attachment, so scroll the dock's chain
    // list back to its top before waiting: a lazy `<img>` below the fold is not
    // a missing picture, and measuring one would be a false failure.
    await js(`(() => {
      const el = document.querySelector(".chat-panel__body--chain");
      if (!el) return false;
      el.scrollTop = 0;
      return true;
    })()`);
    await sleep(300);
    const dockPainted = await waitState(
      (state) =>
        state.dock.items.some(
          (item) =>
            (item.body ?? "").includes(expected.seeded.imageBody) &&
            (item.image?.width ?? 0) > 0,
        ) &&
        state.dock.items.some(
          (item) =>
            item.link.present && item.link.href === expected.seeded.linkUrl,
        ),
      "the dock's chain picture to decode and its link to anchor",
    );
    const dockImageItem = dockPainted.dock.items.find(
      (item) =>
        (item.body ?? "").includes(expected.seeded.imageBody) &&
        (item.image?.width ?? 0) > 0,
    );
    const dockLinkItem = dockPainted.dock.items.find(
      (item) => item.link.present && item.link.href === expected.seeded.linkUrl,
    );
    checks.dock = {
      clicked: dockClicked === true,
      surface: dockPainted.dock.surface,
      action: dockPainted.dock.action,
      items: dockPainted.dock.items.length,
      seededImage: dockImageItem?.image ?? null,
      seededLink: dockLinkItem?.link ?? null,
      bodies: dockPainted.dock.items.map((item) => item.body),
    };
    check(
      "the dock paints the seeded picture",
      (dockImageItem?.image.width ?? 0) === expectedImage.width,
      `dock image ${JSON.stringify(dockImageItem?.image)}`,
    );
    check(
      "the dock anchors the seeded link",
      dockLinkItem?.link.href === expected.seeded.linkUrl &&
        dockLinkItem?.link.target === "_blank",
      `dock link ${JSON.stringify(dockLinkItem?.link)}`,
    );
    await sleep(250);
    await capture("dock");
    check(
      "capture chain-capture-dock.png is a real picture",
      fs.statSync(path.join(artifactsDir, "chain-capture-dock.png")).size > 20_000,
      `${fs.statSync(path.join(artifactsDir, "chain-capture-dock.png")).size} bytes`,
    );

    // ── report ─────────────────────────────────────────────────────────────
    const report = {
      pass: failures.length === 0,
      failures,
      checks,
      expected,
      screenshots: screenshots.map(({ name, bytes }) => ({ name, bytes })),
      consoleErrors,
      url,
      window: { ...WIDE },
      generatedAt: new Date().toISOString(),
    };
    writeReport(report);
    printSummary(report);
    win.destroy();
    app.exit(report.pass ? 0 : 1);
  } catch (error) {
    fail(`the rig threw: ${error instanceof Error ? error.stack : String(error)}`);
    const report = {
      pass: false,
      failures,
      checks,
      screenshots: screenshots.map(({ name, bytes }) => ({ name, bytes })),
      consoleErrors,
      url,
      window: { ...WIDE },
      thrown: String(error),
      generatedAt: new Date().toISOString(),
    };
    writeReport(report);
    win.destroy();
    app.exit(1);
  }
}

function writeReport(report) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "chain-capture.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

function printSummary(report) {
  const reportFile = path.join(artifactsDir, "chain-capture.json");
  console.log(`report: ${reportFile}`);
  for (const shot of report.screenshots ?? []) {
    console.log(`capture: ${path.join(artifactsDir, shot.name)} (${shot.bytes} bytes)`);
  }
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chain capture: PASS" : "chain capture: FAIL");
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chain-capture: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
