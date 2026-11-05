/**
 * Life-Chain capture records.
 *
 * A signal is one JSON file at `.lifequest/signal-chain/<id>.json`. A plain
 * capture is a body; a capture may also carry one attachment — a picture or a
 * link — that says why the body is short or empty. The picture's bytes are
 * files under `.lifequest/signal-chain/files/`, never base64 in the record: the
 * vault keeps what the operator dropped, and the JSON names the file by its
 * vault-relative path. The bytes decide the kind and the extension (the
 * uploaded name never does), the size is bounded before the write, and every
 * read goes through the same physical-containment guard as the rest of the
 * vault.
 */
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteBytes, atomicWriteFile } from "./atomic-write.ts";
import {
  IMAGE_MAX_BYTES,
  imageDisplayName,
  sniffImageMime,
} from "./images.ts";
import {
  assertNoSymlinkLeaf,
  assertPhysicalContainment,
  vaultPaths,
} from "./paths.ts";
import {
  IMAGE_MIME_EXT,
  SIGNAL_SOURCES,
  SIGNAL_TYPES,
  type ImageMimeType,
  type Result,
  type SignalAttachment,
  type SignalChainListResult,
  type SignalCreateInput,
  type SignalImageInput,
  type SignalRecord,
  type SignalSource,
  type SignalType,
  type SignalUpdatePatch,
} from "./types.ts";

/** A link is one line, not a document. */
export const SIGNAL_LINK_MAX = 2048;

/** The ids this module mints and the paths it will accept back. */
const SIGNAL_ATTACHMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A stored picture: ours only, one flat file under signal-chain/files/. */
const SIGNAL_IMAGE_REL_PATH =
  /^\.lifequest\/signal-chain\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp)$/i;

const MIME_BY_EXT: Record<string, ImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** A finite positive integer canvas edge, or null when the caller did not say. */
function canvasEdge(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 100_000) {
    return null;
  }
  return raw;
}

/**
 * An absolute `http`/`https` URL, normalized, or null.
 *
 * The page draws this as a link and the record is read without the renderer, so
 * a relative path, `javascript:`, a `file:` URL or plain prose is refused here
 * rather than stored and drawn as a dead anchor. `http` is accepted because the
 * operator may paste a legacy address; the app only opens `https` externally,
 * which is the same policy the project pages already follow.
 */
export function normalizeSignalLinkUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > SIGNAL_LINK_MAX) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return parsed.href;
}

function isSignalType(value: unknown): value is SignalType {
  return (
    typeof value === "string" &&
    (SIGNAL_TYPES as readonly string[]).includes(value)
  );
}

function isSignalSource(value: unknown): value is SignalSource {
  return (
    typeof value === "string" &&
    (SIGNAL_SOURCES as readonly string[]).includes(value)
  );
}

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function asError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * An attachment read back from disk. Unknown or malformed shapes fail the
 * record rather than being silently dropped: a row the page cannot draw is a
 * bug, and the list reports unreadable files by count.
 */
function parseSignalAttachment(
  raw: unknown,
): { ok: true; value: SignalAttachment | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object") return { ok: false };
  const a = raw as Record<string, unknown>;
  if (a.kind === "link") {
    const url = normalizeSignalLinkUrl(a.url);
    return url ? { ok: true, value: { kind: "link", url } } : { ok: false };
  }
  if (a.kind === "image") {
    const match =
      typeof a.relPath === "string" ? SIGNAL_IMAGE_REL_PATH.exec(a.relPath) : null;
    if (!match) return { ok: false };
    const ext = match[2]!.toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return { ok: false };
    if (a.mime !== mime) return { ok: false };
    if (typeof a.name !== "string") return { ok: false };
    const width = canvasEdge(a.width);
    const height = canvasEdge(a.height);
    if (
      (a.width !== null && a.width !== undefined && width === null) ||
      (a.height !== null && a.height !== undefined && height === null)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      value: {
        kind: "image",
        relPath: `.lifequest/signal-chain/files/${match[1]!.toLowerCase()}.${ext}`,
        name: imageDisplayName(a.name),
        mime,
        width,
        height,
      },
    };
  }
  return { ok: false };
}

export function parseSignalRecord(raw: unknown): SignalRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (!isIso(o.createdAt) || !isIso(o.updatedAt)) return null;
  if (o.deletedAt !== null && !isIso(o.deletedAt)) return null;
  if (!isSignalType(o.type) || !isSignalSource(o.source)) return null;
  if (o.sourceRef !== null && typeof o.sourceRef !== "string") return null;
  if (o.title !== null && typeof o.title !== "string") return null;
  if (typeof o.body !== "string") return null;
  if (o.domainSlug !== null && typeof o.domainSlug !== "string") return null;
  const attachment = parseSignalAttachment(o.attachment);
  if (!attachment.ok) return null;
  if (!o.body.trim() && attachment.value === null) return null;
  return {
    id: o.id,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
    type: o.type,
    source: o.source,
    sourceRef: o.sourceRef,
    title: o.title,
    body: o.body,
    domainSlug: o.domainSlug,
    attachment: attachment.value,
  };
}

async function domainExists(rootPath: string, slug: string): Promise<boolean> {
  try {
    await fs.access(vaultPaths(rootPath).domainDir(slug));
    return true;
  } catch {
    return false;
  }
}

function normalizeTitle(title: string | null | undefined): string | null {
  if (title == null) return null;
  const t = title.trim();
  return t ? t : null;
}

function normalizeDomain(
  domainSlug: string | null | undefined,
): string | null {
  if (domainSlug == null) return null;
  const s = domainSlug.trim();
  return s ? s : null;
}

async function validateBodyAndMeta(
  rootPath: string,
  type: unknown,
  body: string,
  domainSlug: string | null,
  hasAttachment: boolean,
): Promise<Result<{ type: SignalType; body: string; domainSlug: string | null }>> {
  if (!isSignalType(type)) {
    return fail(`Invalid signal type: ${String(type)}`);
  }
  const trimmed = body.trim();
  if (!trimmed && !hasAttachment) {
    return fail("A capture needs text, an image or a link");
  }
  if (domainSlug && !(await domainExists(rootPath, domainSlug))) {
    return fail(`Unknown domain: ${domainSlug}`);
  }
  return ok({ type, body: trimmed, domainSlug });
}

async function writeSignalFile(
  rootPath: string,
  record: SignalRecord,
): Promise<void> {
  const filePath = vaultPaths(rootPath).signalChainJson(record.id);
  await atomicWriteFile(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Store one capture attachment. A link is validated and kept as an address; a
 * picture's bytes are written first and named by the record, so the JSON never
 * points at a file that was not written.
 */
async function storeAttachment(
  rootPath: string,
  input: NonNullable<SignalCreateInput["attachment"]>,
): Promise<Result<SignalAttachment>> {
  if (input.kind === "link") {
    const url = normalizeSignalLinkUrl(input.url);
    if (!url) return fail("Links must be an absolute http or https URL.");
    return ok({ kind: "link", url });
  }
  if (input.kind !== "image") return fail("Unknown attachment kind");
  const image = input as SignalImageInput;
  if (!(image.bytes instanceof Uint8Array)) {
    return fail("Invalid image bytes");
  }
  if (image.bytes.byteLength === 0) return fail("That image is empty.");
  if (image.bytes.byteLength > IMAGE_MAX_BYTES) {
    return fail(
      `That image is larger than ${Math.round(IMAGE_MAX_BYTES / (1024 * 1024))} MB.`,
    );
  }
  const mime = sniffImageMime(image.bytes);
  if (!mime) return fail("Images must be PNG, JPEG, GIF or WebP.");
  const ext = IMAGE_MIME_EXT[mime];
  const id = randomUUID();
  const filePath = vaultPaths(rootPath).signalChainFile(id, ext);
  try {
    await assertPhysicalContainment(rootPath, filePath, "write");
    await atomicWriteBytes(filePath, image.bytes);
  } catch (e) {
    return fail(`Could not save that image: ${asError(e)}`);
  }
  return ok({
    kind: "image",
    relPath: `.lifequest/signal-chain/files/${id}.${ext}`,
    name: imageDisplayName(image.name),
    mime,
    width: canvasEdge(image.width),
    height: canvasEdge(image.height),
  });
}

/** Best effort, after a record write failed: the file alone is not a capture. */
async function removeStoredImage(
  rootPath: string,
  attachment: SignalAttachment,
): Promise<void> {
  if (attachment.kind !== "image") return;
  const match = SIGNAL_IMAGE_REL_PATH.exec(attachment.relPath);
  if (!match) return;
  try {
    await fs.rm(
      vaultPaths(rootPath).signalChainFile(
        match[1]!.toLowerCase(),
        match[2]!.toLowerCase(),
      ),
      { force: true },
    );
  } catch {
    // The orphan is invisible to the chain; a failed cleanup is not a failed write.
  }
}

async function readLiveSignal(
  rootPath: string,
  id: string,
): Promise<Result<SignalRecord>> {
  try {
    const filePath = vaultPaths(rootPath).signalChainJson(id);
    const raw = await fs.readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail("Signal not found");
    }
    const record = parseSignalRecord(parsed);
    if (!record || record.deletedAt) return fail("Signal not found");
    return ok(record);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fail("Signal not found");
    return fail(asError(e));
  }
}

export async function listSignals(
  rootPath: string,
): Promise<Result<SignalChainListResult>> {
  try {
    const paths = vaultPaths(rootPath);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(paths.signalChainDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return ok({ records: [], skipped: 0 });
      }
      throw e;
    }

    const records: SignalRecord[] = [];
    let skipped = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -".json".length);
      let filePath: string;
      try {
        filePath = paths.signalChainJson(id);
      } catch {
        skipped += 1;
        continue;
      }
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const record = parseSignalRecord(JSON.parse(raw));
        if (!record) {
          skipped += 1;
          continue;
        }
        if (record.deletedAt) continue;
        records.push(record);
      } catch {
        skipped += 1;
      }
    }
    records.sort((a, b) => {
      const byCreated = b.createdAt.localeCompare(a.createdAt);
      if (byCreated !== 0) return byCreated;
      return b.id.localeCompare(a.id);
    });
    return ok({ records, skipped });
  } catch (e) {
    return fail(asError(e));
  }
}

export async function createSignal(
  rootPath: string,
  input: SignalCreateInput,
): Promise<Result<SignalRecord>> {
  try {
    const domainSlug = normalizeDomain(input.domainSlug);
    const attachmentInput = input.attachment ?? null;
    const checked = await validateBodyAndMeta(
      rootPath,
      input.type,
      input.body,
      domainSlug,
      attachmentInput !== null,
    );
    if (!checked.ok) return checked;

    const attachment = attachmentInput
      ? await storeAttachment(rootPath, attachmentInput)
      : ok<SignalAttachment | null>(null);
    if (!attachment.ok) return attachment;

    const now = new Date().toISOString();
    const record: SignalRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      type: checked.value.type,
      source: "manual",
      sourceRef: null,
      title: normalizeTitle(input.title),
      body: checked.value.body,
      domainSlug: checked.value.domainSlug,
      attachment: attachment.value,
    };
    try {
      await writeSignalFile(rootPath, record);
    } catch (e) {
      if (record.attachment) await removeStoredImage(rootPath, record.attachment);
      throw e;
    }
    return ok(record);
  } catch (e) {
    return fail(asError(e));
  }
}

export async function updateSignal(
  rootPath: string,
  id: string,
  patch: SignalUpdatePatch,
): Promise<Result<SignalRecord>> {
  try {
    const loaded = await readLiveSignal(rootPath, id);
    if (!loaded.ok) return loaded;
    const nextType = patch.type ?? loaded.value.type;
    const nextBody = patch.body ?? loaded.value.body;
    const nextDomain =
      patch.domainSlug === undefined
        ? loaded.value.domainSlug
        : normalizeDomain(patch.domainSlug);
    const checked = await validateBodyAndMeta(
      rootPath,
      nextType,
      nextBody,
      nextDomain,
      loaded.value.attachment !== null,
    );
    if (!checked.ok) return checked;
    const next: SignalRecord = {
      ...loaded.value,
      type: checked.value.type,
      body: checked.value.body,
      domainSlug: checked.value.domainSlug,
      title:
        patch.title === undefined
          ? loaded.value.title
          : normalizeTitle(patch.title),
      updatedAt: new Date().toISOString(),
    };
    await writeSignalFile(rootPath, next);
    return ok(next);
  } catch (e) {
    return fail(asError(e));
  }
}

/**
 * Read a stored capture picture back, for the renderer to draw from a blob URL.
 * The path is one this module minted; anything else is refused by name rather
 * than reparsed into a filesystem path.
 */
export async function readSignalImage(
  rootPath: string,
  relPath: string,
): Promise<Result<{ bytes: Uint8Array; mime: ImageMimeType }>> {
  try {
    const match =
      typeof relPath === "string" ? SIGNAL_IMAGE_REL_PATH.exec(relPath) : null;
    if (!match || !SIGNAL_ATTACHMENT_ID.test(match[1]!)) {
      return fail(`Invalid image path: ${String(relPath)}`);
    }
    const id = match[1]!.toLowerCase();
    const ext = match[2]!.toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return fail(`Unsupported image type: ${ext}`);
    const filePath = vaultPaths(rootPath).signalChainFile(id, ext);
    await assertPhysicalContainment(rootPath, filePath, "read");
    await assertNoSymlinkLeaf(filePath);
    const bytes = await fs.readFile(filePath);
    return ok({ bytes: new Uint8Array(bytes), mime });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return fail("That image is missing from the vault.");
    }
    return fail(`Could not read that image: ${asError(e)}`);
  }
}

export async function deleteSignal(
  rootPath: string,
  id: string,
): Promise<Result<SignalRecord>> {
  try {
    const loaded = await readLiveSignal(rootPath, id);
    if (!loaded.ok) return loaded;
    const now = new Date().toISOString();
    const next: SignalRecord = {
      ...loaded.value,
      deletedAt: now,
      updatedAt: now,
    };
    await writeSignalFile(rootPath, next);
    return ok(next);
  } catch (e) {
    return fail(asError(e));
  }
}
