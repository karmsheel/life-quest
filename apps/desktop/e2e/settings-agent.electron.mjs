/**
 * Drives the settings-agent harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/settings-agent.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/settings-agent.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims, no eyeballing the app required.
 *
 * NOT covered here: whether the profile on disk really holds what the page
 * shows. The rig answers from a stubbed bridge, so it asserts what the page DOES
 * with the payload it is handed. The reading half — a real profile directory, a
 * real SOUL.md, real SKILL.md files — is `tests/agent-prompts-e2e.test.ts`'s.
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
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/settings-agent.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const SAMPLE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const soul = document.querySelector('[data-testid="agent-soul-text"]');
  const instructions = document.querySelector('[data-testid="agent-instructions-text"]');
  const sheet = document.querySelector(".shell__content");
  const skills = Array.from(document.querySelectorAll('[data-testid="agent-skill"]'));
  const tools = document.querySelectorAll(".settings-prompt__tool, .settings-prompt button");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    hasSection: Boolean(document.querySelector('[data-testid="agent-soul"]')),
    soul: soul
      ? {
          text: text(soul),
          box: box(soul),
          color: getComputedStyle(soul).color,
          scrollHeight: soul.scrollHeight,
          clientHeight: soul.clientHeight,
          scrollWidth: soul.scrollWidth,
          clientWidth: soul.clientWidth,
          whiteSpace: getComputedStyle(soul).whiteSpace,
          overflowY: getComputedStyle(soul).overflowY,
          fontFamily: getComputedStyle(soul).fontFamily,
        }
      : null,
    soulBadge: text(document.querySelector('[data-testid="agent-soul-origin"]')),
    instructions: instructions
      ? { text: text(instructions), box: box(instructions) }
      : null,
    skillCount: Number(text(document.querySelector('[data-testid="agent-skill-count"]')) || "0"),
    skillRows: skills.map((row) => ({
      name: row.getAttribute("data-skill"),
      text: text(row),
      description: text(row.querySelector(".settings-skill__desc")),
      path: text(row.querySelector(".settings-skill__path")),
    })),
    sheetScrollWidth: sheet ? sheet.scrollWidth : null,
    sheetClientWidth: sheet ? sheet.clientWidth : null,
    copyButtons: tools.length,
    contextFields: Array.from(document.querySelectorAll(".settings-hermes .settings-field span")).map(text)
  };
})()`;

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};

async function main() {
  // The rig opens a real window on the operator's desktop: paint it in the theme
  // the app itself defaults to so a test run is not a white sheet flashing across
  // the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 220 ms hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 260) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `settings-agent-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return path.basename(file);
  };

  const report = { pass: false, failures, states: {}, screenshots };

  try {
    await win.loadURL(url);
    await run("window.settingsAgentHarnessReady");
    const seeded = await settle();

    // ── 1. the page answers the question at all ──────────────────────────
    check("the section rendered", seeded.hasSection, "no [data-testid=agent-soul] in the page");
    check(
      "the system prompt is on the page",
      (seeded.soul?.text ?? "").includes("LifeQuest companion"),
      `soul text starts "${(seeded.soul?.text ?? "").slice(0, 60)}"`,
    );
    check(
      "the per-turn instructions are on the page",
      (seeded.instructions?.text ?? "").includes("Active domain"),
      `instructions start "${(seeded.instructions?.text ?? "").slice(0, 60)}"`,
    );

    // ── 2. what is shown is the prompt, not a seed of its own ────────────
    check(
      "the page shows the profile's own words",
      (seeded.soul?.text ?? "").includes("pre-paired") &&
        (seeded.soul?.text ?? "").includes("MAKING A CARD"),
      "the seeded prompt body does not match the payload it was handed",
    );
    check(
      "the seeded badge names the seed",
      seeded.soulBadge === "LifeQuest seed",
      `badge reads "${seeded.soulBadge}"`,
    );

    // ── 3. the prompt body is readable ───────────────────────────────────
    check(
      "the prompt body has real height",
      (seeded.soul?.box?.height ?? 0) > 40,
      `body is ${seeded.soul?.box?.height}px tall`,
    );
    check(
      "the prompt body is not transparent",
      !/rgba\(0, 0, 0, 0\)/.test(seeded.soul?.color ?? ""),
      `body colour is ${seeded.soul?.color}`,
    );
    check(
      "a long prompt scrolls rather than clipping",
      (seeded.soul?.scrollHeight ?? 0) <= (seeded.soul?.clientHeight ?? 0) ||
        ["auto", "scroll"].includes(seeded.soul?.overflowY ?? ""),
      `scrollHeight ${seeded.soul?.scrollHeight} clientHeight ${seeded.soul?.clientHeight} overflow-y ${seeded.soul?.overflowY}`,
    );
    check(
      "the prompt is set in a monospace face",
      /mono/i.test(seeded.soul?.fontFamily ?? ""),
      `font-family is ${seeded.soul?.fontFamily}`,
    );

    // ── 4. a long unbroken token does not widen the page ─────────────────
    check(
      "a long prompt wraps instead of widening the sheet",
      (seeded.sheetScrollWidth ?? 0) <= (seeded.sheetClientWidth ?? 0) + 1,
      `sheet scrollWidth ${seeded.sheetScrollWidth} vs clientWidth ${seeded.sheetClientWidth}`,
    );
    check(
      "the prompt body itself does not overflow sideways",
      (seeded.soul?.scrollWidth ?? 0) <= (seeded.soul?.clientWidth ?? 0) + 1,
      `body scrollWidth ${seeded.soul?.scrollWidth} vs clientWidth ${seeded.soul?.clientWidth}`,
    );

    // ── 5. the instructions carry the board and the lock ─────────────────
    check(
      "the instructions name the board in view",
      (seeded.instructions?.text ?? "").includes('financial dashboard (domainSlug: "financial")'),
      "the board line is missing from the instructions panel",
    );
    check(
      "the instructions say whether the board is locked",
      /UNLOCKED/.test(seeded.instructions?.text ?? ""),
      "the lock line is missing from the instructions panel",
    );
    check(
      "the context summary is on the page",
      seeded.contextFields.includes("Dashboard board") && seeded.contextFields.includes("Domain lens"),
      `context fields are ${JSON.stringify(seeded.contextFields)}`,
    );

    // ── 6. the skill library is listed, described, and counted ───────────
    check(
      "every skill has a row",
      seeded.skillRows.length === 3,
      `listed ${seeded.skillRows.length} skills, expected 3`,
    );
    check(
      "the count badge agrees with the rows",
      seeded.skillCount === seeded.skillRows.length,
      `badge says ${seeded.skillCount}, ${seeded.skillRows.length} rows`,
    );
    check(
      "LifeQuest's own skill is first",
      seeded.skillRows[0]?.name === "lifequest-dashboard-scripting",
      `first row is ${seeded.skillRows[0]?.name}`,
    );
    for (const row of seeded.skillRows) {
      check(
        `"${row.name}" is listed with a description`,
        (row.description ?? "").length > 10,
        `description reads "${row.description}"`,
      );
      check(
        `"${row.name}" has a path to open`,
        /SKILL\.md$/.test(row.path ?? ""),
        `path reads "${row.path}"`,
      );
    }
    check(
      "the used skills say how often",
      (seeded.skillRows.find((r) => r.name === "lifequest-mcp")?.text ?? "").includes("used 7"),
      `row reads "${seeded.skillRows.find((r) => r.name === "lifequest-mcp")?.text}"`,
    );
    check(
      "the unused skill says so",
      (seeded.skillRows.find((r) => r.name === "arxiv")?.text ?? "").includes("not used yet"),
      `row reads "${seeded.skillRows.find((r) => r.name === "arxiv")?.text}"`,
    );
    check("the page offers a Copy control", seeded.copyButtons >= 2, `${seeded.copyButtons} buttons found`);

    screenshots.push(await shot("seeded"));

    // ── 7. the operator's own words are reported as theirs ───────────────
    await run("window.settingsAgentSetPayload(window.settingsAgentEditedPayload)");
    const edited = await settle(360);
    check(
      "the edited profile's own words are shown",
      (edited.soul?.text ?? "").includes("Never use emoji"),
      `soul text is "${(edited.soul?.text ?? "").slice(0, 60)}"`,
    );
    check(
      "the badge says the operator wrote it",
      edited.soulBadge === "Edited by you",
      `badge reads "${edited.soulBadge}"`,
    );
    check(
      "the skill list follows the payload",
      edited.skillRows.length === 2 && edited.skillCount === 2,
      `${edited.skillRows.length} rows, badge ${edited.skillCount}`,
    );
    screenshots.push(await shot("edited"));

    report.states = { seeded, edited };
    report.pass = failures.length === 0;
  } catch (error) {
    report.failures = [
      ...failures,
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    ];
    report.pass = false;
  }

  const reportFile = path.join(artifactsDir, "settings-agent.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const seeded = report.states.seeded;
  if (seeded) {
    const table = [
      ["state", "prompt chars", "instructions chars", "skills", "sheet overflow", "badge"],
      [
        "seeded",
        String((seeded.soul?.text ?? "").length),
        String((seeded.instructions?.text ?? "").length),
        String(seeded.skillRows.length),
        String((seeded.sheetScrollWidth ?? 0) - (seeded.sheetClientWidth ?? 0)),
        seeded.soulBadge,
      ],
      [
        "edited",
        String((report.states.edited?.soul?.text ?? "").length),
        String((report.states.edited?.instructions?.text ?? "").length),
        String(report.states.edited?.skillRows.length ?? 0),
        String(
          (report.states.edited?.sheetScrollWidth ?? 0) -
            (report.states.edited?.sheetClientWidth ?? 0),
        ),
        report.states.edited?.soulBadge,
      ],
    ];
    const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
    for (const row of table) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
    console.log("");
  }

  console.log(`report: ${reportFile}`);
  for (const failure of report.failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "settings agent: PASS" : "settings agent: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`settings-agent: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
