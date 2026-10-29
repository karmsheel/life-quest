/**
 * The page lock, as one switch.
 *
 * Every surface that can be locked wears this same control: the Dashboard's
 * board, a doctrine document and a library note. It replaces the pair of locked
 * "Lock"/"Unlock" buttons — a stateful control whose caption said which action
 * it would take, which read as a command rather than as a setting. The switch
 * says the state instead: the thumb is at rest while the page is editable and
 * moves across, and the caption turns amber, while the page is locked. The
 * badge beside the page's name repeats the state in words, so the control does
 * not have to carry both.
 *
 * It is a `Button` wearing `role="switch"` rather than a checkbox because it is
 * a command, not a form value: pressing it writes to the vault immediately. The
 * button element brings the keyboard contract (Enter and Space both press it)
 * and the disabled handling a busy write needs; `aria-checked` is the state a
 * reader hears.
 */
import { Button } from "./Button";

export function LockSwitch({
  locked,
  busy = false,
  onToggle,
  label,
  testId,
  className,
}: {
  /** Whether the page is locked right now — the switch's position. */
  locked: boolean;
  /** A write is in flight: the switch cannot be pressed again yet. */
  busy?: boolean;
  onToggle: () => void;
  /** The control's accessible name, e.g. "Lock this dashboard". */
  label: string;
  testId?: string;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      role="switch"
      aria-checked={locked}
      aria-label={label}
      title={label}
      className={`lock-switch${locked ? " lock-switch--on" : ""}${className ? ` ${className}` : ""}`}
      data-locked={locked ? "true" : "false"}
      data-testid={testId}
      disabled={busy}
      onClick={(event) => {
        // The switch can sit inside page chrome that is itself a click target;
        // flipping the lock is the whole press.
        event.stopPropagation();
        if (busy) return;
        onToggle();
      }}
    >
      <span className="lock-switch__caption">
        {busy ? "Saving…" : "Lock"}
      </span>
      <span className="lock-switch__track" aria-hidden="true">
        <span className="lock-switch__thumb" />
      </span>
    </Button>
  );
}
