/**
 * Renderer-side automation vocabulary.
 *
 * Types and the rules for a due schedule are re-exported from the browser-safe
 * barrel; the store itself lives in main. `AUTOMATIONS_CHANGED_EVENT` is the
 * one window signal that says a run was recorded or the shelf was edited, so
 * every open surface reloads from the same store rather than keeping a copy.
 */
import type { AutomationRecord } from "@lifequest/vault-core/pure";

export {
  ANALYZE_NOTE_AUTOMATION_ID,
  AUTOMATION_HOSTS,
  AUTOMATION_RUN_STATUSES,
  AUTOMATION_TRIGGER_TYPES,
  DEFAULT_ANALYZE_AUTOMATION,
  DEFAULT_ANALYZE_PROMPT,
  automationContextFor,
  automationIsDue,
  automationTriggerLabel,
  coerceAutomationTrigger,
  formatAutomationSchedule,
  latestScheduleOccurrence,
  parseAutomationInput,
  renderAutomationPrompt,
  type AutomationHost,
  type AutomationInput,
  type AutomationRecord,
  type AutomationRunPatch,
  type AutomationRunStatus,
  type AutomationScheduleFrequency,
  type AutomationTrigger,
  type AutomationTriggerType,
} from "@lifequest/vault-core/pure";

/** Fired after any write to the automation store, including a recorded run. */
export const AUTOMATIONS_CHANGED_EVENT = "lifequest:automations-changed";

export function notifyAutomationsChanged(): void {
  window.dispatchEvent(new Event(AUTOMATIONS_CHANGED_EVENT));
}

/** The host's name in a row, an editor or a chat title. */
export function automationHostLabel(host: AutomationRecord["host"]): string {
  return host === "daily-note" ? "Daily Note" : "No page";
}

/** The built-in's button keeps its original test id; user rows get their own. */
export function dailyNoteAutomationTestId(id: string): string {
  return id === "daily-note-analyze"
    ? "daily-note-analyze"
    : `daily-note-automation-${id}`;
}
