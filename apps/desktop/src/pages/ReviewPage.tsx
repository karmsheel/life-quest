import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams, useNavigate } from "react-router-dom";
import {
  currentPeriod,
  isCurrentPeriod,
  isFuturePeriod,
  nextPeriod,
  previousPeriod,
  periodTitle,
  type ReviewCadence,
  type ReviewPrepopulateResult,
  type ReviewRecord,
  type ReviewSkill,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { asHeld, sameNote } from "@/lib/note-body";
import { useVault } from "@/state/VaultProvider";
import { useChatDock } from "@/state/ChatDockProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { Button } from "@/components/ui/Button";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
import { MarkdownView } from "@/components/documents/MarkdownView";
import { DailyNotesPanel } from "@/components/reviews/DailyNotesPanel";
import { ReviewPreview } from "@/components/reviews/ReviewPreview";

const VALID_CADENCES: ReviewCadence[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

/** How long the page waits after the last keystroke before it writes the review. */
const AUTOSAVE_DELAY_MS = 700;

function resolveCadence(param: string | undefined): ReviewCadence | null {
  if (param && VALID_CADENCES.includes(param as ReviewCadence)) {
    return param as ReviewCadence;
  }
  return null;
}

/**
 * The review document, and the interview that fills it.
 *
 * THE DOCUMENT IS THE PAGE. A review opens in the same box a daily note opens in
 * — `LiveMarkdownEditor`, rendered as it is written, saving itself — because a
 * review *is* a document the operator writes, and it was previously a read-only
 * summary whose edit state had to be entered and left by hand. The sectioned
 * summary is still here behind Preview, for reading a period back.
 *
 * The previous shape also swallowed the operator's own writing: the summary
 * extracted only the four required headings per section, so a heading or an
 * `# H2` typed outside that skeleton simply did not appear. Whatever the file
 * holds, the editor shows — and Preview now renders the whole body rather than a
 * selection of it.
 *
 * START IS THREE THINGS, IN THIS ORDER. It writes the review file if the period
 * has none, it runs the cadence's snapshot rules so the figures the operator
 * asked for are already under the right heading, and only then does it ask the
 * agent for a session. The order is the point: before this, Start was a single
 * call that created a chat, so an agent that was not running failed the whole
 * action with the transport's own words — "fetch failed" — and the operator got
 * neither the document nor the interview. Now the document is open and filled
 * whatever the agent is doing, and a gateway that is down is reported as the one
 * thing that failed, in words that name where to fix it.
 */
export default function ReviewPage() {
  const { cadence: rawCadence } = useParams<{ cadence: string }>();
  const cadenceParam = resolveCadence(rawCadence);
  const cadence: ReviewCadence = cadenceParam ?? "weekly";
  const navigate = useNavigate();
  const { snapshot, refresh, setActiveSlug } = useVault();
  const lens = useDomainLens();
  const chatDock = useChatDock();

  const weekStartDay = snapshot?.settings.weekStartDay ?? "monday";

  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The period whose body is in `draft`; null while one is still on its way in. */
  const [loadedPeriod, setLoadedPeriod] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"document" | "preview">("document");
  const [skill, setSkill] = useState<ReviewSkill | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState("");
  const [skillSaving, setSkillSaving] = useState(false);

  const basePeriod = useMemo(
    () => currentPeriod(cadence, weekStartDay),
    [cadence, weekStartDay],
  );

  const [period, setPeriod] = useState(basePeriod);

  useEffect(() => {
    setPeriod(basePeriod);
  }, [basePeriod]);

  useEffect(() => {
    if (isFuturePeriod(cadence, period, weekStartDay)) {
      setPeriod(currentPeriod(cadence, weekStartDay));
      setError("That period is in the future. Showing the current period.");
    }
  }, [cadence, period, weekStartDay]);

  // Active scope: overall when overview/unassigned/non-domain, domain slug otherwise
  const activeScope: "overall" | string = useMemo(() => {
    if (!lens || lens.kind !== "domain" || !lens.slug) return "overall";
    return lens.slug;
  }, [lens]);

  // A load for a period the operator has already left must not land in the editor.
  const loadToken = useRef(0);
  // Writes go through here one at a time, in the order the page asked for them, so
  // a period is never read before the write that belongs to it has landed.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The newest draft that still has to reach the vault, tagged with its period.
  // Held in a ref rather than in state because a blur or an unmount flushes it
  // outside any render.
  const unsaved = useRef<{ period: string; body: string } | null>(null);
  const refused = useRef<{ period: string; body: string } | null>(null);

  const loadRecord = useCallback(
    async (targetPeriod: string) => {
      const token = ++loadToken.current;
      setLoading(true);
      setError(null);
      try {
        const result = await api().reviewGet(cadence, targetPeriod);
        if (token !== loadToken.current) return;
        if (result.ok) {
          const body = asHeld(result.value.bodyMarkdown);
          setRecord(result.value);
          setDraft(body);
          setSavedBody(body);
        } else if (/not found/i.test(result.error)) {
          // An empty state, not an error: a period nobody has reviewed yet.
          setRecord(null);
          setDraft("");
          setSavedBody("");
        } else {
          setError(result.error);
          setRecord(null);
        }
        setLoadedPeriod(targetPeriod);
      } catch (err) {
        if (token !== loadToken.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoadedPeriod(targetPeriod);
      } finally {
        if (token === loadToken.current) setLoading(false);
      }
    },
    [cadence],
  );

  useEffect(() => {
    setNotice(null);
    refused.current = null;
    unsaved.current = null;
    void loadRecord(period);
  }, [loadRecord, period]);

  /**
   * Write one review. Answers `saved` when the vault holds the body, `refused`
   * when the vault declined it, and `failed` when the write did not complete.
   */
  const writeReview = useCallback(
    async (targetPeriod: string, body: string): Promise<"saved" | "refused" | "failed"> => {
      const run = async (): Promise<"saved" | "refused" | "failed"> => {
        setSaving(true);
        try {
          const result = await api().reviewWrite(cadence, targetPeriod, body);
          if (!result.ok) {
            setError(result.error);
            refused.current = { period: targetPeriod, body };
            return "refused";
          }
          setError(null);
          refused.current = null;
          setRecord(result.value);
          // The file is the truth, and the box takes the body the vault actually
          // holds back only when the two really are different notes — handing the
          // answer back unconditionally re-cuts the paragraph under the caret.
          const written = asHeld(result.value.bodyMarkdown);
          setSavedBody(written);
          setDraft((current) => {
            if (!sameNote(current, body)) return current;
            return sameNote(current, written) ? current : written;
          });
          return "saved";
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          refused.current = { period: targetPeriod, body };
          return "failed";
        } finally {
          setSaving(false);
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    [cadence],
  );

  /** Write whatever is pending right now. */
  const flush = useCallback(async (): Promise<"saved" | "refused" | "failed"> => {
    await queue.current;
    const job = unsaved.current;
    if (!job) return "saved";
    unsaved.current = null;
    const outcome = await writeReview(job.period, job.body);
    if (outcome !== "saved") unsaved.current = job;
    return outcome;
  }, [writeReview]);

  const onDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      setError(null);
      // Recorded here rather than in the effect below, so a blur that beats the
      // next paint still finds the draft it has to save.
      unsaved.current =
        loadedPeriod === period && !sameNote(next, savedBody)
          ? { period, body: next }
          : null;
    },
    [loadedPeriod, period, savedBody],
  );

  useEffect(() => {
    if (loadedPeriod !== period) return;
    if (sameNote(draft, savedBody)) {
      unsaved.current = null;
      return;
    }
    unsaved.current = { period, body: draft };
    const held = refused.current;
    if (held && held.period === period && held.body === draft) return;
    if (saving) return;
    const timer = window.setTimeout(() => {
      void flush();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, savedBody, loadedPeriod, period, saving, flush]);

  // The page itself can go away with a draft still pending: a closed window is
  // the one exit that is not gated on the write.
  useEffect(() => () => void flush(), [flush]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  const loadSkill = useCallback(async () => {
    try {
      const result = await api().reviewSkillGet(cadence);
      if (!result.ok) return;
      setSkill(result.value);
      setSkillDraft(result.value.markdown);
    } catch {
      // The rules panel is a convenience; the review is the page.
    }
  }, [cadence]);

  useEffect(() => {
    setSkill(null);
    setSkillOpen(false);
  }, [cadence]);

  const onSaveSkill = useCallback(async () => {
    setSkillSaving(true);
    setError(null);
    try {
      const result = await api().reviewSkillWrite(cadence, skillDraft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSkill(result.value);
      setSkillDraft(result.value.markdown);
      setNotice(
        result.value.problems.length > 0
          ? `Saved, but ${result.value.problems.length} snapshot rule(s) could not be read: ${result.value.problems.join("; ")}`
          : "Review rules saved.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSkillSaving(false);
    }
  }, [cadence, skillDraft]);

  /** The snapshot pass, said as one line the operator can check. */
  const describeSnapshots = useCallback(
    (result: ReviewPrepopulateResult): string | null => {
      const parts: string[] = [];
      if (result.applied > 0) {
        parts.push(
          `filled ${result.applied} snapshot${result.applied === 1 ? "" : "s"}`,
        );
      }
      if (result.planted.length > 0) {
        parts.push(`added the ${result.planted.join(", ")} section`);
      }
      const failed = result.outcomes.filter((o) => o.status === "failed");
      for (const outcome of failed) {
        parts.push(`${outcome.title} could not run: ${outcome.reason}`);
      }
      return parts.length > 0 ? parts.join(" · ") : null;
    },
    [],
  );

  /**
   * Create the period's review file and open it, without starting an interview.
   *
   * A review is normally born with its interview, but the document is the
   * operator's and they may want to write it themselves. Doing it here rather
   * than letting an edit imply it is deliberate: the vault refuses a write to a
   * period with no review, and a page that offered a writing line it could not
   * save would report "Review file not found" under every keystroke.
   */
  const onOpenDocument = useCallback(async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const ensure = await api().reviewEnsure(cadence, period, activeScope);
      if (!ensure.ok) {
        setError(ensure.error);
        return;
      }
      setRecord(ensure.value);
      setDraft(asHeld(ensure.value.bodyMarkdown));
      setSavedBody(asHeld(ensure.value.bodyMarkdown));
      setLoadedPeriod(period);
      setMode("document");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeScope, cadence, period, snapshot]);

  const onStart = useCallback(async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // 0. Whatever the operator has already typed reaches the vault first: the
      //    snapshot pass rewrites the body, and a draft it never saw would go
      //    under it.
      if ((await flush()) === "failed") return;

      // 1. The document exists. Everything else is optional next to this.
      const ensure = await api().reviewEnsure(cadence, period, activeScope);
      if (!ensure.ok) {
        setError(ensure.error);
        return;
      }
      setRecord(ensure.value);
      setDraft(asHeld(ensure.value.bodyMarkdown));
      setSavedBody(asHeld(ensure.value.bodyMarkdown));
      setLoadedPeriod(period);
      setMode("document");

      // 2. The figures the cadence's rules ask for, filled by the app rather
      //    than the model, so they are there whether or not an agent is.
      const filled = await api().reviewPrepopulate(cadence, period, activeScope);
      let filledLine: string | null = null;
      if (filled.ok) {
        if (filled.value.applied > 0 || filled.value.planted.length > 0) {
          setRecord((current) =>
            current ? { ...current, bodyMarkdown: filled.value.bodyMarkdown } : current,
          );
          setDraft(asHeld(filled.value.bodyMarkdown));
          setSavedBody(asHeld(filled.value.bodyMarkdown));
        }
        filledLine = describeSnapshots(filled.value);
      } else {
        filledLine = `Snapshots could not run: ${filled.error}`;
      }
      setNotice(filledLine);

      // 3. The interview, which needs the agent and is the only part that does.
      //    A gateway that is down leaves the document open and filled, and says
      //    so as the one thing that failed.
      const start = await api().reviewStartOrResume(cadence, period, activeScope);
      if (!start.ok) {
        setError(start.error);
        return;
      }
      const kickoff = start.value.created ? start.value.kickoff : undefined;
      chatDock.requestSession(start.value.sessionId, kickoff);
      setNotice(
        [
          filledLine,
          start.value.created ? "Started this review's chat." : "Opened this review's chat.",
        ]
          .filter(Boolean)
          .join(" · ") || null,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    activeScope,
    cadence,
    chatDock,
    describeSnapshots,
    flush,
    period,
    refresh,
    snapshot,
  ]);

  const onMarkDone = useCallback(async () => {
    if (!snapshot) return;
    if ((await flush()) === "failed") return;
    setBusy(true);
    setError(null);
    try {
      const result = await api().reviewMarkDone(cadence, period, activeScope);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
      await loadRecord(period);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeScope, cadence, flush, loadRecord, period, refresh, snapshot]);

  const onUnlock = useCallback(async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api().reviewUnlock(cadence, period);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
      await loadRecord(period);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [cadence, loadRecord, period, refresh, snapshot]);

  const onPlanNext = useCallback(async () => {
    if (!snapshot) return;
    const next = nextPeriod(cadence, period, weekStartDay);
    if (!next.ok) {
      setError(next.error);
      return;
    }
    if ((await flush()) === "failed") return;
    setBusy(true);
    setError(null);
    try {
      const plan = await api().planningStartOrResume(cadence, next.value, activeScope);
      if (!plan.ok) {
        setError(plan.error);
        return;
      }
      const kickoff = plan.value.created ? plan.value.kickoff : undefined;
      chatDock.requestSession(plan.value.sessionId, kickoff);
      navigate("/goals");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeScope, cadence, chatDock, flush, navigate, period, snapshot, weekStartDay]);

  const onSetActiveSlug = useCallback(
    (slug: string) => {
      void setActiveSlug(slug);
    },
    [setActiveSlug],
  );

  const goToPeriod = useCallback(
    async (target: string) => {
      if (target === period) return;
      // The period being left is written first, so prose never lands on another
      // week. A write that *failed* holds the operator here: nobody knows what
      // reached the disk.
      if ((await flush()) === "failed") return;
      setPeriod(target);
    },
    [flush, period],
  );

  const onPrev = useCallback(() => {
    const prevResult = previousPeriod(cadence, period, weekStartDay);
    if (prevResult.ok) void goToPeriod(prevResult.value);
  }, [cadence, goToPeriod, period, weekStartDay]);

  const onNext = useCallback(() => {
    const next = nextPeriod(cadence, period, weekStartDay);
    if (next.ok) void goToPeriod(next.value);
  }, [cadence, goToPeriod, period, weekStartDay]);

  const isOnCurrentPeriod = isCurrentPeriod(cadence, period, weekStartDay);
  const title = useMemo(
    () => periodTitle(cadence, period, weekStartDay),
    [cadence, period, weekStartDay],
  );

  const domainName =
    activeScope === "overall"
      ? null
      : snapshot?.domains.find((d) => d.slug === activeScope)?.meta.name ??
        null;

  if (!cadenceParam) {
    return <Navigate to="/review/weekly" replace />;
  }

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  const liveDomains = snapshot.domains
    .filter((d) => !d.meta.archivedAt)
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);

  const locked = record?.locked === true;
  const dirty = !sameNote(draft, savedBody);
  const status = locked
    ? "Locked"
    : saving
      ? "Saving…"
      : dirty
        ? refused.current?.period === period && refused.current.body === draft
          ? "Not saved"
          : "Saving…"
        : record
          ? "Saved"
          : "No review for this period yet";

  return (
    <div className="review-page">
      <header className="review-page__header">
        <h1 className="review-page__title">
          {cadence.charAt(0).toUpperCase() + cadence.slice(1)} review
        </h1>
        <div className="review-page__pager">
          <Button variant="outline" data-testid="review-prev" onClick={onPrev}>
            ‹ Prev
          </Button>
          <span className="review-page__period" data-testid="review-period">
            {title}
          </span>
          <Button
            variant="outline"
            data-testid="review-next"
            onClick={onNext}
            disabled={isOnCurrentPeriod}
          >
            Next ›
          </Button>
          {locked ? (
            <span className="review-page__lock-badge">Locked</span>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert" data-testid="review-error">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="review-page__notice" data-testid="review-notice" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading review…</p>
      ) : !record ? (
        // A period nobody has reviewed yet. There is no file to write into, so
        // there is no box: the two ways to make one are the whole page.
        <div className="review-page__empty" data-testid="review-empty">
          <p className="muted">No review for this period yet.</p>
          <div className="review-page__actions">
            <Button
              variant="primary"
              data-testid="review-start"
              onClick={onStart}
              disabled={busy}
            >
              {busy ? "Starting…" : "Start the interview"}
            </Button>
            <Button
              variant="outline"
              data-testid="review-open-document"
              onClick={onOpenDocument}
              disabled={busy}
            >
              Write it myself
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="review-page__modes" role="group" aria-label="Review view">
            <Button
              variant={mode === "document" ? "primary" : "outline"}
              data-testid="review-mode-document"
              onClick={() => setMode("document")}
            >
              Document
            </Button>
            <Button
              variant={mode === "preview" ? "primary" : "outline"}
              data-testid="review-mode-preview"
              onClick={() => setMode("preview")}
            >
              Preview
            </Button>
            <span className="muted review-page__status" data-testid="review-status">
              {status}
            </span>
          </div>

          {mode === "document" ? (
            <div
              className="review-page__editor"
              // The pointer leaving the box — for another pane, another app — is
              // the operator stepping away, so the review is written then rather
              // than at the end of the debounce. Moving between paragraphs stays
              // inside.
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                void flush();
              }}
            >
              <LiveMarkdownEditor
                testId="review-editor"
                value={draft}
                onChange={onDraftChange}
                slug={`review-${cadence}-${period}`}
                ariaLabel={`${title} review`}
                placeholder="Write this review."
                readOnly={locked}
              />
            </div>
          ) : (
            // The whole file, rendered — not an extract of the four required
            // headings. A heading the operator typed is their document, and a
            // preview that dropped it is what made the editor feel like it was
            // ignoring what they wrote.
            <div className="review-page__preview" data-testid="review-preview">
              <MarkdownView
                markdown={record.bodyMarkdown}
                slug={`review-${cadence}-${period}`}
              />
              <ReviewPreview
                record={record}
                scope={activeScope}
                domainName={domainName}
                liveDomains={liveDomains}
                onSetActiveSlug={onSetActiveSlug}
                domainsOnly
              />
            </div>
          )}

          <div className="review-page__actions">
            <Button
              variant="primary"
              data-testid="review-start"
              onClick={onStart}
              disabled={busy}
            >
              {busy ? "Starting…" : "Start interview"}
            </Button>
            <Button
              variant="outline"
              data-testid="review-plan-next"
              onClick={onPlanNext}
              disabled={busy}
            >
              Plan next period
            </Button>
            <Button
              variant="outline"
              data-testid="review-mark-done"
              onClick={onMarkDone}
              disabled={busy || !record}
            >
              Mark done
            </Button>
            {locked ? (
              <Button
                variant="outline"
                data-testid="review-unlock"
                onClick={onUnlock}
                disabled={busy}
              >
                Unlock
              </Button>
            ) : null}
          </div>

          {/* The cadence's standing rules: what every review of this cadence is
              told, and the snapshot rules the app runs before the interview. The
              operator can add a rule here directly, or ask the companion to. */}
          <section className="review-page__skill">
            <button
              type="button"
              className="review-page__skill-toggle"
              data-testid="review-skill-toggle"
              aria-expanded={skillOpen}
              onClick={() => {
                const next = !skillOpen;
                setSkillOpen(next);
                if (next && !skill) void loadSkill();
              }}
            >
              <span>Review rules</span>
              <span className="muted">
                {skill
                  ? `${skill.snapshots.length} snapshot${skill.snapshots.length === 1 ? "" : "s"} · ${skill.exists ? "your file" : "defaults"}`
                  : "what this review session is told"}
              </span>
            </button>
            {skillOpen ? (
              <div className="review-page__skill-body">
                <p className="muted review-page__skill-hint">
                  Every line here is handed to this cadence&rsquo;s review session,
                  and a <code>lifequest-snapshot</code> block is a figure the app
                  fills into the review itself. Ask the companion to add a rule, or
                  write one here.
                </p>
                <LiveMarkdownEditor
                  testId="review-skill-editor"
                  value={skillDraft}
                  onChange={setSkillDraft}
                  slug={`review-skill-${cadence}`}
                  ariaLabel={`${cadence} review rules`}
                />
                {skill && skill.problems.length > 0 ? (
                  <ul className="review-page__skill-problems">
                    {skill.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="review-page__actions">
                  <Button
                    variant="primary"
                    data-testid="review-skill-save"
                    onClick={onSaveSkill}
                    disabled={skillSaving || !skill}
                  >
                    {skillSaving ? "Saving…" : "Save rules"}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </>
      )}

      {/* The days the operator wrote, under the review body and its controls:
          the same notes the companion's period pack carries. Scope-independent
          by design — a note belongs to no domain. */}
      <DailyNotesPanel
        cadence={cadence}
        period={period}
        weekStartDay={weekStartDay}
      />
    </div>
  );
}
