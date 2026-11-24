/**
 * Drives the Notebox page's general capture surface — text, image, any file and
 * a pasted link — and its inbox triage, in a real Electron window and writes
 * `e2e/artifacts/chain-capture.json` plus the `chain-capture-*.png` captures,
 * the file card's `chain-inbox-file.png` and the inbox's `chain-inbox-triage.png`.
 *
 * Run with this checkout's dev server up:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> apps/desktop/tests/chain-capture-e2e.test.ts
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims, no eyeballing the app required. The
 * pictures are the operator-facing half: they show the shipped page with a real
 * uploaded image, a real file card, a pasted link row, and a triaged inbox row.
 *
 * What this rig claims:
 *
 *  1. `/chain` is the shipped shell page renamed Notebox: the rail marks
 *     Notebox, the page heading says Notebox, and the composer carries one plus
 *     attachment control (`chain-attach-file`, aria "Attach a file") over a
 *     hidden file input with no accept restriction — the old Image and Link
 *     arms and the Link URL form are gone. Shift+Enter leaves the draft alone,
 *     Enter logs a text capture, and the row carries `data-attachment="text"`.
 *  2. A real PNG dropped on the composer becomes a pending thumbnail that
 *     decodes (`naturalWidth > 0`). Typing a description and pressing Log hands
 *     the bridge `attachment.kind === "image"` with the actual bytes, the vault
 *     mints a `signal-chain/files/<uuid>.png` path for them, and the row paints
 *     the bytes back through `signalChainReadImage` at the picture's real size.
 *  3. An image-only capture (empty description) is allowed: the bridge receives
 *     `body: ""` with the image attachment, and the row paints the picture with
 *     no body line.
 *  4. Any other file becomes a pending file chip naming it and its size. Log
 *     hands the bridge real `attachment.kind === "file"` bytes, name and mime;
 *     the vault mints a path with the file's extension; the row carries
 *     `data-attachment="file"` and paints a `signal-file` card with the stored
 *     name and a human size, plus a Save control that reads the stored bytes
 *     back through `signalChainReadFile`.
 *  5. A link is attached by PASTING one absolute http(s) URL into the textarea:
 *     the chip shows the host and the URL is not left in the field. A described
 *     link capture hands the bridge `attachment.kind === "link"` with the URL
 *     unchanged, and the row paints an anchor with that href and `_blank`.
 *  6. One attachment at a time: a picked picture, a picked file and a pasted
 *     link each replace whatever was pending before, and the remove controls
 *     clear them; the composer clears after each capture.
 *  7. The seeded fixture rows — text, image and link — render on the shipped
 *     page, the seeded picture loading from bytes the bridge serves, the seeded
 *     link anchoring its URL.
 *  8. The inbox half: every seeded row carries the stored status/priority/
 *     project on the row AND paints the contract's label beside it — including
 *     exactly "Unassigned" and "No project", never a blank cell. Changing a
 *     row's status select hands the bridge exactly `{status: "acting"}`, and the
 *     row paints "Acting" only after the re-read that follows — the screen
 *     change is the vault's answer, not the page's echo. The filter band is one
 *     line: status and project drop-downs plus an Area readout of the domain
 *     picker, which is the page's only area filter — not rows of pills, and no
 *     second area picker; the status picker narrows to the triaged row, says
 *     "No signals match these filters." when nothing matches, and All restores
 *     the chain.
 *  9. The dock's mirrored surface is the same Notebox: its control is labelled
 *     Notebox, it lists the same chain, and its heading says Notebox.
 * 10. The box files under the area lens, not under a picker of its own: the
 *     Life lens reads "Life (general)" and writes an unassigned capture, an
 *     area lens puts its name in the readout and that slug on the wire, and the
 *     readout holds no control — the switcher at the top is the one picker.
 * 11. No unmodelled bridge call, no console error, nothing spills horizontally
 *     past the window, and every capture is a real picture of the shipped page.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  a. The bridge is the only fake, and it records. Any method the page reaches
 *     that this rig does not model is named in `chainCaptureUnexpectedCalls` and
 *     fails the run — a page that silently renders an empty sheet is the failure
 *     this rig exists to catch.
 *  b. A dropped or picked file is not bytes. The drop carries a real `File`
 *     decoded from the fixture's base64 PNG and the file path a real `File` of
 *     UTF-8 bytes; a page that paints a filename or a placeholder never reaches
 *     `naturalWidth > 0` or a byte count and fails.
 *  c. The write mutates only the harness's echo: `signalChainCreate` stores the
 *     record the next `signalChainList` answers with, so "the row is on the
 *     chain" is read back through the bridge, not off the page's own state.
 *  d. The vault lies about storing bytes: the row's picture can only decode if
 *     `signalChainReadImage` served the bytes this bridge kept under the path it
 *     minted, and Save can only read if `signalChainReadFile` was asked for the
 *     path the file record carries. The report carries both and the byte counts.
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
 *  i. The link stays paste-only: a driver that clicked a URL field would be
 *     exercising a composer that no longer exists, so the paste dispatches a
 *     real `ClipboardEvent` and the field is asserted to stay free of the URL.
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

/** The captures this rig drives; every row/dock count is seeded + this. */
const CAPTURES_DRIVEN = 5;

/** The non-image attachment the one plus control is handed, bytes and all. */
const ATTACHMENT_FILE_TEXT =
  "%PDF-1.4\n% LifeQuest e2e attachment\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n";
const ATTACHMENT_FILE = {
  name: "brief.pdf",
  mime: "application/pdf",
  text: ATTACHMENT_FILE_TEXT,
  bytes: Buffer.byteLength(ATTACHMENT_FILE_TEXT, "utf8"),
};

/** A human file size as the row and the pending chip paint it ("12 KB"). */
const SIZE_PATTERN = /(\d+(?:\.\d+)?)\s*(B|KB|MB)/;

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
    const rowText = (testid) => text(row.querySelector('[data-testid="' + testid + '"]'));
    const selectOf = (select) =>
      select
        ? {
            value: select.value,
            options: Array.from(select.options).map((option) => ({
              value: option.value,
              label: (option.textContent || "").trim(),
            })),
          }
        : null;
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
      // A non-image capture paints a file card: the stored name, a human size,
      // and the operator's Save control. A row that names the file but offers
      // no way to read it back is a card the operator cannot use.
      file: (() => {
        const card = row.querySelector('[data-testid="signal-file"]');
        if (!card) return { present: false };
        return {
          present: true,
          text: text(card),
          name: text(card.querySelector('[data-testid="signal-file-name"]')),
          save: Boolean(row.querySelector('[aria-label="Save the attached file"]')),
        };
      })(),
      // The triage contract: the stored values on the row, and the chip text
      // the operator reads, read side by side so a disagreement is visible.
      dataStatus: row.getAttribute("data-status"),
      dataPriority: row.getAttribute("data-priority"),
      dataProjectId: row.getAttribute("data-project-id"),
      dataDomainSlug: row.getAttribute("data-domain-slug"),
      domain: rowText("signal-domain"),
      project: rowText("signal-project"),
      status: rowText("signal-status"),
      priority: rowText("signal-priority"),
      capturedFrom: rowText("signal-captured-from"),
      statusSelect: selectOf(
        row.querySelector('[data-testid="signal-status-select"]'),
      ),
      prioritySelect: selectOf(
        row.querySelector('[data-testid="signal-priority-select"]'),
      ),
      projectSelect: selectOf(
        row.querySelector('[data-testid="signal-project-select"]'),
      ),
    };
  });
  // One triage filter: the picker, the options it offers, the value currently
  // applied, and the box it occupies. The band is three selects on one line now,
  // so a filter is read off its picker rather than off pressed chips.
  const filterOf = (testid) => {
    const select = q('[data-testid="' + testid + '"]');
    return {
      present: Boolean(select),
      testid,
      tag: select ? select.tagName : null,
      value: select ? select.value : null,
      options: select
        ? Array.from(select.options).map((option) => ({
            value: option.value,
            label: (option.textContent || "").trim(),
          }))
        : [],
      box: box(select),
    };
  };
  const composer = q('[data-testid="chain-composer"]');
  const pending = q('[data-testid="chain-pending-image"]');
  const pendingFile = q('[data-testid="chain-pending-file"]');
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
    heading: text(q(".signal-chain h1")),
    presence: {
      rail: Boolean(q(".nav-rail")),
      page: Boolean(q(".signal-chain")),
      composer: Boolean(composer),
      composerBox: box(composer),
      textarea: Boolean(textarea),
      attachFile: Boolean(q('[data-testid="chain-attach-file"]')),
      attachLabel: (() => {
        const el = q('[data-testid="chain-attach-file"]');
        return el ? el.getAttribute("aria-label") : null;
      })(),
      attachBox: box(q('[data-testid="chain-attach-file"]')),
      fileInput: Boolean(fileInput),
      log: Boolean(logButton),
    },
    // The controls the redesign removes must not linger beside the plus: one
    // attachment control is the contract, and a leftover Image/Link arm (or the
    // old URL field) is exactly the collision this rig exists to catch.
    legacyComposer: {
      attachImage: Boolean(q('[data-testid="chain-attach-image"]')),
      attachLink: Boolean(q('[data-testid="chain-attach-link"]')),
      linkUrlField: Boolean(q('[aria-label="Link URL"]')),
      addLink: Boolean(q('[data-testid="chain-link-add"]')),
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
      // The image arm keeps its count/thumbnail reads; the file arm is a chip
      // whose text carries the name and a human size.
      count: all('[data-testid="chain-pending-image"]').length,
      imageWrap: Boolean(q('[data-testid="chain-pending-image-wrap"]')),
      image: imageOf(pending),
      file: pendingFile
        ? { present: true, text: text(pendingFile) }
        : { present: false },
      removeImage: Boolean(q('[aria-label="Remove the attached image"]')),
      removeFile: Boolean(q('[aria-label="Remove the attached file"]')),
    },
    link: {
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
    // The box's area readout: the lens it will file under, and whether that
    // readout is a control (it must not be — the switcher is the one picker).
    composerArea: (() => {
      const readout = q('[data-testid="chain-area-readout"]');
      const value = q('[data-testid="chain-area-value"]');
      return readout
        ? {
            present: true,
            tag: readout.tagName,
            value: text(value),
            slug: readout.getAttribute("data-area-slug") ?? "",
            title: readout.getAttribute("title"),
            controls: readout.querySelectorAll("select, input, button").length,
          }
        : { present: false };
    })(),
    rows,
    counts,
    // The inbox's own surface: the two filter pickers, the area readout that
    // names the domain picker's lens, and their geometry, plus the two empty
    // lines (no matches vs no records at all).
    filters: {
      status: filterOf("signal-filter-status"),
      project: filterOf("signal-filter-project"),
    },
    // The area is not a filter of its own any more: the domain picker at the
    // top is the one area filter, so the band only names it.
    filterArea: (() => {
      const readout = q('[data-testid="signal-filter-domain-readout"]');
      const value = readout
        ? text(readout.querySelector(".signal-chain__filter-value"))
        : null;
      return readout
        ? {
            present: true,
            tag: readout.tagName,
            value,
            slug: readout.getAttribute("data-area-slug") ?? "",
            title: readout.getAttribute("title"),
            controls: readout.querySelectorAll("select, input, button").length,
            box: box(readout),
          }
        : { present: false };
    })(),
    // A separate area picker must be gone: the band is two selects and a readout.
    filterAreaSelect: Boolean(q('[data-testid="signal-filter-domain"]')),
    filterLayout: {
      band: box(q(".signal-chain__filters")),
      labels: all(".signal-chain__filter-label").map(text),
      fields: all(".signal-chain__filter").map(box),
      buttons: all(".signal-chain__filters button").length,
      selects: all(".signal-chain__filters select").length,
      readouts: all(".signal-chain__filter-value").length,
    },
    filterEmpty: text(q('[data-testid="signal-filter-empty"]')),
    emptyLine: text(q('[data-testid="signal-empty"]')),
    projects: window.chainCaptureProjects ?? [],
    areas: window.chainCaptureAreas ?? [],
    lensWrites: (window.chainCaptureLens ?? []).slice(),
    inbox: window.chainCaptureInbox ?? null,
    // The dock's own Life-Chain surface, which renders the same records and
    // carries the same Notebox name.
    dock: {
      surface: q(".chat-panel")
        ? q(".chat-panel").getAttribute("data-chat-surface")
        : null,
      heading: text(q(".chat-panel__heading")),
      action: Boolean(q('.chat-panel [aria-label="Notebox"]')),
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
    fileReads: (window.chainCaptureFileReads ?? []).slice(),
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
  const el = document.querySelector('.chat-panel [aria-label="Notebox"]');
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
 * Move a row's status with the operator's own select. React 19 reads a real
 * bubbling `change` event, and the native value setter is the one that leaves
 * React's value tracker seeing an edit rather than swallowing a programmatic
 * assignment. The row is found by its painted body, so the gesture is the one
 * an operator makes on that row, not a harness handle.
 */
const selectRowStatus = (body, value) => `(() => {
  const rows = Array.from(document.querySelectorAll('[data-testid="signal-row"]'));
  const row = rows.find((candidate) => {
    const el =
      candidate.querySelector('[data-testid="signal-body"]') ||
      candidate.querySelector('.signal-row__body');
    return Boolean(el) && (el.textContent || '').includes(${JSON.stringify(body)});
  });
  if (!row) return "no row";
  const select = row.querySelector('[data-testid="signal-status-select"]');
  if (!select) return "no status select";
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
})()`;

/**
 * Pick a value on one of the three inbox filters. Same native-setter rule as a
 * row select: the picker is the operator's control, and React only sees the
 * change when a real bubbling `change` event follows the value assignment.
 */
const selectFilter = (testid, value) => `(() => {
  const select = document.querySelector('[data-testid="' + ${JSON.stringify(testid)} + '"]');
  if (!select) return "no filter";
  if (select.tagName !== "SELECT") return "not a select";
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
})()`;

/**
 * Choose an area on the window's switcher, the one picker that decides where a
 * capture files. The switcher is a radiogroup of tabs; the operator's gesture
 * is a click on the tab whose name matches.
 */
const clickLens = (name) => `(() => {
  const group = document.querySelector('[role="radiogroup"][aria-label="Area lens"]');
  if (!group) return "no switcher";
  const tab = Array.from(group.querySelectorAll("button")).find(
    (button) => (button.textContent || "").trim() === ${JSON.stringify(name)},
  );
  if (!tab) return "no tab";
  tab.click();
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
 * any-file input and fire the event React listens for. This is the path the one
 * plus control opens; no dialog is ever shown to a hidden window.
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

/**
 * Pick a generic file the way the OS dialog does: a real `File` with real bytes
 * on the hidden any-file input. The composer must take it without an accept
 * gate and hand the bytes to the bridge on Log.
 */
const pickFile = (name, mime, text) => `(() => {
  const input = document.querySelector('[data-testid="chain-file-input"]');
  if (!input) return "no file input";
  const bytes = new TextEncoder().encode(${JSON.stringify(text)});
  const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
  const data = new DataTransfer();
  data.items.add(file);
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;

/**
 * Paste text into the composer the way the clipboard does. The link arm is
 * paste-only now, so this is the operator's gesture that attaches a URL — and
 * the URL must become a chip, not text in the field.
 */
const pasteText = (text) => `(() => {
  const el = document.querySelector('[aria-label="Log a signal"]');
  if (!el) return false;
  el.focus();
  const data = new DataTransfer();
  data.setData("text/plain", ${JSON.stringify(text)});
  const event = new ClipboardEvent("paste", {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(event);
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

  // The file row's Save builds a Blob and clicks an `<a download>`; in Electron
  // that raises the native download UI, which can stall the hidden window or
  // leave a stray dialog on the display. The evidence this rig needs is the
  // `signalChainReadFile` call that happens before the click, so the download
  // itself is cancelled.
  win.webContents.session.on("will-download", (_event, item) => item.cancel());

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

  async function captureFile(filename) {
    fs.mkdirSync(artifactsDir, { recursive: true });
    const file = path.join(artifactsDir, filename);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    screenshots.push({ name: path.basename(file), file, bytes: fs.statSync(file).size });
    return file;
  }
  const capture = (name) => captureFile(`chain-capture-${name}.png`);

  const rowWithBody = (state, body) =>
    (state.rows || []).find((row) => ((row.body ?? row.text) ?? "").includes(body)) ?? null;

  try {
    await win.loadURL(url);
    win.showInactive();
    const ready = await waitFor(
      win,
      "Boolean(window.chainCaptureReady)",
      "chainCaptureReady",
      30_000,
    );

    // A page that never became ready is not measured: name what the window
    // actually shows — the empty sheet, the Vite overlay, or the unmounted
    // tree and the console errors that unmounted it — and write the report
    // now. Grinding through every later phase only burns the test's timeout
    // and loses the error that says why.
    if (!ready) {
      const boot = await js(`(() => {
        const root = document.getElementById("root");
        const overlay = document.querySelector("vite-error-overlay");
        return {
          title: document.title,
          href: location.href,
          readyState: document.readyState,
          rootChildren: root ? root.children.length : -1,
          rootHtml: root ? root.innerHTML.slice(0, 400) : null,
          bodyText: (document.body ? document.body.innerText : "").slice(0, 400),
          overlay: overlay
            ? overlay.shadowRoot
              ? overlay.shadowRoot.textContent.slice(0, 800)
              : "overlay"
            : null,
          hasLifequest: Boolean(window.lifequest),
          hasExpected: Boolean(window.chainCaptureExpected),
          calls: (window.chainCaptureCalls ?? []).slice(),
          unexpected: (window.chainCaptureUnexpectedCalls ?? []).slice(),
        };
      })()`).catch((error) => ({ probeError: String(error) }));
      checks.boot = boot;
      fail(`the harness page never became ready: ${JSON.stringify(boot).slice(0, 1600)}`);
      const report = {
        pass: false,
        failures,
        checks,
        screenshots: screenshots.map(({ name, bytes }) => ({ name, bytes })),
        consoleErrors,
        url,
        window: { ...WIDE },
        generatedAt: new Date().toISOString(),
      };
      writeReport(report);
      printSummary(report);
      win.destroy();
      app.exit(1);
      return;
    }

    const expected = await js("window.chainCaptureExpected");
    const expectedImage = await js("window.chainCaptureImage");
    checks.expected = expected;

    // ── 1. the shipped page and its composer ────────────────────────────────
    const landing = await sample();
    checks.page = {
      route: landing.route,
      skin: landing.skin,
      heading: landing.heading,
      activeRail: landing.activeRail,
      rail: landing.rail,
      presence: landing.presence,
      legacyComposer: landing.legacyComposer,
      fileInput: landing.fileInput,
    };
    check("chain route", landing.route === "/chain", `route is ${JSON.stringify(landing.route)}`);
    check(
      "the rail marks Notebox",
      landing.activeRail === "Notebox",
      `active rail row is ${JSON.stringify(landing.activeRail)}`,
    );
    check(
      "the rail carries the chain row",
      landing.rail.some((item) => item.label === "Notebox" && item.href === "/chain"),
      `rail is ${JSON.stringify(landing.rail)}`,
    );
    check(
      "the page heading is Notebox",
      landing.heading === "Notebox",
      `page heading is ${JSON.stringify(landing.heading)}`,
    );
    check("the chain page is up", landing.presence.page, "no .signal-chain on the page");
    check("the composer is the shipped one", landing.presence.composer, "no [data-testid=chain-composer]");
    check(
      "the composer has its textarea",
      landing.presence.textarea && landing.textarea !== null,
      `textarea ${JSON.stringify(landing.textarea)}`,
    );
    check(
      "the composer has one plus attachment control",
      landing.presence.attachFile && landing.presence.attachLabel === "Attach a file",
      `attach ${JSON.stringify({ present: landing.presence.attachFile, label: landing.presence.attachLabel })}`,
    );
    // The contract puts the plus at the composer's bottom-left. A control that
    // floats elsewhere is the wrong composer shape even when its testid matches.
    check(
      "the plus sits at the composer's bottom-left",
      Boolean(landing.presence.attachBox && landing.presence.composerBox) &&
        landing.presence.attachBox.left <=
          landing.presence.composerBox.left +
            Math.max(120, landing.presence.composerBox.width * 0.25) &&
        landing.presence.attachBox.top >=
          landing.presence.composerBox.top + landing.presence.composerBox.height / 2,
      `attach ${JSON.stringify(landing.presence.attachBox)} composer ${JSON.stringify(landing.presence.composerBox)}`,
    );
    check("the Log control is up", landing.presence.log, "no button labelled Log");
    check(
      "the file input is a hidden any-file picker",
      landing.fileInput.present &&
        landing.fileInput.type === "file" &&
        landing.fileInput.accept === null &&
        landing.fileInput.hidden === true,
      `file input ${JSON.stringify(landing.fileInput)}`,
    );
    check(
      "the old Image and Link arms are gone",
      landing.legacyComposer.attachImage === false &&
        landing.legacyComposer.attachLink === false &&
        landing.legacyComposer.linkUrlField === false &&
        landing.legacyComposer.addLink === false,
      `legacy controls ${JSON.stringify(landing.legacyComposer)}`,
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
      "the text capture filed in Life (general)",
      textCreate?.domainSlug === null,
      `domain ${JSON.stringify(textCreate?.domainSlug)}`,
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
      removeImage: pending.pending.removeImage,
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
      pending.pending.removeImage,
      "no [aria-label=Remove the attached image]",
    );
    check(
      "one attachment at a time: a dropped picture clears any file chip",
      pending.pending.file.present === false,
      `pending ${JSON.stringify(pending.pending)}`,
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

    // ── 5. a non-image file through the one plus control ───────────────────
    // The composer takes any file: the pending chip names it and says its size,
    // the bridge gets real bytes and mime, and the row paints a file card whose
    // Save control asks the bridge for the stored bytes.
    const fileDescription = "The brief for the desk rebuild.";
    const pickedFile = await js(
      pickFile(ATTACHMENT_FILE.name, ATTACHMENT_FILE.mime, ATTACHMENT_FILE.text),
    );
    check(
      "the plus control handed the page a file",
      pickedFile === true,
      `picker returned ${JSON.stringify(pickedFile)}`,
    );
    const filePending = await waitState(
      (state) => state.pending.file.present === true,
      "the pending file chip",
    );
    const pendingFileText = filePending.pending.file.text ?? "";
    checks.pendingFile = {
      text: pendingFileText,
      remove: filePending.pending.removeFile,
      imageCount: filePending.pending.count,
    };
    check(
      "a non-image file becomes a pending file chip",
      filePending.pending.file.present === true &&
        pendingFileText.includes(ATTACHMENT_FILE.name),
      `pending file ${JSON.stringify(filePending.pending.file)}`,
    );
    check(
      "the pending file chip says its size",
      SIZE_PATTERN.test(pendingFileText),
      `chip ${JSON.stringify(pendingFileText)}`,
    );
    check(
      "the pending file has its remove control",
      filePending.pending.removeFile,
      "no [aria-label=Remove the attached file]",
    );
    check(
      "one attachment at a time: no pending picture beside the file",
      filePending.pending.count === 0 && filePending.pending.imageWrap === false,
      `pending ${JSON.stringify(filePending.pending)}`,
    );
    await js(setValue('[aria-label="Log a signal"]', fileDescription));
    await waitState(
      (state) => state.log !== null && state.log.disabled === false,
      "Log to arm with a described file attached",
    );
    await sleep(250);
    await capture("pending-file");
    await js(clickText("Log"));
    await waitState(
      (state) =>
        state.creates.length === 4 &&
        state.counts.rows === expected.seeded.count + 4,
      "the file capture to land on the chain",
    );
    const fileLogged = await waitState(
      (state) => {
        const row = rowWithBody(state, fileDescription);
        return Boolean(row && row.attachment === "file" && row.file?.present);
      },
      "the file row to paint its card",
    );
    const fileCreate = fileLogged.creates[3];
    const fileRow = rowWithBody(fileLogged, fileDescription);
    const fileRelPath = fileCreate?.attachment?.relPath;
    checks.fileCapture = {
      create: fileCreate,
      row: fileRow,
      expectedBytes: ATTACHMENT_FILE.bytes,
      pendingText: pendingFileText,
      reads: fileLogged.fileReads,
      bytes: fileLogged.store?.bytes,
    };
    check(
      "the bridge received a file attachment",
      fileCreate?.attachment?.kind === "file",
      `attachment ${JSON.stringify(fileCreate?.attachment)}`,
    );
    check(
      "the file kept its name",
      fileCreate?.attachment?.name === ATTACHMENT_FILE.name,
      `name ${JSON.stringify(fileCreate?.attachment?.name)}`,
    );
    check(
      "the file kept its mime",
      fileCreate?.attachment?.mime === ATTACHMENT_FILE.mime,
      `mime ${JSON.stringify(fileCreate?.attachment?.mime)}`,
    );
    check(
      "the bridge received the file bytes",
      fileCreate?.attachment?.byteLength === ATTACHMENT_FILE.bytes,
      `byte length ${JSON.stringify(fileCreate?.attachment?.byteLength)} vs ${ATTACHMENT_FILE.bytes}`,
    );
    check(
      "the vault minted a signal-chain path with the file's extension",
      typeof fileRelPath === "string" &&
        /^\.lifequest\/signal-chain\/files\/[0-9a-f-]+\.pdf$/.test(fileRelPath),
      `path ${JSON.stringify(fileRelPath)}`,
    );
    check(
      "the vault stored the file bytes under the path it minted",
      Boolean(fileRelPath) &&
        fileLogged.store?.bytes?.[fileRelPath] === ATTACHMENT_FILE.bytes,
      `stored ${JSON.stringify(fileLogged.store?.bytes)} for ${JSON.stringify(fileRelPath)}`,
    );
    check(
      "the row is marked file",
      fileRow?.attachment === "file",
      `row attachment ${JSON.stringify(fileRow?.attachment)}`,
    );
    check(
      "the file row paints the stored name",
      fileRow?.file?.name === ATTACHMENT_FILE.name,
      `card ${JSON.stringify(fileRow?.file)}`,
    );
    check(
      "the file row paints a human size",
      SIZE_PATTERN.test(fileRow?.file?.text ?? ""),
      `card text ${JSON.stringify(fileRow?.file?.text)}`,
    );
    check(
      "the file row offers Save",
      fileRow?.file?.save === true,
      `card ${JSON.stringify(fileRow?.file)}`,
    );
    check(
      "the file row paints the description",
      (fileRow?.body ?? "").includes(fileDescription),
      `row body ${JSON.stringify(fileRow?.body)}`,
    );
    // Save asks the bridge for the stored bytes; the download itself belongs to
    // the window, so the evidence is the read by the relPath the bridge minted.
    const saveClicked = await js(clickAria("Save the attached file"));
    check(
      "the Save control is clickable",
      saveClicked === true,
      `Save click ${JSON.stringify(saveClicked)}`,
    );
    const fileSaved = await waitState(
      (state) =>
        Boolean(fileRelPath) && (state.fileReads ?? []).includes(fileRelPath),
      "Save to read the file back through the bridge",
    );
    const savedRow = rowWithBody(fileSaved, fileDescription);
    checks.fileCapture.save = {
      clicked: saveClicked === true,
      reads: fileSaved.fileReads,
      error: (savedRow?.file?.text ?? "").includes("missing")
        ? savedRow?.file?.text ?? null
        : null,
    };
    check(
      "Save read the file back by its minted path",
      (fileSaved.fileReads ?? []).includes(fileRelPath),
      `reads ${JSON.stringify(fileSaved.fileReads)}`,
    );
    check(
      "the file row does not report the file missing",
      !(savedRow?.file?.text ?? "").includes("missing"),
      `card text ${JSON.stringify(savedRow?.file?.text)}`,
    );
    await sleep(250);
    const fileShot = await captureFile("chain-inbox-file.png");
    const fileShotBytes = fs.statSync(fileShot).size;
    checks.fileCapture.screenshot = {
      name: path.basename(fileShot),
      bytes: fileShotBytes,
    };
    check(
      "capture chain-inbox-file.png is a real picture",
      fileShotBytes > 20_000,
      `${fileShotBytes} bytes`,
    );

    // ── 6. a link, by pasting a URL into the textarea ──────────────────────
    // The link arm is paste-only now: the URL becomes a chip and must not be
    // left in the field, and the capture still hands the bridge a link.
    const linkUrl = "https://www.are.na/editorial/attention";
    const linkDescription = "What attention costs, and what it buys.";
    const pasted = await js(pasteText(linkUrl));
    check(
      "the paste reached the composer",
      pasted === true,
      `paste returned ${JSON.stringify(pasted)}`,
    );
    const linkPasted = await waitState(
      (state) => state.link.chip.present === true,
      "the pasted URL to become a link chip",
    );
    checks.linkPaste = {
      text: linkUrl,
      chip: linkPasted.link.chip,
      textarea: linkPasted.textarea?.value ?? null,
      error: linkPasted.link.error,
    };
    check(
      "a pasted URL becomes a chip that shows the host",
      (linkPasted.link.chip?.text ?? "").includes("are.na"),
      `chip ${JSON.stringify(linkPasted.link.chip)}`,
    );
    check(
      "the pasted URL is not left in the textarea",
      !(linkPasted.textarea?.value ?? "").includes(linkUrl),
      `field holds ${JSON.stringify(linkPasted.textarea?.value)}`,
    );
    check(
      "the paste is not an error",
      (linkPasted.link.error ?? "") === "",
      `error ${JSON.stringify(linkPasted.link.error)}`,
    );
    await js(setValue('[aria-label="Log a signal"]', linkDescription));
    await waitState(
      (state) => state.log !== null && state.log.disabled === false,
      "Log to arm with a described link attached",
    );
    await js(clickText("Log"));
    const linkLogged = await waitState(
      (state) =>
        state.creates.length === 5 &&
        state.counts.rows === expected.seeded.count + 5,
      "the link capture to land on the chain",
    );
    const linkCreate = linkLogged.creates[4];
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
        linkLogged.textarea?.value === "" &&
        linkLogged.log?.disabled === true,
      `link ${JSON.stringify(linkLogged.link)}, field ${JSON.stringify(linkLogged.textarea)}`,
    );
    await sleep(250);
    await capture("link");

    // ── 7. one attachment at a time: a second kind replaces the pending one ──
    const exclusivity = {};
    await js(pickPng);
    const imagePendingAgain = await waitState(
      (state) => state.pending.count === 1 && state.pending.file.present === false,
      "the picked image to become the pending attachment",
    );
    exclusivity.imagePending = {
      imageCount: imagePendingAgain.pending.count,
      file: imagePendingAgain.pending.file.present,
    };
    await js(pickFile(ATTACHMENT_FILE.name, ATTACHMENT_FILE.mime, ATTACHMENT_FILE.text));
    const fileReplaced = await waitState(
      (state) => state.pending.file.present === true && state.pending.count === 0,
      "the file to replace the pending image",
    );
    exclusivity.fileReplacesImage = {
      imageCount: fileReplaced.pending.count,
      file: fileReplaced.pending.file,
    };
    check(
      "a file replaces the pending picture",
      fileReplaced.pending.file.present === true && fileReplaced.pending.count === 0,
      `pending ${JSON.stringify(fileReplaced.pending)}`,
    );
    const pastedAgain = await js(pasteText(linkUrl));
    const linkReplaced = await waitState(
      (state) => state.link.chip.present === true && state.pending.file.present === false,
      "the pasted link to replace the pending file",
    );
    exclusivity.linkReplacesFile = {
      chip: linkReplaced.link.chip,
      pendingFile: linkReplaced.pending.file.present,
      imageCount: linkReplaced.pending.count,
    };
    check(
      "a pasted link replaces the pending file",
      linkReplaced.link.chip.present === true &&
        linkReplaced.pending.file.present === false,
      `link ${JSON.stringify(linkReplaced.link.chip)}, pending ${JSON.stringify(linkReplaced.pending)}`,
    );
    check(
      "the exclusivity paste reached the composer",
      pastedAgain === true,
      `paste returned ${JSON.stringify(pastedAgain)}`,
    );
    await js(clickAria("Remove the attached link"));
    const linkCleared = await waitState(
      (state) =>
        state.link.chip.present === false &&
        state.counts.rows === expected.seeded.count + 5,
      "the remove control to leave the composer empty",
    );
    exclusivity.linkRemoved = linkCleared.link.chip.present === false;
    check(
      "the remove control clears the pasted link",
      linkCleared.link.chip.present === false,
      `chip ${JSON.stringify(linkCleared.link.chip)}`,
    );
    checks.exclusivity = exclusivity;

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
      final.counts.rows === expected.seeded.count + CAPTURES_DRIVEN,
      `${final.counts.rows} rows vs ${expected.seeded.count + CAPTURES_DRIVEN}`,
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

    // ── 6b. the inbox: a triage select changes the row on screen ───────────
    // The fixture's three seeds cover the whole contract: an unassigned row, a
    // row filed under a live project with High priority, and a row already
    // triaged in an area. First the chips are compared with the stored values
    // the harness publishes; then one row is moved through the operator's own
    // select, and the run waits for BOTH the bridge patch and the re-read it
    // causes to paint back — a page that only echoed its own state fails here.
    const inboxExpected = await js("window.chainCaptureInbox");
    check(
      "the harness publishes the fixture's inbox",
      Boolean(inboxExpected?.seeded?.length === expected.seeded.count),
      `inbox ${JSON.stringify(inboxExpected).slice(0, 300)}`,
    );

    const baseline = await waitState(
      (state) =>
        Array.isArray(inboxExpected?.seeded) &&
        inboxExpected.seeded.every((seed) => {
          const row = rowWithBody(state, seed.body);
          return (
            row !== null &&
            row.dataStatus === seed.status &&
            row.dataDomainSlug === (seed.domainSlug ?? "") &&
            row.dataProjectId === (seed.projectId ?? "") &&
            row.dataPriority === (seed.priority ?? "none") &&
            row.domain === seed.domainLabel &&
            row.project === seed.projectLabel &&
            row.status === seed.statusLabel &&
            row.priority === seed.priorityLabel &&
            row.statusSelect?.value === seed.status
          );
        }),
      "the seeded inbox rows to paint their chips and triage selects",
      15_000,
    );

    const inboxRows = (inboxExpected?.seeded ?? []).map((seed) => {
      const row = rowWithBody(baseline, seed.body);
      return {
        id: seed.id,
        body: seed.body,
        expected: seed,
        attachment: row?.attachment ?? null,
        dataStatus: row?.dataStatus ?? null,
        dataPriority: row?.dataPriority ?? null,
        dataProjectId: row?.dataProjectId ?? null,
        dataDomainSlug: row?.dataDomainSlug ?? null,
        domain: row?.domain ?? null,
        project: row?.project ?? null,
        status: row?.status ?? null,
        priority: row?.priority ?? null,
        capturedFrom: row?.capturedFrom ?? null,
        statusSelect: row?.statusSelect ?? null,
        prioritySelect: row?.prioritySelect ?? null,
        projectSelect: row?.projectSelect ?? null,
      };
    });
    for (const row of inboxRows) {
      const seed = row.expected;
      const name = `seeded ${seed.attachment} row`;
      check(
        `${name} exists with a status`,
        row.attachment !== null && row.dataStatus === seed.status && row.status === seed.statusLabel,
        `painted ${JSON.stringify({ attachment: row.attachment, dataStatus: row.dataStatus, status: row.status })} vs stored ${JSON.stringify({ status: seed.status, label: seed.statusLabel })}`,
      );
      check(
        `${name} paints its domain`,
        row.dataDomainSlug === (seed.domainSlug ?? "") && row.domain === seed.domainLabel,
        `painted ${JSON.stringify({ dataDomainSlug: row.dataDomainSlug, domain: row.domain })} vs ${JSON.stringify({ dataDomainSlug: seed.domainSlug ?? "", domain: seed.domainLabel })}`,
      );
      check(
        `${name} paints its project`,
        row.dataProjectId === (seed.projectId ?? "") && row.project === seed.projectLabel,
        `painted ${JSON.stringify({ dataProjectId: row.dataProjectId, project: row.project })} vs ${JSON.stringify({ dataProjectId: seed.projectId ?? "", project: seed.projectLabel })}`,
      );
      check(
        `${name} paints its priority`,
        row.dataPriority === (seed.priority ?? "none") && row.priority === seed.priorityLabel,
        `painted ${JSON.stringify({ dataPriority: row.dataPriority, priority: row.priority })} vs ${JSON.stringify({ dataPriority: seed.priority ?? "none", priority: seed.priorityLabel })}`,
      );
      if (seed.capturedFrom) {
        check(
          `${name} paints where it was captured from`,
          row.capturedFrom === seed.capturedFrom,
          `painted ${JSON.stringify(row.capturedFrom)} vs ${JSON.stringify(seed.capturedFrom)}`,
        );
      }
    }

    const statusSelect = inboxRows[0]?.statusSelect ?? null;
    const prioritySelect = inboxRows[0]?.prioritySelect ?? null;
    const projectSelect = inboxRows[0]?.projectSelect ?? null;
    check(
      "every row carries its three triage selects",
      inboxRows.every((row) => row.statusSelect && row.prioritySelect && row.projectSelect),
      `selects ${JSON.stringify(inboxRows.map((row) => Boolean(row.statusSelect && row.prioritySelect && row.projectSelect)))}`,
    );
    const statusOptionValues = (statusSelect?.options ?? []).map((option) => option.value);
    const statusOptionLabels = (statusSelect?.options ?? []).map((option) => option.label);
    check(
      "the status select offers the five states with the stored values",
      statusOptionValues.join(",") === "inbox,triaged,acting,done,dropped",
      `options ${JSON.stringify(statusOptionValues)}`,
    );
    check(
      "the status select labels the states",
      statusOptionLabels.join(",") === "Inbox,Triaged,Acting,Done,Dropped",
      `labels ${JSON.stringify(statusOptionLabels)}`,
    );
    const priorityOptionLabels = (prioritySelect?.options ?? []).map((option) => option.label);
    check(
      "the priority select offers None and the three levels",
      ["None", "High", "Normal", "Low"].every((label) => priorityOptionLabels.includes(label)),
      `labels ${JSON.stringify(priorityOptionLabels)}`,
    );
    const projectOptionLabels = (projectSelect?.options ?? []).map((option) => option.label);
    check(
      "the project select offers No project and every live project",
      projectOptionLabels.includes("No project") &&
        (inboxExpected?.projects ?? []).every((project) =>
          projectOptionLabels.includes(project.title),
        ),
      `labels ${JSON.stringify(projectOptionLabels)} vs projects ${JSON.stringify((inboxExpected?.projects ?? []).map((project) => project.title))}`,
    );

    // The band is two drop-downs and the area readout on one line, not three
    // rows of pills: every option list and the geometry that proves the one
    // line are measured off the shipped page.
    const statusValues = (baseline.filters?.status?.options ?? []).map(
      (option) => option.value,
    );
    check(
      "the status filter is a drop-down offering All and the five states",
      baseline.filters?.status?.tag === "SELECT" &&
        statusValues.join(",") === "all,inbox,triaged,acting,done,dropped",
      `tag ${JSON.stringify(baseline.filters?.status?.tag)}, options ${JSON.stringify(statusValues)}`,
    );
    check(
      "the status filter starts on All",
      baseline.filters?.status?.value === "all",
      `value ${JSON.stringify(baseline.filters?.status?.value)}`,
    );
    check(
      "the area is a readout of the domain picker, not a filter of its own",
      (baseline.filterArea?.present ?? false) &&
        baseline.filterArea?.tag === "SPAN" &&
        baseline.filterArea?.value === "Life (general)" &&
        baseline.filterArea?.slug === "" &&
        (baseline.filterArea?.controls ?? -1) === 0 &&
        baseline.filterAreaSelect === false,
      `readout ${JSON.stringify(baseline.filterArea)}, old picker ${JSON.stringify(baseline.filterAreaSelect)}`,
    );
    const projectValues = (baseline.filters?.project?.options ?? []).map(
      (option) => option.value,
    );
    check(
      "the project filter is a drop-down offering All and every live project",
      baseline.filters?.project?.tag === "SELECT" &&
        projectValues.length === (inboxExpected?.projects ?? []).length + 1 &&
        projectValues.includes("all") &&
        (inboxExpected?.projects ?? []).every((project) =>
          projectValues.includes(project.id),
        ),
      `options ${JSON.stringify(projectValues)}`,
    );
    // Mixed heights are fine (two pickers, one readout): the line is proven by
    // the fields' centres agreeing, not by their top edges.
    const filterFieldCenters = (baseline.filterLayout?.fields ?? []).map(
      (field) => (field ? field.top + field.height / 2 : null),
    );
    check(
      "the two filters and the area readout share one line",
      filterFieldCenters.length === 3 &&
        filterFieldCenters.every(
          (center) =>
            center !== null && Math.abs(center - filterFieldCenters[0]) <= 1,
        ),
      `field centres ${JSON.stringify(filterFieldCenters)}`,
    );
    check(
      "the filter band is one compact row of two pickers and a readout",
      (baseline.filterLayout?.band?.height ?? 0) <= 56 &&
        (baseline.filterLayout?.buttons ?? -1) === 0 &&
        (baseline.filterLayout?.selects ?? -1) === 2 &&
        (baseline.filterLayout?.readouts ?? -1) === 1 &&
        (baseline.filterLayout?.labels ?? []).join(",") ===
          "Status,Project,Area",
      `band ${JSON.stringify(baseline.filterLayout?.band)}, selects ${baseline.filterLayout?.selects}, readouts ${baseline.filterLayout?.readouts}, labels ${JSON.stringify(baseline.filterLayout?.labels)}`,
    );
    // The Area readout is the row's right end: the last field in the band, to
    // the right of the project picker, and pushed against the band's edge — not
    // merely last in a left-packed row.
    const filterFieldBoxes = baseline.filterLayout?.fields ?? [];
    const filterBand = baseline.filterLayout?.band ?? null;
    const filterAreaBox = baseline.filterArea?.box ?? null;
    const areaRightGap =
      filterBand && filterAreaBox
        ? filterBand.left + filterBand.width - (filterAreaBox.left + filterAreaBox.width)
        : null;
    check(
      "the Area readout sits at the right end of the band",
      filterFieldBoxes.length === 3 &&
        (filterAreaBox?.left ?? -1) === (filterFieldBoxes[2]?.left ?? -2) &&
        (filterAreaBox?.left ?? -1) >
          (baseline.filters?.project?.box?.left ?? Infinity),
      `area ${JSON.stringify(filterAreaBox)}, project ${JSON.stringify(baseline.filters?.project?.box)}, fields ${JSON.stringify(filterFieldBoxes)}`,
    );
    check(
      "the Area readout is right-aligned against the band's edge",
      areaRightGap !== null && areaRightGap >= 0 && areaRightGap <= 14,
      `right gap ${JSON.stringify(areaRightGap)}px, band ${JSON.stringify(filterBand)}, area ${JSON.stringify(filterAreaBox)}`,
    );

    // The triage itself: one operator gesture on the project-filed row.
    const inboxTarget = inboxExpected?.target ?? null;
    const targetBefore = inboxTarget ? rowWithBody(baseline, inboxTarget.body) : null;
    const listReadsBefore = (baseline.calls ?? []).filter(
      (name) => name === "signalChainList",
    ).length;
    check(
      "the triage target is on screen before the change",
      Boolean(inboxTarget) && targetBefore !== null && targetBefore?.dataStatus === "inbox",
      `target ${JSON.stringify(inboxTarget)}, row ${JSON.stringify(targetBefore && { dataStatus: targetBefore.dataStatus, status: targetBefore.status })}`,
    );
    const moved = inboxTarget ? await js(selectRowStatus(inboxTarget.body, "acting")) : "no target";
    check(
      "the status select accepts the operator's change",
      moved === "ok",
      `select returned ${JSON.stringify(moved)}`,
    );
    const triaged = await waitState(
      (state) => {
        const row = inboxTarget ? rowWithBody(state, inboxTarget.body) : null;
        const update = (state.updates ?? []).find(
          (entry) => entry.id === (inboxTarget?.id ?? ""),
        );
        return Boolean(
          row &&
            row.dataStatus === "acting" &&
            row.status === "Acting" &&
            row.statusSelect?.value === "acting" &&
            update &&
            update.patch?.status === "acting" &&
            (state.calls ?? []).filter((name) => name === "signalChainList").length >
              listReadsBefore,
        );
      },
      "the triage update to paint back as Acting after a re-read",
      15_000,
    );
    const triagedRow = inboxTarget ? rowWithBody(triaged, inboxTarget.body) : null;
    const triageUpdate = (triaged.updates ?? []).find(
      (entry) => entry.id === (inboxTarget?.id ?? ""),
    );
    const storedTriage = (triaged.store?.records ?? []).find(
      (record) => record.id === (inboxTarget?.id ?? ""),
    );
    check(
      "the row paints Acting after the triage",
      triagedRow?.dataStatus === "acting" && triagedRow?.status === "Acting",
      `painted ${JSON.stringify(triagedRow && { dataStatus: triagedRow.dataStatus, status: triagedRow.status, select: triagedRow.statusSelect?.value })}`,
    );
    check(
      "the triage select wrote the status patch",
      triageUpdate?.patch?.status === "acting",
      `patch ${JSON.stringify(triageUpdate?.patch ?? null)}`,
    );
    check(
      "the triage wrote only the status it named",
      JSON.stringify(triageUpdate?.patch ?? null) === JSON.stringify({ status: "acting" }),
      `patch ${JSON.stringify(triageUpdate?.patch ?? null)}`,
    );
    check(
      "the chain was re-read after the triage",
      (triaged.calls ?? []).filter((name) => name === "signalChainList").length >
        listReadsBefore,
      `reads ${listReadsBefore} -> ${(triaged.calls ?? []).filter((name) => name === "signalChainList").length}`,
    );
    check(
      "the vault stored the triaged status",
      storedTriage?.status === "acting",
      `stored ${JSON.stringify(storedTriage && { status: storedTriage.status })}`,
    );

    // The filters: a match, then no matches, then back to All. Choosing Acting
    // is a second read of the status the triage just wrote.
    const acted = await js(selectFilter("signal-filter-status", "acting"));
    check(
      "the status filter accepts the operator's choice",
      acted === "ok",
      `select returned ${JSON.stringify(acted)}`,
    );
    const actingFilter = await waitState(
      (state) =>
        state.rows.length === 1 &&
        rowWithBody(state, inboxTarget?.body ?? "") !== null &&
        state.filters?.status?.value === "acting",
      "the acting filter to show just the triaged row",
    );
    check(
      "the acting filter shows the one triaged row",
      actingFilter.rows.length === 1 &&
        inboxTarget !== null &&
        rowWithBody(actingFilter, inboxTarget.body) !== null,
      `${actingFilter.rows.length} rows, bodies ${JSON.stringify(actingFilter.rows.map((row) => row.body))}`,
    );
    check(
      "the status picker holds Acting",
      actingFilter.filters?.status?.value === "acting",
      `status picker ${JSON.stringify(actingFilter.filters?.status)}`,
    );

    // The operator-facing half of the evidence, taken while the Acting filter
    // proves the change: the one triaged row, its Acting select, and the
    // status picker that narrowed the list to it.
    await js(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="signal-row"]'));
      const row = rows.find((candidate) => {
        const el =
          candidate.querySelector('[data-testid="signal-body"]') ||
          candidate.querySelector('.signal-row__body');
        return Boolean(el) && (el.textContent || '').includes(${JSON.stringify(inboxTarget?.body ?? "")});
      });
      if (!row) return false;
      row.scrollIntoView({ block: "center" });
      return true;
    })()`);
    await sleep(300);
    const inboxShot = await captureFile("chain-inbox-triage.png");
    const inboxShotBytes = fs.statSync(inboxShot).size;
    check(
      "capture chain-inbox-triage.png is a real picture",
      inboxShotBytes > 20_000,
      `${inboxShotBytes} bytes`,
    );

    await js(selectFilter("signal-filter-status", "done"));
    const doneFilter = await waitState(
      (state) =>
        state.rows.length === 0 &&
        (state.filterEmpty ?? "") === "No signals match these filters." &&
        state.filters?.status?.value === "done",
      "the done filter to leave no rows and say why",
    );
    check(
      "a filter with no matches paints the filter-empty line",
      (doneFilter.filterEmpty ?? "") === "No signals match these filters.",
      `line ${JSON.stringify(doneFilter.filterEmpty)}`,
    );
    check(
      "a filter with no matches is not the empty-vault line",
      doneFilter.emptyLine === null,
      `empty line ${JSON.stringify(doneFilter.emptyLine)}`,
    );
    check(
      "the status picker holds Done",
      doneFilter.filters?.status?.value === "done",
      `status picker ${JSON.stringify(doneFilter.filters?.status)}`,
    );

    await js(selectFilter("signal-filter-status", "all"));
    const allFilter = await waitState(
      (state) =>
        state.rows.length === expected.seeded.count + CAPTURES_DRIVEN &&
        state.filters?.status?.value === "all",
      "the all filter to restore the chain",
    );
    check(
      "the all filter restores every row",
      allFilter.rows.length === expected.seeded.count + CAPTURES_DRIVEN,
      `${allFilter.rows.length} rows vs ${expected.seeded.count + CAPTURES_DRIVEN}`,
    );
    check(
      "the status picker is back on All",
      allFilter.filters?.status?.value === "all",
      `status picker ${JSON.stringify(allFilter.filters?.status)}`,
    );

    checks.inbox = {
      expected: inboxExpected ?? null,
      rows: inboxRows,
      controls: {
        statusOptions: statusOptionValues,
        statusLabels: statusOptionLabels,
        priorityOptions: (prioritySelect?.options ?? []).map((option) => option.value),
        priorityLabels: priorityOptionLabels,
        projectOptions: (projectSelect?.options ?? []).map((option) => option.value),
        projectLabels: projectOptionLabels,
        filterStatus: baseline.filters?.status ?? null,
        filterProject: baseline.filters?.project ?? null,
        filterArea: baseline.filterArea ?? null,
        filterAreaSelect: baseline.filterAreaSelect === true,
        filterLayout: baseline.filterLayout ?? null,
      },
      triage: {
        targetId: inboxTarget?.id ?? null,
        targetBody: inboxTarget?.body ?? null,
        before: {
          dataStatus: targetBefore?.dataStatus ?? null,
          status: targetBefore?.status ?? null,
          select: targetBefore?.statusSelect?.value ?? null,
        },
        after: {
          dataStatus: triagedRow?.dataStatus ?? null,
          status: triagedRow?.status ?? null,
          select: triagedRow?.statusSelect?.value ?? null,
          storedStatus: storedTriage?.status ?? null,
        },
        patch: triageUpdate?.patch ?? null,
        updates: triaged.updates ?? [],
        listReadsBefore,
        listReadsAfter: (triaged.calls ?? []).filter(
          (name) => name === "signalChainList",
        ).length,
      },
      filter: {
        acting: {
          rows: actingFilter.rows.length,
          value: actingFilter.filters?.status?.value ?? null,
        },
        done: {
          rows: doneFilter.rows.length,
          empty: doneFilter.filterEmpty,
          emptyLine: doneFilter.emptyLine,
          value: doneFilter.filters?.status?.value ?? null,
        },
        all: {
          rows: allFilter.rows.length,
          value: allFilter.filters?.status?.value ?? null,
        },
      },
      screenshot: { name: path.basename(inboxShot), bytes: inboxShotBytes },
    };

    // ── 7. the dock's Notebox view paints the same attachments ─────────────
    // The page is the capture surface; the dock is the second surface the same
    // records appear on, so a picture or a link written here has to draw there
    // too. The dock's own chain read happens when the surface opens, and the
    // surface and its control carry the renamed page's name.
    const dockClicked = await js(clickDockChain);
    const dockChain = await waitState(
      (state) =>
        state.dock.surface === "chain" &&
        state.dock.items.length === expected.seeded.count + CAPTURES_DRIVEN,
      "the dock's chain surface to list the chain",
    );
    check(
      "the dock switches to its chain surface",
      dockChain.dock.surface === "chain",
      `surface ${JSON.stringify(dockChain.dock.surface)}`,
    );
    check(
      "the dock lists the same chain",
      dockChain.dock.items.length === expected.seeded.count + CAPTURES_DRIVEN,
      `${dockChain.dock.items.length} rows vs ${expected.seeded.count + CAPTURES_DRIVEN}`,
    );
    check(
      "the dock's chain surface is named Notebox",
      dockChain.dock.heading === "Notebox",
      `heading ${JSON.stringify(dockChain.dock.heading)}`,
    );
    check(
      "the dock control is labelled Notebox",
      dockChain.dock.action === true,
      `action ${JSON.stringify(dockChain.dock.action)}`,
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
      heading: dockPainted.dock.heading,
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

    // ── 8. the box's area is the lens at the top ─────────────────────────────
    // The box has no area picker of its own: a capture files under the area the
    // switcher has open, and the Life lens (the general area) files it
    // unassigned under the readout "Life (general)". Switching the lens is the
    // one way to file somewhere else, so the readout is checked to be a readout
    // and the write is checked to carry the lens it showed.
    const lensArea = (dockPainted.areas ?? [])[0] ?? null;
    const beforeLens = await sample();
    check(
      "the box files in Life (general) on the Life lens",
      beforeLens.composerArea?.present === true &&
        beforeLens.composerArea?.value === "Life (general)" &&
        beforeLens.composerArea?.slug === "" &&
        (beforeLens.composerArea?.controls ?? -1) === 0,
      `readout ${JSON.stringify(beforeLens.composerArea)}`,
    );
    const lensClicked = await js(clickLens(lensArea?.name ?? ""));
    check(
      "the area switcher accepts the operator's choice",
      lensClicked === true && lensArea !== null,
      `click returned ${JSON.stringify(lensClicked)}, area ${JSON.stringify(lensArea)}`,
    );
    const lensed = await waitState(
      (state) =>
        state.composerArea?.slug === (lensArea?.slug ?? "") &&
        state.composerArea?.value === (lensArea?.name ?? ""),
      "the box's area to follow the switcher",
    );
    check(
      "the box's area follows the switcher",
      lensed.composerArea?.value === lensArea?.name &&
        lensed.composerArea?.slug === lensArea?.slug,
      `readout ${JSON.stringify(lensed.composerArea)} vs area ${JSON.stringify(lensArea)}`,
    );
    check(
      "the switcher wrote the new lens",
      (lensed.lensWrites ?? []).includes(lensArea?.slug ?? ""),
      `lens writes ${JSON.stringify(lensed.lensWrites)}`,
    );

    // Log under the chosen area: the bridge is handed that area, and the row
    // paints it — the readout is not a label dressing a null write.
    const lensBody = "Filed under the open area.";
    await js(setValue(".signal-chain textarea", lensBody));
    await js(pressEnter(".signal-chain textarea"));
    const lensLogged = await waitState(
      (state) =>
        (state.creates ?? []).length === CAPTURES_DRIVEN + 1 &&
        rowWithBody(state, lensBody) !== null,
      "the capture under the open area to land",
    );
    const lensCreate = lensLogged.creates[lensLogged.creates.length - 1];
    const lensRow = rowWithBody(lensLogged, lensBody);
    check(
      "a capture under an area lens carries that area",
      lensCreate?.domainSlug === (lensArea?.slug ?? null),
      `create ${JSON.stringify(lensCreate)} vs area ${JSON.stringify(lensArea)}`,
    );
    check(
      "the captured row paints the area it filed under",
      lensRow?.dataDomainSlug === (lensArea?.slug ?? "") &&
        lensRow?.domain === lensArea?.name,
      `row ${JSON.stringify(lensRow && { dataDomainSlug: lensRow.dataDomainSlug, domain: lensRow.domain })}`,
    );

    check(
      "the band's area readout follows the switcher too",
      lensed.filterArea?.value === lensArea?.name &&
        lensed.filterArea?.slug === lensArea?.slug,
      `filter area ${JSON.stringify(lensed.filterArea)} vs area ${JSON.stringify(lensArea)}`,
    );

    // The operator-facing half: the switcher on the area, the readouts naming it
    // and the new row filed under it, in one picture, framed from the page's top
    // so the heading and the filter band sit above the filed row.
    await js(`(() => {
      const page = document.querySelector(".signal-chain");
      let node = page ? page.parentElement : null;
      while (node) {
        const style = getComputedStyle(node);
        if (
          /auto|scroll/.test(style.overflowY) &&
          node.scrollHeight > node.clientHeight
        ) {
          node.scrollTop = 0;
          return "scrolled";
        }
        node = node.parentElement;
      }
      window.scrollTo(0, 0);
      return "window";
    })()`);
    await sleep(300);
    const lensShot = await captureFile("chain-capture-area.png");
    const lensShotBytes = fs.statSync(lensShot).size;
    check(
      "capture chain-capture-area.png is a real picture",
      lensShotBytes > 20_000,
      `${lensShotBytes} bytes`,
    );

    // Back to Life: the readout returns to the general area.
    const lifeClicked = await js(clickLens("Life"));
    check(
      "the Life tab is on the switcher",
      lifeClicked === true,
      `click returned ${JSON.stringify(lifeClicked)}`,
    );
    const backToLife = await waitState(
      (state) =>
        state.composerArea?.value === "Life (general)" &&
        state.composerArea?.slug === "",
      "the box's area to return to Life (general)",
    );
    check(
      "the box returns to Life (general) on the Life lens",
      backToLife.composerArea?.value === "Life (general)" &&
        backToLife.composerArea?.slug === "",
      `readout ${JSON.stringify(backToLife.composerArea)}`,
    );

    checks.lens = {
      area: lensArea,
      before: beforeLens.composerArea,
      lensed: lensed.composerArea,
      filterBefore: beforeLens.filterArea,
      filterLensed: lensed.filterArea,
      create: lensCreate ?? null,
      row: lensRow,
      after: backToLife.composerArea,
      filterAfter: backToLife.filterArea,
      lensWrites: backToLife.lensWrites ?? [],
      screenshot: { name: path.basename(lensShot), bytes: lensShotBytes },
    };

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
