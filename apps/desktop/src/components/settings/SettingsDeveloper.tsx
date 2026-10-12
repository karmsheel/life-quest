import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useUpdate } from "@/state/UpdateProvider";

/**
 * Developer: the switches that make a shipping app show something it otherwise
 * only shows when the outside world cooperates.
 *
 * There is exactly one, and it exists because the update affordance is the one
 * thing in the studio you cannot look at on demand: it appears when GitHub
 * publishes a newer release, and not before. Testing the glow used to mean
 * cutting a release and installing the old build.
 *
 * What the switch does *not* do is lie to the rest of the app. The preview is
 * drawn by the rail and the popup only, from a decision that carries no
 * installer, so nothing can be downloaded from it; Settings → Updates still
 * reports what the feed actually said; and a real release always outranks the
 * preview, so the switch can never hide an upgrade that really exists.
 */
export function SettingsDeveloper() {
  const { preview, setPreview, previewing, decision, current } = useUpdate();
  const [justChanged, setJustChanged] = useState(false);

  const offered = decision?.state === "available" ? decision.latest : null;

  return (
    <SettingsSection
      icon={<FlaskConical size={16} />}
      title="Developer"
      subtitle="Switches that show what the app normally waits for"
    >
      <SettingsRow
        label="Preview the update badge"
        description="Makes the build number at the foot of the rail glow, and opens the upgrade popup from it, as if a newer LifeQuest had been published. Nothing is downloaded: the preview carries no installer, so the popup offers the release page instead. It stays on until you turn it back off, and a real release always wins over it."
        action={
          <input
            type="checkbox"
            aria-label="Preview the update badge"
            data-developer-preview={preview ? "on" : "off"}
            checked={preview}
            onChange={(event) => {
              setPreview(event.target.checked);
              setJustChanged(true);
            }}
          />
        }
      />

      <p className="settings-card__desc" role="status" data-developer-state={previewing ? "previewing" : preview ? "shadowed" : "off"}>
        {previewing ? (
          <>
            The rail is glowing from the preview: it is showing{" "}
            <strong>v9.9.9</strong>, a version that does not exist. Turn the
            switch off to go back to <strong>v{current}</strong> and whatever
            GitHub really said.
          </>
        ) : preview ? (
          <>
            The preview is on, but it is not the one being shown: the feed is
            offering <strong>v{offered}</strong>, and a real release outranks the
            preview. Turn the switch off once you have seen it.
          </>
        ) : justChanged ? (
          <>The preview is off. The rail is back to what the feed says.</>
        ) : (
          <>
            The rail is showing what the feed says. Turn the switch on to see the
            upgrade badge — the glow, and the popup behind it — without publishing
            anything.
          </>
        )}
      </p>
    </SettingsSection>
  );
}
