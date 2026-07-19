import type { DocumentKind, RoomId } from "@lifequest/vault-core";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { RoomLockGate } from "@/components/shell/RoomLockGate";

/** Map routes: dream→why, chart→what, track→how */
const ROOM_KIND: Record<Exclude<RoomId, "act">, DocumentKind> = {
  dream: "why",
  chart: "what",
  track: "how",
};

export default function RoomPage({
  room,
}: {
  room: Exclude<RoomId, "act">;
}) {
  const kind = ROOM_KIND[room];

  return (
    <RoomLockGate room={room}>
      <DocumentEditor kind={kind} />
    </RoomLockGate>
  );
}
