import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  COLOR_IDS,
  compareIso,
  dashboardDays,
} from "@lifequest/vault-core/map";
import type { ColorId, MapCommand, IsoDate, YearRecord } from "@lifequest/vault-core/map";
import { KeyPanel } from "./KeyPanel";
import { rangeFromDrag } from "./paintRange";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const QUARTERS: { id: string; months: number[] }[] = [
  { id: "Q1", months: [1, 2, 3] },
  { id: "Q2", months: [4, 5, 6] },
  { id: "Q3", months: [7, 8, 9] },
  { id: "Q4", months: [10, 11, 12] },
];

type Props = {
  year: YearRecord;
  onSelectMonth: (month: number) => void;
  onCommand: (command: MapCommand) => void;
};

type Drag = { start: IsoDate; end: IsoDate };
type Pending = { start: IsoDate; end: IsoDate };

function isoFor(year: number, month: number, day: number): IsoDate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromPoint(clientX: number, clientY: number): IsoDate | undefined {
  const el = document.elementFromPoint(clientX, clientY);
  const cell = el?.closest("[data-date]") as HTMLElement | null;
  return cell?.dataset.date;
}

export function Dashboard({ year, onSelectMonth, onCommand }: Props) {
  const readOnly = year.status === "archive";
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [paintName, setPaintName] = useState("");
  const [paintColor, setPaintColor] = useState<ColorId>(COLOR_IDS[0]);

  const selection = drag ? rangeFromDrag(drag.start, drag.end) : null;

  useEffect(() => {
    const finish = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const end = dateFromPoint(e.clientX, e.clientY) ?? current.end;
      const range = rangeFromDrag(current.start, end);
      dragRef.current = null;
      setDrag(null);
      setPaintName("");
      setPaintColor(COLOR_IDS[0]);
      setPending(range);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, []);

  function startPaint(date: IsoDate, e: ReactPointerEvent) {
    if (readOnly) return;
    e.preventDefault();
    const next = { start: date, end: date };
    dragRef.current = next;
    setPending(null);
    setDrag(next);
  }

  function movePaint(e: ReactPointerEvent) {
    const current = dragRef.current;
    if (!current) return;
    const date = dateFromPoint(e.clientX, e.clientY);
    if (date && date !== current.end) {
      const next = { ...current, end: date };
      dragRef.current = next;
      setDrag(next);
    }
  }

  function submitPaint() {
    if (!pending || !paintName.trim()) return;
    onCommand({
      type: "createPeriodGoal",
      year: year.year,
      name: paintName.trim(),
      color: paintColor,
      start: pending.start,
      end: pending.end,
    });
    setPending(null);
  }

  return (
    <section className={readOnly ? "dashboard is-archive" : "dashboard"}>
      <h2>
        {year.year} Dashboard (Macro Scope)
      </h2>
      {readOnly && <p className="archive-banner">Read-only archive</p>}
      <div className="dashboard-body" onPointerMove={movePaint}>
        <div className="quarters">
          {QUARTERS.map((q) => (
            <div key={q.id} className="quarter">
              <h3>{q.id}</h3>
              {q.months.map((month) => {
                const days = dashboardDays(year, month);
                return (
                  <div key={month} className="month-block">
                    <button
                      type="button"
                      className="month-name"
                      onClick={() => onSelectMonth(month)}
                    >
                      {MONTH_NAMES[month - 1]}
                    </button>
                    <div className="month-grid">
                      {days.map(({ day, colors }) => {
                        const date = isoFor(year.year, month, day);
                        const inDrag =
                          selection !== null &&
                          compareIso(date, selection.start) >= 0 &&
                          compareIso(date, selection.end) <= 0;
                        return (
                          <div
                            key={date}
                            className={inDrag ? "day-cell in-drag" : "day-cell"}
                            data-date={date}
                            onPointerDown={(e) => startPaint(date, e)}
                            onPointerEnter={() => {
                              const current = dragRef.current;
                              if (current && date !== current.end) {
                                const next = { ...current, end: date };
                                dragRef.current = next;
                                setDrag(next);
                              }
                            }}
                          >
                            <span className="day-num">{day}</span>
                            <span className="color-stack">
                              {colors.map((color, i) => (
                                <span
                                  key={`${color}-${i}`}
                                  className="color-bar"
                                  data-map-color={color}
                                />
                              ))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <KeyPanel year={year} readOnly={readOnly} onCommand={onCommand} />
      </div>
      {pending && !readOnly && (
        <div className="paint-dialog" role="dialog" aria-label="New period goal">
          <p>
            {pending.start} – {pending.end}
          </p>
          <label>
            Name
            <input
              autoFocus
              value={paintName}
              onChange={(e) => setPaintName(e.target.value)}
            />
          </label>
          <div className="key-swatches">
            {COLOR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={id === paintColor ? "swatch selected" : "swatch"}
                data-map-color={id}
                aria-label={id}
                onClick={() => setPaintColor(id)}
              />
            ))}
          </div>
          <div className="paint-actions">
            <button type="button" onClick={submitPaint} disabled={!paintName.trim()}>
              Create
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
