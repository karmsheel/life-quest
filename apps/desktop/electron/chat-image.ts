/**
 * The chat's one picture read.
 *
 * A chat picture is a file in the vault, never a URL: the renderer's CSP is
 * `img-src 'self' data: blob:`, and loosening it would let model output make the
 * app fetch arbitrary hosts. Three sources of a reference all come through here
 * — an agent reply's markdown tag, a live send's stored path, and a reloaded
 * transcript's hint — and this is the one place that decides whether the bytes
 * may be read.
 *
 * Kept free of Electron imports on purpose: the e2e rig bundles this module
 * under plain node and proves the door from both sides (a real picture reads; a
 * `..` path, an absolute escape, a symlinked leaf, a renamed text file and an
 * oversized file do not).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { assertPhysicalContainment, type Result } from "@lifequest/vault-core";

/**
 * The face of a 4K photo at full size.
 *
 * Bounded because the vault is a folder the operator syncs: a picture the chat
 * cannot reasonably draw should be refused before its bytes are read, not after
 * they have crossed IPC and become a blob URL.
 */
export const CHAT_IMAGE_MAX_BYTES = 24 * 1024 * 1024;

/** What the chat draws. The extension picks the mime; the magic bytes confirm it. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * The operator's sentence for every refusal.
 *
 * One sentence for all of them: a bubble shows a quiet missing chip, and "that
 * picture could not be read" is both true and actionable for every cause — the
 * file is gone, the extension lied, the path escapes the vault.
 */
const UNREADABLE = "That picture could not be read.";

type ChatImageBytes = { bytes: Uint8Array; mime: string };

function refuse(): Result<ChatImageBytes> {
  return { ok: false, error: UNREADABLE };
}

/**
 * Whether the ref names a scheme instead of a path.
 *
 * A scheme is a fetch, not a file, and the door never fetches. A Windows drive
 * letter looks like a scheme (`C:`) but is an absolute path, so it is not one.
 */
function hasScheme(ref: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(ref)) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref);
}

/** The first bytes must carry the format the extension claims. */
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
      return starts(0, [0x52, 0x49, 0x46, 0x46]) && starts(8, [0x57, 0x45, 0x42, 0x50]);
    default:
      return false;
  }
}

/**
 * Read one picture a chat bubble asked for.
 *
 * `ref` is trimmed first: a vault-relative path resolves against the vault
 * root, an absolute one is kept. The resolved file must sit inside the vault
 * root or inside the active companion profile's `native-inputs/` tree — that is
 * the gateway's retained copy of a picture the operator sent, and the only
 * legitimate place a chat picture lives outside the vault. Anything else is
 * refused, because a transcript hint is not a capability to read the disk.
 */
export async function readChatImage(input: {
  vaultRoot: string | null;
  profileHome: string | null;
  ref: string;
}): Promise<Result<{ bytes: Uint8Array; mime: string }>> {
  const raw = typeof input.ref === "string" ? input.ref.trim() : "";
  // NUL is not part of a path, it is where one ends; a scheme is not a path at
  // all. Both are refused before anything touches the filesystem.
  if (!raw || raw.includes("\u0000") || hasScheme(raw)) return refuse();

  const vaultRoot = input.vaultRoot || null;
  const profileHome = input.profileHome || null;
  const target = path.isAbsolute(raw)
    ? path.normalize(raw)
    : vaultRoot
      ? path.resolve(vaultRoot, raw)
      : null;
  if (!target) return refuse();

  const containers = [
    vaultRoot,
    profileHome ? path.join(profileHome, "native-inputs") : null,
  ].filter((root): root is string => root !== null);
  let contained: string | null = null;
  for (const container of containers) {
    try {
      contained = await assertPhysicalContainment(container, target);
      break;
    } catch {
      // Not in this tree; the other allowed tree may still hold it.
    }
  }
  if (!contained) return refuse();

  const mime = MIME_BY_EXTENSION[path.extname(contained).toLowerCase()];
  if (!mime) return refuse();

  try {
    const stat = await fs.stat(contained);
    // A regular file only: a directory here would be read as its error, and a
    // fifo would hang the read; neither is a picture.
    if (!stat.isFile() || stat.size > CHAT_IMAGE_MAX_BYTES) return refuse();
    const bytes = new Uint8Array(await fs.readFile(contained));
    return magicMatches(mime, bytes) ? { ok: true, value: { bytes, mime } } : refuse();
  } catch {
    // A missing file, a permission denial, a directory handed to readFile: all
    // one quiet missing picture, never an error page.
    return refuse();
  }
}
