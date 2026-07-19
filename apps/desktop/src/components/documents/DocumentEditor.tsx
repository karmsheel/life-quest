import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assertEditable,
  canTransitionStatus,
  type DocumentKind,
  type DocumentStatus,
  type DoctrineDocument,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useActiveDomain } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { ProposeChangeDialog } from "./ProposeChangeDialog";

/** Local-only How template when body is empty — never auto-saved. */
export const HOW_PLACEHOLDER = `# Strategy

# Tactics

# Habits
`;

const COACHING: Record<DocumentKind, string> = {
  why: "Why pursue growth in this domain?",
  what: "What is your North Star for this domain?",
  how: "Strategy, tactics, and habits.",
};

const KIND_LABELS: Record<DocumentKind, string> = {
  why: "Why",
  what: "What",
  how: "How",
};

function initialEditorBody(kind: DocumentKind, bodyMarkdown: string): string {
  if (kind === "how" && bodyMarkdown.trim().length === 0) {
    return HOW_PLACEHOLDER;
  }
  return bodyMarkdown;
}

function applyDocument(
  doc: DoctrineDocument,
  kind: DocumentKind,
  setDocument: (d: DoctrineDocument) => void,
  setTitleDraft: (t: string) => void,
  setDraft: (b: string) => void,
) {
  setDocument(doc);
  setTitleDraft(doc.title);
  setDraft(initialEditorBody(kind, doc.bodyMarkdown));
}

export function DocumentEditor({ kind }: { kind: DocumentKind }) {
  const { refresh, reloadGeneration } = useVault();
  const activeDomain = useActiveDomain();
  const slug = activeDomain?.slug ?? null;

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

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!slug) {
        setDocument(null);
        setDraft("");
        setTitleDraft("");
        setLoadError(null);
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
        applyDocument(
          result.value,
          requestKind,
          setDocument,
          setTitleDraft,
          setDraft,
        );
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
    const baseline = initialEditorBody(kind, document.bodyMarkdown);
    return draft !== baseline;
  }, [document, draft, titleDraft, kind]);

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
    applyDocument(result.value, kind, setDocument, setTitleDraft, setDraft);
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
      applyDocument(result.value, kind, setDocument, setTitleDraft, setDraft);
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
        Select a domain to edit its {KIND_LABELS[kind]} document.
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

  return (
    <div className="doc-editor">
      <header className="doc-editor__header">
        <div className="doc-editor__heading">
          <h1 className="doc-editor__title">
            {KIND_LABELS[kind]}
            {activeDomain ? (
              <span className="doc-editor__domain muted">
                {" "}
                · {activeDomain.meta.name}
              </span>
            ) : null}
          </h1>
          <DocumentStatusBadge status={document.status} />
        </div>
        <p className="doc-editor__coaching muted">{COACHING[kind]}</p>
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

      <label className="field doc-editor__body-field">
        <span>Markdown</span>
        <textarea
          className="doc-editor__textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={isForged}
          disabled={busy}
          rows={18}
          spellCheck
        />
      </label>

      {kind === "how" && document.bodyMarkdown.trim().length === 0 ? (
        <p className="doc-editor__placeholder-hint muted">
          Template is local only until you Save — opening Track does not unlock
          Act.
        </p>
      ) : null}

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
