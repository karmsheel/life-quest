/**
 * Drives the phone client's vault engine and turns its checks into
 * `e2e/artifacts/phone-engine.json`.
 *
 *   node_modules/.bin/electron e2e/phone-engine.electron.mjs
 *
 * Exit code 0 = every scenario held. The report is the repeatable artifact:
 * same command, same scenarios, no eyeballing a vault by hand.
 *
 * WHAT THIS COVERS
 *
 * The real `packages/vault-core` modules, bundled with the same esbuild call
 * `scripts/dev.mjs` uses for main, against a real vault on disk with the Finance
 * kit installed:
 *
 *   - the draft queue: one file per draft, idempotency by clientId, the caps,
 *     the capture-date clamp, corrupt-file recovery, withdrawal;
 *   - the device roster: the four-device cap, hashes only, removal;
 *   - the pinned metric: spend, income, transfers, both currencies, a missing
 *     FX rate, net worth, and a vault without the kit;
 *   - the vault-level settings the metric pin lives in.
 *
 * WHAT IT DOES NOT COVER
 *
 * The door, the HTTP surface, and the pairing cookie land in the next task; this
 * rig never binds a port. The chat strip and the phone app are the UI rig's
 * territory. It uses the queue's own functions rather than a page because the
 * engine is the thing under test.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, nativeTheme } from "electron";
import { build } from "esbuild";

// A rig runs hidden beside every other rig in the suite; a window that is
// occluded stops painting, so keep it painting even though this rig opens none.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const artifactsDir = path.join(here, "artifacts");
const userDataDir = path.join(artifactsDir, "userdata", "phone-engine");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const BUNDLE = path.join(artifactsDir, ".phone-engine.bundle.mjs");

/** A vault of this run's own; a fixed path would let one interrupted run poison
 *  every later one on Windows, where a closing handle refuses the next remove. */
const stamp = `${process.pid}-${Date.now().toString(36)}`;
const VAULT = path.join(userDataDir, `vault-${stamp}`);
const CAP_VAULT = path.join(userDataDir, `vault-cap-${stamp}`);
const CORRUPT_VAULT = path.join(userDataDir, `vault-corrupt-${stamp}`);
const NO_KIT_VAULT = path.join(userDataDir, `vault-nokit-${stamp}`);

function pruneOldVaults() {
  let entries = [];
  try {
    entries = fs.readdirSync(userDataDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith("vault-")) continue;
    const full = path.join(userDataDir, entry);
    if ([VAULT, CAP_VAULT, CORRUPT_VAULT, NO_KIT_VAULT].includes(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A leftover another process still holds is that process's problem.
    }
  }
}

async function loadModules() {
  await build({
    stdin: {
      contents: `export * from ${JSON.stringify(path.join(repoRoot, "packages/vault-core/src/index.ts"))};`,
      resolveDir: repoRoot,
      sourcefile: "phone-engine.entry.ts",
      loader: "ts",
    },
    outfile: BUNDLE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["electron"],
    logLevel: "silent",
  });
  return import(pathToFileURL(BUNDLE).href);
}

const failures = [];
const scenarios = [];
const check = (name, condition, detail) => {
  scenarios.push({ name, pass: Boolean(condition), detail: detail ?? null });
  if (!condition) failures.push(`${name}: ${detail}`);
  return Boolean(condition);
};

function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function daysAgoIso(days, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return todayIso(d);
}

function previousMonthIso(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  return todayIso(d);
}

async function must(label, promise) {
  const res = await promise;
  if (!res || res.ok !== true) {
    throw new Error(`${label}: ${res && res.error ? res.error : JSON.stringify(res)}`);
  }
  return res.value;
}

async function makeVault(mod, dir, { kit = true, name = "Phone rig" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  await must("createVault", mod.createVault(dir, name));
  if (kit) {
    const installed = await must("installFinanceKit", mod.installFinanceKit(dir, mod.USER_ACTOR));
    if (installed.applied !== true) throw new Error("installFinanceKit filed a Decision instead of applying");
  }
  return dir;
}

function registryPath(root) {
  return path.join(root, "domains", "financial", "data", "registry.json");
}

/** Set the USD→ZAR rate the metric and net worth convert with. */
function setFxRate(root, rate) {
  const p = registryPath(root);
  const registry = JSON.parse(fs.readFileSync(p, "utf8"));
  registry.finance = {
    homeCurrency: "ZAR",
    usdZarRate: rate,
    usdZarAsOf: rate === null ? null : todayIso(),
    defaultCaptureAccountId: registry.finance?.defaultCaptureAccountId ?? null,
  };
  fs.writeFileSync(p, `${JSON.stringify(registry, null, 2)}\n`);
}

/** Two accounts and five transactions: two ZAR, one USD, one transfer, one
 *  last month. That covers every rule the metric has to keep. */
async function seedFinance(mod, root) {
  const accounts = [
    {
      id: "rig-acct-zar",
      cells: {
        name: "Cheque",
        type: "checking",
        currency: "ZAR",
        opening_balance: 1000,
        opening_as_of: "2000-01-01",
      },
    },
    {
      id: "rig-acct-usd",
      cells: {
        name: "USD card",
        type: "credit",
        currency: "USD",
        opening_balance: 100,
        opening_as_of: "2000-01-01",
      },
    },
  ];
  for (const account of accounts) {
    await must(`account ${account.id}`, mod.upsertRow(root, mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.accounts, account));
  }

  const today = todayIso();
  const txns = [
    { id: "rig-tx-spend-zar", date: today, amount: -100, account: "rig-acct-zar", transfer_id: null },
    { id: "rig-tx-income-zar", date: today, amount: 500, account: "rig-acct-zar", transfer_id: null },
    { id: "rig-tx-spend-usd", date: today, amount: -20, account: "rig-acct-usd", transfer_id: null },
    { id: "rig-tx-transfer", date: today, amount: -50, account: "rig-acct-zar", transfer_id: "rig-transfer-1" },
    { id: "rig-tx-prior-month", date: previousMonthIso(), amount: -999, account: "rig-acct-zar", transfer_id: null },
  ];
  for (const txn of txns) {
    await must(`txn ${txn.id}`, mod.upsertRow(root, mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.transactions, {
      id: txn.id,
      cells: {
        date: txn.date,
        amount: txn.amount,
        account: txn.account,
        category: null,
        payee: "Rig",
        notes: null,
        source_file: null,
        provenance: "rig",
        external_id: null,
        transfer_id: txn.transfer_id,
      },
    }));
  }
}

function draftInput(overrides = {}) {
  return {
    clientId: randomUUID(),
    deviceId: "rig-device-1",
    deviceName: "iPhone",
    text: "R85 Pick n Pay food",
    captureDate: todayIso(),
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function queueLeg(mod) {
  const root = await makeVault(mod, VAULT);
  await seedFinance(mod, root);
  setFxRate(root, 18.5);

  // 1 — a queued draft is a file, not a transaction.
  const input = draftInput();
  const queued = await must("queuePhoneDraft", mod.queuePhoneDraft(root, input, new Date().toISOString()));
  const draftFile = mod.phonePaths(root).draftJson(input.clientId);
  const onDisk = JSON.parse(fs.readFileSync(draftFile, "utf8"));
  const txns = await must("listRows txns", mod.listRows(root, mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.transactions));
  check(
    "queue writes one pending file and no transaction",
    queued.created === true && onDisk.status === "pending" && queued.draft.text === input.text && txns.length === 5,
    `created ${queued.created} / status ${onDisk.status} / rows ${txns.length}`,
  );

  // 2 — the client's retry is the same draft.
  const retried = await must("queuePhoneDraft retry", mod.queuePhoneDraft(root, input, new Date().toISOString()));
  check(
    "queue is idempotent by clientId",
    retried.created === false && retried.draft.clientId === input.clientId,
    `created ${retried.created} / id ${retried.draft?.clientId}`,
  );

  // 3 — bad input writes nothing.
  const before = fs.readdirSync(mod.phonePaths(root).draftsDir).length;
  const empty = await mod.queuePhoneDraft(root, draftInput({ text: "   " }), new Date().toISOString());
  const long = await mod.queuePhoneDraft(root, draftInput({ text: "x".repeat(501) }), new Date().toISOString());
  const badId = await mod.queuePhoneDraft(root, draftInput({ clientId: "not-a-uuid" }), new Date().toISOString());
  const after = fs.readdirSync(mod.phonePaths(root).draftsDir).length;
  check(
    "queue refuses bad input",
    !empty.ok && !long.ok && !badId.ok && before === after,
    `empty ${empty.ok} / long ${long.ok} / badId ${badId.ok} / files ${before}→${after}`,
  );

  // 4 — the date is clamped to the week before today.
  const old = draftInput({ captureDate: daysAgoIso(30) });
  const clamped = await must("clamp", mod.queuePhoneDraft(root, old, new Date().toISOString()));
  check(
    "captureDate clamps to a week",
    clamped.draft.captureDate === todayIso() && clamped.draft.captureDateClamped === true,
    `date ${clamped.draft.captureDate} / clamped ${clamped.draft.captureDateClamped}`,
  );

  // 5 — withdrawal is a pending draft's move, once.
  const withdrawId = randomUUID();
  await must("queue for withdraw", mod.queuePhoneDraft(root, draftInput({ clientId: withdrawId }), new Date().toISOString()));
  const withdrawn = await must("withdraw", mod.withdrawPhoneDraft(root, withdrawId, "rig-device-1"));
  const again = await mod.withdrawPhoneDraft(root, withdrawId, "rig-device-1");
  const postedId = randomUUID();
  await must("queue for posted", mod.queuePhoneDraft(root, draftInput({ clientId: postedId }), new Date().toISOString()));
  await must("resolve posted", mod.resolvePhoneDraft(root, postedId, { status: "posted", rowId: "row-1", receipt: "receipt" }));
  const postedWithdraw = await mod.withdrawPhoneDraft(root, postedId, "rig-device-1");
  check(
    "withdraw is pending-only",
    withdrawn.draft.status === "dismissed" && again.ok === true && postedWithdraw.ok === false,
    `status ${withdrawn.draft.status} / again ${again.ok} / posted ${postedWithdraw.ok}`,
  );

  // 6 — the metric: spend and income, in the home currency, transfers and last
  // month excluded.
  const spend = await must("month_spend", mod.phoneMetric(root, "month_spend", new Date()));
  const income = await must("month_income", mod.phoneMetric(root, "month_income", new Date()));
  check(
    "metric month_spend and month_income",
    spend.value === 470 && spend.currency === "ZAR" && income.value === 500 && income.currency === "ZAR",
    `spend ${JSON.stringify(spend.value)} / income ${JSON.stringify(income.value)}`,
  );

  // 7 — net worth is netWorth's own answer, not a second calculation.
  const netWorth = await must("netWorth", mod.netWorth(root, { asOf: todayIso() }));
  const netWorthMetric = await must("net_worth metric", mod.phoneMetric(root, "net_worth", new Date()));
  check(
    "metric net_worth",
    netWorthMetric.value === netWorth.zar && netWorthMetric.secondary === null,
    `metric ${JSON.stringify(netWorthMetric.value)} / netWorth ${JSON.stringify(netWorth.zar)}`,
  );

  // 8 — mixed currencies with no rate is a warning, not a wrong number.
  setFxRate(root, null);
  const noRateSpend = await must("month_spend no rate", mod.phoneMetric(root, "month_spend", new Date()));
  const noRateNetWorth = await must("net_worth no rate", mod.phoneMetric(root, "net_worth", new Date()));
  const noRateReport = await must("netWorth no rate", mod.netWorth(root, { asOf: todayIso() }));
  check(
    "metric refuses a mixed total without a rate",
    noRateSpend.value === null &&
      noRateSpend.warnings.length > 0 &&
      noRateNetWorth.value === noRateReport.byCurrency.ZAR &&
      noRateNetWorth.secondary?.currency === "USD" &&
      noRateNetWorth.secondary?.value === noRateReport.byCurrency.USD,
    `spend ${JSON.stringify(noRateSpend.value)} / warnings ${noRateSpend.warnings.length} / net worth ${JSON.stringify(noRateNetWorth.value)} + ${JSON.stringify(noRateNetWorth.secondary)}`,
  );

  // 9 — the vault's settings carry the pin.
  const fresh = await must("settings", mod.readPhoneSettings(root));
  const wrote = await must("writePhoneMetric", mod.writePhoneMetric(root, "month_spend"));
  const reread = await must("reread settings", mod.readPhoneSettings(root));
  const unknown = await mod.writePhoneMetric(root, "not_a_metric");
  check(
    "settings default and write",
    fresh.metric === null && wrote.metric === "month_spend" && reread.metric === "month_spend" && unknown.ok === false,
    `fresh ${fresh.metric} / wrote ${wrote.metric} / reread ${reread.metric} / unknown ${unknown.ok}`,
  );

  // 10 — the devices: four, hashed, removable.
  const devicesPath = mod.phonePaths(root).devicesJson;
  const deviceIds = [];
  for (let i = 1; i <= 4; i += 1) {
    const device = await must(`device ${i}`, mod.addPhoneDevice(root, { name: `Phone ${i}`, tokenHash: `hash-${i}` }));
    deviceIds.push(device.id);
  }
  const fifth = await mod.addPhoneDevice(root, { name: "Phone 5", tokenHash: "hash-5" });
  const devicesFile = JSON.parse(fs.readFileSync(devicesPath, "utf8"));
  const hashesOnly = devicesFile.devices.every(
    (device) =>
      typeof device.tokenHash === "string" &&
      !("token" in device) &&
      !("secret" in device),
  );
  const removed = await must("remove device", mod.removePhoneDevice(root, deviceIds[0]));
  const devicesAfter = await must("read devices", mod.readPhoneDevices(root));
  check(
    "devices cap and hashes",
    fifth.ok === false &&
      hashesOnly &&
      devicesAfter.length === 3 &&
      removed.removed === true,
    `fifth ${fifth.ok} / hashes ${hashesOnly} / after ${devicesAfter.length} / removed ${removed.removed}`,
  );

  return { root };
}

async function capLeg(mod) {
  const root = await makeVault(mod, CAP_VAULT);
  for (let i = 0; i < 100; i += 1) {
    const queued = await mod.queuePhoneDraft(root, draftInput(), new Date().toISOString());
    if (!queued.ok) {
      check("queue cap is 100", false, `draft ${i + 1} failed early: ${queued.error}`);
      return;
    }
  }
  const over = await mod.queuePhoneDraft(root, draftInput(), new Date().toISOString());
  const files = fs.readdirSync(mod.phonePaths(root).draftsDir).length;
  check(
    "queue cap is 100",
    over.ok === false && /full/i.test(over.error) && files === 100,
    `over ${over.ok} / error ${over.error} / files ${files}`,
  );
}

async function corruptLeg(mod) {
  const root = await makeVault(mod, CORRUPT_VAULT);
  const paths = mod.phonePaths(root);
  fs.mkdirSync(paths.draftsDir, { recursive: true });
  const badFile = path.join(paths.draftsDir, "00000000-0000-4000-8000-000000000000.json");
  fs.writeFileSync(badFile, "{not json\n");
  const listed = await must("list corrupt", mod.listPhoneDrafts(root));
  check(
    "corrupt draft is skipped, not deleted",
    listed.drafts.length === 0 && listed.skipped === 1 && fs.existsSync(badFile),
    `drafts ${listed.drafts.length} / skipped ${listed.skipped} / exists ${fs.existsSync(badFile)}`,
  );
}

async function noKitLeg(mod) {
  const root = await makeVault(mod, NO_KIT_VAULT, { kit: false });
  const metric = await mod.phoneMetric(root, "month_spend", new Date());
  check(
    "metric with no kit",
    metric.ok === false && /Finance kit/.test(metric.error),
    `ok ${metric.ok} / error ${metric.error}`,
  );
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  pruneOldVaults();
  nativeTheme.themeSource = "dark";

  let report;
  const timeout = setTimeout(() => {
    console.error("phone-engine: timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    const mod = await loadModules();
    const queued = await queueLeg(mod);
    await capLeg(mod);
    await corruptLeg(mod);
    await noKitLeg(mod);

    report = {
      ranAt: new Date().toISOString(),
      vault: queued.root,
      scenarios,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      ranAt: new Date().toISOString(),
      scenarios,
      failures: [...failures, `threw: ${error instanceof Error ? error.message : String(error)}`],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "phone-engine.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = (report.scenarios ?? []).map((s) => [s.pass ? "PASS" : "FAIL", s.name, s.detail ?? ""]);
  const header = ["", "scenario", "detail"];
  const widths = header.map((_, i) => Math.max(header[i].length, ...rows.map((r) => String(r[i]).length)));
  const format = (row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(format(row));
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "phone engine: PASS" : "phone engine: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`phone-engine: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
