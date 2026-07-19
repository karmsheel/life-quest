import type { DocumentKind, RoomId } from "@lifequest/vault-core";
import { RoomLockGate } from "@/components/shell/RoomLockGate";
import { useActiveDomain } from "@/components/shell/useActiveDomain";

/** Map routes: dream→why, chart→what, track→how */
const ROOM_KIND: Record<Exclude<RoomId, "act">, DocumentKind> = {
  dream: "why",
  chart: "what",
  track: "how",
};

const ROOM_LABELS: Record<Exclude<RoomId, "act">, string> = {
  dream: "Dream",
  chart: "Chart",
  track: "Track",
};

const KIND_LABELS: Record<DocumentKind, string> = {
  why: "Why",
  what: "What",
  how: "How",
};

export default function RoomPage({
  room,
}: {
  room: Exclude<RoomId, "act">;
}) {
  const kind = ROOM_KIND[room];
  const activeDomain = useActiveDomain();
  const doc = activeDomain?.documents[kind];

  return (
    <RoomLockGate room={room}>
      <div className="stub-page">
        <h1 className="stub-page__title">{ROOM_LABELS[room]}</h1>
        <p className="stub-page__desc muted">
          Pillar document: <strong>{KIND_LABELS[kind]}</strong>
          {activeDomain ? ` · ${activeDomain.meta.name}` : ""}. Editor arrives in
          a later task.
        </p>
        {doc ? (
          <dl className="room-meta">
            <div>
              <dt className="muted">Status</dt>
              <dd>{doc.status}</dd>
            </div>
            <div>
              <dt className="muted">Title</dt>
              <dd>{doc.title || "—"}</dd>
            </div>
            <div>
              <dt className="muted">Body</dt>
              <dd>{doc.bodyMarkdown.trim() ? `${doc.bodyMarkdown.trim().length} chars` : "empty"}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted">No active domain documents loaded.</p>
        )}
      </div>
    </RoomLockGate>
  );
}
