import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useVault } from "@/state/VaultProvider";

/**
 * The window that answers "which vault am I in?". The titlebar's vault chip
 * raises it; every known vault is one click away.
 *
 * The chip used to be a link to /home, so the one control naming the workspace
 * did nothing an operator could see — the app's own answer to "am I in the right
 * vault?" was a no-op. Switching vaults is the thing the chip should do, and the
 * recents the provider already keeps are the list it should offer.
 *
 * Drawn in a portal on `document.body`, like the update dialog. The titlebar is
 * a fixed-height strip with `overflow: hidden` and is the window's drag region
 * besides: a popup left inside it would be clipped by the strip and its clicks
 * swallowed by the drag band.
 *
 * Dismissal is refused while a switch is in flight. The open is one atomic act —
 * ask the picker, open the folder — and a dialog that vanished in the middle of
 * it would leave the operator with no surface on which a refusal could appear.
 *
 * Focus goes to the card, not to its first control: a dialog that opens with the
 * first vault row armed turns a stray Enter into an unintended switch.
 */
export function VaultSwitcherDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { snapshot, recent, busy, error, openVault, openRecent, clearError } =
    useVault();
  const navigate = useNavigate();
  const titleId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const currentPath = snapshot?.rootPath ?? null;

  useEffect(() => {
    if (!open) return;
    // This opening has not been refused anything yet: the last attempt's error
    // described a folder nobody is looking at now.
    clearError();
    dialogRef.current?.focus();
  }, [open, clearError]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape is a dismissal, never a switch, and not a way out mid-flight.
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  /**
   * Both ways out end the same way: a successful switch closes this dialog and
   * puts the operator on the board the new vault feeds. A refusal leaves the
   * dialog up — the provider's `error` is painted below — so the folder can be
   * picked again without reopening this window.
   */
  async function finishSwitch(switched: boolean) {
    if (!switched) return;
    onClose();
    navigate("/home", { replace: true });
  }

  return createPortal(
    <div
      className="vault-switcher-backdrop"
      role="presentation"
      onClick={(event) => {
        // Clicking away is a dismissal, like the app's other dialogs — and never
        // an answer to a switch that is already running.
        if (event.target !== event.currentTarget || busy) return;
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="vault-switcher"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        data-vault-switcher="true"
      >
        <header className="vault-switcher__header">
          <div>
            <h2 className="vault-switcher__title" id={titleId}>
              Switch vault
            </h2>
            <p className="vault-switcher__hint" id={hintId}>
              A vault is a folder on this computer. Switching loads that folder's
              files in place — nothing is moved or deleted.
            </p>
          </div>
          <button
            type="button"
            className="vault-switcher__close"
            aria-label="Close vault switcher"
            data-vault-close="true"
            disabled={busy}
            onClick={onClose}
          >
            <X size={14} aria-hidden />
          </button>
        </header>

        {error ? (
          <p className="vault-switcher__error form-error" role="alert">
            {error}
          </p>
        ) : null}

        {recent.length > 0 ? (
          <ul className="vault-switcher__list">
            {recent.map((entry) => {
              const isCurrent = entry.path === currentPath;
              return (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="vault-switcher__row"
                    data-vault-path={entry.path}
                    title={entry.path}
                    // "Open now" is the operator's answer to which vault is
                    // writing their file; the row that carries it is the vault
                    // this window already has open, so it is a status, not a
                    // switch, and asking it to reopen itself would only reload
                    // the same files.
                    aria-current={isCurrent ? "true" : undefined}
                    disabled={busy || isCurrent}
                    onClick={() => void openRecent(entry.path).then(finishSwitch)}
                  >
                    <span className="vault-switcher__row-text">
                      <span className="vault-switcher__row-name">
                        {entry.name}
                      </span>
                      <span className="vault-switcher__row-path">
                        {entry.path}
                      </span>
                    </span>
                    {isCurrent ? (
                      <span className="vault-switcher__current">Open now</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="vault-switcher__empty">
            No vaults opened yet on this computer. Open a folder to give this
            window a vault of its own.
          </p>
        )}

        <div className="vault-switcher__actions">
          {/*
            The escape hatch from the recents list: a folder that has never been
            opened here does not appear above, and it is exactly the one an
            operator who is "in the wrong vault" most often means.
          */}
          <Button
            type="button"
            variant="outline"
            className="vault-switcher__open-folder"
            data-vault-open-folder="true"
            disabled={busy}
            onClick={() => void openVault().then(finishSwitch)}
          >
            {busy ? "Opening…" : "Open another folder…"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
