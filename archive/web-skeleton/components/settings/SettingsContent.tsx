"use client";

import { FormEvent, useEffect, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useHermesConnection } from "@/components/hermes/HermesConnectionProvider";
import {
  defaultHermesConfig,
  loadHermesConfig,
  saveHermesConfig,
} from "@/lib/hermes-storage.ts";
import type { HermesConfig } from "@/lib/hermes-types.ts";

function statusLabel(state: string): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "testing":
      return "Testing…";
    case "discovering":
      return "Discovering…";
    case "error":
      return "Error";
    case "idle":
    default:
      return "Idle";
  }
}

export function SettingsContent() {
  const { theme, setTheme } = useTheme();
  const hermes = useHermesConnection();
  const defaults = defaultHermesConfig();

  const [baseUrl, setBaseUrl] = useState(defaults.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadHermesConfig() ?? hermes.config ?? defaultHermesConfig();
    setBaseUrl(saved.baseUrl || defaults.baseUrl);
    setApiKey(saved.apiKey || "");
    setModel(saved.model || hermes.selectedModel || "");
    setHydrated(true);
    // Mount-only hydrate from localStorage (primary) / provider (fallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional once
  }, []);

  function formConfig(): HermesConfig {
    const next: HermesConfig = {
      baseUrl: baseUrl.trim() || defaults.baseUrl,
      apiKey: apiKey.trim(),
    };
    const trimmedModel = model.trim();
    if (trimmedModel) next.model = trimmedModel;
    return next;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const config = formConfig();
      // Always persist localStorage first so chat/send picks up the new config.
      saveHermesConfig(config);

      if (config.apiKey) {
        const ok = await hermes.saveConnection(config);
        if (ok) {
          setMessage("Hermes settings saved and connected.");
        } else {
          setMessage("Saved locally; connection test failed.");
          setError("Connection test failed after save.");
        }
      } else {
        setMessage(
          "Hermes settings saved (no API key — connection not tested).",
        );
      }
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const config = formConfig();
      if (!config.baseUrl || !config.apiKey) {
        setError("Enter a base URL and API key to test.");
        return;
      }
      // Persist before probe so chat send (loadHermesConfig) uses this config.
      // Provider may re-save with a resolved model after a successful probe.
      saveHermesConfig(config);
      const ok = await hermes.testConnection(config);
      if (ok) {
        setMessage("Connected to Hermes. Settings saved.");
      } else {
        setError("Hermes is unreachable.");
      }
    } catch {
      setError("Network error testing connection");
    } finally {
      setTesting(false);
    }
  }

  const { status, availableModels, modelsLoading, isConnected, isBusy } =
    hermes;
  const probeOk = status.state === "connected";
  const probeFail = status.state === "error";

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
            probeFail && !message.toLowerCase().includes("saved")
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

        <p
          className={
            probeOk
              ? "settings-hermes__probe settings-hermes__probe--ok"
              : probeFail
                ? "settings-hermes__probe settings-hermes__probe--fail"
                : "settings-hermes__probe muted"
          }
          role="status"
          aria-live="polite"
        >
          {statusLabel(status.state)}
          {status.baseUrl ? ` · ${status.baseUrl}` : null}
          {probeOk && typeof status.latencyMs === "number"
            ? ` · ${status.latencyMs}ms`
            : null}
          {status.model ? ` · ${status.model}` : null}
          {probeFail && status.error ? ` · ${status.error}` : null}
        </p>

        {!hydrated ? (
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
                placeholder={defaults.baseUrl}
                autoComplete="off"
                required
              />
            </label>
            <label className="settings-field">
              <span>API key</span>
              <input
                type="password"
                name="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Required for connection"
                autoComplete="off"
              />
            </label>
            {availableModels.length > 0 || modelsLoading ? (
              <label className="settings-field">
                <span>Model</span>
                <select
                  name="model"
                  value={model}
                  onChange={(e) => {
                    const next = e.target.value;
                    setModel(next);
                    if (next && isConnected) {
                      hermes.setModel(next);
                    }
                  }}
                  disabled={modelsLoading || availableModels.length === 0}
                >
                  {modelsLoading && availableModels.length === 0 ? (
                    <option value="">Loading models…</option>
                  ) : null}
                  {!model ? <option value="">Default</option> : null}
                  {model &&
                  !availableModels.some((m) => m.id === model) ? (
                    <option value={model}>{model}</option>
                  ) : null}
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label || m.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="settings-field">
                <span>Model (optional)</span>
                <input
                  type="text"
                  name="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Leave blank for gateway default"
                  autoComplete="off"
                />
              </label>
            )}
            <div className="settings-hermes__actions">
              <button
                type="submit"
                className="doc-btn doc-btn--primary"
                disabled={saving || isBusy}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="doc-btn"
                disabled={testing || isBusy}
                onClick={() => void onTest()}
              >
                {testing || status.state === "testing"
                  ? "Testing…"
                  : "Test connection"}
              </button>
            </div>
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
