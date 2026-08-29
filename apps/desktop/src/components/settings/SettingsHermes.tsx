import { useEffect, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

export function SettingsHermes() {
  const { snapshot, refresh } = useVault();

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null);
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpErrorText, setMcpErrorText] = useState<string | null>(null);

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

  useEffect(() => {
    if (!snapshot) return;
    setBaseUrl(snapshot.settings.hermesBaseUrl ?? "");
  }, [snapshot?.rootPath, snapshot?.settings.hermesBaseUrl]);

  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    void (async () => {
      try {
        const present = await api().secretsHasHermesKey();
        if (!cancelled) setHasKey(present);
      } catch {
        if (!cancelled) setHasKey(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot?.rootPath]);

  async function onSaveHermes(e: FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setError(null);
    setMessage(null);
    setProbe(null);
    try {
      const trimmed = baseUrl.trim();
      const result = await api().settingsUpdate({ hermesBaseUrl: trimmed });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBaseUrl(result.value.hermesBaseUrl);
      setMessage("Hermes base URL saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  async function onSetKey() {
    const key = apiKeyDraft.trim();
    if (!key) {
      setError("Enter an API key to store.");
      return;
    }
    setSavingKey(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api().secretsSetHermesKey(key);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setApiKeyDraft("");
      setHasKey(true);
      setMessage("API key stored securely.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to store API key");
    } finally {
      setSavingKey(false);
    }
  }

  async function onClearKey() {
    setSavingKey(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api().secretsClearHermesKey();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setHasKey(false);
      setApiKeyDraft("");
      setMessage("API key cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear API key");
    } finally {
      setSavingKey(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setError(null);
    setMessage(null);
    setProbe(null);
    try {
      const trimmed = baseUrl.trim();
      if (trimmed !== (snapshot?.settings.hermesBaseUrl ?? "")) {
        const saved = await api().settingsUpdate({ hermesBaseUrl: trimmed });
        if (!saved.ok) {
          setError(saved.error);
          return;
        }
        await refresh();
      }
      if (apiKeyDraft.trim()) {
        const keyResult = await api().secretsSetHermesKey(apiKeyDraft.trim());
        if (!keyResult.ok) {
          setError(keyResult.error);
          return;
        }
        setApiKeyDraft("");
        setHasKey(true);
      }
      const result = await api().hermesTest();
      if (!result.ok) {
        setError(result.error);
        setProbe({ ok: false, text: result.error });
        return;
      }
      const text = `Connected · ${result.value.baseUrl} · ${result.value.latencyMs}ms`;
      setProbe({ ok: true, text });
      setMessage("Hermes connection OK.");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Network error testing connection";
      setError(msg);
      setProbe({ ok: false, text: msg });
    } finally {
      setTesting(false);
    }
  }

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <section>
      <div className="settings-panel__heading">
        <div className="settings-panel__icon">
          <Sparkles size={16} />
        </div>
        <div>
          <h2 className="settings-panel__title">Hermes</h2>
          <p className="settings-panel__subtitle">Local BYOK gateway connection</p>
        </div>
      </div>

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

      <div className="settings-card">
        {probe ? (
          <p
            className={
              probe.ok
                ? "settings-hermes__probe settings-hermes__probe--ok"
                : "settings-hermes__probe settings-hermes__probe--fail"
            }
            role="status"
          >
            {probe.text}
          </p>
        ) : (
          <p className="settings-hermes__probe muted" role="status">
            {hasKey
              ? "API key is stored for this vault."
              : "No API key stored yet."}
          </p>
        )}

        <form className="settings-hermes" onSubmit={(e) => void onSaveHermes(e)}>
          <label className="settings-field">
            <span>Base URL</span>
            <input
              type="url"
              name="baseUrl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:8642"
              autoComplete="off"
            />
          </label>

          <label className="settings-field">
            <span>
              API key{" "}
              <span className="muted">
                ({hasKey ? "stored — enter a new value to replace" : "not stored"})
              </span>
            </span>
            <input
              type="password"
              name="apiKey"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={hasKey ? "•••••••• (unchanged)" : "Enter Hermes API key"}
              autoComplete="off"
            />
          </label>

          <div className="settings-hermes__actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingSettings}
            >
              {savingSettings ? "Saving…" : "Save base URL"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingKey || !apiKeyDraft.trim()}
              onClick={() => void onSetKey()}
            >
              {savingKey ? "…" : hasKey ? "Replace key" : "Store key"}
            </button>
            {hasKey ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={savingKey}
                onClick={() => void onClearKey()}
              >
                Clear key
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={testing}
              onClick={() => void onTest()}
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
          </div>
        </form>
      </div>

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
    </section>
  );
}
