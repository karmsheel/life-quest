/**
 * The four LifeQuest lockups the app ships, and the operator's pick of one.
 *
 * The art lives beside this file (`src/assets/brand/logo/`), extracted from the
 * operator's SVGs. Each file's own `<style>` block was removed when it was
 * copied in: the three inks are the app's theme tokens now
 * (`--life-color`, `--icon-color`, `--uest-color`), so the mark follows the
 * active palette instead of carrying a baked cream on a white skin.
 *
 * The pick is stored locally rather than in the app profile because the splash
 * screen has to know it before React (or any IPC) exists: `theme-boot.js` reads
 * the same key in the inline boot script. That is the same trade the theme
 * preference already makes, and the reason this file has no React import.
 */

export type LogoVariant = "modern" | "athletic" | "classic" | "minimal";

export interface LogoVariantInfo {
  id: LogoVariant;
  label: string;
  /** One line for the picker's subtitle; the art's own title says the rest. */
  description: string;
  /**
   * The artwork's ink-tight viewBox, in the same coordinates as the shipped
   * file's own. The rail's header draws this box instead of the file's padded
   * one so the lockup's leading edge (the L) begins exactly where the rail's
   * rows and the wing switcher begin; the splash and the picker keep the padded
   * box, which is what keeps the mark's scale there unchanged.
   */
  headerViewBox: string;
}

/**
 * In the order the operator met them. The shipped default is the 4th lockup
 * (Minimal); the order stays the supplied one so the picker reads as the
 * operator's own set.
 *
 * The descriptions are the supplied art's own distinctions (the source SVGs
 * title them "Modern", "Athletic — opposing slants", "Classic" and "Minimal"),
 * kept to what the operator can see at picker size rather than to a font name
 * the app does not ship.
 */
export const LOGO_VARIANTS: readonly LogoVariantInfo[] = [
  {
    id: "modern",
    label: "Modern",
    description: "Neutral sans lockup.",
    headerViewBox: "118.33 34 787 171.77",
  },
  {
    id: "athletic",
    label: "Athletic",
    description: "Heavy slanted sans, the two words leaning apart.",
    headerViewBox: "160.61 38 775 173.77",
  },
  {
    id: "classic",
    label: "Classic",
    description: "Serif lockup, settled and editorial.",
    headerViewBox: "144.41 38 757 173.77",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Light, wide-tracked sans — the shipped default.",
    headerViewBox: "144.19 39 847 161.78",
  },
];

export const DEFAULT_LOGO_VARIANT: LogoVariant = "minimal";

/** The localStorage key, shared with `public/theme-boot.js` (the splash read). */
export const LOGO_STORAGE_KEY = "lifequest-logo";

/** The same-window event a pick dispatches; storage changes cover other windows. */
export const LOGO_CHANGED_EVENT = "lifequest-logo-changed";

export function isLogoVariant(value: unknown): value is LogoVariant {
  return (
    typeof value === "string" &&
    LOGO_VARIANTS.some((variant) => variant.id === value)
  );
}

/** What the operator picked, or the default when nothing valid is stored. */
export function readLogoVariant(): LogoVariant {
  try {
    const stored = window.localStorage.getItem(LOGO_STORAGE_KEY);
    return isLogoVariant(stored) ? stored : DEFAULT_LOGO_VARIANT;
  } catch {
    return DEFAULT_LOGO_VARIANT;
  }
}

/**
 * Keep the pick and tell every listener — the rail, and the Developer picker if
 * it is the one changing it. Storage is written first: a listener that re-reads
 * must see the new value, not the one it is replacing.
 */
export function writeLogoVariant(variant: LogoVariant): void {
  try {
    window.localStorage.setItem(LOGO_STORAGE_KEY, variant);
  } catch {
    /* A profile with storage disabled keeps the pick for this window only. */
  }
  window.dispatchEvent(
    new CustomEvent(LOGO_CHANGED_EVENT, { detail: variant }),
  );
}

/**
 * Subscribe to the pick changing: this window's own event, and the `storage`
 * event another window's write raises. Returns the unsubscribe.
 */
export function subscribeLogoVariant(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOGO_STORAGE_KEY) onChange();
  };
  window.addEventListener(LOGO_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LOGO_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
