import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "../atomic-write.ts";
import { appendLog } from "../log.ts";
import { vaultPaths } from "../paths.ts";
import type { Result } from "../types.ts";
import { applyCommand } from "./commands.ts";
import { emptyState } from "./empty.ts";
import { mapLogEvent } from "./log-event.ts";
import { todayLocalIso } from "./dates.ts";
import type { Actor, Command, StoreState } from "./types.ts";
import { ensureCurrentYear, rollover } from "./years.ts";

type MapFile = Omit<StoreState, "aboutMe">;

function toFile(state: StoreState): MapFile {
  return {
    locked: state.locked,
    dayTypes: state.dayTypes,
    defaultWeek: state.defaultWeek,
    years: state.years,
    tasks: state.tasks,
  };
}

function fromFile(file: MapFile, aboutMe: string): StoreState {
  return { ...file, aboutMe };
}

function isMapFile(value: unknown): value is MapFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<MapFile>;
  return (
    typeof v.locked === "boolean" &&
    Array.isArray(v.dayTypes) &&
    !!v.defaultWeek &&
    Array.isArray(v.years) &&
    Array.isArray(v.tasks)
  );
}

export async function readAboutMe(rootPath: string): Promise<string> {
  try {
    return await fs.readFile(vaultPaths(rootPath).aboutMd, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

export async function writeMapState(
  rootPath: string,
  state: StoreState,
): Promise<Result<true>> {
  try {
    const paths = vaultPaths(rootPath);
    await fs.mkdir(paths.lifequestDir, { recursive: true });
    await atomicWriteFile(paths.mapJson, `${JSON.stringify(toFile(state), null, 2)}\n`);
    await atomicWriteFile(paths.aboutMd, state.aboutMe);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadMapState(rootPath: string): Promise<
  Result<StoreState> | { ok: false; error: string; malformed: true }
> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.mapJson, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Map store is not valid JSON", malformed: true };
    }
    if (!isMapFile(parsed)) {
      return { ok: false, error: "Map store has invalid shape", malformed: true };
    }
    const aboutMe = await readAboutMe(rootPath);
    return { ok: true, value: fromFile(parsed, aboutMe) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "ENOENT" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function ensureMapOnOpen(
  rootPath: string,
  today: string = todayLocalIso(),
): Promise<Result<StoreState>> {
  const loaded = await loadMapState(rootPath);
  if (loaded.ok) {
    const next = ensureCurrentYear(rollover(loaded.value, today), today);
    const persistNeeded =
      JSON.stringify(toFile(next)) !== JSON.stringify(toFile(loaded.value));
    if (persistNeeded) {
      const saved = await writeMapState(rootPath, next);
      if (!saved.ok) return saved;
    }
    return { ok: true, value: next };
  }
  if ("malformed" in loaded && loaded.malformed) {
    return { ok: false, error: loaded.error };
  }
  const seeded = ensureCurrentYear(rollover(emptyState(), today), today);
  const saved = await writeMapState(rootPath, seeded);
  if (!saved.ok) return saved;
  return { ok: true, value: seeded };
}

export async function applyMapCommand(
  rootPath: string,
  command: Command,
  actor: Actor,
  today: string = todayLocalIso(),
): Promise<Result<StoreState>> {
  const ensured = await ensureMapOnOpen(rootPath, today);
  if (!ensured.ok) return ensured;
  const result = applyCommand(ensured.value, command, {
    actor,
    today,
    id: () => randomUUID(),
  });
  if (!result.ok) {
    return { ok: false, error: `${result.error.code}: ${result.error.message}` };
  }
  const saved = await writeMapState(rootPath, result.value);
  if (!saved.ok) return saved;
  const ev = mapLogEvent(command);
  const logRes = await appendLog(rootPath, {
    domainSlug: null,
    type: ev.type,
    summary: ev.summary,
    payload: ev.payload,
  });
  if (!logRes.ok) return logRes;
  return { ok: true, value: result.value };
}
