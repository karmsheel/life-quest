/**
 * Launcher for the live-dashboard rig (`live-dashboard.electron.mjs`).
 *
 * The rig has to watch a card repaint itself inside the REAL app, which means it
 * needs a world it is allowed to write to and an agent door it is allowed to
 * talk to. This script builds that world and then spawns Electron once:
 *
 *  - a throwaway VAULT (`createVault` + the finance kit), seeded with two
 *    expenses dated yesterday and three saved cards: the operator's own
 *    "Recent transactions" listing, the repaired "Today's expenses" (a live
 *    `today` window), and a deliberately FROZEN card whose date is written into
 *    a filter — the shape the operator's stuck card had;
 *  - a throwaway `userData` (`LIFEQUEST_E2E`), so the operator's own profile,
 *    recent list, and pairing secrets are never read or written. No `recent.json`
 *    is seeded: the rig opens the vault explicitly, which is deterministic rather
 *    than dependent on the auto-open path;
 *  - a throwaway `HERMES_HOME` with a silent fake `hermes` CLI FIRST on PATH, so
 *    nothing this run does can restart the operator's own Hermes host. The rig
 *    never needs the companion: it speaks to the app's MCP door directly, which
 *    is the same door the companion uses;
 *  - free MCP ports of this run's own, since the operator's running LifeQuest
 *    holds 8643 and 8646.
 *
 * Usage, from `apps/desktop`, with the Vite dev server up:
 *
 *   node e2e/live-dashboard.mjs
 *
 * Exit code 0 = the pinned card moved on its own; the artifact is
 * `e2e/artifacts/live-dashboard-ui.json`.
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
  saveView,
  setFinanceCaptureAccount,
  upsertRow,
} from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const electron = createRequire(import.meta.url)("electron");
const RIG = path.join(here, "live-dashboard.electron.mjs");
const REPORT = path.join(here, "artifacts", "live-dashboard-ui.json");
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
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-live-dashboard-"));
  const vaultDir = path.join(workDir, "vault");
  const profileDir = path.join(workDir, "profile");
  const hermesHome = path.join(workDir, "hermes");
  const cliDir = path.join(workDir, "bin");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesShim(cliDir);

  const created = await createVault(vaultDir, "Live dashboard");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const kit = await applyFinanceKitInstall(vaultDir);
  if (!kit.ok) throw new Error(`applyFinanceKitInstall failed: ${kit.error}`);

  const ids = readFinanceRegistry(vaultDir);

  // One transactional ZAR account, and it is the default the capture path picks
  // when the operator's sentence names no account.
  const account = await upsertRow(vaultDir, "financial", ids.accounts, {
    cells: { name: "Capitec", type: "checking", currency: "ZAR" },
  });
  if (!account.ok) throw new Error(`account row failed: ${account.error}`);
  const accountId = account.value.id;
  const defaulted = await setFinanceCaptureAccount(vaultDir, accountId);
  if (!defaulted.ok) throw new Error(`setFinanceCaptureAccount failed: ${defaulted.error}`);

  const category = await upsertRow(vaultDir, "financial", ids.categories, {
    cells: { [ids.categoryName]: "Groceries" },
  });
  if (!category.ok) throw new Error(`category row failed: ${category.error}`);

  const today = localIso(new Date());
  const yesterday = localIso(new Date(Date.now() - 24 * 60 * 60 * 1000));

  // Two expenses dated YESTERDAY, so a card anchored on today starts empty and a
  // card frozen on yesterday has something to hold still. Distinct amounts keep
  // the two apart: 11 + 12 = 23, and the capture this run makes is 25.
  const seeded = [];
  for (const [amount, payee] of [
    [11, "Coffee"],
    [12, "Bus fare"],
  ]) {
    const row = await upsertRow(vaultDir, "financial", ids.transactions, {
      cells: {
        [ids.txnDate]: yesterday,
        [ids.txnAmount]: -amount,
        [ids.txnAccount]: accountId,
        [ids.txnCategory]: category.value.id,
        [ids.txnPayee]: payee,
      },
    });
    if (!row.ok) throw new Error(`seed row failed: ${row.error}`);
    seeded.push({ amount: -amount, payee, date: yesterday });
  }

  const sumAmount = { measure: "sum", measureColumnId: ids.txnAmount };

  // A. The operator's own card: the recent ROWS, newest first.
  const listView = await saveView(vaultDir, "financial", {
    databaseId: ids.transactions,
    title: "Recent transactions",
    presentation: "list",
    columns: [ids.txnDate, ids.txnPayee, ids.txnCategory, ids.txnAmount],
    timeColumnId: ids.txnDate,
    timeWindow: "all",
    filters: [],
    limit: 12,
  });
  if (!listView.ok) throw new Error(`list view failed: ${listView.error}`);

  // B. The reported card, repaired: a LIVE `today` window, so the number it
  //    shows is today's and tomorrow it is tomorrow's.
  const todayView = await saveView(vaultDir, "financial", {
    databaseId: ids.transactions,
    title: "Today's expenses",
    presentation: "table",
    groupBy: ids.txnDate,
    timeBucket: null,
    timeColumnId: ids.txnDate,
    timeWindow: "today",
    filters: [],
    limit: 12,
    ...sumAmount,
    blocks: [
      { id: "today", title: "Today", presentation: "metric", groupBy: null, ...sumAmount },
      {
        id: "by-category",
        title: "By category",
        presentation: "table",
        groupBy: ids.txnCategory,
        timeBucket: null,
        ...sumAmount,
      },
    ],
  });
  if (!todayView.ok) throw new Error(`today view failed: ${todayView.error}`);

  // C. The shape that was stuck: a literal date inside a filter. It recomputes
  //    perfectly and it can never move, which is the whole lesson of this rig.
  const frozenView = await saveView(vaultDir, "financial", {
    databaseId: ids.transactions,
    title: "Yesterday (frozen date)",
    presentation: "metric",
    groupBy: null,
    timeBucket: null,
    timeColumnId: ids.txnDate,
    timeWindow: "all",
    filters: [{ columnId: ids.txnDate, op: "eq", value: yesterday }],
    limit: 12,
    ...sumAmount,
  });
  if (!frozenView.ok) throw new Error(`frozen view failed: ${frozenView.error}`);

  const plan = {
    vault: vaultDir,
    profile: profileDir,
    domainSlug: "financial",
    today,
    yesterday,
    captureText: "Bought lunch for R25 today",
    /** What a second, renderer-side write needs: the ids the row is built from. */
    ids: {
      transactions: ids.transactions,
      txnDate: ids.txnDate,
      txnAmount: ids.txnAmount,
      txnAccount: ids.txnAccount,
      txnCategory: ids.txnCategory,
      txnPayee: ids.txnPayee,
      accountId,
      categoryId: category.value.id,
    },
    cards: [
      { key: "card-list", title: "Recent transactions", viewId: listView.value.id },
      { key: "card-today", title: "Today's expenses", viewId: todayView.value.id },
      { key: "card-frozen", title: "Yesterday (frozen date)", viewId: frozenView.value.id },
    ],
    expected: {
      listRowsBefore: 2,
      listRowsAfter: 3,
      todayBefore: 0,
      todayAfter: -25,
      frozenBefore: -23,
      frozenAfter: -23,
      /** The operator's own edit, written from the renderer over the IPC bridge. */
      editedAmount: -7,
      listRowsEdited: 4,
      todayEdited: -32,
      /** And the number the day itself moves the card to, with no write at all. */
      todayNextDay: 0,
    },
  };
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
  env.LIFEQUEST_E2E_URL = `${DEV_SERVER}/e2e/live-dashboard.html`;
  env.LIVE_DASHBOARD_PLAN = planPath;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: false,
    mcpPorts: { local: localPort, invite: invitePort },
  });

  fs.rmSync(REPORT, { force: true });
  console.log(`[live-dashboard] world built at ${workDir}`);
  console.log(`[live-dashboard] vault   ${vaultDir}`);
  console.log(`[live-dashboard] mcp     http://127.0.0.1:${localPort}/mcp`);

  const child = spawn(electron, [RIG], { cwd: desktopRoot, stdio: "inherit", env });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error("[live-dashboard] timed out");
    child.kill();
  }, 180_000);

  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    if (!process.env.LIFEQUEST_E2E_KEEP_PROFILE) {
      fs.rmSync(workDir, { recursive: true, force: true });
    } else {
      console.log(`[live-dashboard] world kept at ${workDir}`);
    }
    if (signal || timedOut) {
      console.error(`[live-dashboard] the rig did not finish (${signal ?? "timeout"})`);
      process.exit(1);
    }
    if (!fs.existsSync(REPORT)) {
      console.error(`[live-dashboard] the rig exited (${code}) without writing a report`);
      process.exit(1);
    }
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    console.log(`[live-dashboard] pass=${report.pass}`);
    if (!report.pass) console.error(`[live-dashboard] failures: ${report.failures.join("; ")}`);
    process.exit(report.pass ? 0 : 1);
  });
}

main().catch((error) => {
  console.error(`[live-dashboard] ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
