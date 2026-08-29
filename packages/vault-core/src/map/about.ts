import { ok } from "./errors.ts";
import type { Result, StoreState } from "./types.ts";

export function setAboutMe(state: StoreState, text: string): Result<StoreState> {
  return ok({ ...state, aboutMe: text });
}
