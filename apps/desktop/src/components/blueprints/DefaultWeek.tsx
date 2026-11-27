import { useEffect, useState } from "react";
import type {
  ChecklistItem,
  MapCommand,
  DayType,
  DefaultWeek as DefaultWeekData,
  StoreState,
  Weekday,
  YearRecord,
} from "@lifequest/vault-core/map";

const WEEKDAYS: { label: string; value: Weekday }[] = [
  { label: "Monday", value: 0 },
  { label: "Tuesday", value: 1 },
  { label: "Wednesday", value: 2 },
  { label: "Thursday", value: 3 },
  { label: "Friday", value: 4 },
  { label: "Saturday", value: 5 },
  { label: "Sunday", value: 6 },
];

type Props = {
  state: StoreState;
  year: YearRecord;
  onCommand: (command: MapCommand) => void;
};

function library(state: StoreState, year: YearRecord): {
  types: DayType[];
  week: DefaultWeekData;
} {
  if (year.status === "archive" && year.snapshot) {
    return { types: year.snapshot.dayTypes, week: year.snapshot.defaultWeek };
  }
  return { types: state.dayTypes, week: state.defaultWeek };
}

export function DefaultWeek({ state, year, onCommand }: Props) {
  const readOnly = year.status === "archive";
  const { types, week } = library(state, year);

  return (
    <section className="arch-panel">
      <h3>Default week</h3>
      <div className="arch-weekdays">
        {WEEKDAYS.map(({ label, value }) => (
          <label key={value} className="arch-weekday">
            {label}
            <TypeSelect
              types={types}
              value={week.dayTypeByWeekday[value] ?? null}
              disabled={readOnly}
              onChange={(dayTypeId) =>
                onCommand({
                  type: "setDefaultWeekdayType",
                  weekday: value,
                  dayTypeId,
                })
              }
            />
          </label>
        ))}
      </div>
      <WeeklyItems
        items={week.weeklyItems}
        readOnly={readOnly}
        onChange={(items) => onCommand({ type: "setDefaultWeeklyItems", items })}
      />
    </section>
  );
}

export function TypeSelect({
  types,
  value,
  disabled,
  onChange,
}: {
  types: DayType[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    >
      <option value="">None</option>
      {types.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function WeeklyItems({
  items,
  readOnly,
  onChange,
}: {
  items: ChecklistItem[];
  readOnly: boolean;
  onChange: (items: ChecklistItem[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const text = draft.trim();
    if (!text || readOnly) return;
    onChange([...items, { id: crypto.randomUUID(), text }]);
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
      <h4>Weekly-only items</h4>
      {items.length === 0 ? (
        <p className="arch-empty">No weekly items.</p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li key={item.id} className="arch-item">
              <WeeklyItemText
                value={item.text}
                readOnly={readOnly}
                onCommit={(text) =>
                  onChange(items.map((i) => (i.id === item.id ? { ...i, text } : i)))
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
            aria-label="New weekly item"
          />
          <button type="submit">Add</button>
        </form>
      )}
    </div>
  );
}

function WeeklyItemText({
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
      aria-label="Weekly item text"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const trimmed = text.trim();
        if (!readOnly && trimmed && trimmed !== value) onCommit(trimmed);
        else setText(value);
      }}
    />
  );
}


