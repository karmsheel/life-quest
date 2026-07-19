import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { RoomLockGate } from "@/components/shell/RoomLockGate";

export default function ChartPage() {
  return (
    <RoomLockGate room="chart">
      <DocumentEditor kind="what" />
    </RoomLockGate>
  );
}
