import { useEffect, useState } from "react";
import { useVault } from "@/state/VaultProvider";
import { api } from "@/lib/ipc";
import type { MapCommand } from "@lifequest/vault-core/map";

export function SettingsAbout() {
  const { snapshot, refresh } = useVault();
  const aboutMe = snapshot?.map?.aboutMe ?? "";
  const [text, setText] = useState(aboutMe);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setText(aboutMe);
  }, [aboutMe]);

  async function onSave() {
    setSaving(true);
    const command: MapCommand = { type: "setAboutMe", text };
    const result = await api().mapApply(command);
    setSaving(false);
    if (result.ok) {
      await refresh();
      setSavedAt(Date.now());
    }
  }

  return (
    <div className="settings-about">
      <h3 className="settings-about__title">About me</h3>
      <p className="muted settings-about__hint">
        Agents treat this as lifestyle context. They cannot edit it while Agent
        locked is on.
      </p>
      <label className="field">
        <span>Lifestyle context</span>
        <textarea
          className="settings-about__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Who you are, constraints, rhythms, preferences…"
        />
      </label>
      <div className="settings-about__actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onSave()}
          disabled={saving || text === aboutMe}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedAt ? (
          <span className="muted settings-about__saved">Saved.</span>
        ) : null}
      </div>
    </div>
  );
}
