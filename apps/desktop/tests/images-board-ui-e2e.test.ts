import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Images page under Define, rendered by the real shell in a real layout
 * engine. The claims themselves live in `e2e/images-board.electron.mjs`, which
 * drives the harness; this file runs that driver and refuses a report that does
 * not hold.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `lifequest-e2e` puts this checkout's server on 5173 for the run.
 *
 * The artifact is `e2e/artifacts/images-board.json` plus the pictures the driver
 * captures — the empty page, the write-up with pictures in it, the remove
 * question, and the stacked narrow layout.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/images-board.json");

type Write = {
  op: "save" | "update" | "delete" | "board";
  id?: string;
  blocks?: number;
  kinds?: string[];
  caption?: string | null;
};

type Picture = { complete: boolean; width: number };

type Report = {
  pass: boolean;
  failures: string[];
  consoleErrors: string[];
  checks: {
    rail: { label: string | null; href: string | null; active: boolean }[];
    activeRail: string | null;
    route: string | null;
    eyebrow: string | null;
    empty: {
      libraryEmpty: string | null;
      boardEmpty: string | null;
      status: string | null;
    };
    wide: {
      columns: string | null;
      library: { left: number } | null;
      board: { left: number } | null;
    };
    uploaded: {
      cards: number;
      badge: string | null;
      summary: string | null;
      pictures: Picture[];
      store: { name: string; bytes: number }[];
    };
    caption: {
      stored: string | null;
      updateWrites: Write[];
    };
    inserted: {
      blocks: { kind: string | null }[];
      pictures: Picture[];
    };
    text: {
      blocks: { kind: string | null; text: string | null }[];
      stored: { kind: string; text?: string }[];
    };
    structure: {
      kinds: (string | null)[];
      heading: string | null;
      bullets: string[][];
      storedKinds: string[];
    };
    reorder: { screen: (string | null)[]; stored: string[] };
    backspace: { blocks: (string | null)[]; stored: string[] };
    picker: { options: number; images: number };
    picked: { imageBlocks: number; pickerOpen: number; imageIds: string[] };
    confirm: { title: string | null; message: string | null };
    cancel: { cards: number; deleteWrites: number };
    removed: {
      cards: number;
      storedImages: number;
      missingBlocks: number;
      deleteWrites: Write[];
    };
    refused: { status: string | null; error: string | null };
    recovered: { status: string | null; heading: string | null };
    final: {
      saveControls: number;
      unexpected: string[];
      calls: number;
    };
    narrow: {
      columns: string | null;
      library: { top: number } | null;
      board: { top: number } | null;
    };
  };
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
      [path.join(desktopRoot, "e2e/images-board.electron.mjs")],
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

const PICTURES = [
  "images-board-empty.png",
  "images-board-delete-question.png",
  "images-board-wide.png",
  "images-board-narrow.png",
];

describe("Define → Images", () => {
  it("uploads pictures, writes the vision as blocks, and keeps a removed picture's place", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`lifequest-e2e\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    for (const name of PICTURES) {
      fs.rmSync(path.join(desktopRoot, "e2e/artifacts", name), { force: true });
    }

    const exitCode = await runDriver();
    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact",
    );
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // The pictures the claims name exist and are real captures, not empty files.
    for (const name of PICTURES) {
      const file = path.join(desktopRoot, "e2e/artifacts", name);
      assert.equal(fs.existsSync(file), true, `no capture at ${name}`);
      assert.ok(
        fs.statSync(file).size > 20_000,
        `${name} looks empty (${fs.statSync(file).size} bytes)`,
      );
    }

    const { checks } = report;

    // It is the Define wing's page, not a floating harness.
    assert.equal(checks.activeRail, "Images");
    assert.equal(checks.route, "/images");
    assert.equal(checks.eyebrow, "Define");
    assert.ok(
      checks.rail.some((item) => item.label === "Images" && item.href === "/images"),
      "no Images row on the rail",
    );

    // With room, the two surfaces sit side by side, library on the leading edge.
    assert.equal(
      (checks.wide.columns ?? "").trim().split(/\s+/).filter(Boolean).length,
      2,
    );
    assert.ok(
      checks.wide.library !== null &&
        checks.wide.board !== null &&
        checks.wide.library.left < checks.wide.board.left,
      "the wide layout did not put the library to the left of the document",
    );

    // The vault starts empty, and the page says so in both halves.
    assert.match(checks.empty.libraryEmpty ?? "", /No pictures yet/);
    assert.match(checks.empty.boardEmpty ?? "", /document is empty/i);

    // Uploads became real library rows, and the pictures decoded (640 px wide).
    assert.equal(checks.uploaded.cards, 2);
    assert.equal(checks.uploaded.badge, "2");
    assert.equal(checks.uploaded.summary, "2 pictures");
    assert.equal(checks.uploaded.pictures.length, 2);
    for (const picture of checks.uploaded.pictures) {
      assert.equal(picture.complete, true, "a library picture never finished loading");
      assert.equal(picture.width, 640, "a library picture did not decode at its real size");
    }

    // The caption reached the library, not just the DOM.
    assert.equal(checks.caption.stored, "Light before the house wakes.");
    assert.ok(
      checks.caption.updateWrites.some(
        (write) => write.caption === "Light before the house wakes.",
      ),
      "no imagesUpdate call carried the caption",
    );

    // Clicking a picture made an image block that draws the same bytes.
    assert.equal(checks.inserted.blocks[0]?.kind, "image");
    assert.equal(checks.inserted.pictures[0]?.width, 640);

    // Text typed into the document is the text the vault holds.
    assert.equal(checks.text.blocks.filter((block) => block.kind === "text").length, 2);
    assert.equal(
      checks.text.stored.filter((block) => block.kind === "text").length,
      2,
    );

    // Heading and bullets survived the round trip; Enter added a bullet line.
    assert.equal(checks.structure.heading, "The life I'm reaching for");
    // One bullets block, two lines: Enter added the second line.
    assert.deepEqual(checks.structure.bullets, [
      ["Walk before the house wakes", "Build one thing well"],
    ]);
    assert.equal(checks.structure.storedKinds.includes("bullets"), true);

    // Reordering and Backspace changed the vault, not only the screen.
    assert.deepEqual(checks.reorder.screen, checks.reorder.stored);
    assert.deepEqual(checks.backspace.blocks, checks.backspace.stored);

    // The picker listed the library and closed once a picture was chosen.
    assert.equal(checks.picker.options, 2);
    assert.equal(checks.picked.pickerOpen, 0);
    assert.equal(checks.picked.imageBlocks, 2);

    // Removing asked by name, Cancel kept it, Confirm deleted it from the vault.
    assert.match(checks.confirm.message ?? "", /morning\.png/);
    assert.equal(checks.cancel.cards, 2);
    assert.equal(checks.cancel.deleteWrites, 0);
    assert.equal(checks.removed.cards, 1);
    assert.equal(checks.removed.storedImages, 1);
    assert.ok(checks.removed.deleteWrites.length >= 1);
    // The document kept its block and draws the gone picture as missing.
    assert.equal(checks.removed.missingBlocks, 1);

    // A refused write reported itself and Ctrl+S wrote it for real.
    assert.match(checks.refused.error ?? "", /refused/i);
    assert.equal(checks.recovered.status, "Saved");
    assert.equal(checks.recovered.heading, "The life I'm actually reaching for");

    // No Save control, no bridge hole, and the two surfaces stack when narrow.
    assert.equal(checks.final.saveControls, 0);
    assert.deepEqual(checks.final.unexpected, []);
    assert.deepEqual(report.consoleErrors, []);
    assert.equal(
      (checks.narrow.columns ?? "").trim().split(/\s+/).filter(Boolean).length,
      1,
    );
    assert.ok(
      checks.narrow.library !== null &&
        checks.narrow.board !== null &&
        checks.narrow.library.top < checks.narrow.board.top,
      "the narrow layout did not put the library above the document",
    );
  });
});
