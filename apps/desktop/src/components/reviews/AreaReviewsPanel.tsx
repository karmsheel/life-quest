import type { ReviewRecord } from "@lifequest/vault-core";

/**
 * The Review checklist: the life review, then one row per live area.
 *
 * A weekly-or-longer review is one file with a section per area, so the rail is
 * the operator's map of it — a list of the reviews this period still owes. Every
 * row is a button: pressing an area's row starts (or resumes) that area's part of
 * the review, exactly as the page's own Start does for the scope in the lens.
 *
 * The Life review sits apart at the top because it is not another area: it is the
 * whole-life review that reads across all of them, and it stays disabled until
 * every live area's section is done. While it is gated its status says how many
 * areas are left; a count is the useful fact there, not "not started".
 *
 * Status is derived from the loaded record alone — a scope with no entry in
 * `record.scopes` has not been started. The rail never asks the vault anything of
 * its own: the page already holds the one read of the period, and a second read
 * here would be a second truth.
 */

type AreaStatus = "missing" | "draft" | "done";

type ChecklistArea = { slug: string; meta: { name: string } };

type Props = {
  /** The loaded review for the period, or null when the period has no file yet. */
  record: ReviewRecord | null;
  /** The live areas, in the vault's own order (`unlockedAreas`). */
  liveAreas: readonly ChecklistArea[];
  /** The page's active scope: `overall`, or the area slug in the lens. */
  activeScope: "overall" | string;
  busy: boolean;
  locked: boolean;
  /** Start (or resume) one scope: `overall` for the life review, else the slug. */
  onStart: (scope: "overall" | string) => void;
};

const STATUS_LABEL: Record<AreaStatus, string> = {
  missing: "Not started",
  draft: "In progress",
  done: "Done",
};

function statusOf(record: ReviewRecord | null, slug: string): AreaStatus {
  const scope = record?.scopes[slug];
  if (!scope) return "missing";
  return scope.status === "done" ? "done" : "draft";
}

export function AreaReviewsPanel({
  record,
  liveAreas,
  activeScope,
  busy,
  locked,
  onStart,
}: Props) {
  const total = liveAreas.length;
  const done = liveAreas.filter(
    (area) => statusOf(record, area.slug) === "done",
  ).length;
  const remaining = total - done;
  // No live areas means there is nothing to gate the life review behind, which
  // also covers the vault whose areas are all locked away.
  const allAreasDone = remaining === 0;
  const overallStatus = statusOf(record, "overall");
  const interactionsOff = busy || locked;

  const lifeStatus = allAreasDone
    ? STATUS_LABEL[overallStatus]
    : `${remaining} areas left`;

  const hint = !allAreasDone
    ? "The life review unlocks when every area review is done."
    : overallStatus === "done"
      ? "Every area and the life review are complete."
      : "All areas are reviewed — the life review is ready.";

  return (
    <aside
      className="review-checklist"
      data-testid="review-area-rail"
      aria-label="Review checklist"
    >
      <header className="review-checklist__header">
        <h2 className="review-checklist__title">Review checklist</h2>
        <p
          className="review-checklist__progress"
          data-testid="review-area-progress"
        >
          {done} of {total} areas done
        </p>
      </header>

      {/* The whole-life review: not another area, so it stands apart, and it is
          the one row the areas can gate. */}
      <button
        type="button"
        className={[
          "review-checklist__item",
          "review-checklist__item--life",
          activeScope === "overall" ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="review-area-overall"
        aria-current={activeScope === "overall" ? "true" : undefined}
        title={
          allAreasDone ? undefined : "Finish every area review first"
        }
        disabled={interactionsOff || !allAreasDone}
        onClick={() => onStart("overall")}
      >
        <span className="review-checklist__name">Life review</span>
        <span
          className="review-checklist__status"
          data-status={allAreasDone ? overallStatus : "gated"}
          data-testid="review-area-overall-status"
        >
          {lifeStatus}
        </span>
      </button>

      <ul className="review-checklist__list">
        {liveAreas.map((area) => {
          const status = statusOf(record, area.slug);
          const active = activeScope === area.slug;
          return (
            <li key={area.slug}>
              <button
                type="button"
                className={[
                  "review-checklist__item",
                  active ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid={`review-area-${area.slug}`}
                aria-current={active ? "true" : undefined}
                disabled={interactionsOff}
                onClick={() => onStart(area.slug)}
              >
                <span className="review-checklist__name">
                  {area.meta.name} review
                </span>
                <span
                  className="review-checklist__status"
                  data-status={status}
                  data-testid={`review-area-${area.slug}-status`}
                >
                  {STATUS_LABEL[status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="review-checklist__hint" data-testid="review-area-hint">
        {hint}
      </p>
    </aside>
  );
}
