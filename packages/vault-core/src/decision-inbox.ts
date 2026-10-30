import type { DecisionInboxSettings, Result } from "./types.ts";

/**
 * Whether the Decisions inbox opens and closes itself.
 *
 * Kept pure and outside the vault engine because three ends need the same rules:
 * the settings page validates what it is about to write, the main process
 * normalizes the value it reads back, and the watcher decides what "a new
 * decision" means. A second set of defaults in the renderer would be a second
 * answer to "what does an old vault do", and the operator would see one switch
 * position while the app behaved like the other.
 *
 * Both default to on: the inbox exists to interrupt, and a vault written before
 * these switches existed should behave the way the feature was described rather
 * than silently keep the old manual-only inbox.
 */

export const DEFAULT_DECISION_INBOX_SETTINGS: DecisionInboxSettings = {
  autoOpen: true,
  autoClose: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tolerant read for a settings file: a missing, legacy, or hand-edited value
 * falls back per field, so one bad key never turns the other switch off. This is
 * the shape `openVault` and `updateSettings` store, not the one they reject.
 */
export function decisionInboxFromUnknown(value: unknown): DecisionInboxSettings {
  if (!isRecord(value)) return { ...DEFAULT_DECISION_INBOX_SETTINGS };
  return {
    autoOpen:
      typeof value.autoOpen === "boolean"
        ? value.autoOpen
        : DEFAULT_DECISION_INBOX_SETTINGS.autoOpen,
    autoClose:
      typeof value.autoClose === "boolean"
        ? value.autoClose
        : DEFAULT_DECISION_INBOX_SETTINGS.autoClose,
  };
}

/**
 * Strict read for a write: every field present in the patch has to be a real
 * boolean, because silently coercing `"off"` or `1` would save a value the
 * operator did not choose. A partial patch is fine — omitted fields are filled
 * from the defaults, exactly as a vault that predates the setting would read.
 */
export function parseDecisionInboxPatch(
  value: unknown,
): Result<DecisionInboxSettings> {
  if (!isRecord(value)) {
    return { ok: false, error: "decisionInbox must be an object" };
  }
  if (value.autoOpen !== undefined && typeof value.autoOpen !== "boolean") {
    return { ok: false, error: "decisionInbox.autoOpen must be a boolean" };
  }
  if (value.autoClose !== undefined && typeof value.autoClose !== "boolean") {
    return { ok: false, error: "decisionInbox.autoClose must be a boolean" };
  }
  return {
    ok: true,
    value: {
      autoOpen:
        value.autoOpen !== undefined
          ? value.autoOpen
          : DEFAULT_DECISION_INBOX_SETTINGS.autoOpen,
      autoClose:
        value.autoClose !== undefined
          ? value.autoClose
          : DEFAULT_DECISION_INBOX_SETTINGS.autoClose,
    },
  };
}
