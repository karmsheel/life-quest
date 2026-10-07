import { useEffect, useId, useState } from "react";
import { Button } from "./Button.tsx";

export type ConfirmDialogProps = {
  open: boolean;
  /** The question, as a heading. */
  title: string;
  /** What confirming does, in the operator's words — including what it costs. */
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles and orders the confirming control as the irreversible one. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The app's own confirmation, drawn in the app's own window.
 *
 * `window.confirm` is a dialog owned by the platform: it centres on the
 * *display*, not on the application window, so in a half-width window it lands
 * nowhere near the surface that asked; it cannot be themed; and no rig can click
 * it, so a flow that depends on it can only be tested through a stub. This is
 * the in-window equivalent — a fixed backdrop over the viewport with a centred
 * card — and it is what a destructive write asks through.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const [pending, setPending] = useState(false);

  // Each opening starts clean: a `pending` left over from the last question would
  // freeze the buttons of the next one.
  useEffect(() => {
    if (open) setPending(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      // Clicking away is a cancel, like the app's other dialogs — never a confirm.
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 className="confirm-dialog__title" id={titleId}>
          {title}
        </h2>
        <p className="confirm-dialog__message" id={messageId}>
          {message}
        </p>
        <div className="confirm-dialog__actions">
          {/* Cancel takes the focus: the confirming control is the irreversible
              one, so a stray Enter must not take it. */}
          <Button
            variant="outline"
            autoFocus
            className="confirm-dialog__cancel"
            aria-label={cancelLabel}
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            destructive={destructive}
            variant={destructive ? "outline" : "primary"}
            className="confirm-dialog__confirm"
            aria-label={confirmLabel}
            disabled={pending}
            onClick={() => {
              setPending(true);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
