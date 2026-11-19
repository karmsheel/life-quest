import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { Toggle } from "@/components/ui/Toggle";
import { useUpdate } from "@/state/UpdateProvider";
import { LogoPicker } from "./LogoPicker";

/**
 * Developer: the switches that make a shipping app show something it otherwise
 * only shows when the outside world cooperates.
 *
 * Two things live here now. The update preview exists because the update
 * affordance is the one thing in the studio you cannot look at on demand: it
 * appears when GitHub publishes a newer release, and not before. Testing the
 * glow used to mean cutting a release and installing the old build.
 *
 * The logo picker is the second bench: the app ships four lockups, and which one
 * the rail and the splash wear is an identity choice, not an everyday setting,
 * so it is offered where the operator can see all four and change their mind
 * without hunting through Appearance. The art is the shipped art — the preview
 * is the same component the rail draws — and the pick persists locally because
 * the splash must know it before React exists.
 *
 * The dashboard's Edit card gesture used to be gated here too. It is not any more:
 * the operator asked for card resizing as part of the dashboard itself, so its
 * handles belong to the card's own menu rather than to a hidden switch.
 *
 * What the update switch does not do is lie to the rest of the app. The preview
 * is drawn by the rail and the popup only, from a decision that carries no
 * installer, so nothing can be downloaded from it, and a real release always
 * outranks it.
 *
 * The page is a list rather than a paragraph with a checkbox under it: each
 * bench switch is one `SettingsRow` — label and description on the left, the
 * control pinned to the row's trailing edge — and the list rules the rows apart.
 * A future bench item is another row here, not another layout.
 */
export function SettingsDeveloper() {
  const { preview, setPreview, previewing, decision, current } = useUpdate();
  const [justChanged, setJustChanged] = useState(false);

  const offered = decision?.state === "available" ? decision.latest : null;

  return (
    <SettingsSection
      icon={<FlaskConical size={16} />}
      title="Developer"
      subtitle="The bench: switches and the studio's own identity"
    >
      <div className="settings-developer" data-developer-settings>
        <SettingsRow
          label="Preview the update badge"
          description="Makes the build number in the chat dock's bottom bar glow, and opens the upgrade popup from it, as if a newer LifeQuest had been published. Nothing is downloaded: the preview carries no installer, so the popup offers the release page instead. It stays on until you turn it back off, and a real release always wins over it."
          action={
            <Toggle
              label="Preview the update badge"
              checked={preview}
              onChange={(next) => {
                setPreview(next);
                setJustChanged(true);
              }}
            />
          }
          note={
            <p
              className="settings-developer__state"
              role="status"
              data-developer-state={
                previewing ? "previewing" : preview ? "shadowed" : "off"
              }
            >
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
                  offering <strong>v{offered}</strong>, and a real release outranks
                  the preview. Turn the switch off once you have seen it.
                </>
              ) : justChanged ? (
                <>The preview is off. The rail is back to what the feed says.</>
              ) : (
                <>
                  The rail is showing what the feed says. Turn the switch on to see
                  the upgrade badge — the glow, and the popup behind it — without
                  publishing anything.
                </>
              )}
            </p>
          }
        />
        {/*
          The logo bench: four lockups, the shipped one active. It sits below the
          update row rather than in a row's trailing control because the previews
          need the row's full width — a 15rem-tall thumbnail column would show the
          wordmark at the size of a paragraph. The rail behind the sheet repaints
          on the press (same store), so the operator sees the change immediately.
        */}
        <div className="settings-developer__logo" data-developer-logo>
          <div className="settings-card__copy">
            <div className="settings-card__label">Logo</div>
            <p className="settings-card__desc">
              Which LifeQuest lockup the studio wears. The rail draws it at the
              top of the left sidebar, and the splash screen wears it at launch.
              Its three inks — the LIFE text, the Q emblem and the UEST text — are
              theme colours, so the mark follows the active theme and the day/night
              palette rather than carrying one fixed picture. The pick is stored on
              this machine and survives restarts.
            </p>
          </div>
          <LogoPicker />
        </div>
      </div>
    </SettingsSection>
  );
}
