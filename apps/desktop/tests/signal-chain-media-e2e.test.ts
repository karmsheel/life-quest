import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createSignal,
  createVault,
  deleteSignal,
  listSignals,
  readSignalImage,
  updateSignal,
  vaultPaths,
  type SignalRecord,
} from "@lifequest/vault-core";

/**
 * The Life-Chain capture store, end to end, against a real vault on disk.
 *
 * This is the engine under the general capture surface: a text capture, a link
 * with a description, and a picture whose bytes are files under
 * `.lifequest/signal-chain/files/` while the record names the path. The render
 * half — the capture box, the previews, the rows — is the `chain-capture` rig;
 * here the claims are about what reached the disk.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A text capture that stops parsing now that records carry an attachment.
 *  2. A picture written into the record as base64, or a record pointing at a
 *     file that was never written, or the uploaded name deciding the extension
 *     instead of the sniffed bytes.
 *  3. A refused image (not a picture, empty, over the limit) leaving an orphan
 *     file or a record behind.
 *  4. A link stored with a relative path, `javascript:`, `file:` or prose.
 *  5. An attachment-only capture refused because its description is empty, or a
 *     text-only capture accepted with no words at all.
 *  6. An update of the description dropping the attachment.
 *  7. An old record without an `attachment` key read as malformed, or a record
 *     whose attachment is unsafe read as a row.
 *  8. A soft delete erasing the picture's bytes from the vault.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/signal-chain-media.json");

/** A real 1×1 PNG: the same bytes a browser would hand the capture box. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function imageFiles(vaultRoot: string): string[] {
  const dir = vaultPaths(vaultRoot).signalChainFilesDir;
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

describe("Life-Chain capture store e2e", () => {
  it("persists text, link and image captures", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-chain-capture-"));
    const vaultRoot = path.join(workDir, "vault");
    const chainDir = vaultPaths(vaultRoot).signalChainDir;
    const checks: Record<string, unknown> = { vaultRoot };

    const created = await createVault(vaultRoot, "Life-Chain Capture Rig");
    assert.equal(created.ok, true, "createVault failed");

    // ── 1. a fresh chain is empty ───────────────────────────────────────────
    const fresh = await listSignals(vaultRoot);
    assert.equal(fresh.ok, true);
    assert.deepEqual(fresh.ok ? fresh.value : null, { records: [], skipped: 0 });
    checks.fresh = fresh.ok ? fresh.value : null;

    // ── 2. text capture: still a body, still no attachment ──────────────────
    const text = await createSignal(vaultRoot, {
      type: "thought",
      body: "  A thought worth keeping  ",
    });
    assert.equal(text.ok, true, "text capture was refused");
    const textRecord = text.ok ? text.value : null;
    assert.ok(textRecord);
    assert.equal(textRecord.body, "A thought worth keeping");
    assert.equal(textRecord.attachment, null);
    const textFile = vaultPaths(vaultRoot).signalChainJson(textRecord.id);
    const textOnDisk = JSON.parse(fs.readFileSync(textFile, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(textOnDisk.attachment, null, "the record did not carry a null attachment");
    checks.text = textRecord;

    // A text capture still needs words; one file was written, not two.
    const emptyText = await createSignal(vaultRoot, {
      type: "thought",
      body: "   \n\t ",
    });
    assert.equal(emptyText.ok, false, "an empty text capture was accepted");
    assert.equal(fs.readdirSync(chainDir).filter((f) => f.endsWith(".json")).length, 1);
    checks.emptyTextError = emptyText.ok ? null : emptyText.error;

    // ── 3. link capture: absolute http(s), normalized, no file ──────────────
    const link = await createSignal(vaultRoot, {
      type: "thought",
      body: "Read this after the review.",
      attachment: { kind: "link", url: "  https://example.com/article?q=1  " },
    });
    assert.equal(link.ok, true, "a valid link capture was refused");
    const linkRecord = link.ok ? link.value : null;
    assert.ok(linkRecord);
    assert.deepEqual(linkRecord.attachment, {
      kind: "link",
      url: "https://example.com/article?q=1",
    });
    for (const bad of ["example.com", "javascript:alert(1)", "file:///etc/passwd", ""]) {
      const refused = await createSignal(vaultRoot, {
        type: "thought",
        body: "bad link",
        attachment: { kind: "link", url: bad },
      });
      assert.equal(refused.ok, false, `a bad link was stored: ${bad}`);
    }
    checks.link = linkRecord;

    // ── 4. image capture: bytes are a file, the record names it ─────────────
    const image = await createSignal(vaultRoot, {
      type: "thought",
      body: "",
      attachment: {
        kind: "image",
        bytes: new Uint8Array(PNG),
        name: "..\\hills.png",
        width: 640,
        height: 480,
      },
    });
    assert.equal(image.ok, true, "an image-only capture was refused");
    const imageRecord = image.ok ? image.value : null;
    assert.ok(imageRecord);
    assert.equal(imageRecord.body, "", "the description was invented");
    assert.ok(imageRecord.attachment);
    assert.equal(imageRecord.attachment.kind, "image");
    if (imageRecord.attachment.kind !== "image") throw new Error("not an image");
    assert.match(
      imageRecord.attachment.relPath,
      /^\.lifequest\/signal-chain\/files\/[0-9a-f-]{36}\.png$/,
      "the stored path is not under signal-chain/files",
    );
    assert.equal(imageRecord.attachment.name, "hills.png", "the name was not reduced to a label");
    assert.equal(imageRecord.attachment.mime, "image/png");
    assert.equal(imageRecord.attachment.width, 640);
    assert.equal(imageRecord.attachment.height, 480);
    const storedFiles = imageFiles(vaultRoot);
    assert.equal(storedFiles.length, 1, "the picture did not become one file");
    const storedPath = path.join(
      vaultPaths(vaultRoot).signalChainFilesDir,
      storedFiles[0]!,
    );
    assert.deepEqual(fs.readFileSync(storedPath), PNG, "the stored bytes differ from the upload");
    checks.imagePath = imageRecord.attachment.relPath;

    // The renderer reads the bytes back through the guarded path.
    const read = await readSignalImage(vaultRoot, imageRecord.attachment.relPath);
    assert.equal(read.ok, true, "the stored picture could not be read back");
    assert.equal(read.ok ? read.value.mime : null, "image/png");
    assert.deepEqual(Buffer.from(read.ok ? read.value.bytes : []), PNG);
    const traversal = await readSignalImage(vaultRoot, "../../../etc/passwd");
    assert.equal(traversal.ok, false, "a traversing image path was read");
    checks.readBack = read.ok ? { mime: read.value.mime, bytes: read.value.bytes.length } : null;

    // ── 5. refused pictures leave nothing behind ────────────────────────────
    const beforeRefusals = imageFiles(vaultRoot).length;
    const notAnImage = await createSignal(vaultRoot, {
      type: "thought",
      body: "not a picture",
      attachment: {
        kind: "image",
        bytes: new TextEncoder().encode("<html>not a picture</html>"),
        name: "fake.png",
      },
    });
    assert.equal(notAnImage.ok, false, "HTML renamed .png was stored as a picture");
    const emptyImage = await createSignal(vaultRoot, {
      type: "thought",
      body: "empty file",
      attachment: { kind: "image", bytes: new Uint8Array(0), name: "empty.png" },
    });
    assert.equal(emptyImage.ok, false, "an empty image was stored");
    const tooBig = await createSignal(vaultRoot, {
      type: "thought",
      body: "huge",
      attachment: {
        kind: "image",
        bytes: new Uint8Array(8 * 1024 * 1024 + 1),
        name: "huge.png",
      },
    });
    assert.equal(tooBig.ok, false, "an oversized image was stored");
    assert.equal(imageFiles(vaultRoot).length, beforeRefusals, "a refusal left an orphan file");
    checks.refusals = {
      notAnImage: notAnImage.ok ? null : notAnImage.error,
      emptyImage: emptyImage.ok ? null : emptyImage.error,
      tooBig: tooBig.ok ? null : tooBig.error,
    };

    // ── 6. every record across the three kinds lists back ───────────────────
    const listed = await listSignals(vaultRoot);
    assert.equal(listed.ok, true);
    const records = listed.ok ? listed.value.records : [];
    assert.equal(records.length, 3);
    const kinds = records.map((r) => r.attachment?.kind ?? "text");
    assert.deepEqual(kinds.sort(), ["image", "link", "text"]);
    assert.equal(listed.ok ? listed.value.skipped : -1, 0);
    checks.listed = records.map((r: SignalRecord) => ({
      id: r.id,
      attachment: r.attachment?.kind ?? null,
      body: r.body,
    }));

    // ── 7. the description can change; the attachment survives ──────────────
    const described = await updateSignal(vaultRoot, imageRecord.id, {
      body: "Where the idea started.",
    });
    assert.equal(described.ok, true);
    assert.deepEqual(
      described.ok ? described.value.attachment : null,
      imageRecord.attachment,
      "editing the description dropped the picture",
    );
    const cleared = await updateSignal(vaultRoot, imageRecord.id, { body: "" });
    assert.equal(cleared.ok, true, "an attachment-only capture could not clear its description");
    const textCleared = await updateSignal(vaultRoot, textRecord.id, { body: "" });
    assert.equal(textCleared.ok, false, "a text capture was left with no words and no attachment");
    checks.updated = {
      attachmentKept: described.ok ? described.value.attachment?.kind : null,
      cleared: cleared.ok,
      textCleared: textCleared.ok,
    };

    // ── 8. an old record with no `attachment` key still parses ──────────────
    const legacyId = "00000000-0000-4000-8000-000000000001";
    fs.writeFileSync(
      vaultPaths(vaultRoot).signalChainJson(legacyId),
      `${JSON.stringify(
        {
          id: legacyId,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
          type: "thought",
          source: "manual",
          sourceRef: null,
          title: null,
          body: "A capture from before pictures existed.",
          domainSlug: null,
        },
        null,
        2,
      )}\n`,
    );
    const legacy = await listSignals(vaultRoot);
    const legacyRecord = legacy.ok
      ? legacy.value.records.find((r) => r.id === legacyId)
      : undefined;
    assert.ok(legacyRecord, "a pre-attachment record was skipped");
    assert.equal(legacyRecord.attachment, null);

    // ── 9. an unsafe attachment fails the record, not the chain ─────────────
    const unsafeId = "00000000-0000-4000-8000-000000000002";
    fs.writeFileSync(
      vaultPaths(vaultRoot).signalChainJson(unsafeId),
      `${JSON.stringify({
        id: unsafeId,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        deletedAt: null,
        type: "thought",
        source: "manual",
        sourceRef: null,
        title: null,
        body: "",
        domainSlug: null,
        attachment: { kind: "image", relPath: "../../../etc/passwd", name: "x", mime: "image/png" },
      })}\n`,
    );
    const afterUnsafe = await listSignals(vaultRoot);
    assert.equal(afterUnsafe.ok, true, "one malformed record broke the chain");
    assert.equal(afterUnsafe.ok ? afterUnsafe.value.records.length : -1, 4);
    assert.equal(afterUnsafe.ok ? afterUnsafe.value.skipped : -1, 1);
    assert.equal(
      afterUnsafe.ok ? afterUnsafe.value.records.some((r) => r.id === unsafeId) : true,
      false,
      "a record with a traversing picture path was listed",
    );
    checks.legacy = legacyRecord;

    // ── 10. soft delete keeps the record and the picture's bytes ────────────
    const removed = await deleteSignal(vaultRoot, imageRecord.id);
    assert.equal(removed.ok, true);
    assert.ok(removed.ok ? removed.value.deletedAt : null);
    const afterDelete = await listSignals(vaultRoot);
    assert.equal(
      afterDelete.ok ? afterDelete.value.records.some((r) => r.id === imageRecord.id) : true,
      false,
      "a deleted capture stayed on the chain",
    );
    assert.equal(imageFiles(vaultRoot).length, beforeRefusals, "the delete erased the picture's file");
    assert.equal(
      fs.existsSync(vaultPaths(vaultRoot).signalChainJson(imageRecord.id)),
      true,
      "the record file was erased instead of stamped",
    );
    checks.deleted = {
      listed: afterDelete.ok ? afterDelete.value.records.length : null,
      imageFiles: imageFiles(vaultRoot).length,
    };

    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    fs.writeFileSync(
      ARTIFACT,
      `${JSON.stringify({ pass: true, checks, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    assert.equal(fs.existsSync(ARTIFACT), true);
  });
});
