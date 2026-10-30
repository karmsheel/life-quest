import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { api } from "@/lib/ipc";
import { useUpdate } from "@/state/UpdateProvider";

/**
 * Updates: what this build is, and what the feed last said.
 *
 * The cadence is the app's own: a check at launch, and main's watch every hour
 * after that, so a release published while the studio is open turns up here (and
 * as a notice) without anyone asking. This page does not add another poller. What
 * it adds is a "Check now", which is the operator asking by hand, so it passes
 * `force` and re-reads the feed instead of replaying the session's answer.
 *
 * The feed is public, so there is no token to configure here: the check is one
 * anonymous read. The Developer page is where the upgrade affordance itself can
 * be previewed without publishing anything.
 */
export function SettingsUpdates() {
  const { current, phase, decision, error, refresh } = useUpdate();
  const offering = decision?.state === "available";

  const summary = (() => {
    if (phase === "checking") return "Checking GitHub for a newer release…";
    if (error) return error;
    if (!decision) return "No answer from the update feed yet.";
    if (decision.state === "available") {
      return `LifeQuest ${decision.latest} is available (you are on v${current}).`;
    }
    if (decision.state === "current") {
      return `Up to date — v${current} is the newest release.`;
    }
    return decision.error;
  })();

  return (
    <SettingsSection
      icon={<RefreshCw size={16} />}
      title="Updates"
      subtitle={`LifeQuest v${current} · checked from GitHub Releases`}
    >
      <p
        className={
          offering
            ? "settings-hermes__probe settings-hermes__probe--ok"
            : "settings-hermes__probe"
        }
        role="status"
        data-update-summary={decision?.state ?? phase}
      >
        {summary}
      </p>

      <div className="settings-hermes__actions">
        <Button
          type="button"
          variant="outline"
          disabled={phase === "checking"}
          aria-label="Check for updates now"
          onClick={() => void refresh({ force: true })}
        >
          {phase === "checking" ? "Checking…" : "Check now"}
        </Button>
        {offering ? (
          <Button
            type="button"
            variant="outline"
            aria-label="Open the release page"
            onClick={() => void api().updateOpenReleasePage(decision.releaseUrl)}
          >
            Release page
          </Button>
        ) : null}
      </div>

      <p className="settings-card__desc">
        The release feed is public, so this check holds no token and nothing is
        stored for it. LifeQuest asks at launch and then every hour while it is
        open, so a new release is reported without a click;{" "}
        <em>Check now</em> — like the version number at the foot of the rail — is
        you asking by hand.
      </p>
    </SettingsSection>
  );
}
