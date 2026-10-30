import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Images under Define, and the Vision board on the Vision page, rendered by the
 * real shell in a real layout engine. The claims themselves live in
 * `e2e/images-board.electron.mjs`, which drives the harness; this file runs that
 * driver and refuses a report that does not hold.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `lifequest-e2e` puts this checkout's server on 5173 for the run.
 *
 * The artifact is `e2e/artifacts/images-board.json` plus the pictures the driver
 * captures — the empty library, the library with pictures, the remove question,
 * the Vision page with its board, and the narrow library.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/images-board.json");

type Picture = { complete: boolean; width: number };
type Block = {
  kind: string | null;
  text?: string | null;
  heading?: string | null;
  caption?: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  consoleErrors: string[];
  checks: {
    rail: { label: string | null; href: string | null; active: boolean }[];
    activeRail: string | null;
    route: string | null;
    imagesPage: {
      eyebrow: string | null;
      title: string | null;
      crosslink: string | null;
      presence: { library: boolean; board: number; boardPanel: number };
      states: { libraryEmpty: string | null; boardEmpty: string | null };
    };
    empty: { libraryEmpty: string | null; count: string | null };
    uploaded: {
      cards: number;
      badge: string | null;
      summary: string | null;
      pictures: Picture[];
      store: { name: string; bytes: number }[];
    };
    caption: { stored: string | null };
    confirm: { title: string | null; message: string | null };
    removed: { cards: number; badge: string | null; storedImages: number };
    visionPage: {
      route: string | null;
      title: string | null;
      doctrineCardTitle: string | null;
      doctrineCards: number;
      boardHeading: string | null;
      boardEmpty: string | null;
      boardPresent: number;
      libraryPresent: boolean;
    };
    text: { blocks: Block[]; stored: Block[] };
    structure: {
      kinds: (string | null)[];
      heading: string | null;
      bullets: string[][];
      storedKinds: string[];
    };
    picker: { options: number; images: number };
    picked: { imageBlocks: number; pickerOpen: number; imageIds: string[] };
    boardDrop: {
      imageBlocks: number;
      library: number;
      decoded: Picture[];
      storedKinds: string[];
    };
    reorder: { screen: (string | null)[]; stored: string[] };
    backspace: { blocks: (string | null)[]; stored: string[] };
    refused: { status: string | null; error: string | null };
    recovered: { status: string | null; heading: string | null };
    missingPicture: {
      missingBlocks: number;
      blocks: (string | null)[];
      storedImages: number;
      storedKinds: string[];
    };
    final: {
      route: string | null;
      status: string | null;
      unexpected: string[];
      saveControls: number;
      boardBlocks: number;
    };
    narrow: {
      columns: string | null;
      board: number;
      viewport: { width: number; height: number };
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
  "images-board-library.png",
  "images-board-delete-question.png",
  "images-board-vision.png",
  "images-board-narrow.png",
];

describe("Define → Images, and the vision board on Vision", () => {
  it("keeps the library on Images, writes the board on Vision, and keeps a removed picture's place", async (t) => {
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

    // It is the Define wing's page, and it is the library — not the board.
    assert.equal(checks.activeRail, "Images");
    assert.equal(checks.route, "/images");
    assert.equal(checks.imagesPage.eyebrow, "Define");
    assert.equal(checks.imagesPage.title, "Images");
    assert.equal(checks.imagesPage.presence.library, true);
    assert.equal(checks.imagesPage.presence.board, 0);
    assert.equal(checks.imagesPage.presence.boardPanel, 0);
    assert.equal(checks.imagesPage.crosslink, "/vision");
    assert.ok(
      checks.rail.some((item) => item.label === "Images" && item.href === "/images"),
      "no Images row on the rail",
    );
    assert.ok(
      checks.rail.some((item) => item.label === "Vision" && item.href === "/vision"),
      "no Vision row on the rail",
    );

    // The vault starts empty, and the page says so.
    assert.match(checks.empty.libraryEmpty ?? "", /No pictures yet/);
    assert.equal(checks.empty.count, "0");

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

    // Removing asked by name, Cancel kept it, Confirm deleted it from the vault.
    assert.match(checks.confirm.message ?? "", /hills\.png/);
    assert.equal(checks.removed.cards, 1);
    assert.equal(checks.removed.storedImages, 1);

    // The board lives on Vision, below the doctrine card it did not replace.
    assert.equal(checks.visionPage.route, "/vision");
    assert.equal(checks.visionPage.title, "Vision");
    assert.equal(checks.visionPage.doctrineCards, 1);
    assert.equal(checks.visionPage.doctrineCardTitle, "Vision & Desire");
    assert.equal(checks.visionPage.boardHeading, "Vision board");
    assert.equal(checks.visionPage.boardPresent, 1);
    assert.equal(checks.visionPage.libraryPresent, false);
    assert.match(checks.visionPage.boardEmpty ?? "", /empty/i);

    // Text typed into the board is the text the vault holds.
    assert.equal(
      checks.text.blocks.filter((block) => block.kind === "text").length,
      2,
    );
    assert.equal(
      checks.text.stored.filter((block) => block.kind === "text").length,
      2,
    );

    // Heading and bullets survived the round trip; Enter added a bullet line.
    assert.equal(checks.structure.heading, "The life I'm reaching for");
    assert.deepEqual(checks.structure.bullets, [
      ["Walk before the house wakes", "Build one thing well"],
    ]);

    // The picker read the library and closed after choosing.
    assert.equal(checks.picker.options, 1);
    assert.equal(checks.picked.pickerOpen, 0);
    assert.equal(checks.picked.imageBlocks, 1);

    // A picture dropped into the board joined the library and inserted a block.
    assert.equal(checks.boardDrop.imageBlocks, 2);
    assert.equal(checks.boardDrop.library, 2);
    for (const picture of checks.boardDrop.decoded) {
      assert.equal(picture.width, 640, "a board picture did not decode");
    }

    // Reordering and Backspace changed the vault, not only the screen.
    assert.deepEqual(checks.reorder.screen, checks.reorder.stored);
    assert.deepEqual(checks.backspace.blocks, checks.backspace.stored);

    // A refused write reported itself and Ctrl+S wrote it for real.
    assert.match(checks.refused.error ?? "", /refused/i);
    assert.equal(checks.recovered.status, "Saved");
    assert.equal(checks.recovered.heading, "The life I'm actually reaching for");

    // A picture deleted on Images leaves the board's block drawing as missing.
    assert.equal(checks.missingPicture.storedImages, 1);
    assert.equal(checks.missingPicture.missingBlocks, 1);
    assert.equal(
      checks.missingPicture.blocks.filter((kind) => kind === "image").length,
      2,
    );
    assert.deepEqual(
      checks.missingPicture.blocks,
      checks.missingPicture.storedKinds,
    );

    // No Save control, no bridge hole, and the narrow page still has no board.
    assert.equal(checks.final.saveControls, 0);
    assert.deepEqual(checks.final.unexpected, []);
    assert.deepEqual(report.consoleErrors, []);
    assert.equal(checks.narrow.board, 0);
    assert.equal(
      (checks.narrow.columns ?? "").trim().split(/\s+/).filter(Boolean).length,
      1,
    );
  });
});
