import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  FolderKanban,
  MoreVertical,
  PencilLine,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import { weekOptions } from "../architecture/weekList";
import type {
  MapCommand,
  StoreState,
  Task,
  TaskColumn,
  TaskLinks,
} from "@lifequest/vault-core/map";
import { resolveWeek } from "@lifequest/vault-core/map";
import type { Goal, Project } from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { groupTasks } from "./groupTasks";

type Props = {
  state: StoreState;
  goals: Goal[];
  projects: Project[];
  onCommand: (command: MapCommand) => void;
  initialOpenId?: string | null;
};

const COLUMNS: { id: TaskColumn; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "this-week", label: "This week" },
  { id: "today", label: "Today" },
  { id: "done", label: "Done" },
];

function openGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => g.status === "open");
}

function goalPickerOptions(
  goals: Goal[],
  currentId: string | undefined,
): { id: string; label: string }[] {
  const options = openGoals(goals).map((g) => ({ id: g.id, label: g.name }));
  if (!currentId) return options;
  if (options.some((g) => g.id === currentId)) return options;
  const found = goals.find((g) => g.id === currentId);
  if (!found) {
    options.push({ id: currentId, label: `${currentId} (missing)` });
  } else if (found.status === "done") {
    options.push({ id: found.id, label: `${found.name} (done)` });
  }
  return options;
}

function projectPickerOptions(
  projects: Project[],
  currentId: string | undefined,
): { id: string; label: string }[] {
  const options = projects.map((p) => ({ id: p.id, label: p.title }));
  if (!currentId) return options;
  if (options.some((p) => p.id === currentId)) return options;
  // Tasks may already hold a dangling projectId, same as a dangling goalId.
  options.push({ id: currentId, label: `${currentId} (missing)` });
  return options;
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

/** "Oct 22" — a card's date is a glance, not a timestamp. */
function formatTaskDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * The week item a task points at, by its own text.
 *
 * A card says what it is linked TO, not the id it links to: "Draft the brief" is
 * legible on the board in a way that `item-3f2a` is not. A dangling link falls
 * back to the chip's generic label, and the missing-link mark beside it says the
 * rest.
 */
function weekItemText(
  state: StoreState,
  link: { year: number; monday: string; itemId: string },
): string | null {
  const label =
    resolvedWeekItems(state, link.year, link.monday).find(
      (item) => item.id === link.itemId,
    )?.label ?? null;
  // The picker marks weekly items so they are distinguishable from a day's own
  // item; on a card the chip already sits under "Weekly review", and the suffix
  // was only truncating the words that matter.
  return label?.replace(/\s*\(weekly\)$/, "") ?? null;
}

function patchLinks(task: Task, patch: TaskLinks): TaskLinks {
  const next: TaskLinks = { ...task.links, ...patch };
  if ("goalId" in patch && !patch.goalId) delete next.goalId;
  // A project link survives a goal change; clearing the select removes it.
  if ("projectId" in patch && !patch.projectId) delete next.projectId;
  if ("date" in patch && !patch.date) delete next.date;
  if ("weekItem" in patch && !patch.weekItem) delete next.weekItem;
  return next;
}

export function TaskBoard({
  state,
  goals,
  projects,
  onCommand,
  initialOpenId = null,
}: Props) {
  const grouped = useMemo(() => groupTasks(state.tasks), [state.tasks]);
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialOpenId) return;
    if (state.tasks.some((t) => t.id === initialOpenId)) {
      setOpenId(initialOpenId);
    }
  }, [initialOpenId, state.tasks]);

  function create() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onCommand({ type: "createTask", title: trimmed });
    setTitle("");
  }

  const total = state.tasks.length;

  return (
    <section className="task-board" aria-labelledby="task-board-title">
      <div className="task-board__head">
        <div className="task-board__heading">
          <h2 id="task-board-title">Tasks</h2>
          <span
            className="task-board__count"
            title={`${total} task${total === 1 ? "" : "s"}`}
          >
            {total}
          </span>
        </div>
        <form
          className="task-create"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="New task title"
            placeholder="Add a task…"
            autoComplete="off"
          />
          <Button
            type="submit"
            variant="primary"
            className="task-create__add"
            disabled={!title.trim()}
          >
            <Plus size={15} aria-hidden /> Add task
          </Button>
        </form>
      </div>

      <div className="task-columns">
        {COLUMNS.map((col) => {
          const tasks = grouped[col.id];
          return (
            <section
              key={col.id}
              className="task-column"
              data-column={col.id}
              aria-label={`${col.label}, ${tasks.length} task${
                tasks.length === 1 ? "" : "s"
              }`}
            >
              <header className="task-column__head">
                <span className="task-column__dot" aria-hidden />
                <h3 className="task-column__title">{col.label}</h3>
                <span className="task-column__count">{tasks.length}</span>
              </header>
              {tasks.length === 0 ? (
                <p className="task-empty">No tasks</p>
              ) : (
                <ul className="task-list">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <TaskCard
                        task={task}
                        open={openId === task.id}
                        goals={goals}
                        projects={projects}
                        missingGoal={
                          Boolean(task.links.goalId) &&
                          !goals.some((g) => g.id === task.links.goalId)
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
          );
        })}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  open,
  goals,
  projects,
  missingGoal,
  missingWeekItem,
  state,
  onToggle,
  onCommand,
}: {
  task: Task;
  open: boolean;
  goals: Goal[];
  projects: Project[];
  missingGoal: boolean;
  missingWeekItem: boolean;
  state: StoreState;
  onToggle: () => void;
  onCommand: (command: MapCommand) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const goal = task.links.goalId
    ? goals.find((g) => g.id === task.links.goalId)
    : undefined;
  const project = task.links.projectId
    ? projects.find((p) => p.id === task.links.projectId)
    : undefined;
  const missingProject = Boolean(task.links.projectId) && !project;
  const weekText = task.links.weekItem
    ? weekItemText(state, task.links.weekItem)
    : null;
  const notes = task.notes.trim();

  return (
    <article
      className={`task-card${open ? " is-open" : ""}${
        menuOpen ? " is-menu-open" : ""
      }`}
      data-task-id={task.id}
    >
      <div className="task-card__head">
        <button
          type="button"
          className="task-card__title"
          onClick={onToggle}
          aria-expanded={open}
        >
          {task.title}
        </button>
        <TaskCardMenu
          task={task}
          open={menuOpen}
          detailsOpen={open}
          onToggle={() => setMenuOpen((value) => !value)}
          onClose={() => setMenuOpen(false)}
          onEdit={onToggle}
          onDelete={() => onCommand({ type: "deleteTask", id: task.id })}
        />
      </div>

      {task.links.goalId ||
      task.links.projectId ||
      task.links.date ||
      task.links.weekItem ? (
        <div className="task-card__meta">
          {task.links.goalId ? (
            <TaskChip
              icon={<Target size={11} aria-hidden />}
              label={goal?.name ?? "Missing goal"}
              danger={missingGoal}
              title={
                missingGoal
                  ? "This task points at a goal that no longer exists"
                  : "Linked goal"
              }
            />
          ) : null}
          {task.links.projectId ? (
            <TaskChip
              icon={<FolderKanban size={11} aria-hidden />}
              label={project?.title ?? "Missing project"}
              danger={missingProject}
              title={
                missingProject
                  ? "This task points at a project that no longer exists"
                  : "Linked project"
              }
            />
          ) : null}
          {task.links.date ? (
            <TaskChip
              icon={<CalendarDays size={11} aria-hidden />}
              label={formatTaskDate(task.links.date)}
              title="Scheduled date"
            />
          ) : null}
          {task.links.weekItem ? (
            <TaskChip
              icon={<CalendarRange size={11} aria-hidden />}
              label={weekText ?? "Week item"}
              danger={missingWeekItem}
              title={
                missingWeekItem
                  ? "This task points at a week item that no longer exists"
                  : "Linked week item"
              }
            />
          ) : null}
        </div>
      ) : null}

      {!open && notes ? <p className="task-card__notes">{notes}</p> : null}

      {open ? (
        <TaskEditor
          task={task}
          goals={goals}
          projects={projects}
          missingWeekItem={missingWeekItem}
          state={state}
          onCommand={onCommand}
        />
      ) : null}
    </article>
  );
}

/** One metadata pill under a card's title. */
function TaskChip({
  icon,
  label,
  danger = false,
  title,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  title: string;
}) {
  return (
    <span
      className={`task-chip${danger ? " task-chip--danger" : ""}`}
      title={title}
    >
      {danger ? <AlertTriangle size={11} aria-hidden /> : icon}
      <span className="task-chip__label">{label}</span>
    </span>
  );
}

/**
 * The card's own 3-dot menu.
 *
 * The card's destructive action lives here rather than as a bare "Delete" beside
 * the title: deleting is irreversible, so it belongs one deliberate step behind a
 * menu, and the card's face stays a reading surface. Edit details is the same
 * gesture as the title (open the card), offered where an operator looks for
 * actions; Delete wears the destructive ink.
 *
 * The popup floats over the columns below instead of taking part in layout —
 * the board is a grid, so an inline menu would push its own card's neighbours
 * around. Escape and a press outside close it, and Escape puts focus back on the
 * control that opened it, so the menu is dismissible without the pointer.
 */
function TaskCardMenu({
  task,
  open,
  detailsOpen,
  onToggle,
  onClose,
  onEdit,
  onDelete,
}: {
  task: Task;
  open: boolean;
  detailsOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    // Opening with the pointer should not steal focus, but a keyboard open has
    // to land on the first item: the trigger's click cannot tell the two apart,
    // so the menu focuses its first item only when it was opened from the key.
    if (triggerRef.current?.matches(":focus-visible")) {
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  function run(action: () => void) {
    onClose();
    action();
  }

  return (
    <div className="task-card__actions" ref={wrapRef} data-task-actions>
      <button
        type="button"
        ref={triggerRef}
        className="task-card__menu-btn"
        aria-label={`${task.title} actions`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Task actions"
        data-testid="task-menu-toggle"
        onClick={onToggle}
      >
        <MoreVertical size={15} aria-hidden />
      </button>
      {open ? (
        <div
          className="task-card__menu"
          role="menu"
          ref={menuRef}
          data-testid="task-menu"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="task-menu-edit"
            onClick={() => run(onEdit)}
          >
            <PencilLine size={13} aria-hidden />
            {detailsOpen ? "Hide details" : "Edit details"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="task-card__menu-danger"
            data-testid="task-menu-delete"
            onClick={() => run(onDelete)}
          >
            <Trash2 size={13} aria-hidden />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TaskEditor({
  task,
  goals,
  projects,
  missingWeekItem,
  state,
  onCommand,
}: {
  task: Task;
  goals: Goal[];
  projects: Project[];
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

  const selectedGoal = task.links.goalId ?? "";
  const pickerGoals = goalPickerOptions(goals, task.links.goalId);
  const selectedProject = task.links.projectId ?? "";
  const pickerProjects = projectPickerOptions(projects, task.links.projectId);

  return (
    <div className="task-editor">
      <label className="task-editor__field task-editor__field--wide">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          aria-label={`${task.title} notes`}
        />
      </label>
      <label className="task-editor__field">
        Column
        <select
          value={task.column}
          aria-label={`${task.title} column`}
          onChange={(e) => {
            const column = e.target.value as TaskColumn;
            if (column !== task.column) {
              onCommand({ type: "updateTask", id: task.id, column });
            }
          }}
        >
          {COLUMNS.map((col) => (
            <option key={col.id} value={col.id}>
              {col.label}
            </option>
          ))}
        </select>
      </label>
      <label className="task-editor__field">
        Goal
        <select
          value={selectedGoal}
          aria-label={`${task.title} goal`}
          onChange={(e) => {
            const goalId = e.target.value || undefined;
            onCommand({
              type: "updateTask",
              id: task.id,
              links: patchLinks(task, { goalId }),
            });
          }}
        >
          <option value="">None</option>
          {pickerGoals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <label className="task-editor__field">
        Project
        <select
          value={selectedProject}
          aria-label={`${task.title} project`}
          onChange={(e) => {
            const projectId = e.target.value || undefined;
            onCommand({
              type: "updateTask",
              id: task.id,
              links: patchLinks(task, { projectId }),
            });
          }}
        >
          <option value="">None</option>
          {pickerProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="task-editor__field">
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
        <label className="task-editor__field">
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
        <label className="task-editor__field">
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
        <label className="task-editor__field">
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
