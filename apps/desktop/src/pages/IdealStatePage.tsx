import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
import { useConfirm } from "@/components/ui/useConfirm";
import { asHeld, sameNote } from "@/lib/note-body";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import type {
  IdealStateDocument,
  IdealStateIndexEntry,
} from "@lifequest/vault-core";

/** How long the page waits after the last keystroke before it writes. */
const AUTOSAVE_DELAY_MS = 700;

/**
 * What a write came to.
 *
 * `refused` and `failed` are not the same thing: the vault refusing a title or
 * body is an *answer* — it will never store this one, and the file is untouched
 * — so there is nothing left on screen worth holding the operator for. A write
 * that failed is not an answer: nobody knows what is on disk, so the document is
 * held and the operator is not moved off it.
 */
type WriteOutcome = "saved" | "refused" | "failed";

/**
 * A draft on screen, tagged with the document it belongs to.
 *
 * `id` is null until the first write of a brand-new document invents one. `key`
 * identifies the *draft* rather than the file, so a write that was sent before
 * the document existed can still be told apart from one for a document the
 * operator has since opened.
 */
type Draft = {
  key: number;
  id: string | null;
  title: string;
  body: string;
};

/** When a document was last written, for the list's own column. */
function formatEditedAt(updatedAt: string | null): string {
  if (!updatedAt) return "—";
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Two spellings of one title: the page and the file both trim its ends. */
function sameTitle(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/**
 * Ideal State — the operator's own documents about the life they are reaching
 * for, under Define.
 *
 * It is laid out like the Daily Note page because it is the same act: a single
 * column of prose, an autosave line, and a strip of what has been written
 * beside or below it. The difference is identity. A day is one note because the
 * date is the note; an ideal state is whatever the operator names it, and there
 * may be as many as they think of. So the title is part of the editor, the strip
 * lists titles instead of dates, and a new document is created by giving it a
 * title rather than by choosing a day.
 *
 * There is no save control. The page writes shortly after the operator stops
 * typing, when the pointer leaves the compose area, and when the document is
 * left. Ctrl/Cmd+S is the same write for the operator who asks anyway. The
 * status line is the whole contract: "Give this document a title" before a new
 * one can exist, "Saving…" while a draft is on its way, "Saved" when the vault
 * holds it, and the vault's own reason when it refuses.
 *
 * The body is written in the same box as every other note in the studio:
 * `LiveMarkdownEditor` renders it as prose and opens the paragraph under the
 * caret as its own markdown. The title is a plain field above it.
 *
 * A document may be titled before it has words — that is how a thought starts —
 * so an empty body is allowed. A title may not be empty: without one there is
 * nothing to find the document by and nothing for the list to say. A blank title
 * on an existing document therefore saves its body under the title the file
 * already has, and the status line asks for the title rather than dropping the
 * prose.
 */
export default function IdealStatePage() {
  const { snapshot } = useVault();
  const { ask, dialog } = useConfirm();

  const [documents, setDocuments] = useState<IdealStateIndexEntry[]>([]);
  /** The document in the editor; null while a new, unwritten document is open. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [body, setBody] = useState("");
  const [savedBody, setSavedBody] = useState("");
  /** Whether the editor's contents are loaded enough to autosave them. */
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The last draft the vault refused, so the page stops asking by itself. */
  const [refused, setRefused] = useState<Draft | null>(null);
  /** Bumped when a new draft should take the caret in its title field. */
  const [focusTitleTick, setFocusTitleTick] = useState(0);

  const titleRef = useRef<HTMLInputElement | null>(null);
  // A read for a document the operator has already left must not land.
  const loadToken = useRef(0);
  // Writes go through here one at a time, in the order the page asked for them.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The newest draft that still has to reach the vault. Held in a ref because a
  // blur or an unmount flushes it outside any render.
  const unsaved = useRef<Draft | null>(null);
  // The document the box currently belongs to. `id` turns non-null the moment a
  // new document is created, before React has re-rendered with its list row.
  const active = useRef<{ key: number; id: string | null }>({
    key: 0,
    id: null,
  });
  const draftKey = useRef(0);

  const loadDocuments = useCallback(async (): Promise<IdealStateIndexEntry[]> => {
    try {
      const result = await api().idealStateList();
      if (!result.ok) {
        setError(result.error);
        return [];
      }
      setDocuments(result.value);
      return result.value;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }, []);

  /** Open a brand-new, unwritten document and put the caret in its title. */
  const openNewDraft = useCallback(() => {
    const key = ++draftKey.current;
    active.current = { key, id: null };
    loadToken.current += 1;
    unsaved.current = null;
    setSelectedId(null);
    setTitle("");
    setSavedTitle("");
    setBody("");
    setSavedBody("");
    setRefused(null);
    setError(null);
    setLoaded(true);
    setLoading(false);
    setFocusTitleTick((tick) => tick + 1);
  }, []);

  const loadDocument = useCallback(async (id: string) => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    setRefused(null);
    unsaved.current = null;
    try {
      const result = await api().idealStateGet(id);
      if (token !== loadToken.current) return;
      if (!result.ok) {
        setError(result.error);
        setLoaded(true);
        return;
      }
      const document: IdealStateDocument = result.value;
      const key = ++draftKey.current;
      active.current = { key, id };
      unsaved.current = null;
      const held = asHeld(document.bodyMarkdown);
      setSelectedId(id);
      setTitle(document.title);
      setSavedTitle(document.title);
      setBody(held);
      setSavedBody(held);
      setLoaded(true);
    } catch (err) {
      if (token !== loadToken.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);

  // The page lands on the newest document; a page with none opens the first
  // empty one, so the page is always ready to be written in.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listed = await loadDocuments();
      if (cancelled) return;
      const first = listed.find((entry) => !entry.error);
      if (first) await loadDocument(first.id);
      else openNewDraft();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDocuments, loadDocument, openNewDraft]);

  useEffect(() => {
    if (focusTitleTick > 0) titleRef.current?.focus();
  }, [focusTitleTick]);

  /**
   * Remember the newest draft that differs from the file, or forget it.
   *
   * Called from the change handlers as well as from the effect below: a blur can
   * beat the next render, and the page must not let a keystroke slip past a
   * flush that was asked for in the same moment.
   */
  const recordDraft = useCallback(
    (nextTitle: string, nextBody: string) => {
      if (!loaded) {
        unsaved.current = null;
        return;
      }
      const current = active.current;
      const titleDirty = !sameTitle(nextTitle, savedTitle);
      const bodyDirty = !sameNote(nextBody, savedBody);
      if (!titleDirty && !bodyDirty) {
        unsaved.current = null;
        return;
      }
      // A new document cannot exist without a title; an existing one whose title
      // was cleared still has a file and a title, and only its body can move.
      if (current.id === null && nextTitle.trim() === "") {
        unsaved.current = null;
        return;
      }
      if (current.id !== null && nextTitle.trim() === "" && !bodyDirty) {
        unsaved.current = null;
        return;
      }
      unsaved.current = {
        key: current.key,
        id: current.id,
        title: nextTitle,
        body: nextBody,
      };
    },
    [loaded, savedBody, savedTitle],
  );

  const onTitleChange = useCallback(
    (next: string) => {
      setTitle(next);
      setError(null);
      recordDraft(next, body);
    },
    [body, recordDraft],
  );

  const onBodyChange = useCallback(
    (next: string) => {
      setBody(next);
      setError(null);
      recordDraft(title, next);
    },
    [recordDraft, title],
  );

  const writeDraft = useCallback(
    async (draft: Draft): Promise<WriteOutcome> => {
      const run = async (): Promise<WriteOutcome> => {
        setSaving(true);
        try {
          if (draft.id === null) {
            const result = await api().idealStateCreate({
              title: draft.title.trim(),
              bodyMarkdown: draft.body,
            });
            if (!result.ok) {
              setError(result.error);
              setRefused(draft);
              return "refused";
            }
            const created = result.value;
            // The id exists now, even though the list has not been read back. A
            // keystroke that landed during this write already belongs to this
            // document, and the next write must edit it rather than create a
            // second one.
            active.current = { key: draft.key, id: created.id };
            setSelectedId(created.id);
            setSavedTitle(created.title);
            setSavedBody(asHeld(created.bodyMarkdown));
            setError(null);
            setRefused(null);
            await loadDocuments();
            return "saved";
          }

          // A cleared title is not a title the vault may store. The body still
          // reaches the file under the title it already has; the status line asks
          // for the title the operator is in the middle of replacing.
          const result = await api().idealStateUpdate(
            draft.id,
            draft.title.trim() === ""
              ? { bodyMarkdown: draft.body }
              : { title: draft.title, bodyMarkdown: draft.body },
          );
          if (!result.ok) {
            setError(result.error);
            setRefused(draft);
            return "refused";
          }
          const written = result.value;
          const writtenBody = asHeld(written.bodyMarkdown);
          setSavedTitle(written.title);
          setSavedBody(writtenBody);
          // The file is the truth, and the box takes the body the vault actually
          // holds back only when the two really are different notes. Handing the
          // answer back on every ordinary write would re-cut the paragraph under
          // the caret and close the writing line mid-sentence.
          setBody((current) =>
            sameNote(current, draft.body) && !sameNote(current, writtenBody)
              ? writtenBody
              : current,
          );
          setError(null);
          setRefused(null);
          await loadDocuments();
          return "saved";
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setRefused(draft);
          return "failed";
        } finally {
          setSaving(false);
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    [loadDocuments],
  );

  /**
   * Write whatever is pending right now. The debounce, the blur, Ctrl+S and
   * leaving the document all land here. A body the vault refused stays pending
   * so the operator can ask again rather than lose it.
   */
  const flush = useCallback(async (): Promise<WriteOutcome> => {
    await queue.current;
    const pending = unsaved.current;
    if (!pending) return "saved";
    // A new draft may have gained an id since its write was queued. Resolve it
    // now, so the queued write edits the document it belongs to.
    const id =
      pending.id ??
      (active.current.key === pending.key ? active.current.id : null);
    const draft: Draft = { ...pending, id };
    if (id === null && draft.title.trim() === "") return "saved";
    unsaved.current = null;
    const outcome = await writeDraft(draft);
    if (outcome !== "saved") unsaved.current = pending;
    return outcome;
  }, [writeDraft]);

  /**
   * The autosave itself. A body the vault has already refused is left pending
   * but not rescheduled — the page does not hammer the vault with an answer it
   * has.
   */
  useEffect(() => {
    if (!loaded) return;
    const current = active.current;
    const titleDirty = !sameTitle(title, savedTitle);
    const bodyDirty = !sameNote(body, savedBody);
    if (!titleDirty && !bodyDirty) {
      unsaved.current = null;
      return;
    }
    if (current.id === null && title.trim() === "") {
      unsaved.current = null;
      return;
    }
    if (current.id !== null && title.trim() === "" && !bodyDirty) {
      unsaved.current = null;
      return;
    }
    const draft: Draft = {
      key: current.key,
      id: current.id,
      title,
      body,
    };
    unsaved.current = draft;
    if (
      refused &&
      refused.key === draft.key &&
      sameTitle(refused.title, draft.title) &&
      sameNote(refused.body, draft.body)
    ) {
      return;
    }
    if (saving) return;
    const timer = window.setTimeout(() => {
      void flush();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [body, flush, loaded, refused, savedBody, savedTitle, saving, title]);

  // The page itself can go away with a draft still pending: a closed window is
  // the one exit that is not gated on the write.
  useEffect(() => () => void flush(), [flush]);

  const goToDocument = useCallback(
    async (id: string) => {
      if (id === active.current.id) return;
      if ((await flush()) === "failed") return;
      await loadDocument(id);
    },
    [flush, loadDocument],
  );

  const startNew = useCallback(async () => {
    if (loading || saving) return;
    if ((await flush()) === "failed") return;
    openNewDraft();
  }, [flush, loading, openNewDraft, saving]);

  // Ctrl/Cmd+S writes the document, as it does in every other editor.
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

  /** Remove the document on screen. The markdown file itself goes with it. */
  const deleteDocument = useCallback(async () => {
    const id = active.current.id;
    if (!id) return;
    if ((await flush()) === "failed") return;
    setSaving(true);
    setError(null);
    try {
      const result = await api().idealStateDelete(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const listed = await loadDocuments();
      const next = listed.find((entry) => !entry.error);
      if (next) await loadDocument(next.id);
      else openNewDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [flush, loadDocument, loadDocuments, openNewDraft]);

  const onDelete = useCallback(() => {
    if (selectedId === null) return;
    ask({
      title: "Delete document",
      message:
        "The document is removed from Ideal State and its markdown file is removed from the vault.",
      confirmLabel: "Delete document",
      destructive: true,
      run: () => {
        void deleteDocument();
      },
    });
  }, [ask, deleteDocument, selectedId]);

  const titleBlank = title.trim() === "";
  const titleDirty = !sameTitle(title, savedTitle);
  const bodyDirty = !sameNote(body, savedBody);
  const dirty = titleDirty || bodyDirty;
  const isNew = selectedId === null;
  const heldBack =
    refused !== null &&
    refused.key === active.current.key &&
    sameTitle(refused.title, title) &&
    sameNote(refused.body, body);

  const status = saving
    ? "Saving…"
    : titleBlank && !isNew
      ? "Add a title to save"
      : titleBlank && isNew
        ? "Give this document a title"
        : heldBack
          ? "Not saved"
          : dirty
            ? "Saving…"
            : isNew
              ? "New document"
              : "Saved";

  // Newest first is the order the vault returns; a row that cannot be read stays
  // where it sits rather than disappearing from the page.
  const readable = useMemo(() => documents.filter((entry) => !entry.error), [documents]);
  const unreadable = useMemo(() => documents.filter((entry) => entry.error), [documents]);

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <div className="ideal-state">
      <header className="ideal-state__header">
        <div className="ideal-state__header-row">
          <h1>Ideal State</h1>
          <Button
            variant="outline"
            data-testid="ideal-state-new"
            onClick={() => void startNew()}
            disabled={loading || saving}
          >
            + New document
          </Button>
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ideal-state__workspace">
        {loading ? (
          <p className="muted ideal-state__loading">Loading the document…</p>
        ) : (
          <div
            className="ideal-state__compose"
            // The pointer leaving the compose area — for the list, another page,
            // another app — is the operator stepping away, so the document is
            // written then rather than at the end of the debounce. Moving between
            // the title and the prose stays inside.
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              void flush();
            }}
          >
            <label className="ideal-state__title-field">
              <span className="ideal-state__title-label">Title</span>
              <input
                ref={titleRef}
                className="ideal-state__title"
                data-testid="ideal-state-title"
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                aria-label="Document title"
                spellCheck={false}
              />
            </label>

            <div className="ideal-state__editor">
              <LiveMarkdownEditor
                testId="ideal-state-editor"
                value={body}
                onChange={onBodyChange}
                slug={`ideal-state-${selectedId ?? "new"}`}
                ariaLabel={
                  titleBlank ? "Ideal state document" : `Ideal state: ${title}`
                }
                autoFocusEmpty={!isNew}
              />
            </div>

            <div className="ideal-state__footer">
              <p
                className="ideal-state__status muted"
                data-testid="ideal-state-status"
                role="status"
              >
                {status}
              </p>
              {selectedId !== null ? (
                <Button
                  destructive
                  data-testid="ideal-state-delete"
                  onClick={onDelete}
                  disabled={saving}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          </div>
        )}

        <section className="ideal-state__history">
          <h2>Documents</h2>
          {documents.length === 0 ? (
            <p className="muted">
              No documents yet. Write the first one on the left.
            </p>
          ) : (
            <>
              <div className="ideal-state__history-head" aria-hidden="true">
                <span>Title</span>
                <span>Last edited</span>
              </div>
              {readable.length > 0 ? (
                <ul className="ideal-state__history-list">
                  {readable.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="ideal-state__history-row"
                        data-testid={`ideal-state-doc-${entry.id}`}
                        aria-current={
                          entry.id === selectedId ? "true" : undefined
                        }
                        onClick={() => void goToDocument(entry.id)}
                      >
                        <span className="ideal-state__history-title">
                          {entry.title ?? "Untitled"}
                        </span>
                        <span className="ideal-state__history-edited">
                          {formatEditedAt(entry.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {unreadable.length > 0 ? (
                <ul className="ideal-state__history-list">
                  {unreadable.map((entry) => (
                    <li key={entry.id}>
                      <div
                        className="ideal-state__history-row ideal-state__history-unreadable"
                        data-testid={`ideal-state-doc-${entry.id}`}
                        title={entry.error}
                      >
                        <span className="ideal-state__history-title">
                          {entry.id}.md
                        </span>
                        <span className="ideal-state__history-edited">
                          unreadable
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </section>
      </div>
      {dialog}
    </div>
  );
}
