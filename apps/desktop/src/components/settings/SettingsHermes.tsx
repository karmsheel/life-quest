import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { api } from "@/lib/ipc";
import { useCompanion } from "@/state/CompanionProvider";
import { useVault } from "@/state/VaultProvider";
import type { CompanionStatus, McpDoors } from "@/vite-env";

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

/** KAR-70: no vault open means no door, and no error to report. */
const NO_VAULT: McpDoors = {
  localUrl: "",
  inviteUrl: "",
  localError: null,
  inviteError: null,
};

export function SettingsHermes() {
  const { snapshot } = useVault();
  const { status, ensuring, retry } = useCompanion();
  const [doors, setDoors] = useState<McpDoors>(NO_VAULT);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fileImplied, setFileImplied] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void api()
      .companionGetFiling()
      .then((value) => {
        if (!cancelled) setFileImplied(value);
      })
      .catch(() => {
        if (!cancelled) setFileImplied(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggleFileImplied(next: boolean) {
    setFileImplied(next);
    try {
      await api().companionSetFiling(next);
    } catch (err) {
      setFileImplied(!next);
      setError(err instanceof Error ? err.message : "Could not save filing preference");
    }
  }

  // KAR-70: both doors, each with its own bind error. A vault switch
  // rebinds them, so this is re-read whenever the open vault changes.
  useEffect(() => {
    if (!snapshot) {
      setDoors(NO_VAULT);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const value = await api().mcpGetDoors();
        if (!cancelled) setDoors(value);
      } catch {
        if (!cancelled) setDoors(NO_VAULT);
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

        <SettingsRow
          label="File implied changes"
          description="When a chat proposes a doctrine, library, goal, or day-template change, file one pending Decision. The vault changes only when you approve it."
          action={
            <input
              type="checkbox"
              aria-label="File implied changes"
              checked={fileImplied}
              onChange={(e) => void onToggleFileImplied(e.target.checked)}
            />
          }
        />

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
      {/* KAR-70: the two loopback doors. Each keeps its own bind error, so a
          taken port takes down one row and not the other url. */}
      <div className="settings-card">
        <h3 className="settings-panel__section-title">MCP doors</h3>
        <dl className="settings-hermes">
          <div className="settings-field">
            <span>Local</span>
            <p className="muted" role="status">
              {doors.localUrl || "http://127.0.0.1:8643/mcp"}
            </p>
            {doors.localError ? (
              <p className="form-error" role="alert">
                {doors.localError}
              </p>
            ) : null}
          </div>
          <div className="settings-field">
            <span>Invite</span>
            <p className="muted" role="status">
              {doors.inviteUrl || "http://127.0.0.1:8646/mcp"}
            </p>
            {doors.inviteError ? (
              <p className="form-error" role="alert">
                {doors.inviteError}
              </p>
            ) : null}
          </div>
        </dl>
        {!snapshot ? (
          <p className="settings-hermes__probe muted" role="status">
            MCP doors are closed — open a vault to expose the Life Map store.
          </p>
        ) : null}
      </div>
    </>
  );
}
