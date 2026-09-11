import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import {
  assertEditable,
  canTransitionStatus,
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
  type DocumentStatus,
  type DoctrineDocument,
  type Result,
} from "@lifequest/vault-core/pure";
import { DOCUMENT_KIND_COACHING } from "@/lib/doctrine-copy";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { MarkdownView } from "./MarkdownView";
import { ProposeChangeDialog } from "./ProposeChangeDialog";

function insertAtCaret(
  value: string,
  start: number,
  end: number,
  insert: string,
): { next: string; caret: number } {
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  return { next, caret: start + insert.length };
}

async function saveImageFile(
  slug: string,
  file: File,
): Promise<Result<{ relPath: string }>> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return api().documentMediaSave(slug, { bytes: buf, mime: file.type });
}

function firstImageFile(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of data.files) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
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
  const [statusPending, setStatusPending] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  /** Last reloadGeneration applied — used to quiet-rehydrate after vault refresh. */
  const appliedGenerationRef = useRef(reloadGeneration);
  /** Bumped on each load so stale documentGet results are ignored. */
  const loadGenRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const editable = document ? assertEditable(document.status) : { ok: true as const };
  const isForged = !editable.ok;
  const isDirty = useMemo(() => {
    if (!document) return false;
    if (titleDraft !== document.title) return true;
    return draft !== document.bodyMarkdown;
  }, [document, draft, titleDraft]);

  async function persistBody(
    current: DoctrineDocument,
  ): Promise<DoctrineDocument | null> {
    if (!slug) return null;
    const titleChanged =
      titleDraft.trim().length > 0 && titleDraft.trim() !== current.title;
    const result = await api().documentSave(
      slug,
      kind,
      draft,
      titleChanged ? titleDraft.trim() : undefined,
    );
    if (!result.ok) {
      setActionError(result.error);
      return null;
    }
    applyDocument(result.value, setDocument, setTitleDraft, setDraft);
    return result.value;
  }

  async function onSave() {
    if (!slug || !document || isForged) return;
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

  async function onStatus(to: Extract<DocumentStatus, "refined" | "forged">) {
    if (!slug || !document || isForged) return;
    if (!canTransitionStatus(document.status, to)) {
      setActionError(
        `Invalid status transition: ${document.status} → ${to}`,
      );
      return;
    }

    setStatusPending(true);
    setActionError(null);
    setActionMessage(null);
    try {
      // Persist body first if dirty so forge/refine sees latest content.
      if (isDirty) {
        const saved = await persistBody(document);
        if (!saved) return;
      }

      const result = await api().documentSetStatus(slug, kind, to);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      applyDocument(result.value, setDocument, setTitleDraft, setDraft);
      setActionMessage(to === "forged" ? "Forged" : "Marked refined");
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to update status",
      );
    } finally {
      setStatusPending(false);
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

  const canRefine = canTransitionStatus(document.status, "refined");
  const canForge = canTransitionStatus(document.status, "forged");
  const busy = saving || statusPending;

  async function insertSavedImage(file: File) {
    const result = await saveImageFile(slug, file);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setActionError(null);
    const el = textareaRef.current;
    const value = el?.value ?? draft;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const insert = `\n![](${result.value.relPath})\n`;
    const { next, caret } = insertAtCaret(value, start, end, insert);
    setDraft(next);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  }

  async function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (isForged) return;
    const file = firstImageFile(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    await insertSavedImage(file);
  }

  async function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    if (isForged) return;
    const file = firstImageFile(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    await insertSavedImage(file);
  }

  return (
    <div className="doc-editor">
      <header className="doc-editor__header">
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
          <DocumentStatusBadge status={document.status} />
        </div>
        <p className="doc-editor__coaching muted">
          {DOCUMENT_KIND_COACHING[kind]}
        </p>
        {!editable.ok ? (
          <p className="doc-editor__forged-hint muted">{editable.reason}</p>
        ) : null}
      </header>

      <label className="field doc-editor__title-field">
        <span>Title</span>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          readOnly={isForged}
          disabled={busy}
        />
      </label>

      <div className="doc-editor__split">
        <label className="field doc-editor__body-field">
          <span>Markdown</span>
          <textarea
            ref={textareaRef}
            className="doc-editor__textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => void onPaste(e)}
            onDrop={(e) => void onDrop(e)}
            onDragOver={(e) => {
              if (!isForged) e.preventDefault();
            }}
            readOnly={isForged}
            disabled={busy}
            rows={18}
            spellCheck
          />
        </label>
        <div className="doc-editor__preview">
          <span className="doc-editor__preview-label">Preview</span>
          <MarkdownView markdown={draft} slug={slug} />
        </div>
      </div>

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
        {!isForged ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onSave()}
              disabled={busy || !isDirty}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {canRefine ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void onStatus("refined")}
                disabled={busy}
              >
                Mark refined
              </button>
            ) : null}
            {canForge ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void onStatus("forged")}
                disabled={busy}
              >
                Forge
              </button>
            ) : null}
          </>
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
        domainSlug={slug}
        documentKind={kind}
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
