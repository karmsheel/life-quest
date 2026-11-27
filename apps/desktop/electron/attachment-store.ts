/**
 * The general attachment path: any file the operator drops on the composer,
 * stored in the vault so the agent can reach it with its own file tools.
 *
 * The receipt path (`receipt-image.ts`) is a different thing and stays where it
 * is. A receipt is an IMAGE the app re-encodes, logs a transaction from, and
 * cites by a finance-domain path; it needs the Finance kit and it is only ever
 * a picture. This path accepts anything — a video, a recording, a PDF — and its
 * only job is to put the operator's bytes somewhere durable and to say where.
 *
 * WHY A VAULT-LEVEL DIRECTORY AND NOT `saveDatabaseFile`:
 *
 * `saveDatabaseFile` is the right tool for a file that belongs to a domain's
 * database, and it refuses anything whose domain is not live
 * (`isDomainLive`). General attachments belong to no domain: a voice memo
 * dropped in a chat is not Health data and not Financial data, and picking one
 * of the seeded domains would file it under a lens the operator never chose.
 * The alternative — refusing to attach until the operator has a domain — would
 * make the composer's attach button fail for reasons that have nothing to do
 * with the file.
 *
 * So the bytes go to `attachments/files/<uuid>/<name>` inside the vault root,
 * which mirrors the receipt convention (`<place>/files/<uuid>/<name>`) without
 * borrowing a domain's name for it. The safety rules `saveDatabaseFile`
 * applies are the ones that matter here and they are applied here too:
 *
 *  - the size is bounded (the vault is a folder the operator syncs);
 *  - ACTIVE content is refused, because the agent may read a stored file and
 *    an `.html` or a shell script inside the vault is a thing it could be
 *    talked into running;
 *  - the name is reduced to one safe segment rather than trusted;
 *  - the write is checked for physical containment, so a symlinked
 *    `attachments` directory inside the vault cannot redirect the save out of
 *    the vault.
 *
 * The file is written BEFORE the turn that names it is ever posted, so a path
 * the agent is told about always points at bytes on disk.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertNoSymlinkLeaf,
  assertPhysicalContainment,
  assertSafeSegment,
  type Result,
} from "@lifequest/vault-core";

/**
 * How large one attachment may be.
 *
 * The receipt path allows 25 MB for the original because a phone photo is
 * that size and the vault keeps it whole. The same ceiling is used here so the
 * two paths agree, and because the file never travels in the turn body: only
 * images do, and those are bounded separately by the model-copy ceiling.
 */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The kinds an attachment can be.
 *
 * The gateway's content array accepts only text and image parts
 * (`api_server._normalize_multimodal_content` refuses a `file` part with
 * `unsupported_content_type`), so the kind decides how the attachment rides
 * the turn:
 *
 *  - `image`  — sent inline as an `image_url` part, AND stored, so the agent
 *                has a path to the original as well as the picture;
 *  - `video`  — stored only; the agent reads it with its own file tools;
 *  - `audio`  — stored only;
 *  - `file`   — stored only (documents, archives, anything else).
 */
export type AttachmentKind = "image" | "video" | "audio" | "file";

/**
 * Content the vault will not hold.
 *
 * The list is the one `saveDatabaseFile` keeps, because the reason is the
 * same: these are formats that execute or render themselves. A vault is synced
 * and shared, so an `.html` or an `.exe` inside it is a thing that can run
 * somewhere else. The one addition is SVG, which is an image the agent might
 * inline into a page.
 */
const FORBIDDEN_MIMES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-msdownload",
  "application/x-executable",
  "application/vnd.microsoft.portable-executable",
  "application/x-msdos-program",
  "text/x-shellscript",
]);

/**
 * The image formats that may be sent inline.
 *
 * These are the formats the model providers accept as an `image_url` data URL
 * (JPEG and PNG), and the same two the receipt path allows. A GIF or a WEBP is
 * a perfectly good file to STORE, but it cannot be inlined: the agent would
 * receive a part it cannot decode. So a GIF is stored as an `image` kind with
 * no inline copy, and the turn names its path instead.
 */
const INLINE_IMAGE_MIMES = new Set(["image/jpeg", "image/png"]);

/** The prefix of the mime type, for the kind decision. */
function mimeFamily(mime: string): string {
  const slash = mime.indexOf("/");
  return slash === -1 ? "" : mime.slice(0, slash);
}

/**
 * What kind of attachment these bytes are.
 *
 * The mime the renderer sent is a CLAIM, and for images the claim is checked
 * against the bytes: a file called `photo.jpg` that is really a script must
 * not ride the turn as a picture. Video and audio are told by their own
 * families, and everything else is a file.
 */
export function attachmentKind(mime: string, bytes: Uint8Array): AttachmentKind {
  const normalized = mime.trim().toLowerCase();
  if (normalized.startsWith("image/")) {
    // The bytes decide, for the formats whose signature is cheap to read.
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image";
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length >= png.length && png.every((byte, i) => bytes[i] === byte)) {
      return "image";
    }
    // A GIF, a WEBP or an SVG is an image to a human and a file to the agent.
    return "file";
  }
  const family = mimeFamily(normalized);
  if (family === "video") return "video";
  if (family === "audio") return "audio";
  return "file";
}

/**
 * Reduce an operator file name to one safe vault segment, keeping it readable.
 *
 * The same reduction `saveDatabaseFile` applies: the base name only, control
 * characters and path separators replaced, no `..`, no leading dot. The
 * extension is kept, because the agent's file tools and the operator both use
 * it to recognise what the file is.
 */
export function sanitizeAttachmentName(raw: string): string {
  const base = path.basename(String(raw ?? "").trim());
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 100);
  return cleaned || "file";
}

/**
 * The mime a stored file keeps.
 *
 * An empty or absent mime becomes `application/octet-stream`: the kind is
 * decided by the family, and an unknown family is a file either way. The stored
 * name keeps the operator's extension, so the mime here is the one the turn
 * reports to the agent.
 */
function normalizeMime(mime: unknown): string {
  const raw = typeof mime === "string" ? mime.trim().toLowerCase() : "";
  if (!raw) return "application/octet-stream";
  // Only the type/subtype is kept; a parameter (`text/plain; charset=utf-8`)
  // would not match the forbidden list and would be noise in the instruction.
  const semi = raw.indexOf(";");
  const base = (semi === -1 ? raw : raw.slice(0, semi)).trim();
  return base || "application/octet-stream";
}

/**
 * The data URL the turn sends for an image.
 *
 * Only JPEG and PNG may be inlined, because those are the two the model
 * providers decode. The bytes are the ORIGINAL bytes, not a re-encode: this
 * path is not the receipt path, and re-encoding would throw away exactly the
 * detail the operator attached (a screenshot of a spreadsheet, a photograph of
 * a document) for no gain.
 */
export function inlineImageDataUrl(mime: string, bytes: Uint8Array): string | null {
  if (!INLINE_IMAGE_MIMES.has(mime)) return null;
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * The vault-relative directory general attachments live in.
 *
 * `attachments/files/` — the same shape as a domain's `data/files/`, at vault
 * level, because an attachment belongs to the chat and not to a domain.
 */
export const ATTACHMENT_STORE_DIR = "attachments/files";

/** The vault-relative path one attachment is stored at. */
export function attachmentRelPath(fileId: string, safeName: string): string {
  return `${ATTACHMENT_STORE_DIR}/${fileId}/${safeName}`;
}

/**
 * Store one attachment's bytes in the vault.
 *
 * The original is written whole: an attachment the agent cannot read is still
 * an attachment the operator can open later, and re-encoding a video or a
 * document is not possible anyway. What comes back is everything a turn needs
 * to say about it — where it is, what it is called, how big it is, and what
 * kind of thing it is — plus the inline data URL when, and only when, the
 * format may be inlined.
 */
export async function storeAttachment(
  root: string,
  input: { bytes: Uint8Array; mime: string; name: string },
): Promise<
  Result<{
    fileId: string;
    relPath: string;
    name: string;
    size: number;
    mime: string;
    kind: AttachmentKind;
    /** The inline copy, when the format may be sent as an image part. */
    dataUrl: string | null;
  }>
> {
  try {
    const bytes = input.bytes;
    if (!(bytes instanceof Uint8Array)) {
      return { ok: false, error: "Invalid file bytes" };
    }
    if (bytes.byteLength === 0) {
      return { ok: false, error: "That file is empty." };
    }
    if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
      return {
        ok: false,
        error: `That file is larger than ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.`,
      };
    }
    const mime = normalizeMime(input.mime);
    if (FORBIDDEN_MIMES.has(mime)) {
      return { ok: false, error: `Files of type ${mime} are not stored in the vault.` };
    }
    const safeName = sanitizeAttachmentName(input.name);
    const fileId = randomUUID();
    const relPath = attachmentRelPath(fileId, safeName);

    // The full path is built by hand rather than through `vaultPaths`, because
    // `attachments/` is a vault-level store this app owns and vault-core has no
    // builder for it. The containment check is the same one every other vault
    // write makes, and it is what refuses a symlinked `attachments` directory.
    const fullPath = path.join(
      path.resolve(root),
      ...relPath.split("/").map((segment) => assertSafeSegment(segment, "attachment path segment")),
    );
    await assertPhysicalContainment(root, fullPath, "write");
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await assertNoSymlinkLeaf(path.dirname(fullPath));
    await fs.writeFile(fullPath, bytes);

    const kind = attachmentKind(mime, bytes);
    return {
      ok: true,
      value: {
        fileId,
        relPath,
        name: safeName,
        size: bytes.byteLength,
        mime,
        kind,
        dataUrl: kind === "image" ? inlineImageDataUrl(mime, bytes) : null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The absolute path of a stored attachment.
 *
 * The agent's file tools resolve a RELATIVE path against a working directory
 * it inherits from the gateway process, which is not the vault and is not
 * stable. So the instruction names the ABSOLUTE path, and the vault-relative
 * path is given alongside it for the operator and for a citation. The receipt
 * case does not need this — a receipt is cited, not read — which is why the
 * receipt wording never had to name a root.
 */
export function attachmentAbsolutePath(root: string, relPath: string): string {
  return path.join(path.resolve(root), ...relPath.split("/"));
}
