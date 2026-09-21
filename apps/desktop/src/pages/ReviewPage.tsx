import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  currentPeriod,
  isCurrentPeriod,
  isFuturePeriod,
  nextPeriod,
  previousPeriod,
  periodTitle,
  type ReviewCadence,
  type ReviewRecord,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useChatDock } from "@/state/ChatDockProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { Button } from "@/components/ui/Button";
import { MarkdownView } from "@/components/documents/MarkdownView";
import { ReviewPreview } from "@/components/reviews/ReviewPreview";

const VALID_CADENCES: ReviewCadence[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

function resolveCadence(param: string | undefined): ReviewCadence {
  if (param && VALID_CADENCES.includes(param as ReviewCadence)) {
    return param as ReviewCadence;
  }
  return "weekly";
}

export default function ReviewPage() {
  const { cadence: rawCadence } = useParams<{ cadence: string }>();
  const cadence = resolveCadence(rawCadence);
  const navigate = useNavigate();
  const { snapshot, refresh, setActiveSlug } = useVault();
  const lens = useDomainLens();
  const chatDock = useChatDock();

  const weekStartDay = snapshot?.settings.weekStartDay ?? "monday";

  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // Snap to current period if future
  const isFuture = useMemo(() => {
    const now = currentPeriod(cadence, weekStartDay);
    return isFuturePeriod(cadence, now, weekStartDay);
  }, [cadence, weekStartDay]);

  const basePeriod = useMemo(
    () => currentPeriod(cadence, weekStartDay),
    [cadence, weekStartDay],
  );

  const [period, setPeriod] = useState(basePeriod);

  useEffect(() => {
    setPeriod(basePeriod);
  }, [basePeriod]);

  // Active scope: overall when overview/unassigned/non-domain, domain slug otherwise
  const activeScope: "overall" | string = useMemo(() => {
    if (!lens || lens.kind !== "domain" || !lens.slug) return "overall";
    return lens.slug;
  }, [lens]);

  const loadRecord = useCallback(
    async (targetPeriod: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api().reviewGet(cadence, targetPeriod);
        if (!result.ok) {
          // not found = empty state (valid)
          setRecord(null);
        } else {
          setRecord(result.value);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setRecord(null);
      } finally {
        setLoading(false);
      }
    },
    [cadence],
  );

  useEffect(() => {
    void loadRecord(period);
  }, [loadRecord, period]);

  const onPrev = useCallback(() => {
    const prevResult = previousPeriod(cadence, period, weekStartDay);
    if (prevResult.ok) setPeriod(prevResult.value);
  }, [cadence, period, weekStartDay]);

  const onNext = useCallback(() => {
    const next = nextPeriod(cadence, period, weekStartDay);
    if (next.ok) setPeriod(next.value);
  }, [cadence, period, weekStartDay]);

  const onStart = useCallback(async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const ensure = await api().reviewEnsure(cadence, period, activeScope);
      if (!ensure.ok) {
        setError(ensure.error);
        return;
      }
      const start = await api().reviewStartOrResume(cadence, period, activeScope);
      if (!start.ok) {
        setError(start.error);
        return;
      }
      const kickoff = start.value.created ? start.value.kickoff : undefined;
      chatDock.requestSession(start.value.sessionId, kickoff);
      await loadRecord(period);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeScope, cadence, chatDock, loadRecord, period, refresh, snapshot]);

  const onEdit = useCallback(() => {
    if (record?.locked) return;
    setDraft(record ? record.bodyMarkdown : "");
    setEditing(true);
  }, [record?.bodyMarkdown, record?.locked]);

  const onSave = useCallback(async () => {
    if (!snapshot || record?.locked) return;
    setBusy(true);
    setError(null);
    try {
      // First edit-save on missing file: ensure then write
      if (!record) {
        const ensure = await api().reviewEnsure(cadence, period, activeScope);
        if (!ensure.ok) {
          setError(ensure.error);
          return;
        }
      }
      const write = await api().reviewWrite(cadence, period, draft);
      if (!write.ok) {
        setError(write.error);
        return;
      }
      await refresh();
      await loadRecord(period);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeScope, cadence, draft, loadRecord, period, record, refresh, snapshot]);

  const onMarkDone = useCallback(async () => {
    if (!snapshot) return;
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
  }, [activeScope, cadence, loadRecord, period, refresh, snapshot]);

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
  }, [activeScope, cadence, chatDock, navigate, period, snapshot, weekStartDay]);

  const onSetActiveSlug = useCallback(
    (slug: string) => {
      void setActiveSlug(slug);
    },
    [setActiveSlug],
  );

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

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  const liveDomains = snapshot.domains
    .filter((d) => !d.meta.archivedAt)
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);

  return (
    <div className="review-page">
      <header className="review-page__header">
        <div className="review-page__pager">
          <Button variant="outline" onClick={onPrev}>
            ‹ Prev
          </Button>
          <span className="review-page__period">{title}</span>
          <Button
            variant="outline"
            onClick={onNext}
            disabled={isOnCurrentPeriod}
          >
            Next ›
          </Button>
        </div>
        {record?.locked ? (
          <span className="review-page__lock-badge">Locked</span>
        ) : null}
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading review…</p>
      ) : editing && !record?.locked ? (
        <div className="review-page__editor doc-editor__split">
          <label className="field doc-editor__body-field">
            <span>Markdown (full file)</span>
            <textarea
              className="doc-editor__textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={18}
              spellCheck
            />
          </label>
          <div className="doc-editor__preview">
            <span className="doc-editor__preview-label">Preview</span>
            <MarkdownView
              markdown={draft}
              slug={`review-${cadence}-${period}`}
            />
          </div>
        </div>
      ) : (
        <ReviewPreview
          record={record}
          scope={activeScope}
          domainName={domainName}
          liveDomains={liveDomains}
          onSetActiveSlug={onSetActiveSlug}
        />
      )}

      <div className="review-page__actions">
        <Button variant="primary" onClick={onStart} disabled={busy}>
          Start
        </Button>
        {!editing ? (
          <Button variant="outline" onClick={onEdit} disabled={busy || record?.locked}>
            Edit
          </Button>
        ) : (
          <Button variant="primary" onClick={onSave} disabled={busy}>
            Save
          </Button>
        )}
        <Button variant="outline" onClick={onPlanNext} disabled={busy}>
          Plan next period
        </Button>
        <Button variant="outline" onClick={onMarkDone} disabled={busy}>
          Mark done
        </Button>
        {record?.locked ? (
          <Button variant="outline" onClick={onUnlock} disabled={busy}>
            Unlock
          </Button>
        ) : null}
      </div>
    </div>
  );
}
