import { SheetOverlay } from "@/components/shell/SheetOverlay";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";

/**
 * Focus mode: the day's note alone, over the page it came from.
 *
 * The Daily Note page is a page of prose with a pager above it, a status line
 * under it and the journal below it. That is the right page, but it is not what
 * writing a day needs: the operator asked for the note without the page around
 * it. So focus mode is the app's sheet frame at a narrower measure — the page
 * blurs behind a writing column, the title is centred over the box, and nothing
 * else is on the surface: no pager, no journal, no automations. The cross and a
 * click outside leave, and the day is still the day's, with the same draft the
 * page holds and the same autosave under it.
 *
 * The frame supplies the arrival, the exit, the blurred scrim, the focus trap
 * and the three ways out (`SheetOverlay`); this file supplies what the surface
 * *is*. The editor is the same one box every markdown surface in the studio
 * uses, mounted with `autoEdit` because a box opened to write should arrive with
 * the caret in it. The status line appears only while there is something to say
 * — a save in flight, or the vault's refusal on screen — so at rest the surface
 * is exactly the title and the prose.
 */
export function FocusModeOverlay({
  date,
  dateLabel,
  value,
  onChange,
  status,
  error,
  onClose,
}: {
  /** The day the note belongs to, for the editor's media slug. */
  date: string;
  /** The day as the page prints it, for the box's accessible name. */
  dateLabel: string;
  value: string;
  onChange: (next: string) => void;
  /** The page's autosave line: printed only while it has something to say. */
  status: string;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <SheetOverlay
      sheet="focus"
      title="Daily Note"
      showTitle
      closeLabel="Close focus mode"
      onClose={onClose}
      bodyClassName="focus-overlay__body"
    >
      {error ? (
        <p className="form-error focus-overlay__error" role="alert">
          {error}
        </p>
      ) : null}
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
      {!error && (status === "Saving…" || status === "Not saved") ? (
        <p className="focus-overlay__status muted" role="status">
          {status}
        </p>
      ) : null}
    </SheetOverlay>
  );
}
