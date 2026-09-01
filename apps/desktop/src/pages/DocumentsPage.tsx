import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  lensSlug,
  recordVisibleMulti,
  type LibraryDocument,
} from "@lifequest/vault-core/pure";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function DocumentsPage() {
  const { snapshot, reloadGeneration } = useVault();
  const lens = useDomainLens();

  const [records, setRecords] = useState<LibraryDocument[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOriginalSlugs, setEditingOriginalSlugs] = useState<string[]>(
    [],
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [domainSlugs, setDomainSlugs] = useState<string[]>(() => {
    const slug = lensSlug(lens);
    return slug ? [slug] : [];
  });
  const tagsDirty = useRef(false);

  const liveDomains = useMemo(
    () =>
      (snapshot?.domains ?? [])
        .filter((d) => !d.meta.archivedAt)
        .slice()
        .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder),
    [snapshot],
  );

  const defaultSlugs = useCallback((): string[] => {
    const slug = lensSlug(lens);
    return slug ? [slug] : [];
  }, [lens]);

  const resetComposer = useCallback(() => {
    setEditingId(null);
    setEditingOriginalSlugs([]);
    setTitle("");
    setBody("");
    tagsDirty.current = false;
    setDomainSlugs(defaultSlugs());
  }, [defaultSlugs]);

  useEffect(() => {
    if (editingId) return;
    if (tagsDirty.current) return;
    setDomainSlugs(defaultSlugs());
  }, [defaultSlugs, editingId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api().libraryList();
      if (!result.ok) {
        setError(result.error);
        setRecords([]);
        setSkipped(0);
        return;
      }
      setRecords(result.value.records);
      setSkipped(result.value.skipped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadGeneration]);

  const visible = useMemo(
    () => records.filter((note) => recordVisibleMulti(lens, note.domainSlugs)),
    [records, lens],
  );

  function domainName(slug: string): string {
    return snapshot?.domains.find((d) => d.slug === slug)?.meta.name ?? slug;
  }

  const pickerDomains = useMemo(() => {
    const live = liveDomains.map((d) => ({
      slug: d.slug,
      name: d.meta.name,
    }));
    if (!editingId) return live;
    const seen = new Set(live.map((d) => d.slug));
    const extras: { slug: string; name: string }[] = [];
    for (const slug of editingOriginalSlugs) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      extras.push({
        slug,
        name:
          snapshot?.domains.find((d) => d.slug === slug)?.meta.name ?? slug,
      });
    }
    return [...live, ...extras];
  }, [liveDomains, editingId, editingOriginalSlugs, snapshot]);

  function toggleSlug(slug: string) {
    tagsDirty.current = true;
    setDomainSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  async function openEdit(id: string) {
    if (busy || id === editingId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api().libraryGet(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const note = result.value;
      setEditingId(note.id);
      setEditingOriginalSlugs(note.domainSlugs);
      setTitle(note.title);
      setBody(note.bodyMarkdown);
      setDomainSlugs(note.domainSlugs);
      tagsDirty.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open note");
    } finally {
      setBusy(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = editingId
        ? await api().libraryUpdate(editingId, {
            title: nextTitle,
            bodyMarkdown: body,
            domainSlugs,
          })
        : await api().libraryCreate({
            title: nextTitle,
            bodyMarkdown: body,
            domainSlugs,
          });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetComposer();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!editingId) return;
    if (
      !window.confirm("Delete this note? It will be hidden from the library.")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api().libraryDelete(editingId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetComposer();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="documents-page">
      <header className="documents-page__header">
        <h1 className="stub-page__title">Documents</h1>
        <p className="stub-page__desc muted">
          Markdown notes. Tag a domain, or leave unassigned to keep them in
          Overview only.
        </p>
      </header>

      <form className="library-composer" onSubmit={(e) => void onSave(e)}>
        <label className="field">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label className="field">
          Body
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
          />
        </label>
        <div className="field">
          <span>Domains</span>
          {pickerDomains.length === 0 ? (
            <p className="muted">
              No live domains. Leave unassigned to keep this note in Overview
              only.
            </p>
          ) : (
            <div className="library-tag-picker">
              {pickerDomains.map((d) => (
                <label key={d.slug}>
                  <input
                    type="checkbox"
                    checked={domainSlugs.includes(d.slug)}
                    onChange={() => toggleSlug(d.slug)}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="library-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !title.trim()}
          >
            {editingId ? "Save" : "Create"}
          </button>
          {editingId ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetComposer}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void onDelete()}
                disabled={busy}
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      </form>

      {skipped > 0 ? (
        <p className="form-error" role="status">
          {skipped} note file(s) could not be read.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading notes…</p>
      ) : records.length === 0 ? (
        <p className="muted">No notes yet. Create one above.</p>
      ) : visible.length === 0 ? (
        <p className="muted">
          No notes in this domain. Unassigned notes stay in Overview.
        </p>
      ) : (
        <ul className="library-list">
          {visible.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className={
                  editingId === note.id ? "doc-card is-selected" : "doc-card"
                }
                onClick={() => void openEdit(note.id)}
                disabled={busy}
              >
                <span className="doc-card__label">{note.title}</span>
                <div className="library-tags">
                  {note.domainSlugs.length === 0 ? (
                    <span className="library-tag">Unassigned</span>
                  ) : (
                    note.domainSlugs.map((slug) => (
                      <span key={slug} className="library-tag">
                        {domainName(slug)}
                      </span>
                    ))
                  )}
                </div>
                <time
                  className="muted library-row__when"
                  dateTime={note.updatedAt}
                >
                  {formatWhen(note.updatedAt)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
