import { useRef, type KeyboardEvent } from "react";
import { WING_IDS, WING_LABELS, type WingId } from "./wing.ts";
import { useWing } from "./WingProvider";

/**
 * The five wings, as one control.
 *
 * It lives in the sidebar's own top band, sharing the row with the sheet's top
 * bar: the wings are the sidebar's first level, and the rows under them are the
 * active wing's pages. It used to sit in the sheet's top bar, where it pushed
 * the domain lens off the band's centre.
 */
export function WingTabs() {
  const { active, selectWing } = useWing();
  const refs = useRef<Partial<Record<WingId, HTMLButtonElement | null>>>({});

  function move(from: WingId, key: "ArrowLeft" | "ArrowRight") {
    const index = WING_IDS.indexOf(from);
    const next =
      key === "ArrowRight"
        ? WING_IDS[(index + 1) % WING_IDS.length]
        : WING_IDS[(index - 1 + WING_IDS.length) % WING_IDS.length];
    selectWing(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(wing: WingId, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(wing, event.key);
    }
  }

  return (
    <div
      className="ui-segmented nav-rail__wings"
      role="tablist"
      aria-label="App wing"
    >
      {WING_IDS.map((wing) => {
        const selected = wing === active;
        return (
          <button
            key={wing}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`ui-segmented__option${selected ? " is-active" : ""}`}
            ref={(el) => {
              refs.current[wing] = el;
            }}
            onClick={() => selectWing(wing)}
            onKeyDown={(event) => onKeyDown(wing, event)}
          >
            {WING_LABELS[wing]}
          </button>
        );
      })}
    </div>
  );
}
