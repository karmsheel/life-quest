/**
 * Drives the chat panel harness in a real Electron window and turns the
 * transcript's behaviour while the composer grows into
 * `e2e/artifacts/transcript-anchor.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/transcript-anchor.electron.mjs
 *
 * The page is loaded with `?longthread=1&longchain=1`, so both of the dock's
 * transcripts are long enough to scroll. That is the whole point: the
 * two-message fixture cannot show a bottom edge being kept, because nothing in
 * it can move.
 *
 * The reported bug, stated as the failure modes this rig exists to catch:
 *
 *  1. The composer grows over the transcript. The dock's column is a flex
 *     column — header, transcript, composer, action bar — so a taller composer
 *     takes its height from the transcript above it (the border does move up).
 *     What went wrong is the transcript's own `scrollTop`: the flex layout
 *     shrinks the scroll port, the browser leaves the scroll offset alone
 *     (nothing in the content changed), and the last thing the operator was
 *     reading slides below the new bottom edge. To them the composer grew *over*
 *     the chat. Asserted by the distance between the scrolled-to end and the
 *     port's bottom, and by the last row's box against the port's box.
 *  2. The border does not actually move. If the composer grew downward instead
 *     of taking height from the transcript, the composer's box would no longer
 *     start one gutter below the transcript's bottom edge.
 *  3. Growth is paid for by the wrong pane. The dock's column is fixed by the
 *     shell's grid track; a step that moved the panel outside it is the old "the
 *     dock grows past the window" fault, not this one.
 *  4. The end is not kept while the field is capped. Half the panel is the cap;
 *     a capped composer is the most extreme growth step and the one a long
 *     paste produces.
 *  5. Shrinking loses the end. Clearing the draft gives the transcript its room
 *     back; the port must stay at its end rather than floating a blank strip
 *     under the last row.
 *  6. Reading scrollback is yanked to the live turn. An operator who scrolled up
 *     and then types must keep the words they were reading exactly where they
 *     are: the correction belongs to transcripts that were already at their end.
 *  7. Only the thread is covered. Quick Notes is the dock's second surface with
 *     the same composer idiom and the same flex column: its newest signal has to
 *     keep sitting just above its composer, through the same growth and the same
 *     cap. A watch wired to one ref and not the other would keep cutting the
 *     chain off and this is where that shows.
 *  8. The watch dies across a surface swap. Leaving Quick Notes for the thread
 *     remounts nothing (both bodies stay mounted) but rebinds the visible one;
 *     the end has to be kept again immediately.
 *  9. The watch dies across collapse and reopen. Collapsing unmounts the whole
 *     dock body and reopening mounts a fresh transcript; the watch has to follow
 *     the new node instead of holding the detached one.
 *
 * The IPC bridge, the session, both transcripts and the chain are stubbed/driven
 * from here; the real ChatPanel, the real CSS and the real layout engine are
 * shipping code.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/chat-panel.html?longthread=1&longchain=1";

// Each rig gets its own Electron profile: the panel remembers the last chat it
// opened in localStorage, and a shared profile makes one rig start on another
// rig's session.
const userDataDir = path.join(artifactsDir, "userdata", "transcript-anchor");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };

/** Matches ChatPanel: the composer may take half the panel before it scrolls. */
const CAP_RATIO = 0.5;
const CAP_FLOOR_PX = 72;

/**
 * How near the transcript's end still counts as "the operator is reading the
 * end". The dock's own correction uses the same slack, so a rig reading beyond
 * it would be asserting something the panel does not claim.
 */
const END_SLACK_PX = 8;

const lines = (n) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

/**
 * One read of the dock's column: the visible transcript (thread or chain), its
 * port and scroll offset, the last row's box against it, and the composer's box
 * below. `surface` names which transcript the numbers describe.
 */
const SAMPLE = `(() => {
  const body = document.querySelector(".chat-panel__body:not([hidden])");
  const footer = document.querySelector(".chat-panel__footer");
  // The thread composer is a box around field and controls; the chain composer
  // is the older one-row idiom (the field wears the ring itself). Either way,
  // this is the element whose top edge is the border the transcript pushes up.
  const box =
    document.querySelector(".chat-panel__composer-box") ??
    document.querySelector(".chat-panel__composer-row");
  const field = document.querySelector(".chat-panel__composer-input");
  const panel = document.querySelector(".chat-panel");
  if (!body || !footer || !box || !field || !panel) return null;
  const rows = body.querySelectorAll(".chat-panel__message, .chat-panel__chain-item");
  const last = rows[rows.length - 1] ?? null;
  const bodyRect = body.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const lastRect = last ? last.getBoundingClientRect() : null;
  const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
  return {
    surface: body.classList.contains("chat-panel__body--chain") ? "chain" : "thread",
    rows: rows.length,
    bodyClientHeight: body.clientHeight,
    bodyScrollHeight: body.scrollHeight,
    scrollTop: Math.round(body.scrollTop),
    maxScroll: Math.round(maxScroll),
    distanceFromBottom: Math.round(maxScroll - body.scrollTop),
    atEnd: maxScroll - body.scrollTop <= ${END_SLACK_PX},
    fieldHeight: field.offsetHeight,
    fieldInlineHeight: field.style.height || null,
    footerHeight: footer.offsetHeight,
    footerPaddingTop: Math.round(parseFloat(getComputedStyle(footer).paddingTop) || 0),
    panelTop: Math.round(panelRect.top),
    panelBottom: Math.round(panelRect.bottom),
    panelHeight: panel.clientHeight,
    transcriptBottom: Math.round(bodyRect.bottom),
    composerTop: Math.round(boxRect.top),
    composerBottom: Math.round(boxRect.bottom),
    composerGap: Math.round(boxRect.top - bodyRect.bottom),
    lastRowBottom: lastRect ? Math.round(lastRect.bottom) : null,
    lastRowGap: lastRect ? Math.round(bodyRect.bottom - lastRect.bottom) : null,
    lastRowVisible: lastRect
      ? lastRect.top < bodyRect.bottom && lastRect.bottom > bodyRect.top
      : false,
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const waitFor = async (expression, label, timeoutMs = 10_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await run(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  /**
   * The transcript in front is loaded, at its end, and has enough rows to
   * overflow. Both fixtures are long; a swapped-in surface can take a beat.
   */
  const waitForEndOfTranscript = async (surface, label) => {
    await waitFor(
      `(() => {
        const body = document.querySelector(".chat-panel__body:not([hidden])");
        if (!body) return false;
        const isChain = body.classList.contains("chat-panel__body--chain");
        if (isChain !== ${surface === "chain"}) return false;
        const rows = body.querySelectorAll(".chat-panel__message, .chat-panel__chain-item");
        if (rows.length < 20) return false;
        return body.scrollHeight - body.clientHeight - body.scrollTop <= ${END_SLACK_PX};
      })()`,
      label,
    );
  };

  const timeout = setTimeout(() => {
    console.error("transcript-anchor: timed out after 90s");
    app.exit(1);
  }, 90_000);

  let report;
  let step = "load";
  try {
    step = "load the harness";
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");

    // Fixed content size so the panel height — and so the cap and the port's
    // height — is a known quantity rather than whatever the WM decided.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    // The transcript arrives from the stubbed bridge after the page paints, and
    // the panel's own pin-to-the-newest pass lands it at its end. Wait for that
    // state instead of assuming a number of frames.
    step = "wait for the long thread";
    await waitForEndOfTranscript("thread", "the long thread to load at its end");

    /** Set the composer's draft the way a keystroke does, then let layout settle. */
    const setDraft = async (text, label) => {
      step = label;
      const sample = await run(`(async () => {
        const el = document.querySelector(".chat-panel__composer-input");
        if (!el) return null;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        // Three frames: React's layout effect, the dock's own correction, then a
        // beat for the ResizeObserver delivery and the shell's settling.
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))))
        );
        return ${SAMPLE};
      })()`);
      if (!sample) throw new Error(`the composer disappeared during "${label}"`);
      return sample;
    };

    /** A scroll the operator could have made, left to settle. */
    const scrollTo = async (where, label) => {
      step = label;
      const sample = await run(`(async () => {
        const body = document.querySelector(".chat-panel__body:not([hidden])");
        if (!body) return null;
        body.scrollTop =
          ${where === "end" ? "body.scrollHeight" : "Math.round((body.scrollHeight - body.clientHeight) / 2)"};
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)))
        );
        return ${SAMPLE};
      })()`);
      if (!sample) throw new Error(`the transcript disappeared during "${label}"`);
      return sample;
    };

    const click = async (selector, label) => {
      step = label;
      const clicked = await run(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`could not click ${label} (${selector})`);
      // The gesture's own render and effects need a beat before the next read.
      await new Promise((resolve) => setTimeout(resolve, 120));
    };

    const screenshot = async (name) => {
      const file = path.join(artifactsDir, `transcript-anchor-${name}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      return file;
    };

    const rest = await setDraft("", "rest the thread composer");
    const restShot = await screenshot("rest");
    const capPx = Math.max(
      Math.round(rest.panelHeight * CAP_RATIO),
      CAP_FLOOR_PX,
    );

    // The fixture has to actually overflow, or none of the checks below mean
    // anything: a port that cannot scroll has no end to keep.
    check(
      "the transcript overflows its port",
      rest.surface === "thread" &&
        rest.rows >= 40 &&
        rest.bodyScrollHeight > rest.bodyClientHeight + 200,
      `${rest.rows} rows on the ${rest.surface} in ${rest.bodyScrollHeight}px of content / ${rest.bodyClientHeight}px port`,
    );
    check(
      "the transcript starts at its end",
      rest.atEnd,
      `${rest.distanceFromBottom}px from the end at rest`,
    );

    // A little growth — under the cap, the ordinary "a long paragraph" case.
    const mid = await setDraft(lines(8), "grow the thread composer");
    check(
      "the composer grew",
      mid.fieldHeight > rest.fieldHeight + 40 && mid.footerHeight > rest.footerHeight + 40,
      `field ${rest.fieldHeight}px → ${mid.fieldHeight}px, composer ${rest.footerHeight}px → ${mid.footerHeight}px`,
    );
    check(
      "the transcript kept its end while the composer grew",
      mid.atEnd,
      `${mid.distanceFromBottom}px from the end after the composer grew to ${mid.fieldHeight}px`,
    );
    check(
      "the border moved up rather than the composer growing over the transcript",
      // The composer's box still starts one footer gutter under the transcript's
      // bottom edge: the transcript gave the height up, the composer did not
      // paint over the last line.
      Math.abs(mid.composerGap - mid.footerPaddingTop) <= 1 &&
        mid.composerGap === rest.composerGap,
      `composer ${mid.composerGap}px below the transcript (rest ${rest.composerGap}px, gutter ${mid.footerPaddingTop}px)`,
    );
    check(
      "the last turn is on screen, not clipped by the composer",
      mid.lastRowVisible && mid.lastRowBottom <= mid.transcriptBottom + 1,
      `last row bottom ${mid.lastRowBottom}px against transcript bottom ${mid.transcriptBottom}px`,
    );
    check(
      "the transcript's port gave the height to the composer",
      mid.transcriptBottom < rest.transcriptBottom - 40,
      `transcript bottom ${rest.transcriptBottom}px → ${mid.transcriptBottom}px`,
    );

    // The cap: half the panel, the tallest the composer gets, from a paste.
    const cappedText = lines(60);
    const capped = await setDraft(cappedText, "cap the thread composer");
    const cappedShot = await screenshot("grown");
    check(
      "the composer sits on its cap",
      Math.abs(capped.fieldHeight - capPx) <= 1,
      `${capped.fieldHeight}px against the ${capPx}px cap for a ${capped.panelHeight}px panel`,
    );
    check(
      "the transcript keeps its end under the tallest composer",
      capped.atEnd,
      `${capped.distanceFromBottom}px from the end at the cap`,
    );
    check(
      "the last turn stays clear of the tallest composer",
      capped.lastRowVisible && capped.lastRowBottom <= capped.transcriptBottom + 1,
      `last row bottom ${capped.lastRowBottom}px against transcript bottom ${capped.transcriptBottom}px`,
    );
    // The dock's column is fixed by the shell's grid track: growth moves the
    // border, never the dock off its track. Measured against the panel's own
    // box, not the viewport: the panel deliberately overhangs the window by the
    // shell's frame.
    check(
      "the tallest composer stays inside the dock's column",
      capped.composerTop >= capped.panelTop - 1 &&
        capped.composerBottom <= capped.panelBottom + 1,
      `composer ${capped.composerTop}px–${capped.composerBottom}px in the panel ` +
        `${capped.panelTop}px–${capped.panelBottom}px`,
    );

    // Clearing the draft gives the transcript its room back. The port must stay
    // at its end instead of leaving a blank strip under the last turn.
    const cleared = await setDraft("", "clear the thread composer");
    check(
      "clearing the draft keeps the transcript at its end",
      cleared.atEnd,
      `${cleared.distanceFromBottom}px from the end after the composer shrank back to ${cleared.fieldHeight}px`,
    );

    // The guard: an operator reading scrollback types without being dragged to
    // the live turn. Scroll to the middle, grow the composer to its cap, and the
    // reading position must not move by a pixel.
    const scrolled = await scrollTo("middle", "scroll the thread to the middle");
    check(
      "the rig is reading scrollback, not the end",
      !scrolled.atEnd && scrolled.distanceFromBottom > 100,
      `${scrolled.distanceFromBottom}px from the end after scrolling to the middle`,
    );

    const grownWhileReading = await setDraft(cappedText, "grow over a reader");
    check(
      "reading scrollback is not yanked to the live turn",
      Math.abs(grownWhileReading.scrollTop - scrolled.scrollTop) <= 1 &&
        !grownWhileReading.atEnd,
      `scrollTop ${scrolled.scrollTop}px → ${grownWhileReading.scrollTop}px while the composer grew`,
    );

    // Back to the end: a scroll to the end is the operator's own movement, and
    // shrinking the composer must not lose it.
    const settled = await scrollTo("end", "scroll back to the thread end");
    check(
      "scrolling back to the end re-arms the pin",
      settled.atEnd,
      `${settled.distanceFromBottom}px from the end after scrolling to it`,
    );
    const back = await setDraft("", "shrink the thread composer");
    check(
      "the end survives the composer shrinking again",
      back.atEnd,
      `${back.distanceFromBottom}px from the end after the composer shrank`,
    );

    // ── Quick Notes: the dock's second transcript, same composer idiom ────────
    await click('button[aria-label="Quick Notes"]', "Quick Notes");
    await waitForEndOfTranscript("chain", "the long chain to load at its end");
    const chainRest = await setDraft("", "rest the chain composer");
    check(
      "the chain overflows its port",
      chainRest.surface === "chain" &&
        chainRest.rows >= 20 &&
        chainRest.bodyScrollHeight > chainRest.bodyClientHeight + 200,
      `${chainRest.rows} signals on the ${chainRest.surface} in ${chainRest.bodyScrollHeight}px of content / ${chainRest.bodyClientHeight}px port`,
    );
    check(
      "the chain starts at its end",
      chainRest.atEnd,
      `${chainRest.distanceFromBottom}px from the chain's end at rest`,
    );
    const chainGrown = await setDraft(lines(40), "grow the chain composer");
    const chainShot = await screenshot("chain");
    check(
      "the chain composer grew to its cap",
      Math.abs(chainGrown.fieldHeight - capPx) <= 1,
      `${chainGrown.fieldHeight}px against the ${capPx}px cap`,
    );
    check(
      "the chain keeps its end under the tallest composer",
      chainGrown.atEnd,
      `${chainGrown.distanceFromBottom}px from the chain's end at the cap`,
    );
    check(
      "the newest signal stays clear of the chain composer",
      chainGrown.lastRowVisible &&
        chainGrown.lastRowBottom <= chainGrown.transcriptBottom + 1,
      `last signal bottom ${chainGrown.lastRowBottom}px against chain bottom ${chainGrown.transcriptBottom}px`,
    );
    check(
      "the chain composer keeps the border, not the signal",
      Math.abs(chainGrown.composerGap - chainGrown.footerPaddingTop) <= 1 &&
        chainGrown.transcriptBottom < chainRest.transcriptBottom - 40,
      `composer ${chainGrown.composerGap}px below the chain (gutter ${chainGrown.footerPaddingTop}px); ` +
        `chain bottom ${chainRest.transcriptBottom}px → ${chainGrown.transcriptBottom}px`,
    );
    const chainCleared = await setDraft("", "clear the chain composer");
    check(
      "clearing the chain draft keeps the chain at its end",
      chainCleared.atEnd,
      `${chainCleared.distanceFromBottom}px from the chain's end after the composer shrank`,
    );

    // ── Back to the thread: the watch re-binds to the surface in front ────────
    await click(".chats-rail__row-main", "the first chat in the sidebar");
    await waitForEndOfTranscript("thread", "the thread to come back at its end");
    const recovered = await setDraft(lines(30), "grow the thread composer after the surface swap");
    check(
      "the thread keeps its end after a surface swap",
      recovered.surface === "thread" && recovered.atEnd,
      `${recovered.distanceFromBottom}px from the end after returning from Quick Notes`,
    );
    await setDraft("", "clear after the surface swap");

    // ── Collapse and reopen: the watch has to follow the new transcript ───────
    await click('[data-testid="chat-collapse"]', "collapse the dock");
    await waitFor(
      `Boolean(document.querySelector('[data-testid="chat-launcher"]'))`,
      "the collapsed dock's launcher",
    );
    await click('[data-testid="chat-launcher"]', "the dock launcher");
    await waitFor(
      `Boolean(document.querySelector(".chat-panel__composer-input"))`,
      "the reopened dock's composer",
    );
    await waitForEndOfTranscript("thread", "the reopened thread at its end");
    const reopened = await setDraft("", "reopen the dock");
    check(
      "the reopened dock starts with the transcript at its end",
      reopened.atEnd,
      `${reopened.distanceFromBottom}px from the end after reopening the dock`,
    );
    const reopenedGrown = await setDraft(lines(30), "grow the reopened composer");
    check(
      "the watch still keeps the end after the dock was reopened",
      reopenedGrown.atEnd && reopenedGrown.lastRowVisible,
      `${reopenedGrown.distanceFromBottom}px from the end after the composer grew to ` +
        `${reopenedGrown.fieldHeight}px on the reopened dock`,
    );
    await setDraft("", "clear the reopened composer");

    // The dock's column never moved through any of it, on either surface: one
    // panel height for the whole run.
    check(
      "the panel height never moved",
      [
        mid,
        capped,
        cleared,
        grownWhileReading,
        settled,
        back,
        chainGrown,
        chainCleared,
        recovered,
        reopened,
        reopenedGrown,
      ].every((s) => s.panelHeight === rest.panelHeight),
      `${rest.panelHeight}px → ${mid.panelHeight}px → ${capped.panelHeight}px`,
    );
    const settledShot = await screenshot("settled");

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      capRatio: CAP_RATIO,
      capPx,
      endSlackPx: END_SLACK_PX,
      rest,
      mid,
      capped,
      cleared,
      scrolled: { scrollTop: scrolled.scrollTop, distanceFromBottom: scrolled.distanceFromBottom },
      grownWhileReading,
      settled,
      back,
      chainRest,
      chainGrown,
      chainCleared,
      recovered,
      reopened,
      reopenedGrown,
      screenshots: [restShot, cappedShot, chainShot, settledShot],
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failedAt: step,
      failures: [...failures, `threw at "${step}": ${error instanceof Error ? error.message : String(error)}`],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "transcript-anchor.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = [
    ["rest", report.rest],
    ["mid", report.mid],
    ["capped", report.capped],
    ["cleared", report.cleared],
    ["grown-while-reading", report.grownWhileReading],
    ["back", report.back],
    ["chain-rest", report.chainRest],
    ["chain-grown", report.chainGrown],
    ["chain-cleared", report.chainCleared],
    ["recovered", report.recovered],
    ["reopened", report.reopened],
    ["reopened-grown", report.reopenedGrown],
  ]
    .filter(([, sample]) => sample)
    .map(([step, s]) => [
      step,
      s.surface,
      `${s.fieldHeight}px`,
      `${s.footerHeight}px`,
      `${s.bodyClientHeight}px`,
      `${s.scrollTop}px`,
      `${s.distanceFromBottom}px`,
      s.lastRowGap == null ? "-" : `${s.lastRowGap}px`,
    ]);
  const header = [
    "step",
    "surface",
    "field",
    "composer",
    "port",
    "scrollTop",
    "from end",
    "end gap",
  ];
  const widths = header.map((_, i) =>
    Math.max(header[i].length, ...rows.map((row) => row[i].length)),
  );
  const format = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(format(row));
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "transcript anchor: PASS" : "transcript anchor: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`transcript-anchor: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
