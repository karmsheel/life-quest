/**
 * A page's own actions, behind one three-dot menu.
 *
 * Every lockable page used to wear its lock as a switch at the title's top-right
 * edge. That put a setting — one that changes once in a while — beside the page's
 * work, and on the Dashboard it made the corner a row of two controls of two
 * different kinds. The page's actions now live behind a single three-dot trigger
 * there, and THE LOCK IS THE MENU'S FIRST ITEM: the one setting every lockable
 * page shares is the one item every page menu has.
 *
 * The lock is a `menuitemcheckbox`, not a `menuitem` that runs once. It reports a
 * state the menu can hold, and the menu pattern keeps such an item's menu open
 * while its checked state changes — which is what the operator needs to watch the
 * toggle land. The track and thumb draw the state the `aria-checked` announces;
 * the badge beside the page's name says the same thing in words.
 *
 * The other items are page actions (the Dashboard's pin board, a locked
 * document's Propose change, a note's Delete). They close the menu and return
 * focus to the trigger before they run: an action that opens a dialog must not
 * leave a menu stacked over it, and a menu that vanishes from under the pointer
 * must still hand the keyboard back somewhere.
 *
 * The popover is anchored to the trigger, right-aligned, and floats over the page
 * like the card and settings menus. It is mounted only while open, so a closed
 * menu puts no items in the document — a page's actions are not furniture.
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "./Button";

/** One page action behind the menu, after the lock. */
export type PageMenuAction = {
  /** The item's test id, e.g. `board-add-toggle`. */
  testId: string;
  /** The words the item shows. */
  label: string;
  /** What choosing the item does. The menu closes first. */
  onSelect: () => void;
  /** An icon drawn before the label. */
  icon?: ReactNode;
  /** A write is in flight, or the action is not currently available. */
  disabled?: boolean;
  /** Draw the item in the destructive ink (a note's Delete). */
  danger?: boolean;
  /**
   * For a disclosure item (the Dashboard's pin board): whether the thing it
   * shows is open. It is published as `aria-expanded` on the item.
   */
  expanded?: boolean;
};

/** The lock row the menu always leads with. */
export type PageMenuLock = {
  /** The item's test id, e.g. `board-lock-toggle`. */
  testId: string;
  /** Whether the page is locked right now — the switch's position. */
  locked: boolean;
  /** A write is in flight: the item cannot be pressed again yet. */
  busy?: boolean;
  /** The item's accessible name, e.g. "Lock this dashboard". */
  label: string;
  onToggle: () => void;
};

export function PageMenu({
  lock,
  actions = [],
  label,
  testId,
  className,
}: {
  lock: PageMenuLock;
  actions?: PageMenuAction[];
  /** The trigger's and the menu's accessible name, e.g. "Dashboard actions". */
  label: string;
  /** The trigger's test id; the popover's is this id plus `-popover`. */
  testId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /** Close, and hand the keyboard back to the trigger when asked. */
  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) {
      wrapRef.current
        ?.querySelector<HTMLButtonElement>(".page-menu__trigger")
        ?.focus();
    }
  }

  useEffect(() => {
    if (!open) return;
    // A press anywhere else closes without stealing focus; Escape closes and
    // returns the operator to the control they opened. The menu is a popover over
    // the page, not a page of its own, so both listeners are on the document.
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The page behind may own Escape (the Dashboard's arrange gesture does);
      // the open menu is the thing in front and answers first.
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // The first item is the lock, which is the menu's reason to exist.
    menuRef.current
      ?.querySelector<HTMLElement>(
        '[role="menuitemcheckbox"], [role="menuitem"]',
      )
      ?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // `close` is recreated each render but only reads refs and the setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className={`page-menu${className ? ` ${className}` : ""}`} ref={wrapRef}>
      <Button
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="page-menu__trigger page-corner__action"
        data-testid={testId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <MoreVertical size={16} aria-hidden />
      </Button>

      {open ? (
        <div
          ref={menuRef}
          className="page-menu__popover"
          role="menu"
          aria-label={label}
          data-testid={`${testId}-popover`}
        >
          {/* First, always: the page's lock. Choosing it flips the lock and
              leaves the menu open, so the operator sees the switch and the page
              behind it change together. */}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={lock.locked}
            aria-label={lock.label}
            title={lock.label}
            data-testid={lock.testId}
            data-locked={lock.locked ? "true" : "false"}
            className="page-menu__item page-menu__lock"
            disabled={lock.busy}
            onClick={() => {
              if (lock.busy) return;
              lock.onToggle();
            }}
          >
            <span className="page-menu__item-label">
              {lock.busy ? "Saving…" : "Lock"}
            </span>
            <span className="page-menu__track" aria-hidden="true">
              <span className="page-menu__thumb" />
            </span>
          </button>

          {actions.map((action) => (
            <button
              key={action.testId}
              type="button"
              role="menuitem"
              aria-expanded={action.expanded}
              title={action.label}
              data-testid={action.testId}
              className={`page-menu__item${action.danger ? " page-menu__item--danger" : ""}`}
              disabled={action.disabled}
              onClick={() => {
                close(true);
                action.onSelect();
              }}
            >
              {action.icon}
              <span className="page-menu__item-label">{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
