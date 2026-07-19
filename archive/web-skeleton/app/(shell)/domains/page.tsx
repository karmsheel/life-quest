"use client";

import { FormEvent, useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";

export default function DomainsPage() {
  const {
    domains,
    activeDomainId,
    activateDomain,
    loading,
    refresh,
  } = useShell();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        domain?: { id: string };
      };
      if (!res.ok) {
        setCreateError(data.error ?? "Failed to create domain");
        return;
      }
      setName("");
      setDescription("");
      await refresh();
      if (data.domain?.id) {
        try {
          await activateDomain(data.domain.id);
        } catch {
          /* refresh already loaded list */
        }
      }
    } catch {
      setCreateError("Network error");
    } finally {
      setCreating(false);
    }
  }

  function startRename(id: string, current: string) {
    setRenamingId(id);
    setRenameValue(current);
    setActionError(null);
  }

  async function submitRename(id: string) {
    const next = renameValue.trim();
    if (!next) {
      setActionError("Name is required");
      return;
    }
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/domains/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setActionError(data.error ?? "Failed to rename");
        return;
      }
      setRenamingId(null);
      await refresh();
    } catch {
      setActionError("Network error renaming domain");
    } finally {
      setBusyId(null);
    }
  }

  async function archiveDomain(id: string) {
    if (
      !window.confirm(
        "Archive this domain? It will leave the active list and can be restored later via API.",
      )
    ) {
      return;
    }
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/domains/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setActionError(data.error ?? "Failed to archive");
        return;
      }
      await refresh();
    } catch {
      setActionError("Network error archiving domain");
    } finally {
      setBusyId(null);
    }
  }

  async function onActivate(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await activateDomain(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to activate domain",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="domains-manager">
      <header className="domains-manager__header">
        <h1 className="stub-page__title">Domains</h1>
        <p className="stub-page__desc muted">
          Manage life domains. Activate a domain to scope rooms, documents, and
          log context.
        </p>
      </header>

      <form className="domains-manager__create" onSubmit={onCreate}>
        <h2 className="domains-manager__section-title">Create domain</h2>
        <div className="domains-manager__create-row">
          <label className="doc-field domains-manager__name-field">
            <span>Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Health, Career"
              disabled={creating}
            />
          </label>
          <label className="doc-field domains-manager__desc-field">
            <span>Description (optional)</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note"
              disabled={creating}
            />
          </label>
          <button
            type="submit"
            className="doc-btn doc-btn--primary domains-manager__create-btn"
            disabled={creating || !name.trim()}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {createError ? (
          <p className="doc-editor__error" role="alert">
            {createError}
          </p>
        ) : null}
      </form>

      {actionError ? (
        <p className="doc-editor__error" role="alert">
          {actionError}
        </p>
      ) : null}

      <h2 className="domains-manager__section-title">Your domains</h2>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : domains.length === 0 ? (
        <p className="muted">No domains yet. Create one above.</p>
      ) : (
        <div className="domains-manager__grid">
          {domains.map((d) => {
            const active = d.id === activeDomainId;
            const busy = busyId === d.id;
            const renaming = renamingId === d.id;
            return (
              <article
                key={d.id}
                className={[
                  "domain-card",
                  active ? "domain-card--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="domain-card__head">
                  {renaming ? (
                    <input
                      className="domain-card__rename-input"
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      disabled={busy}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitRename(d.id);
                        }
                        if (e.key === "Escape") {
                          setRenamingId(null);
                        }
                      }}
                    />
                  ) : (
                    <h3 className="domain-card__name">{d.name}</h3>
                  )}
                  {active ? (
                    <span className="domain-card__badge">Active</span>
                  ) : null}
                </div>

                {d.description ? (
                  <p className="domain-card__desc muted">{d.description}</p>
                ) : (
                  <p className="domain-card__desc muted">No description</p>
                )}

                <div className="domain-card__docs muted">
                  {d.documents.length > 0
                    ? d.documents
                        .map(
                          (doc) =>
                            `${doc.kind}: ${doc.status}${
                              doc.bodyLength > 0
                                ? ` (${doc.bodyLength})`
                                : " (empty)"
                            }`,
                        )
                        .join(" · ")
                    : "No documents yet"}
                </div>

                <div className="domain-card__actions">
                  {renaming ? (
                    <>
                      <button
                        type="button"
                        className="doc-btn doc-btn--primary"
                        disabled={busy}
                        onClick={() => void submitRename(d.id)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="doc-btn doc-btn--ghost"
                        disabled={busy}
                        onClick={() => setRenamingId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {!active ? (
                        <button
                          type="button"
                          className="doc-btn doc-btn--primary"
                          disabled={busy}
                          onClick={() => void onActivate(d.id)}
                        >
                          Activate
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="doc-btn"
                        disabled={busy}
                        onClick={() => startRename(d.id, d.name)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="doc-btn doc-btn--danger"
                        disabled={busy}
                        onClick={() => void archiveDomain(d.id)}
                      >
                        Archive
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
