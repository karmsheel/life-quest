import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createVault,
  installFinanceKit,
  upsertRow,
  listRows,
  listDecisions,
  getRow,
  deleteRow,
  captureUtterance,
  undoCapture,
  correctCapture,
  setFinanceCaptureAccount,
  getFinanceKitSettings,
  USER_ACTOR,
} from "../src/index.ts";

const FINANCE = "financial";
const ACCOUNTS_DB = "finance:accounts";
const CATEGORIES_DB = "finance:categories";
const TRANSACTIONS_DB = "finance:transactions";

async function freshVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lq-capture-"));
  const res = await createVault(root, "Test");
  assert.ok(res.ok, `createVault ok: ${res.ok ? "" : res.error}`);
  return root;
}

async function installKit(root: string): Promise<void> {
  const res = await installFinanceKit(root, USER_ACTOR);
  assert.ok(res.ok, `install ok: ${JSON.stringify(res)}`);
}

async function createAccount(
  root: string,
  cells: { name: string; type: string; currency: string; rowId?: string },
): Promise<string> {
  const res = await upsertRow(root, FINANCE, ACCOUNTS_DB, {
    id: cells.rowId,
    cells: { name: cells.name, type: cells.type, currency: cells.currency, opening_balance: 0, opening_as_of: null, apr: null },
  });
  assert.ok(res.ok, `createAccount ok: ${JSON.stringify(res)}`);
  return res.value.id;
}

describe("conversational transaction capture (KAR-62)", () => {
  it("happy path: 'Bought food for R85 today' posts -85 ZAR Uncategorized", async () => {
  const root = await freshVault();
    await installKit(root);
    const cashId = await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR" });

    const beforeDecisions = await listDecisions(root);
    assert.ok(beforeDecisions.ok);

    const res = await captureUtterance(root, {
      text: "Bought food for R85 today",
      today: "2026-09-24",
      threadId: "t1",
      actor: USER_ACTOR,
    });
    assert.ok(res.ok, `capture ok: ${JSON.stringify(res)}`);
    assert.equal(res.value.posted, true);
    if (!res.value.posted) return;
    assert.equal(res.value.amount, -85);
    assert.equal(res.value.currency, "ZAR");
    assert.equal(res.value.date, "2026-09-24");
    assert.equal(res.value.accountName, "Cash");
    assert.equal(res.value.categoryName, "Uncategorized");
    assert.match(res.value.receipt, /85/);
    assert.match(res.value.receipt, /ZAR/);
    assert.match(res.value.receipt, /Cash/);
    assert.match(res.value.receipt, /Uncategorized/);
    assert.match(res.value.receipt, /2026-09-24/);

    // Row exists and account/category cells are row ids
    const txns = await listRows(root, FINANCE, TRANSACTIONS_DB);
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 1);
    assert.equal(txns.value[0].cells.account, cashId);

    // No new decision
    const afterDecisions = await listDecisions(root);
    assert.ok(afterDecisions.ok);
    assert.equal(afterDecisions.value.length, beforeDecisions.value.length);
  });

  it("ask when two transactional accounts, no default", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR", rowId: "acct-cash" });
    await createAccount(root, { name: "Bank", type: "checking", currency: "ZAR", rowId: "acct-bank" });

    const res = await captureUtterance(root, {
      text: "Bought food for R85",
      today: "2026-09-24",
      threadId: "t2",
      actor: USER_ACTOR,
    });
    assert.ok(res.ok);
    assert.equal(res.value.posted, false);
    if (res.value.posted) return;
    assert.match(res.value.ask, /Cash/);
    assert.match(res.value.ask, /Bank/);

    const txns = await listRows(root, FINANCE, TRANSACTIONS_DB);
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 0);
  });

  it("default account resolves ambiguity", async () => {
    const root = await freshVault();
    await installKit(root);
    const cashId = await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR", rowId: "acct-cash" });
    await createAccount(root, { name: "Bank", type: "checking", currency: "ZAR", rowId: "acct-bank" });

    const setRes = await setFinanceCaptureAccount(root, cashId);
    assert.ok(setRes.ok, `set default ok: ${JSON.stringify(setRes)}`);

    const res = await captureUtterance(root, {
      text: "Bought food for R85",
      today: "2026-09-24",
      threadId: "t3",
      actor: USER_ACTOR,
    });
    assert.ok(res.ok);
    assert.equal(res.value.posted, true);
    if (!res.value.posted) return;
    assert.equal(res.value.accountName, "Cash");
  });

  it("named account in text wins over default", async () => {
    const root = await freshVault();
    await installKit(root);
    const cashId = await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR", rowId: "acct-cash" });
    const bankId = await createAccount(root, { name: "Bank", type: "checking", currency: "ZAR", rowId: "acct-bank" });

    await setFinanceCaptureAccount(root, cashId);

    const res = await captureUtterance(root, {
      text: "Bought food for R85 from Bank",
      today: "2026-09-24",
      threadId: "t4",
      actor: USER_ACTOR,
    });
    assert.ok(res.ok);
    assert.equal(res.value.posted, true);
    if (!res.value.posted) return;
    assert.equal(res.value.accountName, "Bank");
  });

  it("missing amount does not post", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR" });

    const res = await captureUtterance(root, {
      text: "bought food",
      today: "2026-09-24",
      threadId: "t5",
      actor: USER_ACTOR,
    });
    assert.ok(res.ok);
    assert.equal(res.value.posted, false);

    const txns = await listRows(root, FINANCE, TRANSACTIONS_DB);
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 0);
  });

  it("USD: sole USD cash account and '$12 coffee' posts -12 USD", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Wallet", type: "cash", currency: "USD" });

    const res = await captureUtterance(root, {
      text: "$12 coffee",
      today: "2026-09-24",
      threadId: "t6",
      actor: USER_ACTOR,
    });
    assert.ok(res.ok);
    assert.equal(res.value.posted, true);
    if (!res.value.posted) return;
    assert.equal(res.value.amount, -12);
    assert.equal(res.value.currency, "USD");
  });

  it("brokerage is not transactional", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Stocks", type: "brokerage", currency: "ZAR" });

    const res = await captureUtterance(root, {
      text: "Bought food for R85",
      today: "2026-09-24",
      threadId: "t7",
      actor: USER_ACTOR,
    });
    assert.ok(res.ok);
    assert.equal(res.value.posted, false);

    const txns = await listRows(root, FINANCE, TRANSACTIONS_DB);
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 0);
  });

  it("kit missing: error mentions install, no row", async () => {
    const root = await freshVault();
    // Do NOT install kit
    const res = await captureUtterance(root, {
      text: "Bought food for R85",
      today: "2026-09-24",
      threadId: "t8",
      actor: USER_ACTOR,
    });
    assert.ok(!res.ok);
    assert.match(res.error, /install/i);
  });

  it("undo deletes the capture row; second undo errors", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR" });

    const post = await captureUtterance(root, {
      text: "Bought food for R85",
      today: "2026-09-24",
      threadId: "t9",
      actor: USER_ACTOR,
    });
    assert.ok(post.ok);
    assert.equal(post.value.posted, true);
    if (!post.value.posted) return;
    const rowId = post.value.rowId;

    // Insert a different row by hand
    const other = await upsertRow(root, FINANCE, TRANSACTIONS_DB, {
      id: "other-row",
      cells: { date: "2026-09-24", amount: 10, account: "x", category: "y", payee: null, notes: null, source_file: null, provenance: "manual", external_id: null },
    });
    assert.ok(other.ok);

    const undo1 = await undoCapture(root, { threadId: "t9", actor: USER_ACTOR });
    assert.ok(undo1.ok);
    assert.equal(undo1.value.posted, false);
    if (undo1.value.posted) return;

    // The capture row is gone
    const check = await getRow(root, FINANCE, TRANSACTIONS_DB, rowId);
    assert.ok(!check.ok, "capture row should be deleted");

    // Second undo errors
    const undo2 = await undoCapture(root, { threadId: "t9", actor: USER_ACTOR });
    assert.ok(!undo2.ok);
    assert.match(undo2.error, /nothing to undo/i);

    // The other row still exists
    const otherCheck = await getRow(root, FINANCE, TRANSACTIONS_DB, "other-row");
    assert.ok(otherCheck.ok, "other row must survive");
  });

  it("correct updates the same row id, keeps one row", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR" });

    const post = await captureUtterance(root, {
      text: "Bought food for R85",
      today: "2026-09-24",
      threadId: "t10",
      actor: USER_ACTOR,
    });
    assert.ok(post.ok);
    assert.equal(post.value.posted, true);
    if (!post.value.posted) return;
    const rowId = post.value.rowId;

    const correct = await correctCapture(root, {
      text: "Actually R90",
      today: "2026-09-24",
      threadId: "t10",
      actor: USER_ACTOR,
    });
    assert.ok(correct.ok);
    assert.equal(correct.value.posted, true);
    if (!correct.value.posted) return;
    assert.equal(correct.value.rowId, rowId);
    assert.equal(correct.value.amount, -90);

    const txns = await listRows(root, FINANCE, TRANSACTIONS_DB);
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 1);

    const decisions = await listDecisions(root);
    assert.ok(decisions.ok);
    assert.equal(decisions.value.length, 0);
  });

  it("agent actor still posts and creates no Decision", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR" });

    const AGENT = { type: "agent" as const, id: "companion", name: "Hermes" };
    const res = await captureUtterance(root, {
      text: "Bought food for R85",
      today: "2026-09-24",
      threadId: "t11",
      actor: AGENT,
    });
    assert.ok(res.ok);
    assert.equal(res.value.posted, true);

    const decisions = await listDecisions(root);
    assert.ok(decisions.ok);
    assert.equal(decisions.value.length, 0);
  });

  it("inflow: 'Received salary R1000' posts +1000", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR" });

    const res = await captureUtterance(root, {
      text: "Received salary R1000",
      today: "2026-09-24",
      threadId: "t12",
      actor: USER_ACTOR,
    });
    assert.ok(res.ok);
    assert.equal(res.value.posted, true);
    if (!res.value.posted) return;
    assert.equal(res.value.amount, 1000);
  });

  it("a second capture in the same thread posts another row", async () => {
    const root = await freshVault();
    await installKit(root);
    await createAccount(root, { name: "Cash", type: "checking", currency: "ZAR" });

    const first = await captureUtterance(root, {
      text: "Bought food for R85",
      today: "2026-09-24",
      threadId: "t13",
      actor: USER_ACTOR,
    });
    const second = await captureUtterance(root, {
      text: "Bought coffee for R20",
      today: "2026-09-24",
      threadId: "t13",
      actor: USER_ACTOR,
    });
    assert.ok(first.ok && first.value.posted);
    assert.ok(second.ok && second.value.posted);
    if (!first.ok || !first.value.posted || !second.ok || !second.value.posted) return;
    assert.notEqual(first.value.rowId, second.value.rowId);

    const txns = await listRows(root, FINANCE, TRANSACTIONS_DB);
    assert.ok(txns.ok);
    assert.equal(txns.value.length, 2);

    const undone = await undoCapture(root, { threadId: "t13", actor: USER_ACTOR });
    assert.ok(undone.ok);
    const left = await listRows(root, FINANCE, TRANSACTIONS_DB);
    assert.ok(left.ok);
    assert.equal(left.value.length, 1);
    assert.equal(left.value[0].id, first.value.rowId);
  });
});
