import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assertEditable,
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
  type DoctrineDocument,
  type Result,
} from "@lifequest/vault-core/pure";
import { DOCUMENT_KIND_COACHING } from "@/lib/doctrine-copy";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { LockSwitch } from "@/components/ui/LockSwitch";
import { DocumentLockBadge } from "./DocumentLockBadge";
import { LiveMarkdownEditor } from "./LiveMarkdownEditor";
import { ProposeChangeDialog } from "./ProposeChangeDialog";

async function saveImageFile(
  slug: string,
  file: File,
): Promise<Result<{ relPath: string }>> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return api().documentMediaSave(slug, { bytes: buf, mime: file.type });
}

function applyDocument(
  doc: DoctrineDocument,
  setDocument: (d: DoctrineDocument) => void,
  setTitleDraft: (t: string) => void,
  setDraft: (b: string) => void,
) {
  setDocument(doc);
  setTitleDraft(doc.title);
  setDraft(doc.bodyMarkdown);
}

export function DocumentEditor({
  kind,
  slug,
}: {
  kind: DocumentKind;
  slug: string;
}) {
  const { refresh, reloadGeneration, snapshot } = useVault();
  const domainName = snapshot?.domains.find((d) => d.slug === slug)?.meta.name;

  const [document, setDocument] = useState<DoctrineDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lockPending, setLockPending] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  /** Last reloadGeneration applied — used to quiet-rehydrate after vault refresh. */
  const appliedGenerationRef = useRef(reloadGeneration);
  /** Bumped on each load so stale documentGet results are ignored. */
  const loadGenRef = useRef(0);
  /** The draft as it stands now, for a save that lands on text typed since. */
  const latestDraftRef = useRef(draft);

  useEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!slug) {
        setDocument(null);
        setDraft("");
        setTitleDraft("");
        setLoadError("Document not found");
        setLoading(false);
        return;
      }

      const gen = ++loadGenRef.current;
      const requestSlug = slug;
      const requestKind = kind;

      // Quiet rehydrate keeps the editor mounted (no loading flash) while
      // still force-resetting draft from disk after external reload.
      if (!opts?.quiet) setLoading(true);
      setLoadError(null);
      setActionError(null);
      setActionMessage(null);

      try {
        const result = await api().documentGet(requestSlug, requestKind);
        // Ignore out-of-order responses after domain/kind switch or re-load.
        if (gen !== loadGenRef.current) return;
        if (!result.ok) {
          setDocument(null);
          setLoadError(result.error);
          return;
        }
        applyDocument(result.value, setDocument, setTitleDraft, setDraft);
      } catch (err) {
        if (gen !== loadGenRef.current) return;
        setDocument(null);
        setLoadError(
          err instanceof Error ? err.message : "Failed to load document",
        );
      } finally {
        if (gen === loadGenRef.current) {
          setLoading(false);
        }
      }
    },
    [slug, kind],
  );

  // Initial load + domain/kind switch.
  useEffect(() => {
    void load();
  }, [load]);

  // After vault Reload / open / create: re-fetch and force-reset local draft.
  useEffect(() => {
    if (appliedGenerationRef.current === reloadGeneration) return;
    appliedGenerationRef.current = reloadGeneration;
    void load({ quiet: true });
  }, [reloadGeneration, load]);

  const locked = document ? document.locked : false;
  const editable = document ? assertEditable(locked) : { ok: true as const };
  const isDirty = useMemo(() => {
    if (!document) return false;
    if (titleDraft !== document.title) return true;
    return draft !== document.bodyMarkdown;
  }, [document, draft, titleDraft]);

  async function persistBody(
    current: DoctrineDocument,
  ): Promise<DoctrineDocument | null> {
    if (!slug) return null;
    const sent = draft;
    const titleChanged =
      titleDraft.trim().length > 0 && titleDraft.trim() !== current.title;
    const result = await api().documentSave(
      slug,
      kind,
      sent,
      titleChanged ? titleDraft.trim() : undefined,
    );
    if (!result.ok) {
      setActionError(result.error);
      return null;
    }
    // The box is never closed while a write is in flight, so the operator can
    // type on. The file holds what was sent; text newer than that stays theirs.
    if (latestDraftRef.current === sent) {
      applyDocument(result.value, setDocument, setTitleDraft, setDraft);
    } else {
      setDocument(result.value);
    }
    return result.value;
  }

  async function onSave() {
    if (!slug || !document || locked) return;
    setSaving(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const saved = await persistBody(document);
      if (!saved) return;
      setActionMessage("Saved");
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to save document",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onLock(lock: boolean) {
    if (!slug || !document || lockPending) return;
    setLockPending(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await api().documentSetLocked(slug, kind, lock);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      // Re-fetch so the document reflects the new locked state.
      await refresh();
      await load({ quiet: true });
      setActionMessage(lock ? "Locked" : "Unlocked");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to update lock",
      );
    } finally {
      setLockPending(false);
    }
  }

  if (!slug) {
    return (
      <p className="muted doc-editor__status">
        Select a domain to edit its {DOCUMENT_KIND_LABELS[kind]} document.
      </p>
    );
  }

  if (loading) {
    return <p className="muted doc-editor__status">Loading document…</p>;
  }

  if (loadError || !document) {
    return (
      <div className="doc-editor">
        <p className="form-error" role="alert">
          {loadError ?? "Document not found"}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  const busy = saving || lockPending;

  async function insertSavedImage(file: File): Promise<string | null> {
    const result = await saveImageFile(slug, file);
    if (!result.ok) {
      setActionError(result.error);
      return null;
    }
    setActionError(null);
    // The image goes exactly where the gesture landed: the box puts this
    // markdown at the caret, and the renderer pulls the file back by that path.
    return `\n![](${result.value.relPath})\n`;
  }

  return (
    <div className="doc-editor">
      <header className="doc-editor__header">
        <div className="doc-editor__intro">
          <div className="doc-editor__heading">
            <h1 className="doc-editor__title">
              {DOCUMENT_KIND_LABELS[kind]}
              {domainName ? (
                <span className="doc-editor__domain muted">
                  {" "}
                  · {domainName}
                </span>
              ) : null}
            </h1>
            {/* The state badge sits beside the document's name, where it has
                always labelled this page. */}
            <DocumentLockBadge locked={locked} />
          </div>
          <p className="doc-editor__coaching muted">
            {DOCUMENT_KIND_COACHING[kind]}
          </p>
          {!editable.ok ? (
            <p className="doc-editor__lock-hint muted">
              Document is locked. Unlock to edit, or propose a change.
            </p>
          ) : null}
        </div>
        {/* The lock is a setting of this document, so the switch belongs with
            the document's name rather than at the bottom of the page beside
            Save; the badge beside the name says what the switch is set to. */}
        <div className="page-corner" data-testid="document-page-corner">
          <LockSwitch
            locked={locked}
            busy={lockPending}
            onToggle={() => void onLock(!locked)}
            label={locked ? "Unlock this document" : "Lock this document"}
            testId="document-lock-toggle"
            className="page-corner__action"
          />
        </div>
      </header>

      <label className="field doc-editor__title-field">
        <span>Title</span>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          readOnly={locked}
          disabled={busy}
        />
      </label>

      <LiveMarkdownEditor
        testId="document-editor"
        value={draft}
        onChange={setDraft}
        slug={slug}
        readOnly={locked}
        onInsertFile={insertSavedImage}
        ariaLabel={`${DOCUMENT_KIND_LABELS[kind]}${domainName ? ` for ${domainName}` : ""} body`}
        placeholder="Write this document."
      />

      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {actionMessage ? (
        <p className="doc-editor__message" role="status">
          {actionMessage}
        </p>
      ) : null}

      <div className="doc-editor__actions">
        {!locked ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={busy || !isDirty}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setProposeOpen(true)}
            disabled={busy}
          >
            Propose change
          </button>
        )}
      </div>

      <ProposeChangeDialog
        open={proposeOpen}
        target={{ type: "doctrine", domainSlug: slug, kind }}
        currentTitle={document.title}
        currentBody={document.bodyMarkdown}
        onClose={() => setProposeOpen(false)}
        onSubmitted={() => {
          setActionMessage("Proposal submitted — review it under Decisions.");
          void refresh();
        }}
      />
    </div>
  );
}
