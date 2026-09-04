export const SPLASH_FLOOR_MS = 800;

export type SplashHoldInput = {
  elapsedMs: number;
  booting: boolean;
  ensuring: boolean;
  kind: string | null | undefined;
};

/** Pure hold/dismiss for the cold-start splash. */
export function shouldHoldSplash(input: SplashHoldInput): boolean {
  if (input.ensuring || input.kind == null) return true;
  if (input.kind !== "ready") return false;
  if (input.booting) return true;
  return input.elapsedMs < SPLASH_FLOOR_MS;
}
