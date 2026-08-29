import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { RoomId } from "@lifequest/vault-core/pure";
import { isRoomUnlocked } from "@lifequest/vault-core/pure";
import { useActiveDomain, useUnlockDomains } from "./useActiveDomain";

const ROOM_LABELS: Record<RoomId, string> = {
  dream: "Dream",
  chart: "Life Map",
  track: "Architecture",
  act: "Act",
};

const UNLOCK_HINTS: Record<RoomId, string> = {
  dream: "Dream is always open.",
  chart: "Save a non-empty Why in any domain to unlock Life Map.",
  track: "Save a non-empty Why in any domain to unlock Architecture.",
  act: "Save a non-empty Why in any domain to unlock Act.",
};

export function RoomLockGate({
  room,
  children,
}: {
  room: RoomId;
  children: ReactNode;
}) {
  const domains = useUnlockDomains();
  const activeDomain = useActiveDomain();
  const unlocked = isRoomUnlocked(room, domains);

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
