import { Check, Copy, ImagePlus } from "lucide-react";
import { formatMessageWhen } from "../../../../electron/companion-client.ts";
import {
  hasWorkLog,
  type TurnRecord,
  type TurnUser,
} from "@/lib/turn-timeline";
import type { HarnessTurnCapabilities } from "@/vite-env";
import { TurnFooter } from "./TurnFooter";
import { TurnProcess } from "./TurnProcess";

/** Bytes as the chip says them: 287 B, 41 KB, 1.2 MB. */
function formatReceiptSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type TurnCopyState = { id: string; ok: boolean } | null;

/**
 * The dock's thread, turn by turn.
 *
 * Each turn is the same shape in both directions — the operator's words, the
 * work the agent did, the agent's reply, and a quiet outcome line — so a live
 * turn and a reloaded one read the same. The reply is never inside the process
 * disclosure: folding the work must never fold the answer.
 */
export function TurnTimeline({
  turns,
  capabilities,
  companionName,
  latestTurnId,
  copied,
  onCopy,
  onToggleFold,
}: {
  turns: readonly TurnRecord[];
  capabilities: HarnessTurnCapabilities;
  companionName: string;
  /** The newest turn's id: only its notes wear the legacy status-line class. */
  latestTurnId: string | null;
  copied: TurnCopyState;
  onCopy: (bubbleId: string, content: string, label: string) => void;
  onToggleFold: (turnId: string, open: boolean) => void;
}) {
  return (
    <>
      {turns.map((turn) => {
        const latest = turn.turnId === latestTurnId;
        const open =
          turn.foldOpen ??
          !(turn.settled && turn.status === "completed" && hasWorkLog(turn));
        return (
          <div
            key={turn.turnId}
            className="chat-panel__turn"
            data-testid="turn"
            data-turn-id={turn.turnId}
            data-turn-status={turn.status}
          >
            {turn.user ? (
              <TurnBubble
                id={`${turn.turnId}:user`}
                role="user"
                content={turn.user.text}
                at={turn.user.at ?? turn.startedAt}
                receipt={turn.user.receipt}
                steer={turn.user.steer === true}
                companionName={companionName}
                copied={copied}
                onCopy={onCopy}
              />
            ) : null}
            {(turn.steers ?? []).map((steer, index) => (
              <TurnBubble
                key={`${turn.turnId}:steer:${index}`}
                id={`${turn.turnId}:steer:${index}`}
                role="user"
                content={steer.text}
                at={steer.at}
                steer
                companionName={companionName}
                copied={copied}
                onCopy={onCopy}
              />
            ))}
            <TurnProcess
              turn={turn}
              open={open}
              capabilities={capabilities}
              onToggleFold={(next) => onToggleFold(turn.turnId, next)}
            />
            {turn.answer ? (
              <TurnBubble
                id={`${turn.turnId}:answer`}
                role="assistant"
                content={turn.answer}
                at={turn.answerAt ?? turn.endedAt}
                companionName={companionName}
                copied={copied}
                onCopy={onCopy}
              />
            ) : null}
            <TurnFooter turn={turn} capabilities={capabilities} latest={latest} />
          </div>
        );
      })}
    </>
  );
}

/**
 * One bubble. Markup is the dock's own from before the timeline — the same
 * classes, role line, stamp and copy control — because the thread's look is not
 * what this change is about, and the panel's existing rigs measure it.
 */
function TurnBubble({
  id,
  role,
  content,
  at,
  receipt,
  steer,
  companionName,
  copied,
  onCopy,
}: {
  id: string;
  role: "user" | "assistant";
  content: string;
  at?: number;
  receipt?: TurnUser["receipt"];
  steer?: boolean;
  companionName: string;
  copied: TurnCopyState;
  onCopy: (bubbleId: string, content: string, label: string) => void;
}) {
  const copyOk = copied?.id === id && copied.ok;
  const copyFailed = copied?.id === id && !copied.ok;
  const copyLabel = copyOk ? "Copied" : copyFailed ? "Copy failed" : "Copy message";
  // A row with no harness timestamp has no stamp: `formatMessageWhen(0)` would
  // print 1970, which is a time the turn was certainly not sent.
  const stampedAt = at !== undefined && at > 0 ? at : undefined;
  const when = formatMessageWhen(stampedAt);
  const copy = content || receipt?.name || "";
  return (
    <div
      className={`chat-panel__message chat-panel__message--${role}`}
      data-testid={role === "user" ? "turn-user" : "turn-answer"}
    >
      <span className="chat-panel__message-role">
        {role === "user" ? "You" : companionName}
        {steer ? (
          <span
            className="chat-panel__message-steer"
            data-testid="chat-steer-bubble"
            title="Steered into the turn that was running"
          >
            steered
          </span>
        ) : null}
      </span>
      <div className="chat-panel__message-content">
        {receipt ? (
          <span className="chat-panel__message-receipt">
            <ImagePlus size={12} aria-hidden />
            {receipt.name}
            <span className="chat-panel__receipt-size">
              {formatReceiptSize(receipt.size)}
            </span>
          </span>
        ) : null}
        {content}
      </div>
      <div className="chat-panel__message-meta">
        {when ? (
          <time
            className="chat-panel__message-time"
            dateTime={new Date(stampedAt ?? 0).toISOString()}
            title={new Date(stampedAt ?? 0).toLocaleString()}
          >
            {when}
          </time>
        ) : null}
        <button
          type="button"
          className="chat-panel__message-copy"
          data-copy-state={copyOk ? "copied" : copyFailed ? "failed" : "idle"}
          aria-label={`${copyLabel} (${role === "user" ? "your message" : companionName})`}
          title={copyLabel}
          onClick={() => onCopy(id, copy, copyLabel)}
        >
          {copyOk ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
