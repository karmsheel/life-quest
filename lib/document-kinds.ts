export const DOCUMENT_KINDS = ["why", "what", "how"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = ["draft", "refined", "forged"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const ROOM_IDS = ["dream", "chart", "track", "act"] as const;
export type RoomId = (typeof ROOM_IDS)[number];

export function parseDocumentKind(s: string): DocumentKind | null {
  return (DOCUMENT_KINDS as readonly string[]).includes(s) ? (s as DocumentKind) : null;
}
