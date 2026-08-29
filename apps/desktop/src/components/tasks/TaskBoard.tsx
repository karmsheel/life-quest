import { useEffect, useMemo, useState } from "react";
import { weekOptions } from "../architecture/weekList";
import type {
  MapCommand,
  PeriodGoal,
  StoreState,
  Task,
  TaskColumn,
  TaskLinks,
} from "@lifequest/vault-core/map";
import { resolveWeek } from "@lifequest/vault-core/map";
import { groupTasks } from "./groupTasks";

type Props = {
  state: StoreState;
  onCommand: (command: MapCommand) => void;
};

const COLUMNS: { id: TaskColumn; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "this-week", label: "This week" },
  { id: "today", label: "Today" },
  { id: "done", label: "Done" },
];

type GoalOption = { id: string; name: string; year: number };

function liveGoals(state: StoreState): GoalOption[] {
  return state.years
    .filter((y) => y.status === "live")
    .sort((a, b) => a.year - b.year)
    .flatMap((y) =>
      y.periodGoals.map((g: PeriodGoal) => ({
        id: g.id,
        name: g.name,
        year: y.year,
      })),
    );
}

function goalExists(state: StoreState, id: string): boolean {
  return state.years.some((y) => y.periodGoals.some((g) => g.id === id));
}

function findGoalName(state: StoreState, id: string): string | undefined {
  for (const y of state.years) {
    const g = y.periodGoals.find((goal) => goal.id === id);
    if (g) return g.name;
  }
  return undefined;
}

function weekHasLinkedItem(
  state: StoreState,
  link: { year: number; monday: string; itemId: string },
): boolean {
  if (!state.years.some((y) => y.year === link.year)) return false;
  const week = resolveWeek(state, link.year, link.monday);
  return (
    week.days.some((day) => day.some((i) => i.id === link.itemId)) ||
    week.weeklyItems.some((i) => i.id === link.itemId)
  );
}

function resolvedWeekItems(
  state: StoreState,
  year: number,
  monday: string,
): { id: string; label: string }[] {
  if (!monday || !state.years.some((y) => y.year === year)) return [];
  const week = resolveWeek(state, year, monday);
  return [
    ...week.days.flatMap((items) =>
      items.map((i) => ({ id: i.id, label: i.text })),
    ),
    ...week.weeklyItems.map((i) => ({
      id: i.id,
      label: `${i.text} (weekly)`,
    })),
  ];
}

function patchLinks(task: Task, patch: TaskLinks): TaskLinks {
  const next: TaskLinks = { ...task.links, ...patch };
  if ("periodGoalId" in patch && !patch.periodGoalId) delete next.periodGoalId;
  if ("date" in patch && !patch.date) delete next.date;
  if ("weekItem" in patch && !patch.weekItem) delete next.weekItem;
  return next;
}

export function TaskBoard({ state, onCommand }: Props) {
  const grouped = useMemo(() => groupTasks(state.tasks), [state.tasks]);
  const goals = useMemo(() => liveGoals(state), [state]);
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  function create() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onCommand({ type: "createTask", title: trimmed });
    setTitle("");
  }

  return (
    <section className="task-board">
      <h2>Tasks</h2>
      <form
        className="task-create"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label>
          New task
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="New task title"
          />
        </label>
        <button type="submit">New task</button>
      </form>
      <div className="task-columns">
        {COLUMNS.map((col) => (
          <section key={col.id} className="task-column">
            <h3>{col.label}</h3>
            {grouped[col.id].length === 0 ? (
              <p className="task-empty">No tasks.</p>
            ) : (
              <ul className="task-list">
                {grouped[col.id].map((task) => (
                  <li key={task.id}>
                    <TaskCard
                      task={task}
                      open={openId === task.id}
                      goals={goals}
                      missingGoal={
                        Boolean(task.links.periodGoalId) &&
                        !goalExists(state, task.links.periodGoalId!)
                      }
                      missingGoalName={
                        task.links.periodGoalId
                          ? findGoalName(state, task.links.periodGoalId)
                          : undefined
                      }
                      missingWeekItem={
                        Boolean(task.links.weekItem) &&
                        !weekHasLinkedItem(state, task.links.weekItem!)
                      }
                      state={state}
                      onToggle={() =>
                        setOpenId((id) => (id === task.id ? null : task.id))
                      }
                      onCommand={onCommand}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  open,
  goals,
  missingGoal,
  missingGoalName,
  missingWeekItem,
  state,
  onToggle,
  onCommand,
}: {
  task: Task;
  open: boolean;
  goals: GoalOption[];
  missingGoal: boolean;
  missingGoalName?: string;
  missingWeekItem: boolean;
  state: StoreState;
  onToggle: () => void;
  onCommand: (command: MapCommand) => void;
}) {
  function move(column: TaskColumn) {
    if (column !== task.column) {
      onCommand({ type: "updateTask", id: task.id, column });
    }
  }

  return (
    <article className={open ? "task-card is-open" : "task-card"}>
      <div className="task-card-head">
        <button type="button" className="task-card-title" onClick={onToggle}>
          {task.title}
        </button>
        <label>
          Column
          <select
            value={task.column}
            aria-label={`${task.title} column`}
            onChange={(e) => move(e.target.value as TaskColumn)}
          >
            {COLUMNS.map((col) => (
              <option key={col.id} value={col.id}>
                {col.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onCommand({ type: "deleteTask", id: task.id })}
        >
          Delete
        </button>
      </div>
      {(missingGoal || missingWeekItem) && (
        <p className="task-missing">missing link</p>
      )}
      {open && (
        <TaskEditor
          task={task}
          goals={goals}
          missingGoal={missingGoal}
          missingGoalName={missingGoalName}
          missingWeekItem={missingWeekItem}
          state={state}
          onCommand={onCommand}
        />
      )}
    </article>
  );
}

function TaskEditor({
  task,
  goals,
  missingGoal,
  missingGoalName,
  missingWeekItem,
  state,
  onCommand,
}: {
  task: Task;
  goals: GoalOption[];
  missingGoal: boolean;
  missingGoalName?: string;
  missingWeekItem: boolean;
  state: StoreState;
  onCommand: (command: MapCommand) => void;
}) {
  const [notes, setNotes] = useState(task.notes);
  const [date, setDate] = useState(task.links.date ?? "");
  const [weekYear, setWeekYear] = useState(
    task.links.weekItem ? String(task.links.weekItem.year) : "",
  );
  const [monday, setMonday] = useState(task.links.weekItem?.monday ?? "");
  const [itemId, setItemId] = useState(task.links.weekItem?.itemId ?? "");

  useEffect(() => {
    setNotes(task.notes);
    setDate(task.links.date ?? "");
    setWeekYear(task.links.weekItem ? String(task.links.weekItem.year) : "");
    setMonday(task.links.weekItem?.monday ?? "");
    setItemId(task.links.weekItem?.itemId ?? "");
  }, [task]);

  function commitNotes() {
    if (notes !== task.notes) {
      onCommand({ type: "updateTask", id: task.id, notes });
    }
  }

  function commitDate() {
    if (date !== (task.links.date ?? "")) {
      onCommand({
        type: "updateTask",
        id: task.id,
        links: patchLinks(task, { date: date || undefined }),
      });
    }
  }

  function commitWeekItem(nextYear: string, nextMonday: string, nextItem: string) {
    setWeekYear(nextYear);
    setMonday(nextMonday);
    setItemId(nextItem);
    const year = Number(nextYear);
    const next =
      nextYear && nextMonday && nextItem && Number.isFinite(year)
        ? { year, monday: nextMonday, itemId: nextItem }
        : undefined;
    const prev = task.links.weekItem;
    const same =
      (!next && !prev) ||
      (next &&
        prev &&
        next.year === prev.year &&
        next.monday === prev.monday &&
        next.itemId === prev.itemId);
    if (!same) {
      onCommand({
        type: "updateTask",
        id: task.id,
        links: patchLinks(task, { weekItem: next }),
      });
    }
  }

  const yearChoices = useMemo(
    () => [...state.years].sort((a, b) => a.year - b.year).map((y) => y.year),
    [state.years],
  );
  const mondayChoices = useMemo(() => {
    const y = Number(weekYear);
    return weekYear && Number.isFinite(y) ? weekOptions(y) : [];
  }, [weekYear]);
  const itemChoices = useMemo(() => {
    const y = Number(weekYear);
    if (!weekYear || !monday || !Number.isFinite(y)) return [];
    return resolvedWeekItems(state, y, monday);
  }, [state, weekYear, monday]);
  const mondayInPicker = mondayChoices.some((o) => o.monday === monday);
  const itemInPicker = itemChoices.some((i) => i.id === itemId);

  const selectedGoal = task.links.periodGoalId ?? "";
  const selectedInPicker = goals.some((g) => g.id === selectedGoal);

  return (
    <div className="task-editor">
      <label>
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          aria-label={`${task.title} notes`}
        />
      </label>
      <label>
        Period goal
        <select
          value={selectedGoal}
          aria-label={`${task.title} period goal`}
          onChange={(e) => {
            const periodGoalId = e.target.value || undefined;
            onCommand({
              type: "updateTask",
              id: task.id,
              links: patchLinks(task, { periodGoalId }),
            });
          }}
        >
          <option value="">None</option>
          {missingGoal && selectedGoal && (
            <option value={selectedGoal}>missing link</option>
          )}
          {!missingGoal && selectedGoal && !selectedInPicker && (
            <option value={selectedGoal}>{missingGoalName ?? selectedGoal}</option>
          )}
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.year})
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input
          type="date"
          value={date}
          aria-label={`${task.title} date`}
          onChange={(e) => setDate(e.target.value)}
          onBlur={commitDate}
        />
      </label>
      <fieldset className="task-week-item">
        <legend>Week item</legend>
        <label>
          Year
          <select
            value={weekYear}
            aria-label={`${task.title} week year`}
            onChange={(e) => commitWeekItem(e.target.value, "", "")}
          >
            <option value="">None</option>
            {missingWeekItem && weekYear && !yearChoices.includes(Number(weekYear)) && (
              <option value={weekYear}>missing link</option>
            )}
            {yearChoices.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label>
          Monday
          <select
            value={monday}
            aria-label={`${task.title} week Monday`}
            disabled={!weekYear}
            onChange={(e) => commitWeekItem(weekYear, e.target.value, "")}
          >
            <option value="">None</option>
            {missingWeekItem && monday && !mondayInPicker && (
              <option value={monday}>missing link</option>
            )}
            {mondayChoices.map((o) => (
              <option key={o.monday} value={o.monday}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Item
          <select
            value={itemId}
            aria-label={`${task.title} week item`}
            disabled={!weekYear || !monday}
            onChange={(e) => commitWeekItem(weekYear, monday, e.target.value)}
          >
            <option value="">None</option>
            {missingWeekItem && itemId && !itemInPicker && (
              <option value={itemId}>missing link</option>
            )}
            {itemChoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
    </div>
  );
}
