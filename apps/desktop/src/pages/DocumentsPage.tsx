import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  DOCUMENT_KIND_LABELS,
  lensSlug,
  liveAreas,
  unlockedAreas,
  type DocumentKind,
  type LibraryDocument,
} from "@lifequest/vault-core/pure";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { WingEyebrow } from "@/components/shell/WingEyebrow";
import { useConfirm } from "@/components/ui/useConfirm";
import { createWikiResolver } from "@/lib/wiki-links";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { PageMenu } from "@/components/ui/PageMenu";
import { DocumentLockBadge } from "@/components/documents/DocumentLockBadge";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
import { ProposeChangeDialog } from "@/components/documents/ProposeChangeDialog";
import type { DocumentTarget } from "@lifequest/vault-core/pure";
import {
  buildDocumentTree,
  docKey,
  type DocRef,
  type DoctrineKind,
} from "./document-tree";

const AUTOSAVE_MS = 700;

/** The four doctrine files, in the order the rest of the app reads them. */
const DOCTRINE_KINDS: readonly DoctrineKind[] = ["premise", "what", "why", "how"];

type OpenDoc = {
  ref: DocRef;
  key: string;
  locked: boolean;
  /** The title the file already has. Doctrine saves pass it back unchanged. */
  storedTitle: string;
  originalSlugs: string[];
};

type Saved = { key: string; title: string; body: string; slugs: string };

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { records?: unknown }).records)
  ) {
    return (value as { records: T[] }).records;
  }
  return [];
}

function doctrineFiles(
  documents: Partial<Record<DocumentKind, unknown>> | null | undefined,
): { kind: DoctrineKind; title: string }[] {
  if (!documents) return [];
  return DOCTRINE_KINDS.flatMap((kind) =>
    documents[kind] ? [{ kind, title: DOCUMENT_KIND_LABELS[kind] }] : [],
  );
}

export default function DocumentsPage() {
  const { snapshot, reloadGeneration } = useVault();
  const lens = useDomainLens();
  const { ask, dialog } = useConfirm();

  const [notes, setNotes] = useState<LibraryDocument[]>([]);
  const [ideals, setIdeals] = useState<{ id: string; title: string }[]>([]);
  const [projects, setProjects] = useState<
    { id: string; title: string; domainSlug: string | null }[]
  >([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<OpenDoc | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [domainSlugs, setDomainSlugs] = useState<string[]>([]);
  const [proposeOpen, setProposeOpen] = useState(false);

  const openRef = useRef<OpenDoc | null>(null);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  const slugsRef = useRef(domainSlugs);
  const saved = useRef<Saved>({ key: "", title: "", body: "", slugs: "" });
  const generation = useRef(0);
  titleRef.current = title;
  bodyRef.current = body;
  slugsRef.current = domainSlugs;

  const liveDomains = useMemo(
    () => liveAreas(snapshot?.domains ?? []),
    [snapshot],
  );
  const pickerAreas = useMemo(
    () => unlockedAreas(snapshot?.domains ?? []),
    [snapshot],
  );

  const tree = useMemo(
    () =>
      buildDocumentTree({
        lens,
        query,
        notes: notes
          .filter((note) => note.deletedAt == null)
          .map((note) => ({
            id: note.id,
            title: note.title,
            domainSlugs: note.domainSlugs ?? [],
          })),
        ideals,
        projects,
        areas: liveDomains.map((area) => ({
          slug: area.slug,
          name: area.meta.name,
          documents: doctrineFiles(area.documents),
        })),
      }),
    [ideals, lens, liveDomains, notes, projects, query],
  );

  const resolveWiki = useMemo(
    () =>
      createWikiResolver({
        domains: liveDomains,
        notes: notes
          .filter((note) => note.deletedAt == null)
          .map((note) => ({ id: note.id, title: note.title })),
      }),
    [liveDomains, notes],
  );

  const loadLists = useCallback(async () => {
    const bridge = api();
    const [noteRes, idealRes, projectRes] = await Promise.all([
      bridge.libraryList(),
      bridge.idealStateList(),
      bridge.projectsList(),
    ]);
    if (noteRes.ok) {
      const value = noteRes.value as { records?: LibraryDocument[]; skipped?: number };
      setNotes(rows<LibraryDocument>(value));
      setSkipped(typeof value?.skipped === "number" ? value.skipped : 0);
    } else {
      setNotes([]);
      setError(noteRes.error);
    }
    if (idealRes.ok) {
      setIdeals(
        rows<{ id: string; title: string | null }>(idealRes.value)
          .filter((row) => row && typeof row.id === "string")
          .map((row) => ({ id: row.id, title: row.title?.trim() || "Untitled" })),
      );
    } else {
      setIdeals([]);
    }
    if (projectRes.ok) {
      setProjects(
        rows<{ id: string; title: string; domainSlug: string | null }>(projectRes.value)
          .filter((row) => row && typeof row.id === "string")
          .map((row) => ({
            id: row.id,
            title: row.title,
            domainSlug: row.domainSlug ?? null,
          })),
      );
    } else {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadLists()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load documents");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadLists, reloadGeneration]);

  const apply = useCallback((next: OpenDoc, nextTitle: string, nextBody: string, slugs: string[]) => {
    generation.current += 1;
    openRef.current = next;
    setOpen(next);
    setTitle(nextTitle);
    setBody(nextBody);
    setDomainSlugs(slugs);
    titleRef.current = nextTitle;
    bodyRef.current = nextBody;
    slugsRef.current = slugs;
    saved.current = {
      key: next.key,
      title: nextTitle,
      body: nextBody,
      slugs: slugs.join("\n"),
    };
  }, []);

  const clearOpen = useCallback(() => {
    generation.current += 1;
    openRef.current = null;
    setOpen(null);
    setTitle("");
    setBody("");
    setDomainSlugs([]);
    setProposeOpen(false);
    saved.current = { key: "", title: "", body: "", slugs: "" };
  }, []);

  const flush = useCallback(async () => {
    const current = openRef.current;
    if (!current || current.locked) return;
    const nextTitle = titleRef.current;
    const nextBody = bodyRef.current;
    const nextSlugs = slugsRef.current;
    const dirty =
      current.key !== saved.current.key ||
      nextTitle !== saved.current.title ||
      nextBody !== saved.current.body ||
      nextSlugs.join("\n") !== saved.current.slugs;
    if (!dirty) return;
    if (current.ref.kind !== "doctrine" && nextTitle.trim() === "") return;

    const ref = current.ref;
    let result: { ok: true } | { ok: false; error: string };
    if (ref.kind === "library") {
      result = await api().libraryUpdate(ref.id, {
        title: nextTitle.trim(),
        bodyMarkdown: nextBody,
        domainSlugs: nextSlugs,
      });
    } else if (ref.kind === "ideal") {
      result = await api().idealStateUpdate(ref.id, {
        title: nextTitle.trim(),
        bodyMarkdown: nextBody,
      });
    } else if (ref.kind === "project") {
      result = await api().projectsUpdate(ref.id, {
        title: nextTitle.trim(),
        bodyMarkdown: nextBody,
      });
    } else {
      result = await api().documentSave(
        ref.slug,
        ref.documentKind,
        nextBody,
        current.storedTitle,
      );
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (openRef.current?.key === current.key) {
      const stored = ref.kind === "doctrine" ? nextTitle : nextTitle.trim();
      saved.current = {
        key: current.key,
        title: stored,
        body: nextBody,
        slugs: nextSlugs.join("\n"),
      };
      if (stored !== nextTitle) {
        setTitle(stored);
        titleRef.current = stored;
      }
    }
    await loadLists();
  }, [loadLists]);

  useEffect(() => {
    const current = openRef.current;
    if (!current || current.locked) return;
    const dirty =
      title !== saved.current.title ||
      body !== saved.current.body ||
      domainSlugs.join("\n") !== saved.current.slugs;
    if (!dirty) return;
    if (current.ref.kind !== "doctrine" && title.trim() === "") return;
    const timer = window.setTimeout(() => {
      void flush();
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [body, domainSlugs, flush, title]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  const select = useCallback(
    async (ref: DocRef) => {
      const key = docKey(ref);
      if (openRef.current?.key === key) return;
      await flush();
      const token = ++generation.current;
      setError(null);
      try {
        if (ref.kind === "library") {
          const result = await api().libraryGet(ref.id);
          if (token !== generation.current) return;
          if (!result.ok) {
            setError(result.error);
            return;
          }
          const note = result.value;
          apply(
            {
              ref,
              key,
              locked: note.locked,
              storedTitle: note.title,
              originalSlugs: note.domainSlugs ?? [],
            },
            note.title,
            note.bodyMarkdown,
            note.domainSlugs ?? [],
          );
          return;
        }
        if (ref.kind === "ideal") {
          const result = await api().idealStateGet(ref.id);
          if (token !== generation.current) return;
          if (!result.ok) {
            setError(result.error);
            return;
          }
          apply(
            { ref, key, locked: false, storedTitle: result.value.title, originalSlugs: [] },
            result.value.title,
            result.value.bodyMarkdown,
            [],
          );
          return;
        }
        if (ref.kind === "project") {
          const result = await api().projectsGet(ref.id);
          if (token !== generation.current) return;
          if (!result.ok) {
            setError(result.error);
            return;
          }
          apply(
            { ref, key, locked: false, storedTitle: result.value.title, originalSlugs: [] },
            result.value.title,
            result.value.bodyMarkdown ?? "",
            [],
          );
          return;
        }
        const result = await api().documentGet(ref.slug, ref.documentKind);
        if (token !== generation.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        apply(
          {
            ref,
            key,
            locked: result.value.locked,
            storedTitle: result.value.title,
            originalSlugs: [],
          },
          DOCUMENT_KIND_LABELS[ref.documentKind],
          result.value.bodyMarkdown,
          [],
        );
      } catch (err) {
        if (token !== generation.current) return;
        setError(err instanceof Error ? err.message : "Failed to open document");
      }
    },
    [apply, flush],
  );

  async function createNote() {
    await flush();
    setError(null);
    setBusy(true);
    try {
      const slug = lensSlug(lens);
      const result = await api().libraryCreate({
        title: "Untitled",
        bodyMarkdown: "",
        domainSlugs: slug ? [slug] : [],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const note = result.value;
      const ref: DocRef = { kind: "library", id: note.id };
      apply(
        {
          ref,
          key: docKey(ref),
          locked: note.locked,
          storedTitle: note.title,
          originalSlugs: note.domainSlugs ?? [],
        },
        note.title,
        note.bodyMarkdown,
        note.domainSlugs ?? [],
      );
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create note");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock() {
    const current = openRef.current;
    if (!current || busy) return;
    if (!current.locked) await flush();
    setBusy(true);
    setError(null);
    try {
      const nextLocked = !current.locked;
      if (current.ref.kind === "library") {
        const result = await api().librarySetLocked(current.ref.id, nextLocked);
        if (!result.ok) {
          setError(result.error);
          return;
        }
      } else if (current.ref.kind === "doctrine") {
        const result = await api().documentSetLocked(
          current.ref.slug,
          current.ref.documentKind,
          nextLocked,
        );
        if (!result.ok) {
          setError(result.error);
          return;
        }
      } else {
        return;
      }
      const updated = { ...current, locked: nextLocked };
      openRef.current = updated;
      setOpen(updated);
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update the lock");
    } finally {
      setBusy(false);
    }
  }

  function deleteOpen() {
    const current = openRef.current;
    if (!current || busy) return;
    if (current.ref.kind !== "library" && current.ref.kind !== "ideal") return;
    const ref = current.ref;
    const library = ref.kind === "library";
    ask({
      title: library ? "Delete note" : "Delete document",
      message: library
        ? "The note is hidden from the library. Its file stays in the vault."
        : "This Ideal State document is removed.",
      confirmLabel: library ? "Delete note" : "Delete document",
      destructive: true,
      run: () => {
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            const result = library
              ? await api().libraryDelete(ref.id)
              : await api().idealStateDelete(ref.id);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            clearOpen();
            await loadLists();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete");
          } finally {
            setBusy(false);
          }
        })();
      },
    });
  }

  function onEditorClick(event: ReactMouseEvent) {
    const anchor = (event.target as HTMLElement).closest("a[href]");
    if (!anchor) return;
    const libraryId = anchor.getAttribute("data-library-id");
    if (libraryId) {
      event.preventDefault();
      void select({ kind: "library", id: libraryId });
      return;
    }
    const href = anchor.getAttribute("href") ?? "";
    const match = href.match(
      /^#\/(?:dream|vision|blueprints)\/([^/]+)\/(premise|what|why|how)$/,
    );
    if (!match) return;
    event.preventDefault();
    void select({
      kind: "doctrine",
      slug: decodeURIComponent(match[1]!),
      documentKind: match[2] as DoctrineKind,
    });
  }

  const locked = open?.locked ?? false;
  const titleReadOnly = locked || open?.ref.kind === "doctrine";
  const showMenu = open?.ref.kind === "library" || open?.ref.kind === "doctrine";
  const showDelete = open?.ref.kind === "library" || open?.ref.kind === "ideal";
  const menuLabel = open?.ref.kind === "library" ? "Note actions" : "Document actions";
  const lockLabel = locked
    ? open?.ref.kind === "library"
      ? "Unlock this note"
      : "Unlock this document"
    : open?.ref.kind === "library"
      ? "Lock this note"
      : "Lock this document";

  const picker = useMemo(() => {
    const extras = (open?.originalSlugs ?? []).filter(
      (slug) => !pickerAreas.some((area) => area.slug === slug),
    );
    return [
      ...pickerAreas,
      ...extras.flatMap((slug) => {
        const area = snapshot?.domains.find((domain) => domain.slug === slug);
        return area ? [area] : [];
      }),
    ];
  }, [open?.originalSlugs, pickerAreas, snapshot?.domains]);

  const proposeTarget: DocumentTarget | null =
    open?.ref.kind === "library"
      ? { type: "library", id: open.ref.id }
      : open?.ref.kind === "doctrine"
        ? { type: "doctrine", domainSlug: open.ref.slug, kind: open.ref.documentKind }
        : null;

  const mediaSlug =
    open?.ref.kind === "doctrine" ? open.ref.slug : domainSlugs[0] || "life";

  const emptyLibrary =
    !loading &&
    notes.filter((note) => note.deletedAt == null).length === 0 &&
    ideals.length === 0 &&
    projects.length === 0 &&
    tree.length === 0;

  return (
    <div className="documents-page">
      <header className="documents-page__header">
        <div className="documents-page__intro">
          <WingEyebrow page="Documents" />
          <h1 className="stub-page__title">Documents</h1>
          <p className="stub-page__desc muted">
            Notes, Ideal State, projects, and doctrine. One file, edited here.
          </p>
        </div>
        {showMenu && open ? (
          <div className="page-corner" data-testid="documents-page-corner">
            <DocumentLockBadge locked={locked} />
            <PageMenu
              label={menuLabel}
              testId="note-page-menu"
              lock={{
                testId: "note-lock-toggle",
                locked,
                busy,
                label: lockLabel,
                onToggle: () => void toggleLock(),
              }}
              actions={[
                ...(locked && proposeTarget
                  ? [
                      {
                        testId: "note-propose",
                        label: "Propose change",
                        onSelect: () => setProposeOpen(true),
                      },
                    ]
                  : []),
                ...(open.ref.kind === "library"
                  ? [
                      {
                        testId: "note-delete",
                        label: "Delete note",
                        danger: true,
                        disabled: busy,
                        onSelect: () => void deleteOpen(),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ) : null}
      </header>

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
      {emptyLibrary ? (
        <p className="muted">No notes yet. Create one with +.</p>
      ) : null}

      <div className="documents-page__split">
        <aside className="doc-tree" aria-label="Documents">
          <div className="doc-tree__bar">
            <input
              className="doc-tree__query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter"
              aria-label="Filter documents"
            />
            <button
              type="button"
              className="btn btn-primary doc-tree__new"
              onClick={() => void createNote()}
              disabled={busy}
              aria-label="New note"
            >
              +
            </button>
          </div>
          {loading ? (
            <p className="muted doc-tree__empty">Loading notes…</p>
          ) : tree.length === 0 ? (
            <p className="muted doc-tree__empty">
              {notes.length === 0
                ? "No notes yet."
                : "No notes in this area. Unassigned notes stay in Life."}
            </p>
          ) : (
            tree.map((group) => (
              <section key={group.id} className="doc-tree__group">
                <h2 className="doc-tree__label">{group.label}</h2>
                {group.files.length > 0 ? (
                  <div className="doc-tree__files">
                    {group.files.map((file) => (
                      <button
                        key={file.key}
                        type="button"
                        className={
                          open?.key === file.key
                            ? "doc-tree__file is-selected"
                            : "doc-tree__file"
                        }
                        data-kind={file.ref.kind}
                        onClick={() => void select(file.ref)}
                      >
                        {file.title}
                      </button>
                    ))}
                  </div>
                ) : (
                  group.areas.map((area) => (
                    <div key={area.slug} className="doc-tree__area">
                      <p className="doc-tree__area-name">{area.name}</p>
                      <div className="doc-tree__files">
                        {area.files.map((file) => (
                          <button
                            key={file.key}
                            type="button"
                            className={
                              open?.key === file.key
                                ? "doc-tree__file is-selected"
                                : "doc-tree__file"
                            }
                            data-kind={file.ref.kind}
                            onClick={() => void select(file.ref)}
                          >
                            {file.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </section>
            ))
          )}
        </aside>

        <div className="doc-editor" onClick={onEditorClick}>
          {open ? (
            <>
              <input
                className="doc-editor__title"
                value={title}
                readOnly={titleReadOnly}
                aria-label="Title"
                onChange={(event) => setTitle(event.target.value)}
              />
              {open.ref.kind === "library" ? (
                <fieldset className="library-tag-picker" disabled={locked}>
                  <legend className="muted">Areas</legend>
                  {picker.length === 0 ? (
                    <span className="muted">
                      No live areas. Leave unassigned to keep this note in Life.
                    </span>
                  ) : (
                    picker.map((area) => (
                      <label key={area.slug}>
                        <input
                          type="checkbox"
                          checked={domainSlugs.includes(area.slug)}
                          disabled={locked}
                          onChange={(event) => {
                            setDomainSlugs((current) =>
                              event.target.checked
                                ? [...current, area.slug]
                                : current.filter((slug) => slug !== area.slug),
                            );
                          }}
                        />
                        {area.meta.name}
                      </label>
                    ))
                  )}
                </fieldset>
              ) : null}
              {locked ? (
                <p className="muted library-lock-hint">Unlock to edit, or propose a change.</p>
              ) : null}
              <div
                data-testid="doc-editor"
                data-readonly={locked ? "true" : "false"}
              >
                <LiveMarkdownEditor
                  key={open.key}
                  value={body}
                  onChange={setBody}
                  slug={mediaSlug}
                  ariaLabel="Document"
                  readOnly={locked}
                  resolveWiki={resolveWiki}
                />
              </div>
              {showDelete && open.ref.kind === "ideal" ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void deleteOpen()}
                >
                  Delete document
                </button>
              ) : null}
            </>
          ) : (
            <p className="muted doc-editor__blank">Choose a file, or start a note.</p>
          )}
        </div>
      </div>

      {proposeTarget ? (
        <ProposeChangeDialog
          open={proposeOpen}
          target={proposeTarget}
          currentTitle={open?.ref.kind === "doctrine" ? open.storedTitle : title}
          currentBody={body}
          onClose={() => setProposeOpen(false)}
          onSubmitted={() => setProposeOpen(false)}
        />
      ) : null}
      {dialog}
    </div>
  );
}
