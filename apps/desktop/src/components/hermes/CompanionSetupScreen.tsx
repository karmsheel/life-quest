import { Button } from "@/components/ui/Button";
import { CompanionProfilePicker } from "@/components/hermes/CompanionProfilePicker";
import { useCompanion } from "@/state/CompanionProvider";

const INSTALL_URL = "https://hermes-agent.nousresearch.com/docs/";

export function CompanionSetupScreen() {
  const { status, ensuring, retry, profile } = useCompanion();
  const kind = status?.kind;
  // The copy names the profile it is about, and that profile is the operator's
  // choice now — a screen that says "lifequest" while the app is on `coder`
  // is the same blindness this feature removes.
  const profileName = profile ?? "lifequest";

  let title = "Connecting to your LifeQuest companion…";
  let body: string | null =
    `Looking for the Hermes CLI and the ${profileName} profile.`;

  if (!ensuring && kind === "needs_install") {
    title = "Install Hermes Agent";
    body =
      "LifeQuest needs the Hermes CLI on your PATH. Install Hermes, then Recheck.";
  } else if (!ensuring && kind === "profile_error") {
    title = `Could not write the ${profileName} profile`;
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
        : `The host Hermes gateway did not serve the ${profileName} profile.`;
  } else if (!ensuring && kind === "hermes_too_old") {
    title = "Hermes is too old";
    body =
      "This Hermes build does not expose the Sessions API (session list + chat/stream). Update Hermes, then Recheck.";
  } else if (!ensuring && kind === "auth_error") {
    title = "Companion rejected the API key";
    body = `The ${profileName} profile key was rejected. Recheck after fixing the profile .env.`;
  } else if (!ensuring && kind === "disconnected") {
    title = "Companion disconnected";
    body = `Could not reach the ${profileName} profile on the Hermes host gateway.`;
  }

  return (
    <main className="welcome">
      <div className="welcome-card">
        <h1>LifeQuest companion</h1>
        <p className="muted welcome-lead">{title}</p>
        {body ? <p className="muted">{body}</p> : null}

        {/*
          The way out of a stuck connect. Every profile this Hermes install
          has, the one the app is on marked, and the app's own `lifequest`
          profile on offer even when it does not exist yet — picking one
          re-runs the ensure against it, and picking `lifequest` creates it.
        */}
        <CompanionProfilePicker />

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
