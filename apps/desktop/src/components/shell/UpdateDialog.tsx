import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { useUpdate } from "@/state/UpdateProvider";

/** Bytes as the operator reads them: one decimal, and the unit that fits. */
function human(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function percent(downloaded: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

type Panel = "offer" | "checking" | "up-to-date" | "error";

/**
 * What the build number opens: the answer to "is there a newer LifeQuest?".
 *
 * One panel for all four answers rather than a popup that only exists when there
 * is something to install. The operator asks by clicking the version number in
 * any state, and a click that opened nothing would be a dead end — so a check
 * that is still running, one that found this build is current, and one that could
 * not answer all report themselves here, in the same place the offer appears.
 *
 * Drawn in a portal on `document.body`, not inside the rail. The rail is a
 * scrolling column inside the shell's grid, and a modal that lives in it would be
 * clipped by its own scroll box on a short window — which is exactly the window a
 * release note needs room in.
 *
 * While the installer is being fetched the popup cannot be dismissed: the
 * download reports itself here, and a dialog that vanished mid-flight would
 * leave the operator with no idea whether it finished. Once it does finish the
 * app is already quitting, which is its own answer.
 */
export function UpdateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    current,
    phase,
    decision,
    error,
    shown,
    previewing,
    installing,
    progress,
    installError,
    install,
    openReleasePage,
    refresh,
  } = useUpdate();
  const titleId = useId();
  const bodyId = useId();
  const [notesOpen, setNotesOpen] = useState(false);

  // What this opening is showing. An offer always wins: it is the only answer
  // with something to do, and it is replaced in place by the next one if a check
  // lands while the panel is open. Otherwise the launch's check and a manual one
  // share `phase`, which is the truth about whether an answer is still on its way.
  const offer = shown?.state === "available" ? shown : null;
  const view: Panel = offer
    ? "offer"
    : phase === "checking"
      ? "checking"
      : decision?.state === "current"
        ? "up-to-date"
        : "error";

  // The failed check's own words, whichever layer knows them: a transport error
  // arrives as `error`, a decision that cannot be used carries its own.
  const failure =
    error ??
    (decision && (decision.state === "error" || decision.state === "no_release")
      ? decision.error
      : null);

  // Each opening starts clean: the last run's folded-away notes must not decide
  // what this one shows.
  useEffect(() => {
    if (open) setNotesOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open || installing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, installing, onClose]);

  if (!open) return null;

  const { latest, installer, notes } = offer ?? {
    latest: null,
    installer: null,
    notes: "",
  };
  const done = percent(progress?.downloaded ?? 0, progress?.total ?? 0);

  const kicker =
    view === "offer"
      ? previewing
        ? "Preview — not a real release"
        : "Upgrade available"
      : view === "checking"
        ? "Checking for updates"
        : view === "up-to-date"
          ? "Up to date"
          : "Update check failed";
  const kickerKind =
    view === "offer" ? (previewing ? "preview" : "release") : view;

  return createPortal(
    <div
      className="update-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        // Clicking away is a dismissal, like the app's other dialogs — and never
        // while the download is running.
        if (event.target === event.currentTarget && !installing) onClose();
      }}
    >
      <div
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-update-dialog={latest ?? ""}
        data-update-view={view}
      >
        <p className="update-dialog__kicker" data-update-kicker={kickerKind}>
          {kicker}
        </p>
        <h2 className="update-dialog__title" id={titleId}>
          {view === "offer"
            ? `LifeQuest ${latest}`
            : view === "error"
              ? "Could not check for updates"
              : `LifeQuest v${current}`}
        </h2>

        {view === "offer" ? (
          <p className="update-dialog__body" id={bodyId} data-update-body="versions">
            You are running <strong>v{current}</strong>.{" "}
            {previewing ? (
              <>
                This is a local preview of the upgrade popup, drawn by Settings →
                Developer. Nothing is being downloaded and no release is being
                offered.
              </>
            ) : (
              <>
                Version <strong>{latest}</strong> is ready to download.
                {installer ? null : (
                  <>
                    {" "}
                    This release carries no Windows installer, so it has to be
                    taken from its own page.
                  </>
                )}
              </>
            )}
          </p>
        ) : view === "checking" ? (
          <p className="update-dialog__body" id={bodyId} data-update-body="checking">
            Asking GitHub for the newest release…
          </p>
        ) : view === "up-to-date" ? (
          <p
            className="update-dialog__body"
            id={bodyId}
            data-update-body="up-to-date"
          >
            You are running <strong>v{current}</strong>. That is the newest
            release — there is nothing to download.
          </p>
        ) : (
          <p className="update-dialog__body" id={bodyId} data-update-body="error">
            {failure ??
              "LifeQuest could not reach the update feed. Try again in a moment."}
          </p>
        )}

        {view === "offer" && notes ? (
          <div className="update-dialog__notes">
            <button
              type="button"
              className="update-dialog__notes-toggle"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((value) => !value)}
            >
              {notesOpen ? "Hide what changed" : "What changed"}
            </button>
            {notesOpen ? (
              // The release body is markdown on GitHub and plain text here: it is
              // shown as the operator wrote it, never parsed into the app.
              <pre className="update-dialog__notes-body">{notes}</pre>
            ) : null}
          </div>
        ) : null}

        {view === "offer" && installer ? (
          <p className="update-dialog__file">
            {installer.name}
            {installer.size > 0 ? ` · ${human(installer.size)}` : ""}
          </p>
        ) : null}

        {installing ? (
          <div className="update-dialog__progress" role="status">
            <div
              className="update-dialog__bar"
              role="progressbar"
              aria-label="Downloading the installer"
              aria-valuemin={0}
              aria-valuemax={100}
              {...(done === null ? {} : { "aria-valuenow": done })}
            >
              <span
                className="update-dialog__bar-fill"
                style={done === null ? { width: "100%" } : { width: `${done}%` }}
              />
            </div>
            <p className="update-dialog__progress-text" data-update-progress={done ?? "unknown"}>
              {done === null
                ? "Downloading the installer…"
                : progress?.total
                  ? `Downloading ${done}% of ${human(progress.total)}…`
                  : `Downloading ${done}%…`}{" "}
              LifeQuest will close so the installer can replace it.
            </p>
          </div>
        ) : null}

        {installError ? (
          <p className="update-dialog__error form-error" role="alert">
            {installError}
          </p>
        ) : null}

        <div className="update-dialog__actions">
          {view === "offer" ? (
            <>
              {/* Cancel takes the focus, as in the app's own confirmations: the
                  control that runs a downloaded executable is the irreversible
                  one, so a stray Enter must not reach it. */}
              <Button
                variant="outline"
                autoFocus
                disabled={installing}
                aria-label="Not now"
                onClick={onClose}
              >
                Not now
              </Button>
              {installer ? (
                <>
                  <Button
                    variant="outline"
                    aria-label="Open the release page"
                    onClick={() => void openReleasePage()}
                  >
                    Release page
                  </Button>
                  <Button
                    variant="primary"
                    disabled={installing}
                    aria-label="Download and install"
                    onClick={() => void install()}
                  >
                    {installing ? "Installing…" : "Download and install"}
                  </Button>
                </>
              ) : (
                // No installer to run — a release published without one, or the
                // Developer preview — so the page is the only thing to offer, and
                // it is offered once.
                <Button
                  variant="primary"
                  aria-label="Open the release page to download"
                  onClick={() => void openReleasePage()}
                >
                  Open release page
                </Button>
              )}
            </>
          ) : view === "checking" ? (
            <Button variant="outline" autoFocus aria-label="Close" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                autoFocus
                aria-label="Close"
                onClick={onClose}
              >
                Close
              </Button>
              <Button
                variant="primary"
                aria-label={
                  view === "up-to-date"
                    ? "Check for updates again"
                    : "Try the update check again"
                }
                onClick={() => void refresh({ force: true })}
              >
                {view === "up-to-date" ? "Check again" : "Try again"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
