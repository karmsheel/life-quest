import type {
  DomainLens,
  SignalRecord,
  SignalType,
} from "@lifequest/vault-core";

export type SignalFilters = {
  type: SignalType | "all";
  domainSlug: string | "all" | "none";
  query: string;
};

export type SignalDayGroup = {
  dayKey: string;
  label: string;
  items: SignalRecord[];
};

export function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayLabel(dayKey: string, now: Date = new Date()): string {
  const todayKey = localDayKey(now.toISOString());
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestKey = localDayKey(yest.toISOString());
  if (dayKey === todayKey) return "Today";
  if (dayKey === yestKey) return "Yesterday";
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

export function formatSignalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function signalDomainLabel(
  slug: string | null,
  domains: { slug: string; name: string }[],
): string {
  if (!slug) return "- unassigned -";
  return domains.find((d) => d.slug === slug)?.name ?? slug;
}

/** Overview: all. A domain tab: unassigned plus that domain. */
export function signalVisible(
  lens: DomainLens,
  domainSlug: string | null,
): boolean {
  if (lens.kind === "overview") return true;
  return domainSlug === null || domainSlug === lens.slug;
}

export function formatSignalWhen(iso: string, now: Date = new Date()): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const time = d.toLocaleTimeString(undefined, { timeStyle: "short" });
    const label = dayLabel(localDayKey(iso), now);
    if (label === "Today" || label === "Yesterday") return `${label}, ${time}`;
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * The date and the time on their own lines, for a stamp the width of a date.
 * `formatSignalWhen` answers one string ("Today, 14:32") that wraps badly in a
 * square, and the square needs the two halves separately to stack them. Recent
 * days keep the Today/Yesterday word; anything older falls back to a short
 * month-and-day so the box stays one line wide.
 */
export function signalStampWhen(
  iso: string,
  now: Date = new Date(),
): { day: string; time: string } {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { day: iso, time: "" };
    const label = dayLabel(localDayKey(iso), now);
    const day =
      label === "Today" || label === "Yesterday"
        ? label
        : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return { day, time: formatSignalTime(iso) };
  } catch {
    return { day: iso, time: "" };
  }
}

export function filterSignals(
  records: SignalRecord[],
  filters: SignalFilters,
): SignalRecord[] {
  const q = filters.query.trim().toLowerCase();
  return records.filter((r) => {
    if (filters.type !== "all" && r.type !== filters.type) return false;
    if (filters.domainSlug === "none" && r.domainSlug !== null) return false;
    if (
      filters.domainSlug !== "all" &&
      filters.domainSlug !== "none" &&
      r.domainSlug !== filters.domainSlug
    ) {
      return false;
    }
    if (!q) return true;
    const title = (r.title ?? "").toLowerCase();
    return title.includes(q) || r.body.toLowerCase().includes(q);
  });
}

export function groupSignalsByDay(
  records: SignalRecord[],
  now: Date = new Date(),
): SignalDayGroup[] {
  const groups: SignalDayGroup[] = [];
  const index = new Map<string, SignalDayGroup>();
  for (const record of records) {
    const key = localDayKey(record.createdAt);
    let group = index.get(key);
    if (!group) {
      group = { dayKey: key, label: dayLabel(key, now), items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(record);
  }
  return groups;
}

export function taskFromSignalBody(body: string): { title: string; notes: string } {
  const notes = body;
  let title = "";
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      title = trimmed;
      break;
    }
  }
  if (title.length > 80) title = `${title.slice(0, 80)}...`;
  return { title, notes };
}

export function taskForSignal(
  tasks: readonly { id: string; links: { signalId?: string } }[],
  signalId: string,
): { id: string } | undefined {
  return tasks.find((t) => t.links.signalId === signalId);
}
