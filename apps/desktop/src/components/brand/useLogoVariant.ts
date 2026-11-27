import { useSyncExternalStore } from "react";
import {
  DEFAULT_LOGO_VARIANT,
  readLogoVariant,
  subscribeLogoVariant,
} from "@/lib/brand/logo";

/**
 * The operator's logo pick, as a rendered value.
 *
 * `useSyncExternalStore` rather than state because the store is outside React:
 * `theme-boot.js` reads the same localStorage key for the splash, and another
 * window's pick arrives as a `storage` event. A `useState` copy would have to be
 * told about both, and would render a stale mark the one time it was not.
 */
export function useLogoVariant() {
  return useSyncExternalStore(
    subscribeLogoVariant,
    readLogoVariant,
    () => DEFAULT_LOGO_VARIANT,
  );
}
