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
const REPORT = path.join(desktopRoot, "e2e/artifacts/vault-switcher.json");

/** The vaults the harness holds: one open, and the two it can switch to. */
const VAULT_A = { id: "vault-a", name: "Harness Vault A", path: "/harness/vault-a" };
const VAULT_B = { id: "vault-b", name: "Harness Vault B", path: "/harness/vault-b" };
const VAULT_C = { id: "vault-c", name: "Harness Vault C", path: "/harness/vault-c" };
const REFUSAL = "No LifeQuest vault in that folder.";

type Calls = { dialog: (string | null)[]; open: string[]; recent: number };

type Row = {
  path: string;
  name: string;
  pathText: string;
  current: boolean;
  openNow: string;
  disabled: boolean;
};

type State = {
  viewport: { width: number; height: number };
  chip: {
    tag: string;
    text: string;
    haspopup: string | null;
    expanded: string | null;
    focused: boolean;
    appRegion: string;
  } | null;
  dialog: {
    title: string;
    alert: string;
    busy: boolean;
    activeInside: boolean;
    portal: boolean;
    rows: Row[];
    folder: { label: string; disabled: boolean; className: string } | null;
    close: { label: string | null; disabled: boolean } | null;
  } | null;
  rects: Record<string, { left: number; top: number; width: number; height: number } | null>;
  probe: { vault: string | null; recents: number } | null;
  location: { pathname: string | null; key: string | null } | null;
  trail: string[];
  calls: Calls;
};

type Report = {
  url: string;
  window: { width: number; height: number };
  states: Record<string, State>;
  screenshots: string[];
  failures: string[];
  pass: boolean;
};

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
      [path.join(desktopRoot, "e2e/vault-switcher.electron.mjs")],
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

const currentRows = (state: State) =>
  (state.dialog?.rows ?? []).filter((row) => row.current);

const otherRows = (state: State) =>
  (state.dialog?.rows ?? []).filter((row) => !row.current);

describe("the titlebar vault switcher", () => {
  it("switches the open vault from the chip, and survives a cancelled and a refused folder", async (t) => {
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
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    const {
      landing,
      opened,
      escaped,
      scrimmed,
      cancelled,
      inFlight,
      switched,
      refused,
      dismissed,
      reopened,
    } = report.states;

    // A repeatable artifact, not just a pass flag: every state has its picture
    // beside the JSON, on disk, for an operator to open later.
    for (const name of ["landing", "open", "in-flight", "switched", "refused"]) {
      assert.ok(
        report.screenshots.includes(`vault-switcher-${name}.png`),
        `the ${name} screenshot was not written`,
      );
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts/vault-switcher-" + name + ".png")),
        true,
        `e2e/artifacts/vault-switcher-${name}.png is missing`,
      );
    }

    // The dead control the human reported is gone: the chip is a button that
    // promises a dialog, the chip is still the vault's name, and nothing is
    // asked before it is clicked.
    assert.equal(landing.chip?.tag, "BUTTON", "the chip is not a button");
    assert.equal(landing.chip?.text, VAULT_A.name, "the chip lost the vault's name");
    assert.equal(landing.chip?.haspopup, "dialog", "the chip does not announce a dialog");
    assert.equal(landing.chip?.expanded, "false", "the chip claims an open dialog");
    assert.equal(landing.chip?.appRegion, "no-drag", "the chip is not clickable");
    assert.equal(landing.dialog, null, "a dialog was drawn before the click");
    assert.equal(landing.probe?.vault, VAULT_A.path, "the page did not boot on vault A");
    assert.equal(landing.probe?.recents, 3, "the provider never read its recents");
    assert.deepEqual(landing.calls.dialog, [], "the picker was asked before a click");
    assert.deepEqual(landing.calls.open, [], "a vault was opened before a click");

    // The click opens the modal, listing exactly the provider's recents, with
    // the open vault marked and the others live.
    assert.equal(opened.dialog?.title, "Switch vault", "the dialog has no title");
    assert.equal(opened.chip?.expanded, "true", "the chip does not read as expanded");
    assert.deepEqual(
      opened.dialog?.rows.map((row) => row.path),
      [VAULT_A.path, VAULT_B.path, VAULT_C.path],
      "the dialog does not list the recents",
    );
    assert.deepEqual(
      opened.dialog?.rows.map((row) => row.name),
      [VAULT_A.name, VAULT_B.name, VAULT_C.name],
      "the rows do not carry the vault names",
    );
    assert.equal(currentRows(opened).length, 1, "the open vault is not marked exactly once");
    assert.equal(currentRows(opened)[0]?.path, VAULT_A.path, "the wrong row is marked open");
    assert.equal(currentRows(opened)[0]?.openNow, "Open now", "the marked row has no status word");
    assert.equal(
      opened.dialog?.rows.find((row) => row.path === VAULT_A.path)?.disabled,
      true,
      "the already-open vault's row is a live switch",
    );
    assert.deepEqual(
      otherRows(opened).map((row) => row.disabled),
      [false, false],
      "a row for another vault is closed before anything is asked",
    );
    assert.equal(
      opened.dialog?.folder?.label,
      "Open another folder…",
      "the dialog has no way to an unseen folder",
    );
    assert.match(opened.dialog?.folder?.className ?? "", /\bbtn\b/, "the folder action is not the app's Button");
    assert.equal(opened.dialog?.close?.label, "Close vault switcher", "the close control is unlabelled");
    assert.equal(opened.dialog?.activeInside, true, "focus did not move into the dialog");
    assert.equal(opened.dialog?.portal, true, "the dialog is not portalled out of the titlebar");
    assert.deepEqual(opened.calls.dialog, [], "opening the dialog asked the picker");
    assert.deepEqual(opened.calls.open, [], "opening the dialog opened a vault");

    // Escape and the scrim both dismiss, and both hand focus back to the chip.
    assert.equal(escaped.dialog, null, "Escape left the dialog up");
    assert.equal(escaped.chip?.expanded, "false", "Escape left the chip expanded");
    assert.equal(escaped.chip?.focused, true, "Escape did not return focus to the chip");
    assert.deepEqual(escaped.calls.dialog, [], "Escape asked the picker");
    assert.deepEqual(escaped.calls.open, [], "Escape opened a vault");
    assert.equal(scrimmed.dialog, null, "the scrim left the dialog up");
    assert.equal(scrimmed.chip?.focused, true, "the scrim did not return focus to the chip");

    // A cancelled picker is the half that must open nothing, and must not close
    // the dialog the operator is still looking at.
    assert.deepEqual(cancelled.calls.dialog, [null], "the cancelled ask did not reach the picker");
    assert.deepEqual(cancelled.calls.open, [], "a cancelled picker opened a vault");
    assert.ok(cancelled.dialog, "a cancelled picker closed the dialog");
    assert.equal(cancelled.chip?.text, VAULT_A.name, "a cancelled picker moved the chip");
    assert.equal(cancelled.probe?.vault, VAULT_A.path, "a cancelled picker moved the vault");
    assert.equal(cancelled.dialog?.alert, "", "a cancelled picker reported an error");
    assert.equal(cancelled.dialog?.folder?.disabled, false, "the folder action stayed closed");
    assert.deepEqual(
      otherRows(cancelled).map((row) => row.disabled),
      [false, false],
      "the rows stayed closed after a cancel",
    );

    // Picking a row is an open of exactly that path — never a picker ask — and
    // mid-flight the whole dialog is closed for further switches.
    assert.deepEqual(inFlight.calls.open, [VAULT_B.path], "the row click opened the wrong path");
    assert.deepEqual(
      inFlight.calls.dialog,
      [null],
      "picking a recent vault asked the platform picker",
    );
    assert.ok(inFlight.dialog, "the dialog closed while the open was in flight");
    assert.equal(inFlight.dialog?.busy, true, "the dialog does not say it is busy");
    assert.equal(
      inFlight.dialog?.rows.every((row) => row.disabled),
      true,
      "a row stayed live while the open was in flight",
    );
    assert.equal(inFlight.dialog?.folder?.disabled, true, "the folder action stayed live mid-open");
    assert.equal(inFlight.dialog?.folder?.label, "Opening…", "the folder action does not say it is working");
    assert.equal(inFlight.dialog?.close?.disabled, true, "the dialog could be dismissed mid-open");
    assert.equal(inFlight.chip?.text, VAULT_A.name, "the page moved before the open finished");
    assert.equal(inFlight.probe?.vault, VAULT_A.path, "the vault moved before the open finished");
    assert.equal(inFlight.location?.key, landing.location?.key, "navigation happened mid-open");

    // The switch itself: dialog gone, the chip wears the new name, the recents
    // are re-read, and the operator is on /home.
    assert.equal(switched.dialog, null, "the dialog outlived the switch");
    assert.equal(switched.chip?.expanded, "false", "the chip still reads as expanded");
    assert.equal(switched.chip?.text, VAULT_B.name, "the chip did not take the new vault's name");
    assert.equal(switched.probe?.vault, VAULT_B.path, "the page did not take the new vault");
    assert.deepEqual(switched.calls.open, [VAULT_B.path], "the switch opened more than one vault");
    assert.ok(
      switched.calls.recent > inFlight.calls.recent,
      `the recent list was not re-read: ${inFlight.calls.recent} → ${switched.calls.recent}`,
    );
    assert.equal(switched.location?.pathname, "/home", "the switch is not on /home");
    assert.notEqual(
      switched.location?.key,
      landing.location?.key,
      "the switch never navigated (the location key did not move)",
    );
    assert.equal(
      switched.trail[switched.trail.length - 1],
      `/home|${switched.location?.key}`,
      "the router never saw the home navigation",
    );
    assert.equal(switched.chip?.focused, true, "focus did not return to the chip after the switch");

    // A refused folder: the refusal is named in the dialog, the old vault stays
    // open, the location does not move, and another attempt is one click away.
    assert.ok(refused.dialog, "a refused folder closed the dialog");
    assert.equal(refused.dialog?.alert, REFUSAL, "the refusal did not reach the operator");
    assert.equal(refused.chip?.text, VAULT_B.name, "a refused open moved the chip");
    assert.equal(refused.probe?.vault, VAULT_B.path, "a refused open moved the vault");
    assert.equal(
      refused.calls.open[refused.calls.open.length - 1],
      VAULT_C.path,
      "the refused open carried the wrong folder",
    );
    assert.equal(refused.location?.key, switched.location?.key, "a refused open navigated");
    assert.equal(refused.dialog?.folder?.disabled, false, "a refused open closed the folder action");
    assert.equal(
      otherRows(refused).every((row) => !row.disabled),
      true,
      "a refused open left the remaining rows closed",
    );

    // Finally, a refusal is not a trap, and the next opening starts from a clean
    // slate rather than the last refusal.
    assert.equal(dismissed.dialog, null, "the refusal trapped the operator in the dialog");
    assert.equal(dismissed.chip?.focused, true, "closing after a refusal lost the focus");
    assert.equal(reopened.dialog?.alert, "", "the last refusal greeted the next opening");
  });
});
