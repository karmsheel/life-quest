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
  "settings-hermes-picked.png",
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

type CardRow = {
  label: string | null;
  checked: string | null;
  disabled: boolean;
  inUse: string | null;
  desc: string;
  tag: string | null;
  avatar: string | null;
  box: Box | null;
};

type State = {
  viewport: { width: number; height: number };
  order: { id: string; box: Box | null }[];
  firstBlock: string;
  facts: FactRow[];
  toggle: { checked: string | null; disabled: boolean; box: Box | null; role: string | null } | null;
  checkboxCount: number;
  cards: CardRow[];
  create: {
    label: string | null;
    checked: string | null;
    inUse: string | null;
    desc: string;
    box: Box | null;
  } | null;
  listColumns: number;
  content: { box: Box | null };
  sheet: { scrollWidth: number; clientWidth: number; scrollHeight: number };
  calls: { ensure: number; useProfile: string[]; filing: boolean[]; openFolder: number };
  doorsError: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  states: { opened: State; picked: State; off: State; failedDoor: State };
  screenshots: string[];
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
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    const { opened, picked, off, failedDoor } = report.states;

    // 1 — the doors lead the page. They are the two addresses another agent
    //     needs, and the thing this page exists to hand over.
    assert.deepEqual(
      opened.order.map((entry) => entry.id),
      ["hermes-doors", "hermes-connection", "hermes-profile", "hermes-behaviour"],
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

    // 3 — the profile choice is a grid of short cards, not a stack of
    //     page-wide bars. The bars were the width complaint.
    const contentWidth = opened.content.box?.width ?? opened.viewport.width;
    assert.ok(opened.listColumns >= 2, `the profile cards are in ${opened.listColumns} column`);
    assert.equal(opened.cards.length, 3, "the picker lost an installed profile");
    assert.ok(opened.create, "the app's own profile is not offered for creation");
    for (const card of opened.cards) {
      assert.ok(
        (card.box?.width ?? contentWidth) <= contentWidth * 0.5,
        `"${card.label}" is ${card.box?.width}px of ${contentWidth}px wide — still a page-wide bar`,
      );
      assert.ok(
        (card.box?.height ?? 999) <= 72,
        `"${card.label}" is ${card.box?.height}px tall — not a short card`,
      );
      assert.ok(
        (card.avatar ?? "").length > 0 && /\.hermes/.test(card.desc),
        `"${card.label}" lost its avatar or its path`,
      );
    }
    assert.equal(opened.cards[0].tag, "default", "the default card is not marked");
    assert.equal(
      opened.cards.slice(1).every((card) => card.tag === null),
      true,
      "a non-default card wears the default tag",
    );
    assert.equal(
      opened.create?.checked,
      "true",
      "the create card is not the one marked while the app is on lifequest",
    );
    assert.equal(opened.create?.inUse, "In use", 'the create card does not read "In use"');
    assert.equal(
      opened.cards.every((card) => card.checked === "false" && card.inUse === null),
      true,
      "an installed card claims to be in use while the app is on an unlisted profile",
    );

    // 4 — the filing preference is the switch, not a checkbox.
    assert.equal(opened.checkboxCount, 0, "the page still carries a native checkbox");
    assert.equal(opened.toggle?.role, "switch", "the filing preference is not a switch");
    assert.equal(opened.toggle?.checked, "true", "the switch does not read its stored value");

    // 5 — choosing a profile reaches the bridge and moves the mark.
    assert.deepEqual(picked.calls.useProfile, ["brook"], "the choice did not reach the bridge");
    const brook = picked.cards.find((card) => card.label === "Use the brook profile");
    assert.equal(brook?.checked, "true", "the chosen card is not checked");
    assert.equal(brook?.inUse, "In use", 'the chosen card does not read "In use"');
    assert.notEqual(picked.create?.checked, "true", "the create card is still marked");
    assert.equal(
      picked.create?.inUse,
      null,
      "the create card still reads in use after a switch",
    );

    // 6 — the switch writes the value it shows, and shows the value it wrote.
    assert.deepEqual(off.calls.filing, [false], "the switch did not write its new value");
    assert.equal(off.toggle?.checked, "false", "the switch did not flip");
    assert.equal(off.cards.length, 3, "the press lost the profile cards");
    assert.equal(off.facts.length, 5, "the press lost the facts");

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
