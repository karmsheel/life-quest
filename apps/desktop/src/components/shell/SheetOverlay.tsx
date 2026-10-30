import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * How long the frame's exit motion runs before the page is told to leave.
 *
 * Mirrors `--dur-exit` in `tokens.css`: CSS owns the motion, this owns the
 * unmount that follows it, and the two have to agree or the panel either snaps
 * away mid-flight or sits there after it has finished fading. A test that reads
 * one and not the other would pass while the shipped pair disagreed.
 */
const SHEET_EXIT_MS = 140;

/**
 * The frame's own close, for a surface inside the sheet that closes it.
 *
 * Most closers are the frame's own (the cross, the scrim, Escape) and never need
 * this. The decisions inbox is the exception: answering the last Decision closes
 * the sheet from the body, and it must leave the same way every other closer
 * does — the exit motion, then the route — rather than unmounting the frame from
 * under its own transition. `useSheetCloseRequest` hands it that close; the
 * fallback keeps a body rendered without a frame (a rig drawing the inbox alone)
 * from having nothing to call.
 */
const SheetCloseContext = createContext<(() => void) | null>(null);

export function useSheetCloseRequest(fallback?: () => void): () => void {
  const requestClose = useContext(SheetCloseContext);
  return requestClose ?? fallback ?? noop;
}

function noop(): void {
  /* A body with no frame and no fallback has nothing to close. */
}

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
 *
 * THE ARRIVAL AND THE LEAVE
 *
 * A surface this large appearing between one frame and the next reads as a
 * flash, and vanishing in one frame reads as a dismissal the operator did not
 * get to see finish. So the frame moves: the scrim fades in while the panel
 * settles up from a hair below (200ms, the app's `--ease-out`), and on the way
 * out the panel drops a few pixels as it fades while the scrim trails it
 * (140ms). The distances are deliberately tiny — this panel is a large share of
 * the window, and a large slide would read as a page transition rather than a
 * surface arriving over one.
 *
 * The exit half needs presence: the route change that unmounts the sheet is
 * deferred until the motion has played, which is why every closer (cross, scrim,
 * Escape, and a body's own close through `useSheetCloseRequest`) goes through
 * `requestClose` instead of the page's `onClose` directly. Under
 * `prefers-reduced-motion: reduce` there is no motion and no wait: the frame
 * leaves the instant it is asked to.
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
  floating,
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
  /** Chrome between the title and the cross, inside the panel. */
  header?: ReactNode;
  /**
   * Chrome that crosses the panel's own top edge, centred over the frame — the
   * settings search field. Rendered inside the dialog but outside the clip, so
   * the half of it that hangs above the border is not cut off by the panel's
   * rounded, overflow-hidden body. It takes no layout height: it is a floating
   * band on the frame's top line, and the chrome inside the panel keeps the
   * close control.
   */
  floating?: ReactNode;
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

  /** True for the exit motion's one beat, after which the page unmounts us. */
  const [closing, setClosing] = useState(false);
  /** A ref as well as state: two presses inside one frame are one close. */
  const closingRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);

  /**
   * Close the sheet the way it was opened: in motion.
   *
   * The page's `onClose` is what leaves the route, and leaving the route unmounts
   * this frame — so calling it directly would cut the exit animation off at frame
   * one. The delay is the animation's own duration, and it is skipped entirely
   * under reduced motion, where the frame has nothing to wait for.
   */
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onClose();
      return;
    }
    setClosing(true);
    exitTimerRef.current = window.setTimeout(onClose, SHEET_EXIT_MS);
  }, [onClose]);

  // A window that closes mid-exit (the app quitting, a vault switch) must not
  // leave a timer holding a callback into an unmounted frame.
  useEffect(
    () => () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    },
    [],
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
      requestClose();
    },
    [requestClose, onEscape],
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
      requestClose();
    },
    [requestClose],
  );

  const overlay = (
    <div
      className={[
        "sheet-overlay",
        `sheet-overlay--${sheet}`,
        `${sheet}-overlay`,
        closing ? "is-closing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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
        {/*
          The floating band: one centred control sitting on the panel's top
          border, half in the panel and half over the scrim. It is a sibling of
          the clip rather than a child, because the clip is what gives the panel
          its rounded corners, and a control crossing the edge must not be
          rounded away with the rest of the body. The band itself takes no
          pointer events — only the control inside it does — so a press beside
          the control still falls through to the panel below, not the scrim.
        */}
        {floating ? (
          <div className="sheet-overlay__floating" data-sheet-floating="">
            {floating}
          </div>
        ) : null}
        <div className="sheet-overlay__clip">
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
              onClick={requestClose}
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
            {/* A body that closes the sheet (the decisions inbox after the last
                answer) gets the frame's own animated close, not the page's raw
                one, so it leaves in motion like every other dismissal. */}
            <SheetCloseContext.Provider value={requestClose}>
              {children}
            </SheetCloseContext.Provider>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
