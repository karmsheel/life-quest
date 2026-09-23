import { Button } from "@/components/ui/Button";
import { useCompanion } from "@/state/CompanionProvider";

const INSTALL_URL = "https://hermes-agent.nousresearch.com/docs/";

export function CompanionSetupScreen() {
  const { status, ensuring, retry } = useCompanion();
  const kind = status?.kind;

  let title = "Connecting to your LifeQuest companion…";
  let body: string | null =
    "Looking for the Hermes CLI and the lifequest profile.";

  if (!ensuring && kind === "needs_install") {
    title = "Install Hermes Agent";
    body =
      "LifeQuest needs the Hermes CLI on your PATH. Install Hermes, then Recheck.";
  } else if (!ensuring && kind === "profile_error") {
    title = "Could not write the lifequest profile";
    body = [status && "message" in status ? status.message : null, status && "path" in status ? status.path : null]
      .filter(Boolean)
      .join(" — ");
  } else if (!ensuring && kind === "port_busy") {
    title = "Companion port is busy";
    body = `Something else is on port ${status && "port" in status ? status.port : ""}. Recheck after freeing the Hermes host gateway port.`;
  } else if (!ensuring && kind === "gateway_exited") {
    title = "Hermes gateway exited";
    body =
      status && "stderr" in status
        ? status.stderr
        : "The host Hermes gateway did not serve the lifequest profile.";
  } else if (!ensuring && kind === "hermes_too_old") {
    title = "Hermes is too old";
    body =
      "This Hermes build does not expose the Sessions API (session list + chat/stream). Update Hermes, then Recheck.";
  } else if (!ensuring && kind === "auth_error") {
    title = "Companion rejected the API key";
    body = "The lifequest profile key was rejected. Recheck after fixing the profile .env.";
  } else if (!ensuring && kind === "disconnected") {
    title = "Companion disconnected";
    body = "Could not reach the lifequest profile on the Hermes host gateway.";
  }

  return (
    <main className="welcome">
      <div className="welcome-card">
        <h1>LifeQuest companion</h1>
        <p className="muted welcome-lead">{title}</p>
        {body ? <p className="muted">{body}</p> : null}

        <div className="welcome-actions">
          <Button
            type="button"
            variant="primary"
            disabled={ensuring}
            onClick={() => void retry()}
          >
            {ensuring ? "Connecting…" : "Recheck"}
          </Button>
          {kind === "needs_install" ? (
            <a
              className="btn btn-secondary"
              href={INSTALL_URL}
              target="_blank"
              rel="noreferrer"
            >
              Hermes install docs
            </a>
          ) : null}
        </div>
      </div>
    </main>
  );
}
