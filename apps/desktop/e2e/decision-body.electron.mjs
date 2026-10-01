/**
 * Drives the decision-body harness in a real Electron window and turns what the
 * card actually renders into `e2e/artifacts/decision-body.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/decision-body.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same table, no eyeballing the app required.
 *
 * What this rig claims, and the input that makes each claim falsifiable:
 *
 *  1. The filed body shows raw relation ids. Rendered as filed, the Category row
 *     reads "Category uncategorized -> 47083ecb…". That is the reported defect,
 *     kept in the artifact so the fix has a before.
 *  2. The read path's labels reach the table. Rendered with `cellLabels`, the
 *     same row reads "Uncategorized -> Groceries".
 *  3. No id survives in the readable area. Waiting for the collapsed "Exact
 *     proposal" block, the card's visible text holds no truncated row id.
 *  4. Nothing is hidden: each labelled cell keeps the raw id in its tooltip, and
 *     the collapsed exact payload still holds the id the apply path will use.
 *  5. The renderer does not rewrite the body: the parsed exact payload is
 *     deep-equal to the body the harness was handed.
 *
 * NOT covered here: that the main process resolves those labels in the first
 * place (that is `packages/vault-core/tests/decision-labels.test.ts` over a real
 * vault with relation columns), and the approve/reject round trip.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/decision-body.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const fixture = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures/decision-row.json"), "utf8"),
);

/** Everything an operator can read, minus the collapsed "Exact proposal". */
const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const rows = Array.from(document.querySelectorAll(".decision-fields tr")).map((tr) => ({
    field: text(tr.querySelector("th")),
    cells: Array.from(tr.querySelectorAll("td")).map((td) => ({
      text: text(td),
      title: td.querySelector("[title]") ? td.querySelector("[title]").getAttribute("title") : null
    }))
  }));
  const proposal = document.querySelector(".decision-proposal");
  const source = document.querySelector(".decision-source pre");
  let readable = "";
  if (proposal) {
    const clone = proposal.cloneNode(true);
    const sourceBlock = clone.querySelector(".decision-source");
    if (sourceBlock) sourceBlock.remove();
    readable = (clone.textContent || "").trim();
  }
  const inbox = document.querySelector(".decisions-inbox");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    inboxWidth: inbox ? Math.round(inbox.getBoundingClientRect().width) : null,
    lead: text(document.querySelector(".decision-lead")),
    rows,
    changedRows: document.querySelectorAll(".decision-row--changed").length,
    unchangedSummary: text(document.querySelector(".decision-unchanged summary")) || null,
    readable,
    exactPayload: source ? source.textContent : null
  };
})()`;

const errors = [];

const failure = (message) => {
  errors.push(message);
  return message;
};

/**
 * Poll for the state we are waiting on. Never sleep a fixed interval, and never
 * wait on a frame: a hidden window suspends rAF and the wait then never returns.
 */
function waitFor(win, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
        // The dev server can reload the page mid-wait (Vite re-optimising a new
        // import), which clears the harness globals: that is "not ready yet".
        value = undefined;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 50);
    };
    void poll();
  });
}

/** Render one body, and return the card as the operator reads it. */
async function render(win, body) {
  const committed = await win.webContents.executeJavaScript(
    "window.decisionBodyCommits ?? 0",
  );
  const previous = body.previousCells ? JSON.stringify(body.previousCells, null, 2) : null;
  await win.webContents.executeJavaScript(
    `window.renderDecisionBody({ target: ${JSON.stringify(fixture.target)}, ` +
      `body: ${JSON.stringify(body)}, previous: ${JSON.stringify(previous)} })`,
  );
  await waitFor(win, `(window.decisionBodyCommits ?? 0) > ${committed}`, "the card to commit");
  return win.webContents.executeJavaScript(SAMPLE);
}

/** "47083ecb…" — the shortId the card falls back to for a raw row id. */
const SHORT_ID = /\b[0-9a-f]{8}…/;
/** "category-uncategorized" — a slug-shaped id, shown as prose when unmapped. */
const SLUG_ID = /\b[a-z]+-[a-z-]{4,}\b/;

const rowFor = (sample, field) => sample.rows.find((row) => row.field === field);

async function main() {
  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(url);
  await waitFor(win, "Boolean(window.decisionBodyReady)", "decisionBodyReady");

  const checks = {};

  // ── as filed: the reported defect, captured on purpose ────────────────────
  const raw = await render(win, fixture.raw);
  const rawCategory = rowFor(raw, "Category");
  checks.rawShowsShortId = Boolean(
    rawCategory && SHORT_ID.test(rawCategory.cells.at(-1)?.text ?? ""),
  );
  checks.rawShowsSlugId = Boolean(
    rawCategory && rawCategory.cells.some((cell) => cell.text === "Category uncategorized"),
  );
  if (!checks.rawShowsShortId) {
    failure("the body as filed no longer shows a relation id — the before state is gone");
  }

  // ── as read: the labels the main process resolved ────────────────────────
  const resolved = await render(win, fixture.resolved);

  const category = rowFor(resolved, "Category");
  checks.categoryNow = category?.cells[0]?.text ?? null;
  checks.categoryProposed = category?.cells.at(-1)?.text ?? null;
  if (checks.categoryNow !== "Uncategorized" || checks.categoryProposed !== "Groceries") {
    failure(
      `Category row read "${checks.categoryNow} -> ${checks.categoryProposed}", expected "Uncategorized -> Groceries"`,
    );
  }

  const account = rowFor(resolved, "Account");
  checks.accountValue = account?.cells.at(-1)?.text ?? null;
  if (checks.accountValue !== "Capitec") {
    failure(`Account row read "${checks.accountValue}", expected "Capitec"`);
  }

  // The id is not gone, it is behind the label: every labelled cell keeps it.
  checks.labelledCells = resolved.rows
    .flatMap((row) => row.cells.map((cell) => ({ field: row.field, ...cell })))
    .filter((cell) => cell.title !== null);
  checks.labelledCellTitles = checks.labelledCells.map((cell) => cell.title);
  for (const id of [fixture.accountId, fixture.groceriesId]) {
    if (!checks.labelledCellTitles.includes(id)) failure(`no cell keeps ${id} in its tooltip`);
  }

  // Nothing readable is an id.
  checks.readableHoldsNoShortId = !SHORT_ID.test(resolved.readable);
  checks.readableHoldsNoSlugId = !SLUG_ID.test(resolved.readable);
  if (!checks.readableHoldsNoShortId) {
    failure(`readable text still holds a truncated id: ${resolved.readable.slice(0, 240)}`);
  }
  if (!checks.readableHoldsNoSlugId) {
    failure(`readable text still holds a slug id: ${resolved.readable.slice(0, 240)}`);
  }
  checks.readable = resolved.readable;

  // The collapsed exact payload is untouched and still carries the id the vault
  // will store, so the operator can always get back to the real value.
  let exact = null;
  try {
    exact = resolved.exactPayload ? JSON.parse(resolved.exactPayload) : null;
  } catch {
    failure("the exact proposal block did not parse as JSON");
  }
  checks.exactPayloadKeptId = resolved.exactPayload?.includes(fixture.groceriesId) ?? false;
  checks.exactPayloadUnchanged = JSON.stringify(exact) === JSON.stringify(fixture.resolved);
  if (!checks.exactPayloadKeptId) failure("the exact proposal dropped the relation id");
  if (!checks.exactPayloadUnchanged) failure("the card rewrote the body it was handed");

  checks.inboxWidth = resolved.inboxWidth;
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    fixture: "fixtures/decision-row.json",
    viewport: resolved.viewport,
    checks,
    raw,
    resolved,
  };

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "decision-body.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "decision-body.png"), image.toPNG());

  const rawCategoryRow = rowFor(raw, "Category");
  const table = resolved.rows
    .map((row) => `  ${row.field.padEnd(18)} ${row.cells.map((cell) => cell.text).join("  |  ")}`)
    .join("\n");
  console.log(
    `inbox ${resolved.inboxWidth}px  rows ${resolved.rows.length}  changed ${resolved.changedRows}`,
  );
  console.log(`as filed:  ${rawCategoryRow?.cells.map((cell) => cell.text).join("  |  ")}`);
  console.log(`as read:\n${table}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("decision-body rig timed out");
  app.exit(1);
}, 90_000);
