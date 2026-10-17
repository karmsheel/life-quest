export const SPLASH_FLOOR_MS = 1500;

export type SplashHoldInput = {
  elapsedMs: number;
  booting: boolean;
};

/**
 * Pure hold/dismiss for the cold-start splash.
 *
 * The splash covers the app's OWN boot — the renderer bundle, the first vault
 * read — and nothing else. It deliberately does not wait on the companion.
 *
 * `companionEnsure` spawns the Hermes CLI and, on the path where the host
 * gateway is not already serving the profile, runs `hermes config set` twice and
 * a `gateway restart` (45s per command) before polling for health for up to 90
 * seconds. Holding the splash for that made the splash's exit unbounded: the
 * renderer was painted and interactive at ~0.5s while the logo stayed up for the
 * whole 56s the companion took. The companion's own boot surface reports that
 * wait now — the same `.welcome` pane, carrying what it is doing, a Recheck and
 * the profile picker. A healthy companion answers in well under the floor, so on
 * a normal launch that surface is never seen.
 */
export function shouldHoldSplash(input: SplashHoldInput): boolean {
  if (input.booting) return true;
  return input.elapsedMs < SPLASH_FLOOR_MS;
}
