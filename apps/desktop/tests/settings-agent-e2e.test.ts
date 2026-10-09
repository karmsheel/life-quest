import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/settings-agent.json");

/**
 * The rig renders the real Settings → Agent section in a real layout engine, so
 * it needs the Vite dev server. With the server down the test skips; `npm run
 * dev` in another terminal brings it up.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/settings-agent.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

type PromptSample = {
  text: string;
  box: { width: number; height: number } | null;
  color: string;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  overflowY: string;
  fontFamily: string;
};

type SkillRow = { name: string | null; text: string; description: string; path: string };

type State = {
  hasSection: boolean;
  soul: PromptSample | null;
  soulBadge: string;
  instructions: { text: string; box: { width: number; height: number } | null } | null;
  skillCount: number;
  skillRows: SkillRow[];
  sheetScrollWidth: number | null;
  sheetClientWidth: number | null;
  copyButtons: number;
  contextFields: string[];
};

type Report = {
  pass: boolean;
  failures: string[];
  states: { seeded: State; edited: State };
  screenshots: string[];
};

/**
 * Settings → Agent: the page that shows what the companion is told and what it
 * has been given to read. Before it existed, the only way to answer "why can my
 * companion not make a card?" was to read %LOCALAPPDATA%\hermes by hand.
 */
describe("settings agent e2e", () => {
  it("shows the profile's prompts and the skill library, and follows the profile", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    const { seeded, edited } = report.states;

    // The page answers the question: both prompts, on screen.
    assert.equal(seeded.hasSection, true);
    assert.match(seeded.soul?.text ?? "", /LifeQuest companion/);
    assert.match(seeded.instructions?.text ?? "", /Active domain/);
    assert.equal(seeded.soulBadge, "LifeQuest seed");

    // Readable, not clipped, and it wraps rather than widening the settings page.
    assert.ok((seeded.soul?.box?.height ?? 0) > 40, "the prompt body has no height");
    assert.doesNotMatch(seeded.soul?.color ?? "", /rgba\(0, 0, 0, 0\)/);
    assert.match(seeded.soul?.fontFamily ?? "", /mono/i);
    assert.ok(
      (seeded.sheetScrollWidth ?? 0) <= (seeded.sheetClientWidth ?? 0) + 1,
      "a long prompt widened the settings sheet",
    );
    assert.ok(
      (seeded.soul?.scrollWidth ?? 0) <= (seeded.soul?.clientWidth ?? 0) + 1,
      "a long prompt overflowed its own body sideways",
    );

    // The instructions carry the two lines that make them worth showing.
    assert.match(seeded.instructions?.text ?? "", /financial dashboard \(domainSlug: "financial"\)/);
    assert.match(seeded.instructions?.text ?? "", /UNLOCKED/);
    assert.ok(seeded.contextFields.includes("Dashboard board"));

    // The skill library is described, ordered, and counted.
    assert.equal(seeded.skillRows.length, 3);
    assert.equal(seeded.skillCount, 3, "the count badge disagrees with the rows");
    assert.equal(seeded.skillRows[0]?.name, "lifequest-dashboard-scripting");
    for (const row of seeded.skillRows) {
      assert.ok((row.description ?? "").length > 10, `${row.name} has no description`);
      assert.match(row.path ?? "", /SKILL\.md$/);
    }
    assert.match(
      seeded.skillRows.find((r) => r.name === "lifequest-mcp")?.text ?? "",
      /used 7/,
    );
    assert.match(seeded.skillRows.find((r) => r.name === "arxiv")?.text ?? "", /not used yet/);

    // The operator's own words are reported as theirs, and the list follows the
    // profile rather than a fixture baked into the page.
    assert.match(edited.soul?.text ?? "", /Never use emoji/);
    assert.equal(edited.soulBadge, "Edited by you");
    assert.equal(edited.skillRows.length, 2);
    assert.equal(edited.skillCount, 2);

    assert.deepEqual(report.screenshots.length >= 2, true, "the run captured no screenshot");
  });
});
