import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  deleteRow,
  getRow,
  isDomainLive,
  listRows,
  upsertRow,
} from "./domain-databases.ts";
import { readRegistry } from "./domain-databases.ts";
import { listInstalledKits } from "./finance-kit.ts";
import { sanitisePayee } from "./payee.ts";
import {
  FINANCE_KIT_ID,
  FINANCE_DOMAIN_SLUG,
  FINANCE_DB_IDS,
  type Actor,
  type CaptureOutcome,
  type FinanceKitSettings,
  type Result,
} from "./types.ts";

// Re-export for tests and tools
export { FINANCE_DB_IDS, FINANCE_DOMAIN_SLUG };

const TRANSACTIONAL_TYPES = new Set(["checking", "credit", "cash", "other"]);

const INFLOW_WORDS = new Set([
  "received",
  "income",
  "salary",
  "refund",
  "got paid",
]);

interface ParsedUtterance {
  amount: number | null;
  currency: "ZAR" | "USD";
  date: string;
  payee: string | null;
  isInflow: boolean;
  accountNameHint: string | null;
}

function parseAmount(text: string): { amount: number | null; rest: string } {
  // Match R/ZAR/USD/$ followed by optional spaces and a number
  // Also handle a leading minus sign before the currency marker
  const patterns = [
    /-?\s*(?:ZAR|USD)\s+(\d+(?:\.\d+)?)/i,
    /-?\s*[\$R]\s*(\d+(?:\.\d+)?)/,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const amount = parseFloat(m[1]);
      if (Number.isFinite(amount)) {
        // Remove the matched portion from text
        const rest = text.replace(m[0], " ").trim();
        // Check for leading minus before the matched portion
        const before = text.slice(0, text.indexOf(m[0])).trim();
        const hasMinus = before.endsWith("-") || m[0].startsWith("-");
        return { amount: hasMinus ? -amount : amount, rest };
      }
    }
  }
  return { amount: null, rest: text };
}

function parseCurrency(text: string): "ZAR" | "USD" {
  const upper = text.toUpperCase();
  if (/\bUSD\b/.test(upper) || /\$/.test(text)) return "USD";
  // R or ZAR → ZAR (default is ZAR too)
  return "ZAR";
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const dayPart = String(day).padStart(2, "0");
  return `${y}-${m}-${dayPart}`;
}

function expandYear(raw: string): number {
  const n = Number(raw);
  return raw.length <= 2 ? 2000 + n : n;
}

/** A numeric date in the sentence: 9/28/26, 28/09/2026, 2026.11.06. */
function parseNumericDate(text: string): string | null {
  const match = text.match(/\b(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})\b/);
  if (!match) return null;
  const [a, b, c] = [Number(match[1]), Number(match[2]), match[3]!];
  // A four-digit first number is the year; otherwise the day/month order is
  // resolved by which number cannot be a month, and day-then-month when both
  // could be (South African order).
  if (match[1]!.length === 4) return isoDate(Number(match[1]), Number(match[2]), Number(c));
  const year = expandYear(c);
  if (a > 12) return isoDate(year, b, a);
  if (b > 12) return isoDate(year, a, b);
  return isoDate(year, b, a);
}

function monthIndex(name: string): number | null {
  return MONTH_NAMES[name.slice(0, 3).toLowerCase()] ?? null;
}

/** A month-name date: 28 Sep 2026, Sep 28, 2026, 28 September 2026. */
function parseMonthNameDate(text: string): string | null {
  const dayFirst = text.match(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{2,4})\b/i,
  );
  if (dayFirst) {
    const month = monthIndex(dayFirst[2]!);
    if (month) return isoDate(expandYear(dayFirst[3]!), month, Number(dayFirst[1]));
  }
  const monthFirst = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{2,4})\b/i,
  );
  if (monthFirst) {
    const month = monthIndex(monthFirst[1]!);
    if (month) return isoDate(expandYear(monthFirst[3]!), month, Number(monthFirst[2]));
  }
  return null;
}

function parseDate(text: string, today: string): string {
  // Explicit YYYY-MM-DD wins
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit) return explicit[1];

  const numeric = parseNumericDate(text);
  if (numeric) return numeric;
  const monthName = parseMonthNameDate(text);
  if (monthName) return monthName;

  if (/\byesterday\b/i.test(text)) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  return today;
}

function detectIsInflow(text: string): boolean {
  const lower = text.toLowerCase();
  for (const word of INFLOW_WORDS) {
    if (lower.includes(word)) return true;
  }
  return false;
}

function parsePayee(rest: string): string | null {
  // Clean up: remove "today", "yesterday", prepositions like "for", "from" at start
  let cleaned = rest
    .replace(/\btoday\b/gi, " ")
    .replace(/\byesterday\b/gi, " ")
    .replace(/\bfor\b/gi, " ")
    .replace(/\bfrom\b/gi, " ")
    .replace(/\bthe\b/gi, " ")
    .replace(/\bamount\b/gi, " ")
    .replace(/\bactually\b/gi, " ")
    .replace(/\bto\b/gi, " ")
    .trim();

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parseAccountNameHint(
  text: string,
  accounts: Array<{ id: string; name: string; type: string; currency: string }>,
): string | null {
  const lower = text.toLowerCase();
  for (const acc of accounts) {
    if (acc.name && lower.includes(acc.name.toLowerCase())) {
      return acc.name;
    }
  }
  return null;
}

export function parseUtterance(
  text: string,
  today: string,
  accounts: Array<{ id: string; name: string; type: string; currency: string }>,
  homeCurrency: "ZAR" | "USD" = "ZAR",
): ParsedUtterance {
  const upper = text.toUpperCase();
  const hasUsd = upper.includes("USD") || text.includes("$");
  const currency = hasUsd ? "USD" : homeCurrency;

  const { amount, rest } = parseAmount(text);
  const date = parseDate(text, today);
  const isInflow = detectIsInflow(text);

  // For payee, use the rest after amount removal, plus clean up
  const payee = parsePayee(rest);
  const accountNameHint = parseAccountNameHint(text, accounts);

  return {
    amount,
    currency,
    date,
    payee,
    isInflow,
    accountNameHint,
  };
}

function selectAccount(
  parsed: ParsedUtterance,
  settings: FinanceKitSettings,
  accounts: Array<{ id: string; name: string; type: string; currency: string }>,
): { accountId: string | null; ask: string | null } {
  const currencyAccounts = accounts.filter(
    (a) => a.currency === parsed.currency,
  );
  const transactional = currencyAccounts.filter((a) =>
    TRANSACTIONAL_TYPES.has(a.type),
  );

  if (transactional.length === 0) {
    return {
      accountId: null,
      ask: `No transactional accounts in ${parsed.currency}.`,
    };
  }

  // 1. Named account in text
  if (parsed.accountNameHint) {
    const named = transactional.find(
      (a) => a.name.toLowerCase() === parsed.accountNameHint!.toLowerCase(),
    );
    if (named) return { accountId: named.id, ask: null };
  }

  // 2. Default capture account
  if (settings.defaultCaptureAccountId) {
    const def = transactional.find(
      (a) => a.id === settings.defaultCaptureAccountId,
    );
    if (def) return { accountId: def.id, ask: null };
  }

  // 3. Sole transactional account
  if (transactional.length === 1) {
    return { accountId: transactional[0].id, ask: null };
  }

  // 4. Ask
  const names = transactional.map((a) => a.name).join(", ");
  return {
    accountId: null,
    ask: `Which ${parsed.currency} account? ${names}.`,
  };
}

/**
 * The categoriser's keyword rules: a word the operator typed that the category
 * name itself does not contain. Without these, "petrol" and "meat" fell into
 * Uncategorized unless the sentence happened to name the category by hand.
 */
const CATEGORY_KEYWORD_RULES: Array<{ target: string; words: string[] }> = [
  { target: "Fuel", words: ["petrol", "fuel", "diesel", "garage", "engen", "shell", "sasol"] },
  { target: "Meat", words: ["meat", "butcher", "steak"] },
  { target: "Food", words: ["coffee"] },
];

function escapeKeyword(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordPresent(text: string, word: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeKeyword(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * A rule names a category by intent, and the operator may have named it more
 * precisely: "Food" has to reach "Food & Drink" without also reaching "Foodie
 * supplies". Exact name first, then a word-prefix.
 */
function ruleTargetCategory(
  target: string,
  categories: Array<{ id: string; name: string }>,
): string | null {
  const exact = categories.find(
    (c) => c.name && c.name.toLowerCase() === target.toLowerCase(),
  );
  if (exact) return exact.id;
  const prefix = new RegExp(`^${escapeKeyword(target)}(?![\\p{L}\\p{N}])`, "iu");
  const named = categories.find((c) => c.name && prefix.test(c.name));
  return named ? named.id : null;
}

function selectCategory(
  text: string,
  categories: Array<{ id: string; name: string }>,
): string {
  const lower = text.toLowerCase();
  // An explicitly named category is the operator's own choice and wins.
  for (const cat of [...categories].sort((a, b) => b.name.length - a.name.length)) {
    if (cat.name && lower.includes(cat.name.toLowerCase())) {
      return cat.id;
    }
  }
  for (const rule of CATEGORY_KEYWORD_RULES) {
    if (!rule.words.some((word) => wordPresent(text, word))) continue;
    const id = ruleTargetCategory(rule.target, categories);
    if (id) return id;
  }
  // Uncategorized
  const uncategorized = categories.find(
    (c) => c.name.toLowerCase() === "uncategorized",
  );
  return uncategorized ? uncategorized.id : "uncategorized";
}

/** The payee the operator's sentence should store: merchant or item only. */
function cleanPayee(
  raw: string | null,
  accounts: Array<{ id: string; name: string }>,
  categories: Array<{ id: string; name: string }>,
  categoryName: string | null,
): string | null {
  const result = sanitisePayee({
    raw,
    accountNames: accounts.map((a) => a.name),
    categoryNames: categories.map((c) => c.name),
    assignedCategoryName: categoryName,
  });
  return result.payee;
}

async function ensureUncategorized(
  root: string,
  categories: Array<{ id: string; name: string }>,
): Promise<string> {
  const existing = categories.find(
    (c) => c.name.toLowerCase() === "uncategorized",
  );
  if (existing) return existing.id;

  const id = "category-uncategorized";
  await upsertRow(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.categories, {
    id,
    cells: { name: "Uncategorized" },
  });
  return id;
}

function captureThreadPath(root: string): string {
  const paths = vaultPaths(root);
  const dir = paths.domainDataDir(FINANCE_DOMAIN_SLUG);
  return path.join(dir, "capture-threads.json");
}

async function readCaptureThreads(
  root: string,
): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(captureThreadPath(root), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}

async function writeCaptureThreads(
  root: string,
  threads: Record<string, string>,
): Promise<void> {
  const p = captureThreadPath(root);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await atomicWriteFile(p, JSON.stringify(threads, null, 2) + "\n");
}

export function resolveAmount(
  parsed: ParsedUtterance,
  isInflow: boolean,
): number | null {
  if (parsed.amount === null) return null;
  const absAmount = Math.abs(parsed.amount);
  return isInflow ? absAmount : -absAmount;
}

/**
 * The `source_file` contract for a captured row, in one place.
 *
 * The shape half is what `checkDatabaseCells` already enforces for every `file`
 * column: a vault-relative path inside this domain's own file store, with no
 * ascent and no Windows separator. The existence half is what keeps a row from
 * citing an original that was never stored — the defect this whole path exists
 * to prevent.
 */
export async function isStoredReceiptPath(
  root: string,
  relPath: unknown,
): Promise<boolean> {
  if (typeof relPath !== "string" || relPath.length === 0) return false;
  if (path.isAbsolute(relPath)) return false;
  if (relPath.includes("..") || relPath.includes("\\")) return false;
  if (!relPath.startsWith(`domains/${FINANCE_DOMAIN_SLUG}/data/files/`)) return false;
  try {
    const stat = await fs.stat(path.join(root, ...relPath.split("/")));
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Whether this vault can hold a receipt at all: the finance domain is live and
 * the Finance kit is installed. The capture path needs the same pair, so the
 * check lives in one place rather than being restated by each caller.
 */
export async function isReceiptStoreReady(root: string): Promise<boolean> {
  if (!(await isDomainLive(root, FINANCE_DOMAIN_SLUG))) return false;
  const kits = await listInstalledKits(root, FINANCE_DOMAIN_SLUG);
  return kits.ok && kits.value.includes(FINANCE_KIT_ID);
}

export async function captureUtterance(
  root: string,
  input: {
    text: string;
    today: string;
    threadId: string;
    actor: Actor;
    /** Vault-relative path of the original this row came from. */
    sourceFile?: string | null;
  },
): Promise<Result<CaptureOutcome>> {
  const { text, today, threadId, actor } = input;
  const sourceFile = input.sourceFile ?? null;

  // Refuse before any row work: a row that cites an original which is not in the
  // vault is worse than no row at all, because nothing downstream can tell the
  // difference from a real one.
  if (sourceFile !== null && !(await isStoredReceiptPath(root, sourceFile))) {
    return { ok: false, error: "source_file must name a stored receipt" };
  }

  // Check kit installed + domain live
  const paths = vaultPaths(root);
  try {
    const registry = await readRegistry(
      paths.domainRegistry(FINANCE_DOMAIN_SLUG),
    );
    if (!registry.installedKits.includes(FINANCE_KIT_ID)) {
      return { ok: false, error: "Install the Finance kit first" };
    }

    // Get settings
    const settings = registry.finance ?? {
      homeCurrency: "ZAR",
      usdZarRate: null,
      usdZarAsOf: null,
      defaultCaptureAccountId: null,
    };
    const homeCurrency = (settings.homeCurrency as "ZAR" | "USD") ?? "ZAR";

    // Load accounts and categories
    const accountsRes = await listRows(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.accounts,
    );
    if (!accountsRes.ok) return { ok: false, error: accountsRes.error };
    const accounts = accountsRes.value.map((r) => ({
      id: r.id,
      name: (r.cells.name as string) ?? "",
      type: (r.cells.type as string) ?? "",
      currency: (r.cells.currency as string) ?? "ZAR",
    }));

    const categoriesRes = await listRows(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.categories,
    );
    if (!categoriesRes.ok) return { ok: false, error: categoriesRes.error };
    let categories = categoriesRes.value.map((r) => ({
      id: r.id,
      name: (r.cells.name as string) ?? "",
    }));

    // Parse
    const parsed = parseUtterance(text, today, accounts, homeCurrency);
    if (parsed.amount === null) {
      return {
        ok: true,
        value: { posted: false, ask: "What amount?", rowId: null },
      };
    }

    const { accountId, ask } = selectAccount(parsed, settings, accounts);
    if (!accountId) {
      return {
        ok: true,
        value: { posted: false, ask: ask ?? "Which account?", rowId: null },
      };
    }

    // Ensure Uncategorized exists
    const uncategorizedId = await ensureUncategorized(root, categories);
    // Reload categories to include newly-ensured uncategorized
    const refreshed = await listRows(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.categories,
    );
    if (refreshed.ok) {
      categories = refreshed.value.map((r) => ({
        id: r.id,
        name: (r.cells.name as string) ?? "",
      }));
    }
    const categoryId = selectCategory(text, categories);
    const categoryName =
      categories.find((c) => c.id === categoryId)?.name ?? "Uncategorized";

    const amount = resolveAmount(parsed, parsed.isInflow);
    if (amount === null) {
      return {
        ok: true,
        value: { posted: false, ask: "What amount?", rowId: null },
      };
    }

    // Each capture is a new row. The thread file remembers only the latest for undo/correct.
    const threads = await readCaptureThreads(root);
    const rowId = `capture-${randomUUID()}`;

    const accountName =
      accounts.find((a) => a.id === accountId)?.name ?? "";
    // The payee the operator sees on the receipt is the stored one: merchant or
    // item only. The write funnel applies the same rule to the row; computing it
    // here keeps the receipt from naming a field the row does not hold.
    const payee = cleanPayee(parsed.payee, accounts, categories, categoryName);

    const cells = {
      date: parsed.date,
      amount,
      account: accountId,
      category: categoryId,
      // The raw payee goes through the write funnel, which normalises it and
      // records the lint; `notes` carries the operator's verbatim sentence.
      payee: parsed.payee,
      notes: text,
      source_file: sourceFile,
      provenance: `chat:${threadId}`,
      external_id: null,
    };

    const upserted = await upsertRow(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.transactions,
      { id: rowId, cells },
    );
    if (!upserted.ok) return { ok: false, error: upserted.error };

    // Update thread tracking
    threads[threadId] = rowId;
    await writeCaptureThreads(root, threads);

    const payeeBit = payee ? ` • ${payee}` : "";
    const receipt = `${amount < 0 ? "-" : ""}${Math.abs(amount)} ${parsed.currency} on ${parsed.date} • ${accountName} • ${categoryName}${payeeBit}`;

    // KAR-9: a posted capture is a vault write, so the life log records who wrote it.
    await appendLog(root, {
      domainSlug: FINANCE_DOMAIN_SLUG,
      type: "capture.posted",
      summary: `Captured ${receipt}`,
      payload: {
        rowId,
        amount,
        currency: parsed.currency,
        date: parsed.date,
        accountName,
        categoryName,
        payee,
      },
      actor,
    });

    return {
      ok: true,
      value: {
        posted: true,
        rowId,
        receipt,
        amount,
        currency: parsed.currency,
        date: parsed.date,
        accountName,
        categoryName,
        payee,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function undoCapture(
  root: string,
  input: { threadId: string; actor: Actor },
): Promise<Result<CaptureOutcome>> {
  const threads = await readCaptureThreads(root);
  const rowId = threads[input.threadId];
  if (!rowId) {
    return { ok: false, error: "Nothing to undo" };
  }

  // Read the row first for receipt details
  const existing = await listRows(
    root,
    FINANCE_DOMAIN_SLUG,
    FINANCE_DB_IDS.transactions,
  );
  let rowInfo: { amount: number; accountName: string } | null = null;
  if (existing.ok) {
    const row = existing.value.find((r) => r.id === rowId);
    if (row) {
      const accounts = await listRows(
        root,
        FINANCE_DOMAIN_SLUG,
        FINANCE_DB_IDS.accounts,
      );
      let accountName = "";
      if (accounts.ok) {
        const accId = row.cells.account as string;
        const acc = accounts.value.find((a) => a.id === accId);
        accountName = acc?.cells.name as string ?? "";
      }
      rowInfo = {
        amount: row.cells.amount as number,
        accountName,
      };
    }
  }

  const del = await deleteRow(
    root,
    FINANCE_DOMAIN_SLUG,
    FINANCE_DB_IDS.transactions,
    rowId,
  );
  if (!del.ok) return del;

  // Clear the thread entry
  delete threads[input.threadId];
  await writeCaptureThreads(root, threads);

  const receipt = rowInfo
    ? `Removed transaction of ${rowInfo.amount} from ${rowInfo.accountName}`
    : "Removed the last captured transaction";

  await appendLog(root, {
    domainSlug: FINANCE_DOMAIN_SLUG,
    type: "capture.undone",
    summary: receipt,
    payload: {
      rowId,
      amount: rowInfo?.amount ?? null,
      accountName: rowInfo?.accountName ?? null,
    },
    actor: input.actor,
  });

  return {
    ok: true,
    value: {
      posted: false,
      ask: receipt,
      rowId: null,
    },
  };
}

export async function correctCapture(
  root: string,
  input: {
    text: string;
    today: string;
    threadId: string;
    actor: Actor;
  },
): Promise<Result<CaptureOutcome>> {
  const { text, today, threadId, actor } = input;

  // Check kit installed
  const paths = vaultPaths(root);
  try {
    const registry = await readRegistry(
      paths.domainRegistry(FINANCE_DOMAIN_SLUG),
    );
    if (!registry.installedKits.includes(FINANCE_KIT_ID)) {
      return { ok: false, error: "Install the Finance kit first" };
    }

    const settings = registry.finance ?? {
      homeCurrency: "ZAR",
      usdZarRate: null,
      usdZarAsOf: null,
      defaultCaptureAccountId: null,
    };
    const homeCurrency = (settings.homeCurrency as "ZAR" | "USD") ?? "ZAR";

    const accountsRes = await listRows(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.accounts,
    );
    if (!accountsRes.ok) return { ok: false, error: accountsRes.error };
    const accounts = accountsRes.value.map((r) => ({
      id: r.id,
      name: (r.cells.name as string) ?? "",
      type: (r.cells.type as string) ?? "",
      currency: (r.cells.currency as string) ?? "ZAR",
    }));

    const categoriesRes = await listRows(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.categories,
    );
    if (!categoriesRes.ok) return { ok: false, error: categoriesRes.error };
    let categories = categoriesRes.value.map((r) => ({
      id: r.id,
      name: (r.cells.name as string) ?? "",
    }));

    const parsed = parseUtterance(text, today, accounts, homeCurrency);
    if (parsed.amount === null) {
      return {
        ok: true,
        value: { posted: false, ask: "What amount?", rowId: null },
      };
    }

    const { accountId, ask } = selectAccount(parsed, settings, accounts);
    if (!accountId) {
      return {
        ok: true,
        value: { posted: false, ask: ask ?? "Which account?", rowId: null },
      };
    }

    const uncategorizedId = await ensureUncategorized(root, categories);
    const refreshed = await listRows(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.categories,
    );
    if (refreshed.ok) {
      categories = refreshed.value.map((r) => ({
        id: r.id,
        name: (r.cells.name as string) ?? "",
      }));
    }
    const categoryId = selectCategory(text, categories);
    const categoryName =
      categories.find((c) => c.id === categoryId)?.name ?? "Uncategorized";

    const amount = resolveAmount(parsed, parsed.isInflow);
    if (amount === null) {
      return {
        ok: true,
        value: { posted: false, ask: "What amount?", rowId: null },
      };
    }

    // Use the existing row id for this thread
    const threads = await readCaptureThreads(root);
    const rowId = threads[threadId];
    if (!rowId) {
      return { ok: false, error: "Nothing to undo" };
    }

    // A correction re-parses the text; it says nothing about where the row came
    // from, so the original the row already cites is carried across rather than
    // cleared. Reading it from the row keeps a correction from unlinking a
    // receipt.
    const existing = await getRow(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.transactions,
      rowId,
    );
    const existingSourceFile = existing.ok && existing.value
      ? (existing.value.cells.source_file ?? null)
      : null;

    const accountName =
      accounts.find((a) => a.id === accountId)?.name ?? "";
    const payee = cleanPayee(parsed.payee, accounts, categories, categoryName);

    const cells = {
      date: parsed.date,
      amount,
      account: accountId,
      category: categoryId,
      payee: parsed.payee,
      // A correction is a new sentence: keep that sentence, not the old payee.
      notes: text,
      source_file: existingSourceFile,
      provenance: `chat:${threadId}`,
      external_id: null,
    };

    const upserted = await upsertRow(
      root,
      FINANCE_DOMAIN_SLUG,
      FINANCE_DB_IDS.transactions,
      { id: rowId, cells },
    );
    if (!upserted.ok) return { ok: false, error: upserted.error };

    const payeeBit = payee ? ` • ${payee}` : "";
    const receipt = `${amount < 0 ? "-" : ""}${Math.abs(amount)} ${parsed.currency} on ${parsed.date} • ${accountName} • ${categoryName}${payeeBit}`;

    return {
      ok: true,
      value: {
        posted: true,
        rowId,
        receipt,
        amount,
        currency: parsed.currency,
        date: parsed.date,
        accountName,
        categoryName,
        payee,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
