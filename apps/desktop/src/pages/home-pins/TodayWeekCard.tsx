import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useVault } from "@/state/VaultProvider";

export function TodayWeekCard() {
  const { snapshot } = useVault();

  const todayTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "today"),
    [snapshot?.map?.tasks],
  );
  const weekTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "this-week"),
    [snapshot?.map?.tasks],
  );

  return (
    <section className="home-card home-card--wide">
      <h2 className="home-card__title">Today &amp; this week</h2>
      <div className="home-task-cols">
        <div>
          <h3 className="home-task-cols__head">Today</h3>
          {todayTasks.length === 0 ? (
            <p className="muted home-card__empty">No tasks today.</p>
          ) : (
            <ul className="home-mini-list">
              {todayTasks.map((t) => (
                <li key={t.id} className="home-mini-list__item">
                  <span className="home-mini-list__link">{t.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="home-task-cols__head">This week</h3>
          {weekTasks.length === 0 ? (
            <p className="muted home-card__empty">Nothing queued this week.</p>
          ) : (
            <ul className="home-mini-list">
              {weekTasks.map((t) => (
                <li key={t.id} className="home-mini-list__item">
                  <span className="home-mini-list__link">{t.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Link to="/act" className="home-card__more">
        Open Act →
      </Link>
    </section>
  );
}
