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
import http from "node:http";
import net from "node:net";
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
const DOOR_VAULT = path.join(userDataDir, `vault-door-${stamp}`);
const SERVICE_VAULT = path.join(userDataDir, `vault-service-${stamp}`);
const STATIC_DIR = path.join(artifactsDir, "phone-door-static");

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
    if ([VAULT, CAP_VAULT, CORRUPT_VAULT, NO_KIT_VAULT, DOOR_VAULT, SERVICE_VAULT].includes(full)) continue;
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
      contents: [
        `export * from ${JSON.stringify(path.join(repoRoot, "packages/vault-core/src/index.ts"))};`,
        `export * from ${JSON.stringify(path.join(repoRoot, "apps/desktop/electron/phone-door.ts"))};`,
        `export * from ${JSON.stringify(path.join(repoRoot, "apps/desktop/electron/phone-service.ts"))};`,
      ].join("\n"),
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
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
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

async function rowCount(mod, root) {
  const rows = await must(
    "listRows txns",
    mod.listRows(root, mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.transactions),
  );
  return rows.length;
}

async function toolsLeg(mod, root) {
  const agent = mod.COMPANION_ACTOR;
  const post = (args) => mod.executePhoneTool(root, agent, "post_phone_draft", args);
  const dismiss = (args) => mod.executePhoneTool(root, agent, "dismiss_phone_draft", args);

  // 1 — one confirmed draft, one row, one resolution, and a log that names it.
  const before = await rowCount(mod, root);
  const postedId = randomUUID();
  await must(
    "queue for post",
    mod.queuePhoneDraft(root, draftInput({ clientId: postedId, text: "R85 Pick n Pay food" }), new Date().toISOString()),
  );
  const posted = await post({ clientId: postedId });
  const after = await rowCount(mod, root);
  const postedDraft = await must("read posted draft", mod.readPhoneDraft(root, postedId));
  const postedRow = await must(
    "get posted row",
    mod.getRow(root, mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.transactions, posted.rowId),
  );
  const log = await must("read log", mod.readLog(root));
  const logged = [...log].reverse().find((event) => event.payload?.phoneDraftId === postedId);
  check(
    "post posts one row and resolves the draft",
    posted.posted === true &&
      posted.resolved === true &&
      after === before + 1 &&
      postedDraft.status === "posted" &&
      postedDraft.rowId === posted.rowId &&
      postedRow.cells.amount === -85 &&
      logged?.type === "capture.posted" &&
      logged?.actor?.name === "Hermes",
    `posted ${posted.posted} / rows ${before}→${after} / status ${postedDraft.status} / amount ${postedRow?.cells?.amount} / log ${logged?.type} by ${logged?.actor?.name}`,
  );

  // 2 — an ambiguous draft asks, stays pending, and posts once corrected.
  const ambiguousId = randomUUID();
  await must(
    "queue for ambiguous",
    mod.queuePhoneDraft(root, draftInput({ clientId: ambiguousId, text: "food" }), new Date().toISOString()),
  );
  const asked = await post({ clientId: ambiguousId });
  const askedDraft = await must("read asked draft", mod.readPhoneDraft(root, ambiguousId));
  const rowsAfterAsk = await rowCount(mod, root);
  check(
    "ambiguous draft stays pending",
    asked.posted === false &&
      asked.ask === "What amount?" &&
      asked.draftStillPending === true &&
      askedDraft.status === "pending" &&
      rowsAfterAsk === after,
    `posted ${asked.posted} / ask ${JSON.stringify(asked.ask)} / status ${askedDraft.status} / rows ${rowsAfterAsk}`,
  );
  const corrected = await post({ clientId: ambiguousId, text: "R85 Pick n Pay food" });
  const correctedDraft = await must("read corrected draft", mod.readPhoneDraft(root, ambiguousId));
  const rowsAfterCorrect = await rowCount(mod, root);
  check(
    "the correction posts once",
    corrected.posted === true &&
      correctedDraft.status === "posted" &&
      correctedDraft.text === "R85 Pick n Pay food" &&
      rowsAfterCorrect === rowsAfterAsk + 1,
    `posted ${corrected.posted} / status ${correctedDraft.status} / text ${correctedDraft.text} / rows ${rowsAfterCorrect}`,
  );

  // 3 — a handled draft is not posted twice.
  const rowsBeforeAgain = await rowCount(mod, root);
  const again = await post({ clientId: postedId });
  const rowsAfterAgain = await rowCount(mod, root);
  check(
    "posting a resolved draft posts nothing",
    again.alreadyResolved === "posted" && rowsAfterAgain === rowsBeforeAgain,
    `alreadyResolved ${again.alreadyResolved} / rows ${rowsBeforeAgain}→${rowsAfterAgain}`,
  );

  // 4 — dismissing is not posting.
  const dismissedId = randomUUID();
  await must(
    "queue for dismiss",
    mod.queuePhoneDraft(root, draftInput({ clientId: dismissedId, text: "coffee" }), new Date().toISOString()),
  );
  const rowsBeforeDismiss = await rowCount(mod, root);
  const dismissed = await dismiss({ clientId: dismissedId });
  const dismissedDraft = await must("read dismissed draft", mod.readPhoneDraft(root, dismissedId));
  const rowsAfterDismiss = await rowCount(mod, root);
  check(
    "dismiss writes no row",
    dismissed.status === "dismissed" &&
      dismissedDraft.status === "dismissed" &&
      rowsAfterDismiss === rowsBeforeDismiss,
    `status ${dismissed.status} / draft ${dismissedDraft.status} / rows ${rowsBeforeDismiss}→${rowsAfterDismiss}`,
  );

  // 5 — an id that is not a draft posts nothing.
  const unknown = await post({ clientId: randomUUID() });
  check(
    "unknown clientId is NOT_FOUND",
    unknown?.error?.code === "NOT_FOUND",
    `error ${JSON.stringify(unknown)}`,
  );

  // 6 — a connected agent never gets the phone's tools.
  const grant = {
    agentId: "rig-agent",
    name: "Rig agent",
    access: "write",
    domainSlugs: ["financial"],
    schedule: false,
  };
  const verdicts = ["list_phone_drafts", "post_phone_draft", "dismiss_phone_draft"].map(
    (name) => mod.toolAllowed(name, grant),
  );
  check(
    "connected agents are refused",
    verdicts.every((verdict) => verdict === "FORBIDDEN"),
    `verdicts ${verdicts.join(", ")}`,
  );

  // 7 — two confirmations in flight are one row.
  const doubleId = randomUUID();
  await must(
    "queue for double",
    mod.queuePhoneDraft(root, draftInput({ clientId: doubleId, text: "R12 bus" }), new Date().toISOString()),
  );
  const rowsBeforeDouble = await rowCount(mod, root);
  const [first, second] = await Promise.all([
    post({ clientId: doubleId }),
    post({ clientId: doubleId }),
  ]);
  const rowsAfterDouble = await rowCount(mod, root);
  const doubleDraft = await must("read double draft", mod.readPhoneDraft(root, doubleId));
  check(
    "double post is one row",
    rowsAfterDouble === rowsBeforeDouble + 1 &&
      doubleDraft.status === "posted" &&
      [first, second].filter((outcome) => outcome.posted === true || outcome.alreadyResolved).length === 2,
    `rows ${rowsBeforeDouble}→${rowsAfterDouble} / first ${JSON.stringify(first)} / second ${JSON.stringify(second)}`,
  );
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

function rawRequest({ port, method = "GET", path: requestPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: requestPath, headers },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function makeStaticDir() {
  fs.rmSync(STATIC_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(STATIC_DIR, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(STATIC_DIR, "index.html"),
    "<!doctype html><html><head><title>LifeQuest phone</title></head><body><div id=root></div></body></html>\n",
  );
  fs.writeFileSync(path.join(STATIC_DIR, "sw.js"), "self.addEventListener('fetch', () => {});\n");
  fs.writeFileSync(path.join(STATIC_DIR, "manifest.webmanifest"), "{}\n");
  fs.writeFileSync(path.join(STATIC_DIR, "assets", "app.js"), "console.log('phone');\n");
  return STATIC_DIR;
}

function api(door, origin, route, opts = {}) {
  const headers = { Origin: origin, ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers ?? {}) };
  return fetch(`${door.url}/api/phone${route}`, { ...opts, headers });
}

async function doorLeg(mod) {
  const root = await makeVault(mod, DOOR_VAULT, { kit: false, name: "Phone door" });
  const staticDir = makeStaticDir();
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const created = await mod.createPhoneDoor({
    root,
    vaultName: "Phone door",
    staticDir,
    port,
    publicOrigin: origin,
    pairingTtlMs: 60_000,
  });
  if (!created.ok) throw new Error(`createPhoneDoor: ${created.error}`);
  const door = created.value;

  try {
    // 1 — the shell is served, the root redirects, and a climb out of the
    // static directory finds nothing.
    const shell = await fetch(`${door.url}/phone/`);
    const shellBody = await shell.text();
    const rootRedirect = await fetch(`${door.url}/`, { redirect: "manual" });
    const traversal = await rawRequest({ port: door.port, path: "/phone/%2e%2e/secret" });
    check(
      "static shell is served",
      shell.status === 200 &&
        /text\/html/.test(shell.headers.get("content-type") ?? "") &&
        shellBody.includes("LifeQuest phone") &&
        (shell.headers.get("content-security-policy") ?? "").includes("default-src 'self'") &&
        shell.headers.get("cache-control") === "no-store" &&
        rootRedirect.status === 302 &&
        rootRedirect.headers.get("location") === "/phone/" &&
        traversal.status === 404,
      `shell ${shell.status} / csp ${shell.headers.get("content-security-policy")} / root ${rootRedirect.status} / traversal ${traversal.status}`,
    );

    // 2 — one code, one device, one cookie.
    const minted = door.mintPairingCode();
    if (!minted.ok) throw new Error(`mint: ${minted.error}`);
    const pair = await api(door, origin, "/pair", {
      method: "POST",
      body: JSON.stringify({ code: minted.value.code, deviceName: "iPhone" }),
    });
    const pairBody = await pair.json();
    const setCookie = pair.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0] ?? "";
    const secret = cookie.includes(".") ? cookie.slice(cookie.indexOf(".") + 1) : "";
    const devices = await must("read devices", mod.readPhoneDevices(root));
    const devicesRaw = fs.readFileSync(mod.phonePaths(root).devicesJson, "utf8");
    check(
      "pairing sets one device",
      pair.status === 200 &&
        pairBody.deviceId === devices[0]?.id &&
        /HttpOnly/.test(setCookie) &&
        /Secure/.test(setCookie) &&
        /SameSite=Strict/.test(setCookie) &&
        devices.length === 1 &&
        devices[0].tokenHash.length === 64 &&
        secret.length > 0 &&
        !devicesRaw.includes(secret),
      `status ${pair.status} / cookies ${setCookie} / devices ${devices.length} / hash ${devices[0]?.tokenHash?.length} / secretLeaked ${devicesRaw.includes(secret)}`,
    );

    // 3 — the code is single-use, and a wrong one is refused.
    const single = door.mintPairingCode();
    if (!single.ok) throw new Error(`mint: ${single.error}`);
    const wrong = await api(door, origin, "/pair", {
      method: "POST",
      body: JSON.stringify({ code: "AAAAAAAA", deviceName: "Wrong" }),
    });
    const used = await api(door, origin, "/pair", {
      method: "POST",
      body: JSON.stringify({ code: single.value.code, deviceName: "Second" }),
    });
    const reused = await api(door, origin, "/pair", {
      method: "POST",
      body: JSON.stringify({ code: single.value.code, deviceName: "Second" }),
    });

    // An expired code is refused too. A second door with a 10 ms window is the
    // only way to make a code old without waiting five minutes.
    const expiredPort = await freePort();
    const expiredOrigin = `http://127.0.0.1:${expiredPort}`;
    const expiredDoorRes = await mod.createPhoneDoor({
      root,
      vaultName: "Phone door",
      staticDir,
      port: expiredPort,
      publicOrigin: expiredOrigin,
      pairingTtlMs: 10,
    });
    if (!expiredDoorRes.ok) throw new Error(`expired door: ${expiredDoorRes.error}`);
    const expiredDoor = expiredDoorRes.value;
    const expiredCode = expiredDoor.mintPairingCode();
    if (!expiredCode.ok) throw new Error(`mint expired: ${expiredCode.error}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const expired = await api(expiredDoor, expiredOrigin, "/pair", {
      method: "POST",
      body: JSON.stringify({ code: expiredCode.value.code, deviceName: "Late" }),
    });
    await expiredDoor.close();
    check(
      "pairing rejects bad codes",
      wrong.status === 401 &&
        used.status === 200 &&
        reused.status === 401 &&
        expired.status === 401,
      `wrong ${wrong.status} / used ${used.status} / reused ${reused.status} / expired ${expired.status}`,
    );

    // 4 — the lock is ten failures, and the eleventh attempt is throttled.
    const locked = door.mintPairingCode();
    if (!locked.ok) throw new Error(`mint: ${locked.error}`);
    const attempts = [];
    for (let i = 0; i < 11; i += 1) {
      attempts.push(
        (
          await api(door, origin, "/pair", {
            method: "POST",
            body: JSON.stringify({ code: "AAAAAAAA", deviceName: "Guess" }),
          })
        ).status,
      );
    }
    check(
      "pairing is rate-limited",
      attempts.slice(0, 9).every((status) => status === 401) &&
        attempts[9] === 429 &&
        attempts[10] === 429,
      `attempts ${attempts.join(",")}`,
    );

    // 5 — every call after this needs the cookie.
    const stateHeaders = { Cookie: cookie };
    const noCookie = await fetch(`${door.url}/api/phone/state`);
    const badCookie = await fetch(`${door.url}/api/phone/state`, {
      headers: { Cookie: `${cookie.slice(0, -1)}${cookie.endsWith("A") ? "B" : "A"}` },
    });
    const stateRes = await fetch(`${door.url}/api/phone/state`, { headers: stateHeaders });
    check(
      "auth is required",
      noCookie.status === 401 && badCookie.status === 401 && stateRes.status === 200,
      `none ${noCookie.status} / tampered ${badCookie.status} / cookie ${stateRes.status}`,
    );

    // 6 — a draft arrives as a file, not a transaction; a retry is the same one.
    const today = todayIso();
    const draftBody = {
      clientId: randomUUID(),
      text: "R85 Pick n Pay food",
      captureDate: today,
      capturedAt: new Date().toISOString(),
    };
    const first = await api(door, origin, "/drafts", {
      method: "POST",
      headers: stateHeaders,
      body: JSON.stringify(draftBody),
    });
    const second = await api(door, origin, "/drafts", {
      method: "POST",
      headers: stateHeaders,
      body: JSON.stringify(draftBody),
    });
    const tooLong = await api(door, origin, "/drafts", {
      method: "POST",
      headers: stateHeaders,
      body: JSON.stringify({ ...draftBody, clientId: randomUUID(), text: "x".repeat(501) }),
    });
    const draftFile = await must("read door draft", mod.readPhoneDraft(root, draftBody.clientId));
    const resolvedBody = {
      clientId: randomUUID(),
      text: "coffee",
      captureDate: today,
      capturedAt: new Date().toISOString(),
    };
    await api(door, origin, "/drafts", {
      method: "POST",
      headers: stateHeaders,
      body: JSON.stringify(resolvedBody),
    });
    await must(
      "resolve door draft",
      mod.resolvePhoneDraft(root, resolvedBody.clientId, {
        status: "posted",
        rowId: "row-door",
        receipt: "receipt-door",
      }),
    );
    const reResolved = await api(door, origin, "/drafts", {
      method: "POST",
      headers: stateHeaders,
      body: JSON.stringify(resolvedBody),
    });
    const reResolvedBody = await reResolved.json();
    check(
      "drafts arrive without a transaction",
      first.status === 201 &&
        second.status === 200 &&
        draftFile.status === "pending" &&
        tooLong.status === 400 &&
        reResolved.status === 409 &&
        reResolvedBody.error === "already_resolved",
      `first ${first.status} / second ${second.status} / status ${draftFile.status} / long ${tooLong.status} / resolved ${reResolved.status}`,
    );

    // 7 — the state is the whole surface and nothing more. Read it after the
    // draft landed, so the pending list is this device's one draft.
    const freshState = await fetch(`${door.url}/api/phone/state`, { headers: stateHeaders });
    const stateBody = await freshState.json();
    const keys = Object.keys(stateBody).sort().join(",");
    const stateText = JSON.stringify(stateBody);
    check(
      "state carries only the surface",
      keys ===
        [
          "apiVersion",
          "device",
          "limits",
          "metric",
          "metricUnavailable",
          "pending",
          "resolved",
          "serverTime",
          "vaultName",
        ].join(",") &&
        !/"amount"|"payee"|"doctrine"|"documents"|"databases"|"rows"/.test(stateText) &&
        stateBody.pending.length === 1,
      `keys ${keys} / pending ${stateBody.pending?.length} / leaked ${/"amount"|"payee"|"doctrine"|"documents"|"databases"|"rows"/.test(stateText)}`,
    );

    // 8 — CSRF: a foreign origin, a missing origin, and a non-JSON body.
    const foreign = await api(door, "http://evil.example", "/drafts", {
      method: "POST",
      headers: stateHeaders,
      body: JSON.stringify(draftBody),
    });
    const missingOrigin = await rawRequest({
      port: door.port,
      method: "POST",
      path: "/api/phone/drafts",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(draftBody),
    });
    const options = await rawRequest({
      port: door.port,
      method: "OPTIONS",
      path: "/api/phone/drafts",
      headers: { Origin: origin },
    });
    const notJson = await rawRequest({
      port: door.port,
      method: "POST",
      path: "/api/phone/drafts",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "text/plain" },
      body: JSON.stringify(draftBody),
    });
    check(
      "csrf is refused",
      foreign.status === 403 &&
        missingOrigin.status === 403 &&
        options.status === 405 &&
        notJson.status === 415,
      `foreign ${foreign.status} / missing ${missingOrigin.status} / options ${options.status} / notJson ${notJson.status}`,
    );

    // 9 — the cap, then unpair.
    let queued = 1;
    while (queued < 100) {
      const res = await api(door, origin, "/drafts", {
        method: "POST",
        headers: stateHeaders,
        body: JSON.stringify({
          clientId: randomUUID(),
          text: "queue filler",
          captureDate: today,
          capturedAt: new Date().toISOString(),
        }),
      });
      if (res.status !== 201 && res.status !== 200) break;
      queued += 1;
    }
    const over = await api(door, origin, "/drafts", {
      method: "POST",
      headers: stateHeaders,
      body: JSON.stringify({
        clientId: randomUUID(),
        text: "one too many",
        captureDate: today,
        capturedAt: new Date().toISOString(),
      }),
    });
    check(
      "queue_full is a 409",
      over.status === 409 && (await over.json()).error === "queue_full",
      `over ${over.status}`,
    );

    const devicesBeforeUnpair = await must("read devices before unpair", mod.readPhoneDevices(root));
    const unpair = await api(door, origin, "/unpair", {
      method: "POST",
      headers: stateHeaders,
      body: "{}",
    });
    const revokedState = await fetch(`${door.url}/api/phone/state`, { headers: stateHeaders });
    const devicesAfter = await must("read devices after", mod.readPhoneDevices(root));
    const removed = !devicesAfter.some((device) => device.id === pairBody.deviceId);
    check(
      "unpair revokes",
      unpair.status === 200 &&
        /Max-Age=0/.test(unpair.headers.get("set-cookie") ?? "") &&
        revokedState.status === 401 &&
        removed &&
        devicesAfter.length === devicesBeforeUnpair.length - 1,
      `unpair ${unpair.status} / revoked ${revokedState.status} / devices ${devicesBeforeUnpair.length}→${devicesAfter.length} / removed ${removed}`,
    );

    return { door };
  } finally {
    await door.close();
  }
}

async function serviceLeg(mod) {
  const root = await makeVault(mod, SERVICE_VAULT, { kit: false, name: "Phone service" });
  const staticDir = makeStaticDir();
  const port = await freePort();

  mod.configurePhoneFromE2e({
    enabled: true,
    port,
    publicOrigin: `http://127.0.0.1:${port}`,
    staticDir,
  });
  await mod.startPhoneForVault(root);
  const up = await mod.getPhoneState();
  await mod.stopPhone();
  const down = await mod.getPhoneState();

  // The same port, already taken: the failure is recorded for Settings and the
  // rest of the app is untouched.
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(port, "127.0.0.1", resolve);
  });
  await mod.startPhoneForVault(root);
  const blocked = await mod.getPhoneState();
  await mod.stopPhone();
  await new Promise((resolve) => blocker.close(resolve));

  // Off means off: no listener at all, not a listener nobody paired with.
  mod.configurePhoneFromE2e({ enabled: false });
  await mod.startPhoneForVault(root);
  const off = await mod.getPhoneState();
  mod.configurePhoneFromE2e(null);
  await mod.stopPhone();

  check(
    "the door lives with the vault",
    up.doorUrl !== "" &&
      down.doorUrl === "" &&
      blocked.error !== null &&
      blocked.doorUrl === "" &&
      off.enabled === false &&
      off.doorUrl === "",
    `up ${up.doorUrl} / down ${down.doorUrl} / blocked ${blocked.error} / off ${off.enabled}:${off.doorUrl}`,
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
    await toolsLeg(mod, queued.root);
    await doorLeg(mod);
    await serviceLeg(mod);
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
