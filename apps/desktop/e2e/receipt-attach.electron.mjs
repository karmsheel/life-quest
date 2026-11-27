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
 * What it covers: the main-process promotion channel (the plus stores a picture
 * as any other attachment; `receipt:promote` reads those bytes, writes the
 * finance-store original and the model copy, and moves the picture into the
 * receipt slot), the capture path that cites the promoted path, the turn that
 * carries it, and the composer leg that drives the chip's "Use as receipt"
 * action through the real ChatPanel.
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

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on. A rig runs
// hidden beside every other rig in the suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
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
 * Hermes is the transport the turn leg measures, and it is the operator's real
 * install by default. The app now applies the open vault's agent binding on
 * vault open, so this rig binds a throwaway agent to its own vault and points
 * that agent at the recording gateway; the throwaway home and the stripped PATH
 * keep every profile and every CLI probe away from the real `~/.hermes` and its
 * running host. The profile path is also what the companion's transport guard
 * compares against, so the fake gateway has to claim exactly this path.
 */
const HERMES_HOME = path.join(userDataDir, "receipt-hermes-home");
const RECEIPT_PROFILE = "receipt-rig";
fs.rmSync(HERMES_HOME, { recursive: true, force: true });
fs.mkdirSync(HERMES_HOME, { recursive: true });
process.env.HERMES_HOME = HERMES_HOME;
process.env.PATH = (process.env.PATH ?? "")
  .split(path.delimiter)
  .filter((dir) => dir && !fs.existsSync(path.join(dir, "hermes")))
  .join(path.delimiter);
const RECEIPT_PROFILE_PATH = path.join(HERMES_HOME, "profiles", RECEIPT_PROFILE);
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
  // The pending attachments are the bytes the promotion reads: the rig has to
  // see that store to prove the id left it and the file moved.
  "apps/desktop/electron/pending-attachment.ts",
  "apps/desktop/electron/vault-service.ts",
  "apps/desktop/electron/vault-agents.ts",
  "apps/desktop/electron/harness/facade.ts",
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

/**
 * A PNG header that DECLARES a canvas wider than a receipt may be.
 *
 * Only the header is needed: main refuses a declared canvas over the ceiling
 * before it decodes anything, which is the whole point of reading dimensions
 * from the header of attacker-supplied bytes. 16,000 x 900 would be 14.4 MP —
 * under the pixel count — so it is the per-side ceiling being exercised.
 */
function hugePng({ width = 16_000, height = 900 } = {}) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // colour type: RGBA
  return new Uint8Array(bytes);
}

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
  // The Finance area seeds locked on a new vault; the kit lives in it.
  const unlocked = await mod.unlockDomain(dir, mod.FINANCE_DOMAIN_SLUG);
  if (!unlocked.ok) throw new Error(`unlockDomain(financial) failed: ${unlocked.error}`);
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

  // 6 — the canvas ceiling. 16,000 px on one side is over the 12,000 px limit,
  // and the header alone is enough: no decode, no store write, no pending
  // change. It is distinct from the format message a text file gets.
  const hugeStore = path.join(vaultRoot, "domains/financial/data/files");
  const storeCount = () => (fs.existsSync(hugeStore) ? fs.readdirSync(hugeStore).length : 0);
  const hugeFilesBefore = storeCount();
  const slotBeforeHuge = mod.pendingReceipt.peek();
  const pendingBeforeHuge = mod.pendingAttachments.peek().length;
  const huge = await mod.prepareReceipt(vaultRoot, {
    bytes: hugePng(),
    mime: "image/png",
    name: "receipt-huge-pixels.png",
  });
  check(
    "refuses a canvas bigger than a receipt can hold",
    huge.ok === false &&
      huge.error === "That picture has more pixels than a receipt can hold." &&
      storeCount() === hugeFilesBefore &&
      mod.pendingReceipt.peek()?.relPath === slotBeforeHuge?.relPath &&
      mod.pendingAttachments.peek().length === pendingBeforeHuge,
    huge.ok
      ? "accepted a 16,000 px canvas"
      : `error ${JSON.stringify(huge.error)} / store files ${hugeFilesBefore}→${storeCount()} / ` +
        `slot ${mod.pendingReceipt.peek()?.relPath ?? "empty"} / pending ${mod.pendingAttachments.peek().length}`,
  );

  // 7 — no Finance kit, no receipt store.
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

/**
 * The promote channel's own path: attach a picture the way the plus does, then
 * promote it the way the chip does, against the real vault.
 *
 * The stores are main's: the attachment is readable from disk before the press,
 * and afterwards the finance-store copy and the receipt slot exist while the
 * general-attachment file is GONE — the picture moves, it is not copied. Every
 * refusal must leave both the file and the pending attachment exactly where
 * they were.
 */
async function attachLeg(mod, vaultRoot) {
  const opened = await mod.vaultOpen(vaultRoot);
  if (!opened.ok) {
    check("opens the vault before attaching", false, `vaultOpen failed: ${opened.error}`);
    return null;
  }
  mod.pendingReceipt.clear();
  mod.pendingAttachments.clear();

  const jpegBytes = jpegFixture();
  const attached = await mod.attachmentAttach({
    bytes: jpegBytes,
    mime: "image/jpeg",
    name: "receipt-held.jpg",
  });
  if (!attached.ok) {
    check(
      "attaches the picture as a general attachment first",
      false,
      `attachmentAttach refused: ${attached.error}`,
    );
    return null;
  }
  const attachmentId = attached.value.id;
  const attachmentAbs = path.join(vaultRoot, attached.value.relPath);
  check(
    "attaches the picture as a general attachment first",
    attached.value.kind === "image" &&
      attached.value.relPath.startsWith("attachments/files/") &&
      fs.existsSync(attachmentAbs) &&
      sha256(readBytes(attachmentAbs)) === sha256(jpegBytes) &&
      mod.pendingAttachments.find(attachmentId) !== null &&
      mod.pendingReceipt.peek() === null,
    `kind ${attached.value.kind} / path ${attached.value.relPath} / on disk ${fs.existsSync(attachmentAbs)} / pending ${mod.pendingAttachments.find(attachmentId) !== null} / receipt slot ${mod.pendingReceipt.peek()?.relPath ?? "empty"}`,
  );

  // The press: one id in, the finance path and the receipt slot out.
  const promoted = await mod.receiptPromoteAttachment({ id: attachmentId });
  const held = promoted.ok ? mod.pendingReceipt.peek() : null;
  const financeAbs = promoted.ok ? path.join(vaultRoot, promoted.value.relPath) : null;
  const financeOnDisk = financeAbs && fs.existsSync(financeAbs) ? readBytes(financeAbs) : null;
  check(
    "promotes the attached picture into the finance store and the receipt slot",
    promoted.ok === true &&
      /^domains\/financial\/data\/files\/[0-9a-f-]{36}\/receipt-held\.jpg$/.test(
        promoted.value.relPath,
      ) &&
      held?.relPath === promoted.value.relPath &&
      held?.name === "receipt-held.jpg" &&
      typeof held?.dataUrl === "string" &&
      held.dataUrl.startsWith("data:image/jpeg;base64,") &&
      financeOnDisk !== null &&
      sha256(financeOnDisk) === sha256(jpegBytes) &&
      promoted.value.size === jpegBytes.byteLength,
    promoted.ok
      ? `path ${promoted.value.relPath} / held ${held?.relPath ?? "none"} / on disk ${financeOnDisk ? sha256(financeOnDisk).slice(0, 12) : "missing"} vs ${sha256(jpegBytes).slice(0, 12)} / model copy ${String(held?.dataUrl ?? "").slice(0, 22)}`
      : `refused: ${promoted.error}`,
  );

  // Moved, not copied: the same bytes must not be paid for twice.
  check(
    "moves the picture out of the general-attachment store",
    promoted.ok === true &&
      mod.pendingAttachments.find(attachmentId) === null &&
      fs.existsSync(attachmentAbs) === false &&
      financeOnDisk !== null,
    promoted.ok
      ? `pending ${mod.pendingAttachments.find(attachmentId) === null ? "cleared" : "still held"} / attachment file ${fs.existsSync(attachmentAbs)} / finance copy ${financeOnDisk !== null}`
      : `refused: ${promoted.error}`,
  );

  // A refusal must not disturb the receipt the operator already chose: the slot
  // holds the promoted picture, then a non-picture is refused. The error is the
  // only thing that changes — the slot keeps A, A's finance file stays, and the
  // refused attachment keeps both its file and its pending record.
  const clip = await mod.attachmentAttach({
    bytes: new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
    mime: "video/mp4",
    name: "clip.mp4",
  });
  const clipAbs = clip.ok ? path.join(vaultRoot, clip.value.relPath) : null;
  const heldBeforeRefusal = mod.pendingReceipt.peek();
  const refusedHeld = clip.ok ? await mod.receiptPromoteAttachment({ id: clip.value.id }) : null;
  const heldAfterRefusal = mod.pendingReceipt.peek();
  check(
    "a refusal leaves the waiting receipt untouched",
    promoted.ok === true &&
      clip.ok === true &&
      refusedHeld?.ok === false &&
      refusedHeld.error === "Only a picture can become a receipt." &&
      heldBeforeRefusal?.relPath === promoted.value.relPath &&
      heldAfterRefusal?.relPath === promoted.value.relPath &&
      heldAfterRefusal?.name === "receipt-held.jpg" &&
      financeOnDisk !== null &&
      fs.existsSync(financeAbs) &&
      mod.pendingAttachments.find(clip.value.id) !== null &&
      clipAbs !== null &&
      fs.existsSync(clipAbs),
    promoted.ok && clip.ok
      ? `${refusedHeld?.ok === false ? `error ${JSON.stringify(refusedHeld.error)}` : "accepted a clip"} / ` +
        `slot ${heldBeforeRefusal?.relPath ?? "empty"} → ${heldAfterRefusal?.relPath ?? "empty"} / ` +
        `finance file ${financeOnDisk !== null && fs.existsSync(financeAbs)} / ` +
        `clip pending ${mod.pendingAttachments.find(clip.value.id) !== null} / clip file ${clipAbs ? fs.existsSync(clipAbs) : false}`
      : `promoted ${promoted.ok} / clip ${clip.ok ? "attached" : clip.error}`,
  );

  // The ledger row cites the promoted path, not the attachment's.
  const posted = await capture(mod, vaultRoot, {
    threadId: "t-promoted",
    source_file: promoted.ok ? promoted.value.relPath : ABSENT,
  });
  const postedCell = posted?.posted ? await sourceFileOf(mod, vaultRoot, posted.rowId) : null;
  check(
    "posts a row citing the promoted receipt",
    promoted.ok === true && posted?.posted === true && postedCell === promoted.value.relPath,
    `outcome ${JSON.stringify(posted)} / cell ${JSON.stringify(postedCell)}`,
  );

  // The next turn takes the slot only by the path main holds.
  const taken = promoted.ok ? mod.pendingReceipt.take(promoted.value.relPath) : null;
  const afterTake = mod.pendingReceipt.peek();
  check(
    "hands the promoted receipt to the turn that follows",
    promoted.ok === true &&
      taken?.relPath === promoted.value.relPath &&
      typeof taken?.dataUrl === "string" &&
      taken.dataUrl.startsWith("data:image/jpeg;base64,") &&
      afterTake === null,
    `took ${taken?.relPath ?? "none"} / slot after ${afterTake === null ? "empty" : "still full"}`,
  );

  // The same non-picture, still waiting, is refused again now that the slot is
  // empty: a refusal with no receipt to keep must not invent one either.
  const refusedKind = clip.ok ? await mod.receiptPromoteAttachment({ id: clip.value.id }) : null;
  check(
    "refuses a non-picture and leaves it waiting",
    clip.ok === true &&
      refusedKind?.ok === false &&
      refusedKind.error === "Only a picture can become a receipt." &&
      mod.pendingAttachments.find(clip.value.id) !== null &&
      clipAbs !== null &&
      fs.existsSync(clipAbs) &&
      mod.pendingReceipt.peek() === null,
    clip.ok
      ? `${refusedKind?.ok === false ? `error ${JSON.stringify(refusedKind.error)}` : "accepted a clip"} / pending ${mod.pendingAttachments.find(clip.value.id) !== null} / file ${clipAbs ? fs.existsSync(clipAbs) : false}`
      : `clip attach refused: ${clip.error}`,
  );

  // The attach path classifies by the bytes, not by the name or the mime the
  // renderer claimed: text posing as a JPEG is a general file, and promoting it
  // is refused as a non-picture. The stored file and the pending attachment
  // stay exactly where they were.
  const fake = await mod.attachmentAttach({
    bytes: new Uint8Array(Buffer.from("this is not an image, whatever the name says")),
    mime: "image/jpeg",
    name: "fake.jpg",
  });
  const fakeAbs = fake.ok ? path.join(vaultRoot, fake.value.relPath) : null;
  const refusedBytes = fake.ok ? await mod.receiptPromoteAttachment({ id: fake.value.id }) : null;
  check(
    "refuses a file whose bytes are not a picture and leaves it waiting",
    fake.ok === true &&
      fake.value.kind === "file" &&
      refusedBytes?.ok === false &&
      refusedBytes.error === "Only a picture can become a receipt." &&
      mod.pendingAttachments.find(fake.value.id) !== null &&
      fakeAbs !== null &&
      fs.existsSync(fakeAbs) &&
      mod.pendingReceipt.peek() === null,
    fake.ok
      ? `kind ${JSON.stringify(fake.value.kind)} / ` +
        `${refusedBytes?.ok === false ? `error ${JSON.stringify(refusedBytes.error)}` : "accepted text bytes"} / ` +
        `pending ${mod.pendingAttachments.find(fake.value.id) !== null} / file ${fakeAbs ? fs.existsSync(fakeAbs) : false}`
      : `fake attach refused: ${fake.error}`,
  );

  // An id the pending store does not hold.
  const unknown = await mod.receiptPromoteAttachment({
    id: "00000000-0000-0000-0000-000000000000",
  });
  check(
    "refuses an attachment it is not holding",
    unknown.ok === false &&
      unknown.error === "That attachment is no longer waiting." &&
      mod.pendingReceipt.peek() === null,
    unknown.ok ? "promoted an unknown id" : `error ${JSON.stringify(unknown.error)}`,
  );

  // A second promotion replaces the first: the receipt slot is one picture deep.
  // The refused attachments above are still waiting, so "the promoted ids left"
  // is the claim, not "the pending store is empty".
  const waitingBefore = mod.pendingAttachments.peek().map((row) => row.id);
  const first = await mod.attachmentAttach({
    bytes: jpegFixture(),
    mime: "image/jpeg",
    name: "first.jpg",
  });
  const firstHeld = first.ok ? await mod.receiptPromoteAttachment({ id: first.value.id }) : null;
  const second = await mod.attachmentAttach({
    bytes: jpegFixture(),
    mime: "image/jpeg",
    name: "second.jpg",
  });
  const secondHeld = second.ok ? await mod.receiptPromoteAttachment({ id: second.value.id }) : null;
  const secondPath = secondHeld?.ok ? secondHeld.value.relPath : "\u0000";
  const slot = mod.pendingReceipt.peek();
  const waitingAfter = mod.pendingAttachments.peek().map((row) => row.id);
  check(
    "replaces the receipt instead of holding two",
    firstHeld?.ok === true &&
      secondHeld?.ok === true &&
      slot?.relPath === secondPath &&
      !waitingAfter.includes(first.value.id) &&
      !waitingAfter.includes(second.value.id) &&
      waitingAfter.length === waitingBefore.length,
    `first ${firstHeld?.ok ? firstHeld.value.relPath : "refused"} / ` +
      `second ${secondHeld?.ok ? secondHeld.value.relPath : "refused"} / ` +
      `slot ${slot?.relPath ?? "empty"} / waiting ${JSON.stringify(waitingAfter)} (was ${JSON.stringify(waitingBefore)})`,
  );

  // A take naming a path the slot does not hold hands nothing over and leaves
  // the slot alone.
  const staleTake = mod.pendingReceipt.take(
    "domains/financial/data/files/00000000-0000-0000-0000-000000000000/other.jpg",
  );
  const stillHeld = mod.pendingReceipt.peek();
  check(
    "will not hand over a receipt it does not hold",
    staleTake === null && stillHeld?.relPath === secondPath,
    `wrong take ${staleTake === null ? "refused" : "returned"} / slot still ${stillHeld?.relPath ?? "empty"}`,
  );

  // Leave the stores clean for the turn leg, which holds its own receipts.
  mod.pendingReceipt.clear();
  mod.pendingAttachments.clear();
  return promoted.ok ? { relPath: promoted.value.relPath, name: held?.name ?? null } : null;
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
 * through the one file control and the chip's "Use as receipt" action.
 *
 * This leg stops at the page's stubbed bridge — a dev-server page has no
 * preload, so the panel's `receiptPromote` call ends here rather than in main.
 * It proves the id the panel sends and the path it accepts; the main leg proves
 * what main does with that id.
 */
async function composerLeg() {
  const url =
    process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 220 ms hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const run = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Page-side helpers, re-declared inside each evaluation.
   *
   * The action is found inside the chip that shows a given name, and a press
   * names that chip's file by its id, so a rig that presses one chip's button
   * cannot pass on another chip's receipt.
   */
  const BYTES = JSON.stringify(Array.from(jpegFixture()));
  const PRELUDE = `
    const mkFile = (name, type) =>
      new File([new Uint8Array(${BYTES})], name, { type: type || "image/jpeg" });
    const until = async (read, budget) => {
      const deadline = Date.now() + budget;
      for (;;) {
        const value = read();
        if (value) return value;
        if (Date.now() >= deadline) return null;
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    const attachmentChips = () =>
      Array.from(document.querySelectorAll('[data-testid="chat-attachment"]'));
    const chipName = (chip) =>
      chip ? (chip.querySelector(".chat-panel__attachment-name") || {}).textContent || "" : null;
    const attachmentChip = (name) =>
      attachmentChips().find((chip) => chipName(chip) === name) || null;
    const attachmentNames = () => attachmentChips().map((chip) => chipName(chip));
    const offerOf = (chip) =>
      chip ? chip.querySelector('[data-testid="chat-attachment-receipt"]') : null;
    const thumbDecoded = async (thumb) => {
      if (!thumb) return false;
      try {
        await thumb.decode();
      } catch {
        return false;
      }
      return thumb.complete === true && thumb.naturalWidth > 0 && thumb.naturalHeight > 0;
    };
    /**
     * The receipt chip, with its picture actually decoded.
     *
     * thumb.src is a string whether the blob URL behind it is alive or revoked,
     * so reading the attribute would pass on a picture the panel handed over and
     * then revoked. decode() rejects for a revoked URL and naturalWidth is zero
     * until real pixels are there.
     */
    const receipt = async () => {
      const name = document.querySelector(".chat-panel__receipt-name");
      if (!name) return null;
      const thumb = document.querySelector(".chat-panel__receipt-thumb");
      return {
        name: name.textContent,
        hasThumb: await thumbDecoded(thumb),
        width: thumb ? thumb.naturalWidth : 0,
      };
    };
    /** Wait for a receipt chip by name whose picture decoded, or give the latest read back. */
    const untilReceipt = async (name, budget) => {
      const deadline = Date.now() + budget;
      for (;;) {
        const shown = await receipt();
        const matches = shown && (name === null || shown.name === name);
        if (matches && shown.hasThumb) return shown;
        if (Date.now() >= deadline) return matches ? shown : null;
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    const receiptCount = () => document.querySelectorAll(".chat-panel__receipt").length;
    const pick = async (name) => {
      const input = document.querySelector(".chat-panel__attachment-input");
      const dt = new DataTransfer();
      dt.items.add(mkFile(name));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return until(() => attachmentChip(name), 4000);
    };
    const promote = async (name) => {
      const chip = await until(() => attachmentChip(name), 4000);
      const button = offerOf(chip);
      if (!button) return false;
      button.click();
      return true;
    };
    const sendCalls = () => window.__lqChatCalls || [];
    const receiptPaths = () => sendCalls().map((call) => call.receiptRelPath);
    const promoteCalls = () => window.__lqPromoteCalls || [];
    const attachCalls = () => window.__lqAttachmentCalls || [];
    const idle = () => new Promise((r) => setTimeout(r, 120));
  `;

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(1280, 900);
    await wait(250);
    win.showInactive();

    // 1 — the one file control takes a JPEG, and the chip offers the receipt.
    // The offer is read after the receipt-readiness read settles, so a chip that
    // draws before main answers cannot be mistaken for one that never offers it.
    const picked = await run(`(async () => { ${PRELUDE}
      window.__lqChatCalls = []; window.__lqAttachmentCalls = []; window.__lqPromoteCalls = [];
      const chip = await pick("receipt.jpg");
      const button = await until(() => offerOf(chip), 4000);
      return {
        chip: chip ? {
          name: chipName(chip),
          kind: chip.getAttribute("data-attachment-kind"),
          offer: chip.getAttribute("data-receipt-offer"),
        } : null,
        action: button ? {
          text: (button.textContent || "").trim(),
          label: button.getAttribute("aria-label"),
          visible: button.offsetParent !== null,
        } : null,
        attaches: attachCalls(),
        promotes: promoteCalls().length,
        receipt: await receipt(),
        pickerCount: document.querySelectorAll('input[type="file"]').length,
        legacyAttach: Boolean(document.querySelector(".chat-panel__attach")),
        plus: Boolean(document.querySelector(".chat-panel__composer-plus")),
      };
    })()`);
    check(
      "shows an attachment chip with 'Use as receipt' when a JPEG is picked",
      picked.chip?.name === "receipt.jpg" &&
        picked.chip.kind === "image" &&
        picked.chip.offer === "true" &&
        picked.action?.text === "Use as receipt" &&
        picked.action.label === "Use receipt.jpg as a receipt" &&
        picked.action.visible === true &&
        picked.attaches.length === 1 &&
        picked.attaches[0].mime === "image/jpeg" &&
        picked.attaches[0].bytes > 0 &&
        picked.promotes === 0 &&
        picked.receipt === null &&
        picked.plus === true &&
        picked.legacyAttach === false &&
        picked.pickerCount === 1,
      `chip ${JSON.stringify(picked.chip)} / action ${JSON.stringify(picked.action)} / ` +
        `attaches ${JSON.stringify(picked.attaches.map((call) => call.name))} / promotes ${picked.promotes} / ` +
        `receipt ${JSON.stringify(picked.receipt)} / plus ${picked.plus} / legacy attach ${picked.legacyAttach} / ` +
        `pickers ${picked.pickerCount}`,
    );

    // 2 — the press moves the picture into the receipt chip and names its id.
    const promoted = await run(`(async () => { ${PRELUDE}
      const before = attachCalls();
      const clicked = await promote("receipt.jpg");
      const shown = await untilReceipt("receipt.jpg", 4000);
      await until(() => (attachmentChips().length === 0 ? true : null), 4000);
      // Decoded once immediately (the URL was handed over with real pixels) and
      // again after the page settles: a preview revoked in a cleanup would leave
      // the first read passing and this one failing.
      await idle();
      const settled = await untilReceipt("receipt.jpg", 4000);
      return {
        clicked,
        receipt: shown,
        settled,
        attachments: attachmentNames(),
        receiptCount: receiptCount(),
        promotes: promoteCalls(),
        attachmentId: before.length ? before[before.length - 1].id : null,
      };
    })()`);
    check(
      "moves the picture into the receipt chip on 'Use as receipt'",
      promoted.clicked === true &&
        promoted.receipt?.name === "receipt.jpg" &&
        promoted.receipt.hasThumb === true &&
        (promoted.receipt.width ?? 0) > 0 &&
        promoted.settled?.hasThumb === true &&
        (promoted.settled?.width ?? 0) > 0 &&
        promoted.attachments.length === 0 &&
        promoted.receiptCount === 1 &&
        promoted.promotes.length === 1 &&
        promoted.promotes[0].id === promoted.attachmentId,
      `clicked ${promoted.clicked} / receipt ${JSON.stringify(promoted.receipt)} / ` +
        `settled ${JSON.stringify(promoted.settled)} / ` +
        `attachments ${JSON.stringify(promoted.attachments)} / receipts ${promoted.receiptCount} / ` +
        `promotes ${JSON.stringify(promoted.promotes)} / attachment id ${JSON.stringify(promoted.attachmentId)}`,
    );

    // 3 — the turn names the promoted path and carries no attachment id.
    const sent = await run(`(async () => { ${PRELUDE}
      window.__lqChatCalls = [];
      document.querySelector(".chat-panel__send").click();
      const arrived = await until(() => (sendCalls().length ? true : null), 4000);
      await idle();
      const call = sendCalls()[0] || null;
      return { arrived, call, receiptCount: receiptCount(), attachments: attachmentNames() };
    })()`);
    check(
      "carries the promoted path on the turn and no attachment",
      sent.arrived === true &&
        sent.call?.receiptRelPath ===
          "domains/financial/data/files/11111111-2222-3333-4444-555555555555/receipt.jpg" &&
        Array.isArray(sent.call?.attachments) &&
        sent.call.attachments.length === 0 &&
        sent.receiptCount === 0 &&
        sent.attachments.length === 0,
      `call ${JSON.stringify(sent.call)} / receipts after send ${sent.receiptCount} / ` +
        `attachments ${JSON.stringify(sent.attachments)}`,
    );

    // 4 — a drop is an attachment, not a receipt: the meaning is chosen on the
    // chip, so the gesture that delivers the bytes cannot decide it.
    const drop = await run(`(async () => { ${PRELUDE}
      window.__lqAttachmentCalls = []; window.__lqPromoteCalls = [];
      const form = document.querySelector(".chat-panel__composer");
      const dt = new DataTransfer();
      dt.items.add(mkFile("dropped.jpg"));
      form.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const chip = await until(() => attachmentChip("dropped.jpg"), 4000);
      const button = await until(() => offerOf(chip), 4000);
      return {
        chip: chip ? { offer: chip.getAttribute("data-receipt-offer"), action: Boolean(button) } : null,
        receipt: await receipt(),
        attaches: attachCalls().map((call) => call.name),
        promotes: promoteCalls().length,
      };
    })()`);
    check(
      "drops a picture as an attachment, not a receipt",
      drop.chip?.offer === "true" &&
        drop.chip.action === true &&
        drop.receipt === null &&
        drop.attaches.includes("dropped.jpg") &&
        drop.promotes === 0,
      `chip ${JSON.stringify(drop.chip)} / receipt ${JSON.stringify(drop.receipt)} / ` +
        `attaches ${JSON.stringify(drop.attaches)} / promotes ${drop.promotes}`,
    );

    // 5 — the same for a paste. The dropped chip is taken off first so the chip
    // proved here is the pasted one's.
    const paste = await run(`(async () => { ${PRELUDE}
      const dropped = attachmentChip("dropped.jpg");
      const remove = dropped ? dropped.querySelector(".chat-panel__attachment-remove") : null;
      if (remove) remove.click();
      await until(() => (attachmentChips().length === 0 ? true : null), 3000);
      window.__lqAttachmentCalls = []; window.__lqPromoteCalls = [];
      const field = document.querySelector(".chat-panel__composer-input");
      const dt = new DataTransfer();
      dt.items.add(mkFile("pasted.jpg"));
      field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      const chip = await until(() => attachmentChip("pasted.jpg"), 4000);
      const button = await until(() => offerOf(chip), 4000);
      return {
        chip: chip ? { offer: chip.getAttribute("data-receipt-offer"), action: Boolean(button) } : null,
        receipt: await receipt(),
        attaches: attachCalls().map((call) => call.name),
        promotes: promoteCalls().length,
      };
    })()`);
    check(
      "pastes a picture as an attachment, not a receipt",
      paste.chip?.offer === "true" &&
        paste.chip.action === true &&
        paste.receipt === null &&
        paste.attaches.includes("pasted.jpg") &&
        paste.promotes === 0,
      `chip ${JSON.stringify(paste.chip)} / receipt ${JSON.stringify(paste.receipt)} / ` +
        `attaches ${JSON.stringify(paste.attaches)} / promotes ${paste.promotes}`,
    );

    // 6 — a second promotion replaces the receipt: the slot is one picture deep,
    // so the chip count stays one rather than two.
    const replace = await run(`(async () => { ${PRELUDE}
      await promote("pasted.jpg");
      await untilReceipt("pasted.jpg", 4000);
      const second = await pick("second.jpg");
      const clicked = await promote("second.jpg");
      const shown = await untilReceipt("second.jpg", 4000);
      await until(() => (attachmentChips().length === 0 ? true : null), 4000);
      return {
        second: Boolean(second),
        clicked,
        receipt: shown,
        receiptCount: receiptCount(),
        attachments: attachmentNames(),
      };
    })()`);
    check(
      "replaces the pending receipt rather than adding one",
      replace.second === true &&
        replace.clicked === true &&
        replace.receipt?.name === "second.jpg" &&
        replace.receiptCount === 1 &&
        replace.attachments.length === 0,
      `second ${replace.second} / clicked ${replace.clicked} / receipt ${JSON.stringify(replace.receipt)} / ` +
        `receipts ${replace.receiptCount} / attachments ${JSON.stringify(replace.attachments)}`,
    );

    // 7 — removing the chip means the next turn names no receipt.
    const remove = await run(`(async () => { ${PRELUDE}
      window.__lqChatCalls = [];
      document.querySelector(".chat-panel__receipt-remove").click();
      const cleared = await until(() => (receiptCount() === 0 ? true : null), 3000);
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "Just text");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await idle();
      document.querySelector(".chat-panel__send").click();
      const delivered = await until(() => (receiptPaths().length ? true : null), 4000);
      return { cleared, delivered, paths: receiptPaths() };
    })()`);
    check(
      "sends no receipt once the chip is removed",
      remove.cleared === true && remove.paths.length === 1 && remove.paths[0] === null,
      `cleared ${remove.cleared} / calls ${JSON.stringify(remove.paths)}`,
    );

    // 8 — switching chats drops the pending receipt with the chat it was
    // attached in. The other chat is opened from the sidebar, where the whole
    // history lives: the dock carries no list of its own to pick a row from.
    // The row is "the one that is not open", not a fixed label: what is under
    // test is the switch, so the rig must make one whatever the profile left in
    // front.
    const switched = await run(`(async () => { ${PRELUDE}
      await pick("switched.jpg");
      const promotedNow = await promote("switched.jpg");
      const attached = Boolean(await untilReceipt("switched.jpg", 4000));
      const readTranscript = () =>
        Array.from(document.querySelectorAll(".chat-panel__message-content"))
          .map((el) => el.textContent || "")
          .join(" | ");
      const readRows = () =>
        Array.from(document.querySelectorAll(".chats-rail__row")).map((li) => ({
          label: (li.querySelector(".chats-rail__label") || {}).textContent || "",
          active: Boolean(li.querySelector("[aria-current='true']")),
        }));
      const before = readTranscript();
      const rows = readRows();
      const target = rows.find((row) => !row.active) || null;
      if (!target) return { attached, promotedNow, rowFound: false, gone: false, switchedNow: false, rows };
      const other = await until(
        () => {
          const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
            (li) =>
              (((li.querySelector(".chats-rail__label") || {}).textContent) || "").trim() ===
              target.label,
          );
          return row ? row.querySelector(".chats-rail__row-main") : null;
        },
        8000,
      );
      if (!other) return { attached, promotedNow, rowFound: false, gone: false, switchedNow: false, rows };
      other.click();
      const switchedNow = Boolean(
        await until(
          () =>
            readRows().some((row) => row.active && row.label === target.label) ||
            null,
          8000,
        ),
      );
      const gone = await until(() => (receiptCount() === 0 ? true : null), 8000);
      return {
        attached,
        promotedNow,
        rowFound: true,
        gone: gone === true,
        switchedNow,
        rows: readRows(),
        heading: (
          (document.querySelector(".chat-panel__heading--thread") || {}).textContent || ""
        ).trim(),
        receipt: await receipt(),
        before,
        after: readTranscript(),
      };
    })()`);
    check(
      "clears the pending receipt when the chat changes",
      switched.attached === true &&
        switched.rowFound === true &&
        switched.switchedNow === true &&
        switched.gone === true,
      `attached ${switched.attached} / other chat found ${switched.rowFound} / ` +
        `switched ${switched.switchedNow} / cleared ${switched.gone} / ` +
        `heading "${switched.heading}" / receipt ${JSON.stringify(switched.receipt)} / ` +
        `rows ${JSON.stringify(switched.rows)}`,
    );

    // The pictures, for the operator: the chip wearing the action that makes the
    // picture a receipt, then a thread that carried one with the next receipt
    // already waiting in the composer beside the page pill.
    const chipShot = path.join(artifactsDir, "receipt-attach-chip.png");
    const threadShot = path.join(artifactsDir, "receipt-attach-thread.png");

    // A fresh page, so the thread the picture shows is a clean one.
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(1280, 900);
    await wait(250);
    const chipShotState = await run(`(async () => { ${PRELUDE}
      window.__lqChatCalls = [];
      const chip = await pick("receipt-photo.jpg");
      const button = await until(() => offerOf(chip), 4000);
      await idle();
      return { shown: Boolean(chip && button), receipt: await receipt() };
    })()`);
    if (chipShotState.shown) {
      fs.writeFileSync(chipShot, (await win.webContents.capturePage()).toPNG());
    }
    const threadState = chipShotState.shown
      ? await run(`(async () => { ${PRELUDE}
        await promote("receipt-photo.jpg");
        const promotedNow = await untilReceipt("receipt-photo.jpg", 4000);
        document.querySelector(".chat-panel__send").click();
        const sentNow = await until(() => (sendCalls().length ? true : null), 4000);
        const receiptTurn = await until(() => {
          const turn = document.querySelector(".chat-panel__message-receipt");
          return turn ? turn.textContent : null;
        }, 4000);
        // One more picture, promoted after the turn: the composer's receipt
        // chip is in the picture with the turn that carried one.
        await pick("composer-photo.jpg");
        const nextPromote = await promote("composer-photo.jpg");
        const waiting = await untilReceipt("composer-photo.jpg", 4000);
        await idle();
        return { promotedNow: Boolean(promotedNow), sentNow, receiptTurn, nextPromote, waiting };
      })()`)
      : null;
    if (threadState) {
      fs.writeFileSync(threadShot, (await win.webContents.capturePage()).toPNG());
    }
    check(
      "photographs the chip with the action and the turn that carried a receipt",
      chipShotState.shown === true &&
        threadState?.sentNow === true &&
        threadState?.promotedNow === true &&
        (threadState?.receiptTurn ?? "").includes("receipt-photo.jpg") &&
        threadState?.waiting?.name === "composer-photo.jpg" &&
        threadState?.waiting?.hasThumb === true &&
        fs.existsSync(chipShot) &&
        fs.existsSync(threadShot),
      `chip shown ${chipShotState.shown} / thread ${JSON.stringify(threadState)} / ` +
        `files ${fs.existsSync(chipShot)}/${fs.existsSync(threadShot)}`,
    );

    // 9 — a refusal from main shows on the composer and leaves the attachment
    // chip where it was, with its action still on offer.
    await win.loadURL(`${url}?attachfail=1`);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(1280, 900);
    await wait(250);
    const refused = await run(`(async () => { ${PRELUDE}
      const chip = await pick("bad.jpg");
      const clicked = await promote("bad.jpg");
      const message = await until(() => {
        const el = document.querySelector(".chat-panel__error");
        return el && el.textContent ? el.textContent.trim() : null;
      }, 4000);
      await idle();
      const after = attachmentChip("bad.jpg");
      return {
        chipPresent: Boolean(after),
        offerStillThere: Boolean(offerOf(after)),
        clicked,
        message,
        receipt: await receipt(),
        promotes: promoteCalls().length,
      };
    })()`);
    check(
      "shows the refusal and keeps the attachment chip",
      refused.chipPresent === true &&
        refused.offerStillThere === true &&
        refused.receipt === null &&
        refused.promotes === 1 &&
        typeof refused.message === "string" &&
        refused.message.includes("Receipts must be JPEG or PNG images."),
      `chip ${refused.chipPresent} / action ${refused.offerStillThere} / ` +
        `receipt ${JSON.stringify(refused.receipt)} / promotes ${refused.promotes} / ` +
        `message ${JSON.stringify(refused.message)}`,
    );

    // 10 — a vault whose receipt store is not ready (`?nokit=1`: no Finance kit
    // or an archived Financial area) offers no receipt: the chip is an
    // attachment, and there is nothing on screen that could dead-end.
    await win.loadURL(`${url}?nokit=1`);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(1280, 900);
    await wait(250);
    const bare = await run(`(async () => { ${PRELUDE}
      const chip = await pick("no-kit.jpg");
      await idle();
      return {
        chipPresent: Boolean(chip),
        offer: chip ? chip.getAttribute("data-receipt-offer") : null,
        action: Boolean(offerOf(chip)),
        receipt: await receipt(),
      };
    })()`);
    check(
      "offers no 'Use as receipt' in a vault without the Finance kit",
      bare.chipPresent === true &&
        bare.offer === null &&
        bare.action === false &&
        bare.receipt === null,
      `chip ${bare.chipPresent} / offer ${JSON.stringify(bare.offer)} / ` +
        `action ${bare.action} / receipt ${JSON.stringify(bare.receipt)}`,
    );

    // 11 — a refused later promotion must not clear the receipt already chosen.
    // The failure stubbed here is main's pixel-ceiling reason, which arrives
    // while the slot holds a picture: the composer must show the error, the
    // refused picture must stay an attachment chip with its action, and the
    // receipt chip must still name (and decode) the picture that was chosen.
    await win.loadURL(`${url}?attachfail=second`);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(1280, 900);
    await wait(250);
    const laterRefusal = await run(`(async () => { ${PRELUDE}
      window.__lqPromoteCalls = [];
      const firstPick = await pick("kept.jpg");
      const firstClick = await promote("kept.jpg");
      const kept = await untilReceipt("kept.jpg", 4000);
      const secondPick = await pick("refused.jpg");
      const secondClick = await promote("refused.jpg");
      const message = await until(() => {
        const el = document.querySelector(".chat-panel__error");
        return el && el.textContent ? el.textContent.trim() : null;
      }, 4000);
      await idle();
      const stillKept = await untilReceipt("kept.jpg", 4000);
      const refusedChip = attachmentChip("refused.jpg");
      return {
        firstPick: Boolean(firstPick),
        firstClick,
        kept,
        secondPick: Boolean(secondPick),
        secondClick,
        message,
        stillKept,
        refusedChip: Boolean(refusedChip),
        refusedOffer: Boolean(offerOf(refusedChip)),
        receiptCount: receiptCount(),
        promotes: promoteCalls().length,
      };
    })()`);
    check(
      "keeps the receipt chip when a later promotion is refused",
      laterRefusal.firstPick === true &&
        laterRefusal.firstClick === true &&
        laterRefusal.kept?.name === "kept.jpg" &&
        laterRefusal.kept?.hasThumb === true &&
        laterRefusal.secondPick === true &&
        laterRefusal.secondClick === true &&
        typeof laterRefusal.message === "string" &&
        laterRefusal.message.includes("That picture has more pixels than a receipt can hold.") &&
        laterRefusal.stillKept?.name === "kept.jpg" &&
        laterRefusal.stillKept?.hasThumb === true &&
        laterRefusal.refusedChip === true &&
        laterRefusal.refusedOffer === true &&
        laterRefusal.receiptCount === 1 &&
        laterRefusal.promotes === 2,
      `first ${laterRefusal.firstClick}/${JSON.stringify(laterRefusal.kept)} / ` +
        `second ${laterRefusal.secondClick}/${JSON.stringify(laterRefusal.stillKept)} / ` +
        `message ${JSON.stringify(laterRefusal.message)} / ` +
        `refused chip ${laterRefusal.refusedChip}/${laterRefusal.refusedOffer} / ` +
        `receipts ${laterRefusal.receiptCount} / promotes ${laterRefusal.promotes}`,
    );

    return { shots: [chipShot, threadShot] };
  } finally {
    win.destroy();
  }
}

/**
 * The receipt the composer's chip produces, made the way the app makes it:
 * attach the picture as any other attachment, then promote it by id. The turn
 * leg only needs the slot main holds, so this is the two-call path once.
 */
async function holdReceipt(mod, input) {
  const attached = await mod.attachmentAttach(input);
  if (!attached.ok) return attached;
  return mod.receiptPromoteAttachment({ id: attached.value.id });
}

/** The turn the app builds, with and without a receipt on it. */
async function turnLeg(mod) {
  const gateway = await startRecordingGateway();
  // A vault-scoped app starts on Pi; this leg measures the Hermes transport, so
  // bind the rig's throwaway agent to the vault the attach leg opened and make
  // it the answering agent before the fake gateway is attached. The fake gateway
  // claims the bound profile's path, which is what the transport guard checks.
  const bound = await mod.addHermesAgentToVault({
    mode: "fresh",
    name: RECEIPT_PROFILE,
  });
  check(
    "binds the rig's own Hermes agent to the open vault",
    bound?.ok === true && bound.value?.hermesProfile === RECEIPT_PROFILE,
    bound?.ok ? JSON.stringify(bound.value) : `refused: ${bound?.error}`,
  );
  const active = await mod.useHarness("hermes");
  check(
    "makes the rig's Hermes agent the answering one",
    active?.kind !== undefined,
    `status ${JSON.stringify(active?.kind)}`,
  );
  mod.companionAttachToGateway(gateway.baseUrl, "rig-key", RECEIPT_PROFILE_PATH);

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
  const held = await holdReceipt(mod, {
    bytes: jpegBytes,
    mime: "image/jpeg",
    name: "turn.jpg",
  });
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
    ? await holdReceipt(mod, {
        bytes: large.bytes,
        mime: "image/jpeg",
        name: "turn-large.jpg",
      })
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
    console.error("receipt-attach: timed out after 150s");
    app.exit(1);
  }, 150_000);

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
