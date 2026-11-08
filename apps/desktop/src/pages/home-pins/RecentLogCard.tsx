import { useMemo } from "react";
import { Link } from "react-router-dom";
import { recordVisible } from "@lifequest/vault-core/pure";
import type { LifeEvent } from "@lifequest/vault-core";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { BuiltInBadge } from "@/components/home/BuiltInBadge";
import { displayEventType } from "@/lib/log-event-copy";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function RecentLogCard({ events }: { events: LifeEvent[] }) {
  const lens = useDomainLens();

  const scoped = useMemo(() => {
    return events
      .filter((e) => recordVisible(lens, e.domainSlug))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
  }, [events, lens]);

  return (
    <section className="home-card">
      <h2 className="home-card__title">
        Recent activity
        <BuiltInBadge />
      </h2>
      {scoped.length === 0 ? (
        <p className="muted home-card__empty">No activity yet.</p>
      ) : (
        <ul className="home-activity-list">
          {/*
            A line of the log is its summary first and its paperwork second: the
            entry is what happened, and the event type and the timestamp are how
            it was recorded. Stacking them keeps the card to a readable column
            instead of the four-column strip that made it a full-row card.
          */}
          {scoped.map((e) => (
            <li key={e.id} className="home-activity-row">
              <span className="home-activity-row__summary">{e.summary}</span>
              <span className="home-activity-row__meta">
                <span className="home-activity-row__type">{displayEventType(e.type)}</span>
                <time className="home-activity-row__when muted" dateTime={e.createdAt}>
                  {formatWhen(e.createdAt)}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/log" className="home-card__more">
        View full log →
      </Link>
    </section>
  );
}
