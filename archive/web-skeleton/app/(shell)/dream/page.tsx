import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { RoomLockGate } from "@/components/shell/RoomLockGate";

export default function DreamPage() {
  return (
    <RoomLockGate room="dream">
      <DocumentEditor kind="why" />
    </RoomLockGate>
  );
}
