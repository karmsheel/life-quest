/**
 * The keyboard shortcuts, as the dock's page: a reference, not an editor.
 *
 * The titlebar control opens this page when the operator wants to look a key up
 * without leaving the page they are on; the Settings → Keyboard page is where
 * they change one. So the body is read-only and quiet — group headings, the
 * movement's name, and the keys it currently answers to — and the only control is
 * the pencil in the dock header, which opens the editable page over the app.
 *
 * The bindings come from the same provider the Settings page writes, so a
 * shortcut changed a moment ago shows its new keys here; it is a second view of
 * one table, not a copy of it.
 */
import { Link } from "react-router-dom";
import { useShortcuts } from "@/state/ShortcutsProvider";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUPS,
  formatShortcutKeycaps,
  shortcutBindingToString,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutGroupId,
} from "@/lib/shortcuts";

function ShortcutKeys({
  binding,
  mac,
}: {
  binding: ShortcutBinding | null;
  mac: boolean;
}) {
  if (!binding) {
    return (
      <span
        className="chat-shortcuts__unassigned"
        data-chat-shortcut-keys="unassigned"
      >
        Unassigned
      </span>
    );
  }
  const caps = formatShortcutKeycaps(binding, mac);
  return (
    <span
      className="chat-shortcuts__keys"
      data-chat-shortcut-keys={shortcutBindingToString(binding)}
    >
      <span className="visually-hidden">Current shortcut: {caps.join(" + ")}</span>
      {caps.map((cap, index) => (
        <span
          key={`${cap}-${index}`}
          className="chat-shortcuts__keycap"
          aria-hidden
        >
          {cap}
        </span>
      ))}
    </span>
  );
}

function Group({
  id,
  title,
  actions,
  bindingFor,
  changedFor,
  mac,
}: {
  id: ShortcutGroupId;
  title: string;
  actions: ShortcutAction[];
  bindingFor: (action: ShortcutAction) => ShortcutBinding | null;
  changedFor: (action: ShortcutAction) => boolean;
  mac: boolean;
}) {
  return (
    <section className="chat-shortcuts__group" data-chat-shortcut-group={id}>
      <h3 className="chat-shortcuts__group-title">{title}</h3>
      <ul className="chat-shortcuts__list">
        {actions.map((action) => {
          const binding = bindingFor(action);
          return (
            <li
              key={action.id}
              className="chat-shortcuts__row"
              data-chat-shortcut-row={action.id}
              data-binding={binding ? shortcutBindingToString(binding) : "unassigned"}
              data-changed={changedFor(action) ? "true" : undefined}
            >
              <span className="chat-shortcuts__label">{action.label}</span>
              <ShortcutKeys binding={binding} mac={mac} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ChatShortcutsPage() {
  const { bindings, overrides, mac, customizedCount } = useShortcuts();

  return (
    <div className="chat-shortcuts" data-chat-shortcuts="">
      <p className="chat-shortcuts__hint">
        Every movement and the keys it answers to.{" "}
        {customizedCount === 0
          ? "All on their default keys."
          : `${customizedCount} ${
              customizedCount === 1 ? "movement is" : "movements are"
            } changed from the defaults.`}{" "}
        <Link to="/settings?tab=shortcuts" className="chat-shortcuts__edit">
          Change in Settings
        </Link>
      </p>

      {SHORTCUT_GROUPS.map((group) => (
        <Group
          key={group.id}
          id={group.id}
          title={group.title}
          actions={SHORTCUT_ACTIONS.filter((action) => action.group === group.id)}
          bindingFor={(action) => bindings[action.id]}
          changedFor={(action) =>
            Object.prototype.hasOwnProperty.call(overrides, action.id)
          }
          mac={mac}
        />
      ))}
    </div>
  );
}
