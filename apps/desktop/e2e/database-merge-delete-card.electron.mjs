/**
 * Drives the real Decision card in a real Electron window and turns what the
 * card actually renders for a `delete-database` and a `merge-databases`
 * Decision into `e2e/artifacts/database-merge-delete-card.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`), or through the bench-safe wrapper:
 *
 *   node e2e/database-merge-delete-card.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact; the PNG is the card the operator would answer.
 *
 * What this rig claims, and the input that makes each claim falsifiable:
 *
 *  1. A delete_database Decision is a card, not JSON. The lead reads
 *     `Delete the database "Supplement log".` — so the operator knows a whole
 *     database is going, not a row — and the before-only table names the
 *     database and states the row count being deleted with it.
 *  2. A merge_databases Decision names both effects of one approval: the lead
 *     reads `Merge 3 databases into "Supplement log", then delete the 3
 *     sources.`, so approving "merge" cannot hide the deletion.
 *  3. Every source is on the card with its own row count, keyed by database id
 *     but labelled with the source's name (three sources here share the name
 *     `Supplement log` — that duplicate IS the drift being collapsed, so the id
 *     is the only unique key and stays reachable as the row's tooltip).
 *  4. The columns the merge adds to the target are listed, and the dedupe rule
 *     is stated: "Exact duplicate rows are skipped."
 *  5. Neither op falls through to `GenericBody`: the lead is not "Proposed
 *     change" and the card lists no raw body keys (`Fingerprint`, `Expected
 *     columns`, `Widened columns`, …).
 *  6. The renderer does not rewrite the body: the collapsed "Exact proposal"
 *     parses back deep-equal to the body the harness was handed, so the approve
 *     path still receives exactly what the engine filed.
 *  7. The card keeps the 52rem inbox width it is given, so this is the column
 *     the operator reads rather than an unconstrained harness layout.
 *
 * The rig waits on `window.decisionBodyCommits` (an effect, i.e. a React commit)
 * — never on requestAnimationFrame: a hidden Electron window suspends rAF, so a
 * frame-based wait never returns and the rig hangs instead of failing.
 *
 * NOT covered here: the engine's proposal/apply behaviour (that is
 * `tests/database-merge-delete-e2e.test.ts`), and that the main process resolves
 * the names first place — these bodies already carry every name the card shows.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/decision-body.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const deleteFixture = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures/decision-database-delete.json"), "utf8"),
);
const mergeFixture = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures/decision-database-merge.json"), "utf8"),
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

/**
 * A database lifecycle card: a lead, one before-only facts table, and the
 * paragraphs beside it (the delete consequence; the merge's added columns and
 * dedupe rule). The exact proposal is read separately, so the readable text is
 * only what the operator sees.
 */
const SAMPLE_CARD = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const read = ${READABLE};
  const proposal = document.querySelector(".decision-proposal");
  const leads = Array.from(document.querySelectorAll(".decision-proposal .decision-lead")).map(text);
  const rows = Array.from(document.querySelectorAll(".decision-proposal table.decision-fields tbody tr")).map((tr) => {
    const th = tr.querySelector("th");
    return {
      field: text(th),
      fieldTitle: th ? th.getAttribute("title") : null,
      cells: Array.from(tr.querySelectorAll("td")).map((td) => ({
        text: text(td),
        title: td.querySelector("[title]") ? td.querySelector("[title]").getAttribute("title") : null
      }))
    };
  });
  const inbox = document.querySelector(".decisions-inbox");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    inboxWidth: inbox ? Math.round(inbox.getBoundingClientRect().width) : null,
    hasProposal: !!proposal,
    hasExactProposal: !!document.querySelector(".decision-proposal .decision-source"),
    lead: leads[0] ?? "",
    leads,
    tableCount: document.querySelectorAll(".decision-proposal table.decision-fields").length,
    columns: Array.from(
      document.querySelectorAll(".decision-proposal table.decision-fields thead th"),
    ).map(text),
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

/** Render one filed body on the shipped card and return what the operator reads. */
async function render(win, target, body, name) {
  const committed = await win.webContents.executeJavaScript("window.decisionBodyCommits ?? 0");
  await win.webContents.executeJavaScript(
    `window.renderDecisionBody({ target: ${JSON.stringify(target)}, ` +
      `body: ${JSON.stringify(body)}, previous: null })`,
  );
  await waitFor(win, `(window.decisionBodyCommits ?? 0) > ${committed}`, `${name} to commit`);
  return win.webContents.executeJavaScript(SAMPLE_CARD);
}

/** The exact payload as a value, or null when the block is missing/unparseable. */
function exactBody(sample) {
  try {
    return sample.exactPayload ? JSON.parse(sample.exactPayload) : null;
  } catch {
    return undefined;
  }
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** GenericBody's lead for a body with no `type` field: "Proposed change". */
const GENERIC_LEAD = "Proposed change";

/** Body keys GenericBody would dump as fields; the card for these ops must not. */
const RAW_BODY_FIELDS = ["Fingerprint", "Expected columns", "Widened columns", "Row count"];

function checkNoGenericFallback(name, sample) {
  if (!sample.hasProposal) {
    failure(`${name}: the card rendered no structured proposal`);
  }
  if (sample.lead === GENERIC_LEAD || sample.lead.startsWith(`${GENERIC_LEAD}.`)) {
    failure(`${name}: the card fell through to GenericBody ("${sample.lead}")`);
  }
  const dumped = RAW_BODY_FIELDS.filter(
    (field) => sample.rows.some((row) => row.field === field) || sample.readable.includes(field),
  );
  if (dumped.length > 0) {
    failure(`${name}: the card dumped raw body keys as fields: ${dumped.join(", ")}`);
  }
}

function checkExactPayload(name, sample, body) {
  const exact = exactBody(sample);
  if (!sample.hasExactProposal) {
    failure(`${name}: the card has no collapsed exact proposal`);
  }
  if (exact === undefined) {
    failure(`${name}: the exact proposal block did not parse as JSON`);
    return false;
  }
  return sameJson(exact, body);
}

async function main() {
  // Paint the harness in the theme the app itself defaults to (tokens.css,
  // [data-theme="dark"]) so a test run is not a white sheet on the display.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
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

  // ── delete a database: one card, its rows going with it ──────────────────
  const deleteCard = await render(
    win,
    deleteFixture.target,
    deleteFixture.body,
    "delete-database card",
  );
  const wantDeleteLead = `Delete the database "${deleteFixture.body.databaseName}".`;
  checks.deleteLead = deleteCard.lead;
  checks.deleteLeadMatchesContract = deleteCard.lead === wantDeleteLead;
  if (!checks.deleteLeadMatchesContract) {
    failure(`delete lead read "${deleteCard.lead}", expected "${wantDeleteLead}"`);
  }

  // The card is a before-only facts table: a delete has no after state.
  checks.deleteColumns = deleteCard.columns;
  if (!sameJson(deleteCard.columns, ["Field", "Now"])) {
    failure(
      `delete card columns read ${JSON.stringify(deleteCard.columns)}, expected a before-only table`,
    );
  }
  const deleteField = (field) => deleteCard.rows.find((row) => row.field === field);
  const deleteName = deleteField("Name");
  const deleteRows = deleteField("Rows");
  checks.deleteName = deleteName?.cells[0]?.text ?? null;
  checks.deleteRowCount = deleteRows?.cells[0]?.text ?? null;
  if (checks.deleteName !== deleteFixture.body.databaseName) {
    failure(
      `delete card name read ${JSON.stringify(checks.deleteName)}, expected ${JSON.stringify(deleteFixture.body.databaseName)}`,
    );
  }
  if (checks.deleteRowCount !== deleteFixture.body.rowCount.toLocaleString()) {
    failure(
      `delete card row count read ${JSON.stringify(checks.deleteRowCount)}, expected ${deleteFixture.body.rowCount}`,
    );
  }
  // The consequence is stated in words beside the table: the rows go with it,
  // and the operator cannot undo it. Without this the card invites "delete the
  // empty table" and hides that a ledger goes too.
  checks.deleteConsequence = deleteCard.leads.find((lead) => /deleted with it/i.test(lead)) ?? null;
  if (!checks.deleteConsequence) {
    failure(`delete card states no consequence for the rows: ${JSON.stringify(deleteCard.leads)}`);
  } else if (!/cannot be undone/i.test(checks.deleteConsequence)) {
    failure(`delete card does not say the deletion cannot be undone: "${checks.deleteConsequence}"`);
  }
  checkNoGenericFallback("delete card", deleteCard);
  checks.deleteExactPayloadUnchanged = checkExactPayload(
    "delete card",
    deleteCard,
    deleteFixture.body,
  );

  // ── merge databases: both effects, every source, and the dedupe rule ─────
  const mergeCard = await render(
    win,
    mergeFixture.target,
    mergeFixture.body,
    "merge-databases card",
  );
  const sources = mergeFixture.body.sources;
  const wantMergeLead =
    `Merge ${sources.length} databases into "${mergeFixture.body.databaseName}", ` +
    `then delete the ${sources.length} sources.`;
  checks.mergeLead = mergeCard.lead;
  checks.mergeLeadMatchesContract = mergeCard.lead === wantMergeLead;
  if (!checks.mergeLeadMatchesContract) {
    failure(`merge lead read "${mergeCard.lead}", expected "${wantMergeLead}"`);
  }

  checks.mergeColumns = mergeCard.columns;
  if (!sameJson(mergeCard.columns, ["Field", "Now"])) {
    failure(
      `merge card columns read ${JSON.stringify(mergeCard.columns)}, expected a before-only table`,
    );
  }
  checks.mergeSourceCount = mergeCard.rows.length;
  if (mergeCard.rows.length !== sources.length) {
    failure(
      `merge card rendered ${mergeCard.rows.length} source rows, expected one per source (${sources.length})`,
    );
  }
  checks.mergeSources = mergeCard.rows.map((row) => ({
    field: row.field,
    fieldTitle: row.fieldTitle,
    cell: row.cells[0]?.text ?? null,
  }));
  sources.forEach((source, index) => {
    const row = mergeCard.rows[index];
    if (!row) {
      failure(`merge card is missing source ${index + 1} (${source.name})`);
      return;
    }
    // Several sources may share a name — that duplicate is what the merge
    // collapses — so the row is keyed by id and labelled by the source's name.
    if (row.field !== source.name) {
      failure(
        `merge source ${index + 1} is labelled ${JSON.stringify(row.field)}, expected ${JSON.stringify(source.name)}`,
      );
    }
    if (row.fieldTitle !== source.databaseId) {
      failure(
        `merge source ${index + 1} does not keep its raw id (tooltip ${JSON.stringify(row.fieldTitle)}, expected ${JSON.stringify(source.databaseId)})`,
      );
    }
    const wantCount = `${source.rowCount} ${source.rowCount === 1 ? "row" : "rows"}`;
    if ((row.cells[0]?.text ?? null) !== wantCount) {
      failure(
        `merge source ${index + 1} count read ${JSON.stringify(row.cells[0]?.text ?? null)}, expected ${JSON.stringify(wantCount)}`,
      );
    }
  });

  // The columns the merge adds are named on the card: the operator approves a
  // schema change as well as a row move.
  const addedColumns = mergeFixture.body.newColumns.map((column) => column.name);
  checks.mergeAddedColumnsSentence =
    mergeCard.leads.find((lead) => /^Add the columns? /.test(lead)) ?? null;
  if (!checks.mergeAddedColumnsSentence) {
    failure(`merge card lists no added columns: ${JSON.stringify(mergeCard.leads)}`);
  } else {
    for (const name of addedColumns) {
      if (!checks.mergeAddedColumnsSentence.includes(`"${name}"`)) {
        failure(`merge card does not name the added column "${name}"`);
      }
    }
  }
  // The dedupe rule is a promise about rows the operator will never see inserted.
  checks.mergeDedupeSentence =
    mergeCard.leads.find((lead) => /duplicate rows/i.test(lead)) ?? null;
  if (mergeFixture.body.dedupe !== false && checks.mergeDedupeSentence !== "Exact duplicate rows are skipped.") {
    failure(
      `merge card dedupe sentence read ${JSON.stringify(checks.mergeDedupeSentence)}, expected "Exact duplicate rows are skipped."`,
    );
  }
  checkNoGenericFallback("merge card", mergeCard);
  checks.mergeExactPayloadUnchanged = checkExactPayload(
    "merge card",
    mergeCard,
    mergeFixture.body,
  );

  // Both cards keep the width the inbox gives them (52rem), so this is the
  // column the operator reads, not an unconstrained harness layout.
  checks.inboxWidth = mergeCard.inboxWidth ?? deleteCard.inboxWidth;
  if (checks.inboxWidth === null || checks.inboxWidth > 832) {
    failure(`inbox rendered ${checks.inboxWidth}px wide, wider than the 52rem column`);
  }

  checks.consoleErrors = consoleErrors;

  fs.mkdirSync(artifactsDir, { recursive: true });
  const screenshotPath = path.join(artifactsDir, "database-merge-delete-card.png");

  // Last render is the merge card: it is the richest state and the picture the
  // handover links, showing sources, added columns and the dedupe rule at once.
  const image = await win.webContents.capturePage();
  fs.writeFileSync(screenshotPath, image.toPNG());
  checks.screenshotBytes = fs.statSync(screenshotPath).size;
  if (checks.screenshotBytes < 5_000) {
    failure(`screenshot is only ${checks.screenshotBytes} bytes — the card probably did not paint`);
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    fixture: [
      "fixtures/decision-database-delete.json",
      "fixtures/decision-database-merge.json",
    ],
    screenshot: "artifacts/database-merge-delete-card.png",
    viewport: mergeCard.viewport,
    checks,
    deleteCard,
    mergeCard,
  };
  fs.writeFileSync(
    path.join(artifactsDir, "database-merge-delete-card.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const rowLine = (sample) =>
    sample.rows
      .map((row) => `  ${row.field.padEnd(18)} ${row.cells.map((cell) => cell.text).join("  |  ")}`)
      .join("\n");
  console.log(`delete lead: ${deleteCard.lead}`);
  console.log(rowLine(deleteCard));
  console.log(`delete leads: ${JSON.stringify(deleteCard.leads)}`);
  console.log(`merge lead:  ${mergeCard.lead}`);
  console.log(rowLine(mergeCard));
  console.log(`merge leads: ${JSON.stringify(mergeCard.leads)}`);
  console.log(`screenshot: ${screenshotPath} (${checks.screenshotBytes} bytes)`);
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
  console.error("database-merge-delete card rig timed out");
  app.exit(1);
}, 90_000);
