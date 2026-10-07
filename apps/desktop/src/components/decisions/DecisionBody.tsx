import type { ReactNode } from "react";
import type { DocumentTarget } from "@lifequest/vault-core";

const MAP_COLORS = new Set([
  "gold",
  "red",
  "blue",
  "green",
  "orange",
  "purple",
  "teal",
  "pink",
]);

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const FIELD_LABELS: Record<string, string> = {
  domainSlug: "Domain",
  bodyMarkdown: "Notes",
  definitionOfDone: "Definition of done",
  horizonMonths: "Horizon",
  databaseName: "Database",
  databaseId: "Database",
  rowLabel: "Row",
  goalId: "Goal",
  dayTypeId: "Day type",
  replacementId: "Replace with",
  sourceKind: "Source",
  columnId: "Column",
  relationDatabaseId: "Relates to",
  relationDatabaseName: "Relates to",
  pageId: "Page",
};

type Lookups = {
  goalName: (id: string) => string | null;
  domainName: (slug: string) => string;
};

type ChangeRow = {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
  /** A relation cell's readable face; the raw id stays as the tooltip. */
  beforeLabel?: string | null;
  afterLabel?: string | null;
};

/** Column id to display label, as resolved for this Decision when it was read. */
type CellLabelMap = Record<string, string> | null;

export function DecisionBody({
  target,
  proposed,
  previous,
  goalName,
  domainName,
}: {
  target: DocumentTarget;
  proposed: string;
  previous: string | null;
  goalName: (id: string) => string | null;
  domainName: (slug: string) => string;
}) {
  const lookups: Lookups = { goalName, domainName };
  const parsed = parseJson(proposed);

  if (!isRecord(parsed)) {
    return <ProseCompare proposed={proposed} previous={previous} />;
  }

  return (
    <div className="decision-proposal">
      {renderStructured(target, parsed, previous, lookups)}
      <details className="decision-source">
        <summary>Exact proposal</summary>
        <pre>{JSON.stringify(parsed, null, 2)}</pre>
      </details>
    </div>
  );
}

function renderStructured(
  target: DocumentTarget,
  body: Record<string, unknown>,
  previous: string | null,
  lookups: Lookups,
): ReactNode {
  switch (target.type) {
    case "database":
    case "database-row":
      return <DatabaseBody target={target} body={body} previous={previous} lookups={lookups} />;
    case "goal":
      return <GoalBody body={body} previous={previous} lookups={lookups} />;
    case "project":
      return <ProjectBody body={body} previous={previous} lookups={lookups} />;
    case "day-template":
      return <DayTemplateBody body={body} lookups={lookups} />;
    case "page":
      return <PageBody body={body} />;
    case "pins":
      return <PinsBody body={body} />;
    case "mapping":
      return <MappingBody body={body} />;
    // KAR-70: the pairing Decision carries no document body. Its proposed
    // body is the fingerprint and the door the caller arrived on, and the
    // generic body would render those as if they were field edits.
    case "agent-pairing":
      return <PairingBody body={body} />;
    case "kit-install":
      return <p className="decision-lead">Install the Finance kit.</p>;
    case "assumption-set":
      return <AssumptionBody body={body} lookups={lookups} />;
    case "view":
      return <ViewBody body={body} />;
    case "database-batch":
      return <BatchBody body={body} lookups={lookups} />;
    default:
      return <GenericBody body={body} previous={previous} lookups={lookups} />;
  }
}

function BatchBody({
  body,
  lookups,
}: {
  body: Record<string, unknown>;
  lookups: Lookups;
}) {
  if (body.op !== "insert-rows" || !Array.isArray(body.rows)) {
    return <GenericBody body={body} previous={null} lookups={lookups} />;
  }
  const databaseName =
    typeof body.databaseName === "string" && body.databaseName ? body.databaseName : "database";
  const rows = body.rows.filter(isRecord);
  return (
    <>
      <p className="decision-lead">Insert {rows.length} rows into {databaseName}.</p>
      {rows.map((row, index) => {
        const cells = isRecord(row.cells) ? row.cells : null;
        // The read path adds a row's relation names as `cellLabels`; without
        // them a relation cell reads as the id the write payload carries.
        const cellLabels = stringMap(row.cellLabels);
        const label =
          typeof row.rowLabel === "string" && row.rowLabel ? row.rowLabel : `Row ${index + 1}`;
        return (
          <ChangeTable
            key={typeof row.id === "string" ? row.id : `row-${index}`}
            lead={label}
            rows={rowsFrom(null, cells, "after", { after: cellLabels })}
            mode="after"
            lookups={lookups}
          />
        );
      })}
    </>
  );
}

/**
 * KAR-70: what the operator approves when they approve a pairing.
 *
 * The fingerprint is the 12-hex hash of the bearer — the only handle on
 * the caller that is safe to show and to store. The raw bearer is not here
 * and never was.
 */
function PairingBody({ body }: { body: Record<string, unknown> }) {
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "—";
  const door = typeof body.door === "string" ? body.door : "—";
  return (
    <div className="decision-proposal">
      <p className="decision-lead">
        Connect this agent. It starts read-only, with no domain assigned and
        Schedule off — you grant what it may reach from Personnel.
      </p>
      <dl className="settings-hermes">
        <div className="settings-field">
          <span>Fingerprint</span>
          <p className="muted">{fingerprint}</p>
        </div>
        <div className="settings-field">
          <span>Door</span>
          <p className="muted">{door}</p>
        </div>
      </dl>
    </div>
  );
}

/**
 * Agent-built dashboard views: what the operator approves is a chart or table
 * on their dashboard. The lead names what will appear and where; the preview
 * rows are the same data the card would show on the day of the proposal.
 */
function ViewBody({ body }: { body: Record<string, unknown> }) {
  const spec = body.spec as Record<string, unknown> | undefined;
  const preview = body.preview as { rows?: unknown[]; currency?: string; warnings?: string[] } | undefined;
  if (!spec || typeof spec !== "object") {
    return <p className="decision-lead">Save a dashboard view. (Spec missing from this proposal.)</p>;
  }
  const title = typeof spec.title === "string" ? spec.title : "Saved view";
  const presentation = typeof spec.presentation === "string" ? spec.presentation : "table";
  return (
    <div className="decision-proposal">
      <p className="decision-lead">
        Save a dashboard view: {title} ({presentation}
        {preview?.rows?.length != null ? ` — showing ${preview.rows.length} row${preview.rows.length === 1 ? "" : "s"} today` : ""}).
        Approve to pin it from the dashboard's Add-pin row.
      </p>
      <dl className="settings-hermes">
        <div className="settings-field">
          <span>Measure</span>
          <p className="muted">
            {typeof spec.measure === "string" ? spec.measure : "?"}
            {typeof spec.measureColumnId === "string" && spec.measureColumnId
              ? ` of ${spec.measureColumnId}`
              : ""}
          </p>
        </div>
        <div className="settings-field">
          <span>Group by</span>
          <p className="muted">
            {typeof spec.groupBy === "string" && spec.groupBy
              ? spec.groupBy
              : typeof spec.timeBucket === "string" && spec.timeBucket
                ? `time (${spec.timeBucket})`
                : "everything in the window"}
          </p>
        </div>
        {preview?.currency ? (
          <div className="settings-field">
            <span>Currency</span>
            <p className="muted">{preview.currency}</p>
          </div>
        ) : null}
        {preview?.warnings && preview.warnings.length > 0 ? (
          <div className="settings-field">
            <span>Warnings</span>
            <p className="muted">{preview.warnings.join("; ")}</p>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function DatabaseBody({
  target,
  body,
  previous,
  lookups,
}: {
  target: Extract<DocumentTarget, { type: "database" | "database-row" }>;
  body: Record<string, unknown>;
  previous: string | null;
  lookups: Lookups;
}) {
  const op = typeof body.op === "string" ? body.op : "";
  const cellLabels = stringMap(body.cellLabels);
  const previousCellLabels = stringMap(body.previousCellLabels);
  const databaseName =
    typeof body.databaseName === "string" && body.databaseName
      ? body.databaseName
      : typeof body.name === "string"
        ? body.name
        : labelize(target.databaseId);

  if (op === "create-database") {
    const name = typeof body.name === "string" ? body.name : databaseName;
    return <p className="decision-lead">Create a database named {name}.</p>;
  }

  if (op === "add-column") {
    // A relation is proposed by database id. The read path resolves that to the
    // target's name; the id is only shown when it could not be resolved.
    const keys = ["name", "type", "options", "relationDatabaseId", "relationDatabaseName"].filter(
      (key) => key in body && !isEmpty(body[key]),
    );
    const collapsed = keys.includes("relationDatabaseName")
      ? keys.filter((key) => key !== "relationDatabaseId")
      : keys;
    const rows: ChangeRow[] = collapsed.map((key) => ({
      key,
      before: undefined,
      after: body[key],
      changed: true,
    }));
    return (
      <ChangeTable
        lead={`Add a column to ${databaseName}.`}
        rows={rows}
        mode="after"
        lookups={lookups}
      />
    );
  }

  if (op && op !== "upsert" && op !== "delete") {
    return <GenericBody body={body} previous={previous} lookups={lookups} />;
  }

  const after = isRecord(body.cells) ? body.cells : null;
  const embeddedBefore = isRecord(body.previousCells) ? body.previousCells : null;
  const previousParsed = parseJson(previous ?? "");
  const before =
    embeddedBefore ??
    (isRecord(previousParsed) && !("op" in previousParsed) ? previousParsed : null);

  if (op === "delete") {
    const rows = rowsFrom(before, null, "before", { before: previousCellLabels });
    return (
      <ChangeTable
        lead={`Delete this row from ${databaseName}.`}
        rows={rows}
        mode="before"
        lookups={lookups}
      />
    );
  }

  const creating = target.type === "database-row" ? target.rowId == null : before == null;
  if (creating || before == null) {
    return (
      <ChangeTable
        lead={`Add a row to ${databaseName}.`}
        rows={rowsFrom(null, after, "after", { after: cellLabels })}
        mode="after"
        lookups={lookups}
      />
    );
  }

  return (
    <ChangeTable
      lead={`Update a row in ${databaseName}.`}
      rows={rowsFrom(before, after, "diff", { before: previousCellLabels, after: cellLabels })}
      mode="diff"
      lookups={lookups}
    />
  );
}

function GoalBody({
  body,
  previous,
  lookups,
}: {
  body: Record<string, unknown>;
  previous: string | null;
  lookups: Lookups;
}) {
  const command = typeof body.type === "string" ? body.type : "";
  const prior = parseJson(previous ?? "");
  const priorRec = isRecord(prior) ? prior : null;

  if (command === "deleteGoal") {
    const rows = priorRec ? rowsFrom(priorRec, null, "before").filter((row) => row.key !== "id") : [];
    return (
      <ChangeTable lead="Delete this goal." rows={rows} mode="before" lookups={lookups} />
    );
  }

  if (command === "createGoal" || command === "updateGoal") {
    const keys = Object.keys(body).filter((key) => key !== "type" && key !== "id");
    const rows: ChangeRow[] = keys.map((key) => ({
      key,
      before: priorRec && key in priorRec ? priorRec[key] : undefined,
      after: body[key],
      changed: !(priorRec && key in priorRec && sameValue(priorRec[key], body[key])),
    }));
    return (
      <ChangeTable
        lead={command === "createGoal" ? "Create this goal." : "Update this goal."}
        rows={rows}
        mode={command === "createGoal" || !priorRec ? "after" : "diff"}
        lookups={lookups}
      />
    );
  }

  return <GenericBody body={body} previous={previous} lookups={lookups} />;
}

function ProjectBody({
  body,
  previous,
  lookups,
}: {
  body: Record<string, unknown>;
  previous: string | null;
  lookups: Lookups;
}) {
  if (body.type === "closeProject") {
    const prior = parseJson(previous ?? "");
    const notes =
      isRecord(prior) && typeof prior.bodyMarkdown === "string" ? prior.bodyMarkdown.trim() : "";
    return (
      <section className="decision-section">
        <p className="decision-lead">Close this project.</p>
        {notes ? <pre className="decision-prose">{notes}</pre> : null}
      </section>
    );
  }
  if (body.type === "createProject") {
    const keys = ["title", "goalId", "domainSlug", "bodyMarkdown"].filter(
      (key) => key in body && !isEmpty(body[key]),
    );
    return (
      <ChangeTable
        lead="Open this project."
        rows={keys.map((key) => ({ key, before: undefined, after: body[key], changed: true }))}
        mode="after"
        lookups={lookups}
      />
    );
  }
  return <GenericBody body={body} previous={null} lookups={lookups} />;
}

function DayTemplateBody({ body, lookups }: { body: Record<string, unknown>; lookups: Lookups }) {
  const command = typeof body.type === "string" ? body.type : "";

  if (command === "setDefaultWeekdayType") {
    const weekday = typeof body.weekday === "number" ? WEEKDAYS[body.weekday] ?? "Weekday" : "Weekday";
    const dayType =
      typeof body.dayTypeId === "string"
        ? textOf(body.dayTypeId, "dayTypeId", lookups)
        : "no default";
    return (
      <p className="decision-lead">
        {weekday} uses {dayType}.
      </p>
    );
  }

  if (command === "setDefaultWeeklyItems") {
    return (
      <section className="decision-section">
        <p className="decision-lead">Replace the default weekly items.</p>
        <ItemList items={body.items} />
      </section>
    );
  }

  if (command === "deleteDayType") {
    return (
      <p className="decision-lead">
        Delete this day type
        {typeof body.replacementId === "string"
          ? `, and move its days to ${textOf(body.replacementId, "replacementId", lookups)}`
          : ""}
        .
      </p>
    );
  }

  if (command === "createDayType" || command === "updateDayType") {
    const keys = ["name", "color"].filter((key) => key in body && !isEmpty(body[key]));
    return (
      <section className="decision-section">
        <ChangeTable
          lead={command === "createDayType" ? "Create this day type." : "Update this day type."}
          rows={keys.map((key) => ({ key, before: undefined, after: body[key], changed: true }))}
          mode="after"
          lookups={lookups}
        />
        {"items" in body ? <ItemList items={body.items} /> : null}
      </section>
    );
  }

  return <GenericBody body={body} previous={null} lookups={lookups} />;
}

function PageBody({ body }: { body: Record<string, unknown> }) {
  const blocks = Array.isArray(body.blocks) ? body.blocks.filter(isRecord) : [];
  return (
    <section className="decision-section">
      <p className="decision-lead">
        {blocks.length === 0
          ? "Clear every block on this page."
          : `Set this page to ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}.`}
      </p>
      {blocks.length > 0 ? (
        <ol className="decision-blocks">
          {blocks.map((block, index) => {
            const summary = blockSummary(block);
            return (
              <li
                key={typeof block.id === "string" ? block.id : index}
                className="decision-block"
                title={summary.ids || undefined}
              >
                <span className="decision-block__kind">{summary.kind}</span>
                {summary.detail ? <span className="decision-block__detail">{summary.detail}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function PinsBody({ body }: { body: Record<string, unknown> }) {
  const pins = Array.isArray(body.pins) ? body.pins.filter(isRecord) : [];
  return (
    <section className="decision-section">
      <p className="decision-lead">
        {pins.length === 0 ? "Clear the pin board." : `Set ${pins.length} ${pins.length === 1 ? "pin" : "pins"}.`}
      </p>
      {pins.length > 0 ? (
        <ol className="decision-pins">
          {pins.map((pin, index) => (
            <li key={typeof pin.id === "string" ? pin.id : index} className="decision-pin">
              <span className="decision-pin__n">{index + 1}</span>
              <span>{pinLabel(pin)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function MappingBody({ body }: { body: Record<string, unknown> }) {
  const columns = Array.isArray(body.columns) ? body.columns.filter(isRecord) : [];
  const databaseId = typeof body.databaseId === "string" ? body.databaseId : "";
  const databaseName = typeof body.databaseName === "string" ? body.databaseName : "";
  const database = databaseName
    ? labelize(databaseName)
    : databaseId && !isUuid(databaseId)
      ? labelize(databaseId)
      : "";
  return (
    <section className="decision-section">
      <p className="decision-lead">
        {databaseName || databaseId ? (
          <span title={databaseId || undefined}>
            {database
              ? `Map incoming columns onto ${database}.`
              : "Map incoming columns onto a database."}
          </span>
        ) : (
          "Map incoming columns onto a database."
        )}
      </p>
      {columns.length > 0 ? (
        <table className="decision-fields">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Column</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column, index) => {
              const source = typeof column.source === "string" ? column.source : "—";
              const columnId = typeof column.columnId === "string" ? column.columnId : "";
              const columnName =
                typeof column.columnName === "string" ? column.columnName : "";
              return (
                <tr key={`${source}-${index}`}>
                  <td>{source}</td>
                  <td title={columnName && columnId ? columnId : undefined}>
                    {columnId || columnName ? (
                      labelize(columnName || columnId)
                    ) : (
                      <span className="decision-empty">Unmapped</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="decision-lead">No columns are mapped.</p>
      )}
    </section>
  );
}

function AssumptionBody({ body, lookups }: { body: Record<string, unknown>; lookups: Lookups }) {
  const rows: ChangeRow[] = ["name", "horizonMonths"]
    .filter((key) => key in body && !isEmpty(body[key]))
    .map((key) => ({ key, before: undefined, after: body[key], changed: true }));
  const deltas = Array.isArray(body.deltas) ? body.deltas.filter(isRecord) : [];
  return (
    <section className="decision-section">
      <ChangeTable lead="Save this assumption set." rows={rows} mode="after" lookups={lookups} />
      {deltas.length > 0 ? (
        <ul className="decision-checklist">
          {deltas.map((delta, index) => (
            <li key={index}>{deltaLine(delta)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function GenericBody({
  body,
  previous,
  lookups,
}: {
  body: Record<string, unknown>;
  previous: string | null;
  lookups: Lookups;
}) {
  const prior = parseJson(previous ?? "");
  const priorRec = isRecord(prior) ? prior : null;
  const hidden = new Set([
    "type",
    "id",
    "expectedUpdatedAt",
    "schemaVersion",
    "previousCells",
    "cells",
    "previousCellLabels",
    "cellLabels",
  ]);
  const rows = rowsFrom(priorRec, body, priorRec ? "diff" : "after").filter(
    (row) => !hidden.has(row.key),
  );
  const verb = typeof body.type === "string" ? labelize(body.type) : "Proposed change";
  return <ChangeTable lead={verb} rows={rows} mode={priorRec ? "diff" : "after"} lookups={lookups} />;
}

function ChangeTable({
  lead,
  rows,
  mode,
  lookups,
}: {
  lead: string;
  rows: ChangeRow[];
  mode: "diff" | "after" | "before";
  lookups: Lookups;
}) {
  const visible = rows.filter((row) => {
    if (mode === "after") return !isEmpty(row.after);
    if (mode === "before") return !isEmpty(row.before);
    return true;
  });
  const changed = mode === "diff" ? visible.filter((row) => row.changed) : visible;
  const unchanged = mode === "diff" ? visible.filter((row) => !row.changed) : [];
  const sentence = /[.!?]$/.test(lead) ? lead : `${lead}.`;
  const changeLead =
    mode === "diff"
      ? changed.length === 0
        ? `${sentence} No field would change.`
        : `${sentence} ${changed.length} ${changed.length === 1 ? "field" : "fields"} would change.`
      : sentence;

  if (visible.length === 0) {
    return <p className="decision-lead">{changeLead}</p>;
  }

  return (
    <section className="decision-section">
      <p className="decision-lead">{changeLead}</p>
      <div className="decision-change">
        <table className="decision-fields">
          <thead>
            <tr>
              <th scope="col">Field</th>
              {mode !== "after" ? <th scope="col">Now</th> : null}
              {mode !== "before" ? <th scope="col">Proposed</th> : null}
            </tr>
          </thead>
          <tbody>
            {(mode === "diff" ? changed : visible).map((row) => (
              <ChangeRowView key={row.key} row={row} mode={mode} lookups={lookups} />
            ))}
          </tbody>
        </table>
        {unchanged.length > 0 ? (
          <details className="decision-unchanged">
            <summary>
              {unchanged.length} unchanged {unchanged.length === 1 ? "field" : "fields"}
            </summary>
            <table className="decision-fields">
              <tbody>
                {unchanged.map((row) => (
                  <ChangeRowView key={row.key} row={row} mode={mode} lookups={lookups} />
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ChangeRowView({
  row,
  mode,
  lookups,
}: {
  row: ChangeRow;
  mode: "diff" | "after" | "before";
  lookups: Lookups;
}) {
  return (
    <tr className={mode === "diff" && row.changed ? "decision-row--changed" : undefined}>
      <th scope="row" className="decision-fields__name">
        {FIELD_LABELS[row.key] ?? labelize(row.key)}
      </th>
      {mode !== "after" ? (
        <td className={mode === "diff" && row.changed ? "decision-value--was" : undefined}>
          <ValueView
            value={row.before}
            field={row.key}
            lookups={lookups}
            label={row.beforeLabel}
          />
        </td>
      ) : null}
      {mode !== "before" ? (
        <td className={mode === "diff" && row.changed ? "decision-value--now" : undefined}>
          <ValueView
            value={row.after}
            field={row.key}
            lookups={lookups}
            label={row.afterLabel}
          />
        </td>
      ) : null}
    </tr>
  );
}

function ValueView({
  value,
  field,
  lookups,
  label,
}: {
  value: unknown;
  field: string;
  lookups: Lookups;
  label?: string | null;
}) {
  if (isEmpty(value)) return <span className="decision-empty">—</span>;
  // A relation cell holds a row id. The label is its readable face and the id
  // stays in the tooltip, so the operator reads prose without losing the value
  // the vault will actually store.
  const raw = typeof value === "string" ? value : null;
  if (label && label !== raw) return <span title={raw ?? undefined}>{label}</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (field === "horizonMonths") return `${value.toLocaleString()} months`;
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof value === "string") {
    if (field === "color" && MAP_COLORS.has(value)) return <ColorValue value={value} />;
    const shown = textOf(value, field, lookups);
    if (shown !== value) return <span title={value}>{shown}</span>;
    return <>{shown}</>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="decision-empty">None</span>;
    if (value.every(isItem)) return <ItemList items={value} />;
    if (value.every((entry) => typeof entry === "string" || typeof entry === "number")) {
      return value.map(String).join(", ");
    }
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, entry]) => !isEmpty(entry));
    if (entries.length === 0) return <span className="decision-empty">—</span>;
    return entries
      .slice(0, 4)
      .map(([key, entry]) => `${FIELD_LABELS[key] ?? labelize(key)}: ${plain(entry)}`)
      .join(" · ");
  }
  return String(value);
}

function ItemList({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? items.filter(isItem) : [];
  if (list.length === 0) return <span className="decision-empty">No items</span>;
  return (
    <ul className="decision-checklist">
      {list.map((item) => (
        <li key={item.id || item.text}>
          {item.text}
          {item.priority ? <span className="muted"> · {labelize(item.priority)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function ProseCompare({ proposed, previous }: { proposed: string; previous: string | null }) {
  const showCurrent = previous != null;
  return (
    <div className={showCurrent ? "decision-prose-grid" : "decision-prose-grid decision-prose-grid--single"}>
      {showCurrent ? (
        <section className="decision-prose-pane">
          <h3 className="decision-prose-pane__label">Current</h3>
          <pre className="decision-prose">{previous || "(empty)"}</pre>
        </section>
      ) : null}
      <section className="decision-prose-pane">
        <h3 className="decision-prose-pane__label">{showCurrent ? "Proposed" : "Proposed text"}</h3>
        <pre className="decision-prose">{proposed || "(empty)"}</pre>
      </section>
    </div>
  );
}

function blockSummary(block: Record<string, unknown>): {
  kind: string;
  detail: string;
  ids: string;
} {
  const kind = typeof block.kind === "string" ? block.kind : "block";
  const labels: Record<string, string> = {
    markdown: "Note",
    "bound-table": "Table",
    metric: "Metric",
    "date-range": "Dates",
    chart: "Chart",
    "goal-progress": "Goal progress",
    deadline: "Deadline",
    "budget-vs-actual": "Budget",
    "net-worth": "Net worth",
    "scenario-compare": "Scenario",
    script: "Script",
  };
  let detail = "";
  const raw: string[] = [];
  // The body carries a name beside each id the vault could resolve; without
  // one, labelize is the best the renderer can do for the id it holds.
  const named = (idField: string, nameField: string): { text: string; raw: string } => {
    const id = typeof block[idField] === "string" ? (block[idField] as string) : "";
    const name = typeof block[nameField] === "string" ? (block[nameField] as string) : "";
    if (id && name) return { text: labelize(name), raw: id };
    return { text: id ? labelize(id) : name, raw: "" };
  };
  if (kind === "markdown") detail = firstLine(typeof block.markdown === "string" ? block.markdown : "");
  else if (kind === "bound-table") {
    const table = named("databaseId", "databaseName");
    detail = table.text;
    if (table.raw) raw.push(table.raw);
  } else if (kind === "metric") {
    const column = named("columnId", "columnName");
    detail = [labelize(String(block.agg ?? "")), column.text].filter(Boolean).join(" · ");
    if (column.raw) raw.push(column.raw);
  } else if (kind === "chart") {
    const y = named("yColumnId", "yColumnName");
    detail = [labelize(String(block.chartType ?? "")), y.text].filter(Boolean).join(" · ");
    if (y.raw) raw.push(y.raw);
  } else if (kind === "date-range") {
    detail = `${plain(block.start) || "open"} – ${plain(block.end) || "open"}`;
  } else if (kind === "script" && typeof block.name === "string") detail = block.name;
  else if (kind === "scenario-compare") {
    const set = named("assumptionSetId", "assumptionSetName");
    detail = set.text;
    if (set.raw) raw.push(set.raw);
  }
  return { kind: labels[kind] ?? labelize(kind), detail, ids: raw.join(" · ") };
}

function pinLabel(pin: Record<string, unknown>): string {
  if (pin.kind === "system" && typeof pin.system === "string") return labelize(pin.system);
  if (pin.kind === "page") return "Page";
  return "Pin";
}

function deltaLine(delta: Record<string, unknown>): string {
  const kind = typeof delta.kind === "string" ? labelize(delta.kind) : "Change";
  const amount = typeof delta.amount === "number" ? delta.amount.toLocaleString() : "";
  const currency = typeof delta.currency === "string" ? delta.currency : "";
  const when = typeof delta.date === "string" ? textOf(delta.date, "date", { goalName: () => null, domainName: (slug) => slug }) : "";
  return [kind, [amount, currency].filter(Boolean).join(" "), when].filter(Boolean).join(" · ");
}

function rowsFrom(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  mode: "diff" | "after" | "before",
  labels?: { before?: CellLabelMap; after?: CellLabelMap },
): ChangeRow[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const source of [after, before]) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys.map((key) => {
    const hasBefore = before != null && key in before;
    const hasAfter = after != null && key in after;
    const beforeValue = hasBefore ? before[key] : undefined;
    const afterValue = hasAfter ? after[key] : undefined;
    // A cell the proposal drops while it was already empty is not a change. A
    // row write is a full replace, so empty cells are simply absent from the new
    // set: without this every null column reads as "- -> -" and the operator has
    // to hunt through the table for the one field that actually moved.
    const bothEmpty = isEmpty(beforeValue) && isEmpty(afterValue);
    const changed =
      mode !== "diff" ||
      (!bothEmpty && (!hasBefore || !hasAfter || !sameValue(beforeValue, afterValue)));
    return {
      key,
      before: beforeValue,
      after: afterValue,
      changed,
      beforeLabel: labels?.before?.[key] ?? null,
      afterLabel: labels?.after?.[key] ?? null,
    };
  });
}

function textOf(value: string, field: string, lookups: Lookups): string {
  if (field === "goalId") return lookups.goalName(value) ?? shortId(value);
  if (field === "domainSlug" || field === "domain") return lookups.domainName(value);
  if (MAP_COLORS.has(value) && (field === "color" || field === "")) return value;
  if (isIsoDate(value)) return formatIso(value);
  if (isUuid(value)) return shortId(value);
  return value;
}

function ColorValue({ value }: { value: string }) {
  return (
    <span className="decision-color">
      <span className="decision-swatch" data-map-color={value} aria-hidden="true" />
      {labelize(value)}
    </span>
  );
}

function plain(value: unknown): string {
  if (isEmpty(value)) return "";
  if (typeof value === "string") return isIsoDate(value) ? formatIso(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function isItem(value: unknown): value is { id: string; text: string; priority?: string } {
  return isRecord(value) && typeof value.text === "string";
}

function isEmpty(value: unknown): boolean {
  return value == null || value === "";
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function shortId(value: string): string {
  return isUuid(value) ? `${value.slice(0, 8)}…` : value;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(value);
}

function formatIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (value.length <= 10) return date.toLocaleDateString(undefined, { dateStyle: "medium" });
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function labelize(key: string): string {
  if (isUuid(key)) return shortId(key);
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/:/g, " · ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > 96 ? `${line.slice(0, 93)}…` : line;
}
