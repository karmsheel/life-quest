import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  deleteRow,
  listRows,
  upsertRow,
} from "./domain-databases.ts";
import { readRegistry } from "./domain-databases.ts";
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

function parseDate(text: string, today: string): string {
  // Explicit YYYY-MM-DD wins
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit) return explicit[1];

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

function selectCategory(
  text: string,
  categories: Array<{ id: string; name: string }>,
): string {
  const lower = text.toLowerCase();
  for (const cat of categories) {
    if (cat.name && lower.includes(cat.name.toLowerCase())) {
      return cat.id;
    }
  }
  // Uncategorized
  const uncategorized = categories.find(
    (c) => c.name.toLowerCase() === "uncategorized",
  );
  return uncategorized ? uncategorized.id : "uncategorized";
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

export async function captureUtterance(
  root: string,
  input: {
    text: string;
    today: string;
    threadId: string;
    actor: Actor;
  },
): Promise<Result<CaptureOutcome>> {
  const { text, today, threadId, actor } = input;

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

    const cells = {
      date: parsed.date,
      amount,
      account: accountId,
      category: categoryId,
      payee: parsed.payee,
      notes: null,
      source_file: null,
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

    const payeeBit = parsed.payee ? ` • ${parsed.payee}` : "";
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
        payee: parsed.payee,
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
        payee: parsed.payee,
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

    const accountName =
      accounts.find((a) => a.id === accountId)?.name ?? "";

    const cells = {
      date: parsed.date,
      amount,
      account: accountId,
      category: categoryId,
      payee: parsed.payee,
      notes: null,
      source_file: null,
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

    const payeeBit = parsed.payee ? ` • ${parsed.payee}` : "";
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
        payee: parsed.payee,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
