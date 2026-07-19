import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { RoomId } from "@lifequest/vault-core";
import { isRoomUnlocked } from "@lifequest/vault-core";
import {
  documentsToUnlockDocs,
  useActiveDomain,
} from "./useActiveDomain";

const ROOM_LABELS: Record<RoomId, string> = {
  dream: "Dream",
  chart: "Chart",
  track: "Track",
  act: "Act",
};

const UNLOCK_HINTS: Record<RoomId, string> = {
  dream: "Dream is always open.",
  chart: "Save a non-empty Why document in Dream to unlock Chart.",
  track: "Save a non-empty What document in Chart to unlock Track.",
  act: "Save a non-empty How document in Track to unlock Act.",
};

export function RoomLockGate({
  room,
  children,
}: {
  room: RoomId;
  children: ReactNode;
}) {
  const activeDomain = useActiveDomain();
  const docs = documentsToUnlockDocs(activeDomain?.documents);
  const unlocked = isRoomUnlocked(room, docs);

  if (unlocked) {
    return <>{children}</>;
  }

  return (
    <div className="room-lock-gate" role="status">
      <div className="room-lock-gate__icon" aria-hidden>
        <Lock size={28} />
      </div>
      <h1 className="room-lock-gate__title">{ROOM_LABELS[room]} is locked</h1>
      <p className="room-lock-gate__hint muted">{UNLOCK_HINTS[room]}</p>
      {activeDomain ? (
        <p className="room-lock-gate__domain muted">
          Active domain: {activeDomain.meta.name}
        </p>
      ) : (
        <p className="room-lock-gate__domain muted">No active domain selected.</p>
      )}
    </div>
  );
}
