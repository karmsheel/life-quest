import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";
import { formatToolDuration, type ToolCallRecord } from "@/lib/turn-timeline";
import { summarizeToolRun, toolRowLabel } from "@/lib/tool-run";
import type { HarnessTurnCapabilities } from "@/vite-env";

/**
 * One contiguous run of tool calls inside a turn's process.
 *
 * This keeps the transcript's original tool-run block, on purpose: the DOM
 * contract (`.chat-panel__activity`, a `.chat-panel__activity-line` button with
 * `aria-expanded`, a `.chat-panel__activity-list` of `.chat-panel__activity-row`
 * whose text is exactly `name · target`) is what the dock's existing rigs
 * measure — including the capped, self-scrolling list and the pixel-level row
 * geometry. What is new is only additive: status/duration attributes and the
 * row's own args/result disclosure, which exist in the DOM without adding text
 * to the row and without adding height until the operator opens one.
 */
export function ToolRunGroup({
  calls,
  live,
  settled,
  capabilities,
}: {
  calls: readonly ToolCallRecord[];
  /** The turn is still running: present tense, and the newest call is the ticker. */
  live: boolean;
  /** The turn has settled: snapshot results may be disclosed now. */
  settled: boolean;
  capabilities: HarnessTurnCapabilities;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLUListElement | null>(null);

  // The block scrolls its own overflow, so it follows the newest row itself:
  // opening the transcript's stick-to-bottom pass must not drag the capped list.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !open) return;
    list.scrollTop = list.scrollHeight;
  }, [calls, open]);

  const wireCalls = calls.map((call) => ({
    id: call.id,
    name: call.name,
    target: call.target,
    // `summarizeToolRun` only needs to know whether a call is still narrating.
    done: call.status !== "running",
  }));
  const line = summarizeToolRun(wireCalls, live);

  return (
    <div className="chat-panel__activity" data-testid="tool-run">
      <button
        type="button"
        className="chat-panel__activity-line"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          size={12}
          aria-hidden
          className={
            open
              ? "chat-panel__activity-caret chat-panel__activity-caret--open"
              : "chat-panel__activity-caret"
          }
        />
        <span>{line}</span>
      </button>
      {open ? (
        <ul className="chat-panel__activity-list" ref={listRef}>
          {calls.map((call) => (
            <ToolRow
              key={call.id}
              call={call}
              expanded={expanded[call.id] === true}
              onToggle={() =>
                setExpanded((current) => ({
                  ...current,
                  [call.id]: !current[call.id],
                }))
              }
              settled={settled}
              capabilities={capabilities}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One call: verb + target on a single line, with the status and duration drawn
 * by the stylesheet from data attributes.
 *
 * The spinner/check/! and the duration have to be pseudo-elements, never text
 * children: the row's `textContent` is the call's identity, byte for byte, in
 * every rig and in the operator's own copy of the transcript.
 */
function ToolRow({
  call,
  expanded,
  onToggle,
  settled,
  capabilities,
}: {
  call: ToolCallRecord;
  expanded: boolean;
  onToggle: () => void;
  settled: boolean;
  capabilities: HarnessTurnCapabilities;
}) {
  const showArgs = capabilities.toolArgs && call.args !== undefined;
  // Live results only when the harness streams them; a settled snapshot may
  // fill a result the live stream never had (Hermes).
  const showResult =
    call.resultPreview !== undefined &&
    (capabilities.toolResultsLive ||
      (settled && capabilities.toolResultsOnSettle));
  const hasDetail = showArgs || showResult;
  const duration =
    call.durationMs === undefined ? null : formatToolDuration(call.durationMs);
  const approximate = call.durationSource === "app";
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!hasDetail) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggle();
  };

  return (
    <li className="chat-panel__activity-item">
      <div
        className="chat-panel__activity-row"
        data-testid="tool-call"
        data-tool-status={call.status}
        data-tool-duration-ms={call.durationMs}
        data-tool-duration-source={call.durationSource}
        data-tool-duration={duration ?? undefined}
        data-tool-expanded={hasDetail ? expanded : undefined}
        data-tool-settled={settled || undefined}
        role={hasDetail ? "button" : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        title={
          duration
            ? approximate
              ? `${duration} — measured by the app (approximate)`
              : `${duration} — reported by the harness`
            : undefined
        }
        aria-expanded={hasDetail ? expanded : undefined}
        onClick={hasDetail ? onToggle : undefined}
        onKeyDown={onKeyDown}
      >
        {toolRowLabel({ id: call.id, name: call.name, target: call.target, done: call.status !== "running" })}
      </div>
      {showArgs ? (
        <pre
          className="chat-panel__activity-detail chat-panel__activity-detail--args"
          data-testid="tool-args"
          hidden={!expanded}
        >
          {formatArgs(call.args)}
        </pre>
      ) : null}
      {showResult ? (
        <pre
          className="chat-panel__activity-detail chat-panel__activity-detail--result"
          data-testid="tool-result"
          data-tool-error={call.status === "failed" || undefined}
          hidden={!expanded}
        >
          {call.resultPreview}
        </pre>
      ) : null}
    </li>
  );
}

/** Arguments as the operator can read them: an object is pretty-printed, a
 *  string is already the sentence the model wrote. */
function formatArgs(args: unknown): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
