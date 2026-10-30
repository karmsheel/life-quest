/**
 * The keyboard's own state: every movement's binding, and the one row the
 * operator is currently recording.
 *
 * The provider sits above the shell, the settings sheet and the dock, because
 * all of them touch it: the runner under the shell listens for the bindings, and
 * two pages edit them — Settings → Keyboard and the dock's shortcuts reference.
 * It owns three things and nothing else —
 *
 *  - **The bindings.** Defaults, with the operator's stored overrides merged in.
 *  - **The recording.** Which row is waiting for a key, and what the last key
 *    said. One recorder serves both editors, because a modal settings sheet does
 *    not unmount the dock beneath it; the runner stands aside while the keys
 *    belong to an editing row, even when the caret is not in an input.
 *  - **The refusals.** Conflict, reserved space and unparseable keys are decided
 *    here, so a page only has to show the reason the provider returned.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  SHORTCUT_ACTIONS,
  defaultShortcutBinding,
  isMacPlatform,
  isReservedShortcut,
  parseShortcutBinding,
  readStoredShortcutOverrides,
  resolveShortcutBindings,
  shortcutBindingFromEvent,
  shortcutBindingsEqual,
  shortcutBindingToString,
  writeStoredShortcutOverrides,
  type ShortcutActionId,
  type ShortcutBindings,
  type ShortcutOverrides,
} from "@/lib/shortcuts";

/** What a change to a binding did, in the operator's words when it refused. */
export type ShortcutChangeResult =
  | { ok: true }
  | { ok: false; error: string };

/** What the recording row says about the last key it saw. */
export type ShortcutRecordingMessage = { kind: "error" | "status"; text: string };

type ShortcutsContextValue = {
  /** Every movement's effective binding, overrides already applied. */
  bindings: ShortcutBindings;
  /** The overrides as stored — what "customized" and "restore" read. */
  overrides: ShortcutOverrides;
  /** The row waiting for a key, or null. */
  recording: ShortcutActionId | null;
  /**
   * What the recording tried last: a refusal, or the note that the binding was
   * saved/cleared/cancelled. One recorder serves every page that edits the
   * table, so the message belongs beside the recording rather than in a page.
   */
  recordingMessage: ShortcutRecordingMessage | null;
  beginRecording: (id: ShortcutActionId) => void;
  cancelRecording: () => void;
  clearRecordingMessage: () => void;
  /**
   * Bind `id` to `value` (a storage spelling such as `Ctrl+Shift+B`), or clear
   * it with `null`. Refuses a reserved combination or another movement's key.
   */
  setBinding: (id: ShortcutActionId, value: string | null) => ShortcutChangeResult;
  /** Put one movement back on its default. */
  resetBinding: (id: ShortcutActionId) => void;
  /** Put every movement back on its default. */
  resetAll: () => void;
  /** How many movements the operator has changed. */
  customizedCount: number;
  /** `true` on macOS, where the platform key is Cmd and labels say so. */
  mac: boolean;
};

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const mac = useMemo(() => isMacPlatform(), []);
  const [overrides, setOverrides] = useState<ShortcutOverrides>(() =>
    readStoredShortcutOverrides(mac),
  );
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [recordingMessage, setRecordingMessage] =
    useState<ShortcutRecordingMessage | null>(null);

  const bindings = useMemo(
    () => resolveShortcutBindings(overrides, mac),
    [overrides, mac],
  );

  const commit = useCallback((next: ShortcutOverrides) => {
    setOverrides(next);
    // A storage failure is not allowed to pretend the change took: the page
    // reads the provider's state, so the in-memory binding is still useful for
    // this session, and `setBinding`'s callers treat a refusal differently.
    writeStoredShortcutOverrides(next);
  }, []);

  const setBinding = useCallback(
    (id: ShortcutActionId, value: string | null): ShortcutChangeResult => {
      if (value === null) {
        commit({ ...overrides, [id]: null });
        return { ok: true };
      }

      const parsed = parseShortcutBinding(value, mac);
      if (!parsed) {
        return { ok: false, error: "That is not a key this app can bind." };
      }
      if (isReservedShortcut(parsed, mac)) {
        return {
          ok: false,
          error:
            "That combination is reserved by the app or the operating system. Pick another one.",
        };
      }

      const conflict = SHORTCUT_ACTIONS.find((action) => {
        if (action.id === id) return false;
        const other = bindings[action.id];
        return other !== null && shortcutBindingsEqual(other, parsed);
      });
      if (conflict) {
        return {
          ok: false,
          error: `Already used by “${conflict.label}”. Pick another combination.`,
        };
      }

      // Setting a movement back to its default leaves no override behind: the
      // default belongs to the app, not to this operator's storage.
      if (
        shortcutBindingsEqual(parsed, defaultShortcutBinding(id, mac))
      ) {
        const next = { ...overrides };
        delete next[id];
        commit(next);
        return { ok: true };
      }

      commit({ ...overrides, [id]: shortcutBindingToString(parsed) });
      return { ok: true };
    },
    [bindings, commit, mac, overrides],
  );

  const resetBinding = useCallback(
    (id: ShortcutActionId) => {
      const next = { ...overrides };
      delete next[id];
      commit(next);
    },
    [commit, overrides],
  );

  const resetAll = useCallback(() => {
    commit({});
  }, [commit]);

  const beginRecording = useCallback((id: ShortcutActionId) => {
    setRecordingMessage(null);
    setRecording(id);
  }, []);

  const cancelRecording = useCallback(() => {
    setRecording(null);
  }, []);

  const clearRecordingMessage = useCallback(() => {
    setRecordingMessage(null);
  }, []);

  /**
   * The keyboard belongs to the recording row, wherever it is drawn.
   *
   * This listener lives on the provider, not on either page, because two pages
   * now edit the same table — Settings → Keyboard and the dock's reference — and
   * a modal settings sheet does not unmount the dock under it. One recorder means
   * one capture listener, one Escape that cancels, and one conflict refusal no
   * matter which page started the recording.
   *
   * A row that is no longer in the document (its page was closed) cancels the
   * recording instead of binding a key into a control the operator can no longer
   * see.
   */
  useEffect(() => {
    if (!recording) return;
    const actionId = recording;

    function rowFor(id: ShortcutActionId): Element | null {
      return document.querySelector(`[data-shortcut-recording-row="${id}"]`);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (!rowFor(actionId)) {
        setRecording(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;

      if (event.key === "Escape") {
        setRecordingMessage({ kind: "status", text: "Shortcut change cancelled." });
        setRecording(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        const result = setBinding(actionId, null);
        if (result.ok) {
          setRecordingMessage({ kind: "status", text: "Shortcut cleared." });
          setRecording(null);
        } else {
          setRecordingMessage({ kind: "error", text: result.error });
        }
        return;
      }

      const binding = shortcutBindingFromEvent(event);
      if (!binding) return; // a modifier held on its own is not the binding yet

      const result = setBinding(actionId, shortcutBindingToString(binding));
      if (!result.ok) {
        setRecordingMessage({ kind: "error", text: result.error });
        return;
      }
      setRecordingMessage({ kind: "status", text: "Shortcut saved." });
      setRecording(null);
    }

    function onPointerDown(event: PointerEvent) {
      const row = rowFor(actionId);
      if (row && event.target instanceof Node && row.contains(event.target)) return;
      setRecording(null);
    }

    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [recording, setBinding]);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      bindings,
      overrides,
      recording,
      recordingMessage,
      beginRecording,
      cancelRecording,
      clearRecordingMessage,
      setBinding,
      resetBinding,
      resetAll,
      customizedCount: Object.keys(overrides).length,
      mac,
    }),
    [
      bindings,
      overrides,
      recording,
      recordingMessage,
      beginRecording,
      cancelRecording,
      clearRecordingMessage,
      setBinding,
      resetBinding,
      resetAll,
      mac,
    ],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
    </ShortcutsContext.Provider>
  );
}

export function useShortcuts(): ShortcutsContextValue {
  const context = useContext(ShortcutsContext);
  if (!context) {
    throw new Error("useShortcuts must be used within ShortcutsProvider");
  }
  return context;
}

/**
 * The shortcuts, if this tree is wrapped in the provider.
 *
 * `ShortcutRunner` sits inside `AppShell`, and the shell is mounted by harnesses
 * that do not need the keyboard — a dock rig, a sidebar rig, a page rig. Those
 * trees predate the shortcuts feature and are complete without it; the runner
 * standing down is the honest behaviour there, the same way `ChatPanel` falls
 * back to its own chat store when the shell's provider is absent. Pages that
 * actually edit or read the bindings use `useShortcuts` and still require it.
 */
export function useShortcutsOptional(): ShortcutsContextValue | null {
  return useContext(ShortcutsContext);
}
