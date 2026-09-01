import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SIGNAL_TYPES,
  lensSlug,
  recordVisible,
  type SignalRecord,
  type SignalType,
  type SignalUpdatePatch,
} from "@lifequest/vault-core/pure";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { api } from "@/lib/ipc";
import {
  filterSignals,
  formatSignalTime,
  groupSignalsByDay,
  type SignalFilters,
} from "@/lib/signal-chain";
import { useVault } from "@/state/VaultProvider";

const TYPE_LABEL: Record<SignalType, string> = {
  thought: "Thought",
  idea: "Idea",
  notice: "Notice",
  other: "Other",
};

export function SignalChainFeed() {
  const { snapshot } = useVault();
  const lens = useDomainLens();
  const liveDomains = (snapshot?.domains ?? []).filter((d) => !d.meta.archivedAt);

  const [records, setRecords] = useState<SignalRecord[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState<SignalType>("thought");
  const [domainSlug, setDomainSlug] = useState(lensSlug(lens) ?? "");
  const domainDirty = useRef(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const [filterType, setFilterType] = useState<SignalFilters["type"]>("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (domainDirty.current) return;
    setDomainSlug(lensSlug(lens) ?? "");
  }, [lens]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api().signalChainList();
      if (!result.ok) {
        setError(result.error);
        setRecords([]);
        setSkipped(0);
        return;
      }
      setRecords(result.value.records);
      setSkipped(result.value.skipped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chain");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const scoped = records.filter((r) => recordVisible(lens, r.domainSlug));
    return filterSignals(scoped, { type: filterType, domainSlug: "all", query });
  }, [records, filterType, query, lens]);
  const groups = useMemo(() => groupSignalsByDay(visible), [visible]);

  function domainName(slug: string | null): string | null {
    if (!slug) return null;
    const match = snapshot?.domains.find((d) => d.slug === slug);
    return match?.meta.name ?? slug;
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainCreate({
        type,
        body,
        title: title.trim() ? title : null,
        domainSlug: domainSlug.trim() ? domainSlug : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle("");
      setBody("");
      setEditingId(null);
      domainDirty.current = false;
      setDomainSlug(lensSlug(lens) ?? "");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add signal");
    } finally {
      setBusy(false);
    }
  }

  async function onSave(id: string, patch: SignalUpdatePatch) {
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainUpdate(id, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update signal");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (
      !window.confirm("Delete this signal? It will be hidden from the chain.")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainDelete(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (editingId === id) setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete signal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signal-chain">
      <header className="signal-chain__header">
        <h1 className="stub-page__title">Life Signal Chain</h1>
        <p className="stub-page__desc muted">
          Dump thoughts, ideas, and things you notice.
        </p>
      </header>

      <form className="signal-chain__composer" onSubmit={onAdd}>
        <label className="field">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SignalType)}
          >
            {SIGNAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Domain
          <select
            value={domainSlug}
            onChange={(e) => {
              domainDirty.current = true;
              setDomainSlug(e.target.value);
            }}
          >
            <option value="">Unassigned</option>
            {liveDomains.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.meta.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field signal-chain__title-field">
          Title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="field signal-chain__body-field">
          Signal
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            required
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !body.trim()}
        >
          Add
        </button>
      </form>

      <div className="signal-chain__filters">
        <label className="field">
          Type
          <select
            value={filterType}
            onChange={(e) =>
              setFilterType(e.target.value as SignalFilters["type"])
            }
          >
            <option value="all">All</option>
            {SIGNAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field signal-chain__search">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title or text"
          />
        </label>
      </div>

      {skipped > 0 ? (
        <p className="form-error" role="status">
          {skipped} signal file(s) could not be read.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading chain…</p>
      ) : records.length === 0 ? (
        <p className="muted signal-chain__empty">
          Nothing on the chain yet. Add a signal above.
        </p>
      ) : visible.length === 0 ? (
        <p className="muted signal-chain__empty">
          No signals match these filters.
        </p>
      ) : (
        <div className="signal-chain__timeline">
          {groups.map((group) => (
            <section key={group.dayKey} className="signal-chain__day">
              <h2 className="signal-chain__day-header">{group.label}</h2>
              <ul className="signal-chain__list">
                {group.items.map((item) => (
                  <SignalRow
                    key={item.id}
                    signal={item}
                    domainName={domainName(item.domainSlug)}
                    liveDomains={liveDomains.map((d) => ({
                      slug: d.slug,
                      name: d.meta.name,
                    }))}
                    allDomains={(snapshot?.domains ?? []).map((d) => ({
                      slug: d.slug,
                      name: d.meta.name,
                    }))}
                    editing={editingId === item.id}
                    busy={busy}
                    onEdit={() => setEditingId(item.id)}
                    onCancel={() => setEditingId(null)}
                    onSave={onSave}
                    onDelete={() => void onDelete(item.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SignalRow(props: {
  signal: SignalRecord;
  domainName: string | null;
  liveDomains: { slug: string; name: string }[];
  allDomains: { slug: string; name: string }[];
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (id: string, patch: SignalUpdatePatch) => Promise<void>;
  onDelete: () => void;
}) {
  const s = props.signal;
  const [type, setType] = useState<SignalType>(s.type);
  const [domainSlug, setDomainSlug] = useState(s.domainSlug ?? "");
  const [title, setTitle] = useState(s.title ?? "");
  const [body, setBody] = useState(s.body);

  useEffect(() => {
    if (!props.editing) return;
    setType(s.type);
    setDomainSlug(s.domainSlug ?? "");
    setTitle(s.title ?? "");
    setBody(s.body);
  }, [props.editing, s]);

  const domainOptions = props.liveDomains.slice();
  if (
    s.domainSlug &&
    !domainOptions.some((d) => d.slug === s.domainSlug)
  ) {
    const archived = props.allDomains.find((d) => d.slug === s.domainSlug);
    domainOptions.push({
      slug: s.domainSlug,
      name: archived?.name ?? s.domainSlug,
    });
  }

  if (props.editing) {
    return (
      <li className="signal-row signal-row--editing">
        <form
          className="signal-row__form"
          onSubmit={(e) => {
            e.preventDefault();
            void props.onSave(s.id, {
              type,
              body,
              title: title.trim() ? title : null,
              domainSlug: domainSlug.trim() ? domainSlug : null,
            });
          }}
        >
          <span className="muted signal-row__when">
            {formatSignalTime(s.createdAt)}
          </span>
          <label className="field">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value as SignalType)}
            >
              {SIGNAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Domain
            <select
              value={domainSlug}
              onChange={(e) => setDomainSlug(e.target.value)}
            >
              <option value="">None</option>
              {domainOptions.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Signal
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              required
            />
          </label>
          <div className="signal-row__actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={props.busy || !body.trim()}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={props.onCancel}
              disabled={props.busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="signal-row">
      <time
        className="signal-row__when muted"
        dateTime={s.createdAt}
      >
        {formatSignalTime(s.createdAt)}
      </time>
      <span className="signal-row__type">{TYPE_LABEL[s.type]}</span>
      {props.domainName ? (
        <span className="signal-row__domain muted">{props.domainName}</span>
      ) : (
        <span className="signal-row__domain muted">No domain</span>
      )}
      <div className="signal-row__content">
        {s.title ? <h3 className="signal-row__title">{s.title}</h3> : null}
        <p className="signal-row__body">{s.body}</p>
      </div>
      <div className="signal-row__actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={props.onEdit}
          disabled={props.busy}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={props.onDelete}
          disabled={props.busy}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
