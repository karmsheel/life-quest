import { useEffect, useState, type FormEvent } from "react";
import type { ManualDecisionRecord } from "@lifequest/vault-core";
import { actorDisplayName } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";

/**
 * Manual decisions — the ones the operator made themselves.
 *
 * A proposal is a change waiting for an answer; a manual decision is an answer
 * the operator already gave about something the vault does not write. That is
 * why it is logged here rather than filed: nothing will be approved, so the
 * record goes straight to the store History reads.
 *
 * The form is the whole capture. It keeps the operator's words as written —
 * title and rationale are trimmed at the edges only — because a log entry the
 * app paraphrases is not a record of the decision.
 */

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function domainLabel(
  domainSlug: string,
  domains: { slug: string; meta: { name: string } }[],
): string {
  return domains.find((d) => d.slug === domainSlug)?.meta.name ?? domainSlug;
}

export type ManualDecisionPanelProps = {
  /** The live domains, for the optional domain field. */
  domains: { slug: string; meta: { name: string } }[];
  /** The lens the operator is looking through, so the field starts where they are. */
  defaultDomainSlug: string | null;
  /** Already lens-filtered and newest first. */
  items: ManualDecisionRecord[];
  /** True while the page is reading the store after a tab or lens move. */
  loading?: boolean;
  /** The record that just landed, so the page can keep it on screen. */
  onLogged: (decision: ManualDecisionRecord) => void;
};

/**
 * One logged decision, as History draws it.
 *
 * It wears the same card as a proposal because it is the same kind of thing in
 * the operator's record — a decision — and differs in exactly two places: the
 * `Manual` source chip and the `Logged` pill where a proposal says approved or
 * rejected. The id attribute is what the rig names the card by.
 */
export function ManualDecisionCard({
  decision,
  domains,
}: {
  decision: ManualDecisionRecord;
  domains: { slug: string; meta: { name: string } }[];
}) {
  const domain = decision.domainSlug;
  return (
    <li
      className="decision-card decision-card--manual"
      data-manual-decision-id={decision.id}
      data-source="manual"
    >
      <div className="decision-card__kicker">
        <span className="decision-card__kicker-left">
          <span className="decision-source decision-source--manual">Manual</span>
        </span>
        <span className="decision-card__kicker-right">
          {domain ? (
            <span
              className="decision-domain"
              data-domain-slug={domain}
              title={`Domain: ${domainLabel(domain, domains)}`}
            >
              {domainLabel(domain, domains)}
            </span>
          ) : null}
          <span className="decision-status decision-status--logged">Logged</span>
        </span>
      </div>
      <div>
        <h2 className="decision-card__title">{decision.title}</h2>
        <p className="decision-card__meta muted">
          <span>{actorDisplayName(decision.actor)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={decision.createdAt}>{formatWhen(decision.createdAt)}</time>
        </p>
      </div>
      {decision.rationale ? (
        <p className="decision-card__rationale">{decision.rationale}</p>
      ) : null}
    </li>
  );
}

export function ManualDecisionsPanel({
  domains,
  defaultDomainSlug,
  items,
  loading = false,
  onLogged,
}: ManualDecisionPanelProps) {
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [domainSlug, setDomainSlug] = useState(defaultDomainSlug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Moving the lens while this panel is open moves the field with it. The
  // operator's own choice still wins once they make one: this only fires when
  // the lens the page is showing changes, not on every keystroke.
  useEffect(() => {
    setDomainSlug(defaultDomainSlug ?? "");
  }, [defaultDomainSlug]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Say what you decided before logging it.");
      return;
    }
    setPending(true);
    try {
      const result = await api().manualDecisionCreate({
        title: title.trim(),
        rationale: rationale.trim() || null,
        domainSlug: domainSlug || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The record is kept by the page; the form hands the operator their blank
      // page back so the next decision can be written without clearing it by hand.
      setTitle("");
      setRationale("");
      onLogged(result.value);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to log the decision",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="manual-decisions" data-testid="manual-decisions-panel">
      <p className="manual-decisions__lead muted">
        Log a decision you made yourself — at a desk or only in your head. Nothing
        is proposed and nothing is written into the vault; it goes into History
        beside the AI&rsquo;s decisions.
      </p>

      <form className="manual-decisions__form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>What did you decide?</span>
          <textarea
            rows={2}
            value={title}
            // The app owns the refusal (`submit` says so in the operator's own
            // words), so the browser's native bubble is not used: an invalid
            // field must not be the only thing between the operator and a
            // sentence they cannot see the reason for. The requirement is still
            // announced to a screen reader.
            aria-required="true"
            placeholder="e.g. Stop the gym membership"
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="field">
          <span>Why? (optional)</span>
          <textarea
            rows={2}
            value={rationale}
            placeholder="What made this the right call?"
            onChange={(e) => setRationale(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="field manual-decisions__domain">
          <span>Domain (optional)</span>
          <select
            value={domainSlug}
            onChange={(e) => setDomainSlug(e.target.value)}
            disabled={pending}
            aria-label="Domain"
          >
            <option value="">No domain</option>
            {domains.map((domain) => (
              <option key={domain.slug} value={domain.slug}>
                {domain.meta.name}
              </option>
            ))}
          </select>
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="manual-decisions__actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending}
            data-testid="manual-decision-submit"
          >
            {pending ? "Logging…" : "Log decision"}
          </button>
        </div>
      </form>

      <div className="manual-decisions__history">
        <h2 className="manual-decisions__heading">Your manual decisions</h2>
        {loading ? (
          <p className="muted">Loading decisions…</p>
        ) : items.length === 0 ? (
          <p className="manual-decisions__empty muted">
            No manual decisions logged yet.
          </p>
        ) : (
          <ul className="manual-decisions__list">
            {items.map((decision) => (
              <ManualDecisionCard
                key={decision.id}
                decision={decision}
                domains={domains}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
