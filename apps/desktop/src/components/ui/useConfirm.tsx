import { useCallback, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

export type ConfirmRequest = {
  /** The question, as a heading. */
  title: string;
  /** What answering yes does, in the operator's words. */
  message: string;
  /** What the confirming control says. */
  confirmLabel: string;
  /**
   * Mark the confirming control as the irreversible one. Leave it off when the
   * write is a soft one the app can bring back — an archive, a hide.
   */
  destructive?: boolean;
  /** The write. The dialog promises it, so it fires only on yes. */
  run: () => void;
};

/**
 * The app's `window.confirm`: a yes/no question about a write, asked inside the
 * application's own window.
 *
 * A platform confirm is owned by the platform. It centres on the *display*
 * rather than the window the app is running in, so with the window on half a
 * screen the question lands over the desktop instead of over the pane that asked
 * it — nothing in the app's CSS can move it, and no rig can click it. Every
 * surface that used to call it asks through here instead: `ask` poses the
 * question, and `dialog` is the element to render (once, anywhere in the
 * component's tree).
 *
 * `when` gates the dialog on something only the caller knows — a dock that draws
 * a collapsed state of its own — so a question asked from a surface that is no
 * longer up cannot float over the one that is.
 */
export function useConfirm(when = true) {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);

  const ask = useCallback((request: ConfirmRequest) => setPending(request), []);

  const dialog = (
    <ConfirmDialog
      open={when && pending !== null}
      title={pending?.title ?? ""}
      message={pending?.message ?? ""}
      confirmLabel={pending?.confirmLabel ?? "Confirm"}
      destructive={pending?.destructive ?? false}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const request = pending;
        setPending(null);
        request?.run();
      }}
    />
  );

  return { ask, dialog };
}
