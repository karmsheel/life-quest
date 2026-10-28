import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  IMAGE_MAX_BYTES,
  createVault,
  deleteImage,
  getVisionBoard,
  listImages,
  readImage,
  saveImage,
  saveVisionBoard,
  updateImage,
} from "@lifequest/vault-core";

/**
 * Define → Images, end to end, against a real vault on disk.
 *
 * This is the storage half of the new Define surface: the operator's uploaded
 * pictures live as real image files under `images/files/`, the library index
 * under `images/library.json`, and the written vision under `images/board.json`.
 * The IPC handlers call exactly these functions, so this file is the contract
 * between the page and the vault. The page's render half — gallery, block
 * editor, image blocks, autosave, delete — is the `images-board-ui` rig, which
 * needs a real layout engine and a dev server.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A file landing anywhere but `images/files/<id>.<ext>`, or two uploads
 *     sharing one file or one id.
 *  2. Bytes stored that the sniff refuses, or a declared mime that overrides the
 *     bytes: an SVG or an HTML file renamed `.png` must never become an <img>.
 *  3. The declared name walking a path, or a name from another platform
 *     (backslashes, drive letters, `..`) reaching the filesystem.
 *  4. A caption or name not surviving a fresh list, or update silently rewriting
 *     a different image.
 *  5. Delete leaving the file behind, or removing a file but keeping the row —
 *     the gallery then shows a broken image.
 *  6. A missing library reading as an error instead of "no images yet", and a
 *     corrupt one crashing the open vault.
 *  7. The vision board losing block order or type on the JSON round trip; image
 *     blocks losing the image they point at.
 *  8. A block referencing an image that was deleted making the whole board
 *     unsavable — the operator could not then edit their document at all.
 *  9. A refused board write damaging the board already on disk.
 * 10. Any path-shaped id (delete/update/read) reaching the filesystem.
 * 11. An artifact written by a failing run. The artifact is written last, so it
 *     only exists for a run that held.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT = path.join(
  desktopRoot,
  "e2e/artifacts/images-board-engine.json",
);

/** The smallest real pictures of each accepted kind, by magic bytes. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const WEBP = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

const is = (bytes: Uint8Array) => new Uint8Array(bytes);
const asBytes = (b: Buffer) => new Uint8Array(b);

describe("images library and vision board e2e", () => {
  it("stores uploaded pictures and a block document, and reads them back", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-images-"));
    const vaultRoot = path.join(workDir, "vault");
    const imagesDir = path.join(vaultRoot, "images");
    const filesDir = path.join(imagesDir, "files");
    const checks: Record<string, unknown> = {};

    const created = await createVault(vaultRoot, "Images Rig");
    assert.equal(
      created.ok,
      true,
      `createVault failed: ${created.ok ? "" : created.error}`,
    );

    // ── 1. a fresh vault reads as an empty page, not a failure ──────────────
    const fresh = await listImages(vaultRoot);
    assert.equal(fresh.ok, true, "a vault with no images must read as empty");
    assert.deepEqual(fresh.ok ? fresh.value : null, []);
    const freshBoard = await getVisionBoard(vaultRoot);
    assert.equal(freshBoard.ok, true, "a vault with no board must read as empty");
    assert.deepEqual(
      freshBoard.ok ? freshBoard.value.blocks : null,
      [],
      "a fresh vault reported blocks",
    );
    checks.fresh = {
      images: fresh.ok ? fresh.value : null,
      blocks: freshBoard.ok ? freshBoard.value.blocks : null,
    };

    // ── 2. uploading stores real bytes at the minted path ───────────────────
    const png = await saveImage(vaultRoot, {
      bytes: asBytes(PNG),
      mime: "image/png",
      name: "  Quiet morning.png  ",
      width: 1024,
      height: 768,
    });
    assert.equal(png.ok, true, `the first upload failed: ${png.ok ? "" : png.error}`);
    if (!png.ok) return;
    const morning = png.value;
    checks.first = morning;
    assert.match(morning.id, /^[0-9a-f-]{36}$/i, "the vault did not mint a uuid id");
    assert.equal(
      morning.relPath,
      `images/files/${morning.id}.png`,
      "the stored path is not the library's own",
    );
    assert.equal(morning.mime, "image/png");
    assert.equal(morning.name, "Quiet morning.png", "the name was not trimmed");
    assert.equal(morning.caption, "", "a new image must have an empty caption");
    assert.equal(morning.width, 1024);
    assert.equal(morning.height, 768);
    assert.equal(morning.bytes, PNG.byteLength);

    const storedPath = path.join(vaultRoot, ...morning.relPath.split("/"));
    assert.equal(fs.existsSync(storedPath), true, `no file at ${storedPath}`);
    assert.deepEqual(
      fs.readFileSync(storedPath),
      PNG,
      "the stored bytes differ from what was uploaded",
    );
    checks.layout = {
      library: fs.existsSync(path.join(imagesDir, "library.json")),
      board: fs.existsSync(path.join(imagesDir, "board.json")),
      files: fs.existsSync(filesDir),
    };
    assert.equal(checks.layout.library, true, "no images/library.json written");
    assert.equal(checks.layout.files, true, "no images/files directory written");

    // ── 3. every accepted kind is sniffed from its bytes ────────────────────
    const kinds: Array<[string, Buffer, string]> = [
      ["gif", GIF, "image/gif"],
      ["webp", WEBP, "image/webp"],
      ["jpeg", JPEG, "image/jpeg"],
    ];
    for (const [label, bytes, mime] of kinds) {
      const saved = await saveImage(vaultRoot, {
        bytes: asBytes(bytes),
        mime: "application/octet-stream", // deliberately wrong: bytes decide
        name: `${label}.bin`,
      });
      assert.equal(saved.ok, true, `upload of ${label} failed: ${saved.ok ? "" : saved.error}`);
      if (!saved.ok) continue;
      assert.equal(saved.value.mime, mime, `${label} was not sniffed as ${mime}`);
      assert.match(
        saved.value.relPath,
        new RegExp(`^images/files/[0-9a-f-]{36}\\.${label === "jpeg" ? "jpg" : label}$`),
        `${label} landed at ${saved.value.relPath}`,
      );
    }

    // ── 4. refused uploads leave the library untouched ──────────────────────
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const notImage = await saveImage(vaultRoot, {
      bytes: new Uint8Array(svg),
      mime: "image/png",
      name: "evil.png",
    });
    assert.equal(notImage.ok, false, "an SVG renamed .png was accepted");
    const empty = await saveImage(vaultRoot, {
      bytes: new Uint8Array(0),
      mime: "image/png",
      name: "empty.png",
    });
    assert.equal(empty.ok, false, "an empty file was accepted");
    const huge = await saveImage(vaultRoot, {
      bytes: new Uint8Array(IMAGE_MAX_BYTES + 1),
      mime: "image/png",
      name: "huge.png",
    });
    assert.equal(huge.ok, false, "a file over the ceiling was accepted");
    const traversal = await saveImage(vaultRoot, {
      bytes: asBytes(PNG),
      mime: "image/png",
      name: "../../escape.png",
    });
    assert.equal(traversal.ok, true, "a display name must not be confused with a path");
    if (traversal.ok) {
      assert.match(traversal.value.name, /^\.\.\/\.\.\/escape\.png$|^escape\.png$/);
      assert.match(traversal.value.relPath, /^images\/files\/[0-9a-f-]{36}\.png$/);
    }
    checks.refusals = {
      notImage: notImage.ok ? null : notImage.error,
      empty: empty.ok ? null : empty.error,
      huge: huge.ok ? null : huge.error,
    };
    const afterRefusals = await listImages(vaultRoot);
    assert.equal(afterRefusals.ok, true);
    assert.equal(
      afterRefusals.ok ? afterRefusals.value.length : -1,
      5,
      "a refused upload changed the library",
    );

    // ── 5. a fresh list sees every image, read-back returns the bytes ───────
    const listed = await listImages(vaultRoot);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.value.length, 5);
    const read = await readImage(vaultRoot, morning.relPath);
    assert.equal(read.ok, true, `read-back failed: ${read.ok ? "" : read.error}`);
    if (read.ok) {
      assert.equal(read.value.mime, "image/png");
      assert.deepEqual(Buffer.from(read.value.bytes), PNG);
    }

    // ── 6. captions and names survive a write and a re-read ─────────────────
    const updated = await updateImage(vaultRoot, morning.id, {
      caption: "Light before the house wakes.",
      name: "morning quiet.png",
    });
    assert.equal(updated.ok, true, `update failed: ${updated.ok ? "" : updated.error}`);
    if (updated.ok) {
      assert.equal(updated.value.caption, "Light before the house wakes.");
      assert.equal(updated.value.name, "morning quiet.png");
      assert.equal(updated.value.relPath, morning.relPath, "update moved the file");
    }
    const reread = await listImages(vaultRoot);
    assert.equal(reread.ok, true);
    const found = reread.ok
      ? reread.value.find((image) => image.id === morning.id)
      : undefined;
    assert.equal(found?.caption, "Light before the house wakes.");

    // ── 7. the vision board round-trips every block kind, in order ──────────
    const blocks = [
      { id: "b1", kind: "heading" as const, text: "The life I'm reaching for" },
      {
        id: "b2",
        kind: "text" as const,
        text: "A quiet house, morning light, work that is mine.",
      },
      { id: "b3", kind: "image" as const, imageId: morning.id, caption: "First light" },
      {
        id: "b4",
        kind: "bullets" as const,
        items: ["Write before the house wakes", "Walk in the hills", "Build one thing well"],
      },
      { id: "b5", kind: "text" as const, text: "" },
    ];
    const savedBoard = await saveVisionBoard(vaultRoot, { blocks });
    assert.equal(
      savedBoard.ok,
      true,
      `the board write failed: ${savedBoard.ok ? "" : savedBoard.error}`,
    );
    if (!savedBoard.ok) return;
    assert.deepEqual(savedBoard.value.blocks, blocks, "the board did not keep its blocks");
    assert.match(
      savedBoard.value.updatedAt,
      /^\d{4}-\d{2}-\d{2}T/,
      "the board has no update stamp",
    );
    const boardFile = path.join(imagesDir, "board.json");
    assert.equal(fs.existsSync(boardFile), true, "no images/board.json written");
    checks.board = JSON.parse(fs.readFileSync(boardFile, "utf8"));

    // ── 8. a refused write leaves the board that is already there ───────────
    const duplicate = await saveVisionBoard(vaultRoot, {
      blocks: [
        { id: "same", kind: "text", text: "one" },
        { id: "same", kind: "text", text: "two" },
      ],
    });
    assert.equal(duplicate.ok, false, "duplicate block ids were accepted");
    const unknownKind = await saveVisionBoard(vaultRoot, {
      blocks: [{ id: "b1", kind: "video", url: "nope" }],
    });
    assert.equal(unknownKind.ok, false, "an unknown block kind was accepted");
    const stillThere = await getVisionBoard(vaultRoot);
    assert.equal(stillThere.ok, true);
    assert.deepEqual(
      stillThere.ok ? stillThere.value.blocks : null,
      blocks,
      "a refused board write damaged the board",
    );
    checks.refusals.board = [duplicate.ok ? null : duplicate.error, unknownKind.ok ? null : unknownKind.error];

    // ── 9. a block pointing at a deleted image is not fatal ────────────────
    const deleted = await deleteImage(vaultRoot, morning.id);
    assert.equal(deleted.ok, true, `delete failed: ${deleted.ok ? "" : deleted.error}`);
    assert.equal(fs.existsSync(storedPath), false, "delete left the image file behind");
    const afterDelete = await listImages(vaultRoot);
    assert.equal(afterDelete.ok, true);
    assert.equal(
      afterDelete.ok ? afterDelete.value.some((image) => image.id === morning.id) : true,
      false,
      "delete left the image in the library",
    );
    const missingRead = await readImage(vaultRoot, morning.relPath);
    assert.equal(missingRead.ok, false, "reading a deleted image must fail");

    const boardAfterDelete = await getVisionBoard(vaultRoot);
    assert.equal(boardAfterDelete.ok, true, "a deleted image broke the board read");
    assert.equal(
      boardAfterDelete.ok
        ? boardAfterDelete.value.blocks.some(
            (block) => block.kind === "image" && block.imageId === morning.id,
          )
        : false,
      true,
      "the board lost the block that names the deleted image",
    );
    const resave = await saveVisionBoard(vaultRoot, {
      blocks: [
        ...(boardAfterDelete.ok ? boardAfterDelete.value.blocks : []),
        { id: "b6", kind: "text", text: "A picture can be replaced." },
      ],
    });
    assert.equal(
      resave.ok,
      true,
      "a board naming a deleted image could not be saved again",
    );

    // ── 10. path-shaped ids never reach the filesystem ─────────────────────
    const badDelete = await deleteImage(vaultRoot, "../library.json");
    assert.equal(badDelete.ok, false, "a path-shaped image id reached delete");
    const badRead = await readImage(vaultRoot, "images/files/../../lifequest.json");
    assert.equal(badRead.ok, false, "a traversing media path reached read");
    const foreignRead = await readImage(vaultRoot, "likeness/files/x.png");
    assert.equal(foreignRead.ok, false, "a foreign path was accepted as media");

    // ── 11. a corrupt library is an error, not a crash ─────────────────────
    fs.writeFileSync(path.join(imagesDir, "library.json"), "{ not json");
    const corrupt = await listImages(vaultRoot);
    assert.equal(corrupt.ok, false, "a corrupt library read as an empty page");
    checks.corrupt = corrupt.ok ? null : corrupt.error;

    checks.pass = true;
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(checks, null, 2)}\n`);
  });
});
