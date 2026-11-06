// Which companion answers.
//
// The dock is the one place the choice has to be visible: a chat belongs to the
// harness that made it, so switching changes the list under this button. The
// picker is deliberately small — the setting is a choice between two, not a
// workspace.
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useOptionalCompanion } from "@/state/CompanionProvider";

export function HarnessPicker() {
  const companion = useOptionalCompanion();
  const harnesses = Array.isArray(companion?.harnesses) ? companion.harnesses : null;
  const useHarness = companion?.useHarness;
  const ensuring = companion?.ensuring ?? false;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!harnesses || harnesses.length === 0 || !useHarness) return null;
  const active = harnesses.find((h) => h.active) ?? harnesses[0]!;

  return (
    <div className="chat-panel__agent" ref={ref}>
      <button
        type="button"
        className="chat-panel__agent-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={ensuring}
        title="Which companion answers"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="chat-panel__agent-name">{active.name}</span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {open ? (
        <div className="chat-panel__agent-menu" role="menu">
          {harnesses.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.active}
              className={
                entry.active
                  ? "chat-panel__agent-item chat-panel__agent-item--active"
                  : "chat-panel__agent-item"
              }
              onClick={() => {
                setOpen(false);
                if (!entry.active) void useHarness(entry.id);
              }}
            >
              <span className="chat-panel__agent-item-name">{entry.name}</span>
              <span className="chat-panel__agent-item-blurb">{entry.blurb}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
