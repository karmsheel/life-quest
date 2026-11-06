import { Button } from "@/components/ui/Button";
import { PiEndpointForm } from "@/components/settings/PiEndpointForm";
import { CompanionProfilePicker } from "@/components/hermes/CompanionProfilePicker";
import { HarnessPicker } from "@/components/hermes/HarnessPicker";
import { useCompanion } from "@/state/CompanionProvider";

const INSTALL_URL = "https://hermes-agent.nousresearch.com/docs/";

export function CompanionSetupScreen() {
  const { status, ensuring, retry, profile, harness } = useCompanion();
  const kind = status?.kind;
  // The copy names the profile it is about, and that profile is the operator's
  // choice now — a screen that says "lifequest" while the app is on `coder`
  // is the same blindness this feature removes.
  const profileName = profile ?? "lifequest";
  const pi = harness === "pi";

  let title = "Connecting to your LifeQuest companion…";
  let body: string | null = pi
    ? "Starting the built-in companion."
    : `Looking for the Hermes CLI and the ${profileName} profile.`;

  if (!ensuring && kind === "needs_setup") {
    title = pi ? "Set up the built-in companion" : "The companion needs setup";
    body =
      (status && "message" in status ? status.message : null) ??
      (pi
        ? "Point it at an OpenAI-compatible endpoint and name a model. A local server works without a key."
        : null);
  } else if (!ensuring && kind === "needs_install") {
    title = "Install Hermes Agent";
    body =
      "The external sidekick needs the Hermes CLI on your PATH. Install Hermes, then Recheck — or switch to the built-in companion above.";
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
    // What the CLI itself said. Hermes prints its refusals on stdout and exits
    // non-zero with stderr empty, so this is the sentence that names the failure —
    // the app used to show only the exit code it fell back to.
    body =
      status && "detail" in status
        ? status.detail
        : `The host Hermes gateway did not serve the ${profileName} profile.`;
  } else if (!ensuring && kind === "hermes_too_old") {
    title = "Hermes is too old";
    body =
      "This Hermes build does not expose the Sessions API (session list + chat/stream). Update Hermes, then Recheck.";
  } else if (!ensuring && kind === "auth_error") {
    title = pi ? "The endpoint rejected the key" : "Companion rejected the API key";
    body = pi
      ? "Update the API key below, then save."
      : `The ${profileName} profile key was rejected. Recheck after fixing the profile .env.`;
  } else if (!ensuring && kind === "disconnected") {
    title = "Companion disconnected";
    body = pi
      ? "The model endpoint did not answer. Check the URL and that the server is running, then Recheck."
      : `Could not reach the ${profileName} profile on the Hermes host gateway.`;
  }

  return (
    <main className="welcome">
      <div className="welcome-card">
        <h1>LifeQuest companion</h1>
        <p className="muted welcome-lead">{title}</p>
        {body ? <p className="muted welcome-detail">{body}</p> : null}

        {/*
          Which companion to bring up. The choice belongs here, not only in
          Settings: a machine with no Hermes needs a way past "install Hermes"
          that does not mean editing a config file.
        */}
        <div className="welcome-harness">
          <HarnessPicker />
        </div>

        {pi && kind === "needs_setup" ? <PiEndpointForm disabled={ensuring} /> : null}

        {/*
          The way out of a stuck connect. Every profile this Hermes install
          has, the one the app is on marked, and the app's own `lifequest`
          profile on offer even when it does not exist yet — picking one
          re-runs the ensure against it, and picking `lifequest` creates it.
        */}
        {pi ? null : <CompanionProfilePicker />}

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
