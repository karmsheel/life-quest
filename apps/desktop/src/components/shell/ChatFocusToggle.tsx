import { Maximize2, Minimize2 } from "lucide-react";
import { useChatDock } from "@/state/ChatDockProvider";

/**
 * The full-screen chat door.
 *
 * One component, two places: the chat dock's top row and the window title bar's
 * trailing cluster. Both toggle the same dock flag, so they can never disagree
 * about the mode; the only difference is the words each says. The dock's control
 * names the mode from inside the chat ("Full screen chat" → "Exit full screen
 * chat"), and the title bar's names the pane it takes away ("Collapse main
 * page" → "Restore main page"), because the title bar's operator is reading the
 * page, not the dock.
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
  /** Which door this instance is — the two are told apart by the rigs. */
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
