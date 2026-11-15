import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PAYEE_SANITISER_VERSION,
  acceptIngestRows,
  applyFinanceKitInstall,
  captureUtterance,
  correctCapture,
  createVault,
  executeDatabaseTool,
  getFinanceKitSettings,
  ingestFile,
  ingestFingerprint,
  insertRows,
  linkDatabaseAdapter,
  listDecisions,
  listIngestRows,
  listRows,
  normaliseFinancePayeeHistory,
  readLog,
  resolveDecision,
  sanitisePayee,
  syncDatabase,
  syncLinkedDatabases,
  unlockDomain,
  upsertRow,
  vaultPaths,
} from "@lifequest/vault-core";
import type { AdapterSecretStore, AdapterTransport, DatabaseRow } from "@lifequest/vault-core";

/**
 * Payee hygiene, end to end: what the ledger stores as a payee, what it keeps in
 * notes, and what the one-time history repair does to 194 rows of pollution.
 *
 * WHY THIS FILE EXISTS
 *
 * The payee of a captured or imported transaction was derived by deleting the
 * amount from the operator's sentence, so the field kept the date, the account
 * name, the category words and filler ("spent on"). Statement imports wrote
 * whole row descriptions into payee. `notes` was null on nearly every row, so
 * the polluted payee was the only surviving copy of what the operator said.
 * There was no sanitiser, no verbatim-notes rule, no keyword categoriser and no
 * write-time lint, and history could only be repaired row-by-row through
 * Decisions — 194 rows cost 303 approvals.
 *
 * Every assertion below is made through the public vault-core API against a
 * real vault on a temp directory, and every "clean" claim is re-read from the
 * vault's own `domain.sqlite`, because the defect was a field that looked
 * healthy on the receipt while holding the wrong text on disk.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN BEFORE THE CODE
 *
 *   1. The sanitiser removes the amount twice and the row agrees with itself,
 *      but a date/account/category/filler token survives somewhere in the
 *      stored payee. The test therefore checks the stored string, and the
 *      migration checks EVERY repaired row against those token classes rather
 *      than trusting the migration's own counts.
 *   2. `notes` is set by the test's own input rather than by the write path:
 *      the manual upsert and the imported description are asserted on disk, and
 *      a row that already had notes must keep them.
 *   3. The verbatim sentence is stored as the payee and the clean merchant as
 *      notes — the two fields swapped. Both are asserted separately.
 *   4. The migration changes 194 rows by filing Decisions, which is the defect
 *      being fixed (it used to cost 303 approvals). `listDecisions()` must be
 *      empty and the marker must be the only registry trace.
 *   5. The migration re-runs and rewrites rows on every vault open. The second
 *      call must write nothing: same cells, same `updatedAt`, `changed: 0`.
 *   6. The history repair is claimed to have scanned 194 rows but only touched
 *      the ones whose payee contains a date. Null-notes rows are asserted to
 *      carry their raw payee afterwards, and existing notes to be untouched.
 *   7. A CSV import bypasses the write funnel (`acceptIngestRows` writes rows
 *      directly) so the description lands in payee uncleaned. The accepted row
 *      is read back after `acceptIngestRows`, not from the staged batch.
 *   8. A mapping is created through the Decision queue — the import test seeds
 *      the mapping JSON itself, so a mapping Decision means the path under test
 *      was not the one that ran.
 *   9. The capture categoriser is asserted from the receipt text only. The row's
 *      category relation cell is read from disk as well.
 *  10. A kit-less or history-less vault errors instead of no-opping. Such a
 *      vault must answer `ran: false` and write nothing.
 *  11. The history repair fixes the row but leaves the linked adapter's sync
 *      baseline holding the polluted cells, so the next sync reads the repair
 *      as a local edit and pushes it over the remote row. S1 seeds that exact
 *      baseline, runs the repair, then performs a real sync with a recording
 *      fake transport: zero bytes may be pushed.
 *  12. The agent's `upsert_row` update files a Decision whose body still holds
 *      the polluted payee, so approving it re-writes the pollution. S2 parses
 *      the pending body before approving and reads the row after.
 *  13. A casing-only repair ("woolworths" → "Woolworths") changes what the
 *      operator typed but carries no lint class, so it could silently skip the
 *      life-log line. The test asserts one event, with the row named in the
 *      summary.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`) with no
 * Electron: every path under test belongs to vault-core. The repeatable artifact
 * is `e2e/artifacts/finance-payee.json`, written only by a run whose every
 * assertion held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/finance-payee.json");

const ACTOR = { type: "user" } as const;

/** The date the capture sentences are parsed against. */
const CAPTURE_TODAY = "2026-10-01";

/** Warnings the write funnel reports, by the sanitiser issue they come from. */
const WARNING_TEXT = {
  date: "payee contained a date",
  "account-name": "payee contained an account name",
  "category-name": "payee contained a category name",
  filler: "payee contained filler text",
} as const;

type SanitiserCase = {
  raw: string;
  accountNames: string[];
  categoryNames: string[];
  payee: string | null;
  issues: string[];
};

/** The contract's table, verbatim. */
const SANITISER_CASES: SanitiserCase[] = [
  {
    raw: "9/28/26 spent on petrol at Engen",
    accountNames: ["Capitec"],
    categoryNames: ["Fuel", "Meat", "Food & Drink"],
    payee: "Petrol at Engen",
    issues: ["date", "filler"],
  },
  {
    raw: "Capitec",
    accountNames: ["Capitec"],
    categoryNames: [],
    payee: null,
    issues: ["account-name"],
  },
  {
    raw: "Woolworths Tech/SaaS",
    accountNames: [],
    categoryNames: ["Tech/SaaS"],
    payee: "Woolworths",
    issues: ["category-name"],
  },
  {
    raw: "2026-11-06 woolworths",
    accountNames: [],
    categoryNames: [],
    payee: "Woolworths",
    issues: ["date"],
  },
  {
    raw: "KFC",
    accountNames: [],
    categoryNames: [],
    payee: "KFC",
    issues: [],
  },
  {
    raw: "SaaS subscription",
    accountNames: [],
    categoryNames: [],
    payee: "SaaS Subscription",
    issues: [],
  },
  {
    raw: "spent on",
    accountNames: [],
    categoryNames: [],
    payee: null,
    issues: ["filler"],
  },
];

/** Filler phrases the contract says a stored payee must never keep. */
const FILLER_PHRASES = [
  "spent on",
  "spent at",
  "received into",
  "received from",
  "paid to",
  "paid from",
  "payment to",
  "purchase at",
  "purchased at",
  "bought at",
  "bought from",
  "transfer to",
  "transfer from",
  "deposit into",
  "credited to",
  "debited from",
  "spent",
  "received",
  "paid",
  "expense",
  "transaction",
  "purchase",
  "deposit",
];

const DATE_TOKEN =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/;

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole-word matcher for one literal name or phrase. */
function wordRegex(value: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeLiteral(value)}(?![\\p{L}\\p{N}])`, "iu");
}

/** Everything wrong with a stored payee, judged by the contract, not by the code. */
function payeeProblems(
  payee: unknown,
  accountNames: string[],
  categoryNames: string[],
): string[] {
  const problems: string[] = [];
  if (typeof payee !== "string" || !payee.trim()) {
    problems.push(`payee is ${JSON.stringify(payee)}`);
    return problems;
  }
  if (DATE_TOKEN.test(payee)) problems.push(`payee keeps a date token: ${payee}`);
  for (const name of [...accountNames, ...categoryNames]) {
    if (wordRegex(name).test(payee)) problems.push(`payee keeps the name '${name}': ${payee}`);
  }
  for (const phrase of FILLER_PHRASES) {
    if (wordRegex(phrase).test(payee)) problems.push(`payee keeps filler '${phrase}': ${payee}`);
  }
  return problems;
}

function valueOf<T>(
  res: { ok: true; value: T } | { ok: false; error: string },
  what: string,
): T {
  if (!res.ok) throw new Error(`${what} failed: ${res.error}`);
  return res.value;
}

async function transactionRows(root: string): Promise<DatabaseRow[]> {
  return valueOf(await listRows(root, "financial", "finance:transactions"), "listRows(transactions)");
}

function rowById(rows: DatabaseRow[], id: string): DatabaseRow {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`transaction row ${id} is not in the vault`);
  return row;
}

function cellsOf(row: DatabaseRow): Record<string, unknown> {
  return row.cells;
}

/** An in-memory AdapterSecretStore, so the link/sync path runs with a real secret. */
function fakeSecretStore(): AdapterSecretStore {
  const secrets = new Map<string, string>();
  return {
    put: async (bindingId, secret) => {
      secrets.set(bindingId, secret);
    },
    get: async (bindingId) => secrets.get(bindingId) ?? null,
    delete: async (bindingId) => {
      secrets.delete(bindingId);
    },
  };
}

/** A tool reply that failed, raised as an error instead of being read as data. */
function toolOk(reply: Record<string, unknown>, what: string): Record<string, unknown> {
  const error = reply.error as { code?: string; message?: string } | undefined;
  if (error) throw new Error(`${what} failed: ${error.code ?? "ERROR"} ${error.message ?? ""}`);
  return reply;
}

function sortedWarnings(value: unknown): string[] {
  return Array.isArray(value) ? [...(value as string[])].sort() : [];
}

async function capture(root: string, text: string, threadId: string) {
  const out = valueOf(
    await captureUtterance(root, { text, today: CAPTURE_TODAY, threadId, actor: ACTOR }),
    `captureUtterance(${JSON.stringify(text)})`,
  );
  if (!out.posted) {
    throw new Error(`captureUtterance(${JSON.stringify(text)}) asked '${out.ask}' instead of posting`);
  }
  return out;
}

/** Seed the finance kit's reference rows the way the app does: through the vault API. */
async function seedFinanceReference(root: string): Promise<{
  accountId: string;
  categories: { fuel: string; meat: string; foodDrink: string };
}> {
  const accountId = "account-capitec";
  valueOf(
    await upsertRow(root, "financial", "finance:accounts", {
      id: accountId,
      cells: {
        name: "Capitec",
        type: "checking",
        currency: "ZAR",
        opening_balance: 0,
        opening_as_of: "2026-09-01",
      },
    }),
    "seed Capitec account",
  );
  const categories = { fuel: "category-fuel", meat: "category-meat", foodDrink: "category-food-drink" };
  for (const [id, name] of [
    [categories.fuel, "Fuel"],
    [categories.meat, "Meat"],
    [categories.foodDrink, "Food & Drink"],
  ] as const) {
    valueOf(
      await upsertRow(root, "financial", "finance:categories", { id, cells: { name } }),
      `seed category ${name}`,
    );
  }
  return { accountId, categories };
}

describe("finance payee hygiene e2e", () => {
  it("sanitises every write path and repairs 194 rows of history without a Decision", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-payee-"));
    const root = path.join(workDir, "vault");
    const artifact: Record<string, unknown> = {};
    const checks: Record<string, unknown> = {};

    try {
      // ── the sanitiser is the contract's own table ────────────────────────
      assert.equal(PAYEE_SANITISER_VERSION, 1, "the sanitiser version is not 1");
      const sanitiserResults = SANITISER_CASES.map((c) => {
        const result = sanitisePayee({
          raw: c.raw,
          accountNames: c.accountNames,
          categoryNames: c.categoryNames,
        });
        assert.equal(
          result.payee,
          c.payee,
          `sanitisePayee(${JSON.stringify(c.raw)}).payee was ${JSON.stringify(result.payee)}`,
        );
        assert.deepEqual(
          result.issues,
          c.issues,
          `sanitisePayee(${JSON.stringify(c.raw)}).issues was ${JSON.stringify(result.issues)}`,
        );
        assert.equal(
          result.flagged,
          c.issues.length > 0,
          `sanitisePayee(${JSON.stringify(c.raw)}).flagged disagrees with its issues`,
        );
        return {
          raw: c.raw,
          accountNames: c.accountNames,
          categoryNames: c.categoryNames,
          payee: result.payee,
          issues: result.issues,
          flagged: result.flagged,
        };
      });
      // Casing-only repairs and settled edge punctuation still change what the
      // operator typed, and the rule is idempotent: running it again on its own
      // answer changes nothing.
      const casingOnly = sanitisePayee({ raw: "woolworths", accountNames: [], categoryNames: [] });
      assert.equal(casingOnly.payee, "Woolworths", "a casing-only payee was not title-cased");
      assert.deepEqual(casingOnly.issues, [], "a casing-only repair raised lint issues");
      assert.equal(casingOnly.flagged, false, "a casing-only repair was flagged");

      const edgeArticle = sanitisePayee({ raw: "- the butcher", accountNames: [], categoryNames: [] });
      assert.equal(edgeArticle.payee, "Butcher", `'- the butcher' settled to ${JSON.stringify(edgeArticle.payee)}`);
      const settledAgain = sanitisePayee({
        raw: edgeArticle.payee,
        accountNames: [],
        categoryNames: [],
      });
      assert.equal(
        settledAgain.payee,
        edgeArticle.payee,
        `the sanitiser is not idempotent: ${JSON.stringify(edgeArticle.payee)} → ${JSON.stringify(settledAgain.payee)}`,
      );
      assert.deepEqual(settledAgain.issues, [], "re-sanitising a settled payee found issues");

      artifact.sanitiser = {
        version: PAYEE_SANITISER_VERSION,
        cases: sanitiserResults,
        edgeCases: {
          casingOnly: { raw: "woolworths", result: casingOnly },
          edgeArticle: { raw: "- the butcher", result: edgeArticle, secondPass: settledAgain },
        },
      };

      valueOf(await createVault(root, "E2E"), "createVault");
      valueOf(await unlockDomain(root, "financial"), "unlockDomain(financial)");
      valueOf(await applyFinanceKitInstall(root), "applyFinanceKitInstall");
      const { accountId, categories } = await seedFinanceReference(root);

      // ── chat capture: date parsed, keyword category, verbatim notes ──────
      const CAPTURE_SENTENCE = "9/28/26 spent on petrol at Engen R450 from Capitec";
      const captured = await capture(root, CAPTURE_SENTENCE, "payee-thread-petrol");
      assert.equal(captured.amount, -450, `the captured amount was ${captured.amount}`);
      assert.equal(captured.date, "2026-09-28", `the captured date was ${captured.date}`);
      assert.equal(captured.payee, "Petrol at Engen", `the receipt payee was ${JSON.stringify(captured.payee)}`);
      assert.equal(captured.categoryName, "Fuel", `the captured category was ${captured.categoryName}`);
      assert.match(
        captured.receipt,
        /Petrol at Engen/,
        `the receipt does not show the normalised payee: ${captured.receipt}`,
      );

      const capturedRow = rowById(await transactionRows(root), captured.rowId);
      const capturedCells = cellsOf(capturedRow);
      assert.equal(capturedCells.date, "2026-09-28", `the stored date was ${JSON.stringify(capturedCells.date)}`);
      assert.equal(capturedCells.amount, -450, `the stored amount was ${JSON.stringify(capturedCells.amount)}`);
      assert.equal(capturedCells.payee, "Petrol at Engen", `the stored payee was ${JSON.stringify(capturedCells.payee)}`);
      assert.equal(capturedCells.category, categories.fuel, "the stored category is not Fuel");
      assert.equal(capturedCells.account, accountId, "the stored account is not Capitec");
      assert.equal(
        capturedCells.notes,
        CAPTURE_SENTENCE,
        `the stored notes are not the verbatim sentence: ${JSON.stringify(capturedCells.notes)}`,
      );
      checks.capture = { sentence: CAPTURE_SENTENCE, outcome: captured, row: capturedCells };

      // Keyword rules resolve against the categories the vault actually has.
      const butcher = await capture(root, "R120 at butcher", "payee-thread-butcher");
      assert.equal(butcher.categoryName, "Meat", `'butcher' was categorised as ${butcher.categoryName}`);
      assert.equal(butcher.payee, "Butcher", `'butcher' stored the payee ${JSON.stringify(butcher.payee)}`);
      const butcherRow = rowById(await transactionRows(root), butcher.rowId);
      assert.equal(butcherRow.cells.category, categories.meat, "the butcher row's category relation is not Meat");

      // "Food" is only a rule name; the vault's category is "Food & Drink".
      const coffee = await capture(root, "R45 coffee", "payee-thread-coffee");
      assert.equal(
        coffee.categoryName,
        "Food & Drink",
        `'coffee' was categorised as ${coffee.categoryName}, expected the Food prefix to reach Food & Drink`,
      );
      assert.equal(coffee.date, CAPTURE_TODAY, `an undated capture stored ${coffee.date}`);
      const coffeeRow = rowById(await transactionRows(root), coffee.rowId);
      assert.equal(coffeeRow.cells.category, categories.foodDrink, "the coffee row's category relation is not Food & Drink");

      // An explicitly named category wins over a keyword rule.
      const explicit = await capture(root, "R150 butcher Food & Drink", "payee-thread-explicit");
      assert.equal(
        explicit.categoryName,
        "Food & Drink",
        `an explicitly named category lost to a keyword rule: ${explicit.categoryName}`,
      );
      checks.keywordCategories = {
        butcher: { sentence: "R120 at butcher", category: butcher.categoryName, payee: butcher.payee },
        coffee: { sentence: "R45 coffee", category: coffee.categoryName, payee: coffee.payee, date: coffee.date },
        explicit: { sentence: "R150 butcher Food & Drink", category: explicit.categoryName, payee: explicit.payee },
      };

      // ── a correction re-parses the same row, keeping the new wording ─────
      const rowsBeforeCorrection = await transactionRows(root);
      const CORRECTION_SENTENCE = "9/28/26 spent on petrol at Shell from Capitec R480";
      const corrected = valueOf(
        await correctCapture(root, {
          text: CORRECTION_SENTENCE,
          today: CAPTURE_TODAY,
          threadId: "payee-thread-petrol",
          actor: ACTOR,
        }),
        "correctCapture",
      );
      if (!corrected.posted) throw new Error(`correctCapture asked '${corrected.ask}'`);
      assert.equal(corrected.rowId, captured.rowId, "the correction minted a new row");
      assert.equal(corrected.payee, "Petrol at Shell", `the corrected payee was ${JSON.stringify(corrected.payee)}`);
      const rowsAfterCorrection = await transactionRows(root);
      assert.equal(
        rowsAfterCorrection.length,
        rowsBeforeCorrection.length,
        "the correction added or removed a row instead of re-parsing the captured one",
      );
      const correctedCells = cellsOf(rowById(rowsAfterCorrection, captured.rowId));
      assert.equal(correctedCells.payee, "Petrol at Shell", `the corrected stored payee was ${JSON.stringify(correctedCells.payee)}`);
      assert.equal(correctedCells.amount, -480, `the corrected stored amount was ${JSON.stringify(correctedCells.amount)}`);
      assert.equal(
        correctedCells.notes,
        CORRECTION_SENTENCE,
        `the corrected notes are not the new sentence: ${JSON.stringify(correctedCells.notes)}`,
      );
      checks.correction = {
        sentence: CORRECTION_SENTENCE,
        outcome: corrected,
        row: correctedCells,
        transactionCount: { before: rowsBeforeCorrection.length, after: rowsAfterCorrection.length },
      };

      // ── a manual add is linted, notes keep the raw payee, one log line ───
      const normalisedEventsBefore = valueOf(await readLog(root), "readLog").filter(
        (e) => e.type === "finance.payee.normalised",
      ).length;
      const MANUAL_PAYEE = "9/28/26 spent on Capitec petrol Fuel";
      const manual = valueOf(
        await upsertRow(root, "financial", "finance:transactions", {
          id: "row-manual-payee",
          cells: {
            date: "2026-10-02",
            amount: -250,
            account: accountId,
            category: categories.fuel,
            payee: MANUAL_PAYEE,
          },
        }),
        "manual upsertRow",
      );
      assert.equal(manual.cells.payee, "Petrol", `the manual row stored the payee ${JSON.stringify(manual.cells.payee)}`);
      assert.equal(
        manual.cells.notes,
        MANUAL_PAYEE,
        `the manual row did not keep the raw payee in notes: ${JSON.stringify(manual.cells.notes)}`,
      );
      const manualWarnings = [...(manual.warnings ?? [])].sort();
      const expectedManualWarnings = [
        WARNING_TEXT["account-name"],
        WARNING_TEXT["category-name"],
        WARNING_TEXT.date,
        WARNING_TEXT.filler,
      ].sort();
      assert.deepEqual(
        manualWarnings,
        expectedManualWarnings,
        `the manual row's warnings were ${JSON.stringify(manual.warnings)}`,
      );

      const storedManual = cellsOf(rowById(await transactionRows(root), "row-manual-payee"));
      assert.deepEqual(storedManual, manual.cells, "the manual row on disk does not match what the write returned");

      const logAfterManual = valueOf(await readLog(root), "readLog");
      const normalisedEventsAfter = logAfterManual.filter((e) => e.type === "finance.payee.normalised");
      assert.equal(
        normalisedEventsAfter.length,
        normalisedEventsBefore + 1,
        "a normalised payee did not append exactly one finance.payee.normalised event",
      );
      const manualEvent = normalisedEventsAfter.find(
        (e) => (e.payload as Record<string, unknown> | null)?.rowId === "row-manual-payee",
      );
      if (!manualEvent) throw new Error("the manual write's life-log event does not name the row");
      assert.ok(
        manualEvent.summary.includes(MANUAL_PAYEE),
        `the log summary does not carry the before text: ${manualEvent.summary}`,
      );
      assert.ok(
        manualEvent.summary.includes("Petrol"),
        `the log summary does not carry the after text: ${manualEvent.summary}`,
      );
      assert.ok(
        manualEvent.summary.startsWith("Normalised payee for row-manual-payee:"),
        `the log summary does not name the row: ${manualEvent.summary}`,
      );
      checks.manualUpsert = {
        inputPayee: MANUAL_PAYEE,
        before: { payee: MANUAL_PAYEE, notes: null },
        after: storedManual,
        warnings: manual.warnings ?? [],
        logEvent: { type: manualEvent.type, summary: manualEvent.summary, payload: manualEvent.payload },
      };

      // ── a batch insert is linted per row; a clean row is untouched ───────
      const BATCH_POLLUTED = "2026-11-06 Woolworths Capitec Fuel";
      const batch = valueOf(
        await insertRows(root, "financial", "finance:transactions", [
          {
            id: "row-batch-polluted",
            cells: {
              date: "2026-11-06",
              amount: -88,
              account: accountId,
              category: categories.fuel,
              payee: BATCH_POLLUTED,
            },
          },
          {
            id: "row-batch-clean",
            cells: {
              date: "2026-11-07",
              amount: -12,
              account: accountId,
              category: categories.fuel,
              payee: "Woolworths",
            },
          },
        ]),
        "insertRows",
      );
      assert.deepEqual(batch.ids, ["row-batch-polluted", "row-batch-clean"], "the batch ids changed");
      const batchWarnings = [...(batch.warnings ?? [])].sort();
      assert.deepEqual(
        batchWarnings,
        [WARNING_TEXT.date, WARNING_TEXT["account-name"], WARNING_TEXT["category-name"]].sort(),
        `the batch warnings were ${JSON.stringify(batch.warnings)}`,
      );
      const rowsAfterBatch = await transactionRows(root);
      const pollutedBatchCells = cellsOf(rowById(rowsAfterBatch, "row-batch-polluted"));
      const cleanBatchCells = cellsOf(rowById(rowsAfterBatch, "row-batch-clean"));
      assert.equal(
        pollutedBatchCells.payee,
        "Woolworths",
        `the polluted batch row stored the payee ${JSON.stringify(pollutedBatchCells.payee)}`,
      );
      assert.equal(
        pollutedBatchCells.notes,
        BATCH_POLLUTED,
        `the polluted batch row did not keep its raw payee in notes: ${JSON.stringify(pollutedBatchCells.notes)}`,
      );
      assert.equal(cleanBatchCells.payee, "Woolworths", "a clean batch payee was rewritten");
      assert.equal(
        cleanBatchCells.notes ?? null,
        null,
        `a clean batch row gained notes: ${JSON.stringify(cleanBatchCells.notes)}`,
      );
      checks.batchInsert = {
        before: [
          { id: "row-batch-polluted", payee: BATCH_POLLUTED, notes: null },
          { id: "row-batch-clean", payee: "Woolworths", notes: null },
        ],
        after: [pollutedBatchCells, cleanBatchCells],
        warnings: batch.warnings ?? [],
      };

      // ── a casing-only repair is still a change, and is still logged ──────
      // "woolworths" → "Woolworths" carries no lint class, but it changed what
      // the operator typed; the write-time lint must record it, and the summary
      // must name the row so the operator can find it.
      const casingEventsBefore = valueOf(await readLog(root), "readLog").filter(
        (e) => e.type === "finance.payee.normalised",
      ).length;
      const casing = valueOf(
        await upsertRow(root, "financial", "finance:transactions", {
          id: "row-casing-only",
          cells: {
            date: "2026-10-03",
            amount: -20,
            account: accountId,
            category: categories.fuel,
            payee: "woolworths",
          },
        }),
        "casing-only upsertRow",
      );
      assert.equal(casing.cells.payee, "Woolworths", `a casing-only payee stored ${JSON.stringify(casing.cells.payee)}`);
      assert.equal(casing.cells.notes, "woolworths", "a casing-only repair did not keep the original wording");
      assert.equal(casing.warnings ?? null, null, "a casing-only repair raised a lint warning");
      const casingEvents = valueOf(await readLog(root), "readLog").filter(
        (e) => e.type === "finance.payee.normalised",
      );
      assert.equal(
        casingEvents.length,
        casingEventsBefore + 1,
        "a casing-only repair did not append exactly one finance.payee.normalised event",
      );
      const casingEvent = casingEvents.find(
        (e) => (e.payload as Record<string, unknown> | null)?.rowId === "row-casing-only",
      );
      if (!casingEvent) throw new Error("the casing-only repair's life-log event does not name the row");
      assert.equal(
        casingEvent.summary,
        "Normalised payee for row-casing-only: woolworths → Woolworths",
        `the casing-only summary is ${JSON.stringify(casingEvent.summary)}`,
      );
      checks.casingOnly = {
        before: { payee: "woolworths", notes: null },
        after: cellsOf(rowById(await transactionRows(root), "row-casing-only")),
        warnings: casing.warnings ?? [],
        logEvent: { type: casingEvent.type, summary: casingEvent.summary, payload: casingEvent.payload },
      };

      // ── a mapped CSV import: description to payee, no notes column ───────
      // The mapping is seeded straight into the vault's mappings directory, so
      // no Decision is ever filed for it; a mapping Decision here would mean
      // the import took the staged queue path instead of the one under test.
      const IMPORT_DESCRIPTION = "9/28/26 spent on petrol at Engen Capitec";
      const mappingId = "mapping-capitec-statement";
      const sourceColumns = ["Date", "Description", "Amount"];
      const mapping = {
        id: mappingId,
        databaseId: "finance:transactions",
        fingerprint: ingestFingerprint(sourceColumns),
        sourceKind: "csv",
        columns: [
          { source: "Date", columnId: "date" },
          { source: "Description", columnId: "payee" },
          { source: "Amount", columnId: "amount" },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      fs.mkdirSync(vaultPaths(root).domainMappingsDir("financial"), { recursive: true });
      fs.writeFileSync(
        vaultPaths(root).domainMapping("financial", mappingId),
        `${JSON.stringify(mapping, null, 2)}\n`,
      );

      const csv = [
        "Date,Description,Amount",
        `2026-11-06,${IMPORT_DESCRIPTION},-450`,
        "",
      ].join("\n");
      const ingested = valueOf(
        await ingestFile(root, "financial", {
          databaseId: "finance:transactions",
          bytes: Buffer.from(csv, "utf8"),
          mime: "text/csv",
          name: "capitec-statement.csv",
          actor: ACTOR,
        }),
        "ingestFile",
      );
      if (ingested.kind !== "staged") {
        throw new Error(`the seeded mapping was not used; ingest answered '${ingested.kind}'`);
      }
      const stagedRows = valueOf(
        await listIngestRows(root, "financial", ingested.batch.id),
        "listIngestRows",
      );
      assert.equal(stagedRows.length, 1, `the statement staged ${stagedRows.length} rows`);
      const staged = stagedRows[0]!;
      assert.equal(
        staged.cells.payee,
        IMPORT_DESCRIPTION,
        `the staged description was already changed: ${JSON.stringify(staged.cells.payee)}`,
      );
      // The operator accepts the batch as staged; the write funnel has to make
      // the numeric CSV cell and the polluted payee right at accept time.
      const accepted = valueOf(
        await acceptIngestRows(root, "financial", ingested.batch.id),
        "acceptIngestRows",
      );
      assert.equal(accepted.accepted, 1, `the accept posted ${accepted.accepted} rows`);
      const imported = rowById(await transactionRows(root), accepted.postedIds[0]!);
      const importedCells = cellsOf(imported);
      assert.equal(
        importedCells.payee,
        "Petrol at Engen",
        `the imported row stored the payee ${JSON.stringify(importedCells.payee)}`,
      );
      assert.equal(
        importedCells.notes,
        IMPORT_DESCRIPTION,
        `the imported row's notes are not the raw description: ${JSON.stringify(importedCells.notes)}`,
      );
      assert.equal(importedCells.amount, -450, `the imported amount was ${JSON.stringify(importedCells.amount)}`);
      const mappingDecisions = valueOf(await listDecisions(root), "listDecisions");
      assert.equal(mappingDecisions.length, 0, "an import filed a Decision instead of using the seeded mapping");
      checks.csvImport = {
        description: IMPORT_DESCRIPTION,
        mappingFingerprint: mapping.fingerprint,
        stagedPayee: staged.cells.payee,
        after: importedCells,
        decisions: mappingDecisions.length,
      };

      // ── the one-time history repair over 194 raw rows ────────────────────
      // The repair must see a vault with exactly the polluted rows and nothing
      // else, or "scanned 194" would be a coincidence of other writes.
      const historyRoot = path.join(workDir, "history-vault");
      valueOf(await createVault(historyRoot, "History"), "createVault(history)");
      valueOf(await unlockDomain(historyRoot, "financial"), "unlockDomain(history)");
      valueOf(await applyFinanceKitInstall(historyRoot), "applyFinanceKitInstall(history)");
      const historyRefs = await seedFinanceReference(historyRoot);
      const historyAccountNames = ["Capitec"];
      const historyCategoryNames = ["Fuel", "Meat", "Food & Drink", "Uncategorized"];
      const historyCategoryNameById: Record<string, string> = {
        [historyRefs.categories.fuel]: "Fuel",
        [historyRefs.categories.meat]: "Meat",
        [historyRefs.categories.foodDrink]: "Food & Drink",
      };

      type HistorySeed = {
        id: string;
        raw: string;
        notes: string | null;
        category: string;
        date: string;
        amount: number;
        kind: "petrol" | "woolworths" | "coffee" | "butcher";
      };
      const HISTORY_ROW_COUNT = 194;
      const historySeeds: HistorySeed[] = [];
      for (let i = 0; i < 80; i += 1) {
        historySeeds.push({
          id: `hist-${String(i).padStart(4, "0")}`,
          raw: "9/28/26 spent on petrol at Engen Capitec",
          notes: null,
          category: historyRefs.categories.fuel,
          date: "2026-09-28",
          amount: -(100 + i),
          kind: "petrol",
        });
      }
      for (let i = 80; i < 140; i += 1) {
        historySeeds.push({
          id: `hist-${String(i).padStart(4, "0")}`,
          raw: "2026-11-06 Woolworths Fuel Capitec",
          notes: null,
          category: historyRefs.categories.fuel,
          date: "2026-11-06",
          amount: -(100 + i),
          kind: "woolworths",
        });
      }
      for (let i = 140; i < 180; i += 1) {
        historySeeds.push({
          id: `hist-${String(i).padStart(4, "0")}`,
          raw: "Capitec coffee",
          notes: null,
          category: historyRefs.categories.foodDrink,
          date: "2026-11-05",
          amount: -(50 + i),
          kind: "coffee",
        });
      }
      for (let i = 180; i < HISTORY_ROW_COUNT; i += 1) {
        historySeeds.push({
          id: `hist-${String(i).padStart(4, "0")}`,
          raw: "9/28/26 paid to butcher Capitec Meat",
          notes: `existing note ${i}`,
          category: historyRefs.categories.meat,
          date: "2026-09-28",
          amount: -(70 + i),
          kind: "butcher",
        });
      }
      assert.equal(historySeeds.length, HISTORY_ROW_COUNT, "the history fixture is not 194 rows");

      // Seed the rows into the vault's own database, bypassing every write path:
      // this is the unrepaired history the migration exists to heal.
      const historySqlite = new DatabaseSync(vaultPaths(historyRoot).domainSqlite("financial"));
      try {
        historySqlite.exec("PRAGMA journal_mode=WAL;");
        const insert = historySqlite.prepare(
          "INSERT OR REPLACE INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
        );
        const seededAt = new Date().toISOString();
        for (const seed of historySeeds) {
          const cells = {
            date: seed.date,
            amount: seed.amount,
            account: historyRefs.accountId,
            category: seed.category,
            payee: seed.raw,
            notes: seed.notes,
          };
          insert.run("finance:transactions", seed.id, seededAt, seededAt, JSON.stringify(cells));
        }
      } finally {
        historySqlite.close();
      }

      const historyBefore = await transactionRows(historyRoot);
      assert.equal(
        historyBefore.length,
        HISTORY_ROW_COUNT,
        `the history vault holds ${historyBefore.length} rows before the repair, expected ${HISTORY_ROW_COUNT}`,
      );
      const historyBeforeById = new Map(historyBefore.map((r) => [r.id, cellsOf(r)]));
      for (const seed of historySeeds) {
        const before = historyBeforeById.get(seed.id)!;
        assert.equal(before.payee, seed.raw, `seed ${seed.id} did not start polluted`);
      }

      // Independently predict how many rows the repair must change, using the
      // public sanitiser — the migration's own `changed` number cannot be its
      // only witness.
      const expectedChanged = historySeeds.filter((seed) => {
        const result = sanitisePayee({
          raw: seed.raw,
          accountNames: historyAccountNames,
          categoryNames: historyCategoryNames,
          assignedCategoryName: historyCategoryNameById[seed.category] ?? null,
        });
        return (result.payee ?? "") !== seed.raw.trim();
      }).length;
      assert.equal(expectedChanged, HISTORY_ROW_COUNT, "the fixture expects pollution the sanitiser does not change");

      const migration = valueOf(
        await normaliseFinancePayeeHistory(historyRoot),
        "normaliseFinancePayeeHistory",
      );
      assert.equal(migration.ran, true, "the first repair reported it did not run");
      assert.equal(migration.alreadyCurrent, false, "the first repair claimed the vault was already current");
      assert.equal(migration.scanned, HISTORY_ROW_COUNT, `the repair scanned ${migration.scanned} rows, expected ${HISTORY_ROW_COUNT}`);
      assert.equal(migration.changed, expectedChanged, `the repair changed ${migration.changed} rows, expected ${expectedChanged}`);
      assert.ok(migration.flagged > 0, "the repair flagged no payees");
      assert.ok(
        migration.flagged <= migration.changed,
        `the repair flagged ${migration.flagged} rows but only changed ${migration.changed}`,
      );

      const historyAfter = await transactionRows(historyRoot);
      assert.equal(historyAfter.length, HISTORY_ROW_COUNT, "the repair added or removed a row");
      const historyAfterById = new Map(historyAfter.map((r) => [r.id, cellsOf(r)]));
      const repairProblems: string[] = [];
      for (const seed of historySeeds) {
        const after = historyAfterById.get(seed.id);
        if (!after) {
          repairProblems.push(`${seed.id}: the row disappeared`);
          continue;
        }
        repairProblems.push(...payeeProblems(after.payee, historyAccountNames, historyCategoryNames).map((p) => `${seed.id}: ${p}`));
        const expectedNotes = seed.notes ?? seed.raw;
        if (after.notes !== expectedNotes) {
          repairProblems.push(
            `${seed.id}: notes ${JSON.stringify(after.notes)}, expected ${JSON.stringify(expectedNotes)}`,
          );
        }
        const before = historyBeforeById.get(seed.id)!;
        for (const field of ["date", "amount", "account", "category"]) {
          if (after[field] !== before[field]) {
            repairProblems.push(`${seed.id}: ${field} changed from ${JSON.stringify(before[field])} to ${JSON.stringify(after[field])}`);
          }
        }
        if (seed.notes !== null && after.notes !== seed.notes) {
          repairProblems.push(`${seed.id}: an existing note was overwritten: ${JSON.stringify(after.notes)}`);
        }
      }
      assert.deepEqual(
        repairProblems.slice(0, 25),
        [],
        `the history repair left ${repairProblems.length} problems, first: ${repairProblems.slice(0, 5).join(" | ")}`,
      );

      // Zero Decisions is the whole point of the one-time repair.
      const historyDecisions = valueOf(await listDecisions(historyRoot), "listDecisions(history)");
      assert.equal(historyDecisions.length, 0, "the history repair filed Decisions instead of repairing rows");

      const historySettings = valueOf(
        await getFinanceKitSettings(historyRoot),
        "getFinanceKitSettings(history)",
      );
      assert.ok(historySettings, "the history vault reported no finance settings");
      assert.equal(
        historySettings?.payeeSanitiserVersion,
        PAYEE_SANITISER_VERSION,
        `the repair marker is ${JSON.stringify(historySettings?.payeeSanitiserVersion)}`,
      );

      const historyLog = valueOf(await readLog(historyRoot), "readLog(history)");
      const migrationEvents = historyLog.filter((e) => e.type === "finance.payees.normalised");
      assert.equal(migrationEvents.length, 1, `the repair wrote ${migrationEvents.length} finance.payees.normalised events, expected 1`);
      const migrationPayload = migrationEvents[0]!.payload as {
        scanned?: number;
        changed?: number;
        flagged?: number;
        version?: number;
      };
      assert.equal(migrationPayload.scanned, migration.scanned, "the repair's log and answer disagree on the scan count");
      assert.equal(migrationPayload.changed, migration.changed, "the repair's log and answer disagree on the change count");
      assert.equal(migrationPayload.flagged, migration.flagged, "the repair's log and answer disagree on the flagged count");
      assert.equal(migrationPayload.version, PAYEE_SANITISER_VERSION, "the repair logged a different sanitiser version");

      // Idempotence: the second visit writes nothing at all.
      const updatedAtBeforeSecond = new Map(historyAfter.map((r) => [r.id, r.updatedAt]));
      const second = valueOf(
        await normaliseFinancePayeeHistory(historyRoot),
        "normaliseFinancePayeeHistory (second)",
      );
      assert.equal(second.ran, false, "the second repair ran again");
      assert.equal(second.alreadyCurrent, true, "the second repair did not report the vault as current");
      assert.equal(second.changed, 0, `the second repair changed ${second.changed} rows`);
      const historyAfterSecond = await transactionRows(historyRoot);
      assert.equal(historyAfterSecond.length, HISTORY_ROW_COUNT, "the second repair changed the row count");
      for (const row of historyAfterSecond) {
        assert.equal(
          row.updatedAt,
          updatedAtBeforeSecond.get(row.id),
          `the second repair rewrote ${row.id}`,
        );
        assert.deepEqual(
          cellsOf(row),
          historyAfterById.get(row.id),
          `the second repair changed the cells of ${row.id}`,
        );
      }
      const historyLogAfterSecond = valueOf(await readLog(historyRoot), "readLog(history, second)");
      assert.equal(
        historyLogAfterSecond.filter((e) => e.type === "finance.payees.normalised").length,
        1,
        "the second repair appended a second history event",
      );

      const migrationSampleIds = ["hist-0000", "hist-0080", "hist-0140", "hist-0180"];
      const migrationSample = migrationSampleIds.map((id) => {
        const seed = historySeeds.find((s) => s.id === id)!;
        return {
          id,
          kind: seed.kind,
          before: historyBeforeById.get(id),
          after: historyAfterById.get(id),
        };
      });
      checks.migration = {
        rowCount: HISTORY_ROW_COUNT,
        outcome: migration,
        expectedChanged,
        decisions: historyDecisions.length,
        marker: historySettings?.payeeSanitiserVersion ?? null,
        logEvent: {
          type: migrationEvents[0]!.type,
          summary: migrationEvents[0]!.summary,
          payload: migrationPayload,
        },
        nullNoteRowsCarryRawPayee: historySeeds.filter((s) => s.notes === null).length,
        existingNotesRows: historySeeds.filter((s) => s.notes !== null).length,
        sample: migrationSample,
        secondRun: second,
      };

      // ── S1. the repair is rebased into the adapter's sync baseline ───────
      // A linked sheet keeps a `lastSyncedLocal` baseline of the cells as they
      // were after the last sync. If the repair updates the row and not the
      // baseline, the next sync reads the repair as a local edit and pushes the
      // normalised payee over the remote row. This vault seeds exactly that
      // state and then performs a real sync with a recording fake transport.
      const syncRoot = path.join(workDir, "sync-vault");
      valueOf(await createVault(syncRoot, "Sync"), "createVault(sync)");
      valueOf(await unlockDomain(syncRoot, "financial"), "unlockDomain(sync)");
      valueOf(await applyFinanceKitInstall(syncRoot), "applyFinanceKitInstall(sync)");
      const syncAccountId = "account-sync-capitec";
      valueOf(
        await upsertRow(syncRoot, "financial", "finance:accounts", {
          id: syncAccountId,
          cells: {
            name: "Capitec",
            type: "checking",
            currency: "ZAR",
            opening_balance: 0,
            opening_as_of: "2026-09-01",
          },
        }),
        "seed sync account",
      );

      const SYNC_RAW_PAYEE = "9/28/26 spent on petrol at Engen Capitec";
      const legacyRowId = "legacy-1";
      const legacyExternalId = "ext-1";
      const legacyCells = {
        date: "2026-09-28",
        amount: -321,
        account: syncAccountId,
        payee: SYNC_RAW_PAYEE,
        notes: null,
        external_id: legacyExternalId,
      };
      // Seed the unrepaired row straight into the vault's database, the way an
      // older version of the app left it.
      const syncSqlite = new DatabaseSync(vaultPaths(syncRoot).domainSqlite("financial"));
      try {
        syncSqlite.exec("PRAGMA journal_mode=WAL;");
        const seededAt = new Date().toISOString();
        syncSqlite
          .prepare(
            "INSERT OR REPLACE INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
          )
          .run("finance:transactions", legacyRowId, seededAt, seededAt, JSON.stringify(legacyCells));
      } finally {
        syncSqlite.close();
      }

      // Link a google-sheet adapter through the public path, with a fake secret
      // store; the sync under test reads the secret from it.
      const syncSecrets = fakeSecretStore();
      valueOf(
        await linkDatabaseAdapter(
          syncRoot,
          "financial",
          "finance:transactions",
          {
            kind: "google-sheet",
            bindingId: "sheet-1",
            secret: "sheet-secret",
            sotMode: "local-canonical-mirror",
            actor: ACTOR,
          },
          { secrets: syncSecrets },
        ),
        "linkDatabaseAdapter",
      );

      // Seed the mapping the pull's columns match, so the sync has no mapping
      // Decision to file and goes straight to the row compare.
      const PULL_COLUMNS = ["Date", "Description", "Amount", "External ID"];
      const syncMappingId = "mapping-sheet-statement";
      fs.mkdirSync(vaultPaths(syncRoot).domainMappingsDir("financial"), { recursive: true });
      fs.writeFileSync(
        vaultPaths(syncRoot).domainMapping("financial", syncMappingId),
        `${JSON.stringify(
          {
            id: syncMappingId,
            databaseId: "finance:transactions",
            fingerprint: ingestFingerprint(PULL_COLUMNS),
            sourceKind: "google-sheet",
            columns: [
              { source: "Date", columnId: "date" },
              { source: "Description", columnId: "payee" },
              { source: "Amount", columnId: "amount" },
              { source: "External ID", columnId: "external_id" },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );

      // The baseline as the last sync left it: the polluted cells, with the
      // remote side already converted to the column types (amount is a number).
      const syncIndexPath = vaultPaths(syncRoot).domainSyncIndex("financial");
      const remoteBaseline = {
        date: "2026-09-28",
        amount: -321,
        payee: SYNC_RAW_PAYEE,
        external_id: legacyExternalId,
      };
      fs.mkdirSync(path.dirname(syncIndexPath), { recursive: true });
      fs.writeFileSync(
        syncIndexPath,
        `${JSON.stringify(
          {
            entries: {
              [legacyRowId]: {
                externalId: legacyExternalId,
                rowId: legacyRowId,
                lastSyncedRemote: remoteBaseline,
                lastSyncedLocal: legacyCells,
                updatedAt: new Date().toISOString(),
              },
            },
          },
          null,
          2,
        )}\n`,
      );
      const readSyncIndex = () =>
        JSON.parse(fs.readFileSync(syncIndexPath, "utf8")) as {
          entries: Record<
            string,
            { lastSyncedRemote: Record<string, unknown>; lastSyncedLocal: Record<string, unknown> }
          >;
        };
      const baselineBefore = readSyncIndex().entries[legacyRowId]!;
      assert.equal(
        baselineBefore.lastSyncedLocal.payee,
        SYNC_RAW_PAYEE,
        "the sync baseline did not start polluted, so the rebase would prove nothing",
      );

      const syncMigration = valueOf(
        await normaliseFinancePayeeHistory(syncRoot),
        "normaliseFinancePayeeHistory(sync)",
      );
      assert.equal(syncMigration.ran, true, "the repair did not run on the linked vault");
      assert.equal(syncMigration.scanned, 1, `the repair scanned ${syncMigration.scanned} rows, expected 1`);
      assert.equal(syncMigration.changed, 1, `the repair changed ${syncMigration.changed} rows, expected 1`);

      const baselineAfter = readSyncIndex().entries[legacyRowId]!;
      assert.equal(
        baselineAfter.lastSyncedLocal.payee,
        "Petrol at Engen",
        `the repair did not rebase the sync baseline; it holds ${JSON.stringify(baselineAfter.lastSyncedLocal.payee)}`,
      );
      assert.equal(
        baselineAfter.lastSyncedLocal.notes,
        SYNC_RAW_PAYEE,
        "the rebased baseline lost the operator's raw wording",
      );
      assert.equal(
        baselineAfter.lastSyncedRemote.payee,
        SYNC_RAW_PAYEE,
        "the repair rewrote the REMOTE baseline; the local repair must not claim the remote said it",
      );

      // A recording fake transport: a sync that pushes would be visible here.
      const transportCalls = {
        pull: 0,
        push: [] as Array<{ externalId: string; cells: Record<string, string> }>,
        delete: [] as Array<{ externalId: string }>,
      };
      const syncTransport: AdapterTransport = {
        pull: async () => {
          transportCalls.pull += 1;
          return {
            ok: true,
            value: {
              columns: PULL_COLUMNS,
              rows: [
                {
                  externalId: legacyExternalId,
                  cells: {
                    Date: "2026-09-28",
                    Description: SYNC_RAW_PAYEE,
                    Amount: "-321",
                    "External ID": legacyExternalId,
                  },
                },
              ],
            },
          };
        },
        pushRow: async (input) => {
          transportCalls.push.push({ externalId: input.externalId, cells: input.cells });
          return { ok: true, value: true };
        },
        deleteRow: async (input) => {
          transportCalls.delete.push({ externalId: input.externalId });
          return { ok: true, value: true };
        },
      };
      const syncDeps = { secrets: syncSecrets, transport: syncTransport, online: true };

      const syncOne = valueOf(
        await syncDatabase(syncRoot, "financial", "finance:transactions", syncDeps),
        "syncDatabase",
      );
      assert.equal(syncOne.pulled, 0, `the sync pulled ${syncOne.pulled} rows from an unchanged remote`);
      assert.equal(syncOne.pushed, 0, `the sync pushed ${syncOne.pushed} rows; the repair was read as a local edit`);
      assert.deepEqual(syncOne.conflicts, [], "the sync reported a conflict over the repair");
      assert.equal(transportCalls.push.length, 0, "the sync called pushRow over the repaired row");

      const linkedOne = valueOf(
        await syncLinkedDatabases(syncRoot, "financial", syncDeps),
        "syncLinkedDatabases",
      );
      assert.equal(linkedOne.length, 1, `syncLinkedDatabases reported ${linkedOne.length} databases, expected 1`);
      assert.equal(linkedOne[0]!.pulled, 0, "syncLinkedDatabases pulled a row");
      assert.equal(linkedOne[0]!.pushed, 0, "syncLinkedDatabases pushed a row");
      assert.deepEqual(linkedOne[0]!.conflicts, [], "syncLinkedDatabases reported a conflict");
      assert.equal(linkedOne[0]!.needsMapping, false, "the seeded mapping was not found by syncLinkedDatabases");

      const linkedTwo = valueOf(
        await syncLinkedDatabases(syncRoot, "financial", syncDeps),
        "syncLinkedDatabases (second)",
      );
      assert.equal(linkedTwo.length, 1, "the second sync lost the linked database");
      assert.equal(linkedTwo[0]!.pulled, 0, "the second sync pulled a row");
      assert.equal(linkedTwo[0]!.pushed, 0, "the second sync pushed a row");
      assert.deepEqual(linkedTwo[0]!.conflicts, [], "the second sync reported a conflict");
      assert.equal(transportCalls.push.length, 0, "a later sync still pushed the repaired row");
      assert.equal(transportCalls.delete.length, 0, "a sync deleted a row");

      checks.adapterSyncRebase = {
        rawPayee: SYNC_RAW_PAYEE,
        cleanPayee: "Petrol at Engen",
        migration: syncMigration,
        baselineBefore: {
          lastSyncedLocal: { payee: baselineBefore.lastSyncedLocal.payee, notes: baselineBefore.lastSyncedLocal.notes },
          lastSyncedRemote: { payee: baselineBefore.lastSyncedRemote.payee },
        },
        baselineAfter: {
          lastSyncedLocal: { payee: baselineAfter.lastSyncedLocal.payee, notes: baselineAfter.lastSyncedLocal.notes },
          lastSyncedRemote: { payee: baselineAfter.lastSyncedRemote.payee },
        },
        syncDatabase: syncOne,
        syncLinkedDatabases: linkedOne[0],
        secondSync: linkedTwo[0],
        transportCalls: {
          pull: transportCalls.pull,
          pushRow: transportCalls.push,
          deleteRow: transportCalls.delete,
        },
      };

      // ── S2. the agent's write path and the Decision it files ─────────────
      // The companion reaches the ledger through `executeDatabaseTool`. A
      // create writes now; an update is a Decision the operator approves, and
      // its body must already hold the clean cells or approval re-writes the
      // pollution.
      const agentRoot = path.join(workDir, "agent-vault");
      valueOf(await createVault(agentRoot, "Agent"), "createVault(agent)");
      valueOf(await unlockDomain(agentRoot, "financial"), "unlockDomain(agent)");
      valueOf(await applyFinanceKitInstall(agentRoot), "applyFinanceKitInstall(agent)");
      const agentRefs = await seedFinanceReference(agentRoot);
      const techCategoryId = "category-tech-saas";
      valueOf(
        await upsertRow(agentRoot, "financial", "finance:categories", {
          id: techCategoryId,
          cells: { name: "Tech/SaaS" },
        }),
        "seed Tech/SaaS category",
      );
      const agentActor = { type: "agent", id: "agent-e2e", name: "E2E Agent" } as const;

      const AGENT_CREATE_RAW = "9/28/26 spent on Capitec coffee";
      const createdTool = toolOk(
        (await executeDatabaseTool(agentRoot, agentActor, "upsert_row", {
          domainSlug: "financial",
          databaseId: "finance:transactions",
          cells: {
            date: "2026-10-05",
            amount: -99,
            account: agentRefs.accountId,
            category: agentRefs.categories.foodDrink,
            payee: AGENT_CREATE_RAW,
          },
        })) as Record<string, unknown>,
        "agent upsert_row (create)",
      );
      assert.equal(createdTool.posted, true, "the agent's create did not write immediately");
      assert.equal(createdTool.applied, true, "the agent's create did not report itself applied");
      assert.deepEqual(
        sortedWarnings(createdTool.warnings),
        [WARNING_TEXT.date, WARNING_TEXT["account-name"], WARNING_TEXT.filler].sort(),
        `the agent's create warnings were ${JSON.stringify(createdTool.warnings)}`,
      );
      const createdAgentRowId = String(createdTool.rowId);
      const createdAgentCells = cellsOf(rowById(await transactionRows(agentRoot), createdAgentRowId));
      assert.equal(
        createdAgentCells.payee,
        "Coffee",
        `the agent's created row stored the payee ${JSON.stringify(createdAgentCells.payee)}`,
      );
      assert.equal(
        createdAgentCells.notes,
        AGENT_CREATE_RAW,
        "the agent's created row did not keep the raw wording in notes",
      );

      // An existing row the agent proposes to change: it runs through the
      // approval queue, so the E2E reads the pending body before approving.
      const AGENT_UPDATE_RAW = "2026-11-06 paid to Woolworths Tech/SaaS Capitec";
      valueOf(
        await upsertRow(agentRoot, "financial", "finance:transactions", {
          id: "row-agent-update",
          cells: {
            date: "2026-10-10",
            amount: -1500,
            account: agentRefs.accountId,
            category: techCategoryId,
            payee: "Woolworths Tech/SaaS",
            notes: null,
          },
        }),
        "seed agent update row",
      );
      const beforeAgentUpdate = cellsOf(rowById(await transactionRows(agentRoot), "row-agent-update"));
      assert.equal(beforeAgentUpdate.payee, "Woolworths", "the seeded update row did not start clean");

      const updateTool = toolOk(
        (await executeDatabaseTool(agentRoot, agentActor, "upsert_row", {
          domainSlug: "financial",
          databaseId: "finance:transactions",
          id: "row-agent-update",
          cells: {
            date: "2026-10-10",
            amount: -1500,
            account: agentRefs.accountId,
            category: techCategoryId,
            payee: AGENT_UPDATE_RAW,
          },
        })) as Record<string, unknown>,
        "agent upsert_row (update)",
      );
      assert.equal(updateTool.posted, false, "the agent's update wrote without a Decision");
      assert.equal(updateTool.status, "pending", `the agent's update status was ${JSON.stringify(updateTool.status)}`);
      assert.deepEqual(
        sortedWarnings(updateTool.warnings),
        [
          WARNING_TEXT.date,
          WARNING_TEXT["account-name"],
          WARNING_TEXT["category-name"],
          WARNING_TEXT.filler,
        ].sort(),
        `the agent's update warnings were ${JSON.stringify(updateTool.warnings)}`,
      );
      const updateDecisionId = String(updateTool.decisionId);

      const pendingDecisions = valueOf(await listDecisions(agentRoot), "listDecisions(agent)");
      const updateDecision = pendingDecisions.find((d) => d.id === updateDecisionId);
      if (!updateDecision) throw new Error("the agent's update filed no pending Decision");
      assert.equal(updateDecision.status, "pending", `the update Decision is ${updateDecision.status}`);
      assert.equal(
        (updateDecision.target as { type: string; rowId?: string }).type,
        "database-row",
        "the update Decision does not target a database row",
      );
      assert.equal(
        (updateDecision.target as { type: string; rowId?: string }).rowId,
        "row-agent-update",
        "the update Decision targets a different row",
      );
      const updateBody = JSON.parse(updateDecision.proposedBodyMarkdown) as {
        op: string;
        cells: Record<string, unknown>;
        previousCells: Record<string, unknown>;
      };
      assert.equal(updateBody.op, "upsert", `the Decision body op is ${JSON.stringify(updateBody.op)}`);
      assert.equal(
        updateBody.cells.payee,
        "Woolworths",
        `the pending Decision body still holds the payee ${JSON.stringify(updateBody.cells.payee)}`,
      );
      assert.equal(
        updateBody.cells.notes,
        AGENT_UPDATE_RAW,
        "the pending Decision body does not carry the verbatim wording in notes",
      );
      assert.equal(
        updateBody.previousCells.payee,
        "Woolworths",
        "the Decision's previousCells do not show the row as it was",
      );

      const approved = valueOf(
        await resolveDecision(agentRoot, updateDecisionId, "approved"),
        "resolveDecision(approved)",
      );
      assert.equal(approved.status, "approved", `the Decision resolved to ${approved.status}`);
      const afterApproval = cellsOf(rowById(await transactionRows(agentRoot), "row-agent-update"));
      assert.equal(
        afterApproval.payee,
        "Woolworths",
        `the approved row stored the payee ${JSON.stringify(afterApproval.payee)}`,
      );
      assert.equal(
        afterApproval.notes,
        AGENT_UPDATE_RAW,
        `the approved row's notes are ${JSON.stringify(afterApproval.notes)}, expected the verbatim wording`,
      );
      assert.equal(afterApproval.amount, -1500, "the approved row lost its amount");
      assert.equal(afterApproval.category, techCategoryId, "the approved row lost its category");
      assert.equal(afterApproval.date, "2026-10-10", "the approved row lost its date");
      const decisionsAfterAgent = valueOf(await listDecisions(agentRoot), "listDecisions(agent, after)");
      assert.equal(decisionsAfterAgent.length, 1, "approving the update filed or removed a Decision");
      assert.equal(decisionsAfterAgent[0]!.status, "approved", "the resolved Decision is not recorded as approved");

      checks.agentDecision = {
        create: {
          rawPayee: AGENT_CREATE_RAW,
          tool: createdTool,
          row: createdAgentCells,
        },
        update: {
          rawPayee: AGENT_UPDATE_RAW,
          tool: updateTool,
          decision: {
            id: updateDecisionId,
            status: updateDecision.status,
            target: updateDecision.target,
            bodyOp: updateBody.op,
            bodyCells: updateBody.cells,
            previousCells: updateBody.previousCells,
          },
          afterApproval,
          decisions: decisionsAfterAgent.map((d) => ({ id: d.id, status: d.status, target: d.target })),
        },
      };

      // ── a vault without the Finance kit is a no-op ───────────────────────
      const kitlessRoot = path.join(workDir, "kitless-vault");
      valueOf(await createVault(kitlessRoot, "Kitless"), "createVault(kitless)");
      valueOf(await unlockDomain(kitlessRoot, "financial"), "unlockDomain(kitless)");
      const kitless = valueOf(
        await normaliseFinancePayeeHistory(kitlessRoot),
        "normaliseFinancePayeeHistory(kitless)",
      );
      assert.equal(kitless.ran, false, "the repair ran on a vault with no Finance kit");
      assert.equal(kitless.alreadyCurrent, false, "a kit-less vault was reported as already current");
      assert.equal(kitless.changed, 0, "the repair changed rows on a vault with no Finance kit");
      checks.kitlessVault = kitless;

      // ── the artifact ─────────────────────────────────────────────────────
      const report = {
        pass: true,
        what: "payee hygiene on every finance write path (chat capture, correction, manual/batch writes, mapped import, adapter sync, agent tool and approved Decision), and the one-time history repair of 194 polluted rows without a Decision, rebased into the sync baseline",
        command: "cd apps/desktop && node --experimental-strip-types --test tests/finance-payee-e2e.test.ts",
        sanitiser: artifact.sanitiser,
        checks,
        generatedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
