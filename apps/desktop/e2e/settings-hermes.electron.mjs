/**
 * Drives the Settings → Hermes page in a real Electron window and turns the
 * measurements into `e2e/artifacts/settings-hermes.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/settings-hermes.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * The complaint this rig answers: the Hermes page was an imbalanced stack —
 * each fact's name above its value, the profile picker a column of full-width
 * bars, the filing preference a raw checkbox, and the MCP doors at the bottom
 * of the page. The page now leads with the doors, sets each fact on one line,
 * offers short selectable profile cards, and switches the filing preference.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/settings-hermes.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const SAMPLE = `(() => {
  const round = (value) => Math.round(value);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: round(r.left), top: round(r.top), right: round(r.right),
      bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const block = (id) => document.querySelector('[data-testid="' + id + '"]');
  const blockBox = (id) => box(block(id));
  const list = document.querySelector(".companion-profile-list");
  const columns = list
    ? getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length
    : 0;
  const cards = Array.from(
    document.querySelectorAll(".companion-profile-list .companion-profile-row")
  );
  const facts = Array.from(document.querySelectorAll(".settings-fact")).map((row) => {
    const label = row.querySelector(".settings-fact__label");
    const value = row.querySelector(".settings-fact__value");
    return {
      label: text(label),
      value: text(value),
      labelBox: box(label),
      valueBox: box(value),
      error: text(row.querySelector(".settings-fact__error")) || null,
    };
  });
  const toggle = document.querySelector('[role="switch"]');
  const create = document.querySelector(".companion-profile-row--create");
  const content = document.querySelector(".settings-card") ||
    document.querySelector(".settings-overlay__main-scroll");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    order: ["hermes-doors", "hermes-connection", "hermes-profile", "hermes-behaviour"]
      .map((id) => ({ id, box: blockBox(id) })),
    firstBlock: text((document.querySelector(".settings-hermes__block .settings-hermes__heading") || { textContent: "" })),
    facts,
    toggle: toggle
      ? {
          checked: toggle.getAttribute("aria-checked"),
          disabled: toggle.disabled === true,
          box: box(toggle),
          role: toggle.getAttribute("role"),
        }
      : null,
    checkboxCount: document.querySelectorAll('input[type="checkbox"]').length,
    cards: cards.map((card) => ({
      label: card.getAttribute("aria-label"),
      checked: card.getAttribute("aria-checked"),
      disabled: card.disabled === true,
      inUse: text(card.querySelector(".companion-profile-row__in-use")) || null,
      desc: text(card.querySelector(".companion-profile-row__desc")),
      tag: text(card.querySelector(".companion-profile-row__tag")) || null,
      avatar: text(card.querySelector(".companion-profile-row__avatar")) || null,
      box: box(card),
    })),
    create: create
      ? {
          label: create.getAttribute("aria-label"),
          checked: create.getAttribute("aria-checked"),
          inUse: text(create.querySelector(".companion-profile-row__in-use")) || null,
          desc: text(create.querySelector(".companion-profile-row__desc")),
          box: box(create),
        }
      : null,
    listColumns: columns,
    content: { box: box(content) },
    sheet: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
    calls: JSON.parse(JSON.stringify(window.settingsHermesCalls || {})),
    doorsError: text(document.querySelector('[data-testid="hermes-doors"] [role="alert"]')) || null,
  };
})()`;

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};

async function main() {
  // Paint in the theme the app defaults to, so a rig run is not a white sheet
  // flashing across the screen.
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

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 280) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  const screenshots = [];
  const shot = async (name) => {
    // Give the compositor a beat: a hidden window commits frames on its own
    // schedule, and an immediate capture can hand back the paint before the
    // last state change (an error landing, a card being marked).
    await new Promise((resolve) => setTimeout(resolve, 180));
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `settings-hermes-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return path.basename(file);
  };

  const report = { pass: false, failures, states: {}, screenshots };

  try {
    await win.loadURL(url);
    await run("window.settingsHermesHarnessReady.then(() => true)");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const opened = await settle();

    // ── 1. the doors lead the page, above the profile choice ─────────────
    const order = opened.order;
    check(
      "the page has its four blocks",
      order.every((entry) => entry.box),
      `blocks ${JSON.stringify(order.map((entry) => [entry.id, entry.box]))}`,
    );
    check(
      "MCP doors are the first block",
      order[0]?.id === "hermes-doors" && opened.firstBlock === "MCP doors",
      `first block reads "${opened.firstBlock}"`,
    );
    check(
      "the doors sit above the companion profile cards",
      (order[0]?.box?.top ?? Infinity) < (order[2]?.box?.top ?? -Infinity) &&
        (order[0]?.box?.bottom ?? Infinity) <= (order[2]?.box?.top ?? -Infinity),
      `doors ${JSON.stringify(order[0]?.box)} vs profile ${JSON.stringify(order[2]?.box)}`,
    );
    check(
      "the doors sit above the connection block too",
      (order[0]?.box?.top ?? Infinity) < (order[1]?.box?.top ?? -Infinity),
      `doors ${JSON.stringify(order[0]?.box)} vs connection ${JSON.stringify(order[1]?.box)}`,
    );

    // ── 2. every name/value pair is one line ─────────────────────────────
    check(
      "all five facts are on the page",
      opened.facts.length === 5,
      `facts ${JSON.stringify(opened.facts.map((f) => f.label))}`,
    );
    for (const fact of opened.facts) {
      const labelY = fact.labelBox ? (fact.labelBox.top + fact.labelBox.bottom) / 2 : -1;
      const valueY = fact.valueBox ? (fact.valueBox.top + fact.valueBox.bottom) / 2 : -1;
      check(
        `"${fact.label}" has a value`,
        (fact.value ?? "").length > 0,
        `value reads "${fact.value}"`,
      );
      check(
        `"${fact.label}" and its value share a line`,
        Math.abs(labelY - valueY) <= 2,
        `label centre ${labelY}px, value centre ${valueY}px`,
      );
      check(
        `"${fact.label}" sits left of its value`,
        (fact.valueBox?.left ?? -1) >= (fact.labelBox?.right ?? Infinity),
        `label ends ${fact.labelBox?.right}px, value starts ${fact.valueBox?.left}px`,
      );
    }

    // ── 3. the catalog is short cards, not page-wide bars ───────────────
    const contentWidth = opened.content.box?.width ?? opened.viewport.width;
    check(
      "the profile choice is a grid",
      opened.listColumns >= 2,
      `${opened.listColumns} column(s)`,
    );
    check(
      "there is a card per installed profile and one to create the app's own",
      opened.cards.length === 3 && opened.create !== null,
      `cards ${JSON.stringify(opened.cards.map((card) => card.label))}, create ${JSON.stringify(opened.create?.label)}`,
    );
    for (const card of opened.cards) {
      check(
        `"${card.label}" is a short card, not a full-width bar`,
        (card.box?.width ?? contentWidth) <= contentWidth * 0.5,
        `card ${card.box?.width}px of ${contentWidth}px`,
      );
      check(
        `"${card.label}" is short enough to read at a glance`,
        (card.box?.height ?? 999) <= 72,
        `card ${card.box?.height}px tall`,
      );
      check(
        `"${card.label}" has an avatar and the profile's path`,
        (card.avatar ?? "").length > 0 && /\.hermes/.test(card.desc ?? ""),
        `avatar "${card.avatar}", desc "${card.desc}"`,
      );
    }
    check(
      "the default card is marked as the default",
      opened.cards[0]?.tag === "default" &&
        opened.cards.slice(1).every((card) => card.tag === null),
      `tags ${JSON.stringify(opened.cards.map((card) => card.tag))}`,
    );
    check(
      "the create card is the one in use while the app is on lifequest",
      opened.create?.checked === "true" && opened.create?.inUse === "In use",
      `checked ${opened.create?.checked}, mark ${opened.create?.inUse}`,
    );
    check(
      "no installed profile claims to be in use",
      opened.cards.every((card) => card.checked === "false" && card.inUse === null),
      `cards ${JSON.stringify(opened.cards.map((card) => [card.label, card.checked, card.inUse]))}`,
    );

    screenshots.push(await shot("opened"));

    // ── 4. the filing preference is a switch, not a checkbox ────────────
    check(
      "the page has no native checkbox",
      opened.checkboxCount === 0,
      `${opened.checkboxCount} checkbox input(s)`,
    );
    check(
      "the filing preference is a switch, on",
      opened.toggle?.role === "switch" && opened.toggle?.checked === "true",
      `toggle ${JSON.stringify(opened.toggle)}`,
    );

    // ── 5. choosing a profile reaches the bridge and marks the card ─────
    const clicked = await run(
      `(() => {
        const el = document.querySelector('.companion-profile-row[aria-label="Use the brook profile"]');
        if (!el) return false;
        el.click();
        return true;
      })()`,
    );
    check("a profile card could be clicked", clicked, "no brook card");
    const picked = await settle();
    check(
      "the choice reached companionUseProfile",
      JSON.stringify(picked.calls.useProfile) === JSON.stringify(["brook"]),
      `bridge saw ${JSON.stringify(picked.calls.useProfile)}`,
    );
    check(
      "the chosen card reads In use",
      picked.cards.find((card) => card.label === "Use the brook profile")?.inUse === "In use" &&
        picked.cards.find((card) => card.label === "Use the brook profile")?.checked === "true",
      `cards ${JSON.stringify(picked.cards.map((card) => [card.label, card.checked, card.inUse]))}`,
    );
    check(
      "the create card is no longer marked",
      picked.create?.checked !== "true" && picked.create?.inUse === null,
      `create ${JSON.stringify(picked.create)}`,
    );

    screenshots.push(await shot("picked"));

    // ── 6. the switch writes, and reads back its new state ──────────────
    const toggled = await run(
      `(() => {
        const el = document.querySelector('[role="switch"]');
        if (!el) return false;
        el.click();
        return true;
      })()`,
    );
    check("the switch could be pressed", toggled, "no switch");
    const off = await settle();
    check(
      "the switch reached companionSetFiling with false",
      JSON.stringify(off.calls.filing) === JSON.stringify([false]),
      `bridge saw ${JSON.stringify(off.calls.filing)}`,
    );
    check(
      "the switch reads off after the press",
      off.toggle?.checked === "false",
      `aria-checked is ${off.toggle?.checked}`,
    );
    check(
      "the rest of the page survives the press",
      off.cards.length === 3 && off.facts.length === 5,
      `${off.cards.length} cards, ${off.facts.length} facts`,
    );

    // ── 7. a door that failed to bind keeps its own error, in place ─────
    await win.loadURL(`${url}?doorsError=1`);
    await run("window.settingsHermesHarnessReady.then(() => true)");
    const failedDoor = await settle(360);
    const invite = failedDoor.facts.find((fact) => fact.label === "Invite");
    check(
      "a failed door keeps its own error under its row",
      invite?.error === "Port 8646 is already in use.",
      `invite error ${JSON.stringify(invite?.error)}, doorsError ${JSON.stringify(failedDoor.doorsError)}`,
    );
    check(
      "the other door keeps its value while one fails",
      failedDoor.facts.find((fact) => fact.label === "Local")?.value ===
        "http://127.0.0.1:8643/mcp",
      `local value ${JSON.stringify(failedDoor.facts.find((fact) => fact.label === "Local")?.value)}`,
    );
    check(
      "a door error does not push the name off its value's line",
      (() => {
        const labelY = invite?.labelBox
          ? (invite.labelBox.top + invite.labelBox.bottom) / 2
          : -1;
        const valueY = invite?.valueBox
          ? (invite.valueBox.top + invite.valueBox.bottom) / 2
          : -2;
        return Math.abs(labelY - valueY) <= 2;
      })(),
      `invite label/value boxes ${JSON.stringify([invite?.labelBox, invite?.valueBox])}`,
    );

    // ── 8. nothing widens the page ──────────────────────────────────────
    check(
      "a long profile path truncates instead of widening the page",
      failedDoor.sheet.scrollWidth <= failedDoor.sheet.clientWidth + 1,
      `scrollWidth ${failedDoor.sheet.scrollWidth}px vs clientWidth ${failedDoor.sheet.clientWidth}px`,
    );

    screenshots.push(await shot("door-error"));

    report.states = {
      opened,
      picked,
      off,
      failedDoor,
    };

    report.pass = failures.length === 0;
  } catch (error) {
    report.failures = [
      ...failures,
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    ];
    report.pass = false;
  }

  const reportFile = path.join(artifactsDir, "settings-hermes.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const opened = report.states.opened;
  if (opened) {
    const table = [
      ["state", "facts", "cards", "columns", "fact line Δ", "switch", "door error"],
      [
        "opened",
        String(opened.facts.length),
        String(opened.cards.length),
        String(opened.listColumns),
        String(
          Math.max(
            ...opened.facts.map((fact) => {
              const labelY = (fact.labelBox?.top ?? 0) + (fact.labelBox?.height ?? 0) / 2;
              const valueY = (fact.valueBox?.top ?? 0) + (fact.valueBox?.height ?? 0) / 2;
              return Math.abs(labelY - valueY);
            }),
          ),
        ),
        String(opened.toggle?.checked),
        String(opened.doorsError),
      ],
    ];
    const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
    for (const row of table) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
    console.log("");
  }

  console.log(`report: ${reportFile}`);
  for (const failure of report.failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "settings hermes: PASS" : "settings hermes: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`settings-hermes: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
