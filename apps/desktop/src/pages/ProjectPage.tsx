import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type Project,
  type ProjectPriority,
  type ProjectStatus,
  type ProjectUpdatePatch,
  type SignalRecord,
} from "@lifequest/vault-core/pure";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/ipc";
import {
  formatProjectDay,
  formatProjectWhen,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_COLUMN_LABELS,
} from "@/lib/projects";
import { useLiveData } from "@/state/LiveDataProvider";
import { useVault } from "@/state/VaultProvider";

/**
 * Execute · one project — the central place a project lives.
 *
 * The header says where it stands; below it are the operator's own fields
 * (progress, context, attributes) and then everything the vault already knows
 * about this project: board tasks that point at it, the signals those tasks
 * carry, the Decisions filed against its id, and its life-log lines. One page,
 * one reading order — not a dashboard of cards.
 */

const DECISION_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

type Attrs = {
  title: string;
  summary: string;
  status: ProjectStatus;
  priority: "" | ProjectPriority;
  goalId: string;
  domainSlug: string;
  startDate: string;
  targetDate: string;
};

type Standing = {
  stateNote: string;
  nextAction: string;
};

const EMPTY_ATTRS: Attrs = {
  title: "",
  summary: "",
  status: "open",
  priority: "",
  goalId: "",
  domainSlug: "",
  startDate: "",
  targetDate: "",
};

function attrsFrom(project: Project): Attrs {
  return {
    title: project.title,
    summary: project.summary ?? "",
    status: project.status,
    priority: project.priority ?? "",
    goalId: project.goalId ?? "",
    domainSlug: project.domainSlug ?? "",
    startDate: project.startDate ?? "",
    targetDate: project.targetDate ?? "",
  };
}

function standingFrom(project: Project): Standing {
  return {
    stateNote: project.stateNote ?? "",
    nextAction: project.nextAction ?? "",
  };
}

/** The `id` a life-log event carries about the record it changed. */
function payloadId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function byNewest<T extends { createdAt: string }>(records: T[]): T[] {
  return records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Progress is a whole percent in 0–100; the engine refuses anything else. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.trunc(value)));
}

function clip(value: string, max = 180): string {
  const line = value.trim().replace(/\s+/g, " ");
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { snapshot, refresh, reloadGeneration } = useVault();
  const liveRevision = useLiveData();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const [attrs, setAttrs] = useState<Attrs>(EMPTY_ATTRS);
  const [standing, setStanding] = useState<Standing>({
    stateNote: "",
    nextAction: "",
  });
  const [progressDraft, setProgressDraft] = useState(0);
  const [progressNote, setProgressNote] = useState("");
  const [contextDraft, setContextDraft] = useState("");

  const load = useCallback(async () => {
    if (!id) {
      setPageError("Project id is missing from the address.");
      setProject(null);
      setLoading(false);
      return;
    }
    try {
      const result = await api().projectsGet(id);
      if (!result.ok) {
        setPageError(result.error);
        setProject(null);
        return;
      }
      setProject(result.value);
      setPageError(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Failed to load project");
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, reloadGeneration, liveRevision]);

  // The drafts follow the file when a different project is opened. A write this
  // page made syncs its own group explicitly; an unrelated live reload must not
  // throw away what the operator is typing.
  useEffect(() => {
    if (!project) return;
    setAttrs(attrsFrom(project));
    setStanding(standingFrom(project));
    setContextDraft(project.bodyMarkdown ?? "");
    setProgressDraft(project.progress ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api().signalChainList();
        setSignals(result.ok ? result.value.records : []);
      } catch {
        setSignals([]);
      }
    })();
  }, [reloadGeneration, liveRevision]);

  const goalLabel = useMemo(() => {
    if (!project?.goalId) return "No goal";
    const goal = (snapshot?.goals ?? []).find((g) => g.id === project.goalId);
    return goal?.name ?? `${project.goalId} (missing)`;
  }, [project?.goalId, snapshot]);

  const domainLabel = useMemo(() => {
    if (!project?.domainSlug) return "Unassigned";
    return (
      (snapshot?.domains ?? []).find((d) => d.slug === project.domainSlug)?.meta
        .name ?? project.domainSlug
    );
  }, [project?.domainSlug, snapshot]);

  const liveDomains = useMemo(
    () =>
      (snapshot?.domains ?? [])
        .filter((d) => !d.meta.archivedAt)
        .slice()
        .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder),
    [snapshot],
  );

  const tasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.links.projectId === id),
    [snapshot, id],
  );

  const signalsById = useMemo(
    () => new Map(signals.map((record) => [record.id, record])),
    [signals],
  );

  /** The signals this project's tasks carry — the Life-Chain read through them. */
  const linkedSignals = useMemo(() => {
    const seen = new Set<string>();
    const records: SignalRecord[] = [];
    for (const task of tasks) {
      const signalId = task.links.signalId;
      if (!signalId || seen.has(signalId)) continue;
      seen.add(signalId);
      const record = signalsById.get(signalId);
      if (record && !record.deletedAt) records.push(record);
    }
    return records;
  }, [tasks, signalsById]);

  const decisions = useMemo(
    () =>
      byNewest(
        (snapshot?.decisions ?? []).filter(
          (d) => d.target.type === "project" && d.target.id === id,
        ),
      ),
    [snapshot, id],
  );

  const logLines = useMemo(
    () =>
      byNewest(
        (snapshot?.log ?? []).filter((event) => payloadId(event.payload) === id),
      ),
    [snapshot, id],
  );

  const updates = useMemo(
    () => (project ? [...project.updates].reverse() : []),
    [project],
  );

  const attrsDirty =
    project !== null &&
    (attrs.title !== project.title ||
      attrs.summary !== (project.summary ?? "") ||
      attrs.status !== project.status ||
      attrs.priority !== (project.priority ?? "") ||
      attrs.goalId !== (project.goalId ?? "") ||
      attrs.domainSlug !== (project.domainSlug ?? "") ||
      attrs.startDate !== (project.startDate ?? "") ||
      attrs.targetDate !== (project.targetDate ?? ""));

  const standingDirty =
    project !== null &&
    (standing.stateNote !== (project.stateNote ?? "") ||
      standing.nextAction !== (project.nextAction ?? ""));

  const contextDirty = project !== null && contextDraft !== project.bodyMarkdown;

  async function save(patch: ProjectUpdatePatch): Promise<Project | null> {
    if (!project || busy) return null;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api().projectsUpdate(project.id, patch);
      if (!result.ok) {
        setActionError(result.error);
        return null;
      }
      setProject(result.value);
      await refresh();
      return result.value;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to save project");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onSaveAttrs(e: FormEvent) {
    e.preventDefault();
    if (!attrs.title.trim()) {
      setActionError("Title is required");
      return;
    }
    const next = await save({
      title: attrs.title.trim(),
      summary: attrs.summary.trim(),
      status: attrs.status,
      priority: attrs.priority || null,
      goalId: attrs.goalId || null,
      domainSlug: attrs.domainSlug || null,
      startDate: attrs.startDate || null,
      targetDate: attrs.targetDate || null,
    });
    if (next) setAttrs(attrsFrom(next));
  }

  async function onSaveStanding(e: FormEvent) {
    e.preventDefault();
    const next = await save({
      stateNote: standing.stateNote.trim(),
      nextAction: standing.nextAction.trim() || null,
    });
    if (next) setStanding(standingFrom(next));
  }

  async function onLogProgress() {
    if (!progressNote.trim()) {
      setActionError("Write a note with the progress you are logging.");
      return;
    }
    const next = await save({
      progress: progressDraft,
      addUpdate: { note: progressNote.trim(), progress: progressDraft },
    });
    if (next) {
      setProgressDraft(next.progress);
      setProgressNote("");
    }
  }

  async function onSaveContext() {
    const next = await save({ bodyMarkdown: contextDraft });
    if (next) setContextDraft(next.bodyMarkdown);
  }

  if (loading && !project) {
    return <p className="muted">Loading project…</p>;
  }

  if (!project) {
    return (
      <div className="project-detail" data-testid="project-detail">
        <Link to="/projects" className="project-detail__back" data-testid="project-back">
          ← Projects
        </Link>
        <p className="form-error" role="alert" data-testid="project-missing">
          {pageError ?? "Project not found."}
        </p>
      </div>
    );
  }

  return (
    <div className="project-detail" data-testid="project-detail">
      <Link to="/projects" className="project-detail__back" data-testid="project-back">
        ← Projects
      </Link>

      <header className="act-page__header project-detail__header">
        <div>
          <p className="act-page__eyebrow muted">Execute · Project</p>
          <h1 className="act-page__title" data-testid="project-title">
            {project.title}
          </h1>
        </div>
        <span
          className={`projects-chip projects-chip--${project.status}`}
          data-testid="project-status"
          data-status={project.status}
        >
          {PROJECT_STATUS_LABELS[project.status]}
        </span>
      </header>

      {project.summary ? (
        <p className="project-detail__summary muted">{project.summary}</p>
      ) : null}

      <div className="project-detail__meta">
        <span>{goalLabel}</span>
        <span>{domainLabel}</span>
        {project.priority ? (
          <span>{PROJECT_PRIORITY_LABELS[project.priority]}</span>
        ) : null}
        {project.startDate ? (
          <span>Started {formatProjectDay(project.startDate)}</span>
        ) : null}
        {project.targetDate ? (
          <span>Target {formatProjectDay(project.targetDate)}</span>
        ) : null}
        <span className="muted">
          Updated {formatProjectWhen(project.updatedAt)}
        </span>
      </div>

      {project.stateNote ? (
        <p className="project-detail__state-note">{project.stateNote}</p>
      ) : null}

      <div className="project-detail__next">
        <span className="project-detail__next-label">Next action</span>
        <span className="project-detail__next-text">
          {project.nextAction || "Nothing chosen yet."}
        </span>
      </div>

      <div
        className="project-detail__progress"
        data-testid="project-progress"
        data-value={project.progress}
      >
        <span className="project-detail__progress-caption muted">Progress</span>
        <span className="project-detail__progress-value">
          <span data-testid="project-progress-value">{project.progress}%</span>
        </span>
        <span className="projects-progress__track project-detail__bar">
          <span
            className="projects-progress__fill"
            style={{ width: `${project.progress}%` }}
          />
        </span>
      </div>

      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="project-detail__section">
        <div className="project-detail__section-head">
          <h2 className="project-detail__section-title">Where it stands</h2>
        </div>
        <form
          className="project-detail__standing"
          onSubmit={(e) => void onSaveStanding(e)}
        >
          <label className="field">
            <span>State note</span>
            <input
              value={standing.stateNote}
              onChange={(e) =>
                setStanding((prev) => ({ ...prev, stateNote: e.target.value }))
              }
              aria-label="Project state note"
              data-testid="project-state-note"
              placeholder="Where it stands right now, in your own words"
            />
          </label>
          <label className="field">
            <span>Next action</span>
            <input
              value={standing.nextAction}
              onChange={(e) =>
                setStanding((prev) => ({ ...prev, nextAction: e.target.value }))
              }
              aria-label="Project next action"
              data-testid="project-next-action"
              placeholder="The one thing to do next"
            />
          </label>
          <div className="project-detail__actions">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !standingDirty}
              data-testid="project-standing-save"
            >
              Save standing
            </Button>
          </div>
        </form>
      </section>

      <section
        className="project-detail__section"
        data-testid="project-progress-section"
      >
        <div className="project-detail__section-head">
          <h2 className="project-detail__section-title">Progress</h2>
          <p className="muted project-detail__section-hint">
            Each log line appends to this project's timeline and sets the
            percent in the same write.
          </p>
        </div>
        <div className="project-detail__progress-control">
          <label className="field project-detail__progress-number">
            <span>New percent</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={progressDraft}
              onChange={(e) => setProgressDraft(clampPercent(Number(e.target.value)))}
              aria-label="Progress percent to log"
              data-testid="project-progress-input"
            />
          </label>
          <span className="project-detail__progress-draft">{progressDraft}%</span>
        </div>
        <label className="field">
          <span>Note</span>
          <textarea
            value={progressNote}
            onChange={(e) => setProgressNote(e.target.value)}
            rows={2}
            aria-label="Progress note"
            data-testid="project-progress-note"
            placeholder="What moved since last time?"
          />
        </label>
        <div className="project-detail__actions">
          <Button
            variant="primary"
            onClick={() => void onLogProgress()}
            disabled={busy || !progressNote.trim()}
            data-testid="project-log-progress"
          >
            Log progress
          </Button>
        </div>

        {updates.length === 0 ? (
          <p className="muted project-detail__empty">
            No progress logged yet. The first note starts the timeline.
          </p>
        ) : (
          <ul className="project-detail__timeline" data-testid="project-timeline">
            {updates.map((update) => (
              <li
                key={update.id}
                className="project-detail__timeline-item"
                data-testid="project-update-row"
              >
                <time
                  className="project-detail__when muted"
                  dateTime={update.at}
                >
                  {formatProjectWhen(update.at)}
                </time>
                <span className="project-detail__timeline-note">
                  {update.note}
                </span>
                {update.progress !== null ? (
                  <span className="projects-chip projects-chip--progress">
                    {update.progress}%
                  </span>
                ) : null}
                {update.actorName ? (
                  <span className="project-detail__actor muted">
                    {update.actorName}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="project-detail__section">
        <div className="project-detail__section-head">
          <h2 className="project-detail__section-title">Context</h2>
          <p className="muted project-detail__section-hint">
            The project's own document — the markdown body of its file. The
            companion reads it with <code>get_project</code>.
          </p>
        </div>
        <LiveMarkdownEditor
          value={contextDraft}
          onChange={setContextDraft}
          slug={project.domainSlug ?? ""}
          ariaLabel="Project context"
          placeholder="Write the project's context here — the background, the shape of the work, what matters."
          testId="project-context"
        />
        <div className="project-detail__actions">
          <Button
            variant="primary"
            onClick={() => void onSaveContext()}
            disabled={busy || !contextDirty}
            data-testid="project-context-save"
          >
            Save context
          </Button>
          {contextDirty ? (
            <Button
              onClick={() => setContextDraft(project.bodyMarkdown)}
              disabled={busy}
            >
              Discard
            </Button>
          ) : null}
        </div>
      </section>

      <section className="project-detail__section" data-testid="project-details">
        <div className="project-detail__section-head">
          <h2 className="project-detail__section-title">Details</h2>
        </div>
        <form
          className="project-detail__grid"
          onSubmit={(e) => void onSaveAttrs(e)}
        >
          <label className="field project-detail__span2">
            <span>Title</span>
            <input
              value={attrs.title}
              onChange={(e) =>
                setAttrs((prev) => ({ ...prev, title: e.target.value }))
              }
              aria-label="Project title"
              data-testid="project-detail-title"
            />
          </label>
          <label className="field project-detail__span2">
            <span>Summary</span>
            <input
              value={attrs.summary}
              onChange={(e) =>
                setAttrs((prev) => ({ ...prev, summary: e.target.value }))
              }
              aria-label="Project summary"
              data-testid="project-detail-summary"
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={attrs.status}
              onChange={(e) =>
                setAttrs((prev) => ({
                  ...prev,
                  status: e.target.value as ProjectStatus,
                }))
              }
              aria-label="Project status"
              data-testid="project-detail-status"
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
              value={attrs.priority}
              onChange={(e) =>
                setAttrs((prev) => ({
                  ...prev,
                  priority: e.target.value as "" | ProjectPriority,
                }))
              }
              aria-label="Project priority"
              data-testid="project-detail-priority"
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
            <span>Goal</span>
            <select
              value={attrs.goalId}
              onChange={(e) =>
                setAttrs((prev) => ({ ...prev, goalId: e.target.value }))
              }
              aria-label="Project goal"
              data-testid="project-detail-goal"
            >
              <option value="">No goal</option>
              {(snapshot?.goals ?? []).map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.status === "done" ? `${goal.name} (done)` : goal.name}
                </option>
              ))}
              {attrs.goalId &&
              !(snapshot?.goals ?? []).some((g) => g.id === attrs.goalId) ? (
                <option value={attrs.goalId}>
                  {attrs.goalId} (missing)
                </option>
              ) : null}
            </select>
          </label>
          <label className="field">
            <span>Domain</span>
            <select
              value={attrs.domainSlug}
              onChange={(e) =>
                setAttrs((prev) => ({ ...prev, domainSlug: e.target.value }))
              }
              aria-label="Project domain"
              data-testid="project-detail-domain"
            >
              <option value="">Unassigned</option>
              {liveDomains.map((domain) => (
                <option key={domain.slug} value={domain.slug}>
                  {domain.meta.name}
                </option>
              ))}
              {attrs.domainSlug &&
              !liveDomains.some((d) => d.slug === attrs.domainSlug) ? (
                <option value={attrs.domainSlug}>
                  {attrs.domainSlug} (archived)
                </option>
              ) : null}
            </select>
          </label>
          <label className="field">
            <span>Start date</span>
            <input
              type="date"
              value={attrs.startDate}
              onChange={(e) =>
                setAttrs((prev) => ({ ...prev, startDate: e.target.value }))
              }
              aria-label="Project start date"
              data-testid="project-detail-start"
            />
          </label>
          <label className="field">
            <span>Target date</span>
            <input
              type="date"
              value={attrs.targetDate}
              onChange={(e) =>
                setAttrs((prev) => ({ ...prev, targetDate: e.target.value }))
              }
              aria-label="Project target date"
              data-testid="project-detail-target"
            />
          </label>
          <div className="project-detail__actions project-detail__span2">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !attrsDirty || !attrs.title.trim()}
              data-testid="project-save"
            >
              Save details
            </Button>
          </div>
        </form>
      </section>

      <h2 className="project-detail__group-title">Around this project</h2>

      <section className="project-detail__section" data-testid="project-tasks">
        <div className="project-detail__section-head">
          <h2 className="project-detail__section-title">Tasks</h2>
          <span className="muted project-detail__count">
            {tasks.length === 1 ? "1 task" : `${tasks.length} tasks`}
          </span>
        </div>
        {tasks.length === 0 ? (
          <p className="muted project-detail__empty">
            No tasks on the board point at this project yet. Link one from Act.
          </p>
        ) : (
          <ul className="act-activity-list">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="act-activity-row"
                data-testid="project-task-row"
              >
                <span className="act-activity-row__type">
                  {TASK_COLUMN_LABELS[task.column]}
                </span>
                <span className="act-activity-row__summary">
                  <Link
                    to={`/act?task=${encodeURIComponent(task.id)}`}
                    className="project-detail__row-link"
                  >
                    {task.title}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="project-detail__section" data-testid="project-signals">
        <div className="project-detail__section-head">
          <h2 className="project-detail__section-title">Signals</h2>
          <span className="muted project-detail__count">
            {linkedSignals.length === 1
              ? "1 signal"
              : `${linkedSignals.length} signals`}
          </span>
        </div>
        {linkedSignals.length === 0 ? (
          <p className="muted project-detail__empty">
            No signals are linked through this project's tasks yet.
          </p>
        ) : (
          <ul className="act-activity-list">
            {linkedSignals.map((signal) => (
              <li
                key={signal.id}
                className="act-activity-row"
                data-testid="project-signal-row"
              >
                <span className="act-activity-row__type">{signal.type}</span>
                <span className="act-activity-row__summary">
                  {signal.title ? (
                    <strong className="project-detail__signal-title">
                      {signal.title}
                    </strong>
                  ) : null}
                  {signal.title ? " — " : null}
                  {clip(signal.body)}
                  <span className="project-detail__signal-meta muted">
                    {formatProjectWhen(signal.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="project-detail__section"
        data-testid="project-decisions"
      >
        <div className="project-detail__section-head">
          <h2 className="project-detail__section-title">Decisions</h2>
          <span className="muted project-detail__count">
            {decisions.length === 1
              ? "1 Decision"
              : `${decisions.length} Decisions`}
          </span>
        </div>
        {decisions.length === 0 ? (
          <p className="muted project-detail__empty">
            No Decisions have been filed for this project.
          </p>
        ) : (
          <ul className="act-activity-list">
            {decisions.map((decision) => (
              <li
                key={decision.id}
                className="act-activity-row"
                data-testid="project-decision-row"
              >
                <span className="act-activity-row__type">
                  {DECISION_STATUS_LABELS[decision.status] ?? decision.status}
                </span>
                <span className="act-activity-row__summary">
                  <Link
                    to="/decisions"
                    className="project-detail__row-link"
                  >
                    {decision.title}
                  </Link>
                  {decision.rationale ? (
                    <span className="muted"> — {clip(decision.rationale, 140)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="project-detail__section" data-testid="project-log">
        <div className="project-detail__section-head">
          <h2 className="project-detail__section-title">Activity</h2>
          <span className="muted project-detail__count">
            {logLines.length === 1 ? "1 entry" : `${logLines.length} entries`}
          </span>
        </div>
        {logLines.length === 0 ? (
          <p className="muted project-detail__empty">
            No life-log lines for this project yet.
          </p>
        ) : (
          <ul className="act-activity-list">
            {logLines.map((event) => (
              <li
                key={event.id}
                className="act-activity-row"
                data-testid="project-log-row"
              >
                <span className="act-activity-row__type">{event.type}</span>
                <span className="act-activity-row__summary">
                  {event.summary}
                  <span className="project-detail__signal-meta muted">
                    {formatProjectWhen(event.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
