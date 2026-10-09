import type { MapToolDef } from "./map/tools.ts";
import type { Actor, DatabaseMeta } from "./types.ts";
import {
  listViews,
  runViewBlocks,
  validateViewSpec,
  getView,
  saveView,
  MAX_VIEW_BLOCKS,
} from "./views.ts";
import { VIEW_SPEC_SCHEMA, VIEW_VOCABULARY, viewSpecTemplate } from "./view-schema.ts";
import { getDatabase } from "./domain-databases.ts";
import {
  boardLabel,
  isPinBoardLocked,
  listPinBoard,
  setPins,
} from "./pins.ts";
import { getPage } from "./pages.ts";
import { SYSTEM_PIN_KINDS } from "./types.ts";
import type { ComposedViewRunResult, Pin, Result, ViewSpec } from "./types.ts";

/**
 * Agent-built dashboard views (plan.md design). The Dashboard is the home pin
 * board — one per lens: the Overview board and one board per domain. The
 * companion reads it with get_dashboard and changes it with save_view (one card)
 * or arrange_dashboard (the whole board).
 *
 * The DASHBOARD PAGE LOCK is the only gate, and it is the one the operator sets
 * on the board itself:
 *
 *   unlocked  the write lands. Saving a card and pinning it are one call, so a
 *             "summary table on my dashboard" costs ONE save_view and nothing
 *             else.
 *   locked    the board is read-only. The same call files ONE pending Decision
 *             carrying the full spec and today's rows; approval saves the view
 *             and pins it, and never unlocks the board.
 *
 * This replaced two things that made the feature fail in practice. The old flow
 * made saving a view and pinning it two separate Decisions-or-not: the companion
 * had to propose a view, WAIT for the operator to approve it, and only then
 * arrange the board — and `propose_view` returned a viewId-shaped field that was
 * actually a databaseId, so the pin it then attempted named a view that did not
 * exist. And `arrange_dashboard` applied for the companion by NAME while filing
 * a Decision for every other agent, so what happened depended on who asked
 * rather than on anything the operator could see. Now one call does the whole
 * job and the board's own lock decides where it lands.
 *
 * The companion never emits SQL: preview_view runs the same parameterized read
 * the dashboard card will.
 *
 * 2026-10-08 — the second, larger failure, and why this file now teaches:
 *
 * Six recorded sessions tried "create a weekly summary of expenses on the
 * Dashboard" and not one card was made. The reason was upstream of everything
 * above: the MCP door advertised every tool with an EMPTY argument schema, so
 * the model could not see that `spec` was an object with a `groupBy`, a
 * `timeBucket` and a `timeWindow`. It guessed, and every preview_view and
 * save_view call it made across those sessions passed `spec` as a JSON STRING
 * and died on `spec must be an object` — 40+ identical failures, then a
 * runaway repetition loop. `pairing-door.ts` now advertises the real schema
 * (`VIEW_SPEC_SCHEMA` below) and `parseSpec` also accepts a stringified object,
 * because a model that has been told the shape once should not be able to lose
 * a turn to a quoting habit.
 *
 * The second half of that fix is that a validation failure now ANSWERS the
 * question it raises: the reply carries the live column ids, the allowed
 * vocabulary, and two specs built from that database that would pass. A model
 * that gets a field wrong should need one retry, not a discovery tour.
 */

const SPEC_ARG_DESCRIPTION =
  "The card, as a live query. Pass it as a JSON object — never as a string. " +
  "One aggregate, or a `blocks` array for a card with several panels. " +
  "Use get_database first if you do not know the column ids.";

export const VIEW_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_dashboard",
    description:
      "Read one dashboard (pin board) as it currently stands: whether the page is locked, and " +
      "every pin in order with its human label, kind, and span. domainSlug names a domain's " +
      "dashboard; null names the Overview dashboard. Call this before arranging so you change the " +
      "real board, not an imagined one. The `locked` field is the whole write rule: unlocked, your " +
      "view and pin changes land at once; locked, the same call files one pending Decision. " +
      "A view pin's `viewId` is what you pass to save_view to change that card in place.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: "string",
          description: "The dashboard: a domain slug like 'financial', or null for the Overview dashboard.",
        },
      },
      required: ["domainSlug"],
    },
  },
  {
    name: "save_view",
    description:
      "Put a table, chart, or metric card on a dashboard, or change one that is already there. This " +
      "is the ONE call that does it: it validates the spec, saves the view, and pins it to the board " +
      "you name, in that order and in one step. On an UNLOCKED board it applies at once (the reply " +
      "says applied: true with the viewId and the card's rows) — do not call arrange_dashboard " +
      "afterwards, and do not call preview_view first unless you actually need to compare options. " +
      "On a LOCKED board it files one pending Decision that saves and pins the card when the " +
      "operator approves (the reply says proposed: true with a decisionId); say that a decision is " +
      "waiting. The call is the same either way, so you never have to know the lock state first.\n\n" +
      "`domainSlug` is the domain that OWNS the view and its database (the view file lives there). " +
      "`boardSlug` is the dashboard it lands on: null for the Overview board, or a domain slug for " +
      "that domain's board. They differ legitimately — a financial weekly summary belongs on " +
      "Overview, so domainSlug: \"financial\" with boardSlug: null. A domain board only accepts its " +
      "own domain's view. `span` 2 makes the card the full row, which a composed view usually " +
      "wants.\n\n" +
      "To CHANGE a card that already exists — including how one of its blocks is displayed — read it " +
      "with get_view, change the field you mean to change, and call save_view again with the same " +
      "`viewId`. That updates the card in place and keeps its position on the board. Omitting " +
      "`viewId` creates a new card.\n\n" +
      "The CARD draws itself in the app's design system, so a spec carries data and never looks: " +
      "no currency symbols, thousands separators, markdown, or prose in a title. Its table headers " +
      "come from the query — a timeBucket names the label column (Month, Week), a groupBy names the " +
      "column it grouped by — and a number's format follows the theme. Keep a table under about 12 " +
      "rows and a chart under about 20 points, which is all a card has room for.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: "string",
          description: "The domain that owns the view and its database, e.g. 'financial'.",
        },
        boardSlug: {
          type: "string",
          description:
            "The dashboard to pin it on: a domain slug, or null for the Overview board. An absent " +
            "value means the Overview board.",
        },
        spec: VIEW_SPEC_SCHEMA,
        span: {
          type: "number",
          description: "1 = one grid cell (default), 2 = the full row. A composed card is usually 2.",
        },
        viewId: {
          type: "string",
          description:
            "Update this saved card in place instead of creating a new one. Take it from " +
            "get_dashboard or list_views; leave it out for a new card.",
        },
      },
      required: ["domainSlug", "boardSlug", "spec"],
    },
  },
  {
    name: "get_view",
    description:
      "Read one saved card's full spec: its title, its database, and every block with its " +
      "presentation, groupBy, measure, and window. Use this before changing a card — it is the only " +
      "way to see how a block is currently displayed. Change what you need and send the whole spec " +
      "back through save_view with the same viewId.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain that owns the view, e.g. 'financial'." },
        viewId: { type: "string", description: "The saved view's id, from get_dashboard or list_views." },
      },
      required: ["domainSlug", "viewId"],
    },
  },
  {
    name: "arrange_dashboard",
    description:
      "Set one dashboard's pins: reorder, add a saved view pin (span 1 = one cell, 2 = full row), " +
      "or unpin by leaving a pin out. The array is the COMPLETE board, so keep every pin you do " +
      "not change and keep their order meaningful. Read get_dashboard first and send back the full " +
      "board with your changes.\n\n" +
      "On an UNLOCKED board this applies at once. On a LOCKED board nothing is written: the call " +
      "files one pending Decision with your full pin list, and the board moves when the operator " +
      "approves. Either way the reply tells you which happened. To ADD a card you have not saved " +
      "yet, use save_view instead — this tool can only pin views that already exist (see " +
      "list_views), and the two calls are not interchangeable.\n\n" +
      "A pin's `domainSlug` is the domain that OWNS the view, which is not always the board's: the " +
      "Overview board (domainSlug: null) is the cross-domain board and accepts any live domain's " +
      "view, so a financial weekly summary belongs there. A domain board still shows only its own " +
      "domain's views, and a page pin must belong to the board's domain.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: "string",
          description: "The dashboard: a domain slug like 'financial', or null for the Overview dashboard.",
        },
        pins: {
          type: "array",
          description:
            "The complete new pin list for that board. Copy each pin object from get_dashboard " +
            "exactly as it came back and reorder, add, or drop entries.",
        },
      },
      required: ["domainSlug", "pins"],
    },
  },
  {
    name: "list_views",
    description:
      "List the saved views in a domain: id, title, presentation, and the database each reads. " +
      "Use this to see what is already available to pin, or to find the viewId of a card you want " +
      "to change.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain, e.g. 'financial'." },
      },
      required: ["domainSlug"],
    },
  },
  {
    name: "preview_view",
    description:
      "Run a view spec against a domain database and return what the dashboard card would show: " +
      "rows of [label, value], warnings, and the shared currency. Nothing is saved. Use this only " +
      "when you need to compare options or check a number before committing — save_view already " +
      "returns the card's rows, so a plain \"make me a weekly summary\" needs no preview at all. " +
      "The reply also names whether the board you are aiming at is locked, when you pass boardSlug.\n\n" +
      "A spec is either ONE aggregate (query fields at the top level) or a COMPOSED view: add a " +
      "`blocks` array (up to " + MAX_VIEW_BLOCKS + ") and each entry is one panel of the same card, " +
      'e.g. {"databaseId":"finance:transactions","title":"Weekly expenses",' +
      '"blocks":[{"id":"total","title":"Last 8 weeks","presentation":"metric",...},' +
      '{"id":"weeks","title":"Week by week","presentation":"table","groupBy":"date",' +
      '"timeBucket":"week","timeColumnId":"date","timeWindow":{"kind":"last-weeks","weeks":8},...}]}. ' +
      "Each block carries its own presentation, filters, and measure; a field a block omits " +
      "is inherited from the top-level query fields. Use blocks whenever the operator asks for a " +
      '"summary" that needs more than one figure — a metric plus its table is one card, not two views.',
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain, e.g. 'financial'." },
        spec: VIEW_SPEC_SCHEMA,
        boardSlug: {
          type: "string",
          description:
            "Optional: the dashboard you intend to pin on, so the reply can tell you whether that write will land or file a Decision.",
        },
      },
      required: ["domainSlug", "spec"],
    },
  },
];

export async function executeViewTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_dashboard": {
      const domainSlug = parseBoardSlug(args.domainSlug);
      if (domainSlug === INVALID) return toolError("domainSlug must be a slug or null");
      const res = await listPinBoard(root, domainSlug);
      if (!res.ok) return toolError(res.error);
      return {
        domainSlug,
        locked: res.value.locked,
        pins: await Promise.all(res.value.pins.map((p) => describePin(root, p))),
      };
    }

    case "arrange_dashboard": {
      const domainSlug = parseBoardSlug(args.domainSlug);
      if (domainSlug === INVALID) return toolError("domainSlug must be a slug or null");
      const pinsRes = parsePins(args.pins);
      if (!pinsRes.ok) return toolError(pinsRes.error);
      const res = await setPins(root, domainSlug, pinsRes.value, actor);
      if (!res.ok) return toolError(res.error);
      if (res.value.applied) {
        return {
          applied: true,
          locked: res.value.locked,
          pins: res.value.pins.map((p) => p.id),
        };
      }
      return {
        proposed: true,
        locked: res.value.locked,
        decisionId: res.value.decision.id,
        status: res.value.decision.status,
        note:
          `${boardLabel(domainSlug)} is locked, so nothing was written: the whole pin list is ` +
          "waiting in the Decisions card. Tell the operator that, and do not resend it.",
      };
    }

    case "save_view": {
      const slug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const boardSlug = parseBoardSlug(args.boardSlug);
      if (boardSlug === INVALID) return toolError("boardSlug must be a slug or null");
      const specRes = parseSpec(args.spec ?? flattenedSpec(args));
      if (!specRes.ok) return toolError(specRes.error);
      const spec = specRes.value;
      // `span` is documented as part of the spec — it is the one field in there
      // that describes the CARD rather than the query — so a caller that puts it
      // there is following the schema, and reading it from the spec as well as
      // from the argument is what makes that true.
      const spanRes = parseSpan(args.span ?? (spec as { span?: unknown }).span);
      if (!spanRes.ok) return toolError(spanRes.error);
      const viewId = typeof args.viewId === "string" && args.viewId.trim() ? args.viewId.trim() : null;
      if (viewId) {
        // An edit names a card that has to be here: a typo must not silently
        // create a second card beside the one the operator asked to change.
        const existing = await getView(root, slug, viewId);
        if (!existing.ok) {
          return toolError(
            `${existing.error}. To CHANGE a card, pass the viewId get_dashboard or list_views ` +
              "reported; to create a new one, leave viewId out.",
          );
        }
      }
      const check = await checkSpec(root, slug, spec);
      if (!check.ok) return check.reply;
      // A spec that saves but cannot DRAW is the second half of the 2026-10-08
      // failure: the run's refusal used to ride back inside `card.error` while
      // the file was written and the pin landed, so the operator got a card that
      // showed nothing and the companion — told `applied: true` — made a SECOND
      // card with the fix instead of correcting the first. Nothing is written
      // until the card is known to run.
      const run = await runViewBlocks(root, slug, spec);
      if (!run.ok) {
        return toolError(run.error, specFix(check.db, slug));
      }
      const preview = previewShape(run.value);
      return writeViewAndPin(root, actor, slug, spec, boardSlug, spanRes.value, preview, viewId);
    }

    case "get_view": {
      const slug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const viewId = typeof args.viewId === "string" ? args.viewId : "";
      const res = await getView(root, slug, viewId);
      if (!res.ok) return toolError(res.error);
      const { createdAt: _c, updatedAt: _u, ...spec } = res.value;
      return {
        viewId: res.value.id,
        title: res.value.title,
        spec,
        note:
          "This is the whole card. Change the field you mean to change — a block's `presentation`, " +
          "its `groupBy`, or its `timeWindow` — and send the whole spec back through save_view with " +
          `viewId: "${res.value.id}" to update it in place.`,
      };
    }

    case "propose_view": {
      // Kept for a caller that names the old tool: the answer says what to call
      // instead of silently doing something the operator did not ask for. On a
      // locked board save_view files the same Decision, so nothing is lost.
      return toolError(
        "propose_view is now save_view: it saves the view AND pins it in one call, on any board. " +
          "Call save_view with domainSlug, boardSlug, and the spec.",
      );
    }

    case "list_views": {
      const slug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const res = await listViews(root, slug);
      if (!res.ok) return toolError(res.error);
      return {
        views: res.value.map((v) => ({
          id: v.id,
          title: v.title,
          presentation: v.presentation,
          databaseId: v.databaseId,
          blocks: Array.isArray(v.blocks) ? v.blocks.length : 1,
        })),
      };
    }

    case "preview_view": {
      const slug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const specRes = parseSpec(args.spec ?? flattenedSpec(args));
      if (!specRes.ok) return toolError(specRes.error);
      const check = await checkSpec(root, slug, specRes.value);
      if (!check.ok) return check.reply;
      const run = await runViewBlocks(root, slug, specRes.value);
      if (!run.ok) return toolError(run.error);
      const boardSlug = parseBoardSlug(args.boardSlug);
      const shape = previewShape(run.value);
      if (boardSlug === INVALID) return shape;
      // Knowing the lock here is what keeps the model from promising "it's on
      // your dashboard" for a change that is really sitting in the inbox.
      const locked = await isPinBoardLocked(root, boardSlug);
      return {
        ...shape,
        board: {
          domainSlug: boardSlug,
          locked,
          note: locked
            ? "save_view will file one pending Decision for this board, because it is locked."
            : "save_view will land on this board at once, because it is unlocked.",
        },
      };
    }

    default:
      return toolError(`Unknown view tool: ${name}`);
  }
}

/**
 * Save a view and pin it, or file the one Decision that does both.
 *
 * Shared by save_view and, in future, any other caller: the lock decision and
 * the two write shapes live here rather than in the tool, so a second entry
 * point cannot invent a third behaviour.
 *
 * `viewId` present means the operator is changing a card that already exists:
 * the file keeps its id and its place on the board, and only its contents move.
 */
async function writeViewAndPin(
  root: string,
  actor: Actor,
  domainSlug: string,
  spec: ViewSpec,
  boardSlug: string | null,
  span: 1 | 2,
  preview: unknown,
  viewId: string | null,
): Promise<unknown> {
  const locked = await isPinBoardLocked(root, boardSlug);
  if (locked) {
    // Locked board → one Decision carrying the spec AND the pin, so approval
    // completes the whole request. Filing only the view would leave the
    // operator's card saved and invisible, which is the failure this design
    // exists to remove.
    const { createDecision } = await import("./decisions.ts");
    const title = spec.title.trim() || "Saved view";
    const created = await createDecision(root, {
      target: { type: "view", domainSlug, viewId: viewId ?? "" },
      proposedTitle: title,
      proposedBodyMarkdown: JSON.stringify(
        { op: "save-view", domainSlug, spec, preview, boardSlug, span, viewId },
        null,
        2,
      ),
      actor,
    });
    if (!created.ok) return toolError(created.error);
    return {
      proposed: true,
      locked: true,
      decisionId: created.value.id,
      status: created.value.status,
      boardSlug,
      note:
        `${boardLabel(boardSlug)} is locked, so nothing was written yet. One Decision saves the ` +
        `view and pins it on approval. Name the card and tell the operator a decision is waiting; ` +
        `do not call arrange_dashboard for it.`,
    };
  }

  const saved = await saveView(root, domainSlug, spec as Omit<ViewSpec, "schemaVersion">, {
    ...(viewId ? { id: viewId } : {}),
  });
  if (!saved.ok) return toolError(saved.error);
  const savedId = saved.value.id;
  const pin: Pin = { id: `view:${domainSlug}:${savedId}`, kind: "view", domainSlug, viewId: savedId, span };
  const board = await listPinBoard(root, boardSlug);
  if (!board.ok) return toolError(board.error);
  const pins = [
    ...board.value.pins.filter(
      (p) => !(p.kind === "view" && p.domainSlug === domainSlug && p.viewId === savedId),
    ),
    pin,
  ];
  const written = await setPins(root, boardSlug, pins, actor);
  if (!written.ok) return toolError(written.error);
  if (!written.value.applied) {
    // Cannot happen — the lock was read a moment ago and `setPins` only gates on
    // the lock — but reporting a Decision the caller did not expect beats
    // claiming a pin that is not on the board.
    return {
      proposed: true,
      locked: true,
      decisionId: written.value.decision.id,
      status: written.value.decision.status,
    };
  }
  // A second card with the same name on the same board is almost never what was
  // wanted: it is what a companion makes when it corrects a card it has just
  // created without naming it. The write stands — the operator may genuinely
  // want two — but the reply names the other card so the NEXT correction lands
  // in place instead of beside it.
  const twin = viewId === null ? await findSameTitledCard(root, written.value.pins, domainSlug, savedId) : null;

  return {
    applied: true,
    locked: false,
    updated: viewId !== null,
    viewId: savedId,
    boardSlug,
    span,
    // The numbers the card will show, so the caller can name them in its reply
    // without a second preview round trip. This is the whole speed argument for
    // the one-call path: the model already has what it needs to talk.
    card: preview,
    pins: written.value.pins.map((p) => p.id),
    ...(twin ? { existingViewId: twin.viewId, existingTitle: twin.title } : {}),
    note:
      (viewId !== null
        ? `"${saved.value.title}" was updated in place and stays pinned on ${boardLabel(boardSlug)}.`
        : `"${saved.value.title}" is saved and pinned on ${boardLabel(boardSlug)}.`) +
      (twin
        ? ` Another card on this board is also titled "${twin.title}" (viewId: ${twin.viewId}) — to ` +
          `change THAT one, call save_view again with viewId: "${twin.viewId}" instead of adding a third.`
        : "") +
      " Do not call arrange_dashboard for it.",
  };
}

/** Another view pin on the same board whose card carries the same title. */
async function findSameTitledCard(
  root: string,
  pins: Pin[],
  domainSlug: string,
  savedId: string,
): Promise<{ viewId: string; title: string } | null> {
  const title = (await getView(root, domainSlug, savedId)).ok
    ? (await getView(root, domainSlug, savedId)).value.title
    : null;
  if (!title) return null;
  for (const pin of pins) {
    if (pin.kind !== "view" || pin.viewId === savedId) continue;
    const other = await getView(root, pin.domainSlug, pin.viewId);
    if (other.ok && other.value.title === title) {
      return { viewId: pin.viewId, title: other.value.title };
    }
  }
  return null;
}

/** The sentinel `parseBoardSlug` returns for an argument that is neither. */
const INVALID = Symbol("invalid-board");

/**
 * A board argument: a domain slug, or `null` for the Overview board. An absent
 * value is the Overview board too, because that is what a caller meant by not
 * naming one; a value that is neither a string nor null is a mistake worth
 * reporting rather than silently reinterpreting as Overview.
 *
 * The string "null" is accepted as the Overview board: a JSON-shaped client
 * cannot send a bare null inside a string field, and `"null"` is what it sends
 * instead. Reading it as a domain slug named "null" is the one answer that is
 * certainly wrong.
 */
function parseBoardSlug(raw: unknown): string | null | typeof INVALID {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "null") return null;
    return trimmed;
  }
  return INVALID;
}

/**
 * The spec, for a caller that spread it across the arguments instead of nesting
 * it under `spec`.
 *
 * This is the third shape a model reaches for, and it is a one-turn mistake
 * rather than a misunderstanding: it writes `databaseId`, `title`, and `blocks`
 * as siblings of `domainSlug`. Nothing about that is ambiguous — the tool's own
 * argument names are a closed set — so the spec is reassembled here rather than
 * refused. `undefined` when the arguments name no spec field at all, which
 * leaves the refusal to `parseSpec`'s own message.
 */
function flattenedSpec(args: Record<string, unknown>): unknown {
  if (typeof args.databaseId !== "string" || !args.databaseId) return undefined;
  const { domainSlug: _d, boardSlug: _b, span: _s, viewId: _v, spec: _sp, ...rest } = args;
  return rest;
}

/**
 * Validate one spec against its live database.
 *
 * A failure is not just a string: it is the answer to "so what should I have
 * sent?". The reply carries the database's own columns, the vocabulary every
 * field accepts, and two complete specs built from that database that would
 * pass. That is the difference between one retry and the discovery tour six
 * recorded sessions went on.
 */
type SpecCheck =
  | { ok: true; db: DatabaseMeta }
  | { ok: false; reply: { error: { code: string; message: string; fix?: unknown } } };

async function checkSpec(root: string, slug: string, spec: ViewSpec): Promise<SpecCheck> {
  const live = await getDatabase(root, slug, spec.databaseId);
  if (!live.ok) {
    return {
      ok: false,
      reply: toolError(
        `${live.error}. Call list_databases(domainSlug: "${slug}") for the database ids this ` +
          "domain actually has, and pass one of those as spec.databaseId.",
      ),
    };
  }
  const check = validateViewSpec(spec, live.value);
  if (check.ok) return { ok: true, db: live.value };
  return { ok: false, reply: toolError(check.error, specFix(live.value, slug)) };
}

/** The "do this instead" half of a validation failure, for one live database. */
function specFix(db: DatabaseMeta, domainSlug: string): Record<string, unknown> {
  const template = viewSpecTemplate(db);
  return {
    database: { id: db.id, name: db.name, domainSlug },
    columns: db.columns.map((c) => ({
      id: c.id,
      type: c.type,
      ...(c.type === "relation" ? { relationDatabaseId: c.relationDatabaseId } : {}),
    })),
    allowed: VIEW_VOCABULARY,
    dateColumnId: template.dateColumnId,
    numberColumnId: template.numberColumnId,
    workingSpecs: { metric: template.metric, table: template.table },
    rules: [
      "presentation 'metric' takes no groupBy; 'table' and 'bar' require one.",
      "presentation 'line' requires a date groupBy plus timeBucket ('day' | 'week' | 'month').",
      "timeBucket only applies to a date groupBy. 'week' labels rows like 2026-W41, 'month' like 2026-10.",
      "A timeWindow needs timeColumnId on the same block, or it is refused rather than ignored.",
      "measureColumnId must name a number column of this database; a 'count' measure takes none.",
      "Pass `spec` as a JSON object, not as a string.",
    ],
  };
}

/**
 * A card's width: 1 = one grid cell, 2 = the full row. Absent means 1, because
 * that is the grid's normal cell and a caller that says nothing is not asking
 * for anything unusual.
 */
function parseSpan(raw: unknown): Result<1 | 2> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: 1 };
  if (raw === 1 || raw === 2) return { ok: true, value: raw };
  // A model that read the schema as text sends the number as a string.
  if (raw === "1" || raw === "2") return { ok: true, value: raw === "2" ? 2 : 1 };
  return { ok: false, error: "span must be 1 (one cell) or 2 (full row)" };
}

function toolError(
  message: string,
  fix?: unknown,
): { error: { code: string; message: string; fix?: unknown } } {
  return { error: fix === undefined ? { code: "FAILED", message } : { code: "FAILED", message, fix } };
}

/** One board entry as the agent sees it: kind + a human label. */
async function describePin(root: string, pin: Pin): Promise<Record<string, unknown>> {
  if (pin.kind === "system") {
    return { kind: "system", system: pin.system, label: pin.system, id: pin.id };
  }
  if (pin.kind === "page") {
    const page = await getPage(root, pin.domainSlug, pin.pageId);
    return {
      kind: "page",
      id: pin.id,
      domainSlug: pin.domainSlug,
      pageId: pin.pageId,
      label: page.ok ? page.value.title : pin.pageId,
      span: 1,
    };
  }
  const view = await getView(root, pin.domainSlug, pin.viewId);
  return {
    kind: "view",
    id: pin.id,
    domainSlug: pin.domainSlug,
    viewId: pin.viewId,
    label: view.ok ? view.value.title : pin.viewId,
    presentation: view.ok ? view.value.presentation : null,
    span: pin.span,
  };
}

/**
 * Accept a spec, and accept the two ways a caller habitually gets it wrong.
 *
 * A full spec (schemaVersion 1) and a shape missing it are both fine. A spec
 * that arrives as a JSON STRING is parsed rather than refused: the model has
 * been told `spec` is an object, but a nested argument this large is exactly the
 * one a model serialises by reflex, and across six recorded sessions that reflex
 * was the whole failure. A string that does not parse is still refused, and the
 * refusal says which of the two mistakes it was.
 */
function parseSpec(raw: unknown): Result<ViewSpec> {
  let value = raw;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return {
        ok: false,
        error: "spec is empty. Pass the card as a JSON object, e.g. " +
          '{"databaseId":"finance:transactions","title":"Weekly expenses","presentation":"table",' +
          '"groupBy":"date","timeBucket":"week","timeColumnId":"date",' +
          '"timeWindow":{"kind":"last-weeks","weeks":8},"measure":"sum","measureColumnId":"amount"}.',
      };
    }
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return {
        ok: false,
        error:
          "spec was sent as a string that is not valid JSON. Pass `spec` as a JSON OBJECT — the " +
          "tool arguments are already JSON, so the spec is a nested object and must not be " +
          "stringified or escaped.",
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error:
        `spec must be a JSON object, got ${Array.isArray(value) ? "an array" : typeof value}. ` +
        'A minimal one: {"databaseId":"<from list_databases>","title":"My card",' +
        '"presentation":"metric","measure":"count"}.',
    };
  }
  const spec = value as Record<string, unknown>;
  if (spec.schemaVersion === undefined || spec.schemaVersion === null) {
    return { ok: true, value: { ...(spec as Omit<ViewSpec, "schemaVersion">), schemaVersion: 1 } as ViewSpec };
  }
  if (spec.schemaVersion !== 1 && spec.schemaVersion !== "1") {
    return { ok: false, error: `Unsupported view schemaVersion: ${String(spec.schemaVersion)}` };
  }
  return { ok: true, value: { ...spec, schemaVersion: 1 } as unknown as ViewSpec };
}

/**
 * The pin list, and the one habitual mistake: an array sent as a JSON string.
 * `get_dashboard` hands back an array, and a model echoing it back sometimes
 * serialises the whole thing; refusing that would cost a turn for nothing.
 */
function parsePins(raw: unknown): Result<Pin[]> {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return { ok: false, error: "pins was sent as a string that is not valid JSON; pass the array itself" };
    }
  }
  if (!Array.isArray(value)) return { ok: false, error: "pins must be an array" };
  const out: Pin[] = [];
  const knownSystems = SYSTEM_PIN_KINDS as readonly string[];
  for (const p of value) {
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, error: "every pin must be an object" };
    }
    const pin = p as Record<string, unknown>;
    if (pin.id === undefined || pin.id === null) {
      return { ok: false, error: `pin ${out.length}: id is required` };
    }
    if (pin.kind === "view") {
      if (typeof pin.domainSlug !== "string" || !pin.domainSlug) {
        return { ok: false, error: `pin ${out.length}: view pin requires domainSlug` };
      }
      if (typeof pin.viewId !== "string" || !pin.viewId) {
        return { ok: false, error: `pin ${out.length}: view pin requires viewId` };
      }
      if (pin.span !== 1 && pin.span !== 2) {
        return { ok: false, error: `pin ${out.length}: span must be 1 or 2` };
      }
      out.push({ id: String(pin.id), kind: "view", domainSlug: pin.domainSlug, viewId: pin.viewId, span: pin.span as 1 | 2 });
    } else if (pin.kind === "page") {
      if (typeof pin.domainSlug !== "string" || !pin.domainSlug) {
        return { ok: false, error: `pin ${out.length}: page pin requires domainSlug` };
      }
      if (typeof pin.pageId !== "string" || !pin.pageId) {
        return { ok: false, error: `pin ${out.length}: page pin requires pageId` };
      }
      out.push({ id: String(pin.id), kind: "page", domainSlug: pin.domainSlug, pageId: pin.pageId });
    } else if (pin.kind === "system") {
      if (typeof pin.system !== "string" || !knownSystems.includes(pin.system)) {
        return { ok: false, error: `pin ${out.length}: unknown system pin kind ${String(pin.system)}` };
      }
      out.push({ id: String(pin.id), kind: "system", system: pin.system as never });
    } else {
      return { ok: false, error: `pin ${out.length}: unknown pin kind ${String(pin.kind)}` };
    }
  }
  return { ok: true, value: out };
}

/**
 * The compact shape a preview or proposal shows: every block's rows, plus the
 * warnings rolled up. A one-aggregate view is one block named after its
 * presentation, so a caller reads one shape either way.
 */
function previewShape(run: ComposedViewRunResult): {
  title: string;
  blocks: Array<{
    id: string;
    title: string;
    presentation: string;
    columns: string[];
    rows: Array<[string, number]>;
    rowCount: number;
    currency: ComposedViewRunResult["blocks"][number]["result"]["currency"];
  }>;
  warnings: string[];
} {
  return {
    title: run.title,
    blocks: run.blocks.map((b) => ({
      id: b.id,
      title: b.title,
      presentation: b.presentation,
      columns: b.result.columns,
      rows: b.result.rows,
      rowCount: b.result.rows.length,
      currency: b.result.currency,
    })),
    warnings: run.warnings,
  };
}
