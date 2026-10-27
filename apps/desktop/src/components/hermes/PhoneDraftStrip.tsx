import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { PhoneDraftView } from "@/vite-env";

/**
 * What the phone queued, above the composer.
 *
 * The strip is a fact and an invitation, never a posting control: its action
 * fills the composer with a confirmation the operator can edit or send, and the
 * companion is the one that turns a confirmed draft into a transaction. There
 * is deliberately no "Post" button here — that would make the desktop a second
 * place a transaction starts, and the phone's rule is that the companion posts
 * from chat.
 */
export function PhoneDraftStrip({
  drafts,
  onPrefill,
}: {
  drafts: PhoneDraftView[];
  onPrefill: (draft: PhoneDraftView) => void;
}) {
  if (drafts.length === 0) return null;
  const shown = drafts.slice(0, 3);

  return (
    <div className="phone-drafts" data-testid="phone-drafts">
      <div className="phone-drafts__head">
        <Smartphone size={12} aria-hidden />
        <span>
          {drafts.length} phone draft{drafts.length === 1 ? "" : "s"}
        </span>
      </div>
      {shown.map((draft) => (
        <div key={draft.clientId} className="phone-drafts__row">
          <div className="phone-drafts__text">
            <span className="phone-drafts__body" title={draft.text}>
              {draft.text}
            </span>
            <span className="phone-drafts__meta">
              {draft.deviceName} · {draft.captureDate}
            </span>
          </div>
          <Button
            variant="outline"
            onClick={() => onPrefill(draft)}
            aria-label={`Ask the companion about the phone draft ${draft.text}`}
          >
            Ask companion
          </Button>
        </div>
      ))}
      {drafts.length > shown.length ? (
        <p className="phone-drafts__more">
          and {drafts.length - shown.length} more
        </p>
      ) : null}
    </div>
  );
}
