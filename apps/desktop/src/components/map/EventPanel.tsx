import { useEffect, useMemo, useState } from "react";
import {
  filterByLens,
  lensSlug,
  type DomainLens,
  type DomainRecord,
  type Goal,
  type Result,
} from "@lifequest/vault-core/pure";
import type { MapCommand, MapEvent, YearRecord } from "@lifequest/vault-core/map";

type CommandHandler = (command: MapCommand) => Promise<Result<unknown>>;

type Props = {
  year: YearRecord;
  readOnly: boolean;
  onCommand: CommandHandler;
  goals: Goal[];
  domains: DomainRecord[];
  lens: DomainLens;
  seedDate: string | null;
  onConsumedSeed: () => void;
};

function liveDomains(domains: DomainRecord[]): DomainRecord[] {
  return domains
    .filter((d) => !d.meta.archivedAt)
    .slice()
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
}

function domainPickerOptions(
  domains: DomainRecord[],
  current: string | null,
): { slug: string; name: string }[] {
  const live = liveDomains(domains).map((d) => ({
    slug: d.slug,
    name: d.meta.name,
  }));
  if (current && !live.some((d) => d.slug === current)) {
    const stored = domains.find((d) => d.slug === current);
    live.push({ slug: current, name: stored?.meta.name ?? current });
  }
  return live;
}

function goalPickerOptions(
  goals: Goal[],
  currentId: string | null,
): { id: string; label: string }[] {
  const options = goals
    .filter((g) => g.status === "open")
    .map((g) => ({ id: g.id, label: g.name }));
  if (!currentId) return options;
  const found = goals.find((g) => g.id === currentId);
  if (!found) {
    options.push({ id: currentId, label: `${currentId} (missing)` });
  } else if (found.status === "done") {
    options.push({ id: found.id, label: `${found.name} (done)` });
  }
  return options;
}

export function EventPanel({
  year,
  readOnly,
  onCommand,
  goals,
  domains,
  lens,
  seedDate,
  onConsumedSeed,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(`${year.year}-01-01`);
  const [notes, setNotes] = useState("");
  const [domainValue, setDomainValue] = useState(lensSlug(lens) ?? "");
  const [goalValue, setGoalValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      filterByLens(year.events, lens)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
    [year.events, lens],
  );

  const addDomains = domainPickerOptions(domains, null);
  const addGoals = goalPickerOptions(goals, null);
  const domainName =
    lens.kind === "domain"
      ? (domains.find((d) => d.slug === lens.slug)?.meta.name ?? lens.slug)
      : null;

  function resetAdd(nextDate = `${year.year}-01-01`) {
    setTitle("");
    setNotes("");
    setDate(nextDate);
    setDomainValue(lensSlug(lens) ?? "");
    setGoalValue("");
    setError(null);
  }

  useEffect(() => {
    if (!seedDate || readOnly) return;
    resetAdd(seedDate);
    setAdding(true);
    onConsumedSeed();
  }, [seedDate, readOnly]);

  async function submitAdd() {
    const trimmed = title.trim();
    if (!trimmed || readOnly) return;
    setError(null);
    try {
      const result = await onCommand({
        type: "createEvent",
        year: year.year,
        title: trimmed,
        date,
        notes,
        domainSlug: domainValue === "" ? null : domainValue,
        goalId: goalValue === "" ? null : goalValue,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAdding(false);
      resetAdd();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply event");
    }
  }

  return (
    <aside className="event-panel">
      <div className="event-heading">
        <h3>{year.year} Events</h3>
        {!readOnly && !adding && (
          <button
            type="button"
            className="event-add"
            onClick={() => {
              resetAdd();
              setAdding(true);
            }}
          >
            Add event
          </button>
        )}
      </div>
      {adding && !readOnly && (
        <form
          className="event-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitAdd();
          }}
        >
          <label>
            Title
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="New event title"
            />
          </label>
          <label>
            Date
            <input
              type="date"
              value={date}
              min={`${year.year}-01-01`}
              max={`${year.year}-12-31`}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </label>
          <label>
            Domain
            <select
              value={domainValue}
              onChange={(e) => setDomainValue(e.target.value)}
            >
              <option value="">Unassigned</option>
              {addDomains.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Goal
            <select
              value={goalValue}
              onChange={(e) => setGoalValue(e.target.value)}
            >
              <option value="">None</option>
              {addGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <div className="paint-actions">
            <button type="submit" disabled={!title.trim()}>
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
      {visible.length === 0 && !adding ? (
        <p className="event-empty">
          {lens.kind === "overview"
            ? "No events this year."
            : `No events in ${domainName}.`}
        </p>
      ) : visible.length > 0 ? (
        <ul className="event-list">
          {visible.map((event) => (
            <li key={event.id}>
              <EventEditor
                year={year.year}
                event={event}
                readOnly={readOnly}
                goals={goals}
                domains={domains}
                onCommand={onCommand}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function EventEditor({
  year,
  event,
  readOnly,
  goals,
  domains,
  onCommand,
}: {
  year: number;
  event: MapEvent;
  readOnly: boolean;
  goals: Goal[];
  domains: DomainRecord[];
  onCommand: CommandHandler;
}) {
  const [title, setTitle] = useState(event.title);
  const [date, setDate] = useState(event.date);
  const [notes, setNotes] = useState(event.notes);
  const [domainValue, setDomainValue] = useState(event.domainSlug ?? "");
  const [goalValue, setGoalValue] = useState(event.goalId ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(event.title);
    setDate(event.date);
    setNotes(event.notes);
    setDomainValue(event.domainSlug ?? "");
    setGoalValue(event.goalId ?? "");
  }, [event.title, event.date, event.notes, event.domainSlug, event.goalId]);

  const pickerDomains = domainPickerOptions(domains, event.domainSlug);
  const pickerGoals = goalPickerOptions(goals, event.goalId);

  function revertPatch(patch: {
    title?: string;
    date?: string;
    notes?: string;
    domainSlug?: string | null;
    goalId?: string | null;
  }) {
    if (patch.title !== undefined) setTitle(event.title);
    if (patch.date !== undefined) setDate(event.date);
    if (patch.notes !== undefined) setNotes(event.notes);
    if (patch.domainSlug !== undefined) setDomainValue(event.domainSlug ?? "");
    if (patch.goalId !== undefined) setGoalValue(event.goalId ?? "");
  }

  async function commit(patch: {
    title?: string;
    date?: string;
    notes?: string;
    domainSlug?: string | null;
    goalId?: string | null;
  }) {
    setError(null);
    try {
      const result = await onCommand({ type: "updateEvent", year, id: event.id, ...patch });
      if (!result.ok) {
        revertPatch(patch);
        setError(result.error);
      }
    } catch (err) {
      revertPatch(patch);
      setError(err instanceof Error ? err.message : "Failed to apply event");
    }
  }

  return (
    <div className="event-editor">
      <label>
        Title
        <input
          value={title}
          disabled={readOnly}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const trimmed = title.trim();
            if (trimmed && trimmed !== event.title) void commit({ title: trimmed });
            else setTitle(event.title);
          }}
        />
      </label>
      <label>
        Date
        <input
          type="date"
          value={date}
          disabled={readOnly}
          min={`${year}-01-01`}
          max={`${year}-12-31`}
          onChange={(e) => setDate(e.target.value)}
          onBlur={() => {
            if (date !== event.date && date) void commit({ date });
          }}
        />
      </label>
      <label>
        Notes
        <textarea
          value={notes}
          disabled={readOnly}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== event.notes) void commit({ notes });
          }}
        />
      </label>
      <label>
        Domain
        <select
          value={domainValue}
          disabled={readOnly}
          onChange={(e) => {
            const next = e.target.value;
            setDomainValue(next);
            const slug = next === "" ? null : next;
            if (slug !== event.domainSlug) void commit({ domainSlug: slug });
          }}
        >
          <option value="">Unassigned</option>
          {pickerDomains.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Goal
        <select
          value={goalValue}
          disabled={readOnly}
          onChange={(e) => {
            const next = e.target.value;
            setGoalValue(next);
            const goalId = next === "" ? null : next;
            if (goalId === event.goalId) return;
            void commit({ goalId });
          }}
        >
          <option value="">None</option>
          {pickerGoals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="event-delete"
        disabled={readOnly}
        onClick={() => {
          void (async () => {
            setError(null);
            try {
              const result = await onCommand({ type: "deleteEvent", year, id: event.id });
              if (!result.ok) setError(result.error);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to apply event");
            }
          })();
        }}
      >
        Delete
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
