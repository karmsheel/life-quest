import type { DocumentKind, RoomId } from "@lifequest/vault-core";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { RoomLockGate } from "@/components/shell/RoomLockGate";
import { useActiveDomain } from "@/components/shell/useActiveDomain";

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
  const activeDomain = useActiveDomain();
  const slug = activeDomain?.slug;

  return (
    <RoomLockGate room={room}>
      {!slug ? (
        <p className="muted">Document not found</p>
      ) : (
        <DocumentEditor kind={kind} slug={slug} />
      )}
    </RoomLockGate>
  );
}
