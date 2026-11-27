import { FormEvent, useMemo, useState } from "react";
import { Layers } from "lucide-react";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  isAreaLocked,
  unlockedAreas,
} from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useConfirm } from "@/components/ui/useConfirm";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

/**
 * Settings → Areas.
 *
 * The seeded, locked areas are offered here by name — the one place the
 * taxonomy is revealed, and only when the operator asks for it. Unlocking is a
 * flag flip: it creates nothing, moves nothing, and does not change the lens.
 * The base `life` area is the vault container, not a choice, so it never
 * appears as a card or a row.
 */
export function SettingsDomains() {
  const { snapshot, activeSlug, setActiveSlug, refresh, error: vaultError } =
    useVault();

  const domains = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.domains
      .slice()
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  }, [snapshot]);

  /** The areas the operator chooses between: unlocked and live, base excluded. */
  const live = useMemo(() => unlockedAreas(domains), [domains]);
  /**
   * Seeded areas nobody has unlocked yet. Locked means exactly
   * `unlockedAt: null`; every area written before the lock state existed is
   * unlocked and is not offered here.
   */
  const locked = useMemo(
    () => domains.filter((d) => isAreaLocked(d) && !d.meta.archivedAt),
    [domains],
  );
  const archived = domains.filter((d) => d.meta.archivedAt);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Archive and delete ask in the app's own dialog, not the platform's. */
  const { ask, dialog } = useConfirm();

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

  /** Unlock is a reveal, not an activation: the lens stays where it was. */
  async function unlockArea(slug: string) {
    setBusySlug(slug);
    setActionError(null);
    try {
      const result = await api().domainUnlock(slug);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to unlock area");
    } finally {
      setBusySlug(null);
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

  /** Archive is the soft one — the folder and its database stay — so it asks plainly. */
  function archiveArea(slug: string) {
    ask({
      title: "Archive area",
      message:
        "The area leaves the active switcher list. Its folder and everything in it stay in the vault.",
      confirmLabel: "Archive area",
      run: () => void runArchiveArea(slug),
    });
  }

  async function runArchiveArea(slug: string) {
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
      setActionError(err instanceof Error ? err.message : "Failed to archive area");
    } finally {
      setBusySlug(null);
    }
  }

  async function unarchiveArea(slug: string) {
    setBusySlug(slug);
    setActionError(null);
    try {
      const result = await api().domainUnarchive(slug);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to unarchive area",
      );
    } finally {
      setBusySlug(null);
    }
  }

  /** Delete is not archive: the folder and its database go, so it wears the danger. */
  function deleteArea(slug: string, name: string) {
    ask({
      title: "Delete area",
      message: `Delete "${name}"? This permanently removes the area and everything in it, including doctrine, pages, and its database. This cannot be undone.`,
      confirmLabel: "Delete area",
      destructive: true,
      run: () => void runDeleteArea(slug),
    });
  }

  async function runDeleteArea(slug: string) {
    setBusySlug(slug);
    setActionError(null);
    try {
      const result = await api().domainDelete(slug);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      if (activeSlug === slug) {
        await setActiveSlug(null);
      }
      if (renamingSlug === slug) setRenamingSlug(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete area");
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
      setActionError(err instanceof Error ? err.message : "Failed to activate area");
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
      title="Areas"
      subtitle="Activate an area to filter the app. Life shows everything."
      contentClassName="domains-manager"
    >
        {locked.length > 0 ? (
          <>
            <h3 className="domains-manager__section-title">
              Unlock another area
            </h3>
            <ul className="locked-areas" aria-label="Areas not unlocked yet">
              {locked.map((d) => {
                const busy = busySlug === d.slug;
                return (
                  <li key={d.slug} className="locked-areas__item">
                    <span className="locked-areas__name">{d.meta.name}</span>
                    <span className="locked-areas__slug muted">{d.slug}</span>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void unlockArea(d.slug)}
                    >
                      Unlock
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {actionError || vaultError ? (
          <p className="form-error" role="alert">
            {actionError ?? vaultError}
          </p>
        ) : null}

        <h3 className="domains-manager__section-title">Your areas</h3>

        {live.length === 0 ? (
          <p className="muted">No areas yet. Create one below.</p>
        ) : (
          <div className="domains-manager__grid">
            {live.map((d) => {
              const active = d.slug === activeSlug;
              const busy = busySlug === d.slug;
              const renaming = renamingSlug === d.slug;
              const docs = DOCUMENT_KINDS.map((kind) => {
                const doc = d.documents[kind];
                const len = doc?.bodyMarkdown.trim().length ?? 0;
                return `${DOCUMENT_KIND_LABELS[kind]}: ${doc?.locked ? "locked" : "unlocked"}${
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
                          onClick={() => void archiveArea(d.slug)}
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
            <ul className="archived-list">
              {archived.map((d) => {
                const busy = busySlug === d.slug;
                return (
                  <li key={d.slug} className="archived-list__item">
                    <span>
                      {d.meta.name}{" "}
                      <span className="domain-card__slug muted">({d.slug})</span>
                    </span>
                    <span className="archived-list__actions">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void unarchiveArea(d.slug)}
                      >
                        Unarchive
                      </Button>
                      <Button
                        destructive
                        disabled={busy}
                        onClick={() => void deleteArea(d.slug, d.meta.name)}
                      >
                        Delete
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        <form
          className="domains-manager__create"
          onSubmit={(e) => void onCreate(e)}
        >
          <h3 className="domains-manager__section-title">Create area</h3>
          <div className="domains-manager__create-row">
            <label className="field domains-manager__name-field">
              <span>Name</span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Woodworking"
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

      {dialog}
    </SettingsSection>
  );
}
