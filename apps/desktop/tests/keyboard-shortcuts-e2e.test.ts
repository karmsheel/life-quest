import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(
  desktopRoot,
  "e2e/artifacts/keyboard-shortcuts.json",
);

/** Every frame the driver must write; the artifact is only evidence with them. */
const SHOTS = [
  "keyboard-shortcuts-defaults.png",
  "keyboard-shortcuts-search.png",
  "keyboard-shortcuts-recording.png",
  "keyboard-shortcuts-rebound.png",
  "keyboard-shortcuts-conflict.png",
  "keyboard-shortcuts-cleared.png",
  "keyboard-shortcuts-reload.png",
  "keyboard-shortcuts-typing-guard.png",
];

/** The contract this branch ships, restated here so the suite fails on a
 *  regression even if the driver's own expectations were loosened. */
const DEFAULTS: Record<string, string> = {
  "wing.home": "Ctrl+1",
  "wing.define": "Ctrl+2",
  "wing.plan": "Ctrl+3",
  "wing.execute": "Ctrl+4",
  "wing.review": "Ctrl+5",
  "wing.next": "Ctrl+PageDown",
  "wing.previous": "Ctrl+PageUp",
  "page.next": "Ctrl+Shift+PageDown",
  "page.previous": "Ctrl+Shift+PageUp",
  "history.back": "Alt+ArrowLeft",
  "history.forward": "Alt+ArrowRight",
  "panel.sidebar.toggle": "Ctrl+B",
  "panel.chat.toggle": "Ctrl+J",
  "surface.settings.open": "Ctrl+Comma",
};

const GROUPS = [
  { id: "wings", rows: 7 },
  { id: "pages", rows: 4 },
  { id: "panels", rows: 2 },
  { id: "surfaces", rows: 1 },
];

type RowState = {
  id: string;
  label: string;
  binding: string;
  recording: boolean;
  customized: boolean;
  prompt: boolean;
  keysValue: string | null;
  keycaps: string[];
  defaultText: string | null;
  buttons: Array<string | null>;
};

type State = {
  path: string | null;
  overlayOpen: boolean;
  panelPresent: boolean;
  bodyOverflow: string;
  backgroundPage: boolean;
  backgroundPages: Array<{ name: string | null; title: string }>;
  viewedTab: string | null;
  nav: Array<{ label: string; active: boolean; match: string | null }>;
  navEmpty: string | null;
  pageTitle: string;
  pageSubtitle: string;
  shortcutsRoot: boolean;
  groups: Array<{ id: string | null; rows: string[] }>;
  rows: RowState[];
  promptCount: number;
  error: string | null;
  status: string | null;
  resetAll: { present: boolean; disabled: boolean | null };
  storage: string | null;
  shellClass: string | null;
  chatPanel: boolean;
  wingTabs: Array<{ label: string; selected: boolean }>;
  selectedWing: string | null;
  vaultText: string;
  focused: { tag: string; id: string | null; className: string | null } | null;
  input: { present: boolean; value: string | null; focused: boolean };
  searchValue: string | null;
  searchFocused: boolean;
  keyLog: Array<{
    key: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    target: string;
  }>;
};

type Report = {
  pass: boolean;
  failures: string[];
  vaultName: string;
  storageKey: string;
  expected: { defaults: Record<string, string>; groups: typeof GROUPS };
  states: Record<string, State>;
  steps: Record<string, unknown>;
  screenshots: string[];
};

const state = (report: Report, name: string): State => {
  const found = report.states[name];
  assert.ok(found, `the report carries no "${name}" state`);
  return found;
};

const row = (snapshot: State, id: string): RowState => {
  const found = snapshot.rows.find((candidate) => candidate.id === id);
  assert.ok(found, `the "${snapshot.path}" page has no ${id} row`);
  return found;
};

const storedBindings = (snapshot: State): unknown => {
  if (snapshot.storage === null) return null;
  const parsed = JSON.parse(snapshot.storage) as { bindings?: unknown };
  return parsed.bindings ?? null;
};

const lastKey = (snapshot: State) => {
  const log = snapshot.keyLog;
  return log.length ? log[log.length - 1] : null;
};

/**
 * The rig measures the real shell in a real Electron window, so it needs the
 * Vite dev server. With the server down the test skips; the bench script is how
 * this is meant to be run.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
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
      [path.join(desktopRoot, "e2e/keyboard-shortcuts.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000 },
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

describe("keyboard shortcuts settings and runner", () => {
  it("records, refuses, resets, persists and runs the shipped movements", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    // A stale report would let a crashed run pass on the previous run's states.
    fs.rmSync(REPORT, { force: true });
    for (const shot of SHOTS) {
      fs.rmSync(path.join(desktopRoot, "e2e/artifacts", shot), { force: true });
    }

    const exitCode = await runDriver();
    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact (e2e/artifacts/keyboard-shortcuts.json)",
    );

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.deepEqual(
      report.failures,
      [],
      `the driver reported failures: ${JSON.stringify(report.failures)}`,
    );
    assert.equal(report.pass, true, "the driver reported pass: false");
    assert.equal(exitCode, 0, "driver exited non-zero");

    // The report is the branch's contract, not whatever the run happened to see.
    assert.deepEqual(report.expected.defaults, DEFAULTS);
    assert.deepEqual(report.expected.groups, GROUPS);
    assert.equal(report.storageKey, "lifequest-keyboard-shortcuts");

    const landing = state(report, "landing");
    assert.equal(landing.path, "/home", "the rig did not start on the home stub");
    assert.equal(landing.storage, null, "the run started with stored overrides");
    assert.equal(
      landing.input.present,
      true,
      "the home stub has no [data-rig-input] for the typing guard",
    );

    // —— 1. Settings nav shows "Keyboard"; the page has all 14 rows in four
    //       groups, on their defaults, with nothing stored.
    const defaults = state(report, "defaults");
    assert.equal(
      defaults.nav.some((item) => item.label === "Keyboard"),
      true,
      `the settings nav has no Keyboard row: ${JSON.stringify(defaults.nav.map((item) => item.label))}`,
    );
    assert.equal(defaults.viewedTab, "shortcuts", "the Keyboard page is not the open panel");
    assert.equal(defaults.pageTitle, "Keyboard shortcuts", `page title ${defaults.pageTitle}`);
    assert.equal(defaults.shortcutsRoot, true, "the shortcuts card root is missing");
    assert.equal(defaults.rows.length, 14, `the page lists ${defaults.rows.length} rows, not 14`);
    assert.deepEqual(
      defaults.groups.map((group) => ({ id: group.id, rows: group.rows.length })),
      GROUPS,
      `the page groups are ${JSON.stringify(defaults.groups)}`,
    );
    for (const [id, binding] of Object.entries(DEFAULTS)) {
      assert.equal(row(defaults, id).binding, binding, `${id} is not on its default binding`);
    }
    assert.deepEqual(row(defaults, "wing.next").keycaps, ["Ctrl", "PgDn"]);
    assert.deepEqual(row(defaults, "history.back").keycaps, ["Alt", "←"]);
    assert.deepEqual(row(defaults, "surface.settings.open").keycaps, ["Ctrl", ","]);
    assert.deepEqual(row(defaults, "page.next").keycaps, ["Ctrl", "Shift", "PgDn"]);
    assert.deepEqual(row(defaults, "wing.home").keycaps, ["Ctrl", "1"]);
    for (const item of defaults.rows) {
      assert.equal(
        item.keycaps.length > 0,
        true,
        `${item.id} draws no keycaps: ${JSON.stringify(item)}`,
      );
      assert.equal(item.customized, false, `${item.id} is customized before any change`);
      assert.equal(item.recording, false, `${item.id} is recording before any change`);
    }
    assert.equal(defaults.promptCount, 0, "a recording prompt is up on the defaults page");
    assert.equal(defaults.storage, null, "an override was stored before any change");
    assert.equal(defaults.error, null, `the defaults page shows an error: ${defaults.error}`);
    assert.equal(
      defaults.resetAll.present && defaults.resetAll.disabled,
      true,
      "Restore all defaults is not present and disabled on an all-default page",
    );
    assert.match(
      defaults.status ?? "",
      /Every movement is on its default key\./,
      `footer status ${JSON.stringify(defaults.status)}`,
    );

    // —— 2. Search narrows the nav to Keyboard and leaves the page open.
    const searched = state(report, "searched");
    assert.deepEqual(
      searched.nav.map((item) => item.label),
      ["Keyboard"],
      `searching "shortcut" left nav ${JSON.stringify(searched.nav)}`,
    );
    assert.equal(searched.nav[0].active, true, "the Keyboard row is not active after the search");
    assert.equal(searched.searchValue, "shortcut", "the search field does not carry the query");
    assert.equal(searched.viewedTab, "shortcuts", "the search left the shortcuts panel");
    assert.equal(searched.pageTitle, "Keyboard shortcuts", "the search left the shortcuts page");

    // —— 3. Rebind Next wing: prompt, new binding, storage, and a real movement.
    const recording = state(report, "recording");
    const recordingRow = row(recording, "wing.next");
    assert.equal(recordingRow.recording, true, "the Next wing row is not recording");
    assert.equal(recordingRow.prompt, true, "the recording prompt is missing");
    assert.equal(recording.promptCount, 1, "more than one row is recording");
    assert.ok(
      recordingRow.buttons.includes("Cancel changing the shortcut for Next wing"),
      `the Change control did not turn into Cancel: ${JSON.stringify(recordingRow.buttons)}`,
    );

    const rebound = state(report, "rebound");
    const reboundRow = row(rebound, "wing.next");
    assert.equal(reboundRow.binding, "Ctrl+Alt+N", `rebound row carries ${reboundRow.binding}`);
    assert.equal(reboundRow.customized, true, "the rebound row is not marked customized");
    assert.equal(
      reboundRow.defaultText,
      "Default: Ctrl + PgDn",
      `the rebound row does not name its default: ${JSON.stringify(reboundRow.defaultText)}`,
    );
    assert.deepEqual(reboundRow.keycaps, ["Ctrl", "Alt", "N"]);
    assert.equal(reboundRow.recording, false, "the row is still recording after saving");
    assert.equal(rebound.error, null, `the save showed an error: ${rebound.error}`);
    assert.deepEqual(
      storedBindings(rebound),
      { "wing.next": "Ctrl+Alt+N" },
      `storage after the rebind: ${rebound.storage}`,
    );
    assert.match(
      rebound.status ?? "",
      /1 movement is changed/,
      `footer after the rebind: ${JSON.stringify(rebound.status)}`,
    );

    const reboundMovement = state(report, "reboundMovement");
    assert.equal(reboundMovement.path, "/dream", `Ctrl+Alt+N landed on ${reboundMovement.path}`);
    assert.equal(reboundMovement.selectedWing, "Define", "the Define wing tab is not selected");
    const reboundKey = lastKey(reboundMovement);
    assert.ok(reboundKey, "the harness logged no keydown for the movement");
    assert.deepEqual(
      { key: reboundKey.key, ctrl: reboundKey.ctrl, alt: reboundKey.alt },
      { key: "n", ctrl: true, alt: true },
      `the movement key did not arrive as Ctrl+Alt+N: ${JSON.stringify(reboundKey)}`,
    );

    // —— 4. A conflict names the other movement, changes nothing, keeps the row
    //       recording, and the runner stands down.
    const conflict = state(report, "conflict");
    assert.match(
      conflict.error ?? "",
      /Toggle sidebar/,
      `the conflict does not name the owning movement: ${JSON.stringify(conflict.error)}`,
    );
    assert.equal(
      row(conflict, "wing.previous").binding,
      "Ctrl+PageUp",
      "the refused row lost its binding",
    );
    assert.equal(row(conflict, "wing.previous").recording, true, "the refused row stopped recording");
    assert.equal(
      String(conflict.shellClass).includes("shell--nav-collapsed"),
      false,
      `the runner fired Ctrl+B while recording: ${conflict.shellClass}`,
    );
    assert.equal(
      storedBindings(conflict) !== null &&
        JSON.stringify(storedBindings(conflict)) === JSON.stringify({ "wing.next": "Ctrl+Alt+N" }),
      true,
      `the refusal wrote to storage: ${conflict.storage}`,
    );
    const conflictKey = lastKey(conflict);
    assert.ok(conflictKey, "the harness logged no keydown for the conflict");
    assert.deepEqual(
      { key: conflictKey.key, ctrl: conflictKey.ctrl, alt: conflictKey.alt },
      { key: "b", ctrl: true, alt: false },
      `the conflicting key did not arrive as Ctrl+B: ${JSON.stringify(conflictKey)}`,
    );

    const conflictCancelled = state(report, "conflictCancelled");
    assert.equal(conflictCancelled.overlayOpen, true, "Escape closed the sheet instead of cancelling");
    assert.equal(conflictCancelled.pageTitle, "Keyboard shortcuts", "the cancelled sheet lost its page");
    assert.equal(row(conflictCancelled, "wing.previous").recording, false, "recording survived Escape");
    assert.equal(conflictCancelled.promptCount, 0, "a prompt survived Escape");
    assert.equal(conflictCancelled.error, null, "the error banner survived the cancel");

    // —— 5. Reserved combinations are refused and change nothing.
    const reserved = state(report, "reserved");
    assert.match(
      reserved.error ?? "",
      /reserved/i,
      `Ctrl+W was not refused as reserved: ${JSON.stringify(reserved.error)}`,
    );
    assert.equal(row(reserved, "history.back").binding, "Alt+ArrowLeft", "the reserved refusal rebound Back");
    assert.equal(row(reserved, "history.back").recording, true, "the reserved refusal ended recording");
    assert.ok(
      JSON.stringify(storedBindings(reserved)) === JSON.stringify({ "wing.next": "Ctrl+Alt+N" }),
      `the reserved refusal wrote to storage: ${reserved.storage}`,
    );

    // —— 6. Backspace clears: the row is unassigned and storage records null.
    const cleared = state(report, "cleared");
    assert.equal(row(cleared, "history.back").binding, "unassigned", "Backspace did not clear the row");
    assert.deepEqual(row(cleared, "history.back").keycaps, []);
    assert.equal(row(cleared, "history.back").customized, true, "a deliberate clear is not customized");
    assert.deepEqual(
      storedBindings(cleared),
      { "wing.next": "Ctrl+Alt+N", "history.back": null },
      `storage after Backspace: ${cleared.storage}`,
    );

    // —— 7. Per-row Reset, then Restore all defaults.
    const resetRow = state(report, "resetRow");
    assert.equal(row(resetRow, "history.back").binding, "Alt+ArrowLeft", "Reset did not restore the default");
    assert.deepEqual(row(resetRow, "history.back").keycaps, ["Alt", "←"]);
    assert.equal(row(resetRow, "history.back").customized, false, "Reset left the row customized");
    assert.equal(row(resetRow, "history.back").defaultText, null, "Reset left the Default line up");
    assert.deepEqual(
      storedBindings(resetRow),
      { "wing.next": "Ctrl+Alt+N" },
      `Reset left the cleared override behind: ${resetRow.storage}`,
    );

    const resetAll = state(report, "resetAll");
    assert.deepEqual(storedBindings(resetAll), {}, `Restore all left overrides: ${resetAll.storage}`);
    for (const item of resetAll.rows) {
      assert.equal(item.customized, false, `${item.id} survived Restore all as customized`);
      assert.equal(item.binding, DEFAULTS[item.id], `${item.id} is not back on its default`);
    }
    assert.equal(resetAll.resetAll.disabled, true, "Restore all defaults stayed enabled on an all-default page");

    // —— 8. Persistence: the custom binding and the movement survive a reload.
    const afterReload = state(report, "afterReload");
    assert.equal(afterReload.path, "/home", "the reloaded window did not start on /home");
    assert.deepEqual(
      storedBindings(afterReload),
      { "wing.next": "Ctrl+Alt+N" },
      `the stored override did not survive the reload: ${afterReload.storage}`,
    );
    const reloadPage = state(report, "reloadPage");
    assert.equal(row(reloadPage, "wing.next").binding, "Ctrl+Alt+N", "the reloaded page lost the binding");
    assert.equal(row(reloadPage, "wing.next").customized, true, "the reloaded row is not customized");
    assert.equal(
      row(reloadPage, "wing.next").defaultText,
      "Default: Ctrl + PgDn",
      "the reloaded row lost its Default line",
    );
    const reloadMovement = state(report, "reloadMovement");
    assert.equal(reloadMovement.path, "/dream", "the custom key stopped moving after the reload");
    assert.equal(reloadMovement.selectedWing, "Define");

    // —— 9. Typing guard: the character lands, the bare key does not fire,
    //       and the same key moves once the caret leaves the field.
    const bareBinding = state(report, "bareBinding");
    assert.equal(row(bareBinding, "wing.next").binding, "N", `bare key binding ${row(bareBinding, "wing.next").binding}`);
    assert.deepEqual(storedBindings(bareBinding), { "wing.next": "N" });

    const typingGuarded = state(report, "typingGuarded");
    assert.equal(typingGuarded.input.value, "n", `the field value is ${JSON.stringify(typingGuarded.input.value)}`);
    assert.equal(typingGuarded.input.focused, true, "the field does not have the caret");
    assert.equal(typingGuarded.path, "/home", "the bare binding fired while typing");
    assert.equal(typingGuarded.selectedWing, "Home", "the wing changed while typing");

    const typingReleased = state(report, "typingReleased");
    assert.equal(typingReleased.path, "/dream", "the bare binding did not fire after blur");
    assert.equal(typingReleased.selectedWing, "Define", "the wing did not change after blur");

    // —— 10. The shipped movements: panels, page steps, wing jump, settings.
    assert.equal(
      String(state(report, "navCollapsed").shellClass).includes("shell--nav-collapsed"),
      true,
      "Ctrl+B did not collapse the sidebar",
    );
    assert.equal(
      String(state(report, "navExpanded").shellClass).includes("shell--nav-collapsed"),
      false,
      "Ctrl+B did not expand the sidebar again",
    );
    const chatCollapsed = state(report, "chatCollapsed");
    assert.equal(String(chatCollapsed.shellClass).includes("shell--chat-collapsed"), true, "Ctrl+J did not collapse chat");
    assert.equal(chatCollapsed.chatPanel, false, "the chat panel survived Ctrl+J");
    const chatOpen = state(report, "chatOpen");
    assert.equal(String(chatOpen.shellClass).includes("shell--chat-open"), true, "Ctrl+J did not reopen chat");
    assert.equal(chatOpen.chatPanel, true, "the chat panel did not come back");
    assert.equal(state(report, "pageOne").path, "/data", "Ctrl+Shift+PageDown did not step to Data");
    assert.equal(state(report, "pageTwo").path, "/pages", "Ctrl+Shift+PageDown did not step to Pages");
    const pageBack = state(report, "pageBack");
    assert.equal(pageBack.path, "/data", "Ctrl+Shift+PageUp did not step back to Data");
    assert.equal(pageBack.selectedWing, "Home", "the reverse page step left the home wing");
    const directWing = state(report, "directWing");
    assert.equal(directWing.path, "/dream", "Ctrl+2 did not jump to Dream");
    assert.equal(directWing.selectedWing, "Define", "Ctrl+2 left the wing tab on the wrong wing");
    const settingsOpened = state(report, "settingsOpened");
    assert.equal(settingsOpened.overlayOpen, true, "Ctrl+Comma did not open settings");
    assert.equal(settingsOpened.path, "/settings", "Ctrl+Comma did not enter the settings route");
    const settingsClosed = state(report, "settingsClosed");
    assert.equal(settingsClosed.overlayOpen, false, "Escape did not close the settings sheet");
    assert.equal(settingsClosed.path, "/dream", "closing settings did not return to the page it covered");

    // The repeatable artifact: a JSON report plus the frames it measured.
    assert.equal(report.screenshots.length, SHOTS.length, `the run recorded ${report.screenshots.length} screenshots`);
    for (const shot of SHOTS) {
      assert.ok(report.screenshots.includes(shot), `the run did not record ${shot}`);
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts", shot)),
        true,
        `${shot} was reported but not written`,
      );
    }
  });
});
