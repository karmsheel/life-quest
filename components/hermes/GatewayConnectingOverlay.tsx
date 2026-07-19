"use client";

import { useEffect, useRef, useState } from "react";

// Mirrors Hermes Agent Desktop (`gateway-connecting-overlay.tsx`):
// monospace CONNECTING decode + blink cursor, then fade out on success.

const PREFIX = "CONN";
const TAIL = "ECTING";
const SCRAMBLE_CHARS = "/\\|-_=+<>~:*";
const TICK_MS = 45;
const TEXT_OUT_MS = 360;
const POST_TEXT_HOLD_MS = 300;
const OVERLAY_OUT_MS = 520;

type Phase = "live" | "text-out" | "overlay-out" | "gone";

function scrambledTail(resolvedCount: number): string {
  return Array.from(TAIL, (ch, i) =>
    i < resolvedCount ? ch : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0],
  ).join("");
}

interface GatewayConnectingOverlayProps {
  leaving?: boolean;
  onExitComplete?: () => void;
}

export function GatewayConnectingOverlay({
  leaving = false,
  onExitComplete,
}: GatewayConnectingOverlayProps) {
  const [tail, setTail] = useState(TAIL);
  const [phase, setPhase] = useState<Phase>("live");
  const onExitCompleteRef = useRef(onExitComplete);

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  useEffect(() => {
    if (leaving && phase === "live") {
      setTail(TAIL);
      setPhase("text-out");
    }
  }, [leaving, phase]);

  useEffect(() => {
    if (phase !== "live") return;

    let resolved = 0;
    let hold = 0;

    const id = window.setInterval(() => {
      if (resolved >= TAIL.length) {
        hold += 1;
        if (hold > 16) {
          resolved = 0;
          hold = 0;
        }
        setTail(TAIL);
        return;
      }

      resolved += 0.5;
      setTail(scrambledTail(Math.floor(resolved)));
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "text-out") {
      const id = window.setTimeout(
        () => setPhase("overlay-out"),
        TEXT_OUT_MS + POST_TEXT_HOLD_MS,
      );
      return () => window.clearTimeout(id);
    }

    if (phase === "overlay-out") {
      const id = window.setTimeout(() => {
        setPhase("gone");
        onExitCompleteRef.current?.();
      }, OVERLAY_OUT_MS);
      return () => window.clearTimeout(id);
    }
  }, [phase]);

  if (phase === "gone") {
    return null;
  }

  const overlayHidden = phase === "overlay-out";
  const textLeaving = phase !== "live";

  return (
    <div
      className={`hermes-connecting${overlayHidden ? " hermes-connecting--hidden" : ""}`}
    >
      <span
        className={`hermes-connecting__text${textLeaving ? " hermes-connecting__text--leaving" : ""}`}
      >
        {PREFIX}
        {tail}
        <span aria-hidden="true" className="hermes-connecting__cursor" />
      </span>
    </div>
  );
}
