/**
 * Drives the confirm-layering harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/confirm-layering.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/confirm-layering.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same numbers, no eyeballing the app required. It carries the
 * shipped arrangement, the swap that puts the dock on the leading side, the
 * question the sidebar asks about a chat, the scrim it wears, the points inside
 * the card that used to be covered by the dock, and the two answers (cancel,
 * confirm) with the bridge calls they made.
 *
 * NOT covered here: whether the dock's write reaches Hermes. The rig answers from
 * a stubbed bridge, so it asserts the question, its paint order, and which chat
 * id the answer carried — the gateway's own `sessions.delete` is not in this
 * window.
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
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/confirm-layering.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const SAMPLE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const px = (value) => Math.round(parseFloat(value) || 0);

  /** One computed colour, resolved by the browser from a token expression. */
  const mix = (expression) => {
    const probe = document.createElement("div");
    probe.style.background = expression;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  };
  /** One computed filter, resolved by the browser from a token expression. */
  const filterOf = (expression) => {
    const probe = document.createElement("div");
    probe.style.backdropFilter = expression;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backdropFilter;
    probe.remove();
    return value;
  };

  const root = getComputedStyle(document.documentElement);
  const shell = document.querySelector(".shell");
  const rail = document.querySelector(".nav-rail");
  const chat = document.querySelector(".chat-panel");
  const main = document.querySelector(".shell__main");
  const railBox = box(rail);
  const chatBox = box(chat);
  const mainBox = box(main);

  const card = document.querySelector(".confirm-dialog");
  const backdrop = document.querySelector(".confirm-dialog-backdrop");
  const glassProbe = document.querySelector("[data-rig-glass-probe]");
  const cardBox = box(card);
  const backdropBox = box(backdrop);
  const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;

  /**
   * What the window paints at a point — the only answer that can settle a
   * stacking question. \`inCard\` is the claim that matters: a card the dock covers
   * still measures where it was placed, so its box alone cannot prove it is the
   * surface on top.
   */
  const hit = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return { x, y, hit: null, inCard: false, inBackdrop: false, inDock: false, inRail: false, inSheet: false, inTitlebar: false };
    return {
      x,
      y,
      hit: String((typeof el.className === "string" && el.className) || el.tagName),
      inCard: Boolean(card && card.contains(el)),
      inBackdrop: Boolean(backdrop && backdrop.contains(el)),
      inDock: Boolean(chat && chat.contains(el)),
      inRail: Boolean(rail && rail.contains(el)),
      inSheet: Boolean(main && main.contains(el)),
      inTitlebar: Boolean(document.querySelector(".window-titlebar")?.contains(el))
    };
  };
  /** A point inside a box, inset from its edges. */
  const at = (target, fx, fy, inset = 6) =>
    target
      ? hit(
          Math.round(target.left + Math.min(inset, target.width / 2) + (target.width - 2 * Math.min(inset, target.width / 2)) * fx),
          Math.round(target.top + Math.min(inset, target.height / 2) + (target.height - 2 * Math.min(inset, target.height / 2)) * fy)
        )
      : null;

  const active = document.activeElement;
  const cancel = card ? card.querySelector(".confirm-dialog__cancel") : null;
  const confirm = card ? card.querySelector(".confirm-dialog__confirm") : null;

  // The point the dock used to own: inside the dock's column, far below the
  // card, where no question is drawn.
  const dockOnlyY = chatBox ? Math.round(Math.min(window.innerHeight - 40, chatBox.bottom - 60)) : 0;
  const sheetOnlyY = mainBox ? Math.round(Math.min(window.innerHeight - 40, mainBox.bottom - 60)) : 0;
  const railOnlyY = railBox ? Math.round(Math.min(window.innerHeight - 40, railBox.bottom - 60)) : 0;

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    theme: {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      canvasBase: root.getPropertyValue("--canvas-base").trim(),
      fg: root.getPropertyValue("--fg").trim()
    },
    shell: shell ? { className: shell.className } : null,
    rail: railBox,
    chat: chatBox,
    main: mainBox,
    rows: Array.from(document.querySelectorAll(".chats-rail__row")).map((row) => ({
      label: text(row.querySelector(".chats-rail__label"))
    })),
    // The fixture's own ids, mapped to the labels it published: the driver names
    // the chat the sidebar asked about without retyping a fixture id beside it.
    harnessRows: [...(window.confirmHarnessRows ?? [])],
    menuOpen: Boolean(document.querySelector(".chats-rail [role='menu']")),
    deleteCalls: [...(window.confirmDeleteCalls ?? [])],
    glass: glassProbe
      ? {
          backdropFilter:
            getComputedStyle(glassProbe).backdropFilter ||
            getComputedStyle(glassProbe).webkitBackdropFilter ||
            null,
          background: getComputedStyle(glassProbe).backgroundColor
        }
      : null,
    scrim: {
      // The recipe the question is supposed to wear: the settings sheet's glass.
      expectedBackground: mix("color-mix(in srgb, var(--canvas-base) 38%, transparent)"),
      // The fill it used to wear — the paper-white veil this fix removes.
      oldWashBackground: mix("color-mix(in srgb, var(--fg) 35%, transparent)"),
      // The sheet's recipe expressed directly, for a browser without the class.
      expectedBlur: filterOf("blur(7px) saturate(0.94)")
    },
    dialog: cardBox
      ? {
          present: true,
          title: text(card.querySelector(".confirm-dialog__title")),
          message: text(card.querySelector(".confirm-dialog__message")),
          confirmLabel: text(confirm),
          cancelLabel: text(cancel),
          role: card.getAttribute("role"),
          ariaModal: card.getAttribute("aria-modal"),
          box: cardBox,
          backdrop: backdropBox,
          backdropPosition: backdropStyle ? backdropStyle.position : null,
          backdropZIndex: backdropStyle ? backdropStyle.zIndex : null,
          backdropFilter:
            (backdropStyle && (backdropStyle.backdropFilter || backdropStyle.webkitBackdropFilter)) ||
            null,
          backdropBackground: backdropStyle ? backdropStyle.backgroundColor : null,
          /** Card centre minus the window's centre: the contract is ~0. */
          offsetFromWindowX: Math.round(
            cardBox.left + cardBox.width / 2 - window.innerWidth / 2
          ),
          offsetFromWindowY: Math.round(
            cardBox.top + cardBox.height / 2 - window.innerHeight / 2
          ),
          /** Card centre minus the dock's centre: what it must NOT be. */
          offsetFromDockX: chatBox
            ? Math.round(cardBox.left + cardBox.width / 2 - (chatBox.left + chatBox.width / 2))
            : null,
          /** How much of the card hangs over the dock's column. */
          overlapsDockBy: chatBox ? Math.round(chatBox.right - cardBox.left) : 0,
          withinWindow:
            cardBox.left >= 0 &&
            cardBox.top >= 0 &&
            cardBox.right <= window.innerWidth &&
            cardBox.bottom <= window.innerHeight,
          focus: active
            ? {
                inCancel: cancel ? cancel.contains(active) : false,
                inConfirm: confirm ? confirm.contains(active) : false,
                className: typeof active.className === "string" ? active.className : active.tagName
              }
            : null,
          // The points the card has to own. \`leftInside\` is the one the dock used
          // to paint over; the rest make sure that is not a single lucky pixel.
          hits: {
            centre: at(cardBox, 0.5, 0.5),
            leftInside: at(cardBox, 0, 0.5),
            rightInside: at(cardBox, 1, 0.5),
            topLeftInside: at(cardBox, 0, 0),
            bottomLeftInside: at(cardBox, 0, 1),
            topRightInside: at(cardBox, 1, 0)
          },
          // And the points the scrim has to own: the panes the question is
          // painting over, outside the card's own box.
          scrimHits: {
            dock: chatBox ? hit(Math.round(chatBox.left + chatBox.width / 2), dockOnlyY) : null,
            sheet: mainBox ? hit(Math.round(mainBox.left + mainBox.width / 2), sheetOnlyY) : null,
            rail: railBox ? hit(Math.round(railBox.left + railBox.width / 2), railOnlyY) : null
          }
        }
      : null,
    /** The same three points with no question up: the panes own them again. */
    idle: {
      dock: chatBox ? hit(Math.round(chatBox.left + chatBox.width / 2), dockOnlyY) : null,
      sheet: mainBox ? hit(Math.round(mainBox.left + mainBox.width / 2), sheetOnlyY) : null
    }
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/** Channel values of a computed colour; 0–1 forms are scaled to 0–255. */
function channels(color) {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  // `color-mix()` resolves to `color(srgb r g b / a)` in this browser: three
  // 0–1 channels and an alpha, which a four-number `rgba()` reading would take
  // for three 0–255 channels beside an alpha.
  if (/^color\(\s*srgb/i.test(color ?? "")) {
    return raw.slice(0, 3).map((value) => value * 255);
  }
  return raw.length === 3 && raw.every((value) => value <= 1.0001)
    ? raw.map((value) => value * 255)
    : raw;
}

/** Alpha of a computed colour: 1 when it carries none. */
function alphaOf(color) {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length >= 4 ? raw[3] : 1;
}

/** Largest per-channel gap between two computed colours; NaN when unparseable. */
function channelDelta(a, b) {
  const x = channels(a);
  const y = channels(b);
  if (x.length < 3 || y.length < 3) return Number.NaN;
  return Math.max(...x.map((value, index) => Math.abs(value - y[index])));
}

/**
 * The last step the rig reached.
 *
 * A throw anywhere inside the run leaves `report` as the catch branch, so without
 * this the failure reads as a bare "Script failed to execute" with no indication
 * of which evaluation produced it — which is a bisect instead of a diagnosis.
 */
let step = "start";
const at = (name) => {
  step = name;
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the theme
  // the app itself defaults to (tokens.css, [data-theme="dark"]) so a test run is
  // not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 220 ms hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const shot = async (name, rect) => {
    const image = await win.webContents.capturePage(rect);
    const file = path.join(artifactsDir, name);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  // Vite re-optimises dependencies the first time a new import appears and
  // reloads the page when it does, which clears the harness globals mid-wait —
  // so poll instead of assuming the first evaluate lands after the module ran.
  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.confirmLayeringReady !== "object") return null;
          await window.confirmLayeringReady;
          return typeof window.confirmHarnessVaultName === "string"
            ? window.confirmHarnessVaultName
            : null;
        })()`);
        if (typeof ready === "string") return ready;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  const sample = async (attempt = 0) => {
    let value;
    try {
      value = await run(SAMPLE);
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return sample(attempt + 1);
    }
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settled = async (ms = 260) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  const click = async (selector) => {
    const clicked = await run(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      return true;
    })()`);
    if (!clicked) throw new Error(`no element for ${selector}`);
  };

  /**
   * Escape, from the body: a real key event starts at the focused element and
   * bubbles up through `document` to `window`, which is where the confirm listens.
   */
  const pressEscape = () =>
    run(`(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
      return true;
    })()`);

  /** The row's own kebab, then the named command inside its menu. */
  const askToDeleteFirstRow = async () => {
    await click(".chats-rail__row .chats-rail__menu-btn");
    await click(".chats-rail [role='menu'] [aria-label='Delete chat']");
  };

  /**
   * Every point the card covers has to be the card, and every point the scrim
   * covers has to be the scrim. Stated once, read against both answers below.
   */
  const checkQuestion = (label, state) => {
    const dialog = state.dialog;
    check(`${label}: the question is up`, Boolean(dialog), "no .confirm-dialog in the window");
    if (!dialog) return;

    check(
      `${label}: the question names the write`,
      dialog.title === "Delete chat" && dialog.confirmLabel === "Delete chat",
      `title ${JSON.stringify(dialog.title)}, confirm ${JSON.stringify(dialog.confirmLabel)}`,
    );
    check(
      `${label}: the question says what it takes`,
      /Delete ".+"\?/.test(dialog.message) && /cannot be undone/.test(dialog.message),
      `message ${JSON.stringify(dialog.message)}`,
    );
    check(
      `${label}: the question is a modal dialog`,
      dialog.role === "dialog" && dialog.ariaModal === "true",
      `role ${JSON.stringify(dialog.role)}, aria-modal ${JSON.stringify(dialog.ariaModal)}`,
    );
    check(
      `${label}: the question is centred on the window`,
      Math.abs(dialog.offsetFromWindowX) <= 2 && Math.abs(dialog.offsetFromWindowY) <= 2,
      `${dialog.offsetFromWindowX}px across, ${dialog.offsetFromWindowY}px down from the window's centre`,
    );
    check(
      `${label}: the question is not centred on the dock`,
      Math.abs(dialog.offsetFromDockX ?? 0) > 40,
      `${dialog.offsetFromDockX}px from the dock's centre`,
    );
    check(
      `${label}: the card is whole inside the window`,
      dialog.withinWindow,
      `card ${JSON.stringify(dialog.box)} in a ${state.viewport.width}x${state.viewport.height} window`,
    );
    check(
      `${label}: the card holds the caret`,
      dialog.focus?.inCancel === true,
      `focus ${JSON.stringify(dialog.focus)}`,
    );

    // The reported geometry: the card has to hang over the dock's column, or the
    // layering claim below would be about a card that never crosses it.
    check(
      `${label}: the card hangs over the dock (${
        state.shell?.className?.includes("shell--chat-left") ? "swapped" : "shipped"
      } arrangement)`,
      dialog.overlapsDockBy >= 100,
      `${dialog.overlapsDockBy}px of the card crosses the dock's trailing edge`,
    );

    for (const [point, hit] of Object.entries(dialog.hits)) {
      check(
        `${label}: the card owns its ${point} (not the dock behind it)`,
        hit?.inCard === true,
        `${point} ${JSON.stringify(hit)}`,
      );
    }
    // The dock point is the one the bug report is about: before the fix the
    // sidebar's stacking context left the card under the dock here.
    check(
      `${label}: the dock does not paint over the card's leading half`,
      dialog.hits.leftInside?.inCard === true && dialog.hits.leftInside.inDock === false,
      `left ${JSON.stringify(dialog.hits.leftInside)}`,
    );

    check(
      `${label}: the scrim covers the window`,
      dialog.backdrop?.width === state.viewport.width &&
        dialog.backdrop?.height === state.viewport.height &&
        dialog.backdropPosition === "fixed",
      `backdrop ${JSON.stringify(dialog.backdrop)} at ${dialog.backdropPosition}`,
    );
    for (const [pane, hit] of Object.entries(dialog.scrimHits)) {
      check(
        `${label}: the scrim covers the ${pane}`,
        hit?.inBackdrop === true && hit.inDock === false && hit.inRail === false && hit.inSheet === false,
        `${pane} ${JSON.stringify(hit)}`,
      );
    }

    // The effect the operator asked for: the settings sheet's glass, not the
    // flat `--fg` veil that whitened the page.
    check(
      `${label}: the scrim blurs`,
      typeof dialog.backdropFilter === "string" && /blur\(\s*7px\s*\)/.test(dialog.backdropFilter),
      `backdrop-filter ${JSON.stringify(dialog.backdropFilter)}`,
    );
    check(
      `${label}: the scrim wears the settings sheet's glass`,
      dialog.backdropFilter === state.glass?.backdropFilter,
      `question ${JSON.stringify(dialog.backdropFilter)} vs sheet ${JSON.stringify(state.glass?.backdropFilter)}`,
    );
    check(
      `${label}: the scrim wears the sheet's canvas fill`,
      channelDelta(dialog.backdropBackground, state.scrim.expectedBackground) <= 2,
      `question ${dialog.backdropBackground} vs color-mix(canvas-base 38%) ${state.scrim.expectedBackground}`,
    );
    check(
      `${label}: the scrim is a veil, not opaque`,
      alphaOf(dialog.backdropBackground) > 0.3 && alphaOf(dialog.backdropBackground) < 0.5,
      `alpha ${alphaOf(dialog.backdropBackground)} of ${dialog.backdropBackground}`,
    );
    check(
      `${label}: the scrim is not the old fg wash that whitened the page`,
      channelDelta(dialog.backdropBackground, state.scrim.oldWashBackground) > 30,
      `question ${dialog.backdropBackground} vs the old color-mix(fg 35%) ${state.scrim.oldWashBackground}`,
    );
    check(
      `${label}: the scrim and the sheet agree on the canvas fill`,
      channelDelta(dialog.backdropBackground, state.glass?.background) <= 2,
      `question ${dialog.backdropBackground} vs sheet ${state.glass?.background}`,
    );
  };

  let report;
  const timeout = setTimeout(() => {
    console.error("confirm-layering: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();

    // Fixed content size so every number is comparable run to run.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    // 1 — the shipped arrangement, before anything is asked. The layout the bug
    //     report starts from: the dock on the trailing side, the rail leading.
    at("shipped arrangement");
    const shipped = await settled();
    const shippedShot = await shot("confirm-layering-shipped.png");
    check(
      "shipped: the dock is on the trailing side",
      shipped.shell?.className?.includes("shell--chat-right") === true,
      `shell classes ${JSON.stringify(shipped.shell?.className)}`,
    );
    check(
      "shipped: the sidebar lists the chats",
      shipped.rows.length === 2,
      `rows ${JSON.stringify(shipped.rows)}`,
    );
    check("shipped: no question is up", shipped.dialog === null, JSON.stringify(shipped.dialog));
    check(
      "shipped: the dock owns its own column at rest",
      shipped.idle?.dock?.inDock === true && shipped.idle?.dock?.inBackdrop === false,
      `dock point ${JSON.stringify(shipped.idle?.dock)}`,
    );

    // 2 — the reported gesture: swap the dock and the sheet from the dock's own
    //     bottom action bar, so the chat bar now stands on the leading side
    //     beside the sidebar.
    at("swapped arrangement");
    await click('[data-testid="chat-side-switch"]');
    const swapped = await settled();
    const swappedShot = await shot("confirm-layering-swapped.png");
    check(
      "swapped: the dock takes the leading column",
      swapped.shell?.className?.includes("shell--chat-left") === true &&
        (swapped.chat?.left ?? Infinity) < (swapped.main?.left ?? 0),
      `shell ${JSON.stringify(swapped.shell?.className)}, dock ${JSON.stringify(swapped.chat)}, sheet ${JSON.stringify(swapped.main)}`,
    );
    check(
      "swapped: the sidebar still lists the chats",
      swapped.rows.length === 2,
      `rows ${JSON.stringify(swapped.rows)}`,
    );

    // 3 — delete a chat from the left sidebar: the row's menu, then Delete.
    at("asked from the sidebar");
    const row = swapped.rows[0];
    const rowId =
      swapped.harnessRows.find((candidate) => candidate.label === row?.label)?.id ?? null;
    await askToDeleteFirstRow();
    const asked = await settled();
    const askedShot = await shot("confirm-layering-asked.png");
    const crop = asked.dialog?.box
      ? await shot("confirm-layering-asked-crop.png", {
          x: Math.max(0, asked.dialog.box.left - 40),
          y: Math.max(0, asked.dialog.box.top - 30),
          width: Math.min(
            asked.viewport.width - Math.max(0, asked.dialog.box.left - 40),
            asked.dialog.box.width + 80,
          ),
          height: Math.min(
            asked.viewport.height - Math.max(0, asked.dialog.box.top - 30),
            asked.dialog.box.height + 60,
          ),
        })
      : null;
    check(
      "asked: the row menu closed on the way in",
      asked.menuOpen === false,
      "the row menu is still open under the question",
    );
    check(
      "asked: the delete has not written yet",
      asked.deleteCalls.length === 0,
      `deletes ${JSON.stringify(asked.deleteCalls)}`,
    );
    check(
      "asked: the question names a chat in the sidebar",
      typeof row?.label === "string" &&
        row.label.length > 0 &&
        (asked.dialog?.message ?? "").includes(row.label),
      `row ${JSON.stringify(row)}, message ${JSON.stringify(asked.dialog?.message)}`,
    );
    checkQuestion("asked", asked);

    // 4 — cancelling writes nothing, and takes the scrim away with it.
    at("cancelled");
    await pressEscape();
    const cancelled = await settled();
    const cancelledShot = await shot("confirm-layering-cancelled.png");
    check(
      "cancelled: Escape closes the question",
      cancelled.dialog === null,
      JSON.stringify(cancelled.dialog),
    );
    check(
      "cancelled: a cancelled delete wrote nothing",
      cancelled.deleteCalls.length === 0,
      `deletes ${JSON.stringify(cancelled.deleteCalls)}`,
    );
    check(
      "cancelled: the dock owns its column again",
      cancelled.idle?.dock?.inDock === true && cancelled.idle?.dock?.inBackdrop === false,
      `dock point ${JSON.stringify(cancelled.idle?.dock)}`,
    );

    // 5 — answering yes writes the chat the row named, and only that one.
    at("confirmed");
    await askToDeleteFirstRow();
    await settled();
    await click(".confirm-dialog__confirm");
    const deleted = await settled();
    const deletedShot = await shot("confirm-layering-deleted.png");
    check(
      "confirmed: the write reached the bridge once",
      deleted.deleteCalls.length === 1,
      `deletes ${JSON.stringify(deleted.deleteCalls)}`,
    );
    check(
      "confirmed: the write named the chat the row asked about",
      deleted.deleteCalls[0] === rowId,
      `deleted ${JSON.stringify(deleted.deleteCalls[0])} vs row ${JSON.stringify(rowId)} (${JSON.stringify(row)})`,
    );
    check(
      "confirmed: the question closed after the answer",
      deleted.dialog === null,
      JSON.stringify(deleted.dialog),
    );
    check(
      "confirmed: the deleted chat left the sidebar",
      deleted.rows.length === cancelled.rows.length - 1,
      `${deleted.rows.length} rows after ${cancelled.rows.length}`,
    );
    check(
      "confirmed: the delete did not take another row",
      !deleted.rows.some((candidate) => candidate.label === row?.label),
      `rows ${JSON.stringify(deleted.rows)}`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      vaultName,
      theme: asked.theme,
      shipped,
      swapped,
      asked,
      cancelled,
      deleted,
      screenshots: [shippedShot, swappedShot, askedShot, crop, cancelledShot, deletedShot].filter(
        Boolean,
      ),
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw at ${step}: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "confirm-layering.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  if (report.asked?.dialog) {
    const d = report.asked.dialog;
    console.log(
      `card ${JSON.stringify(d.box)}, scrim ${d.backdropBackground} ${d.backdropFilter}`,
    );
    console.log(
      `card over dock by ${d.overlapsDockBy}px; hits ${JSON.stringify(d.hits)}`,
    );
  }
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "confirm layering: PASS" : "confirm layering: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`confirm-layering: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
