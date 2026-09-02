import { useEffect, useState } from "react";
import {
  periodGoalsOnDate,
  periodGoalsOverlappingMonth,
} from "@lifequest/vault-core/map";
import type { MapCommand, YearRecord } from "@lifequest/vault-core/map";
import { monthGrid } from "./monthGrid";

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

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = {
  year: YearRecord;
  month: number;
  onBack: () => void;
  onCommand: (command: MapCommand) => void;
};

function isoFor(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function MonthPage({ year, month, onBack, onCommand }: Props) {
  const readOnly = year.status === "archive";
  const data = year.months[month - 1];
  const goals = periodGoalsOverlappingMonth(year, month);
  const grid = monthGrid(year.year, month);

  return (
    <section className={readOnly ? "month-page is-archive" : "month-page"}>
      <button type="button" onClick={onBack}>
        Back to dashboard
      </button>
      <h2>
        {MONTH_NAMES[month - 1]} {year.year}
      </h2>
      {readOnly && <p className="archive-banner">Read-only archive</p>}
      <div className="month-calendar" role="grid" aria-label="Month calendar">
        <div className="month-calendar-head">
          {WEEKDAYS.map((label) => (
            <div key={label} className="month-weekday">
              {label}
            </div>
          ))}
        </div>
        {grid.map((row, ri) => (
          <div key={ri} className="month-calendar-row">
            {row.map((cell, ci) => {
              if (!cell.inMonth || cell.day == null) {
                return <div key={`inert-${ri}-${ci}`} className="month-day-cell is-inert" />;
              }
              const day = cell.day;
              const date = isoFor(year.year, month, day);
              const colors = periodGoalsOnDate(year, date).map((g) => g.color);
              return (
                <div key={date} className="month-day-cell">
                  <div className="month-day-meta">
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
                  <DayText
                    value={data.days[String(day)] ?? ""}
                    readOnly={readOnly}
                    onCommit={(text) =>
                      onCommand({
                        type: "setMonthDay",
                        year: year.year,
                        month,
                        day,
                        text,
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="month-below">
        <section className="month-period-goals">
          <h3>Period goals</h3>
          {goals.length === 0 ? (
            <p className="month-empty">No period goals this month.</p>
          ) : (
            <ul>
              {goals.map((goal) => (
                <li key={goal.id}>
                  <span
                    className="month-goal-swatch"
                    data-map-color={goal.color}
                    aria-hidden
                  />
                  {goal.name}
                </li>
              ))}
            </ul>
          )}
        </section>
        <MonthField
          label="Main Objectives"
          value={data.objectives}
          readOnly={readOnly}
          onCommit={(text) =>
            onCommand({
              type: "setMonthObjectives",
              year: year.year,
              month,
              text,
            })
          }
        />
        <MonthField
          label="Notes"
          value={data.notes}
          readOnly={readOnly}
          onCommit={(text) =>
            onCommand({
              type: "setMonthNotes",
              year: year.year,
              month,
              text,
            })
          }
        />
      </div>
    </section>
  );
}

function DayText({
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
    <textarea
      className="month-day-text"
      value={text}
      readOnly={readOnly}
      aria-label="Day text"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (!readOnly && text !== value) onCommit(text);
      }}
    />
  );
}

function MonthField({
  label,
  value,
  readOnly,
  onCommit,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <label className="month-field">
      {label}
      <textarea
        value={text}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!readOnly && text !== value) onCommit(text);
        }}
      />
    </label>
  );
}
