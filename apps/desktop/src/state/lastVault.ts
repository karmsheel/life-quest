/** Path to reopen on cold start, or null (Welcome). */
export function lastVaultToReopen(
  snapshot: object | null,
  recent: { path: string }[],
): string | null {
  if (snapshot) return null;
  const path = recent[0]?.path?.trim();
  return path || null;
}
