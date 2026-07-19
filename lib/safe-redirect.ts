/**
 * Allow only same-origin relative paths for post-auth redirects.
 * Rejects open redirects (//evil.com, protocol-relative, external).
 */
export function safeInternalPath(
  raw: string | null | undefined,
  fallback = "/home",
): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.startsWith("/sign-in") || raw.startsWith("/sign-up")) return fallback;
  return raw;
}
