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
const REPORT = path.join(desktopRoot, "e2e/artifacts/settings-domains.json");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Dialog = {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass: string | null;
  confirmColor: string | null;
  cancelColor: string | null;
  box: Box;
  backdrop: Box | null;
  backdropBackground: string | null;
  /** Card centre minus the window's centre: the contract is that it is ~0. */
  offsetFromWindowX: number;
  offsetFromWindowY: number;
  /** Card centre minus the sheet's centre: what it must NOT be. */
  offsetFromSheetX: number | null;
  /** True if the sheet's own box cuts the card off. */
  clippedBySheet: boolean | null;
};

type State = {
  viewport: { width: number; height: number };
  cards: string[];
  archived: string[];
  sheet: Box | null;
  archiveCalls: string[];
  deleteCalls: string[];
  dialog: Dialog | null;
};

type Report = {
  url: string;
  window: { width: number; height: number };
  states: Record<string, State>;
  screenshots: string[];
  failures: string[];
  pass: boolean;
};

/** Channel values of a computed colour; 0–1 forms are scaled to 0–255. */
function channels(color: string | null): number[] {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length === 3 && raw.every((value) => value <= 1.0001)
    ? raw.map((value) => value * 255)
    : raw;
}

/** Alpha of a computed colour: 1 when it carries none. */
function alphaOf(color: string | null): number {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length >= 4 ? raw[3] : 1;
}

/** Largest per-channel gap between two computed colours; NaN when unparseable. */
function channelDelta(a: string | null, b: string | null): number {
  const x = channels(a);
  const y = channels(b);
  if (x.length < 3 || y.length < 3) return Number.NaN;
  return Math.max(...x.map((value, index) => Math.abs(value - y[index])));
}

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
      [path.join(desktopRoot, "e2e/settings-domains.electron.mjs")],
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

describe("the app's own confirm dialog on a settings surface", () => {
  it("asks in the window, writes only on yes, and keeps the danger for the final write", async (t) => {
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

    const { landing, asked, declined, archived, deleteAsked, deleted } = report.states;

    // The page is the real settings page: two live domains and one archived, so
    // both asks (archive a live one, delete an archived one) exist to click.
    assert.deepEqual(landing.cards, ["Health", "Career"], "the live domain cards");
    assert.equal(landing.archived.length, 1, "the archived row");
    assert.equal(landing.dialog, null, "a question was open before anything was clicked");
    assert.ok(landing.sheet, "the harness did not render the shell's own content pane");

    // Archive — the soft write: it asks, and it does not wear the danger.
    const archive = asked.dialog;
    assert.ok(archive, "the archive wrote without asking");
    assert.equal(archive.title, "Archive domain", "the question is not named for the write");
    assert.match(archive.message, /switcher list/, "the question does not say what archive does");
    assert.deepEqual(asked.archiveCalls, [], "the archive wrote before it was answered");
    assert.ok(
      Math.abs(archive.offsetFromWindowX) <= 2 && Math.abs(archive.offsetFromWindowY) <= 2,
      `the card is not centred in the window: ${archive.offsetFromWindowX}px across, ${archive.offsetFromWindowY}px down`,
    );
    assert.ok(
      Math.abs(archive.offsetFromSheetX ?? 0) > 40,
      `the card is centred on the sheet rather than the window: ${archive.offsetFromSheetX}px`,
    );
    assert.equal(archive.clippedBySheet, false, "the sheet's scroller clipped the card");
    assert.equal(archive.backdrop?.width, asked.viewport.width, "the scrim does not cover the window");
    assert.equal(archive.backdrop?.height, asked.viewport.height, "the scrim does not cover the window");
    assert.ok(
      alphaOf(archive.backdropBackground) > 0.1,
      `the scrim does not paint: ${archive.backdropBackground}`,
    );
    assert.match(
      archive.confirmClass ?? "",
      /btn-primary/,
      `the archive confirm is not the plain control: "${archive.confirmClass}"`,
    );
    assert.doesNotMatch(
      archive.confirmClass ?? "",
      /btn-danger/,
      "archive is a soft write and must not wear the danger",
    );

    // Cancelling is the half that has to write nothing — and it is the half a
    // platform dialog could never be asked to prove.
    assert.equal(declined.dialog, null, "the question outlived the cancel");
    assert.deepEqual(declined.archiveCalls, [], "a cancelled archive wrote anyway");
    assert.deepEqual(declined.deleteCalls, [], "a cancelled archive deleted something");

    // The retry carries the slug of the row the question was opened from.
    assert.deepEqual(archived.archiveCalls, ["health"], "the archive answered the wrong domain");
    assert.deepEqual(archived.deleteCalls, [], "the archive called delete");
    assert.equal(archived.dialog, null, "answering did not close the question");

    // Delete — the final write: the question names the domain, and the control
    // wears the destructive token while the archive's does not.
    const remove = deleteAsked.dialog;
    assert.ok(remove, "the delete wrote without asking");
    assert.equal(remove.title, "Delete domain", "the question is not named for the write");
    assert.match(remove.message, /Career \(old\)/, "the question does not name the domain it takes");
    assert.deepEqual(deleteAsked.deleteCalls, [], "the delete wrote before it was answered");
    assert.match(
      remove.confirmClass ?? "",
      /btn-danger/,
      `the final write does not wear the danger: "${remove.confirmClass}"`,
    );
    assert.ok(
      channelDelta(remove.confirmColor, remove.cancelColor) > 40,
      `the destructive control is not distinct: ${remove.confirmColor} vs ${remove.cancelColor}`,
    );
    assert.ok(
      Math.abs(remove.offsetFromWindowX) <= 2 && Math.abs(remove.offsetFromWindowY) <= 2,
      `the delete's card is not centred in the window: ${remove.offsetFromWindowX}, ${remove.offsetFromWindowY}`,
    );

    assert.deepEqual(deleted.deleteCalls, ["career-old"], "the delete answered the wrong domain");
    assert.deepEqual(deleted.archiveCalls, ["health"], "the delete archived something");
    assert.equal(deleted.dialog, null, "answering the delete did not close the question");
  });
});
