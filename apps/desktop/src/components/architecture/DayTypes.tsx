import { useEffect, useState } from "react";
import { dayTypeInUse } from "@lifequest/vault-core/map";
import { COLOR_IDS, PALETTE } from "@lifequest/vault-core/map";
import type {
  ChecklistItem,
  ColorId,
  MapCommand,
  DayType,
  StoreState,
  YearRecord,
} from "@lifequest/vault-core/map";

type Props = {
  state: StoreState;
  year: YearRecord;
  onCommand: (command: MapCommand) => void;
};

function typesFor(state: StoreState, year: YearRecord): DayType[] {
  if (year.status === "archive" && year.snapshot) return year.snapshot.dayTypes;
  return state.dayTypes;
}

export function DayTypes({ state, year, onCommand }: Props) {
  const readOnly = year.status === "archive";
  const types = typesFor(state, year);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ColorId>(COLOR_IDS[0]);

  function create() {
    const trimmed = name.trim();
    if (!trimmed || readOnly) return;
    onCommand({ type: "createDayType", name: trimmed, color });
    setName("");
    setColor(COLOR_IDS[0]);
  }

  return (
    <section className="arch-panel">
      <h3>Day types</h3>
      {types.length === 0 ? (
        <p className="arch-empty">No day types yet.</p>
      ) : (
        <ul className="arch-type-list">
          {types.map((type) => (
            <li key={type.id}>
              <TypeEditor
                state={state}
                type={type}
                others={types.filter((t) => t.id !== type.id)}
                readOnly={readOnly}
                onCommand={onCommand}
              />
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          className="arch-create"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label>
            New type
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="New day type name"
            />
          </label>
          <div className="key-swatches" role="group" aria-label="New day type color">
            {COLOR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={id === color ? "swatch selected" : "swatch"}
                style={{ background: PALETTE[id] }}
                aria-label={id}
                onClick={() => setColor(id)}
              />
            ))}
          </div>
          <button type="submit">Create</button>
        </form>
      )}
    </section>
  );
}

function TypeEditor({
  state,
  type,
  others,
  readOnly,
  onCommand,
}: {
  state: StoreState;
  type: DayType;
  others: DayType[];
  readOnly: boolean;
  onCommand: (command: MapCommand) => void;
}) {
  const [name, setName] = useState(type.name);
  const [replacing, setReplacing] = useState(false);
  const [replacementId, setReplacementId] = useState(others[0]?.id ?? "");

  useEffect(() => {
    setName(type.name);
  }, [type.name]);

  useEffect(() => {
    if (!others.some((t) => t.id === replacementId)) {
      setReplacementId(others[0]?.id ?? "");
    }
  }, [others, replacementId]);

  function commitName() {
    const trimmed = name.trim();
    if (!readOnly && trimmed && trimmed !== type.name) {
      onCommand({ type: "updateDayType", id: type.id, name: trimmed });
    } else {
      setName(type.name);
    }
  }

  function setItems(items: ChecklistItem[]) {
    onCommand({ type: "updateDayType", id: type.id, items });
  }

  function requestDelete() {
    if (readOnly) return;
    if (dayTypeInUse(state, type.id)) {
      setReplacing(true);
      return;
    }
    onCommand({ type: "deleteDayType", id: type.id });
  }

  function confirmReplace() {
    onCommand({
      type: "deleteDayType",
      id: type.id,
      replacementId: replacementId || undefined,
    });
    setReplacing(false);
  }

  return (
    <div className="arch-type-card">
      <div className="arch-type-head">
        <span
          className="arch-type-swatch"
          style={{ background: PALETTE[type.color] }}
          aria-hidden
        />
        <label>
          Name
          <input
            value={name}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
          />
        </label>
        <button type="button" disabled={readOnly} onClick={requestDelete}>
          Delete
        </button>
      </div>
      <div className="key-swatches" role="group" aria-label={`${type.name} color`}>
        {COLOR_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={id === type.color ? "swatch selected" : "swatch"}
            style={{ background: PALETTE[id] }}
            aria-label={id}
            disabled={readOnly}
            onClick={() => {
              if (id !== type.color) {
                onCommand({ type: "updateDayType", id: type.id, color: id });
              }
            }}
          />
        ))}
      </div>
      {replacing && (
        <div className="arch-replace">
          <p>This type is in use. Pick a replacement.</p>
          {others.length === 0 ? (
            <p className="arch-empty">Reassign the default week and live detached weeks first.</p>
          ) : (
            <label>
              Replacement
              <select
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
              >
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="arch-replace-actions">
            <button
              type="button"
              disabled={others.length === 0}
              onClick={confirmReplace}
            >
              Replace and delete
            </button>
            <button type="button" onClick={() => setReplacing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ChecklistEditor items={type.items} readOnly={readOnly} onChange={setItems} />
    </div>
  );
}

function ChecklistEditor({
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
      <h4>Checklist</h4>
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
            aria-label="New checklist item"
          />
          <button type="submit">Add</button>
        </form>
      )}
    </div>
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
