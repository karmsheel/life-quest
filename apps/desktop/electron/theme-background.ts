/**
 * Background pictures: one write into the profile, one read back out.
 *
 * A background is the operator's own wallpaper, never a theme file's bytes. The
 * renderer names a stored picture by file name only; this module is the one
 * place that copies a source picture in (`<app profile>/backgrounds/`) and the
 * one place that hands bytes back. Both sides take their rules from
 * `shared/theme-file.ts`, so the parser, the store and the rigs agree on what a
 * background file name is and how large a picture may be.
 *
 * The write path is content-addressed: the stored name carries a hash of the
 * bytes, so the same picture picked twice is one file, and a half-written copy
 * is never visible under the real name (write `.tmp`, then rename). Nothing here
 * touches the vault.
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertPhysicalContainment, type Result } from "@lifequest/vault-core";
import {
  BACKGROUND_IMAGE_FILE,
  MAX_BACKGROUND_IMAGE_BYTES,
} from "../shared/theme-file.ts";

/** `<app profile>/backgrounds/` — beside `themes/`, never in the vault. */
export function BACKGROUNDS_DIR(): string {
  return path.join(app.getPath("userData"), "backgrounds");
}

/** What can be stored. The extension picks the mime; the magic bytes confirm it. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * The one sentence a failed read gets.
 *
 * A picture that is gone, oversized, renamed or escaped is all the same quiet
 * chip to the page — the drawn preset still paints — so the renderer is not
 * handed a cause it cannot act on. This is the dialogue chat's refusal with the
 * chat image (`chat-image.ts`), kept deliberately identical in tone.
 */
const UNREADABLE = "That picture could not be read.";

/**
 * The first bytes must carry the format the extension claims.
 *
 * Duplicated from `chat-image.ts` on purpose (see the contract): that module's
 * door is the vault's and is kept free of Electron, and these four signatures
 * are two lines shorter than a shared module would be. If a format is added,
 * both places move together.
 */
function magicMatches(mime: string, bytes: Uint8Array): boolean {
  const starts = (offset: number, signature: readonly number[]): boolean =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, i) => bytes[offset + i] === byte);
  switch (mime) {
    case "image/png":
      return starts(0, [0x89, 0x50, 0x4e, 0x47]);
    case "image/jpeg":
      return starts(0, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return starts(0, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      return starts(0, [0x52, 0x49, 0x46, 0x46]) &&
        starts(8, [0x57, 0x45, 0x42, 0x50]);
    default:
      return false;
  }
}

/**
 * The source's own stem, made a legal stored slug: letters and digits, dashes
 * between runs, at most 48 characters. An unpronounceable stem becomes
 * `picture`, which still says what the file is.
 */
function slugFor(sourcePath: string): string {
  const stem = path.basename(sourcePath, path.extname(sourcePath));
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "picture";
}

/**
 * Copy one picture the operator picked into the profile.
 *
 * `sourcePath` is a path main chose — a dialog's answer, or a rig's queued
 * fixture — never a string the renderer handed over: a renderer that could name
 * the path could read any file the app can. The destination is
 * `<slug>-<sha256 first 12 hex>.<ext>`, so content is the identity: the same
 * picture stored twice reuses its file, and no name is ever overwritten with
 * different bytes.
 */
export async function storeBackground(
  sourcePath: string,
): Promise<Result<{ file: string }>> {
  if (typeof sourcePath !== "string" || sourcePath.trim() === "") {
    return { ok: false, error: "that file is not a picture" };
  }

  let size: number;
  try {
    const stat = await fs.stat(sourcePath);
    // A regular file only: a directory would be read as its error, and a fifo
    // would hang the read; neither is a picture.
    if (!stat.isFile()) return { ok: false, error: "that file is not a picture" };
    size = stat.size;
  } catch {
    return { ok: false, error: "that file could not be read" };
  }
  if (size > MAX_BACKGROUND_IMAGE_BYTES) {
    return { ok: false, error: "that picture is larger than 16 MB" };
  }

  const extension = path.extname(sourcePath).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) {
    return {
      ok: false,
      error: "only PNG, JPEG, GIF and WebP pictures can be used",
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await fs.readFile(sourcePath));
  } catch {
    return { ok: false, error: "that file could not be read" };
  }
  // The cap is re-applied to the bytes actually read: the stat and the read are
  // two moments, and the second one is what becomes the stored file.
  if (bytes.byteLength > MAX_BACKGROUND_IMAGE_BYTES) {
    return { ok: false, error: "that picture is larger than 16 MB" };
  }
  if (!magicMatches(mime, bytes)) {
    return { ok: false, error: "that file is not a picture" };
  }

  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const file = `${slugFor(sourcePath)}-${hash}${extension}`;
  const target = path.join(BACKGROUNDS_DIR(), file);
  try {
    await fs.mkdir(BACKGROUNDS_DIR(), { recursive: true });
    // The hash in the name means an existing file already holds these bytes. A
    // re-pick is a no-op rather than a second copy.
    try {
      const existing = await fs.stat(target);
      if (existing.isFile()) return { ok: true, value: { file } };
    } catch {
      // Not stored yet; the write below is the answer.
    }
    await fs.writeFile(`${target}.tmp`, bytes);
    await fs.rename(`${target}.tmp`, target);
    return { ok: true, value: { file } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "that picture could not be copied",
    };
  }
}

/**
 * Read one stored picture back to the page.
 *
 * The name is the whole capability: it must be a `BACKGROUND_IMAGE_FILE` name,
 * it is resolved under `backgrounds/` and proven contained there (a symlink out
 * of the profile is not a picture either), and the bytes must still be the
 * format the extension claims. Every failure is the one quiet sentence above.
 */
export async function readBackground(
  file: string,
): Promise<Result<{ bytes: Uint8Array; mime: string }>> {
  if (typeof file !== "string" || !BACKGROUND_IMAGE_FILE.test(file)) {
    return { ok: false, error: UNREADABLE };
  }
  const mime = MIME_BY_EXTENSION[path.extname(file).toLowerCase()];
  if (!mime) return { ok: false, error: UNREADABLE };

  let contained: string;
  try {
    contained = await assertPhysicalContainment(
      BACKGROUNDS_DIR(),
      path.join(BACKGROUNDS_DIR(), file),
    );
  } catch {
    return { ok: false, error: UNREADABLE };
  }

  try {
    const stat = await fs.stat(contained);
    if (!stat.isFile() || stat.size > MAX_BACKGROUND_IMAGE_BYTES) {
      return { ok: false, error: UNREADABLE };
    }
    const bytes = new Uint8Array(await fs.readFile(contained));
    if (
      bytes.byteLength > MAX_BACKGROUND_IMAGE_BYTES ||
      !magicMatches(mime, bytes)
    ) {
      return { ok: false, error: UNREADABLE };
    }
    return { ok: true, value: { bytes, mime } };
  } catch {
    return { ok: false, error: UNREADABLE };
  }
}

/** One stored picture, as the companion's `get_theme` inventory reports it. */
export type BackgroundInventoryEntry = {
  file: string;
  bytes: number;
  mime: string;
};

/**
 * Every stored picture, sorted by name.
 *
 * The companion can only name a picture that is already in the profile, so
 * `get_theme` reports the inventory instead of leaving it to guess. A missing
 * directory is an empty inventory, not an error: a profile that has never had a
 * picture stored has nothing to list, and the first store makes the folder. A
 * name that vanishes between the read and the stat, or that is not a regular
 * file, is skipped — the answer is a snapshot, not a promise.
 */
export async function listBackgrounds(): Promise<BackgroundInventoryEntry[]> {
  const dir = BACKGROUNDS_DIR();
  let names: string[];
  try {
    await fs.mkdir(dir, { recursive: true });
    names = (await fs.readdir(dir))
      .filter((name) => BACKGROUND_IMAGE_FILE.test(name))
      .sort();
  } catch {
    return [];
  }
  const entries: BackgroundInventoryEntry[] = [];
  for (const file of names) {
    const mime = MIME_BY_EXTENSION[path.extname(file).toLowerCase()];
    if (!mime) continue;
    try {
      const stat = await fs.stat(path.join(dir, file));
      if (!stat.isFile()) continue;
      entries.push({ file, bytes: stat.size, mime });
    } catch {
      // Vanished between the read and the stat: not in this snapshot.
    }
  }
  return entries;
}
