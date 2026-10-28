/**
 * Drives the live Decisions badge in a real Electron window and turns what the
 * real `NavRail` did into `e2e/artifacts/decisions-badge.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`), or through the launcher:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> tests/decisions-badge-live-e2e.test.ts
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same table, no eyeballing the app required. The PNG is captured
 * at the arrival itself, which is the state this rig exists to show.
 *
 * WHAT THIS RIG CLAIMS, AND THE INPUT THAT MAKES EACH CLAIM FALSIFIABLE
 *
 *  1. With nothing pending, the rail shows no badge and the link is still
 *     "Decisions" — the starting state the other claims are measured against.
 *  2. A Decision filed while the rail is mounted appears on it as a count of 1,
 *     and the page re-read the vault to find it: the stub's snapshot has no
 *     decisions at all, and its `decisionList` call count went up. A badge drawn
 *     from the boot snapshot cannot pass this.
 *  3. The link's own `aria-label`/`title` say "Decisions, 1 pending", so the
 *     count is not only a dot on the icon.
 *  4. The arrival is marked on the badge element: `data-arrived="true"` and
 *     `nav-rail__badge--arrived`.
 *  5. The count arrived without a remount or a reload: the cumulative mount
 *     counter, the page's module nonce, and the token stamped on the anchor are
 *     all unchanged from the baseline.
 *  6. The mark is a pulse, not a flag: it clears by itself after about four
 *     seconds (sampled on a timer, so the duration is measured rather than
 *     guessed) while the count stays at 1.
 *  7. A second filing bumps the count to 2, updates the label, and marks the
 *     arrival again — "updates as more arrive".
 *  8. A DECREASE (a Decision resolved elsewhere) updates the count without
 *     flashing the arrival mark: the mark means "something new for you", not
 *     "something changed".
 *  9. With nothing pending the badge leaves the rail entirely and the link goes
 *     back to plain "Decisions".
 * 10. Nothing was rebuilt between the baseline and the end — the same no-remount
 *     fact read at the end of the run rather than only at the first arrival.
 * 11. The stub bridge recorded no unexpected method calls.
 * 12. The page logged no console errors (and the window captured no uncaught
 *     errors or unhandled rejections).
 *
 * NOT covered here: whether the real main process announces a Decision at all,
 * and whether the real vault's `decisionList` returns it. The harness plays the
 * main process — it writes the decision and fires the one event `main.ts` fires —
 * so this rig is about the rail's reaction, not the write path. Those live in the
 * intake rig and the vault's own tests.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing timers a frame at a time: a hidden rig in the suite has to keep going.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const baseUrl =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/decisions-badge.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/**
 * The contract's "about 4 seconds", with room either side for a slow frame and
 * the sampler's own 100ms beat. A band rather than an equality: the claim is
 * "the mark clears itself", not "the timeout is exactly 4000ms".
 */
const PULSE_MIN_MS = 2_500;
const PULSE_MAX_MS = 7_000;

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
 * is missing rather than red. Everything after boot settles through here, so a
 * claim that never held reads as a failed claim, not as a rig that hung.
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

/** Call one of the harness's own globals, JSON-encoding its argument. */
function call(win, name, ...args) {
  const encoded = args.map((arg) => JSON.stringify(arg)).join(", ");
  return win.webContents.executeJavaScript(`window.${name}(${encoded})`);
}

const screen = (win) => call(win, "decisionsBadgeScreen");
const pulse = (win) => call(win, "decisionsBadgePulse");

/** The badge's own words, as the rail link carries them. */
function labelOf(screenNow) {
  return { aria: screenNow.ariaLabel, title: screenNow.title };
}

async function open(win) {
  await win.loadURL(baseUrl);
  await waitFor(win, "Boolean(window.decisionsBadgeReady)", "decisionsBadgeReady");
  // The vault's first snapshot load has its own effect; a baseline taken before
  // it lands would be measuring a page that is still booting.
  await settle(win, "Boolean(window.decisionsBadgeBooted)", 8_000);
  await sleep(250);
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

  // ══ the starting state: nothing pending, no badge ═════════════════════════
  const before = await open(win);
  checks.before = before;
  await call(win, "decisionsBadgeStartPulseWatch");
  claim(
    "the-rail-starts-with-no-badge",
    before.railPresent === true &&
      before.href === "/decisions" &&
      before.badgePresent === false &&
      before.ariaLabel === "Decisions" &&
      before.title === "Decisions" &&
      before.snapshotDecisions === 0,
    `rail=${before.railPresent} href=${JSON.stringify(before.href)} badge=${before.badgePresent} aria=${JSON.stringify(before.ariaLabel)} title=${JSON.stringify(before.title)} snapshotDecisions=${before.snapshotDecisions}`,
  );

  // ══ one filing, while the rail is mounted ═════════════════════════════════
  const filedId = await call(win, "decisionsBadgeFile", "Premise revision 1");
  const landed = await settle(win, "window.decisionsBadgeScreen().badgePresent", 6_000);
  // The money shot: the count on the rail, with the arrival mark on it.
  const image = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  const pngPath = path.join(artifactsDir, "decisions-badge.png");
  fs.writeFileSync(pngPath, image.toPNG());
  const afterFirst = await screen(win);
  checks.afterFirst = afterFirst;
  checks.filedId = filedId;
  checks.screenshot = path.relative(here, pngPath);

  claim(
    "a-filing-while-mounted-appears-as-a-count",
    landed &&
      afterFirst.badgePresent === true &&
      afterFirst.badgeText === "1" &&
      afterFirst.decisionListCalls > before.decisionListCalls &&
      afterFirst.snapshotDecisions === 0,
    `landed=${landed} badge=${afterFirst.badgePresent} text=${JSON.stringify(afterFirst.badgeText)} listCalls=${afterFirst.decisionListCalls} (was ${before.decisionListCalls}) snapshotDecisions=${afterFirst.snapshotDecisions}`,
  );
  claim(
    "the-link-says-how-many-are-pending",
    afterFirst.badgePresent === true &&
      afterFirst.ariaLabel === "Decisions, 1 pending" &&
      afterFirst.title === "Decisions, 1 pending",
    `label=${JSON.stringify(labelOf(afterFirst))} badgeAria=${JSON.stringify(afterFirst.badgeAriaLabel)} badgeTitle=${JSON.stringify(afterFirst.badgeTitle)}`,
  );
  claim(
    "the-arrival-mark-is-on-the-badge",
    afterFirst.arrived === "true" && afterFirst.arrivedClass === true,
    `data-arrived=${JSON.stringify(afterFirst.arrived)} class=${afterFirst.arrivedClass}`,
  );
  claim(
    "the-count-arrives-without-a-remount-or-a-reload",
    afterFirst.mounts === before.mounts &&
      afterFirst.nonce === before.nonce &&
      afterFirst.sameLinkNode === true &&
      afterFirst.linkToken === before.linkToken &&
      afterFirst.listenerCount >= 1,
    `mounts=${afterFirst.mounts} (was ${before.mounts}) nonce=${afterFirst.nonce === before.nonce} sameLink=${afterFirst.sameLinkNode} token=${afterFirst.linkToken === before.linkToken} listeners=${afterFirst.listenerCount}`,
  );

  // ══ the mark clears itself, and the count stays ═══════════════════════════
  const cleared = await settle(
    win,
    "(() => { const s = window.decisionsBadgeScreen(); return !s.badgePresent || (s.arrived !== 'true' && !s.arrivedClass); })()",
    9_000,
  );
  const afterPulse = await screen(win);
  const firstPulse = await pulse(win);
  checks.afterPulse = afterPulse;
  checks.pulseFirst = firstPulse;
  await call(win, "decisionsBadgeStopPulseWatch");
  claim(
    "the-mark-is-a-pulse-and-the-count-stays",
    cleared &&
      afterPulse.badgePresent === true &&
      afterPulse.badgeText === "1" &&
      afterPulse.arrived !== "true" &&
      afterPulse.arrivedClass === false &&
      afterPulse.ariaLabel === "Decisions, 1 pending" &&
      firstPulse.arrivedAt !== null &&
      firstPulse.goneAt !== null &&
      firstPulse.durationMs !== null &&
      firstPulse.durationMs >= PULSE_MIN_MS &&
      firstPulse.durationMs <= PULSE_MAX_MS,
    `cleared=${cleared} badge=${afterPulse.badgePresent} text=${JSON.stringify(afterPulse.badgeText)} arrived=${JSON.stringify(afterPulse.arrived)} class=${afterPulse.arrivedClass} durationMs=${firstPulse.durationMs} samples=${firstPulse.samples}`,
  );

  // ══ a second filing: the count moves again and marks again ════════════════
  await call(win, "decisionsBadgeStartPulseWatch");
  const secondId = await call(win, "decisionsBadgeFile", "Premise revision 2");
  const bumped = await settle(win, "window.decisionsBadgeScreen().badgeText === '2'", 6_000);
  // The arrival mark is stamped by an effect one commit after the count moves,
  // so a read taken the instant the count reads "2" can land between the two and
  // miss it. Wait for the mark the claim is about (the pulse lasts seconds, so a
  // real absence still times out); the count itself is already asserted above.
  const secondMarked = await settle(
    win,
    "window.decisionsBadgeScreen().arrived === 'true'",
    2_000,
  );
  const afterSecond = await screen(win);
  checks.afterSecond = afterSecond;
  checks.secondId = secondId;
  claim(
    "a-second-filing-bumps-the-count",
    bumped &&
      secondMarked &&
      afterSecond.badgePresent === true &&
      afterSecond.badgeText === "2" &&
      afterSecond.ariaLabel === "Decisions, 2 pending" &&
      afterSecond.arrived === "true" &&
      afterSecond.arrivedClass === true &&
      afterSecond.decisionListCalls > afterFirst.decisionListCalls,
    `bumped=${bumped} badge=${afterSecond.badgePresent} text=${JSON.stringify(afterSecond.badgeText)} aria=${JSON.stringify(afterSecond.ariaLabel)} arrived=${JSON.stringify(afterSecond.arrived)} class=${afterSecond.arrivedClass} listCalls=${afterSecond.decisionListCalls} (was ${afterFirst.decisionListCalls})`,
  );

  // ══ a decrease is not an arrival ══════════════════════════════════════════
  // Wait the second mark out first, so "no mark" below cannot be the remains of
  // an earlier pulse rather than a fact about the decrease.
  await settle(
    win,
    "(() => { const s = window.decisionsBadgeScreen(); return !s.badgePresent || (s.arrived !== 'true' && !s.arrivedClass); })()",
    9_000,
  );
  // Read the second pulse before the watch is stopped, so the artifact carries
  // the same measurement for the repeat that it carries for the first arrival.
  checks.pulseSecond = await pulse(win);
  await call(win, "decisionsBadgeStopPulseWatch");
  const resolvedElsewhere = await call(win, "decisionsBadgeResolve", secondId);
  const decreased = await settle(
    win,
    "window.decisionsBadgeScreen().badgeText === '1'",
    6_000,
  );
  // A frame's worth of slack, so a transient "arrived" would have been painted
  // and cleared rather than missed.
  await sleep(350);
  const afterDecrease = await screen(win);
  checks.afterDecrease = afterDecrease;
  claim(
    "a-decrease-updates-without-a-pulse",
    resolvedElsewhere === true &&
      decreased &&
      afterDecrease.badgePresent === true &&
      afterDecrease.badgeText === "1" &&
      afterDecrease.ariaLabel === "Decisions, 1 pending" &&
      afterDecrease.arrived !== "true" &&
      afterDecrease.arrivedClass === false &&
      afterDecrease.decisionListCalls > afterSecond.decisionListCalls,
    `resolved=${resolvedElsewhere} decreased=${decreased} badge=${afterDecrease.badgePresent} text=${JSON.stringify(afterDecrease.badgeText)} arrived=${JSON.stringify(afterDecrease.arrived)} class=${afterDecrease.arrivedClass} listCalls=${afterDecrease.decisionListCalls} (was ${afterSecond.decisionListCalls})`,
  );

  // ══ nothing pending: the badge leaves the rail ════════════════════════════
  const lastResolved = await call(win, "decisionsBadgeResolve", filedId);
  const emptied = await settle(
    win,
    "window.decisionsBadgeScreen().badgePresent === false",
    6_000,
  );
  const afterEmpty = await screen(win);
  checks.afterEmpty = afterEmpty;
  claim(
    "the-badge-disappears-when-nothing-is-pending",
    lastResolved === true &&
      emptied &&
      afterEmpty.badgePresent === false &&
      afterEmpty.ariaLabel === "Decisions" &&
      afterEmpty.title === "Decisions" &&
      afterEmpty.arrived !== "true" &&
      afterEmpty.decisionListCalls > afterDecrease.decisionListCalls,
    `resolved=${lastResolved} emptied=${emptied} badge=${afterEmpty.badgePresent} aria=${JSON.stringify(afterEmpty.ariaLabel)} title=${JSON.stringify(afterEmpty.title)} listCalls=${afterEmpty.decisionListCalls} (was ${afterDecrease.decisionListCalls})`,
  );

  // ══ and none of that rebuilt the rail ═════════════════════════════════════
  claim(
    "nothing-was-rebuilt-between-the-baseline-and-the-end",
    afterEmpty.mounts === before.mounts &&
      afterEmpty.nonce === before.nonce &&
      afterEmpty.sameLinkNode === true &&
      afterEmpty.linkToken === before.linkToken,
    `mounts=${afterEmpty.mounts} (was ${before.mounts}) nonce=${afterEmpty.nonce === before.nonce} sameLink=${afterEmpty.sameLinkNode} token=${afterEmpty.linkToken === before.linkToken}`,
  );

  // ══ the instrument is not lying to itself ═════════════════════════════════
  const harnessErrors = afterEmpty.harnessErrors;
  checks.harnessErrors = harnessErrors;
  checks.unexpectedBridgeCalls = afterEmpty.unexpected;
  claim(
    "the-page-asks-the-bridge-for-nothing-else",
    afterEmpty.unexpected.length === 0,
    `unexpected calls: ${JSON.stringify(afterEmpty.unexpected)}`,
  );
  checks.consoleErrors = consoleErrors;
  claim(
    "the-page-logs-no-errors",
    consoleErrors.length === 0 && harnessErrors.length === 0,
    `console errors: ${JSON.stringify(consoleErrors)} harness errors: ${JSON.stringify(harnessErrors)}`,
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
    path.join(artifactsDir, "decisions-badge.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const table = scenarios
    .map((scenario) => `  ${scenario.pass ? "ok  " : "FAIL"} ${scenario.name}`)
    .join("\n");
  console.log(`decisions-badge  ${passed}/${scenarios.length} claims held`);
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
  console.error("decisions-badge rig timed out");
  app.exit(1);
}, 150_000);
