import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  SignalRecord,
  SignalUpdatePatch,
} from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/ipc";
import { formatSignalWhen, signalDomainLabel } from "@/lib/signal-chain";
import { useVault } from "@/state/VaultProvider";

function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (e.repeat) return;
  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
}

export function SignalChainFeed() {
  const { snapshot } = useVault();
  const liveDomains = (snapshot?.domains ?? []).filter((d) => !d.meta.archivedAt);
  const allDomains = (snapshot?.domains ?? []).map((d) => ({
    slug: d.slug,
    name: d.meta.name,
  }));

  const [records, setRecords] = useState<SignalRecord[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const [domainSlug, setDomainSlug] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
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
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainCreate({
        type: "thought",
        title: null,
        body,
        domainSlug: domainSlug.trim() ? domainSlug : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      setEditingId(null);
      await load({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add signal");
    } finally {
      busyRef.current = false;
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
      await load({ quiet: true });
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
      await load({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete signal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signal-chain">
      <header className="signal-chain__header">
        <h1 className="stub-page__title">Life-Chain</h1>
        <p className="stub-page__desc muted">
          A database of what you notice. Log now; assign later.
        </p>
      </header>

      <form className="signal-chain__composer" onSubmit={onAdd}>
        <textarea
          aria-label="Log a signal"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder="What's on your mind?"
          rows={6}
          required
          autoFocus
        />
        <div className="signal-chain__composer-footer">
          <label className="field">
            Domain
            <select
              value={domainSlug}
              onChange={(e) => setDomainSlug(e.target.value)}
            >
              <option value="">General</option>
              {liveDomains.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.meta.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="ghost" disabled={busy || !body.trim()}>
            Log
          </Button>
        </div>
        <p className="signal-chain__hint">
          <kbd>Enter</kbd> to log · <kbd>Shift+Enter</kbd> for a new line
        </p>
      </form>

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
          Nothing on the chain yet. Write something above.
        </p>
      ) : (
        <ul className="signal-chain__list">
          {records.map((item) => (
            <SignalRow
              key={item.id}
              signal={item}
              domainLabel={signalDomainLabel(item.domainSlug, allDomains)}
              liveDomains={liveDomains.map((d) => ({
                slug: d.slug,
                name: d.meta.name,
              }))}
              allDomains={allDomains}
              editing={editingId === item.id}
              busy={busy}
              onEdit={() => setEditingId(item.id)}
              onCancel={() => setEditingId(null)}
              onSave={onSave}
              onDelete={() => void onDelete(item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SignalRow(props: {
  signal: SignalRecord;
  domainLabel: string;
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
  const [domainSlug, setDomainSlug] = useState(s.domainSlug ?? "");
  const [body, setBody] = useState(s.body);

  useEffect(() => {
    if (!props.editing) return;
    setDomainSlug(s.domainSlug ?? "");
    setBody(s.body);
  }, [props.editing, s]);

  const domainOptions = props.liveDomains.slice();
  if (s.domainSlug && !domainOptions.some((d) => d.slug === s.domainSlug)) {
    const archived = props.allDomains.find((d) => d.slug === s.domainSlug);
    domainOptions.push({
      slug: s.domainSlug,
      name: archived?.name ?? s.domainSlug,
    });
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Escape") return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    props.onCancel();
  }

  if (props.editing) {
    return (
      <li className="signal-row signal-row--editing">
        <form
          className="signal-row__form"
          onSubmit={(e) => {
            e.preventDefault();
            void props.onSave(s.id, {
              body,
              domainSlug: domainSlug.trim() ? domainSlug : null,
            });
          }}
          onKeyDown={onEditKeyDown}
        >
          <span className="muted signal-row__when">
            {formatSignalWhen(s.createdAt)}
          </span>
          <label className="field">
            Signal
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              required
            />
          </label>
          <label className="field">
            Domain
            <select
              value={domainSlug}
              onChange={(e) => setDomainSlug(e.target.value)}
            >
              <option value="">General</option>
              {domainOptions.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="signal-row__actions">
            <Button
              type="submit"
              variant="ghost"
              disabled={props.busy || !body.trim()}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={props.onCancel}
              disabled={props.busy}
            >
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="signal-row">
      <div className="signal-row__content">
        <p className="signal-row__body">{s.body}</p>
        {s.title ? <h3 className="signal-row__title">{s.title}</h3> : null}
      </div>
      <time className="signal-row__when muted" dateTime={s.createdAt}>
        {formatSignalWhen(s.createdAt)}
      </time>
      <span className="signal-row__domain muted">{props.domainLabel}</span>
      <div className="signal-row__actions">
        <Button
          type="button"
          variant="ghost"
          onClick={props.onEdit}
          disabled={props.busy}
        >
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={props.onDelete}
          disabled={props.busy}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
