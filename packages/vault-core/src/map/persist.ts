import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "../atomic-write.ts";
import { listDomains } from "../domains.ts";
import { loadGoals } from "../goals.ts";
import { appendLog } from "../log.ts";
import { vaultPaths } from "../paths.ts";
import type { Result } from "../types.ts";
import { USER_ACTOR, type Actor } from "../types.ts";
import { applyCommand } from "./commands.ts";
import { emptyState } from "./empty.ts";
import { isMapEvent } from "./events.ts";
import { mapLogEvent } from "./log-event.ts";
import { isIsoDate, todayLocalIso } from "./dates.ts";
import type { Actor as MapActor, Command, IsoDate, LiveBlock, LiveDay, LiveLeftoverItem, LiveSource, StoreState, Task, YearRecord } from "./types.ts";
import { ensureCurrentYear, rollover } from "./years.ts";

type MapFile = Omit<StoreState, "aboutMe">;

function toFile(state: StoreState): MapFile {
  return {
    dayTypes: state.dayTypes,
    defaultWeek: state.defaultWeek,
    years: state.years,
    tasks: state.tasks,
    liveDays: state.liveDays,
  };
}

function normalizeLinks(links: Record<string, unknown> | undefined): Task["links"] {
  const next: Task["links"] = {};
  if (!links || typeof links !== "object") return next;
  if (typeof links.goalId === "string") next.goalId = links.goalId;
  if (typeof links.projectId === "string") next.projectId = links.projectId;
  if (typeof links.date === "string") next.date = links.date;
  if (links.weekItem && typeof links.weekItem === "object") {
    next.weekItem = links.weekItem as Task["links"]["weekItem"];
  }
  if (typeof links.signalId === "string") next.signalId = links.signalId;
  return next;
}

function normalizeYear(raw: Record<string, unknown>): YearRecord {
  const events = Array.isArray(raw.events)
    ? raw.events.filter(isMapEvent)
    : [];
  return {
    year: raw.year as number,
    status: raw.status as YearRecord["status"],
    events,
    months: raw.months as YearRecord["months"],
    detachedWeeks: (raw.detachedWeeks as YearRecord["detachedWeeks"]) ?? {},
    snapshot: raw.snapshot as YearRecord["snapshot"],
  };
}

function fromFile(file: MapFile, aboutMe: string): StoreState {
  return {
    dayTypes: file.dayTypes,
    defaultWeek: file.defaultWeek,
    years: (file.years as unknown as Record<string, unknown>[]).map(normalizeYear),
    tasks: file.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      column: t.column,
      links: normalizeLinks(t.links as unknown as Record<string, unknown>),
    })),
    liveDays: normalizeLiveDays(file.liveDays),
    aboutMe,
  };
}

function isLiveSource(value: unknown): value is LiveSource {
  if (!value || typeof value !== "object") return false;
  const s = value as LiveSource;
  if (s.type === "ad-hoc") return true;
  if (s.type === "template" && typeof s.dayTypeItemId === "string") return true;
  if (s.type === "task" && typeof s.taskId === "string") return true;
  return false;
}

function normalizeLiveDays(raw: unknown): Record<string, LiveDay> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, LiveDay> = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isIsoDate(date) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const leftover = Array.isArray(v.leftover) ? v.leftover : [];
    const blocks = Array.isArray(v.blocks) ? v.blocks : [];
    out[date] = {
      date,
      dayTypeId: typeof v.dayTypeId === "string" ? v.dayTypeId : null,
      leftover: leftover.filter((row) => {
        const r = row as LiveLeftoverItem;
        return (
          r &&
          typeof r.id === "string" &&
          typeof r.text === "string" &&
          typeof r.done === "boolean" &&
          isLiveSource(r.source) &&
          r.source.type !== "task"
        );
      }),
      blocks: blocks.filter((row) => {
        const r = row as LiveBlock;
        return (
          r &&
          typeof r.id === "string" &&
          typeof r.text === "string" &&
          typeof r.done === "boolean" &&
          Number.isInteger(r.startMinutes) &&
          Number.isInteger(r.durationMinutes) &&
          isLiveSource(r.source)
        );
      }),
    };
  }
  return out;
}

function isMapFile(value: unknown): value is MapFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<MapFile>;
  return (
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

async function readMapFile(rootPath: string): Promise<
  | { ok: true; file: MapFile; aboutMe: string }
  | { ok: false; error: string }
  | { ok: false; error: string; malformed: true }
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
    return { ok: true, file: parsed, aboutMe };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "ENOENT" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadMapState(rootPath: string): Promise<
  Result<StoreState> | { ok: false; error: string; malformed: true }
> {
  const loaded = await readMapFile(rootPath);
  if (!loaded.ok) return loaded;
  return { ok: true, value: fromFile(loaded.file, loaded.aboutMe) };
}

export async function ensureMapOnOpen(
  rootPath: string,
  today: string = todayLocalIso(),
): Promise<Result<StoreState>> {
  const loaded = await readMapFile(rootPath);
  if (loaded.ok) {
    const value = fromFile(loaded.file, loaded.aboutMe);
    const next = ensureCurrentYear(rollover(value, today), today);
    const persistNeeded =
      JSON.stringify(toFile(next)) !==
      JSON.stringify({
        dayTypes: loaded.file.dayTypes,
        defaultWeek: loaded.file.defaultWeek,
        years: loaded.file.years,
        tasks: loaded.file.tasks,
        liveDays: loaded.file.liveDays,
      });
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
  actor: MapActor,
  today: string = todayLocalIso(),
  vaultActor: Actor = USER_ACTOR,
): Promise<Result<StoreState>> {
  const ensured = await ensureMapOnOpen(rootPath, today);
  if (!ensured.ok) return ensured;
  const domains = await listDomains(rootPath);
  const live = domains.ok
    ? domains.value.filter((d) => !d.meta.archivedAt).map((d) => d.slug)
    : [];
  const goals = await loadGoals(rootPath);
  const goalIds = goals.ok ? goals.value.map((g) => g.id) : [];
  const result = applyCommand(ensured.value, command, {
    actor,
    today,
    id: () => randomUUID(),
    liveDomainSlugs: live,
    goalIds,
  });
  if (!result.ok) {
    return { ok: false, error: `${result.error.code}: ${result.error.message}` };
  }
  const saved = await writeMapState(rootPath, result.value);
  if (!saved.ok) return saved;
  const ev = mapLogEvent(command);
  // Map + about are already persisted. Do not roll them back if the life-log
  // append fails; the map command itself succeeded.
  await appendLog(rootPath, {
    domainSlug:
      "domainSlug" in command ? ((command.domainSlug as string | null | undefined) ?? null) : null,
    type: ev.type,
    summary: ev.summary,
    payload: ev.payload,
    actor: vaultActor,
  });
  return { ok: true, value: result.value };
}
