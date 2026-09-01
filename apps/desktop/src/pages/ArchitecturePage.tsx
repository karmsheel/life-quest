import { DayTypes } from "@/components/architecture/DayTypes";
import { DefaultWeek } from "@/components/architecture/DefaultWeek";
import { RealWeek } from "@/components/architecture/RealWeek";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";
import { RoomLockGate } from "@/components/shell/RoomLockGate";
import { useVault } from "@/state/VaultProvider";
import { useMapYear } from "@/state/MapYearProvider";
import { api } from "@/lib/ipc";
import { findYear, type MapCommand } from "@lifequest/vault-core/map";

export default function ArchitecturePage() {
  return (
    <RoomLockGate room="track">
      <ArchitectureContent />
    </RoomLockGate>
  );
}

function ArchitectureContent() {
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
    <div className={selected?.status === "archive" ? "architecture is-archive" : "architecture"}>
      <header className="life-map__chrome">
        <h1>Architecture</h1>
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
