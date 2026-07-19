import { FormEvent, useEffect, useState } from "react";
import type { DocumentKind } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";

export type ProposeChangeDialogProps = {
  open: boolean;
  domainSlug: string;
  documentKind: DocumentKind;
  currentBody: string;
  onClose: () => void;
  onSubmitted?: () => void;
};

export function ProposeChangeDialog({
  open,
  domainSlug,
  documentKind,
  currentBody,
  onClose,
  onSubmitted,
}: ProposeChangeDialogProps) {
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [proposedBody, setProposedBody] = useState(currentBody);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setRationale("");
      setProposedBody(currentBody);
      setError(null);
      setPending(false);
    }
  }, [open, currentBody]);

  if (!open) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await api().decisionCreate({
        domainSlug,
        documentKind,
        title: title.trim(),
        rationale: rationale.trim() || null,
        proposedBodyMarkdown: proposedBody,
        previousBodyMarkdown: currentBody,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSubmitted?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose change");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="propose-dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        className="propose-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="propose-dialog-title"
      >
        <header className="propose-dialog__header">
          <h2 id="propose-dialog-title">Propose change</h2>
          <p className="muted propose-dialog__hint">
            Forged documents stay read-only until a Decision is approved.
          </p>
        </header>

        <form className="propose-dialog__form" onSubmit={(e) => void onSubmit(e)}>
          <label className="field">
            <span>Title</span>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary of the change"
              disabled={pending}
            />
          </label>

          <label className="field">
            <span>Rationale (optional)</span>
            <textarea
              rows={2}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Why this change?"
              disabled={pending}
            />
          </label>

          <label className="field">
            <span>Proposed body</span>
            <textarea
              className="propose-dialog__body"
              rows={12}
              required
              value={proposedBody}
              onChange={(e) => setProposedBody(e.target.value)}
              disabled={pending}
            />
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="propose-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={pending || !title.trim()}
            >
              {pending ? "Submitting…" : "Submit proposal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
