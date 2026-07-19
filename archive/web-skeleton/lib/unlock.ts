import type { DocumentKind, RoomId } from "./document-kinds.ts";

export type UnlockDoc = { kind: DocumentKind; bodyMarkdown: string };

export function isNonEmptyBody(body: string): boolean {
  return body.trim().length > 0;
}

function bodyOf(docs: UnlockDoc[], kind: DocumentKind): string {
  return docs.find((d) => d.kind === kind)?.bodyMarkdown ?? "";
}

export function getUnlockedRooms(docs: UnlockDoc[]): Set<RoomId> {
  const rooms = new Set<RoomId>(["dream"]);
  if (isNonEmptyBody(bodyOf(docs, "why"))) rooms.add("chart");
  if (isNonEmptyBody(bodyOf(docs, "what"))) rooms.add("track");
  if (isNonEmptyBody(bodyOf(docs, "how"))) rooms.add("act");
  return rooms;
}

export function isRoomUnlocked(room: RoomId, docs: UnlockDoc[]): boolean {
  return getUnlockedRooms(docs).has(room);
}
