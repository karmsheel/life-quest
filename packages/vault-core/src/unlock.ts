import { ROOM_IDS, type DocumentKind, type RoomId } from "./types.ts";

export type UnlockDoc = { kind: DocumentKind; bodyMarkdown: string };

export type UnlockDomain = {
  archivedAt: string | null;
  documents: UnlockDoc[];
};

export function isNonEmptyBody(body: string): boolean {
  return body.trim().length > 0;
}

function bodyOf(docs: UnlockDoc[], kind: DocumentKind): string {
  return docs.find((d) => d.kind === kind)?.bodyMarkdown ?? "";
}

export function getUnlockedRooms(_domains: UnlockDomain[]): Set<RoomId> {
  return new Set<RoomId>(ROOM_IDS);
}

export function isRoomUnlocked(room: RoomId, domains: UnlockDomain[]): boolean {
  return getUnlockedRooms(domains).has(room);
}

export function canDispatchAgent(docs: UnlockDoc[]): boolean {
  return isNonEmptyBody(bodyOf(docs, "how"));
}
