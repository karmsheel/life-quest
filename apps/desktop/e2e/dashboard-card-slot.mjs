/**
 * Launcher for the dashboard card-slot rig (`dashboard-card-slot.electron.mjs`).
 *
 * The rig has to watch a REAL card on a REAL dashboard change while staying in
 * the same place, which means it needs a world it is allowed to write to, a board
 * long enough to scroll, and an agent door it is allowed to talk to. This script
 * builds all three and then spawns Electron once:
 *
 *  - a throwaway VAULT (`createVault` + the finance kit), seeded with a handful of
 *    transactions so the cards have rows, and THREE saved cards: a listing, a
 *    composed card (metric + table) that is the one the companion edits, and a
 *    table. The composed card is the one that matters: "change the order of the
 *    items" is a change to its `blocks`, which is a change to the card's own box,
 *    which is what makes "did it stay in its place" a question with an answer.
 *  - an OVERVIEW BOARD of seven pins, with the composed card THIRD. Third of seven
 *    is the instrument: a card that leaves its slot and is appended lands LAST, and
 *    "third" and "last" are different places on a board this length — which they
 *    would not be on a board of two.
 *  - a throwaway `userData` (`LIFEQUEST_E2E`), so the operator's own profile,
 *    recent list, and pairing secrets are never read or written. No `recent.json`
 *    is seeded: the rig opens the vault through the app's own recent path, which
 *    is deterministic rather than dependent on the auto-open path.
 *  - a throwaway `HERMES_HOME` with a silent fake `hermes` CLI FIRST on PATH, so
 *    nothing this run does can restart the operator's own Hermes host. The rig
 *    never needs the companion: it speaks to the app's MCP door directly, which is
 *    the same door, the same tool name, and the same arguments the companion uses.
 *  - free MCP ports of this run's own, since the operator's running LifeQuest holds
 *    8643 and 8646.
 *
 * Usage, from `apps/desktop`, with the Vite dev server up:
 *
 *   node e2e/dashboard-card-slot.mjs
 *
 * Exit code 0 = the card kept its place; the artifact is
 * `e2e/artifacts/dashboard-card-slot.json`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  applyFinanceKitInstall,
  createVault,
  listPages,
  saveView,
  setPins,
  upsertRow,
  USER_ACTOR,
} from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const electron = createRequire(import.meta.url)("electron");
const RIG = path.join(here, "dashboard-card-slot.electron.mjs");
const REPORT = path.join(here, "artifacts", "dashboard-card-slot.json");
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

/** `YYYY-MM-DD` of a Date's LOCAL day — the same rule the app's windows use. */
function localIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A port nothing is listening on, asked by binding it rather than guessing. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * A silent `hermes` that is first on PATH.
 *
 * The app spawns this CLI on vault open (`companionEnsure`). Without a shim the
 * operator's real Hermes would be the thing the app talked to, and one of the
 * commands this app runs is `gateway restart` — a test that restarts the
 * operator's own assistant is not a test anybody can run twice. The shim exits 0
 * and says nothing.
 */
function writeHermesShim(cliDir) {
  fs.mkdirSync(cliDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(cliDir, "hermes.cmd"),
      ["@echo off", "rem A fake hermes, first on PATH: exit 0, say nothing.", "exit /b 0", ""].join("\r\n"),
      "ascii",
    );
  } else {
    const shim = path.join(cliDir, "hermes");
    fs.writeFileSync(shim, "#!/bin/sh\nexit 0\n", "utf8");
    fs.chmodSync(shim, 0o755);
  }
}

/** The registry the just-installed kit wrote: db ids and column ids by name. */
function readFinanceRegistry(vaultDir) {
  const registryPath = path.join(vaultDir, "domains", "financial", "data", "registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const dbNamed = (name) => {
    const db = registry.databases.find((d) => d.name === name);
    if (!db) throw new Error(`the finance kit has no ${name} database`);
    return db;
  };
  const txn = dbNamed("Transactions");
  const category = dbNamed("Categories");
  const account = dbNamed("Accounts");
  const columnId = (db, name) => {
    const column = db.columns.find((c) => c.name === name);
    if (!column) throw new Error(`${db.name} has no ${name} column`);
    return column.id;
  };
  return {
    transactions: txn.id,
    categories: category.id,
    accounts: account.id,
    txnDate: columnId(txn, "date"),
    txnAmount: columnId(txn, "amount"),
    txnAccount: columnId(txn, "account"),
    txnCategory: columnId(txn, "category"),
    txnPayee: columnId(txn, "payee"),
    categoryName: columnId(category, "name"),
  };
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-card-slot-"));
  const vaultDir = path.join(workDir, "vault");
  const profileDir = path.join(workDir, "profile");
  const hermesHome = path.join(workDir, "hermes");
  const cliDir = path.join(workDir, "bin");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesShim(cliDir);

  const created = await createVault(vaultDir, "Card slot");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const kit = await applyFinanceKitInstall(vaultDir);
  if (!kit.ok) throw new Error(`applyFinanceKitInstall failed: ${kit.error}`);

  const ids = readFinanceRegistry(vaultDir);

  const account = await upsertRow(vaultDir, "financial", ids.accounts, {
    cells: { name: "Capitec", type: "checking", currency: "ZAR" },
  });
  if (!account.ok) throw new Error(`account row failed: ${account.error}`);
  const accountId = account.value.id;

  const category = await upsertRow(vaultDir, "financial", ids.categories, {
    cells: { [ids.categoryName]: "Groceries" },
  });
  if (!category.ok) throw new Error(`category row failed: ${category.error}`);

  /**
   * Six months of small expenses, all dated the 10th.
   *
   * The dates are all in the past, and the cards the rig draws read `all` and a
   * trailing-weeks window, so the rows are stable across a month boundary and the
   * fixture's numbers are the fixture's own rather than the clock's.
   */
  const today = new Date();
  for (let monthsBack = 0; monthsBack < 6; monthsBack += 1) {
    const date = localIso(new Date(today.getFullYear(), today.getMonth() - monthsBack, 10));
    const row = await upsertRow(vaultDir, "financial", ids.transactions, {
      cells: {
        [ids.txnDate]: date,
        [ids.txnAmount]: -(100 + monthsBack * 10),
        [ids.txnAccount]: accountId,
        [ids.txnCategory]: category.value.id,
        [ids.txnPayee]: monthsBack === 0 ? "Coffee" : `${monthsBack} months back`,
      },
    });
    if (!row.ok) throw new Error(`seed row failed: ${row.error}`);
  }

  const sumAmount = { measure: "sum", measureColumnId: ids.txnAmount };

  // A. A listing: the card at the foot of the board, so "the bottom" is a place
  //    with something in it before the turn as well as after.
  const listView = await saveView(vaultDir, "financial", {
    databaseId: ids.transactions,
    title: "Recent transactions",
    presentation: "list",
    columns: [ids.txnDate, ids.txnPayee, ids.txnAmount],
    timeColumnId: ids.txnDate,
    timeWindow: "all",
    filters: [],
    limit: 12,
  });
  if (!listView.ok) throw new Error(`list view failed: ${listView.error}`);

  /**
   * B. THE CARD THE COMPANION EDITS: a composed card, two blocks, one of each
   * shape. "Change the order of the items" is a reorder of these two, so the
   * card's own box changes height when the turn lands — which is what makes the
   * claim "it did not leave its place" a claim about the board rather than about
   * the array on disk.
   */
  const editView = await saveView(vaultDir, "financial", {
    databaseId: ids.transactions,
    title: "Spending by month",
    presentation: "composed",
    blocks: [
      {
        id: "months",
        title: "Month by month",
        presentation: "table",
        groupBy: ids.txnDate,
        timeBucket: "month",
        timeColumnId: ids.txnDate,
        timeWindow: "all",
        filters: [],
        ...sumAmount,
      },
      {
        id: "total",
        title: "All time",
        presentation: "metric",
        groupBy: null,
        timeColumnId: ids.txnDate,
        timeWindow: "all",
        filters: [],
        ...sumAmount,
      },
    ],
    groupBy: null,
    timeBucket: "month",
    timeColumnId: ids.txnDate,
    timeWindow: "all",
    filters: [],
    limit: 12,
    ...sumAmount,
  });
  if (!editView.ok) throw new Error(`edit view failed: ${editView.error}`);

  // C. A table further down the board: something the operator scrolls past on
  //    their way to the bottom, so the bottom of the board is not the last thing
  //    they were looking at.
  const tableZView = await saveView(vaultDir, "financial", {
    databaseId: ids.transactions,
    title: "By payee",
    presentation: "table",
    groupBy: ids.txnPayee,
    timeBucket: null,
    timeColumnId: ids.txnDate,
    timeWindow: "all",
    filters: [],
    limit: 12,
    ...sumAmount,
  });
  if (!tableZView.ok) throw new Error(`payee view failed: ${tableZView.error}`);

  // D. The page pins. Real pages the kit wrote, used as board filler: they are
  //    short, static, and never re-run, so any movement on the board during the
  //    turn is attributable to the one card that changed.
  const pages = await listPages(vaultDir, "financial");
  if (!pages.ok) throw new Error(`listPages failed: ${pages.error}`);
  const pageId = (title) => {
    const entry = pages.value.find((p) => p.page.title === title);
    if (!entry) throw new Error(`the finance kit wrote no "${title}" page`);
    return entry.page.id;
  };

  const editPinId = `view:financial:${editView.value.id}`;
  const listPinId = `view:financial:${listView.value.id}`;
  const payeePinId = `view:financial:${tableZView.value.id}`;

  /**
   * The board, seven pins, the edited card THIRD.
   *
   * Third of seven rather than first or last, and the two are not the same claim:
   * a card that is appended lands at index 6, so "did it move" only has an answer
   * on a board where index 2 and index 6 are different places.
   */
  const board = [
    { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
    { id: "sys:today-week", kind: "system", system: "today-week" },
    { id: editPinId, kind: "view", domainSlug: "financial", viewId: editView.value.id, span: 2 },
    { id: `page:financial:${pageId("Ledger")}`, kind: "page", domainSlug: "financial", pageId: pageId("Ledger") },
    { id: listPinId, kind: "view", domainSlug: "financial", viewId: listView.value.id, span: 1 },
    { id: payeePinId, kind: "view", domainSlug: "financial", viewId: tableZView.value.id, span: 1 },
    { id: "sys:deadline", kind: "system", system: "deadline" },
  ];

  const plan = {
    vault: vaultDir,
    profile: profileDir,
    domainSlug: "financial",
    /** The dashboard the operator is looking at: the Overview board. */
    boardSlug: null,
    /**
     * The board FILE, straight from the vault's own layout.
     *
     * Passed rather than resolved by the rig: the rig runs inside Electron's main
     * process, and importing `@lifequest/vault-core` there would mean asking
     * Electron's bundled Node to strip TypeScript. It does — today — and a rig
     * that broke the day it stopped is a rig nobody can trust. The board is a JSON
     * file with a documented shape; reading it is the whole of what the rig needs.
     */
    pinsPath: path.join(vaultDir, ".lifequest", "overview-pins.json"),
    editPinId,
    editViewId: editView.value.id,
    editIndex: board.findIndex((pin) => pin.id === editPinId),
    board,
    /** The board's order, which the turn must not change. */
    expectedOrder: board.map((pin) => pin.id),
    seededRows: 6,
    /** What the control leg needs to create a card that is not on the board yet. */
    newCardDatabaseId: ids.transactions,
    newCardDateColumnId: ids.txnDate,
  };

  // The board goes on disk through the app's own write path, so the rig then
  // reads it back exactly as the page does. Written last, after the fixture is
  // complete, so nothing in the world can reorder it before the run starts.
  const pinned = await setPins(vaultDir, null, board, USER_ACTOR);
  if (!pinned.ok) throw new Error(`setPins failed: ${pinned.error}`);
  if (!pinned.value.applied) throw new Error("the Overview board refused the fixture's pins");

  const planPath = path.join(workDir, "plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const localPort = await freePort();
  const invitePort = await freePort();

  const env = { ...process.env };
  // Without this the spawned Electron runs as plain Node and no window opens.
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_HOME = hermesHome;
  env.PATH = `${cliDir}${path.delimiter}${env.PATH ?? ""}`;
  env.VITE_DEV_SERVER_URL = DEV_SERVER;
  env.LIFEQUEST_E2E_URL = `${DEV_SERVER}/e2e/dashboard-card-slot.html`;
  env.DASHBOARD_CARD_SLOT_PLAN = planPath;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: false,
    mcpPorts: { local: localPort, invite: invitePort },
  });

  fs.rmSync(REPORT, { force: true });
  console.log(`[card-slot] world built at ${workDir}`);
  console.log(`[card-slot] vault   ${vaultDir}`);
  console.log(`[card-slot] mcp     http://127.0.0.1:${localPort}/mcp`);

  const child = spawn(electron, [RIG], { cwd: desktopRoot, stdio: "inherit", env });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error("[card-slot] timed out");
    child.kill();
  }, 180_000);

  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    if (!process.env.LIFEQUEST_E2E_KEEP_PROFILE) {
      fs.rmSync(workDir, { recursive: true, force: true });
    } else {
      console.log(`[card-slot] world kept at ${workDir}`);
    }
    if (signal || timedOut) {
      console.error(`[card-slot] the rig did not finish (${signal ?? "timeout"})`);
      process.exit(1);
    }
    if (!fs.existsSync(REPORT)) {
      console.error(`[card-slot] the rig exited (${code}) without writing a report`);
      process.exit(1);
    }
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    console.log(`[card-slot] pass=${report.pass}`);
    if (!report.pass) console.error(`[card-slot] failures: ${report.failures.join("; ")}`);
    process.exit(report.pass ? 0 : 1);
  });
}

main().catch((error) => {
  console.error(`[card-slot] ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
