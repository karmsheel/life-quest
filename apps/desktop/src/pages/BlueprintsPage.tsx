import { DayTypes } from "@/components/blueprints/DayTypes";
import { DefaultWeek } from "@/components/blueprints/DefaultWeek";
import { RealWeek } from "@/components/blueprints/RealWeek";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";
import { WingEyebrow } from "@/components/shell/WingEyebrow";
import { useVault } from "@/state/VaultProvider";
import { useMapYear } from "@/state/MapYearProvider";
import { api } from "@/lib/ipc";
import { findYear, type MapCommand } from "@lifequest/vault-core/map";

export default function BlueprintsPage() {
  return <BlueprintsContent />;
}

function BlueprintsContent() {
  const { snapshot, refresh } = useVault();
  const { yearNum, setYearNum } = useMapYear();
  const map = snapshot?.map ?? null;

  async function onCommand(command: MapCommand) {
    const result = await api().mapApply(command);
    if (result.ok) await refresh();
  }

  if (snapshot?.mapError && !map) {
    return <p className="form-error" role="alert">{snapshot.mapError}</p>;
  }
  if (!map || yearNum == null) return <p className="muted">Loading map…</p>;
  const selected = findYear(map, yearNum);

  return (
    <div className={selected?.status === "archive" ? "blueprints is-archive" : "blueprints"}>
      <header className="life-map__chrome">
        <div className="life-map__title">
          <WingEyebrow page="Blueprints" />
          <h1>Blueprints</h1>
        </div>
        <label>
          Year
          <select value={yearNum} onChange={(e) => setYearNum(Number(e.target.value))}>
            {map.years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.status === "archive" ? `${y.year} (archive)` : String(y.year)}
              </option>
            ))}
          </select>
        </label>
      </header>
      {selected?.status === "archive" && <p className="archive-banner">Read-only archive</p>}
      <DoctrineIndex kinds={["how"]} />
      {selected && (
        <>
          <DayTypes state={map} year={selected} onCommand={onCommand} />
          <DefaultWeek state={map} year={selected} onCommand={onCommand} />
          <RealWeek state={map} year={selected} onCommand={onCommand} />
        </>
      )}
    </div>
  );
}
