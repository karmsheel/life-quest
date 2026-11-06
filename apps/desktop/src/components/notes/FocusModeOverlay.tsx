import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { SheetOverlay } from "@/components/shell/SheetOverlay";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
import { Button } from "@/components/ui/Button";

/**
 * Focus mode: the day's note alone, over the page it came from.
 *
 * The Daily Note page is a page of prose with a pager above it, a status line
 * under it and the journal below it. That is the right page, but it is not what
 * writing a day needs: the operator asked for the note without the page around
 * it. So focus mode is the app's sheet frame at a notepad's measure — the page
 * blurs behind a page of paper, the day's date is printed at the top of it, and
 * nothing else is on the surface: no pager, no journal, no automations in the
 * header. The cross and a click outside leave, and the day is still the day's,
 * with the same draft the page holds and the same autosave under it.
 *
 * The frame supplies the arrival, the exit, the blurred scrim, the focus trap
 * and the three ways out (`SheetOverlay`); this file supplies what the surface
 * *is*. The editor is the same one box every markdown surface in the studio
 * uses, mounted with `autoEdit` because a box opened to write should arrive with
 * the caret in it.
 *
 * THE PAGE OF PAPER
 *
 * Focus mode was a narrow column of prose floating in a sheet. It read as a
 * form field with a lot of empty margin around it rather than as a page of
 * notepaper, and the operator had to keep the Daily Note page behind it in
 * their head to remember which day they were writing. So the sheet is now a
 * page of paper rather than a reading column:
 *
 *  - The day is printed at the top of the page, over the prose, in the page's
 *    own date form. The sheet's title stays "Daily Note" — that is the
 *    surface's name, and the sheet frame needs one — and the date becomes the
 *    page's heading, the way a page of a journal is headed.
 *  - The day's own act — Analyze note — moves to the foot of the page, under
 *    the prose, where a note is committed rather than where the page's window
 *    chrome is. It is the one control that acts on the day, and a page's own
 *    control belongs to the page.
 *  - The autosave line keeps its own band under the prose, and the band is
 *    always there rather than appearing and disappearing: the line only ever
 *    had words in it while a write was in flight, and a page whose foot
 *    changes height when the notification arrives is a page that jumps under
 *    the operator's hands. The band is reserved space, so "Saving…" arrives in
 *    a place that was already there.
 */

/** One of the day's acts, offered at the foot of the page. */
export type FocusModeAction = {
  /** Stable id, used as the button's test id. */
  id: string;
  /** The act's own name, printed on the button. */
  label: string;
  /** The act's own explanation, on hover. */
  title?: string;
  /** The act is not available right now: an empty day, or one already running. */
  disabled?: boolean;
  /** What the button says while the act is being started. */
  busyLabel?: string;
  /** Whether the act is the one currently being started. */
  busy?: boolean;
  /** The act's own icon. */
  icon?: ReactNode;
  /** Pressed the act. */
  onPress: () => void;
};

export function FocusModeOverlay({
  date,
  dateLabel,
  weekday,
  value,
  onChange,
  status,
  error,
  actions = [],
  onClose,
}: {
  /** The day the note belongs to, for the editor's media slug. */
  date: string;
  /** The day as the page prints it, for the box's accessible name. */
  dateLabel: string;
  /** The day's weekday, for the header: "Thursday, 6 November 2026". */
  weekday?: string | null;
  value: string;
  onChange: (next: string) => void;
  /** The page's autosave line: printed only while it has something to say. */
  status: string;
  error: string | null;
  /** The day's own acts, offered at the foot of the page. */
  actions?: FocusModeAction[];
  onClose: () => void;
}) {
  return (
    <SheetOverlay
      sheet="focus"
      title="Daily Note"
      closeLabel="Close focus mode"
      onClose={onClose}
      bodyClassName="focus-overlay__body"
    >
      {error ? (
        <p className="form-error focus-overlay__error" role="alert">
          {error}
        </p>
      ) : null}
      {/* The page's one heading: the day, centred over the prose. The sheet's
          own title is hidden rather than removed — it still names the surface
          for a screen reader and for the frame's accessible name, but the page
          the operator sees is headed by the day and nothing else. */}
      <h2 className="focus-overlay__date" data-testid="focus-overlay-date">
        {weekday ? `${weekday}, ` : ""}
        {dateLabel}
      </h2>
      <div className="focus-overlay__note">
        <LiveMarkdownEditor
          testId="daily-note-focus-editor"
          value={value}
          onChange={onChange}
          slug={`daily-note-${date}`}
          ariaLabel={`Daily note for ${dateLabel} in focus mode`}
          autoEdit
        />
      </div>
      {/* The page's foot: the autosave band and the day's own acts. The band is
          always mounted, so a write landing does not change the page's height
          under the operator's hands — the words arrive in a place that was
          already there. */}
      <div className="focus-overlay__foot">
        <p
          className="focus-overlay__status muted"
          data-testid="focus-overlay-status"
          role="status"
          aria-live="polite"
        >
          {!error && (status === "Saving…" || status === "Not saved") ? status : ""}
        </p>
        {actions.length > 0 ? (
          <div className="focus-overlay__actions">
            {actions.map((action) => (
              <Button
                key={action.id}
                variant="raised"
                className="focus-overlay__action"
                data-testid={`focus-overlay-action-${action.id}`}
                onClick={action.onPress}
                disabled={action.disabled}
                title={action.title}
              >
                {action.icon ?? <Sparkles size={14} aria-hidden />}
                {action.busy ? (action.busyLabel ?? action.label) : action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </SheetOverlay>
  );
}
