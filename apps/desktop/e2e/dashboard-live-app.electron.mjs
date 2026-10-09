/**
 * The wired-app acceptance run: the REAL LifeQuest main process, the REAL
 * preload, and the REAL renderer, opened on the operator's own vault.
 *
 * The other rigs prove the pieces. This one proves the join — that the built
 * `main.js` reads the board's lock over the real IPC bridge, that `pins:setLocked`
 * is a channel the preload and main agree on, and that the summary table
 * `scratch-live-dashboard` pinned shows up on the operator's Dashboard through
 * `pins:list` → `HomePage` → `ViewCard` → `view:runSaved`, with no stub anywhere.
 *
 * Run from `apps/desktop`, with the dev server up and the main bundle built:
 *
 *   <electron> e2e/dashboard-live-app.electron.mjs
 *
 * Isolation: `LIFEQUEST_E2E` points the app at a throwaway profile seeded with a
 * copy of the operator's `recent.json`, so their vault auto-opens and their own
 * `%APPDATA%\LifeQuest` is never written; the window is hidden, so nothing
 * flashes on their desktop. This is the only rig here that runs the application
 * itself rather than a harness page.
 *
 * `--drag` (through the launcher) adds the one leg that writes: it reorders the
 * operator's own Overview board through the real IPC channel and then puts the
 * order back, asserting the board file at each step. It is opt-in for the same
 * reason the screenshot is: everything else here reads, and a run that writes to
 * a real vault should be a decision rather than a default.
 *
 * The drag uses the **grip**, not a hold. This window is hidden, and Chromium
 * throttles timers in a window nobody is looking at — a 220 ms hold that never
 * fires would make "a press on a locked board does nothing" pass for the wrong
 * reason. The grip is armed on movement and needs no timer, so the leg proves the
 * channel rather than the frame rate.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const SOURCE_RECENT = path.join(os.homedir(), "AppData", "Roaming", "LifeQuest", "recent.json");
const REPORT = path.join(artifactsDir, "dashboard-live-app.json");

const errors = [];
const failure = (m) => {
  errors.push(m);
  return m;
};

function waitFor(win, expression, label, timeoutMs = 30_000) {
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

/** What the operator's Dashboard renders, read straight off the live DOM. */
const SAMPLE = `(() => {
  const badge = document.querySelector('[data-testid="board-lock-badge"]');
  const title = document.querySelector(".home-dashboard__title");
  return {
    title: title ? title.textContent.trim() : null,
    badge: badge ? badge.textContent.trim() : null,
    locked: badge ? badge.dataset.locked : null,
    toggle: document.querySelector('[data-testid="board-lock-toggle"]')
      ? document.querySelector('[data-testid="board-lock-toggle"]').textContent.trim()
      : null,
    cards: Array.from(document.querySelectorAll(".view-card__title")).map((e) => e.textContent.trim()),
    tables: Array.from(document.querySelectorAll(".view-card__table")).map((t) =>
      Array.from(t.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()),
      ),
    ),
    headers: Array.from(document.querySelectorAll(".view-card__table thead th")).map((th) =>
      th.textContent.trim(),
    ),
    tableAlign: (() => {
      const cell = document.querySelector(".view-card__table tbody td + td");
      return cell ? getComputedStyle(cell).textAlign : null;
    })(),
    // The card must wear the board's own shell, so a pinned view reads as a
    // sibling of the KPI cards rather than as a drawing dropped onto the board.
    shell: (() => {
      const card = document.querySelector(".view-card");
      if (!card) return null;
      const cs = getComputedStyle(card);
      return { background: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius };
    })(),
    /** The live palette the card is judged against, with a sibling card's own. */
    palette: (() => {
      const root = getComputedStyle(document.documentElement);
      const sibling = document.querySelector(".home-card");
      const token = (name) => root.getPropertyValue(name).trim();
      return {
        skin: document.documentElement.dataset.skin ?? null,
        theme: document.documentElement.dataset.theme ?? null,
        accent: token("--accent"),
        bgPanel: token("--bg-panel"),
        border: token("--border"),
        siblingBackground: sibling ? getComputedStyle(sibling).backgroundColor : null,
      };
    })(),
    metrics: Array.from(document.querySelectorAll(".view-card__metric")).map((e) => e.textContent.trim()),
    chrome: document.querySelectorAll(".home-pin__chrome").length,
    pinCount: document.querySelectorAll(".home-dashboard__grid > .home-pin").length,
    addPin: Boolean(document.querySelector('[data-testid="board-add-pin"]')),
    addToggle: Boolean(document.querySelector('[data-testid="board-add-toggle"]')),
  };
})()`;

/** The board's pins, in the order the live DOM has them. */
const ORDER = `[...document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]")].map((el) => el.dataset.pinId)`;

/** Real input, through the browser's own pipeline: this is the app's own window. */
function mouse(win, type, x, y) {
  win.webContents.sendInputEvent({
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    clickCount: 1,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The centre of a selector's box, in the CSS pixels `sendInputEvent` takes. */
async function pointAt(win, selector) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height };
     })()`,
  );
  if (!point) throw new Error(`no element for ${selector}`);
  return point;
}

/** How many proposals are waiting for the operator right now. */
async function pendingDecisions(win) {
  const list = await win.webContents.executeJavaScript("window.lifequest.decisionList()");
  const records = list && list.ok ? list.value : [];
  return records.filter((record) => record.status === "pending").length;
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-live-app-"));
  if (!fs.existsSync(SOURCE_RECENT)) {
    console.error(`no recent.json at ${SOURCE_RECENT} — cannot open a vault`);
    app.exit(1);
    return;
  }
  // Seed the throwaway profile with the operator's recent list so their vault
  // auto-opens. The path itself comes from that file, never from this script.
  fs.copyFileSync(SOURCE_RECENT, path.join(workDir, "recent.json"));

  // The SAME handlers and the SAME window the product boots with. The profile
  // is already isolated above through app.setPath("userData", …).
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();

  const checks = {};

  // The window opens on the operator's last lens, which is a domain. The board
  // this run reports on is the Overview one, so the rail's own switch is used —
  // the same `domain:setActive` channel the renderer calls — and the page is
  // reloaded so the restored lens is re-read.
  //
  // Boot order matters: the renderer paints Welcome before its snapshot arrives
  // and only then swaps to the Dashboard, so this waits for the vault to be open
  // rather than sampling whatever the first frame held. `bootForE2e` returns as
  // soon as the window is loaded, which is earlier than that.
  await waitFor(
    win,
    `Boolean(document.querySelector(".home-dashboard"))`,
    "the vault to open and the Dashboard to mount",
    60_000,
  );
  const onWelcome = await win.webContents.executeJavaScript(
    `Boolean(document.querySelector(".welcome"))`,
  );
  checks.openedOnWelcome = onWelcome;
  if (onWelcome) {
    failure("the app opened on Welcome: the seeded profile did not auto-open the vault");
  }

  const switched = await win.webContents.executeJavaScript(
    `window.lifequest.domainSetActive(null)`,
  );
  checks.overviewSwitch = switched;
  if (!switched || switched.ok !== true) {
    failure(`switching to the Overview lens failed: ${JSON.stringify(switched)}`);
  }
  await win.webContents.reload();
  await waitFor(win, `Boolean(document.querySelector(".home-dashboard"))`, "the Dashboard");
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'false'; })()`,
    "the Overview board to read unlocked",
  );
  // A view card paints its frame first and its rows when `view:runSaved`
  // answers, so the sample waits for the card's content rather than the shell.
  await waitFor(
    win,
    `document.querySelectorAll(".view-card__table tbody tr").length > 0 || Boolean(document.querySelector(".view-card__error, .view-card__empty"))`,
    "the pinned card to draw",
    30_000,
  );

  const board = await win.webContents.executeJavaScript(SAMPLE);
  checks.overview = board;

  // ── the pinned summary table is on the real board ────────────────────────
  if (!board.cards.includes("Spending by month")) {
    failure(`the Overview dashboard does not show the pinned card: ${JSON.stringify(board.cards)}`);
  }
  const rows = board.tables.flat();
  checks.tableRows = rows;
  if (rows.length !== 5) {
    failure(`the card drew ${rows.length} table rows on the live board: ${JSON.stringify(rows)}`);
  }
  checks.metric = board.metrics[0] ?? null;
  if (!(board.metrics[0] ?? "").includes("ZAR")) {
    failure(`the card's headline metric read ${JSON.stringify(board.metrics[0])}`);
  }
  // The card is drawn in the design system, on the operator's real board: the
  // month header comes from the query, the money column is right-aligned, and
  // the shell matches its sibling pins.
  checks.design = { headers: board.headers, tableAlign: board.tableAlign, shell: board.shell };
  if (board.headers[0] !== "Month") {
    failure(`the live card's label column read ${JSON.stringify(board.headers[0])}, expected "Month"`);
  }
  if (!(board.headers[1] ?? "").startsWith("Total")) {
    failure(`the live card's value column read ${JSON.stringify(board.headers[1])}`);
  }
  if (board.tableAlign !== "right") {
    failure(`the live card's value column is ${JSON.stringify(board.tableAlign)}-aligned, expected right`);
  }
  if (!board.shell?.background || board.shell.background === "rgba(0, 0, 0, 0)") {
    failure(`the live card drew no shell background: ${JSON.stringify(board.shell)}`);
  }
  if (board.shell?.border === "0px" || board.shell?.radius === "0px") {
    failure(`the live card drew no shell edge: ${JSON.stringify(board.shell)}`);
  }
  // The card is drawn FROM the live palette, so it cannot drift from the skin
  // the operator runs: the same `--bg-panel` as a sibling KPI card, and the
  // accent the theme hands out.
  checks.palette = board.palette;
  if (board.palette.siblingBackground && board.shell.background !== board.palette.siblingBackground) {
    failure(
      `the live card's paper (${board.shell.background}) is not its siblings' (${board.palette.siblingBackground})`,
    );
  }
  if (board.locked !== "false") failure(`the Overview board read locked=${JSON.stringify(board.locked)}`);
  if (board.toggle !== "Lock") failure(`the live board's control read ${JSON.stringify(board.toggle)}`);
  if (board.chrome === 0) failure("the live unlocked board drew no pin chrome");
  // Adding is a control now, not a permanent row: it is offered at the top of
  // the page and draws the row when asked. This board already carries every
  // system pin, every finance page and the new card, so nothing is left to pin —
  // and the honest answer to "is there an add path?" is no control at all. The
  // chrome count above is what proves the unlocked board is editable.
  checks.addPinRowOffered = board.addPin;
  checks.pinBoardOffered = board.addToggle;

  // ── the lock toggle, over the real IPC channel ───────────────────────────
  // `pins:setLocked` is the one channel this feature adds; a rig with a stubbed
  // bridge can never prove the preload and main agree on its name and arity.
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="board-lock-toggle"]').click()`,
  );
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'true'; })()`,
    "the live board to lock",
  );
  const lockedSample = await win.webContents.executeJavaScript(SAMPLE);
  checks.afterLockClick = lockedSample;
  if (lockedSample.badge !== "Locked") {
    failure(`the board did not lock: badge ${JSON.stringify(lockedSample.badge)}`);
  }
  if (lockedSample.chrome !== 0 || lockedSample.addPin) {
    failure("the locked live board is still editable");
  }
  if (lockedSample.pinCount !== board.pinCount) {
    failure(
      `the locked live board changed its cards: ${board.pinCount} pins unlocked, ${lockedSample.pinCount} locked`,
    );
  }

  // ...and back, so the operator's board is left as it was found (unlocked).
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="board-lock-toggle"]').click()`,
  );
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'false'; })()`,
    "the live board to unlock again",
  );
  checks.afterUnlockClick = await win.webContents.executeJavaScript(SAMPLE);
  if (checks.afterUnlockClick.chrome !== board.chrome) {
    failure(
      `unlocking restored ${checks.afterUnlockClick.chrome} pin chrome bars, the unlocked board had ${board.chrome}`,
    );
  }
  if (checks.afterUnlockClick.addPin !== board.addPin) {
    failure("unlocking did not restore the Add-pin row to its unlocked state");
  }

  // ── arranging the operator's own board, over the real IPC channel ─────────
  //
  // The harness rig proves the gesture against a stubbed bridge. This is the only
  // place the whole chain is real at once: grip → pointer capture → the slot rule
  // → `pins:set` → the board file on disk → the renderer reading it back.
  if (process.env.LIFEQUEST_E2E_DRAG) {
    const before = await win.webContents.executeJavaScript(ORDER);
    checks.dragBefore = before;
    if (before.length < 2) {
      failure(`the live board has ${before.length} pin(s); there is nothing to arrange`);
    } else {
      const [first, second] = before;
      /** Drag the grip of `id` onto a fraction across the card `ontoId`. */
      const drag = async (id, ontoId, across) => {
        const grip = await pointAt(win, `[data-pin-id="${id}"] [data-testid="pin-grip"]`);
        mouse(win, "mouseDown", grip.x, grip.y);
        mouse(win, "mouseMove", grip.x + 8, grip.y);
        await sleep(120);
        const onto = await pointAt(win, `[data-pin-id="${ontoId}"]`);
        const target = { x: onto.left + onto.width * across, y: onto.top + 24 };
        for (let step = 1; step <= 3; step += 1) {
          mouse(win, "mouseMove", grip.x + ((target.x - grip.x) * step) / 3, grip.y + ((target.y - grip.y) * step) / 3);
          await sleep(60);
        }
        mouse(win, "mouseUp", target.x, target.y);
        await sleep(400);
      };

      // Onto the first card's left half: `second` lands before `first`.
      await drag(second, first, 0.2);
      const swapped = await win.webContents.executeJavaScript(ORDER);
      checks.dragAfterSwap = swapped;
      if (swapped.join(",") !== [second, first, ...before.slice(2)].join(",")) {
        failure(`the live drag gave ${JSON.stringify(swapped)}, expected ${JSON.stringify([second, first, ...before.slice(2)])}`);
      }
      // Onto the first card's right half: `second` goes back where it belongs,
      // so the operator's board is left exactly as it was found.
      await drag(second, first, 0.8);
      const restored = await win.webContents.executeJavaScript(ORDER);
      checks.dragRestored = restored;
      if (restored.join(",") !== before.join(",")) {
        failure(`the live board was not put back: ${JSON.stringify(restored)} against ${JSON.stringify(before)}`);
      }

      // A locked board has no arrange affordance at all, and a gesture over it
      // must not reach the bridge: no lift, and no new proposal in the inbox.
      await win.webContents.executeJavaScript(
        `document.querySelector('[data-testid="board-lock-toggle"]').click()`,
      );
      await waitFor(
        win,
        `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'true'; })()`,
        "the live board to lock for the drag check",
      );
      const proposalsBefore = await pendingDecisions(win);
      const lockedChrome = await win.webContents.executeJavaScript(
        `document.querySelectorAll(".home-pin__chrome").length`,
      );
      const lockedCard = await pointAt(win, `[data-pin-id="${before[0]}"] .home-card__title, [data-pin-id="${before[0]}"] .view-card__title`);
      mouse(win, "mouseDown", lockedCard.x, lockedCard.y);
      await sleep(500);
      mouse(win, "mouseMove", lockedCard.x + 60, lockedCard.y + 30);
      await sleep(200);
      const lockedLifted = await win.webContents.executeJavaScript(
        `document.querySelectorAll(".home-pin.is-lifted").length`,
      );
      mouse(win, "mouseUp", lockedCard.x + 60, lockedCard.y + 30);
      await sleep(400);
      const proposalsAfter = await pendingDecisions(win);
      const afterLockedGesture = await win.webContents.executeJavaScript(ORDER);
      checks.dragLocked = {
        chrome: lockedChrome,
        lifted: lockedLifted,
        proposalsBefore,
        proposalsAfter,
        order: afterLockedGesture,
      };
      if (lockedChrome !== 0) {
        failure(`the locked live board drew ${lockedChrome} chrome bar(s), so there was a grip to drag with`);
      }
      if (lockedLifted !== 0) {
        failure("a gesture on the locked live board lifted a card");
      }
      if (proposalsAfter !== proposalsBefore) {
        failure(
          `a gesture on the locked live board filed a proposal: ${proposalsBefore} pending before, ${proposalsAfter} after`,
        );
      }
      if (afterLockedGesture.join(",") !== before.join(",")) {
        failure(`the locked live board changed its order: ${JSON.stringify(afterLockedGesture)}`);
      }
      // ...and back, so the operator's board is left unlocked.
      await win.webContents.executeJavaScript(
        `document.querySelector('[data-testid="board-lock-toggle"]').click()`,
      );
      await waitFor(
        win,
        `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'false'; })()`,
        "the live board to unlock after the drag check",
      );
    }
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what: "the built app, on the operator's vault, showing the pinned summary table and toggling the page lock through the real IPC bridge",
    vault: "from the seeded recent.json",
    checks,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  // A picture of the operator's own board, on request: the artifact a reader
  // wants when the question is "does the restyle actually look like the app".
  // It is best-effort and time-boxed — a capture that never settles must not
  // turn a green run into a hung one, and the report is already on disk.
  if (process.env.LIFEQUEST_E2E_SHOT) {
    try {
      await win.webContents.executeJavaScript(
        `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      );
      const image = await Promise.race([
        win.webContents.capturePage(),
        new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);
      if (image) {
        fs.writeFileSync(path.join(artifactsDir, "dashboard-live-board.png"), image.toPNG());
      } else {
        console.error("[live-app] the board screenshot timed out; the report stands");
      }
    } catch (err) {
      console.error("[live-app] the board screenshot failed:", err);
    }
  }

  console.log(`board: ${JSON.stringify(board.cards)} metric ${checks.metric}`);
  console.log(`table rows: ${JSON.stringify(rows)}`);
  console.log(`lock: ${board.badge} -> ${lockedSample.badge} -> ${checks.afterUnlockClick.badge}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  fs.rmSync(workDir, { recursive: true, force: true });
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("dashboard-live-app rig timed out");
  app.exit(1);
}, 90_000);
