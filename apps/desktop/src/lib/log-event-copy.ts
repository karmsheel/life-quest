/**
 * The Log's event names are data — `domain.created`, `domain.unlocked` — and
 * they stay that way in the vault. The operator reads one word for the concept
 * everywhere else, so the one column that prints the raw name translates the
 * prefix rather than teaching a second vocabulary.
 *
 * The onboarding events are the exception that proves the rule: they have no
 * concept word to translate, and `onboarding.started` in a Log column reads as
 * plumbing. Both are named in the operator's language here — the interview is
 * the only thing that writes them.
 */
const EVENT_LABELS: Record<string, string> = {
  "onboarding.started": "Onboarding started",
  "onboarding.completed": "Onboarding complete",
};

export function displayEventType(type: string): string {
  const label = EVENT_LABELS[type];
  if (label) return label;
  return type.startsWith("domain.")
    ? `area.${type.slice("domain.".length)}`
    : type;
}
