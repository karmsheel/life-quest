import { useState } from "react";
import { dashboardDays } from "@lifequest/vault-core/map";
import type { MapCommand, YearRecord } from "@lifequest/vault-core/map";
import {
  filterByLens,
  type DomainLens,
  type DomainRecord,
  type Goal,
} from "@lifequest/vault-core/pure";
import { EventPanel } from "./EventPanel";
import { eventMarkColor } from "./eventColor";

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
  domains: DomainRecord[];
  goals: Goal[];
  lens: DomainLens;
};

function isoFor(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function Dashboard({
  year,
  onSelectMonth,
  onCommand,
  domains,
  goals,
  lens,
}: Props) {
  const readOnly = year.status === "archive";
  const [seedDate, setSeedDate] = useState<string | null>(null);

  return (
    <section className={readOnly ? "dashboard is-archive" : "dashboard"}>
      <h2>
        {year.year} Dashboard (Macro Scope)
      </h2>
      {readOnly && <p className="archive-banner">Read-only archive</p>}
      <div className="dashboard-body">
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
                      {days.map(({ day, events }) => {
                        const date = isoFor(year.year, month, day);
                        const visible = filterByLens(events, lens);
                        return (
                          <div
                            key={date}
                            className="day-cell"
                            data-date={date}
                            onPointerDown={() => {
                              if (!readOnly) setSeedDate(date);
                            }}
                          >
                            <span className="day-num">{day}</span>
                            <span className="color-stack">
                              {visible.map((ev) => (
                                <span
                                  key={ev.id}
                                  className="event-mark"
                                  style={{
                                    background: eventMarkColor(ev.domainSlug, domains),
                                  }}
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
        <EventPanel
          year={year}
          readOnly={readOnly}
          onCommand={onCommand}
          goals={goals}
          domains={domains}
          lens={lens}
          seedDate={seedDate}
          onConsumedSeed={() => setSeedDate(null)}
        />
      </div>
    </section>
  );
}
