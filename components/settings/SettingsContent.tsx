"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { DEFAULT_HERMES_URL } from "@/lib/constants.ts";

type HermesConfig = {
  baseUrl: string;
  apiKey: string;
  hasApiKey: boolean;
};

type HermesProbe = {
  ok: boolean;
  baseUrl: string;
  latencyMs: number;
  error?: string;
  status?: number;
};

export function SettingsContent() {
  const { theme, setTheme } = useTheme();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_HERMES_URL);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<HermesProbe | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/hermes", {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as HermesConfig & {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to load Hermes settings");
        return;
      }
      setBaseUrl(data.baseUrl || DEFAULT_HERMES_URL);
      setHasApiKey(Boolean(data.hasApiKey));
      // Masked keys stay blank in the form so Save does not overwrite with "***".
      setApiKey("");
    } catch {
      setError("Network error loading settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    setProbe(null);
    try {
      const body: { baseUrl: string; apiKey?: string } = {
        baseUrl: baseUrl.trim() || DEFAULT_HERMES_URL,
      };
      // Only send apiKey when the user typed a new value (or cleared).
      if (apiKey !== "") {
        body.apiKey = apiKey;
      }

      const res = await fetch("/api/settings/hermes", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as HermesConfig & {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to save settings");
        return;
      }
      setBaseUrl(data.baseUrl || DEFAULT_HERMES_URL);
      setHasApiKey(Boolean(data.hasApiKey));
      setApiKey("");
      setMessage("Hermes settings saved.");
    } catch {
      setError("Network error saving settings");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setError(null);
    setMessage(null);
    setProbe(null);
    try {
      // Prefer dedicated status probe; fall back is unnecessary if route exists.
      const res = await fetch("/api/hermes/status", {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        baseUrl?: string;
        latencyMs?: number;
        error?: string;
        status?: number;
      };

      if (!res.ok && data.ok === undefined) {
        setError(data.error ?? "Connection test failed");
        return;
      }

      const result: HermesProbe = {
        ok: Boolean(data.ok),
        baseUrl: data.baseUrl ?? baseUrl,
        latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : 0,
        error: data.error,
        status: data.status,
      };
      setProbe(result);
      setMessage(
        result.ok
          ? `Connected to Hermes (${result.latencyMs}ms).`
          : result.error ?? "Hermes is unreachable.",
      );
    } catch {
      setError("Network error testing connection");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings-content">
      <header className="settings-content__header">
        <h1 className="stub-page__title">Settings</h1>
        <p className="stub-page__desc muted">
          Appearance, Hermes connection, and about LifeQuest.
        </p>
      </header>

      {error ? (
        <p className="doc-editor__error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className={
            probe && !probe.ok
              ? "doc-editor__error"
              : "doc-editor__message"
          }
          role="status"
        >
          {message}
        </p>
      ) : null}

      <section className="settings-section">
        <h2 className="settings-section__title">Appearance</h2>
        <div className="settings-theme">
          <button
            type="button"
            className={
              theme === "light"
                ? "settings-theme__btn settings-theme__btn--active"
                : "settings-theme__btn"
            }
            onClick={() => setTheme("light")}
          >
            Light
          </button>
          <button
            type="button"
            className={
              theme === "dark"
                ? "settings-theme__btn settings-theme__btn--active"
                : "settings-theme__btn"
            }
            onClick={() => setTheme("dark")}
          >
            Dark
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Hermes</h2>
        {loading ? (
          <p className="muted">Loading connection settings…</p>
        ) : (
          <form className="settings-hermes" onSubmit={(e) => void onSave(e)}>
            <label className="settings-field">
              <span>Base URL</span>
              <input
                type="url"
                name="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={DEFAULT_HERMES_URL}
                autoComplete="off"
                required
              />
            </label>
            <label className="settings-field">
              <span>
                API key
                {hasApiKey ? (
                  <span className="muted"> (saved — leave blank to keep)</span>
                ) : null}
              </span>
              <input
                type="password"
                name="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasApiKey ? "••••••••" : "Optional"}
                autoComplete="off"
              />
            </label>
            <div className="settings-hermes__actions">
              <button
                type="submit"
                className="doc-btn doc-btn--primary"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="doc-btn"
                disabled={testing}
                onClick={() => void onTest()}
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
            </div>
            {probe ? (
              <p
                className={
                  probe.ok
                    ? "settings-hermes__probe settings-hermes__probe--ok"
                    : "settings-hermes__probe settings-hermes__probe--fail"
                }
              >
                {probe.ok
                  ? `OK · ${probe.baseUrl} · ${probe.latencyMs}ms`
                  : `Failed · ${probe.baseUrl}${probe.error ? ` · ${probe.error}` : ""}`}
              </p>
            ) : null}
          </form>
        )}
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">About</h2>
        <p className="settings-about muted">
          LifeQuest <strong>0.1.0</strong> — skeleton shell for Why → What → How
          life design with Hermes agents.
        </p>
      </section>
    </div>
  );
}
