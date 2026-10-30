/**
 * The keyboard shortcuts, as the dock's page: the reference, and the two things
 * the operator can do with it — look a key up, or change one in place.
 *
 * The titlebar control opens this page when the operator wants to look a key up
 * without leaving the page they are on. Each row carries a small pencil: the
 * row then waits for the next key, exactly as a Settings row does, because both
 * pages edit through the one recorder in `ShortcutsProvider`. The header pencil
 * still opens the full Settings → Keyboard page, where the whole table can be
 * read at once and restored wholesale.
 *
 * The bindings come from the same provider the Settings page writes, so a
 * shortcut changed here or there shows its new keys in both places; this is a
 * second surface over one table, not a copy of it.
 */
import { Link } from "react-router-dom";
import { Pencil, X } from "lucide-react";
import { useShortcuts } from "@/state/ShortcutsProvider";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUPS,
  formatShortcutKeycaps,
  shortcutBindingToString,
  type ShortcutAction,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutGroupId,
  type ShortcutOverrides,
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
  bindings,
  overrides,
  recording,
  mac,
  onEdit,
  onCancel,
}: {
  id: ShortcutGroupId;
  title: string;
  actions: ShortcutAction[];
  bindings: Record<ShortcutActionId, ShortcutBinding | null>;
  overrides: ShortcutOverrides;
  recording: ShortcutActionId | null;
  mac: boolean;
  onEdit: (id: ShortcutActionId) => void;
  onCancel: (id: ShortcutActionId) => void;
}) {
  return (
    <section className="chat-shortcuts__group" data-chat-shortcut-group={id}>
      <h3 className="chat-shortcuts__group-title">{title}</h3>
      <ul className="chat-shortcuts__list">
        {actions.map((action) => {
          const binding = bindings[action.id];
          const isRecording = recording === action.id;
          return (
            <li
              key={action.id}
              className="chat-shortcuts__row"
              data-chat-shortcut-row={action.id}
              data-shortcut-recording-row={isRecording ? action.id : undefined}
              data-recording={isRecording ? "true" : undefined}
              data-binding={binding ? shortcutBindingToString(binding) : "unassigned"}
              data-changed={
                Object.prototype.hasOwnProperty.call(overrides, action.id)
                  ? "true"
                  : undefined
              }
            >
              <span className="chat-shortcuts__label">{action.label}</span>
              <span className="chat-shortcuts__control">
                {isRecording ? (
                  <>
                    <span
                      className="chat-shortcuts__prompt"
                      role="status"
                      data-shortcut-recording-prompt=""
                      data-chat-shortcut-recording-prompt=""
                    >
                      Press keys…
                    </span>
                    <button
                      type="button"
                      className="chat-shortcuts__icon-btn"
                      aria-label={`Cancel changing the shortcut for ${action.label}`}
                      title="Cancel"
                      onClick={() => onCancel(action.id)}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </>
                ) : (
                  <>
                    <ShortcutKeys binding={binding} mac={mac} />
                    <button
                      type="button"
                      className="chat-shortcuts__icon-btn chat-shortcuts__edit"
                      aria-label={`Change shortcut for ${action.label}`}
                      title={`Change shortcut for ${action.label}`}
                      onClick={() => onEdit(action.id)}
                    >
                      <Pencil size={12} aria-hidden />
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ChatShortcutsPage() {
  const {
    bindings,
    overrides,
    mac,
    customizedCount,
    recording,
    recordingMessage,
    beginRecording,
    cancelRecording,
    clearRecordingMessage,
  } = useShortcuts();

  function edit(id: ShortcutActionId) {
    clearRecordingMessage();
    beginRecording(id);
  }

  function cancel() {
    clearRecordingMessage();
    cancelRecording();
  }

  return (
    <div className="chat-shortcuts" data-chat-shortcuts="">
      <p className="chat-shortcuts__hint">
        Every movement and the keys it answers to.{" "}
        {customizedCount === 0
          ? "All on their default keys."
          : `${customizedCount} ${
              customizedCount === 1 ? "movement is" : "movements are"
            } changed from the defaults.`}{" "}
        <Link to="/settings?tab=shortcuts" className="chat-shortcuts__edit-link">
          Change in Settings
        </Link>
      </p>

      {recordingMessage?.kind === "error" ? (
        <p
          className="chat-shortcuts__error"
          role="alert"
          data-chat-shortcuts-error=""
        >
          {recordingMessage.text}
        </p>
      ) : null}

      <p className="chat-shortcuts__hint chat-shortcuts__hint--quiet">
        Pick a pencil, then press the keys you want. Escape cancels; Backspace
        clears a shortcut.
      </p>

      {SHORTCUT_GROUPS.map((group) => (
        <Group
          key={group.id}
          id={group.id}
          title={group.title}
          actions={SHORTCUT_ACTIONS.filter((action) => action.group === group.id)}
          bindings={bindings}
          overrides={overrides}
          recording={recording}
          mac={mac}
          onEdit={edit}
          onCancel={cancel}
        />
      ))}
    </div>
  );
}
