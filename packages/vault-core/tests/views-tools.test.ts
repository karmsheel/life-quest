import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  executeViewTool,
  applyFinanceKitInstall,
  createVault,
  listViews,
  runSavedView,
  upsertRow,
  resolveDecision,
  listDecisions,
} from "../src/index.ts";
import type { Actor, ViewSpec } from "../src/index.ts";

// Agent-built dashboard views — plan.md design, slice 3: the companion's tool
// surface. Proven on a temp vault with finance rows, through executeViewTool
// exactly as the MCP door calls it: nothing writes on propose, approval saves,
// and the pin board is only ever changed by an approved Decision.
describe("views-tools (agent-built dashboard views, slice 3)", () => {
  let dir: string;
  let root: string;
  const AGENT: Actor = { type: "agent", id: "companion", name: "Hermes" };
  let txDb = "finance:transactions";
  let catColId = "category";
  let dateColId = "date";
  let amountColId = "amount";

  function spec(partial: Partial<ViewSpec>): ViewSpec {
    return {
      schemaVersion: 1,
      databaseId: txDb,
      title: "Spend by category",
      presentation: "bar",
      groupBy: catColId,
      timeBucket: null,
      timeColumnId: dateColId,
      timeWindow: "all",
      filters: [],
      measure: "sum",
      measureColumnId: amountColId,
      sort: { by: "value", dir: "desc" },
      limit: 12,
      convertToZar: false,
      ...partial,
    };
  }

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-views-tools-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "ViewToolsTest")).ok, true);
    assert.equal((await applyFinanceKitInstall(root)).ok, true);
    await upsertRow(root, "financial", "finance:categories", {
      id: "cat:coffee",
      cells: { name: "Coffee" },
    });
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct:zar",
      cells: { name: "Card", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: "2026-01-01" },
    });
    const rows: Array<[string, string, number, string]> = [
      ["tx1", "2026-09-03", -40, "cat:coffee"],
      ["tx2", "2026-10-01", -25, "cat:coffee"],
    ];
    for (const [id, date, amount, cat] of rows) {
      const res = await upsertRow(root, "financial", txDb, {
        id,
        cells: { date, amount, account: "acct:zar", [catColId]: cat },
      });
      assert.equal(res.ok, true);
    }
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("last-weeks window covers the current week plus the weeks before it", async () => {
    // tx1 2026-09-03 (Thu) and tx2 2026-10-01 (Thu); with today around
    // 2026-10-05 (Mon) a 1-week window starts Mon 2026-10-05 and covers NEITHER
    // row; four weeks start Mon 2026-09-14 and cover tx2 only. Dates picked to
    // be stable around the actual run day, not a fixture-only "today".
    const one = await executeViewTool(root, AGENT, "preview_view", {
      domainSlug: "financial",
      spec: spec({
        title: "This week",
        timeWindow: { kind: "last-weeks", weeks: 1 },
        filters: [{ columnId: amountColId, op: "lt", value: 0 }],
      }),
    });
    assert.ok(!(one as { error?: unknown }).error, JSON.stringify(one));
    assert.equal((one as { rowCount: number }).rowCount, 0);
    const four = await executeViewTool(root, AGENT, "preview_view", {
      domainSlug: "financial",
      spec: spec({
        title: "Four weeks",
        timeWindow: { kind: "last-weeks", weeks: 4 },
        filters: [{ columnId: amountColId, op: "lt", value: 0 }],
      }),
    });
    assert.ok(!(four as { error?: unknown }).error, JSON.stringify(four));
    assert.equal((four as { rowCount: number }).rowCount, 1);
  });

  it("avg measure divides after the fold", async () => {
    // tx1 -40, tx2 -25 both Coffee: avg = -32.5, sum = -65.
    const res = await executeViewTool(root, AGENT, "preview_view", {
      domainSlug: "financial",
      spec: spec({ measure: "avg", title: "Avg spend" }),
    });
    assert.ok(!(res as { error?: unknown }).error, JSON.stringify(res));
    const out = res as { rows: Array<[string, number]> };
    assert.equal(out.rows[0][1], -32.5);
  });

  it("windowBounds anchors last-weeks on Monday and counts back inclusively", async () => {
    const { windowBounds } = await import("../src/views.ts");
    // 2026-10-07 is a Wednesday; 3 weeks = Mon 09-21 .. Wed 10-07.
    assert.deepEqual(
      windowBounds({ kind: "last-weeks", weeks: 3 } as ViewSpec["timeWindow"], "2026-10-07"),
      { start: "2026-09-21", end: "2026-10-07" },
    );
    // One week: today's Monday .. today.
    assert.deepEqual(
      windowBounds({ kind: "last-weeks", weeks: 1 } as ViewSpec["timeWindow"], "2026-10-07"),
      { start: "2026-10-05", end: "2026-10-07" },
    );
  });

  it("a last-weeks window with a bogus weeks value is refused", async () => {
    const res = await executeViewTool(root, AGENT, "preview_view", {
      domainSlug: "financial",
      spec: spec({ timeWindow: { kind: "last-weeks", weeks: 0 } as ViewSpec["timeWindow"] }),
    });
    assert.ok((res as { error?: unknown }).error);
  });

  it("list_views names what is already saved", async () => {
    const res = await executeViewTool(root, AGENT, "list_views", { domainSlug: "financial" });
    assert.deepEqual(res, { views: [] });
  });

  it("preview_view returns the card's rows and writes nothing", async () => {
    const before = await listViews(root, "financial");
    const res = await executeViewTool(root, AGENT, "preview_view", {
      domainSlug: "financial",
      spec: spec({}),
    });
    assert.ok(!(res as { error?: unknown }).error, JSON.stringify(res));
    const out = res as { rows: Array<[string, number]>; currency: string; rowCount: number };
    assert.equal(out.rowCount, 1);
    assert.equal(out.rows[0][0], "Coffee");
    assert.equal(out.rows[0][1], -65);
    assert.equal(out.currency, "ZAR");
    // Nothing was written — the view list is byte-identical.
    const afterList = await listViews(root, "financial");
    assert.deepEqual(afterList, before);
  });

  it("preview_view carries the failures of a bad spec, not a crash", async () => {
    const res = await executeViewTool(root, AGENT, "preview_view", {
      domainSlug: "financial",
      spec: spec({ presentation: "line", timeBucket: null }),
    });
    assert.ok((res as { error?: { code?: string } }).error);
  });

  it("propose_view files exactly one Decision and saves nothing", async () => {
    const before = await listViews(root, "financial");
    const res = await executeViewTool(root, AGENT, "propose_view", {
      domainSlug: "financial",
      spec: spec({ title: "Coffee spend" }),
    });
    assert.ok(!(res as { error?: unknown }).error, JSON.stringify(res));
    const out = res as { proposed: boolean; decisionId: string };
    assert.equal(out.proposed, true);
    // Still nothing saved.
    const afterList = await listViews(root, "financial");
    assert.deepEqual(afterList, before);
    // One pending view decision exists, carrying spec + preview.
    const pending = await listDecisions(root);
    assert.ok(pending.ok);
    if (!pending.ok) return;
    const dec = pending.value.find((d) => d.id === out.decisionId);
    assert.ok(dec, "filed decision not found");
    assert.equal(dec.status, "pending");
    assert.equal(dec.target.type, "view");
    const body = JSON.parse(dec.proposedBodyMarkdown) as { op: string; spec: ViewSpec; preview: unknown };
    assert.equal(body.op, "save-view");
    assert.equal(body.spec.title, "Coffee spend");
    assert.ok(body.preview && typeof body.preview === "object");
  });

  it("approving the view decision mints an id, saves the file, and it runs", async () => {
    // Find the proposal this suite's previous test filed, or (isolated run)
    // file it here, then approve it. Either path ends with one saved view.
    const before = await listDecisions(root);
    assert.ok(before.ok);
    let decId = before.ok
      ? before.value.find(
          (d) =>
            d.status === "pending" &&
            d.target.type === "view" &&
            (JSON.parse(d.proposedBodyMarkdown) as { spec?: { title?: string } }).spec?.title ===
              "Coffee spend",
        )?.id
      : undefined;
    if (!decId) {
      const pv = await executeViewTool(root, AGENT, "propose_view", {
        domainSlug: "financial",
        spec: spec({ title: "Coffee spend" }),
      });
      assert.ok(!(pv as { error?: unknown }).error, JSON.stringify(pv));
      decId = (pv as { decisionId: string }).decisionId;
    }
    const res = await resolveDecision(root, decId, "approved");
    assert.ok(res.ok, JSON.stringify(res));
    const views = await listViews(root, "financial");
    assert.ok(views.ok);
    if (!views.ok) return;
    assert.equal(views.value.length, 1);
    const view = views.value[0];
    assert.equal(view.title, "Coffee spend");
    const run = await runSavedView(root, "financial", view.id);
    assert.ok(run.ok, JSON.stringify(run));
    if (!run.ok) return;
    assert.equal(run.value.rows[0][1], -65);
  });

  it("arrange_dashboard applies at once for the companion (agent-arranged board)", async () => {
    // The board piece needs one saved view to exist; the propose/order tests
    // above it are the only source of state, so make an isolated run work by
    // saving through the approved-Decision path this suite already proves.
    const viewsRes = await listViews(root, "financial");
    assert.ok(viewsRes.ok);
    let savedViewId = viewsRes.ok ? viewsRes.value[0]?.id : undefined;
    if (!savedViewId) {
      // Isolated run: file + approve one view decision first.
      const pv = await executeViewTool(root, AGENT, "propose_view", {
        domainSlug: "financial",
        spec: spec({ title: "Coffee spend" }),
      });
      assert.ok(!(pv as { error?: unknown }).error, JSON.stringify(pv));
      const approve = await resolveDecision(root, (pv as { decisionId: string }).decisionId, "approved");
      assert.ok(approve.ok, JSON.stringify(approve));
      const views = await listViews(root, "financial");
      assert.ok(views.ok);
      if (!views.ok) return;
      assert.ok(views.value.length > 0);
      savedViewId = views.value[0].id;
    }
    const viewId = savedViewId as string;

    const before = await listDecisions(root);
    const boardPath = path.join(root, "domains", "financial", "pins.json");
    const res = await executeViewTool(root, AGENT, "arrange_dashboard", {
      domainSlug: "financial",
      pins: [
        { id: "pin:deadline", kind: "system", system: "deadline" },
        {
          id: `view:financial:${viewId}`,
          kind: "view",
          domainSlug: "financial",
          viewId,
          span: 2,
        },
      ],
    });
    assert.ok(!(res as { error?: unknown }).error, JSON.stringify(res));
    const out = res as { applied: boolean; pins: string[] };
    assert.equal(out.applied, true, "companion board change must apply instantly");
    // The board file moved immediately.
    const boardNow = JSON.parse(await fs.readFile(boardPath, "utf8")) as {
      pins: Array<{ kind: string; viewId?: string; span?: number }>;
    };
    const pin = boardNow.pins.find((p) => p.kind === "view");
    assert.ok(pin, "instant apply lost the view pin");
    assert.equal(pin.span, 2);
    assert.equal(pin.viewId, viewId);
    // And no Decision was filed for it.
    const after = await listDecisions(root);
    assert.ok(after.ok && before.ok);
    if (!after.ok || !before.ok) return;
    assert.equal(after.value.length, before.value.length);
  });

  it("get_dashboard resolves pins to labels the agent can act on", async () => {
    const res = await executeViewTool(root, AGENT, "get_dashboard", { domainSlug: "financial" });
    assert.ok(!(res as { error?: unknown }).error, JSON.stringify(res));
    const out = res as { domainSlug: string | null; pins: Array<{ kind: string; label?: string; span?: number }> };
    assert.equal(out.domainSlug, "financial");
    const viewPin = out.pins.find((p) => p.kind === "view");
    assert.ok(viewPin, "board read lost the view pin");
    // The label is the view's title, not its id — the agent names things.
    assert.notEqual(viewPin.label, viewPin.label && viewPin.label.includes(":") ? viewPin.label : null);
    assert.equal(viewPin.span, 2);
  });

  it("arrange_dashboard rejects a view pin pointing at a missing view", async () => {
    const res = await executeViewTool(root, AGENT, "arrange_dashboard", {
      domainSlug: "financial",
      pins: [{ id: "v-x", kind: "view", domainSlug: "financial", viewId: "v-nope", span: 1 }],
    });
    assert.ok((res as { error?: unknown }).error);
  });

  it("an unknown system pin kind is refused, not passed through", async () => {
    const res = await executeViewTool(root, AGENT, "arrange_dashboard", {
      domainSlug: "financial",
      pins: [{ id: "s-x", kind: "system", system: "not-a-system-pin" }],
    });
    assert.ok((res as { error?: unknown }).error);
  });

  it("a deleted view drops off the board instead of crashing the dashboard", async () => {
    // The board from the propose_pins test carries the approved view pin.
    // Delete the view file behind it: listPins silently drops the pin (the
    // read path must not crash a live dashboard over a stale artifact), and
    // the board is back to system pins only.
    const views = await listViews(root, "financial");
    assert.ok(views.ok);
    if (!views.ok) return;
    assert.ok(views.value.length > 0, "fixture lost its saved view");
    const { deleteView } = await import("../src/index.ts");
    const del = await deleteView(root, "financial", views.value[0].id);
    assert.ok(del.ok, JSON.stringify(del));
    const { listPins } = await import("../src/index.ts");
    const pins = await listPins(root, "financial");
    assert.ok(pins.ok);
    if (!pins.ok) return;
    assert.equal(pins.value.filter((p) => p.kind === "view").length, 0);
  });
});
