import { compareIso } from "@lifequest/vault-core/map";
import type { IsoDate } from "@lifequest/vault-core/map";

export function rangeFromDrag(a: IsoDate, b: IsoDate): { start: IsoDate; end: IsoDate } {
  return compareIso(a, b) <= 0 ? { start: a, end: b } : { start: b, end: a };
}
