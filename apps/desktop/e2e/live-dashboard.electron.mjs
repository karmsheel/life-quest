/**
 * The live-dashboard rig: the REAL app's main process, the REAL preload, the
 * REAL `ViewCard` and `LiveDataProvider`, and a REAL write made through the
 * app's own agent door — and the claim is that a card already on screen repaints
 * itself without anything being clicked, navigated, or reloaded.
 *
 * Run through its launcher (`node e2e/live-dashboard.mjs`), which builds the
 * throwaway vault, profile, and fake Hermes CLI this rig needs.
 *
 * WHAT IS PROVEN, AND HOW EACH CLAIM CAN FAIL
 *
 *  1. The write is the agent's own. The rig POSTs `tools/call` to the MCP door
 *     the app itself bound, with the companion token the app itself minted, over
 *     loopback — the same HTTP request Hermes makes. This is not `upsertRow`
 *     called from a test: it goes through `pairing-door.ts` → `executeTool`,
 *     which is the one path every companion tool takes. A door that never
 *     announced the write leaves the card at its old number, and the wait for the
 *     new one times out: that is the operator's reported bug, reproduced.
 *
 *  2. The card re-runs because it was TOLD to, not because its parent re-rendered.
 *     The rig sends no input, changes no route, and reloads nothing —
 *     `liveDashboardLoads` counts module evaluations and must still read 1. If the
 *     card only looked fresh because the page had been thrown away, this fails.
 *
 *  3. A live window and a frozen date behave differently, which is the point of
 *     the fix. `Today's expenses` is a `today` window over the metrics and table
 *     panels and moves from 0 to the new expense; `Yesterday (frozen date)` spells
 *     its date in a filter and does not move at all, exactly as the operator's
 *     stuck card did.
 *
 *  3b. A PERIOD AVERAGE reads the calendar and not the rows. `Average monthly
 *     spend` is one metric: measure "avg-per", per "month", over
 *     `{"kind":"previous-months","months":4}`. It holds still when an expense is
 *     written, because that expense is in the current month and the window is the
 *     four whole months before it — and then it MOVES when the last leg turns the
 *     month over, with nothing written at all. Both halves are asserted: a window
 *     that leaked this month would move on the write, and a card that was never
 *     asked again would not move on the turn.
 *
 *  4. The card is drawn by the app's own ViewCard in the app's own skin: the rig
 *     refuses an unstyled or empty run, so "it updated" cannot mean "it drew an
 *     error message in the right place".
 *
 * The artifact is `e2e/artifacts/live-dashboard-ui.json`, with a screenshot
 * beside it. Exit code 0 = every claim held.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame. A rig runs hidden beside every other rig, so it
// has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "live-dashboard-ui.json");
/** The moment the agent's expense appeared — the picture of the fix. */
const SHOT = path.join(artifactsDir, "live-dashboard-ui.png");
/** And the same board after the day turned over, with no write at all. */
const SHOT_NEXT_DAY = path.join(artifactsDir, "live-dashboard-ui-next-day.png");

const plan = JSON.parse(fs.readFileSync(process.env.LIVE_DASHBOARD_PLAN, "utf8"));
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/live-dashboard.html";

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for an expression to turn true, with a deadline that the wall clock
 * cannot move.
 *
 * `performance.now()` and not `Date.now()`: the rollover leg REPLACES `Date` in
 * this process, so a deadline measured with it would be a constant, nothing would
 * ever time out, and a failure would arrive as the rig's own watchdog with no
 * diagnostic instead of as the assertion that failed.
 */
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
 * What the three cards are showing, read off the live DOM.
 *
 * Read as TEXT and as rows rather than through any test hook the card might
 * grow: a card that drew the right number into the wrong place, or drew nothing,
 * must not pass.
 */
const SAMPLE = `(() => {
  const cardOf = (key) => document.querySelector('[data-testid="' + key + '"]');
  const text = (el, sel) => {
    const found = el ? el.querySelector(sel) : null;
    return found ? (found.textContent || "").trim() : null;
  };
  const rowsOf = (el) =>
    Array.from(el ? el.querySelectorAll(".view-card__table tbody tr") : []).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()),
    );
  const cards = {};
  for (const key of ["card-list", "card-today", "card-frozen", "card-average"]) {
    const el = cardOf(key);
    cards[key] = {
      title: text(el, ".view-card__title"),
      painted: el ? el.querySelectorAll(".view-card").length : 0,
      metrics: Array.from(el ? el.querySelectorAll(".view-card__metric") : []).map((m) => (m.textContent || "").trim()),
      rows: rowsOf(el),
      empty: Boolean(el && el.querySelector(".view-card__empty")),
      errors: Array.from(el ? el.querySelectorAll(".form-error") : []).map((e) => (e.textContent || "").trim()),
      shell: (() => {
        const card = el ? el.querySelector(".view-card") : null;
        if (!card) return null;
        const cs = getComputedStyle(card);
        // A listing's money column is not its second column: the card marks the
        // columns that hold numbers, and the money is whichever one that is.
        const numeric = card.querySelector(".view-card__table td.view-card__cell--num");
        return {
          background: cs.backgroundColor,
          border: cs.borderTopWidth,
          numericCells: card.querySelectorAll(".view-card__table td.view-card__cell--num").length,
          numericAlign: numeric ? getComputedStyle(numeric).textAlign : null,
        };
      })(),
    };
  }
  return {
    cards,
    loads: window.liveDashboardLoads ?? 0,
    commits: window.liveDashboardCommits ?? 0,
    mutations: window.liveDashboardMutations ?? 0,
  };
})()`;

/** The numbers a metric card shows, as numbers, for an honest comparison. */
function metricNumbers(sample, key) {
  return (sample.cards[key]?.metrics ?? []).map((text) => {
    const match = /-?[\d\s.,]+/.exec(text.replace(/\u00a0/g, " "));
    const value = match ? Number(match[0].replace(/[\s,]/g, "")) : NaN;
    return Number.isFinite(value) ? value : null;
  });
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

/**
 * One screenshot of the cards, from a window that has actually painted.
 *
 * A hidden window is not painted, and `capturePage` on one hands back whatever
 * frame the compositor last held — which is how a screenshot meant to show the
 * fix came back showing the board from before it. `showInactive` makes the window
 * paint without stealing the operator's focus, and it happens only for the two
 * captures at the end of the run.
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
    width: 1280,
    height: 900,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      preload: path.join(desktopRoot, "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      partition: `live-dashboard-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const checks = {};

  try {
    await win.loadURL(`${url}?v=${Date.now()}`);
    await waitFor(win, "Boolean(window.liveDashboardReady)", "the harness page to mount");

    // ── the vault, opened through the app's own channel ─────────────────────
    const opened = await win.webContents.executeJavaScript(
      `window.lifequest.vaultOpen(${JSON.stringify(plan.vault)})`,
    );
    if (!opened?.ok) failure(`vaultOpen failed: ${JSON.stringify(opened)}`);
    checks.vaultOpen = Boolean(opened?.ok);

    const token = companionToken(plan.profile, plan.vault);
    const port = mcpPortFromEnv();

    // The door binds as part of the open. Poll it the way a client would rather
    // than sleeping at a guessed number: the first answered call IS the proof
    // that the door is up.
    let doorReady = null;
    for (let attempt = 0; attempt < 60 && doorReady === null; attempt += 1) {
      try {
        const reply = await mcpCall(port, token, "get_state", {});
        if (reply.status === 200 && reply.value && !reply.value.error) doorReady = reply.value;
      } catch {
        // The listener is not up yet.
      }
      if (doorReady === null) await sleep(250);
    }
    if (doorReady === null) failure(`the MCP door on port ${port} never answered`);
    checks.doorReady = doorReady !== null;

    // ── the four cards, drawn by the real ViewCard over the real bridge ────
    await win.webContents.executeJavaScript(
      `window.liveDashboardRender(${JSON.stringify(
        plan.cards.map((c) => ({
          key: c.key,
          title: c.title,
          domainSlug: plan.domainSlug,
          viewId: c.viewId,
        })),
      )})`,
    );
    await waitFor(
      win,
      `document.querySelector('[data-testid="card-list"] .view-card__table tbody tr') !== null`,
      "the listing card to draw its rows",
    );
    // The metric cards paint their number when the run answers, so wait for all
    // four shells to be painted rather than for the first one.
    await waitFor(
      win,
      `document.querySelectorAll('[data-testid^="card-"] .view-card').length === 4`,
      "all four cards to paint",
    );
    await sleep(200);

    const before = await win.webContents.executeJavaScript(SAMPLE);
    checks.before = before;
    checks.expected = plan.expected;

    // The board is STILL before the write: no card repaints on its own while
    // nothing is happening. Recorded rather than asserted — an unrelated write
    // elsewhere in the app (the FX rate landing, a log line) is legitimate and
    // would make a hard claim here flaky — but the number is in the artifact, and
    // it is what makes the growth below attributable.
    await sleep(500);
    const still = await win.webContents.executeJavaScript(SAMPLE);
    checks.mutationsWhileIdle = still.mutations - before.mutations;
    checks.mutationsBefore = before.mutations;

    // ── the world as it was before the agent was asked for anything ─────────
    const listBefore = before.cards["card-list"].rows.length;
    if (listBefore !== plan.expected.listRowsBefore) {
      failure(`the listing drew ${listBefore} rows before the write, expected ${plan.expected.listRowsBefore}`);
    }
    const todayBefore = metricNumbers(before, "card-today");
    if (todayBefore[0] !== plan.expected.todayBefore) {
      failure(`Today's expenses read ${JSON.stringify(todayBefore)} before the write, expected [${plan.expected.todayBefore}]`);
    }
    const frozenBefore = metricNumbers(before, "card-frozen");
    if (frozenBefore[0] !== plan.expected.frozenBefore) {
      failure(`the frozen card read ${JSON.stringify(frozenBefore)} before the write, expected [${plan.expected.frozenBefore}]`);
    }
    // The average card, before anything is written: the previous four whole
    // months, divided by four. It is the operator's own ask, drawn.
    const averageBefore = metricNumbers(before, "card-average");
    checks.averageBefore = averageBefore;
    if (averageBefore[0] !== plan.expected.averageBefore) {
      failure(
        `the average-month card read ${JSON.stringify(averageBefore)} before the write, ` +
          `expected [${plan.expected.averageBefore}] over ${plan.expected.averageWindows.before.start}` +
          `..${plan.expected.averageWindows.before.end}`,
      );
    }

    // ── the write: the agent's own door, the agent's own tool ───────────────
    const captured = await mcpCall(port, token, "capture_transaction", { text: plan.captureText });
    checks.captureReply = captured.value;
    const posted = captured.value?.posted === true;
    if (!posted) {
      failure(`capture_transaction did not post: ${JSON.stringify(captured.value) ?? captured.raw}`);
    }

    // ── and the cards move, with nothing clicked, navigated, or reloaded ────
    // No sleep-then-hope: the listing is waited on for the ROW COUNT, and the
    // metric for the NUMBER. Both are the operator's own complaint.
    let after = null;
    try {
      await waitFor(
        win,
        `document.querySelectorAll('[data-testid="card-list"] .view-card__table tbody tr').length === ${plan.expected.listRowsAfter} && (document.querySelector('[data-testid="card-today"] .view-card__metric') || {}).textContent?.includes("-25")`,
        "the cards to repaint with the new expense",
        15_000,
      );
      after = await win.webContents.executeJavaScript(SAMPLE);
    } catch (error) {
      after = await win.webContents.executeJavaScript(SAMPLE);
      failure(
        `${error instanceof Error ? error.message : String(error)}: ` +
          `listing ${after.cards["card-list"].rows.length} rows, today ${JSON.stringify(metricNumbers(after, "card-today"))}`,
      );
    }
    checks.after = after;

    if (after) {
      const listAfter = after.cards["card-list"].rows.length;
      checks.listRowsAfter = listAfter;
      if (listAfter !== plan.expected.listRowsAfter) {
        failure(`the listing drew ${listAfter} rows after the write, expected ${plan.expected.listRowsAfter}`);
      }
      // The new row is ON the card, with the amount that was captured — not just
      // "one more row of something".
      const capturedRow = after.cards["card-list"].rows.find((row) =>
        row.some((cell) => cell.replace(/[\s,]/g, "") === "-25"),
      );
      checks.capturedRow = capturedRow ?? null;
      if (!capturedRow) {
        failure(`the captured expense is not on the listing: ${JSON.stringify(after.cards["card-list"].rows)}`);
      }

      const todayAfter = metricNumbers(after, "card-today");
      checks.todayAfter = todayAfter;
      if (todayAfter[0] !== plan.expected.todayAfter) {
        failure(`Today's expenses read ${JSON.stringify(todayAfter)} after the write, expected [${plan.expected.todayAfter}]`);
      }
      // The composed card's table panel is live too, not just its headline: the
      // same write reaches both panels of the same card.
      const todayPanelRows = after.cards["card-today"].rows;
      checks.todayPanelRows = todayPanelRows;
      if (todayPanelRows.length === 0) {
        failure("Today's expenses drew no detail row for the expense it just totalled");
      }

      // And the frozen card held still. This is not a defect being asserted: it
      // is the difference between the two shapes, and it is what makes the claim
      // about the live window a claim rather than a coincidence.
      const frozenAfter = metricNumbers(after, "card-frozen");
      checks.frozenAfter = frozenAfter;
      if (frozenAfter[0] !== plan.expected.frozenAfter) {
        failure(
          `the frozen card read ${JSON.stringify(frozenAfter)} after the write, expected [${plan.expected.frozenAfter}] — ` +
            "a card that reads a literal date must not move when a different day is written",
        );
      }

      // The average card held still too, and for a REASON rather than by being
      // stuck: the expense was written inside the CURRENT month, and this card
      // averages the four whole months before it. A window that leaked the
      // current month would have moved here.
      const averageAfter = metricNumbers(after, "card-average");
      checks.averageAfter = averageAfter;
      if (averageAfter[0] !== plan.expected.averageAfter) {
        failure(
          `the average-month card read ${JSON.stringify(averageAfter)} after the write, expected ` +
            `[${plan.expected.averageAfter}]: the previous-months window must not include the ` +
            `month the expense was written in`,
        );
      }

      if (after.loads !== 1) {
        failure(`the harness page was loaded ${after.loads} times: the cards were not live, the page was replaced`);
      }
      // The picture changed BECAUSE of the write: the cards' DOM was repainted
      // after the door call, with nothing clicked, navigated, or reloaded.
      checks.mutationsAfter = after.mutations;
      if (after.mutations <= checks.mutationsBefore) {
        failure(
          `the cards drew no new DOM after the write (${checks.mutationsBefore} → ${after.mutations} mutations): ` +
            "the repaint did not come from the write",
        );
      }
      if (checks.before.loads !== 1) {
        failure(`the harness page had already been loaded ${checks.before.loads} times before the write`);
      }
    }

    // ── the drawing itself is the app's own ────────────────────────────────
    const painted = after ?? before;
    for (const key of ["card-list", "card-today", "card-frozen", "card-average"]) {
      const card = painted.cards[key];
      if (!card || card.painted !== 1) failure(`${key} did not draw exactly one view card`);
      if (card.errors.length > 0) failure(`${key} drew an error: ${card.errors.join(" | ")}`);
      if (!card.shell?.background || card.shell.background === "rgba(0, 0, 0, 0)") {
        failure(`${key} drew no shell background`);
      }
      if (card.shell?.border === "0px") failure(`${key} drew no shell edge`);
    }
    const listCard = painted.cards["card-list"].shell;
    if (!listCard?.numericCells) {
      failure("the listing marked no column as numeric, so its money column cannot be aligned by type");
    }
    if (listCard?.numericAlign !== "right") {
      failure(`the listing's money column is ${listCard?.numericAlign}-aligned, expected right`);
    }

    // The picture of the fix, taken while the cards show the agent's expense:
    // the screenshot after the rollover leg would show a correct board reading 0,
    // which is the right state and the wrong illustration.
    const image = await shot(win);
    if (image) fs.writeFileSync(SHOT, image);

    // ── leg two: the OPERATOR's own write, from the renderer ────────────────
    //
    // The agent's door is not the only way the vault changes. The operator edits
    // a cell in the app, accepts an ingest batch, toggles a setting — all of that
    // goes over IPC, and every one of those channels has to announce itself the
    // same way. This leg writes a row through `db:upsertRow` from the page's own
    // bridge, which is the channel `DatabasePage` uses.
    const edited = await win.webContents.executeJavaScript(
      `window.lifequest.dbUpsertRow(${JSON.stringify(plan.domainSlug)}, ${JSON.stringify(plan.ids.transactions)}, {
         cells: {
           ${JSON.stringify(plan.ids.txnDate)}: ${JSON.stringify(plan.today)},
           ${JSON.stringify(plan.ids.txnAmount)}: ${plan.expected.editedAmount},
           ${JSON.stringify(plan.ids.txnAccount)}: ${JSON.stringify(plan.ids.accountId)},
           ${JSON.stringify(plan.ids.txnCategory)}: ${JSON.stringify(plan.ids.categoryId)},
           ${JSON.stringify(plan.ids.txnPayee)}: "Typed by hand"
         }
       })`,
    );
    checks.editReply = edited;
    if (!edited?.ok) failure(`dbUpsertRow from the renderer failed: ${JSON.stringify(edited)}`);

    if (edited?.ok) {
      try {
        await waitFor(
          win,
          `document.querySelectorAll('[data-testid="card-list"] .view-card__table tbody tr').length === ${plan.expected.listRowsEdited} && (document.querySelector('[data-testid="card-today"] .view-card__metric') || {}).textContent?.includes("${plan.expected.todayEdited}")`,
          "the cards to repaint with the operator's own edit",
          15_000,
        );
      } catch (error) {
        failure(error instanceof Error ? error.message : String(error));
      }
      const editedSample = await win.webContents.executeJavaScript(SAMPLE);
      checks.afterEdit = editedSample;
      if (editedSample.loads !== 1) {
        failure(`the harness page was loaded ${editedSample.loads} times after the operator's edit`);
      }
      if (metricNumbers(editedSample, "card-today")[0] !== plan.expected.todayEdited) {
        failure(
          `Today's expenses read ${JSON.stringify(metricNumbers(editedSample, "card-today"))} after the operator's own edit, ` +
            `expected [${plan.expected.todayEdited}]: an IPC write did not reach the card`,
        );
      }
      // The operator's own write is in this month too, so the average of the
      // months before it is still the number it was — the same rule, reached
      // through the app's other write door.
      const averageAfterEdit = metricNumbers(editedSample, "card-average");
      checks.averageAfterEdit = averageAfterEdit;
      if (averageAfterEdit[0] !== plan.expected.averageAfterEdit) {
        failure(
          `the average-month card read ${JSON.stringify(averageAfterEdit)} after the operator's own edit, ` +
            `expected [${plan.expected.averageAfterEdit}]`,
        );
      }
      if (editedSample.cards["card-list"].rows.length !== plan.expected.listRowsEdited) {
        failure(
          `the listing drew ${editedSample.cards["card-list"].rows.length} rows after the operator's edit, ` +
            `expected ${plan.expected.listRowsEdited}`,
        );
      }
    }

    // ── leg three: the DAY, with no write anywhere ─────────────────────────
    //
    // A board left open overnight is the other half of "it's stuck on a particular
    // day": a `today` window is computed from the calendar, so at 00:01 the card
    // is showing yesterday's answer and nothing on disk has changed to say so.
    // The clock is moved on BOTH sides, because both of them read it: the
    // renderer's day check decides when to re-run, and the engine's `today`
    // decides what the re-run means. A vault whose only row for the new day is
    // none at all makes the answer unambiguous: a live `today` metric falls to 0.
    //
    // It is moved to the FIRST OF NEXT MONTH rather than merely to tomorrow,
    // which makes this one leg carry two claims at once. The `today` window
    // follows the day as it always did, and the average card's
    // `previous-months` window — the four whole months before whatever month it
    // is — steps forward by a month. October's spending drops out of the average
    // and November becomes the month that just ended, with no write anywhere.
    // That is the operator's "Every month it gets recalculated", observed in the
    // real app rather than argued.
    const moved = await win.webContents.executeJavaScript(`(() => {
      const Real = Date;
      const [y, m, d] = ${JSON.stringify(plan.nextMonthStart)}.split('-').map(Number);
      const ahead = new Real(y, m - 1, d, 12, 0, 0, 0);
      const Fake = class extends Real {
        constructor(...args) { if (args.length === 0) super(ahead.getTime()); else super(...args); }
        static now() { return ahead.getTime(); }
      };
      window.Date = Fake;
      return { from: new Real().toISOString(), to: ahead.toISOString() };
    })()`);
    checks.clockMovedInRenderer = moved;
    // The same shift in the main process, where the engine computes the window.
    const RealDate = Date;
    const [nextY, nextM, nextD] = String(plan.nextMonthStart).split("-").map(Number);
    const aheadMs = new RealDate(nextY, nextM - 1, nextD, 12, 0, 0, 0).getTime();
    // eslint-disable-next-line no-global-assign
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(aheadMs);
        else super(...args);
      }
      static now() {
        return aheadMs;
      }
    };
    checks.clockMovedInMain = new RealDate(aheadMs).toISOString();

    const todayBeforeRollover = metricNumbers(checks.afterEdit ?? after ?? before, "card-today");
    const averageBeforeRollover = metricNumbers(checks.afterEdit ?? after ?? before, "card-average");
    checks.averageBeforeMonthTurn = averageBeforeRollover;
    // A metric's own number, parsed out of its text, so "0" cannot be matched by
    // a "-320" or by the word "No rows".
    const metricIs = (key, value) => `(() => {
      const el = document.querySelector('[data-testid="${key}"] .view-card__metric');
      if (!el) return false;
      const match = /-?[\\d\\s.,]+/.exec((el.textContent || '').replace(/\\u00a0/g, ' '));
      if (!match) return false;
      return Number(match[0].replace(/[\\s,]/g, '')) === ${value};
    })()`;
    try {
      await waitFor(
        win,
        // The average card is the discriminating one: a card that was never
        // asked again would still read the old month's number, while `today`
        // reads 0 on any day with no rows.
        `(${metricIs("card-today", plan.expected.todayNextDay)}) && ` +
          `(${metricIs("card-average", plan.expected.averageAfterMonthTurn)})`,
        "the cards to follow the calendar into the new month",
        // The day check runs on a 30-second clock, so this leg is bounded by that
        // rather than by the write path. It is the one wait in this rig that is
        // not driven by an event, because the thing being tested is a timer.
        40_000,
      );
      const rolled = await win.webContents.executeJavaScript(SAMPLE);
      checks.todayAfterRollover = metricNumbers(rolled, "card-today");
      checks.averageAfterMonthTurn = metricNumbers(rolled, "card-average");
    } catch (error) {
      const rolled = await win.webContents.executeJavaScript(SAMPLE);
      checks.todayAfterRollover = metricNumbers(rolled, "card-today");
      checks.averageAfterMonthTurn = metricNumbers(rolled, "card-average");
      failure(
        `${error instanceof Error ? error.message : String(error)}: ` +
          `Today's expenses read ${JSON.stringify(checks.todayAfterRollover)} ` +
          `(${JSON.stringify(todayBeforeRollover)} before the clock moved) and the average read ` +
          `${JSON.stringify(checks.averageAfterMonthTurn)} ` +
          `(${JSON.stringify(averageBeforeRollover)} before, expected ` +
          `${JSON.stringify([plan.expected.averageAfterMonthTurn])} over ` +
          `${plan.expected.averageWindows.afterMonthTurn.start}..${plan.expected.averageWindows.afterMonthTurn.end})`,
      );
    }
    if (checks.todayAfterRollover?.[0] !== plan.expected.todayNextDay) {
      failure(
        `After the day changed, Today's expenses read ${JSON.stringify(checks.todayAfterRollover)}, ` +
          `expected [${plan.expected.todayNextDay}] — a live window did not follow the calendar`,
      );
    }
    if (checks.averageAfterMonthTurn?.[0] !== plan.expected.averageAfterMonthTurn) {
      failure(
        `After the month turned, the average read ${JSON.stringify(checks.averageAfterMonthTurn)}, ` +
          `expected [${plan.expected.averageAfterMonthTurn}] over ` +
          `${plan.expected.averageWindows.afterMonthTurn.start}..${plan.expected.averageWindows.afterMonthTurn.end} ` +
          `— the previous-months window did not step forward on its own, with no write anywhere`,
      );
    }
    const nextDayImage = await shot(win);
    if (nextDayImage) fs.writeFileSync(SHOT_NEXT_DAY, nextDayImage);

    if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);
  } catch (error) {
    failure(error instanceof Error ? error.stack ?? error.message : String(error));
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what:
      "a pinned dashboard card repaints itself when the agent posts a row through the app's own MCP " +
      "door, and a period average over the previous months follows the calendar with no write",
    command: "node e2e/live-dashboard.mjs  (also reached by npm test via tests/live-dashboard-ui-e2e.test.ts)",
    vault: plan.vault,
    captureText: plan.captureText,
    checks,
    consoleErrors,
    screenshots: {
      afterTheAgentsExpense: fs.existsSync(SHOT) ? path.basename(SHOT) : null,
      afterTheDayTurned: fs.existsSync(SHOT_NEXT_DAY) ? path.basename(SHOT_NEXT_DAY) : null,
    },
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[live-dashboard] listing rows: ${checks.before?.cards["card-list"].rows.length} → ${checks.after?.cards["card-list"].rows.length} (agent) → ${checks.afterEdit?.cards["card-list"].rows.length} (operator)`);
  console.log(`[live-dashboard] today: ${JSON.stringify(metricNumbers(checks.before ?? { cards: {} }, "card-today"))} → ${JSON.stringify(checks.todayAfter ?? [])} (agent) → ${JSON.stringify(metricNumbers(checks.afterEdit ?? { cards: {} }, "card-today"))} (operator) → ${JSON.stringify(checks.todayAfterRollover ?? [])} (next month)`);
  console.log(`[live-dashboard] frozen: ${JSON.stringify(metricNumbers(checks.before ?? { cards: {} }, "card-frozen"))} → ${JSON.stringify(checks.frozenAfter ?? [])}`);
  console.log(`[live-dashboard] average: ${JSON.stringify(metricNumbers(checks.before ?? { cards: {} }, "card-average"))} → ${JSON.stringify(checks.averageAfter ?? [])} (agent) → ${JSON.stringify(metricNumbers(checks.afterEdit ?? { cards: {} }, "card-average"))} (operator) → ${JSON.stringify(checks.averageAfterMonthTurn ?? [])} (next month) over ${plan.expected.averageWindows.before.start}..${plan.expected.averageWindows.afterMonthTurn.end}`);
  console.log(`[live-dashboard] repaints: idle ${checks.mutationsWhileIdle ?? "?"} mutation(s), after the write ${checks.mutationsBefore ?? "?"} → ${checks.mutationsAfter ?? "?"}`);
  console.log(`[live-dashboard] failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  if (!product.isDestroyed()) product.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

/** The local door's port, as the launcher told the app through LIFEQUEST_E2E. */
function mcpPortFromEnv() {
  const parsed = JSON.parse(process.env.LIFEQUEST_E2E ?? "{}");
  const port = parsed?.mcpPorts?.local;
  if (typeof port !== "number") throw new Error("LIFEQUEST_E2E carries no mcpPorts.local");
  return port;
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("live-dashboard rig timed out");
  app.exit(1);
}, 170_000);
