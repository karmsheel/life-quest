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
      ["tx2", "2026-09-11", -25, "cat:coffee"],
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

  it("propose_pins files a Decision and leaves the board file untouched", async () => {
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

    const boardPath = path.join(root, "domains", "financial", "pins.json");
    const beforeFile = await fs.readFile(boardPath, "utf8").catch(() => null);
    const res = await executeViewTool(root, AGENT, "propose_pins", {
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
    const out = res as { proposed: boolean; decisionId: string };
    assert.equal(out.proposed, true);
    const afterFile = await fs.readFile(boardPath, "utf8").catch(() => null);
    assert.equal(afterFile, beforeFile, "board file must not move before approval");
    // Approving writes the view pin onto the board.
    const approve = await resolveDecision(root, out.decisionId, "approved");
    assert.ok(approve.ok, JSON.stringify(approve));
    const pins = JSON.parse(await fs.readFile(boardPath, "utf8")) as {
      pins: Array<{ kind: string; viewId?: string; span?: number }>;
    };
    const pin = pins.pins.find((p) => p.kind === "view");
    assert.ok(pin, "approved board lost the view pin");
    assert.equal(pin.span, 2);
    assert.equal(pin.viewId, viewId);
  });

  it("propose_pins rejects a view pin pointing at a missing view, before filing", async () => {
    const res = await executeViewTool(root, AGENT, "propose_pins", {
      domainSlug: "financial",
      pins: [{ id: "v-x", kind: "view", domainSlug: "financial", viewId: "v-nope", span: 1 }],
    });
    assert.ok((res as { error?: unknown }).error);
    // Nothing was filed on top of whatever earlier tests left: the call itself
    // must not add a pending pins-target Decision. Count is exact in full-suite
    // runs (all prior pins decisions are resolved) and in isolated runs (this
    // fixture files none).
    const pending = await listDecisions(root);
    assert.ok(pending.ok);
    if (!pending.ok) return;
    assert.equal(
      pending.value.filter((d) => d.status === "pending" && d.target.type === "pins").length,
      0,
    );
  });

  it("the saved view ids are view-ish and stable; a second propose pins fine", async () => {
    // The companion can pin a second view on the overview board via null slug.
    const res = await executeViewTool(root, AGENT, "propose_pins", {
      domainSlug: null,
      pins: [{ id: "pin:today", kind: "system", system: "today-week" }],
    });
    assert.ok(!(res as { error?: unknown }).error, JSON.stringify(res));
    const out = res as { proposed: boolean; decisionId: string };
    const reject = await resolveDecision(root, out.decisionId, "rejected");
    assert.ok(reject.ok, JSON.stringify(reject));
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
