import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  DEFAULT_REVIEW_AVAILABILITY,
  currentPeriod,
  formatReviewOpening,
  nextPeriod,
  openReviewPeriod,
  previousPeriod,
  periodBounds,
  periodLabel,
  periodTitle,
  periodTodayLocalIso,
  reviewOpensAt,
  type ReviewCadence,
  type ReviewNotebook,
  type ReviewPageBody,
  type ReviewPageSummary,
  type ReviewPrepopulateResult,
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

/** How long the page waits after the last keystroke before it writes the page. */
const AUTOSAVE_DELAY_MS = 700;

type PageStatus = "missing" | "draft" | "done";

/**
 * The status vocabulary the tabs share with the retired checklist: a page
 * nobody started, a page opened and in progress, and a page marked done.
 */
function statusLabel(status: PageStatus): string {
  return status === "done"
    ? "Done"
    : status === "draft"
      ? "In progress"
      : "Not started";
}

function resolveCadence(param: string | undefined): ReviewCadence | null {
  if (param && VALID_CADENCES.includes(param as ReviewCadence)) {
    return param as ReviewCadence;
  }
  return null;
}

/** The key a load/draft belongs to: one period, one page. */
function pageKey(period: string, scope: string): string {
  return `${period}|${scope}`;
}

/** Fold a just-written page into the notebook summary the tabs read. */
function withPageSummary(
  notebook: ReviewNotebook,
  page: ReviewPageBody,
): ReviewNotebook {
  const summary: ReviewPageSummary = {
    scope: page.scope,
    title: page.title,
    status: page.status === "missing" ? "draft" : page.status,
    sessionId: page.sessionId,
    rev: page.rev,
    updatedAt: page.updatedAt ?? new Date().toISOString(),
    chars: page.bodyMarkdown.length,
  };
  const exists = notebook.pages.some((row) => row.scope === page.scope);
  return {
    ...notebook,
    pages: exists
      ? notebook.pages.map((row) => (row.scope === page.scope ? summary : row))
      : [...notebook.pages, summary],
  };
}

/**
 * The review period, as a notebook of pages.
 *
 * THE PAGE IS ONE PAGE OF THE PERIOD. Weekly-or-longer reviews used to be one
 * file with an area section per area, beside a checklist rail. Every writer sent
 * the whole file, so concurrent interviews clobbered each other; the engine now
 * stores a page per area (Phase 1) and this page shows one at a time. The tab row
 * above the editor is the scope selection: Overall first, then each live area.
 * The area lens in the window title bar is the same selection seen from outside —
 * pressing a tab moves the lens, and a lens change moves the tab.
 *
 * THE CHECKLIST IS RETIRED. Its progress line survives above the tabs, the Start
 * / Mark complete / Unlock actions moved under the editor and act on the active
 * page, and an area with no page yet shows a page-scoped empty state instead of
 * quietly pre-creating every area.
 *
 * AUTOSAVE IS PER PAGE. The timer and the write queue belong to the page in the
 * box; switching tabs flushes the page being left first (a write that cannot land
 * holds the switch), so unsaved text never lands on another area. A live update
 * from the companion re-reads only the open page and the notebook summary; a
 * clean box adopts the new body, a dirty one keeps the draft and raises the
 * conflict banner.
 *
 * DAILY IS UNCHANGED. A day is one general review: no tabs, no progress line, no
 * areas. Internally it is the same single overall page.
 */
export default function ReviewPage() {
  const { cadence: rawCadence } = useParams<{ cadence: string }>();
  const cadence = resolveCadence(rawCadence) ?? "weekly";
  // A review page is ONE cadence: keying remounts the body so the period, the
  // notebook and the box all reset together when the cadence changes.
  return <ReviewPageFor key={cadence} />;
}

function ReviewPageFor() {
  const { cadence: rawCadence } = useParams<{ cadence: string }>();
  const cadenceParam = resolveCadence(rawCadence);
  const cadence: ReviewCadence = cadenceParam ?? "weekly";
  const navigate = useNavigate();
  const location = useLocation();
  const { snapshot, refresh, setActiveSlug } = useVault();
  const lens = useDomainLens();
  const chatDock = useChatDock();

  const weekStartDay = snapshot?.settings.weekStartDay ?? "monday";

  // The windows the operator has configured, one per cadence. A vault written
  // before the setting existed has no key here, so the built-in windows stand in
  // rather than the page showing a period that in fact cannot be written.
  const availability =
    snapshot?.settings.reviewAvailability ?? DEFAULT_REVIEW_AVAILABILITY;

  const [notebook, setNotebook] = useState<ReviewNotebook | null>(null);
  const [page, setPage] = useState<ReviewPageBody | null>(null);
  const [draft, setDraft] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The period|scope whose page body is in `draft`; null while one is loading. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skill, setSkill] = useState<ReviewSkill | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState("");
  const [skillSaving, setSkillSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  // The latest period whose window is open — where the page lands and the wall
  // the pager cannot pass. Memoised on the availability object so a settings
  // change that moves a window also moves the page.
  const basePeriod = useMemo(
    () => openReviewPeriod(cadence, weekStartDay, availability),
    [cadence, weekStartDay, availability],
  );

  // A `?period=` on the URL is a deep link into one period — the Analytics
  // matrix's column headers are the door. It is read once, here, so the first
  // load is the asked-for period rather than the latest period followed by a
  // second fetch. An invalid period, or one whose review window has not opened,
  // is ignored: the page lands where it would have without the link.
  const linkedPeriod = useMemo(() => {
    const raw = new URLSearchParams(location.search).get("period");
    if (!raw) return null;
    const bounds = periodBounds(cadence, raw, weekStartDay);
    if (!bounds.ok || raw > basePeriod) return null;
    return raw;
  }, [basePeriod, cadence, location.search, weekStartDay]);

  const [period, setPeriod] = useState(linkedPeriod ?? basePeriod);

  // The base period is where the page lands when the vault's review windows
  // move under it (a Settings change). It is not re-applied on mount, or the
  // deep link read above would be overwritten a moment after it was applied.
  const previousBasePeriod = useRef(basePeriod);
  useEffect(() => {
    if (previousBasePeriod.current === basePeriod) return;
    previousBasePeriod.current = basePeriod;
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
   * The daily review is one general review: it has a single `overall` page and
   * deliberately ignores the title-bar area lens.
   */
  const isDaily = cadence === "daily";

  // The live areas: the tabs beside Overall, and the set the life review is
  // gated on. The base `life` area is the whole-vault container, not an area
  // review, so `unlockedAreas` leaves it out.
  const liveAreas = useMemo(
    () => (snapshot ? unlockedAreas(snapshot.domains) : []),
    [snapshot],
  );

  // Active page: the lens's area when it is a live area, otherwise Overall.
  // Daily always reads Overall. This is also the tab selection: there is no
  // second source of truth.
  const activeScope: "overall" | string = useMemo(() => {
    if (isDaily) return "overall";
    if (!lens || lens.kind !== "domain" || !lens.slug) return "overall";
    return liveAreas.some((area) => area.slug === lens.slug)
      ? lens.slug
      : "overall";
  }, [isDaily, lens, liveAreas]);

  const activeDomainName = useMemo(() => {
    if (activeScope === "overall") return null;
    return (
      snapshot?.domains.find((domain) => domain.slug === activeScope)?.meta
        .name ?? null
    );
  }, [activeScope, snapshot]);

  // A load for a page the operator has already left must not land in the editor.
  const loadToken = useRef(0);
  // The same, for the background read below: it is a second door onto the page.
  const refreshToken = useRef(0);
  const periodRef = useRef(period);
  const scopeRef = useRef(activeScope);
  useEffect(() => {
    periodRef.current = period;
  }, [period]);
  useEffect(() => {
    scopeRef.current = activeScope;
  }, [activeScope]);
  // The page as last rendered, so a background read can tell the empty state
  // (a page nobody started) from a page that holds prose.
  const pageRef = useRef<ReviewPageBody | null>(null);
  const draftRef = useRef(draft);
  const savedBodyRef = useRef(savedBody);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    savedBodyRef.current = savedBody;
  }, [savedBody]);
  // Writes go through here one at a time, in the order the page asked for them,
  // so a page is never read before the write that belongs to it has landed.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // Bumped by every mutation this page starts. A background read that began
  // before the bump must not adopt its answer.
  const fileEpoch = useRef(0);
  // The newest draft that still has to reach the vault, tagged with its page.
  const unsaved = useRef<{
    key: string;
    period: string;
    scope: string;
    body: string;
  } | null>(null);
  const refused = useRef<{
    key: string;
    period: string;
    scope: string;
    body: string;
  } | null>(null);
  // A write raced another writer. The draft is kept, autosave is paused until
  // the operator reloads: sending the freshly-read rev with the old draft would
  // land the clobber this whole guard exists to stop.
  const conflictRef = useRef(false);
  // Roving focus for the tab row: select-then-focus, never Ctrl+Tab (the chat
  // strip owns that).
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const adoptPage = useCallback(
    (next: ReviewPageBody, targetPeriod: string, targetScope: string) => {
      pageRef.current = next;
      setPage(next);
      const body = asHeld(next.bodyMarkdown);
      draftRef.current = body;
      savedBodyRef.current = body;
      setDraft(body);
      setSavedBody(body);
      setLoadedKey(pageKey(targetPeriod, targetScope));
      conflictRef.current = false;
      setConflict(false);
    },
    [],
  );

  /**
   * Load one period and one page, with the notebook summary beside it.
   *
   * A period with no notebook is an empty state, not an error: the two ways to
   * start it are the page's own empty state.
   */
  const loadView = useCallback(
    async (targetPeriod: string, targetScope: string) => {
      const token = ++loadToken.current;
      // A load replaces the whole page state; a background read that began
      // before it must not land on top of it afterwards.
      fileEpoch.current += 1;
      setLoading(true);
      setError(null);
      try {
        const result = await api().reviewNotebookGet(cadence, targetPeriod);
        if (token !== loadToken.current) return;
        if (!result.ok) {
          if (/not found/i.test(result.error)) {
            setNotebook(null);
            setPage(null);
            pageRef.current = null;
            draftRef.current = "";
            savedBodyRef.current = "";
            setDraft("");
            setSavedBody("");
            setLoadedKey(pageKey(targetPeriod, targetScope));
            conflictRef.current = false;
            setConflict(false);
          } else {
            setError(result.error);
            setNotebook(null);
            setPage(null);
            setLoadedKey(pageKey(targetPeriod, targetScope));
          }
          return;
        }
        setNotebook(result.value);
        const pageResult = await api().reviewPageGet(
          cadence,
          targetPeriod,
          targetScope,
        );
        if (token !== loadToken.current) return;
        if (pageResult.ok) {
          adoptPage(pageResult.value, targetPeriod, targetScope);
        } else if (/not found/i.test(pageResult.error)) {
          // The notebook exists but this page's file is gone: the page's own
          // empty state offers to make it again.
          pageRef.current = null;
          setPage(null);
          draftRef.current = "";
          savedBodyRef.current = "";
          setDraft("");
          setSavedBody("");
          setLoadedKey(pageKey(targetPeriod, targetScope));
        } else {
          setError(pageResult.error);
          pageRef.current = null;
          setPage(null);
          setLoadedKey(pageKey(targetPeriod, targetScope));
        }
      } catch (err) {
        if (token !== loadToken.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoadedKey(pageKey(targetPeriod, targetScope));
      } finally {
        if (token === loadToken.current) setLoading(false);
      }
    },
    [adoptPage, cadence],
  );

  /**
   * Re-read the open page and the notebook summary, for a change this page did
   * not make itself (the companion finishing an interview writes through its own
   * tool calls in main). Only the open page is re-read.
   */
  const refreshView = useCallback(
    async (targetPeriod: string, targetScope: string) => {
      // The write the operator's own autosave queued has to land first, or the
      // read answers with the page as it stood before their last keystroke.
      await queue.current;
      const epoch = fileEpoch.current;
      const token = ++refreshToken.current;
      try {
        const notebookResult = await api().reviewNotebookGet(
          cadence,
          targetPeriod,
        );
        if (token !== refreshToken.current) return;
        if (periodRef.current !== targetPeriod) return;
        if (notebookResult.ok) setNotebook(notebookResult.value);
        const result = await api().reviewPageGet(
          cadence,
          targetPeriod,
          targetScope,
        );
        if (token !== refreshToken.current) return;
        if (periodRef.current !== targetPeriod) return;
        if (scopeRef.current !== targetScope) return;
        // A write the page started after this read began means the answer is
        // older than the page. Keeping the page's own newer state is the point.
        if (fileEpoch.current !== epoch) return;
        if (!result.ok) return;
        const next = result.value;
        const previous = pageRef.current;
        const wasMissing = previous === null || previous.status === "missing";
        const boxIsClean = sameNote(draftRef.current, savedBodyRef.current);
        pageRef.current = next;
        setPage(next);
        if (wasMissing || next.locked || next.status === "missing" || boxIsClean) {
          const body = asHeld(next.bodyMarkdown);
          draftRef.current = body;
          savedBodyRef.current = body;
          setDraft(body);
          setSavedBody(body);
          setLoadedKey(pageKey(targetPeriod, targetScope));
          // The page is what the box holds now; nothing is left to autosave.
          unsaved.current = null;
          conflictRef.current = false;
          setConflict(false);
        } else if (previous && previous.rev !== next.rev) {
          // The page moved on while the operator was typing. Keep the draft, but
          // stop the next autosave from writing the old text over the new rev.
          conflictRef.current = true;
          setConflict(true);
          refused.current = {
            key: pageKey(targetPeriod, targetScope),
            period: targetPeriod,
            scope: targetScope,
            body: draftRef.current,
          };
        }
      } catch {
        // A background read that fails changes nothing: the page keeps the page
        // it is showing, and the next change tries again.
      }
    },
    [cadence],
  );

  // The vault's change signal is the only way this page hears about a write it
  // did not make. Subscribing is what makes the tabs' statuses and the open box
  // live while the companion works.
  useEffect(() => {
    let stop: (() => void) | undefined;
    try {
      stop = api().onVaultDataChanged(() => {
        void refreshView(periodRef.current, scopeRef.current);
      });
    } catch {
      stop = undefined;
    }
    return () => stop?.();
  }, [refreshView]);

  /**
   * Write one page. Answers `saved` when the vault holds the page, `refused`
   * when the vault declined it, and `failed` when the write did not complete.
   */
  const writePage = useCallback(
    async (
      key: string,
      targetPeriod: string,
      targetScope: string,
      body: string,
    ): Promise<"saved" | "refused" | "failed"> => {
      const run = async (): Promise<"saved" | "refused" | "failed"> => {
        // A conflicted box stays paused until Reload: writing now would send the
        // newly-read rev with the operator's old text and win the race.
        if (conflictRef.current) {
          refused.current = { key, period: targetPeriod, scope: targetScope, body };
          return "refused";
        }
        // This write is about to change the page: a background read already in
        // flight is now older than the page's own state.
        fileEpoch.current += 1;
        setSaving(true);
        try {
          const current = pageRef.current;
          const baseRev =
            current && current.scope === targetScope ? current.rev : 0;
          const result = await api().reviewPageWrite(
            cadence,
            targetPeriod,
            targetScope,
            body,
            baseRev,
          );
          if (!result.ok) {
            if (result.code === "CONFLICT") {
              conflictRef.current = true;
              setConflict(true);
            } else {
              setError(result.message);
            }
            refused.current = {
              key,
              period: targetPeriod,
              scope: targetScope,
              body,
            };
            return "refused";
          }
          setError(null);
          setConflict(false);
          conflictRef.current = false;
          refused.current = null;
          pageRef.current = result.page;
          setPage(result.page);
          setNotebook((currentNotebook) =>
            currentNotebook
              ? withPageSummary(currentNotebook, result.page)
              : currentNotebook,
          );
          // The page is the truth, and the box takes the body the vault actually
          // holds back only when the two really are different notes — handing the
          // answer back unconditionally re-cuts the paragraph under the caret.
          const written = asHeld(result.page.bodyMarkdown);
          savedBodyRef.current = written;
          setSavedBody(written);
          setDraft((currentDraft) => {
            if (!sameNote(currentDraft, body)) return currentDraft;
            return sameNote(currentDraft, written) ? currentDraft : written;
          });
          return "saved";
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          refused.current = {
            key,
            period: targetPeriod,
            scope: targetScope,
            body,
          };
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
    const outcome = await writePage(job.key, job.period, job.scope, job.body);
    if (outcome !== "saved") unsaved.current = job;
    return outcome;
  }, [writePage]);

  const onDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      setError(null);
      // Recorded here rather than in the effect below, so a blur that beats the
      // next paint still finds the draft it has to save.
      unsaved.current =
        loadedKey === pageKey(period, activeScope) &&
        !sameNote(next, savedBody)
          ? {
              key: pageKey(period, activeScope),
              period,
              scope: activeScope,
              body: next,
            }
          : null;
    },
    [activeScope, loadedKey, period, savedBody],
  );

  useEffect(() => {
    if (loadedKey !== pageKey(period, activeScope)) return;
    if (!page || page.status === "missing") {
      unsaved.current = null;
      return;
    }
    if (sameNote(draft, savedBody)) {
      unsaved.current = null;
      return;
    }
    const key = pageKey(period, activeScope);
    unsaved.current = { key, period, scope: activeScope, body: draft };
    const held = refused.current;
    if (held && held.key === key && held.body === draft) return;
    if (saving) return;
    const timer = window.setTimeout(() => {
      void flush();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeScope, draft, flush, loadedKey, page, period, savedBody, saving]);

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

  // A period or page change writes the page being left first. A write that
  // cannot land holds the operator on the page it belongs to: nobody knows what
  // reached the disk. The load effect is keyed on the period and the page only;
  // the callbacks read the render they run in.
  const loadForSelection = useCallback(async () => {
    setNotice(null);
    setError(null);
    const outcome = await flush();
    if (outcome === "failed") return false;
    await loadView(periodRef.current, scopeRef.current);
    return true;
  }, [flush, loadView]);
  useEffect(() => {
    void loadForSelection();
  }, [loadForSelection, period, activeScope]);

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

  /** The figure pass, said as one line the operator can check. */
  const describeSnapshots = useCallback(
    (result: ReviewPrepopulateResult): string | null => {
      const parts: string[] = [];
      if (result.applied > 0) {
        parts.push(
          `filled ${result.applied} figure${result.applied === 1 ? "" : "s"}`,
        );
      }
      if (result.planted.length > 0) {
        parts.push(`added the ${result.planted.join(", ")} section`);
      }
      const failed = result.outcomes.filter((o) => o.status === "failed");
      for (const outcome of failed) {
        parts.push(`${outcome.title} could not run: ${outcome.reason}`);
      }
      // A skip is not a clean start: the rule was meant to write and had no
      // heading to write into, so the operator is told which rule found nothing.
      const skipped = result.outcomes.filter((o) => o.status === "skipped");
      for (const outcome of skipped) {
        parts.push(`Skipped: ${outcome.title} — ${outcome.reason}`);
      }
      return parts.length > 0 ? parts.join(" · ") : null;
    },
    [],
  );

  /** Read the open page again without a spinner, and put it in the box. */
  const reloadPage = useCallback(
    async (targetPeriod: string, targetScope: string) => {
      const result = await api().reviewPageGet(
        cadence,
        targetPeriod,
        targetScope,
      );
      if (!result.ok) return null;
      adoptPage(result.value, targetPeriod, targetScope);
      return result.value;
    },
    [adoptPage, cadence],
  );

  /** Read the notebook summary again, for the tabs and the gate. */
  const reloadNotebook = useCallback(
    async (targetPeriod: string) => {
      const result = await api().reviewNotebookGet(cadence, targetPeriod);
      if (result.ok) setNotebook(result.value);
      return result.ok ? result.value : null;
    },
    [cadence],
  );

  /**
   * Create one page (and the notebook, when the period has none) and open it,
   * without starting an interview.
   */
  const ensurePage = useCallback(
    async (scope: "overall" | string) => {
      fileEpoch.current += 1;
      const ensured = await api().reviewPageEnsure(cadence, period, scope);
      if (!ensured.ok) {
        setError(ensured.error);
        return null;
      }
      setNotebook(ensured.value);
      return reloadPage(period, scope);
    },
    [cadence, period, reloadPage],
  );

  const onOpenDocument = useCallback(async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      await ensurePage(activeScope);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeScope, ensurePage, snapshot]);

  /**
   * Start one page's interview: create the page, run its figures, then ask for
   * the session. The document is open and filled whatever the agent is doing.
   */
  const runStart = useCallback(
    async (scope: "overall" | string) => {
      if (!snapshot) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        // 0. Whatever the operator has already typed reaches the vault first: the
        //    figure pass rewrites the page, and a draft it never saw would go
        //    under it.
        if ((await flush()) === "failed") return;

        // 1. The page exists. Everything else is optional next to this.
        const fresh = await ensurePage(scope);
        if (!fresh) return;

        // 2. The figures the cadence's rules ask for, filled by the app rather
        //    than the model, so they are there whether or not an agent is.
        fileEpoch.current += 1;
        const filled = await api().reviewPrepopulate(cadence, period, scope);
        let filledLine: string | null = null;
        if (filled.ok) {
          await reloadPage(period, scope);
          await reloadNotebook(period);
          filledLine = describeSnapshots(filled.value);
        } else {
          filledLine = `Figures could not run: ${filled.error}`;
        }
        setNotice(filledLine);

        // 3. The interview, which needs the agent and is the only part that does.
        const start = await api().reviewStartOrResume(cadence, period, scope);
        if (!start.ok) {
          setError(start.error);
          return;
        }
        const kickoff = start.value.created ? start.value.kickoff : undefined;
        chatDock.requestSession({
          id: start.value.sessionId,
          kickoff,
          session: start.value.session,
          icon: "review",
        });
        setNotice(
          [
            filledLine,
            start.value.created
              ? "Started this review's chat."
              : "Opened this review's chat.",
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
    },
    [
      cadence,
      chatDock,
      describeSnapshots,
      ensurePage,
      flush,
      period,
      refresh,
      reloadNotebook,
      reloadPage,
      snapshot,
    ],
  );

  const startFromEmpty = useCallback(() => {
    // No notebook: the page-level empty state starts the life review (daily: its
    // one review). An area tab with no page starts that area's page.
    if (!notebook) {
      void runStart("overall");
      return;
    }
    void runStart(activeScope);
  }, [activeScope, notebook, runStart]);

  /** Adopt the page after a conflict — the operator's draft is given up. */
  const reloadAfterConflict = useCallback(async () => {
    conflictRef.current = false;
    setConflict(false);
    refused.current = null;
    unsaved.current = null;
    await loadView(period, activeScope);
  }, [activeScope, loadView, period]);

  const onMarkDone = useCallback(async () => {
    if (!snapshot) return;
    if ((await flush()) === "failed") return;
    setBusy(true);
    setError(null);
    const scope = activeScope;
    try {
      fileEpoch.current += 1;
      const result = await api().reviewMarkDone(cadence, period, scope);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        isDaily
          ? "Review complete."
          : scope === "overall"
            ? "Life review complete."
            : `${activeDomainName ?? "Area"} review complete.`,
      );
      await refresh();
      await reloadNotebook(period);
      await reloadPage(period, scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    activeDomainName,
    activeScope,
    cadence,
    flush,
    isDaily,
    period,
    refresh,
    reloadNotebook,
    reloadPage,
    snapshot,
  ]);

  const onUnlock = useCallback(async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      fileEpoch.current += 1;
      const result = await api().reviewUnlock(cadence, period);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
      await reloadNotebook(period);
      await reloadPage(period, activeScope);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    activeScope,
    cadence,
    period,
    refresh,
    reloadNotebook,
    reloadPage,
    snapshot,
  ]);

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
      const plan = await api().planningStartOrResume(
        cadence,
        next.value,
        activeScope,
      );
      if (!plan.ok) {
        setError(plan.error);
        return;
      }
      const kickoff = plan.value.created ? plan.value.kickoff : undefined;
      chatDock.requestSession({
        id: plan.value.sessionId,
        kickoff,
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
      // week. A write that *failed* holds the operator here.
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
    // Next stops at the latest open period: anything after it has no window.
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

  // A `?scope=` and/or `?period=` on the URL is how an external link addresses
  // a page: the scope selects a page, the period selects which review. Both are
  // applied once, then stripped with `replace` so no other URL state exists and
  // a back press does not re-apply them. On a cold open the period is already
  // in state from `linkedPeriod`; this lays it down for a link that lands while
  // the page is mounted (a second click on an Analytics period header).
  useEffect(() => {
    if (!snapshot) return;
    const params = new URLSearchParams(location.search);
    const rawPeriod = params.get("period");
    const requestedScope = isDaily ? null : params.get("scope");
    if (!rawPeriod && !requestedScope) return;
    if (rawPeriod) {
      const bounds = periodBounds(cadence, rawPeriod, weekStartDay);
      if (bounds.ok && rawPeriod <= basePeriod) setPeriod(rawPeriod);
    }
    if (requestedScope) {
      const valid =
        requestedScope === "overall" ||
        liveAreas.some((area) => area.slug === requestedScope);
      const alreadyActive =
        requestedScope === "overall"
          ? lens.kind === "overview"
          : lens.kind === "domain" && lens.slug === requestedScope;
      if (valid && !alreadyActive) {
        void setActiveSlug(requestedScope === "overall" ? null : requestedScope);
      }
    }
    navigate({ pathname: location.pathname, search: "" }, { replace: true });
  }, [
    basePeriod,
    cadence,
    isDaily,
    lens,
    liveAreas,
    location.pathname,
    location.search,
    navigate,
    setActiveSlug,
    snapshot,
    weekStartDay,
  ]);

  const isOnBasePeriod = period === basePeriod;
  const title = useMemo(
    () => periodTitle(cadence, period, weekStartDay),
    [cadence, period, weekStartDay],
  );
  /**
   * The page's heading: the period alone. The cadence is the page's eyebrow, so
   * repeating it in a title would say the same thing twice.
   */
  const headline = useMemo(
    () => periodLabel(cadence, period, weekStartDay),
    [cadence, period, weekStartDay],
  );

  const cadenceLabel = cadence.charAt(0).toUpperCase() + cadence.slice(1);

  /** The tab row: Overall first, then each live area, in the vault's order. */
  const tabs = useMemo(() => {
    if (isDaily) return [] as Array<{
      scope: string;
      label: string;
      status: PageStatus;
    }>;
    const summaries = new Map(
      (notebook?.pages ?? []).map((row) => [row.scope, row]),
    );
    const rows: Array<{ scope: string; label: string; status: PageStatus }> = [
      {
        scope: "overall",
        label: "Overall",
        status: summaries.get("overall")?.status ?? "missing",
      },
    ];
    for (const area of liveAreas) {
      const summary = summaries.get(area.slug);
      rows.push({
        scope: area.slug,
        label: summary?.title ?? area.meta.name,
        status: summary?.status ?? "missing",
      });
    }
    return rows;
  }, [isDaily, liveAreas, notebook]);

  const pageReady = loadedKey === pageKey(period, activeScope);
  const locked = notebook?.locked === true || page?.locked === true;
  const areaStatus = useCallback(
    (scope: string): PageStatus =>
      (notebook?.pages.find((row) => row.scope === scope)?.status as
        | PageStatus
        | undefined) ?? "missing",
    [notebook],
  );

  // The life review is gated on the areas, and derived exactly as the rail
  // derivation was: a live area whose page is not done gates the whole-life
  // review, and a period with no notebook has nothing done. No live areas means
  // there is nothing to gate behind.
  const allAreasDone =
    liveAreas.length === 0 ||
    liveAreas.every((area) => areaStatus(area.slug) === "done");
  const lifeReviewGated =
    !isDaily && activeScope === "overall" && !allAreasDone;
  const lifeReviewGateHint = "Finish every area review first";
  const doneCount = liveAreas.filter(
    (area) => areaStatus(area.slug) === "done",
  ).length;

  const progressText = useMemo(() => {
    if (isDaily || !notebook) return null;
    if (locked && areaStatus("overall") === "done") {
      return "Review complete — read-only.";
    }
    if (allAreasDone) {
      return "Every area is reviewed — the life review is ready";
    }
    return `${doneCount} of ${liveAreas.length} areas done · Life review unlocks when every area is done`;
  }, [allAreasDone, areaStatus, doneCount, isDaily, liveAreas.length, locked, notebook]);

  const pageMissing = page === null || page.status === "missing";
  const showEditor = !loading && pageReady && notebook !== null && !pageMissing;
  const showEmpty = !loading && pageReady && !showEditor;

  const markDoneLabel = isDaily
    ? "Mark review complete"
    : activeScope === "overall"
      ? "Mark life review complete"
      : `Mark ${activeDomainName ?? "area"} review complete`;

  const emptyStartLabel = isDaily
    ? "Start the interview"
    : !notebook || activeScope === "overall"
      ? "Start the life review"
      : `Start the ${activeDomainName ?? "area"} review`;

  const emptyPageText = !notebook
    ? "No review for this period yet."
    : activeScope === "overall"
      ? "No review for this period yet."
      : `No ${activeDomainName ?? "area"} review for this period yet.`;

  const selectTab = useCallback(
    async (scope: string) => {
      if (scope === activeScope) return;
      // The page being left is written first; a write that cannot land holds the
      // switch, so its prose never lands on another area.
      if ((await flush()) !== "saved") return;
      await setActiveSlug(scope === "overall" ? null : scope);
    },
    [activeScope, flush, setActiveSlug],
  );

  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tabs.length - 1;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      const target = tabs[nextIndex];
      if (!target) return;
      void selectTab(target.scope);
      window.requestAnimationFrame(() => {
        tabRefs.current.get(target.scope)?.focus();
      });
    },
    [selectTab, tabs],
  );

  const dirty = showEditor && !sameNote(draft, savedBody);
  const heldRefusal =
    refused.current !== null &&
    refused.current.key === pageKey(period, activeScope) &&
    refused.current.body === draft;
  const status = locked
    ? "Locked"
    : saving
      ? "Saving…"
      : dirty
        ? heldRefusal
          ? "Not saved"
          : "Saving…"
        : showEditor
          ? "Saved"
          : "No review for this period yet";

  if (!cadenceParam) {
    return <Navigate to="/review/weekly" replace />;
  }

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <div className="review-page-layout" data-testid="review-layout">
      <div className="review-page-layout__inner">
        <header className="review-page__header">
          {/* The page's name is the eyebrow, as on the Daily Journal: the period
              below is the page's one heading, so the cadence is not repeated as a
              second title. */}
          <div className="review-page__title-row">
            <WingEyebrow page={cadenceLabel as EyebrowPage} wing="Review" />
            {locked ? (
              <div className="review-page__header-actions">
                <span className="review-page__lock-badge">Locked</span>
              </div>
            ) : null}
          </div>
          {/* The period row: the journal's day row, at a period's scale. */}
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
        </header>

        <div className="review-page">
          {isDaily ? null : (
            <div className="review-page__pages-nav">
              {/* The status sentence leads, then the tab row sits straight on the
                  document it selects between, so the strip reads as the page's own
                  index rather than as chrome under the header. */}
              {progressText ? (
                <p
                  className="review-page__progress"
                  data-testid="review-progress"
                  role="status"
                >
                  {progressText}
                </p>
              ) : null}
              {/* The tab row is the scope selection. Roving tabIndex and the
                  Arrow/Home/End keys match the studio's field strip; Ctrl+Tab is
                  the chat dock's and is never claimed here. Six tabs wrap rather
                  than scroll sideways, so no page hides. */}
              <div
                className="review-page__tabs"
                role="tablist"
                aria-label="Review pages"
                data-testid="review-tabs"
              >
                {tabs.map((tab, index) => {
                  const active = tab.scope === activeScope;
                  return (
                    <button
                      key={tab.scope}
                      ref={(element) => {
                        if (element) tabRefs.current.set(tab.scope, element);
                        else tabRefs.current.delete(tab.scope);
                      }}
                      type="button"
                      role="tab"
                      id={`review-tab-${tab.scope}`}
                      aria-selected={active}
                      aria-controls="review-page-panel"
                      tabIndex={active ? 0 : -1}
                      data-testid={`review-tab-${tab.scope}`}
                      data-status={tab.status}
                      data-scope={tab.scope}
                      title={`${tab.label} — ${statusLabel(tab.status)}`}
                      className={`review-page__tab${active ? " is-active" : ""}`}
                      onClick={() => void selectTab(tab.scope)}
                      onKeyDown={(event) => onTabKeyDown(event, index)}
                    >
                      <span
                        className="review-page__tab-status"
                        aria-hidden
                        data-status={tab.status}
                      >
                        {tab.status === "done" ? "✓" : ""}
                      </span>
                      <span className="review-page__tab-label">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            id="review-page-panel"
            role={isDaily ? undefined : "tabpanel"}
            aria-labelledby={isDaily ? undefined : `review-tab-${activeScope}`}
            className="review-page__panel"
          >
            {loading || !pageReady ? (
              <p className="muted">Loading review…</p>
            ) : showEmpty ? (
              // A period nobody has reviewed yet, or an area page nobody started:
              // there is no box, so the two ways to make one are the page.
              <div className="review-page__empty" data-testid="review-empty">
                <p className="muted">{emptyPageText}</p>
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
                {/* The box is the page: one page at a time, keyed so switching
                    tabs remounts blocks and caret cleanly. */}
                {conflict ? (
                  <div
                    className="review-page__conflict"
                    role="alert"
                    data-testid="review-conflict"
                  >
                    <p>
                      This page changed on disk while you were writing. Reload to
                      read the latest version, then re-apply your text.
                    </p>
                    <Button
                      variant="outline"
                      data-testid="review-conflict-reload"
                      onClick={() => void reloadAfterConflict()}
                    >
                      Reload
                    </Button>
                  </div>
                ) : null}

                <div
                  className="review-page__editor"
                  onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    void flush();
                  }}
                >
                  <LiveMarkdownEditor
                    key={activeScope}
                    testId="review-editor"
                    value={draft}
                    onChange={onDraftChange}
                    slug={`review-${cadence}-${period}-${activeScope}`}
                    ariaLabel={title}
                    placeholder="Write this review."
                    readOnly={locked}
                  />
                </div>

                <div className="review-page__status-row">
                  <span className="muted review-page__status" data-testid="review-status">
                    {status}
                  </span>
                </div>

                <div className="review-page__actions" data-testid="review-actions">
                  {locked ? null : (
                    <Button
                      variant="primary"
                      data-testid="review-start"
                      onClick={() => void runStart(activeScope)}
                      disabled={busy || page?.status === "done"}
                    >
                      {busy ? "Starting…" : "Start interview"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    data-testid="review-plan-next"
                    onClick={onPlanNext}
                    disabled={busy}
                  >
                    Plan next period
                  </Button>
                  {/* Authoring controls are hidden on a locked notebook; the row
                      keeps Unlock as the one way back in. */}
                  {locked ? null : (
                    <Button
                      variant="outline"
                      data-testid="review-mark-done"
                      onClick={onMarkDone}
                      disabled={busy || page?.status === "done" || lifeReviewGated}
                      title={lifeReviewGated ? lifeReviewGateHint : undefined}
                    >
                      {markDoneLabel}
                    </Button>
                  )}
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

                {/* The cadence's standing rules: what every review of this
                    cadence is told, and the custom figure rules the app still
                    honours in it. */}
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
                        ? `${skill.snapshots.length} custom figure${skill.snapshots.length === 1 ? "" : "s"} · ${skill.exists ? "your file" : "defaults"}`
                        : "what this review session is told"}
                    </span>
                  </button>
                  {skillOpen ? (
                    <div className="review-page__skill-body">
                      <p className="muted review-page__skill-hint">
                        Every line here is handed to this cadence&rsquo;s review
                        session, and a <code>lifequest-snapshot</code> block is a
                        figure the app fills into the review itself. Ask the
                        companion to add a rule, or write one here.
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
          </div>

          {/* The days the operator wrote: once, on the overall page — a note
              belongs to no area, so it is not repeated per tab. */}
          {isDaily || activeScope === "overall" ? (
            <DailyNotesPanel
              cadence={cadence}
              period={period}
              weekStartDay={weekStartDay}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
