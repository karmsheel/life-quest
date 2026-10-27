/**
 * The one number the phone may show.
 *
 * Two rules this module will not break:
 *
 *  - **Never sum across currencies.** A transaction carries no currency of its
 *    own; it comes from its account. ZAR and USD added as one number is a lie,
 *    so a mixed month with no conversion rate reports `value: null` and says
 *    why, rather than a partial total presented as the whole.
 *  - **Transfers are not spend.** Money moving between the operator's own
 *    accounts is not money leaving the household.
 *
 * Net worth is `netWorth`'s own report, not a second calculation: the phone and
 * the Net worth page must never disagree about the same figure.
 */
import fs from "node:fs/promises";
import { listRows, readRegistry } from "./domain-databases.ts";
import { netWorth, round2 } from "./finance-plan.ts";
import { todayLocalIso } from "./period.ts";
import { vaultPaths } from "./paths.ts";
import {
  FINANCE_DB_IDS,
  FINANCE_DOMAIN_SLUG,
  FINANCE_KIT_ID,
  type FinanceCurrency,
  type Result,
} from "./types.ts";
import {
  isPhoneMetricId,
  type PhoneMetricId,
  type PhoneMetricSnapshot,
} from "./phone.ts";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function currencyOf(value: unknown): FinanceCurrency | null {
  return value === "ZAR" || value === "USD" ? value : null;
}

/** Whether the Finance kit is installed and its domain is live. */
async function financeReady(root: string): Promise<boolean> {
  try {
    const meta = JSON.parse(
      await fs.readFile(vaultPaths(root).domainJson(FINANCE_DOMAIN_SLUG), "utf8"),
    ) as { archivedAt?: unknown };
    if (meta.archivedAt != null) return false;
  } catch {
    return false;
  }
  const registry = await readRegistry(
    vaultPaths(root).domainRegistry(FINANCE_DOMAIN_SLUG),
  );
  return registry.installedKits.includes(FINANCE_KIT_ID);
}

type TransactionCell = {
  date: string;
  amount: number;
  account: string | null;
  transferId: string | null;
};

type MonthBook = {
  homeCurrency: FinanceCurrency;
  usdZarRate: number | null;
  accounts: Map<string, FinanceCurrency>;
  txns: TransactionCell[];
};

async function loadMonthBook(root: string): Promise<Result<MonthBook>> {
  const accountsRes = await listRows(
    root,
    FINANCE_DOMAIN_SLUG,
    FINANCE_DB_IDS.accounts,
  );
  if (!accountsRes.ok) return accountsRes;
  const txnsRes = await listRows(
    root,
    FINANCE_DOMAIN_SLUG,
    FINANCE_DB_IDS.transactions,
  );
  if (!txnsRes.ok) return txnsRes;

  const registry = await readRegistry(
    vaultPaths(root).domainRegistry(FINANCE_DOMAIN_SLUG),
  );
  const finance = registry.finance;
  const homeCurrency = currencyOf(finance?.homeCurrency) ?? "ZAR";
  const usdZarRate =
    typeof finance?.usdZarRate === "number" &&
    Number.isFinite(finance.usdZarRate) &&
    finance.usdZarRate > 0
      ? finance.usdZarRate
      : null;

  const accounts = new Map<string, FinanceCurrency>();
  for (const row of accountsRes.value) {
    const currency = currencyOf(row.cells.currency);
    if (currency) accounts.set(row.id, currency);
  }

  const txns: TransactionCell[] = [];
  for (const row of txnsRes.value) {
    const date = row.cells.date;
    const amount = row.cells.amount;
    if (typeof date !== "string" || typeof amount !== "number" || !Number.isFinite(amount)) {
      continue;
    }
    const account =
      typeof row.cells.account === "string" ? row.cells.account : null;
    const transferId =
      typeof row.cells.transfer_id === "string" && row.cells.transfer_id
        ? row.cells.transfer_id
        : null;
    txns.push({ date, amount, account, transferId });
  }

  return {
    ok: true,
    value: { homeCurrency, usdZarRate, accounts, txns },
  };
}

function monthSnapshot(
  book: MonthBook,
  kind: "month_spend" | "month_income",
  today: string,
  now: Date,
): PhoneMetricSnapshot {
  const monthKey = today.slice(0, 7);
  const [year, month] = monthKey.split("-").map(Number);
  const monthName = MONTH_NAMES[(month ?? 1) - 1] ?? String(month);
  const by: Record<FinanceCurrency, number> = { ZAR: 0, USD: 0 };
  let unattached = 0;

  for (const txn of book.txns) {
    if (!txn.date.startsWith(monthKey)) continue;
    if (txn.transferId) continue;
    const currency = txn.account ? book.accounts.get(txn.account) : undefined;
    if (!currency) {
      // A row whose account was deleted cannot be priced honestly; say so
      // rather than silently dropping it into a total.
      unattached += 1;
      continue;
    }
    if (kind === "month_spend") {
      if (txn.amount < 0) by[currency] += -txn.amount;
    } else if (txn.amount > 0) {
      by[currency] += txn.amount;
    }
  }

  const other: FinanceCurrency = book.homeCurrency === "ZAR" ? "USD" : "ZAR";
  const warnings: string[] = [];
  if (unattached > 0) {
    warnings.push(
      `${unattached} transaction${unattached === 1 ? "" : "s"} name${
        unattached === 1 ? "s" : ""
      } an account that is not in the vault and were not counted.`,
    );
  }

  let value: number | null = round2(by[book.homeCurrency]);
  if (by[other] !== 0) {
    if (book.usdZarRate === null) {
      value = null;
      warnings.push(
        `No ${book.homeCurrency} conversion rate is set, so ${other} transactions are not included.`,
      );
    } else {
      const converted =
        book.homeCurrency === "ZAR"
          ? by[other] * book.usdZarRate
          : by[other] / book.usdZarRate;
      value = round2(by[book.homeCurrency] + converted);
    }
  }

  return {
    id: kind,
    label:
      kind === "month_spend"
        ? `Spent in ${monthName} ${year}`
        : `Received in ${monthName} ${year}`,
    value,
    currency: book.homeCurrency,
    secondary: null,
    periodLabel: `${monthName} ${year}`,
    asOf: today,
    computedAt: now.toISOString(),
    warnings,
  };
}

async function netWorthSnapshot(
  root: string,
  today: string,
  now: Date,
): Promise<Result<PhoneMetricSnapshot>> {
  const report = await netWorth(root, { asOf: today });
  if (!report.ok) return report;
  const r = report.value;
  let value: number | null = r.zar;
  let secondary: { currency: FinanceCurrency; value: number } | null = null;
  if (value === null) {
    // No conversion rate: report both books rather than inventing one. The
    // phone renders the secondary only when there is something to render.
    value = round2(r.byCurrency.ZAR);
    if (r.byCurrency.USD !== 0) {
      secondary = { currency: "USD", value: round2(r.byCurrency.USD) };
    }
  }
  return {
    ok: true,
    value: {
      id: "net_worth",
      label: "Net worth",
      value,
      currency: "ZAR",
      secondary,
      periodLabel: `as of ${today}`,
      asOf: today,
      computedAt: now.toISOString(),
      warnings: [...r.warnings],
    },
  };
}

/**
 * The pinned metric's snapshot. `null` is a valid answer: the operator has not
 * pinned one, and the phone says so rather than choosing for them.
 */
export async function phoneMetric(
  root: string,
  id: PhoneMetricId | null,
  now: Date = new Date(),
): Promise<Result<PhoneMetricSnapshot | null>> {
  if (id === null) return { ok: true, value: null };
  if (!isPhoneMetricId(id)) return { ok: false, error: "Unknown phone metric" };
  if (!(await financeReady(root))) {
    return { ok: false, error: "Install the Finance kit first" };
  }
  const today = todayLocalIso(now);
  if (id === "net_worth") return netWorthSnapshot(root, today, now);

  const book = await loadMonthBook(root);
  if (!book.ok) return book;
  return { ok: true, value: monthSnapshot(book.value, id, today, now) };
}
