// The built-in companion's endpoint, as a form.
//
// Used by the gate (a fresh machine has no Hermes, so this is the first thing
// it is asked for) and by Settings (the only place to change it later). One
// component, because two copies of a key field drift — and one of them would
// eventually stop sealing the key.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useCompanion } from "@/state/CompanionProvider";
import { api } from "@/lib/ipc";

export function PiEndpointForm({ disabled = false }: { disabled?: boolean }) {
  const { retry } = useCompanion();
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [providerName, setProviderName] = useState("OpenAI-compatible");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyPersisted, setKeyPersisted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .companionPiSettings()
      .then((settings) => {
        if (cancelled) return;
        setBaseUrl(settings.baseUrl);
        setModel(settings.model);
        setProviderName(settings.providerName);
        setHasKey(settings.hasKey);
        setKeyPersisted(settings.keyPersisted);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setNote(null);
    const typedKey = apiKey.trim();
    try {
      const status = await api().companionPiSettingsSave({
        baseUrl,
        model,
        providerName,
        // An empty field means "keep the key that is already sealed". Clearing
        // is an explicit act, not something a blank field does.
        ...(typedKey ? { apiKey: typedKey } : {}),
      });
      setApiKey("");
      if (typedKey) setHasKey(true);
      const settings = await api().companionPiSettings();
      setKeyPersisted(settings.keyPersisted);
      setNote(
        status.kind === "ready"
          ? "Connected."
          : status.kind === "needs_setup"
            ? `Saved — ${status.message ?? "still not ready"}.`
            : "Saved — the endpoint did not answer yet.",
      );
      await retry();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save the endpoint.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pi-setup">
      <div className="settings-field">
        <label htmlFor="pi-base-url">Endpoint</label>
        <input
          id="pi-base-url"
          type="url"
          value={baseUrl}
          spellCheck={false}
          placeholder="http://localhost:11434/v1"
          onChange={(e) => setBaseUrl(e.target.value)}
          disabled={disabled || busy}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="pi-model">Model</label>
        <input
          id="pi-model"
          type="text"
          value={model}
          spellCheck={false}
          placeholder="qwen2.5-coder:7b"
          onChange={(e) => setModel(e.target.value)}
          disabled={disabled || busy}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="pi-provider">Name</label>
        <input
          id="pi-provider"
          type="text"
          value={providerName}
          onChange={(e) => setProviderName(e.target.value)}
          disabled={disabled || busy}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="pi-key">API key</label>
        <input
          id="pi-key"
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder={hasKey ? "stored — leave blank to keep" : "optional for a local server"}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={disabled || busy}
        />
      </div>
      <p className="muted welcome-detail">
        A local server (Ollama, LM Studio, llama.cpp) needs no key. The key is
        sealed by the OS, never written into the vault.
        {keyPersisted
          ? ""
          : " This machine has no OS keyring, so the key is kept for this session only."}
      </p>
      {note ? <p className="muted welcome-detail">{note}</p> : null}
      <div className="welcome-actions">
        <Button
          type="button"
          variant="primary"
          disabled={disabled || busy || !baseUrl.trim() || !model.trim()}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save and connect"}
        </Button>
      </div>
    </div>
  );
}
