import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  periodTodayLocalIso,
  unlockedAreas,
  type AnalyticsCell,
  type AnalyticsMatrix,
  type AnalyticsMetricRow,
  type DatabaseColumn,
  type DatabaseListEntry,
  type MetricAggregation,
  type MetricDefinitionDraft,
  type MetricDirection,
  type MetricEvents,
  type MetricSource,
  type ReviewCadence,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useChatDock } from "@/state/ChatDockProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { WingEyebrow } from "@/components/shell/WingEyebrow";
import { Button } from "@/components/ui/Button";

/**
 * Analytics — the Review wing's period × metric matrix.
 *
 * This is the one genuinely new surface of the metrics work, and it is a
 * matrix, not a dashboard: rows are the lens area's metric definitions, columns
 * are the last eight periods of the chosen cadence, and a cell is a formatted
 * value plus the change from the period before it. No score, no streak, no
 * colour judgement — the only target and direction printed are the ones the
 * operator set on the definition, said quietly in the row label.
 *
 * It is scoped by the app-wide area lens (D5): an area lens shows that area's
 * metrics, Life shows every live area's grouped by area. Archived areas never
 * appear because the engine's matrix only reads live areas.
 *
 * The page is deliberately live, not a report: a click on an events cell opens
 * that column's period beside the matrix, where the operator can log one dated
 * event and edit or delete the rows already there through the ordinary database
 * row path. A click on a derived cell opens the database the metric reads,
 * filtered to the cell's period when the definition names a date column. A
 * period header is a door into that period's review.
 *
 * A definition can be created from this page — an events metric, or a database-
 * derived one whose spec the engine builds from the database/columns chosen
 * here. Creating one applies immediately; editing or deleting an existing
 * definition is proposed in Decisions instead, because it changes what a review
 * measures. Either path reloads the matrix, which therefore keeps showing the
 * old definition until the Decision is approved.
 *
 * Matrix reads are cached for the session, keyed by cadence and lens, so
 * flipping back to a cadence already read does not re-run every definition's
 * window. A mutation — here or from the companion — drops the cache and
 * re-reads, which is how the matrix stays the truth rather than a snapshot.
 */

const CADENCE_OPTIONS: Array<{ value: ReviewCadence; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const AGGREGATION_OPTIONS: Array<{
  value: MetricAggregation;
  label: string;
}> = [
  { value: "sum", label: "Sum" },
  { value: "count", label: "Count" },
  { value: "last", label: "Last" },
  { value: "avg", label: "Average" },
];

const AGGREGATION_LABELS: Record<MetricAggregation, string> = {
  sum: "sum",
  count: "count",
  last: "last",
  avg: "average",
};

const DIRECTION_LABELS: Record<MetricDirection, string> = {
  "higher-is-better": "higher is better",
  "lower-is-better": "lower is better",
  neutral: "neutral",
};

/** The cell panel is about one metric in one column period. */
type PanelSelection = {
  row: AnalyticsMetricRow;
  cell: AnalyticsCell;
  periodLabel: string;
};

/**
 * The definition the form is editing: its area and id are the stable names the
 * proposal carries, and an events metric's event key must survive an edit or the
 * rows already logged under it would leave the metric.
 */
type EditingMetric = {
  area: string;
  metricId: string;
  eventKey: string | null;
};

/**
 * What the page says after a proposal lands. Editing or deleting a definition
 * does not change the file — the Decision does — so the sentence has to say both
 * that it was sent and why the matrix still looks the same.
 */
const PROPOSAL_SENT =
  "Sent to Decisions — applying it changes what this metric measures.";

/** The columns a derived spec can measure and window on, from the registry. */
function numericColumns(columns: readonly DatabaseColumn[]): DatabaseColumn[] {
  return columns.filter((column) => column.type === "number");
}

function dateColumns(columns: readonly DatabaseColumn[]): DatabaseColumn[] {
  return columns.filter((column) => column.type === "date");
}

/**
 * A metric id from its label: lowercase, every run of non-alphanumerics to one
 * dash. The form's fallback path follows the same rule the companion's
 * `define_metric` is given in its kickoff, so both doors name the definition the
 * same way.
 */
function metricIdFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The quiet second line of a row label: unit, provenance, target, direction. */
function rowMeta(row: AnalyticsMetricRow): string {
  const parts: string[] = [];
  if (row.unit) parts.push(row.unit);
  parts.push(row.source === "derived" ? "database" : "events");
  parts.push(AGGREGATION_LABELS[row.aggregation]);
  if (row.target !== null) parts.push(`target ${row.target}`);
  if (row.direction) parts.push(DIRECTION_LABELS[row.direction]);
  return parts.join(" · ");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function AnalyticsPage() {
  const { snapshot } = useVault();
  const lens = useDomainLens();
  const chatDock = useChatDock();
  const navigate = useNavigate();

  const lensSlug = lens.kind === "domain" ? lens.slug : null;
  const lensName = useMemo(() => {
    if (!lensSlug) return "Life";
    return (
      snapshot?.domains.find((area) => area.slug === lensSlug)?.meta.name ??
      lensSlug
    );
  }, [lensSlug, snapshot]);

  const [cadence, setCadence] = useState<ReviewCadence>("weekly");

  // One session cache keyed by cadence and lens: flipping back to a cadence
  // already read must not re-run every definition's window. Mutations drop the
  // cache (see `refreshMatrix`), so a cached matrix is never a stale one.
  const matrixKey = `${cadence}|${lensSlug ?? ""}`;
  const matrixCache = useRef(new Map<string, AnalyticsMatrix>());
  const [matrix, setMatrix] = useState<AnalyticsMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadBucket, setReloadBucket] = useState(0);
  const [panelReload, setPanelReload] = useState(0);
  const keyRef = useRef(matrixKey);
  keyRef.current = matrixKey;

  /** A mutation of this page's own is in flight; its signal is not news. */
  const mutatingRef = useRef(false);
  /** When this page last wrote; the vault's signal may arrive just after. */
  const lastMutationAt = useRef(0);

  const [panel, setPanel] = useState<PanelSelection | null>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;

  const [events, setEvents] = useState<MetricEvents | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [logDate, setLogDate] = useState(periodTodayLocalIso);
  const [logValue, setLogValue] = useState("1");
  const [logNote, setLogNote] = useState("");
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editStatus, setEditStatus] = useState<string | null>(null);

  const [metricFormOpen, setMetricFormOpen] = useState(false);
  const [editingMetric, setEditingMetric] = useState<EditingMetric | null>(null);
  const [metricArea, setMetricArea] = useState("");
  const [metricSource, setMetricSource] = useState<MetricSource>("events");
  const [metricLabel, setMetricLabel] = useState("");
  const [metricUnit, setMetricUnit] = useState("");
  const [metricAggregation, setMetricAggregation] =
    useState<MetricAggregation>("sum");
  const [metricTarget, setMetricTarget] = useState("");
  const [metricDirection, setMetricDirection] = useState<MetricDirection | null>(
    null,
  );
  const [metricDatabaseId, setMetricDatabaseId] = useState("");
  const [metricMeasureColumnId, setMetricMeasureColumnId] = useState("");
  const [metricTimeColumnId, setMetricTimeColumnId] = useState("");
  const [metricDatabases, setMetricDatabases] = useState<DatabaseListEntry[]>(
    [],
  );
  const [metricDatabasesLoading, setMetricDatabasesLoading] = useState(false);
  const [metricDatabasesError, setMetricDatabasesError] = useState<
    string | null
  >(null);
  const [metricStatus, setMetricStatus] = useState<string | null>(null);
  const [metricSaving, setMetricSaving] = useState(false);
  const [proposalStatus, setProposalStatus] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnalyticsMetricRow | null>(
    null,
  );
  const [companionStatus, setCompanionStatus] = useState<string | null>(null);

  const areaChoices = useMemo(
    () => unlockedAreas(snapshot?.domains ?? []),
    [snapshot],
  );

  // The derived form's columns, from the database the operator picked. A new
  // database is a new measure and window, so the picks reset when it changes.
  const selectedDatabase = useMemo(
    () =>
      metricDatabases.find(
        (entry) => entry.database.id === metricDatabaseId,
      ) ?? null,
    [metricDatabaseId, metricDatabases],
  );
  const measureChoices = useMemo(
    () =>
      selectedDatabase
        ? numericColumns(selectedDatabase.database.columns)
        : [],
    [selectedDatabase],
  );
  const timeChoices = useMemo(
    () =>
      selectedDatabase ? dateColumns(selectedDatabase.database.columns) : [],
    [selectedDatabase],
  );

  /**
   * The sentence for a derived form that cannot be completed: no database in
   * the area, or a database without the number and date columns a metric needs.
   * It points at Data because that is where the operator fixes it.
   */
  const derivedHint = useMemo((): string | null => {
    if (metricSource !== "derived") return null;
    if (!metricArea.trim()) {
      return "Choose an area, then pick one of its databases.";
    }
    if (metricDatabasesLoading) return "Reading the area's databases…";
    if (metricDatabasesError) return metricDatabasesError;
    if (metricDatabases.length === 0) {
      return "This area has no databases yet. Create one in Data, then define a database-derived metric here.";
    }
    if (
      selectedDatabase &&
      (measureChoices.length === 0 || timeChoices.length === 0)
    ) {
      return "The selected database needs at least one number column and one date column. Add them in Data, then come back.";
    }
    return null;
  }, [
    metricArea,
    metricDatabases.length,
    metricDatabasesError,
    metricDatabasesLoading,
    metricSource,
    measureChoices.length,
    selectedDatabase,
    timeChoices.length,
  ]);

  // The matrix read. A cached key paints without a fetch; an uncached one
  // fetches with the loading line visible while the promise is pending.
  useEffect(() => {
    const cached = matrixCache.current.get(matrixKey);
    if (cached) {
      setMatrix(cached);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await api().analyticsMatrix({
          cadence,
          lens: lensSlug,
        });
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          setMatrix(null);
          return;
        }
        matrixCache.current.set(matrixKey, result.value);
        setMatrix(result.value);
      } catch (err) {
        if (!cancelled) {
          setError(errorText(err));
          setMatrix(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cadence, lensSlug, matrixKey, reloadBucket]);

  /** Drop the session cache for the matrix on screen and read it again. */
  const refreshMatrix = useCallback(() => {
    matrixCache.current.delete(keyRef.current);
    setReloadBucket((bucket) => bucket + 1);
  }, []);

  // A new cadence or lens is a different table: the open cell panel belongs to
  // the old one, so it closes rather than pointing at a column that is gone.
  useEffect(() => {
    setPanel(null);
    setEditingRowId(null);
  }, [matrixKey]);

  // The vault's change signal is how this page hears about a metric defined or
  // an event logged elsewhere — by the companion, or by another window. A write
  // this page made itself already re-reads what it touched, so its own signal is
  // ignored; anything else schedules one debounced re-read.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let timer: number | null = null;
    try {
      stop = api().onVaultDataChanged(() => {
        if (mutatingRef.current) return;
        if (Date.now() - lastMutationAt.current < 800) return;
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = null;
          matrixCache.current.delete(keyRef.current);
          setReloadBucket((bucket) => bucket + 1);
          if (panelRef.current) setPanelReload((token) => token + 1);
        }, 250);
      });
    } catch {
      stop = undefined;
    }
    return () => {
      stop?.();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  // The open cell's events for its column period.
  useEffect(() => {
    if (!panel) {
      setEvents(null);
      setEventsError(null);
      setEventsLoading(false);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    setEventsError(null);
    void (async () => {
      try {
        const result = await api().metricEvents({
          area: panel.row.areaSlug,
          metricId: panel.row.metricId,
          start: panel.cell.start,
          end: panel.cell.end,
        });
        if (cancelled) return;
        if (!result.ok) {
          setEvents(null);
          setEventsError(result.error);
          return;
        }
        setEvents(result.value);
      } catch (err) {
        if (!cancelled) {
          setEvents(null);
          setEventsError(errorText(err));
        }
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panel, panelReload]);

  // A new period's panel starts with the log form at its defaults, as the design
  // asks: today's date, value 1, no note.
  useEffect(() => {
    setLogDate(periodTodayLocalIso());
    setLogValue("1");
    setLogNote("");
    setLogStatus(null);
    setEditingRowId(null);
    setEditStatus(null);
  }, [panel]);

  // The derived form needs the area's databases (and their columns) to offer a
  // measure and a date column. This is a read of the registry, not of rows, so
  // it is safe to ask for it whenever the form is open on the area.
  useEffect(() => {
    if (!metricFormOpen || metricSource !== "derived") return;
    const area = metricArea.trim();
    if (!area) {
      setMetricDatabases([]);
      setMetricDatabasesError(null);
      setMetricDatabasesLoading(false);
      return;
    }
    let cancelled = false;
    setMetricDatabasesLoading(true);
    setMetricDatabasesError(null);
    void (async () => {
      try {
        const result = await api().dbList(area);
        if (cancelled) return;
        if (!result.ok) {
          setMetricDatabases([]);
          setMetricDatabasesError(result.error);
          return;
        }
        setMetricDatabases(result.value);
      } catch (err) {
        if (!cancelled) {
          setMetricDatabases([]);
          setMetricDatabasesError(errorText(err));
        }
      } finally {
        if (!cancelled) setMetricDatabasesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [metricArea, metricFormOpen, metricSource]);

  const reviewHref = useCallback(
    (period: string, areaSlug?: string) => {
      const params = new URLSearchParams();
      params.set("period", period);
      const scope = areaSlug ?? lensSlug;
      if (scope) params.set("scope", scope);
      return `/review/${cadence}?${params.toString()}`;
    },
    [cadence, lensSlug],
  );

  /**
   * A cell is a door. A derived metric has no rows to log here, so its cell
   * opens the source database in Data, pinned to the cell's own period when the
   * definition names a date column (DatabasePage reads the three params once);
   * without a date column it opens the database unpinned. An events metric opens
   * the period's logged rows in the panel under the matrix.
   */
  const onCellClick = useCallback(
    (row: AnalyticsMetricRow, cell: AnalyticsCell, periodLabel: string) => {
      if (row.source === "derived") {
        if (!row.databaseId) {
          navigate(`/data/${row.areaSlug}`);
          return;
        }
        if (row.timeColumnId) {
          const params = new URLSearchParams();
          params.set("from", cell.start);
          params.set("to", cell.end);
          params.set("columnId", row.timeColumnId);
          navigate(
            `/data/${row.areaSlug}/${row.databaseId}?${params.toString()}`,
          );
          return;
        }
        navigate(`/data/${row.areaSlug}/${row.databaseId}`);
        return;
      }
      setPanel({ row, cell, periodLabel });
    },
    [navigate],
  );

  const onLogEvent = useCallback(async () => {
    if (!panel || logging) return;
    const value = Number(logValue);
    if (logValue.trim() === "" || !Number.isFinite(value)) {
      setLogStatus("Value must be a number.");
      return;
    }
    setLogging(true);
    setLogStatus(null);
    mutatingRef.current = true;
    try {
      const result = await api().metricLogEvent({
        area: panel.row.areaSlug,
        metricId: panel.row.metricId,
        date: logDate,
        value,
        note: logNote.trim() || undefined,
      });
      if (!result.ok) {
        setLogStatus(result.error);
        return;
      }
      lastMutationAt.current = Date.now();
      setLogStatus("Logged.");
      setLogValue("1");
      setLogNote("");
      refreshMatrix();
      setPanelReload((token) => token + 1);
    } catch (err) {
      setLogStatus(errorText(err));
    } finally {
      setLogging(false);
      mutatingRef.current = false;
    }
  }, [logDate, logNote, logValue, logging, panel, refreshMatrix]);

  const beginEdit = useCallback(
    (row: { rowId: string; date: string; value: number; note: string }) => {
      setEditingRowId(row.rowId);
      setEditDate(row.date);
      setEditValue(String(row.value));
      setEditNote(row.note);
      setEditStatus(null);
    },
    [],
  );

  const cancelEdit = useCallback(() => {
    setEditingRowId(null);
    setEditStatus(null);
  }, []);

  /**
   * Saving an edited event is the ordinary database row path: the metrics
   * table's minted column ids come from the engine's events read, and the
   * `metric` cell carries the definition's event key so the row stays the same
   * metric after the edit.
   */
  const onSaveEdit = useCallback(async () => {
    if (!panel || !events || !editingRowId) return;
    const value = Number(editValue);
    if (editValue.trim() === "" || !Number.isFinite(value)) {
      setEditStatus("Value must be a number.");
      return;
    }
    mutatingRef.current = true;
    try {
      const result = await api().dbUpsertRow(panel.row.areaSlug, "metrics", {
        id: editingRowId,
        cells: {
          [events.columns.date]: editDate,
          [events.columns.metric]: events.eventKey,
          [events.columns.value]: value,
          [events.columns.note]: editNote,
        },
      });
      if (!result.ok) {
        setEditStatus(result.error);
        return;
      }
      lastMutationAt.current = Date.now();
      setEditingRowId(null);
      setEditStatus(null);
      refreshMatrix();
      setPanelReload((token) => token + 1);
    } catch (err) {
      setEditStatus(errorText(err));
    } finally {
      mutatingRef.current = false;
    }
  }, [
    editDate,
    editNote,
    editValue,
    editingRowId,
    events,
    panel,
    refreshMatrix,
  ]);

  const onDeleteEvent = useCallback(
    async (rowId: string) => {
      if (!panel) return;
      mutatingRef.current = true;
      try {
        const result = await api().dbDeleteRow(
          panel.row.areaSlug,
          "metrics",
          rowId,
        );
        if (!result.ok) {
          setEventsError(result.error);
          return;
        }
        lastMutationAt.current = Date.now();
        refreshMatrix();
        setPanelReload((token) => token + 1);
      } catch (err) {
        setEventsError(errorText(err));
      } finally {
        mutatingRef.current = false;
      }
    },
    [panel, refreshMatrix],
  );

  /**
   * The prepared-chat door, exactly as Act and the Daily Journal use it: create
   * the companion session, then hand the dock its id and the kickoff. The
   * prompt names the area and asks the companion to `define_metric`; it is a
   * prepared brief, not a second mechanism.
   */
  const onAskCompanion = useCallback(async () => {
    setCompanionStatus(null);
    try {
      const created = await api().companionSessionCreate(
        `Define a metric for ${lensName}`,
      );
      if (!created.ok) {
        setCompanionStatus(created.error);
        return;
      }
      const kickoff =
        `Define a metric for ${lensName}. Ask me what it should measure, then ` +
        `call define_metric for that area with its label, unit, aggregation and ` +
        `target. Use an events metric when it needs per-period entry (I log the ` +
        `events on Analytics); use a derived spec over one of the area's ` +
        `databases when it can be computed from rows. One metric only, and say ` +
        `which periods it will be measured over.`;
      chatDock.requestSession({
        id: created.value.id,
        kickoff,
        session: created.value,
        icon: "review",
      });
      setCompanionStatus("Opened a prepared chat with the companion.");
    } catch (err) {
      setCompanionStatus(errorText(err));
    }
  }, [chatDock, lensName]);

  /** Start a new metric: the events source is the one that applies immediately. */
  const openMetricForm = useCallback(() => {
    setEditingMetric(null);
    setMetricArea(lensSlug ?? "");
    setMetricSource("events");
    setMetricLabel("");
    setMetricUnit("");
    setMetricAggregation("sum");
    setMetricTarget("");
    setMetricDirection(null);
    setMetricDatabaseId("");
    setMetricMeasureColumnId("");
    setMetricTimeColumnId("");
    setMetricDatabases([]);
    setMetricDatabasesError(null);
    setMetricStatus(null);
    setProposalStatus(null);
    setDeleteTarget(null);
    setMetricFormOpen(true);
  }, [lensSlug]);

  const closeMetricForm = useCallback(() => {
    setMetricFormOpen(false);
    setEditingMetric(null);
    setMetricSaving(false);
    setMetricStatus(null);
  }, []);

  /**
   * Edit prefills from the definition itself, not just the matrix row: the row
   * knows the source and the display fields, while the measure column and (for
   * an events metric) the event key only the definition carries. The row's
   * values paint first so the form is never blank, then the read corrects them.
   */
  const beginMetricEdit = useCallback(async (row: AnalyticsMetricRow) => {
    setDeleteTarget(null);
    setProposalStatus(null);
    setMetricStatus(null);
    setEditingMetric({
      area: row.areaSlug,
      metricId: row.metricId,
      eventKey: row.source === "events" ? row.metricId : null,
    });
    setMetricArea(row.areaSlug);
    setMetricSource(row.source);
    setMetricLabel(row.label);
    setMetricUnit(row.unit);
    setMetricAggregation(row.aggregation);
    setMetricTarget(row.target === null ? "" : String(row.target));
    setMetricDirection(row.direction);
    setMetricDatabaseId(row.databaseId ?? "");
    setMetricMeasureColumnId("");
    setMetricTimeColumnId(row.timeColumnId ?? "");
    setMetricDatabases([]);
    setMetricDatabasesError(null);
    setMetricFormOpen(true);
    try {
      const result = await api().metricGet({
        area: row.areaSlug,
        metricId: row.metricId,
      });
      if (!result.ok) {
        setMetricStatus(result.error);
        return;
      }
      const definition = result.value;
      setMetricLabel(definition.label);
      setMetricUnit(definition.unit);
      setMetricAggregation(definition.aggregation);
      setMetricTarget(
        definition.target === null || definition.target === undefined
          ? ""
          : String(definition.target),
      );
      setMetricDirection(definition.direction ?? null);
      setMetricSource(definition.source);
      if (definition.source === "derived") {
        setEditingMetric({
          area: row.areaSlug,
          metricId: row.metricId,
          eventKey: null,
        });
        setMetricDatabaseId(definition.spec?.databaseId ?? "");
        setMetricMeasureColumnId(definition.spec?.measureColumnId ?? "");
        setMetricTimeColumnId(definition.spec?.timeColumnId ?? "");
      } else {
        setEditingMetric({
          area: row.areaSlug,
          metricId: row.metricId,
          eventKey: definition.eventKey ?? row.metricId,
        });
      }
    } catch (err) {
      setMetricStatus(errorText(err));
    }
  }, []);

  /** Picking a database preselects its first number and date column. */
  const onPickMetricDatabase = useCallback(
    (databaseId: string) => {
      setMetricDatabaseId(databaseId);
      const entry = metricDatabases.find(
        (candidate) => candidate.database.id === databaseId,
      );
      setMetricMeasureColumnId(
        entry ? (numericColumns(entry.database.columns)[0]?.id ?? "") : "",
      );
      setMetricTimeColumnId(
        entry ? (dateColumns(entry.database.columns)[0]?.id ?? "") : "",
      );
    },
    [metricDatabases],
  );

  /**
   * The form's save. A new definition is created immediately (`metricDefine`);
   * an edit is proposed (`metricPropose`), because it changes what a review
   * measures. A derived draft carries the database and columns — the engine
   * builds the one-number spec — never a renderer-built ViewSpec.
   */
  const onSaveMetric = useCallback(async () => {
    if (metricSaving || proposing) return;
    const area = metricArea.trim();
    const label = metricLabel.trim();
    if (!area) {
      setMetricStatus("Choose an area.");
      return;
    }
    if (!label) {
      setMetricStatus("Give the metric a label.");
      return;
    }
    const id = editingMetric?.metricId ?? metricIdFromLabel(label);
    if (!id) {
      setMetricStatus("The label needs at least one letter or number.");
      return;
    }
    let target: number | null = null;
    if (metricTarget.trim() !== "") {
      const parsed = Number(metricTarget);
      if (!Number.isFinite(parsed)) {
        setMetricStatus("Target must be a number.");
        return;
      }
      target = parsed;
    }
    let definition: MetricDefinitionDraft;
    if (metricSource === "derived") {
      if (!metricDatabaseId) {
        setMetricStatus("Choose the database the metric reads.");
        return;
      }
      if (!metricMeasureColumnId) {
        setMetricStatus("Choose the number column this metric measures.");
        return;
      }
      if (!metricTimeColumnId) {
        setMetricStatus("Choose the date column the periods use.");
        return;
      }
      definition = {
        id,
        label,
        unit: metricUnit.trim(),
        source: "derived",
        aggregation: metricAggregation,
        databaseId: metricDatabaseId,
        measureColumnId: metricMeasureColumnId,
        timeColumnId: metricTimeColumnId,
        target,
        ...(metricDirection ? { direction: metricDirection } : {}),
      };
    } else {
      definition = {
        id,
        label,
        unit: metricUnit.trim(),
        source: "events",
        aggregation: metricAggregation,
        eventKey: editingMetric?.eventKey ?? id,
        target,
        ...(metricDirection ? { direction: metricDirection } : {}),
      };
    }
    setMetricSaving(true);
    setMetricStatus(null);
    mutatingRef.current = true;
    try {
      if (editingMetric) {
        const result = await api().metricPropose({
          area: editingMetric.area,
          metricId: editingMetric.metricId,
          action: "update",
          definition,
        });
        if (!result.ok) {
          setMetricStatus(result.error);
          return;
        }
        lastMutationAt.current = Date.now();
        setProposalStatus(PROPOSAL_SENT);
        setMetricFormOpen(false);
        setEditingMetric(null);
        refreshMatrix();
        return;
      }
      const result = await api().metricDefine({ area, definition });
      if (!result.ok) {
        setMetricStatus(result.error);
        return;
      }
      lastMutationAt.current = Date.now();
      setMetricLabel("");
      setMetricUnit("");
      setMetricTarget("");
      setMetricStatus("Metric defined.");
      setMetricFormOpen(false);
      refreshMatrix();
    } catch (err) {
      setMetricStatus(errorText(err));
    } finally {
      setMetricSaving(false);
      mutatingRef.current = false;
    }
  }, [
    editingMetric,
    metricAggregation,
    metricArea,
    metricDatabaseId,
    metricDirection,
    metricLabel,
    metricMeasureColumnId,
    metricSaving,
    metricSource,
    metricTarget,
    metricTimeColumnId,
    metricUnit,
    proposing,
    refreshMatrix,
  ]);

  /**
   * Deleting a definition is a proposal too: the file — and every figure and
   * cell that reads it — stays until the Decision is approved.
   */
  const onConfirmDelete = useCallback(async () => {
    if (!deleteTarget || proposing) return;
    setProposing(true);
    setProposalStatus(null);
    mutatingRef.current = true;
    try {
      const result = await api().metricPropose({
        area: deleteTarget.areaSlug,
        metricId: deleteTarget.metricId,
        action: "delete",
      });
      if (!result.ok) {
        setProposalStatus(result.error);
        return;
      }
      lastMutationAt.current = Date.now();
      setProposalStatus(PROPOSAL_SENT);
      setDeleteTarget(null);
      refreshMatrix();
    } catch (err) {
      setProposalStatus(errorText(err));
    } finally {
      setProposing(false);
      mutatingRef.current = false;
    }
  }, [deleteTarget, proposing, refreshMatrix]);

  // Grouped by area, in the order the engine answered: under Life that is the
  // vault's area order; under an area lens there is one group.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byArea = new Map<
      string,
      { areaSlug: string; areaName: string; rows: AnalyticsMetricRow[] }
    >();
    for (const row of matrix?.rows ?? []) {
      let group = byArea.get(row.areaSlug);
      if (!group) {
        group = { areaSlug: row.areaSlug, areaName: row.areaName, rows: [] };
        byArea.set(row.areaSlug, group);
        order.push(row.areaSlug);
      }
      group.rows.push(row);
    }
    return order.map((slug) => byArea.get(slug)!);
  }, [matrix]);

  const periods = matrix?.periods ?? [];
  const isEmpty = !loading && matrix !== null && matrix.rows.length === 0;

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <div className="page-content analytics-page" data-testid="analytics-page">
      <header className="analytics-page__header">
        <div className="analytics-page__heading">
          <WingEyebrow page="Analytics" wing="Review" />
          <h1 className="analytics-page__title">Analytics</h1>
          <p className="analytics-page__lead">
            {lensSlug
              ? `${lensName}'s metrics, period by period.`
              : "Every live area's metrics, period by period."}{" "}
            A column is a period and a cell is one metric's value with its
            change from the period before. Click an events cell to read or log
            that period's entries; a derived cell opens its source rows for that
            period; a period header opens that review.
          </p>
        </div>
        <div className="analytics-page__actions">
          <Button
            variant="outline"
            data-testid="analytics-ask-companion"
            onClick={() => void onAskCompanion()}
            title="Open a chat with the companion, briefed to define a metric"
          >
            Ask the companion
          </Button>
          <Button
            variant="primary"
            data-testid="analytics-new-metric"
            onClick={openMetricForm}
          >
            New metric
          </Button>
        </div>
      </header>

      <div className="analytics-toolbar">
        <label className="analytics-toolbar__field">
          <span className="analytics-toolbar__label">Cadence</span>
          <select
            className="input-field"
            data-testid="analytics-cadence"
            value={cadence}
            onChange={(event) =>
              setCadence(event.target.value as ReviewCadence)
            }
          >
            {CADENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="analytics-toolbar__note">
          {periods.length > 0
            ? `${periods.length} periods · ${periods[0]?.label} – ${
                periods[periods.length - 1]?.label
              }`
            : "The last eight periods of the chosen cadence."}
        </p>
      </div>

      {companionStatus ? (
        <p
          className="analytics-page__notice"
          data-testid="analytics-companion-status"
          role="status"
        >
          {companionStatus}
        </p>
      ) : null}

      {proposalStatus ? (
        <p
          className="analytics-page__notice analytics-proposal-status"
          data-testid="analytics-proposal-status"
          role="status"
        >
          {proposalStatus}
        </p>
      ) : null}

      {error ? (
        <p
          className="analytics-page__error"
          data-testid="analytics-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p
          className="analytics-page__loading"
          data-testid="analytics-loading"
          role="status"
        >
          Reading the metrics…
        </p>
      ) : null}

      {isEmpty ? (
        <section className="analytics-empty" data-testid="analytics-empty">
          <p className="analytics-empty__title">
            No metrics defined for {lensName} yet.
          </p>
          <p className="analytics-empty__hint">
            Ask the companion to define one, or create an events metric or a
            database-derived one with the New metric button — events are logged
            from this page, derived values come from a database.
          </p>
        </section>
      ) : null}

      {!loading && matrix && matrix.rows.length > 0 ? (
        <section
          className="analytics-matrix-card"
          aria-label={`Metrics by ${cadence} period`}
        >
          <div className="analytics-matrix-scroll">
            <table
              className="analytics-matrix"
              data-testid="analytics-matrix"
            >
              <caption className="visually-hidden">
                Metric values by period, oldest to newest
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="analytics-matrix__corner">
                    Metric
                  </th>
                  {periods.map((period) => (
                    <th
                      key={period.period}
                      scope="col"
                      className="analytics-matrix__period-head"
                    >
                      <Link
                        className="analytics-matrix__period-link"
                        data-testid={`analytics-period-link-${period.period}`}
                        to={reviewHref(period.period)}
                        title={`Open the review for ${period.label}`}
                      >
                        {period.label}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.areaSlug}>
                  <tr
                    className="analytics-matrix__area-row"
                    data-testid={`analytics-area-${group.areaSlug}`}
                  >
                    <th scope="colgroup" colSpan={periods.length + 1}>
                      {group.areaName}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr
                      key={`${row.areaSlug}-${row.metricId}`}
                      className="analytics-matrix__row"
                      data-testid={`analytics-row-${row.areaSlug}-${row.metricId}`}
                    >
                      <th scope="row" className="analytics-matrix__metric">
                        <div className="analytics-matrix__metric-head">
                          <span className="analytics-matrix__label">
                            {row.label}
                          </span>
                          <span className="analytics-matrix__metric-actions">
                            <button
                              type="button"
                              className="analytics-events__action"
                              data-testid={`analytics-metric-edit-${row.areaSlug}-${row.metricId}`}
                              title={`Edit ${row.label} (proposed in Decisions)`}
                              onClick={() => void beginMetricEdit(row)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="analytics-events__action is-danger"
                              data-testid={`analytics-metric-delete-${row.areaSlug}-${row.metricId}`}
                              title={`Delete ${row.label} (proposed in Decisions)`}
                              onClick={() => {
                                setProposalStatus(null);
                                setDeleteTarget(row);
                              }}
                            >
                              Delete
                            </button>
                          </span>
                        </div>
                        <span className="analytics-matrix__meta">
                          {rowMeta(row)}
                        </span>
                      </th>
                      {periods.map((period, index) => {
                        const cell = row.cells[index] ?? null;
                        if (!cell) {
                          return (
                            <td
                              key={period.period}
                              className="analytics-matrix__cell"
                            />
                          );
                        }
                        const noData = cell.valueText === null;
                        const label = `${row.label}, ${period.label}`;
                        return (
                          <td
                            key={cell.period}
                            className={`analytics-matrix__cell${
                              noData ? " is-nodata" : ""
                            }`}
                          >
                            <button
                              type="button"
                              className="analytics-cell"
                              data-testid={`analytics-cell-${row.areaSlug}-${row.metricId}-${cell.period}`}
                              data-value={cell.valueText ?? ""}
                              data-delta={cell.deltaText ?? ""}
                              data-nodata={noData ? "true" : "false"}
                              onClick={() =>
                                onCellClick(row, cell, period.label)
                              }
                              title={
                                row.source === "derived"
                                  ? row.timeColumnId
                                    ? `${label}: open the source database filtered to this period`
                                    : `${label}: open the source database`
                                  : `${label}: show the logged events`
                              }
                              aria-label={
                                row.source === "derived"
                                  ? row.timeColumnId
                                    ? `${label}: ${cell.valueText ?? "no data"}. Open the source database filtered to this period.`
                                    : `${label}: ${cell.valueText ?? "no data"}. Open the source database.`
                                  : `${label}: ${cell.valueText ?? "no data"}. Show the logged events.`
                              }
                            >
                              <span className="analytics-cell__value">
                                {noData ? "—" : cell.valueText}
                              </span>
                              {!noData && cell.deltaText !== null ? (
                                <span className="analytics-cell__delta">
                                  {cell.deltaText}
                                </span>
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <footer className="analytics-matrix-card__foot">
            <span>
              {matrix ? `As of ${formatAsOf(matrix.asOf)}` : null}
            </span>
            <span className="analytics-matrix-card__legend">
              — means no rows in the window
            </span>
          </footer>
        </section>
      ) : null}

      {deleteTarget ? (
        <section
          className="analytics-confirm"
          data-testid="analytics-metric-delete-panel"
          aria-label={`Delete ${deleteTarget.label}`}
        >
          <p className="analytics-confirm__text">
            Delete <strong>{deleteTarget.label}</strong>? It is sent to
            Decisions; the definition stays — and this metric keeps measuring —
            until you approve it.
          </p>
          <div className="analytics-confirm__actions">
            <button
              type="button"
              className="analytics-events__action is-danger"
              data-testid="analytics-metric-delete-confirm"
              disabled={proposing}
              onClick={() => void onConfirmDelete()}
            >
              {proposing ? "Sending…" : "Send to Decisions"}
            </button>
            <button
              type="button"
              className="analytics-events__action"
              data-testid="analytics-metric-delete-cancel"
              disabled={proposing}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {!loading && matrix && matrix.problems.length > 0 ? (
        <section
          className="analytics-problems"
          data-testid="analytics-problems"
          role="status"
        >
          <h2 className="analytics-problems__title">
            Some definitions could not be read
          </h2>
          <ul>
            {matrix.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {panel ? (
        <section
          className="analytics-panel"
          data-testid="analytics-cell-panel"
          aria-label={`${panel.row.label}, ${panel.periodLabel}`}
        >
          <header className="analytics-panel__header">
            <div>
              <h2 className="analytics-panel__title">
                {panel.row.label} · {panel.periodLabel}
              </h2>
              <p className="analytics-panel__meta">
                {panel.row.areaName}
                {panel.row.unit ? ` · ${panel.row.unit}` : ""}
                {` · ${AGGREGATION_LABELS[panel.row.aggregation]}`}
              </p>
            </div>
            <div className="analytics-panel__actions">
              <Link
                className="analytics-panel__review-link"
                data-testid="analytics-open-review"
                to={reviewHref(panel.cell.period, panel.row.areaSlug)}
              >
                Open that period's review
              </Link>
              <Button
                variant="ghost"
                className="analytics-panel__close"
                onClick={() => setPanel(null)}
              >
                Close
              </Button>
            </div>
          </header>

          {eventsError ? (
            <p
              className="analytics-page__error"
              data-testid="analytics-events-error"
              role="alert"
            >
              {eventsError}
            </p>
          ) : null}

          {eventsLoading ? (
            <p
              className="analytics-page__loading"
              data-testid="analytics-events-loading"
              role="status"
            >
              Reading the events…
            </p>
          ) : (
            <table
              className="analytics-events"
              data-testid="analytics-events-table"
            >
              <caption className="visually-hidden">
                Logged events for this metric in this period
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Value</th>
                  <th scope="col">Note</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {events && events.rows.length > 0 ? (
                  events.rows.map((row) =>
                    editingRowId === row.rowId ? (
                      <tr
                        key={row.rowId}
                        className="analytics-events__row is-editing"
                        data-testid={`analytics-event-${row.rowId}`}
                      >
                        <td>
                          <input
                            type="date"
                            className="input-field analytics-events__input"
                            data-testid={`analytics-event-date-${row.rowId}`}
                            value={editDate}
                            onChange={(event) =>
                              setEditDate(event.target.value)
                            }
                            aria-label="Event date"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="input-field analytics-events__input"
                            data-testid={`analytics-event-value-${row.rowId}`}
                            value={editValue}
                            onChange={(event) =>
                              setEditValue(event.target.value)
                            }
                            aria-label="Event value"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="input-field analytics-events__input"
                            data-testid={`analytics-event-note-${row.rowId}`}
                            value={editNote}
                            onChange={(event) =>
                              setEditNote(event.target.value)
                            }
                            aria-label="Event note"
                          />
                        </td>
                        <td className="analytics-events__actions">
                          <button
                            type="button"
                            className="analytics-events__action is-primary"
                            data-testid={`analytics-event-save-${row.rowId}`}
                            onClick={() => void onSaveEdit()}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="analytics-events__action"
                            data-testid={`analytics-event-cancel-${row.rowId}`}
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={row.rowId}
                        className="analytics-events__row"
                        data-testid={`analytics-event-${row.rowId}`}
                      >
                        <td className="analytics-events__date">{row.date}</td>
                        <td className="analytics-events__value">{row.value}</td>
                        <td className="analytics-events__note">{row.note}</td>
                        <td className="analytics-events__actions">
                          <button
                            type="button"
                            className="analytics-events__action"
                            data-testid={`analytics-event-edit-${row.rowId}`}
                            onClick={() => beginEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="analytics-events__action is-danger"
                            data-testid={`analytics-event-delete-${row.rowId}`}
                            onClick={() => void onDeleteEvent(row.rowId)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ),
                  )
                ) : (
                  <tr className="analytics-events__row">
                    <td
                      className="analytics-events__empty"
                      colSpan={4}
                      data-testid="analytics-events-empty"
                    >
                      No events in this period yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {editStatus ? (
            <p
              className="analytics-page__error"
              data-testid="analytics-events-status"
              role="alert"
            >
              {editStatus}
            </p>
          ) : null}

          <form
            className="analytics-log-form"
            data-testid="analytics-log-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onLogEvent();
            }}
          >
            <h3 className="analytics-log-form__title">Log an event</h3>
            <div className="analytics-log-form__fields">
              <label className="analytics-toolbar__field">
                <span className="analytics-toolbar__label">Date</span>
                <input
                  type="date"
                  className="input-field"
                  data-testid="analytics-log-date"
                  value={logDate}
                  onChange={(event) => setLogDate(event.target.value)}
                />
              </label>
              <label className="analytics-toolbar__field">
                <span className="analytics-toolbar__label">Value</span>
                <input
                  type="number"
                  className="input-field"
                  data-testid="analytics-log-value"
                  value={logValue}
                  onChange={(event) => setLogValue(event.target.value)}
                />
              </label>
              <label className="analytics-toolbar__field analytics-log-form__note">
                <span className="analytics-toolbar__label">Note</span>
                <input
                  type="text"
                  className="input-field"
                  data-testid="analytics-log-note"
                  value={logNote}
                  placeholder="Optional"
                  onChange={(event) => setLogNote(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="analytics-log-form__submit"
                data-testid="analytics-log-submit"
                disabled={logging}
                onClick={() => void onLogEvent()}
              >
                {logging ? "Logging…" : "Log event"}
              </button>
            </div>
            <p
              className="analytics-log-form__status"
              data-testid="analytics-log-status"
              role="status"
            >
              {logStatus ?? ""}
            </p>
          </form>
        </section>
      ) : null}

      {metricFormOpen ? (
        <section
          className="analytics-metric-form"
          data-testid="analytics-metric-form"
          data-mode={editingMetric ? "edit" : "create"}
          aria-label={editingMetric ? "Edit metric" : "New metric"}
        >
          <header className="analytics-metric-form__header">
            <h2 className="analytics-metric-form__title">
              {editingMetric ? "Edit metric" : "New metric"}
            </h2>
            <p className="analytics-metric-form__hint">
              {editingMetric
                ? "Saving sends this change to Decisions. The definition — and what this metric measures — changes only once you approve it."
                : "An events metric stores one dated row per entry, logged from this page. A database-derived metric is computed from a database's rows: pick the database, the number to measure and the date column its periods use."}
            </p>
          </header>
          <div className="analytics-metric-form__fields">
            <label className="analytics-toolbar__field">
              <span className="analytics-toolbar__label">Area</span>
              <select
                className="input-field"
                data-testid="analytics-metric-area"
                value={metricArea}
                disabled={editingMetric !== null}
                onChange={(event) => setMetricArea(event.target.value)}
              >
                <option value="">Select area…</option>
                {areaChoices.map((area) => (
                  <option key={area.slug} value={area.slug}>
                    {area.meta.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="analytics-toolbar__field">
              <span className="analytics-toolbar__label">Source</span>
              <select
                className="input-field"
                data-testid="analytics-metric-source"
                value={metricSource}
                onChange={(event) => {
                  setMetricSource(event.target.value as MetricSource);
                  setMetricStatus(null);
                }}
              >
                <option value="events">Events — logged from this page</option>
                <option value="derived">
                  Database — computed from rows
                </option>
              </select>
            </label>
            <label className="analytics-toolbar__field">
              <span className="analytics-toolbar__label">Label</span>
              <input
                type="text"
                className="input-field"
                data-testid="analytics-metric-label"
                value={metricLabel}
                placeholder="Training sessions"
                onChange={(event) => setMetricLabel(event.target.value)}
              />
            </label>
            <label className="analytics-toolbar__field">
              <span className="analytics-toolbar__label">Unit</span>
              <input
                type="text"
                className="input-field"
                data-testid="analytics-metric-unit"
                value={metricUnit}
                placeholder="sessions"
                onChange={(event) => setMetricUnit(event.target.value)}
              />
            </label>
            {metricSource === "derived" ? (
              <>
                <label className="analytics-toolbar__field">
                  <span className="analytics-toolbar__label">Database</span>
                  <select
                    className="input-field"
                    data-testid="analytics-metric-database"
                    value={metricDatabaseId}
                    onChange={(event) =>
                      onPickMetricDatabase(event.target.value)
                    }
                  >
                    <option value="">Select database…</option>
                    {metricDatabases.map((entry) => (
                      <option
                        key={`${entry.domainSlug}:${entry.database.id}`}
                        value={entry.database.id}
                      >
                        {entry.database.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="analytics-toolbar__field">
                  <span className="analytics-toolbar__label">Measure</span>
                  <select
                    className="input-field"
                    data-testid="analytics-metric-measure"
                    value={metricMeasureColumnId}
                    onChange={(event) =>
                      setMetricMeasureColumnId(event.target.value)
                    }
                  >
                    <option value="">Select number column…</option>
                    {measureChoices.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="analytics-toolbar__field">
                  <span className="analytics-toolbar__label">Date column</span>
                  <select
                    className="input-field"
                    data-testid="analytics-metric-date"
                    value={metricTimeColumnId}
                    onChange={(event) =>
                      setMetricTimeColumnId(event.target.value)
                    }
                  >
                    <option value="">Select date column…</option>
                    {timeChoices.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="analytics-toolbar__field">
              <span className="analytics-toolbar__label">Aggregation</span>
              <select
                className="input-field"
                data-testid="analytics-metric-aggregation"
                value={metricAggregation}
                onChange={(event) =>
                  setMetricAggregation(event.target.value as MetricAggregation)
                }
              >
                {AGGREGATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="analytics-toolbar__field">
              <span className="analytics-toolbar__label">Target</span>
              <input
                type="number"
                className="input-field"
                data-testid="analytics-metric-target"
                value={metricTarget}
                placeholder="Optional"
                onChange={(event) => setMetricTarget(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="analytics-log-form__submit"
              data-testid="analytics-metric-save"
              disabled={metricSaving || proposing}
              onClick={() => void onSaveMetric()}
            >
              {metricSaving
                ? "Saving…"
                : editingMetric
                  ? "Propose change"
                  : "Save metric"}
            </button>
            {editingMetric ? (
              <button
                type="button"
                className="analytics-events__action"
                data-testid="analytics-metric-cancel"
                onClick={closeMetricForm}
              >
                Cancel
              </button>
            ) : null}
          </div>
          {metricSource === "derived" && derivedHint ? (
            <p
              className="analytics-metric-form__hint"
              data-testid="analytics-metric-derived-hint"
            >
              {derivedHint}
              {!metricDatabasesLoading &&
              !metricDatabasesError &&
              (metricDatabases.length === 0 ||
                (selectedDatabase !== null &&
                  (measureChoices.length === 0 ||
                    timeChoices.length === 0))) ? (
                <>
                  {" "}
                  <Link
                    className="analytics-metric-form__link"
                    to="/data"
                  >
                    Open Data
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <p
            className="analytics-metric-form__status"
            data-testid="analytics-metric-status"
            role="status"
          >
            {metricStatus ?? ""}
          </p>
        </section>
      ) : null}
    </div>
  );
}

/** The matrix's "as of" line: minute precision is honest and short. */
function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
