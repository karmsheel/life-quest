/**
 * Register the shell cache.
 *
 * Registration is best effort: a browser that refuses service workers (or a
 * page opened over plain http on a non-loopback host) must still show the app —
 * it just loses the offline shell, which the UI says rather than hides.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });
    void registration.update().catch(() => undefined);
  } catch {
    // Offline starts will show the network error instead of the shell.
  }
}
