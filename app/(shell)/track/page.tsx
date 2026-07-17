import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { RoomLockGate } from "@/components/shell/RoomLockGate";

export default function TrackPage() {
  return (
    <RoomLockGate room="track">
      <DocumentEditor kind="how" />
    </RoomLockGate>
  );
}
