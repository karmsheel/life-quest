import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { vaultPaths } from "./paths.ts";
import {
  SIGNAL_SOURCES,
  SIGNAL_TYPES,
  type Result,
  type SignalChainListResult,
  type SignalCreateInput,
  type SignalRecord,
  type SignalSource,
  type SignalType,
  type SignalUpdatePatch,
} from "./types.ts";

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
): Promise<Result<{ type: SignalType; body: string; domainSlug: string | null }>> {
  if (!isSignalType(type)) {
    return fail(`Invalid signal type: ${String(type)}`);
  }
  const trimmed = body.trim();
  if (!trimmed) return fail("body is required");
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
    const checked = await validateBodyAndMeta(
      rootPath,
      input.type,
      input.body,
      domainSlug,
    );
    if (!checked.ok) return checked;
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
    };
    await writeSignalFile(rootPath, record);
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
