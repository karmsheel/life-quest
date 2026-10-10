/**
 * Drives the page-context rig and turns what the pill and the turn actually do
 * into `e2e/artifacts/page-context.{json,png}` plus `page-context-off.png`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/page-context.electron.mjs
 *
 * Exit code 0 = every claim held. The JSON report is the repeatable artifact:
 * same command, same claims, no eyeballing the app required.
 *
 * WHAT THIS RIG IS ABOUT
 *
 * The reported failure was a redundant offer: the companion proposed to build an
 * expense summary for a dashboard that was already showing one, because nothing
 * had told it what was on the screen. The fix is a pill beside the receipt
 * control that says which screen rides the next turn, and an instruction that
 * quotes that screen. This rig is about both halves and the join between them.
 *
 * What each claim rests on, and what would falsify it:
 *
 *  1. `the-pill-is-on-by-default` — landing on the Dashboard draws one pill,
 *     pressed, naming the screen the rail names it, wearing the "seeing" glyph.
 *     A pill that only appears once clicked fails here.
 *  2. `the-pill-sits-beside-the-attach-control` — the receipt control is still
 *     the first control of the composer's footer line, the pill is its immediate
 *     next sibling in that line, on the same row, and the attach control itself
 *     is untouched. Proven with `compareDocumentPosition` and measured boxes, so
 *     "beside" is a fact about the document and not about a screenshot.
 *  3. `clicking-the-pill-turns-it-off` — it is a toggle, not a one-way door: the
 *     pill stays on the line in its off state, unpressed, with the same name and
 *     the "not seeing" glyph. A control that vanished when used would fail here.
 *  4. `a-turn-sent-while-off-quotes-nothing` — the recorded turn has no
 *     `pageContext` key at all, and the instruction text main would post has no
 *     page block in it. This is the claim that the pill really gates the read.
 *  5. `walking-to-another-page-turns-it-back-on` — the off state does not survive
 *     navigation: the pill re-arms on arrival and names the new screen.
 *  6. `the-turn-carries-the-screen` — the turn sent from the Goals screen has a
 *     `pageContext` whose route and label are that screen's, whose body quotes
 *     that screen's heading, sentence, list and table, and whose built
 *     instruction carries the whole thing between the page markers.
 *  7. `the-outline-is-the-page-and-not-the-chrome` — the nav rail's own marker
 *     text, which is on screen the whole time, never reaches the body, and the
 *     body opens on the page's own heading. Without this the "read the screen"
 *     claim would also pass on a rig that quoted the entire document.
 *  8. `the-dashboard-says-what-is-already-there` — the reported failure, made
 *     falsifiable: back on the Dashboard, the turn quotes the existing expense
 *     card by name and its rendered weeks, and the instruction tells the model
 *     that what the block names already exists and to work with it rather than
 *     propose a duplicate. The same claim carries the two things the outline must
 *     not say: the card's own presentation picker — Metric, Table, Bar, Line — is
 *     an affordance, and quoted as content those four words read like four
 *     charts that are on the screen; and the heading's badge is joined with a
 *     space rather than welded into "OverviewUnlocked".
 *  9. `the-pill-survives-the-turns-it-sends` — three turns later the pill is
 *     still on and still naming the screen, so a turn does not quietly spend it.
 *
 * The bridge is a stub (a dev-server page has no preload), so this rig ends at
 * the recorded call and the instruction text built from it. What the gateway
 * does with that instruction is the same path `settings-agent` reads.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/page-context.html";
const DEFAULT_SIZE = { width: 1280, height: 1000 };

/** The chrome marker the harness paints into the rail, restated as a claim. */
const RAIL_MARKER = "RAIL-CHROME-MARKER";

/** The words this rig sends, so a reader can tell the turns apart in the log. */
const OFF_TURN = "What is on my screen?";
const GOALS_TURN = "Where are the goals up to?";
const DASHBOARD_TURN = "Add me an expense summary widget";

/**
 * The pill, the control beside it, and the page, in one pass.
 *
 * `follows` is a document-order bit rather than an index: "beside the attach
 * control" is a fact about the document, and an index into a child list is a
 * fact about markup. The row claim compares the two boxes' vertical spans, so a
 * pill that wrapped onto its own line is not "on the same row".
 */
const SAMPLE = `(() => {
  const pill = document.querySelector('[data-testid="chat-page-context"]');
  const label = pill ? pill.querySelector('[data-testid="chat-page-context-label"]') : null;
  const kind = pill ? pill.querySelector('.chat-panel__page-kind') : null;
  const attach = document.querySelector('.chat-panel__attach');
  const line = document.querySelector('.chat-panel__receipts');
  const root = document.querySelector('[data-page-context-root]');
  const follows = (a, b) => Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
  const glyph = (el) => {
    const svg = el ? el.querySelector('svg') : null;
    return svg ? [...svg.classList].join(' ') : null;
  };
  const pillBox = box(pill);
  const attachBox = box(attach);
  const heading = root ? root.querySelector('h1, h2, .home-card__title, .view-card__title') : null;
  return {
    path: window.pageContextPath ?? null,
    pill: pill ? {
      text: (pill.textContent || '').trim(),
      label: label ? (label.textContent || '').trim() : null,
      kind: kind ? (kind.textContent || '').trim() : null,
      state: pill.dataset.state ?? null,
      pressed: pill.getAttribute('aria-pressed'),
      aria: pill.getAttribute('aria-label'),
      title: pill.getAttribute('title'),
      type: pill.getAttribute('type'),
      svgs: pill.querySelectorAll('svg').length,
      icon: glyph(pill),
    } : null,
    attach: attach ? {
      label: attach.getAttribute('aria-label'),
      svgs: attach.querySelectorAll('svg').length,
      icon: glyph(attach),
    } : null,
    line: line ? { children: [...line.children].map((c) => c.className) } : null,
    inLine: Boolean(pill && line && pill.parentElement === line),
    attachBeforePill: follows(attach, pill),
    attachLeftOfPill: Boolean(pillBox && attachBox && pillBox.left >= attachBox.right - 1),
    sameRow: Boolean(pillBox && attachBox && attachBox.top < pillBox.bottom && pillBox.top < attachBox.bottom),
    pageHeading: heading ? (heading.textContent || '').trim() : null,
    railText: (document.querySelector('.nav-rail') || {}).textContent ?? null,
    calls: (window.__pageContextChatCalls ?? []).length,
  };
})()`;

const errors = [];
const scenarios = [];

function failure(message) {
  errors.push(message);
  return message;
}

function check(name, pass, detail) {
  scenarios.push({
    name,
    pass: Boolean(pass),
    detail: pass ? null : (detail ?? "failed"),
  });
  if (!pass) failure(`${name}: ${detail ?? "failed"}`);
  return Boolean(pass);
}

function waitFor(win, expression, label, timeoutMs = 10_000) {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sample = (win) => win.webContents.executeJavaScript(SAMPLE);
const calls = (win) =>
  win.webContents.executeJavaScript("window.__pageContextChatCalls ?? []");

/** The pill's own class list, as lucide writes it: "lucide lucide-eye". */
const isGlyph = (name, expected) =>
  typeof name === "string" && name.split(" ").includes(expected);

/** Type into the composer the way a keyboard would, then send the turn. */
async function send(win, text) {
  const before = (await calls(win)).length;
  await win.webContents.executeJavaScript(`(async () => {
    const el = document.querySelector('.chat-panel__composer-input');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const send = document.querySelector('.chat-panel__send');
    if (!send) return false;
    send.click();
    return true;
  })()`);
  await waitFor(
    win,
    `(window.__pageContextChatCalls ?? []).length > ${before}`,
    "the turn to be sent",
  );
  return (await calls(win))[before];
}

/** Click the pill, and let React commit the new state. */
async function togglePill(win) {
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="chat-page-context"]').click()`,
  );
  await sleep(80);
}

/** Walk the harness to another screen and wait for the pill to catch up. */
async function go(win, route) {
  await win.webContents.executeJavaScript(`window.pageContextGo(${JSON.stringify(route)})`);
  await waitFor(win, `window.pageContextPath === ${JSON.stringify(route)}`, `the ${route} route`);
  await sleep(80);
}

async function main() {
  const sessionPartition = `page-context-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionPartition,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await win.webContents.executeJavaScript("window.pageContextReady");
  await waitFor(
    win,
    "Boolean(document.querySelector('.chat-panel__composer-input'))",
    "the composer",
  );
  // The panel resumes the last chat asynchronously; without a session the field
  // is disabled and nothing can be sent.
  await waitFor(
    win,
    `!document.querySelector('.chat-panel__composer-input').disabled`,
    "the composer to be usable",
  );

  const checks = {};

  checks.skin = await win.webContents.executeJavaScript(
    "({ name: window.pageContextSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
  }

  // ── 1. on by default, and naming the screen ───────────────────────────────
  const landing = await sample(win);
  checks.landing = landing;
  check(
    "the-pill-is-on-by-default",
    landing.path === "/home" &&
      landing.pill !== null &&
      landing.pill.state === "on" &&
      landing.pill.pressed === "true" &&
      landing.pill.type === "button" &&
      landing.pill.label === "Dashboard" &&
      /^in context$/i.test(landing.pill.kind ?? "") &&
      landing.pill.svgs === 1 &&
      isGlyph(landing.pill.icon, "lucide-eye") &&
      !isGlyph(landing.pill.icon, "lucide-eye-off") &&
      /dashboard/i.test(landing.pill.aria ?? ""),
    `the landing pill read ${JSON.stringify(landing.pill)} on ${landing.path}`,
  );

  // ── 2. beside the receipt control, in its line ────────────────────────────
  check(
    "the-pill-sits-beside-the-attach-control",
    landing.attach !== null &&
      isGlyph(landing.attach.icon, "lucide-image-plus") &&
      landing.attach.label === "Attach a receipt" &&
      landing.inLine === true &&
      landing.attachBeforePill === true &&
      landing.attachLeftOfPill === true &&
      landing.sameRow === true,
    `attach ${JSON.stringify(landing.attach)}, inLine=${landing.inLine}, ` +
      `follows=${landing.attachBeforePill}, leftOf=${landing.attachLeftOfPill}, ` +
      `sameRow=${landing.sameRow}, line ${JSON.stringify(landing.line)}`,
  );

  // ── 3. it toggles, and stays where a toggle can be found again ────────────
  await togglePill(win);
  const off = await sample(win);
  checks.off = off.pill;
  check(
    "clicking-the-pill-turns-it-off",
    off.pill !== null &&
      off.pill.state === "off" &&
      off.pill.pressed === "false" &&
      off.pill.label === "Dashboard" &&
      /^off$/i.test(off.pill.kind ?? "") &&
      off.inLine === true &&
      off.attachBeforePill === true &&
      isGlyph(off.pill.icon, "lucide-eye-off"),
    `the pill read ${JSON.stringify(off.pill)} in line ${JSON.stringify(off.line)}`,
  );

  // ── 4. off means the turn quotes nothing ──────────────────────────────────
  const whileOff = await send(win, OFF_TURN);
  const offContext = whileOff?.instructionsContext ?? {};
  checks.offTurn = {
    hasKey: Object.prototype.hasOwnProperty.call(offContext, "pageContext"),
    pageContext: offContext.pageContext ?? "<absent>",
    quotes: /PAGE CONTEXT/.test(whileOff?.instructions ?? ""),
  };
  check(
    "a-turn-sent-while-off-quotes-nothing",
    checks.offTurn.hasKey === false && checks.offTurn.quotes === false,
    `the turn carried pageContext=${JSON.stringify(checks.offTurn.pageContext)} and its ` +
      `instruction ${checks.offTurn.quotes ? "still quoted the page" : "quoted nothing"}`,
  );

  // ── 5. walking away turns it back on, naming the new screen ───────────────
  await go(win, "/goals");
  const arrived = await sample(win);
  checks.arrived = arrived;
  check(
    "walking-to-another-page-turns-it-back-on",
    arrived.pill !== null &&
      arrived.pill.state === "on" &&
      arrived.pill.pressed === "true" &&
      arrived.pill.label === "Goals" &&
      arrived.pageHeading === "Goals" &&
      isGlyph(arrived.pill.icon, "lucide-eye"),
    `arriving on /goals left the pill ${JSON.stringify(arrived.pill)} over ` +
      `${JSON.stringify(arrived.pageHeading)}`,
  );

  // ── 6. the turn carries that screen ───────────────────────────────────────
  const goalsTurn = await send(win, GOALS_TURN);
  const goalsPage = goalsTurn?.instructionsContext?.pageContext ?? null;
  const goalsText = goalsTurn?.instructions ?? "";
  checks.goalsTurn = {
    pageContext: goalsPage,
    hasBlock: /--- PAGE CONTEXT \(untrusted, read-only, quoted from the operator's screen\) ---/
      .test(goalsText),
    hasEnd: /--- END PAGE CONTEXT ---/.test(goalsText),
  };
  const goalsBody = goalsPage?.body ?? "";
  const goalsQuoted = [
    "# Goals",
    "Three goals are live in this domain.",
    "- Run a half marathon",
    "[table] Progress: Goal | Progress",
    "- Run a half marathon | 62%",
  ];
  const missingGoals = goalsQuoted.filter((line) => !goalsBody.includes(line));
  check(
    "the-turn-carries-the-screen",
    goalsPage?.route === "/goals" &&
      goalsPage?.label === "Goals" &&
      missingGoals.length === 0 &&
      checks.goalsTurn.hasBlock === true &&
      checks.goalsTurn.hasEnd === true &&
      goalsText.includes(goalsBody),
    `the turn carried route=${JSON.stringify(goalsPage?.route)} ` +
      `label=${JSON.stringify(goalsPage?.label)} missing from the body ` +
      `${JSON.stringify(missingGoals)}; markers block=${checks.goalsTurn.hasBlock} ` +
      `end=${checks.goalsTurn.hasEnd}; body quoted in the instruction=${goalsText.includes(goalsBody)}`,
  );

  // ── 7. the outline is the page, not the chrome around it ──────────────────
  checks.chrome = {
    railText: (arrived.railText ?? "").trim(),
    bodyMentionsRail: goalsBody.includes(RAIL_MARKER),
    bodyMentionsComposer: /Message Hermes/.test(goalsBody),
    firstLine: goalsBody.split("\n")[0] ?? null,
  };
  check(
    "the-outline-is-the-page-and-not-the-chrome",
    checks.chrome.railText === RAIL_MARKER &&
      checks.chrome.bodyMentionsRail === false &&
      checks.chrome.bodyMentionsComposer === false &&
      checks.chrome.firstLine === "# Goals",
    `the rail said ${JSON.stringify(checks.chrome.railText)}; the body ` +
      `${checks.chrome.bodyMentionsRail ? "quoted it" : "did not quote it"} and ` +
      `read ${JSON.stringify(checks.chrome.firstLine)} first`,
  );

  // ── 8. back on the Dashboard: the turn says what is already there ─────────
  await go(win, "/home");
  await waitFor(
    win,
    `document.querySelector('[data-testid="chat-page-context"]').dataset.state === 'on'`,
    "the pill to re-arm on the Dashboard",
  );
  const backHome = await send(win, DASHBOARD_TURN);
  const dashPage = backHome?.instructionsContext?.pageContext ?? null;
  const dashText = backHome?.instructions ?? "";
  const dashBody = dashPage?.body ?? "";
  checks.dashboardTurn = {
    route: dashPage?.route ?? null,
    label: dashPage?.label ?? null,
    body: dashBody,
    namesTheCard: dashBody.includes("Weekly expenses"),
    namesTheFigures: dashBody.includes("2026-W38") && dashBody.includes("2026-W39"),
    // The card's own picker says "Metric | Table | Bar | Line". Those words are
    // affordances, not charts, and quoted into a turn they read like four
    // presentations that are on the screen — so a control's label must not be
    // there at all.
    noAffordances:
      !/^Metric$/m.test(dashBody) &&
      !/^Bar$/m.test(dashBody) &&
      !/^Line$/m.test(dashBody) &&
      !/^Lock$/m.test(dashBody),
    // The heading's badge is joined with a space rather than welded on.
    headingIsSpaced: /^# Overview Unlocked$/m.test(dashBody),
    saysAlreadyExists: /already exists on that screen/.test(dashText),
    saysNoDuplicate: /instead of proposing a duplicate/.test(dashText),
  };
  check(
    "the-dashboard-says-what-is-already-there",
    dashPage?.route === "/home" &&
      dashPage?.label === "Dashboard" &&
      checks.dashboardTurn.namesTheCard === true &&
      checks.dashboardTurn.namesTheFigures === true &&
      checks.dashboardTurn.noAffordances === true &&
      checks.dashboardTurn.headingIsSpaced === true &&
      checks.dashboardTurn.saysAlreadyExists === true &&
      checks.dashboardTurn.saysNoDuplicate === true,
    `the Dashboard turn read route=${JSON.stringify(checks.dashboardTurn.route)} ` +
      `label=${JSON.stringify(checks.dashboardTurn.label)} ` +
      `namesCard=${checks.dashboardTurn.namesTheCard} ` +
      `namesFigures=${checks.dashboardTurn.namesTheFigures} ` +
      `noAffordances=${checks.dashboardTurn.noAffordances} ` +
      `headingSpaced=${checks.dashboardTurn.headingIsSpaced} ` +
      `alreadyExists=${checks.dashboardTurn.saysAlreadyExists} ` +
      `noDuplicate=${checks.dashboardTurn.saysNoDuplicate}; body:\n${dashBody}`,
  );

  // ── 9. a turn does not spend the pill ─────────────────────────────────────
  const afterTurns = await sample(win);
  checks.afterTurns = afterTurns.pill;
  check(
    "the-pill-survives-the-turns-it-sends",
    afterTurns.pill !== null &&
      afterTurns.pill.state === "on" &&
      afterTurns.pill.label === "Dashboard" &&
      afterTurns.calls >= 3,
    `after ${afterTurns.calls} turn(s) the pill read ${JSON.stringify(afterTurns.pill)}`,
  );

  // ── nothing unexpected, nothing on fire ───────────────────────────────────
  const unexpected = await win.webContents.executeJavaScript(
    "window.pageContextUnexpectedCalls ?? null",
  );
  checks.unexpectedBridgeCalls = unexpected;
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  // ── the artifact ──────────────────────────────────────────────────────────
  // Two frames, because the pill has two states and a reader should see both:
  // the Dashboard with the screen in context, and the same pill turned off.
  await go(win, "/home");
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  const onShot = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "page-context-on.png"), onShot.toPNG());

  await togglePill(win);
  const offShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "page-context-off.png"), offShot.toPNG());

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks: { ...checks, scenarios },
  };
  fs.writeFileSync(
    path.join(artifactsDir, "page-context.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(
    `pill: default=${landing.pill?.state} label=${JSON.stringify(landing.pill?.label)} ` +
      `beside-attach=${landing.attachBeforePill} after-${afterTurns.calls}-turns=` +
      `${afterTurns.pill?.state}`,
  );
  console.log(
    `turns: off=${checks.offTurn.hasKey ? "carried the page" : "carried nothing"} ` +
      `goals=${JSON.stringify(checks.goalsTurn.pageContext?.label)} ` +
      `dashboard=${JSON.stringify(checks.dashboardTurn.label)}`,
  );
  console.log(
    `dashboard outline (${(checks.dashboardTurn.body ?? "").length} chars):\n` +
      `${checks.dashboardTurn.body ?? ""}`,
  );
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
  console.error("page-context rig timed out");
  app.exit(1);
}, 90_000);
