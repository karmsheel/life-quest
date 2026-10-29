import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * The sheet frame the app's floating surfaces share.
 *
 * Settings and the decisions inbox are not pages in this app — they are
 * surfaces over the page you were on. The whole window dims and blurs behind a
 * panel that takes most of it, the surface scrolls inside that frame, and the
 * app underneath is still the app: the rail, the titlebar and the dock stay
 * where they were, out of reach behind the scrim.
 *
 * The frame is shared; the measure is not. Each sheet caps its own width in
 * global.css (`--settings` at its workbench measure, `--decisions` at its
 * reading column), so a window wider than that measure grows mat around the
 * surface instead of stretching a form across it.
 *
 * Three ways out, because a sheet this large has no close-button muscle memory
 * yet: the cross at the top right, a click on the scrim, and Escape.
 *
 * Portalled to `<body>`: `.shell__content` is a scrolling, padded column, and a
 * fixed scrim painted inside it would be clipped by its scroll box and would
 * still have to outrank the titlebar. The portal makes the sheet's share of the
 * window mean the window itself, not the scroll box it was painted in.
 */
export function SheetOverlay({
  sheet,
  title,
  subtitle,
  showTitle = false,
  closeLabel,
  onClose,
  onEscape,
  header,
  initialFocusRef,
  scroll = false,
  bodyClassName,
  children,
}: {
  sheet: "settings" | "decisions";
  title: string;
  subtitle?: ReactNode;
  /** Settings keeps its heading hidden: the search bar is its one top field. */
  showTitle?: boolean;
  closeLabel: string;
  onClose: () => void;
  /**
   * Escape hook for a sheet with an inner step to unwind first. Returning true
   * says the key was consumed; the sheet stays up.
   */
  onEscape?: () => boolean;
  /** Chrome between the title and the cross — settings' search field. */
  header?: ReactNode;
  /** What receives the caret on open, and what catches it if it leaves. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Let the body scroll as one column (decisions) instead of owning a layout. */
  scroll?: boolean;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  /** The control the operator pressed to get here, so leaving can hand it back. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = "sheet-overlay-title";

  const focusTarget = useCallback(
    () => initialFocusRef?.current ?? panelRef.current,
    [initialFocusRef],
  );

  /**
   * Escape unwinds one step at a time where a sheet has an inner step (a search
   * in progress clears, and only an empty search closes settings). Closing a
   * frame this large by reflex while a query is half-typed is the one dismissal the
   * operator did not ask for.
   *
   * A question asked over the sheet — the app's own confirm, or the update dialog
   * — takes the Escape first: those listen on `window` too, and this listener was
   * registered earlier, so `defaultPrevented` cannot be relied on to tell whose
   * key it is.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".confirm-dialog-backdrop, .update-dialog-backdrop")) {
        return;
      }
      if (onEscape?.()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onClose();
    },
    [onClose, onEscape],
  );

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) restoreFocusRef.current = active;
    return () => {
      const target = restoreFocusRef.current;
      // `preventScroll`: a sheet closes back onto the page exactly where it was.
      // Focusing a trigger near the top of a scrolled page must not make the
      // browser and the keyboard's own refocus move the operator's place.
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    focusTarget()?.focus();
  }, [focusTarget]);

  /**
   * `aria-modal` is a promise that the rest of the app is inert, so the caret has
   * to stay in the frame too: without this, Tab walks off the sheet's last control
   * and into the blurred page behind it, where the operator cannot see what they
   * are about to press.
   *
   * A dialog raised over the sheet (a confirmation) is a `role="dialog"` of its
   * own and owns the caret while it is up — including the sheet's own panel, which
   * is the other dialog in the document.
   */
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[role="dialog"]')) return;
      focusTarget()?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [focusTarget]);

  /** The scrim is the frame's negative space: a press that starts there closes. */
  const onScrimMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      onClose();
    },
    [onClose],
  );

  const overlay = (
    <div
      className={`sheet-overlay sheet-overlay--${sheet} ${sheet}-overlay`}
      role="presentation"
      data-sheet-overlay=""
      {...(sheet === "settings"
        ? { "data-settings-overlay": "" }
        : { "data-decisions-overlay": "" })}
      onMouseDown={onScrimMouseDown}
    >
      <div
        ref={panelRef}
        className={`sheet-overlay__panel sheet-overlay__panel--${sheet} ${sheet}-overlay__panel`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={`sheet-overlay__chrome ${sheet}-overlay__chrome`}>
          <div className="sheet-overlay__heading">
            <h2
              id={titleId}
              className={showTitle ? "sheet-overlay__title" : "visually-hidden"}
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="sheet-overlay__subtitle">{subtitle}</p>
            ) : null}
          </div>
          {header}
          {/* The cross is the sheet's last control, at its top right: the corner
              a hand goes to when the frame has no title bar to close from. */}
          <button
            type="button"
            className={`sheet-overlay__close ${sheet}-overlay__close`}
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div
          className={[
            "sheet-overlay__body",
            scroll ? "sheet-overlay__body--scroll" : "",
            bodyClassName ?? "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
