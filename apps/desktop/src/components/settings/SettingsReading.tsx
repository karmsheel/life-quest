import { type CSSProperties } from "react";
import { Minus, Plus, RotateCcw, Type } from "lucide-react";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useChatDisplay } from "@/state/ChatDisplayProvider";
import {
  CHAT_LINE_SPACING_OPTIONS,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
} from "@/lib/chat-display";

/**
 * Settings → Chat display: how the agent's prose is set in the right-hand dock.
 *
 * Two axes, because they are the two an operator reads by: the size the text is
 * drawn at, and the space between its lines. The dock ships at 100% and 1.5 line
 * spacing; both are adjustable here, and the same two values are what the dock's
 * zoom gestures change, so the page is the read-back of a gesture and a gesture
 * is a shortcut to the page. The preview under the rows is drawn with the
 * transcript's own measures, so the choice is judged on the text it changes
 * rather than on a sample that only looks like it.
 *
 * The settings belong to the window (localStorage), not the vault: reading size
 * follows the screen, and one vault opened on two machines should not carry one
 * machine's eyes to the other.
 */
export function SettingsReading() {
  const {
    zoom,
    lineSpacing,
    stepZoom,
    setLineSpacing,
    reset,
    canZoomIn,
    canZoomOut,
  } = useChatDisplay();

  return (
    <SettingsSection
      icon={<Type size={16} />}
      title="Chat display"
      subtitle="Text size and line spacing in the chat dock"
    >
      <SettingsRow
        label="Text size"
        description="How large the agent's prose is drawn in the right-hand dock. Ctrl and the mouse wheel zooms over the dock; Ctrl + plus, Ctrl + minus and Ctrl + 0 change it from anywhere."
        action={
          <div
            className="chat-display-zoom"
            data-testid="chat-display-zoom"
            role="group"
            aria-label="Chat text size"
          >
            <button
              type="button"
              className="chat-display-zoom__step"
              data-testid="chat-display-zoom-out"
              aria-label="Decrease chat text size"
              title="Decrease chat text size"
              disabled={!canZoomOut}
              onClick={() => stepZoom(-1)}
            >
              <Minus size={14} aria-hidden />
            </button>
            <output
              className="chat-display-zoom__value"
              data-testid="chat-display-zoom-value"
              aria-live="polite"
            >
              {zoom}%
            </output>
            <button
              type="button"
              className="chat-display-zoom__step"
              data-testid="chat-display-zoom-in"
              aria-label="Increase chat text size"
              title="Increase chat text size"
              disabled={!canZoomIn}
              onClick={() => stepZoom(1)}
            >
              <Plus size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="chat-display-reset"
              data-testid="chat-display-reset"
              aria-label="Reset chat display to normal"
              title={`Reset to normal (100%, 1.5 line spacing)`}
              onClick={reset}
            >
              <RotateCcw size={12} aria-hidden />
              Reset
            </button>
          </div>
        }
      />
      <SettingsRow
        label="Line spacing"
        description="The space between lines of the agent's prose. The dock ships at 1.5, the reading setting it was tuned for."
        action={
          <div
            className="chat-display-lines"
            data-testid="chat-display-lines"
            role="group"
            aria-label="Line spacing"
          >
            {CHAT_LINE_SPACING_OPTIONS.map((option) => {
              const active = option.value === lineSpacing;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`chat-display-lines__option${active ? " is-active" : ""}`}
                  data-testid={`chat-display-line-${option.id}`}
                  data-value={option.value}
                  aria-pressed={active}
                  title={`${option.label} — ${option.value} line spacing`}
                  onClick={() => setLineSpacing(option.value)}
                >
                  <span>{option.label}</span>
                  <span className="chat-display-lines__value">
                    {option.value.toFixed(2).replace(/0$/, "")}
                  </span>
                </button>
              );
            })}
          </div>
        }
      />
      <SettingsRow
        label="Zoom range"
        description={`The dock's text size can be zoomed between ${CHAT_ZOOM_MIN}% and ${CHAT_ZOOM_MAX}% in 10-percent steps; the size in the box above is the one the dock is wearing now.`}
      />
      <div className="settings-card__row settings-card__row--stacked">
        <div className="settings-card__copy">
          <div className="settings-card__label">Preview</div>
          <p className="settings-card__desc">
            The dock's own reading measures, drawn at the size and spacing picked
            above.
          </p>
        </div>
        <div
          className="chat-display-preview"
          data-testid="chat-display-preview"
          data-zoom={zoom}
          data-line-spacing={lineSpacing}
          style={
            {
              "--chat-reading-scale": String(zoom / 100),
              "--chat-reading-line": String(lineSpacing),
            } as CSSProperties
          }
        >
          <p className="chat-display-preview__prose">
            I read the vault before answering: the week is mostly clear, the
            review window opens on Sunday, and the two decisions still waiting
            are both small. Pick one and I will walk it with you.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
