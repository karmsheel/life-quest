import { useEffect, useMemo, useState } from "react";
import {
  DOCUMENT_KIND_LABELS,
  DOCTRINE_ORDER,
  type DocumentKind,
  type OnboardingConfirmOptions,
  type OnboardingProposal,
  type OnboardingStatus,
} from "@lifequest/vault-core";
import { Button } from "@/components/ui/Button";

/**
 * The onboarding interview, as the chat dock renders it.
 *
 * Three quiet cards, never a modal and never a chat message: the interview is
 * an offer the operator can take up at any time, so it lives above the composer
 * where a chat bubble would scroll away and where `aria-live` cannot announce it
 * as if the companion had spoken. Which card shows is decided by the vault
 * record, never inferred from the areas list — the snapshot deliberately carries
 * locked areas too, and the welcome card must not name them.
 *
 * The card draws the proposal's own payload and nothing else: `snapshot.domains`
 * includes the locked areas by design, so deriving the list from it would leak
 * the taxonomy the interview exists to reveal only when it is heard.
 */
export type OnboardingCardsProps = {
  status: OnboardingStatus;
  /** The pending proposal, or null; drives the confirmation card. */
  proposal: OnboardingProposal | null;
  /** True while one of the card's own writes is in flight. */
  busy?: boolean;
  onBegin: () => void;
  onContinue: () => void;
  onConfirm: (options: OnboardingConfirmOptions) => void;
  onDiscard: () => void;
};

const TABLE_LINE = "table";
const NOTE_LINE = "note";

/**
 * One doctrine kind's tick key.
 *
 * The engine's consent is a kind list — `skipDoctrineKinds` — not a
 * matrix, so unticking a kind untickes it for every proposed area. The card
 * binds the same state to each area's line so what the operator sees is exactly
 * what Confirm will do, rather than a per-area gesture that silently falls back
 * to a batch-wide skip.
 */
function doctrineKey(kind: DocumentKind): string {
  return `kind:${kind}`;
}

/**
 * "Health and Business", "Health, Business and Mind": the areas as one phrase,
 * so the primary button names the act rather than the taxonomy.
 */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Four kinds in the order the doctrine chain reads, then anything unexpected:
 * the engine writes exactly the four, but a card that silently dropped a line
 * would be worse than one that shows it last.
 */
function orderedDoctrine(
  lines: OnboardingProposal["areas"][number]["doctrine"],
): OnboardingProposal["areas"][number]["doctrine"] {
  const rank = (kind: DocumentKind) => {
    const at = DOCTRINE_ORDER.indexOf(kind);
    return at === -1 ? DOCTRINE_ORDER.length : at;
  };
  return lines
    .slice()
    .sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** The first readable line of a draft, so a tick has something to point at. */
function excerpt(markdown: string): string {
  const line =
    markdown
      .split("\n")
      .map((part) => part.replace(/^[\s#>*+-]+/, "").trim())
      .find((part) => part.length > 0) ?? "";
  if (line.length <= 140) return line;
  return `${line.slice(0, 137).trimEnd()}…`;
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
 * The quiet way back in: while the record is open and no proposal is waiting,
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
 * The confirmation card: the one consent record for the interview's batch.
 *
 * It lists exactly what will be unlocked, what doctrine will be drafted and what
 * (at most one) table and note will be created, and every drafted line can be
 * unticked. Nothing here is written by opening it — Confirm is the write.
 */
export function OnboardingConfirmCard({
  proposal,
  busy = false,
  onConfirm,
  onDiscard,
}: Pick<
  OnboardingCardsProps,
  "proposal" | "busy" | "onConfirm" | "onDiscard"
> & { proposal: OnboardingProposal }) {
  /**
   * What the operator has unticked: a doctrine kind (`kind:<kind>`), `table` or
   * `note`. It resets when the proposal itself changes: a revised proposal is a
   * new sheet, not the old one with the operator's objections carried over.
   */
  const [dropped, setDropped] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  useEffect(() => {
    setDropped(new Set<string>());
  }, [proposal]);

  const toggle = (key: string) => {
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const choices = useMemo<OnboardingConfirmOptions>(() => {
    // In the order the card lists them, so the engine's batch reads the way the
    // sheet did.
    const skip: DocumentKind[] = [];
    for (const area of proposal.areas) {
      for (const line of orderedDoctrine(area.doctrine)) {
        if (dropped.has(doctrineKey(line.kind)) && !skip.includes(line.kind)) {
          skip.push(line.kind);
        }
      }
    }
    return {
      skipDoctrineKinds: skip,
      includeTable: proposal.table !== null && !dropped.has(TABLE_LINE),
      includeNote: !dropped.has(NOTE_LINE),
    };
  }, [proposal, dropped]);

  const unlockLabel = `Unlock ${joinNames(proposal.areas.map((area) => area.name))}`;

  return (
    <div
      className="onboarding-card onboarding-card--confirm"
      data-testid="onboarding-card"
      data-onboarding-status="confirm"
      aria-busy={busy || undefined}
      aria-labelledby="onboarding-confirm-title"
    >
      <h3 className="onboarding-card__title" id="onboarding-confirm-title">
        Here&apos;s what I heard.
      </h3>
      <p className="onboarding-card__question">
        {unlockLabel}?
      </p>
      <p className="onboarding-card__copy">
        {proposal.table
          ? "I'll draft their premise, vision, purpose and strategy from your answers, and add the one table the conversation asked for."
          : "I'll draft their premise, vision, purpose and strategy from your answers."}
      </p>
      {/*
        The manifest scrolls inside the card, not with it: the heading and the
        two buttons stay put, so a three-area proposal can never push Confirm off
        the bottom of the dock.
      */}
      <div className="onboarding-card__sheet">
        <ul className="onboarding-card__groups">
          {proposal.areas.map((area) => (
            <li
              key={area.slug}
              className="onboarding-card__group"
              data-onboarding-area={area.slug}
            >
              <p className="onboarding-card__area-name">{area.name}</p>
              <ul className="onboarding-card__lines">
                {orderedDoctrine(area.doctrine).map((line) => {
                  const key = doctrineKey(line.kind);
                  const label = DOCUMENT_KIND_LABELS[line.kind];
                  return (
                    <li key={line.kind} className="onboarding-card__line">
                      <label className="onboarding-card__tick">
                        <input
                          type="checkbox"
                          checked={!dropped.has(key)}
                          onChange={() => toggle(key)}
                          aria-label={`Draft ${label} for ${area.name}`}
                          data-onboarding-toggle={`doctrine:${key}`}
                        />
                        <span className="onboarding-card__line-body">
                          <span className="onboarding-card__line-title">
                            {label}
                          </span>
                          <span className="onboarding-card__line-detail">
                            {excerpt(line.bodyMarkdown)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {proposal.table ? (
          <label className="onboarding-card__tick onboarding-card__tick--extra">
            <input
              type="checkbox"
              checked={!dropped.has(TABLE_LINE)}
              onChange={() => toggle(TABLE_LINE)}
              aria-label={`Create the ${proposal.table.name} table`}
              data-onboarding-toggle={TABLE_LINE}
            />
            <span className="onboarding-card__line-body">
              <span className="onboarding-card__line-title">
                {proposal.table.name}
                <span className="onboarding-card__line-kind"> table</span>
              </span>
              <span className="onboarding-card__line-detail">
                {proposal.table.columns.map((column) => column.name).join(" · ")}
              </span>
            </span>
          </label>
        ) : null}
        <label className="onboarding-card__tick onboarding-card__tick--extra">
          <input
            type="checkbox"
            checked={!dropped.has(NOTE_LINE)}
            onChange={() => toggle(NOTE_LINE)}
            aria-label="Save the interview note"
            data-onboarding-toggle={NOTE_LINE}
          />
          <span className="onboarding-card__line-body">
            <span className="onboarding-card__line-title">
              {proposal.note.title}
              <span className="onboarding-card__line-kind"> note</span>
            </span>
            <span className="onboarding-card__line-detail">
              A short record of this conversation, kept in Life.
            </span>
          </span>
        </label>
      </div>
      <div className="onboarding-card__actions">
        <Button
          variant="primary"
          onClick={() => onConfirm(choices)}
          disabled={busy}
          data-testid="onboarding-confirm"
        >
          {unlockLabel}
        </Button>
        <Button
          variant="ghost"
          onClick={onDiscard}
          disabled={busy}
          data-testid="onboarding-discard"
        >
          Not now
        </Button>
      </div>
    </div>
  );
}

/**
 * The dock's onboarding surface: the one card the vault record earns.
 *
 * `completed` draws nothing — after the interview the dock never mentions it
 * again, which is why the component returns null rather than an empty shell.
 */
export function OnboardingCards(props: OnboardingCardsProps) {
  if (props.status === "completed") return null;
  if (props.proposal !== null) {
    return (
      <OnboardingConfirmCard
        proposal={props.proposal}
        busy={props.busy}
        onConfirm={props.onConfirm}
        onDiscard={props.onDiscard}
      />
    );
  }
  if (props.status === "not_started") {
    return <OnboardingWelcomeCard busy={props.busy} onBegin={props.onBegin} />;
  }
  return <OnboardingContinueCard busy={props.busy} onContinue={props.onContinue} />;
}
