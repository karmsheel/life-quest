import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/ipc";

/**
 * LiveData — the one thing a dashboard card listens to in order to know that
 * what it is drawing has changed.
 *
 * The problem this solves, as reported: "I just told the agent to log an
 * expense, but it didn't show up on the recent transactions table." The card's
 * spec was a live query and the engine re-ran it perfectly — the card simply was
 * never asked to run again. It ran on mount, and when its own presentation
 * switch was clicked, and at no other moment. The Life log agrees with the
 * operator: the capture posted at 19:59:33, and the last time the card's view
 * file was touched was 19:54:42.
 *
 * Three things move the number, which is all a consumer ever sees:
 *
 *  1. A WRITE. The main process announces every write that can change what a
 *     card reads — the companion's tools, the operator's edits, a Decision
 *     being approved, the FX rate moving — on `vault:dataChanged`.
 *  2. THE DAY. A named window like "today" or "this-week" is computed from the
 *     current date, so a board left open overnight is showing yesterday's answer
 *     at 00:01. A timer notices the local date has changed and bumps, with no
 *     write anywhere. This is the half that makes "Today's expenses" mean today
 *     instead of the day the card was built.
 *  3. COMING BACK TO THE WINDOW. Main notes a change on focus, which is how an
 *     edit made by another program, a sync client, or a second copy of the app
 *     reaches the board.
 *
 * The context has a DEFAULT rather than a throwing hook, which is deliberate:
 * `ViewCard` is rendered by e2e harness pages that mount the component alone,
 * with no provider above it. A missing provider must mean "nothing is live",
 * not a crash.
 */

const LiveDataContext = createContext(0);

/**
 * How often the local day is checked. Half a minute is chosen against the two
 * costs: a date comparison per tick is free, and the worst case is a card that
 * is up to 30 seconds late crossing midnight — on a screen nobody is reading at
 * midnight, since a window that is not visible has its timers throttled anyway.
 */
const DAY_CHECK_MS = 30_000;

/** The LOCAL calendar day of an instant, as `YYYY-MM-DD`. */
export function localDayOf(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((current) => current + 1), []);

  // 1. A write, announced by the main process.
  useEffect(() => {
    try {
      return api().onVaultDataChanged(() => bump());
    } catch {
      // No bridge (a harness page, or a window opened before preload): a card
      // that cannot hear about writes still draws, and still re-runs on mount.
      return undefined;
    }
  }, [bump]);

  // 2. The clock. A window anchored on "today" is a different query tomorrow.
  useEffect(() => {
    let day = localDayOf(new Date());
    const timer = setInterval(() => {
      const now = localDayOf(new Date());
      if (now === day) return;
      day = now;
      bump();
    }, DAY_CHECK_MS);
    return () => clearInterval(timer);
  }, [bump]);

  const value = useMemo(() => revision, [revision]);
  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
}

/**
 * The current live-data revision. A component that draws vault data puts this in
 * its load effect's dependencies and is then live: it re-reads whenever
 * something it could be showing has changed.
 */
export function useLiveData(): number {
  return useContext(LiveDataContext);
}
