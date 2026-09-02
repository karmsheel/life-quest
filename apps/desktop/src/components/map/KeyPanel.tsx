import { useEffect, useState } from "react";
import { COLOR_IDS } from "@lifequest/vault-core/map";
import type { ColorId, MapCommand, PeriodGoal, YearRecord } from "@lifequest/vault-core/map";

type Props = {
  year: YearRecord;
  readOnly: boolean;
  onCommand: (command: MapCommand) => void;
};

function nextColor(goals: PeriodGoal[]): ColorId {
  const used = new Set(goals.map((goal) => goal.color));
  return COLOR_IDS.find((id) => !used.has(id)) ?? COLOR_IDS[goals.length % COLOR_IDS.length];
}

export function KeyPanel({ year, readOnly, onCommand }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ColorId>(COLOR_IDS[0]);
  const [start, setStart] = useState(`${year.year}-01-01`);
  const [end, setEnd] = useState(`${year.year}-12-31`);

  function openAdd() {
    setName("");
    setColor(nextColor(year.periodGoals));
    setStart(`${year.year}-01-01`);
    setEnd(`${year.year}-12-31`);
    setAdding(true);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed || start > end) return;
    onCommand({
      type: "createPeriodGoal",
      year: year.year,
      name: trimmed,
      color,
      start,
      end,
    });
    setAdding(false);
    setName("");
  }

  return (
    <aside className="key-panel">
      <div className="key-heading">
        <h3>{year.year} Goals</h3>
        {!readOnly && !adding && (
          <button type="button" className="key-add" onClick={openAdd}>
            Add goal
          </button>
        )}
      </div>
      {adding && !readOnly && (
        <form
          className="key-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitAdd();
          }}
        >
          <label>
            Name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="New goal name"
            />
          </label>
          <div className="key-swatches">
            {COLOR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={id === color ? "swatch selected" : "swatch"}
                data-map-color={id}
                aria-label={id}
                onClick={() => setColor(id)}
              />
            ))}
          </div>
          <label>
            Start
            <input
              type="date"
              value={start}
              min={`${year.year}-01-01`}
              max={`${year.year}-12-31`}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            End
            <input
              type="date"
              value={end}
              min={`${year.year}-01-01`}
              max={`${year.year}-12-31`}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <div className="paint-actions">
            <button type="submit" disabled={!name.trim() || start > end}>
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {year.periodGoals.length === 0 && !adding ? (
        <p className="key-empty">No goals yet.</p>
      ) : year.periodGoals.length > 0 ? (
        <ul className="key-list">
          {year.periodGoals.map((goal) => (
            <li key={goal.id}>
              <GoalEditor
                year={year.year}
                goal={goal}
                readOnly={readOnly}
                onCommand={onCommand}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function GoalEditor({
  year,
  goal,
  readOnly,
  onCommand,
}: {
  year: number;
  goal: PeriodGoal;
  readOnly: boolean;
  onCommand: (command: MapCommand) => void;
}) {
  const [name, setName] = useState(goal.name);
  const [start, setStart] = useState(goal.start);
  const [end, setEnd] = useState(goal.end);

  useEffect(() => {
    setName(goal.name);
    setStart(goal.start);
    setEnd(goal.end);
  }, [goal.name, goal.start, goal.end]);

  function commit(patch: {
    name?: string;
    color?: ColorId;
    start?: string;
    end?: string;
  }) {
    onCommand({ type: "updatePeriodGoal", year, id: goal.id, ...patch });
  }

  return (
    <div className="key-goal">
      <div className="key-swatches">
        {COLOR_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={id === goal.color ? "swatch selected" : "swatch"}
            data-map-color={id}
            aria-label={id}
            disabled={readOnly}
            onClick={() => {
              if (id !== goal.color) commit({ color: id });
            }}
          />
        ))}
      </div>
      <label>
        Name
        <input
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name !== goal.name) commit({ name });
          }}
        />
      </label>
      <label>
        Start
        <input
          type="date"
          value={start}
          disabled={readOnly}
          onChange={(e) => setStart(e.target.value)}
          min={`${year}-01-01`}
          max={`${year}-12-31`}
          onBlur={() => {
            if (start === goal.start && end === goal.end) return;
            if (start && end && start <= end) commit({ start, end });
          }}
        />
      </label>
      <label>
        End
        <input
          type="date"
          value={end}
          disabled={readOnly}
          onChange={(e) => setEnd(e.target.value)}
          min={`${year}-01-01`}
          max={`${year}-12-31`}
          onBlur={() => {
            if (start === goal.start && end === goal.end) return;
            if (start && end && start <= end) commit({ start, end });
          }}
        />
      </label>
      <button
        type="button"
        className="key-delete"
        disabled={readOnly}
        onClick={() => onCommand({ type: "deletePeriodGoal", year, id: goal.id })}
      >
        Delete
      </button>
    </div>
  );
}
