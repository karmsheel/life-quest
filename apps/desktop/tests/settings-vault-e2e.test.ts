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
const RESTORE_REFUSAL = "Books.json for this domain could not be read.";

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerY: number;
};

type Calls = {
  dialog: (string | null)[];
  open: string[];
  recent: number;
  settings: Record<string, unknown>[];
  export: string[];
  restore: string[];
};

type Toggle = {
  checked: string | null;
  text: string;
  className: string;
  disabled: boolean;
  box: Box | null;
  track: Box | null;
  thumb: Box | null;
};

type BookRow = {
  label: string;
  description: string;
  row: Box;
  copy: Box;
  labelBox: Box;
  control: Box;
  checkboxCount: number;
  toggle: Toggle | null;
  exportButton: {
    text: string;
    disabled: boolean;
    radius: number | null;
    className: string;
    box: Box;
  } | null;
  restoreButton: {
    text: string;
    disabled: boolean;
    radius: number | null;
    box: Box;
  } | null;
  messages: { text: string; role: string | null; error: boolean }[];
};

type State = {
  viewport: { width: number; height: number };
  identity: {
    label: string;
    value: string;
    row: Box;
    labelBox: Box;
    valueBox: Box;
  }[];
  vaultName: string | null;
  vaultId: string | null;
  vaultPath: string | null;
  sections: Box[];
  folderRow: {
    label: string;
    description: string;
    copy: Box;
    control: Box;
    labelBox: Box;
    button: {
      label: string;
      className: string;
      disabled: boolean;
      radius: number | null;
    } | null;
  } | null;
  weekStart: {
    label: string;
    description: string | null;
    copy: Box;
    labelBox: Box;
    control: Box;
    controlClassName: string;
    height: number;
    width: number;
    disabled: boolean;
    active: "monday" | "sunday" | null;
  } | null;
  books: BookRow[];
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
      { cwd: desktopRoot, timeout: 180_000 },
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

function bookAt(state: State | undefined, label: string): BookRow {
  const row = state?.books.find((candidate) => candidate.label === label);
  assert.ok(row, `state has no book row for ${label}`);
  return row;
}

describe("the settings vault page", () => {
  it("gates restores with a switch, lays rows out name-left/control-right, and switches folders", async (t) => {
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
      weekStart,
      exportState,
      booksArmed,
      booksRestored,
      booksRefused,
      folderCancelled,
      folderInFlight,
      switched,
      folderRefused,
      weekLocked,
    } = report.states;

    assert.ok(landing, "the page never reached its landing state");

    // —— The page still describes the vault that is open ——
    assert.equal(landing.vaultPath, VAULT_A.path, "the open vault's path");
    assert.equal(landing.vaultId, VAULT_A.id, "the open vault's id");
    assert.equal(landing.vaultName, VAULT_A.name, "the open vault's name");

    // —— Identity: label on the left, value on the right, rows apart ——
    assert.equal(landing.identity.length, 3, "identity row count");
    for (const entry of landing.identity) {
      assert.ok(
        entry.labelBox.right <= entry.valueBox.left,
        `identity ${entry.label}: value is not to the right of its label`,
      );
    }
    for (let index = 1; index < landing.identity.length; index += 1) {
      const previous = landing.identity[index - 1];
      const current = landing.identity[index];
      assert.ok(
        current.labelBox.top - previous.valueBox.bottom >= 12,
        `identity rows ${previous.label} / ${current.label} are squeezed together`,
      );
    }

    // —— The two blocks on the page are separated ——
    assert.ok(landing.sections.length >= 2, "Vault and Books are not two sections");
    assert.ok(
      landing.sections[1].top - landing.sections[0].bottom >= 24,
      `the Books heading sits on the Vault card: gap ${landing.sections[1].top - landing.sections[0].bottom}`,
    );

    // —— Vault folder: live control on the trailing edge, clear of its copy ——
    assert.equal(landing.folderRow?.label, "Vault folder", "the folder row's label");
    assert.match(landing.folderRow?.button?.className ?? "", /btn/, "the control is not the app's Button");
    assert.equal(landing.folderRow?.button?.label, "Change folder…", "the control's own label");
    assert.equal(landing.folderRow?.button?.disabled, false, "the control was closed before a click");
    assert.ok(
      (landing.folderRow?.button?.radius ?? 999) <= 12,
      `the folder button still wears the pill: radius ${landing.folderRow?.button?.radius}`,
    );
    assert.ok(
      (landing.folderRow?.control?.left ?? 0) - (landing.folderRow?.copy?.right ?? 0) >= 16,
      "the folder control is pressed against its text",
    );
    assert.deepEqual(landing.calls.export, [], "books were written before a click");
    assert.deepEqual(landing.calls.restore, [], "a restore ran before a click");

    // —— Week starts on: compact, on the heading's line, hint only when locked ——
    assert.equal(landing.weekStart?.label, "Week starts on", "the week row's label");
    assert.match(
      landing.weekStart?.controlClassName ?? "",
      /ui-segmented--sm/,
      "the week control is still the full-size segmented bar",
    );
    assert.ok(
      Math.abs(
        (landing.weekStart?.control?.top ?? 0) -
          (landing.weekStart?.labelBox?.top ?? 0),
      ) <= 8,
      "the week control is not on the heading's line",
    );
    assert.ok(
      (landing.weekStart?.control?.left ?? 0) > (landing.weekStart?.labelBox?.right ?? 0),
      "the week control is not to the right of its heading",
    );
    assert.ok(
      (landing.weekStart?.height ?? 999) <= 30,
      `the week control is not compact: ${landing.weekStart?.height}px`,
    );
    assert.ok(
      (landing.weekStart?.width ?? 999) <= 240,
      `the week control is still a full-width bar: ${landing.weekStart?.width}px`,
    );
    assert.equal(
      landing.weekStart?.description,
      null,
      "a live week-start setting claims it cannot change",
    );

    // —— Books: checkboxes are gone, replaced by a switch that gates restore ——
    assert.deepEqual(
      landing.books.map((row) => row.label),
      ["Health", "Finance"],
      "the books rows are not the live domains",
    );
    for (const row of landing.books) {
      assert.equal(row.checkboxCount, 0,`${row.label} still renders a checkbox`);
      assert.ok(row.toggle, `${row.label} has no restore switch`);
      assert.equal(row.toggle?.checked, "false", `${row.label}'s switch starts on`);
      assert.match(row.toggle?.text ?? "", /allow restore/i, `${row.label}'s switch is unlabelled`);
      assert.ok(
        (row.toggle?.track?.width ?? 0) >= 40 && (row.toggle?.track?.height ?? 0) >= 20,
        `${row.label}'s switch is too small to be the way in: ${JSON.stringify(row.toggle?.track)}`,
      );
      assert.equal(
        row.restoreButton?.disabled,
        true,
        `${row.label}'s restore is open before the switch arms it`,
      );
      assert.equal(row.exportButton?.disabled, false, `${row.label}'s export is closed`);
      assert.ok(
        (row.exportButton?.radius ?? 999) <= 12 && (row.restoreButton?.radius ?? 999) <= 12,
        `${row.label}'s buttons still wear the pill`,
      );
      assert.ok(
        row.control.left > row.labelBox.right && row.control.left - row.copy.right >= 16,
        `${row.label}'s name and controls are not on opposite sides with a gap`,
      );
    }
    assert.ok(
      landing.books[1].labelBox.top - landing.books[0].labelBox.bottom >= 40,
      "the books rows are squeezed together",
    );

    // —— The week-start switch works, in place ——
    assert.equal(weekStart?.calls.settings.length, 1, "the week switch did not write settings");
    assert.equal(
      weekStart?.calls.settings[0].weekStartDay,
      "sunday",
      "the week switch wrote the wrong day",
    );
    assert.equal(weekStart?.weekStart?.active, "sunday", "the chosen day is not the active one");

    // —— Export reports on its own row ——
    assert.deepEqual(exportState?.calls.export, ["health"], "export did not carry the domain");
    assert.ok(
      bookAt(exportState, "Health").messages.some(
        (message) => message.role === "status" && /exported books for health/i.test(message.text),
      ),
      "export did not report itself on the Health row",
    );
    assert.deepEqual(bookAt(exportState, "Finance").messages, [], "export reported on another row");

    // —— Arming is per domain; a restore disarms its own row again ——
    assert.equal(bookAt(booksArmed, "Health").toggle?.checked, "true", "Health's switch did not arm");
    assert.equal(
      bookAt(booksArmed, "Health").restoreButton?.disabled,
      false,
      "Health's restore did not open",
    );
    assert.equal(
      bookAt(booksArmed, "Finance").restoreButton?.disabled,
      true,
      "arming Health armed Finance too",
    );
    assert.deepEqual(booksRestored?.calls.restore, ["health"], "the restore did not carry the domain");
    assert.equal(
      bookAt(booksRestored, "Health").toggle?.checked,
      "false",
      "a finished restore left its row armed",
    );
    assert.equal(
      bookAt(booksRestored, "Health").restoreButton?.disabled,
      true,
      "a finished restore left its button open",
    );

    // —— A refused restore names itself on the row that asked ——
    assert.deepEqual(booksRefused?.calls.restore, ["health", "health"], "the refused restore did not run");
    assert.ok(
      bookAt(booksRefused, "Health").messages.some(
        (message) => message.role === "alert" && message.text === RESTORE_REFUSAL,
      ),
      "a refused restore is silent on its row",
    );

    // —— The folder switch: cancelled, in flight, switched, refused ——
    assert.deepEqual(folderCancelled?.calls.dialog, [null], "the cancelled ask did not reach the picker");
    assert.deepEqual(folderCancelled?.calls.open, [], "a cancelled picker opened a vault");
    assert.equal(folderCancelled?.vaultPath, VAULT_A.path, "a cancelled picker moved the open vault");
    assert.equal(folderCancelled?.error, null, "a cancelled picker reported an error");
    assert.equal(
      folderInFlight?.folderRow?.button?.disabled,
      true,
      "the folder control was live mid-open",
    );
    assert.equal(
      folderInFlight?.folderRow?.button?.label,
      "Opening…",
      "the folder control did not say it was working",
    );
    assert.deepEqual(folderInFlight?.calls.open, [VAULT_B.path], "the open carried the wrong folder");
    assert.equal(folderInFlight?.vaultPath, VAULT_A.path, "the page moved before the open finished");
    assert.equal(
      switched?.calls.dialog[switched?.calls.dialog.length - 1],
      VAULT_B.path,
      "the switch opened a folder the picker never returned",
    );
    assert.equal(switched?.vaultPath, VAULT_B.path, "the switch did not move the path");
    assert.equal(switched?.vaultId, VAULT_B.id, "the switch did not move the vault id");
    assert.equal(switched?.vaultName, VAULT_B.name, "the switch did not move the vault name");
    assert.equal(folderRefused?.error, REFUSAL, "the refusal did not reach the operator");
    assert.equal(folderRefused?.vaultPath, VAULT_B.path, "a refused open moved the vault");
    assert.equal(
      folderRefused?.folderRow?.button?.disabled,
      false,
      "a refused open closed the switch control",
    );

    // —— With weekly files present the week control closes and says why ——
    assert.equal(weekLocked?.weekStart?.disabled, true, "the locked week control stayed live");
    assert.match(
      weekLocked?.weekStart?.description ?? "",
      /cannot change/i,
      "the locked week row does not say why it cannot change",
    );
    assert.ok(
      (weekLocked?.weekStart?.height ?? 999) <= 30,
      "the locked week control grew again",
    );

    // The pictures are the point of the artifact: a run whose images are
    // missing cannot show that the shipped UI is what passed.
    for (const name of [
      "settings-vault-landing.png",
      "settings-vault-week-start.png",
      "settings-vault-books-armed.png",
      "settings-vault-switched.png",
      "settings-vault-refused.png",
      "settings-vault-week-locked.png",
    ]) {
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts", name)),
        true,
        `the rig wrote no ${name}`,
      );
    }
  });
});
