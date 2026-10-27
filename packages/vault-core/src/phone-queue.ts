/**
 * The phone's vault files: one draft per file, the device roster, the metric
 * pin, and the resolution lifecycle.
 *
 * Everything under `.lifequest/phone/` follows the shape the rest of the app's
 * state already uses — one JSON record per file, atomic writes, a corrupt file
 * costs one record rather than the set. The queue is deliberately not one JSON
 * array: a phone that retries while the desktop writes cannot truncate the
 * queue, and a hand-edited file cannot take the rest down with it.
 *
 * No transaction is ever written here. A draft becomes an event only through
 * the companion's tool, which lives in `phone-tools.ts` and calls the same
 * `captureUtterance` the chat already uses.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { todayLocalIso } from "./period.ts";
import { vaultPaths } from "./paths.ts";
import {
  PHONE_DRAFT_MAX_TEXT,
  PHONE_MAX_DEVICES,
  PHONE_PENDING_CAP,
  PHONE_RESOLVED_RETENTION_DAYS,
  clampCaptureDate,
  isClientId,
  isIsoDate,
  isPhoneMetricId,
  normalizeDraftText,
  type PhoneDevice,
  type PhoneDraft,
  type PhoneDraftStatus,
  type PhoneMetricId,
  type PhoneSettings,
} from "./phone.ts";
import type { Result } from "./types.ts";

const MS_PER_DAY = 86_400_000;
const DEVICE_NAME_MAX = 40;

export function phonePaths(root: string) {
  const dir = path.join(vaultPaths(root).lifequestDir, "phone");
  return {
    dir,
    settingsJson: path.join(dir, "settings.json"),
    devicesJson: path.join(dir, "devices.json"),
    draftsDir: path.join(dir, "drafts"),
    draftJson: (clientId: string) => path.join(dir, "drafts", `${clientId}.json`),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

// ── settings ────────────────────────────────────────────────────────────────

export async function readPhoneSettings(
  root: string,
): Promise<Result<PhoneSettings>> {
  const parsed = await readJsonFile<{ schemaVersion?: unknown; metric?: unknown }>(
    phonePaths(root).settingsJson,
  );
  // A missing or unreadable file is a fresh vault's setting, not an error: the
  // phone has nothing pinned until the operator pins one.
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      metric:
        parsed && isPhoneMetricId(parsed.metric) ? parsed.metric : null,
    },
  };
}

export async function writePhoneMetric(
  root: string,
  metric: PhoneMetricId | null,
): Promise<Result<PhoneSettings>> {
  if (metric !== null && !isPhoneMetricId(metric)) {
    return { ok: false, error: "Unknown phone metric" };
  }
  const settings: PhoneSettings = { schemaVersion: 1, metric };
  await atomicWriteFile(
    phonePaths(root).settingsJson,
    `${JSON.stringify(settings, null, 2)}\n`,
  );
  return { ok: true, value: settings };
}

// ── devices ─────────────────────────────────────────────────────────────────

type DevicesFile = { schemaVersion: 1; devices: PhoneDevice[] };

function isDevice(value: unknown): value is PhoneDevice {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.tokenHash === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.lastSeenAt === "string"
  );
}

async function readDevicesFile(root: string): Promise<DevicesFile> {
  const parsed = await readJsonFile<Partial<DevicesFile>>(
    phonePaths(root).devicesJson,
  );
  const devices = Array.isArray(parsed?.devices)
    ? parsed!.devices.filter(isDevice)
    : [];
  return { schemaVersion: 1, devices };
}

async function writeDevicesFile(root: string, devices: PhoneDevice[]): Promise<void> {
  await atomicWriteFile(
    phonePaths(root).devicesJson,
    `${JSON.stringify({ schemaVersion: 1, devices }, null, 2)}\n`,
  );
}

export async function readPhoneDevices(root: string): Promise<Result<PhoneDevice[]>> {
  const file = await readDevicesFile(root);
  return { ok: true, value: file.devices };
}

export async function addPhoneDevice(
  root: string,
  input: { name: string; tokenHash: string },
): Promise<Result<PhoneDevice>> {
  const name = input.name.trim().slice(0, DEVICE_NAME_MAX) || "Phone";
  if (!input.tokenHash.trim()) {
    return { ok: false, error: "A device token hash is required" };
  }
  const file = await readDevicesFile(root);
  if (file.devices.length >= PHONE_MAX_DEVICES) {
    return {
      ok: false,
      error: `too_many_devices: the vault allows ${PHONE_MAX_DEVICES} phones`,
    };
  }
  const now = new Date().toISOString();
  const device: PhoneDevice = {
    id: randomUUID(),
    name,
    tokenHash: input.tokenHash,
    createdAt: now,
    lastSeenAt: now,
  };
  file.devices.push(device);
  await writeDevicesFile(root, file.devices);
  return { ok: true, value: device };
}

export async function removePhoneDevice(
  root: string,
  id: string,
): Promise<Result<{ removed: boolean }>> {
  const file = await readDevicesFile(root);
  const next = file.devices.filter((device) => device.id !== id);
  const removed = next.length !== file.devices.length;
  if (removed) await writeDevicesFile(root, next);
  return { ok: true, value: { removed } };
}

export async function touchPhoneDevice(
  root: string,
  id: string,
): Promise<Result<PhoneDevice | null>> {
  const file = await readDevicesFile(root);
  const device = file.devices.find((row) => row.id === id);
  if (!device) return { ok: true, value: null };
  device.lastSeenAt = new Date().toISOString();
  await writeDevicesFile(root, file.devices);
  return { ok: true, value: device };
}

// ── drafts ──────────────────────────────────────────────────────────────────

function isDraft(value: unknown): value is PhoneDraft {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === 1 &&
    isClientId(v.clientId) &&
    typeof v.deviceId === "string" &&
    typeof v.deviceName === "string" &&
    typeof v.text === "string" &&
    typeof v.captureDate === "string" &&
    typeof v.captureDateClamped === "boolean" &&
    typeof v.capturedAt === "string" &&
    typeof v.receivedAt === "string" &&
    (v.status === "pending" || v.status === "posted" || v.status === "dismissed") &&
    (v.rowId === null || typeof v.rowId === "string") &&
    (v.receipt === null || typeof v.receipt === "string") &&
    (v.resolvedAt === null || typeof v.resolvedAt === "string")
  );
}

async function writeDraft(root: string, draft: PhoneDraft): Promise<void> {
  await atomicWriteFile(
    phonePaths(root).draftJson(draft.clientId),
    `${JSON.stringify(draft, null, 2)}\n`,
  );
}

export async function readPhoneDraft(
  root: string,
  clientId: string,
): Promise<Result<PhoneDraft>> {
  if (!isClientId(clientId)) {
    return { ok: false, error: "Not a phone draft id" };
  }
  const parsed = await readJsonFile<PhoneDraft>(
    phonePaths(root).draftJson(clientId),
  );
  if (!parsed || !isDraft(parsed)) {
    return { ok: false, error: "No phone draft with that id" };
  }
  return { ok: true, value: parsed };
}

export async function listPhoneDrafts(
  root: string,
  opts: { deviceId?: string; status?: PhoneDraftStatus } = {},
): Promise<Result<{ drafts: PhoneDraft[]; skipped: number }>> {
  let names: string[];
  try {
    names = await fs.readdir(phonePaths(root).draftsDir);
  } catch {
    return { ok: true, value: { drafts: [], skipped: 0 } };
  }
  const drafts: PhoneDraft[] = [];
  let skipped = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const parsed = await readJsonFile<PhoneDraft>(
      path.join(phonePaths(root).draftsDir, name),
    );
    if (!parsed || !isDraft(parsed)) {
      skipped += 1;
      continue;
    }
    if (opts.deviceId && parsed.deviceId !== opts.deviceId) continue;
    if (opts.status && parsed.status !== opts.status) continue;
    drafts.push(parsed);
  }
  // Oldest first: a phone that queued three drafts offline expects that order
  // when the companion walks them.
  drafts.sort(
    (a, b) =>
      a.receivedAt.localeCompare(b.receivedAt) ||
      a.clientId.localeCompare(b.clientId),
  );
  return { ok: true, value: { drafts, skipped } };
}

export async function pendingPhoneDraftCount(root: string): Promise<number> {
  const listed = await listPhoneDrafts(root, { status: "pending" });
  return listed.ok ? listed.value.drafts.length : 0;
}

export type QueuePhoneDraftInput = {
  clientId: string;
  deviceId: string;
  deviceName: string;
  text: string;
  captureDate: string;
  capturedAt: string;
};

/**
 * Write one draft, unless the client already wrote it.
 *
 * A repeated `clientId` returns the existing draft with `created: false`, even
 * when it has already been resolved: the caller reads `status` and answers 409,
 * so a phone that missed the first response cannot create a second draft.
 */
export async function queuePhoneDraft(
  root: string,
  input: QueuePhoneDraftInput,
  receivedAt: string = new Date().toISOString(),
): Promise<Result<{ draft: PhoneDraft; created: boolean }>> {
  if (!isClientId(input.clientId)) {
    return { ok: false, error: "clientId must be a UUID v4" };
  }
  const text = normalizeDraftText(input.text);
  if (text === null) {
    return {
      ok: false,
      error: `Draft text must be 1–${PHONE_DRAFT_MAX_TEXT} characters`,
    };
  }
  if (!isIsoDate(input.captureDate)) {
    return { ok: false, error: "captureDate must be YYYY-MM-DD" };
  }

  const existing = await readPhoneDraft(root, input.clientId);
  if (existing.ok) return { ok: true, value: { draft: existing.value, created: false } };

  await pruneResolvedPhoneDrafts(root, new Date(receivedAt));
  if ((await pendingPhoneDraftCount(root)) >= PHONE_PENDING_CAP) {
    return {
      ok: false,
      error: `The phone queue is full (${PHONE_PENDING_CAP} pending drafts)`,
    };
  }

  const captureDate = clampCaptureDate(
    input.captureDate,
    todayLocalIso(new Date(receivedAt)),
  );
  const capturedAt = Number.isFinite(Date.parse(input.capturedAt))
    ? input.capturedAt
    : receivedAt;
  const draft: PhoneDraft = {
    schemaVersion: 1,
    clientId: input.clientId,
    deviceId: input.deviceId,
    deviceName: input.deviceName.trim().slice(0, DEVICE_NAME_MAX) || "Phone",
    text,
    captureDate: captureDate.date,
    captureDateClamped: captureDate.clamped,
    capturedAt,
    receivedAt,
    status: "pending",
    rowId: null,
    receipt: null,
    resolvedAt: null,
  };
  await writeDraft(root, draft);
  return { ok: true, value: { draft, created: true } };
}

/** A phone may take a draft back before the companion ever confirms it. */
export async function withdrawPhoneDraft(
  root: string,
  clientId: string,
  deviceId: string,
): Promise<Result<{ draft: PhoneDraft }>> {
  const read = await readPhoneDraft(root, clientId);
  if (!read.ok) return read;
  const draft = read.value;
  if (draft.deviceId !== deviceId) {
    return { ok: false, error: "No phone draft with that id" };
  }
  if (draft.status === "dismissed") {
    // The phone may retry a withdrawal whose response it lost.
    return { ok: true, value: { draft } };
  }
  if (draft.status !== "pending") {
    return { ok: false, error: `already_resolved:${draft.status}` };
  }
  draft.status = "dismissed";
  draft.resolvedAt = new Date().toISOString();
  await writeDraft(root, draft);
  return { ok: true, value: { draft } };
}

/**
 * Move a pending draft to its outcome. Called only by the companion's tool.
 * A draft that is already resolved is refused rather than rewritten, so one
 * draft can never produce two transactions.
 */
export async function resolvePhoneDraft(
  root: string,
  clientId: string,
  input: {
    status: "posted" | "dismissed";
    rowId?: string | null;
    receipt?: string | null;
    resolvedAt?: string;
  },
): Promise<Result<PhoneDraft>> {
  const read = await readPhoneDraft(root, clientId);
  if (!read.ok) return read;
  if (read.value.status !== "pending") {
    return { ok: false, error: `already_resolved:${read.value.status}` };
  }
  const draft: PhoneDraft = {
    ...read.value,
    status: input.status,
    rowId: input.rowId ?? null,
    receipt: input.receipt ?? null,
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
  };
  await writeDraft(root, draft);
  return { ok: true, value: draft };
}

/**
 * Delete resolutions older than the retention window. They are kept long
 * enough for a phone that was offline when its draft posted to find the
 * resolution when it returns; a shorter window would let it re-send the id and
 * risk a second transaction.
 */
export async function pruneResolvedPhoneDrafts(
  root: string,
  now: Date = new Date(),
): Promise<number> {
  const listed = await listPhoneDrafts(root);
  if (!listed.ok) return 0;
  const cutoff = now.getTime() - PHONE_RESOLVED_RETENTION_DAYS * MS_PER_DAY;
  let removed = 0;
  for (const draft of listed.value.drafts) {
    if (draft.status === "pending") continue;
    const at = draft.resolvedAt ? Date.parse(draft.resolvedAt) : Number.NaN;
    if (!Number.isFinite(at) || at >= cutoff) continue;
    await fs.rm(phonePaths(root).draftJson(draft.clientId), { force: true });
    removed += 1;
  }
  return removed;
}
