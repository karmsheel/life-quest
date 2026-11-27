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
  title: string;
  subtitle: string;
  sectionTitles: string[];
  cards: string[];
  locked: { name: string; slug: string }[];
  archived: string[];
  createPlaceholder: string | null;
  sheet: Box | null;
  archiveCalls: string[];
  deleteCalls: string[];
  unlockCalls: string[];
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

    const { landing, asked, declined, archived, deleteAsked, deleted, unlocked } =
      report.states;

    // The page is the real Settings → Areas: the base Life area (never listed),
    // two unlocked areas, one archived area and two seeded areas still locked —
    // so the unlock list, both asks and the create form all have their fixture.
    assert.equal(landing.title, "Areas", "the settings section is not titled Areas");
    assert.match(
      landing.subtitle,
      /Life shows everything/,
      `the settings section still talks about Overview: "${landing.subtitle}"`,
    );
    assert.deepEqual(
      landing.sectionTitles,
      ["Unlock another area", "Your areas", "Archived", "Create area"],
      "the Areas sections are missing or out of contract order",
    );
    assert.deepEqual(landing.cards, ["Health", "Career"], "the live area cards");
    assert.deepEqual(
      landing.locked,
      [
        { name: "Mind", slug: "mind" },
        { name: "Finance", slug: "financial" },
      ],
      "the locked seeded areas are not offered to unlock",
    );
    assert.equal(landing.archived.length, 1, "the archived row");
    assert.equal(
      landing.createPlaceholder,
      "e.g. Woodworking",
      `the create form asks with the wrong placeholder: ${JSON.stringify(landing.createPlaceholder)}`,
    );
    assert.ok(
      !landing.cards.includes("Life") &&
        !landing.locked.some((row) => row.name === "Life") &&
        !landing.archived.some((row) => row.includes("Life")),
      "the base Life area is listed in Settings → Areas",
    );
    assert.equal(landing.dialog, null, "a question was open before anything was clicked");
    assert.deepEqual(landing.unlockCalls, [], "an unlock ran before it was clicked");
    assert.ok(landing.sheet, "the harness did not render the shell's own content pane");

    // Archive — the soft write: it asks, and it does not wear the danger.
    const archive = asked.dialog;
    assert.ok(archive, "the archive wrote without asking");
    assert.equal(archive.title, "Archive area", "the question is not named for the write");
    assert.equal(
      archive.message,
      "The area leaves the active switcher list. Its folder and everything in it stay in the vault.",
      "the archive question does not say what archive does, in area words",
    );
    assert.equal(archive.confirmLabel, "Archive area", "the confirm control is not the area verb");
    assert.match(archive.message, /switcher list/, "the question does not say what archive does");
    assert.deepEqual(asked.archiveCalls, [], "the archive wrote before it was answered");
    assert.ok(
      Math.abs(archive.offsetFromWindowX) <= 2 && Math.abs(archive.offsetFromWindowY) <= 2,
      `the card is not centred in the window: ${archive.offsetFromWindowX}px across, ${archive.offsetFromWindowY}px down`,
    );
    assert.ok(
      Math.abs(archive.offsetFromWindowX) < Math.abs(archive.offsetFromSheetX ?? 0),
      `the card is nearer the sheet's centre than the window's: ${archive.offsetFromSheetX}px from the sheet vs ${archive.offsetFromWindowX}px from the window`,
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

    // Delete — the final write: the question names the area, and the control
    // wears the destructive token while the archive's does not.
    const remove = deleteAsked.dialog;
    assert.ok(remove, "the delete wrote without asking");
    assert.equal(remove.title, "Delete area", "the question is not named for the write");
    assert.equal(remove.confirmLabel, "Delete area", "the delete confirm is not the area verb");
    assert.match(remove.message, /Career \(old\)/, "the question does not name the area it takes");
    assert.match(remove.message, /area/, "the delete question still says domain");
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

    assert.deepEqual(deleted.deleteCalls, ["career-old"], "the delete answered the wrong area");
    assert.deepEqual(deleted.archiveCalls, ["health"], "the delete archived something");
    assert.equal(deleted.dialog, null, "answering the delete did not close the question");

    // Unlock — a reveal, not an activation: the locked row's slug travels on the
    // call, the row leaves "Unlock another area", and the area appears under
    // "Your areas" without any confirm dialog.
    assert.deepEqual(unlocked.unlockCalls, ["mind"], "the unlock answered the wrong area");
    assert.deepEqual(
      unlocked.locked,
      [{ name: "Finance", slug: "financial" }],
      "unlocking Mind did not leave Finance as the only locked area",
    );
    assert.ok(
      unlocked.cards.includes("Mind"),
      `the unlocked area did not appear under Your areas: ${JSON.stringify(unlocked.cards)}`,
    );
    assert.equal(unlocked.dialog, null, "unlocking asked a question it should not ask");
    assert.deepEqual(unlocked.archiveCalls, ["health"], "the unlock archived something");
    assert.deepEqual(unlocked.deleteCalls, ["career-old"], "the unlock deleted something");
  });
});
