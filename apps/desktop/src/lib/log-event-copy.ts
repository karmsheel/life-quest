/**
 * The Log's event names are data — `domain.created`, `domain.unlocked` — and
 * they stay that way in the vault. The operator reads one word for the concept
 * everywhere else, so the one column that prints the raw name translates the
 * prefix rather than teaching a second vocabulary.
 */
export function displayEventType(type: string): string {
  return type.startsWith("domain.")
    ? `area.${type.slice("domain.".length)}`
    : type;
}
