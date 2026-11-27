/**
 * E2E harness page for the object-shaped ViewCard.
 *
 * It mounts the real component against a fixture of the shape the engine now
 * returns: several objects in one card, one of them a series split, one a
 * derived average (a metric with `from`), one reading a second database, and
 * one a raw listing. The page stubs `window.lifequest` before render and
 * records every save, so the driver can prove that a presentation switch writes
 * ONLY the presentation.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { CSSProperties } from "react";
import type { ComposedViewRunResult, SavedView } from "@lifequest/vault-core";
import { ViewCard } from "@/components/ui/ViewCard";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

applyAppSkin("dark");

type Fixture = {
  view: SavedView;
  run: { ok: true; value: ComposedViewRunResult } | { ok: false; error: string };
};

type SaveRecord = {
  viewId: string | null;
  blocks: Array<Record<string, unknown>>;
};

type HarnessWindow = Window & {
  viewCardReady?: boolean;
  viewCardCommits?: number;
  installFixture?: (key: string, fixture: Fixture) => boolean;
  renderViewCard?: (domainSlug: string, viewId: string) => boolean;
  viewSaveLog?: SaveRecord[];
  viewCardSkin?: string;
};

const harness = window as HarnessWindow;
const fixtures: Record<string, Fixture> = {};
harness.viewSaveLog = [];

const WRAP: CSSProperties = { padding: 24, display: "grid", gap: "0.85rem" };

const ZAR = "ZAR" as const;

function block(
  id: string,
  title: string,
  presentation: "table" | "bar" | "line" | "metric" | "list",
  result: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title,
    presentation,
    groupBy: "date",
    timeBucket: "month",
    timeColumnId: "date",
    timeWindow: { kind: "previous-months", months: 4 },
    filters: [],
    measure: "sum",
    measureColumnId: "amount",
    per: null,
    sort: { by: "label", dir: "asc" },
    limit: 12,
    convertToZar: false,
    columns: [],
    ...extra,
    result: { columns: ["label", "value"], warnings: [], currency: ZAR, ...result },
  };
}

const MONTHS_ROWS: [string, number][] = [
  ["2026-06", 200],
  ["2026-07", 300],
  ["2026-08", 300],
  ["2026-09", 100],
];
const SERIES = ["Food", "Travel", "Rent"];
const SERIES_ROWS: [string, string, number][] = [
  ["2026-06", "Food", 100],
  ["2026-06", "Travel", 100],
  ["2026-07", "Food", 200],
  ["2026-07", "Rent", 100],
  ["2026-08", "Food", 300],
  ["2026-09", "Travel", 100],
];

const OBJECTS_VIEW = {
  schemaVersion: 1 as const,
  id: "v-objects",
  databaseId: "finance:transactions",
  title: "Spending, object by object",
  presentation: "table" as const,
  groupBy: "date",
  timeBucket: "month" as const,
  timeColumnId: "date",
  timeWindow: { kind: "previous-months" as const, months: 4 },
  filters: [],
  measure: "sum" as const,
  measureColumnId: "amount",
  per: null,
  sort: { by: "label" as const, dir: "asc" as const },
  limit: 12,
  convertToZar: false,
  columns: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  blocks: [
    {
      id: "months",
      title: "Month by month",
      presentation: "table" as const,
      groupBy: "date",
      timeBucket: "month" as const,
      timeColumnId: "date",
      timeWindow: { kind: "previous-months" as const, months: 4 },
      filters: [],
      measure: "sum" as const,
      measureColumnId: "amount",
      per: null,
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
      columns: [],
      seriesBy: "category",
      display: { palette: "warm" as const },
    },
    {
      id: "average",
      title: "Average month",
      presentation: "metric" as const,
      from: "months",
      measure: "avg" as const,
      measureColumnId: null,
      per: null,
      groupBy: null,
      timeBucket: null,
      timeColumnId: null,
      timeWindow: "all" as const,
      filters: [],
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
      columns: [],
    },
    {
      id: "trend",
      title: "By category",
      presentation: "line" as const,
      groupBy: "date",
      timeBucket: "month" as const,
      timeColumnId: "date",
      timeWindow: { kind: "previous-months" as const, months: 4 },
      filters: [],
      measure: "sum" as const,
      measureColumnId: "amount",
      per: null,
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
      columns: [],
      seriesBy: "category",
      display: {
        palette: "cool" as const,
        legend: true,
        xLabel: "Month",
        yLabel: "Spend",
        valueLabels: true,
      },
    },
    {
      id: "accounts",
      title: "Accounts",
      presentation: "metric" as const,
      databaseId: "finance:accounts",
      measure: "count" as const,
      groupBy: null,
      timeBucket: null,
      timeColumnId: null,
      timeWindow: "all" as const,
      filters: [],
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
      columns: [],
    },
    {
      id: "rows",
      title: "The rows themselves",
      presentation: "list" as const,
      groupBy: null,
      timeBucket: null,
      timeColumnId: "date",
      timeWindow: { kind: "previous-months" as const, months: 4 },
      filters: [],
      measure: "sum" as const,
      measureColumnId: "amount",
      per: null,
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
      columns: ["date", "payee", "amount"],
    },
  ],
} as unknown as SavedView;

const OBJECTS_RUN: ComposedViewRunResult = {
  title: "Spending, object by object",
  warnings: [],
  blocks: [
    block("months", "Month by month", "table", {
      rows: MONTHS_ROWS,
      summary: { label: "total", value: 900 },
      series: SERIES,
      seriesRows: SERIES_ROWS,
    }, { seriesBy: "category", display: { palette: "warm" } }),
    block("average", "Average month", "metric", {
      rows: [["value", 225]],
      summary: { label: "average", value: 225 },
    }, { from: "months", measure: "avg", measureColumnId: null }),
    block("trend", "By category", "line", {
      rows: MONTHS_ROWS,
      summary: { label: "total", value: 900 },
      series: SERIES,
      seriesRows: SERIES_ROWS,
    }, { seriesBy: "category", display: { palette: "cool", legend: true, xLabel: "Month", yLabel: "Spend", valueLabels: true } }),
    block("accounts", "Accounts", "metric", {
      rows: [["value", 2]],
      summary: { label: "value", value: 2 },
      // A count has no currency. ZAR here would be the fixture inventing a unit
      // the engine never returns for a measure that is not an amount.
      currency: null,
    }, { databaseId: "finance:accounts", measure: "count", groupBy: null, timeBucket: null, timeColumnId: null }),
    block("rows", "The rows themselves", "list", {
      rows: [],
      columns: ["Date", "Payee", "Amount"],
      listRows: [
        ["2026-09-05", "September travel", 100],
        ["2026-08-05", "August food", 300],
        ["2026-07-20", "July rent", 100],
        ["2026-07-05", "July food", 200],
      ],
      currencyColumn: "Amount",
    }, { groupBy: null, timeBucket: null, columns: ["date", "payee", "amount"] }),
  ] as unknown as ComposedViewRunResult["blocks"],
};

const SCHEMA = {
  id: "finance:transactions",
  name: "Transactions",
  sotMode: "local-canonical-mirror",
  adapter: null,
  columns: [
    { id: "date", name: "date", type: "date" },
    { id: "amount", name: "amount", type: "number" },
    { id: "category", name: "category", type: "select", options: ["Food", "Travel", "Rent"] },
    { id: "payee", name: "payee", type: "text" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/**
 * What the real save does to this harness: the block's presentation changes and
 * the run keeps drawing the same rows. The engine's own data-preservation is
 * proven by `dashboard-objects-e2e`; this page proves the RENDERER reads one
 * dataset for every drawing.
 */
function applySave(key: string, spec: Record<string, unknown>): void {
  const fixture = fixtures[key];
  if (!fixture) return;
  const blocks = Array.isArray(spec.blocks)
    ? (spec.blocks as Array<Record<string, unknown>>)
    : [{ ...(spec as Record<string, unknown>), id: "block-1" }];
  fixture.view = {
    ...(spec as unknown as SavedView),
    id: fixture.view.id,
    createdAt: fixture.view.createdAt,
    updatedAt: "2026-10-28T00:00:00.000Z",
  };
  fixture.run = {
    ok: true,
    value: {
      ...fixture.run.value,
      title: (spec.title as string) ?? fixture.run.value.title,
      blocks: fixture.run.value.blocks.map((b) => {
        const match = blocks.find((nb) => nb.id === b.id);
        return match
          ? { ...b, presentation: match.presentation as typeof b.presentation }
          : b;
      }),
    },
  };
}

fixtures["financial::v-objects"] = {
  view: OBJECTS_VIEW,
  run: { ok: true, value: OBJECTS_RUN },
};

(window as unknown as { lifequest: object }).lifequest = {
  viewGet: (slug: string, viewId: string) => {
    const fixture = fixtures[`${slug}::${viewId}`];
    return Promise.resolve(
      fixture ? { ok: true, value: fixture.view } : { ok: false, error: `View not found: ${viewId}` },
    );
  },
  viewRunSaved: (slug: string, viewId: string) => {
    const fixture = fixtures[`${slug}::${viewId}`];
    return Promise.resolve(fixture ? fixture.run : { ok: false, error: "View not found" });
  },
  dbGet: () => Promise.resolve({ ok: true, value: SCHEMA }),
  viewSave: (slug: string, spec: Record<string, unknown>, viewId?: string) => {
    const key = `${slug}::${viewId ?? ""}`;
    const blocks = Array.isArray(spec.blocks)
      ? (spec.blocks as Array<Record<string, unknown>>)
      : [{ ...spec, id: "block-1" }];
    harness.viewSaveLog!.push({
      viewId: viewId ?? null,
      blocks: blocks.map((b) => ({
        id: b.id,
        presentation: b.presentation,
        groupBy: b.groupBy,
        timeBucket: b.timeBucket,
        measure: b.measure,
        measureColumnId: b.measureColumnId,
        timeWindow: b.timeWindow,
        seriesBy: b.seriesBy,
        display: b.display,
        from: b.from,
        databaseId: b.databaseId,
      })),
    });
    applySave(key, spec);
    const fixture = fixtures[key];
    return Promise.resolve(
      fixture
        ? { ok: true, value: { ...fixture.view, id: viewId ?? fixture.view.id } }
        : { ok: false, error: "View not found" },
    );
  },
};

function App() {
  return (
    <div style={WRAP}>
      <ViewCard domainSlug="financial" viewId="v-objects" editable />
    </div>
  );
}

/** Rendered in an effect so a driver can wait on a committed DOM, not a frame. */
function CommitProbe() {
  useEffect(() => {
    harness.viewCardCommits = (harness.viewCardCommits ?? 0) + 1;
  });
  return null;
}

harness.renderViewCard = (slug: string, viewId: string) => {
  harness.viewCardReady = true;
  harness.viewCardSkin = document.documentElement.dataset.skin;
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <App />
      <CommitProbe />
    </StrictMode>,
  );
  // The App's own effect sets the target; the probe counts commits after it.
  return true;
};

harness.installFixture = (key, fixture) => {
  fixtures[key] = fixture;
  return true;
};

harness.renderViewCard("financial", "v-objects");
