"use client";

import { useEffect } from "react";
import { AlertTriangle, Loader2, RefreshCw, Wrench, X } from "lucide-react";
import { connectionErrorExplanation } from "@/lib/hermes-setup-shared.ts";

interface HermesConnectionErrorModalProps {
  open: boolean;
  onClose: () => void;
  error?: string;
  kind?: string;
  hasApiKey?: boolean | null;
  settingUp: boolean;
  restarting: boolean;
  actionMessage?: string | null;
  onEnableApiServer: () => void;
  onRestartGateway: () => void;
}

export function HermesConnectionErrorModal({
  open,
  onClose,
  error,
  kind,
  hasApiKey,
  settingUp,
  restarting,
  actionMessage,
  onEnableApiServer,
  onRestartGateway,
}: HermesConnectionErrorModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !settingUp && !restarting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open, restarting, settingUp]);

  if (!open) return null;

  const explanation = connectionErrorExplanation(kind, hasApiKey, error);
  const actionBusy = settingUp || restarting;

  return (
    <div className="hermes-error-modal" role="dialog" aria-modal="true" aria-labelledby="hermes-error-title">
      <button
        type="button"
        aria-label="Close connection error dialog"
        onClick={() => {
          if (!actionBusy) onClose();
        }}
        className="hermes-error-modal__backdrop"
      />

      <div className="hermes-error-modal__card">
        <button
          type="button"
          onClick={onClose}
          disabled={actionBusy}
          className="hermes-error-modal__close"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="hermes-error-modal__header">
          <div className="hermes-error-modal__icon" aria-hidden="true">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h2 id="hermes-error-title" className="hermes-error-modal__title">
              Connection error
            </h2>
            <p className="hermes-error-modal__explanation">{explanation}</p>
          </div>
        </div>

        {error && <div className="hermes-error-modal__detail">{error}</div>}

        {actionMessage && (
          <div className="hermes-error-modal__message">{actionMessage}</div>
        )}

        <div className="hermes-error-modal__actions">
          <button
            type="button"
            onClick={onEnableApiServer}
            disabled={actionBusy}
            className="hermes-error-modal__btn hermes-error-modal__btn--primary"
          >
            {settingUp ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Wrench className="w-4 h-4" />
                Enable the API Server
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onRestartGateway}
            disabled={actionBusy}
            className="hermes-error-modal__btn hermes-error-modal__btn--secondary"
          >
            {restarting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Restart Gateway
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
