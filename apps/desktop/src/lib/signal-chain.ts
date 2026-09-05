import type { SignalRecord, SignalType } from "@lifequest/vault-core";

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
  if (!slug) return "General";
  return domains.find((d) => d.slug === slug)?.name ?? slug;
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
