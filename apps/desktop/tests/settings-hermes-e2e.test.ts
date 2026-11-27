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
const REPORT = path.join(desktopRoot, "e2e/artifacts/settings-hermes.json");
const SCREENSHOTS = [
  "settings-hermes-opened.png",
  "settings-hermes-removed.png",
  "settings-hermes-door-error.png",
];

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type FactRow = {
  label: string;
  value: string;
  labelBox: Box | null;
  valueBox: Box | null;
  error: string | null;
};

/** The shipped "Agents in this vault" card, as the rig measures it. */
type VaultAgentsCard = {
  box: Box | null;
  pi: { box: Box | null; active: boolean; usePi: boolean } | null;
  hermes: {
    box: Box | null;
    bound: boolean;
    profile: string | null;
    boundCopy: string | null;
    emptyCopy: string | null;
    active: boolean;
    sharedWarning: string | null;
    useHermes: boolean;
    change: boolean;
    remove: boolean;
    create: boolean;
    reuse: boolean;
  } | null;
  notice: string | null;
};

type State = {
  viewport: { width: number; height: number };
  order: { id: string; box: Box | null }[];
  firstBlock: string;
  facts: FactRow[];
  toggle: { checked: string | null; disabled: boolean; box: Box | null; role: string | null } | null;
  checkboxCount: number;
  vaultAgents: VaultAgentsCard | null;
  content: { box: Box | null };
  sheet: { scrollWidth: number; clientWidth: number; scrollHeight: number };
  calls: {
    ensure: number;
    useProfile: string[];
    filing: boolean[];
    openFolder: number;
    addHermes: unknown[];
    removeHermes: number;
    switchHarness: string[];
  };
  doorsError: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  states: { opened: State; removed: State; off: State; failedDoor: State };
  screenshots: string[];
  pageErrors: string[];
};

/**
 * The rig renders the real Settings → Hermes section in a real layout engine, so
 * it needs the Vite dev server. With the server down the test skips; `npm run
 * dev` in another terminal brings it up.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT });
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
      [path.join(desktopRoot, "e2e/settings-hermes.electron.mjs")],
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

/**
 * Settings → Hermes, after the cleanup: the MCP doors lead the page, every
 * name/value fact sits on one line, the profile choice is a row of short
 * selectable cards, and the filing preference is a switch rather than a
 * checkbox. The complaint this rig answers is the page before it: facts stacked
 * over their values, page-wide profile bars, a raw checkbox, and the doors
 * below the fold.
 */
describe("settings hermes e2e", () => {
  it("leads with the doors, keeps each fact on one line, and offers profile cards and a switch", async (t) => {
    assert.equal(
      await devServerUp(),
      true,
      `no dev server on 127.0.0.1:${DEV_PORT} — run this rig through ` +
        "`/root/.local/bin/lifequest-e2e <checkout> tests/settings-hermes-e2e.test.ts`. " +
        "A skipped rig is evidence of nothing.",
    );

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.deepEqual(report.pageErrors ?? [], [], "the page logged errors while the rig drove it");

    const { opened, removed, off, failedDoor } = report.states;

    // 1 — the doors lead the page. They are the two addresses another agent
    //     needs, and the thing this page exists to hand over.
    assert.deepEqual(
      opened.order.map((entry) => entry.id),
      ["hermes-doors", "hermes-connection", "vault-agents", "hermes-behaviour"],
      "the page's blocks are not in the order the cleanup set",
    );
    assert.equal(opened.firstBlock, "MCP doors", "the page does not open with the doors");
    const doors = opened.order[0].box;
    const connection = opened.order[1].box;
    const profile = opened.order[2].box;
    assert.ok(doors, "the doors block has no box");
    assert.ok(connection, "the connection block has no box");
    assert.ok(profile, "the profile block has no box");
    assert.ok(doors.top < connection.top, "the doors are not above the connection");
    assert.ok(
      doors.bottom <= profile.top,
      `the doors end at ${doors.bottom}px, the profile cards start at ${profile.top}px`,
    );

    // 2 — name and data on one line, for both the doors and the connection.
    assert.equal(opened.facts.length, 5, "the page does not show its five facts");
    for (const fact of opened.facts) {
      assert.ok(fact.value.length > 0, `"${fact.label}" has no value`);
      const labelY = fact.labelBox
        ? (fact.labelBox.top + fact.labelBox.bottom) / 2
        : -1;
      const valueY = fact.valueBox
        ? (fact.valueBox.top + fact.valueBox.bottom) / 2
        : -2;
      assert.ok(
        Math.abs(labelY - valueY) <= 2,
        `"${fact.label}" and its value are on different lines: ${labelY}px vs ${valueY}px`,
      );
      assert.ok(
        (fact.valueBox?.left ?? -1) >= (fact.labelBox?.right ?? Infinity),
        `"${fact.label}" does not lead its value`,
      );
      assert.equal(fact.error, null, `"${fact.label}" carries an error it did not report`);
    }

    // 3 — "Agents in this vault": Pi always, the bound Hermes agent named,
    //     and the shared-memory warning shown for a profile another vault uses.
    const contentWidth = opened.content.box?.width ?? opened.viewport.width;
    const agents = opened.vaultAgents;
    assert.ok(agents, "the Agents in this vault section is not on the page");
    assert.ok(agents.pi, "the Pi card is not on the page");
    assert.equal(agents.pi.active, false, "Pi reads active while the vault runs Hermes");
    assert.equal(agents.pi.usePi, true, "Pi is not offered as an action when it is not active");
    assert.ok(agents.hermes, "the Hermes card is not on the page");
    assert.equal(agents.hermes.bound, true, "the bound Hermes card does not read bound");
    assert.equal(agents.hermes.profile, "brook", "the card does not name the bound profile");
    assert.match(
      agents.hermes.boundCopy ?? "",
      /bound to this vault/i,
      "the bound card does not say the agent belongs to this vault",
    );
    assert.equal(agents.hermes.active, true, "the bound Hermes agent is not marked active");
    assert.equal(agents.hermes.useHermes, false, "an active agent still offers Use Hermes");
    assert.equal(agents.hermes.change, true, "the bound card offers no Change agent");
    assert.equal(agents.hermes.remove, true, "the bound card offers no Remove from this vault");
    assert.match(
      agents.hermes.sharedWarning ?? "",
      /other vault/i,
      "the reused profile's shared-memory warning does not name the other vault",
    );
    assert.match(
      agents.hermes.sharedWarning ?? "",
      /memory, skills and knowledge are shared/i,
      "the shared-memory warning does not say what is shared",
    );
    assert.ok(
      (agents.box?.width ?? Infinity) <= contentWidth + 1,
      `the agent card is ${agents.box?.width}px of ${contentWidth}px — it widens the page`,
    );

    // 4 — the filing preference is the switch, not a checkbox.
    assert.equal(opened.checkboxCount, 0, "the page still carries a native checkbox");
    assert.equal(opened.toggle?.role, "switch", "the filing preference is not a switch");
    assert.equal(opened.toggle?.checked, "true", "the switch does not read its stored value");

    // 5 — Remove from this vault reaches the bridge and the vault falls back
    //     to Pi, with both explicit ways to add an agent offered again.
    assert.equal(
      removed.calls.removeHermes,
      1,
      "the removal did not reach vaultAgentsRemoveHermes",
    );
    assert.equal(removed.vaultAgents?.pi?.active, true, "the vault did not fall back to Pi");
    assert.equal(
      removed.vaultAgents?.hermes?.bound,
      false,
      "the Hermes card still reads bound after removal",
    );
    assert.match(
      removed.vaultAgents?.hermes?.emptyCopy ?? "",
      /this vault has no hermes agent/i,
      "the empty card does not say the vault has no Hermes agent",
    );
    assert.equal(
      removed.vaultAgents?.hermes?.create,
      true,
      "the empty card offers no Create a new agent action",
    );
    assert.equal(
      removed.vaultAgents?.hermes?.reuse,
      true,
      "the empty card offers no Use an existing agent action",
    );

    // 6 — the switch writes the value it shows, and shows the value it wrote.
    assert.deepEqual(off.calls.filing, [false], "the switch did not write its new value");
    assert.equal(off.toggle?.checked, "false", "the switch did not flip");
    assert.ok(off.vaultAgents, "the press lost the Agents in this vault card");
    // The vault is on Pi after the removal, so the Hermes connection facts are
    // replaced by the built-in endpoint form; the doors' two facts remain.
    assert.ok(off.facts.length >= 2, `the press lost the facts: ${off.facts.length}`);

    // 7 — a door that failed to bind keeps its own error, under its own row,
    //     while the other door keeps its address.
    const invite = failedDoor.facts.find((fact) => fact.label === "Invite");
    assert.equal(
      invite?.error,
      "Port 8646 is already in use.",
      "a failed door lost its error",
    );
    assert.match(
      failedDoor.doorsError ?? "",
      /Port 8646 is already in use\./,
      "the failure is not rendered in the doors block",
    );
    assert.equal(
      failedDoor.facts.find((fact) => fact.label === "Local")?.value,
      "http://127.0.0.1:8643/mcp",
      "one failed door took the other door's address with it",
    );

    // 8 — no long path widens the page.
    assert.ok(
      failedDoor.sheet.scrollWidth <= failedDoor.sheet.clientWidth + 1,
      `the page scrolls sideways: ${failedDoor.sheet.scrollWidth}px vs ${failedDoor.sheet.clientWidth}px`,
    );

    // The repeatable artifact: a JSON report plus the frames it measured.
    for (const shot of SCREENSHOTS) {
      assert.ok(report.screenshots.includes(shot), `the run did not record ${shot}`);
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts", shot)),
        true,
        `${shot} was reported but not written`,
      );
    }
  });
});
