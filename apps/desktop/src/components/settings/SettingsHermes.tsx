import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { api } from "@/lib/ipc";
import { useCompanion } from "@/state/CompanionProvider";
import { useVault } from "@/state/VaultProvider";
import type { CompanionStatus } from "@/vite-env";

function statusSummary(status: CompanionStatus | null, ensuring: boolean): string {
  if (ensuring || !status) return "Connecting…";
  if (status.kind === "ready") {
    const how = status.startedByLifeQuest ? "started by LifeQuest" : "attached";
    return `Ready · ${status.baseUrl} · ${how}`;
  }
  if (status.kind === "needs_install") return "Hermes CLI not found on PATH.";
  if (status.kind === "profile_error") return status.message;
  if (status.kind === "port_busy") return `Port ${status.port} is busy.`;
  if (status.kind === "gateway_exited") return status.stderr || "Gateway exited.";
  if (status.kind === "hermes_too_old") return "Hermes is too old for the Sessions API.";
  if (status.kind === "auth_error") return "Companion API key was rejected.";
  return "Companion disconnected.";
}

export function SettingsHermes() {
  const { snapshot } = useVault();
  const { status, ensuring, retry } = useCompanion();
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpErrorText, setMcpErrorText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    void (async () => {
      try {
        const [url, err] = await Promise.all([
          api().mcpGetUrl(),
          api().mcpGetError(),
        ]);
        if (cancelled) return;
        setMcpUrl(url);
        setMcpErrorText(err);
      } catch {
        if (!cancelled) {
          setMcpUrl("");
          setMcpErrorText(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot?.rootPath]);

  async function onRecheck() {
    setError(null);
    setMessage(null);
    try {
      await retry();
      setMessage("Rechecked companion.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recheck failed");
    }
  }

  const ready = status?.kind === "ready" ? status : null;
  const probeOk = status?.kind === "ready";

  return (
    <>
      <SettingsSection
        icon={<Sparkles size={16} />}
        title="Hermes"
        subtitle="LifeQuest companion on the lifequest Hermes profile"
        banner={
          error || message ? (
            <>
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="form-message" role="status">
                  {message}
                </p>
              ) : null}
            </>
          ) : undefined
        }
      >
        <p
          className={
            probeOk
              ? "settings-hermes__probe settings-hermes__probe--ok"
              : "settings-hermes__probe settings-hermes__probe--fail"
          }
          role="status"
        >
          {statusSummary(status, ensuring)}
        </p>

        {ready ? (
          <dl className="settings-hermes">
            <div className="settings-field">
              <span>CLI</span>
              <p className="muted">{ready.cliPath}</p>
            </div>
            <div className="settings-field">
              <span>Profile</span>
              <p className="muted">{ready.profilePath}</p>
            </div>
            <div className="settings-field">
              <span>API</span>
              <p className="muted">{ready.baseUrl}</p>
            </div>
          </dl>
        ) : null}

        <div className="settings-hermes__actions">
          <Button
            type="button"
            variant="primary"
            disabled={ensuring}
            destructive={false}
            onClick={() => void onRecheck()}
          >
            {ensuring ? "Checking…" : "Recheck"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!ready}
            onClick={() => void api().companionOpenProfileFolder()}
          >
            Open profile folder
          </Button>
        </div>
      </SettingsSection>
      <div className="settings-card">
        <h3 className="settings-panel__section-title">MCP door</h3>
        {mcpErrorText ? (
          <p className="form-error" role="alert">
            {mcpErrorText}
          </p>
        ) : mcpUrl ? (
          <p className="settings-hermes__probe muted" role="status">
            MCP (while a vault is open): {mcpUrl}
          </p>
        ) : (
          <p className="settings-hermes__probe muted" role="status">
            MCP door is closed — open a vault to expose the Life Map store.
          </p>
        )}
      </div>
    </>
  );
}
