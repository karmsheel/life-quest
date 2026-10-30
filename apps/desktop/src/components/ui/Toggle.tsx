/**
 * A switch for a setting that is either on or off.
 *
 * It is a button wearing `role="switch"` rather than a checkbox because pressing
 * it is the whole act: the preference is written the moment it moves, there is no
 * form to submit and no third, indeterminate state. The button element brings the
 * keyboard contract with it — Enter and Space both press it — along with the
 * disabled handling a write in flight needs and the focus ring; the track and
 * thumb are decoration, so a reader hears the label and `aria-checked`, not the
 * two spans.
 *
 * The switch carries no caption of its own. A settings row already says what the
 * setting is in its label and description, and an "On"/"Off" beside the thumb
 * would repeat the thumb's own position in words.
 *
 * A caption is the one exception: where the switch stands beside a name that
 * does not describe it — a domain's row with its own arms-restore switch — the
 * words belong to the switch, and they are part of its button so the whole
 * control, not just the thumb, is the target.
 */
export function Toggle({
  checked,
  onChange,
  label,
  caption,
  disabled = false,
  className = "",
}: {
  /** Whether the setting is on right now — the thumb's position. */
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The control's accessible name, e.g. "Preview the update badge". */
  label: string;
  /** Visible words beside the track, when the row's own label is not this bit. */
  caption?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={["ui-toggle", checked ? "is-on" : "", className]
        .filter(Boolean)
        .join(" ")}
      data-state={checked ? "on" : "off"}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
    >
      {caption ? <span className="ui-toggle__caption">{caption}</span> : null}
      <span className="ui-toggle__track" aria-hidden="true">
        <span className="ui-toggle__thumb" />
      </span>
    </button>
  );
}
