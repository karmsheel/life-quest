import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  MoreVertical,
  Pencil,
  Pin,
  Search,
  Settings2,
  SquarePen,
  SquarePlus,
  X,
} from "lucide-react";
import { useChatSessions } from "@/state/ChatSessionsProvider";
import { useChatDock } from "@/state/ChatDockProvider";
import { useConfirm } from "@/components/ui/useConfirm";
import {
  formatSessionWhen,
  sessionLabel,
} from "../../../electron/companion-client.ts";
import type { HermesSession } from "@/vite-env";

/** The seconds-based stamp a `<time>` needs, or undefined when unknown. */
function timeValue(lastActive: number | null): string | undefined {
  if (lastActive == null || !Number.isFinite(lastActive)) return undefined;
  const date = new Date(lastActive * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * The pinned rows' order, most recently pinned first.
 *
 * The pin itself is durable in Hermes — that is what keeps the row above the
 * unpinned chats on every channel. What Hermes does not carry is the order
 * WITHIN that pinned band: the gateway sorts the list by activity, so a pinned
 * chat that has been quiet for a week would drift under the ones that just
 * spoke. The operator's gesture says "keep this at the top", so the sidebar
 * remembers the order the pins were made in, browser-locally, exactly as the
 * reference client does. This store is only consulted for the pinned band and
 * is reconciled against the live list on every render, so a stale id costs
 * nothing.
 */
const PINNED_ORDER_KEY = "lifequest.companion.pinnedOrder";

function readPinnedOrder(): string[] {
  try {
    const raw = window.localStorage.getItem(PINNED_ORDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function writePinnedOrder(ids: string[]): void {
  try {
    window.localStorage.setItem(PINNED_ORDER_KEY, JSON.stringify(ids));
  } catch {
    // A storage refusal costs the order its memory, not the pin: the pin is
    // already durable in Hermes, which is what keeps the row in the band.
  }
}

/**
 * The chats section of the sidebar: every conversation on the companion
 * profile, between the wing's pages above and the governed shelf at the foot.
 *
 * The list used to be a page inside the dock, which meant a chat was only
 * reachable once the operator had already opened the dock. Here it is part of
 * the one wide sidebar: one click loads a chat into the dock (opening it first
 * if it was collapsed). A plain click is navigation and takes over the tab on
 * screen; a middle click, or the row's "Open in new tab", is the only gesture
 * that adds a tab.
 *
 * Pinning follows the desktop reference client rather than two labelled
 * sections: there is no "Pinned"/"Recent" eyebrow, the pinned chats simply form
 * the top of one list, and the row itself carries the gesture. Pin and archive
 * are hover buttons (with the kebab menu still holding the named commands for
 * keyboard and rename/delete); a pinned row keeps a filled pin at rest in the
 * slot the hover pin button will occupy, so the state is legible without
 * hovering. Pinning fronts the row in the pinned band, unpinning drops it back
 * to the activity order, and archiving takes it out of the list.
 *
 * The header carries the two controls the list needs to stay usable as it
 * grows. The magnifier does not open a second row under the heading: the field
 * takes the header's own line, where the title and both icons were, focused and
 * ready for the query; the cross, a press anywhere outside it, or Escape hands
 * the usual header back. The sliders open the view menu that decides whether
 * archived chats are listed. Archived rows come back below the live ones in
 * their own greyed, tagged band, restorable but never openable — the chat is
 * out of the working set, but not lost.
 *
 * Rows are the same Hermes sessions the dock's tabs are, read from
 * `ChatSessionsProvider`, so a pin from here is a pin in the dock, in Hermes
 * Desktop, and on every other channel on this profile. A live turn is a dot on
 * the row: parallel chats all report here, whichever one is on screen.
 */
export function ChatsSidebar() {
  const chat = useChatSessions();
  const { open: dockOpen, setOpen: setDockOpen } = useChatDock();
  const { ask, dialog } = useConfirm(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pinnedOrder, setPinnedOrder] = useState<string[]>(readPinnedOrder);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);

  const needle = query.trim().toLowerCase();
  const matches = (s: HermesSession) => {
    if (!needle) return true;
    return (
      sessionLabel(s).toLowerCase().includes(needle) ||
      (s.preview ?? "").toLowerCase().includes(needle)
    );
  };
  const shown = chat.sessions.filter(matches);

  /**
   * One live list, pinned band first, then the activity order. The pinned band
   * follows the remembered pin order (newest pin at the front); a pinned chat
   * the local order has not seen yet waits at the back of the band, ordered the
   * way the gateway sent it. Archived rows are not part of this list: they have
   * their own band at the foot when the view shows them.
   */
  const pinned = useMemo(() => {
    const rank = new Map<string, number>();
    pinnedOrder.forEach((id, index) => {
      if (!rank.has(id)) rank.set(id, index);
    });
    return shown
      .filter((s) => s.pinned && !s.archived)
      .sort((a, b) => {
        const aRank = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
        const bRank = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
        if (aRank !== bRank) return aRank - bRank;
        return (b.lastActive ?? 0) - (a.lastActive ?? 0);
      });
  }, [shown, pinnedOrder]);
  const recent = shown.filter((s) => !s.pinned && !s.archived);
  const archived = shown.filter((s) => s.archived);
  const ordered = [...pinned, ...recent];
  const matchCount = ordered.length + archived.length;
  const liveCount = chat.openTabs.filter((id) => chat.runOf(id).sending).length;

  /** Load one chat into the dock, opening the dock if it was put away. */
  async function openChat(id: string) {
    setMenuId(null);
    if (!dockOpen) setDockOpen(true);
    await chat.openChat(id);
  }

  /** The gesture that keeps the chat on screen instead of replacing it. */
  async function openInNewTab(id: string) {
    setMenuId(null);
    if (!dockOpen) setDockOpen(true);
    await chat.openChatInNewTab(id);
  }

  async function createChat() {
    setMenuId(null);
    if (!dockOpen) setDockOpen(true);
    await chat.newChat();
  }

  function toggleMenu(id: string) {
    setMenuId((current) => (current === id ? null : id));
  }

  /**
   * Pin or unpin one chat. The order moves on the gesture, not on the reply:
   * the operator clicks pin and the row is at the top before the gateway has
   * answered, which is what the row should feel like. A refused write puts the
   * remembered order back and the provider's error banner does the talking.
   */
  function togglePin(s: HermesSession) {
    setMenuId(null);
    const next = !s.pinned;
    const previous = pinnedOrder;
    const applied = next
      ? [s.id, ...pinnedOrder.filter((id) => id !== s.id)]
      : pinnedOrder.filter((id) => id !== s.id);
    setPinnedOrder(applied);
    writePinnedOrder(applied);
    void chat.patchSession(s.id, { pinned: next }).then((ok) => {
      if (ok) return;
      setPinnedOrder((current) => {
        // Only undo the move if nothing else has pinned since; a newer gesture
        // owns the order and must not be overwritten by this refusal.
        if (current.join("|") !== applied.join("|")) return current;
        writePinnedOrder(previous);
        return previous;
      });
    });
  }

  /** Archive takes the chat out of the list; leaving that list is the gesture. */
  function archiveChat(s: HermesSession) {
    setMenuId(null);
    void chat.patchSession(s.id, { archived: true });
  }

  /**
   * The field is the header while it is open: the "Chats" title and its two
   * icons step aside for a full-width input, and the cross (or a press anywhere
   * outside it) hands that header back.
   */
  const closeSearch = useCallback((focusButton = false) => {
    setSearchOpen(false);
    setQuery("");
    if (!focusButton) return;
    // The header re-renders with the magnifier in this same commit; put the
    // keyboard back on the control that opened the field.
    requestAnimationFrame(() => searchButtonRef.current?.focus());
  }, []);

  function openSearch() {
    setViewMenuOpen(false);
    setMenuId(null);
    setQuery("");
    setSearchOpen(true);
  }

  useEffect(() => {
    if (!searchOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const box = searchBoxRef.current;
      if (box && event.target instanceof Node && box.contains(event.target)) return;
      closeSearch(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [searchOpen, closeSearch]);

  function startRename(s: HermesSession) {
    setMenuId(null);
    setRenamingId(s.id);
    setRenameDraft(sessionLabel(s));
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }

  async function commitRename(e: FormEvent, id: string) {
    e.preventDefault();
    const title = renameDraft.trim();
    cancelRename();
    await chat.patchSession(id, { title });
  }

  /**
   * Delete asks through the app's own dialog. The row menu closes on the way in:
   * the question is the surface now, and it names the chat it will take.
   */
  function deleteChat(s: HermesSession) {
    const label = sessionLabel(s);
    setMenuId(null);
    ask({
      title: "Delete chat",
      message: `Delete "${label}"? Its messages leave Hermes everywhere, and this cannot be undone.`,
      confirmLabel: "Delete chat",
      destructive: true,
      run: () => void chat.deleteChat(s.id),
    });
  }

  function renderRow(s: HermesSession) {
    const label = sessionLabel(s);
    const when = formatSessionWhen(s.lastActive);
    const run = chat.runOf(s.id);
    const active = s.id === chat.activeId;
    const archived = s.archived === true;
    const menuOpen = menuId === s.id;
    const renaming = renamingId === s.id;
    return (
      <li
        key={s.id}
        className="chats-rail__row"
        data-active={active || undefined}
        data-archived={archived || undefined}
        data-pinned={s.pinned || undefined}
        data-menu-open={menuOpen || undefined}
        data-live={run.sending || undefined}
        data-approval={run.approval !== null || undefined}
      >
        {renaming ? (
          <form
            className="chats-rail__rename"
            onSubmit={(e) => void commitRename(e, s.id)}
          >
            <input
              className="chats-rail__rename-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              aria-label="Chat name"
              autoFocus
            />
            <button type="submit" className="chats-rail__text-btn" aria-label="Save chat name">
              Save
            </button>
            <button
              type="button"
              className="chats-rail__text-btn"
              aria-label="Cancel rename"
              onClick={cancelRename}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              className="chats-rail__row-main"
              aria-current={active ? "true" : undefined}
              aria-disabled={archived || undefined}
              disabled={archived}
              title={
                archived
                  ? `${label} — archived; restore it to open`
                  : `${label} — middle-click to open in a new tab`
              }
              onClick={() => void openChat(s.id)}
              onAuxClick={(e) => {
                // Middle click is "keep this one too": the browser gesture the
                // operator already knows, transplanted to the chat list.
                if (e.button !== 1) return;
                e.preventDefault();
                void openInNewTab(s.id);
              }}
              onMouseDown={(e) => {
                // Without this the middle press starts the platform's autoscroll
                // cursor and the aux click never lands on the control.
                if (e.button === 1) e.preventDefault();
              }}
            >
              <span className="chats-rail__dot" aria-hidden />
              <span className="chats-rail__label">{label}</span>
              {archived ? (
                <span className="chats-rail__archived-tag">Archived</span>
              ) : when ? (
                <time className="chats-rail__when" dateTime={timeValue(s.lastActive)}>
                  {when}
                </time>
              ) : null}
            </button>
            {archived ? null : s.pinned ? (
              <span
                className="chats-rail__pin-state"
                role="img"
                aria-label="Pinned"
                title="Pinned"
              >
                <Pin size={14} fill="currentColor" aria-hidden />
              </span>
            ) : null}
            {/*
              The row's own verbs. The pin is rightmost because the marker it
              replaces at rest sits there, and archive is its neighbour — the
              same pair, in the same places, as the reference client. Both are
              paint-only until the row is hovered (or focused, so the keyboard
              can reach them), which is what keeps a quiet list quiet. An
              archived row has no working verbs: its menu offers Unarchive.
            */}
            <span className="chats-rail__actions">
              <button
                type="button"
                className="chats-rail__menu-btn"
                aria-label="Chat actions"
                title="Chat actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                // A pointer press must not leave focus on the revealed control:
                // focus keeps the verbs on screen (`:focus-within`), and a click
                // that ends with the row stuck open would read as a stuck hover.
                // Keyboard focus still arrives by Tab, which is the point of
                // showing the verbs on focus at all.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleMenu(s.id)}
              >
                <MoreVertical size={14} aria-hidden />
              </button>
              {archived ? null : (
                <>
                  <button
                    type="button"
                    className="chats-rail__archive-btn"
                    aria-label="Archive chat"
                    title="Archive chat"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => archiveChat(s)}
                  >
                    <Archive size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="chats-rail__pin-btn"
                    data-pinned={s.pinned || undefined}
                    aria-label={s.pinned ? "Unpin chat" : "Pin chat"}
                    title={s.pinned ? "Unpin chat" : "Pin chat"}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => togglePin(s)}
                  >
                    <Pin
                      size={14}
                      fill={s.pinned ? "currentColor" : "none"}
                      aria-hidden
                    />
                  </button>
                </>
              )}
            </span>
            {menuOpen ? (
              <div className="chats-rail__menu" role="menu">
                {archived ? (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Unarchive chat"
                    onClick={() => {
                      setMenuId(null);
                      void chat.patchSession(s.id, { archived: false });
                    }}
                  >
                    <ArchiveRestore size={12} aria-hidden /> Unarchive
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Open in new tab"
                      onClick={() => void openInNewTab(s.id)}
                    >
                      <SquarePlus size={12} aria-hidden /> Open in new tab
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={s.pinned ? "Unpin chat" : "Pin chat"}
                      onClick={() => togglePin(s)}
                    >
                      {s.pinned ? (
                        <>
                          <Pin size={12} fill="currentColor" aria-hidden /> Unpin
                        </>
                      ) : (
                        <>
                          <Pin size={12} aria-hidden /> Pin
                        </>
                      )}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Rename chat"
                  onClick={() => startRename(s)}
                >
                  <Pencil size={12} aria-hidden /> Rename
                </button>
                {archived ? null : (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Archive chat"
                    onClick={() => archiveChat(s)}
                  >
                    <Archive size={12} aria-hidden /> Archive
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Delete chat"
                  className="chats-rail__menu-danger"
                  onClick={() => deleteChat(s)}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </>
        )}
      </li>
    );
  }

  return (
    <section className="chats-rail" aria-label="Chats">
      <header
        className={[
          "chats-rail__header",
          searchOpen ? "chats-rail__header--search" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {searchOpen ? (
          /*
            The field takes the header's own line, where the magnifier was: one
            row, the full width of the column, focused and ready for the query.
            Nothing sits above it but the wing switcher.
          */
          <div className="chats-rail__search" role="search" ref={searchBoxRef}>
            <Search size={13} aria-hidden />
            <input
              className="chats-rail__search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                closeSearch(true);
              }}
              placeholder="Search chats"
              aria-label="Search chats"
              autoFocus
            />
            <button
              type="button"
              className="chats-rail__search-clear"
              aria-label="Close search"
              title="Close search"
              onClick={() => closeSearch(true)}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <p className="chats-rail__title">Chats</p>
            {liveCount > 0 ? (
              <span
                className="chats-rail__live-count"
                title={`${liveCount} ${liveCount === 1 ? "chat is" : "chats are"} running`}
              >
                {liveCount} running
              </span>
            ) : null}
            <div className="chats-rail__header-actions">
              <button
                type="button"
                className="chats-rail__icon-btn"
                aria-label="Search chats"
                title="Search chats"
                ref={searchButtonRef}
                onClick={openSearch}
              >
                <Search size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="chats-rail__icon-btn"
                aria-label="View options"
                title="View options"
                aria-haspopup="menu"
                aria-expanded={viewMenuOpen}
                onClick={() => {
                  setMenuId(null);
                  setViewMenuOpen((open) => !open);
                }}
              >
                <Settings2 size={14} aria-hidden />
              </button>
              {viewMenuOpen ? (
                <div
                  className="chats-rail__menu chats-rail__view-menu"
                  role="menu"
                  aria-label="View options"
                >
                  <p className="chats-rail__menu-title">View options</p>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={!chat.showArchived}
                    aria-label="Hide archived chats"
                    onClick={() => {
                      chat.setShowArchived(false);
                      setViewMenuOpen(false);
                    }}
                  >
                    <span className="chats-rail__check" aria-hidden>
                      {!chat.showArchived ? <Check size={12} /> : null}
                    </span>
                    Hide archived
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={chat.showArchived}
                    aria-label="Show archived chats"
                    onClick={() => {
                      chat.setShowArchived(true);
                      setViewMenuOpen(false);
                    }}
                  >
                    <span className="chats-rail__check" aria-hidden>
                      {chat.showArchived ? <Check size={12} /> : null}
                    </span>
                    Show archived
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </header>

      <button
        type="button"
        className="chats-rail__new"
        aria-label="New chat"
        title="New chat"
        onClick={() => void createChat()}
      >
        <SquarePen size={15} aria-hidden />
        <span>New chat</span>
      </button>

      {chat.listError ? (
        <div className="chats-rail__error" role="alert">
          <p>{chat.listError}</p>
          <button
            type="button"
            className="chats-rail__text-btn"
            onClick={() => chat.reportError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="chats-rail__list">
        {chat.sessionsLoaded && chat.sessions.length === 0 ? (
          <p className="chats-rail__empty">No chats yet</p>
        ) : (
          <ul className="chats-rail__rows" aria-label="Chats">
            {ordered.map(renderRow)}
            {archived.length > 0 ? (
              <>
                <li className="chats-rail__group">Archived</li>
                {archived.map(renderRow)}
              </>
            ) : null}
            {needle && matchCount === 0 ? (
              <li className="chats-rail__empty">
                No chats match “{query.trim()}”
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {/* The question is asked here because the row is here; the dialog paints
          over the window rather than the column, so it is not clipped. */}
      {dialog}
    </section>
  );
}
