import { useCallback, useState, type CSSProperties, type RefObject } from "react";

/** The quick menus' shared width: one tile grid, one column of chrome. */
const POPOVER_WIDTH = 16.5 * 16;

/**
 * Where an anchored popover draws, measured off its trigger.
 *
 * Both quick menus — the settings button's and the titlebar's day/night control
 * — hang off a control in the window strip, and both must survive a narrow
 * window: `bottom-end` opens under the control and pulls itself back from the
 * window's edges, while `right-end` hangs beside a control that sits against a
 * vertical edge. The measurements are taken whenever the menu opens and then
 * again on every resize and scroll, because a menu positioned once would drift
 * off its trigger the moment the window moved under it.
 *
 * The returned style is `position: fixed`: the menus are portalled to the body,
 * so they are not clipped by the strip that owns the trigger.
 */
export function useMenuPosition(
  triggerRef: RefObject<HTMLElement | null>,
  placement: "bottom-end" | "right-end",
  options: { width?: number } = {},
) {
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  // The quick menus are one tile grid of a fixed width; a caller that draws
  // something wider (the journal's day picker is seven day cells across) says so
  // rather than having its width overridden by the shared default.
  const requestedWidth = options.width ?? POPOVER_WIDTH;

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(requestedWidth, vw - 16);

    if (placement === "right-end") {
      let left = rect.right + gap;
      if (left + width > vw - 8) {
        left = Math.max(8, rect.left - width - gap);
      }
      const bottom = Math.max(8, vh - rect.bottom);
      setMenuStyle({
        position: "fixed",
        left,
        bottom,
        top: "auto",
        width,
        maxHeight: Math.max(160, vh - bottom - 8),
      });
      return;
    }

    let top = rect.bottom + gap;
    let left = rect.right - width;
    if (left < 8) left = 8;
    if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
    const estimatedMax = Math.min(420, vh - 16);
    if (top + 200 > vh && rect.top > vh - rect.bottom) {
      top = Math.max(8, rect.top - gap - estimatedMax);
    }
    setMenuStyle({
      position: "fixed",
      top,
      left,
      bottom: "auto",
      width,
      maxHeight: Math.max(160, vh - top - 8),
    });
  }, [placement, requestedWidth, triggerRef]);

  return { menuStyle, updateMenuPosition };
}
