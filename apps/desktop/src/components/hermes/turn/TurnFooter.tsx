import {
  formatDuration,
  formatTokens,
  turnDurationMs,
  type TurnRecord,
} from "@/lib/turn-timeline";
import type { HarnessTurnCapabilities } from "@/vite-env";

const STATUS_LABEL: Record<TurnRecord["status"], string> = {
  running: "Working",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
  incomplete: "Ended early",
};

/**
 * The quiet line under a settled turn: how it ended, how long it took, what it
 * cost, and the notes the app filed about it.
 *
 * Nothing here is synthesized. A duration needs both instants observed, usage
 * needs the harness's exact accounting and a descriptor that says it reports
 * it, and a note is written by the reducer from something that actually
 * happened (a stop frame, a filed Decision, a refused approval).
 */
export function TurnFooter({
  turn,
  capabilities,
  latest,
}: {
  turn: TurnRecord;
  capabilities: HarnessTurnCapabilities;
  /**
   * This is the newest turn. Its note stays the dock's live status line
   * (`.chat-panel__turn-note`), which older rigs read; older turns keep only
   * the neutral test-id — a stop message from three turns ago is history, not
   * the current state of the chat.
   */
  latest: boolean;
}) {
  if (!turn.settled || turn.status === "running") return null;

  const duration = turnDurationMs(turn);
  const tokens = capabilities.usage ? formatTokens(turn.usage) : null;

  return (
    <div
      className="chat-panel__turn-footer"
      data-testid="turn-footer"
      data-footer-status={turn.status}
    >
      <p className="chat-panel__turn-footer-line">
        <span className="chat-panel__turn-outcome">{STATUS_LABEL[turn.status]}</span>
        {duration !== undefined ? (
          <span className="chat-panel__turn-duration"> · {formatDuration(duration)}</span>
        ) : null}
        {tokens ? (
          <span className="chat-panel__turn-usage" data-testid="turn-usage" data-total={turn.usage?.total} data-input={turn.usage?.input} data-output={turn.usage?.output}>
            {" "}
            · {tokens} tokens
          </span>
        ) : null}
      </p>
      {turn.notes.map((note, index) => (
        <p
          key={`${note.kind}:${index}`}
          className={latest ? "chat-panel__turn-note" : "chat-panel__turn-remark"}
          role={latest ? "status" : undefined}
          data-testid="turn-note"
          data-note-kind={note.kind}
        >
          {note.text}
        </p>
      ))}
    </div>
  );
}
