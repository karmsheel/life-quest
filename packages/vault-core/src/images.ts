/**
 * Define → Images: the operator's picture library, and the one long vision
 * document written beside it.
 *
 * The pictures are files — `images/files/<id>.<ext>` — because a vault that
 * holds the operator's photographs must hold what they uploaded, not a base64
 * copy inside JSON. Two small files sit beside them:
 *
 *   images/library.json  the index: id, display name, caption, kind, size
 *   images/board.json    the document: an ordered array of typed blocks
 *
 * Both are plain JSON so the vault is readable without the app; the picture
 * bytes are the source of truth for the pictures, and the index is only as
 * authoritative as any cache. An entry whose file has gone is still listed and
 * drawn as missing rather than silently dropped, so the operator can see what
 * happened to their library.
 *
 * Pictures are attacker-influenced bytes: the renderer picks them from the
 * filesystem, and the file name and declared mime are both operator strings.
 * So the kind is sniffed from the leading bytes (the name never decides), the
 * display name is reduced to one harmless segment and never used as a path,
 * the size is bounded before the write, and every read goes through the same
 * physical-containment guard as the rest of the vault.
 *
 * The document is small on purpose: text, heading, bullets and a picture with
 * its caption. A block that names a deleted picture is kept — the operator may
 * have meant to replace the picture, and a document that cannot be saved
 * because one image went away would be worse than a gap to fix.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteBytes, atomicWriteFile } from "./atomic-write.ts";
import {
  assertNoSymlinkLeaf,
  assertPhysicalContainment,
  vaultPaths,
} from "./paths.ts";
import {
  IMAGE_MIME_EXT,
  type ImageMimeType,
  type ImageSaveInput,
  type ImageUpdatePatch,
  type Result,
  type VaultImage,
  type VisionBoard,
  type VisionBoardBlock,
} from "./types.ts";

/** The original may be this large; the vault keeps it as it arrived. */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** A display name is a label, not a path and not a paragraph. */
export const IMAGE_NAME_MAX = 200;
export const IMAGE_CAPTION_MAX = 2000;
/** A vision document is one page of blocks, not an import target. */
export const BOARD_MAX_BLOCKS = 1000;
export const BOARD_TEXT_MAX = 20_000;
export const BOARD_HEADING_MAX = 500;
export const BOARD_ITEMS_MAX = 200;
export const BOARD_ITEM_MAX = 2000;
export const BOARD_IMAGE_CAPTION_MAX = 2000;
/** The whole document is bounded, so a paste cannot grow the file unbounded. */
export const BOARD_MAX_BYTES = 2 * 1024 * 1024;

/** The ids this module mints and the ids it will accept back. */
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** A stored picture path: ours only, one flat file under images/files/. */
const IMAGE_REL_PATH =
  /^images\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp)$/i;
const BLOCK_KINDS = ["text", "heading", "bullets", "image"] as const;

const MIME_BY_EXT: Record<string, ImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

type LibraryFile = { version: 1; images: VaultImage[] };
type BoardFile = { version: 1; blocks: VisionBoardBlock[]; updatedAt: string };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * The kind, read from the bytes. The declared mime and the file name are both
 * strings an operator controls, so neither is allowed to decide what is stored:
 * an HTML file renamed `.png` never becomes a picture the page will draw.
 */
export function sniffImageMime(bytes: Uint8Array): ImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, i) => bytes[i] === byte)) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** A label the page may show: one path segment's worth, no control characters. */
function displayName(raw: unknown): string {
  const source = typeof raw === "string" ? raw : "";
  const base = source.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, IMAGE_NAME_MAX)
    .trim();
  return cleaned || "Image";
}

/** A finite positive integer canvas edge, or null when the caller did not say. */
function canvasEdge(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 100_000) {
    return null;
  }
  return raw;
}

function captionOf(raw: unknown): string {
  return typeof raw === "string" ? raw.slice(0, IMAGE_CAPTION_MAX) : "";
}

/**
 * One library mutation at a time.
 *
 * Upload, caption and delete are read-modify-write over one JSON file. The
 * renderer serializes its own writes, but an upload and a caption edit can
 * still be in flight together; without this the later write would silently
 * drop the earlier one. The chain holds no state beyond ordering, and a failed
 * job does not poison the queue for the next one.
 */
let libraryChain: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = libraryChain.then(work, work);
  libraryChain = next.catch(() => undefined);
  return next;
}

/** Read the index. A missing file is an empty library, not an error. */
async function readLibrary(rootPath: string): Promise<Result<LibraryFile>> {
  const paths = vaultPaths(rootPath);
  let raw: string;
  try {
    await assertPhysicalContainment(rootPath, paths.imagesLibraryJson, "read");
    await assertNoSymlinkLeaf(paths.imagesLibraryJson);
    raw = await fs.readFile(paths.imagesLibraryJson, "utf8");
  } catch (e) {
    if (isMissing(e)) return { ok: true, value: { version: 1, images: [] } };
    return { ok: false, error: `Could not read the image library: ${message(e)}` };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as LibraryFile).images)) {
      return { ok: false, error: "The image library is malformed" };
    }
    const images: VaultImage[] = [];
    for (const entry of (parsed as LibraryFile).images) {
      const image = normalizeStoredImage(entry);
      if (!image) return { ok: false, error: "The image library is malformed" };
      images.push(image);
    }
    return { ok: true, value: { version: 1, images } };
  } catch (e) {
    return { ok: false, error: `Could not read the image library: ${message(e)}` };
  }
}

/** An index entry as the page expects it, or null when it is not ours. */
function normalizeStoredImage(raw: unknown): VaultImage | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || !IMAGE_ID.test(entry.id)) return null;
  if (typeof entry.relPath !== "string" || !IMAGE_REL_PATH.test(entry.relPath)) return null;
  const ext = entry.relPath.slice(entry.relPath.lastIndexOf(".") + 1).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  return {
    id: entry.id.toLowerCase(),
    relPath: entry.relPath,
    name: displayName(entry.name),
    caption: captionOf(entry.caption),
    mime,
    bytes: typeof entry.bytes === "number" && entry.bytes >= 0 ? entry.bytes : 0,
    width: canvasEdge(entry.width),
    height: canvasEdge(entry.height),
    createdAt:
      typeof entry.createdAt === "string" && entry.createdAt
        ? entry.createdAt
        : new Date(0).toISOString(),
  };
}

async function writeLibrary(rootPath: string, images: VaultImage[]): Promise<void> {
  const paths = vaultPaths(rootPath);
  await assertPhysicalContainment(rootPath, paths.imagesLibraryJson, "write");
  const body: LibraryFile = { version: 1, images };
  await atomicWriteFile(paths.imagesLibraryJson, `${JSON.stringify(body, null, 2)}\n`);
}

/** Every picture in the library, in upload order. A fresh vault is empty. */
export async function listImages(rootPath: string): Promise<Result<VaultImage[]>> {
  const library = await readLibrary(rootPath);
  return library.ok ? { ok: true, value: library.value.images } : library;
}

/**
 * Store one uploaded picture and its index row.
 *
 * The file is written before the index, so a crash between the two leaves an
 * orphan file and, at worst, a library that does not list it — never an index
 * row that points at nothing. If the index write fails, the file is removed
 * again so a refused upload leaves the library exactly as it was.
 */
export async function saveImage(
  rootPath: string,
  input: ImageSaveInput,
): Promise<Result<VaultImage>> {
  if (!(input.bytes instanceof Uint8Array)) {
    return { ok: false, error: "Invalid image bytes" };
  }
  if (input.bytes.byteLength === 0) {
    return { ok: false, error: "That image is empty." };
  }
  if (input.bytes.byteLength > IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: `That image is larger than ${Math.round(IMAGE_MAX_BYTES / (1024 * 1024))} MB.`,
    };
  }
  const mime = sniffImageMime(input.bytes);
  if (!mime) {
    return { ok: false, error: "Images must be PNG, JPEG, GIF or WebP." };
  }
  const ext = IMAGE_MIME_EXT[mime];
  const id = randomUUID();
  const paths = vaultPaths(rootPath);
  const filePath = paths.imageFile(id, ext);

  return serialized(async () => {
    try {
      const library = await readLibrary(rootPath);
      if (!library.ok) return library;
      const image: VaultImage = {
        id,
        relPath: `images/files/${id}.${ext}`,
        name: displayName(input.name),
        caption: "",
        mime,
        bytes: input.bytes.byteLength,
        width: canvasEdge(input.width),
        height: canvasEdge(input.height),
        createdAt: new Date().toISOString(),
      };
      await assertPhysicalContainment(rootPath, filePath, "write");
      await atomicWriteBytes(filePath, input.bytes);
      try {
        await writeLibrary(rootPath, [...library.value.images, image]);
      } catch (e) {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
        throw e;
      }
      return { ok: true, value: image };
    } catch (e) {
      return { ok: false, error: `Could not save that image: ${message(e)}` };
    }
  });
}

/** The bytes of one stored picture, for the renderer to draw from a blob URL. */
export async function readImage(
  rootPath: string,
  relPath: string,
): Promise<Result<{ bytes: Uint8Array; mime: ImageMimeType }>> {
  try {
    if (typeof relPath !== "string" || !IMAGE_REL_PATH.test(relPath)) {
      return { ok: false, error: `Invalid image path: ${String(relPath)}` };
    }
    const match = IMAGE_REL_PATH.exec(relPath)!;
    const id = match[1]!.toLowerCase();
    const ext = match[2]!.toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return { ok: false, error: `Unsupported image type: ${ext}` };
    const paths = vaultPaths(rootPath);
    const filePath = paths.imageFile(id, ext);
    await assertPhysicalContainment(rootPath, filePath, "read");
    await assertNoSymlinkLeaf(filePath);
    const bytes = await fs.readFile(filePath);
    return { ok: true, value: { bytes: new Uint8Array(bytes), mime } };
  } catch (e) {
    if (isMissing(e)) return { ok: false, error: "That image is missing from the vault." };
    return { ok: false, error: `Could not read that image: ${message(e)}` };
  }
}

/** Rename a picture, caption it, or both. The stored file never moves. */
export async function updateImage(
  rootPath: string,
  id: string,
  patch: ImageUpdatePatch,
): Promise<Result<VaultImage>> {
  if (typeof id !== "string" || !IMAGE_ID.test(id)) {
    return { ok: false, error: "Invalid image id" };
  }
  return serialized(async () => {
    try {
      const library = await readLibrary(rootPath);
      if (!library.ok) return library;
      const index = library.value.images.findIndex((image) => image.id === id);
      if (index < 0) return { ok: false, error: "Image not found" };
      const existing = library.value.images[index]!;
      const next: VaultImage = {
        ...existing,
        name: patch.name === undefined ? existing.name : displayName(patch.name),
        caption:
          patch.caption === undefined ? existing.caption : captionOf(patch.caption),
      };
      const images = [...library.value.images];
      images[index] = next;
      await writeLibrary(rootPath, images);
      return { ok: true, value: next };
    } catch (e) {
      return { ok: false, error: `Could not update that image: ${message(e)}` };
    }
  });
}

/** Remove a picture from the library and its bytes from the vault. */
export async function deleteImage(
  rootPath: string,
  id: string,
): Promise<Result<{ id: string }>> {
  if (typeof id !== "string" || !IMAGE_ID.test(id)) {
    return { ok: false, error: "Invalid image id" };
  }
  return serialized(async () => {
    try {
      const library = await readLibrary(rootPath);
      if (!library.ok) return library;
      const existing = library.value.images.find((image) => image.id === id);
      if (!existing) return { ok: false, error: "Image not found" };
      await writeLibrary(
        rootPath,
        library.value.images.filter((image) => image.id !== id),
      );
      const paths = vaultPaths(rootPath);
      const ext = existing.relPath.slice(existing.relPath.lastIndexOf(".") + 1).toLowerCase();
      const filePath = paths.imageFile(id, ext);
      await assertPhysicalContainment(rootPath, filePath, "write");
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      return { ok: true, value: { id } };
    } catch (e) {
      return { ok: false, error: `Could not remove that image: ${message(e)}` };
    }
  });
}

/**
 * Validate blocks on their way into the vault. Unknown kinds are refused rather
 * than dropped: a document the page cannot draw is a bug, not a silent edit.
 */
function validateBlocks(raw: unknown): Result<VisionBoardBlock[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "blocks must be an array" };
  if (raw.length > BOARD_MAX_BLOCKS) {
    return { ok: false, error: `A vision document holds at most ${BOARD_MAX_BLOCKS} blocks` };
  }
  const blocks: VisionBoardBlock[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "A block must be an object" };
    }
    const block = entry as Record<string, unknown>;
    if (typeof block.id !== "string" || !BLOCK_ID.test(block.id)) {
      return { ok: false, error: "A block needs a safe id" };
    }
    if (ids.has(block.id)) return { ok: false, error: `Duplicate block id: ${block.id}` };
    ids.add(block.id);
    const kind = block.kind;
    if (typeof kind !== "string" || !(BLOCK_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, error: `Unknown block kind: ${String(kind)}` };
    }
    if (kind === "text" || kind === "heading") {
      if (typeof block.text !== "string") {
        return { ok: false, error: `${kind} block requires text` };
      }
      const max = kind === "text" ? BOARD_TEXT_MAX : BOARD_HEADING_MAX;
      if (block.text.length > max) {
        return { ok: false, error: `${kind} block is longer than ${max} characters` };
      }
      blocks.push(
        kind === "text"
          ? { id: block.id, kind: "text", text: block.text }
          : { id: block.id, kind: "heading", text: block.text },
      );
      continue;
    }
    if (kind === "bullets") {
      if (!Array.isArray(block.items)) {
        return { ok: false, error: "bullets block requires items" };
      }
      if (block.items.length > BOARD_ITEMS_MAX) {
        return { ok: false, error: `bullets block holds at most ${BOARD_ITEMS_MAX} lines` };
      }
      const items: string[] = [];
      for (const item of block.items) {
        if (typeof item !== "string") return { ok: false, error: "a bullet must be text" };
        if (item.length > BOARD_ITEM_MAX) {
          return { ok: false, error: `a bullet is longer than ${BOARD_ITEM_MAX} characters` };
        }
        items.push(item);
      }
      blocks.push({ id: block.id, kind: "bullets", items });
      continue;
    }
    // image
    if (typeof block.imageId !== "string" || !IMAGE_ID.test(block.imageId)) {
      return { ok: false, error: "image block requires an image id" };
    }
    if (block.caption !== undefined && typeof block.caption !== "string") {
      return { ok: false, error: "image caption must be text" };
    }
    if (typeof block.caption === "string" && block.caption.length > BOARD_IMAGE_CAPTION_MAX) {
      return { ok: false, error: "image caption is too long" };
    }
    blocks.push({
      id: block.id,
      kind: "image",
      imageId: block.imageId.toLowerCase(),
      caption: typeof block.caption === "string" ? block.caption : "",
    });
  }
  const size = JSON.stringify(blocks).length;
  if (size > BOARD_MAX_BYTES) {
    return { ok: false, error: "A vision document is larger than 2 MB" };
  }
  return { ok: true, value: blocks };
}

/**
 * The vision document. A vault that has never saved one reads as a fresh,
 * empty document with no blocks — the page then draws its own empty state.
 */
export async function getVisionBoard(rootPath: string): Promise<Result<VisionBoard>> {
  const paths = vaultPaths(rootPath);
  let raw: string;
  try {
    await assertPhysicalContainment(rootPath, paths.imagesBoardJson, "read");
    await assertNoSymlinkLeaf(paths.imagesBoardJson);
    raw = await fs.readFile(paths.imagesBoardJson, "utf8");
  } catch (e) {
    if (isMissing(e)) {
      return { ok: true, value: { blocks: [], updatedAt: new Date(0).toISOString() } };
    }
    return { ok: false, error: `Could not read the vision document: ${message(e)}` };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "The vision document is malformed" };
    }
    const file = parsed as BoardFile;
    const checked = validateBlocks(file.blocks);
    if (!checked.ok) return { ok: false, error: `The vision document is malformed: ${checked.error}` };
    return {
      ok: true,
      value: {
        blocks: checked.value,
        updatedAt:
          typeof file.updatedAt === "string" && file.updatedAt
            ? file.updatedAt
            : new Date(0).toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: `Could not read the vision document: ${message(e)}` };
  }
}

/** Replace the vision document. The whole block list is the write. */
export async function saveVisionBoard(
  rootPath: string,
  input: { blocks: unknown },
): Promise<Result<VisionBoard>> {
  const checked = validateBlocks(input?.blocks);
  if (!checked.ok) return checked;
  try {
    const paths = vaultPaths(rootPath);
    await assertPhysicalContainment(rootPath, paths.imagesBoardJson, "write");
    const value: VisionBoard = {
      blocks: checked.value,
      updatedAt: new Date().toISOString(),
    };
    const body: BoardFile = { version: 1, blocks: value.blocks, updatedAt: value.updatedAt };
    await atomicWriteFile(paths.imagesBoardJson, `${JSON.stringify(body, null, 2)}\n`);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: `Could not save the vision document: ${message(e)}` };
  }
}
