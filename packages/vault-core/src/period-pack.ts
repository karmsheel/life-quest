import fs from "node:fs/promises";
import { listDomains } from "./domains.ts";
import { loadGoals } from "./goals.ts";
import { readLog } from "./log.ts";
import { loadMapState } from "./map/persist.ts";
import {
  currentPeriod,
  isCurrentPeriod,
  periodBounds,
  previousPeriod,
} from "./period.ts";
import { getReview } from "./reviews.ts";
import { vaultPaths } from "./paths.ts";
import type {
  Goal,
  LifeEvent,
  MapEvent,
  PeriodPack,
  Result,
  ReviewCadence,
  ReviewRecord,
  Task,
  WeekStartDay,
} from "./types.ts";

async function readSettings(rootPath: string): Promise<WeekStartDay> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.settingsJson, "utf8");
    const parsed = JSON.parse(raw) as { weekStartDay?: string };
    return parsed.weekStartDay === "sunday" ? "sunday" : "monday";
  } catch {
    return "monday";
  }
}

function inWindow(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function extractDomainSections(
  bodyMarkdown: string,
  domainNames: Map<string, string>,
): Array<{ slug: string; name: string; status: "draft" | "done"; body: string }> {
  const lines = bodyMarkdown.split("\n");
  const sections: Array<{ slug: string; name: string; status: "draft" | "done"; body: string }> = [];
  // Build reverse name->slug map
  const nameToSlug = new Map<string, string>();
  for (const [slug, name] of domainNames) {
    nameToSlug.set(name.toLowerCase(), slug);
  }

  // Find H2 sections that match a domain name
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^##\s+(.+)$/.exec(line);
    if (!m) continue;
    const headingName = m[1].trim();
    const slug = nameToSlug.get(headingName.toLowerCase());
    if (!slug) continue;

    // Collect body from after this H2 until next H2 or EOF
    const sectionLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      if (/^##\s+/.test(nextLine)) break;
      sectionLines.push(nextLine);
    }
    const body = sectionLines.join("\n").trim();
    sections.push({ slug, name: headingName, status: "draft", body });
  }
  return sections;
}

export async function getPeriodPack(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: "overall" | string },
): Promise<Result<PeriodPack>> {
  const weekStartDay = await readSettings(rootPath);
  const bounds = periodBounds(input.cadence, input.period, weekStartDay);
  if (!bounds.ok) return { ok: false, error: bounds.error };

  const { start, end } = bounds.value;
  const isOverall = input.scope === "overall";
  const isCurrent = isCurrentPeriod(input.cadence, input.period, weekStartDay);

  const missingSources: string[] = [];

  // --- Log ---
  let log: LifeEvent[] = [];
  const logRes = await readLog(rootPath);
  if (!logRes.ok) {
    missingSources.push("log");
  } else {
    log = logRes.value.filter((e) => {
      const date = e.createdAt.slice(0, 10);
      if (!inWindow(date, start, end)) return false;
      if (!isOverall) {
        if (e.domainSlug === null) return false;
        return e.domainSlug === input.scope;
      }
      return true;
    });
  }

  // --- Map state (tasks, liveDays, events) ---
  const mapRes = await loadMapState(rootPath);
  let tasks: Task[] = [];
  let liveDays: { date: string }[] = [];
  let events: MapEvent[] = [];
  if (!mapRes.ok) {
    missingSources.push("map");
  } else {
    const state = mapRes.value;

    // Tasks
    tasks = state.tasks.filter((t) => {
      const date = t.links?.date;
      if (date && inWindow(date, start, end)) {
        // ok, include
      } else if (isCurrent && (t.column === "today" || t.column === "this-week")) {
        // include for current period
      } else {
        return false;
      }
      if (!isOverall) {
        const goalId = t.links?.goalId;
        if (!goalId) return false;
        // Need to check goal domainSlug — we'll filter after goals load
        return true;
      }
      return true;
    });

    // liveDays
    liveDays = Object.values(state.liveDays).filter((d) =>
      inWindow(d.date, start, end),
    );

    // Map events
    for (const year of state.years) {
      for (const ev of year.events) {
        if (!inWindow(ev.date, start, end)) continue;
        if (!isOverall) {
          if (ev.domainSlug === null) continue;
          if (ev.domainSlug !== input.scope) continue;
        }
        events.push(ev);
      }
    }
  }

  // --- Goals ---
  let goals: Goal[] = [];
  const goalsRes = await loadGoals(rootPath);
  if (!goalsRes.ok) {
    missingSources.push("goals");
  } else {
    goals = goalsRes.value.filter((g) => {
      if (g.status !== "open" && !g.deadline) return false;
      if (g.status === "open" || (g.deadline && inWindow(g.deadline, start, end))) {
        if (!isOverall) {
          if (g.domainSlug === null) return false;
          return g.domainSlug === input.scope;
        }
        return true;
      }
      return false;
    });

    // Now filter tasks by goal domain (for domain packs)
    if (!isOverall && mapRes.ok) {
      const goalDomainMap = new Map<string, string | null>();
      for (const g of goalsRes.value) {
        goalDomainMap.set(g.id, g.domainSlug);
      }
      tasks = tasks.filter((t) => {
        const date = t.links?.date;
        const inWin = date && inWindow(date, start, end);
        const inCurrent = isCurrent && (t.column === "today" || t.column === "this-week");
        if (!inWin && !inCurrent) return false;
        const goalId = t.links?.goalId;
        if (!goalId) return false;
        const gSlug = goalDomainMap.get(goalId);
        return gSlug === input.scope;
      });
    }
  }

  // --- Previous review ---
  let previousReview: ReviewRecord | null = null;
  const prevResult = previousPeriod(input.cadence, input.period, weekStartDay);
  if (prevResult.ok) {
    const reviewRes = await getReview(rootPath, input.cadence, prevResult.value);
    if (reviewRes.ok) {
      previousReview = reviewRes.value;
    }
  }

  // --- domainSections (overall only) ---
  let domainSections: Array<{ slug: string; name: string; status: "draft" | "done"; body: string }> = [];
  if (isOverall) {
    const reviewRes = await getReview(rootPath, input.cadence, input.period);
    if (reviewRes.ok) {
      const record = reviewRes.value;
      const listed = await listDomains(rootPath);
      const domainNames = new Map<string, string>();
      if (listed.ok) {
        for (const d of listed.value) {
          domainNames.set(d.slug, d.meta.name);
        }
      }
      // Build sections from body
      const rawSections = extractDomainSections(record.bodyMarkdown, domainNames);
      // Attach status from scopes
      for (const s of rawSections) {
        const scopeState = record.scopes[s.slug];
        domainSections.push({
          ...s,
          status: scopeState?.status === "done" ? "done" : "draft",
        });
      }
    }
  }

  // --- Caps / truncated ---
  let truncated = false;
  const CAP_LOG = 100;
  const CAP_TASKS = 80;
  const CAP_EVENTS = 80;
  const CAP_LIVE_DAYS = 62;

  if (log.length > CAP_LOG) {
    log = log.slice(0, CAP_LOG);
    truncated = true;
  }
  if (tasks.length > CAP_TASKS) {
    tasks = tasks.slice(0, CAP_TASKS);
    truncated = true;
  }
  if (events.length > CAP_EVENTS) {
    events = events.slice(0, CAP_EVENTS);
    truncated = true;
  }
  if (liveDays.length > CAP_LIVE_DAYS) {
    liveDays = liveDays.slice(0, CAP_LIVE_DAYS);
    truncated = true;
  }

  return {
    ok: true,
    value: {
      cadence: input.cadence,
      period: input.period,
      scope: input.scope,
      bounds: { start, end },
      log,
      tasks,
      goals,
      liveDays: liveDays as PeriodPack["liveDays"],
      events: events as PeriodPack["events"],
      previousReview,
      domainSections,
      missingSources,
      truncated,
    },
  };
}
