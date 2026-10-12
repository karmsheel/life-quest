import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { api } from "@/lib/ipc";
import { useUpdate } from "@/state/UpdateProvider";

/**
 * Updates: what this build is, what the feed last said, and the one secret the
 * feed needs while the repository is private.
 *
 * The cadence is the launch's own check — this page does not add a poller. What
 * it adds is the token and a "Check now", which is the operator asking by hand,
 * so it passes `force` and re-reads the feed instead of replaying the session's
 * answer.
 */
export function SettingsUpdates() {
  const { current, phase, decision, error, available, refresh } = useUpdate();
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api()
      .updateTokenStatus()
      .then((value) => {
        if (!cancelled) setHasToken(Boolean(value));
      })
      .catch(() => {
        if (!cancelled) setHasToken(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSaveToken() {
    setFailure(null);
    setMessage(null);
    if (!draft.trim()) {
      setFailure("Paste a GitHub token first.");
      return;
    }
    setBusy(true);
    try {
      const result = await api().updateSetToken(draft.trim());
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      // The token is never read back: the field clears and the row reports that
      // one is stored, which is all the renderer is allowed to know.
      setDraft("");
      setHasToken(true);
      setMessage("Token stored in OS secure storage.");
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClearToken() {
    setFailure(null);
    setMessage(null);
    setBusy(true);
    try {
      const result = await api().updateClearToken();
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      setHasToken(false);
      setMessage("Token removed.");
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const summary = (() => {
    if (phase === "checking") return "Checking GitHub for a newer release…";
    if (error) return error;
    if (!decision) return "No answer from the update feed yet.";
    if (decision.state === "available") {
      return `LifeQuest ${decision.latest} is available (you are on v${current}).`;
    }
    if (decision.state === "current") return `Up to date — v${current} is the newest release.`;
    if (decision.state === "no_release") return decision.error;
    return decision.error;
  })();

  return (
    <SettingsSection
      icon={<RefreshCw size={16} />}
      title="Updates"
      subtitle={`LifeQuest v${current} · checked from GitHub Releases`}
      banner={
        failure || message ? (
          <>
            {failure ? (
              <p className="form-error" role="alert">
                {failure}
              </p>
            ) : null}
            {message ? (
              <p className="form-message" role="status">
                {message}
              </p>
            ) : null}
          </>
        ) : undefined
      }
    >
      <p
        className={
          available
            ? "settings-hermes__probe settings-hermes__probe--ok"
            : "settings-hermes__probe"
        }
        role="status"
        data-update-summary={available ? "available" : (decision?.state ?? phase)}
      >
        {summary}
      </p>

      <SettingsRow
        label="GitHub token"
        description="Not needed while the release repository is public — its releases are read without one. Set a token with read access to it if the repository ever goes private. Stored in OS secure storage, never in a vault, and never read back into this window."
        action={
          <span
            className="settings-field__value"
            data-update-token={hasToken ? "set" : "unset"}
          >
            {hasToken === null ? "…" : hasToken ? "Stored" : "Not set"}
          </span>
        }
      />

      <div className="settings-field settings-updates__token">
        <span>Token</span>
        <p className="muted">
          A fine-grained token with read access to this repository's contents is
          enough. Leaving it unset is the normal case: the check simply reads the
          public release feed.
        </p>
        <div className="settings-hermes__actions">
          <input
            type="password"
            aria-label="GitHub token"
            placeholder="github_pat_… or ghp_…"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            aria-label="Save GitHub token"
            onClick={() => void onSaveToken()}
          >
            Save token
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !hasToken}
            aria-label="Remove GitHub token"
            destructive
            onClick={() => void onClearToken()}
          >
            Remove
          </Button>
        </div>
      </div>

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
        {decision?.state === "available" ? (
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
    </SettingsSection>
  );
}
