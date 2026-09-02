import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/ui/SettingsSection";
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
    <SettingsSection
      icon={<User size={16} />}
      title="About me"
      subtitle="Agents treat this as lifestyle context, not a command surface."
    >
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
        <Button
          variant="primary"
          onClick={() => void onSave()}
          disabled={saving || text === aboutMe}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        {savedAt ? (
          <span className="muted settings-about__saved">Saved.</span>
        ) : null}
      </div>
    </SettingsSection>
  );
}
