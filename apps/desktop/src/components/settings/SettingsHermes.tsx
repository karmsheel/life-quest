import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { DatabaseListEntry } from "@lifequest/vault-core";
import { Button } from "@/components/ui/Button";
import { SettingsRow } from "@/components/ui/SettingsRow";
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
  const { snapshot, updateSettings } = useVault();
  const { status, ensuring, retry } = useCompanion();
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpErrorText, setMcpErrorText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [databases, setDatabases] = useState<DatabaseListEntry[] | null>(null);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [listError, setListError] = useState<string | null>(null);

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

  const vaultPath = snapshot?.rootPath ?? null;
  useEffect(() => {
    if (!vaultPath) {
      setDatabases(null);
      setListStatus("loading");
      setListError(null);
      return;
    }
    let cancelled = false;
    setListStatus("loading");
    setListError(null);
    void (async () => {
      try {
        const result = await api().dbList(null);
        if (cancelled) return;
        if (!result.ok) {
          setDatabases(null);
          setListStatus("failed");
          setListError(result.error);
          return;
        }
        setDatabases(result.value);
        setListStatus("ready");
        setListError(null);
      } catch (err) {
        if (!cancelled) {
          setDatabases(null);
          setListStatus("failed");
          setListError(err instanceof Error ? err.message : "Could not list databases");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  async function onToggleInsert(domainSlug: string, databaseId: string, checked: boolean) {
    if (!snapshot) return;
    const current = snapshot.settings.autoApproveInserts ?? [];
    const without = current.filter(
      (pair) => pair.domainSlug !== domainSlug || pair.databaseId !== databaseId,
    );
    const next = checked ? [...without, { domainSlug, databaseId }] : without;
    const result = await updateSettings({ autoApproveInserts: next });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
  }

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
  const allowlist = snapshot?.settings.autoApproveInserts ?? [];
  const liveDomains = (snapshot?.domains ?? [])
    .filter((domain) => domain.meta.archivedAt == null)
    .slice()
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  const groups = liveDomains
    .map((domain) => ({
      domain,
      entries: (databases ?? []).filter((entry) => entry.domainSlug === domain.slug),
    }))
    .filter((group) => group.entries.length > 0);
  const liveKeys = new Set(
    groups.flatMap((group) =>
      group.entries.map((entry) => `${entry.domainSlug}\0${entry.database.id}`),
    ),
  );
  const stalePairs =
    databases == null
      ? []
      : allowlist.filter((pair) => !liveKeys.has(`${pair.domainSlug}\0${pair.databaseId}`));

  return (
    <>
      <SettingsSection
        icon={<Sparkles size={16} />}
        title="Hermes"
        subtitle="LifeQuest companion on the lifequest Hermes profile"
        banner={
          error || listError || message ? (
            <>
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
              {listError ? (
                <p className="form-error" role="alert">
                  {listError}
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
        <div className="settings-hermes">
          <h3 className="settings-panel__section-title">Apply assistant inserts immediately</h3>
          <p className="settings-card__desc">
            New rows the assistant proposes in a checked database are applied immediately. Updates, deletes, and other databases still wait in Decisions.
          </p>
          {snapshot && listStatus === "loading" ? <p className="muted">Loading databases…</p> : null}
          {databases != null && groups.length === 0 && stalePairs.length === 0 ? (
            <p className="muted">No databases in live domains.</p>
          ) : null}
          {groups.map((group) => {
            const domainName = group.domain.meta.name;
            const domainSlug = group.domain.slug;
            return (
              <div key={domainSlug}>
                <h4 className="settings-card__label">{domainName}</h4>
                {group.entries.map((entry) => {
                  const database = entry.database;
                  const listed = allowlist.some(
                    (pair) => pair.domainSlug === domainSlug && pair.databaseId === database.id,
                  );
                  return (
                    <SettingsRow
                      key={database.id}
                      label={database.name}
                      action={
                        <input
                          type="checkbox"
                          aria-label={`Apply assistant inserts immediately: ${domainName} / ${database.name}`}
                          checked={listed}
                          onChange={(e) =>
                            void onToggleInsert(domainSlug, database.id, e.target.checked)
                          }
                        />
                      }
                    />
                  );
                })}
              </div>
            );
          })}
          {stalePairs.map((pair) => (
            <SettingsRow
              key={`${pair.domainSlug}/${pair.databaseId}`}
              label={`${pair.domainSlug} / ${pair.databaseId}`}
              action={
                <input
                  type="checkbox"
                  aria-label={`Apply assistant inserts immediately: ${pair.domainSlug} / ${pair.databaseId}`}
                  checked
                  onChange={(e) => {
                    if (!e.target.checked) {
                      void onToggleInsert(pair.domainSlug, pair.databaseId, false);
                    }
                  }}
                />
              }
            />
          ))}
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
