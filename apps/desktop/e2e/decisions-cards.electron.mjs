/**
 * Drives the decisions-inbox card harness in a real Electron window and turns
 * what the page actually painted into `e2e/artifacts/decisions-cards.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node_modules/.bin/electron e2e/decisions-cards.electron.mjs
 *
 * Exit code 0 = every claim ran and held. The JSON report is the repeatable
 * artifact: the same command produces the same table, and the test file
 * (`tests/decisions-cards-e2e.test.ts`) is what asserts the claims by name.
 *
 * THE CLAIMS, AND THE MEASUREMENT THAT MAKES EACH ONE FALSIFIABLE
 *
 *  1. The card is not the sheet. The sheet panel paints `--card`; the card used
 *     to paint `--card` too, which is why the inbox read flat. The card's computed
 *     background is read against the panel's in the same frame, as both WCAG
 *     contrast and per-channel distance — flat is a number.
 *  2. The same holds in the light skin, not just the dark one. The harness is
 *     reopened with `?theme=light` and the same numbers are taken again.
 *  3. There is a diagonal wash at rest: a real `linear-gradient` in the card's
 *     `background-image`.
 *  4. Hovering sweeps a slash: the card's `::after` translateX is measured off
 *     one edge at rest and off the other while the pointer is on the card. The
 *     pointer is moved with `sendInputEvent`, so this is Chromium's `:hover`;
 *     `card.matches(":hover")` is reported as the proof the pointer arrived.
 *  5. Hover also shades the surface: the card's background and border colours
 *     change, and change back when the pointer leaves.
 *  6. The Pending pill is larger than the kind chip — font-size and painted
 *     height, both read from `getComputedStyle`/rects — and still sits in the
 *     card's top-right corner.
 *  7. The domain is a badge beside the Pending pill: its text is the domain's
 *     name (not its slug), it is the pill's immediately preceding sibling, it is
 *     on the same line, and a decision filed for no domain wears none.
 *  8. History's logged card wears its domain badge too.
 *  9. The page asks the bridge for nothing the stub does not answer, and logs no
 *     console error.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing transitions and hover: a rig beside every other rig has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const baseUrl =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/decisions-cards.html";
const SIZE = { width: 1280, height: 900 };

const errors = [];
const scenarios = [];
const screenshots = [];

function claim(name, pass, detail = null) {
  scenarios.push({ name, pass, detail: pass ? null : detail });
  if (!pass) errors.push(`${name}: ${detail ?? "failed"}`);
  return pass;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(win, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
        // The dev server can reload mid-wait (Vite re-optimising a new import);
        // that clears the harness globals and is "not ready yet", not a failure.
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
    await sleep(40);
  }
}

/** Call one of the harness's own globals, JSON-encoding its arguments. */
function call(win, name, ...args) {
  const encoded = args.map((arg) => JSON.stringify(arg)).join(", ");
  return win.webContents.executeJavaScript(`window.${name}(${encoded})`);
}

const screen = (win) => call(win, "decisionsCardsScreen");

async function shot(win, name) {
  // A hidden window paints asynchronously: a capture straight after a state
  // change reads the last composited frame, i.e. the state before it. Two
  // animation frames put the page's commit on the compositor, and the short
  // settle gives the capture a frame of its own.
  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
  );
  await sleep(150);
  const image = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, name), image.toPNG());
  screenshots.push(name);
  return name;
}

function pointAt(win, x, y) {
  win.webContents.sendInputEvent({
    type: "mouseMove",
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    clickCount: 1,
  });
}

const parkPointer = (win) => pointAt(win, 2, 2);

async function open(win, theme) {
  await win.loadURL(`${baseUrl}?theme=${theme}`);
  await waitFor(win, "Boolean(window.decisionsCardsReady)", "decisionsCardsReady");
  const drawn = await settle(
    win,
    'window.decisionsCardsScreen().cards.length === 3 && window.decisionsCardsScreen().activeTab === "Pending"',
  );
  if (!drawn) throw new Error(`the ${theme} inbox never drew three pending cards`);
  await sleep(160);
  return screen(win);
}

/** The one card with this id, or null. */
function cardIn(screenNow, id) {
  return screenNow.cards.find((card) => card.id === id) ?? null;
}

function centre(card) {
  return {
    x: Math.round(card.cardBox.left + card.cardBox.width / 2),
    y: Math.round(card.cardBox.top + card.cardBox.height / 2),
  };
}

/** The geometry claims both the pending and the logged card share. */
function domainBadgeHolds(card, expected) {
  if (!card.statusBox || card.domains.length !== expected.length) return false;
  if (!card.domainsImmediatelyBeforeStatus) return false;
  return expected.every((expectedChip, index) => {
    const chip = card.domains[index];
    if (!chip) return false;
    const gap = card.statusBox.left - chip.box.right;
    const chipCentre = chip.box.top + chip.box.height / 2;
    const statusCentre = card.statusBox.top + card.statusBox.height / 2;
    return (
      chip.text === expectedChip.name &&
      chip.slug === expectedChip.slug &&
      chip.text !== chip.slug &&
      gap >= 0 &&
      gap <= 14 &&
      Math.abs(chipCentre - statusCentre) <= 2
    );
  });
}

/**
 * The pointer's landing spot on a card: its top-left inside the frame.
 *
 * Not the centre — the list is taller than the sheet's scrollport, so the older
 * cards hang below the window and their centre is off-screen. The top-left is on
 * every card that is drawn at all, and it is still the card's own surface.
 */
function hoverPoint(card) {
  return {
    x: card.cardBox.left + 42,
    y: card.cardBox.top + 36,
  };
}

/** The first card the operator can actually point at: one whose top is on screen. */
function firstPointable(screenNow) {
  return (
    screenNow.cards.find(
      (card) => card.cardBox.top >= 0 && card.cardBox.top < SIZE.height - 80,
    ) ?? screenNow.cards[0]
  );
}

function domainDetail(card) {
  if (!card.statusBox) return `card ${card.id} has no status pill`;
  return card.domains
    .map((chip) => {
      const gap = card.statusBox.left - chip.box.right;
      const chipCentre = chip.box.top + chip.box.height / 2;
      const statusCentre = card.statusBox.top + card.statusBox.height / 2;
      return `${chip.text}/${chip.slug} gap=${gap} centreΔ=${(chipCentre - statusCentre).toFixed(1)}`;
    })
    .join("; ");
}

/** The painted shadow as far as a claim can read it: layers and their blur radii. */
function shadowInfo(value) {
  const px = [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) =>
    Number(match[1]),
  );
  const blurs = [];
  for (let index = 0; index + 3 < px.length; index += 4) {
    blurs.push(px[index + 2]);
  }
  return {
    none: value === "none",
    layers: blurs.length,
    maxBlur: blurs.length > 0 ? Math.max(...blurs) : 0,
  };
}

function surfaceDetail(screenNow) {
  const sheet = screenNow.sheet?.background ?? "?";
  return screenNow.cards
    .map(
      (card) =>
        `${card.id}: card=${card.background} sheet=${sheet} contrast=${card.contrastVsSheet} Δsheet=${card.channelDeltaVsSheet} Δcanvas=${card.channelDeltaVsCanvas}`,
    )
    .join(" | ");
}

async function main() {
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(SIZE.width, SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const checks = {};

  // ══ dark skin: the shipped surface ═════════════════════════════════════════
  const dark = await open(win, "dark");
  checks.dark = dark;
  checks.darkScreenshot = await shot(win, "decisions-cards-dark.png");

  claim(
    "the-card-wears-a-surface-different-from-its-sheet",
    dark.cards.length === 3 &&
      dark.sheet !== null &&
      dark.cards.every(
        (card) =>
          card.background !== dark.sheet.background &&
          card.contrastVsSheet >= 1.05 &&
          card.channelDeltaVsSheet >= 6 &&
          card.channelDeltaVsCanvas >= 5,
      ),
    surfaceDetail(dark),
  );

  claim(
    "the-card-carries-a-diagonal-shading-wash",
    dark.cards.every(
      (card) =>
        /linear-gradient/.test(card.backgroundImage) &&
        /linear-gradient/.test(card.sheenBackgroundImage),
    ),
    dark.cards
      .map((card) => `${card.id}: ${card.backgroundImage} / ${card.sheenBackgroundImage}`)
      .join(" | "),
  );
  claim(
    "the-card-is-grey-and-steps-up-off-the-sheet",
    dark.cards.every(
      (card) =>
        card.channelSpread <= 10 &&
        card.luminanceDeltaVsSheet > 0.01 &&
        card.contrastVsSheet >= 1.15,
    ),
    dark.cards
      .map(
        (card) =>
          `${card.id}: ${card.background} spread=${card.channelSpread} Δlum=${card.luminanceDeltaVsSheet} contrast=${card.contrastVsSheet}`,
      )
      .join(" | "),
  );
  claim(
    "the-card-casts-a-shadow-that-raises-it",
    dark.cards.every((card) => {
      const shadow = shadowInfo(card.boxShadow);
      return !shadow.none && shadow.layers >= 2 && shadow.maxBlur >= 8;
    }),
    dark.cards
      .map((card) => `${card.id}: ${card.boxShadow}`)
      .join(" | "),
  );

  // ══ hover: the slash sweeps, the surface shades ════════════════════════════
  const target = firstPointable(dark);
  if (!target) throw new Error("the inbox drew no card to point at");
  const targetPoint = hoverPoint(target);
  const rest = target;
  claim(
    "the-slash-waits-off-the-card-at-rest",
    (rest.sheenTranslateX ?? 0) < -100 && rest.hovered === false,
    `translateX=${rest.sheenTranslateX} hovered=${rest.hovered} card=${rest.cardBox.width}px at y=${rest.cardBox.top}`,
  );

  pointAt(win, targetPoint.x, targetPoint.y);
  const hovered = await settle(win, "window.decisionsCardsScreen().cards.some((card) => card.hovered)");
  // Mid-sweep is the moment the slash is visibly crossing the card; that is the
  // picture the operator can check the effect by.
  await shot(win, "decisions-cards-hover.png");
  await sleep(820);
  const hover = cardIn(await screen(win), target.id);
  checks.rest = rest;
  checks.hover = hover;
  claim(
    "hovering-really-lands-on-the-card",
    hovered && hover?.hovered === true,
    `hovered=${hovered} card :hover=${hover?.hovered} point=${JSON.stringify(targetPoint)}`,
  );
  claim(
    "hover-sweeps-the-slash-across-the-card",
    (rest.sheenTranslateX ?? 0) < -100 && (hover?.sheenTranslateX ?? 0) > 100,
    `card=${target.id} rest=${rest.sheenTranslateX} hover=${hover?.sheenTranslateX}`,
  );
  claim(
    "hover-reveals-a-diagonal-slash-of-shading",
    rest.slashOpacity === 0 &&
      /linear-gradient/.test(rest.slashBackgroundImage) &&
      (hover?.slashOpacity ?? 0) >= 0.5 &&
      /linear-gradient/.test(hover?.slashBackgroundImage ?? ""),
    `slash opacity ${rest.slashOpacity} → ${hover?.slashOpacity}; gradient ${hover?.slashBackgroundImage}`,
  );
  claim(
    "hover-shades-the-card-and-its-edge",
    hover !== null &&
      hover.background !== rest.background &&
      hover.borderTopColor !== rest.borderTopColor,
    `background ${rest.background} → ${hover?.background}; border ${rest.borderTopColor} → ${hover?.borderTopColor}`,
  );

  parkPointer(win);
  await sleep(900);
  const back = cardIn(await screen(win), target.id);
  checks.restAgain = back;
  claim(
    "leaving-the-card-puts-the-shading-back",
    back?.hovered === false &&
      back.background === rest.background &&
      back.borderTopColor === rest.borderTopColor &&
      back.slashOpacity === 0 &&
      (back.sheenTranslateX ?? 0) < -100,
    `hovered=${back?.hovered} background=${back?.background} slash=${back?.slashOpacity} translateX=${back?.sheenTranslateX}`,
  );

  // ══ the larger Pending pill, at the top right ══════════════════════════════
  const pendingCards = dark.cards.filter((card) => card.status === "pending");
  const pillHolds = pendingCards.every((card) => {
    if (!card.statusBox || !card.kindBox) return false;
    const gapRight = card.cardBox.right - card.statusBox.right;
    const gapTop = card.statusBox.top - card.cardBox.top;
    return (
      (card.statusFontSize ?? 0) >= 13 &&
      (card.kindFontSize ?? 99) + 2 <= (card.statusFontSize ?? 0) &&
      card.statusBox.height >= card.kindBox.height + 4 &&
      card.statusBox.height >= 22 &&
      gapRight >= 8 &&
      gapRight <= card.padding.right + 8 &&
      gapTop <= card.padding.top + 8
    );
  });
  claim(
    "the-pending-badge-is-larger-than-the-kind-chip",
    pendingCards.length === 3 && pillHolds,
    pendingCards
      .map(
        (card) =>
          `${card.id}: status ${card.statusFontSize}px h${card.statusBox?.height} vs kind ${card.kindFontSize}px h${card.kindBox?.height}`,
      )
      .join(" | "),
  );
  claim(
    "the-pending-badge-keeps-the-top-right-corner",
    pendingCards.every((card) => {
      if (!card.statusBox) return false;
      const gapRight = card.cardBox.right - card.statusBox.right;
      const gapTop = card.statusBox.top - card.cardBox.top;
      return gapRight <= card.padding.right + 8 && gapTop <= card.padding.top + 8;
    }),
    pendingCards
      .map((card) => {
        if (!card.statusBox) return `${card.id}: no pill`;
        return `${card.id}: right gap ${card.cardBox.right - card.statusBox.right}px, top gap ${card.statusBox.top - card.cardBox.top}px`;
      })
      .join(" | "),
  );

  const tallest = Math.max(...dark.cards.map((card) => card.cardBox.height));
  claim(
    "the-cards-are-condensed",
    dark.cards.length === 3 && tallest <= 380,
    `card heights ${dark.cards.map((card) => `${card.id}=${card.cardBox.height}px`).join(", ")} (tallest ${tallest}px)`,
  );
  claim(
    "two-full-cards-fit-on-the-sheet-without-scrolling",
    dark.sheetBody !== null && dark.fullyVisibleCards.length >= 2,
    `scrollport ${JSON.stringify(dark.sheetBody)}; fully visible ${JSON.stringify(dark.fullyVisibleCards)}`,
  );

  // ══ the answer buttons: bigger, rectangular, still rounded ══════════════════
  const buttonCards = pendingCards.filter((card) => card.buttons.length > 0);
  const buttonHolds = buttonCards.every((card) => {
    const labels = card.buttons.map((button) => button.label);
    const answersPresent = labels.includes("Approve") && labels.includes("Reject");
    // The amend feature adds a third control to an editable proposal. A pairing
    // Decision has nothing to correct and keeps the two answers. Every control
    // that is on the row is held to the same measure as the answers it sits by.
    const editRule =
      card.id === "decision-pairing"
        ? !labels.includes("Edit")
        : labels.includes("Edit");
    return (
      answersPresent &&
      editRule &&
      card.buttons.every(
        (button) =>
          button.box.height >= 40 &&
          button.box.width >= 110 &&
          button.fontSize >= 14.5 &&
          button.borderRadius >= 2 &&
          button.borderRadius <= 8 &&
          button.paddingX >= 16,
      )
    );
  });
  claim(
    "approve-and-reject-are-bigger-and-more-rectangular",
    buttonHolds,
    pendingCards
      .map(
        (card) =>
          `${card.id}: ${card.buttons
            .map(
              (button) =>
                `${button.label} ${button.box.width}x${button.box.height} r=${button.borderRadius} font=${button.fontSize}`,
            )
            .join(", ")}`,
      )
      .join(" | "),
  );

  // ══ the domain badge beside it ═════════════════════════════════════════════
  const financial = cardIn(dark, "decision-financial");
  const health = cardIn(dark, "decision-health");
  const pairing = cardIn(dark, "decision-pairing");
  const domainHolds =
    financial !== null &&
    health !== null &&
    domainBadgeHolds(financial, [{ name: "Financial", slug: "financial" }]) &&
    domainBadgeHolds(health, [{ name: "Health", slug: "health" }]);
  claim(
    "a-domain-badge-sits-beside-the-pending-badge",
    domainHolds,
    `financial: ${financial ? domainDetail(financial) : "missing"}; health: ${health ? domainDetail(health) : "missing"}`,
  );
  claim(
    "the-domain-badge-names-the-domain-not-its-slug",
    financial?.domains[0]?.text === "Financial" &&
      financial.domains[0]?.slug === "financial" &&
      health?.domains[0]?.text === "Health",
    `financial=${JSON.stringify(financial?.domains[0]?.text)} health=${JSON.stringify(health?.domains[0]?.text)}`,
  );
  claim(
    "a-domainless-decision-wears-no-domain-badge",
    pairing !== null && pairing.domains.length === 0,
    `pairing badges=${JSON.stringify(pairing?.domains.map((chip) => chip.text))}`,
  );

  // ══ the light skin: the surface is not one palette's accident ══════════════
  nativeTheme.themeSource = "light";
  const light = await open(win, "light");
  checks.light = light;
  checks.lightScreenshot = await shot(win, "decisions-cards-light.png");
  claim(
    "the-card-surface-holds-in-the-light-skin",
    light.theme === "light" &&
      light.cards.length === 3 &&
      light.sheet !== null &&
      light.cards.every(
        (card) =>
          card.background !== light.sheet.background &&
          card.contrastVsSheet >= 1.05 &&
          card.channelDeltaVsSheet >= 6 &&
          card.channelSpread <= 10 &&
          !shadowInfo(card.boxShadow).none,
      ),
    surfaceDetail(light),
  );
  claim(
    "the-larger-pending-badge-holds-in-the-light-skin",
    light.cards
      .filter((card) => card.status === "pending")
      .every((card) => (card.statusFontSize ?? 0) >= 13),
    light.cards.map((card) => `${card.id}: ${card.statusFontSize}`).join(" | "),
  );

  // ══ History: the logged card wears its domain too ═════════════════════════
  nativeTheme.themeSource = "dark";
  await open(win, "dark");
  await call(win, "decisionsCardsTab", "History");
  const manualDrawn = await settle(
    win,
    'window.decisionsCardsScreen().cards.some((card) => card.id === "manual-1")',
  );
  const history = await screen(win);
  checks.history = history;
  checks.historyScreenshot = await shot(win, "decisions-cards-history.png");
  const manual = cardIn(history, "manual-1");
  claim(
    "history-s-logged-card-wears-its-domain-badge",
    manualDrawn &&
      history.activeTab === "History" &&
      manual !== null &&
      manual.status === "Logged" &&
      domainBadgeHolds(manual, [{ name: "Financial", slug: "financial" }]),
    `drawn=${manualDrawn} tab=${JSON.stringify(history.activeTab)} manual: ${manual ? domainDetail(manual) : "missing"}`,
  );

  // ══ hygiene ════════════════════════════════════════════════════════════════
  const unexpected = await win.webContents.executeJavaScript(
    "window.decisionsCardsUnexpectedCalls",
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
    `${consoleErrors.length} console errors: ${consoleErrors.join("; ")}`,
  );

  checks.screenshots = screenshots;
  const passed = scenarios.filter((scenario) => scenario.pass).length;
  const report = {
    pass: errors.length === 0,
    failures: errors,
    claims: `${passed}/${scenarios.length}`,
    checks: { scenarios, ...checks },
  };

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "decisions-cards.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const table = scenarios
    .map((scenario) => `  ${scenario.pass ? "ok  " : "FAIL"} ${scenario.name}`)
    .join("\n");
  console.log(`decisions-cards  ${passed}/${scenarios.length} claims held`);
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
  console.error("decisions-cards rig timed out");
  app.exit(1);
}, 120_000);
