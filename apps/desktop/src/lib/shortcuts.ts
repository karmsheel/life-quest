/**
 * Keyboard shortcuts: the movements the studio offers the keyboard, and the keys
 * the operator binds to them.
 *
 * The app has always had a keyboard (Escape unwinds a sheet, Ctrl/Cmd+S saves a
 * document), but its movements — changing wing, walking the pages of a wing,
 * toggling a pane, opening settings — were mouse-only. This module is the one
 * table those movements are declared in, the parser that turns a pressed key into
 * a binding, and the storage that remembers a binding the operator chose.
 *
 * Three rules keep a user-defined shortcut honest:
 *
 *  1. **A default is portable.** Action defaults are written with `Mod`, which
 *     resolves to Cmd on macOS and Ctrl everywhere else. A binding the operator
 *     records is stored with the modifier they actually pressed, so a deliberate
 *     Ctrl on a Mac stays Ctrl.
 *  2. **A binding is compared by what should happen, not by how it is spelled.**
 *     Parsing normalises aliases, modifier order and key case once, and matching
 *     compares the parsed shape against the event's flags. `Ctrl+Shift+B` and
 *     `shift+ctrl+b` are the same shortcut, and neither is a shortcut for `B`.
 *  3. **Reserved space stays reserved.** Reload, devtools, print, window close
 *     and Escape are not ours to take: a binding that lands on one of them is
 *     refused with a reason instead of silently stealing a key the app or the
 *     operating system needs.
 *
 * This file has no React in it. The provider owns the binding state, the runner
 * owns the movement; everything that can be decided from a key and a table is
 * decided here.
 */

/** The group a shortcut row sits under on the settings page. */
export type ShortcutGroupId = "wings" | "pages" | "panels" | "surfaces";

export type ShortcutActionId =
  | "wing.home"
  | "wing.define"
  | "wing.plan"
  | "wing.execute"
  | "wing.review"
  | "wing.next"
  | "wing.previous"
  | "page.next"
  | "page.previous"
  | "history.back"
  | "history.forward"
  | "panel.sidebar.toggle"
  | "panel.chat.toggle"
  | "surface.settings.open";

export type ShortcutAction = {
  id: ShortcutActionId;
  group: ShortcutGroupId;
  label: string;
  description: string;
  /**
   * The default binding, in portable notation. `Mod` is Cmd on macOS and Ctrl
   * elsewhere; every other token is a modifier name or a key name this module
   * understands (see `KEY_ALIASES`).
   */
  defaultBinding: string;
};

export const SHORTCUT_GROUPS: Array<{ id: ShortcutGroupId; title: string }> = [
  { id: "wings", title: "Wings" },
  { id: "pages", title: "Pages" },
  { id: "panels", title: "Panels" },
  { id: "surfaces", title: "Surfaces" },
];

/**
 * Every movement a key can be bound to, in the order the settings page lists
 * them. The order is also the tie-breaker if a stored file ever carries two
 * actions on one binding: the first one wins.
 */
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "wing.home",
    group: "wings",
    label: "Go to Home",
    description:
      "Jump to the Home wing's last page. Home holds the Dashboard, Data, Pages, Documents and Personnel.",
    defaultBinding: "Mod+1",
  },
  {
    id: "wing.define",
    group: "wings",
    label: "Go to Define",
    description:
      "Jump to the Define wing's last page — Dream, Vision or Ideal State.",
    defaultBinding: "Mod+2",
  },
  {
    id: "wing.plan",
    group: "wings",
    label: "Go to Plan",
    description:
      "Jump to the Plan wing's last page — Goals, Life Map or Architecture.",
    defaultBinding: "Mod+3",
  },
  {
    id: "wing.execute",
    group: "wings",
    label: "Go to Execute",
    description:
      "Jump to the Execute wing's last page — Projects, Daily Schedule or Act.",
    defaultBinding: "Mod+4",
  },
  {
    id: "wing.review",
    group: "wings",
    label: "Go to Review",
    description: "Jump to the Review wing's last page, or Daily on a fresh session.",
    defaultBinding: "Mod+5",
  },
  {
    id: "wing.next",
    group: "wings",
    label: "Next wing",
    description:
      "Step to the next wing in the top bar, in order, wrapping from Review back to Home.",
    defaultBinding: "Mod+PageDown",
  },
  {
    id: "wing.previous",
    group: "wings",
    label: "Previous wing",
    description:
      "Step to the previous wing in the top bar, wrapping from Home back to Review.",
    defaultBinding: "Mod+PageUp",
  },
  {
    id: "page.next",
    group: "pages",
    label: "Next page",
    description:
      "Step to the next page in the current wing's rail, wrapping at the end. From a page outside the rail, it enters at the first page.",
    defaultBinding: "Mod+Shift+PageDown",
  },
  {
    id: "page.previous",
    group: "pages",
    label: "Previous page",
    description:
      "Step to the previous page in the current wing's rail, wrapping at the start. From a page outside the rail, it enters at the last page.",
    defaultBinding: "Mod+Shift+PageUp",
  },
  {
    id: "history.back",
    group: "pages",
    label: "Back",
    description: "Return to the page you were on before this one.",
    defaultBinding: "Alt+ArrowLeft",
  },
  {
    id: "history.forward",
    group: "pages",
    label: "Forward",
    description: "Return to the page you stepped back from.",
    defaultBinding: "Alt+ArrowRight",
  },
  {
    id: "panel.sidebar.toggle",
    group: "panels",
    label: "Toggle sidebar",
    description: "Collapse or expand the nav rail, giving its column back to the page.",
    defaultBinding: "Mod+B",
  },
  {
    id: "panel.chat.toggle",
    group: "panels",
    label: "Toggle chat",
    description: "Open or close the chat dock beside the page.",
    defaultBinding: "Mod+J",
  },
  {
    id: "surface.settings.open",
    group: "surfaces",
    label: "Open settings",
    description: "Open the settings sheet over the page you are reading.",
    defaultBinding: "Mod+,",
  },
];

const ACTION_BY_ID = new Map<ShortcutActionId, ShortcutAction>(
  SHORTCUT_ACTIONS.map((action) => [action.id, action]),
);

export function shortcutAction(
  id: ShortcutActionId,
): ShortcutAction | undefined {
  return ACTION_BY_ID.get(id);
}

/** One parsed shortcut: the four modifiers the platform reports and one key. */
export type ShortcutBinding = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

/** `true` when this window is on macOS, where `Mod` means Cmd, not Ctrl. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = data?.platform ?? navigator.platform ?? "";
  if (/mac/i.test(platform)) return true;
  return /mac os x|macintosh/i.test(navigator.userAgent ?? "");
}

/**
 * Key spellings that mean the same key. The canonical form is what `event.key`
 * already reports for named keys (ArrowLeft, PageDown, Escape…); aliases exist
 * for hand-written defaults and for punctuation, whose literal characters would
 * break the `+`-joined storage format.
 */
const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  return: "Enter",
  enter: "Enter",
  tab: "Tab",
  space: "Space",
  spacebar: "Space",
  backspace: "Backspace",
  del: "Delete",
  delete: "Delete",
  insert: "Insert",
  ins: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pgup: "PageUp",
  pagedown: "PageDown",
  pgdn: "PageDown",
  arrowup: "ArrowUp",
  up: "ArrowUp",
  arrowdown: "ArrowDown",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  left: "ArrowLeft",
  arrowright: "ArrowRight",
  right: "ArrowRight",
  comma: "Comma",
  period: "Period",
  slash: "Slash",
  backslash: "Backslash",
  semicolon: "Semicolon",
  quote: "Quote",
  backquote: "Backquote",
  bracketleft: "BracketLeft",
  bracketright: "BracketRight",
  minus: "Minus",
  equal: "Equal",
  equals: "Equal",
  plus: "Plus",
};

/** Punctuation whose canonical name is not the character the key prints. */
const KEY_FROM_CHARACTER: Record<string, string> = {
  " ": "Space",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
  "+": "Plus",
};

/** The character a canonical punctuation key prints, for keycaps. */
const KEY_PRINTED: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Plus: "+",
};

/** The keycap label of a named key that is not one character. */
const KEY_LABEL: Record<string, string> = {
  Space: "Space",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Del",
  Insert: "Ins",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Keys that never end a binding: pressing one alone is still waiting. */
const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "Hyper",
  "Super",
]);

/** Keys an event can report that are not a key anybody can bind. */
const UNBINDABLE_KEYS = new Set([
  "Dead",
  "Unidentified",
  "Process",
  "Compose",
  "Convert",
  "NonConvert",
  "KanaMode",
  "Lang1",
  "Lang2",
  "Lang3",
  "Lang4",
  "Lang5",
]);

const MODIFIER_ALIASES: Record<string, "mod" | "ctrl" | "meta" | "alt" | "shift"> = {
  mod: "mod",
  command: "meta",
  cmd: "meta",
  meta: "meta",
  super: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
};

/**
 * A key as the canonical token this module stores, or null if the event is not a
 * key a binding can end on.
 */
export function shortcutKeyToken(raw: string): string | null {
  if (!raw) return null;
  if (MODIFIER_KEYS.has(raw) || UNBINDABLE_KEYS.has(raw)) return null;
  const lower = raw.toLowerCase();
  const alias = KEY_ALIASES[lower];
  if (alias) return alias;
  if (KEY_FROM_CHARACTER[raw]) return KEY_FROM_CHARACTER[raw];
  if (raw.length === 1) return raw.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase();
  return null;
}

function bindingFromParts(
  key: string,
  mods: Pick<ShortcutBinding, "ctrl" | "meta" | "alt" | "shift">,
): ShortcutBinding {
  return { key, ...mods };
}

/**
 * Parse a stored or written binding — `Ctrl+Shift+PageDown`, `Mod+B`, `Alt+←` —
 * into the shape the matcher compares. `Mod` resolves with the platform, so the
 * same default string works on a Mac and on Windows.
 */
export function parseShortcutBinding(
  text: string,
  mac = isMacPlatform(),
): ShortcutBinding | null {
  return parseBinding(text, mac);
}

function parseBinding(text: string, mac: boolean): ShortcutBinding | null {
  const tokens = text
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let key: string | null = null;
  const mods = { ctrl: false, meta: false, alt: false, shift: false };

  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    if (modifier === "mod") {
      if (mac) mods.meta = true;
      else mods.ctrl = true;
      continue;
    }
    if (modifier) {
      mods[modifier] = true;
      continue;
    }
    if (key !== null) return null;
    key = shortcutKeyToken(token);
    if (key === null) return null;
  }

  if (key === null) return null;
  return bindingFromParts(key, mods);
}

/** The default binding for an action, already resolved for this platform. */
export function defaultShortcutBinding(
  id: ShortcutActionId,
  mac = isMacPlatform(),
): ShortcutBinding {
  const action = ACTION_BY_ID.get(id);
  const parsed = action ? parseBinding(action.defaultBinding, mac) : null;
  // Every default in this table parses; the fallback keeps a typo from taking
  // the whole keyboard down at runtime.
  return parsed ?? bindingFromParts("F24", { ctrl: true, meta: false, alt: true, shift: true });
}

/** A binding in the one storage spelling this module writes and reads. */
export function shortcutBindingToString(binding: ShortcutBinding): string {
  const tokens: string[] = [];
  if (binding.ctrl) tokens.push("Ctrl");
  if (binding.meta) tokens.push("Meta");
  if (binding.alt) tokens.push("Alt");
  if (binding.shift) tokens.push("Shift");
  tokens.push(binding.key);
  return tokens.join("+");
}

/** The keycaps of a binding, in modifier order, printed the way the platform does. */
export function formatShortcutKeycaps(
  binding: ShortcutBinding,
  mac = isMacPlatform(),
): string[] {
  const caps: string[] = [];
  if (binding.ctrl) caps.push("Ctrl");
  if (binding.meta) caps.push(mac ? "Cmd" : "Meta");
  if (binding.alt) caps.push("Alt");
  if (binding.shift) caps.push("Shift");
  caps.push(keycapLabel(binding.key));
  return caps;
}

/** A single key's label, for a keycap row. */
export function keycapLabel(key: string): string {
  if (KEY_PRINTED[key]) return KEY_PRINTED[key];
  if (KEY_LABEL[key]) return KEY_LABEL[key];
  return key;
}

/** A binding read off a keydown event, or null for a modifier-only press. */
export function shortcutBindingFromEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): ShortcutBinding | null {
  const key = shortcutKeyToken(event.key);
  if (key === null) return null;
  return bindingFromParts(key, {
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  });
}

/** True when this keydown is the binding. */
export function shortcutBindingMatchesEvent(
  binding: ShortcutBinding,
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): boolean {
  const key = shortcutKeyToken(event.key);
  return (
    key === binding.key &&
    event.ctrlKey === binding.ctrl &&
    event.metaKey === binding.meta &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift
  );
}

/** Two bindings that would both fire on the same key. */
export function shortcutBindingsEqual(
  a: ShortcutBinding,
  b: ShortcutBinding,
): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

/**
 * Combinations the app or the operating system owns. A user binding that lands
 * on one is refused: stealing Ctrl/Cmd+W would make the window unclosable, and
 * stealing F12 would replace devtools with a wing jump.
 */
const RESERVED_BINDINGS = [
  "Escape",
  "Tab",
  "Enter",
  "F5",
  "F11",
  "F12",
  "Alt+F4",
  "Mod+W",
  "Mod+Q",
  "Mod+R",
  "Mod+Shift+R",
  "Mod+Shift+I",
  "Mod+Alt+I",
  "Mod+Shift+J",
  "Mod+Shift+C",
  "Mod+P",
  "Mod+Shift+P",
  "Mod+Minus",
  "Mod+Equal",
  "Mod+0",
];

/** True when the binding is one the app or the platform must keep. */
export function isReservedShortcut(
  binding: ShortcutBinding,
  mac = isMacPlatform(),
): boolean {
  return RESERVED_BINDINGS.some((reserved) => {
    const parsed = parseBinding(reserved, mac);
    return parsed !== null && shortcutBindingsEqual(parsed, binding);
  });
}

/** Every action's effective binding, after overrides and defaults are merged. */
export type ShortcutBindings = Record<ShortcutActionId, ShortcutBinding | null>;

export function resolveShortcutBindings(
  overrides: ShortcutOverrides,
  mac = isMacPlatform(),
): ShortcutBindings {
  const bindings = {} as ShortcutBindings;
  for (const action of SHORTCUT_ACTIONS) {
    if (Object.prototype.hasOwnProperty.call(overrides, action.id)) {
      const stored = overrides[action.id];
      if (stored === null) {
        bindings[action.id] = null;
        continue;
      }
      const parsed = parseBinding(stored ?? "", mac);
      // A corrupt entry falls back to the default rather than leaving the
      // movement silent: the operator can still reset it from the page.
      bindings[action.id] = parsed ?? defaultShortcutBinding(action.id, mac);
      continue;
    }
    bindings[action.id] = defaultShortcutBinding(action.id, mac);
  }
  return bindings;
}

/** The action a keydown fires, or null. */
export function shortcutActionForEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
  bindings: ShortcutBindings,
): ShortcutActionId | null {
  for (const action of SHORTCUT_ACTIONS) {
    const binding = bindings[action.id];
    if (binding && shortcutBindingMatchesEvent(binding, event)) return action.id;
  }
  return null;
}

/**
 * Where a recorded binding is stored: only the actions the operator changed,
 * with `null` meaning "deliberately unassigned". Keeping defaults out of storage
 * means a later release can still improve a default for everyone who never
 * touched it.
 */
export type ShortcutOverrides = Partial<
  Record<ShortcutActionId, string | null>
>;

export const SHORTCUTS_STORAGE_KEY = "lifequest-keyboard-shortcuts";

type StoredShortcuts = {
  version: 1;
  bindings: ShortcutOverrides;
};

function knownActionId(value: string): value is ShortcutActionId {
  return ACTION_BY_ID.has(value as ShortcutActionId);
}

/** The stored overrides, or an empty set when there is nothing usable. */
export function readStoredShortcutOverrides(
  mac = isMacPlatform(),
): ShortcutOverrides {
  if (typeof window === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const stored = parsed as Partial<StoredShortcuts> & Record<string, unknown>;
    const bindings = stored.bindings;
    if (!bindings || typeof bindings !== "object") return {};
    const result: ShortcutOverrides = {};
    for (const [key, value] of Object.entries(bindings)) {
      if (!knownActionId(key)) continue;
      if (value === null) {
        result[key] = null;
        continue;
      }
      if (typeof value !== "string") continue;
      if (parseBinding(value, mac) === null) continue;
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** Persist the overrides. A storage failure is reported, never swallowed. */
export function writeStoredShortcutOverrides(
  overrides: ShortcutOverrides,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      SHORTCUTS_STORAGE_KEY,
      JSON.stringify({ version: 1, bindings: overrides } satisfies StoredShortcuts),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the event's target is somewhere text is being typed.
 *
 * A one-key binding must never fire mid-sentence, and neither should Alt+Arrow:
 * Option+Arrow is a word-wise caret move on a Mac. A combination carrying Ctrl
 * or Cmd still does — that is the distinction every editor makes, and it is why
 * navigation shortcuts keep working from inside a text field.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const field = target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
  );
  if (!field) return false;
  if (field instanceof HTMLInputElement) {
    const type = field.type;
    // A checkbox, radio, button or slider is a control, not a place to type.
    return !(
      type === "button" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "submit" ||
      type === "reset" ||
      type === "range" ||
      type === "color"
    );
  }
  return true;
}
