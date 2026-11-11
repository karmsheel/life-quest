/**
 * The one listener that makes a binding a movement.
 *
 * It is a component with no markup, mounted inside `AppShell` because that is
 * the first place both halves of the answer are in scope: the wing the operator
 * is in (from `WingProvider`) and the page they are on (from the router). The
 * provider above it owns which keys mean what; this file owns what they do.
 *
 * One key here is not a movement: Mod+W closes the chat tab in front, the way
 * every browser closes a tab. It lives in this listener rather than the movement
 * table because browsers do not let that key be rebound, because `RESERVED_BINDINGS`
 * keeps it out of every movement, and because it must see the dock's strip and
 * the app's modals — two things only this place has in scope at once.
 *
 * The listener stands aside in four cases, and each is deliberate:
 *
 *  - **A row is recording.** The keys belong to the settings page until it has
 *    one, or the very shortcut being typed would fire the movement it is being
 *    bound to.
 *  - **A sheet or dialog is up.** The settings and decisions frames are modal;
 *    navigating the page behind one would close the operator's surface from
 *    under the key they pressed.
 *  - **The key is typing.** A binding without Ctrl or Cmd must not fire in a
 *    note or a chat composer: Alt+Arrow is a word-wise caret move on a Mac, and
 *    a bare letter is just a letter. A Ctrl/Cmd combination still does, which is
 *    how navigation shortcuts keep working while the caret is in a field.
 *  - **The event is already spoken for.** `defaultPrevented` and repeats belong
 *    to whoever had them first.
 */
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "@/components/shell/nav-items";
import { useWing } from "@/components/shell/WingProvider";
import { WING_IDS, type WingId } from "@/components/shell/wing";
import { useChatDock } from "@/state/ChatDockProvider";
import { useChatSessions } from "@/state/ChatSessionsProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { useShortcutsOptional } from "@/state/ShortcutsProvider";
import {
  isTypingTarget,
  shortcutActionForEvent,
  type ShortcutActionId,
} from "@/lib/shortcuts";

/** The rail rows a wing owns, in the order the rail draws them. */
function pagesOfWing(wing: WingId): NavItem[] {
  return NAV_ITEMS.filter((item) => item.wing === wing);
}

/** A route without its query/trailing slash, as the rail's links are written. */
function bareRoute(pathname: string): string {
  const bare = pathname.split("?")[0] ?? pathname;
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare || "/";
}

/**
 * Where `pathname` sits in `items`: an exact row first, then the longest href the
 * route is nested under. `/projects/42` is the Projects row, exactly as the
 * rail's own active state reads it.
 */
function pageIndex(items: readonly NavItem[], pathname: string): number {
  const route = bareRoute(pathname);
  const exact = items.findIndex((item) => item.href === route);
  if (exact >= 0) return exact;
  let best = -1;
  let bestLength = -1;
  items.forEach((item, index) => {
    if (route.startsWith(`${item.href}/`) && item.href.length > bestLength) {
      best = index;
      bestLength = item.href.length;
    }
  });
  return best;
}

/**
 * The browser's tab-close key: Mod+W.
 *
 * It is deliberately not a row in the movement table. Every browser gives this
 * key to the tab in front and lets nobody rebind it; the table's reserved space
 * keeps Mod+W out of every other movement (see `RESERVED_BINDINGS`), and the
 * dock owns the gesture the way the composer owns Ctrl/Cmd+Enter.
 */
function isChatTabCloseKey(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "w" || event.key === "W")
  );
}

/**
 * A modal surface is up. The app's own dialogs declare `aria-modal`; the sheet
 * frame is one of them, and the update dialog and confirmations are the others.
 * While one is up the page behind it is not the page the operator is working on.
 */
function modalIsOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[aria-modal="true"], .confirm-dialog-backdrop, .update-dialog-backdrop',
    ),
  );
}

export function ShortcutRunner() {
  // A harness (or any embedding of the shell) that does not mount the provider
  // gets a shell with no keyboard movements rather than a crash; the real app
  // always wraps the shell, so this is only the isolated-tree fallback.
  const shortcuts = useShortcutsOptional();
  const bindings = shortcuts?.bindings ?? null;
  const recording = shortcuts?.recording ?? null;
  const { active, selectWing } = useWing();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toggle: toggleSidebar } = useNavDock();
  const { open: chatOpen, setOpen: setChatOpen, surface: chatSurface } = useChatDock();
  // The dock's tab strip. The close key is a fact about what is on screen, so
  // the runner reads the same two lists the strip draws from.
  const { activeId, activeSession, closeTab, pinnedTabIds, tabIds } = useChatSessions();
  /**
   * The tab Mod+W would close, or null when there is nothing to close.
   *
   * It is a ref, not state, because the listener below must not re-bind per
   * streamed delta: `closeTab` is rebuilt whenever a run changes, while the
   * strip itself changes only when a tab opens or closes. The conditions are the
   * strip's own — open dock, thread surface, more than one open chat or a pinned
   * band, a chat in front — plus the rule the close control already follows: a
   * pinned square is never dropped by a press or a key, Unpin is its way out.
   */
  const closableTabRef = useRef<{ id: string; close: (id: string) => void } | null>(
    null,
  );
  closableTabRef.current =
    chatOpen &&
    chatSurface === "thread" &&
    (tabIds.length > 1 || pinnedTabIds.length > 0) &&
    activeId &&
    tabIds.includes(activeId) &&
    activeSession &&
    !activeSession.pinned
      ? { id: activeId, close: closeTab }
      : null;

  const run = useCallback(
    (id: ShortcutActionId) => {
      switch (id) {
        case "wing.home":
        case "wing.define":
        case "wing.plan":
        case "wing.execute":
        case "wing.review": {
          selectWing(id.slice("wing.".length) as WingId);
          return;
        }
        case "wing.next":
        case "wing.previous": {
          const index = WING_IDS.indexOf(active);
          const step = id === "wing.next" ? 1 : -1;
          selectWing(WING_IDS[(index + step + WING_IDS.length) % WING_IDS.length]);
          return;
        }
        case "page.next":
        case "page.previous": {
          const pages = pagesOfWing(active);
          if (pages.length === 0) return;
          const index = pageIndex(pages, pathname);
          const step = id === "page.next" ? 1 : -1;
          const next =
            index < 0
              ? step > 0
                ? 0
                : pages.length - 1
              : (index + step + pages.length) % pages.length;
          navigate(pages[next].href);
          return;
        }
        case "history.back":
          navigate(-1);
          return;
        case "history.forward":
          navigate(1);
          return;
        case "panel.sidebar.toggle":
          toggleSidebar();
          return;
        case "panel.chat.toggle":
          setChatOpen(!chatOpen);
          return;
        case "surface.settings.open":
          navigate("/settings");
          return;
      }
    },
    [active, chatOpen, navigate, pathname, selectWing, setChatOpen, toggleSidebar],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (recording) return;
      if (modalIsOpen()) return;
      // The dock's own browser gesture, ahead of the movement table. No movement
      // can own Mod+W — it is reserved — so this cannot shadow one, and the tab
      // in front must close even while the caret is in the chat composer.
      const closableTab = closableTabRef.current;
      if (closableTab && isChatTabCloseKey(event)) {
        event.preventDefault();
        closableTab.close(closableTab.id);
        return;
      }
      if (!bindings) return;
      if (isTypingTarget(event.target) && !event.ctrlKey && !event.metaKey) {
        return;
      }
      const action = shortcutActionForEvent(event, bindings);
      if (!action) return;
      event.preventDefault();
      run(action);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, recording, run]);

  return null;
}
