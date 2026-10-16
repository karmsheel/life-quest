/**
 * Drives the decisions-live harness in a real Electron window and turns what the
 * page actually rendered into `e2e/artifacts/decisions-live.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/decisions-live.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same table, no eyeballing the app required.
 *
 * WHAT THIS RIG CLAIMS, AND THE INPUT THAT MAKES EACH CLAIM FALSIFIABLE
 *
 * The report, replayed on the shortlist — legs 1 to 3 are the fix, and legs 4 to 6
 * are the two behaviours around it that the fix must not break:
 *
 *  1. A filing while the operator is ON the page appears on it. No remount, no
 *     navigation, no reload: the mount count is read before and after, and the
 *     bridge's own `decisionList` count is what says the page re-read the vault
 *     rather than being handed anything.
 *  2. The page says it arrived: the card wears the mark and the arrival line names
 *     the actor who filed it.
 *  3. The list is never swapped for a spinner on the way. Sampled on a timer from
 *     before the write: no frame after the first paint reads "Loading decisions",
 *     and the card count only ever goes up.
 *  4. The mark is a pulse, not a flag: after it expires the card is still there and
 *     the chip is gone.
 *  5. The arrival lands where the operator's eye already is. Parked 120px down with
 *     the list's beginning on screen, the new card takes the place the previous
 *     newest card held, its heading on screen, and the page does not scroll itself.
 *  6. An operator reading further down is not yanked: the prepend IS absorbed
 *     (`scrollTop` grows by the card's height — or the leg would pass by having
 *     changed nothing) and the card their fold was sitting in keeps its exact
 *     offset in the scrollport.
 *  7. The page shows what belongs to it: a proposal filed for a domain the lens is
 *     not on is not shown, is not counted in the arrival line, and appears the
 *     moment the lens moves there.
 *  8. Approving still works, and it works on a card that just arrived.
 *  9. A Decision resolved in another window leaves this list with no reload and
 *     with no "New" chip on it.
 *
 * NOT covered here: that the main process announces a fenced `lifequest-decision`
 * filing at all (`fileImpliedChange` in `vault-service.ts` now calls
 * `noteDataChanged`; the harness plays the main process and fires the event itself,
 * so this rig cannot see whether the real one does), and the real vault's own
 * `decisionList` read path.
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
const baseUrl =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/decisions-live.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The mark's own lifetime in the component, plus slack for a slow frame. */
const ARRIVAL_MS = 6_000;

const errors = [];
const scenarios = [];

/** Record one claim, so the JSON report names what held and what did not. */
function claim(name, pass, detail = null) {
  scenarios.push({ name, pass, detail: pass ? null : detail });
  if (!pass) errors.push(`${name}: ${detail ?? "failed"}`);
  return pass;
}

function waitFor(win, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
        // The dev server can reload the page mid-wait (Vite re-optimising a new
        // import), which clears the harness globals: that is "not ready yet".
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a condition, and say whether it ever held.
 *
 * A `waitFor` that THROWS on a broken page is the wrong instrument for a claim:
 * the rig then dies before it writes its report, and the artifact the suite reads
 * is missing rather than red. Everything after boot settles through here, so every
 * claim is recorded and named — a claim that never held reads as a failed claim,
 * not as a rig that hung.
 */
async function settle(win, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await win.webContents.executeJavaScript(expression);
    } catch {
      value = undefined;
    }
    if (value) return true;
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
}

/** Call one of the harness's own globals, JSON-encoding its arguments. */
function call(win, name, ...args) {
  const encoded = args.map((arg) => JSON.stringify(arg)).join(", ");
  return win.webContents.executeJavaScript(`window.${name}(${encoded})`);
}

const screen = (win) => call(win, "decisionsLiveScreen");
const scroll = (win) => call(win, "decisionsLiveScroll");

/** The revision the vault is at, read from the page's own listener count. */
async function file(win, slug, title) {
  return call(win, "decisionsLiveFile", slug, title);
}

/**
 * The card the operator is reading: the last one whose top edge reached the fold.
 *
 * The same definition `board-hold.ts` uses, arrived at here independently — a card
 * clean off the top is still the card the operator scrolled past.
 */
function reading(screenNow) {
  let place = null;
  screenNow.ids.forEach((id, index) => {
    const top = screenNow.tops[index];
    if (top !== undefined && top <= 0) place = { id, top };
  });
  return place;
}

async function open(win, seed) {
  await win.loadURL(`${baseUrl}?seed=${seed}`);
  await waitFor(win, "Boolean(window.decisionsLiveReady)", "decisionsLiveReady");
  // The page has committed once; one more poll lets the inbox's first read land.
  await waitFor(win, "window.decisionsLiveScreen().listCalls > 0", "the first read");
  return screen(win);
}

async function main() {
  // The rig opens a real window on the operator's desktop: paint it in the theme
  // the app defaults to, so a test run is not a white sheet flashing across it.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const checks = {};

  // ══ the reported case: an empty inbox, and a filing that lands in it ═══════
  const before = await open(win, 0);
  checks.before = before;
  claim(
    "the-empty-inbox-says-so",
    before.empty === "No pending proposals." &&
      before.ids.length === 0 &&
      before.arrival === null &&
      before.activeTab === "Pending",
    `empty=${JSON.stringify(before.empty)} cards=${before.ids.length} arrival=${JSON.stringify(before.arrival)} tab=${JSON.stringify(before.activeTab)}`,
  );

  await call(win, "decisionsLiveStartWatch");
  const mountsAtStart = before.mounts;
  const listCallsAtStart = before.listCalls;
  const filedId = await file(win, "financial", "Premise revision 1");
  const landed = await settle(
    win,
    "window.decisionsLiveScreen().arrival !== null",
  );
  const after = await screen(win);
  checks.afterFirst = after;
  checks.filedId = filedId;
  // The money shot: the card that arrived, with its mark and the line above it.
  const image = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "decisions-live.png"), image.toPNG());

  claim(
    "a-filing-appears-without-leaving-the-page",
    landed &&
      after.ids[0] === filedId &&
      after.titles[0] === "Premise revision 1" &&
      after.mounts === mountsAtStart &&
      after.listCalls > listCallsAtStart,
    `landed=${landed} ids=${JSON.stringify(after.ids)} mounts=${after.mounts} (was ${mountsAtStart}) listCalls=${after.listCalls} (was ${listCallsAtStart})`,
  );
  claim(
    "the-arrival-line-names-who-filed-it",
    after.arrival === "New decision filed by Hermes.",
    `line read ${JSON.stringify(after.arrival)}`,
  );
  claim(
    "the-new-card-wears-the-mark",
    after.arrived.length === 1 &&
      after.arrived[0] === filedId &&
      after.newChips === 1 &&
      after.empty === null,
    `marked=${JSON.stringify(after.arrived)} chips=${after.newChips} empty=${JSON.stringify(after.empty)}`,
  );

  // The flicker claim, from the frames rather than from the endpoints: a spinner
  // that came and went between two reads would be invisible in both of them.
  const frames = await call(win, "decisionsLiveFrames");
  checks.frames = frames;
  const loadingFrames = frames.filter((frame) => frame.loading);
  const counts = frames.map((frame) => frame.cards);
  const everDropped = counts.some(
    (count, index) => index > 0 && count < counts[index - 1],
  );
  claim(
    "the-list-is-never-swapped-for-a-spinner",
    loadingFrames.length === 0 && !everDropped,
    `loading frames=${loadingFrames.length} card counts=${JSON.stringify(counts)}`,
  );

  // The mark is a pulse. Waited out rather than asserted at an arbitrary instant.
  await sleep(ARRIVAL_MS + 700);
  const settled = await screen(win);
  checks.afterPulse = settled;
  claim(
    "the-mark-is-a-pulse",
    settled.newChips === 0 &&
      settled.arrival === null &&
      settled.ids.includes(filedId),
    `chips=${settled.newChips} arrival=${JSON.stringify(settled.arrival)} still listed=${settled.ids.includes(filedId)}`,
  );

  // A burst: two filings land before the page has drawn either one. Both are the
  // page's to show, and the line counts them rather than naming the newest twice.
  await call(win, "decisionsLiveFile", "financial", "Premise revision 2");
  await call(win, "decisionsLiveFile", "financial", "Premise revision 3");
  const burstLanded = await settle(
    win,
    "window.decisionsLiveScreen().arrival !== null",
  );
  const afterBurst = await screen(win);
  checks.afterBurst = afterBurst;
  claim(
    "two-filings-read-as-a-plural",
    burstLanded &&
      /^2 new decisions filed\.$/.test(afterBurst.arrival ?? "") &&
      afterBurst.arrived.length === 2,
    `line=${JSON.stringify(afterBurst.arrival)} marked=${JSON.stringify(afterBurst.arrived)}`,
  );

  // ══ a list taller than the scrollport: where the arrival lands ═════════════
  const seeded = await open(win, 8);
  checks.seeded = seeded;
  const seededScroll = await scroll(win);
  checks.seededScroll = seededScroll;
  claim(
    "the-page-can-scroll-at-all",
    seeded.ids.length === 8 && seededScroll.max > 0,
    `cards=${seeded.ids.length} max=${seededScroll.max}`,
  );

  // Where the operator's eye already is: parked 120px down, with the list's
  // beginning still on screen. The arrival takes the place the previous newest
  // card held and is read where they are looking — and note what this leg is NOT:
  // no scroll of the page's own is needed or wanted, which is why the control
  // below (scrolled INTO the list) is the leg that has an answer.
  await call(win, "decisionsLiveScrollTo", 120);
  const beforeTopFile = await screen(win);
  const topId = await file(win, "financial", "An arrival at the top");
  const topDrawn = await settle(
    win,
    `window.decisionsLiveScreen().ids.includes(${JSON.stringify(topId)})`,
  );
  await sleep(120);
  const atTop = await screen(win);
  checks.beforeTopFile = beforeTopFile;
  checks.atTop = atTop;
  claim(
    "the-arrival-lands-on-screen-where-the-list-starts",
    topDrawn &&
      atTop.ids[0] === topId &&
      (atTop.tops[0] ?? -1) >= 0 &&
      atTop.top === beforeTopFile.top,
    `drawn=${topDrawn} first=${JSON.stringify(atTop.ids[0])} tops=${JSON.stringify(atTop.tops.slice(0, 3))} scrollTop=${atTop.top} (was ${beforeTopFile.top})`,
  );

  // Reading further down: the page does not take the operator's place. The
  // prepend IS absorbed — `scrollTop` grows by the new card's height, or this leg
  // would pass by having changed nothing at all — and the card their fold was
  // sitting in does not move a pixel.
  await call(
    win,
    "decisionsLiveScrollTo",
    Math.min(700, Math.max(1, seededScroll.max - 60)),
  );
  const parked = await screen(win);
  const place = reading(parked);
  const downId = await file(win, "financial", "An arrival you were not watching for");
  const downDrawn = await settle(
    win,
    `window.decisionsLiveScreen().ids.includes(${JSON.stringify(downId)})`,
  );
  // One frame after the commit that drew it, so a correction would have landed.
  await sleep(250);
  const held = await screen(win);
  const afterPlace =
    place && held.ids.includes(place.id)
      ? { id: place.id, top: held.tops[held.ids.indexOf(place.id)] }
      : null;
  checks.parked = parked;
  checks.held = held;
  checks.place = place;
  checks.afterPlace = afterPlace;
  claim(
    "reading-further-down-keeps-your-place",
    downDrawn &&
      Boolean(place) &&
      Boolean(afterPlace) &&
      Math.abs((afterPlace?.top ?? 0) - (place?.top ?? 0)) <= 1 &&
      held.top > parked.top,
    `place=${JSON.stringify(place)} after=${JSON.stringify(afterPlace)} scrollTop=${held.top} (was ${parked.top})`,
  );

  // Another window's approval: the card goes, with no reload and no arrival mark.
  const leaveId = parked.ids.at(-1);
  await call(win, "decisionsLiveResolveElsewhere", leaveId);
  const left = await settle(
    win,
    `!window.decisionsLiveScreen().ids.includes(${JSON.stringify(leaveId)})`,
  );
  const afterElsewhere = await screen(win);
  checks.afterElsewhere = afterElsewhere;
  claim(
    "a-decision-resolved-elsewhere-leaves-the-list",
    left &&
      !afterElsewhere.ids.includes(leaveId) &&
      !afterElsewhere.arrived.includes(leaveId),
    `left=${left} ids=${JSON.stringify(afterElsewhere.ids)} marked=${JSON.stringify(afterElsewhere.arrived)}`,
  );

  // ══ the lens, and the approve ══════════════════════════════════════════════
  const beforeLens = await screen(win);
  await call(win, "decisionsLiveSetLens", "financial");
  const lensRead = await settle(
    win,
    `window.decisionsLiveScreen().listCalls > ${beforeLens.listCalls}`,
  );
  const hiddenId = await file(win, "health", "A health premise");
  await sleep(400);
  const hidden = await screen(win);
  checks.hidden = hidden;
  claim(
    "another-domain-s-proposal-is-not-this-page-s-to-show",
    lensRead &&
      !hidden.ids.includes(hiddenId) &&
      hidden.arrival === null &&
      hidden.newChips === 0,
    `lensRead=${lensRead} ids=${JSON.stringify(hidden.ids)} arrival=${JSON.stringify(hidden.arrival)} chips=${hidden.newChips}`,
  );

  // The lens moves there: the proposal was never dropped, only filtered, and it is
  // still the page's arrival to announce while the mark is live.
  await call(win, "decisionsLiveSetLens", "health");
  const shownUp = await settle(
    win,
    `window.decisionsLiveScreen().ids.includes(${JSON.stringify(hiddenId)})`,
  );
  const shown = await screen(win);
  checks.shown = shown;
  claim(
    "the-lens-moving-there-reveals-it-marked",
    shownUp &&
      shown.ids.length === 1 &&
      shown.arrived.includes(hiddenId) &&
      shown.arrival !== null,
    `shown=${shownUp} ids=${JSON.stringify(shown.ids)} marked=${JSON.stringify(shown.arrived)} arrival=${JSON.stringify(shown.arrival)}`,
  );

  // Approving a card that just arrived: the card's own control, the vault's own
  // call, and the list settling without a reload.
  const approved = await call(win, "decisionsLiveApprove", hiddenId);
  const gone = await settle(
    win,
    `!window.decisionsLiveScreen().ids.includes(${JSON.stringify(hiddenId)})`,
  );
  const resolves = await win.webContents.executeJavaScript(
    "window.decisionsLiveResolves",
  );
  const afterApprove = await screen(win);
  checks.afterApprove = afterApprove;
  checks.resolves = resolves;
  claim(
    "an-approve-still-works-after-an-arrival",
    approved === true &&
      gone &&
      resolves.length === 1 &&
      resolves[0].id === hiddenId &&
      resolves[0].resolution === "approved" &&
      afterApprove.empty === "No pending proposals.",
    `approved=${approved} gone=${gone} resolves=${JSON.stringify(resolves)} empty=${JSON.stringify(afterApprove.empty)}`,
  );

  await call(win, "decisionsLiveTab", "History");
  const onHistory = await settle(
    win,
    `window.decisionsLiveScreen().ids.includes(${JSON.stringify(hiddenId)})`,
  );
  const history = await screen(win);
  checks.history = history;
  claim(
    "history-draws-it-as-approved",
    onHistory &&
      history.activeTab === "History" &&
      history.statuses[history.ids.indexOf(hiddenId)] === "approved",
    `tab=${JSON.stringify(history.activeTab)} ids=${JSON.stringify(history.ids)} statuses=${JSON.stringify(history.statuses)}`,
  );

  // A read that lands out of order cannot draw the wrong tab.
  //
  // A read is a round trip and the tab can move inside it, so this is the case
  // where the LAST result to arrive is the older question: the live read a filing
  // starts is made to take 800ms, the operator clicks History inside that window,
  // and that read is fast. Without a guard on which read owns the screen, the
  // slow one lands last and puts the PENDING list — with the new card on it —
  // under the History tab, where it stays, because nothing asks again.
  //
  // The filing is for the lens that is open (`health`), which is what makes the
  // claim say something: a proposal the pending list would NOT have shown is one
  // whose arrival cannot be mistaken for the fix working.
  await call(win, "decisionsLiveTab", "Pending");
  await settle(win, 'window.decisionsLiveScreen().activeTab === "Pending"');
  const startsBefore = (await screen(win)).listStarts;
  await call(win, "decisionsLiveSlowNextList", 800);
  const slowId = await file(win, "health", "A filing whose read is slow");
  const slowStarted = await settle(
    win,
    `window.decisionsLiveScreen().listStarts > ${startsBefore}`,
  );
  await call(win, "decisionsLiveTab", "History");
  // Long enough for the slow read to have landed, had it been allowed to.
  await sleep(1200);
  const afterRace = await screen(win);
  checks.afterRace = afterRace;
  claim(
    "a-slow-read-cannot-land-under-the-wrong-tab",
    slowStarted &&
      afterRace.activeTab === "History" &&
      !afterRace.ids.includes(slowId),
    `started=${slowStarted} tab=${JSON.stringify(afterRace.activeTab)} ids=${JSON.stringify(afterRace.ids)} slowId=${slowId}`,
  );

  const unexpected = await win.webContents.executeJavaScript(
    "window.decisionsLiveUnexpectedCalls",
  );
  checks.unexpectedBridgeCalls = unexpected;
  claim(
    "the-page-asks-the-bridge-for-nothing-else",
    unexpected.length === 0,
    `unexpected calls: ${JSON.stringify(unexpected)}`,
  );
  checks.consoleErrors = consoleErrors;
  claim(
    "the-page-logs-no-errors",
    consoleErrors.length === 0,
    `${consoleErrors.length} console errors`,
  );

  const passed = scenarios.filter((scenario) => scenario.pass).length;
  const report = {
    pass: errors.length === 0,
    failures: errors,
    claims: `${passed}/${scenarios.length}`,
    checks: { scenarios, ...checks },
  };

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "decisions-live.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  // `decisions-live.png` was captured at the arrival itself, which is the state
  // this rig exists to show; it is not overwritten with the History tab at the end.

  const table = scenarios
    .map((scenario) => `  ${scenario.pass ? "ok  " : "FAIL"} ${scenario.name}`)
    .join("\n");
  console.log(`decisions-live  ${passed}/${scenarios.length} claims held`);
  console.log(table);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

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
  console.error("decisions-live rig timed out");
  app.exit(1);
}, 120_000);
