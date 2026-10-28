/**
 * The app's own on/off switch: one control, one bit, and a target big enough to
 * hit without aiming.
 *
 * This is deliberately not a checkbox dressed up. A checkbox says "include this
 * in the set"; a switch says "this is on now", and the settings rows use it
 * where the bit takes effect the moment it is flipped (arming a destructive
 * restore, for instance) rather than being read on submit. The track is
 * `--radius-pill` because a switch is the one control that is a shape rather
 * than a box, and the words beside it say what it arms.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  className = "",
  "data-testid": testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible words beside the track; also the accessible name unless overridden. */
  label?: string;
  /** Accessible name when the visible label is not the whole story. */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      data-testid={testId}
      disabled={disabled}
      className={["ui-toggle", checked ? "is-on" : "", className]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onChange(!checked)}
    >
      {label ? <span className="ui-toggle__label">{label}</span> : null}
      <span className="ui-toggle__track" aria-hidden>
        <span className="ui-toggle__thumb" />
      </span>
    </button>
  );
}
