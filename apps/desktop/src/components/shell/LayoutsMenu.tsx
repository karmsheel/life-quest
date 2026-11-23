import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { LayoutTemplate } from "lucide-react";
import { useChatDock, type LayoutId } from "@/state/ChatDockProvider";
import { useMenuPosition } from "@/components/ui/useMenuPosition";

/**
 * The layouts control and its picker.
 *
 * The studio is one window made of the same three panes, and sometimes the
 * operator wants them in a different shape: the page alone, the conversation
 * alone, or the two of them sharing the frame evenly. The picker is the door to
 * those shapes, and it sits in the title bar beside the day/night control,
 * because what it changes is the window's own arrangement — like the palette,
 * not like anything inside a page.
 *
 * It is a popover, not a sheet: four thumbnails small enough to take in at a
 * glance and press in one movement, the way a window manager's layout gallery
 * works. The thumbnails are drawn from the app's own tokens — the rail, the
 * page and the agent as three blocks in their real order — so the card shows
 * the arrangement rather than describing it.
 *
 * The four arrangements are:
 *
 *  - **Studio** — the shipped studio, the dock back at its own width.
 *  - **Page · Agent** — an even split, page leading, agent trailing.
 *  - **Agent · Page** — the same split with the panes swapped.
 *  - **Full agent** — the dock's own full-screen mode: the page leaves and the
 *    agent takes the workspace beside the rail.
 *
 * Nothing here owns an arrangement: every card writes the dock's own state
 * through `setLayout`, and the card that reads as pressed is the one derived
 * from that state. So a swap, a collapse or the dock's own full-screen control
 * moves the picker's answer with it instead of leaving a stale tick behind.
 */

type LayoutOption = {
  id: LayoutId;
  label: string;
  /** What the card does, said in one line for the tooltip and the screen
   *  reader; the thumbnail carries the shape itself. */
  hint: string;
};

const LAYOUT_OPTIONS: readonly LayoutOption[] = [
  {
    id: "studio",
    label: "Studio",
    hint: "The studio: rail, page and agent at the dock's own width",
  },
  {
    id: "page-agent",
    label: "Page · Agent",
    hint: "Even split: the page on the left, the agent on the right",
  },
  {
    id: "agent-page",
    label: "Agent · Page",
    hint: "Even split: the agent on the left, the page on the right",
  },
  {
    id: "agent",
    label: "Full agent",
    hint: "Full-screen chat: the agent takes the workspace beside the rail",
  },
];

/**
 * One card's thumbnail: the same three panes, in the order the card puts them.
 *
 * The rail is always first — it is the window's chrome and it never leaves —
 * and each block is a plain span so the stylesheet alone decides the fills
 * (the agent wears the accent tint, so the eye finds it in every card).
 */
function LayoutThumbnail({ id }: { id: LayoutId }) {
  return (
    <span
      className={`layout-thumb layout-thumb--${id}`}
      aria-hidden="true"
      data-testid={`layout-thumb-${id}`}
    >
      <span
        className="layout-thumb__pane layout-thumb__pane--rail"
        data-pane="rail"
      />
      {id === "agent-page" ? (
        <>
          <span
            className="layout-thumb__pane layout-thumb__pane--agent"
            data-pane="agent"
          />
          <span
            className="layout-thumb__pane layout-thumb__pane--page"
            data-pane="page"
          />
        </>
      ) : id === "agent" ? (
        <span
          className="layout-thumb__pane layout-thumb__pane--agent"
          data-pane="agent"
        />
      ) : (
        <>
          <span
            className="layout-thumb__pane layout-thumb__pane--page"
            data-pane="page"
          />
          <span
            className="layout-thumb__pane layout-thumb__pane--agent"
            data-pane="agent"
          />
        </>
      )}
    </span>
  );
}

/**
 * The titlebar's layouts control.
 *
 * A press opens the picker; a second press, a press outside it, or Escape
 * closes it. The menu is portalled to the body because the window strip owns
 * the trigger and must not decide where the menu is drawn, and it is positioned
 * off the trigger on every open, resize and scroll so a moving window cannot
 * leave it behind.
 */
export function LayoutsMenu({ className }: { className?: string }) {
  const { layout, setLayout } = useChatDock();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { menuStyle, updateMenuPosition } = useMenuPosition(
    triggerRef,
    "bottom-end",
    { width: 18.5 * 16 },
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /**
   * The menu's own keyboard walk: a small radio group, so the arrow keys move
   * between the cards the way a menu's owner expects and Home/End jump to the
   * ends. Tab still leaves the group.
   */
  const onMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const cards = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          ".layouts-menu__card",
        ) ?? [],
      );
      if (cards.length === 0) return;
      const index = cards.findIndex((card) => card === document.activeElement);
      const focusAt = (next: number) => {
        const card = cards[(next + cards.length) % cards.length];
        card?.focus();
        event.preventDefault();
      };
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        focusAt(index < 0 ? 0 : index + 1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        focusAt(index < 0 ? cards.length - 1 : index - 1);
      } else if (event.key === "Home") {
        focusAt(0);
      } else if (event.key === "End") {
        focusAt(cards.length - 1);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();

    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const popover =
    open && mounted ? (
      <div
        ref={menuRef}
        id="layouts-menu"
        className="settings-menu__popover settings-menu__popover--portal layouts-menu__popover"
        role="menu"
        aria-label="Layouts"
        data-testid="layouts-menu"
        style={menuStyle}
        onKeyDown={onMenuKeyDown}
      >
        <section className="settings-menu__section">
          <div className="settings-menu__section-title">
            <LayoutTemplate size={14} aria-hidden />
            <span>Layouts</span>
          </div>
          <div
            className="layouts-menu__grid"
            role="group"
            aria-label="Workspace layout"
          >
            {LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={layout === option.id}
                aria-label={`${option.label} — ${option.hint}`}
                title={option.hint}
                data-testid={`layout-option-${option.id}`}
                className={[
                  "layouts-menu__card",
                  layout === option.id ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setLayout(option.id);
                  close();
                }}
              >
                <LayoutThumbnail id={option.id} />
                <span className="layouts-menu__card-label">{option.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={["layouts-menu__trigger", "window-titlebar__btn", className]
          .filter(Boolean)
          .join(" ")}
        data-testid="layouts-trigger"
        aria-label="Layouts"
        title="Layouts"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="layouts-menu"
        onClick={() => setOpen((current) => !current)}
      >
        <LayoutTemplate size={14} aria-hidden />
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </>
  );
}
