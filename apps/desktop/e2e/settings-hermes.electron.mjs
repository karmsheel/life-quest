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
  const byTestId = (id) => document.querySelector('[data-testid="' + id + '"]');
  const byTestIdText = (id) => {
    const el = byTestId(id);
    return el ? text(el) : null;
  };
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
  const content = document.querySelector(".settings-card") ||
    document.querySelector(".settings-overlay__main-scroll");
  const piCard = byTestId("vault-agent-pi");
  const hermesCard = byTestId("vault-agent-hermes");
  const sharedWarning = byTestId("vault-agent-shared-warning");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    order: ["hermes-doors", "hermes-connection", "vault-agents", "hermes-behaviour"]
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
    // The shipped "Agents in this vault" card: Pi always, Hermes bound or absent.
    vaultAgents: block("vault-agents")
      ? {
          box: blockBox("vault-agents"),
          pi: piCard
            ? {
                box: box(piCard),
                active: piCard.getAttribute("data-active") === "true",
                usePi: Boolean(byTestId("vault-agent-use-pi")),
              }
            : null,
          hermes: hermesCard
            ? {
                box: box(hermesCard),
                bound: hermesCard.getAttribute("data-bound") === "true",
                profile: byTestIdText("vault-agent-hermes-profile"),
                boundCopy: byTestIdText("vault-agent-hermes-bound"),
                emptyCopy: byTestIdText("vault-agent-hermes-empty"),
                active: Boolean(byTestId("vault-agent-hermes-active")),
                sharedWarning: sharedWarning ? text(sharedWarning) : null,
                useHermes: Boolean(byTestId("vault-agent-use-hermes")),
                change: Boolean(byTestId("vault-agent-change")),
                remove: Boolean(byTestId("vault-agent-remove-hermes")),
                create: Boolean(byTestId("vault-agent-create")),
                reuse: Boolean(byTestId("vault-agent-reuse")),
              }
            : null,
          notice: byTestIdText("vault-agent-notice"),
        }
      : null,
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
  const pageErrors = [];
  win.webContents.on("console-message", (event, level, message) => {
    const text =
      typeof event?.message === "string" ? event.message : typeof message === "string" ? message : "";
    const severity = typeof event?.level === "string" ? event.level : level;
    if (severity === "error" || (typeof severity === "number" && severity >= 3)) {
      pageErrors.push(String(text).slice(0, 500));
    }
  });
  /**
   * Wait for the harness page's ready promise, but never forever: a page that
   * throws before settling would otherwise hang the driver until the wrapper
   * kills it, and the report — the artifact this rig exists to write — would
   * never appear.
   */
  const waitHarnessReady = async (timeoutMs = 25_000) => {
    const ready = run("window.settingsHermesHarnessReady.then(() => true)");
    const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
    const outcome = await Promise.race([ready, timeout]);
    if (outcome !== "timeout") return;
    const body = await run(
      "(() => ({ text: document.body.innerText.slice(0, 1500), html: document.body.innerHTML.length, scripts: [...document.scripts].map((s) => s.src) }))()",
    ).catch(() => null);
    throw new Error(
      `the harness page never signalled ready; page errors: ${JSON.stringify(pageErrors)}; body: ${JSON.stringify(body)}`,
    );
  };

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

  const report = { pass: false, failures, states: {}, screenshots, pageErrors };

  try {
    await win.loadURL(url);
    await waitHarnessReady();
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

    // ── 3. "Agents in this vault": Pi always, the bound agent named ─────
    const contentWidth = opened.content.box?.width ?? opened.viewport.width;
    const agents = opened.vaultAgents;
    check(
      "the Agents in this vault section is on the page",
      Boolean(agents),
      `section ${JSON.stringify(agents)}`,
    );
    check(
      "Pi is always offered and is not the active agent while the vault runs Hermes",
      agents?.pi?.active === false && agents?.pi?.usePi === true,
      `pi ${JSON.stringify(agents?.pi)}`,
    );
    check(
      "the bound Hermes agent names its profile and reads Bound to this vault",
      agents?.hermes?.bound === true &&
        agents?.hermes?.profile === "brook" &&
        /bound to this vault/i.test(agents?.hermes?.boundCopy ?? ""),
      `hermes ${JSON.stringify(agents?.hermes)}`,
    );
    check(
      "the bound agent is marked active and offers Change/Remove, not Use Hermes",
      agents?.hermes?.active === true &&
        agents?.hermes?.useHermes === false &&
        agents?.hermes?.change === true &&
        agents?.hermes?.remove === true,
      `hermes ${JSON.stringify(agents?.hermes)}`,
    );
    check(
      "a profile another vault already uses carries the shared-memory warning",
      /other vault/i.test(agents?.hermes?.sharedWarning ?? "") &&
        /memory, skills and knowledge are shared/i.test(agents?.hermes?.sharedWarning ?? ""),
      `warning ${JSON.stringify(agents?.hermes?.sharedWarning)}`,
    );
    check(
      "the agent card does not widen the page",
      (agents?.box?.width ?? Infinity) <= contentWidth + 1 && (agents?.box?.height ?? 0) > 0,
      `card ${JSON.stringify(agents?.box)} of ${contentWidth}px`,
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

    // ── 5. Remove from this vault reaches the bridge and falls back to Pi ─
    const clicked = await run(
      `(() => {
        const el = document.querySelector('[data-testid="vault-agent-remove-hermes"]');
        if (!el) return false;
        el.click();
        return true;
      })()`,
    );
    check("Remove from this vault could be clicked", clicked, "no remove control");
    const removed = await settle();
    check(
      "the removal reached vaultAgentsRemoveHermes",
      removed.calls.removeHermes === 1,
      `bridge saw ${JSON.stringify(removed.calls.removeHermes)}`,
    );
    check(
      "the vault falls back to Pi after the removal",
      removed.vaultAgents?.pi?.active === true && removed.vaultAgents?.hermes?.bound === false,
      `agents ${JSON.stringify(removed.vaultAgents)}`,
    );
    check(
      "the empty card says the vault has no Hermes agent and offers both ways to add one",
      /this vault has no hermes agent/i.test(removed.vaultAgents?.hermes?.emptyCopy ?? "") &&
        removed.vaultAgents?.hermes?.create === true &&
        removed.vaultAgents?.hermes?.reuse === true,
      `hermes ${JSON.stringify(removed.vaultAgents?.hermes)}`,
    );

    screenshots.push(await shot("removed"));

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
      // The vault is on Pi after the removal, so the Hermes connection facts
      // have given way to the built-in endpoint form; the doors' two remain.
      Boolean(off.vaultAgents) && off.facts.length >= 2,
      `agents ${JSON.stringify(off.vaultAgents)}, ${off.facts.length} facts`,
    );

    // ── 7. a door that failed to bind keeps its own error, in place ─────
    await win.loadURL(`${url}?doorsError=1`);
    await waitHarnessReady();
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
      removed,
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
      ["state", "facts", "agents", "fact line Δ", "switch", "door error"],
      [
        "opened",
        String(opened.facts.length),
        String(opened.vaultAgents ? 1 : 0),
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
