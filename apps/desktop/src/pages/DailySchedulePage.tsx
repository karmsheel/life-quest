import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import {
  liveDayView,
  todayLocalIso,
  type DayType,
  type MapCommand,
} from "@lifequest/vault-core/map";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

function formatMinutes(mins: number): string {
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function DailySchedulePage() {
  const { snapshot, refresh } = useVault();
  const map = snapshot?.map ?? null;
  const today = todayLocalIso();
  const date = today;

  const [error, setError] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [placeStart, setPlaceStart] = useState<number>(540);
  const [placeDuration, setPlaceDuration] = useState<number>(30);
  const [adHocText, setAdHocText] = useState("");
  const [blockEdits, setBlockEdits] = useState<
    Record<string, { start?: number; duration?: number }>
  >({});

  const view = useMemo(() => {
    if (!map) return null;
    return liveDayView(map, date);
  }, [map, date]);

  const day = view?.day ?? null;
  const leftover = view?.leftover ?? [];

  const sortedBlocks = useMemo(() => {
    if (!day) return [];
    return [...day.blocks].sort((a, b) =>
      a.startMinutes - b.startMinutes ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }, [day]);

  const defaultStart = useMemo(() => {
    if (!day || day.blocks.length === 0) return 540;
    return Math.max(...day.blocks.map((b) => b.startMinutes + b.durationMinutes));
  }, [day]);

  useEffect(() => {
    if (map && !map.liveDays[date]) {
      void (async () => {
        const result = await api().mapApply({ type: "ensureLiveDay", date });
        if (result.ok) {
          setError(null);
          await refresh();
        } else {
          setError(result.error);
        }
      })();
    }
  }, [map, date, refresh]);

  async function apply(command: MapCommand): Promise<void> {
    const result = await api().mapApply(command);
    if (result.ok) {
      setError(null);
      await refresh();
    } else {
      setError(result.error);
    }
  }

  const dayTypes: DayType[] = map?.dayTypes ?? [];
  const selectedDayTypeId = day?.dayTypeId ?? null;

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    void apply({
      type: "setLiveDayType",
      date,
      dayTypeId: value === "" ? null : value,
    });
  }

  function handlePlaceClick(id: string) {
    setPlacingId(id);
    setPlaceStart(defaultStart);
    setPlaceDuration(30);
  }

  function handlePlaceConfirm(item: { id: string; kind: "stored" | "task" }) {
    if (item.kind === "task") {
      void apply({
        type: "placeLiveBlock",
        date,
        taskId: item.id,
        startMinutes: placeStart,
        durationMinutes: placeDuration,
      });
    } else {
      void apply({
        type: "placeLiveBlock",
        date,
        leftoverId: item.id,
        startMinutes: placeStart,
        durationMinutes: placeDuration,
      });
    }
    setPlacingId(null);
  }

  function handleCompleteLeftover(item: {
    id: string;
    kind: "stored" | "task";
    done: boolean;
  }) {
    if (item.kind === "task") {
      void apply({
        type: "updateTask",
        id: item.id,
        column: item.done ? "today" : "done",
      });
    } else {
      void apply({
        type: "completeLiveLeftover",
        date,
        leftoverId: item.id,
      });
    }
  }

  function handleCompleteBlock(blockId: string) {
    void apply({ type: "completeLiveBlock", date, blockId });
  }

  function handleUnplaceBlock(blockId: string) {
    void apply({ type: "unplaceLiveBlock", date, blockId });
  }

  function handleDeleteAdHoc(leftoverId: string) {
    void apply({ type: "deleteLiveAdHoc", date, leftoverId });
  }

  function handleAddAdHoc() {
    const text = adHocText.trim();
    if (!text) return;
    void apply({ type: "addLiveAdHoc", date, text });
    setAdHocText("");
  }

  function handleBlockEdit(
    blockId: string,
    field: "start" | "duration",
    value: string,
  ) {
    const num = Number(value);
    if (Number.isNaN(num)) return;
    setBlockEdits((prev) => ({
      ...prev,
      [blockId]: { ...prev[blockId], [field]: num },
    }));
  }

  function handleBlockApply(blockId: string) {
    const edits = blockEdits[blockId];
    if (!edits) return;
    void apply({
      type: "updateLiveBlock",
      date,
      blockId,
      startMinutes: edits.start,
      durationMinutes: edits.duration,
    });
    setBlockEdits((prev) => {
      const next = { ...prev };
      delete next[blockId];
      return next;
    });
  }

  if (snapshot?.mapError && !snapshot.map) {
    return <p className="form-error" role="alert">{snapshot.mapError}</p>;
  }

  return (
    <div className="schedule">
      <header className="schedule__chrome">
        <h1>Daily Schedule</h1>
        <span className="muted">{today}</span>
        <select value={selectedDayTypeId ?? ""} onChange={handleTypeChange}>
          <option value="">None</option>
          {dayTypes.map((dt) => (
            <option key={dt.id} value={dt.id}>{dt.name}</option>
          ))}
          {selectedDayTypeId &&
            !dayTypes.some((dt) => dt.id === selectedDayTypeId) && (
              <option value={selectedDayTypeId}>
                {selectedDayTypeId} (missing)
              </option>
            )}
        </select>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}

      <section>
        <h2><Clock size={16} /><span>Clock</span></h2>
        <ul className="schedule__list">
          {sortedBlocks.map((block) => {
            const edits = blockEdits[block.id];
            const editStart = edits?.start ?? block.startMinutes;
            const editDuration = edits?.duration ?? block.durationMinutes;
            return (
              <li key={block.id}>
                <span>
                  {formatMinutes(block.startMinutes)}–
                  {formatMinutes(block.startMinutes + block.durationMinutes)}
                </span>
                <span>{block.text}</span>
                <input
                  type="number"
                  value={editDuration}
                  onChange={(e) =>
                    handleBlockEdit(block.id, "duration", e.target.value)
                  }
                />
                <input
                  type="number"
                  value={editStart}
                  onChange={(e) =>
                    handleBlockEdit(block.id, "start", e.target.value)
                  }
                />
                <label>
                  <input
                    type="checkbox"
                    checked={block.done}
                    onChange={() => handleCompleteBlock(block.id)}
                  />
                  Done
                </label>
                <Button onClick={() => handleUnplaceBlock(block.id)}>
                  Unplace
                </Button>
                <Button onClick={() => handleBlockApply(block.id)}>Apply</Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>Leftover</h2>
        <ul className="schedule__list">
          {leftover.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => handleCompleteLeftover(item)}
                />
                {item.kind === "task" ? `Task · ${item.text}` : item.text}
              </label>
              {item.kind === "stored" && item.source.type === "ad-hoc" && (
                <Button onClick={() => handleDeleteAdHoc(item.id)}>Remove</Button>
              )}
              {placingId === item.id ? (
                <span className="schedule__row">
                  <input
                    type="number"
                    value={placeStart}
                    onChange={(e) => setPlaceStart(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    value={placeDuration}
                    onChange={(e) => setPlaceDuration(Number(e.target.value))}
                  />
                  <Button
                    onClick={() => handlePlaceConfirm(item)}
                    variant="primary"
                  >
                    Place
                  </Button>
                  <Button onClick={() => setPlacingId(null)}>Cancel</Button>
                </span>
              ) : (
                <Button onClick={() => handlePlaceClick(item.id)}>Place</Button>
              )}
            </li>
          ))}
        </ul>
        <div className="schedule__chrome">
          <input
            type="text"
            value={adHocText}
            onChange={(e) => setAdHocText(e.target.value)}
            placeholder="Add schedule item"
          />
          <Button onClick={handleAddAdHoc} variant="primary">Add</Button>
        </div>
      </section>
    </div>
  );
}
