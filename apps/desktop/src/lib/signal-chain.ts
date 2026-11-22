import type {
  DomainLens,
  SignalPriority,
  SignalRecord,
  SignalStatus,
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

/**
 * Bytes in the operator's units, for a capture's file chip and card. Exact
 * bytes below a kilobyte, one decimal below ten in the unit ("1.4 MB"), whole
 * numbers above it ("12 KB") — deterministic, so the same size always reads the
 * same in both places.
 */
export function formatSignalFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

export function signalDomainLabel(
  slug: string | null,
  domains: { slug: string; name: string }[],
): string {
  if (!slug) return "- unassigned -";
  return domains.find((d) => d.slug === slug)?.name ?? slug;
}

/**
 * The inbox's per-row area label. It differs from `signalDomainLabel` on
 * purpose: the composer's picker and the old table say "- unassigned -", while
 * a row in the inbox must never paint a blank cell and says "Unassigned" — a
 * fixed word the inbox rig asserts. Keep both; they answer different surfaces.
 */
export function signalRowDomainLabel(
  slug: string | null | undefined,
  domains: { slug: string; name: string }[],
): string {
  if (!slug) return "Unassigned";
  return domains.find((d) => d.slug === slug)?.name ?? slug;
}

/** The five triage states, as the operator reads them on a row or a chip. */
export const SIGNAL_STATUS_LABELS: Record<SignalStatus, string> = {
  inbox: "Inbox",
  triaged: "Triaged",
  acting: "Acting",
  done: "Done",
  dropped: "Dropped",
};

/** The three priorities, as the operator reads them. "None" is unset, not low. */
export const SIGNAL_PRIORITY_LABELS: Record<SignalPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * A row's status word. A record written before the inbox existed carries no
 * status key; the store reads that as "inbox", and so does this label.
 */
export function signalStatusLabel(
  status: SignalStatus | null | undefined,
): string {
  return (status && SIGNAL_STATUS_LABELS[status]) || SIGNAL_STATUS_LABELS.inbox;
}

/** A row's priority word: one of High/Normal/Low, or "None" when unset. */
export function signalPriorityLabel(
  priority: SignalPriority | null | undefined,
): string {
  return (priority && SIGNAL_PRIORITY_LABELS[priority]) || "None";
}

/**
 * What a row's project cell reads: the live project's title, else the stored id
 * (a project may have been deleted while the signal kept its link), else
 * "No project" for an unfiled capture. Never blank.
 */
export function projectDisplayLabel(
  projectId: string | null | undefined,
  projects: readonly { id: string; title: string }[],
): string {
  if (!projectId) return "No project";
  return projects.find((p) => p.id === projectId)?.title || projectId;
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
    const attachmentText =
      r.attachment?.kind === "link"
        ? r.attachment.url.toLowerCase()
        : r.attachment?.kind === "image" || r.attachment?.kind === "file"
          ? r.attachment.name.toLowerCase()
          : "";
    return (
      title.includes(q) ||
      r.body.toLowerCase().includes(q) ||
      attachmentText.includes(q)
    );
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

/** The host of a stored link, for a card's label. Empty when it cannot parse. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/** The same 80-plus-ellipsis cap the body-derived title uses. */
function capTaskTitle(title: string): string {
  return title.length > 80 ? `${title.slice(0, 80)}...` : title;
}

/**
 * What a capture becomes when it is made a task. The body leads; a capture that
 * is only a picture or a link names itself from the attachment, so an image
 * dropped with no words still has a handle on the Act board.
 */
export function taskFromSignal(signal: SignalRecord): {
  title: string;
  notes: string;
} {
  const body = signal.body.trim();
  if (body) return taskFromSignalBody(body);
  const attachment = signal.attachment;
  if (attachment?.kind === "link") {
    return {
      title: capTaskTitle(`Link: ${linkHost(attachment.url) || attachment.url}`),
      notes: attachment.url,
    };
  }
  if (attachment?.kind === "image") {
    return { title: capTaskTitle(`Image: ${attachment.name}`), notes: attachment.name };
  }
  if (attachment?.kind === "file") {
    return { title: capTaskTitle(`File: ${attachment.name}`), notes: attachment.name };
  }
  return { title: "", notes: "" };
}

export function taskForSignal(
  tasks: readonly { id: string; links: { signalId?: string } }[],
  signalId: string,
): { id: string } | undefined {
  return tasks.find((t) => t.links.signalId === signalId);
}
