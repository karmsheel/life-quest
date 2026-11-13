import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsFact } from "@/components/ui/SettingsFact";
import { PiEndpointForm } from "@/components/settings/PiEndpointForm";
import { SettingsAgents } from "@/components/settings/SettingsAgents";
import { SettingsVaultAgents } from "@/components/settings/SettingsVaultAgents";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { Toggle } from "@/components/ui/Toggle";
import { api } from "@/lib/ipc";
import { companionStatusSummary } from "@/lib/companion-status-copy";
import { useCompanion } from "@/state/CompanionProvider";
import { useVault } from "@/state/VaultProvider";
import type { McpDoors } from "@/vite-env";

/** The loopback doors' default ports, shown while the door is not bound yet. */
const LOCAL_DOOR = "http://127.0.0.1:8643/mcp";
const INVITE_DOOR = "http://127.0.0.1:8646/mcp";

/** KAR-70: no vault open means no door, and no error to report. */
const NO_VAULT: McpDoors = {
  localUrl: "",
  inviteUrl: "",
  localError: null,
  inviteError: null,
};

export function SettingsHermes() {
  const { snapshot } = useVault();
  const { status, ensuring, retry, harness } = useCompanion();
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
    <SettingsSection
      icon={<Sparkles size={16} />}
      title="Hermes"
      subtitle="The companion and the agents this vault runs on"
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
      {/*
        MCP doors first: they are the two addresses every other agent on this
        machine needs in order to reach the vault, and the thing an operator
        comes to this page to copy. They used to sit under the old app-level
        agent picker, below the fold on a normal window — local plumbing at the
        end of the page. The block opts out of page-context capture: the doors
        are local plumbing, not content for a model turn.
      */}
      <section
        className="settings-hermes__block"
        data-page-context="ignore"
        data-testid="hermes-doors"
      >
        <h3 className="settings-hermes__heading">MCP doors</h3>
        <div className="settings-facts">
          <SettingsFact
            label="Local"
            value={doors.localUrl || LOCAL_DOOR}
            error={doors.localError}
            status
          />
          <SettingsFact
            label="Invite"
            value={doors.inviteUrl || INVITE_DOOR}
            error={doors.inviteError}
            status
          />
        </div>
        {!snapshot ? (
          <p className="settings-hermes__note muted" role="status">
            MCP doors are closed — open a vault to expose the Life Map store.
          </p>
        ) : null}
      </section>

      <section className="settings-hermes__block" data-testid="hermes-connection">
        <h3 className="settings-hermes__heading">Connection</h3>
        <p
          className={
            probeOk
              ? "settings-hermes__probe settings-hermes__probe--ok"
              : "settings-hermes__probe settings-hermes__probe--fail"
          }
          role="status"
        >
          {companionStatusSummary(status, ensuring)}
        </p>

        {status?.kind === "ready" && status.modelWarning ? (
          <p className="settings-hermes__probe settings-hermes__probe--fail" role="alert">
            {status.modelWarning}
          </p>
        ) : null}

        {ready && harness !== "pi" ? (
          <div className="settings-facts" data-testid="hermes-facts">
            <SettingsFact label="CLI" value={ready.cliPath ?? ""} />
            <SettingsFact label="Profile" value={ready.profilePath ?? ""} />
            <SettingsFact label="API" value={ready.baseUrl ?? ""} />
          </div>
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
          {harness === "pi" ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={!ready}
              onClick={() => void api().companionOpenProfileFolder()}
            >
              Open profile folder
            </Button>
          )}
        </div>
      </section>

      {/*
        The vault's agent choice lives in one section now: a vault is the
        profile that is loaded, so its companion is part of the vault, not an
        app-wide setting. The dock's switcher shows the same binding as pills.
      */}
      <SettingsVaultAgents />

      <SettingsAgents />

      {harness === "pi" ? (
        <section className="settings-hermes__block" data-testid="pi-endpoint">
          <h3 className="settings-hermes__heading">Built-in endpoint</h3>
          <PiEndpointForm disabled={ensuring} />
        </section>
      ) : null}

      <section className="settings-hermes__block" data-testid="hermes-behaviour">
        <h3 className="settings-hermes__heading">Chat behaviour</h3>
        <div className="settings-hermes__rows">
          <SettingsRow
            className="settings-hermes__row"
            label="File implied changes"
            description="When a chat proposes a doctrine, library, goal, or day-template change, file one pending Decision. The vault changes only when you approve it."
            action={
              <Toggle
                checked={fileImplied}
                onChange={(next) => void onToggleFileImplied(next)}
                label="File implied changes"
              />
            }
          />
          {/* The insert allowlist is gone: adding database data is no longer
              gated at all (operator policy, 2026-10-28). This row says what the
              companion does now, so the one place that used to configure the old
              behaviour explains the new one instead of leaving a dead control. */}
          <SettingsRow
            className="settings-hermes__row"
            label="Database writes"
            description="A new database, a new row, or a batch of new rows is written as soon as you agree to it in the chat. Changing or deleting data that already exists still waits for your approval in Decisions."
          />
        </div>
      </section>
    </SettingsSection>
  );
}
