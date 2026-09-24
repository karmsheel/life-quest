import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createVault,
  installFinanceKit,
  listRows,
  resolveDecision,
  upsertRow,
  USER_ACTOR,
  type AssumptionDelta,
  type BudgetVsActualReport,
  type NetWorthReport,
  type ScenarioCompareReport,
} from "../src/index.ts";

async function freshVault() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lq-finance-plan-"));
  const res = await createVault(root, "Test");
  assert.ok(res.ok, `createVault ok: ${res.ok ? "" : res.error}`);
  return root;
}

async function install(root: string) {
  const res = await installFinanceKit(root, USER_ACTOR);
  assert.ok(res.ok, `install ok: ${JSON.stringify(res)}`);
}

describe("finance plan loop (KAR-57)", () => {
  it("1. Empty kit does not lie", async () => {
    const root = await freshVault();
    await install(root);
    const { budgetVsActual, netWorth, scenarioCompare } = await import("../src/index.ts");
    const budget = await budgetVsActual(root, { asOf: "2026-09-24" });
    assert.ok(budget.ok);
    assert.equal(budget.value.empty, true);
    assert.deepEqual(budget.value.lines, []);
    const nw = await netWorth(root, { asOf: "2026-09-24" });
    assert.ok(nw.ok);
    assert.equal(nw.value.empty, true);
    assert.deepEqual(nw.value.byCurrency, { ZAR: 0, USD: 0 });
    assert.equal(nw.value.zar, 0);
    const sc = await scenarioCompare(root, { asOf: "2026-09-24", assumptionSetId: "finance-assumption-scenario-1" });
    assert.ok(sc.ok);
    const report = sc.value as ScenarioCompareReport;
    assert.equal(report.live.months.length, 12);
    assert.ok(report.live.months.every((m) => m.byCurrency.ZAR === 0 && m.byCurrency.USD === 0 && m.zar === 0));
    assert.equal(report.primary.months.length, 12);
    // No transaction rows inserted
    const txns = await listRows(root, "financial", "finance:transactions");
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 0);
  });

  it("2. Budget vs actual", async () => {
    const root = await freshVault();
    await install(root);
    const { budgetVsActual, projectFinance } = await import("../src/index.ts");
    // Category: Food
    await upsertRow(root, "financial", "finance:categories", { id: "cat-food", cells: { name: "Food" } });
    // ZAR checking account
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-zar",
      cells: { name: "ZAR Checking", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: null },
    });
    // Budget: 2026-09, Food, 1000 ZAR
    await upsertRow(root, "financial", "finance:budgets", {
      id: "bud-1",
      cells: { period: "2026-09", category: "cat-food", amount: 1000, currency: "ZAR" },
    });
    // Posted txn: -800 in Food on ZAR acct, 2026-09-10
    await upsertRow(root, "financial", "finance:transactions", {
      id: "txn-1",
      cells: { date: "2026-09-10", amount: -800, account: "acct-zar", category: "cat-food" },
    });
    // Second budget 5000 to test it doesn't move projections
    await upsertRow(root, "financial", "finance:budgets", {
      id: "bud-2",
      cells: { period: "2026-09", category: "cat-food", amount: 5000, currency: "ZAR" },
    });
    const budget = await budgetVsActual(root, { asOf: "2026-09-24" });
    assert.ok(budget.ok);
    const lines = (budget.value as BudgetVsActualReport).lines;
    assert.equal(lines.length, 2);
    const line1 = lines.find((l) => l.budgetRowId === "bud-1")!;
    assert.equal(line1.planned, 1000);
    assert.equal(line1.spent, 800);
    assert.equal(line1.remaining, 200);
    assert.equal(line1.categoryName, "Food");
    // Projection: opening = -800 (posted txn), budget 5000 should NOT move cash
    const proj = await projectFinance(root, { asOf: "2026-09-24", horizonMonths: 12, deltas: [] });
    assert.ok(proj.ok);
    assert.ok(proj.value.months.every((m) => m.byCurrency.ZAR === -800));
  });

  it("3. Transfer excluded from spend, kept in books", async () => {
    const root = await freshVault();
    await install(root);
    const { budgetVsActual, netWorth } = await import("../src/index.ts");
    await upsertRow(root, "financial", "finance:categories", { id: "cat-food", cells: { name: "Food" } });
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-a",
      cells: { name: "A", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: null },
    });
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-b",
      cells: { name: "B", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: null },
    });
    await upsertRow(root, "financial", "finance:budgets", {
      id: "bud-1",
      cells: { period: "2026-09", category: "cat-food", amount: 1000, currency: "ZAR" },
    });
    // Two transfer rows sharing transfer_id t1
    await upsertRow(root, "financial", "finance:transactions", {
      id: "txn-t1-out",
      cells: { date: "2026-09-10", amount: -100, account: "acct-a", category: "cat-food", transfer_id: "t1" },
    });
    await upsertRow(root, "financial", "finance:transactions", {
      id: "txn-t1-in",
      cells: { date: "2026-09-10", amount: 100, account: "acct-b", category: "cat-food", transfer_id: "t1" },
    });
    const budget = await budgetVsActual(root, { asOf: "2026-09-24" });
    assert.ok(budget.ok);
    assert.equal((budget.value as BudgetVsActualReport).lines[0].spent, 0);
    const nw = await netWorth(root, { asOf: "2026-09-24" });
    assert.ok(nw.ok);
    assert.equal((nw.value as NetWorthReport).byCurrency.ZAR, 0);
    assert.equal((nw.value as NetWorthReport).zar, 0);
  });

  it("4. ZAR conversion", async () => {
    const root = await freshVault();
    await install(root);
    const { netWorth, vaultPaths } = await import("../src/index.ts");
    // USD checking opening 10
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-usd",
      cells: { name: "USD Checking", type: "checking", currency: "USD", opening_balance: 10, opening_as_of: null },
    });
    // Set FX rate 18 via registry
    const registryPath = vaultPaths(root).domainRegistry("financial");
    const raw = await fs.readFile(registryPath, "utf8");
    const registry = JSON.parse(raw);
    registry.finance.usdZarRate = 18;
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");

    const nw1 = await netWorth(root, { asOf: "2026-09-24" });
    assert.ok(nw1.ok);
    const r1 = nw1.value as NetWorthReport;
    assert.equal(r1.byCurrency.USD, 10);
    assert.equal(r1.zar, 180);
    assert.ok(!r1.warnings.includes("ZAR conversion requires an FX rate"));

    // Now null rate
    registry.finance.usdZarRate = null;
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
    const nw2 = await netWorth(root, { asOf: "2026-09-24" });
    assert.ok(nw2.ok);
    const r2 = nw2.value as NetWorthReport;
    assert.equal(r2.zar, null);
    assert.ok(r2.warnings.includes("ZAR conversion requires an FX rate"));
    assert.equal(r2.byCurrency.USD, 10);
  });

  it("4b. ZAR-only with null rate → zar = ZAR total, no FX warning", async () => {
    const root = await freshVault();
    await install(root);
    const { netWorth, vaultPaths } = await import("../src/index.ts");
    // Null rate by default after install
    const registryPath = vaultPaths(root).domainRegistry("financial");
    const raw = await fs.readFile(registryPath, "utf8");
    const registry = JSON.parse(raw);
    registry.finance.usdZarRate = null;
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
    // ZAR checking opening 50, no USD accounts
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-zar",
      cells: { name: "ZAR Checking", type: "checking", currency: "ZAR", opening_balance: 50, opening_as_of: null },
    });
    const nw = await netWorth(root, { asOf: "2026-09-24" });
    assert.ok(nw.ok);
    const r = nw.value as NetWorthReport;
    assert.equal(r.zar, 50);
    assert.ok(!r.warnings.includes("ZAR conversion requires an FX rate"));
  });

  it("5. APR honesty", async () => {
    const root = await freshVault();
    await install(root);
    const { netWorth, projectFinance } = await import("../src/index.ts");
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-zar",
      cells: { name: "ZAR Checking", type: "checking", currency: "ZAR", opening_balance: 100, opening_as_of: null },
    });
    // APR omitted
    const proj1 = await projectFinance(root, { asOf: "2026-09-24", horizonMonths: 1, deltas: [] });
    assert.ok(proj1.ok);
    assert.equal(proj1.value.months[0].byCurrency.ZAR, 100);
    assert.ok(proj1.value.warnings.some((w) => w.includes("APR not set:")));
    // Snapshot stays 100
    const nw1 = await netWorth(root, { asOf: "2026-09-24" });
    assert.equal((nw1.value as NetWorthReport).byCurrency.ZAR, 100);

    // APR 0.12
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-zar",
      cells: { name: "ZAR Checking", type: "checking", currency: "ZAR", opening_balance: 100, opening_as_of: null, apr: 0.12 },
    });
    const proj2 = await projectFinance(root, { asOf: "2026-09-24", horizonMonths: 1, deltas: [] });
    assert.ok(proj2.ok);
    assert.equal(proj2.value.months[0].byCurrency.ZAR, 101);
    const nw2 = await netWorth(root, { asOf: "2026-09-24" });
    assert.equal((nw2.value as NetWorthReport).byCurrency.ZAR, 100);
  });

  it("6. Expected return honesty", async () => {
    const root = await freshVault();
    await install(root);
    const { netWorth, projectFinance } = await import("../src/index.ts");
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-zar",
      cells: { name: "ZAR Checking", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: null },
    });
    // Holding no expected_return
    await upsertRow(root, "financial", "finance:holdings", {
      id: "h1",
      cells: { name: "Stock", account: "acct-zar", market_value: 100, price_currency: "ZAR" },
    });
    const proj1 = await projectFinance(root, { asOf: "2026-09-24", horizonMonths: 1, deltas: [] });
    assert.ok(proj1.ok);
    assert.equal(proj1.value.months[0].byCurrency.ZAR, 100);
    assert.ok(proj1.value.warnings.some((w) => w.includes("expected return not set:")));
    const nw1 = await netWorth(root, { asOf: "2026-09-24" });
    assert.equal((nw1.value as NetWorthReport).byCurrency.ZAR, 100);

    // expected_return 0.12
    await upsertRow(root, "financial", "finance:holdings", {
      id: "h1",
      cells: { name: "Stock", account: "acct-zar", market_value: 100, price_currency: "ZAR", expected_return: 0.12 },
    });
    const proj2 = await projectFinance(root, { asOf: "2026-09-24", horizonMonths: 1, deltas: [] });
    assert.ok(proj2.ok);
    assert.equal(proj2.value.months[0].byCurrency.ZAR, 101);
    const nw2 = await netWorth(root, { asOf: "2026-09-24" });
    assert.equal((nw2.value as NetWorthReport).byCurrency.ZAR, 100);
  });

  it("7. Recurring does not post", async () => {
    const root = await freshVault();
    await install(root);
    const { projectFinance } = await import("../src/index.ts");
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-zar",
      cells: { name: "ZAR Checking", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: null },
    });
    await upsertRow(root, "financial", "finance:recurring", {
      id: "rec-1",
      cells: { name: "Rent", amount: 100, currency: "ZAR", cadence: "monthly", next_date: "2026-09-01", kind: "outflow", account: "acct-zar" },
    });
    const proj = await projectFinance(root, { asOf: "2026-09-24", horizonMonths: 2, deltas: [] });
    assert.ok(proj.ok);
    // Month 0 = September, Month 1 = October
    const months = proj.value.months;
    assert.equal(months[0].month, "2026-09");
    assert.equal(months[0].byCurrency.ZAR, 0);
    assert.equal(months[1].month, "2026-10");
    assert.equal(months[1].byCurrency.ZAR, -100);
    // No transactions inserted
    const txns = await listRows(root, "financial", "finance:transactions");
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 0);
  });

  it("8. One-time delta", async () => {
    const root = await freshVault();
    await install(root);
    const { scenarioCompare, saveAssumptionSet } = await import("../src/index.ts");
    await upsertRow(root, "financial", "finance:accounts", {
      id: "acct-zar",
      cells: { name: "ZAR Checking", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: null },
    });
    const deltas: AssumptionDelta[] = [
      { kind: "one-time", amount: 40, currency: "ZAR", date: "2026-10-02" },
    ];
    const saveRes = await saveAssumptionSet(root, {
      rowId: "finance-assumption-scenario-1",
      name: "Test",
      horizonMonths: 2,
      deltas,
      actor: USER_ACTOR,
    });
    assert.ok(saveRes.ok);
    const sc = await scenarioCompare(root, { asOf: "2026-09-24", assumptionSetId: "finance-assumption-scenario-1" });
    assert.ok(sc.ok);
    const report = sc.value as ScenarioCompareReport;
    const liveOct = report.live.months[1];
    const primarySep = report.primary.months[0];
    const primaryOct = report.primary.months[1];
    assert.equal(liveOct.byCurrency.ZAR, 0);
    assert.equal(primarySep.byCurrency.ZAR, 0);
    assert.equal(primaryOct.byCurrency.ZAR, 40);
  });

  it("9. Agent save files a Decision", async () => {
    const root = await freshVault();
    await install(root);
    const { saveAssumptionSet } = await import("../src/index.ts");
    const deltas: AssumptionDelta[] = [
      { kind: "income", amount: 500, currency: "ZAR" },
    ];
    // Agent actor → Decision, no write
    const agentRes = await saveAssumptionSet(root, {
      rowId: "finance-assumption-scenario-1",
      name: "Agent plan",
      horizonMonths: 3,
      deltas,
      actor: { type: "agent", id: "companion", name: "Hermes" },
    });
    assert.ok(agentRes.ok, `agent save ok: ${JSON.stringify(agentRes)}`);
    assert.ok(agentRes.value.decision !== null);
    // Row should NOT have been written
    const rows = await listRows(root, "financial", "finance:assumption-sets");
    assert.ok(rows.ok);
    const row = rows.value.find((r) => r.id === "finance-assumption-scenario-1");
    assert.ok(row);
    assert.equal(row!.cells.deltas, ""); // not written

    // Approve → row written
    const resolveRes = await resolveDecision(root, agentRes.value.decision!.id, "approved");
    assert.ok(resolveRes.ok);
    const rows2 = await listRows(root, "financial", "finance:assumption-sets");
    assert.ok(rows2.ok);
    const row2 = rows2.value.find((r) => r.id === "finance-assumption-scenario-1");
    assert.ok(row2);
    const parsed = JSON.parse(row2!.cells.deltas as string);
    assert.deepEqual(parsed, deltas);

    // User actor writes immediately, no Decision
    const userRes = await saveAssumptionSet(root, {
      rowId: "finance-assumption-scenario-1",
      name: "User plan",
      horizonMonths: 5,
      deltas: [],
      actor: USER_ACTOR,
    });
    assert.ok(userRes.ok);
    assert.equal(userRes.value.decision, null);
  });

  it("10. Missing kit", async () => {
    const root = await freshVault();
    // Do NOT install
    const { netWorth } = await import("../src/index.ts");
    const nw = await netWorth(root, { asOf: "2026-09-24" });
    assert.ok(!nw.ok);
    assert.match(nw.error, /Install the Finance kit/i);
    // Should not create finance:transactions
    const txns = await listRows(root, "financial", "finance:transactions");
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 0);
  });
});
