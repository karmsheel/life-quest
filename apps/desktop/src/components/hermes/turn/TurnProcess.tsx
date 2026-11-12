import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  currentActivity,
  foldSummary,
  formatDuration,
  hasWorkLog,
  turnDurationMs,
  type TurnBlock,
  type TurnRecord,
} from "@/lib/turn-timeline";
import type { HarnessTurnCapabilities } from "@/vite-env";
import { ToolRunGroup } from "./ToolRunGroup";

/**
 * A turn's process: what the agent did before it answered.
 *
 * One disclosure per turn, and its rule follows the outcome:
 *
 *  - running: always open, with a live status line (elapsed, current activity)
 *    and no fold header — the operator is watching the work, not revisiting it;
 *  - completed: folded to one quiet header ("Worked for 1m 12s · Read 2 files"),
 *    reopenable, and the body unmounted so a long run costs one line;
 *  - stopped / failed / incomplete: never folded. The work that was cut short
 *    and the reason are the evidence; hiding them would leave the operator with
 *    a truncated reply and no explanation.
 *
 * The answer bubble is outside this component entirely: the reply is never
 * behind a disclosure.
 */
export function TurnProcess({
  turn,
  open,
  capabilities,
  onToggleFold,
}: {
  turn: TurnRecord;
  /** The operator's disclosure state for a foldable turn. */
  open: boolean;
  capabilities: HarnessTurnCapabilities;
  onToggleFold: (open: boolean) => void;
}) {
  const running = turn.status === "running";
  if (!running && !hasWorkLog(turn)) return null;

  // A provisional settle (no terminal frame) stays unfolded until the next
  // turn starts; see `settleProvisionally`.
  const foldable =
    !running &&
    turn.settled &&
    !turn.provisional &&
    turn.status === "completed" &&
    hasWorkLog(turn);
  const shown = foldable ? open : true;
  const duration = turnDurationMs(turn);
  const summary = foldSummary(turn);
  const heading = duration !== undefined ? `Worked for ${formatDuration(duration)}` : "Work log";

  return (
    <div
      className="chat-panel__process"
      data-testid="turn-process"
      data-process-state={shown ? "open" : "closed"}
    >
      {foldable ? (
        <button
          type="button"
          className="chat-panel__process-header"
          data-testid="process-header"
          aria-expanded={shown}
          onClick={() => onToggleFold(!shown)}
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={
              shown
                ? "chat-panel__process-caret chat-panel__process-caret--open"
                : "chat-panel__process-caret"
            }
          />
          <span className="chat-panel__process-heading">{heading}</span>
          {summary ? (
            <span className="chat-panel__process-summary"> · {summary}</span>
          ) : null}
        </button>
      ) : null}
      {shown ? (
        <div className="chat-panel__process-body">
          {turn.blocks.map((block) => (
            <ProcessBlock
              key={block.id}
              block={block}
              turn={turn}
              capabilities={capabilities}
            />
          ))}
          {running && turn.blocks.length === 0 && !turn.answer ? (
            <p className="chat-panel__thinking muted">Thinking…</p>
          ) : null}
          {running ? <LiveStatus turn={turn} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ProcessBlock({
  block,
  turn,
  capabilities,
}: {
  block: TurnBlock;
  turn: TurnRecord;
  capabilities: HarnessTurnCapabilities;
}) {
  switch (block.kind) {
    case "tools":
      // A descriptor that says the harness cannot produce rows gets no rows;
      // the frames may still arrive, and the renderer simply does not claim
      // evidence it cannot honour.
      if (!capabilities.toolRows) return null;
      return (
        <ToolRunGroup
          calls={block.calls}
          live={turn.status === "running"}
          settled={turn.settled}
          capabilities={capabilities}
        />
      );
    case "reasoning":
      return (
        <ReasoningRow
          text={block.text}
          streaming={turn.status === "running"}
          capabilities={capabilities}
        />
      );
    case "commentary":
      return (
        <p className="chat-panel__process-commentary" data-testid="commentary">
          {block.text}
        </p>
      );
    case "text":
      return (
        <p className="chat-panel__process-narration" data-testid="narration">
          {block.text}
        </p>
      );
  }
}

/**
 * Thinking is one row, expanded on demand. Hermes can only sample a lossy
 * preview of it, so the row says "preview" rather than claiming a stream; a
 * harness with no reasoning at all renders no row (the descriptor, not the
 * presence of a frame, decides).
 */
function ReasoningRow({
  text,
  streaming,
  capabilities,
}: {
  text: string;
  streaming: boolean;
  capabilities: HarnessTurnCapabilities;
}) {
  if (capabilities.reasoning === "none") return null;
  const preview = firstLine(text);
  const label = capabilities.reasoning === "preview" ? "Thinking preview" : "Thought";
  return (
    <details
      className="chat-panel__reasoning"
      data-testid="reasoning-row"
      data-reasoning-fidelity={capabilities.reasoning}
      data-reasoning-streaming={streaming || undefined}
    >
      <summary className="chat-panel__reasoning-summary">
        <span className="chat-panel__reasoning-label">{label}</span>
        {preview ? (
          <span className="chat-panel__reasoning-preview"> · {preview}</span>
        ) : null}
      </summary>
      <p className="chat-panel__reasoning-body">{text}</p>
    </details>
  );
}

/** One line of thinking: enough to see what it is about, not the whole trace. */
function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((row) => row.replace(/\s+/g, " ").trim())
    .find((row) => row.length > 0);
  if (!line) return "";
  return line.length > 96 ? `${line.slice(0, 95)}…` : line;
}

/**
 * While a turn runs: how long, and what it is doing now.
 *
 * The clock is the app's own receipt time, ticked once a second — no harness
 * reports live elapsed. The ticker is deliberately coarse: a smoothly animating
 * number would claim a precision the app does not have, and repainting the
 * whole timeline 60 times a second to show milliseconds is not a feature.
 */
function LiveStatus({ turn }: { turn: TurnRecord }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, now - turn.startedAt);
  const activity = currentActivity(turn);
  return (
    <p className="chat-panel__process-status" data-testid="turn-status">
      <span className="chat-panel__process-status-time">
        Working… {formatDuration(elapsed)}
      </span>
      {activity ? (
        <span className="chat-panel__process-status-activity"> · {activity}</span>
      ) : null}
    </p>
  );
}
