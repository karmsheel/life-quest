/**
 * The page behind a sheet, held still.
 *
 * A sheet (Decisions, Settings) is not a page and not a modal over a dead
 * backdrop: the page the operator was reading stays mounted behind it, dimmed
 * and blurred by the scrim, and it has to be there — same route, same scroll,
 * same card under the caret — when the sheet leaves. What it does NOT have to be
 * is up to date; nobody can read it while the scrim is over it, and no control in
 * it can be reached.
 *
 * THE COST OF THE PAGE BEING LIVE UNDER A SHEET
 *
 * Both of the app's live signals reach the covered page while the operator works
 * in the sheet, and every reader under it used to answer with its own query:
 *
 *  - the vault's live revision, which fires for every write — and answering a
 *    queue of decisions is a run of writes;
 *  - the vault snapshot's `reloadGeneration`, which the inbox bumps after each
 *    answer so editors behind the sheet pick up the approved body.
 *
 * So approving ten proposals re-ran the dashboard's pins, its log, its views and
 * its decisions list ten times, and raced the next answer for the vault's one
 * queue — work nobody could see, spent in the operator's way. This module is
 * what makes "covered" a fact the page's queries can be held on.
 *
 * THE CONTRACT
 *
 * While covered, `PageCoverHold` freezes both signals for the subtree it wraps
 * (`LiveDataHold` + `VaultHold`). It does not unmount, skip or defer anything by
 * hand: every query keeps its own effect and its own dependencies, exactly as
 * written — they simply see a revision and a snapshot that do not move. When the
 * sheet leaves, the subtree is handed the current revision and the current
 * snapshot in the same commit, so everything it slept through is caught up in one
 * pass rather than one pass per write it missed.
 *
 * Only the routed page is wrapped (`AppShell`'s outlet), never the whole shell.
 * The rail, the dock and the chat keep their live view: a streaming turn must
 * not pause because a sheet is up, and the inbox lives inside the sheet, where it
 * is the surface being read.
 */
import { createContext, useContext, type ReactNode } from "react";
import { LiveDataHold } from "@/state/LiveDataProvider";
import { VaultHold } from "@/state/VaultProvider";

/**
 * Whether the routed page is currently behind a sheet.
 *
 * Provided by `AppRoutes` (which is where `useSheetBackground` lives), read by
 * `AppShell` (which is where the page's outlet lives). Defaults to false so a
 * rig that renders a page or the shell on its own is never silently held.
 */
const PageCoverContext = createContext(false);

export function PageCoverProvider({
  covered,
  children,
}: {
  covered: boolean;
  children: ReactNode;
}) {
  return (
    <PageCoverContext.Provider value={covered}>
      {children}
    </PageCoverContext.Provider>
  );
}

export function usePageCovered(): boolean {
  return useContext(PageCoverContext);
}

/**
 * Freeze the page's live signals while a sheet is over it.
 *
 * The two holds nest in the order their providers do — vault outside live data —
 * so a component inside sees one consistent held world rather than a held
 * revision against a moving snapshot.
 */
export function PageCoverHold({ children }: { children: ReactNode }) {
  const covered = usePageCovered();
  return (
    <VaultHold held={covered}>
      <LiveDataHold held={covered}>{children}</LiveDataHold>
    </VaultHold>
  );
}
