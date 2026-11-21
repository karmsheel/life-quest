/**
 * Drives the chat-panel harness with a reply that ends in a
 * `lifequest-decision` fence, and turns the result into
 * `e2e/artifacts/chat-decision-fence.{json,png}`.
 *
 * Run with the dev server up:
 *
 *   LIFEQUEST_E2E_URL="http://127.0.0.1:5175/e2e/chat-panel.html?decisionfence=1" \
 *     ../../node_modules/.bin/electron e2e/chat-decision-fence.electron.mjs
 *
 * The claim: the fence is a wire format main parses and files, so it must stay
 * in the stored message — and must not be read as prose in the bubble. It shows
 * as one line reading `DECISION:` and what the proposal changes, closed by
 * default, opening to the proposal's own text.
 *
 * The ways this can fail, written down before the assertions:
 *
 *  1. The JSON is still on screen — the fence renders as text, which is the
 *     report this rig exists for (`kind`, `domainSlugs`, backticks).
 *  2. No card — the fence is stripped at render time instead of hidden, so the
 *     reply no longer says a decision is waiting.
 *  3. Wrong label — the line does not read `DECISION:`.
 *  4. Wrong description — the summary is the raw body, a JSON fragment, or a
 *     generic word rather than what the proposal changes.
 *  5. Open at rest — the card starts expanded, which is the wall of JSON again.
 *  6. Dead toggle — a click does not open it, or opening does not show the body.
 *  7. The body lands outside its card, or above the line it belongs to.
 *  8. The reply's prose is lost — the sentence before the fence disappears.
 *  9. Copy loses the proposal — the copy control must still carry the whole
 *     message, fence included, because that text is what main parses.
 * 10. The collapsed line is not one line high (wrapping JSON pushed into the
 *     summary, so the card is a paragraph again).
 *
 * The real ChatPanel, the real CSS and the real layout engine are shipping code;
 * only the IPC bridge is stubbed, by the harness page.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, nativeTheme } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html?decisionfence=1";

const userDataDir = path.join(artifactsDir, "userdata", "chat-decision-fence");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };
const EXPECTED_SUMMARY = "Library note — Project rule — build at level 2 dev by default";
const PROSE_OPENING = "Two things came out of the week";

/** One read of the reply that carries the fence. */
const SAMPLE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      width: Math.round(r.width), height: Math.round(r.height)
    };
  };
  const rows = Array.from(document.querySelectorAll(".chat-panel__message"));
  const row = rows.find((el) => el.querySelector("[data-testid='chat-decision-fence']"));
  if (!row) {
    return {
      found: false,
      bubbleTexts: rows.map((el) => (el.querySelector(".chat-panel__message-content")?.textContent ?? "").trim())
    };
  }
  const content = row.querySelector(".chat-panel__message-content");
  const cards = Array.from(row.querySelectorAll("[data-testid='chat-decision-fence']"));
  return {
    found: true,
    bubbleText: (content?.textContent ?? "").trim(),
    proseText: (() => {
      const withoutCards = content.cloneNode(true);
      withoutCards.querySelectorAll("[data-testid='chat-decision-fence']").forEach((el) => el.remove());
      return (withoutCards.textContent ?? "").trim();
    })(),
    cardCount: cards.length,
    cards: cards.map((card) => {
      const line = card.querySelector(".chat-panel__decision-line");
      const kicker = card.querySelector(".chat-panel__decision-kicker");
      const summary = card.querySelector("[data-testid='chat-decision-summary']");
      const body = card.querySelector("[data-testid='chat-decision-body']");
      const style = getComputedStyle(summary ?? card);
      return {
        kicker: kicker ? kicker.textContent.trim() : null,
        summary: summary ? summary.textContent.trim() : null,
        ariaExpanded: line ? line.getAttribute("aria-expanded") : null,
        bodyPresent: Boolean(body),
        bodyText: body ? body.textContent.trim() : null,
        box: box(card),
        lineBox: box(line),
        bodyBox: box(body),
        summaryLineHeightPx: style.lineHeight,
        summaryWhiteSpace: style.whiteSpace,
        summaryTruncated: summary ? summary.scrollWidth > summary.clientWidth + 1 : null
      };
    })
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);
  const waitFor = async (expression, label, timeoutMs = 8_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await run(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  const timeout = setTimeout(() => {
    console.error("chat-decision-fence: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();
    win.webContents.focus();

    // ── At rest: hidden, one line, closed ─────────────────────────────────
    const initial = await run(SAMPLE);
    check(
      "the reply carrying the fence rendered a card",
      initial.found,
      `bubbles ${JSON.stringify(initial.bubbleTexts)}`,
    );

    const card = initial.cards?.[0];
    if (card) {
      check(
        "the fence's JSON is not on screen",
        !/lifequest-decision|domainSlugs|"kind"/.test(initial.bubbleText),
        `bubble text ${JSON.stringify(initial.bubbleText.slice(0, 240))}`,
      );
      check("exactly one card for one fence", initial.cardCount === 1, `${initial.cardCount} cards`);
      check("the line is labelled DECISION:", card.kicker === "DECISION:", JSON.stringify(card.kicker));
      check(
        "the line describes what the proposal changes",
        card.summary === EXPECTED_SUMMARY,
        JSON.stringify(card.summary),
      );
      check("the card starts closed", card.ariaExpanded === "false", `aria-expanded ${card.ariaExpanded}`);
      check("no body at rest", !card.bodyPresent, `body text ${JSON.stringify(card.bodyText)}`);
      check(
        "the reply's prose is still shown",
        initial.proseText.startsWith(PROSE_OPENING),
        JSON.stringify(initial.proseText.slice(0, 120)),
      );
      check(
        "the collapsed line is one row high",
        card.lineBox && card.lineBox.height <= 34,
        `line ${card.lineBox?.height}px tall, ${card.lineBox?.width}px wide`,
      );
      check(
        "the card sits above the bubble's foot, not outside it",
        card.box && card.box.bottom <= (initial.cards?.[0]?.box?.bottom ?? Infinity),
        JSON.stringify(card.box),
      );
    }

    const shotClosed = path.join(artifactsDir, "chat-decision-fence-closed.png");
    fs.writeFileSync(shotClosed, (await win.webContents.capturePage()).toPNG());

    // ── Opened by the operator ────────────────────────────────────────────
    await run(`document.querySelector("[data-testid='chat-decision-fence'] .chat-panel__decision-line").click()`);
    await waitFor(
      `document.querySelector("[data-testid='chat-decision-fence'] .chat-panel__decision-line")?.getAttribute("aria-expanded") === "true"`,
      "the card to open",
    );
    await new Promise((resolve) => setTimeout(resolve, 120));

    const opened = await run(SAMPLE);
    const openCard = opened.cards?.[0];
    if (openCard) {
      check(
        "opening shows the proposal's own text",
        openCard.bodyPresent && /"kind"\s*:\s*"library"/.test(openCard.bodyText ?? ""),
        JSON.stringify((openCard.bodyText ?? "").slice(0, 160)),
      );
      check(
        "the body sits under its line",
        openCard.lineBox && openCard.bodyBox && openCard.bodyBox.top >= openCard.lineBox.bottom - 1,
        `body top ${openCard.bodyBox?.top}px, line bottom ${openCard.lineBox?.bottom}px`,
      );
      check(
        "the body stays inside its card",
        openCard.bodyBox &&
          openCard.box &&
          openCard.bodyBox.left >= openCard.box.left - 1 &&
          openCard.bodyBox.right <= openCard.box.right + 1,
        `body ${JSON.stringify(openCard.bodyBox)} card ${JSON.stringify(openCard.box)}`,
      );
    }

    // ── Copy keeps the whole message, fence included ──────────────────────
    await clipboard.writeText("sentinel");
    await run(
      `Array.from(document.querySelectorAll(".chat-panel__message"))
        .find((el) => el.querySelector("[data-testid='chat-decision-fence']"))
        .querySelector(".chat-panel__message-copy").click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const copied = await clipboard.readText();
    check(
      "copy still carries the proposal text",
      copied.includes("lifequest-decision") && copied.includes("Project rule"),
      JSON.stringify(copied.slice(0, 160)),
    );

    // ── The toggle closes again ───────────────────────────────────────────
    await run(`document.querySelector("[data-testid='chat-decision-fence'] .chat-panel__decision-line").click()`);
    await waitFor(
      `document.querySelector("[data-testid='chat-decision-fence'] .chat-panel__decision-line")?.getAttribute("aria-expanded") === "false"`,
      "the card to close",
    );

    const shot = path.join(artifactsDir, "chat-decision-fence.png");
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());

    const report = {
      pass: failures.length === 0,
      failures,
      atRest: initial,
      opened: opened.cards ?? [],
      clipboardHead: copied.slice(0, 200),
      shots: { closed: shotClosed, thread: shot },
    };

    const reportFile = path.join(artifactsDir, "chat-decision-fence.json");
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`cards: ${initial.cardCount ?? 0}`);
    console.log(`report: ${reportFile}`);
    console.log(`shot: ${shot}`);
    for (const failure of failures) console.log(`FAIL ${failure}`);
    console.log(report.pass ? "chat decision fence: PASS" : "chat decision fence: FAIL");

    clearTimeout(timeout);
    app.exit(report.pass ? 0 : 1);
  } catch (error) {
    clearTimeout(timeout);
    console.error(`chat-decision-fence: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  }
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-decision-fence: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
