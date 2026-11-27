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
const REPORT = path.join(desktopRoot, "e2e/artifacts/settings-composer.json");
const SCREENSHOTS = [
  "settings-composer.png",
  "settings-composer-enter.png",
  "settings-composer-search.png",
];

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type NavRow = { label: string; match: string | null; active: boolean };

type Radio = { label: string; checked: string | null; box: Box | null };

type State = {
  viewport: { width: number; height: number };
  nav: NavRow[];
  heading: string;
  subtitle: string;
  pagePresent: boolean;
  sendKey: string | null;
  pageBox: Box | null;
  groupPresent: boolean;
  groupBox: Box | null;
  radios: Radio[];
  sendRow: { label: string; box: Box | null } | null;
  rowLabels: string[];
  hint: {
    sendKey: string | null;
    role: string | null;
    text: string;
    box: Box | null;
  } | null;
  search: { value: string; label: string | null; box: Box | null } | null;
  panelView: string | null;
  panel: { box: Box | null } | null;
  content: { box: Box | null } | null;
  stored: string | null;
  sheet: { scrollWidth: number; clientWidth: number; scrollHeight: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  states: {
    opened: State;
    enter: State;
    reloaded: State;
    restored: State;
    searched: State;
  };
  screenshots: string[];
  pageErrors: string[];
};

/** The section column, in the order the sheet ships it. */
const NAV_ORDER = [
  "Appearance",
  "Keyboard",
  "Chat display",
  "Composer",
  "Areas",
  "Vault",
  "Hermes",
  "Phone",
  "Agent",
  "Review",
  "Questions",
  "Decisions",
  "Updates",
  "About me",
  "Developer",
];

/**
 * The rig renders the real Settings → Composer section in a real layout engine,
 * so it needs the Vite dev server. With the server down the test skips; `npm run
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
      [path.join(desktopRoot, "e2e/settings-composer.electron.mjs")],
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
 * Settings → Composer: the tab sits second, immediately after Keyboard; the page
 * names itself and offers one row with a two-option Send key control, a hint
 * that states the consequence of each choice, and a root element that reports
 * the live choice. Pressing a choice moves the root, the checked radio, the hint
 * and `lifequest-composer-send-key` together; a reload keeps it; pressing the
 * other choice puts it back; and the sheet's own search still finds the page.
 */
describe("settings composer e2e", () => {
  it("offers the send-key choice, stores it, and survives a reload", async (t) => {
    assert.equal(
      await devServerUp(),
      true,
      `no dev server on 127.0.0.1:${DEV_PORT} — run this rig through ` +
        "`/root/.local/bin/lifequest-e2e <checkout> tests/settings-composer-e2e.test.ts`. " +
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

    const { opened, enter, reloaded, restored, searched } = report.states;

    // 1 — the tab: fifth in the column, after Keyboard, Chat display and
    //     Composer, and the one that is open.
    assert.deepEqual(
      opened.nav.map((row) => row.label),
      NAV_ORDER,
      "the section column is not the app's fifteen tabs in order",
    );
    assert.equal(opened.nav.length, 15, "the sheet does not list 15 tabs");
    assert.equal(opened.nav[1]?.label, "Keyboard", "Keyboard is not the tab before Chat display");
    assert.equal(opened.nav[2]?.label, "Chat display", "Chat display does not follow Keyboard");
    assert.equal(opened.nav[3]?.label, "Composer", "Composer does not follow Chat display");
    assert.equal(opened.nav[3]?.active, true, "the Composer tab is not the open one");
    assert.equal(opened.panelView, "composer", "the panel is not the Composer page");

    // 2 — the page names itself, and carries the root the choice is read from.
    assert.equal(opened.pagePresent, true, "the page has no [data-composer-settings] root");
    assert.equal(opened.heading, "Composer", "the page has no Composer heading");
    assert.equal(
      opened.subtitle,
      "How the message box sends",
      `the page subtitle reads ${JSON.stringify(opened.subtitle)}`,
    );
    assert.ok(opened.sendRow, `the page has no "Send with" row: ${JSON.stringify(opened.rowLabels)}`);

    // 3 — the default: Ctrl/Cmd+Enter sends, and the hint says Enter breaks the
    //     line rather than sending.
    assert.equal(opened.sendKey, "modified", `the default root reads ${opened.sendKey}`);
    assert.equal(opened.groupPresent, true, "the Send key control is not a group");
    assert.deepEqual(
      opened.radios.map((radio) => radio.label),
      ["Ctrl/Cmd+Enter", "Enter"],
      "the Send key control does not offer both keys",
    );
    assert.deepEqual(
      opened.radios.map((radio) => radio.checked),
      ["true", "false"],
      "the default option is not the checked one",
    );
    assert.equal(opened.hint?.sendKey, "modified", "the hint does not report the default");
    assert.equal(opened.hint?.role, "status", "the hint is not a status note");
    assert.match(
      opened.hint?.text ?? "",
      /enter[^.]*breaks? the line/i,
      `the default hint does not say Enter breaks the line: ${JSON.stringify(opened.hint?.text)}`,
    );
    assert.match(
      opened.hint?.text ?? "",
      /ctrl\/cmd(?:|\s*)\+enter[^.]*sends?/i,
      `the default hint does not say Ctrl/Cmd+Enter sends: ${JSON.stringify(opened.hint?.text)}`,
    );

    // 4 — pressing "Enter" moves every reader of the choice at once: the root's
    //     attribute, the checked radio, the hint and storage.
    assert.equal(enter.sendKey, "enter", `the root reads ${enter.sendKey} after pressing Enter`);
    assert.deepEqual(
      enter.radios.map((radio) => radio.checked),
      ["false", "true"],
      "pressing Enter did not move the checked option",
    );
    assert.equal(enter.stored, "enter", `localStorage holds ${JSON.stringify(enter.stored)}`);
    assert.equal(enter.hint?.sendKey, "enter", "the hint did not follow the press");
    assert.match(
      enter.hint?.text ?? "",
      /enter[^.]*sends?/i,
      `the Enter hint does not say Enter sends: ${JSON.stringify(enter.hint?.text)}`,
    );
    assert.match(
      enter.hint?.text ?? "",
      /shift\s*\+\s*enter[^.]*(breaks? the line|newline|new line)/i,
      `the Enter hint does not say Shift+Enter breaks the line: ${JSON.stringify(enter.hint?.text)}`,
    );

    // 5 — the choice is window storage, not session state: a reload keeps it.
    assert.equal(reloaded.sendKey, "enter", "the reload lost the chosen keyboard");
    assert.equal(reloaded.radios[1]?.checked, "true", "the reload unchecked the chosen option");
    assert.equal(reloaded.stored, "enter", `the reload lost the stored choice: ${reloaded.stored}`);
    assert.equal(reloaded.nav.length, 15, "the reload lost the section column");
    assert.equal(reloaded.panelView, "composer", "the reload left the Composer page");

    // 6 — and back: Ctrl/Cmd+Enter is stored the same way.
    assert.equal(restored.sendKey, "modified", "pressing Ctrl/Cmd+Enter did not restore the default");
    assert.equal(restored.radios[0]?.checked, "true", "pressing Ctrl/Cmd+Enter did not check it");
    assert.equal(
      restored.stored,
      "modified",
      `localStorage holds ${JSON.stringify(restored.stored)} after restoring`,
    );

    // 7 — the sheet's own search can find the page by the key it is about.
    assert.ok(searched.nav.length > 0, "searching for the send key matched no section");
    assert.ok(
      searched.nav.length < NAV_ORDER.length,
      "searching for the send key did not narrow the column",
    );
    assert.equal(
      searched.nav.some((row) => row.label === "Composer"),
      true,
      `searching "enter" lost Composer: ${JSON.stringify(searched.nav.map((row) => row.label))}`,
    );
    assert.equal(searched.panelView, "composer", "the search moved the panel off Composer");
    assert.equal(searched.search?.value, "enter", "the search field lost its query");

    // 8 — no line widens the sheet.
    assert.ok(
      searched.sheet.scrollWidth <= searched.sheet.clientWidth + 1,
      `the page scrolls sideways: ${searched.sheet.scrollWidth}px vs ${searched.sheet.clientWidth}px`,
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
