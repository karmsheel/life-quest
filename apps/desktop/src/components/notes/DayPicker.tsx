/**
 * The journal's day picker: a calendar key beside the day, and the month it
 * opens.
 *
 * The pager walks the journal one day at a time, which is what an operator
 * writing today wants; it is the wrong tool for the note they half remember
 * writing three weeks ago, which used to mean pressing Prev day until it
 * appeared. The calendar key opens the month and jumps straight there.
 *
 * The future is closed. The journal cannot hold a day that has not happened —
 * the vault refuses one — so every day after today is disabled here, and the
 * handler refuses one as well rather than trusting the button's `disabled`. The
 * month arrows stop at the month today is in for the same reason: a month the
 * operator cannot pick anything from is not worth walking to.
 *
 * The popover is the app's shared quick-menu shape: portalled to the body,
 * anchored under its trigger with `useMenuPosition`, dismissed by a press
 * outside or by Escape, and handing the focus back to the key when it closes.
 * It is mounted only while open, so a closed picker puts no day buttons in the
 * document.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { monthGrid } from "@/components/map/monthGrid";
import { useMenuPosition } from "@/components/ui/useMenuPosition";
import { Button } from "@/components/ui/Button";

/** Monday first, the same week the Life Map's month grid draws. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

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
] as const;

/** Seven day cells across, plus the popover's own frame. */
const PICKER_WIDTH = 19 * 16;

/** The year and 1-based month an ISO date belongs to. */
function monthOf(iso: string): { year: number; month: number } {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
  };
}

/** The ISO date a year, month and day make, zero-padded. */
function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Twelve months as one number, for comparing months without a date object. */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export type DayPickerProps = {
  /** The day the page is showing. */
  date: string;
  /** Today, in the operator's own time zone. Nothing after it may be chosen. */
  today: string;
  /** Called with the chosen ISO date. Today is allowed; the future is not. */
  onSelect: (date: string) => void;
};

export function DayPicker({ date, today, onSelect }: DayPickerProps) {
  const [open, setOpen] = useState(false);
  // The trigger is wrapped rather than referenced directly: the studio's
  // `Button` is the primitive this key wears, and the wrapper is the box the
  // popover anchors to.
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // The month on screen. It starts on the day being written — where the
  // operator is — and is re-seeded on every open rather than kept from the last
  // visit, so a picker never opens on a month left behind weeks ago.
  const [cursor, setCursor] = useState(() => monthOf(date));
  const { menuStyle, updateMenuPosition } = useMenuPosition(
    triggerRef,
    "bottom-end",
    { width: PICKER_WIDTH },
  );

  const todayMonth = monthOf(today);
  const canGoNextMonth =
    monthIndex(cursor.year, cursor.month) < monthIndex(todayMonth.year, todayMonth.month);

  const returnFocus = useCallback(() => {
    triggerRef.current?.querySelector("button")?.focus();
  }, []);

  const close = useCallback(
    (handBackFocus: boolean) => {
      setOpen(false);
      if (handBackFocus) returnFocus();
    },
    [returnFocus],
  );

  const show = useCallback(() => {
    setCursor(monthOf(date));
    setOpen(true);
  }, [date]);

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      close(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(true);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, close, updateMenuPosition]);

  /** Take a day. The button is already disabled for the future; this is the
   *  same rule where a press could still reach it. */
  const choose = useCallback(
    (day: string) => {
      if (day > today) return;
      close(true);
      if (day !== date) onSelect(day);
    },
    [close, date, onSelect, today],
  );

  const shiftMonth = useCallback((step: -1 | 1) => {
    setCursor((current) => {
      const index = monthIndex(current.year, current.month) + step;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });
  }, []);

  const grid = monthGrid(cursor.year, cursor.month);
  const popoverStyle: CSSProperties = menuStyle;

  const trigger = (
    <span ref={triggerRef} className="daily-note__calendar-slot">
      <Button
        variant="ghost"
        className="daily-note__calendar"
        data-testid="daily-note-calendar"
        aria-label="Choose a day"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Choose a day — earlier days only"
        onClick={() => (open ? close(false) : show())}
      >
        <CalendarDays size={16} aria-hidden />
      </Button>
    </span>
  );

  const popover = open ? (
    <div
      ref={popoverRef}
      className="day-picker"
      data-testid="day-picker"
      role="dialog"
      aria-label="Choose a day"
      style={popoverStyle}
    >
      <div className="day-picker__head">
        <button
          type="button"
          className="day-picker__arrow"
          data-testid="day-picker-prev-month"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft size={15} aria-hidden />
        </button>
        <p className="day-picker__month" data-testid="day-picker-month">
          {MONTH_NAMES[cursor.month - 1]} {cursor.year}
        </p>
        <button
          type="button"
          className="day-picker__arrow"
          data-testid="day-picker-next-month"
          aria-label="Next month"
          disabled={!canGoNextMonth}
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>

      <div className="day-picker__weekdays" aria-hidden>
        {WEEKDAYS.map((label) => (
          <span key={label} className="day-picker__weekday">
            {label}
          </span>
        ))}
      </div>

      <div className="day-picker__grid">
        {grid.map((row, rowIndex) => (
          <div key={rowIndex} className="day-picker__row">
            {row.map((cell, cellIndex) => {
              if (!cell.inMonth || cell.day === undefined) {
                return (
                  <span
                    key={`blank-${rowIndex}-${cellIndex}`}
                    className="day-picker__blank"
                  />
                );
              }
              const iso = isoOf(cursor.year, cursor.month, cell.day);
              const future = iso > today;
              const selected = iso === date;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    "day-picker__day",
                    selected ? "is-selected" : null,
                    isToday ? "is-today" : null,
                    future ? "is-future" : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-testid={`day-picker-day-${iso}`}
                  data-date={iso}
                  aria-label={`${WEEKDAYS[cellIndex]} ${cell.day} ${
                    MONTH_NAMES[cursor.month - 1]
                  } ${cursor.year}${isToday ? " (today)" : ""}`}
                  aria-current={selected ? "date" : undefined}
                  disabled={future}
                  onClick={() => choose(iso)}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <>
      {trigger}
      {popover ? createPortal(popover, document.body) : null}
    </>
  );
}
