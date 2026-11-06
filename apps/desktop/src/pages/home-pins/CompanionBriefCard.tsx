import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BriefDismissalReason,
  BriefItem,
  CompanionBriefRead,
} from "@lifequest/vault-core";
import {
  BRIEF_KIND_LABELS,
  BRIEF_OPERATOR_REASONS,
  BRIEF_REASON_LABELS,
  BRIEF_STALE_MS,
  filterByLens,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useLiveData } from "@/state/LiveDataProvider";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { BuiltInBadge } from "@/components/home/BuiltInBadge";

/**
 * The companion's brief, on the dashboard.
 *
 * The brief is the companion's reading of the operator's day — a decision, a
 * watch, a commitment, a pattern — typed, sourced and expiring. The card is
 * modelled on the deadline banner because it is the same kind of thing: a live
 * standing notice with one operator verb (dismiss) and no editor.
 *
 * Three facts decide what is drawn:
 *
 *  1. THE LENS FILTERS IT. Each item names a domain or is vault-wide, so a
 *     domain board shows its own items plus the vault-wide ones — the same
 *     `filterByLens` rule the deadline banner follows.
 *  2. THE CLOCK AGES IT. The server hands back the active set and the items
 *     that expired in the last day. An expired item is still drawn, faded and
 *     marked "expired", for one day; after that it is simply gone. An old
 *     `writtenAt` (over 48 hours) adds a quiet "not refreshed since" line, so
 *     the operator can see when the companion has stopped paying attention.
 *  3. ABSENCE IS VISIBLE. An empty brief draws "Nothing on the brief today"
 *     rather than hiding the card: a card that vanishes cannot tell the
 *     operator that the companion has gone quiet.
 *
 * The operator's verb is the dismissal menu. It calls the user-only IPC path —
 * the companion has no tool to dismiss its own items — and the whole card
 * re-renders from the reply, so the item leaves and every other item stays put.
 */
type Read = CompanionBriefRead;

function formatDay(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

/** Active and recently expired items in one priority order: 1 is read first. */
function inPriorityOrder(items: BriefItem[], recentlyExpired: BriefItem[]): BriefItem[] {
  return [...items, ...recentlyExpired].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

function isExpired(item: BriefItem, now: number): boolean {
  const at = Date.parse(item.expiresAt);
  return !Number.isNaN(at) && at <= now;
}

export function CompanionBriefCard() {
  const live = useLiveData();
  const { reloadGeneration } = useVault();
  const lens = useDomainLens();
  const [read, setRead] = useState<Read | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  /** The card's own clock, so an item that lapses while the board is open turns
   * faded (and an expired one leaves after its day) without waiting for a write
   * or a reload. A minute is enough for a card whose shortest lived claim is a
   * day. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let next: Read | null;
      try {
        const res = await api().briefGet();
        next = res.ok ? res.value : null;
      } catch {
        // No bridge (a harness page, or a window before preload): the card still
        // draws its shell and says nothing rather than breaking the board.
        next = null;
      }
      if (alive) setRead(next);
    })();
    return () => {
      alive = false;
    };
  }, [live, reloadGeneration]);

  const items = useMemo(() => {
    if (!read) return [];
    return filterByLens(
      inPriorityOrder(read.items, read.recentlyExpired),
      lens,
    );
  }, [read, lens]);

  const stale =
    read?.writtenAt !== null &&
    read?.writtenAt !== undefined &&
    now - Date.parse(read.writtenAt) > BRIEF_STALE_MS;

  // One menu at a time, and it closes on Escape, on a press elsewhere, and on
  // the choice itself — the same rule the board's own pin menu follows.
  useEffect(() => {
    if (!menuItemId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-companion-brief-reasons]")) return;
      if (target?.closest("[data-companion-brief-dismiss]")) return;
      setMenuItemId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuItemId(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuItemId]);

  const dismiss = useCallback(async (itemId: string, reason: BriefDismissalReason) => {
    setMenuItemId(null);
    setDismissing(itemId);
    try {
      const res = await api().briefDismiss(itemId, reason);
      if (res.ok) setRead(res.value);
    } finally {
      setDismissing(null);
    }
  }, []);

  return (
    <section
      className="home-card companion-brief"
      data-testid="companion-brief-card"
      role="status"
      aria-live="polite"
    >
      <h2 className="home-card__title">
        Companion brief
        <BuiltInBadge />
      </h2>
      {stale && read?.writtenAt ? (
        <p className="companion-brief__stale muted" data-testid="companion-brief-stale">
          Not refreshed since {formatDay(read.writtenAt)}
        </p>
      ) : null}
      {read === null ? null : items.length === 0 ? (
        <p className="muted home-card__empty" data-testid="companion-brief-empty">
          Nothing on the brief today
        </p>
      ) : (
        <ul className="companion-brief__items">
          {items.map((item) => {
            const expired = isExpired(item, now);
            const menuOpen = menuItemId === item.id;
            return (
              <li
                key={item.id}
                className={
                  expired ? "companion-brief__item is-expired" : "companion-brief__item"
                }
                data-testid="companion-brief-item"
                data-item-id={item.id}
                data-kind={item.kind}
                data-priority={item.priority}
                data-expired={expired ? "true" : "false"}
                data-domain={item.domainSlug ?? ""}
              >
                <div className="companion-brief__line">
                  <span className="companion-brief__kind" data-testid="companion-brief-kind">
                    {BRIEF_KIND_LABELS[item.kind]}
                  </span>
                  <span className="companion-brief__text" data-testid="companion-brief-text">
                    {item.text}
                  </span>
                  {expired ? (
                    <span className="companion-brief__expired" data-testid="companion-brief-expired">
                      expired
                    </span>
                  ) : null}
                </div>
                <p className="companion-brief__why muted" data-testid="companion-brief-why">
                  {item.why}
                </p>
                <div className="companion-brief__settle">
                  <button
                    type="button"
                    className="companion-brief__dismiss"
                    data-testid="companion-brief-dismiss"
                    data-companion-brief-dismiss={item.id}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label={`Dismiss "${item.text}"`}
                    disabled={dismissing === item.id}
                    onClick={() =>
                      setMenuItemId((open) => (open === item.id ? null : item.id))
                    }
                  >
                    {dismissing === item.id ? "Dismissing…" : "Dismiss"}
                  </button>
                  {menuOpen ? (
                    <div
                      className="companion-brief__reasons"
                      role="menu"
                      aria-label={`Dismiss "${item.text}" as`}
                      data-testid="companion-brief-reasons"
                      data-companion-brief-reasons={item.id}
                    >
                      {BRIEF_OPERATOR_REASONS.map((reason) => (
                        <button
                          key={reason}
                          type="button"
                          role="menuitem"
                          className="companion-brief__reason"
                          onClick={() => void dismiss(item.id, reason)}
                        >
                          {BRIEF_REASON_LABELS[reason]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
