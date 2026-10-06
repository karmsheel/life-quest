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
 *  6. A page block and a mapping name their data by id too. Rendered as filed, a
 *     bound-table block reads "Finance · transactions", a metric bound to a
 *     column uuid reads "Sum · 8f3d2b41…", and a mapping's column cell is a
 *     truncated uuid.
 *  7. The read path's names reach those surfaces: "Transactions", "Sum ·
 *     Mileage", "Line · Distance", "Scenario 1", and the mapping's "Mileage".
 *  8. The ids are neither hidden nor lost: each block row and mapped-column cell
 *     keeps its raw id in its tooltip, and the exact payload is unchanged.
 *
 * NOT covered here: that the main process resolves those names in the first
 * place (that is `packages/vault-core/tests/decision-labels.test.ts` for row
 * writes and `decision-labels-page-mapping.test.ts` for pages and mappings, both
 * over a real vault), and the approve/reject round trip.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/decision-body.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const fixture = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures/decision-row.json"), "utf8"),
);
const targets = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures/decision-page-mapping.json"), "utf8"),
);

/** Everything an operator can read, minus the collapsed "Exact proposal". */
const READABLE = `(() => {
  const proposal = document.querySelector(".decision-proposal");
  const source = document.querySelector(".decision-source pre");
  let readable = "";
  if (proposal) {
    const clone = proposal.cloneNode(true);
    const sourceBlock = clone.querySelector(".decision-source");
    if (sourceBlock) sourceBlock.remove();
    readable = (clone.textContent || "").trim();
  }
  return { readable, exactPayload: source ? source.textContent : null };
})()`;

const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const read = ${READABLE};
  const rows = Array.from(document.querySelectorAll(".decision-fields tr")).map((tr) => ({
    field: text(tr.querySelector("th")),
    cells: Array.from(tr.querySelectorAll("td")).map((td) => ({
      text: text(td),
      title: td.querySelector("[title]") ? td.querySelector("[title]").getAttribute("title") : null
    }))
  }));
  const inbox = document.querySelector(".decisions-inbox");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    inboxWidth: inbox ? Math.round(inbox.getBoundingClientRect().width) : null,
    lead: text(document.querySelector(".decision-lead")),
    rows,
    changedRows: document.querySelectorAll(".decision-row--changed").length,
    unchangedSummary: text(document.querySelector(".decision-unchanged summary")) || null,
    readable: read.readable,
    exactPayload: read.exactPayload
  };
})()`;

/** The page card: one row per block, each row carrying the ids it stands for. */
const SAMPLE_BLOCKS = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const read = ${READABLE};
  const blocks = Array.from(document.querySelectorAll(".decision-block")).map((li) => ({
    kind: text(li.querySelector(".decision-block__kind")),
    detail: text(li.querySelector(".decision-block__detail")),
    title: li.getAttribute("title")
  }));
  const inbox = document.querySelector(".decisions-inbox");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    inboxWidth: inbox ? Math.round(inbox.getBoundingClientRect().width) : null,
    lead: text(document.querySelector(".decision-lead")),
    blocks,
    readable: read.readable,
    exactPayload: read.exactPayload
  };
})()`;

/** The mapping card: one row per incoming source column. */
const SAMPLE_MAPPING = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const read = ${READABLE};
  const rows = Array.from(document.querySelectorAll(".decision-fields tbody tr")).map((tr) => {
    const cells = Array.from(tr.querySelectorAll("td"));
    return {
      source: text(cells[0]),
      column: text(cells[1]),
      columnTitle: cells[1] ? cells[1].getAttribute("title") : null
    };
  });
  const inbox = document.querySelector(".decisions-inbox");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    inboxWidth: inbox ? Math.round(inbox.getBoundingClientRect().width) : null,
    lead: text(document.querySelector(".decision-lead")),
    rows,
    readable: read.readable,
    exactPayload: read.exactPayload
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

/**
 * Render one body, and return the card as the operator reads it.
 *
 * `previousCells` is the cell map the vault held before the write; the card
 * takes it as the JSON text it renders, so it is stringified here.
 */
async function render(win, target, body, previousCells, sampler = SAMPLE, name = "card") {
  const committed = await win.webContents.executeJavaScript(
    "window.decisionBodyCommits ?? 0",
  );
  const previous = previousCells ? JSON.stringify(previousCells, null, 2) : null;
  await win.webContents.executeJavaScript(
    `window.renderDecisionBody({ target: ${JSON.stringify(target)}, ` +
      `body: ${JSON.stringify(body)}, previous: ${JSON.stringify(previous)} })`,
  );
  await waitFor(win, `(window.decisionBodyCommits ?? 0) > ${committed}`, `${name} to commit`);
  return win.webContents.executeJavaScript(sampler);
}

/**
 * "47083ecb…" — the shortId the card falls back to for a raw id. No leading
 * word boundary: a mapped column's id follows its source name with no space.
 */
const SHORT_ID = /[0-9a-f]{8}…/;
/** "category-uncategorized" — a slug-shaped id, shown as prose when unmapped. */
const SLUG_ID = /\b[a-z]+-[a-z-]{4,}\b/;

const rowFor = (sample, field) => sample.rows.find((row) => row.field === field);

async function main() {
  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to (tokens.css, [data-theme="dark"]) so a
  // test run is not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
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
  const raw = await render(
    win,
    fixture.target,
    fixture.raw,
    fixture.raw.previousCells,
    SAMPLE,
    "row (as filed)",
  );
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
  const resolved = await render(
    win,
    fixture.target,
    fixture.resolved,
    fixture.resolved.previousCells,
    SAMPLE,
    "row (as read)",
  );

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

  // ── a page: every block names the database and columns it is bound to ─────
  const pageRaw = await render(
    win,
    targets.page.target,
    targets.page.raw,
    null,
    SAMPLE_BLOCKS,
    "page (as filed)",
  );
  checks.pageRaw = pageRaw.blocks.map((block) => block.detail);
  checks.pageRawShowsShortId = SHORT_ID.test(pageRaw.readable);
  if (!checks.pageRawShowsShortId) {
    failure("the page as filed no longer shows a column id — the before state is gone");
  }

  const page = await render(
    win,
    targets.page.target,
    targets.page.resolved,
    null,
    SAMPLE_BLOCKS,
    "page (as read)",
  );
  checks.pageBlocks = page.blocks;
  const wantPage = [
    { kind: "Table", detail: "Transactions", title: targets.page.ids.databaseId },
    { kind: "Metric", detail: "Sum · Mileage", title: targets.page.ids.mileageColumnId },
    { kind: "Chart", detail: "Line · Distance", title: targets.page.ids.distanceColumnId },
    { kind: "Scenario", detail: "Scenario 1", title: targets.page.ids.assumptionSetId },
    { kind: "Note", detail: "Top spend this month.", title: null },
  ];
  wantPage.forEach((want, index) => {
    const got = page.blocks[index];
    if (!got) {
      failure(`the page card rendered ${page.blocks.length} blocks, expected one per block`);
      return;
    }
    if (got.kind !== want.kind || got.detail !== want.detail) {
      failure(
        `page block ${index} read "${got.kind} ${got.detail}", expected "${want.kind} ${want.detail}"`,
      );
    }
    if (got.title !== want.title) {
      failure(
        `page block ${index} tooltip is ${JSON.stringify(got.title)}, expected ${JSON.stringify(want.title)}`,
      );
    }
  });
  checks.pageReadableHoldsNoShortId = !SHORT_ID.test(page.readable);
  if (!checks.pageReadableHoldsNoShortId) {
    failure(`the page card still shows a column id: ${page.readable.slice(0, 240)}`);
  }
  checks.pageExactPayloadUnchanged =
    JSON.stringify(page.exactPayload ? JSON.parse(page.exactPayload) : null) ===
    JSON.stringify(targets.page.resolved);
  if (!checks.pageExactPayloadUnchanged) failure("the page card rewrote the body it was handed");

  // ── a mapping: the database and every mapped column by name ──────────────
  const mappingRaw = await render(
    win,
    targets.mapping.target,
    targets.mapping.raw,
    null,
    SAMPLE_MAPPING,
    "mapping (as filed)",
  );
  checks.mappingRawLead = mappingRaw.lead;
  checks.mappingRawShowsShortId = SHORT_ID.test(mappingRaw.readable);
  if (!checks.mappingRawShowsShortId) {
    failure("the mapping as filed no longer shows a column id — the before state is gone");
  }

  const mapping = await render(
    win,
    targets.mapping.target,
    targets.mapping.resolved,
    null,
    SAMPLE_MAPPING,
    "mapping (as read)",
  );
  checks.mappingRows = mapping.rows;
  checks.mappingLead = mapping.lead;
  if (!mapping.lead.startsWith("Map incoming columns onto Transactions.")) {
    failure(`the mapping lead read "${mapping.lead}", expected the database name`);
  }
  const wantColumns = ["Date", "Mileage", "Unmapped"];
  const gotColumns = mapping.rows.map((row) => row.column);
  if (JSON.stringify(gotColumns) !== JSON.stringify(wantColumns)) {
    failure(`mapped columns read ${JSON.stringify(gotColumns)}, expected ${JSON.stringify(wantColumns)}`);
  }
  const odometer = mapping.rows.find((row) => row.source === "Odometer");
  if (odometer?.columnTitle !== targets.page.ids.mileageColumnId) {
    failure(
      `the mapped column tooltip is ${JSON.stringify(odometer?.columnTitle)}, expected the raw column id`,
    );
  }
  checks.mappingReadableHoldsNoShortId = !SHORT_ID.test(mapping.readable);
  if (!checks.mappingReadableHoldsNoShortId) {
    failure(`the mapping card still shows a column id: ${mapping.readable.slice(0, 240)}`);
  }
  checks.mappingExactPayloadUnchanged =
    JSON.stringify(mapping.exactPayload ? JSON.parse(mapping.exactPayload) : null) ===
    JSON.stringify(targets.mapping.resolved);
  if (!checks.mappingExactPayloadUnchanged) {
    failure("the mapping card rewrote the body it was handed");
  }

  checks.inboxWidth = resolved.inboxWidth;
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    fixture: ["fixtures/decision-row.json", "fixtures/decision-page-mapping.json"],
    viewport: resolved.viewport,
    checks,
    raw,
    resolved,
    pageRaw,
    page,
    mappingRaw,
    mapping,
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
  const blockLine = (blocks) =>
    blocks.map((block) => `${block.kind}: ${block.detail}`).join(" | ");
  console.log(
    `inbox ${resolved.inboxWidth}px  rows ${resolved.rows.length}  changed ${resolved.changedRows}`,
  );
  console.log(`as filed:  ${rawCategoryRow?.cells.map((cell) => cell.text).join("  |  ")}`);
  console.log(`as read:\n${table}`);
  console.log(`page  as filed:  ${blockLine(pageRaw.blocks)}`);
  console.log(`page  as read:   ${blockLine(page.blocks)}`);
  console.log(`map   as filed:  ${mappingRaw.lead}  [${mappingRaw.rows.map((r) => r.column).join(", ")}]`);
  console.log(`map   as read:   ${mapping.lead}  [${mapping.rows.map((r) => r.column).join(", ")}]`);
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
