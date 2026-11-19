import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams, useNavigate } from "react-router-dom";
import {
  DEFAULT_REVIEW_AVAILABILITY,
  currentPeriod,
  formatReviewOpening,
  nextPeriod,
  openReviewPeriod,
  previousPeriod,
  periodLabel,
  periodTitle,
  periodTodayLocalIso,
  reviewOpensAt,
  type ReviewCadence,
  type ReviewPrepopulateResult,
  type ReviewRecord,
  type ReviewSkill,
  unlockedAreas,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { asHeld, sameNote } from "@/lib/note-body";
import { useVault } from "@/state/VaultProvider";
import { useChatDock } from "@/state/ChatDockProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
import { AreaReviewsPanel } from "@/components/reviews/AreaReviewsPanel";
import { DailyNotesPanel } from "@/components/reviews/DailyNotesPanel";
import { ReviewPeriodPicker } from "@/components/reviews/ReviewPeriodPicker";
import { WingEyebrow } from "@/components/shell/WingEyebrow";
import type { EyebrowPage } from "@/components/shell/wing-eyebrow";

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
 *
 * THE PAGE OPENS ON AN OPEN WINDOW, NOT ON THE CALENDAR. Each cadence's review
 * becomes writable a little before its period ends — how long, and at what wall
 * clock time, is the operator's to set in Settings › Review. Until the window
 * for the calendar's own period opens, the page stays on the previous period,
 * which is still theirs to write; the latest period whose window is open is the
 * page's base, the pager cannot move past it, and a note under the header says
 * when the calendar's period opens. Everything else here — autosave, Prev/Next,
 * Start, lock, rules, daily notes — behaves as it did.
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

  // The windows the operator has configured, one per cadence. A vault written
  // before the setting existed has no key here, so the built-in windows stand in
  // rather than the page showing a period that in fact cannot be written.
  const availability =
    snapshot?.settings.reviewAvailability ?? DEFAULT_REVIEW_AVAILABILITY;

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
  const [skill, setSkill] = useState<ReviewSkill | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState("");
  const [skillSaving, setSkillSaving] = useState(false);
  /** The area slug whose section the page should bring into view, if any. */
  const [scrollToArea, setScrollToArea] = useState<string | null>(null);

  // The latest period whose window is open — where the page lands and the wall
  // the pager cannot pass. Memoised on the availability object so a settings
  // change that moves a window also moves the page.
  const basePeriod = useMemo(
    () => openReviewPeriod(cadence, weekStartDay, availability),
    [cadence, weekStartDay, availability],
  );

  const [period, setPeriod] = useState(basePeriod);

  useEffect(() => {
    setPeriod(basePeriod);
  }, [basePeriod]);

  useEffect(() => {
    // A period after the open one cannot be written yet: its review window has
    // not begun. The pager does not offer it (Next stops at the base), so this
    // catches a stale period from an earlier navigation or a settings change
    // that closes a window the page was sitting on.
    if (period > basePeriod) {
      setPeriod(basePeriod);
      setError("That period has not opened yet. Showing the latest open period.");
    }
  }, [basePeriod, period]);

  // The calendar's own period, which is the one the note under the header talks
  // about: when the page is on an earlier one, the operator is waiting for this
  // period's window to open.
  const calendarCurrent = useMemo(
    () => currentPeriod(cadence, weekStartDay),
    [cadence, weekStartDay],
  );

  // Said only while the calendar-current period is still closed: once the window
  // opens the page is already on that period and there is nothing to wait for.
  // `reviewOpensAt` answers a Result; a period the engine cannot place simply
  // shows no note rather than a sentence with an empty date in it.
  const windowNote = useMemo(() => {
    if (!snapshot || calendarCurrent === basePeriod) return null;
    const opensAt = reviewOpensAt(
      cadence,
      calendarCurrent,
      weekStartDay,
      availability,
    );
    if (!opensAt.ok) return null;
    return `The ${cadence} review for the current period opens ${formatReviewOpening(opensAt.value)}.`;
  }, [availability, basePeriod, cadence, calendarCurrent, snapshot, weekStartDay]);

  /**
   * The daily review is one general review: it has a single `overall` scope, no
   * area sections, and it deliberately ignores the title-bar area lens.
   */
  const isDaily = cadence === "daily";

  // Active scope: overall when daily/overview/unassigned/non-domain, domain slug
  // otherwise.
  const activeScope: "overall" | string = useMemo(() => {
    if (isDaily) return "overall";
    if (!lens || lens.kind !== "domain" || !lens.slug) return "overall";
    return lens.slug;
  }, [isDaily, lens]);

  // The live areas: the checklist's rows, and the set the life review is gated
  // on. The base `life` area is the whole-vault container, not a scoped review,
  // so `unlockedAreas` leaves it out.
  const liveAreas = useMemo(
    () => (snapshot ? unlockedAreas(snapshot.domains) : []),
    [snapshot],
  );

  const activeDomainName = useMemo(() => {
    if (activeScope === "overall") return null;
    return (
      snapshot?.domains.find((domain) => domain.slug === activeScope)?.meta
        .name ?? null
    );
  }, [activeScope, snapshot]);

  // A load for a period the operator has already left must not land in the editor.
  const loadToken = useRef(0);
  // The same, for the background read below: it is a second door onto the file,
  // so it gets its own token rather than disturbing the page's own load.
  const refreshToken = useRef(0);
  // The period currently on screen, for a read that resolves after a move.
  const periodRef = useRef(period);
  useEffect(() => {
    periodRef.current = period;
  }, [period]);
  // The record as last rendered, so a background read can tell the empty state
  // (no file, no editor, nothing to lose) from a page that holds a review.
  const recordRef = useRef<ReviewRecord | null>(null);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
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
   * Re-read the review this page is on, for a change it did not make itself.
   *
   * The reported case is the companion finishing an interview: it marks an area
   * — or the life review — done with its own tool call in the main process, so
   * this page made no IPC call the answer could re-render it from. The vault's
   * change signal is the only announcement that reaches the renderer, and this
   * background read is what turns it into "Done" on the checklist while the
   * page is already open. Before this, the row only flipped after the operator
   * navigated away and back.
   *
   * It is deliberately NOT `loadRecord`. This is a background read: it never
   * shows a spinner, never puts an error banner over a page that is still
   * readable, and never touches the box — the operator's draft is theirs until
   * they save it, and a refresh that ate a sentence would be worse than the
   * stale checklist it fixes. The one thing it does adopt whole is a file that
   * appeared where the period had none: there is no editor and no draft in that
   * empty state, so the page can simply show the review the agent created.
   */
  const refreshRecord = useCallback(
    async (targetPeriod: string) => {
      // The write the operator's own autosave queued has to land first, or the
      // read answers with the file as it stood before their last keystroke.
      await queue.current;
      const token = ++refreshToken.current;
      try {
        const result = await api().reviewGet(cadence, targetPeriod);
        if (token !== refreshToken.current) return;
        // A read for a period the operator has already left must not land.
        if (periodRef.current !== targetPeriod) return;
        if (!result.ok) return;
        const next = result.value;
        const wasEmpty = recordRef.current === null;
        recordRef.current = next;
        setRecord(next);
        if (wasEmpty) {
          const body = asHeld(next.bodyMarkdown);
          setDraft(body);
          setSavedBody(body);
          setLoadedPeriod(targetPeriod);
        }
      } catch {
        // A background read that fails changes nothing: the page keeps the
        // record it is showing, and the next change tries again.
      }
    },
    [cadence],
  );

  // The vault's change signal is the only way this page hears about a write it
  // did not make: a companion or paired agent marking a scope done is a tool
  // call in the main process, never an IPC call from this renderer. Subscribing
  // is what makes the checklist live.
  useEffect(() => {
    let stop: (() => void) | undefined;
    try {
      stop = api().onVaultDataChanged(() => {
        void refreshRecord(periodRef.current);
      });
    } catch {
      // No bridge (a harness page, or a window opened before preload): the
      // checklist still updates on the next period change or page load.
      stop = undefined;
    }
    return () => stop?.();
  }, [refreshRecord]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeScope, cadence, period, snapshot]);

  /**
   * Start one scope of this review — the whole review, or one area's part of it.
   *
   * `scope` is a parameter rather than the page's `activeScope` on purpose: the
   * checklist sets the lens and then starts, and the start has to be for the
   * scope the operator pressed even though the lens lands on the next render.
   */
  const runStart = useCallback(
    async (scope: "overall" | string) => {
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
        const ensure = await api().reviewEnsure(cadence, period, scope);
        if (!ensure.ok) {
          setError(ensure.error);
          return;
        }
        setRecord(ensure.value);
        setDraft(asHeld(ensure.value.bodyMarkdown));
        setSavedBody(asHeld(ensure.value.bodyMarkdown));
        setLoadedPeriod(period);

        // 2. The figures the cadence's rules ask for, filled by the app rather
        //    than the model, so they are there whether or not an agent is.
        const filled = await api().reviewPrepopulate(cadence, period, scope);
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
        const start = await api().reviewStartOrResume(cadence, period, scope);
        if (!start.ok) {
          setError(start.error);
          return;
        }
        const kickoff = start.value.created ? start.value.kickoff : undefined;
        chatDock.requestSession({
          id: start.value.sessionId,
          kickoff,
          // The row the gateway just made (or the resumed one): the dock lists
          // this review's chat in Chats under its name from the first paint,
          // rather than waiting for the next session-list read — which does not
          // happen until the interview's turn settles, so the chat was missing
          // from the sidebar for the whole run.
          session: start.value.session,
          icon: "review",
        });
        setNotice(
          [
            filledLine,
            start.value.created ? "Started this review's chat." : "Opened this review's chat.",
          ]
            .filter(Boolean)
            .join(" · ") || null,
        );
        // Bring the area's own section into view. The file is one long document
        // and the interview is about the section that was just started, so
        // opening on the top of the file would hide the very part in play.
        if (!isDaily && scope !== "overall") setScrollToArea(scope);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [
      cadence,
      chatDock,
      describeSnapshots,
      flush,
      isDaily,
      period,
      refresh,
      snapshot,
    ],
  );

  /** A checklist row: set the lens first, then start that scope's review. */
  const startFromRail = useCallback(
    async (scope: "overall" | string) => {
      await setActiveSlug(scope === "overall" ? null : scope);
      await runStart(scope);
    },
    [runStart, setActiveSlug],
  );

  /** The scope line's way back to the whole-life review: no session is started. */
  const onOpenLifeScope = useCallback(() => {
    void setActiveSlug(null);
  }, [setActiveSlug]);

  // The area section a checked-out row asked for, brought into view once the
  // document has committed the body that holds it. Best effort by design: the
  // editor is a whole-file box, so the heading is found in the rendered blocks
  // and scrolled to; a heading that is not drawn is simply not scrolled to.
  useEffect(() => {
    if (!scrollToArea) return;
    const area = liveAreas.find((item) => item.slug === scrollToArea);
    if (!area) {
      setScrollToArea(null);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const box = document.querySelector('[data-testid="review-editor"]');
      if (box) {
        const name = area.meta.name.trim().toLowerCase();
        const heading = Array.from(box.querySelectorAll("h1, h2, h3, h4")).find(
          (element) => (element.textContent ?? "").trim().toLowerCase() === name,
        );
        const target = heading?.closest("[data-note-block]") ?? heading;
        target?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      setScrollToArea(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToArea, liveAreas, draft, loadedPeriod, period]);

  const onMarkDone = useCallback(async () => {
    if (!snapshot) return;
    if ((await flush()) === "failed") return;
    setBusy(true);
    setError(null);
    const scope = activeScope;
    try {
      const result = await api().reviewMarkDone(cadence, period, scope);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const after = result.value;
      const allDoneNow =
        liveAreas.length === 0 ||
        liveAreas.every((area) => after.scopes[area.slug]?.status === "done");
      const wasAllDone =
        liveAreas.length === 0 ||
        liveAreas.every((area) => record?.scopes[area.slug]?.status === "done");
      if (isDaily) {
        setNotice("Review complete.");
      } else if (scope === "overall") {
        setNotice("Life review complete.");
      } else {
        const name =
          liveAreas.find((area) => area.slug === scope)?.meta.name ?? "Area";
        setNotice(
          allDoneNow && !wasAllDone
            ? "Every area is reviewed — the life review is ready."
            : `${name} review complete.`,
        );
      }
      await refresh();
      await loadRecord(period);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    activeScope,
    cadence,
    flush,
    isDaily,
    liveAreas,
    loadRecord,
    period,
    record,
    refresh,
    snapshot,
  ]);

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
      chatDock.requestSession({
        id: plan.value.sessionId,
        kickoff,
        // The plan chat's own row, so the dock lists it in Chats from the first
        // paint instead of waiting for the next session-list read.
        session: plan.value.session,
        icon: "plan",
      });
      navigate("/goals");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeScope, cadence, chatDock, flush, navigate, period, snapshot, weekStartDay]);

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
    if (!next.ok) return;
    // Next stops at the latest open period: anything after it has no window yet,
    // so stepping there would open a review the vault will not let anyone write.
    if (next.value > basePeriod) return;
    void goToPeriod(next.value);
  }, [basePeriod, cadence, goToPeriod, period, weekStartDay]);

  /** The calendar beside the period chose a period: move there, as a step does. */
  const onPickPeriod = useCallback(
    (next: string) => {
      if (next !== period) void goToPeriod(next);
    },
    [goToPeriod, period],
  );

  const isOnBasePeriod = period === basePeriod;
  const title = useMemo(
    () => periodTitle(cadence, period, weekStartDay),
    [cadence, period, weekStartDay],
  );
  /**
   * The page's heading: the period alone. The cadence is the page's eyebrow, so
   * repeating it in a title would say the same thing twice — the daily journal
   * heads its page with the day, not with the words "Daily Note".
   */
  const headline = useMemo(
    () => periodLabel(cadence, period, weekStartDay),
    [cadence, period, weekStartDay],
  );

  /**
   * The eyebrow names the cadence's own page: "Daily" for the daily review,
   * "Weekly" for the weekly one, and so on. The cadence is
   * already one of the review page names, so the label is its capitalised
   * form.
   */
  const cadenceLabel =
    cadence.charAt(0).toUpperCase() + cadence.slice(1);

  if (!cadenceParam) {
    return <Navigate to="/review/weekly" replace />;
  }

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  const locked = record?.locked === true;

  // The life review is gated on the areas, and derived exactly as the rail derives
  // it: a live area whose scope is not `done` gates the whole-life review, and a
  // period with no file has nothing done, so it is gated too. No live areas means
  // there is nothing to gate behind.
  const allAreasDone =
    liveAreas.length === 0 ||
    liveAreas.every((area) => record?.scopes[area.slug]?.status === "done");
  const lifeReviewGated =
    !isDaily && activeScope === "overall" && !allAreasDone;
  const lifeReviewGateHint = "Finish every area review first";

  // The first area whose review is not done: what the empty state's one button
  // starts when the period has no file yet. When there are none — or no areas at
  // all — that button is the life review's.
  const firstUnfinishedArea = liveAreas.find(
    (area) => record?.scopes[area.slug]?.status !== "done",
  );

  const markDoneLabel = isDaily
    ? "Mark review complete"
    : activeScope === "overall"
      ? "Mark life review complete"
      : `Mark ${activeDomainName ?? "area"} review complete`;

  const emptyStartLabel = isDaily
    ? "Start the interview"
    : firstUnfinishedArea
      ? `Start the ${firstUnfinishedArea.meta.name} review`
      : "Start the life review";

  const startFromEmpty = () => {
    if (isDaily) {
      void runStart("overall");
      return;
    }
    void startFromRail(firstUnfinishedArea?.slug ?? "overall");
  };

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
    <div
      className={`review-page-layout${isDaily ? " review-page-layout--single" : ""}`}
      data-testid="review-layout"
    >
      <div className="review-page">
        <header className="review-page__header">
          {/* The page's name is the eyebrow, as on the Daily Journal: the period
              below is the page's one heading, so the cadence is not repeated as a
              second title. The lock, while it is on, is the page's one badge and
              rides the title row's trailing edge. */}
          <div className="review-page__title-row">
            <WingEyebrow page={cadenceLabel as EyebrowPage} />
            {locked ? (
              <div className="review-page__header-actions">
                <span className="review-page__lock-badge">Locked</span>
              </div>
            ) : null}
          </div>
          {/* The period row: the journal's day row, at a period's scale. The two
              step keys sit on the column's edges — wordless arrows, no frame, so
              they read as the page's margins rather than as chrome — while the
              period and its calendar are one block centred between them. Next
              stops at the open period: a later one has no window to write. */}
          <div className="review-page__pager">
            <Button
              variant="ghost"
              className="review-page__pager-prev"
              data-testid="review-prev"
              aria-label={`Previous ${cadence}`}
              title={`Previous ${cadence}`}
              onClick={onPrev}
            >
              <ChevronLeft size={20} aria-hidden />
            </Button>
            <div className="review-page__period-block">
              <h1
                className="review-page__title"
                data-testid="review-period"
                data-period={period}
              >
                {headline}
              </h1>
              <ReviewPeriodPicker
                cadence={cadence}
                period={period}
                weekStartDay={weekStartDay}
                latestPeriod={basePeriod}
                today={periodTodayLocalIso()}
                onSelect={onPickPeriod}
              />
            </div>
            <Button
              variant="ghost"
              className="review-page__pager-next"
              data-testid="review-next"
              aria-label={`Next ${cadence}`}
              title={`Next ${cadence}`}
              onClick={onNext}
              disabled={isOnBasePeriod}
            >
              <ChevronRight size={20} aria-hidden />
            </Button>
          </div>
        </header>

        {/* Why the page is on an earlier period than the calendar's: its window
            has not opened. Kept under the header, above any error, because it is
            context for what is on screen rather than a report about it. */}
        {windowNote ? (
          <p className="review-page__window" data-testid="review-window-note">
            {windowNote}
          </p>
        ) : null}

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
            <p className="muted">
              {isDaily
                ? "No review for this period yet."
                : "No review for this period yet — pick an area in the checklist to start its review."}
            </p>
            <div className="review-page__actions">
              <Button
                variant="primary"
                data-testid="review-start"
                onClick={startFromEmpty}
                disabled={busy}
              >
                {busy ? "Starting…" : emptyStartLabel}
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
            {/* The box is the page: there is no second view of it to switch
                between, so the row above the prose is only what the prose is —
                the scope line — and whether it has reached the vault. */}
            <div className="review-page__toolbar">
              {isDaily ? null : (
                <div className="review-page__scope" data-testid="review-scope">
                  <span className="review-page__scope-label">Reviewing</span>
                  <span
                    className="review-page__scope-name"
                    data-testid="review-scope-name"
                  >
                    {activeDomainName ?? "Life"}
                  </span>
                  {activeScope === "overall" ? null : (
                    <button
                      type="button"
                      className="review-page__scope-link"
                      data-testid="review-scope-life"
                      onClick={onOpenLifeScope}
                    >
                      Whole-life review
                    </button>
                  )}
                </div>
              )}
              <span className="muted review-page__status" data-testid="review-status">
                {status}
              </span>
            </div>

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
                  ariaLabel={title}
                  placeholder="Write this review."
                  readOnly={locked}
                />
            </div>

            <div className="review-page__actions">
              <Button
                variant="primary"
                data-testid="review-start"
                onClick={() => void runStart(activeScope)}
                disabled={busy || lifeReviewGated}
                title={lifeReviewGated ? lifeReviewGateHint : undefined}
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
                disabled={busy || !record || lifeReviewGated}
                title={lifeReviewGated ? lifeReviewGateHint : undefined}
              >
                {markDoneLabel}
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

      {/* The checklist is the page's second column on a weekly-or-longer
          review, and the daily review has none: a day is one general review, so
          there is nothing to tick off beside it. */}
      {isDaily ? null : (
        <AreaReviewsPanel
          record={record}
          liveAreas={liveAreas}
          activeScope={activeScope}
          busy={busy}
          locked={locked}
          onStart={(scope) => {
            void startFromRail(scope);
          }}
        />
      )}
    </div>
  );
}
