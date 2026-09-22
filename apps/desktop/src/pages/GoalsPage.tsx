import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  currentPeriod,
  filterByLens,
  lensSlug,
  type Goal,
  type GoalStatus,
  type GoalsCommand,
  type ReviewCadence,
} from "@lifequest/vault-core/pure";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/ipc";
import { useChatDock } from "@/state/ChatDockProvider";
import { useVault } from "@/state/VaultProvider";

type StatusFilter = "open" | "done" | "all";
type GoalShape = "numeric" | "done";

function shapeOf(goal: Goal): GoalShape {
  if (goal.definitionOfDone) return "done";
  return "numeric";
}

function domainLabel(
  slug: string | null,
  domains: { slug: string; meta: { name: string } }[],
): string {
  if (!slug) return "Unassigned";
  return domains.find((d) => d.slug === slug)?.meta.name ?? "Unassigned";
}

function truncateNotes(notes: string): string {
  const trimmed = notes.trim();
  if (trimmed.length <= 140) return trimmed;
  return `${trimmed.slice(0, 137).trimEnd()}…`;
}

export default function GoalsPage() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [domainValue, setDomainValue] = useState("");
  const [status, setStatus] = useState<GoalStatus>("open");
  const [deadline, setDeadline] = useState("");
  const [shape, setShape] = useState<GoalShape>("numeric");
  const [metric, setMetric] = useState("");
    const [target, setTarget] = useState("");
    const [current, setCurrent] = useState("");
    const [definitionOfDone, setDefinitionOfDone] = useState("");
    const [domainDirty, setDomainDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<ReviewCadence>("weekly");
  const chatDock = useChatDock();
  const weekStartDay = snapshot?.settings.weekStartDay ?? "monday";

  const liveDomains = useMemo(
    () =>
      (snapshot?.domains ?? [])
        .filter((d) => !d.meta.archivedAt)
        .slice()
        .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder),
    [snapshot],
  );

  const defaultDomain = useCallback((): string => {
    return lensSlug(lens) ?? "";
  }, [lens]);

  const resetComposer = useCallback(() => {
    setEditingId(null);
    setName("");
    setNotes("");
    setStatus("open");
    setDeadline("");
    setShape("numeric");
    setMetric("");
        setTarget("");
        setCurrent("");
        setDefinitionOfDone("");
        setDomainDirty(false);
    setDomainValue(defaultDomain());
  }, [defaultDomain]);

  useEffect(() => {
    if (editingId || domainDirty) return;
    setDomainValue(defaultDomain());
  }, [defaultDomain, domainDirty, editingId]);

  const goals = snapshot?.goals ?? [];
  const visible = useMemo(() => filterByLens(goals, lens), [goals, lens]);
  const listed = useMemo(
    () =>
      statusFilter === "all"
        ? visible
        : visible.filter((g) => g.status === statusFilter),
    [statusFilter, visible],
  );

  const pickerDomains = useMemo(() => {
    const live = liveDomains.map((d) => ({ slug: d.slug, name: d.meta.name }));
    if (!editingId) return live;
    const current = goals.find((g) => g.id === editingId)?.domainSlug ?? null;
    if (!current || live.some((d) => d.slug === current)) return live;
    const stored = snapshot?.domains.find((d) => d.slug === current);
    return [
      ...live,
      { slug: current, name: stored?.meta.name ?? current },
    ];
  }, [editingId, goals, liveDomains, snapshot]);

  const eventsByGoal = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of snapshot?.map?.years.flatMap((y) => y.events) ?? []) {
      if (!event.goalId) continue;
      counts.set(event.goalId, (counts.get(event.goalId) ?? 0) + 1);
    }
    return counts;
  }, [snapshot]);

  const goalsError = snapshot?.goalsError ?? null;
  const domainName =
    lens.kind === "domain"
      ? (snapshot?.domains.find((d) => d.slug === lens.slug)?.meta.name ??
        lens.slug)
      : null;

  function openEdit(goal: Goal) {
    if (busy) return;
    setEditingId(goal.id);
    setName(goal.name);
    setNotes(goal.notes);
    setStatus(goal.status);
    setDomainValue(goal.domainSlug ?? "");
    setDeadline(goal.deadline ?? "");
    setShape(shapeOf(goal));
    setMetric(goal.metric ?? "");
        setTarget(goal.target === null ? "" : String(goal.target));
        setCurrent(goal.current === null || goal.current === undefined ? "" : String(goal.current));
        setDefinitionOfDone(goal.definitionOfDone ?? "");
        setDomainDirty(true);
    setError(null);
  }

  async function apply(command: GoalsCommand): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await api().goalsApply(command);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply goal");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    const domainSlug = domainValue === "" ? null : domainValue;
    const deadlineValue = deadline.trim() === "" ? null : deadline.trim();
    const measure =
          shape === "numeric"
            ? {
                metric: metric.trim() === "" ? null : metric.trim(),
                target: target.trim() === "" ? null : Number(target),
                current:
                  current.trim() === ""
                    ? null
                    : Number(current),
                definitionOfDone: null as string | null,
              }
            : {
                metric: null as string | null,
                target: null as number | null,
                current: null as number | null,
                definitionOfDone:
                  definitionOfDone.trim() === "" ? null : definitionOfDone.trim(),
              };
        if (editingId) {
          const existing = goals.find((g) => g.id === editingId);
          const patch: Extract<GoalsCommand, { type: "updateGoal" }> = {
            type: "updateGoal",
            id: editingId,
            name: trimmed,
            notes,
            status,
            deadline: deadlineValue,
            metric: measure.metric,
            target: measure.target,
            current: measure.current,
            definitionOfDone: measure.definitionOfDone,
          };
          if ((existing?.domainSlug ?? null) !== domainSlug) {
            patch.domainSlug = domainSlug;
          }
          const saved = await apply(patch);
          if (saved) resetComposer();
          return;
        }
        const ok = await apply({
          type: "createGoal",
          name: trimmed,
          notes,
          domainSlug,
          deadline: deadlineValue,
          metric: measure.metric,
          target: measure.target,
          current: measure.current,
          definitionOfDone: measure.definitionOfDone,
        });
    if (ok) resetComposer();
  }

  async function onDelete() {
    if (!editingId || busy) return;
    if (!window.confirm("Delete this goal?")) return;
    const ok = await apply({ type: "deleteGoal", id: editingId });
    if (ok) resetComposer();
  }

  const onPlanThis = useCallback(async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const period = currentPeriod(cadence, weekStartDay);
      const scope =
        lens.kind === "domain" && lens.slug ? lens.slug : "overall";
      const plan = await api().planningStartOrResume(cadence, period, scope);
      if (!plan.ok) {
        setError(plan.error);
        return;
      }
      const kickoff = plan.value.created ? plan.value.kickoff : undefined;
      chatDock.requestSession(plan.value.sessionId, kickoff);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [cadence, chatDock, lens, snapshot, weekStartDay]);

  if (!snapshot) {
    return <p className="muted">Loading goals…</p>;
  }

  return (
    <div className="goals-page">
      <header className="goals-page__header">
        <h1 className="stub-page__title">Goals</h1>
        <p className="stub-page__desc muted">
          Vault-wide outcomes. A deadline and either a metric or a definition of
          done live on the goal.
        </p>
        <div className="goals-page__plan">
          <div
            className="ui-segmented goals-page__cadence"
            role="radiogroup"
            aria-label="Plan cadence"
          >
            {(
              [
                ["weekly", "Weekly"],
                ["monthly", "Monthly"],
                ["quarterly", "Quarterly"],
                ["yearly", "Yearly"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={cadence === value}
                className={`ui-segmented__option${cadence === value ? " is-active" : ""}`}
                onClick={() => setCadence(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={onPlanThis} disabled={busy}>
            Plan this period
          </Button>
        </div>
      </header>

      {goalsError ? (
        <p className="form-error" role="alert">
          {goalsError}
        </p>
      ) : null}

      <div
        className="ui-segmented goals-page__filters"
        role="radiogroup"
        aria-label="Goal status"
      >
        {(
          [
            ["open", "Open"],
            ["done", "Done"],
            ["all", "All"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={statusFilter === value}
            className={`ui-segmented__option${statusFilter === value ? " is-active" : ""}`}
            onClick={() => setStatusFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {!goalsError ? (
        <form className="goals-page__composer" onSubmit={(e) => void onSubmit(e)}>
          <label className="field">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="field">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </label>
          <label className="field">
            Domain
            <select
              value={domainValue}
              onChange={(e) => {
                setDomainDirty(true);
                setDomainValue(e.target.value);
              }}
            >
              <option value="">Unassigned</option>
              {pickerDomains.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Deadline
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>
          <div
            className="ui-segmented goals-page__shape"
            role="radiogroup"
            aria-label="Goal measure"
          >
            {(
              [
                ["numeric", "Metric"],
                ["done", "Definition of done"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={shape === value}
                className={`ui-segmented__option${shape === value ? " is-active" : ""}`}
                onClick={() => setShape(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {shape === "numeric" ? (
                      <div className="goals-page__measure">
                        <label className="field">
                          Metric
                          <input
                            value={metric}
                            onChange={(e) => setMetric(e.target.value)}
                            placeholder="km, pages, sessions"
                          />
                        </label>
                        <label className="field">
                          Current
                          <input
                            type="number"
                            value={current}
                            onChange={(e) => setCurrent(e.target.value)}
                            placeholder="0"
                          />
                        </label>
                        <label className="field">
                          Target
                          <input
                            type="number"
                            value={target}
                            onChange={(e) => setTarget(e.target.value)}
                          />
                        </label>
                      </div>
                    ) : (
            <label className="field">
              Definition of done
              <textarea
                value={definitionOfDone}
                onChange={(e) => setDefinitionOfDone(e.target.value)}
                rows={3}
              />
            </label>
          )}
          {editingId ? (
            <label className="field">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as GoalStatus)}
              >
                <option value="open">Open</option>
                <option value="done">Done</option>
              </select>
            </label>
          ) : null}
          <div className="goals-page__actions">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !name.trim()}
            >
              {editingId ? "Save" : "Add"}
            </Button>
            {editingId ? (
              <>
                <Button
                  type="button"
                  onClick={resetComposer}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  destructive
                  onClick={() => void onDelete()}
                  disabled={busy}
                >
                  Delete
                </Button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {goalsError ? null : visible.length === 0 ? (
        <p className="muted">
          {lens.kind === "overview"
            ? "No goals yet."
            : `No goals in ${domainName}.`}
        </p>
      ) : listed.length === 0 ? (
        <p className="muted">
          {statusFilter === "done" ? "No done goals." : "No open goals."}
        </p>
      ) : (
        <ul className="goals-page__list">
          {listed.map((goal) => {
            const count = eventsByGoal.get(goal.id) ?? 0;
            return (
              <li key={goal.id}>
                <button
                  type="button"
                  className={
                    editingId === goal.id
                      ? "goals-page__row is-selected"
                      : "goals-page__row"
                  }
                  onClick={() => openEdit(goal)}
                  disabled={busy}
                >
                  <span className="goals-page__row-name">{goal.name}</span>
                  <span className="goals-page__row-meta">
                    <span>{goal.status === "done" ? "Done" : "Open"}</span>
                    <span>{domainLabel(goal.domainSlug, snapshot.domains)}</span>
                    {goal.deadline ? <span>{goal.deadline}</span> : null}
                    {goal.metric && goal.target !== null ? (
                                          <span>
                                            {goal.current ?? 0}/{goal.target} {goal.metric}
                                          </span>
                                        ) : null}
                    {goal.definitionOfDone ? (
                      <span>{truncateNotes(goal.definitionOfDone)}</span>
                    ) : null}
                    <span>{count} events</span>
                  </span>
                  {goal.notes.trim() ? (
                    <span className="goals-page__row-notes muted">
                      {truncateNotes(goal.notes)}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
