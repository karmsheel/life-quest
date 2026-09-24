import { useMemo } from "react";
import { Link } from "react-router-dom";
import { recordVisible } from "@lifequest/vault-core/pure";
import type { LifeEvent } from "@lifequest/vault-core";
import { useDomainLens } from "@/components/shell/useActiveDomain";

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
    <section className="home-card home-card--wide">
      <h2 className="home-card__title">Recent activity</h2>
      {scoped.length === 0 ? (
        <p className="muted home-card__empty">No activity yet.</p>
      ) : (
        <ul className="home-activity-list">
          {scoped.map((e) => (
            <li key={e.id} className="home-activity-row">
              <time className="home-activity-row__when muted" dateTime={e.createdAt}>
                {formatWhen(e.createdAt)}
              </time>
              <span className="home-activity-row__type">{e.type}</span>
              <span className="home-activity-row__summary">{e.summary}</span>
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
