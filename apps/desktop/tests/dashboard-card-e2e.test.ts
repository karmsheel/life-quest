import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ALL_TOOL_DEFS,
  applyFinanceKitInstall,
  createVault,
  listPinBoard,
  listViews,
  runSavedView,
  upsertRow,
  VIEW_SPEC_SCHEMA,
  VIEW_VOCABULARY,
} from "@lifequest/vault-core";
import { startPairingDoors } from "../electron/pairing-door.ts";
import { ensureCompanionToken } from "../electron/pairing-secrets.ts";

/**
 * The companion's dashboard-card path, end to end, over the REAL MCP door.
 *
 * WHY THIS FILE EXISTS
 *
 * Six recorded chat sessions asked for "a weekly summary of expenses on the
 * Dashboard" and not one card was made. The cause was in none of the vault code:
 * the door registered every tool with `inputSchema: z.looseObject({})` and, for
 * the companion, advertised that same empty schema — `properties: {}` for all 62
 * tools. With no property names in front of it the model invented the shape of
 * every argument, and the one it invented identically 40+ times was `spec` as a
 * JSON *string*, which the tool refused with `spec must be an object` before it
 * could judge anything else. Two of those sessions ended in a runaway repetition
 * loop, and the operator's own profile still caches the empty manifest.
 *
 * So this rig is written against the door, not against `executeViewTool`. Every
 * assertion below is an HTTP request to 127.0.0.1 and a read of what that request
 * left on disk, because the thing that failed was the contract the door showed
 * the model, and calling the tool directly would have gone on passing.
 *
 * THE WAYS THIS PATH COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 *   1. The door advertises an empty argument schema again, so a model has to
 *      guess — the original fault, and the reason for step 1 below.
 *   2. The advertised schema drifts from what the validator accepts: a value the
 *      schema offers is refused, or a value the validator wants is not offered.
 *   3. A `spec` sent as a JSON string is refused — the exact historical failure.
 *   4. A refusal says only "spec must be an object", with nothing a model can act
 *      on, so the turn is spent discovering the vocabulary instead of fixing it.
 *   5. `save_view` needs a second call to be usable: the card's numbers are not
 *      in its reply, so the companion must preview first. That is the "a lot of
 *      searching and tool calling" the operator reported.
 *   6. `timeBucket: "week"` does not actually produce weeks.
 *   7. The card is saved but not pinned, or pinned to a board the read path will
 *      not show it on.
 *   8. A card that already exists cannot be changed — the operator asked to be
 *      able to modify a block's display, and a save that always creates a new
 *      view leaves two cards and no way to edit either.
 *   9. Editing names a view that does not exist and silently creates a second
 *      card beside the one the operator asked to change.
 *  10. An edit loses the card's identity or its place: a new id, a new createdAt,
 *      or a second pin on the board.
 *  11. The pin list a model echoes back from `get_dashboard` as a string is
 *      refused, which costs a turn for a quoting habit.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`), which
 * needs no Electron: `pairing-door.ts` imports no Electron module and loads the
 * tool body on demand. The door binds test ports (18_743 / 18_746) so the
 * operator's running LifeQuest, which holds 8643 and 8646, is neither disturbed
 * nor consulted.
 *
 * The artifact is `e2e/artifacts/dashboard-card.json`: same command, same claims,
 * no eyeballing. Failures throw, so the artifact only exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/dashboard-card.json");

/** Test ports. The pairing rig holds 18_643 / 18_646; the live app holds 8643 / 8646. */
const LOCAL_PORT = 18_743;
const INVITE_PORT = 18_746;

type Auth = { bearer?: string };
type Reply = { status: number; json: unknown; raw: string };

/**
 * One JSON-RPC call to the door. `Accept` asks for both shapes the Streamable
 * HTTP transport may answer with; a served call comes back as one `data:` frame.
 */
async function mcp(auth: Auth, method: string, params: unknown = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (auth.bearer !== undefined) headers.authorization = `Bearer ${auth.bearer}`;
  const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await res.text();
  const frame = raw.split("\n").find((line) => line.startsWith("data: "));
  let json: unknown;
  try {
    json = JSON.parse(frame ? frame.slice(6) : raw);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, raw };
}

/** The manifest as the client reads it, argument schemas included. */
async function toolsList(
  auth: Auth,
): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]> {
  const reply = await mcp(auth, "tools/list");
  return (
    (reply.json as { result?: { tools?: { name: string }[] } } | undefined)?.result?.tools ?? []
  ) as { name: string }[];
}

/** One tool call, with the tool's own JSON answer unwrapped. */
async function callTool(
  auth: Auth,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const reply = await mcp(auth, "tools/call", { name, arguments: args });
  const text = (reply.json as { result?: { content?: { text?: string }[] } } | undefined)?.result
    ?.content?.[0]?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** ISO date `days` before an ISO date, in UTC arithmetic on a plain date. */
function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of a Date's LOCAL calendar day — the same rule the view uses. */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The property names one advertised schema declares, or [] when it declares none. */
function propertyNames(schema: unknown): string[] {
  const props = (schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return props && typeof props === "object" ? Object.keys(props) : [];
}

function schemaAt(schema: unknown, ...trail: string[]): unknown {
  let node = schema;
  for (const key of trail) {
    const bag = node as { properties?: Record<string, unknown> } & Record<string, unknown>;
    // `properties.<name>` for a named argument, and the raw key for a schema
    // keyword like `items` that hangs off the node itself.
    node = bag?.properties?.[key] ?? bag?.[key];
  }
  return node;
}

describe("companion dashboard card e2e", () => {
  it("makes, reads, and changes a weekly expense card through the real MCP door", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-dashboard-card-"));
    const vaultRoot = path.join(workDir, "vault");
    const secretsDir = path.join(workDir, "userData", "pairing-secrets");
    fs.mkdirSync(secretsDir, { recursive: true });

    const checks: Record<string, unknown> = {};
    const transcript: Array<Record<string, unknown>> = [];

    const created = await createVault(vaultRoot, "E2E");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
    const vaultId = (created as { ok: true; value: { lifequest: { id: string } } }).value.lifequest.id;

    // ── a real finance kit, with one expense row per week ────────────────────
    const kit = await applyFinanceKitInstall(vaultRoot);
    assert.equal(kit.ok, true, `applyFinanceKitInstall failed: ${kit.ok ? "" : kit.error}`);

    const runAt = new Date();
    runAt.setHours(22, 30, 0, 0);
    const today = localIso(runAt);

    const account = await upsertRow(vaultRoot, "financial", "finance:accounts", {
      cells: {
        name: "Cheque",
        type: "checking",
        currency: "ZAR",
        opening_balance: 0,
        opening_as_of: daysBefore(today, 120),
      },
    });
    assert.equal(account.ok, true, `account upsert failed: ${account.ok ? "" : account.error}`);
    const accountId = (account as { ok: true; value: { id: string } }).value.id;

    // One row per week, each week's total a distinct literal: a bucketing slip
    // moves a number between weeks instead of landing on the same total.
    const amounts = [1111, 1114, 1148, 1265, 2390.34];
    const dates = [28, 21, 14, 7, 0].map((back) => daysBefore(today, back));
    for (let i = 0; i < amounts.length; i += 1) {
      const row = await upsertRow(vaultRoot, "financial", "finance:transactions", {
        cells: { date: dates[i], amount: -amounts[i], account: accountId },
      });
      assert.equal(row.ok, true, `transaction upsert ${i} failed: ${row.ok ? "" : row.error}`);
    }
    checks.rowsSeeded = amounts.length;

    const doors = await startPairingDoors({
      root: vaultRoot,
      vaultId,
      secretsDir,
      localPort: LOCAL_PORT,
      invitePort: INVITE_PORT,
    });
    try {
      assert.equal(doors.localError, null, `the door did not bind: ${doors.localError}`);
      const companion = await ensureCompanionToken(secretsDir, vaultId);
      const auth: Auth = { bearer: companion };
      transcript.push({ step: "door bound", port: doors.localPort, vault: vaultRoot });

      // ── 1. the door tells the model what the arguments ARE ────────────────
      // This is the regression the whole fix exists for. Before it, every tool's
      // `inputSchema.properties` was `{}` — 62 tools a model could only guess at.
      const manifest = await toolsList(auth);
      checks.toolCount = manifest.length;
      assert.equal(manifest.length, ALL_TOOL_DEFS.length, "the companion must see every tool");

      const emptySchemas = manifest.filter((t) => propertyNames(t.inputSchema).length === 0);
      checks.toolsWithNoArguments = emptySchemas.map((t) => t.name);
      // Three tools really do take no arguments (`get_state`, `list_goals`,
      // `list_documents`). The claim is that the door advertises exactly what
      // each tool declares — no more, and no less — so an empty schema is only
      // acceptable where the tool itself is argument-less.
      const declaredEmpty = ALL_TOOL_DEFS.filter(
        (d) => propertyNames((d as { parameters?: unknown }).parameters).length === 0,
      ).map((d) => d.name);
      checks.toolsDeclaredArgumentless = declaredEmpty;
      assert.deepEqual(
        emptySchemas.map((t) => t.name).sort(),
        declaredEmpty.slice().sort(),
        "a tool advertised no argument properties at all, so a model must guess its shape",
      );
      const mismatched = manifest.filter((t) => {
        const declared = ALL_TOOL_DEFS.find((d) => d.name === t.name) as
          | { parameters?: unknown }
          | undefined;
        return (
          propertyNames(t.inputSchema).join(",") !== propertyNames(declared?.parameters).join(",")
        );
      });
      assert.deepEqual(
        mismatched.map((t) => t.name),
        [],
        "the door advertises a different argument shape than the tool declares",
      );

      const previewSchema = manifest.find((t) => t.name === "preview_view")?.inputSchema;
      const saveSchema = manifest.find((t) => t.name === "save_view")?.inputSchema;
      const specSchema = schemaAt(previewSchema, "spec");
      checks.specSchemaProperties = propertyNames(specSchema);
      for (const field of [
        "databaseId",
        "title",
        "presentation",
        "measure",
        "measureColumnId",
        "groupBy",
        "timeBucket",
        "timeColumnId",
        "timeWindow",
        "blocks",
      ]) {
        assert.ok(
          propertyNames(specSchema).includes(field),
          `the advertised spec schema does not name '${field}', so a model has to invent it`,
        );
      }
      assert.ok(
        propertyNames(schemaAt(specSchema, "blocks", "items")).includes("presentation"),
        "a composed card's block schema names no presentation",
      );
      assert.ok(
        propertyNames(saveSchema).includes("viewId"),
        "save_view advertises no viewId, so changing an existing card is undiscoverable",
      );
      assert.ok(
        manifest.some((t) => t.name === "get_view"),
        "get_view is not on the door, so a model cannot read a card before changing it",
      );

      // ── 2. the schema and the validator agree on the vocabulary ───────────
      // A schema that offers a value the tool refuses is worse than no schema:
      // the model follows it, gets refused, and cannot tell which one is wrong.
      const advertised = {
        presentation: schemaAt(specSchema, "presentation")?.enum,
        measure: schemaAt(specSchema, "measure")?.enum,
        timeBucket: schemaAt(specSchema, "timeBucket")?.enum,
      };
      checks.advertisedVocabulary = advertised;
      assert.deepEqual(advertised.presentation, VIEW_VOCABULARY.presentation);
      assert.deepEqual(advertised.measure, VIEW_VOCABULARY.measure);
      assert.deepEqual(advertised.timeBucket, VIEW_VOCABULARY.timeBucket);
      assert.deepEqual(
        propertyNames(VIEW_SPEC_SCHEMA),
        propertyNames(specSchema),
        "the schema the door sends is not the one vault-core exports",
      );

      // ── 3. the exact payload that failed 40 times now works ──────────────
      // A JSON-encoded string in `spec`, which is what the model sent every
      // single time it called preview_view or save_view without a schema.
      const weekly = {
        databaseId: "finance:transactions",
        title: "Weekly expenses",
        presentation: "table",
        measure: "sum",
        measureColumnId: "amount",
        groupBy: "date",
        timeBucket: "week",
        timeColumnId: "date",
        timeWindow: { kind: "last-weeks", weeks: 5 },
        blocks: [
          {
            id: "total",
            title: "Last 5 weeks",
            presentation: "metric",
            measure: "sum",
            measureColumnId: "amount",
            groupBy: null,
            timeColumnId: "date",
            timeWindow: { kind: "last-weeks", weeks: 5 },
          },
          {
            id: "weeks",
            title: "Week by week",
            presentation: "table",
            measure: "sum",
            measureColumnId: "amount",
            groupBy: "date",
            timeBucket: "week",
            timeColumnId: "date",
            timeWindow: { kind: "last-weeks", weeks: 5 },
            limit: 12,
          },
        ],
      };
      const asString = await callTool(auth, "preview_view", {
        domainSlug: "financial",
        spec: JSON.stringify(weekly),
        boardSlug: "financial",
      });
      checks.specAsString = asString;
      assert.equal(
        (asString as { error?: unknown }).error,
        undefined,
        `a spec sent as a JSON string must be accepted, got ${JSON.stringify(asString).slice(0, 200)}`,
      );
      // A preview block reports its rows at the top level (`rows`, `columns`,
      // `currency`), which is the compact shape a model reads.
      const stringPanels = (asString as { blocks: { id: string; rows: [string, number][] }[] }).blocks;
      assert.equal(stringPanels.length, 2, "the composed card lost a panel");

      // ── 4. timeBucket week really buckets weeks ───────────────────────────
      const weekRows = stringPanels.find((b) => b.id === "weeks")!.rows;
      checks.weekLabels = weekRows.map(([label]) => label);
      assert.equal(weekRows.length, 5, `the weekly panel drew ${weekRows.length} rows, expected 5`);
      for (const [label] of weekRows) {
        assert.match(label, /^\d{4}-W\d{2}$/, `week label ${label} is not an ISO week`);
      }
      assert.deepEqual(
        weekRows.map(([, v]) => v).sort((a, b) => a - b),
        [...amounts].map((a) => -a).sort((a, b) => a - b),
        "each week's bucket must hold exactly one week's amount",
      );

      // ── 5. a wrong spec comes back with the answer, not just a refusal ────
      // The old reply was `spec must be an object` and nothing else, which is
      // why the model spent turns discovering the vocabulary instead of fixing
      // the call. The reply now names the database's own columns.
      const wrong = await callTool(auth, "preview_view", {
        domainSlug: "financial",
        spec: {
          databaseId: "finance:transactions",
          title: "Weekly",
          presentation: "table",
          measure: { field: "amount", operator: "sum" },
          groupBy: "week",
          timeWindow: { field: "date", operator: "last_7_days" },
        },
      });
      checks.wrongSpec = wrong;
      const fix = (wrong as { error?: { message?: string; fix?: { columns?: { id: string }[]; workingSpecs?: unknown } } })
        .error?.fix;
      assert.ok(fix, "a refused spec carried no `fix`, so a model has nothing to correct it with");
      assert.ok(
        (fix?.columns ?? []).some((c) => c.id === "amount"),
        "the `fix` does not name the live columns",
      );
      assert.ok(fix?.workingSpecs, "the `fix` offers no spec that would pass");

      // ── 5b. a spec that validates but cannot RUN is refused ──────────────
      // The measured duplicate: the first weekly card this door accepted had a
      // windowed metric panel with no `timeColumnId`, so the RUN refused it while
      // the file was written and the pin landed. The companion was told
      // `applied: true`, corrected the panel, and made a SECOND card — leaving
      // the broken one on the board. Nothing may be written until the card runs.
      const unrunnable = {
        databaseId: "finance:transactions",
        title: "Weekly expenses (unrunnable)",
        blocks: [
          {
            id: "total",
            title: "Last 8 weeks",
            presentation: "metric",
            measure: "sum",
            measureColumnId: "amount",
            groupBy: null,
            timeWindow: { kind: "last-weeks", weeks: 8 },
          },
          weekly.blocks[1],
        ],
      };
      const viewsBeforeUnrunnable = await listViews(vaultRoot, "financial");
      const countBeforeUnrunnable = (viewsBeforeUnrunnable as { ok: true; value: unknown[] }).value.length;
      const refused = await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        spec: unrunnable,
      });
      checks.unrunnable = refused;
      const refusedError = (refused as { error?: { message?: string; fix?: unknown } }).error;
      assert.ok(refusedError, "a spec whose panels cannot run was accepted");
      assert.match(refusedError?.message ?? "", /timeColumnId/, "the refusal does not name the missing field");
      assert.ok(refusedError?.fix, "the refusal carried no `fix`");
      const viewsAfterUnrunnable = await listViews(vaultRoot, "financial");
      assert.equal(
        (viewsAfterUnrunnable as { ok: true; value: unknown[] }).value.length,
        countBeforeUnrunnable,
        "a card that cannot run was still written",
      );
      const boardAfterUnrunnable = await listPinBoard(vaultRoot, "financial");
      const unrunnablePin = (boardAfterUnrunnable as { ok: true; value: { pins: { kind: string; viewId?: string }[] } })
        .value.pins.find((p) => p.kind === "view" && p.viewId === (refused as { viewId?: string }).viewId);
      assert.equal(unrunnablePin, undefined, "a card that cannot run was still pinned");

      // ── 5c. a spec spread across the arguments is reassembled ────────────
      // The third shape a model reaches for: `databaseId`, `title` and `blocks`
      // as siblings of `domainSlug` instead of nested under `spec`. The tool's
      // own argument names are a closed set, so this costs no ambiguity and is
      // read as the spec it plainly is.
      const flattened = await callTool(auth, "preview_view", {
        domainSlug: "financial",
        databaseId: "finance:transactions",
        title: "Weekly expenses",
        presentation: "table",
        measure: "sum",
        measureColumnId: "amount",
        groupBy: "date",
        timeBucket: "week",
        timeColumnId: "date",
        timeWindow: { kind: "last-weeks", weeks: 5 },
      });
      checks.flattenedSpec = flattened;
      assert.equal(
        (flattened as { error?: unknown }).error,
        undefined,
        `a spec spread across the arguments must be read as the spec, got ${JSON.stringify(flattened).slice(0, 200)}`,
      );
      assert.equal(
        (flattened as { blocks: { rows: unknown[] }[] }).blocks[0]?.rows.length,
        5,
        "the reassembled spec did not run",
      );

      // ── 6. ONE call makes the card: save, pin, and the numbers ───────────
      // The reply carries the card's own rows, so the companion can report the
      // figures without a preview round trip. That is the whole speed argument.
      const saved = await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        span: 2,
        spec: weekly,
      });
      checks.saveView = saved;
      const savedResult = saved as {
        applied?: boolean;
        proposed?: unknown;
        viewId?: string;
        updated?: boolean;
        card?: { blocks?: { id: string }[] };
        error?: unknown;
      };
      assert.equal(savedResult.error, undefined, `save_view failed: ${JSON.stringify(saved).slice(0, 300)}`);
      assert.equal(savedResult.applied, true, "save_view did not apply on an unlocked board");
      assert.equal(savedResult.proposed, undefined, "save_view filed a Decision on an unlocked board");
      assert.equal(savedResult.updated, false, "a new card reported itself as an update");
      assert.ok(savedResult.viewId, "save_view returned no view id");
      assert.deepEqual(
        (savedResult.card?.blocks ?? []).map((b) => b.id),
        ["total", "weeks"],
        "save_view's reply must carry the card's rows, or the companion has to preview first",
      );

      const viewId = savedResult.viewId!;
      transcript.push({ step: "card saved", viewId, calls: 1 });

      // ── 7. it is on the board the call named, and it runs there ──────────
      const board = await listPinBoard(vaultRoot, "financial");
      assert.equal(board.ok, true);
      const pins = (board as { ok: true; value: { pins: { kind: string; viewId?: string; span?: number }[] } }).value.pins;
      const pinned = pins.find((p) => p.kind === "view" && p.viewId === viewId);
      checks.pinned = pinned;
      assert.ok(pinned, "the saved card is not on the financial board");
      assert.equal(pinned.span, 2, "the pinned card lost its span");

      const run = await runSavedView(vaultRoot, "financial", viewId, runAt);
      assert.equal(run.ok, true, `runSavedView failed: ${run.ok ? "" : run.error}`);
      const ran = (run as { ok: true; value: { blocks: { id: string; presentation: string; result: { rows: unknown[] } }[] } }).value;
      checks.savedRun = ran.blocks.map((b) => ({
        id: b.id,
        presentation: b.presentation,
        rows: b.result.rows.length,
      }));
      assert.deepEqual(
        ran.blocks.map((b) => [b.id, b.result.rows.length]),
        [["total", 1], ["weeks", 5]],
        "the saved card does not run as it was previewed",
      );

      // ── 8. the card can be READ and CHANGED in place ─────────────────────
      // "Modify a certain block on the dashboard — like editing how a certain
      // block is displayed." get_view is the read half; save_view with the same
      // viewId is the write half, and it must keep the card's identity and its
      // place on the board.
      const read = await callTool(auth, "get_view", { domainSlug: "financial", viewId });
      checks.getView = read;
      const readSpec = (read as { spec?: { blocks?: { id: string; presentation: string }[] } }).spec;
      assert.ok(readSpec, "get_view returned no spec");
      assert.deepEqual(
        (readSpec?.blocks ?? []).map((b) => [b.id, b.presentation]),
        [["total", "metric"], ["weeks", "table"]],
        "get_view does not report how each block is currently displayed",
      );

      const viewsBefore = await listViews(vaultRoot, "financial");
      const beforeCount = (viewsBefore as { ok: true; value: unknown[] }).value.length;
      const createdAtBefore = (
        (viewsBefore as { ok: true; value: { id: string; createdAt: string }[] }).value.find(
          (v) => v.id === viewId,
        )
      )!.createdAt;

      const editedSpec = {
        ...(readSpec as Record<string, unknown>),
        blocks: (readSpec!.blocks ?? []).map((b) =>
          b.id === "weeks" ? { ...b, presentation: "bar" } : b,
        ),
      };
      const edited = await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        span: 2,
        viewId,
        spec: editedSpec,
      });
      checks.saveViewEdit = edited;
      const editResult = edited as { applied?: boolean; updated?: boolean; viewId?: string; error?: unknown };
      assert.equal(editResult.error, undefined, `the edit failed: ${JSON.stringify(edited).slice(0, 300)}`);
      assert.equal(editResult.applied, true, "the edit did not apply");
      assert.equal(editResult.updated, true, "the edit did not report itself as an update");
      assert.equal(editResult.viewId, viewId, "the edit minted a new view id instead of changing the card");

      const viewsAfter = await listViews(vaultRoot, "financial");
      const afterList = (viewsAfter as { ok: true; value: { id: string; createdAt: string; blocks?: { id: string; presentation: string }[] }[] }).value;
      checks.viewCounts = { before: beforeCount, after: afterList.length };
      assert.equal(afterList.length, beforeCount, "the edit created a second card");
      const afterCard = afterList.find((v) => v.id === viewId)!;
      assert.equal(afterCard.createdAt, createdAtBefore, "the edit reset the card's createdAt");
      assert.deepEqual(
        (afterCard.blocks ?? []).map((b) => [b.id, b.presentation]),
        [["total", "metric"], ["weeks", "bar"]],
        "the block's presentation did not change on disk",
      );

      const afterBoard = await listPinBoard(vaultRoot, "financial");
      const afterPins = (afterBoard as { ok: true; value: { pins: { kind: string; viewId?: string }[] } }).value.pins;
      assert.equal(
        afterPins.filter((p) => p.kind === "view" && p.viewId === viewId).length,
        1,
        "the edit added a second pin for the same card",
      );

      // ── 9. an edit that names no card does not create one ────────────────
      const bogus = await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        viewId: "no-such-view",
        spec: weekly,
      });
      checks.bogusViewId = bogus;
      assert.ok(
        (bogus as { error?: unknown }).error,
        "an edit naming a card that does not exist was accepted",
      );
      const afterBogus = await listViews(vaultRoot, "financial");
      assert.equal(
        (afterBogus as { ok: true; value: unknown[] }).value.length,
        afterList.length,
        "a failed edit still created a card",
      );

      // ── 9b. a second card with the same name names the first ────────────
      // Two cards with one title on one board is what a companion makes when it
      // corrects a card it has just created. The write stands; the reply has to
      // name the other card, or the next correction lands beside it too.
      const twin = await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        spec: { ...weekly, title: "Weekly expenses" },
      });
      checks.twin = twin;
      assert.equal((twin as { applied?: boolean }).applied, true, "the second card was not written");
      assert.equal(
        (twin as { existingViewId?: string }).existingViewId,
        viewId,
        "the reply did not name the card that already carries this title",
      );
      assert.match(
        (twin as { note?: string }).note ?? "",
        new RegExp(viewId),
        "the note does not tell the caller which viewId to use next time",
      );

      // ── 10. a pin list echoed back as a string is accepted ──────────────
      const boardRead = await callTool(auth, "get_dashboard", { domainSlug: "financial" });
      const boardPins = (boardRead as { pins?: { id: string }[] }).pins ?? [];
      assert.ok(boardPins.length > 0, "get_dashboard returned no pins");
      const arranged = await callTool(auth, "arrange_dashboard", {
        domainSlug: "financial",
        pins: JSON.stringify(boardPins),
      });
      checks.arrangeAsString = arranged;
      assert.equal(
        (arranged as { applied?: boolean }).applied,
        true,
        `a pin list sent as a JSON string must be accepted, got ${JSON.stringify(arranged).slice(0, 200)}`,
      );

      // ── the artifact ─────────────────────────────────────────────────────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      const report = {
        pass: true,
        what: "the companion's dashboard-card path over the real MCP door: the advertised schemas, one save_view call, and an in-place block edit",
        command: "npm test  (this file: tests/dashboard-card-e2e.test.ts)",
        door: { local: doors.localPort, livePorts: [8643, 8646] },
        checks,
        transcript,
        generatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      await doors.close();
    }

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
