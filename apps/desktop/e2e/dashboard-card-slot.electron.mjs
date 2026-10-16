/**
 * Drives the REAL app against a throwaway vault and turns what the dashboard
 * actually does when the companion edits a card into
 * `e2e/artifacts/dashboard-card-slot.json`.
 *
 * Run through its launcher (`node e2e/dashboard-card-slot.mjs`), which builds the
 * vault, the board, and the fake Hermes CLI this rig needs.
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact.
 *
 * THE CLAIM, AND HOW IT IS FALSIFIED
 *
 * The operator's report, in their own words:
 *
 *   "I edited a card on the dashboard. After the change, the card moved to the
 *    bottom of the dashboard — though it told me it had stayed in place. I want
 *    the card to not leave the dashboard and the elements to change within it."
 *
 * That is two claims and they need two different instruments, because either can
 * hold while the other fails:
 *
 *  1. `place` — where the card IS. Read three ways, because "the card moved" can
 *     mean any of them: the pin's index in the board FILE (what the vault says),
 *     the card's index among the `.home-pin` elements in the DOM (what the
 *     operator sees), and its distance from the card under their eye (where it is
 *     relative to the thing they were reading). A board that reorders itself in
 *     React and not on disk would pass the first and fail the second; the reverse
 *     is a card that has moved every time the page is opened.
 *  2. `within` — that the card, in that place, is the SAME card drawing DIFFERENT
 *     content. The DOM node is stamped before the turn and must survive it: a
 *     card that was thrown away and rebuilt at the same index is not "edited in
 *     place", it is a flash, and it is exactly what a wrong fix looks like.
 *
 * THE WRITE IS THE COMPANION'S OWN
 *
 * The rig POSTs `tools/call` to the MCP door the app itself bound, with the
 * companion token the app itself minted, over loopback — the same HTTP request
 * Hermes makes, naming `save_view` with a `viewId`, which is the call the
 * companion is instructed to make to change a card that already exists. It reads
 * the card with `get_view` first and sends the whole spec back, which is the
 * documented flow. Nothing here calls `setPins` or `saveView` directly for the
 * turn: a rig that wrote the pin list itself would be asserting its own idea of
 * where the card goes, which is the one thing under test.
 *
 * AND THE CONTROL THAT MAKES "IT STAYED PUT" MEAN SOMETHING
 *
 * A board that never changes cannot fail claim 1, so the last legs are the ones
 * that could have passed for the wrong reason. A SECOND card is created with the
 * same call and no `viewId`, and it must land at the END of the board — that is
 * what a new card does, and it is what makes "index unchanged" an observation
 * rather than a tautology. Then the board is LOCKED and the same edit is filed as
 * a Decision and approved, because the locked path is a second implementation of
 * the same placement rule and the one a fix to the first would leave behind.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig runs hidden beside every other rig, so it
// has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "dashboard-card-slot.json");
/** The picture: the edited card, changed, in the place it was already in. */
const SHOT = path.join(artifactsDir, "dashboard-card-slot.png");
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/dashboard-card-slot.html";

const plan = JSON.parse(fs.readFileSync(process.env.DASHBOARD_CARD_SLOT_PLAN, "utf8"));

/**
 * Shorter than the board on purpose — that is the instrument. 1280 wide keeps the
 * grid at three tracks, so the edited card (span 2) is the full row and its height
 * is the board's own.
 */
const WINDOW = { width: 1280, height: 720 };

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(win, expression, label, timeoutMs = 20_000) {
  const deadline = performance.now() + timeoutMs;
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
      if (performance.now() > deadline) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 50);
    };
    void poll();
  });
}

/**
 * The board as the operator sees it, read off the live DOM in one pass.
 *
 * `index` is read from the DOM order rather than inferred, and `probe` is the
 * stamp put on the node before the turn: the two together separate "the card is
 * in the same place" from "the same card is in the same place", and only the
 * second is what the operator asked for.
 *
 * The anchor point is deliberately a few pixels INTO the scrollport rather than at
 * its very top: a card whose top edge is exactly at 0 sits on the boundary, and a
 * one-pixel reflow flips which card is "at the top" without the operator having
 * lost anything.
 */
const MEASURE = `(() => {
  const port = (() => {
    const grid = document.querySelector(".home-dashboard__grid");
    let node = grid ? grid.parentElement : null;
    while (node) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return node;
      node = node.parentElement;
    }
    return document.scrollingElement;
  })();
  const portRect = port.getBoundingClientRect();
  const anchorY = portRect.top + 12;
  const cards = [...document.querySelectorAll(".home-dashboard__grid > .home-pin")];
  let anchor = null;
  const boxes = [];
  cards.forEach((card, index) => {
    const rect = card.getBoundingClientRect();
    const title = card.querySelector(".view-card__title, .home-card__title");
    boxes.push({
      index,
      id: card.dataset.pinId ?? null,
      probe: card.dataset.probe ?? null,
      top: Math.round(rect.top - portRect.top),
      height: Math.round(rect.height),
      span2: card.classList.contains("home-pin--span2"),
      rows: card.querySelectorAll(".view-card__table tbody tr").length,
      title: title ? (title.textContent || "").trim() : null,
    });
    if (!anchor && rect.top <= anchorY && rect.bottom > anchorY) {
      anchor = {
        id: card.dataset.pinId ?? null,
        // The anchor's own top, not only how far into it the fold falls. The
        // relative-distance check below is measured FROM the anchor, so an anchor
        // without a coordinate makes every gap NaN — and NaN > SLACK is false,
        // which is a check that silently never fires.
        top: Math.round(rect.top - portRect.top),
        offsetInCard: Math.round(anchorY - rect.top),
        height: Math.round(rect.height),
      };
    }
  });
  const edit = document.querySelector('[data-pin-id="' + ${JSON.stringify(plan.editPinId)} + '"]');
  return {
    scrollTop: Math.round(port.scrollTop),
    maxScrollTop: Math.round(port.scrollHeight - port.clientHeight),
    scrollHeight: port.scrollHeight,
    clientHeight: port.clientHeight,
    // Only the cards that ARE pins. HomePage draws one more .home-pin that has
    // no data-pin-id — the always-present agents card, which is app furniture
    // rather than something the operator put on the board — and counting it as a
    // pin would make the board one card longer than the vault says it is.
    order: boxes.filter((box) => box.id).map((box) => box.id),
    boxes,
    anchor,
    edit: edit
      ? {
          index: cards.indexOf(edit),
          top: Math.round(edit.getBoundingClientRect().top - portRect.top),
          height: Math.round(edit.getBoundingClientRect().height),
          probe: edit.dataset.probe ?? null,
          span2: edit.classList.contains("home-pin--span2"),
          // The card's panels, by the shape each is drawn in and the heading it
          // carries. "The elements changed within" is this reading and no other.
          blocks: [...edit.querySelectorAll(".view-card__block")].map((block) => {
            const shape = [...block.classList].find((name) =>
              name.startsWith("view-card__block--"),
            );
            const heading = block.querySelector(".view-card__block-title");
            return {
              shape: shape ? shape.replace("view-card__block--", "") : "unknown",
              title: heading ? (heading.textContent || "").trim() : null,
            };
          }),
          loading:
            (edit.querySelector(".view-card")?.textContent || "").trim() === "Loading…",
        }
      : null,
    loads: window.dashboardCardSlotLoads ?? 0,
  };
})()`;

/** How far anything is allowed to drift between two measurements, in pixels. */
const SLACK = 2;

/**
 * The claim, asserted between two measurements of the same board.
 *
 * The scroll offset is NOT the claim on its own. A card that grows by 64px above
 * the operator's fold has to move `scrollTop` by 64px to keep them still, and a
 * page that froze the offset would have failed them. The claim is:
 *
 *  1. The card under the operator's eye is the same card, in the same place.
 *  2. Every other card keeps its distance from that anchor — which is what the
 *     operator sees as "the board did not move under me".
 *  3. The edited card is at the same INDEX among the cards, and is the same DOM
 *     node, and is now drawing something different.
 */
function compare(before, after, label) {
  const detail = { label, failures: [] };
  if (before.order.length === 0) {
    detail.failures.push(`the board drew no cards before the ${label} leg`);
    return detail;
  }
  if (!before.anchor || !after.anchor) {
    detail.failures.push(`nothing was under the board's top edge across the ${label} leg`);
    return detail;
  }
  if (before.anchor.id !== after.anchor.id) {
    detail.failures.push(
      `a different card is under the operator's eye: ${before.anchor.id} → ${after.anchor.id}`,
    );
  }
  const slide = Math.abs(after.anchor.offsetInCard - before.anchor.offsetInCard);
  detail.anchorSlide = slide;
  if (slide > SLACK) {
    detail.failures.push(
      `${before.anchor.id} slid ${slide}px under the operator's eye ` +
        `(offset ${before.anchor.offsetInCard} → ${after.anchor.offsetInCard})`,
    );
  }

  const beforeById = new Map(before.boxes.map((box) => [box.id, box]));
  const afterById = new Map(after.boxes.map((box) => [box.id, box]));
  for (const box of before.boxes) {
    if (!box.id) continue;
    const now = afterById.get(box.id);
    if (!now) {
      detail.failures.push(`${box.id} left the board across the ${label} leg`);
      continue;
    }
    const wasGap = box.top - before.anchor.top;
    const isGap = now.top - after.anchor.top;
    if (Math.abs(isGap - wasGap) > SLACK) {
      detail.failures.push(
        `${box.id} changed its place on the board: ${wasGap}px below the anchor before, ${isGap}px after`,
      );
    }
  }

  // The place, said twice: the index among the cards, and the card that is last.
  detail.editIndexBefore = before.edit?.index ?? null;
  detail.editIndexAfter = after.edit?.index ?? null;
  if (before.edit && after.edit && before.edit.index !== after.edit.index) {
    detail.failures.push(
      `the edited card changed index on the board: ${before.edit.index} → ${after.edit.index} ` +
        `(of ${after.order.length})`,
    );
  }
  detail.lastBefore = before.order[before.order.length - 1] ?? null;
  detail.lastAfter = after.order[after.order.length - 1] ?? null;

  // And the card itself: the same node, drawing something else.
  if (before.edit && after.edit) {
    if (before.edit.probe && after.edit.probe && before.edit.probe !== after.edit.probe) {
      detail.failures.push("the edited card was replaced by a new DOM node, not edited in place");
    }
    detail.blocksBefore = before.edit.blocks;
    detail.blocksAfter = after.edit.blocks;
    if (JSON.stringify(before.edit.blocks) === JSON.stringify(after.edit.blocks)) {
      detail.failures.push(
        `the card drew the same panels before and after the ${label} leg, so nothing changed within it`,
      );
    }
    detail.span2Before = before.edit.span2;
    detail.span2After = after.edit.span2;
    if (before.edit.span2 !== after.edit.span2) {
      detail.failures.push(
        `the edited card changed width: span2 ${before.edit.span2} → ${after.edit.span2}`,
      );
    }
    detail.loadingAfter = after.edit.loading;
    if (after.edit.loading) {
      detail.failures.push("the edited card fell back to its Loading… state: it was rebuilt");
    }
  }
  return detail;
}

/** One JSON-RPC call to the app's own MCP door, exactly as Hermes makes it. */
async function mcpCall(port, bearer, name, args) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const raw = await res.text();
  const frame = raw.split("\n").find((line) => line.startsWith("data: "));
  let json;
  try {
    json = JSON.parse(frame ? frame.slice(6) : raw);
  } catch {
    json = undefined;
  }
  const text = json?.result?.content?.[0]?.text;
  let value;
  try {
    value = text === undefined ? undefined : JSON.parse(text);
  } catch {
    value = text;
  }
  return { status: res.status, value, raw };
}

/** The companion token the app minted for this vault, read from its own file. */
function companionToken(profileDir, vaultDir) {
  const secretsPath = path.join(profileDir, "pairing-secrets", "connected-agent-secrets.json");
  const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  const vaultId = JSON.parse(fs.readFileSync(path.join(vaultDir, "lifequest.json"), "utf8")).id;
  const token = secrets?.vaults?.[vaultId]?.companionToken;
  if (typeof token !== "string" || !token) {
    throw new Error(`no companion token for vault ${vaultId} in ${secretsPath}`);
  }
  return token;
}

/** The local door's port, as the launcher told the app through LIFEQUEST_E2E. */
function mcpPortFromEnv() {
  const parsed = JSON.parse(process.env.LIFEQUEST_E2E ?? "{}");
  const port = parsed?.mcpPorts?.local;
  if (typeof port !== "number") throw new Error("LIFEQUEST_E2E carries no mcpPorts.local");
  return port;
}

/**
 * One screenshot of the board, from a window that has actually painted.
 *
 * A hidden window is not painted, and `capturePage` on one hands back whatever
 * frame the compositor last held — which is how a screenshot meant to show the
 * fix came back showing the board from before it. `showInactive` makes the window
 * paint without stealing the operator's focus.
 */
async function shot(win) {
  try {
    if (!win.isVisible()) win.showInactive();
    await sleep(250);
    return (await win.webContents.capturePage()).toPNG();
  } catch {
    return null;
  }
}

/**
 * The board as the VAULT has it: the pins file, read straight off disk.
 *
 * Read from the FILE rather than through `listPinBoard` because this rig runs in
 * Electron's main process and the vault's API is TypeScript, which would make the
 * rig depend on Electron's bundled Node stripping types. The board is a JSON file
 * with a documented shape, and reading it is the whole of what is needed — and it
 * is the better instrument besides: this is what a page opened a moment later
 * would be handed, rather than what a library in this process remembers writing.
 */
function boardFromVault(pinsPath) {
  const board = JSON.parse(fs.readFileSync(pinsPath, "utf8"));
  const pins = Array.isArray(board.pins) ? board.pins : [];
  return {
    ids: pins.map((pin) => pin.id),
    spans: pins.map((pin) => `${pin.id}:${pin.span ?? "system"}`),
    locked: board.locked === true,
  };
}

/** Stamp every card with a value that survives a re-render but not a rebuild. */
const STAMP_PROBES = `(() => {
  for (const card of document.querySelectorAll(".home-dashboard__grid > .home-pin")) {
    if (!card.dataset.pinId) continue;
    card.dataset.probe = String(Math.random()).slice(2);
  }
  return true;
})()`;

/**
 * The companion's edit, read and written the way it is documented: `get_view`
 * for the whole card, change the field meant to change, send it all back with the
 * same `viewId`.
 *
 * The change is the operator's own: "change the order of the items". Reversing the
 * two blocks moves the table above the metric, so the card's own box changes
 * height — which is what makes "did it stay in its place" a question the board has
 * to answer rather than one the array does.
 *
 * `span` is deliberately NOT sent, which is the second half of the fault: an edit
 * that says nothing about width must leave the card as wide as it was. The fixture
 * pins it span 2, so a write path that defaulted a missing span to one cell would
 * quietly halve a full-row card — the card leaving its place by another route.
 */
function editedSpecFrom(read) {
  const spec = { ...read };
  spec.blocks = [...(read.blocks ?? [])].reverse();
  return spec;
}

async function main() {
  nativeTheme.themeSource = "dark";
  const consoleErrors = [];

  // The REAL main process: same handlers, same windows, same doors the product
  // boots with. The profile was isolated by the launcher through LIFEQUEST_E2E,
  // before this import, which is why the import is dynamic.
  const { bootForE2e } = await import("../dist-electron/main.js");
  const product = await bootForE2e();

  // A second window loads the harness page with the PRODUCT's own preload, so
  // `window.lifequest` here is the real bridge to the same main process.
  const win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      preload: path.join(desktopRoot, "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      partition: `card-slot-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(WINDOW.width, WINDOW.height);
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const checks = {};
  const editIndex = plan.editIndex;

  try {
    await win.loadURL(`${url}?v=${Date.now()}`);
    await waitFor(win, "Boolean(window.dashboardCardSlotReady)", "the harness page to mount");

    // ── the vault, opened through the app's own recent-vault path ───────────
    const opened = await win.webContents.executeJavaScript(
      `window.dashboardCardSlotOpenVault(${JSON.stringify(plan.vault)})`,
    );
    if (!opened) failure(`the page could not open the vault at ${plan.vault}`);
    checks.vaultOpen = Boolean(opened);
    checks.skin = await win.webContents.executeJavaScript(
      `document.documentElement.dataset.skin ?? null`,
    );

    // ── the board, drawn by the real HomePage over the real bridge ─────────
    await waitFor(
      win,
      `document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]").length === ${plan.expectedOrder.length}`,
      "the board to draw its pins",
    );
    await waitFor(
      win,
      `document.querySelectorAll('[data-pin-id="${plan.editPinId}"] .view-card__block').length === 2`,
      "the edited card to draw its two panels",
    );
    // The system cards answer over their own channels; a page that has not settled
    // would make the first measurement a moving target.
    await sleep(400);

    const token = companionToken(plan.profile, plan.vault);
    const port = mcpPortFromEnv();

    // The door binds as part of the open. Poll it the way a client would rather
    // than sleeping at a guessed number: the first answered call IS the proof that
    // the door is up.
    let doorReady = null;
    for (let attempt = 0; attempt < 60 && doorReady === null; attempt += 1) {
      try {
        const reply = await mcpCall(port, token, "get_dashboard", { domainSlug: plan.boardSlug });
        if (reply.status === 200 && reply.value && !reply.value.error) doorReady = reply.value;
      } catch {
        // The listener is not up yet.
      }
      if (doorReady === null) await sleep(250);
    }
    if (doorReady === null) failure(`the MCP door on port ${port} never answered`);
    checks.doorReady = doorReady !== null;
    checks.boardThroughTheDoor = doorReady?.pins?.map((pin) => pin.id) ?? null;

    // The board on disk agrees with the board the fixture asked for, before
    // anything happens: without this the rig could "prove" a card held a place it
    // was never in.
    const vaultBefore = boardFromVault(plan.pinsPath);
    checks.pinsBefore = vaultBefore.ids;
    if (JSON.stringify(vaultBefore.ids) !== JSON.stringify(plan.expectedOrder)) {
      failure(
        `the board file is not the fixture's board: ${JSON.stringify(vaultBefore.ids)} vs ` +
          `${JSON.stringify(plan.expectedOrder)}`,
      );
    }

    // ── the operator's place: the edited card under the top of the glass ────
    //
    // The scrollport is RESOLVED by walking up from the grid, not taken as its
    // parent: `HomePage` draws `.home-dashboard` between the grid and the thing
    // that actually scrolls (`AppShell`'s `.shell__content`), and that wrapper is
    // `overflow: visible`. Setting `scrollTop` on it moves nothing at all, and a
    // rig that parked the board there would then measure a board it never moved.
    await win.webContents.executeJavaScript(`(() => {
      const grid = document.querySelector(".home-dashboard__grid");
      let port = grid ? grid.parentElement : null;
      while (port) {
        const overflowY = getComputedStyle(port).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") break;
        port = port.parentElement;
      }
      port = port ?? document.scrollingElement;
      const card = document.querySelector('[data-pin-id="${plan.editPinId}"]');
      port.scrollTop += card.getBoundingClientRect().top - port.getBoundingClientRect().top;
      // A programmatic assignment does not deliver a scroll event to a listener on
      // the same element, and the app's own hold lives on that event.
      port.dispatchEvent(new Event("scroll"));
      return Math.round(port.scrollTop);
    })()`);
    await win.webContents.executeJavaScript(STAMP_PROBES);
    await sleep(150);

    const before = await win.webContents.executeJavaScript(MEASURE);
    checks.before = before;
    if (before.order.length !== plan.expectedOrder.length) {
      failure(
        `the board drew ${before.order.length} cards, expected ${plan.expectedOrder.length}`,
      );
    }
    if (before.anchor?.id !== plan.editPinId) {
      failure(
        `the parked board put ${JSON.stringify(before.anchor?.id)} at the top, not the card being edited`,
      );
    }
    if (before.maxScrollTop <= 0) {
      failure("the board does not scroll: this rig cannot tell one place on it from another");
    }
    // The instrument, asserted rather than assumed: the edited card must NOT be at
    // the end of the board, or "it kept its index" would be true of a card that had
    // nowhere to go.
    if (editIndex >= plan.expectedOrder.length - 1) {
      failure(`the fixture put the edited card last, so "it did not move" proves nothing`);
    }
    if ((before.edit?.blocks ?? []).length !== 2) {
      failure(`the edited card drew ${before.edit?.blocks?.length} panels, expected 2`);
    }
    if (before.edit?.span2 !== true) {
      failure("the fixture's edited card is not the full row, so the width claim is not exercised");
    }

    // ── the turn: the companion's own call, through the app's own door ─────
    const read = await mcpCall(port, token, "get_view", {
      domainSlug: plan.domainSlug,
      viewId: plan.editViewId,
    });
    if (read.value?.error) {
      failure(`get_view failed: ${JSON.stringify(read.value.error)}`);
    }
    checks.getViewTitle = read.value?.title ?? null;
    checks.getViewBlocks = (read.value?.spec?.blocks ?? []).map((block) => block.id);

    const edited = await mcpCall(port, token, "save_view", {
      domainSlug: plan.domainSlug,
      boardSlug: plan.boardSlug,
      viewId: plan.editViewId,
      spec: editedSpecFrom(read.value?.spec ?? {}),
    });
    checks.saveViewReply = edited.value;
    if (edited.value?.error) {
      failure(`save_view failed: ${JSON.stringify(edited.value.error)}`);
    }
    if (edited.value?.applied !== true) {
      failure(`save_view did not apply: ${JSON.stringify(edited.value)}`);
    }
    if (edited.value?.updated !== true) {
      failure("the edit did not report itself as an update of an existing card");
    }
    if (edited.value?.viewId !== plan.editViewId) {
      failure("the edit minted a new view id instead of changing the card");
    }
    // What the companion TELLS the operator, checked against what happened. The
    // report was that the reply claimed the card had stayed in place when it had
    // not, so the claim is only worth anything alongside the measurement above.
    checks.replySaidItKeptItsPlace = edited.value?.cardKeptItsPlace ?? null;
    checks.replyPosition = edited.value?.cardPosition ?? null;
    if (edited.value?.cardKeptItsPlace !== true) {
      failure(
        `save_view did not report the card as keeping its place: ` +
          `cardKeptItsPlace=${JSON.stringify(edited.value?.cardKeptItsPlace)}`,
      );
    }
    if (edited.value?.cardPosition !== editIndex + 1) {
      failure(
        `save_view reported the card at position ${JSON.stringify(edited.value?.cardPosition)}, ` +
          `expected ${editIndex + 1}`,
      );
    }

    const wanted = JSON.stringify(["metric", "table"]);
    try {
      await waitFor(
        win,
        `JSON.stringify([...document.querySelectorAll('[data-pin-id="${plan.editPinId}"] .view-card__block')].map((b) => { const s = [...b.classList].find((n) => n.startsWith("view-card__block--")); return s ? s.replace("view-card__block--", "") : "unknown"; })) === ${JSON.stringify(wanted)}`,
        "the card to redraw with its panels reordered",
      );
    } catch (error) {
      failure(
        `${error instanceof Error ? error.message : String(error)}: the card drew ` +
          `${JSON.stringify((await win.webContents.executeJavaScript(MEASURE)).edit?.blocks)}`,
      );
    }
    await sleep(400);

    const after = await win.webContents.executeJavaScript(MEASURE);
    checks.after = after;
    checks.editLeg = compare(before, after, "edit");

    const vaultAfter = boardFromVault(plan.pinsPath);
    checks.pinsAfter = vaultAfter.ids;
    checks.pinsBeforeLast = vaultBefore.ids[vaultBefore.ids.length - 1] ?? null;
    checks.pinsAfterLast = vaultAfter.ids[vaultAfter.ids.length - 1] ?? null;
    if (JSON.stringify(vaultAfter.ids) !== JSON.stringify(vaultBefore.ids)) {
      failure(
        `the board FILE reordered itself across the edit: ` +
          `${JSON.stringify(vaultBefore.ids)} → ${JSON.stringify(vaultAfter.ids)}`,
      );
    }
    if (JSON.stringify(after.order) !== JSON.stringify(before.order)) {
      failure(
        `the board on SCREEN reordered itself across the edit: ` +
          `${JSON.stringify(before.order)} → ${JSON.stringify(after.order)}`,
      );
    }
    if (after.edit?.index !== editIndex) {
      failure(
        `the edited card is at index ${after.edit?.index}, was ${editIndex} of ${after.order.length}`,
      );
    }
    // The card's width survived an edit that said nothing about width. Without
    // this the fix for the position would still let an edit halve a full-row card.
    const spanAfter = (boardFromVault(plan.pinsPath)).spans.find(
      (entry) => entry.startsWith(`${plan.editPinId}:`),
    );
    checks.editSpanAfter = spanAfter ?? null;
    if (spanAfter !== `${plan.editPinId}:2`) {
      failure(`the edited card's width on disk is ${spanAfter}, expected ${plan.editPinId}:2`);
    }
    if (after.loads !== 1) {
      failure(`the harness page was loaded ${after.loads} times: the board was replaced, not edited`);
    }

    const image = await shot(win);
    if (image) {
      fs.mkdirSync(artifactsDir, { recursive: true });
      fs.writeFileSync(SHOT, image);
    }

    // ── the control: a card that is NOT on the board still lands at the end ──
    //
    // This is what makes the leg above mean something. If creating a card also
    // left the board where it was, "the board did not move" would be a property of
    // the rig rather than of the fix. A new card appends — that is what a new card
    // does — and the board is expected to move for it.
    const created = await mcpCall(port, token, "save_view", {
      domainSlug: plan.domainSlug,
      boardSlug: plan.boardSlug,
      spec: {
        databaseId: plan.newCardDatabaseId,
        title: "A brand new card",
        presentation: "metric",
        groupBy: null,
        timeBucket: null,
        timeColumnId: plan.newCardDateColumnId,
        timeWindow: "all",
        filters: [],
        limit: 12,
        measure: "count",
      },
    });
    checks.newCardReply = created.value;
    if (created.value?.applied !== true) {
      failure(`the new card was not created: ${JSON.stringify(created.value)}`);
    }
    try {
      await waitFor(
        win,
        `document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]").length === ${plan.expectedOrder.length + 1}`,
        "the board to draw the new card",
      );
    } catch (error) {
      failure(error instanceof Error ? error.message : String(error));
    }
    await sleep(300);
    const withNew = await win.webContents.executeJavaScript(MEASURE);
    checks.afterNewCard = {
      order: withNew.order,
      last: withNew.order[withNew.order.length - 1] ?? null,
      editIndex: withNew.edit?.index ?? null,
      newCardKeptItsPlace: created.value?.cardKeptItsPlace ?? null,
      newCardPosition: created.value?.cardPosition ?? null,
      newCardViewId: created.value?.viewId ?? null,
      newCardPinId: `view:${plan.domainSlug}:${created.value?.viewId}`,
    };
    if (withNew.order[withNew.order.length - 1] === plan.editPinId) {
      failure("the edited card is at the bottom of the board");
    }
    if (withNew.order[withNew.order.length - 1] !== `view:${plan.domainSlug}:${created.value?.viewId}`) {
      failure(
        `a brand new card did not land at the end of the board: ` +
          `${JSON.stringify(withNew.order)}`,
      );
    }
    if (created.value?.cardKeptItsPlace === true) {
      failure("a brand new card reported that it had kept a place it never had");
    }
    if (withNew.edit?.index !== editIndex) {
      failure(
        `the edited card moved when an unrelated card was added: ${editIndex} → ${withNew.edit?.index}`,
      );
    }

    // ── and the same rule through the other door: a locked board's Decision ──
    //
    // `save_view` on a locked board writes nothing and files one Decision; the
    // pin is placed when the operator approves it. That is a SECOND implementation
    // of the same placement rule, in `decisions.ts`, and the one a fix to the
    // tool alone would have left sending the card to the bottom on approval.
    const locked = await win.webContents.executeJavaScript(
      `window.lifequest.pinsSetLocked(${JSON.stringify(plan.boardSlug)}, true)`,
    );
    checks.lockReply = locked;
    if (locked?.ok !== true) failure(`the board would not lock: ${JSON.stringify(locked)}`);
    await win.webContents.executeJavaScript(`window.dashboardCardSlotRefresh()`);
    await waitFor(
      win,
      `document.querySelector('[data-testid="board-lock-badge"]')?.dataset.locked === "true"`,
      "the board to show itself locked",
    );

    const beforeLocked = await win.webContents.executeJavaScript(MEASURE);
    checks.beforeLocked = { order: beforeLocked.order, editIndex: beforeLocked.edit?.index ?? null };
    const readLocked = await mcpCall(port, token, "get_view", {
      domainSlug: plan.domainSlug,
      viewId: plan.editViewId,
    });
    const reLocked = await mcpCall(port, token, "save_view", {
      domainSlug: plan.domainSlug,
      boardSlug: plan.boardSlug,
      viewId: plan.editViewId,
      spec: editedSpecFrom(readLocked.value?.spec ?? {}),
    });
    checks.lockedEditReply = reLocked.value;
    if (reLocked.value?.proposed !== true) {
      failure(
        `save_view on a locked board did not file a Decision: ${JSON.stringify(reLocked.value)}`,
      );
    }
    const decisionId = reLocked.value?.decisionId;
    const resolved = await win.webContents.executeJavaScript(
      `window.lifequest.decisionResolve(${JSON.stringify(decisionId)}, "approved")`,
    );
    checks.decisionResolveReply = resolved;
    if (resolved?.ok !== true) {
      failure(`the Decision would not approve: ${JSON.stringify(resolved)}`);
    }
    await sleep(400);
    const afterLocked = boardFromVault(plan.pinsPath);
    checks.pinsAfterApproval = afterLocked.ids;
    const approvedEditIndex = afterLocked.ids.indexOf(plan.editPinId);
    checks.approvedEditIndex = approvedEditIndex;
    checks.approvedLast = afterLocked.ids[afterLocked.ids.length - 1] ?? null;
    if (approvedEditIndex !== editIndex) {
      failure(
        `an approved edit moved the card: index ${editIndex} → ${approvedEditIndex} of ` +
          `${afterLocked.ids.length}`,
      );
    }
    if (afterLocked.ids[afterLocked.ids.length - 1] === plan.editPinId) {
      failure("the card reached the bottom of the board by way of the Decision path");
    }
    await win.webContents.executeJavaScript(
      `window.lifequest.pinsSetLocked(${JSON.stringify(plan.boardSlug)}, false)`,
    );

    // ── the operator's own width, through the companion's door ─────────────
    //
    // A card the operator dragged an edge to carries a `width` in rem. The
    // companion never sets one — it has no argument for it — but it REORDERS the
    // board and EDITS cards, and both calls rewrite the pin list. So the rule has
    // to be measured the way the companion would trip over it: a width must
    // survive a reorder and an edit that names no span, and it must go when a span
    // is named, because a span IS a width and two answers to one question is how a
    // board ends up disagreeing with itself.
    const dragged = 24.5;
    const boardNow = await mcpCall(port, token, "get_dashboard", { domainSlug: plan.boardSlug });
    const draggedPins = (boardNow.value?.pins ?? []).map((pin) =>
      pin.id === plan.editPinId ? { ...pin, width: dragged } : pin,
    );
    await mcpCall(port, token, "arrange_dashboard", {
      domainSlug: plan.boardSlug,
      pins: draggedPins,
    });
    const afterArrange = await mcpCall(port, token, "get_dashboard", {
      domainSlug: plan.boardSlug,
    });
    checks.widthAfterArrange =
      (afterArrange.value?.pins ?? []).find((pin) => pin.id === plan.editPinId)?.width ?? null;

    // The same call again, with the pins exactly as the board returned them: a
    // reorder that dropped a field it was handed would take the width with it.
    await mcpCall(port, token, "arrange_dashboard", {
      domainSlug: plan.boardSlug,
      pins: afterArrange.value?.pins ?? [],
    });
    const afterSecondArrange = await mcpCall(port, token, "get_dashboard", {
      domainSlug: plan.boardSlug,
    });
    checks.widthAfterSecondArrange =
      (afterSecondArrange.value?.pins ?? []).find((pin) => pin.id === plan.editPinId)?.width ?? null;
    if (checks.widthAfterArrange !== dragged || checks.widthAfterSecondArrange !== dragged) {
      failure(
        `a reorder lost the operator's width: ${JSON.stringify(checks.widthAfterArrange)} then ` +
          `${JSON.stringify(checks.widthAfterSecondArrange)}, expected ${dragged}`,
      );
    }

    // An edit that names no span leaves it alone.
    const readForWidth = await mcpCall(port, token, "get_view", {
      domainSlug: plan.domainSlug,
      viewId: plan.editViewId,
    });
    await mcpCall(port, token, "save_view", {
      domainSlug: plan.domainSlug,
      boardSlug: plan.boardSlug,
      viewId: plan.editViewId,
      spec: editedSpecFrom(readForWidth.value?.spec ?? {}),
    });
    const afterEdit = await mcpCall(port, token, "get_dashboard", { domainSlug: plan.boardSlug });
    checks.widthAfterEdit =
      (afterEdit.value?.pins ?? []).find((pin) => pin.id === plan.editPinId)?.width ?? null;

    // And naming a span replaces it — the card is the row, so it has no width of
    // its own to come back to.
    const reSized = await mcpCall(port, token, "save_view", {
      domainSlug: plan.domainSlug,
      boardSlug: plan.boardSlug,
      viewId: plan.editViewId,
      span: 2,
      spec: editedSpecFrom(readForWidth.value?.spec ?? {}),
    });
    checks.resizedReply = reSized.value;
    const afterSpan = await mcpCall(port, token, "get_dashboard", { domainSlug: plan.boardSlug });
    const namedSpanPin = (afterSpan.value?.pins ?? []).find((pin) => pin.id === plan.editPinId);
    checks.spanAfterNamedSpan = namedSpanPin?.span ?? null;
    checks.widthAfterNamedSpan = namedSpanPin?.width ?? null;
    if (checks.widthAfterEdit !== dragged) {
      failure(
        `an edit that named no span lost the operator's width: ` +
          `${JSON.stringify(checks.widthAfterEdit)}`,
      );
    }
    if (checks.spanAfterNamedSpan !== 2 || checks.widthAfterNamedSpan !== null) {
      failure(
        `naming a span did not replace the width: span ${JSON.stringify(checks.spanAfterNamedSpan)}, ` +
          `width ${JSON.stringify(checks.widthAfterNamedSpan)}`,
      );
    }

    if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);
  } catch (error) {
    failure(error instanceof Error ? error.stack ?? error.message : String(error));
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what:
      "a dashboard card the companion edits keeps its slot on the board — same pin index in the " +
      "vault, same index on screen, same DOM node, different panels within it — while a brand new " +
      "card still lands at the end",
    command: "node e2e/dashboard-card-slot.mjs  (also reached by npm test via tests/dashboard-card-slot-e2e.test.ts)",
    vault: plan.vault,
    boardSlug: plan.boardSlug,
    editPinId: plan.editPinId,
    editIndex,
    checks,
    consoleErrors,
    screenshots: { afterTheEdit: fs.existsSync(SHOT) ? path.basename(SHOT) : null },
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `[card-slot] board: ${JSON.stringify(checks.before?.order ?? null)} → ${JSON.stringify(checks.after?.order ?? null)}`,
  );
  console.log(
    `[card-slot] edited card index: ${checks.before?.edit?.index} → ${checks.after?.edit?.index} of ${checks.after?.order?.length}`,
  );
  console.log(
    `[card-slot] panels: ${JSON.stringify(checks.before?.edit?.blocks?.map((b) => b.shape))} → ${JSON.stringify(checks.after?.edit?.blocks?.map((b) => b.shape))}`,
  );
  console.log(
    `[card-slot] new card landed last: ${checks.afterNewCard?.last} (kept its place: ${checks.afterNewCard?.newCardKeptItsPlace})`,
  );
  console.log(
    `[card-slot] approved edit index: ${checks.approvedEditIndex} of ${checks.pinsAfterApproval?.length}`,
  );
  console.log(`[card-slot] failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  if (!product.isDestroyed()) product.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("card-slot rig timed out");
  app.exit(1);
}, 170_000);
