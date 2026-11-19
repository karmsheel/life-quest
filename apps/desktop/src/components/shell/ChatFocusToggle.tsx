import { Maximize2, Minimize2 } from "lucide-react";
import { useChatDock } from "@/state/ChatDockProvider";

/**
 * The full-screen chat door.
 *
 * The dock's own control, drawn at the trailing end of its top row. It is the
 * window's one door to the mode (the title bar carries no second copy, and
 * Mod+Shift+F is the shortcut), so it names the mode from inside the chat:
 * "Full screen chat" → "Exit full screen chat".
 *
 * The icon turns around rather than changing meaning: maximize while the mode is
 * off, minimize while it is on, the same arrow-pair language the rail's own
 * collapse control uses. The press is a state, not a one-way door, so the
 * control carries `aria-pressed` and stays put in both modes.
 */
export function ChatFocusToggle({
  className,
  testId,
  offLabel,
  onLabel,
}: {
  className?: string;
  /** The rigs tell this control apart by its test id. */
  testId: string;
  /** The words said while the mode is off. */
  offLabel: string;
  /** The words said while the mode is on. */
  onLabel: string;
}) {
  const { focus, toggleFocus } = useChatDock();
  const label = focus ? onLabel : offLabel;

  return (
    <button
      type="button"
      className={["chat-focus-toggle", className].filter(Boolean).join(" ")}
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-pressed={focus}
      onClick={toggleFocus}
    >
      {focus ? (
        <Minimize2 size={15} aria-hidden />
      ) : (
        <Maximize2 size={15} aria-hidden />
      )}
    </button>
  );
}
