import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import {
  AUTOMATION_RUN_STATUSES,
  DEFAULT_ANALYZE_AUTOMATION,
  coerceAutomationTrigger,
  parseAutomationInput,
  type AutomationRecord,
  type AutomationRunPatch,
} from "./automation-core.ts";
import { vaultPaths } from "./paths.ts";
import type { Result } from "./types.ts";

/**
 * The automation store — one JSON file per vault, beside goals and the map.
 *
 * A missing file is not an empty vault: it means the built-in "Analyze note" has
 * not been edited yet, so the default record is what the page sees. The first
 * write materializes it. An explicit empty array is a vault whose operator
 * deleted every automation, and it stays empty.
 */
function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isIso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Date.parse(value))
  );
}

function coerceRecord(value: unknown): AutomationRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.description !== "string" ||
    typeof record.prompt !== "string" ||
    typeof record.enabled !== "boolean" ||
    !isIso(record.createdAt) ||
    !isIso(record.updatedAt)
  ) {
    return null;
  }
  if (record.host !== "daily-note" && record.host !== "none") return null;
  const trigger = coerceAutomationTrigger(record.trigger);
  if (!trigger) return null;
  const lastRunStatus =
    record.lastRunStatus === "succeeded" ||
    record.lastRunStatus === "failed" ||
    record.lastRunStatus === "skipped"
      ? record.lastRunStatus
      : null;
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    prompt: record.prompt,
    host: record.host,
    trigger,
    enabled: record.enabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastRunAt:
      record.lastRunAt === undefined || record.lastRunAt === null
        ? null
        : isIso(record.lastRunAt)
          ? record.lastRunAt
          : null,
    lastRunStatus,
    lastRunSessionId:
      record.lastRunSessionId === undefined || record.lastRunSessionId === null
        ? null
        : typeof record.lastRunSessionId === "string"
          ? record.lastRunSessionId
          : null,
    lastError:
      record.lastError === undefined || record.lastError === null
        ? null
        : typeof record.lastError === "string"
          ? record.lastError
          : null,
  };
}

export async function loadAutomations(
  rootPath: string,
): Promise<Result<AutomationRecord[]>> {
  const file = vaultPaths(rootPath).automationsJson;
  try {
    const raw = await fs.readFile(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "The automations store is not valid JSON." };
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { automations?: unknown }).automations)
    ) {
      return { ok: false, error: "The automations store has an invalid shape." };
    }
    const coerced = (parsed as { automations: unknown[] }).automations.map(coerceRecord);
    if (coerced.some((record) => record === null)) {
      return { ok: false, error: "The automations store holds an invalid record." };
    }
    return { ok: true, value: coerced as AutomationRecord[] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: [{ ...DEFAULT_ANALYZE_AUTOMATION }] };
    }
    return { ok: false, error: message(e) };
  }
}

async function writeAutomations(
  rootPath: string,
  records: AutomationRecord[],
): Promise<Result<AutomationRecord[]>> {
  try {
    await atomicWriteFile(
      vaultPaths(rootPath).automationsJson,
      `${JSON.stringify({ automations: records }, null, 2)}\n`,
    );
    return { ok: true, value: records };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function createAutomation(
  rootPath: string,
  input: unknown,
): Promise<Result<AutomationRecord[]>> {
  const parsed = parseAutomationInput(input);
  if (!parsed.ok) return parsed;
  const loaded = await loadAutomations(rootPath);
  if (!loaded.ok) return loaded;
  const now = new Date().toISOString();
  const record: AutomationRecord = {
    id: randomUUID(),
    ...parsed.value,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunSessionId: null,
    lastError: null,
  };
  return writeAutomations(rootPath, [...loaded.value, record]);
}

export async function updateAutomation(
  rootPath: string,
  id: string,
  input: unknown,
): Promise<Result<AutomationRecord[]>> {
  const parsed = parseAutomationInput(input);
  if (!parsed.ok) return parsed;
  const loaded = await loadAutomations(rootPath);
  if (!loaded.ok) return loaded;
  const index = loaded.value.findIndex((record) => record.id === id);
  if (index < 0) return { ok: false, error: "Automation not found." };
  const current = loaded.value[index]!;
  const now = new Date().toISOString();
  // A changed schedule starts from now rather than instantly replaying an
  // occurrence that passed while the old schedule was in force.
  const scheduleChanged =
    JSON.stringify(current.trigger) !== JSON.stringify(parsed.value.trigger);
  const next: AutomationRecord = {
    ...current,
    ...parsed.value,
    updatedAt: now,
    ...(scheduleChanged
      ? {
          lastRunAt: now,
          lastRunStatus: null,
          lastRunSessionId: null,
          lastError: null,
        }
      : {}),
  };
  const records = loaded.value.slice();
  records[index] = next;
  return writeAutomations(rootPath, records);
}

export async function deleteAutomation(
  rootPath: string,
  id: string,
): Promise<Result<AutomationRecord[]>> {
  const loaded = await loadAutomations(rootPath);
  if (!loaded.ok) return loaded;
  const records = loaded.value.filter((record) => record.id !== id);
  return writeAutomations(rootPath, records);
}

export async function markAutomationRun(
  rootPath: string,
  id: string,
  patch: AutomationRunPatch,
): Promise<Result<AutomationRecord[]>> {
  const loaded = await loadAutomations(rootPath);
  if (!loaded.ok) return loaded;
  const index = loaded.value.findIndex((record) => record.id === id);
  // A run can finish after its automation was deleted. That is not a write, and
  // the scheduler has nothing left to tell.
  if (index < 0) return loaded;
  if (!AUTOMATION_RUN_STATUSES.includes(patch.status)) {
    return { ok: false, error: "Unknown automation run status." };
  }
  const records = loaded.value.slice();
  records[index] = {
    ...records[index]!,
    lastRunAt: isIso(patch.at) ? patch.at : new Date().toISOString(),
    lastRunStatus: patch.status,
    lastRunSessionId:
      patch.sessionId === undefined ? records[index]!.lastRunSessionId : patch.sessionId,
    lastError: patch.error === undefined ? null : patch.error,
    updatedAt: new Date().toISOString(),
  };
  return writeAutomations(rootPath, records);
}
