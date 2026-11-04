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
const REPORT = path.join(desktopRoot, "e2e/artifacts/confirm-layering.json");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Hit = {
  x: number;
  y: number;
  hit: string | null;
  inCard: boolean;
  inBackdrop: boolean;
  inDock: boolean;
  inRail: boolean;
  inSheet: boolean;
  inTitlebar: boolean;
};

type Dialog = {
  present: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  role: string | null;
  ariaModal: string | null;
  box: Box;
  backdrop: Box | null;
  backdropPosition: string | null;
  backdropZIndex: string | null;
  backdropFilter: string | null;
  backdropBackground: string | null;
  offsetFromWindowX: number;
  offsetFromWindowY: number;
  offsetFromDockX: number | null;
  overlapsDockBy: number;
  withinWindow: boolean;
  focus: { inCancel: boolean; inConfirm: boolean; className: string } | null;
  hits: Record<string, Hit | null>;
  scrimHits: Record<string, Hit | null>;
};

type State = {
  viewport: { width: number; height: number };
  theme: { dataTheme: string | null; canvasBase: string; fg: string };
  shell: { className: string } | null;
  rail: Box | null;
  chat: Box | null;
  main: Box | null;
  rows: { label: string }[];
  harnessRows: { id: string; label: string }[];
  menuOpen: boolean;
  deleteCalls: string[];
  glass: { backdropFilter: string | null; background: string | null } | null;
  scrim: {
    expectedBackground: string;
    oldWashBackground: string;
    expectedBlur: string;
  };
  dialog: Dialog | null;
  idle: { dock: Hit | null; sheet: Hit | null };
};

type Report = {
  url: string;
  window: { width: number; height: number };
  vaultName: string;
  theme: State["theme"];
  shipped: State;
  swapped: State;
  asked: State;
  cancelled: State;
  deleted: State;
  screenshots: string[];
  failures: string[];
  pass: boolean;
};

/** Channel values of a computed colour; 0–1 forms are scaled to 0–255. */
function channels(color: string | null): number[] {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  // `color-mix()` resolves to `color(srgb r g b / a)` in this browser: three
  // 0–1 channels and an alpha, which a four-number `rgba()` reading would take
  // for three 0–255 channels beside an alpha.
  if (/^color\(\s*srgb/i.test(color ?? "")) {
    return raw.slice(0, 3).map((value) => value * 255);
  }
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
      [path.join(desktopRoot, "e2e/confirm-layering.electron.mjs")],
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

describe("the app's own confirm dialog over the swapped studio", () => {
  it("asks above the left-hand dock and blurs the page like the settings sheet", async (t) => {
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

    const { shipped, swapped, asked, cancelled, deleted } = report;

    // —— The arrangement the report starts from. ——
    assert.equal(shipped.dialog, null, "a question was open before anything was clicked");
    assert.equal(
      shipped.shell?.className.includes("shell--chat-right"),
      true,
      `the rig did not start in the shipped arrangement: ${shipped.shell?.className}`,
    );
    assert.equal(swapped.shell?.className.includes("shell--chat-left"), true);
    assert.ok(
      (swapped.chat?.left ?? Infinity) < (swapped.main?.left ?? 0),
      `the swap did not put the dock ahead of the sheet: dock ${JSON.stringify(swapped.chat)}, sheet ${JSON.stringify(swapped.main)}`,
    );
    assert.equal(swapped.rows.length, 2, "the sidebar lost its chats");

    // —— The question asked from the left sidebar. ——
    const dialog = asked.dialog;
    assert.ok(dialog, "deleting a chat from the sidebar never asked");
    assert.equal(dialog.title, "Delete chat", "the question is not named for the write");
    assert.equal(dialog.confirmLabel, "Delete chat", "the confirming control names another write");
    assert.match(dialog.message, /Delete ".+"\?/, "the question does not name the chat");
    assert.equal(dialog.role, "dialog", "the question is not a dialog");
    assert.equal(dialog.ariaModal, "true", "the question does not promise an inert page behind it");
    assert.deepEqual(asked.deleteCalls, [], "the delete wrote before it was answered");
    assert.equal(asked.menuOpen, false, "the row menu stayed open under the question");

    assert.ok(
      Math.abs(dialog.offsetFromWindowX) <= 2 && Math.abs(dialog.offsetFromWindowY) <= 2,
      `the card is not centred in the window: ${dialog.offsetFromWindowX}px across, ${dialog.offsetFromWindowY}px down`,
    );
    assert.ok(
      Math.abs(dialog.offsetFromDockX ?? 0) > 40,
      `the card is centred on the dock rather than the window: ${dialog.offsetFromDockX}px`,
    );
    assert.equal(dialog.focus?.inCancel, true, "the question does not hold the caret");

    // 1 — the layering. The card hangs over the dock's column; every point inside
    // it has to be the card, whichever pane stands behind that point.
    assert.ok(
      dialog.overlapsDockBy >= 100,
      `the card does not cross the dock's column: ${dialog.overlapsDockBy}px`,
    );
    for (const [point, hit] of Object.entries(dialog.hits)) {
      assert.equal(
        hit?.inCard,
        true,
        `the ${point} of the card is painted by something else: ${JSON.stringify(hit)}`,
      );
    }
    assert.equal(
      dialog.hits.leftInside?.inDock,
      false,
      `the dock paints over the card's leading half: ${JSON.stringify(dialog.hits.leftInside)}`,
    );

    // 2 — the scrim covers the window, not the column that raised the question.
    assert.equal(dialog.backdropPosition, "fixed", "the scrim is not drawn over the window");
    assert.equal(dialog.backdrop?.width, asked.viewport.width, "the scrim stops short of the window");
    assert.equal(dialog.backdrop?.height, asked.viewport.height, "the scrim stops short of the window");
    for (const [pane, hit] of Object.entries(dialog.scrimHits)) {
      assert.equal(
        hit?.inBackdrop,
        true,
        `the ${pane} is not under the scrim: ${JSON.stringify(hit)}`,
      );
      assert.equal(hit?.inDock || hit?.inRail || hit?.inSheet, false, `${pane}: ${JSON.stringify(hit)}`);
    }

    // 3 — the blur, not the white-out. The scrim has to be the sheet's glass.
    assert.match(
      dialog.backdropFilter ?? "",
      /blur\(\s*7px\s*\)/,
      `the scrim does not blur: ${JSON.stringify(dialog.backdropFilter)}`,
    );
    assert.equal(
      dialog.backdropFilter,
      asked.glass?.backdropFilter,
      `the question's scrim is not the settings sheet's glass: ${dialog.backdropFilter} vs ${asked.glass?.backdropFilter}`,
    );
    assert.ok(
      channelDelta(dialog.backdropBackground, asked.glass?.background ?? null) <= 2,
      `the question's fill is not the sheet's canvas veil: ${dialog.backdropBackground} vs ${asked.glass?.background}`,
    );
    assert.ok(
      channelDelta(dialog.backdropBackground, asked.scrim.expectedBackground) <= 2,
      `the scrim does not wear color-mix(canvas-base 38%): ${dialog.backdropBackground} vs ${asked.scrim.expectedBackground}`,
    );
    assert.ok(
      alphaOf(dialog.backdropBackground) > 0.3 && alphaOf(dialog.backdropBackground) < 0.5,
      `the scrim is not a veil: ${dialog.backdropBackground}`,
    );
    assert.ok(
      channelDelta(dialog.backdropBackground, asked.scrim.oldWashBackground) > 30,
      `the scrim is still the old --fg wash that whitened the page: ${dialog.backdropBackground} vs ${asked.scrim.oldWashBackground}`,
    );

    // —— Both answers. ——
    assert.equal(cancelled.dialog, null, "Escape did not close the question");
    assert.deepEqual(cancelled.deleteCalls, [], "a cancelled delete wrote anyway");
    assert.equal(
      cancelled.idle.dock?.inDock,
      true,
      `the scrim outlived the question: ${JSON.stringify(cancelled.idle.dock)}`,
    );

    const row = swapped.rows[0];
    const rowId = swapped.harnessRows.find((entry) => entry.label === row?.label)?.id;
    assert.ok(rowId, `the harness published no id for the row ${JSON.stringify(row)}`);
    assert.deepEqual(
      deleted.deleteCalls,
      [rowId],
      "the confirmed delete named the wrong chat",
    );
    assert.equal(deleted.dialog, null, "the question outlived its answer");
    assert.equal(
      deleted.rows.length,
      cancelled.rows.length - 1,
      "the confirmed delete did not remove exactly one row",
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
