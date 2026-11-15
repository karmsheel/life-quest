import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  DEFAULT_REVIEW_AVAILABILITY,
  defaultReviewAvailability,
  isReviewTimeOfDay,
  REVIEW_WINDOW_MAX_DAYS,
  reviewWindowSummary,
  type ReviewAvailability,
  type ReviewCadence,
  type ReviewWindow,
} from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useVault } from "@/state/VaultProvider";

/**
 * When each review opens.
 *
 * A review is writable a little before its period ends — long enough to write
 * the week up while the week is still going, not so long that there is nothing
 * to say yet. Each cadence is one row: how many days before the period ends the
 * window opens, and the wall-clock time of day it opens at. The defaults are the
 * operator's own words — daily at 18:00 on the day, weekly at 08:00 on the
 * week's last day, monthly on the second-last day, quarterly on the third-last,
 * yearly on 25 December — and they live in the engine's
 * `DEFAULT_REVIEW_AVAILABILITY`.
 *
 * Every write sends the whole `reviewAvailability` object through
 * `updateSettings`, because the engine replaces the field with the patch rather
 * than merging into it. The value is read defensively: a vault written before
 * this setting existed has no key, and the built-in windows stand in rather than
 * five rows of blanks.
 */

/** The five cadences in the order the reviews themselves are named. */
const CADENCES: { id: ReviewCadence; label: string; noun: string }[] = [
  { id: "daily", label: "Daily review", noun: "day" },
  { id: "weekly", label: "Weekly review", noun: "week" },
  { id: "monthly", label: "Monthly review", noun: "month" },
  { id: "quarterly", label: "Quarterly review", noun: "quarter" },
  { id: "yearly", label: "Yearly review", noun: "year" },
];

/** A copy of the five windows, so the draft never aliases the saved snapshot. */
function copyAvailability(value: ReviewAvailability): ReviewAvailability {
  const next = {} as ReviewAvailability;
  for (const { id } of CADENCES) next[id] = { ...value[id] };
  return next;
}

/** The first thing wrong with a draft, said in the row's own name. */
function validate(draft: ReviewAvailability): string | null {
  for (const { id, label } of CADENCES) {
    const window = draft[id];
    if (
      !Number.isInteger(window.daysBeforeEnd) ||
      window.daysBeforeEnd < 0 ||
      window.daysBeforeEnd > REVIEW_WINDOW_MAX_DAYS
    ) {
      return `${label}: days before the period ends must be a whole number from 0 to ${REVIEW_WINDOW_MAX_DAYS}.`;
    }
    if (!isReviewTimeOfDay(window.timeOfDay)) {
      return `${label}: choose a time of day.`;
    }
  }
  return null;
}

export function SettingsReview() {
  const { snapshot, updateSettings } = useVault();
  const saved: ReviewAvailability =
    snapshot?.settings.reviewAvailability ?? DEFAULT_REVIEW_AVAILABILITY;

  /**
   * The draft is what the operator is editing; the saved value only moves when
   * the engine answers. Initialised from the saved value so the shipped defaults
   * are what a first open shows.
   */
  const [draft, setDraft] = useState<ReviewAvailability>(() =>
    copyAvailability(saved),
  );
  /** Whether the operator has touched anything; their edits are theirs to keep. */
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Adopt the saved value when the vault answers or a save lands — but never
  // under the operator's fingers: a late snapshot must not overwrite a draft
  // somebody is halfway through changing.
  useEffect(() => {
    if (edited) return;
    setDraft(copyAvailability(saved));
  }, [edited, saved]);

  function updateWindow(cadence: ReviewCadence, patch: Partial<ReviewWindow>) {
    setEdited(true);
    setError(null);
    setNotice(null);
    setDraft((current) => ({
      ...current,
      [cadence]: { ...current[cadence], ...patch },
    }));
  }

  function onDaysChange(cadence: ReviewCadence, raw: string) {
    // An emptied number field reads as zero rather than as NaN: the input is
    // controlled, and a NaN value would turn the field blank mid-retype. A
    // number the browser lets through out of range is caught by `validate`.
    const days = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isFinite(days)) return;
    updateWindow(cadence, { daysBeforeEnd: days });
  }

  async function onSave() {
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      setNotice(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateSettings({
        reviewAvailability: copyAvailability(draft),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEdited(false);
      setNotice("Review windows saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the review windows",
      );
    } finally {
      setBusy(false);
    }
  }

  function onRestoreDefaults() {
    setEdited(true);
    setError(null);
    setDraft(defaultReviewAvailability());
    // Restoring is only a draft change: nothing is written until Save, and the
    // operator has to know that.
    setNotice("Defaults restored — save review windows to apply them.");
  }

  return (
    <SettingsSection
      icon={<CalendarClock size={16} />}
      title="Review"
      subtitle="When each review opens"
      contentClassName="settings-card settings-review"
      banner={
        error || notice ? (
          <>
            {error ? (
              <p
                className="form-error"
                role="alert"
                data-testid="settings-review-error"
              >
                {error}
              </p>
            ) : null}
            {notice ? (
              <p
                className="form-message"
                role="status"
                data-testid="settings-review-notice"
              >
                {notice}
              </p>
            ) : null}
          </>
        ) : undefined
      }
    >
      <p className="settings-card__desc settings-review__intro">
        A review opens shortly before its period ends, so it can be written while
        the period is still going. Until then, the Review page stays on the
        previous period. Set how many days before the end the window opens, and
        the time of day it does.
      </p>

      <div className="settings-review__rows">
        {CADENCES.map(({ id, label, noun }) => {
          const window = draft[id];
          return (
            <SettingsRow
              key={id}
              className="settings-review__row"
              label={label}
              description={`How many days before the ${noun} ends, and at what time, this review opens.`}
              note={
                <span
                  className="settings-review__preview"
                  data-testid={`settings-review-preview-${id}`}
                >
                  {reviewWindowSummary(window, id)}
                </span>
              }
              action={
                <div className="settings-review__controls">
                  <label className="settings-field settings-review__field">
                    <span>Days before the end</span>
                    <input
                      type="number"
                      min={0}
                      max={REVIEW_WINDOW_MAX_DAYS}
                      step={1}
                      data-testid={`settings-review-days-${id}`}
                      value={window.daysBeforeEnd}
                      onChange={(event) => onDaysChange(id, event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="settings-field settings-review__field">
                    <span>Opens at</span>
                    <input
                      type="time"
                      data-testid={`settings-review-time-${id}`}
                      value={window.timeOfDay}
                      onChange={(event) =>
                        updateWindow(id, { timeOfDay: event.target.value })
                      }
                      disabled={busy}
                    />
                  </label>
                </div>
              }
            />
          );
        })}
      </div>

      <div className="settings-review__actions">
        <Button
          variant="primary"
          data-testid="settings-review-save"
          onClick={() => void onSave()}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save review windows"}
        </Button>
        <Button
          variant="outline"
          data-testid="settings-review-reset"
          onClick={onRestoreDefaults}
          disabled={busy}
        >
          Restore defaults
        </Button>
      </div>
    </SettingsSection>
  );
}
