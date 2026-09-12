import { Dashboard } from "@/components/map/Dashboard";
import { MonthPage } from "@/components/map/MonthPage";
import { DoctrineStrip } from "@/components/doctrine/DoctrineStrip";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";
import { useMapYear } from "@/state/MapYearProvider";
import { api } from "@/lib/ipc";
import { findYear, liveYears, todayLocalIso, yearOf, type MapCommand, type YearRecord } from "@lifequest/vault-core/map";

export default function ChartPage() {
  return <ChartContent />;
}

function yearHasContent(year: YearRecord): boolean {
  if (year.events.length > 0) return true;
  if (Object.keys(year.detachedWeeks).length > 0) return true;
  return year.months.some(
    (m) =>
      m.objectives.trim() !== "" ||
      m.notes.trim() !== "" ||
      Object.values(m.days).some((t) => t.trim() !== ""),
  );
}

function ChartContent() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  const { yearNum, month, setYearNum, setMonth } = useMapYear();
  const map = snapshot?.map ?? null;

  async function onCommand(command: MapCommand) {
    const result = await api().mapApply(command);
    if (result.ok) await refresh();
  }

  if (snapshot?.mapError && !map) {
    return <p className="form-error" role="alert">{snapshot.mapError}</p>;
  }
  if (!snapshot || !map || yearNum == null) return <p className="muted">Loading map…</p>;

  const selected = findYear(map, yearNum);
  const todayYear = yearOf(todayLocalIso());
  const live = liveYears(map);
  const addYear =
    live.length >= 3
      ? null
      : [todayYear, todayYear + 1, todayYear + 2].find((y) => !findYear(map, y)) ??
        null;

  return (
    <div className="life-map">
      <header className="life-map__chrome">
        <h1>Life Map</h1>
        <label>
          Year
          <select
            value={yearNum}
            onChange={(e) => setYearNum(Number(e.target.value))}
          >
            {map.years
              .slice()
              .sort((a, b) =>
                a.status === b.status
                  ? a.status === "live"
                    ? a.year - b.year
                    : b.year - a.year
                  : a.status === "live"
                    ? -1
                    : 1,
              )
              .map((y) => (
                <option key={y.year} value={y.year}>
                  {y.status === "archive" ? `${y.year} (archive)` : String(y.year)}
                </option>
              ))}
          </select>
        </label>
        {selected?.status === "archive" && (
          <button type="button" onClick={() => void onCommand({ type: "deleteYear", year: selected.year })}>
            Delete archive
          </button>
        )}
        {selected?.status === "live" && selected.year !== todayYear && (
          <button type="button" onClick={() => {
            if (yearHasContent(selected) && !window.confirm(`Delete ${selected.year}? It has events, month text, or detached weeks.`)) return;
            void onCommand({ type: "deleteYear", year: selected.year });
          }}>
            Delete year
          </button>
        )}
        {addYear != null && (
          <button type="button" onClick={() => void onCommand({ type: "createYear", year: addYear })}>
            Add {addYear}
          </button>
        )}
      </header>
      <DoctrineStrip kind="what" />
      {selected && month == null && (
        <Dashboard
          year={selected}
          onSelectMonth={setMonth}
          onCommand={onCommand}
          domains={snapshot.domains}
          goals={snapshot.goals}
          lens={lens}
        />
      )}
      {selected && month != null && (
        <MonthPage
          year={selected}
          month={month}
          onBack={() => setMonth(null)}
          onCommand={onCommand}
          domains={snapshot.domains}
          lens={lens}
        />
      )}
    </div>
  );
}
