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
const REPORT = path.join(desktopRoot, "e2e/artifacts/settings-vault.json");

/** The two vaults the harness holds: open on load, and the one it switches to. */
const VAULT_A = { id: "vault-a", name: "Harness Vault A", path: "/harness/vault-a" };
const VAULT_B = { id: "vault-b", name: "Harness Vault B", path: "/harness/vault-b" };
const REFUSAL = "No LifeQuest vault in that folder.";

type Calls = { dialog: (string | null)[]; open: string[]; recent: number };

type State = {
  viewport: { width: number; height: number };
  identity: { label: string; value: string }[];
  vaultName: string | null;
  vaultId: string | null;
  vaultPath: string | null;
  folderRowLabel: string | null;
  folderRowDescription: string | null;
  button: { label: string; className: string; disabled: boolean } | null;
  error: string | null;
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
      [path.join(desktopRoot, "e2e/settings-vault.electron.mjs")],
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

describe("the settings vault-folder switch", () => {
  it("points the open vault at another folder, and survives a refused one", async (t) => {
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

    const { landing, cancelled, inFlight, switched, refused } = report.states;

    // The page is the real settings page, naming the vault that is open, and it
    // offers a control that is live before anything is asked.
    assert.equal(landing.vaultPath, VAULT_A.path, "the open vault's path");
    assert.equal(landing.vaultId, VAULT_A.id, "the open vault's id");
    assert.equal(landing.vaultName, VAULT_A.name, "the open vault's name");
    assert.equal(landing.folderRowLabel, "Vault folder", "the folder row's label");
    assert.ok(landing.button, "the folder row carries no control");
    assert.equal(landing.button?.label, "Change folder…", "the control's own label");
    assert.equal(landing.button?.disabled, false, "the control was closed before any click");
    assert.match(landing.button?.className ?? "", /btn/, "the control is not the app's Button");
    assert.match(
      landing.folderRowDescription ?? "",
      /vault folder/i,
      "the row does not say what the switch does",
    );
    assert.deepEqual(landing.calls.dialog, [], "the picker was asked before a click");
    assert.deepEqual(landing.calls.open, [], "a vault was opened before a click");
    assert.equal(landing.error, null, "an error was on screen before a click");

    // A cancelled picker is the half that has to open nothing.
    assert.deepEqual(cancelled.calls.dialog, [null], "the cancelled ask did not reach the picker");
    assert.deepEqual(cancelled.calls.open, [], "a cancelled picker opened a vault");
    assert.equal(cancelled.vaultPath, VAULT_A.path, "a cancelled picker moved the open vault");
    assert.equal(cancelled.error, null, "a cancelled picker reported an error");
    assert.equal(cancelled.button?.disabled, false, "the control stayed closed after a cancel");

    // While the open is in flight the control is closed, so a second dialog
    // cannot be asked over the first one.
    assert.equal(inFlight.button?.disabled, true, "the control was live mid-open");
    assert.equal(inFlight.button?.label, "Opening…", "the control did not say it was working");
    assert.deepEqual(inFlight.calls.open, [VAULT_B.path], "the open carried the wrong folder");
    assert.equal(inFlight.vaultPath, VAULT_A.path, "the page moved before the open finished");

    // The switch itself: the folder the picker answered, then the new vault's
    // identity, and a recent list re-read so the next start reopens it.
    assert.equal(
      switched.calls.dialog[switched.calls.dialog.length - 1],
      VAULT_B.path,
      "the switch opened a folder the picker never returned",
    );
    assert.deepEqual(switched.calls.open, [VAULT_B.path], "the switch opened more than one vault");
    assert.equal(switched.vaultPath, VAULT_B.path, "the switch did not move the path");
    assert.equal(switched.vaultId, VAULT_B.id, "the switch did not move the vault id");
    assert.equal(switched.vaultName, VAULT_B.name, "the switch did not move the vault name");
    assert.ok(
      switched.calls.recent > landing.calls.recent,
      `the recent list was not re-read: ${landing.calls.recent} → ${switched.calls.recent}`,
    );
    assert.equal(switched.button?.disabled, false, "the control stayed closed after the switch");

    // A refused folder: the refusal is named, the operator stays on the same
    // surface on the same vault, and the escape hatch stays on it.
    assert.equal(
      refused.calls.open[refused.calls.open.length - 1],
      VAULT_B.path,
      "the refused open carried the wrong folder",
    );
    assert.equal(refused.error, REFUSAL, "the refusal did not reach the operator");
    assert.equal(refused.vaultPath, VAULT_B.path, "a refused open moved the vault");
    assert.equal(refused.vaultId, VAULT_B.id, "a refused open moved the vault id");
    assert.ok(refused.button, "a refused open unmounted the switch control");
    assert.equal(refused.button?.disabled, false, "a refused open closed the switch control");
    assert.equal(
      refused.calls.recent,
      switched.calls.recent,
      "a refused open re-read the recent list",
    );
  });
});
