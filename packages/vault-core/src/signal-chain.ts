/**
 * Life-Chain capture records.
 *
 * A signal is one JSON file at `.lifequest/signal-chain/<id>.json`. A plain
 * capture is a body; a capture may also carry one attachment — a picture, a
 * link, or any other file — that says why the body is short or empty. A
 * picture's or a file's bytes live under `.lifequest/signal-chain/files/`, never
 * base64 in the record: the vault keeps what the operator dropped, and the JSON
 * names the file by its vault-relative path. For pictures the bytes decide the
 * kind and the extension (the uploaded name never does); for other files the
 * name supplies a safe extension, active content (a page, a script, an app) is
 * refused before anything is written, and the size is bounded. Every read goes
 * through the same physical-containment guard as the rest of the vault.
 */
import fs from "node:fs/promises";
import path from "node:path";
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
  assertSafeSegment,
  vaultPaths,
} from "./paths.ts";
import {
  IMAGE_MIME_EXT,
  SIGNAL_PRIORITIES,
  SIGNAL_SOURCES,
  SIGNAL_STATUSES,
  SIGNAL_TYPES,
  type ImageMimeType,
  type Result,
  type SignalAttachment,
  type SignalChainListResult,
  type SignalCreateInput,
  type SignalFileInput,
  type SignalImageInput,
  type SignalPriority,
  type SignalRecord,
  type SignalSource,
  type SignalStatus,
  type SignalType,
  type SignalUpdatePatch,
} from "./types.ts";

/** A link is one line, not a document. */
export const SIGNAL_LINK_MAX = 2048;

/**
 * The ceiling for a general file attachment, the same 25 MB the chat composer
 * uses. A picture keeps its own, tighter ceiling: the renderer draws it inline.
 */
export const SIGNAL_FILE_MAX_BYTES = 25 * 1024 * 1024;

/** A display name is a label, not a path and not a paragraph. */
const SIGNAL_FILE_NAME_MAX = 200;

/** The ids this module mints and the paths it will accept back. */
const SIGNAL_ATTACHMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A stored picture: ours only, one flat file under signal-chain/files/. */
const SIGNAL_IMAGE_REL_PATH =
  /^\.lifequest\/signal-chain\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp)$/i;
/**
 * A stored general file: ours only, one flat file under signal-chain/files/,
 * with the safe `[a-z0-9]{1,8}` extension the name supplied (or none at all).
 */
const SIGNAL_FILE_REL_PATH =
  /^\.lifequest\/signal-chain\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.([a-z0-9]{1,8}))?$/i;
/** A MIME type is a type/subtype token, lowercase, with no parameters. */
const SIGNAL_MIME_SHAPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
const SIGNAL_FALLBACK_MIME = "application/octet-stream";

/**
 * Content the vault must never store as a file attachment. A stored HTML page, a
 * script, or an app would be executable-ish content behind a name the operator
 * was told was safe; the store refuses the extension and the declared type by
 * name, before the bytes are written.
 */
const FORBIDDEN_FILE_EXTENSIONS = new Set([
  "html",
  "htm",
  "xhtml",
  "svg",
  "js",
  "mjs",
  "cjs",
  "sh",
  "bat",
  "cmd",
  "ps1",
  "exe",
  "msi",
  "dll",
  "app",
  "com",
  "scr",
  "jar",
  "vbs",
  "wsf",
]);
const FORBIDDEN_MIMES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-sh",
  "application/x-msdownload",
  "application/x-executable",
  "application/vnd.microsoft.portable-executable",
  "text/x-shellscript",
]);

/** The type a read reports for a stored file, from the extension it minted. */
const MIME_BY_FILE_EXT: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

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

/** The type/subtype of a declared MIME value, lowercased, parameters dropped. */
function mimeBase(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.split(";")[0]!.trim().toLowerCase();
}

/**
 * Keep only a type/subtype token. A declared type the vault does not recognise
 * is stored as `application/octet-stream` rather than trusted: the renderer
 * hands the blob back with this value.
 */
function sanitizeMime(raw: unknown): string {
  const base = mimeBase(raw);
  return SIGNAL_MIME_SHAPE.test(base) ? base : SIGNAL_FALLBACK_MIME;
}

/**
 * The safe extension a file name supplies, or null. Only the last dot segment
 * counts, lowercased, and only when it is a short alphanumeric token — a name
 * like `notes`, `.bashrc` or `report.pdf.exe` therefore stores no extension it
 * could smuggle content behind (`pdf` would; `exe` is refused by the caller).
 */
function fileExtension(name: unknown): string | null {
  const source = typeof name === "string" ? name : "";
  const base = source.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 1 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
}

/**
 * A file name is a display label, not a path: the basename only, control
 * characters stripped, trimmed, bounded, with a fallback so a card is never
 * blank. The rules mirror `imageDisplayName`; the fallback word differs because
 * the card says "File".
 */
function fileDisplayName(raw: unknown): string {
  const source = typeof raw === "string" ? raw : "";
  const base = source.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, SIGNAL_FILE_NAME_MAX)
    .trim();
  return cleaned || "File";
}

/** The vault-relative path a stored general file is named by. */
function signalFileRelPath(id: string, ext: string | null): string {
  return `.lifequest/signal-chain/files/${id}${ext ? `.${ext}` : ""}`;
}

/**
 * The absolute path for a stored signal attachment. `signalChainFile` appends
 * the extension itself; a file that carries none is the flat `<uuid>` beside
 * its siblings, and the id still goes through the same segment fence.
 */
function signalAttachmentPath(
  rootPath: string,
  id: string,
  ext: string | null,
): string {
  const safeId = assertSafeSegment(id, "signal attachment id");
  if (!ext) {
    return path.join(vaultPaths(rootPath).signalChainFilesDir, safeId);
  }
  return vaultPaths(rootPath).signalChainFile(
    safeId,
    assertSafeSegment(ext, "signal attachment extension"),
  );
}

/** The refusal when a file's name or declared type is active content. */
function forbiddenFileType(name: unknown, mime: unknown): string | null {
  const ext = fileExtension(name);
  if (ext && FORBIDDEN_FILE_EXTENSIONS.has(ext)) return `.${ext}`;
  const base = mimeBase(mime);
  if (base && FORBIDDEN_MIMES.has(base)) return base;
  return null;
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

/** Where a capture stands as work; one of the five the store accepts. */
export const DEFAULT_SIGNAL_STATUS: SignalStatus = "inbox";

function isSignalStatus(value: unknown): value is SignalStatus {
  return (
    typeof value === "string" &&
    (SIGNAL_STATUSES as readonly string[]).includes(value)
  );
}

function isSignalPriority(value: unknown): value is SignalPriority {
  return (
    typeof value === "string" &&
    (SIGNAL_PRIORITIES as readonly string[]).includes(value)
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
  if (a.kind === "file") {
    const match =
      typeof a.relPath === "string" ? SIGNAL_FILE_REL_PATH.exec(a.relPath) : null;
    if (!match) return { ok: false };
    const ext = match[2]?.toLowerCase() ?? null;
    // A record naming content the store itself would have refused fails here
    // too: nothing a hostile file edit writes is drawn as a safe attachment.
    if (ext && FORBIDDEN_FILE_EXTENSIONS.has(ext)) return { ok: false };
    if (typeof a.mime !== "string") return { ok: false };
    const mime = mimeBase(a.mime);
    if (!SIGNAL_MIME_SHAPE.test(mime) || FORBIDDEN_MIMES.has(mime)) {
      return { ok: false };
    }
    if (typeof a.name !== "string") return { ok: false };
    if (
      typeof a.size !== "number" ||
      !Number.isInteger(a.size) ||
      a.size < 0 ||
      a.size > SIGNAL_FILE_MAX_BYTES
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      value: {
        kind: "file",
        relPath: signalFileRelPath(match[1]!.toLowerCase(), ext),
        name: fileDisplayName(a.name),
        mime,
        size: a.size,
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

  // The inbox fields. A record written before they existed has no keys at all:
  // absence is the migration, and it reads as the defaults (`inbox`, no
  // project, no priority, no origin). A key that IS present but holds the wrong
  // shape fails the record rather than being silently reset, the same rule
  // every other field here follows.
  let projectId: string | null = null;
  if (o.projectId !== undefined && o.projectId !== null) {
    if (typeof o.projectId !== "string") return null;
    projectId = o.projectId.trim() || null;
  }
  let status: SignalStatus = DEFAULT_SIGNAL_STATUS;
  if (o.status !== undefined) {
    if (!isSignalStatus(o.status)) return null;
    status = o.status;
  }
  let priority: SignalPriority | null = null;
  if (o.priority !== undefined && o.priority !== null) {
    if (!isSignalPriority(o.priority)) return null;
    priority = o.priority;
  }
  let capturedFrom: string | null = null;
  if (o.capturedFrom !== undefined && o.capturedFrom !== null) {
    if (typeof o.capturedFrom !== "string") return null;
    capturedFrom = o.capturedFrom.trim() || null;
  }

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
    projectId,
    status,
    priority,
    capturedFrom,
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

/**
 * A live project is one the projects store would read back: the id is the
 * project file's name, so the file's presence is the existence test (the same
 * shape `domainExists` uses for areas). A malformed id fails the `try` rather
 * than escaping as a path error, so the caller names the value it refused.
 */
async function projectExists(rootPath: string, projectId: string): Promise<boolean> {
  try {
    await fs.access(vaultPaths(rootPath).projectMd(projectId));
    return true;
  } catch {
    return false;
  }
}

/** A nullable text field: absent and empty both read as null, never "". */
function readOptionalString(
  raw: unknown,
  field: string,
): Result<string | null> {
  if (raw === undefined || raw === null) return ok(null);
  if (typeof raw !== "string") return fail(`${field} must be a string or null`);
  const trimmed = raw.trim();
  return ok(trimmed ? trimmed : null);
}

/** What every signal now carries as work: where it belongs and where it stands. */
type SignalTriage = {
  projectId: string | null;
  status: SignalStatus;
  priority: SignalPriority | null;
  capturedFrom: string | null;
};

/**
 * Validate the triage half of a write. Status defaults to `inbox` when the
 * caller did not say; projectId must name a project that exists, because a
 * dangling id would file a capture under work no board can show. Every field is
 * refused by the value it was handed.
 */
async function validateSignalTriage(
  rootPath: string,
  raw: {
    projectId?: unknown;
    status?: unknown;
    priority?: unknown;
    capturedFrom?: unknown;
  },
): Promise<Result<SignalTriage>> {
  const projectId = readOptionalString(raw.projectId, "projectId");
  if (!projectId.ok) return projectId;
  const status = raw.status === undefined || raw.status === null
    ? DEFAULT_SIGNAL_STATUS
    : raw.status;
  if (!isSignalStatus(status)) {
    return fail(`Invalid signal status: ${String(status)}`);
  }
  const priority = readOptionalString(raw.priority, "priority");
  if (!priority.ok) return priority;
  if (priority.value !== null && !isSignalPriority(priority.value)) {
    return fail(`Invalid signal priority: ${priority.value}`);
  }
  const capturedFrom = readOptionalString(raw.capturedFrom, "capturedFrom");
  if (!capturedFrom.ok) return capturedFrom;
  if (
    projectId.value !== null &&
    !(await projectExists(rootPath, projectId.value))
  ) {
    return fail(`Unknown project: ${projectId.value}`);
  }
  return ok({
    projectId: projectId.value,
    status,
    priority: priority.value as SignalPriority | null,
    capturedFrom: capturedFrom.value,
  });
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
    return fail("A capture needs text, a file, an image or a link");
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
  if (input.kind === "file") {
    const file = input as SignalFileInput;
    if (!(file.bytes instanceof Uint8Array)) return fail("Invalid file bytes");
    if (file.bytes.byteLength === 0) return fail("That file is empty.");
    if (file.bytes.byteLength > SIGNAL_FILE_MAX_BYTES) {
      return fail(
        `That file is larger than ${Math.round(SIGNAL_FILE_MAX_BYTES / (1024 * 1024))} MB.`,
      );
    }
    // Refuse active content before minting an id or writing a byte: a refused
    // file leaves the chain and the files directory exactly as they were.
    const refused = forbiddenFileType(file.name, file.mime);
    if (refused) {
      return fail(`That file type cannot be kept in the vault: ${refused}`);
    }
    const ext = fileExtension(file.name);
    const id = randomUUID();
    const filePath = signalAttachmentPath(rootPath, id, ext);
    try {
      await assertPhysicalContainment(rootPath, filePath, "write");
      await atomicWriteBytes(filePath, file.bytes);
    } catch (e) {
      return fail(`Could not save that file: ${asError(e)}`);
    }
    return ok({
      kind: "file",
      relPath: signalFileRelPath(id, ext),
      name: fileDisplayName(file.name),
      mime: sanitizeMime(file.mime),
      size: file.bytes.byteLength,
    });
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

/**
 * Best effort, after a record write failed: a stored picture or file alone is
 * not a capture. One shared relPath handler keeps image and file cleanup honest
 * about which bytes this module actually minted.
 */
async function removeStoredAttachment(
  rootPath: string,
  attachment: SignalAttachment,
): Promise<void> {
  let target: string | null = null;
  if (attachment.kind === "image") {
    const match = SIGNAL_IMAGE_REL_PATH.exec(attachment.relPath);
    if (match) {
      target = vaultPaths(rootPath).signalChainFile(
        match[1]!.toLowerCase(),
        match[2]!.toLowerCase(),
      );
    }
  } else if (attachment.kind === "file") {
    const match = SIGNAL_FILE_REL_PATH.exec(attachment.relPath);
    if (match) {
      target = signalAttachmentPath(
        rootPath,
        match[1]!.toLowerCase(),
        match[2]?.toLowerCase() ?? null,
      );
    }
  }
  if (!target) return;
  try {
    await fs.rm(target, { force: true });
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

    const triage = await validateSignalTriage(rootPath, {
      projectId: input.projectId,
      status: input.status,
      priority: input.priority,
      capturedFrom: input.capturedFrom,
    });
    if (!triage.ok) return triage;

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
      projectId: triage.value.projectId,
      status: triage.value.status,
      priority: triage.value.priority,
      capturedFrom: triage.value.capturedFrom,
      attachment: attachment.value,
    };
    try {
      await writeSignalFile(rootPath, record);
    } catch (e) {
      if (record.attachment) {
        await removeStoredAttachment(rootPath, record.attachment);
      }
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

    // The triage fields are patched independently of the body/area write: an
    // absent key keeps what the record has, an explicit null clears it, and a
    // legacy record's parsed defaults make the first update safe.
    const triage = await validateSignalTriage(rootPath, {
      projectId:
        patch.projectId === undefined ? loaded.value.projectId : patch.projectId,
      status: patch.status === undefined ? loaded.value.status : patch.status,
      priority:
        patch.priority === undefined ? loaded.value.priority : patch.priority,
      capturedFrom: loaded.value.capturedFrom,
    });
    if (!triage.ok) return triage;

    const next: SignalRecord = {
      ...loaded.value,
      type: checked.value.type,
      body: checked.value.body,
      domainSlug: checked.value.domainSlug,
      title:
        patch.title === undefined
          ? loaded.value.title
          : normalizeTitle(patch.title),
      projectId: triage.value.projectId,
      status: triage.value.status,
      priority: triage.value.priority,
      capturedFrom: triage.value.capturedFrom,
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

/**
 * Read a stored file attachment back, for the renderer to hand to the operator
 * (a blob URL / a download). Only a path this module minted is accepted; a
 * foreign path, an active extension, or anything outside the vault is refused
 * by name rather than reparsed into a filesystem path. The MIME type is derived
 * from the extension the name supplied — the record's own hint is a label, and
 * this function never reads a record to find it.
 */
export async function readSignalFile(
  rootPath: string,
  relPath: string,
): Promise<Result<{ bytes: Uint8Array; mime: string }>> {
  try {
    const match =
      typeof relPath === "string" ? SIGNAL_FILE_REL_PATH.exec(relPath) : null;
    if (!match || !SIGNAL_ATTACHMENT_ID.test(match[1]!)) {
      return fail(`Invalid file path: ${String(relPath)}`);
    }
    const id = match[1]!.toLowerCase();
    const ext = match[2]?.toLowerCase() ?? null;
    if (ext && FORBIDDEN_FILE_EXTENSIONS.has(ext)) {
      return fail(`That file type cannot be kept in the vault: .${ext}`);
    }
    const filePath = signalAttachmentPath(rootPath, id, ext);
    await assertPhysicalContainment(rootPath, filePath, "read");
    await assertNoSymlinkLeaf(filePath);
    const bytes = await fs.readFile(filePath);
    const mime = (ext && MIME_BY_FILE_EXT[ext]) || SIGNAL_FALLBACK_MIME;
    return ok({ bytes: new Uint8Array(bytes), mime });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return fail("That file is missing from the vault.");
    }
    return fail(`Could not read that file: ${asError(e)}`);
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
