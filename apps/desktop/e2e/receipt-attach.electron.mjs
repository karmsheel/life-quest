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
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, nativeTheme, nativeImage, BrowserWindow } from "electron";
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
const MODULES = [
  "packages/vault-core/src/index.ts",
  "apps/desktop/electron/receipt-image.ts",
  "apps/desktop/electron/pending-receipt.ts",
  "apps/desktop/electron/vault-service.ts",
  "apps/desktop/electron/companion.ts",
];

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

/**
 * A small real image, built rather than embedded. Hand-written base64 is a
 * fixture that can be silently undecodable, and then the rig proves that the
 * *fixture* is broken rather than that the code refuses a bad image.
 */
function fixtureImage() {
  const width = 8;
  const height = 8;
  const bgra = Buffer.allocUnsafe(width * height * 4);
  for (let i = 0; i < bgra.length; i += 4) {
    bgra[i] = 40;
    bgra[i + 1] = 90;
    bgra[i + 2] = 200;
    bgra[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(bgra, { width, height });
}

const jpegFixture = () => new Uint8Array(fixtureImage().toJPEG(95));
const pngFixture = () => new Uint8Array(fixtureImage().toPNG());

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
  const jpeg = jpegFixture();
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

  return { vault: root, storedPath, bytes: jpeg.byteLength, scenarios: scenarios.length };
}

const sha256 = (bytes) => createHash("sha256").update(Buffer.from(bytes)).digest("hex");

/**
 * A JPEG with far more entropy than a 1x1 has. A flat fixture compresses to a
 * few kilobytes, so the copy ladder would pass its first rung and prove nothing
 * about stepping down; random pixels make rung one overshoot the ceiling.
 *
 * Built once and kept: filling a multi-megabyte pixel buffer and encoding it at
 * quality 100 is the most expensive thing this rig does, and the suite runs the
 * page's rigs side by side, so a second copy of that work is stolen from a
 * neighbour's timing budget.
 */
let largeJpegCache = null;
function makeLargeJpeg(minBytes) {
  if (largeJpegCache) return largeJpegCache;
  let largest = null;
  for (const width of [1600, 2000, 2400]) {
    const height = Math.round(width * 0.66);
    const noise = Buffer.allocUnsafe(width * height * 4);
    for (let i = 0; i < noise.length; i += 4) {
      noise[i] = (Math.random() * 256) | 0;
      noise[i + 1] = (Math.random() * 256) | 0;
      noise[i + 2] = (Math.random() * 256) | 0;
      noise[i + 3] = 255;
    }
    const jpeg = nativeImage.createFromBitmap(noise, { width, height }).toJPEG(100);
    const bytes = new Uint8Array(jpeg);
    if (!largest || bytes.byteLength > largest.bytes.byteLength) {
      largest = { bytes, width, height };
    }
    if (bytes.byteLength >= minBytes) break;
  }
  largeJpegCache = largest;
  return largest;
}

const COPY_CEILING = 2 * 1024 * 1024;
const ORIGINAL_CEILING = 25 * 1024 * 1024;

/** The real preparation path, called the way the attach channel calls it. */
async function prepareLeg(mod, vaultRoot) {
  const jpegBytes = jpegFixture();
  const pngBytes = pngFixture();

  // 1 — the original lands in the domain's own file store, byte for byte.
  const stored = await mod.prepareReceipt(vaultRoot, {
    bytes: jpegBytes,
    mime: "image/jpeg",
    name: "receipt.jpg",
  });
  const storedAbs = stored.ok ? path.join(vaultRoot, stored.value.relPath) : null;
  const onDisk = storedAbs && fs.existsSync(storedAbs) ? readBytes(storedAbs) : null;
  check(
    "stores the original in the finance file store",
    stored.ok === true &&
      /^domains\/financial\/data\/files\/[0-9a-f-]{36}\/receipt\.jpg$/.test(stored.value.relPath) &&
      onDisk !== null &&
      sha256(onDisk) === sha256(jpegBytes) &&
      stored.value.size === jpegBytes.byteLength,
    stored.ok
      ? `path ${stored.value.relPath} / onDisk ${onDisk ? sha256(onDisk).slice(0, 12) : "missing"} vs ${sha256(jpegBytes).slice(0, 12)} / size ${stored.value.size} vs ${jpegBytes.byteLength}`
      : `refused: ${stored.error}`,
  );

  // 2 — a PNG is kept as a PNG and handed to the model as a JPEG.
  const png = await mod.prepareReceipt(vaultRoot, {
    bytes: pngBytes,
    mime: "image/png",
    name: "receipt.png",
  });
  const pngAbs = png.ok ? path.join(vaultRoot, png.value.relPath) : null;
  const pngOnDisk = pngAbs && fs.existsSync(pngAbs) ? readBytes(pngAbs) : null;
  const modelIsJpeg = png.ok
    ? png.value.modelCopy[0] === 0xff &&
      png.value.modelCopy[1] === 0xd8 &&
      png.value.modelCopy[2] === 0xff
    : false;
  check(
    "keeps a PNG as stored and copies it to the model as JPEG",
    png.ok === true && pngOnDisk !== null && sha256(pngOnDisk) === sha256(pngBytes) && modelIsJpeg,
    png.ok
      ? `stored ${pngOnDisk ? sha256(pngOnDisk).slice(0, 12) : "missing"} vs ${sha256(pngBytes).slice(0, 12)} / model JPEG ${modelIsJpeg}`
      : `refused: ${png.error}`,
  );

  // 3 — the copy ladder: a busy original still yields a small copy.
  const large = makeLargeJpeg(2.5 * 1024 * 1024);
  const big = large
    ? await mod.prepareReceipt(vaultRoot, {
        bytes: large.bytes,
        mime: "image/jpeg",
        name: "receipt-large.jpg",
      })
    : null;
  check(
    "re-encodes a busy original under the copy ceiling",
    big?.ok === true &&
      large.bytes.byteLength > COPY_CEILING &&
      big.value.modelCopy.byteLength <= COPY_CEILING,
    big?.ok
      ? `original ${large.bytes.byteLength} → copy ${big.value.modelCopy.byteLength} (ceiling ${COPY_CEILING})`
      : `refused or no fixture: ${big ? big.error : "no large fixture"}`,
  );

  // 4 — a text file with an image's name.
  const notImage = await mod.prepareReceipt(vaultRoot, {
    bytes: new Uint8Array(Buffer.from("this is not an image, whatever the name says")),
    mime: "image/jpeg",
    name: "receipt.jpg",
  });
  check(
    "refuses bytes that are not an image",
    notImage.ok === false && notImage.error === "Receipts must be JPEG or PNG images.",
    notImage.ok ? "accepted a text buffer" : `error ${JSON.stringify(notImage.error)}`,
  );

  // 5 — the size ceiling, refused before any decode.
  const oversized = Buffer.alloc(ORIGINAL_CEILING + 1024 * 1024);
  oversized[0] = 0xff;
  oversized[1] = 0xd8;
  oversized[2] = 0xff;
  const tooBig = await mod.prepareReceipt(vaultRoot, {
    bytes: new Uint8Array(oversized),
    mime: "image/jpeg",
    name: "receipt-huge.jpg",
  });
  check(
    "refuses an original over 25 MB",
    tooBig.ok === false && tooBig.error === "That receipt is larger than 25 MB.",
    tooBig.ok ? "accepted a 26 MB buffer" : `error ${JSON.stringify(tooBig.error)}`,
  );

  // 6 — no Finance kit, no receipt store.
  const bareVault = path.join(userDataDir, `bare-${process.pid}`);
  fs.rmSync(bareVault, { recursive: true, force: true, maxRetries: 5 });
  fs.mkdirSync(bareVault, { recursive: true });
  const bare = await mod.createVault(bareVault, "No kit");
  const noKit = bare.ok
    ? await mod.prepareReceipt(bareVault, {
        bytes: jpegBytes,
        mime: "image/jpeg",
        name: "receipt.jpg",
      })
    : null;
  check(
    "refuses when the Finance kit is missing",
    noKit?.ok === false && noKit.error === "Install the Finance kit first",
    bare.ok === false
      ? `could not make the bare vault: ${bare.error}`
      : noKit.ok
        ? "accepted a receipt with no Finance kit"
        : `error ${JSON.stringify(noKit.error)}`,
  );

  return { jpegBytes: jpegBytes.byteLength, largeBytes: large?.bytes.byteLength ?? 0 };
}

/** The attach channel's own path: open the vault, prepare, and hold the slot. */
async function attachLeg(mod, vaultRoot) {
  const opened = await mod.vaultOpen(vaultRoot);
  if (!opened.ok) {
    check("opens the vault before attaching", false, `vaultOpen failed: ${opened.error}`);
    return null;
  }

  const jpegBytes = jpegFixture();
  const attached = await mod.receiptAttach({
    bytes: jpegBytes,
    mime: "image/jpeg",
    name: "receipt-held.jpg",
  });
  const held = attached.ok ? mod.pendingReceipt.peek() : null;
  const taken = attached.ok ? mod.pendingReceipt.take(attached.value.relPath) : null;
  const afterTake = mod.pendingReceipt.peek();
  check(
    "holds the prepared receipt for the turn that follows",
    attached.ok === true &&
      held?.relPath === attached.value.relPath &&
      taken?.relPath === attached.value.relPath &&
      typeof taken?.dataUrl === "string" &&
      taken.dataUrl.startsWith("data:image/jpeg;base64,") &&
      afterTake === null,
    attached.ok
      ? `held ${held?.relPath ?? "none"} / took ${taken?.relPath ?? "none"} / slot after ${afterTake === null ? "empty" : "still full"}`
      : `refused: ${attached.error}`,
  );

  // A second attach, then a take naming something the slot does not hold.
  const again = await mod.receiptAttach({
    bytes: jpegBytes,
    mime: "image/jpeg",
    name: "receipt-held-2.jpg",
  });
  const wrong = mod.pendingReceipt.take(
    "domains/financial/data/files/00000000-0000-0000-0000-000000000000/other.jpg",
  );
  const stillHeld = mod.pendingReceipt.peek();
  check(
    "will not hand over a receipt it does not hold",
    again.ok === true && wrong === null && stillHeld?.relPath === again.value.relPath,
    again.ok
      ? `wrong take ${wrong === null ? "refused" : "returned"} / slot still ${stillHeld?.relPath ?? "empty"}`
      : `refused: ${again.error}`,
  );

  return attached.ok ? { relPath: attached.value.relPath, name: attached.value.name } : null;
}

function readBytes(abs) {
  return new Uint8Array(fs.readFileSync(abs));
}

/**
 * Stands in for the gateway on the far side of `/chat/stream`, and keeps every
 * body it is sent. The turn is what this rig is about, so the recording is the
 * evidence: the request the app really builds, not a shape the rig hoped for.
 */
function startRecordingGateway() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ url: req.url, method: req.method, body });
      if ((req.url ?? "").endsWith("/chat/stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end("event: run.completed\ndata: {}\n\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        chatBodies: () => requests.filter((r) => (r.url ?? "").endsWith("/chat/stream")),
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * The composer leg: the real ChatPanel on the chat-panel harness page, driven
 * through the real control for each way a receipt can arrive.
 *
 * This leg stops at the page's stubbed bridge — a dev-server page has no
 * preload, so the panel's `receiptAttach` call ends here rather than in main.
 * It proves the payload the panel builds; the main leg proves what main does
 * with that payload.
 */
async function composerLeg() {
  const url =
    process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const run = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Page-side helpers, re-declared inside each evaluation. */
  const BYTES = JSON.stringify(Array.from(jpegFixture()));
  const PRELUDE = `
    const mkFile = (name) => new File([new Uint8Array(${BYTES})], name, { type: "image/jpeg" });
    const until = async (read, budget) => {
      const deadline = Date.now() + budget;
      for (;;) {
        const value = read();
        if (value) return value;
        if (Date.now() >= deadline) return null;
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    const chip = () => {
      const name = document.querySelector(".chat-panel__receipt-name");
      const thumb = document.querySelector(".chat-panel__receipt-thumb");
      return name ? { name: name.textContent, hasThumb: Boolean(thumb && thumb.src) } : null;
    };
    const chipCount = () => document.querySelectorAll(".chat-panel__receipt").length;
    const calls = () => (window.__lqChatCalls || []).map((c) => c.receiptRelPath);`;

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(1280, 900);
    await wait(250);
    win.showInactive();

    // 1 — a pick through the file control.
    const pick = await run(`(async () => { ${PRELUDE}
      window.__lqChatCalls = []; window.__lqAttachCalls = [];
      const input = document.querySelector(".chat-panel__receipt-input");
      const dt = new DataTransfer();
      dt.items.add(mkFile("receipt.jpg"));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const shown = await until(() => chip(), 4000);
      return { shown, attaches: window.__lqAttachCalls || [] };
    })()`);
    check(
      "shows a chip when a receipt is picked",
      pick.shown?.name === "receipt.jpg" &&
        pick.shown.hasThumb === true &&
        pick.attaches.length === 1 &&
        pick.attaches[0].mime === "image/jpeg" &&
        pick.attaches[0].bytes > 0,
      `chip ${JSON.stringify(pick.shown)} / attaches ${JSON.stringify(pick.attaches)}`,
    );

    // 2 — the turn names the path the bridge minted.
    const send = await run(`(async () => { ${PRELUDE}
      document.querySelector(".chat-panel__send").click();
      const sent = await until(() => (window.__lqChatCalls || []).length ? true : null, 4000);
      await new Promise((r) => setTimeout(r, 60));
      return { sent, calls: calls(), chipAfter: chipCount() };
    })()`);
    check(
      "carries the stored path on the turn and clears the chip",
      send.sent === true &&
        send.calls.length === 1 &&
        send.calls[0] === "domains/financial/data/files/11111111-2222-3333-4444-555555555555/receipt.jpg" &&
        send.chipAfter === 0,
      `calls ${JSON.stringify(send.calls)} / chips after send ${send.chipAfter}`,
    );

    // 3 — a drop on the composer.
    const drop = await run(`(async () => { ${PRELUDE}
      const form = document.querySelector(".chat-panel__composer");
      const dt = new DataTransfer();
      dt.items.add(mkFile("dropped.jpg"));
      form.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { shown: await until(() => chip(), 4000) };
    })()`);
    check(
      "shows a chip when a receipt is dropped",
      drop.shown?.name === "dropped.jpg",
      `chip ${JSON.stringify(drop.shown)}`,
    );

    // 4 — a paste into the field. The dropped receipt is removed first so the
    // chip proved here is the pasted one's.
    const paste = await run(`(async () => { ${PRELUDE}
      document.querySelector(".chat-panel__receipt-remove").click();
      await until(() => (chipCount() === 0 ? true : null), 2000);
      const field = document.querySelector(".chat-panel__composer-input");
      const dt = new DataTransfer();
      dt.items.add(mkFile("pasted.jpg"));
      field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      return { shown: await until(() => chip(), 4000) };
    })()`);
    check(
      "shows a chip when a receipt is pasted",
      paste.shown?.name === "pasted.jpg",
      `chip ${JSON.stringify(paste.shown)}`,
    );

    // 5 — a second attach replaces the first: one chip, never two.
    const replace = await run(`(async () => { ${PRELUDE}
      const input = document.querySelector(".chat-panel__receipt-input");
      const dt = new DataTransfer();
      dt.items.add(mkFile("second.jpg"));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const shown = await until(() => (chip()?.name === "second.jpg" ? chip() : null), 4000);
      return { shown, count: chipCount() };
    })()`);
    check(
      "replaces the pending receipt rather than adding one",
      replace.shown?.name === "second.jpg" && replace.count === 1,
      `chip ${JSON.stringify(replace.shown)} / count ${replace.count}`,
    );

    // 6 — removing it sends no receipt on the next turn.
    const remove = await run(`(async () => { ${PRELUDE}
      window.__lqChatCalls = [];
      document.querySelector(".chat-panel__receipt-remove").click();
      const cleared = await until(() => (chipCount() === 0 ? true : null), 3000);
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "Just text");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      document.querySelector(".chat-panel__send").click();
      const sent = await until(() => (calls().length ? true : null), 4000);
      return { cleared, sent, calls: calls() };
    })()`);
    check(
      "sends no receipt once the chip is removed",
      remove.cleared === true && remove.calls.length === 1 && remove.calls[0] === null,
      `cleared ${remove.cleared} / calls ${JSON.stringify(remove.calls)}`,
    );

    // 7 — switching chats drops the pending receipt with the chat it was
    // attached in. The row is picked as "not the one already open": this rig's
    // Electron profile keeps localStorage between runs, so the panel can come up
    // on either chat, and a fixed row would sometimes be a no-op click that
    // looked like the panel keeping the chip.
    const switched = await run(`(async () => { ${PRELUDE}
      const input = document.querySelector(".chat-panel__receipt-input");
      const dt = new DataTransfer();
      dt.items.add(mkFile("switched.jpg"));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const attached = Boolean(await until(() => chip(), 4000));
      const readTranscript = () =>
        Array.from(document.querySelectorAll(".chat-panel__message-content"))
          .map((el) => el.textContent || "")
          .join(" | ");
      const before = readTranscript();
      document.querySelector('[aria-label="Chat history"]').click();
      const other = await until(
        () => Array.from(document.querySelectorAll(".chat-panel__session"))
          .find((el) => !el.classList.contains("chat-panel__session--active")) ?? null,
        8000,
      );
      if (!other) return { attached, rowFound: false, gone: false, switchedNow: false };
      other.click();
      const gone = await until(() => (chipCount() === 0 ? true : null), 8000);
      return {
        attached,
        rowFound: true,
        gone: gone === true,
        switchedNow: before !== readTranscript(),
      };
    })()`);
    check(
      "clears the pending receipt when the chat changes",
      switched.attached === true &&
        switched.rowFound === true &&
        switched.switchedNow === true &&
        switched.gone === true,
      `attached ${switched.attached} / other chat found ${switched.rowFound} / switched ${switched.switchedNow} / cleared ${switched.gone}`,
    );

    const chipShot = path.join(artifactsDir, "receipt-attach-chip.png");
    const threadShot = path.join(artifactsDir, "receipt-attach-thread.png");

    // The pictures, for the operator: the chip with a receipt waiting, and the
    // thread showing the turn that carried one.
    const shots = await run(`(async () => { ${PRELUDE}
      const input = document.querySelector(".chat-panel__receipt-input");
      const dt = new DataTransfer();
      dt.items.add(mkFile("receipt-photo.jpg"));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const shown = await until(() => chip(), 4000);
      return { shown: Boolean(shown) };
    })()`);
    if (shots.shown) {
      fs.writeFileSync(chipShot, (await win.webContents.capturePage()).toPNG());
      await run(`(async () => { ${PRELUDE}
        document.querySelector(".chat-panel__send").click();
        await until(() => (document.querySelector(".chat-panel__message-receipt") ? true : null), 4000);
        return true;
      })()`);
      fs.writeFileSync(threadShot, (await win.webContents.capturePage()).toPNG());
    }
    check(
      "photographs the chip and the turn that carried it",
      shots.shown === true &&
        fs.existsSync(chipShot) &&
        fs.existsSync(threadShot),
      `chip shown ${shots.shown} / files ${fs.existsSync(chipShot)}/${fs.existsSync(threadShot)}`,
    );

    // 8 — a refusal from main shows on the composer and leaves no chip.
    await win.loadURL(`${url}?attachfail=1`);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(1280, 900);
    await wait(250);
    const refused = await run(`(async () => { ${PRELUDE}
      const input = document.querySelector(".chat-panel__receipt-input");
      const dt = new DataTransfer();
      dt.items.add(mkFile("bad.jpg"));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const message = await until(() => {
        const el = document.querySelector(".chat-panel__error, [role=alert]");
        return el && el.textContent ? el.textContent.trim() : null;
      }, 4000);
      return { message, count: chipCount() };
    })()`);
    check(
      "shows the refusal and keeps no chip",
      refused.count === 0 && typeof refused.message === "string" && refused.message.length > 0,
      `count ${refused.count} / message ${JSON.stringify(refused.message)}`,
    );

    return { shots: [chipShot, threadShot] };
  } finally {
    win.destroy();
  }
}

/** The turn the app builds, with and without a receipt on it. */
async function turnLeg(mod) {
  const gateway = await startRecordingGateway();
  mod.companionAttachToGateway(gateway.baseUrl, "rig-key");

  const ctx = {
    domainName: "Financial",
    domainSlug: "financial",
    aboutMe: "",
    locked: false,
    vaultOpen: true,
  };
  const noop = () => {};

  // 1 — a turn with no receipt keeps the text-only shape it has always had.
  const plain = await mod.companionChatStream("rig-session", "Coffee for R85", ctx, noop);
  const plainBody = JSON.parse(gateway.chatBodies().at(-1).body);
  check(
    "posts a text-only turn as a plain string",
    plain.ok === true && typeof plainBody.input === "string" && plainBody.input === "Coffee for R85",
    `ok ${plain.ok} / input ${JSON.stringify(plainBody.input)?.slice(0, 80)}`,
  );

  // 2 — with a receipt named, the turn carries the image and the path.
  const jpegBytes = jpegFixture();
  const held = await mod.receiptAttach({ bytes: jpegBytes, mime: "image/jpeg", name: "turn.jpg" });
  const sent = held.ok
    ? await mod.companionChatStreamWithPack(
        "rig-session",
        "Log this receipt",
        ctx,
        noop,
        null,
        held.value.relPath,
      )
    : null;
  const withReceipt = JSON.parse(gateway.chatBodies().at(-1).body);
  const parts = Array.isArray(withReceipt.input) ? withReceipt.input : [];
  const imagePart = parts.find((p) => p.type === "image_url");
  check(
    "posts a receipt turn as a text part and an image part",
    sent?.ok === true &&
      parts.length === 2 &&
      parts[0].type === "text" &&
      parts[0].text === "Log this receipt" &&
      Boolean(imagePart) &&
      String(imagePart.image_url.url).startsWith("data:image/jpeg;base64,"),
    sent?.ok === false
      ? `refused: ${sent.error}`
      : `parts ${JSON.stringify(parts.map((p) => p.type))} / image ${String(imagePart?.image_url?.url ?? "").slice(0, 30)}`,
  );

  // 3 — the same body tells the agent the exact string to cite.
  const instructions = String(withReceipt.instructions ?? "");
  check(
    "names the stored path in the turn's instructions",
    held.ok === true &&
      instructions.includes(held.value.relPath) &&
      instructions.includes("pass that exact string as source_file"),
    `path in instructions ${instructions.includes(held.ok ? held.value.relPath : "\u0000")}`,
  );

  // 4 — a busy receipt's whole body, base64 and instructions included, stays
  // well inside the gateway's ceiling. The payload floor is here so a body that
  // came out tiny because the image was dropped cannot read as a pass.
  const large = makeLargeJpeg(2.5 * 1024 * 1024);
  const bigHeld = large
    ? await mod.receiptAttach({ bytes: large.bytes, mime: "image/jpeg", name: "turn-large.jpg" })
    : null;
  const bigSent = bigHeld?.ok
    ? await mod.companionChatStreamWithPack(
        "rig-session",
        "Log this receipt",
        ctx,
        noop,
        null,
        bigHeld.value.relPath,
      )
    : null;
  const bodyBytes = bigHeld?.ok
    ? Buffer.byteLength(gateway.chatBodies().at(-1).body, "utf8")
    : 0;
  check(
    "keeps a busy receipt turn under the body ceiling",
    bigSent?.ok === true && bodyBytes < 6 * 1024 * 1024 && bodyBytes > 100 * 1024,
    bigHeld?.ok
      ? `original ${large.bytes.byteLength} → body ${bodyBytes} bytes (ceiling ${6 * 1024 * 1024})`
      : `no large receipt: ${bigHeld ? bigHeld.error : "no fixture"}`,
  );

  // 5 — a turn naming a receipt main is not holding never reaches the gateway.
  const before = gateway.chatBodies().length;
  const stale = await mod.companionChatStreamWithPack(
    "rig-session",
    "Log this receipt",
    ctx,
    noop,
    null,
    "domains/financial/data/files/00000000-0000-0000-0000-000000000000/stale.jpg",
  );
  check(
    "refuses a turn naming a receipt it does not hold",
    stale.ok === false &&
      stale.error === "Attach that receipt again." &&
      gateway.chatBodies().length === before,
    `ok ${stale.ok} / error ${JSON.stringify(stale.error)} / requests +${gateway.chatBodies().length - before}`,
  );

  await gateway.close();
  return { recorded: gateway.requests.length, bodyBytes };
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
    const preparation = await prepareLeg(mod, summary.vault);
    const attached = await attachLeg(mod, summary.vault);
    const turn = await turnLeg(mod);
    const composer = await composerLeg();

    report = {
      ranAt: new Date().toISOString(),
      vault: VAULT,
      fixture: { path: summary.storedPath, bytes: summary.bytes },
      preparation,
      attached,
      turn,
      composer,
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
