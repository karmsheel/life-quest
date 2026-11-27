import { Button } from "@/components/ui/Button";
// Types only: the package index pulls `node:fs`/`node:crypto`, which the browser
// bundle externalizes. Nothing in this file needs a vault-core value, so the
// renderer's module graph never touches that entry; a value import would have to
// come from `@lifequest/vault-core/pure`.
import type { OnboardingProposal, OnboardingStatus } from "@lifequest/vault-core";

/**
 * The onboarding interview, as the chat dock renders it.
 *
 * The interview is passive: the companion opens the areas itself once it has
 * heard enough, and the dock only announces what happened. Nothing here asks
 * the operator to consent to a batch, so there is no confirmation card and no
 * tickable line — one announcement with one **Continue** that acknowledges the
 * receipt, plus the two offers that are not the interview's result:
 *
 *  - **Welcome** (`not_started`): the spec's copy and *Begin the interview*.
 *  - **Continue the interview** (`in_progress`, no receipt): a quiet way back in.
 *  - **Opened** (`completed` with a receipt): what the companion just opened.
 *
 * Which card shows is decided by the vault record and the pending receipt,
 * never inferred from the areas list: `snapshot.domains` deliberately carries
 * the locked areas too, and the welcome card must not name them. The opened
 * card's names come from the proposal payload — the receipt is what the
 * companion wrote, and it is the only place those names may come from.
 */
export type OnboardingCardsProps = {
  status: OnboardingStatus;
  /** The pending receipt, or null; drives the announcement card. */
  proposal: OnboardingProposal | null;
  /** True while the card's own write (start, continue, acknowledge) is in flight. */
  busy?: boolean;
  onBegin: () => void;
  /** The `in_progress` card: send the operator's "let's continue" turn. */
  onContinue: () => void;
  /** The opened card's **Continue**: acknowledge the receipt. */
  onAcknowledge: () => void;
};

/**
 * "Health and Business", "Health, Business and Mind": the areas as one phrase,
 * the way the announcement names what was opened.
 */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The announcement's first line, verbatim apart from the names the companion
 * opened. "area" when the interview heard one; "areas" for the usual two or
 * three, so the sentence stays a sentence.
 */
export function openedAnnouncement(names: string[]): string {
  const noun = names.length === 1 ? "area" : "areas";
  return `After analyzing our conversation, I've opened up the ${joinNames(names)} ${noun} for you.`;
}

/**
 * The welcome card: the spec's copy, one button, no taxonomy.
 *
 * The interview is optional in both directions — the copy says the operator can
 * just start talking — so this is an offer, not a gate.
 */
export function OnboardingWelcomeCard({
  busy = false,
  onBegin,
}: Pick<OnboardingCardsProps, "busy" | "onBegin">) {
  return (
    <div
      className="onboarding-card onboarding-card--welcome"
      data-testid="onboarding-card"
      data-onboarding-status="not_started"
      aria-busy={busy || undefined}
    >
      <h3 className="onboarding-card__title">Welcome to LifeQuest.</h3>
      <p className="onboarding-card__copy">
        To start, I&apos;d like to spend ten minutes on what&apos;s actually going
        on in your life — what&apos;s worrying you, what you want to change, what
        you&apos;re working toward. Or just start talking; you can do this
        anytime.
      </p>
      <div className="onboarding-card__actions">
        <Button
          variant="primary"
          onClick={onBegin}
          disabled={busy}
          data-testid="onboarding-begin"
        >
          Begin the interview
        </Button>
      </div>
    </div>
  );
}

/**
 * The quiet way back in: while the record is open and no receipt is waiting,
 * one line and one button, so the dock does not keep asking for attention.
 */
export function OnboardingContinueCard({
  busy = false,
  onContinue,
}: Pick<OnboardingCardsProps, "busy" | "onContinue">) {
  return (
    <div
      className="onboarding-card onboarding-card--continue"
      data-testid="onboarding-card"
      data-onboarding-status="in_progress"
      aria-busy={busy || undefined}
    >
      <p className="onboarding-card__copy">
        The interview is still open. Pick it up whenever you&apos;re ready.
      </p>
      <div className="onboarding-card__actions">
        <Button
          variant="outline"
          onClick={onContinue}
          disabled={busy}
          data-testid="onboarding-continue"
        >
          Continue the interview
        </Button>
      </div>
    </div>
  );
}

/**
 * What the companion opened, announced after the fact.
 *
 * The areas are already unlocked and their doctrine, the one table and the one
 * note are already written when this card paints — the companion applied the
 * batch, the card is the receipt's face, and **Continue** only acknowledges it.
 * That is why there is exactly one button and no question: there is nothing
 * left to decide.
 */
export function OnboardingOpenedCard({
  proposal,
  busy = false,
  onAcknowledge,
}: Pick<OnboardingCardsProps, "proposal" | "busy" | "onAcknowledge"> & {
  proposal: OnboardingProposal;
}) {
  return (
    <div
      className="onboarding-card onboarding-card--opened"
      data-testid="onboarding-card"
      data-onboarding-status="opened"
      aria-busy={busy || undefined}
    >
      <p className="onboarding-card__lead">
        {openedAnnouncement(proposal.areas.map((area) => area.name))}
      </p>
      <p className="onboarding-card__copy">
        These let you hone in and focus on different areas in your life.
      </p>
      <div className="onboarding-card__actions">
        <Button
          variant="primary"
          onClick={onAcknowledge}
          disabled={busy}
          data-testid="onboarding-opened-continue"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

/**
 * The dock's onboarding surface: the one card the vault record earns.
 *
 * - a receipt with the record completed is the announcement (the companion has
 *   already applied it; only the acknowledgement is left);
 * - otherwise `not_started` is the welcome and `in_progress` is the way back in;
 * - `completed` with no receipt draws nothing, ever again.
 */
export function OnboardingCards(props: OnboardingCardsProps) {
  if (props.status === "completed") {
    return props.proposal !== null ? (
      <OnboardingOpenedCard
        proposal={props.proposal}
        busy={props.busy}
        onAcknowledge={props.onAcknowledge}
      />
    ) : null;
  }
  if (props.proposal !== null) {
    // A receipt without a completed record is a mid-apply read, not a state an
    // operator should see a card for; the next snapshot settles it.
    return null;
  }
  if (props.status === "not_started") {
    return <OnboardingWelcomeCard busy={props.busy} onBegin={props.onBegin} />;
  }
  return <OnboardingContinueCard busy={props.busy} onContinue={props.onContinue} />;
}
