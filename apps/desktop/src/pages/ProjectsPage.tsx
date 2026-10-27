import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  lensSlug,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  recordVisible,
  type Project,
  type ProjectPriority,
  type ProjectStatus,
} from "@lifequest/vault-core/pure";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
import { Button } from "@/components/ui/Button";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { api } from "@/lib/ipc";
import {
  formatProjectDay,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/projects";
import { useLiveData } from "@/state/LiveDataProvider";
import { useVault } from "@/state/VaultProvider";

/**
 * Execute · Projects.
 *
 * A Project is not a database the operator has to build first: every vault ships
 * with the schema, one markdown file per project, and the body is its context
 * document. This page is the register — the rows say where each project stands
 * and open the project's own page, which is where the work around it collates.
 *
 * KAR-7: an operator write here goes straight to the vault; no Decision.
 */

type StatusFilter = "all" | ProjectStatus;

type Composer = {
  title: string;
  summary: string;
  goalId: string;
  domainSlug: string;
  status: ProjectStatus;
  priority: "" | ProjectPriority;
  startDate: string;
  targetDate: string;
  nextAction: string;
  stateNote: string;
  context: string;
};

function emptyComposer(domainSlug: string): Composer {
  return {
    title: "",
    summary: "",
    goalId: "",
    domainSlug,
    status: "open",
    priority: "",
    startDate: "",
    targetDate: "",
    nextAction: "",
    stateNote: "",
    context: "",
  };
}

export default function ProjectsPage() {
  const { snapshot, refresh, reloadGeneration } = useVault();
  const lens = useDomainLens();
  const liveRevision = useLiveData();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [domainDirty, setDomainDirty] = useState(false);
  const [composer, setComposer] = useState<Composer>(() =>
    emptyComposer(lensSlug(lens) ?? ""),
  );
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
  }, [load, reloadGeneration, liveRevision]);

  // The domain lens is the app's, not a second filter on the page: Overview shows
  // every project, a domain lens shows that domain's own.
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

  const domainName = useCallback(
    (slugValue: string | null): string => {
      if (!slugValue) return "Unassigned";
      return (
        snapshot?.domains.find((d) => d.slug === slugValue)?.meta.name ??
        slugValue
      );
    },
    [snapshot],
  );

  const goalLabel = useCallback(
    (id: string | null): string => {
      if (!id) return "No goal";
      const goal = goals.find((g) => g.id === id);
      return goal?.name ?? `${id} (missing)`;
    },
    [goals],
  );

  // Keep the composer's domain following the lens until the operator picks one.
  useEffect(() => {
    if (domainDirty) return;
    setComposer((prev) => ({ ...prev, domainSlug: lensSlug(lens) ?? "" }));
  }, [domainDirty, lens]);

  const setField = <K extends keyof Composer>(key: K, value: Composer[K]) => {
    setComposer((prev) => ({ ...prev, [key]: value }));
  };

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!composer.title.trim()) {
      setError("Title is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api().projectsCreate({
        title: composer.title.trim(),
        summary: composer.summary.trim(),
        bodyMarkdown: composer.context,
        stateNote: composer.stateNote.trim(),
        goalId: composer.goalId || null,
        domainSlug: composer.domainSlug || null,
        status: composer.status,
        priority: composer.priority || null,
        startDate: composer.startDate || null,
        targetDate: composer.targetDate || null,
        nextAction: composer.nextAction.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setComposer(emptyComposer(lensSlug(lens) ?? ""));
      setDomainDirty(false);
      await refresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="projects-page" data-testid="projects-page">
      <header className="act-page__header">
        <div>
          <p className="act-page__eyebrow muted">Execute</p>
          <h1 className="act-page__title">Projects</h1>
        </div>
        <span className="muted projects-page__count">
          {visible.length === 1 ? "1 project" : `${visible.length} projects`}
        </span>
      </header>

      <p className="projects-page__intro muted">
        A project is a built-in vault document: one markdown file with a fixed
        set of attributes and a context page of its own. Open one to log
        progress and see the tasks, signals, Decisions and log lines gathered
        around it.
      </p>

      {loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="projects-page__toolbar">
        <div
          className="ui-segmented projects-page__filters"
          role="radiogroup"
          aria-label="Project status filter"
        >
          {(["all", ...PROJECT_STATUSES] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={statusFilter === value}
              className={`ui-segmented__option${statusFilter === value ? " is-active" : ""}`}
              onClick={() => setStatusFilter(value)}
              data-testid={`project-filter-${value}`}
            >
              {value === "all" ? "All" : PROJECT_STATUS_LABELS[value]}
            </button>
          ))}
        </div>
        <p className="muted projects-page__scope">
          {lens.kind === "overview"
            ? "Overview — every domain"
            : `Scoped to ${domainName(lens.slug)}`}
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="muted projects-page__empty" data-testid="projects-empty">
          No projects yet. Start one below — it becomes a markdown file in the
          vault the moment you create it.
        </p>
      ) : visible.length === 0 ? (
        <p className="muted projects-page__empty">
          No projects in {domainName(lens.kind === "domain" ? lens.slug : null)}.
        </p>
      ) : listed.length === 0 ? (
        <p className="muted projects-page__empty">
          No {statusFilter === "all" ? "" : `${statusFilter} `}projects.
        </p>
      ) : (
        <ul className="projects-list" aria-label="Projects">
          {listed.map((project) => (
            <li key={project.id} className="projects-list__item">
              <Link
                to={`/projects/${project.id}`}
                className="projects-row"
                data-testid="project-row"
                data-project-id={project.id}
                data-status={project.status}
              >
                <span className="projects-row__main">
                  <span className="projects-row__head">
                    <span className="projects-row__title">{project.title}</span>
                    <span
                      className={`projects-chip projects-chip--${project.status}`}
                    >
                      {PROJECT_STATUS_LABELS[project.status]}
                    </span>
                    {project.priority ? (
                      <span className="projects-row__priority muted">
                        {PROJECT_PRIORITY_LABELS[project.priority]}
                      </span>
                    ) : null}
                  </span>
                  {project.stateNote || project.summary ? (
                    <span className="projects-row__summary">
                      {project.stateNote || project.summary}
                    </span>
                  ) : null}
                  <span className="projects-row__meta">
                    <span>{goalLabel(project.goalId)}</span>
                    <span>{domainName(project.domainSlug)}</span>
                    {project.targetDate ? (
                      <span>Target {formatProjectDay(project.targetDate)}</span>
                    ) : null}
                    {project.nextAction ? (
                      <span className="projects-row__next">
                        Next: {project.nextAction}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span
                  className="projects-row__aside"
                  aria-label={`${project.progress}% complete`}
                >
                  <span className="projects-progress">
                    <span className="projects-progress__track" aria-hidden="true">
                      <span
                        className="projects-progress__fill"
                        style={{ width: `${project.progress}%` }}
                      />
                    </span>
                    <span className="projects-progress__value">
                      {project.progress}%
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="projects-page__section">
        <div className="projects-page__section-head">
          <h2 className="projects-page__section-title">New project</h2>
          <p className="muted projects-page__section-hint">
            Every attribute is optional except the title. A project can start
            before it is filed under a goal.
          </p>
        </div>
        <form
          className="projects-page__composer"
          onSubmit={(e) => void onCreate(e)}
          data-testid="project-create"
        >
          <div className="projects-page__grid">
            <label className="field projects-page__span2">
              <span>Title</span>
              <input
                value={composer.title}
                onChange={(e) => setField("title", e.target.value)}
                aria-label="Project title"
                data-testid="project-create-title"
                required
              />
            </label>
            <label className="field projects-page__span2">
              <span>Summary</span>
              <input
                value={composer.summary}
                onChange={(e) => setField("summary", e.target.value)}
                aria-label="Project summary"
                data-testid="project-create-summary"
                placeholder="One line: what this is"
              />
            </label>
            <label className="field">
              <span>Goal</span>
              <select
                value={composer.goalId}
                onChange={(e) => setField("goalId", e.target.value)}
                aria-label="Project goal"
                data-testid="project-create-goal"
              >
                <option value="">No goal</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.status === "done" ? `${goal.name} (done)` : goal.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Domain</span>
              <select
                value={composer.domainSlug}
                onChange={(e) => {
                  setDomainDirty(true);
                  setField("domainSlug", e.target.value);
                }}
                aria-label="Project domain"
                data-testid="project-create-domain"
              >
                <option value="">Unassigned</option>
                {liveDomains.map((domain) => (
                  <option key={domain.slug} value={domain.slug}>
                    {domain.meta.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select
                value={composer.status}
                onChange={(e) =>
                  setField("status", e.target.value as ProjectStatus)
                }
                aria-label="Project status"
                data-testid="project-create-status"
              >
                {PROJECT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {PROJECT_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Priority</span>
              <select
                value={composer.priority}
                onChange={(e) =>
                  setField("priority", e.target.value as "" | ProjectPriority)
                }
                aria-label="Project priority"
                data-testid="project-create-priority"
              >
                <option value="">No priority</option>
                {PROJECT_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {PROJECT_PRIORITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Start date</span>
              <input
                type="date"
                value={composer.startDate}
                onChange={(e) => setField("startDate", e.target.value)}
                aria-label="Project start date"
                data-testid="project-create-start"
              />
            </label>
            <label className="field">
              <span>Target date</span>
              <input
                type="date"
                value={composer.targetDate}
                onChange={(e) => setField("targetDate", e.target.value)}
                aria-label="Project target date"
                data-testid="project-create-target"
              />
            </label>
            <label className="field projects-page__span2">
              <span>Next action</span>
              <input
                value={composer.nextAction}
                onChange={(e) => setField("nextAction", e.target.value)}
                aria-label="Project next action"
                data-testid="project-create-next-action"
                placeholder="The one thing to do next"
              />
            </label>
            <label className="field projects-page__span2">
              <span>State note</span>
              <input
                value={composer.stateNote}
                onChange={(e) => setField("stateNote", e.target.value)}
                aria-label="Project state note"
                data-testid="project-create-state-note"
                placeholder="Where it stands right now"
              />
            </label>
          </div>

          <div className="field projects-page__context">
            <span>Context</span>
            <LiveMarkdownEditor
              value={composer.context}
              onChange={(next) => setField("context", next)}
              slug={composer.domainSlug || (lensSlug(lens) ?? "")}
              ariaLabel="Project context"
              placeholder="The project's own context document. Markdown, saved with the project."
              testId="project-create-context"
            />
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="projects-page__actions">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !composer.title.trim()}
              data-testid="project-create-submit"
            >
              {busy ? "Creating…" : "Create project"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
