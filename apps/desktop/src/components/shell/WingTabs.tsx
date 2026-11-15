import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { WING_IDS, WING_LABELS, type WingId } from "./wing.ts";
import { useWing } from "./WingProvider";

/** The icon variant's mark for each wing: one letter, named for a screen reader. */
const WING_INITIALS: Record<WingId, string> = {
  home: "H",
  define: "D",
  plan: "P",
  execute: "A",
  review: "R",
};

/**
 * The five wings, as one control.
 *
 * It lives in the sidebar's own top band, sharing the row with the sheet's top
 * bar: the wings are the sidebar's first level, and the rows under them are the
 * active wing's pages. It used to sit in the sheet's top bar, where it pushed
 * the domain lens off the band's centre.
 *
 * The control itself is `@ui-sdk/react`'s segmented control (the first
 * primitive adopted from the library): keyboard roving, the radio semantics and
 * the focus rules are the library's, while the classes and the palette stay the
 * app's. A theme may ask for the compact `icons` variant; it changes the label,
 * never the value the shell stores.
 */
export function WingTabs({ variant = "labels" }: { variant?: "labels" | "icons" }) {
  const { active, selectWing } = useWing();

  return (
    <SegmentedControl
      className="ui-segmented nav-rail__wings"
      aria-label="App wing"
      value={active}
      onValueChange={(next) => {
        if (next) selectWing(next as WingId);
      }}
    >
      {WING_IDS.map((wing) => (
        <SegmentedControlItem
          key={wing}
          className="ui-segmented__option"
          value={wing}
          aria-label={variant === "icons" ? WING_LABELS[wing] : undefined}
        >
          {variant === "icons" ? (
            <span className="nav-rail__wing-initial" aria-hidden="true">
              {WING_INITIALS[wing]}
            </span>
          ) : (
            WING_LABELS[wing]
          )}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
