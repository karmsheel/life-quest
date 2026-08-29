import { useEffect, useMemo, useState } from "react";
import { addDays, mondayOnOrBefore, todayLocalIso } from "@lifequest/vault-core/map";
import { PALETTE } from "@lifequest/vault-core/map";
import { periodGoalsOnDate } from "@lifequest/vault-core/map";
import type {
  MapCommand,
  DayType,
  GridBlock,
  PeriodGoal,
  Priority,
  ResolvedWeek,
  StoreState,
  WeekItem,
  Weekday,
  YearRecord,
} from "@lifequest/vault-core/map";
import { resolveWeek } from "@lifequest/vault-core/map";
import { TypeSelect } from "./DefaultWeek";
import { weekOptions } from "./weekList";

const WEEKDAYS: { label: string; short: string; value: Weekday }[] = [
  { label: "Monday", short: "Mon", value: 0 },
  { label: "Tuesday", short: "Tue", value: 1 },
  { label: "Wednesday", short: "Wed", value: 2 },
  { label: "Thursday", short: "Thu", value: 3 },
  { label: "Friday", short: "Fri", value: 4 },
  { label: "Saturday", short: "Sat", value: 5 },
  { label: "Sunday", short: "Sun", value: 6 },
];

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "required", label: "required" },
  { value: "semi-optional", label: "semi-optional" },
  { value: "optional", label: "optional" },
];

const GRID_START = 360;
const GRID_END = 1320;
const SLOT = 30;

const SLOTS: number[] = [];
for (let m = GRID_START; m < GRID_END; m += SLOT) SLOTS.push(m);

type Props = {
  state: StoreState;
  year: YearRecord;
  onCommand: (command: MapCommand) => void;
};

function typesFor(state: StoreState, year: YearRecord): DayType[] {
  if (year.status === "archive" && year.snapshot) return year.snapshot.dayTypes;
  return state.dayTypes;
}

function defaultMonday(year: number): string {
  const opts = weekOptions(year);
  const todayMonday = mondayOnOrBefore(todayLocalIso());
  if (opts.some((o) => o.monday === todayMonday)) return todayMonday;
  return opts[0]?.monday ?? "";
}

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function blockAt(
  grid: GridBlock[],
  weekday: Weekday,
  start: number,
): GridBlock | undefined {
  return grid.find(
    (b) =>
      b.weekday === weekday &&
      start >= b.startMinutes &&
      start < b.startMinutes + b.durationMinutes,
  );
}

function itemLabel(week: ResolvedWeek, itemId: string): string {
  for (const day of week.days) {
    const found = day.find((i) => i.id === itemId);
    if (found) return found.text;
  }
  return week.weeklyItems.find((i) => i.id === itemId)?.text ?? itemId;
}

function weekGoals(year: YearRecord, monday: string): PeriodGoal[] {
  const seen = new Map<string, PeriodGoal>();
  for (let i = 0; i < 7; i++) {
    for (const goal of periodGoalsOnDate(year, addDays(monday, i))) {
      seen.set(goal.id, goal);
    }
  }
  return [...seen.values()];
}

export function RealWeek({ state, year, onCommand }: Props) {
  const readOnly = year.status === "archive";
  const types = typesFor(state, year);
  const options = useMemo(() => weekOptions(year.year), [year.year]);
  const [monday, setMonday] = useState(() => defaultMonday(year.year));
  const [placingId, setPlacingId] = useState("");

  useEffect(() => {
    setMonday(defaultMonday(year.year));
    setPlacingId("");
  }, [year.year]);

  const week = monday ? resolveWeek(state, year.year, monday) : null;
  const goals = monday ? weekGoals(year, monday) : [];

  const placeable = week
    ? [
        ...week.days.flatMap((items, di) =>
          items.map((i) => ({
            id: i.id,
            label: `${WEEKDAYS[di].short} · ${i.text}`,
          })),
        ),
        ...week.weeklyItems.map((i) => ({
          id: i.id,
          label: `Weekly · ${i.text}`,
        })),
      ]
    : [];

  return (
    <section className="arch-panel">
      <h3>Real week</h3>
      <div className="arch-real-toolbar">
        <label>
          Week
          <select
            value={monday}
            onChange={(e) => setMonday(e.target.value)}
            aria-label="Week"
          >
            {options.map((opt) => (
              <option key={opt.monday} value={opt.monday}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {week && (
          <span
            className={
              week.inheriting ? "arch-badge is-inheriting" : "arch-badge is-detached"
            }
          >
            {week.inheriting ? "Inheriting" : "Detached"}
          </span>
        )}
        {week && !week.inheriting && !readOnly && (
          <button
            type="button"
            onClick={() =>
              onCommand({ type: "resetWeek", year: year.year, monday })
            }
          >
            Reset to default
          </button>
        )}
      </div>
      {goals.length > 0 && (
        <div className="arch-week-goals">
          <h4>Period goals this week</h4>
          <ul>
            {goals.map((goal) => (
              <li key={goal.id}>
                <span
                  className="month-goal-swatch"
                  style={{ background: PALETTE[goal.color] }}
                  aria-hidden
                />
                {goal.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {week && (
        <>
          <div className="arch-real-days">
            {WEEKDAYS.map(({ label, value }) => (
              <DayColumn
                key={value}
                label={label}
                types={types}
                dayTypeId={week.dayTypeByWeekday[value] ?? null}
                items={week.days[value]}
                prioritiesActive={week.prioritiesActive}
                readOnly={readOnly}
                onType={(dayTypeId) =>
                  onCommand({
                    type: "setWeekDayType",
                    year: year.year,
                    monday,
                    weekday: value,
                    dayTypeId,
                  })
                }
                onItems={(items) =>
                  onCommand({
                    type: "setWeekDayItems",
                    year: year.year,
                    monday,
                    weekday: value,
                    items,
                  })
                }
              />
            ))}
          </div>
          <WeekItemsEditor
            title="Weekly-only items"
            items={week.weeklyItems}
            prioritiesActive={week.prioritiesActive}
            readOnly={readOnly}
            onChange={(items) =>
              onCommand({
                type: "setWeekWeeklyItems",
                year: year.year,
                monday,
                items,
              })
            }
          />
          <WeekGrid
            week={week}
            placeable={placeable}
            placingId={placingId}
            readOnly={readOnly}
            onPlacing={setPlacingId}
            onPlace={(weekday, startMinutes) => {
              if (!placingId) return;
              onCommand({
                type: "placeGridBlock",
                year: year.year,
                monday,
                block: {
                  itemId: placingId,
                  weekday,
                  startMinutes,
                  durationMinutes: SLOT,
                },
              });
            }}
            onClear={(itemId, weekday) =>
              onCommand({
                type: "clearGridBlock",
                year: year.year,
                monday,
                itemId,
                weekday,
              })
            }
          />
        </>
      )}
    </section>
  );
}

function DayColumn({
  label,
  types,
  dayTypeId,
  items,
  prioritiesActive,
  readOnly,
  onType,
  onItems,
}: {
  label: string;
  types: DayType[];
  dayTypeId: string | null;
  items: WeekItem[];
  prioritiesActive: boolean;
  readOnly: boolean;
  onType: (id: string | null) => void;
  onItems: (items: WeekItem[]) => void;
}) {
  const color = dayTypeId
    ? types.find((t) => t.id === dayTypeId)?.color
    : undefined;

  return (
    <div className="arch-day-col">
      <div className="arch-day-head">
        {color && (
          <span
            className="arch-type-swatch"
            style={{ background: PALETTE[color] }}
            aria-hidden
          />
        )}
        <strong>{label}</strong>
      </div>
      <TypeSelect
        types={types}
        value={dayTypeId}
        disabled={readOnly}
        onChange={onType}
      />
      <WeekItemsEditor
        items={items}
        prioritiesActive={prioritiesActive}
        readOnly={readOnly}
        onChange={onItems}
      />
    </div>
  );
}

function WeekItemsEditor({
  title,
  items,
  prioritiesActive,
  readOnly,
  onChange,
}: {
  title?: string;
  items: WeekItem[];
  prioritiesActive: boolean;
  readOnly: boolean;
  onChange: (items: WeekItem[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const text = draft.trim();
    if (!text || readOnly) return;
    onChange([...items, { id: crypto.randomUUID(), text, priority: "optional" }]);
    setDraft("");
  }

  function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= items.length) return;
    const copy = items.slice();
    const [row] = copy.splice(index, 1);
    copy.splice(next, 0, row);
    onChange(copy);
  }

  return (
    <div className="arch-checklist">
      {title && <h4>{title}</h4>}
      {items.length === 0 ? (
        <p className="arch-empty">No items.</p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li key={item.id} className="arch-item">
              <ItemText
                value={item.text}
                readOnly={readOnly}
                onCommit={(text) =>
                  onChange(
                    items.map((i) => (i.id === item.id ? { ...i, text } : i)),
                  )
                }
              />
              <PriorityRadios
                item={item}
                showSelected={prioritiesActive}
                disabled={readOnly}
                onChange={(priority) =>
                  onChange(
                    items.map((i) =>
                      i.id === item.id ? { ...i, priority } : i,
                    ),
                  )
                }
              />
              <button
                type="button"
                disabled={readOnly || index === 0}
                aria-label="Move up"
                onClick={() => move(index, -1)}
              >
                Up
              </button>
              <button
                type="button"
                disabled={readOnly || index === items.length - 1}
                aria-label="Move down"
                onClick={() => move(index, 1)}
              >
                Down
              </button>
              <button
                type="button"
                disabled={readOnly}
                aria-label={`Remove ${item.text}`}
                onClick={() => onChange(items.filter((i) => i.id !== item.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          className="arch-add-item"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={title ? "New weekly item" : "New checklist item"}
          />
          <button type="submit">Add</button>
        </form>
      )}
    </div>
  );
}

function PriorityRadios({
  item,
  showSelected,
  disabled,
  onChange,
}: {
  item: WeekItem;
  showSelected: boolean;
  disabled: boolean;
  onChange: (priority: Priority) => void;
}) {
  if (!showSelected) return null;

  return (
    <fieldset className="arch-priorities" disabled={disabled}>
      <legend className="visually-hidden">Priority</legend>
      {PRIORITIES.map((p) => (
        <label key={p.value}>
          <input
            type="radio"
            name={`prio-${item.id}`}
            value={p.value}
            checked={showSelected && item.priority === p.value}
            onChange={() => onChange(p.value)}
          />
          {p.label}
        </label>
      ))}
    </fieldset>
  );
}

function ItemText({
  value,
  readOnly,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <input
      value={text}
      disabled={readOnly}
      aria-label="Item text"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const trimmed = text.trim();
        if (!readOnly && trimmed && trimmed !== value) onCommit(trimmed);
        else setText(value);
      }}
    />
  );
}

function WeekGrid({
  week,
  placeable,
  placingId,
  readOnly,
  onPlacing,
  onPlace,
  onClear,
}: {
  week: ResolvedWeek;
  placeable: { id: string; label: string }[];
  placingId: string;
  readOnly: boolean;
  onPlacing: (id: string) => void;
  onPlace: (weekday: Weekday, startMinutes: number) => void;
  onClear: (itemId: string, weekday: Weekday) => void;
}) {
  return (
    <div className="arch-grid-wrap">
      <h4>Hourly grid</h4>
      <p className="arch-hint">
        06:00–22:00 in 30-minute slots. Select an item, then click a slot to
        place it. Click a block to clear it. Clearing does not delete the item.
      </p>
      {!readOnly && (
        <label className="arch-place">
          Place item
          <select
            value={placingId}
            onChange={(e) => onPlacing(e.target.value)}
            aria-label="Item to place"
          >
            <option value="">None</option>
            {placeable.map((p) => (
              <option key={`${p.id}-${p.label}`} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="arch-grid" role="grid" aria-label="Week grid">
        <div className="arch-grid-head">
          <div className="arch-grid-time" />
          {WEEKDAYS.map((d) => (
            <div key={d.value} className="arch-grid-day">
              {d.short}
            </div>
          ))}
        </div>
        {SLOTS.map((start) => (
          <div key={start} className="arch-grid-row">
            <div className="arch-grid-time">{formatMinutes(start)}</div>
            {WEEKDAYS.map((d) => {
              const block = blockAt(week.grid, d.value, start);
              const isStart = block?.startMinutes === start;
              return (
                <button
                  key={d.value}
                  type="button"
                  className={
                    block
                      ? isStart
                        ? "arch-grid-slot is-block is-start"
                        : "arch-grid-slot is-block"
                      : "arch-grid-slot"
                  }
                  disabled={readOnly || (!block && !placingId)}
                  aria-label={
                    block
                      ? `Clear ${itemLabel(week, block.itemId)} at ${formatMinutes(start)} ${d.short}`
                      : `Place at ${formatMinutes(start)} ${d.short}`
                  }
                  onClick={() => {
                    if (block) onClear(block.itemId, d.value);
                    else onPlace(d.value, start);
                  }}
                >
                  {isStart ? itemLabel(week, block.itemId) : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
