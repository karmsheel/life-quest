import type { DecisionRecord, DocumentTarget } from "@lifequest/vault-core";

/**
 * The operator's view of a pending proposal, as the inbox editor needs it.
 *
 * A Decision is stored as a title plus a markdown body, and for every target
 * except doctrine and library that body is JSON. The editor has to let the
 * operator touch the same thing the card shows — the title, the scalar fields
 * of the proposal — without ever letting it write a proposal the apply path
 * cannot read. So the body is kept here as text (the exact proposal the record
 * holds), and the title and fields are projections over that text: an edit to
 * either rewrites the text, and the text is what is sent to `decisionAmend`.
 * There is one source of truth, so the fields, the exact-proposal textarea and
 * the saved record cannot disagree.
 *
 * The helpers are pure and live outside the component because the rules they
 * encode are the operator-facing contract, not rendering: which targets carry a
 * title in the body at all (approval reads it from `title`, `patch.title`,
 * `name` or `spec.title` depending on the target), which body keys are the
 * proposal's target rather than its content, and how a typed field value goes
 * back into JSON.
 */

export type FieldKind = "string" | "number" | "boolean" | "null";

/** One scalar the operator can edit as a typed control, addressed by dot path. */
export type EditableField = {
  /** Dot path into the proposal body, e.g. `summary` or `patch.title`. */
  key: string;
  label: string;
  kind: FieldKind;
  /** The current value as the control shows it (booleans as "true"/"false"). */
  value: string;
  /** Keys whose text reads as prose are rendered as a textarea, not a line. */
  multiline: boolean;
};

/**
 * Where the title the operator edits actually lives.
 *
 * `path: null` means the record's own `proposedTitle` (a doctrine, a library
 * note or a page). Otherwise approval will overwrite the title from this body
 * path, so the editor has to edit the body as well: fixing only the card's
 * title would save the corrected spelling next to a file that keeps the typo.
 */
export type TitleBinding = { path: string | null };

/**
 * The parsed shape of the proposal text.
 *
 * `invalid` exists because the operator can type into the exact-proposal
 * textarea — malformed JSON is a state the editor must show, not crash on or
 * send to the vault.
 */
export type ProposalParse =
  | { kind: "json"; body: Record<string, unknown>; error: null }
  | { kind: "prose"; body: null; error: null }
  | { kind: "invalid"; body: null; error: string };

/** What the editor starts from, derived once on mount. */
export type EditorStart = {
  /** The working proposal text: pretty JSON, or the markdown as filed. */
  text: string;
  /** The title the title input starts on. */
  title: string;
  binding: TitleBinding | null;
  prose: boolean;
};

/**
 * Body keys that name what the Decision applies to rather than what it says.
 *
 * Changing one would retarget the file approval writes or change the command
 * under the card the operator read, so they are not offered as fields. The
 * engine refuses them through the exact-proposal textarea too; this list is
 * what keeps them out of the friendly controls.
 */
export const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  "type",
  "op",
  "id",
  "rowId",
  "databaseId",
  "mappingId",
  "viewId",
  "boardSlug",
  "domainSlug",
  "agentId",
  "cadence",
  "period",
  "expectedUpdatedAt",
  "schemaVersion",
]);

/**
 * Field names the app already speaks.
 *
 * The same vocabulary DecisionBody reads with, so the editor and the card the
 * operator just left name a field identically. Unknown keys fall back to the
 * shared labelize shape ("nextAction" -> "Next action").
 */
export const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  name: "Name",
  summary: "Summary",
  bodyMarkdown: "Notes",
  notes: "Notes",
  stateNote: "State note",
  status: "Status",
  priority: "Priority",
  startDate: "Start date",
  targetDate: "Target date",
  deadline: "Deadline",
  progress: "Progress",
  nextAction: "Next action",
  addUpdate: "Progress update",
  definitionOfDone: "Definition of done",
  metric: "Metric",
  target: "Target",
  horizonMonths: "Horizon (months)",
  description: "Description",
  color: "Colour",
  dayTypeId: "Day type",
  replacementId: "Replace with",
  weekday: "Weekday",
  items: "Items",
  databaseName: "Database",
  databaseId: "Database",
  rowLabel: "Row",
  goalId: "Goal",
  domainSlug: "Domain",
  columnId: "Column",
  relationDatabaseId: "Relates to",
  relationDatabaseName: "Relates to",
  pageId: "Page",
  sourceKind: "Source",
};

/** Prose-shaped keys are a paragraph, not a one-line value. */
const MULTILINE_KEYS: ReadonlySet<string> = new Set([
  "bodyMarkdown",
  "notes",
  "stateNote",
  "summary",
  "definitionOfDone",
  "description",
  "markdown",
  "rationale",
]);

export function isProseTarget(target: DocumentTarget): boolean {
  // Doctrine and library documents are markdown files, and a review Decision's
  // body is the review's markdown too — the apply path writes it with
  // `applyLockedReviewBody` exactly as written. Everything else parses its body
  // as JSON. Getting this wrong in either direction is not cosmetic: a prose
  // body parsed as JSON shows an editor that refuses every save, and a JSON
  // body edited as prose sends a string the apply path cannot read.
  return (
    target.type === "doctrine" ||
    target.type === "library" ||
    target.type === "review"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the proposal the way the apply path will.
 *
 * Doctrine and library decisions are markdown and are taken as written. Every
 * other target's body is JSON — approval parses it — so anything that does not
 * parse (or parses to something that is not an object) is reported as an error
 * the editor shows instead of a save it would refuse.
 */
export function parseProposalText(
  target: DocumentTarget,
  text: string,
): ProposalParse {
  if (isProseTarget(target)) return { kind: "prose", body: null, error: null };
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      kind: "invalid",
      body: null,
      error: "The proposal is empty — there is nothing to save yet.",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      kind: "invalid",
      body: null,
      error: `The proposal is not valid JSON: ${reason}`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      kind: "invalid",
      body: null,
      error: "The proposal must be a JSON object.",
    };
  }
  return { kind: "json", body: parsed, error: null };
}

/**
 * Where approval reads the title from, for the targets whose body carries one.
 *
 * These mirror the engine's own `bodyTitlePath` on purpose: a title the editor
 * offers in a different place from the one approval writes would be a control
 * that promises a change it does not make. A goal's delete command has no name,
 * a database's add-column `name` is a column rather than the database's, and a
 * project's title moves under `patch` on an update — all three are why this is
 * a function per target instead of a fixed key.
 */
export function titlePathFor(
  target: DocumentTarget,
  body: Record<string, unknown>,
): string | null {
  switch (target.type) {
    case "project":
      if (body.type === "createProject") return "title";
      if (body.type === "updateProject" && isRecord(body.patch)) return "patch.title";
      return null;
    case "goal":
      return body.type === "deleteGoal" ? null : "name";
    case "database":
      return body.op === "create-database" ? "name" : null;
    case "day-template":
      return typeof body.name === "string" ? "name" : null;
    case "view":
      return isRecord(body.spec) ? "spec.title" : null;
    default:
      return null;
  }
}

/** The title control for this Decision, or null when the target has no title. */
export function titleBindingFor(
  target: DocumentTarget,
  body: Record<string, unknown> | null,
): TitleBinding | null {
  // A doctrine, library note and page write their title from `proposedTitle`,
  // not from the body, so the record's own field is the one to edit.
  if (target.type === "doctrine" || target.type === "library" || target.type === "page") {
    return { path: null };
  }
  if (!body) return null;
  const path = titlePathFor(target, body);
  return path ? { path } : null;
}

/** Read a dot path out of a proposal body. */
export function valueAtPath(
  body: Record<string, unknown>,
  path: string,
): unknown {
  let cursor: unknown = body;
  for (const key of path.split(".")) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

/** A body value as the title input shows it. */
export function titleTextAt(
  body: Record<string, unknown>,
  path: string,
): string {
  const value = valueAtPath(body, path);
  if (typeof value === "string") return value;
  return value == null ? "" : String(value);
}

/** A copy of `body` with one dot path replaced; the original is not mutated. */
export function withPathValue(
  body: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  const next: Record<string, unknown> = { ...body };
  if (!head) return next;
  if (rest.length === 0) {
    next[head] = value;
    return next;
  }
  const child = next[head];
  next[head] = isRecord(child)
    ? withPathValue(child, rest.join("."), value)
    : withPathValue({}, rest.join("."), value);
  return next;
}

function kindOf(value: unknown): FieldKind | null {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return null;
}

function scalarField(
  key: string,
  leaf: string,
  value: unknown,
  prefix = "",
): EditableField | null {
  const kind = kindOf(value);
  if (!kind) return null;
  return {
    key,
    label: `${prefix}${FIELD_LABELS[leaf] ?? labelize(leaf)}`,
    kind,
    value: kind === "null" ? "" : String(value),
    multiline: kind === "string" && MULTILINE_KEYS.has(leaf),
  };
}

/**
 * The scalar fields of a JSON proposal body, in a stable order.
 *
 * Top-level scalars come first in body order. `patch` is opened up because a
 * project update is the one target whose payload is mostly nested, and the
 * common correction there is a field inside the patch — forcing that through
 * raw JSON would make the operator read a brace language to fix a typo. Every
 * other nested value and every list stays in the exact-proposal textarea: the
 * editor shows what it can type safely, and the textarea stays the escape hatch
 * for everything else.
 *
 * Two keys are withheld because approval would not read the edit. The title
 * path is the control the title input owns (offering it twice would be two
 * controls over one value). A page's body also carries a stale `title` key that
 * its apply path ignores in favour of `proposedTitle` — a "Title" field there
 * would promise a rename that approving does not make, so the operator gets it
 * through the title input, which is what approval writes.
 */
export function editableFields(
  target: DocumentTarget,
  body: Record<string, unknown>,
  titlePath: string | null,
): EditableField[] {
  const fields: EditableField[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    if (target.type === "page" && key === "title") continue;
    if (key === "patch" && isRecord(value)) {
      for (const [patchKey, patchValue] of Object.entries(value)) {
        if (STRUCTURAL_KEYS.has(patchKey)) continue;
        const fieldKey = `patch.${patchKey}`;
        if (fieldKey === titlePath) continue;
        const field = scalarField(fieldKey, patchKey, patchValue, "Patch · ");
        if (field) fields.push(field);
      }
      continue;
    }
    if (key === titlePath) continue;
    const field = scalarField(key, key, value);
    if (field) fields.push(field);
  }
  return fields;
}

/** A typed field's string back to the JSON value it came from. */
export function coerceFieldValue(kind: FieldKind, raw: string): unknown {
  switch (kind) {
    case "number": {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "boolean":
      return raw === "true";
    case "null":
      return raw.trim() ? raw : null;
    case "string":
      return raw;
  }
}

/** The body as the record stores it, formatted for the exact-proposal textarea. */
export function serializeBody(body: Record<string, unknown>): string {
  return JSON.stringify(body, null, 2);
}

/**
 * Whether the operator may correct this Decision in the inbox.
 *
 * A pairing Decision proposes a connection, not a document, and a finance-kit
 * install has no editable content — presenting an editor for either would offer
 * an edit with nothing to edit. Closing a project is a one-line answer to a
 * proposal already read; there is no title or field to correct, so it keeps the
 * plain Approve/Reject pair.
 */
export function supportsAmendment(
  decision: Pick<DecisionRecord, "target" | "proposedBodyMarkdown">,
): boolean {
  const target = decision.target;
  if (target.type === "agent-pairing" || target.type === "kit-install") return false;
  if (target.type === "project") {
    const parsed = parseProposalText(target, decision.proposedBodyMarkdown);
    if (parsed.kind === "json" && parsed.body.type === "closeProject") return false;
  }
  return true;
}

/** Derive the editor's opening state from the record. */
export function buildEditorStart(decision: DecisionRecord): EditorStart {
  const target = decision.target;
  const prose = isProseTarget(target);
  const parsed = parseProposalText(target, decision.proposedBodyMarkdown);
  const body = parsed.kind === "json" ? parsed.body : null;
  const binding = titleBindingFor(target, body);
  const fallbackTitle = decision.proposedTitle ?? decision.title;
  let title = fallbackTitle;
  if (binding?.path && parsed.kind === "json") {
    const fromBody = titleTextAt(parsed.body, binding.path);
    if (fromBody) title = fromBody;
  }
  return {
    text:
      parsed.kind === "json"
        ? serializeBody(parsed.body)
        : decision.proposedBodyMarkdown,
    title,
    binding,
    prose,
  };
}

function labelize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/:/g, " · ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
