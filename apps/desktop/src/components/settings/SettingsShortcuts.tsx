/**
 * Keyboard shortcuts: the one page where the operator chooses the keys.
 *
 * The page is a list, not a dialog per movement. A row shows the movement, the
 * keys it currently answers to, and one control to change it; a changed row also
 * offers its default back. Recording happens in place — the row says "Press
 * keys…" and the next combination that includes a real key becomes the binding —
 * because a modal recorder would hide the list the operator is choosing from.
 *
 * Three behaviours are worth stating because they are what makes the page safe:
 *
 *  - **The runner stands down while a row records.** The key you press to bind a
 *    movement must not also perform it.
 *  - **Escape cancels and Backspace clears.** Escape is the keyboard's way out
 *    everywhere else in the app; Backspace is the way to say "no key at all".
 *  - **A refusal keeps the row recording.** A combination already used by another
 *    movement is named, and the row stays open so the operator can try the next
 *    one instead of walking back to the button.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useShortcuts } from "@/state/ShortcutsProvider";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUPS,
  defaultShortcutBinding,
  formatShortcutKeycaps,
  shortcutAction,
  shortcutBindingFromEvent,
  shortcutBindingToString,
  type ShortcutAction,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutGroupId,
} from "@/lib/shortcuts";

type Message = { kind: "error" | "status"; text: string };

function Keycaps({
  binding,
  mac,
}: {
  binding: ShortcutBinding | null;
  mac: boolean;
}) {
  if (!binding) {
    return (
      <span className="settings-shortcuts__unassigned" data-shortcut-keys="">
        Unassigned
      </span>
    );
  }
  const caps = formatShortcutKeycaps(binding, mac);
  return (
    <span
      className="settings-shortcuts__keys"
      data-shortcut-keys={shortcutBindingToString(binding)}
    >
      <span className="visually-hidden">Current shortcut: {caps.join(" + ")}</span>
      {caps.map((cap, index) => (
        <span key={`${cap}-${index}`} className="settings-shortcuts__keycap" aria-hidden>
          {cap}
        </span>
      ))}
    </span>
  );
}

function ShortcutRow({
  action,
  binding,
  defaultCaps,
  customized,
  recording,
  mac,
  onChange,
  onCancel,
  onReset,
}: {
  action: ShortcutAction;
  binding: ShortcutBinding | null;
  defaultCaps: string;
  customized: boolean;
  recording: boolean;
  mac: boolean;
  onChange: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className="settings-shortcuts__row"
      data-shortcut-row={action.id}
      data-recording={recording ? "true" : undefined}
      data-customized={customized ? "true" : undefined}
      data-binding={binding ? shortcutBindingToString(binding) : "unassigned"}
    >
      <div className="settings-shortcuts__copy">
        <div className="settings-shortcuts__label">{action.label}</div>
        <p className="settings-shortcuts__desc">{action.description}</p>
        {customized ? (
          <p className="settings-shortcuts__default">Default: {defaultCaps}</p>
        ) : null}
      </div>
      <div className="settings-shortcuts__control">
        {recording ? (
          <span
            className="settings-shortcuts__recording"
            role="status"
            data-shortcut-recording-prompt=""
          >
            Press keys…
          </span>
        ) : (
          <Keycaps binding={binding} mac={mac} />
        )}
        <div className="settings-shortcuts__actions">
          <Button
            type="button"
            variant="outline"
            aria-label={
              recording
                ? `Cancel changing the shortcut for ${action.label}`
                : `Change shortcut for ${action.label}`
            }
            onClick={recording ? onCancel : onChange}
          >
            {recording ? "Cancel" : "Change"}
          </Button>
          {customized && !recording ? (
            <Button
              type="button"
              variant="ghost"
              aria-label={`Reset shortcut for ${action.label}`}
              onClick={onReset}
            >
              Reset
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SettingsShortcuts() {
  const {
    bindings,
    recording,
    beginRecording,
    cancelRecording,
    setBinding,
    resetBinding,
    resetAll,
    customizedCount,
    overrides,
    mac,
  } = useShortcuts();
  const [message, setMessage] = useState<Message | null>(null);

  const byGroup = useMemo(() => {
    const groups = new Map<ShortcutGroupId, ShortcutAction[]>();
    for (const group of SHORTCUT_GROUPS) groups.set(group.id, []);
    for (const action of SHORTCUT_ACTIONS) {
      groups.get(action.group)?.push(action);
    }
    return groups;
  }, []);

  const finish = useCallback(
    (next: Message | null) => {
      setMessage(next);
      cancelRecording();
    },
    [cancelRecording],
  );

  /**
   * The key belongs to the row while it records. This is a capture listener so it
   * runs before the sheet's own Escape and before the shell's runner, and it
   * stops the event there: the next Escape must cancel the recording, not close
   * the settings the operator is working in.
   */
  useEffect(() => {
    if (!recording) return;
    const actionId: ShortcutActionId = recording;

    function onKeyDown(event: KeyboardEvent) {
      // A composing IME owns its keys: let the composition finish rather than
      // turning the keystroke into a binding.
      if (event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.repeat) return;
      if (event.key === "Escape") {
        finish({ kind: "status", text: "Shortcut change cancelled." });
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        const result = setBinding(actionId, null);
        finish(
          result.ok
            ? { kind: "status", text: "Shortcut cleared." }
            : { kind: "error", text: result.error },
        );
        return;
      }

      const binding = shortcutBindingFromEvent(event);
      if (!binding) return; // a modifier held on its own is not the binding yet

      const result = setBinding(actionId, shortcutBindingToString(binding));
      if (!result.ok) {
        // Stay in the row: the next combination should be one key away.
        setMessage({ kind: "error", text: result.error });
        return;
      }
      finish({ kind: "status", text: "Shortcut saved." });
    }

    function onPointerDown(event: PointerEvent) {
      const row = document.querySelector(
        `[data-shortcut-row="${recording}"]`,
      );
      if (row && event.target instanceof Node && row.contains(event.target)) return;
      cancelRecording();
    }

    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [cancelRecording, finish, recording, setBinding]);

  // Closing the sheet while a row waits for a key would otherwise leave the
  // provider recording forever, and the runner would never move the app again.
  useEffect(() => cancelRecording, [cancelRecording]);

  return (
    <SettingsSection
      icon={<Keyboard size={16} />}
      title="Keyboard shortcuts"
      subtitle="Keys for moving around the studio"
      banner={
        message?.kind === "error" ? (
          <p
            className="form-error"
            role="alert"
            data-shortcuts-message="error"
          >
            {message.text}
          </p>
        ) : undefined
      }
    >
      <div className="settings-card settings-shortcuts" data-settings-shortcuts="">
        <p className="settings-shortcuts__hint">
          Select <strong>Change</strong>, then press the keys you want. The new
          shortcut works everywhere in the app and is saved on this computer.
        </p>

        {SHORTCUT_GROUPS.map((group) => {
          const actions = byGroup.get(group.id) ?? [];
          if (actions.length === 0) return null;
          return (
            <section
              key={group.id}
              className="settings-shortcuts__group"
              data-shortcut-group={group.id}
              aria-label={group.title}
            >
              <h3 className="settings-shortcuts__group-title">{group.title}</h3>
              {actions.map((action) => {
                const binding = bindings[action.id];
                const customized = Object.prototype.hasOwnProperty.call(
                  overrides,
                  action.id,
                );
                const defaultCaps = formatShortcutKeycaps(
                  defaultShortcutBinding(action.id, mac),
                  mac,
                ).join(" + ");
                return (
                  <ShortcutRow
                    key={action.id}
                    action={action}
                    binding={binding}
                    defaultCaps={defaultCaps}
                    customized={customized}
                    recording={recording === action.id}
                    mac={mac}
                    onChange={() => {
                      setMessage(null);
                      beginRecording(action.id);
                    }}
                    onCancel={() => {
                      setMessage(null);
                      cancelRecording();
                    }}
                    onReset={() => {
                      const actionRecord = shortcutAction(action.id);
                      resetBinding(action.id);
                      setMessage({
                        kind: "status",
                        text: `${actionRecord?.label ?? "Shortcut"} is back on its default.`,
                      });
                    }}
                  />
                );
              })}
            </section>
          );
        })}

        <div className="settings-shortcuts__footer">
          <p className="settings-shortcuts__hint" role="status">
            {customizedCount === 0
              ? "Every movement is on its default key."
              : `${customizedCount} ${
                  customizedCount === 1 ? "movement is" : "movements are"
                } changed from the defaults.`}
            {message?.kind === "status" ? ` ${message.text}` : ""}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={customizedCount === 0}
            data-shortcuts-reset-all=""
            onClick={() => {
              resetAll();
              setMessage({ kind: "status", text: "Every shortcut is back on its default." });
            }}
          >
            Restore all defaults
          </Button>
        </div>

        <p className="settings-shortcuts__hint settings-shortcuts__hint--quiet">
          Escape cancels a change. Backspace or Delete clears a shortcut, leaving
          the movement with no key at all.
        </p>
      </div>
    </SettingsSection>
  );
}
