import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DEFAULT_DECISION_INBOX_SETTINGS } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useLiveData } from "@/state/LiveDataProvider";
import { useVault } from "@/state/VaultProvider";

/**
 * The inbox opens itself when a proposal is filed.
 *
 * THE FAULT THIS REPAIRS (reported, not imagined):
 *
 *   "The auto open should happen when a new decision is available in the
 *    decision inbox. Then the decision inbox pops up on the screen to make it
 *    easy for the user to just click approve."
 *
 * Until this watcher, a filing was announced only by the rail's badge — a number
 * and a four-second pulse on an icon at the edge of the window — and an operator
 * whose caret was in a document could miss it for hours. The inbox is a sheet
 * over the page (see `useSheetBackground`), not a navigation away from it, so
 * opening it costs the operator nothing: the page stays mounted underneath, and
 * closing hands it back exactly as it was, same route, same scroll, same card
 * under the caret. Popping it is therefore the cheap interruption, and the
 * operator can turn it off in Settings › Decisions.
 *
 * WHAT COUNTS AS NEWS
 *
 * The first read of a vault's queue is a baseline, not an arrival. A queue that
 * was already waiting when the window opened must not pop over the operator's
 * work at launch — otherwise the app would greet them with a sheet every morning
 * until the backlog cleared, and the switch would mean "the inbox is always
 * open" rather than "tell me when something new arrives". Every read after that
 * compares the pending ids against the ones this window has already seen; only
 * an id it has never held is a filing. The baseline is kept per vault, so
 * switching vaults re-seeds instead of reading the destination's whole queue as
 * a burst of arrivals.
 *
 * WHY IT WATCHES THE LIVE REVISION
 *
 * The same reason the inbox and the rail do: the main process announces every
 * write on `vault:dataChanged`, and a Decision filed by a scheduled automation,
 * a paired agent on the MCP door, or a chat turn whose snapshot refresh landed
 * before the filing is only visible through that announcement. A failed read is
 * not an arrival — it leaves the known set alone and the next announcement asks
 * again.
 *
 * The switch is `settings.decisionInbox.autoOpen`, read from a ref so a settings
 * write does not restart the effect and re-baseline the queue: turning the
 * switch on must not treat the decisions already waiting as new. Turning it off
 * still updates the known set, so the filings it missed while off do not all pop
 * the moment it is turned back on — only the next genuinely new one does.
 *
 * The filing's ids are carried into the navigation (`decisionArrivalIds`) for
 * the same reason the inbox's own live arrival mark exists: an operator who was
 * not looking at the inbox when a Decision was written should still be told which
 * card is the new one. The sheet opens in motion; the card that caused it wears
 * the arrival aura as it lands.
 */
export function DecisionInboxAutoOpen() {
  const { snapshot } = useVault();
  const live = useLiveData();
  const navigate = useNavigate();
  const location = useLocation();

  const vaultId = snapshot?.lifequest.id ?? null;
  const autoOpen =
    snapshot?.settings.decisionInbox?.autoOpen ??
    DEFAULT_DECISION_INBOX_SETTINGS.autoOpen;

  /**
   * The pending ids this window has already seen, for the open vault.
   *
   * `null` means "no baseline yet": the next successful read seeds it and opens
   * nothing. `vaultId` is part of the record rather than a separate ref so a
   * vault switch can never be mistaken for a filing burst.
   */
  const knownRef = useRef<{ vaultId: string; ids: Set<string> } | null>(null);
  /** The newest read, so a slower earlier one cannot seed or pop over it. */
  const readSeqRef = useRef(0);
  /**
   * The route and the switch as of the latest render, read by an async answer.
   * They are refs because the read is a round trip: the operator can open a
   * sheet or flip the switch inside it, and the answer must act on where they
   * are now, not on where they were when the read started.
   */
  const routeRef = useRef(location.pathname);
  routeRef.current = location.pathname;
  const autoOpenRef = useRef(autoOpen);
  autoOpenRef.current = autoOpen;

  useEffect(() => {
    if (!vaultId) {
      // No vault: no queue to watch. Opening one later starts a fresh baseline.
      knownRef.current = null;
      return;
    }
    const seq = readSeqRef.current + 1;
    readSeqRef.current = seq;
    void (async () => {
      try {
        const result = await api().decisionList();
        if (readSeqRef.current !== seq) return;
        if (!result.ok) return;
        const pending = result.value
          .filter((decision) => decision.status === "pending")
          .map((decision) => decision.id);
        const known = knownRef.current;
        if (!known || known.vaultId !== vaultId) {
          knownRef.current = { vaultId, ids: new Set(pending) };
          return;
        }
        const fresh = pending.filter((id) => !known.ids.has(id));
        for (const id of pending) known.ids.add(id);
        if (fresh.length === 0) return;
        if (!autoOpenRef.current) return;
        // Already answering: a second navigation would push a second history
        // entry behind the sheet the operator is looking at.
        if (routeRef.current === "/decisions") return;
        // The ids travel with the navigation: the inbox was not on screen when
        // these were filed, so its own live-arrival mark never saw them. The
        // sheet's first paint uses them to wear the mark on the card that caused
        // it to open — the operator's eye should land on what is new, not on a
        // quiet list where one more card appeared.
        navigate("/decisions", { state: { decisionArrivalIds: fresh } });
      } catch {
        // A read that failed is not a filing. Keep the baseline and wait for the
        // next announcement, which is what a transient failure deserves.
      }
    })();
  }, [vaultId, live, navigate]);

  return null;
}
