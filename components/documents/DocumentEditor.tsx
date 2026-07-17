"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HOW_PLACEHOLDER } from "@/lib/constants.ts";
import type { DocumentKind, DocumentStatus } from "@/lib/document-kinds.ts";
import { useShell } from "@/components/shell/ShellProvider";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { ProposeChangeDialog } from "./ProposeChangeDialog";

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

type LoadedDocument = {
  id: string;
  domainId: string;
  kind: DocumentKind;
  title: string;
  bodyMarkdown: string;
  status: DocumentStatus;
};

function parseDocument(raw: unknown): LoadedDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== "string") return null;
  if (typeof rec.domainId !== "string") return null;
  if (rec.kind !== "why" && rec.kind !== "what" && rec.kind !== "how") {
    return null;
  }
  const statusRaw = typeof rec.status === "string" ? rec.status : "draft";
  const status = (
    statusRaw === "refined" || statusRaw === "forged" ? statusRaw : "draft"
  ) as DocumentStatus;
  return {
    id: rec.id,
    domainId: rec.domainId,
    kind: rec.kind,
    title: typeof rec.title === "string" ? rec.title : KIND_LABELS[rec.kind],
    bodyMarkdown: typeof rec.bodyMarkdown === "string" ? rec.bodyMarkdown : "",
    status,
  };
}

/** Local editor body: How uses placeholder when empty — never auto-saved. */
function initialEditorBody(kind: DocumentKind, bodyMarkdown: string): string {
  if (kind === "how" && bodyMarkdown.trim().length === 0) {
    return HOW_PLACEHOLDER;
  }
  return bodyMarkdown;
}

export function DocumentEditor({ kind }: { kind: DocumentKind }) {
  const { activeDomainId, activeDomain, loading: shellLoading, refresh } =
    useShell();

  const [document, setDocument] = useState<LoadedDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeDomainId) {
      setDocument(null);
      setDraft("");
      setTitleDraft("");
      setLoadError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setActionMessage(null);

    try {
      const res = await fetch(
        `/api/domains/${activeDomainId}/documents/${kind}`,
        { credentials: "same-origin" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        document?: unknown;
        error?: string;
      };
      if (!res.ok) {
        setDocument(null);
        setLoadError(data.error ?? "Failed to load document");
        return;
      }
      const doc = parseDocument(data.document);
      if (!doc) {
        setDocument(null);
        setLoadError("Invalid document payload");
        return;
      }
      setDocument(doc);
      setTitleDraft(doc.title);
      // Placeholder is local-only for empty How — do not auto-save on open.
      setDraft(initialEditorBody(kind, doc.bodyMarkdown));
    } catch {
      setDocument(null);
      setLoadError("Network error loading document");
    } finally {
      setLoading(false);
    }
  }, [activeDomainId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const isForged = document?.status === "forged";
  /** True when local draft differs from the loaded baseline (How placeholder counts as baseline when body empty). */
  const isDirty = useMemo(() => {
    if (!document) return false;
    if (titleDraft !== document.title) return true;
    const baseline = initialEditorBody(kind, document.bodyMarkdown);
    return draft !== baseline;
  }, [document, draft, titleDraft, kind]);

  async function onSave() {
    if (!activeDomainId || !document || isForged) return;
    setSaving(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const payload: { bodyMarkdown: string; title?: string } = {
        bodyMarkdown: draft,
      };
      if (titleDraft.trim() && titleDraft.trim() !== document.title) {
        payload.title = titleDraft.trim();
      }
      const res = await fetch(
        `/api/domains/${activeDomainId}/documents/${kind}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        document?: unknown;
        error?: string;
      };
      if (!res.ok) {
        setActionError(data.error ?? "Failed to save");
        return;
      }
      const doc = parseDocument(data.document);
      if (doc) {
        setDocument(doc);
        setTitleDraft(doc.title);
        setDraft(initialEditorBody(kind, doc.bodyMarkdown));
      }
      setActionMessage("Saved");
      await refresh();
    } catch {
      setActionError("Network error saving document");
    } finally {
      setSaving(false);
    }
  }

  async function onStatus(to: "refined" | "forged") {
    if (!activeDomainId || !document || isForged) return;
    setStatusPending(true);
    setActionError(null);
    setActionMessage(null);
    try {
      // Persist body first if dirty so unlock + forge see latest content.
      if (isDirty) {
        const saveRes = await fetch(
          `/api/domains/${activeDomainId}/documents/${kind}`,
          {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              bodyMarkdown: draft,
              ...(titleDraft.trim() && titleDraft.trim() !== document.title
                ? { title: titleDraft.trim() }
                : {}),
            }),
          },
        );
        if (!saveRes.ok) {
          const data = (await saveRes.json().catch(() => ({}))) as {
            error?: string;
          };
          setActionError(data.error ?? "Failed to save before status change");
          return;
        }
        const saveData = (await saveRes.json()) as { document?: unknown };
        const saved = parseDocument(saveData.document);
        if (saved) {
          setDocument(saved);
          setTitleDraft(saved.title);
          setDraft(initialEditorBody(kind, saved.bodyMarkdown));
        }
      }

      const res = await fetch(
        `/api/domains/${activeDomainId}/documents/${kind}/status`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: to }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        document?: unknown;
        error?: string;
      };
      if (!res.ok) {
        setActionError(data.error ?? "Failed to update status");
        return;
      }
      const doc = parseDocument(data.document);
      if (doc) {
        setDocument(doc);
        setTitleDraft(doc.title);
        setDraft(initialEditorBody(kind, doc.bodyMarkdown));
      }
      setActionMessage(to === "forged" ? "Forged" : "Marked refined");
      await refresh();
    } catch {
      setActionError("Network error updating status");
    } finally {
      setStatusPending(false);
    }
  }

  if (shellLoading) {
    return <p className="muted doc-editor__status">Loading shell…</p>;
  }

  if (!activeDomainId) {
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
        <p className="doc-editor__error">{loadError ?? "Document not found"}</p>
        <button type="button" className="doc-btn doc-btn--ghost" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  const canRefine = document.status === "draft";
  const canForge =
    document.status === "draft" || document.status === "refined";
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
                · {activeDomain.name}
              </span>
            ) : null}
          </h1>
          <DocumentStatusBadge status={document.status} />
        </div>
        <p className="doc-editor__coaching muted">{COACHING[kind]}</p>
      </header>

      <label className="doc-field doc-editor__title-field">
        <span>Title</span>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          readOnly={isForged}
          disabled={busy}
        />
      </label>

      <label className="doc-field doc-editor__body-field">
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

      {actionError ? <p className="doc-editor__error">{actionError}</p> : null}
      {actionMessage ? (
        <p className="doc-editor__message">{actionMessage}</p>
      ) : null}

      <div className="doc-editor__actions">
        {!isForged ? (
          <>
            <button
              type="button"
              className="doc-btn doc-btn--primary"
              onClick={() => void onSave()}
              disabled={busy}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {canRefine ? (
              <button
                type="button"
                className="doc-btn"
                onClick={() => void onStatus("refined")}
                disabled={busy}
              >
                Mark refined
              </button>
            ) : null}
            {canForge ? (
              <button
                type="button"
                className="doc-btn"
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
            className="doc-btn doc-btn--primary"
            onClick={() => setProposeOpen(true)}
            disabled={busy}
          >
            Propose change
          </button>
        )}
      </div>

      <ProposeChangeDialog
        open={proposeOpen}
        documentId={document.id}
        currentBody={document.bodyMarkdown}
        onClose={() => setProposeOpen(false)}
        onSubmitted={() => {
          setActionMessage("Proposal submitted — review it under Decisions.");
        }}
      />
    </div>
  );
}
