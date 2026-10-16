/**
 * Launcher for the live-dashboard rig (`live-dashboard.electron.mjs`).
 *
 * The rig has to watch a card repaint itself inside the REAL app, which means it
 * needs a world it is allowed to write to and an agent door it is allowed to
 * talk to. This script builds that world and then spawns Electron once:
 *
 *  - a throwaway VAULT (`createVault` + the finance kit), seeded with two
 *    expenses dated yesterday, one expense in each of the four whole months
 *    before this one, and four saved cards: the operator's own "Recent
 *    transactions" listing, the repaired "Today's expenses" (a live `today`
 *    window), a deliberately FROZEN card whose date is written into a filter —
 *    the shape the operator's stuck card had — and "Average monthly spend", a
 *    period average over the previous four whole months;
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

/**
 * The whole calendar months BEFORE the month `fromIso` is in — the window
 * `{"kind":"previous-months","months":n}` names, computed here in plain month
 * arithmetic so the numbers this rig asserts are the fixture's own and not the
 * engine's answer read back to it.
 */
function previousMonthsWindow(months, fromIso) {
  const [y, m] = fromIso.split("-").map(Number);
  const first = new Date(y, m - 1 - months, 1);
  // Day 0 of this month is the last day of the month before it.
  const last = new Date(y, m - 1, 0);
  return { start: localIso(first), end: localIso(last) };
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
  // The first of NEXT month, as a local day: the instant the month turns, which
  // is the only moment a `previous-months` window changes. The rig moves the
  // clock here for its last leg, so "every month it gets recalculated" is a
  // claim about the calendar and not about a write.
  const [thisYear, thisMonth] = today.split("-").map(Number);
  const nextMonthStart = localIso(new Date(thisYear, thisMonth, 1));

  /**
   * Every row this run writes into the ledger, so the expected averages below
   * are computed from the fixture's own dates and amounts rather than from the
   * engine under test.
   */
  const ledger = [];

  // Two expenses dated YESTERDAY, so a card anchored on today starts empty and a
  // card frozen on yesterday has something to hold still. Both are -12 so that
  // they divide cleanly by four when they land inside a four-month window (a
  // month-boundary run puts yesterday in the month before today's, which is
  // inside the window the average card reads).
  const seeded = [];
  for (const [amount, payee] of [
    [12, "Coffee"],
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
    ledger.push({ date: yesterday, amount: -amount });
  }

  // And one expense in each of the four whole months before this one, dated the
  // 10th: the previous-months window is always June..September on a day in
  // October, so these four rows are always inside it and this month's rows are
  // always outside it.
  for (const [monthsBack, amount] of [
    [4, -400],
    [3, -300],
    [2, -200],
    [1, -100],
  ]) {
    const date = localIso(new Date(thisYear, thisMonth - 1 - monthsBack, 10));
    const row = await upsertRow(vaultDir, "financial", ids.transactions, {
      cells: {
        [ids.txnDate]: date,
        [ids.txnAmount]: amount,
        [ids.txnAccount]: accountId,
        [ids.txnCategory]: category.value.id,
        [ids.txnPayee]: `${monthsBack} months back`,
      },
    });
    if (!row.ok) throw new Error(`month seed row failed: ${row.error}`);
    ledger.push({ date, amount });
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

  // D. The average the operator asked for: "the average spend per month, based
  //    on the previous 4 months (not including current one)". One metric, one
  //    period, one live window — the whole spec is the query, and the card
  //    recalculates when the month turns with nothing written.
  const averageView = await saveView(vaultDir, "financial", {
    databaseId: ids.transactions,
    title: "Average monthly spend",
    presentation: "metric",
    measure: "avg-per",
    per: "month",
    measureColumnId: ids.txnAmount,
    groupBy: null,
    timeBucket: null,
    timeColumnId: ids.txnDate,
    timeWindow: { kind: "previous-months", months: 4 },
    filters: [],
    limit: 12,
  });
  if (!averageView.ok) throw new Error(`average view failed: ${averageView.error}`);

  /**
   * What the average card must read, from the fixture's own rows and month
   * boundaries. The divisor is the WINDOW's months — four, whether or not a
   * month holds rows — which is what makes a quiet month a month of R0.
   */
  const averageIn = (window, extra = []) => {
    const inside = [...ledger, ...extra].filter(
      (row) => row.date >= window.start && row.date <= window.end,
    );
    return inside.reduce((total, row) => total + row.amount, 0) / 4;
  };
  const beforeWindow = previousMonthsWindow(4, today);
  const afterWindow = previousMonthsWindow(4, nextMonthStart);
  // The two writes the rig itself makes, both dated today: the agent's captured
  // expense and the operator's typed one.
  const captured = { date: today, amount: -25 };
  const typed = { date: today, amount: -7 };
  const averages = {
    before: averageIn(beforeWindow),
    afterCapture: averageIn(beforeWindow, [captured]),
    afterEdit: averageIn(beforeWindow, [captured, typed]),
    afterMonthTurn: averageIn(afterWindow, [captured, typed]),
  };
  for (const [name, value] of Object.entries(averages)) {
    if (!Number.isInteger(value)) {
      throw new Error(`the fixture's ${name} average is ${value}, not a whole number to assert`);
    }
  }
  // The whole claim of the window is that this month's spending is not in it, so
  // a fixture where the month turn changed nothing would prove nothing.
  if (averages.afterEdit === averages.afterMonthTurn) {
    throw new Error("the fixture cannot tell the previous-months window from the next one");
  }

  const plan = {
    vault: vaultDir,
    profile: profileDir,
    domainSlug: "financial",
    today,
    yesterday,
    captureText: "Bought lunch for R25 today",
    /**
     * The instant the month turns, in the local day the app's windows use. The
     * rig's last leg moves both clocks here: the renderer's day check and the
     * engine's window, so the average card recalculates with no write at all.
     */
    nextMonthStart,
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
      { key: "card-average", title: "Average monthly spend", viewId: averageView.value.id },
    ],
    expected: {
      /**
       * The listing draws every row of the ledger, and the fixture now holds six
       * before the run writes anything: two dated yesterday and one in each of
       * the four whole months before this one.
       */
      listRowsBefore: 6,
      listRowsAfter: 7,
      todayBefore: 0,
      todayAfter: -25,
      frozenBefore: -24,
      frozenAfter: -24,
      /** The operator's own edit, written from the renderer over the IPC bridge. */
      editedAmount: -7,
      listRowsEdited: 8,
      todayEdited: -32,
      /**
       * And the number the day itself moves the card to, with no write at all.
       * The month turn is a day turn too, so a `today` window falls to 0 on the
       * first of next month exactly as it would tomorrow morning.
       */
      todayNextDay: 0,
      /** The period average, and the one thing a write inside this month cannot move. */
      averageBefore: averages.before,
      averageAfter: averages.afterCapture,
      averageAfterEdit: averages.afterEdit,
      averageAfterMonthTurn: averages.afterMonthTurn,
      averageWindows: { before: beforeWindow, afterMonthTurn: afterWindow },
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
