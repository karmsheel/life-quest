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
  "keyboard-shortcuts-dock.png",
  "keyboard-shortcuts-dock-live.png",
  "keyboard-shortcuts-dock-editing.png",
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

type DockRowState = {
  id: string;
  label: string;
  binding: string;
  changed: boolean;
  recording: boolean;
  prompt: boolean;
  edit: { present: boolean; label: string | null; title: string | null };
  cancel: { present: boolean; label: string | null };
  keysValue: string | null;
  keycaps: string[];
};

type DockState = {
  surface: string | null;
  ariaLabel: string | null;
  shortcutsHeading: string;
  back: { present: boolean; label: string | null };
  pencil: { present: boolean; label: string | null; href: string | null };
  footerHidden: boolean | null;
  footerVisible: boolean;
  composerVisible: boolean;
  bodyVisible: boolean;
  shortcutsRoot: boolean;
  hint: string;
  editCount: number;
  recordingPromptCount: number;
  editingError: string | null;
  groups: Array<{ id: string | null; rows: string[] }>;
  rows: DockRowState[];
};

type TitlebarChild = {
  tag: string;
  className: string;
  label: string | null;
  pressed: string | null;
  icon: string | null;
};

type TitlebarState = {
  shortcuts: {
    present: boolean;
    label: string | null;
    title: string | null;
    pressed: string | null;
    icon: string | null;
    inTrailing: boolean;
  };
  trailing: TitlebarChild[];
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
  dock: DockState | null;
  titlebar: TitlebarState;
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

const dockRow = (snapshot: State, id: string): DockRowState => {
  const found = (snapshot.dock?.rows ?? []).find((row) => row.id === id);
  assert.ok(found, `the dock has no ${id} row`);
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

    // —— The dock's keyboard-shortcuts reference: the titlebar control, the
    //       read-only page it opens, and Back to the thread.
    const dockThread = state(report, "dockThread");
    assert.equal(
      dockThread.dock?.surface,
      "thread",
      "the dock did not start on the thread surface",
    );
    assert.equal(
      dockThread.dock?.composerVisible,
      true,
      "the thread surface has no visible composer",
    );
    assert.equal(
      dockThread.titlebar.shortcuts.present,
      true,
      "the titlebar carries no shortcuts control",
    );
    assert.equal(
      dockThread.titlebar.shortcuts.label,
      "Keyboard shortcuts",
      `the control's aria-label is ${JSON.stringify(dockThread.titlebar.shortcuts.label)}`,
    );
    assert.equal(
      dockThread.titlebar.shortcuts.title,
      "Keyboard shortcuts",
      `the control's title is ${JSON.stringify(dockThread.titlebar.shortcuts.title)}`,
    );
    assert.equal(
      dockThread.titlebar.shortcuts.pressed,
      "false",
      "the control reports pressed while the dock is on a thread",
    );
    assert.equal(
      dockThread.titlebar.shortcuts.inTrailing,
      true,
      "the control is not in the titlebar's trailing cluster",
    );
    const trailingClasses = dockThread.titlebar.trailing.map((child) => child.className);
    const shortcutsAt = trailingClasses.findIndex((name) =>
      name.includes("window-titlebar__shortcuts"),
    );
    const settingsAt = trailingClasses.findIndex((name) => name.includes("settings-menu"));
    assert.equal(
      shortcutsAt,
      settingsAt - 1,
      `the shortcuts control is not immediately before the settings menu: ${JSON.stringify(trailingClasses)}`,
    );
    const expectedTrailing = [
      "theme-mode-toggle",
      "window-titlebar__shortcuts",
      "settings-menu",
      "window-titlebar__side-switch",
      "window-titlebar__chat-toggle",
    ];
    expectedTrailing.forEach((needle, index) => {
      assert.ok(
        String(trailingClasses[index] ?? "").includes(needle),
        `trailing child ${index} is not ${needle}: ${JSON.stringify(trailingClasses)}`,
      );
    });

    const dockDefaults = state(report, "dockDefaults");
    const dock = dockDefaults.dock;
    assert.ok(dock, "the titlebar control did not open the dock onto its page");
    assert.equal(dock.surface, "shortcuts", `dock surface ${dock.surface}`);
    assert.equal(
      dock.shortcutsHeading,
      "Keyboard shortcuts",
      `dock heading ${JSON.stringify(dock.shortcutsHeading)}`,
    );
    assert.equal(dock.back.present, true, "the dock page has no Back control");
    assert.equal(dock.back.label, "Back to chat", `Back label ${dock.back.label}`);
    assert.equal(dock.pencil.present, true, "the dock page has no Settings pencil");
    assert.equal(
      dock.pencil.label,
      "Change keyboard shortcuts in Settings",
      `pencil label ${dock.pencil.label}`,
    );
    assert.equal(
      dock.pencil.href,
      "/settings?tab=shortcuts",
      `pencil href ${dock.pencil.href}`,
    );
    assert.equal(dock.shortcutsRoot, true, "the dock body has no [data-chat-shortcuts]");
    assert.equal(dock.rows.length, 14, `the dock lists ${dock.rows.length} rows, not 14`);
    assert.deepEqual(
      dock.groups.map((group) => ({ id: group.id, rows: group.rows.length })),
      GROUPS,
      `dock groups ${JSON.stringify(dock.groups)}`,
    );
    for (const [id, binding] of Object.entries(DEFAULTS)) {
      assert.equal(
        dockRow(dockDefaults, id).binding,
        binding,
        `dock row ${id} is not on its default binding`,
      );
    }
    for (const item of dock.rows) {
      assert.equal(item.changed, false, `dock row ${item.id} is marked changed on a defaults page`);
    }
    assert.deepEqual(dockRow(dockDefaults, "wing.next").keycaps, ["Ctrl", "PgDn"]);
    assert.deepEqual(dockRow(dockDefaults, "history.back").keycaps, ["Alt", "←"]);
    assert.deepEqual(dockRow(dockDefaults, "surface.settings.open").keycaps, ["Ctrl", ","]);
    assert.match(
      dock.hint,
      /All on their default keys\./,
      `dock hint ${JSON.stringify(dock.hint)}`,
    );
    assert.equal(dock.footerHidden, true, "the reference kept the chat footer visible");
    assert.equal(dock.footerVisible, false, "the reference footer is painted");
    assert.equal(dock.composerVisible, false, "the reference kept a visible composer");
    assert.equal(dock.bodyVisible, true, "the reference body is not painted");
    assert.equal(
      dockDefaults.titlebar.shortcuts.pressed,
      "true",
      "the titlebar control does not report pressed on its page",
    );

    const dockBack = state(report, "dockBackToThread");
    assert.equal(dockBack.dock?.surface, "thread", "Back did not return the dock to the thread");
    assert.equal(dockBack.dock?.composerVisible, true, "the thread did not get its composer back");
    assert.equal(
      dockBack.titlebar.shortcuts.pressed,
      "false",
      "the titlebar control stayed pressed after Back",
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

    // —— The dock reads the same provider the Settings page writes: the row
    //       just rebound shows its new keys, the hint counts it, and the pencil
    //       opens the editable page without closing the dock.
    const dockLive = state(report, "dockLive");
    assert.equal(dockLive.dock?.surface, "shortcuts", "the dock is not on the reference");
    const liveDockRow = dockRow(dockLive, "wing.next");
    assert.equal(
      liveDockRow.binding,
      "Ctrl+Alt+N",
      `the dock row shows ${liveDockRow.binding}, not the freshly stored binding`,
    );
    assert.equal(liveDockRow.changed, true, "the customized row is not marked changed in the dock");
    assert.deepEqual(liveDockRow.keycaps, ["Ctrl", "Alt", "N"]);
    assert.match(
      dockLive.dock?.hint ?? "",
      /1 movement is changed from the defaults\./,
      `dock hint ${JSON.stringify(dockLive.dock?.hint)}`,
    );
    assert.deepEqual(
      (dockLive.dock?.rows ?? []).filter((item) => item.changed).map((item) => item.id),
      ["wing.next"],
      "the dock marks more than the one rebound movement as changed",
    );

    const dockPencil = state(report, "dockPencilSettings");
    assert.equal(dockPencil.overlayOpen, true, "the pencil did not open the settings sheet");
    assert.equal(
      dockPencil.path,
      "/settings?tab=shortcuts",
      `the pencil landed on ${dockPencil.path}`,
    );
    assert.equal(dockPencil.viewedTab, "shortcuts", "the pencil did not open the shortcuts panel");
    assert.equal(dockPencil.pageTitle, "Keyboard shortcuts", `page title ${dockPencil.pageTitle}`);
    assert.equal(dockPencil.dock?.surface, "shortcuts", "the dock left its reference behind the sheet");

    const dockAfterSettings = state(report, "dockAfterSettingsClose");
    assert.equal(dockAfterSettings.overlayOpen, false, "Escape did not close the settings sheet");
    assert.equal(dockAfterSettings.path, "/home", `closing the sheet landed on ${dockAfterSettings.path}`);
    assert.equal(
      String(dockAfterSettings.shellClass).includes("shell--chat-open"),
      true,
      "closing the sheet collapsed the dock",
    );
    assert.equal(
      dockAfterSettings.dock?.surface,
      "shortcuts",
      "Escape took the dock off its reference instead of just closing the sheet",
    );
    assert.equal(
      dockAfterSettings.titlebar.shortcuts.pressed,
      "true",
      "the titlebar control stopped reporting pressed while the dock stayed on the page",
    );

    const dockBackAfterSettings = state(report, "dockBackAfterSettings");
    assert.equal(
      dockBackAfterSettings.dock?.surface,
      "thread",
      "the dock did not return to the thread after the settings visit",
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

    // —— A collapsed dock opens straight onto the reference, and the
    //       chat-resume effect does not replace the requested surface.
    const dockCollapsed = state(report, "dockCollapsedForShortcuts");
    assert.equal(dockCollapsed.chatPanel, false, "the chat toggle left the dock mounted");
    assert.equal(
      String(dockCollapsed.shellClass).includes("shell--chat-collapsed"),
      true,
      "the chat toggle did not collapse the dock",
    );
    assert.equal(
      dockCollapsed.titlebar.shortcuts.pressed,
      "false",
      "the titlebar control reports pressed while the dock is collapsed",
    );

    const dockReopened = state(report, "dockReopenedOnShortcuts");
    assert.equal(dockReopened.chatPanel, true, "the control did not open the collapsed dock");
    assert.equal(
      String(dockReopened.shellClass).includes("shell--chat-open"),
      true,
      `the reopened shell is ${JSON.stringify(dockReopened.shellClass)}`,
    );
    assert.equal(dockReopened.dock?.surface, "shortcuts", "the reopened dock is not on the reference");
    assert.equal(
      dockReopened.titlebar.shortcuts.pressed,
      "true",
      "the titlebar control does not report pressed on the reopened page",
    );
    assert.equal(dockReopened.dock?.footerHidden, true, "the reopened reference kept its footer");
    assert.equal(dockReopened.dock?.composerVisible, false, "the reopened reference kept a composer");
    assert.equal(dockReopened.dock?.rows.length, 14, "the reopened reference lost rows");

    const dockReopenedSettled = state(report, "dockReopenedSettled");
    assert.equal(
      dockReopenedSettled.dock?.surface,
      "shortcuts",
      "the chat-resume effect replaced the surface the titlebar control asked for",
    );
    assert.equal(
      dockReopenedSettled.path,
      "/dream",
      `reopening the dock navigated the page behind it to ${dockReopenedSettled.path}`,
    );

    const dockReopenedBack = state(report, "dockReopenedBack");
    assert.equal(dockReopenedBack.dock?.surface, "thread", "Back did not return the reopened dock to the thread");

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

    // —— 11. The dock's page is an editor too: every row has its own pencil,
    //       the provider's one recorder runs without opening the settings
    //       sheet, refusals stay on the page, and the saved key moves the shell.
    const dockEditingSetup = state(report, "dockEditingSetup");
    assert.deepEqual(
      storedBindings(dockEditingSetup),
      {},
      `the set-up reset left overrides behind: ${dockEditingSetup.storage}`,
    );

    const dockEditReady = state(report, "dockEditReady");
    const editDock = dockEditReady.dock;
    assert.ok(editDock, "the dock is not open on its shortcuts page");
    assert.equal(editDock.surface, "shortcuts", "the dock is not on the shortcuts surface");
    assert.equal(editDock.editCount, 14, `the dock page has ${editDock.editCount} edit pencils, not 14`);
    assert.equal(editDock.rows.length, 14, `the dock page lists ${editDock.rows.length} rows, not 14`);
    for (const item of editDock.rows) {
      assert.equal(item.edit.present, true, `the ${item.id} row has no edit pencil`);
      assert.equal(
        item.edit.label,
        `Change shortcut for ${item.label}`,
        `the ${item.id} pencil is labelled ${JSON.stringify(item.edit.label)}`,
      );
    }
    assert.deepEqual(
      editDock.groups.map((group) => ({ id: group.id, rows: group.rows.length })),
      GROUPS,
      `the pencils do not cover all four dock groups: ${JSON.stringify(editDock.groups)}`,
    );
    assert.equal(
      editDock.pencil.present,
      true,
      "the dock page lost its header pencil to Settings",
    );
    assert.equal(
      editDock.pencil.label,
      "Change keyboard shortcuts in Settings",
      `the header pencil is labelled ${JSON.stringify(editDock.pencil.label)}`,
    );
    assert.equal(editDock.recordingPromptCount, 0, "a dock row was already recording");
    assert.equal(editDock.editingError, null, "a dock error was already up");

    const dockRecording = state(report, "dockRecording");
    const recordingDockRow = dockRow(dockRecording, "panel.sidebar.toggle");
    assert.equal(recordingDockRow.recording, true, "the Toggle sidebar row did not start recording");
    assert.equal(recordingDockRow.prompt, true, "the recording prompt is missing from the dock row");
    assert.deepEqual(recordingDockRow.keycaps, [], "the recording dock row still draws keycaps");
    assert.equal(
      dockRecording.dock?.recordingPromptCount,
      1,
      "the dock page shows more than the one recording prompt",
    );
    assert.equal(recordingDockRow.cancel.present, true, "the recording dock row has no cancel control");
    assert.equal(
      recordingDockRow.cancel.label,
      "Cancel changing the shortcut for Toggle sidebar",
      `the dock cancel is labelled ${JSON.stringify(recordingDockRow.cancel.label)}`,
    );
    assert.equal(recordingDockRow.edit.present, false, "the dock pencil is still drawn while recording");
    assert.equal(dockRecording.overlayOpen, false, "clicking a dock pencil opened the settings sheet");
    assert.equal(dockRecording.dock?.surface, "shortcuts", "the dock left its page while recording");

    const dockSaved = state(report, "dockSaved");
    const savedDockRow = dockRow(dockSaved, "panel.sidebar.toggle");
    assert.equal(savedDockRow.binding, "Ctrl+Alt+Y", `the dock saved ${savedDockRow.binding}`);
    assert.equal(savedDockRow.changed, true, "the saved dock row is not marked changed");
    assert.deepEqual(savedDockRow.keycaps, ["Ctrl", "Alt", "Y"]);
    assert.equal(savedDockRow.recording, false, "the dock row is still recording after saving");
    assert.equal(savedDockRow.edit.present, true, "the pencil did not return after saving");
    assert.deepEqual(
      storedBindings(dockSaved),
      { "panel.sidebar.toggle": "Ctrl+Alt+Y" },
      `storage after the dock save: ${dockSaved.storage}`,
    );
    assert.match(
      dockSaved.dock?.hint ?? "",
      /1 movement is changed from the defaults\./,
      `dock hint ${JSON.stringify(dockSaved.dock?.hint)}`,
    );
    assert.equal(dockSaved.overlayOpen, false, "saving from the dock opened the settings sheet");

    const dockEditHome = state(report, "dockEditHome");
    assert.equal(dockEditHome.path, "/home", `the movement step ran on ${dockEditHome.path}`);
    const dockEditCollapsed = state(report, "dockEditCollapsed");
    assert.equal(
      String(dockEditCollapsed.shellClass).includes("shell--nav-collapsed"),
      true,
      "Ctrl+Alt+Y did not collapse the sidebar",
    );
    const dockEditExpanded = state(report, "dockEditExpanded");
    assert.equal(
      String(dockEditExpanded.shellClass).includes("shell--nav-collapsed"),
      false,
      "Ctrl+Alt+Y did not expand the sidebar again",
    );

    const dockConflictRecording = state(report, "dockConflictRecording");
    assert.equal(
      dockRow(dockConflictRecording, "surface.settings.open").recording,
      true,
      "the Open settings row did not start recording",
    );
    const dockConflict = state(report, "dockConflict");
    assert.match(
      dockConflict.dock?.editingError ?? "",
      /Next wing/,
      `the dock conflict does not name Next wing: ${JSON.stringify(dockConflict.dock?.editingError)}`,
    );
    assert.equal(
      dockRow(dockConflict, "surface.settings.open").binding,
      "Ctrl+Comma",
      "the refused dock row lost its binding",
    );
    assert.equal(
      dockRow(dockConflict, "surface.settings.open").recording,
      true,
      "the refused dock row stopped recording",
    );
    assert.equal(dockConflict.path, "/home", "the refused Ctrl+PageDown fired the runner and navigated");
    assert.equal(dockConflict.overlayOpen, false, "the dock conflict opened the settings sheet");

    const dockConflictCancelled = state(report, "dockConflictCancelled");
    assert.equal(dockConflictCancelled.dock?.editingError, null, "the dock error survived Escape");
    assert.equal(
      dockRow(dockConflictCancelled, "surface.settings.open").recording,
      false,
      "the dock recording survived Escape",
    );
    assert.equal(
      dockConflictCancelled.dock?.surface,
      "shortcuts",
      "Escape took the dock off its shortcuts page",
    );

    const dockReserved = state(report, "dockReserved");
    assert.match(
      dockReserved.dock?.editingError ?? "",
      /reserved/i,
      `the dock did not refuse Ctrl+W as reserved: ${JSON.stringify(dockReserved.dock?.editingError)}`,
    );
    assert.equal(
      dockRow(dockReserved, "history.back").binding,
      "Alt+ArrowLeft",
      "the reserved refusal rebound Back in the dock",
    );
    assert.equal(dockRow(dockReserved, "history.back").recording, true, "the reserved refusal ended recording");
    const dockReservedCancelled = state(report, "dockReservedCancelled");
    assert.equal(dockReservedCancelled.dock?.editingError, null, "the dock reserved error survived Escape");

    const dockCleared = state(report, "dockCleared");
    const clearedDockRow = dockRow(dockCleared, "history.back");
    assert.equal(clearedDockRow.binding, "unassigned", "Backspace did not clear the dock row");
    assert.equal(clearedDockRow.changed, true, "the cleared dock row is not marked changed");
    assert.deepEqual(clearedDockRow.keycaps, [], "the cleared dock row still draws keycaps");
    assert.deepEqual(
      storedBindings(dockCleared),
      { "panel.sidebar.toggle": "Ctrl+Alt+Y", "history.back": null },
      `storage after the dock clear: ${dockCleared.storage}`,
    );
    assert.match(
      dockCleared.dock?.hint ?? "",
      /2 movements are changed from the defaults\./,
      `dock hint after the clear ${JSON.stringify(dockCleared.dock?.hint)}`,
    );
    assert.equal(dockCleared.dock?.surface, "shortcuts", "the dock left its page after the clear");
    assert.equal(dockCleared.overlayOpen, false, "the dock clear opened the settings sheet");

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
