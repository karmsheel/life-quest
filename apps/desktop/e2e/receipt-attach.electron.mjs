/**
 * Drives the receipt-attach rig and turns its checks into
 * `e2e/artifacts/receipt-attach.json`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/receipt-attach.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same scenarios, no eyeballing the app required.
 *
 * The rig is a rig of the chat-panel harness page and is wrapped by that page's
 * one wrapper, `tests/chat-panel-e2e.test.ts`.
 *
 * What it covers today is the main leg: the real vault-core capture path
 * against a real temporary vault on disk, through the real tool executor.
 * `receipt:attach` and the composer leg land in later tasks.
 *
 * Why it bundles: Electron's main process cannot import the app's TypeScript,
 * so the modules under test are bundled with the same esbuild call `dev.mjs`
 * uses for main, then imported. `node:sqlite` is a builtin and stays external.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, nativeTheme, nativeImage } from "electron";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const artifactsDir = path.join(here, "artifacts");
const userDataDir = path.join(artifactsDir, "userdata", "receipt-attach");
// Each rig keeps its own Electron profile: the app stores window state in
// localStorage, and two rigs sharing one profile can read each other's writes.
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const BUNDLE = path.join(artifactsDir, ".receipt-attach.bundle.mjs");
/**
 * A vault of this run's own. Windows refuses to remove a directory while any
 * handle inside it is still closing, so a fixed path makes one interrupted run
 * poison every later one. Each run takes a fresh path and prunes its
 * predecessors best-effort, which keeps a locked leftover from failing a run
 * that has nothing to do with it.
 */
const VAULT = path.join(userDataDir, `vault-${process.pid}-${Date.now().toString(36)}`);

function pruneOldVaults() {
  let entries = [];
  try {
    entries = fs.readdirSync(userDataDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith("vault-") || path.join(userDataDir, entry) === VAULT) continue;
    try {
      fs.rmSync(path.join(userDataDir, entry), { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A leftover another process still holds is that process's problem, not
      // this run's: this run writes to its own path either way.
    }
  }
}

/** The real modules under test, bundled into one importable ESM file. */
const MODULES = ["packages/vault-core/src/index.ts"];

async function loadModules() {
  const contents = MODULES.map(
    (rel) => `export * from ${JSON.stringify(path.join(repoRoot, rel))};`,
  ).join("\n");
  await build({
    stdin: { contents, resolveDir: repoRoot, sourcefile: "receipt-attach.entry.ts", loader: "ts" },
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

/** A 1x1 PNG, re-encoded to JPEG so every fixture is a real image. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const failures = [];
const scenarios = [];
const check = (name, condition, detail) => {
  scenarios.push({ name, pass: Boolean(condition), detail: detail ?? null });
  if (!condition) failures.push(`${name}: ${detail}`);
  return Boolean(condition);
};

/** A vault with the Finance kit installed and one ZAR checking account. */
async function makeVault(mod, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const created = await mod.createVault(dir, "Receipt rig");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const kit = await mod.installFinanceKit(dir, mod.USER_ACTOR);
  if (!kit.ok) throw new Error(`installFinanceKit failed: ${kit.error}`);
  if (!kit.value.applied) throw new Error("installFinanceKit filed a Decision instead of applying");
  const account = await mod.upsertRow(dir, mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.accounts, {
    id: "acct-rig-cheque",
    cells: { name: "Cheque", type: "checking", currency: "ZAR" },
  });
  if (!account.ok) throw new Error(`account row failed: ${account.error}`);
  return dir;
}

const AGENT = { type: "agent", id: "rig-agent", name: "Receipt rig" };
const TX = (mod) => [mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.transactions];
const ABSENT = "domains/financial/data/files/00000000-0000-0000-0000-000000000000/gone.jpg";
const ESCAPE = "domains/financial/data/files/../../secrets.txt";
const OTHER_DOMAIN = "domains/health/data/files/x/y.jpg";
const BACKSLASH = "domains\\financial\\data\\files\\x\\y.jpg";

async function rowCount(mod, root) {
  const [slug, dbId] = TX(mod);
  const rows = await mod.listRows(root, slug, dbId);
  if (!rows.ok) throw new Error(`listRows failed: ${rows.error}`);
  return rows.value.length;
}

async function sourceFileOf(mod, root, rowId) {
  const [slug, dbId] = TX(mod);
  const row = await mod.getRow(root, slug, dbId, rowId);
  // A deleted row reads as "no linked file" rather than as a rig failure: undo
  // removing the row is one of the things this rig asserts.
  if (!row.ok) {
    if (String(row.error).includes("Row not found")) return null;
    throw new Error(`getRow failed: ${row.error}`);
  }
  return row.value ? (row.value.cells.source_file ?? null) : null;
}

const capture = (mod, root, args) =>
  mod.executeCaptureTool(root, AGENT, "capture_transaction", {
    text: "Coffee for R85 today",
    ...args,
  });

async function mainLeg(mod) {
  const root = await makeVault(mod, VAULT);

  // The original: written through the vault's own file writer, so the path the
  // tool must accept is the path the app really produces.
  const jpeg = new Uint8Array(nativeImage.createFromBuffer(Buffer.from(PNG_1PX, "base64")).toJPEG(95));
  const saved = await mod.saveDatabaseFile(root, mod.FINANCE_DOMAIN_SLUG, {
    bytes: jpeg,
    mime: "image/jpeg",
    name: "receipt.jpg",
  });
  if (!saved.ok) throw new Error(`saveDatabaseFile failed: ${saved.error}`);
  const storedPath = saved.value.relPath;
  const storedAbs = path.join(root, storedPath);

  // 1 — the path the app stored is the path the row cites.
  const posted = await capture(mod, root, { threadId: "t-receipt", source_file: storedPath });
  const postedCell = posted?.posted ? await sourceFileOf(mod, root, posted.rowId) : null;
  check(
    "posts a row citing the stored receipt",
    posted?.posted === true && postedCell === storedPath,
    `outcome ${JSON.stringify(posted)} / cell ${JSON.stringify(postedCell)}`,
  );

  // 2 — a path that climbs out of the store.
  const beforeEscape = await rowCount(mod, root);
  const escape = await capture(mod, root, { threadId: "t-escape", source_file: ESCAPE });
  const afterEscape = await rowCount(mod, root);
  check(
    "refuses a path escape",
    escape?.error?.code === "MALFORMED" && afterEscape === beforeEscape,
    `code ${escape?.error?.code} / rows ${beforeEscape}→${afterEscape}`,
  );

  // 3 — a well-formed path in another domain's store.
  const beforeOther = await rowCount(mod, root);
  const other = await capture(mod, root, { threadId: "t-other", source_file: OTHER_DOMAIN });
  const afterOther = await rowCount(mod, root);
  check(
    "refuses another domain's store",
    other?.error?.code === "MALFORMED" && afterOther === beforeOther,
    `code ${other?.error?.code} / rows ${beforeOther}→${afterOther}`,
  );

  // 4 — the right shape, no such file.
  const beforeAbsent = await rowCount(mod, root);
  const absent = await capture(mod, root, { threadId: "t-absent", source_file: ABSENT });
  const afterAbsent = await rowCount(mod, root);
  check(
    "refuses a path that is not on disk",
    absent?.error?.code === "MALFORMED" && afterAbsent === beforeAbsent,
    `code ${absent?.error?.code} / rows ${beforeAbsent}→${afterAbsent}`,
  );

  // 5 — a Windows separator smuggled into the path.
  const beforeBackslash = await rowCount(mod, root);
  const backslash = await capture(mod, root, { threadId: "t-backslash", source_file: BACKSLASH });
  const afterBackslash = await rowCount(mod, root);
  check(
    "refuses a backslash path",
    backslash?.error?.code === "MALFORMED" && afterBackslash === beforeBackslash,
    `code ${backslash?.error?.code} / rows ${beforeBackslash}→${afterBackslash}`,
  );

  // 6 — stated text with no original keeps working.
  const plain = await capture(mod, root, { threadId: "t-plain" });
  const plainCell = plain?.posted ? await sourceFileOf(mod, root, plain.rowId) : "unset";
  check(
    "posts without a receipt",
    plain?.posted === true && plainCell === null,
    `outcome ${JSON.stringify(plain)} / cell ${JSON.stringify(plainCell)}`,
  );

  // 7 — one photo can back several rows.
  const first = await capture(mod, root, { threadId: "t-two-a", source_file: storedPath });
  const second = await capture(mod, root, { threadId: "t-two-b", source_file: storedPath });
  const firstCell = first?.posted ? await sourceFileOf(mod, root, first.rowId) : null;
  const secondCell = second?.posted ? await sourceFileOf(mod, root, second.rowId) : null;
  const storeFiles = fs.existsSync(path.join(root, "domains/financial/data/files"))
    ? fs.readdirSync(path.join(root, "domains/financial/data/files")).length
    : 0;
  check(
    "one receipt backs two rows",
    firstCell === storedPath && secondCell === storedPath && storeFiles === 1,
    `cells ${JSON.stringify([firstCell, secondCell])} / stores ${storeFiles}`,
  );

  // 8 — correcting the text must not erase the file link.
  const toCorrect = await capture(mod, root, { threadId: "t-correct", source_file: storedPath });
  const corrected = toCorrect?.posted
    ? await mod.executeCaptureTool(root, AGENT, "correct_capture", {
        text: "Coffee for R95 today",
        threadId: "t-correct",
      })
    : null;
  const correctedCell = toCorrect?.posted ? await sourceFileOf(mod, root, toCorrect.rowId) : null;
  check(
    "correction keeps the receipt",
    corrected?.posted === true && correctedCell === storedPath,
    `outcome ${JSON.stringify(corrected)} / cell ${JSON.stringify(correctedCell)}`,
  );

  // 9 — undo takes the row and leaves the original.
  const toUndo = await capture(mod, root, { threadId: "t-undo", source_file: storedPath });
  const undone = toUndo?.posted
    ? await mod.executeCaptureTool(root, AGENT, "undo_capture", { threadId: "t-undo" })
    : null;
  const afterUndo = toUndo?.posted ? await sourceFileOf(mod, root, toUndo.rowId) : "unset";
  check(
    "undo leaves the file",
    undone !== null && afterUndo === null && fs.existsSync(storedAbs),
    `outcome ${JSON.stringify(undone)} / row ${JSON.stringify(afterUndo)} / file ${fs.existsSync(storedAbs)}`,
  );

  return { storedPath, bytes: jpeg.byteLength, scenarios: scenarios.length };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  pruneOldVaults();
  // A rig opens a real window; paint it in the app's own default theme so a run
  // is not a white sheet flashing across the operator's screen.
  nativeTheme.themeSource = "dark";

  let report;
  const timeout = setTimeout(() => {
    console.error("receipt-attach: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    const mod = await loadModules();
    const summary = await mainLeg(mod);

    report = {
      ranAt: new Date().toISOString(),
      vault: VAULT,
      fixture: { path: summary.storedPath, bytes: summary.bytes },
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

  const reportFile = path.join(artifactsDir, "receipt-attach.json");
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
  console.log(report.pass ? "receipt attach: PASS" : "receipt attach: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`receipt-attach: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
