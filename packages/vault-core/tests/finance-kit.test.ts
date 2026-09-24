import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, before } from "node:test";
import {
  createVault,
  archiveDomain,
  createDatabase,
  listDatabases,
  listRows,
  installFinanceKit,
  listInstalledKits,
  getFinanceKitSettings,
  createPage,
  getPage,
  updatePage,
  listPages,
  listPins,
  createDecision,
  resolveDecision,
  readLog,
  USER_ACTOR,
} from "../src/index.ts";

async function freshVault() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lq-finance-kit-"));
  const res = await createVault(root, "Test");
  assert.ok(res.ok, `createVault ok: ${res.ok ? "" : res.error}`);
  return root;
}

describe("finance kit install", () => {
  it("refuses when financial is archived", async () => {
    const root = await freshVault();
    await archiveDomain(root, "financial");
    const res = await installFinanceKit(root, USER_ACTOR);
    assert.ok(!res.ok);
    assert.match(res.error, /financial/i);
  });

  it("refuses when financial is missing", async () => {
    const root = await freshVault();
    // Create a new vault without financial domain
    // archiveDomain is enough per the brief — createVault seeds financial, so we remove it
    const finJsonPath = path.join(root, "domains", "financial", "domain.json");
    await fs.rm(path.dirname(finJsonPath), { recursive: true, force: true });
    const res = await installFinanceKit(root, USER_ACTOR);
    assert.ok(!res.ok);
    assert.match(res.error, /financial/i);
  });

  it("installs: 7 kit DBs, settings, 6 pages, 2 assumption rows, pins, log", async () => {
    const root = await freshVault();
    const res = await installFinanceKit(root, USER_ACTOR);
    assert.ok(res.ok, `install ok: ${JSON.stringify(res)}`);
    assert.deepEqual(res.value, { applied: true, alreadyInstalled: false });

    // Seven kit db ids present
    const dbsRes = await listDatabases(root, "financial");
    assert.ok(dbsRes.ok);
    const dbIds = dbsRes.value.map((d) => d.database.id).sort();
    const expected = [
      "finance:accounts",
      "finance:categories",
      "finance:transactions",
      "finance:budgets",
      "finance:recurring",
      "finance:holdings",
      "finance:assumption-sets",
    ].sort();
    assert.deepEqual(dbIds, expected);

    // installedKits includes finance
    const kitsRes = await listInstalledKits(root, "financial");
    assert.ok(kitsRes.ok);
    assert.ok(kitsRes.value.includes("finance"));

    // Settings
    const settingsRes = await getFinanceKitSettings(root);
    assert.ok(settingsRes.ok);
    assert.deepEqual(settingsRes.value, { homeCurrency: "ZAR", usdZarRate: null, usdZarAsOf: null, defaultCaptureAccountId: null });

    // Six pages
    const pagesRes = await listPages(root, "financial");
    assert.ok(pagesRes.ok);
    const titles = pagesRes.value.map((e) => e.page.title).sort();
    assert.deepEqual(titles, ["Budget", "Ledger", "Net worth", "Scenario 1", "Scenario 2", "Spend"]);

    // Two assumption rows
    const assumeRows = await listRows(root, "financial", "finance:assumption-sets");
    assert.ok(assumeRows.ok);
    assert.equal(assumeRows.value.length, 2);
    const names = assumeRows.value.map((r) => r.cells.name).sort();
    assert.deepEqual(names, ["Scenario 1", "Scenario 2"]);

    // Financial pins start with goal-progress, deadline, then the six pages
    const finPinsRes = await listPins(root, "financial");
    assert.ok(finPinsRes.ok);
    const pinIds = finPinsRes.value.map((p) => p.id);
    assert.equal(pinIds[0], "sys:goal-progress");
    assert.equal(pinIds[1], "sys:deadline");

    // Overview pins include starter page pins and keep doctrine-progress
    const ovPinsRes = await listPins(root, null);
    assert.ok(ovPinsRes.ok);
    const ovPagePins = ovPinsRes.value.filter((p) => p.kind === "page");
    assert.ok(ovPagePins.length >= 6);
    assert.ok(ovPinsRes.value.some((p) => p.kind === "system" && p.system === "doctrine-progress"));

    // Log has kit.installed
    const logRes = await readLog(root);
    assert.ok(logRes.ok);
    const kitLog = logRes.value.find((e) => e.type === "kit.installed");
    assert.ok(kitLog, "log has kit.installed");
  });

  it("is idempotent: second install is no-op", async () => {
    const root = await freshVault();
    await installFinanceKit(root, USER_ACTOR);
    const res2 = await installFinanceKit(root, USER_ACTOR);
    assert.ok(res2.ok);
    assert.deepEqual(res2.value, { applied: true, alreadyInstalled: true });

    // Still 7 kit dbs (not 14)
    const dbsRes = await listDatabases(root, "financial");
    assert.equal(dbsRes.value.length, 7);

    // Still 6 pages
    const pagesRes = await listPages(root, "financial");
    assert.equal(pagesRes.value.length, 6);

    // Pin ids unique
    const finPinsRes = await listPins(root, "financial");
    const ids = finPinsRes.value.map((p) => p.id);
    assert.equal(ids.length, new Set(ids).size);

    // No second kit.installed log
    const logRes = await readLog(root);
    const kitLogs = logRes.value.filter((e) => e.type === "kit.installed");
    assert.equal(kitLogs.length, 1);
  });

  it("agent actor files a Decision, user install applies on approve", async () => {
    const root = await freshVault();
    const AGENT = { type: "agent" as const, id: "companion", name: "Hermes" };
    const res = await installFinanceKit(root, AGENT);
    assert.ok(res.ok);
    assert.deepEqual(res.value, { applied: false, decision: res.value.decision });
    assert.equal(res.value.decision.target.type, "kit-install");

    // Not yet installed
    const kitsRes = await listInstalledKits(root, "financial");
    assert.ok(!kitsRes.value.includes("finance"));

    // Approve
    const approveRes = await resolveDecision(root, res.value.decision.id, "approved");
    assert.ok(approveRes.ok);

    // Now installed
    const kitsRes2 = await listInstalledKits(root, "financial");
    assert.ok(kitsRes2.value.includes("finance"));
  });

  it("listInstalledKits with unknown slug returns empty; path escape fails closed", async () => {
    const root = await freshVault();
    const res = await listInstalledKits(root, "nonexistent");
    assert.ok(res.ok);
    assert.deepEqual(res.value, []);
    const evil = await listInstalledKits(root, "../evil");
    assert.equal(evil.ok && evil.value.length > 0, false);
    const parent = path.dirname(root);
    await assert.rejects(() => fs.access(path.join(parent, "evil")));
  });

  it("empty finance blocks round-trip via updatePage/getPage", async () => {
    const root = await freshVault();
    await installFinanceKit(root, USER_ACTOR);
    // Budget page has a budget-vs-actual block
    const budgetRes = await getPage(root, "financial", "finance-page-budget");
    assert.ok(budgetRes.ok);
    const budgetPage = budgetRes.value;
    assert.equal(budgetPage.blocks.length, 1);
    assert.equal(budgetPage.blocks[0].kind, "budget-vs-actual");

    // Net worth page has a net-worth block
    const nwRes = await getPage(root, "financial", "finance-page-net-worth");
    assert.ok(nwRes.ok);
    assert.equal(nwRes.value.blocks[0].kind, "net-worth");

    // Update and read back
    const updateRes = await updatePage(root, "financial", "finance-page-budget", {
      blocks: [{ id: "blk-1", kind: "budget-vs-actual" }],
    }, USER_ACTOR);
    assert.ok(updateRes.ok);
    const getRes = await getPage(root, "financial", "finance-page-budget");
    assert.equal(getRes.value.blocks.length, 1);
    assert.equal(getRes.value.blocks[0].kind, "budget-vs-actual");
  });

  it("generic Health db still works independently", async () => {
    const root = await freshVault();
    await installFinanceKit(root, USER_ACTOR);
    const dbRes = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(dbRes.ok);
  });
});
