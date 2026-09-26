import { useCallback, useEffect, useMemo, useState } from "react";
import {
  lensSlug,
  recordVisible,
  type Project,
  type ProjectStatus,
} from "@lifequest/vault-core/pure";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

type StatusFilter = "open" | "closed" | "all";

/**
 * KAR-7: a Project is one markdown file linked to one Goal. The operator creates
 * and edits it directly — every write here goes straight to the vault with no
 * Decision in the loop. The agent only proposes create and close.
 */
export default function ProjectsPage() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Composer state. The same fields serve create and edit.
  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [goalId, setGoalId] = useState("");
  const [domainValue, setDomainValue] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveDomains = useMemo(
    () =>
      (snapshot?.domains ?? [])
        .filter((d) => !d.meta.archivedAt)
        .slice()
        .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder),
    [snapshot],
  );

  const goals = snapshot?.goals ?? [];

  const defaultDomain = useCallback((): string => lensSlug(lens) ?? "", [lens]);

  const load = useCallback(async () => {
    try {
      const result = await api().projectsList();
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setProjects(result.value.records);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load projects");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, snapshot]);

  // Overview shows everything, including unassigned. A domain lens shows only
  // that domain, so unassigned work drops out of a domain view.
  const visible = useMemo(
    () => projects.filter((p) => recordVisible(lens, p.domainSlug)),
    [projects, lens],
  );
  const listed = useMemo(
    () =>
      statusFilter === "all"
        ? visible
        : visible.filter((p) => p.status === statusFilter),
    [statusFilter, visible],
  );

  const domainName = (slug: string | null): string => {
    if (!slug) return "Unassigned";
    return snapshot?.domains.find((d) => d.slug === slug)?.meta.name ?? slug;
  };

  const goalName = (id: string): string =>
    goals.find((g) => g.id === id)?.name ?? `${id} (missing)`;

  const resetComposer = useCallback(() => {
    setEditingId(null);
    setTitle("");
    setBodyMarkdown("");
    setGoalId("");
    setStatus("open");
    setError(null);
    setDomainValue(defaultDomain());
  }, [defaultDomain]);

  // Keep the domain default following the lens until the operator picks one.
  const [domainDirty, setDomainDirty] = useState(false);
  useEffect(() => {
    if (editingId || domainDirty) return;
    setDomainValue(defaultDomain());
  }, [defaultDomain, domainDirty, editingId]);

  function openEdit(project: Project) {
    if (busy) return;
    setEditingId(project.id);
    setTitle(project.title);
    setBodyMarkdown(project.bodyMarkdown);
    setGoalId(project.goalId);
    setStatus(project.status);
    setDomainValue(project.domainSlug ?? "");
    setDomainDirty(true);
    setError(null);
  }

  async function onCreate() {
    if (busy) return;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!goalId) {
      setError("Pick a goal");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api().projectsCreate({
        title: title.trim(),
        goalId,
        domainSlug: domainValue || null,
        bodyMarkdown,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetComposer();
      await load();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (busy || !editingId) return;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!goalId) {
      setError("Pick a goal");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api().projectsUpdate(editingId, {
        title: title.trim(),
        bodyMarkdown,
        goalId,
        domainSlug: domainValue || null,
        status,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetComposer();
      await load();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save project");
    } finally {
      setBusy(false);
    }
  }

  const editing = editingId ? projects.find((p) => p.id === editingId) ?? null : null;

  return (
    <div className="projects-page">
      <header className="act-page__header">
        <div>
          <p className="act-page__eyebrow muted">Plan</p>
          <h1 className="act-page__title">Projects</h1>
        </div>
      </header>
      <p className="muted">
        A project is one markdown document in the vault, linked to a goal. You
        edit it directly here.
      </p>

      {loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <section className="act-page__section">
        <h2 className="act-page__section-title">
          {editing ? `Edit — ${editing.title}` : "New project"}
        </h2>
        <div className="act-run__agent-field">
          <label className="field">
            <span>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Project title"
            />
          </label>
          <label className="field">
            <span>Goal</span>
            <select
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              aria-label="Project goal"
            >
              <option value="">Pick a goal</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Domain</span>
            <select
              value={domainValue}
              onChange={(e) => {
                setDomainValue(e.target.value);
                setDomainDirty(true);
              }}
              aria-label="Project domain"
            >
              <option value="">Unassigned</option>
              {liveDomains.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.meta.name}
                </option>
              ))}
            </select>
          </label>
          {editing ? (
            <label className="field">
              <span>Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                aria-label="Project status"
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>Notes</span>
            <textarea
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              rows={4}
              aria-label="Project notes"
            />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="act-page__section-head">
            {editing ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onSave()}
                disabled={busy}
              >
                Save
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onCreate()}
                disabled={busy}
              >
                Create
              </button>
            )}
            {editing ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetComposer}
                disabled={busy}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="act-page__section">
        <div className="act-page__section-head">
          <h2 className="act-page__section-title">All projects</h2>
          <label className="field">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Project status filter"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        {listed.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <ul className="act-activity-list">
            {listed.map((project) => (
              <li key={project.id} className="act-activity-row">
                <button
                  type="button"
                  className="task-card-title"
                  onClick={() => openEdit(project)}
                >
                  {project.title}
                </button>
                <span className="act-activity-row__type">
                  {project.status === "closed" ? "Closed" : "Open"}
                </span>
                <span className="act-activity-row__summary">
                  {domainName(project.domainSlug)} · {goalName(project.goalId)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
