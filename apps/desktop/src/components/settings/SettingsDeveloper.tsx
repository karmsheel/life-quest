import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useUpdate } from "@/state/UpdateProvider";
import { setDeveloperFlag, useDeveloperFlag } from "@/state/developer-flags";

/**
 * Developer: the switches that make a shipping app show something it otherwise
 * only shows when the outside world cooperates.
 *
 * There are two.
 *
 * The update preview exists because the update affordance is the one thing in the
 * studio you cannot look at on demand: it appears when GitHub publishes a newer
 * release, and not before. Testing the glow used to mean cutting a release and
 * installing the old build.
 *
 * The card width handle is gated because it is a GESTURE, and a gesture has to be
 * felt before it can be judged. Dragging a dashboard card's right edge is the
 * operator's own answer to "give me more control over the width of the cards", and
 * until it has been lived with it is an edge on every card in the app that nobody
 * asked for. So it ships off, and this page is where it is turned on.
 *
 * What neither switch does is lie to the rest of the app. The update preview is
 * drawn by the rail and the popup only, from a decision that carries no installer,
 * so nothing can be downloaded from it, and a real release always outranks it. The
 * width handle is a real feature when it is on — the handle is the same element,
 * the gesture is the same code, and the width it sets is stored on the pin exactly
 * as it is with the flag off-then-on — and when it is off the board does not draw
 * the edge at all, so there is nothing to discover by accident.
 */
export function SettingsDeveloper() {
  const { preview, setPreview, previewing, decision, current } = useUpdate();
  const cardWidthHandle = useDeveloperFlag("cardWidthHandle");
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

      <SettingsRow
        label="Card width handle"
        description="Puts a draggable edge on the right of every view card on a dashboard: drag it and the card is as wide as you make it, with the arrow keys stepping one column at a time. A card can never be dragged narrower than the data it holds — the board stops the handle there — and the width you set is saved on that card, so it is still that wide tomorrow. Off by default: it is a gesture, and a gesture wants to be lived with before it is on everybody's board."
        action={
          <input
            type="checkbox"
            aria-label="Card width handle"
            data-developer-card-resize={cardWidthHandle ? "on" : "off"}
            checked={cardWidthHandle}
            onChange={(event) => setDeveloperFlag("cardWidthHandle", event.target.checked)}
          />
        }
      />

      <p
        className="settings-card__desc"
        role="status"
        data-developer-card-resize-state={cardWidthHandle ? "on" : "off"}
      >
        {cardWidthHandle ? (
          <>
            Dashboard cards have a draggable right edge. Hover the right edge of a
            card to see it, drag it to set the width, or tab to it and use the
            arrow keys. Cards still size themselves from what they hold until you
            say otherwise.
          </>
        ) : (
          <>
            Dashboard cards size themselves from what they hold, and there is no
            edge to drag. Turn the switch on to set a card's width by hand.
          </>
        )}
      </p>
    </SettingsSection>
  );
}
