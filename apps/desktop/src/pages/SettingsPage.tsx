import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type { VaultSettings } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

type Theme = VaultSettings["theme"];

export default function SettingsPage() {
  const { snapshot, refresh } = useVault();

  const [theme, setTheme] = useState<Theme>("system");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [hasKey, setHasKey] = useState(false);

  const [savingSettings, setSavingSettings] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const hydrate = useCallback(async () => {
    if (!snapshot) return;
    setTheme(snapshot.settings.theme);
    setBaseUrl(snapshot.settings.hermesBaseUrl ?? "");
    try {
      const present = await api().secretsHasHermesKey();
      setHasKey(present);
    } catch {
      setHasKey(false);
    }
  }, [snapshot]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  async function saveTheme(next: Theme) {
    setTheme(next);
    setError(null);
    setMessage(null);
    try {
      const result = await api().settingsUpdate({ theme: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Theme set to ${next}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update theme");
    }
  }

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
      // Persist base URL first so the main process uses the form value.
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
    return (
      <div className="settings-page">
        <p className="muted">No vault open.</p>
      </div>
    );
  }

  const { lifequest, rootPath } = snapshot;

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1 className="stub-page__title">Settings</h1>
        <p className="stub-page__desc muted">
          Vault identity, appearance, and Hermes connection.
        </p>
      </header>

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

      <section className="settings-section">
        <h2 className="settings-section__title">Vault</h2>
        <dl className="settings-vault">
          <div>
            <dt className="muted">Name</dt>
            <dd>{lifequest.name}</dd>
          </div>
          <div>
            <dt className="muted">Id</dt>
            <dd className="settings-vault__mono">{lifequest.id}</dd>
          </div>
          <div>
            <dt className="muted">Path</dt>
            <dd className="settings-vault__mono">{rootPath}</dd>
          </div>
        </dl>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Appearance</h2>
        <div className="settings-theme" role="group" aria-label="Theme">
          {(["system", "light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={
                theme === t
                  ? "settings-theme__btn settings-theme__btn--active"
                  : "settings-theme__btn"
              }
              onClick={() => void saveTheme(t)}
            >
              {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Hermes</h2>

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
      </section>
    </div>
  );
}
