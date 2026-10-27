import { useState, type FormEvent } from "react";
import {
  Archive,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
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
 * The chats section of the sidebar: every conversation on the companion
 * profile, between the wing's pages above and the governed shelf at the foot.
 *
 * The list used to be a page inside the dock, which meant a chat was only
 * reachable once the operator had already opened the dock. Here it is part of
 * the one wide sidebar: one click loads a chat into the dock (opening it first
 * if it was collapsed), and the same row carries the four durable things the
 * operator does to a chat without opening it — pin, rename, archive, delete.
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

  const pinned = chat.sessions.filter((s) => s.pinned);
  const recent = chat.sessions.filter((s) => !s.pinned);
  const liveCount = chat.openTabs.filter((id) => chat.runOf(id).sending).length;

  /** Load one chat into the dock, opening the dock if it was put away. */
  async function openChat(id: string) {
    setMenuId(null);
    if (!dockOpen) setDockOpen(true);
    await chat.openChat(id);
  }

  async function createChat() {
    setMenuId(null);
    if (!dockOpen) setDockOpen(true);
    await chat.newChat();
  }

  function toggleMenu(id: string) {
    setMenuId((current) => (current === id ? null : id));
  }

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
    const menuOpen = menuId === s.id;
    const renaming = renamingId === s.id;
    return (
      <li
        key={s.id}
        className="chats-rail__row"
        data-active={active || undefined}
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
              title={label}
              onClick={() => void openChat(s.id)}
            >
              <span className="chats-rail__dot" aria-hidden />
              <span className="chats-rail__label">{label}</span>
              {when ? (
                <time className="chats-rail__when" dateTime={timeValue(s.lastActive)}>
                  {when}
                </time>
              ) : null}
            </button>
            <button
              type="button"
              className="chats-rail__menu-btn"
              aria-label="Chat actions"
              title="Chat actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => toggleMenu(s.id)}
            >
              <MoreVertical size={14} aria-hidden />
            </button>
            {menuOpen ? (
              <div className="chats-rail__menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  aria-label={s.pinned ? "Unpin chat" : "Pin chat"}
                  onClick={() => {
                    setMenuId(null);
                    void chat.patchSession(s.id, { pinned: !s.pinned });
                  }}
                >
                  {s.pinned ? (
                    <>
                      <PinOff size={12} aria-hidden /> Unpin
                    </>
                  ) : (
                    <>
                      <Pin size={12} aria-hidden /> Pin
                    </>
                  )}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Rename chat"
                  onClick={() => startRename(s)}
                >
                  <Pencil size={12} aria-hidden /> Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Archive chat"
                  onClick={() => {
                    setMenuId(null);
                    void chat.patchSession(s.id, { archived: true });
                  }}
                >
                  <Archive size={12} aria-hidden /> Archive
                </button>
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
      <header className="chats-rail__header">
        <p className="chats-rail__title">Chats</p>
        {liveCount > 0 ? (
          <span
            className="chats-rail__live-count"
            title={`${liveCount} ${liveCount === 1 ? "chat is" : "chats are"} running`}
          >
            {liveCount} running
          </span>
        ) : null}
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
            {pinned.length > 0 ? (
              <>
                <li className="chats-rail__group">Pinned</li>
                {pinned.map(renderRow)}
              </>
            ) : null}
            {recent.length > 0 ? (
              <>
                {pinned.length > 0 ? (
                  <li className="chats-rail__group">Recent</li>
                ) : null}
                {recent.map(renderRow)}
              </>
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
