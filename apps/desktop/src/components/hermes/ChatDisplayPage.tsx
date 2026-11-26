/**
 * The chat display settings, as the dock's surface: the two axes the
 * transcript is read by — text size and line spacing — edited where the
 * transcript is, without taking the operator off the page they are working on.
 *
 * The page is the third surface over the same window-local pair Settings →
 * Chat display edits. It is not a copy of the settings sheet and not a shortcut
 * to it: the controls call the one `ChatDisplayProvider`, so a notch pressed
 * here is worn by the thread behind it the moment the surface closes, and a
 * value changed in Settings is what the stepper reads the next time this page
 * opens. The preview is drawn with the transcript's own measures for the same
 * reason the Settings page's is: the choice is judged on the text it changes.
 *
 * The dock has no room for the Settings page's long descriptions, so each axis
 * keeps one line of prose and the live control under it. The reset control rides
 * the size row because it is the one action that moves both axes at once.
 */
import type { CSSProperties } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  CHAT_LINE_SPACING_OPTIONS,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  CHAT_ZOOM_STEP,
} from "@/lib/chat-display";
import { useChatDisplay } from "@/state/ChatDisplayProvider";

export function ChatDisplayPage() {
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
    <div className="chat-display-page" data-chat-display="">
      <section className="chat-display-page__group">
        <h3 className="chat-display-page__title">Text size</h3>
        <p className="chat-display-page__desc">
          How large the agent's prose is drawn here. Ctrl and the mouse wheel
          over the dock steps it too.
        </p>
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
            title="Reset to normal (100%, 1.5 line spacing)"
            onClick={reset}
          >
            <RotateCcw size={12} aria-hidden />
            Reset
          </button>
        </div>
        <p className="chat-display-page__hint">
          {CHAT_ZOOM_MIN}% to {CHAT_ZOOM_MAX}% in {CHAT_ZOOM_STEP}-percent steps.
          Ctrl + plus, Ctrl + minus and Ctrl + 0 work from anywhere.
        </p>
      </section>

      <section className="chat-display-page__group">
        <h3 className="chat-display-page__title">Line spacing</h3>
        <p className="chat-display-page__desc">
          The space between lines of the agent's prose.
        </p>
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
      </section>

      <section className="chat-display-page__group">
        <h3 className="chat-display-page__title">Preview</h3>
        <p className="chat-display-page__desc">
          The dock's own reading measures, at the size and spacing above.
        </p>
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
      </section>
    </div>
  );
}
