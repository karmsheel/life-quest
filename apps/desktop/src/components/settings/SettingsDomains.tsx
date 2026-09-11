import { FormEvent, useMemo, useState } from "react";
import { Layers } from "lucide-react";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
} from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

export function SettingsDomains() {
  const { snapshot, activeSlug, setActiveSlug, refresh, error: vaultError } =
    useVault();

  const domains = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.domains
      .slice()
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  }, [snapshot]);

  const live = domains.filter((d) => !d.meta.archivedAt);
  const archived = domains.filter((d) => d.meta.archivedAt);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreateError(null);
    setCreating(true);
    try {
      const result = await api().domainCreate({ name: trimmed });
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      setName("");
      await refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  function startRename(slug: string, current: string) {
    setRenamingSlug(slug);
    setRenameValue(current);
    setActionError(null);
  }

  async function submitRename(slug: string) {
    const next = renameValue.trim();
    if (!next) {
      setActionError("Name is required");
      return;
    }
    setBusySlug(slug);
    setActionError(null);
    try {
      const result = await api().domainUpdate(slug, { name: next });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setRenamingSlug(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setBusySlug(null);
    }
  }

  async function archiveDomain(slug: string) {
    if (
      !window.confirm(
        "Archive this domain? It will leave the active switcher list.",
      )
    ) {
      return;
    }
    setBusySlug(slug);
    setActionError(null);
    try {
      const result = await api().domainArchive(slug);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      if (activeSlug === slug) {
        await setActiveSlug(null);
      }
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to archive");
    } finally {
      setBusySlug(null);
    }
  }

  async function onActivate(slug: string) {
    setBusySlug(slug);
    setActionError(null);
    try {
      const result = await setActiveSlug(slug);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to activate domain",
      );
    } finally {
      setBusySlug(null);
    }
  }

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <SettingsSection
      icon={<Layers size={16} />}
      title="Domains"
      subtitle="Activate a domain to filter the app. Overview shows everything."
      contentClassName="domains-manager"
    >
        <form
          className="domains-manager__create"
          onSubmit={(e) => void onCreate(e)}
        >
          <h3 className="domains-manager__section-title">Create domain</h3>
          <div className="domains-manager__create-row">
            <label className="field domains-manager__name-field">
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
            <Button
              type="submit"
              variant="primary"
              disabled={creating || !name.trim()}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
          {createError ? (
            <p className="form-error" role="alert">
              {createError}
            </p>
          ) : null}
        </form>

        {actionError || vaultError ? (
          <p className="form-error" role="alert">
            {actionError ?? vaultError}
          </p>
        ) : null}

        <h3 className="domains-manager__section-title">Your domains</h3>

        {live.length === 0 ? (
          <p className="muted">No domains yet. Create one above.</p>
        ) : (
          <div className="domains-manager__grid">
            {live.map((d) => {
              const active = d.slug === activeSlug;
              const busy = busySlug === d.slug;
              const renaming = renamingSlug === d.slug;
              const docs = DOCUMENT_KINDS.map((kind) => {
                const doc = d.documents[kind];
                const len = doc?.bodyMarkdown.trim().length ?? 0;
                return `${DOCUMENT_KIND_LABELS[kind]}: ${doc?.status ?? "draft"}${
                  len > 0 ? ` (${len})` : " (empty)"
                }`;
              });

              return (
                <article
                  key={d.slug}
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
                            void submitRename(d.slug);
                          }
                          if (e.key === "Escape") {
                            setRenamingSlug(null);
                          }
                        }}
                      />
                    ) : (
                      <h4 className="domain-card__name">{d.meta.name}</h4>
                    )}
                    {active ? (
                      <span className="domain-card__badge">Active</span>
                    ) : null}
                  </div>

                  <p className="domain-card__desc muted">
                    {d.meta.description || "No description"}
                  </p>
                  <p className="domain-card__slug muted">slug: {d.slug}</p>
                  <div className="domain-card__docs muted">{docs.join(" · ")}</div>

                  <div className="domain-card__actions">
                    {renaming ? (
                      <>
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() => void submitRename(d.slug)}
                        >
                          Save
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => setRenamingSlug(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        {!active ? (
                          <Button
                            variant="primary"
                            disabled={busy}
                            onClick={() => void onActivate(d.slug)}
                          >
                            Activate
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => startRename(d.slug, d.meta.name)}
                        >
                          Rename
                        </Button>
                        <Button
                          destructive
                          disabled={busy}
                          onClick={() => void archiveDomain(d.slug)}
                        >
                          Archive
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {archived.length > 0 ? (
          <>
            <h3 className="domains-manager__section-title">Archived</h3>
            <ul className="archived-list muted">
              {archived.map((d) => (
                <li key={d.slug}>
                  {d.meta.name}{" "}
                  <span className="domain-card__slug">({d.slug})</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
    </SettingsSection>
  );
}
