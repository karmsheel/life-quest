import { atomicWriteFile } from "./atomic-write.ts";
import { vaultPaths } from "./paths.ts";
import {
  FINANCE_DB_IDS,
  FINANCE_DOMAIN_SLUG,
  type Actor,
  type AssumptionDelta,
  type AssumptionSetSaveResult,
  type BudgetVsActualReport,
  type DatabaseRow,
  type DecisionRecord,
  type FinanceCurrency,
  type FinanceMonthPoint,
  type FinanceProjection,
  type NetWorthReport,
  type Result,
  type ScenarioCompareReport,
} from "./types.ts";
import { readRegistry } from "./domain-databases.ts";

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_MONTH = /^(\d{4})-(\d{2})$/;
const VALID_YEAR = /^(\d{4})$/;
const TRANSACTIONAL_TYPES = new Set(["checking", "credit", "cash", "other"]);

export function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r; // normalize -0 to 0
}

async function checkKitInstalled(root: string): Promise<Result<true>> {
  try {
    const paths = vaultPaths(root);
    const metaRaw = await (await import("node:fs/promises")).readFile(
      paths.domainJson(FINANCE_DOMAIN_SLUG),
      "utf8",
    );
    const meta = JSON.parse(metaRaw);
    if (meta.archivedAt != null) {
      return { ok: false, error: "Install the Finance kit first" };
    }
  } catch {
    return { ok: false, error: "Install the Finance kit first" };
  }
  const registry = await readRegistry(
    vaultPaths(root).domainRegistry(FINANCE_DOMAIN_SLUG),
  );
  if (!registry.installedKits.includes("finance")) {
    return { ok: false, error: "Install the Finance kit first" };
  }
  return { ok: true, value: true };
}

async function ensureFinanceTransferColumn(root: string): Promise<void> {
  const paths = vaultPaths(root);
  const registry = await readRegistry(paths.domainRegistry(FINANCE_DOMAIN_SLUG));
  const txnDb = registry.databases.find((d) => d.id === FINANCE_DB_IDS.transactions);
  if (!txnDb) return;
  if (txnDb.columns.some((c) => c.id === "transfer_id")) return;
  txnDb.columns.push({ id: "transfer_id", name: "transfer_id", type: "text" });
  txnDb.updatedAt = new Date().toISOString();
  await atomicWriteFile(
    paths.domainRegistry(FINANCE_DOMAIN_SLUG),
    JSON.stringify(registry, null, 2) + "\n",
  );
}

function isCurrency(c: string): c is FinanceCurrency {
  return c === "ZAR" || c === "USD";
}

async function loadAccounts(
  root: string,
): Promise<Result<{ byId: Map<string, DatabaseRow>; rows: DatabaseRow[] }>> {
  const { listRows } = await import("./domain-databases.ts");
  const res = await listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.accounts);
  if (!res.ok) return res;
  const byId = new Map<string, DatabaseRow>();
  for (const r of res.value) byId.set(r.id, r);
  return { ok: true, value: { byId, rows: res.value } };
}

async function loadHoldingMarks(
  root: string,
  accountsById: Map<string, DatabaseRow>,
): Promise<Result<Map<string, { value: number; currency: FinanceCurrency }>>> {
  const { listRows } = await import("./domain-databases.ts");
  const res = await listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.holdings);
  if (!res.ok) return res;
  const marks = new Map<string, { value: number; currency: FinanceCurrency }>();
  for (const r of res.value) {
    const mv = r.cells.market_value;
    const qty = r.cells.quantity;
    const price = r.cells.price;
    let value: number;
    if (typeof mv === "number" && Number.isFinite(mv)) {
      value = mv;
    } else if (typeof qty === "number" && typeof price === "number" && Number.isFinite(qty) && Number.isFinite(price)) {
      value = qty * price;
    } else {
      value = 0;
    }
    const pc = r.cells.price_currency;
    let currency: FinanceCurrency;
    if (pc === "ZAR" || pc === "USD") {
      currency = pc;
    } else {
      const acct = r.cells.account as string | undefined;
      const acctRow = acct ? accountsById.get(acct) : undefined;
      const ac = acctRow?.cells.currency as string | undefined;
      currency = ac === "ZAR" || ac === "USD" ? ac : "ZAR";
    }
    marks.set(r.id, { value, currency });
  }
  return { ok: true, value: marks };
}

function accountBookAtAsOf(
  account: DatabaseRow,
  txns: DatabaseRow[],
  asOf: string,
): number {
  const opening = account.cells.opening_balance;
  const openingAsOf = account.cells.opening_as_of as string | undefined;
  let total = 0;
  if (typeof opening === "number" && Number.isFinite(opening)) {
    if (!openingAsOf || openingAsOf <= asOf) {
      total = opening;
    }
  }
  for (const t of txns) {
    const acct = t.cells.account;
    if (acct !== account.id) continue;
    const date = t.cells.date as string | undefined;
    if (!date || !VALID_DATE.test(date)) continue;
    if (date > asOf) continue;
    const amount = t.cells.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
    total += amount;
  }
  return total;
}

async function loadTxns(root: string): Promise<Result<DatabaseRow[]>> {
  const { listRows } = await import("./domain-databases.ts");
  return listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.transactions);
}

export async function budgetVsActual(
  root: string,
  input: { asOf: string },
): Promise<Result<BudgetVsActualReport>> {
  const kitRes = await checkKitInstalled(root);
  if (!kitRes.ok) return kitRes;
  if (!VALID_DATE.test(input.asOf)) {
    return { ok: false, error: "asOf must be YYYY-MM-DD" };
  }

  const [budgetsRes, categoriesRes, accountsRes, txnsRes] = await Promise.all([
    (async () => {
      const { listRows } = await import("./domain-databases.ts");
      return listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.budgets);
    })(),
    (async () => {
      const { listRows } = await import("./domain-databases.ts");
      return listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.categories);
    })(),
    loadAccounts(root),
    loadTxns(root),
  ]);
  if (!budgetsRes.ok) return budgetsRes;
  if (!categoriesRes.ok) return categoriesRes;
  if (!accountsRes.ok) return accountsRes;
  if (!txnsRes.ok) return txnsRes;

  const budgets = budgetsRes.value;
  const categories = categoriesRes.value;
  const accountsById = accountsRes.value.byId;
  const txns = txnsRes.value;

  if (budgets.length === 0) {
    return { ok: true, value: { empty: true, lines: [], warnings: [] } };
  }

  const lines: BudgetVsActualReport["lines"] = [];
  const warnings: string[] = [];

  for (const b of budgets) {
    const period = b.cells.period as string | undefined;
    if (!period) {
      warnings.push("budget period unreadable: <blank>");
      continue;
    }
    let monthMatch = VALID_MONTH.exec(period);
    let yearMatch = VALID_YEAR.exec(period);
    if (!monthMatch && !yearMatch) {
      warnings.push(`budget period unreadable: ${period}`);
      continue;
    }

    const amount = b.cells.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      warnings.push("budget amount unreadable");
      continue;
    }
    const currency = b.cells.currency as string | undefined;
    if (!currency || !isCurrency(currency)) {
      warnings.push("budget currency unreadable");
      continue;
    }

    const categoryId = b.cells.category as string | undefined;
    const categoryRow = categories.find((c) => c.id === categoryId);
    const categoryName = categoryRow?.cells.name as string | undefined || categoryId || "";

    // spent = round2(-1 * sum of negative transaction amounts) matching category + currency + period + not transfer
    let spent = 0;
    for (const t of txns) {
      const tid = t.cells.transfer_id as string | undefined;
      if (tid && tid.trim() !== "") continue;
      const tCat = t.cells.category;
      if (tCat !== categoryId) continue;
      const acctId = t.cells.account as string | undefined;
      const acctRow = acctId ? accountsById.get(acctId) : undefined;
      if (!acctRow) continue;
      const acctCurrency = acctRow.cells.currency as string | undefined;
      if (acctCurrency !== currency) continue;
      const date = t.cells.date as string | undefined;
      if (!date || !VALID_DATE.test(date)) continue;

      let inPeriod = false;
      if (monthMatch) {
        inPeriod = date.slice(0, 7) === period;
      } else {
        inPeriod = date.slice(0, 4) === period;
      }
      if (!inPeriod) continue;

      const amt = t.cells.amount;
      if (typeof amt !== "number" || !Number.isFinite(amt)) continue;
      if (amt < 0) spent += amt;
    }

    const spentRounded = round2(-1 * spent);
    lines.push({
      budgetRowId: b.id,
      period,
      categoryId: categoryId || "",
      categoryName,
      currency,
      planned: amount,
      spent: spentRounded,
      remaining: round2(amount - spentRounded),
    });
  }

  return { ok: true, value: { empty: false, lines, warnings } };
}

export async function netWorth(
  root: string,
  input: { asOf: string },
): Promise<Result<NetWorthReport>> {
  const kitRes = await checkKitInstalled(root);
  if (!kitRes.ok) return kitRes;
  if (!VALID_DATE.test(input.asOf)) {
    return { ok: false, error: "asOf must be YYYY-MM-DD" };
  }

  const [accountsRes, txnsRes] = await Promise.all([
    loadAccounts(root),
    loadTxns(root),
  ]);
  if (!accountsRes.ok) return accountsRes;
  if (!txnsRes.ok) return txnsRes;

  const accountsById = accountsRes.value.byId;
  const accounts = accountsRes.value.rows;
  const txns = txnsRes.value;

  const holdingsMarksRes = await loadHoldingMarks(root, accountsById);
  if (!holdingsMarksRes.ok) return holdingsMarksRes;
  const holdingMarks = holdingsMarksRes.value;

  if (accounts.length === 0 && holdingMarks.size === 0) {
    return {
      ok: true,
      value: {
        empty: true,
        asOf: input.asOf,
        byCurrency: { ZAR: 0, USD: 0 },
        zar: 0,
        warnings: [],
      },
    };
  }

  const byCurrency: { ZAR: number; USD: number } = { ZAR: 0, USD: 0 };
  const warnings: string[] = [];

  for (const acct of accounts) {
    const type = acct.cells.type as string | undefined;
    if (!TRANSACTIONAL_TYPES.has(type || "")) continue;
    const currency = acct.cells.currency as string | undefined;
    if (!isCurrency(currency)) continue;
    const book = accountBookAtAsOf(acct, txns, input.asOf);
    byCurrency[currency] = round2(byCurrency[currency] + book);
  }

  for (const [hid, mark] of holdingMarks) {
    byCurrency[mark.currency] = round2(byCurrency[mark.currency] + mark.value);
  }

  const fxRes = await (async () => {
    const registry = await readRegistry(
      vaultPaths(root).domainRegistry(FINANCE_DOMAIN_SLUG),
    );
    return registry.finance?.usdZarRate ?? null;
  })();

  let zar: number | null = byCurrency.ZAR;
  if (byCurrency.USD !== 0) {
    if (typeof fxRes !== "number" || !Number.isFinite(fxRes) || fxRes <= 0) {
      warnings.push("ZAR conversion requires an FX rate");
      zar = null;
    } else {
      zar = round2(zar + byCurrency.USD * fxRes);
    }
  } else {
    zar = round2(zar);
  }

  return {
    ok: true,
    value: { empty: false, asOf: input.asOf, byCurrency, zar, warnings },
  };
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const totalMonths = (year * 12 + (month - 1)) + n;
  return { year: Math.floor(totalMonths / 12), month: (totalMonths % 12) + 1 };
}

function isoMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

function monthContainsDate(horizonMonth: string, dateStr: string): boolean {
  return monthOf(dateStr) === horizonMonth;
}

export async function projectFinance(
  root: string,
  input: { asOf: string; horizonMonths: number; deltas: AssumptionDelta[] },
): Promise<Result<FinanceProjection>> {
  const kitRes = await checkKitInstalled(root);
  if (!kitRes.ok) return kitRes;
  if (!VALID_DATE.test(input.asOf)) {
    return { ok: false, error: "asOf must be YYYY-MM-DD" };
  }
  await ensureFinanceTransferColumn(root);

  let horizon = typeof input.horizonMonths === "number" && Number.isInteger(input.horizonMonths)
    ? input.horizonMonths
    : 12;
  horizon = Math.max(1, Math.min(60, horizon));

  const [accountsRes, txnsRes] = await Promise.all([
    loadAccounts(root),
    loadTxns(root),
  ]);
  if (!accountsRes.ok) return accountsRes;
  if (!txnsRes.ok) return txnsRes;

  const accountsById = accountsRes.value.byId;
  const accounts = accountsRes.value.rows;
  const txns = txnsRes.value;

  const holdingsMarksRes = await loadHoldingMarks(root, accountsById);
  if (!holdingsMarksRes.ok) return holdingsMarksRes;
  const holdingMarks = holdingsMarksRes.value;

  const fxRes = await (async () => {
    const registry = await readRegistry(
      vaultPaths(root).domainRegistry(FINANCE_DOMAIN_SLUG),
    );
    return registry.finance?.usdZarRate ?? null;
  })();

  // Opening cash per currency = transactional books as of asOf
  const cash: { ZAR: number; USD: number } = { ZAR: 0, USD: 0 };
  for (const acct of accounts) {
    const type = acct.cells.type as string | undefined;
    if (!TRANSACTIONAL_TYPES.has(type || "")) continue;
    const currency = acct.cells.currency as string | undefined;
    if (!isCurrency(currency)) continue;
    cash[currency] = round2(cash[currency] + accountBookAtAsOf(acct, txns, input.asOf));
  }

  // Account books at asOf for APR
  const accountBooks = new Map<string, number>();
  for (const acct of accounts) {
    accountBooks.set(acct.id, accountBookAtAsOf(acct, txns, input.asOf));
  }

  // Opening holding marks per currency
  const holdingsCash: { ZAR: number; USD: number } = { ZAR: 0, USD: 0 };
  for (const [, mark] of holdingMarks) {
    holdingsCash[mark.currency] = round2(holdingsCash[mark.currency] + mark.value);
  }

  // Recurring occurrences
  const { listRows } = await import("./domain-databases.ts");
  const recurringRes = await listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.recurring);
  const recurring = recurringRes.ok ? recurringRes.value : [];

  // Build horizon month list
  const asOfYear = Number(input.asOf.slice(0, 4));
  const asOfMonth = Number(input.asOf.slice(5, 7));
  const horizonMonthsList: string[] = [];
  for (let i = 0; i < horizon; i++) {
    const m = addMonths(asOfYear, asOfMonth, i);
    horizonMonthsList.push(isoMonth(m.year, m.month));
  }
  const lastHorizonMonth = horizonMonthsList[horizonMonthsList.length - 1];
  const lastHorizonYear = Number(lastHorizonMonth.slice(0, 4));
  const lastHorizonMon = Number(lastHorizonMonth.slice(5, 7));
  const lastHorizonDay = daysInMonth(lastHorizonYear, lastHorizonMon);
  const lastHorizonDate = `${lastHorizonMonth}-${String(lastHorizonDay).padStart(2, "0")}`;

  // Pre-compute recurring contributions per month (signed)
  const recurringByMonth: { ZAR: number; USD: number }[] = horizonMonthsList.map(() => ({ ZAR: 0, USD: 0 }));

  for (const rec of recurring) {
    const amount = rec.cells.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
    const currency = rec.cells.currency as string | undefined;
    if (!isCurrency(currency)) continue;
    const kind = rec.cells.kind as string | undefined;
    const cadence = rec.cells.cadence as string | undefined;
    const nextDate = rec.cells.next_date as string | undefined;
    if (!nextDate || !VALID_DATE.test(nextDate)) continue;

    // Signed amount
    let signed: number;
    if (amount < 0) {
      signed = amount;
    } else if (kind === "outflow") {
      signed = -amount;
    } else {
      signed = amount;
    }

    // First occurrence >= asOf stepping from next_date
    const nextYear = Number(nextDate.slice(0, 4));
    const nextMon = Number(nextDate.slice(5, 7));
    const nextDay = Number(nextDate.slice(8, 10));

    let occYear = nextYear;
    let occMon = nextMon;
    let occDay = nextDay;

    // Step forward until >= asOf
    const asOfIso = input.asOf;
    while (true) {
      const occIso = `${isoMonth(occYear, occMon)}-${String(clampDay(occYear, occMon, occDay)).padStart(2, "0")}`;
      if (occIso >= asOfIso) break;

      if (cadence === "weekly") {
        const totalMonths = occYear * 12 + (occMon - 1);
        const nextTotalMonths = totalMonths;
        // Add 7 days
        const d = new Date(Date.UTC(occYear, occMon - 1, occDay));
        d.setUTCDate(d.getUTCDate() + 7);
        occYear = d.getUTCFullYear();
        occMon = d.getUTCMonth() + 1;
        occDay = clampDay(occYear, occMon, nextDay);
      } else if (cadence === "yearly") {
        occYear += 1;
        occDay = clampDay(occYear, occMon, occDay);
      } else {
        // monthly
        let m = occMon + 1;
        let y = occYear;
        if (m > 12) { m = 1; y += 1; }
        occYear = y;
        occMon = m;
        occDay = clampDay(occYear, occMon, occDay);
      }
    }

    // Now occ is first >= asOf. Add to each month
    while (true) {
      const occIso = `${isoMonth(occYear, occMon)}-${String(clampDay(occYear, occMon, occDay)).padStart(2, "0")}`;
      if (occIso > lastHorizonDate) break;

      const hMonth = isoMonth(occYear, occMon);
      const idx = horizonMonthsList.indexOf(hMonth);
      if (idx >= 0) {
        recurringByMonth[idx][currency] = round2(recurringByMonth[idx][currency] + signed);
      }

      if (cadence === "weekly") {
        const d = new Date(Date.UTC(occYear, occMon - 1, clampDay(occYear, occMon, occDay)));
        d.setUTCDate(d.getUTCDate() + 7);
        occYear = d.getUTCFullYear();
        occMon = d.getUTCMonth() + 1;
        occDay = clampDay(occYear, occMon, nextDay);
      } else if (cadence === "yearly") {
        occYear += 1;
        occDay = clampDay(occYear, occMon, occDay);
      } else {
        let m = occMon + 1;
        let y = occYear;
        if (m > 12) { m = 1; y += 1; }
        occYear = y;
        occMon = m;
        occDay = clampDay(occYear, occMon, occDay);
      }
    }
  }

  // Warnings for APR/expected return
  const projWarnings: string[] = [];
  const holdingMarkValues = new Map<string, number>();
  for (const [hid, mark] of holdingMarks) {
    holdingMarkValues.set(hid, mark.value);
  }

  const months: FinanceMonthPoint[] = [];
  let currentCash = { ...cash };
  let currentHoldingValues = new Map(holdingMarkValues);

  for (let i = 0; i < horizon; i++) {
    const monthId = horizonMonthsList[i];
    const startCash = { ...currentCash };

    // Interest per currency
    const interest: { ZAR: number; USD: number } = { ZAR: 0, USD: 0 };
    for (const acct of accounts) {
      const type = acct.cells.type as string | undefined;
      if (!TRANSACTIONAL_TYPES.has(type || "")) continue;
      const currency = acct.cells.currency as string | undefined;
      if (!isCurrency(currency)) continue;
      const apr = acct.cells.apr;
      if (typeof apr !== "number" || !Number.isFinite(apr)) {
        if (!projWarnings.some((w) => w === `APR not set: ${acct.cells.name}`)) {
          projWarnings.push(`APR not set: ${acct.cells.name}`);
        }
        continue;
      }
      const book = accountBooks.get(acct.id) ?? 0;
      interest[currency] = round2(interest[currency] + round2(book * apr / 12));
    }

    // Deltas for this month
    const deltaAmount: { ZAR: number; USD: number } = { ZAR: 0, USD: 0 };
    for (const d of input.deltas) {
      const currency = d.currency;
      if (d.kind === "income" || d.kind === "contribution") {
        deltaAmount[currency] += d.amount;
      } else if (d.kind === "extra-payment" || d.kind === "spending-change") {
        deltaAmount[currency] -= d.amount;
      } else if (d.kind === "one-time") {
        if (monthContainsDate(monthId, d.date)) {
          deltaAmount[currency] += d.amount;
        }
      } else {
        if (!projWarnings.includes("assumption delta ignored")) {
          projWarnings.push("assumption delta ignored");
        }
      }
    }

    const endCash: { ZAR: number; USD: number } = {
      ZAR: round2(startCash.ZAR + interest.ZAR + recurringByMonth[i].ZAR + deltaAmount.ZAR),
      USD: round2(startCash.USD + interest.USD + recurringByMonth[i].USD + deltaAmount.USD),
    };

    // Holdings growth
    const endHoldingCash: { ZAR: number; USD: number } = { ZAR: 0, USD: 0 };
    const newHoldingValues = new Map<string, number>();
    for (const [hid, mark] of holdingMarks) {
      const prevValue = currentHoldingValues.get(hid) ?? mark.value;
      const hRow = (await (async () => {
        const { listRows } = await import("./domain-databases.ts");
        const r = await listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.holdings);
        return r.ok ? r.value.find((x) => x.id === hid) : undefined;
      })());
      const er = hRow?.cells.expected_return;
      let newValue = prevValue;
      if (typeof er === "number" && Number.isFinite(er)) {
        newValue = round2(prevValue * (1 + er / 12));
      } else {
        if (!projWarnings.some((w) => w === `expected return not set: ${hRow?.cells.name}`)) {
          projWarnings.push(`expected return not set: ${hRow?.cells.name}`);
        }
      }
      newHoldingValues.set(hid, newValue);
      endHoldingCash[mark.currency] = round2(endHoldingCash[mark.currency] + newValue);
    }
    currentHoldingValues = newHoldingValues;
    currentCash = endCash;

    const byCurr = {
      ZAR: round2(endCash.ZAR + endHoldingCash.ZAR),
      USD: round2(endCash.USD + endHoldingCash.USD),
    };

    let zar: number | null = byCurr.ZAR;
    const monthWarnings: string[] = [];
    if (byCurr.USD !== 0) {
      if (typeof fxRes !== "number" || !Number.isFinite(fxRes) || fxRes <= 0) {
        zar = null;
        monthWarnings.push("ZAR conversion requires an FX rate");
      } else {
        zar = round2(zar + byCurr.USD * fxRes);
      }
    } else {
      zar = round2(zar);
    }

    months.push({ month: monthId, byCurrency: byCurr, zar, warnings: monthWarnings });
  }

  return { ok: true, value: { months, warnings: projWarnings } };
}

export async function scenarioCompare(
  root: string,
  input: { asOf: string; assumptionSetId: string; compareSetId?: string | null },
): Promise<Result<ScenarioCompareReport>> {
  const kitRes = await checkKitInstalled(root);
  if (!kitRes.ok) return kitRes;
  if (!VALID_DATE.test(input.asOf)) {
    return { ok: false, error: "asOf must be YYYY-MM-DD" };
  }

  const { listRows } = await import("./domain-databases.ts");

  const primaryRowRes = await listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.assumptionSets);
  if (!primaryRowRes.ok) return primaryRowRes;
  const primaryRows = primaryRowRes.value;
  const primaryRow = primaryRows.find((r) => r.id === input.assumptionSetId);
  if (!primaryRow) {
    return { ok: false, error: "Assumption set not found" };
  }

  const horizon = (() => {
    const h = primaryRow.cells.horizon_months;
    if (typeof h === "number" && Number.isFinite(h)) {
      return Math.max(1, Math.min(60, h));
    }
    return 12;
  })();

  let primaryDeltas: AssumptionDelta[] = [];
  const primaryWarnings: string[] = [];
  const deltasStr = primaryRow.cells.deltas as string | null | undefined;
  if (deltasStr && deltasStr.trim() !== "") {
    try {
      primaryDeltas = JSON.parse(deltasStr) as AssumptionDelta[];
    } catch {
      primaryWarnings.push("assumption deltas unreadable");
    }
  }

  const liveRes = await projectFinance(root, { asOf: input.asOf, horizonMonths: horizon, deltas: [] });
  if (!liveRes.ok) return liveRes;

  const primaryRes = await projectFinance(root, { asOf: input.asOf, horizonMonths: horizon, deltas: primaryDeltas });
  if (!primaryRes.ok) return primaryRes;
  if (primaryWarnings.length > 0) {
    primaryRes.value.warnings = [...primaryWarnings, ...primaryRes.value.warnings];
  }

  const name = (primaryRow.cells.name as string | undefined) || "Scenario";

  let secondary: FinanceProjection | null = null;
  let compareSetId: string | null = null;
  let compareSetName: string | null = null;

  if (input.compareSetId && input.compareSetId.trim() !== "") {
    compareSetId = input.compareSetId;
    const compareRow = primaryRows.find((r) => r.id === input.compareSetId);
    if (!compareRow) {
      return { ok: false, error: "Assumption set not found" };
    }
    compareSetName = (compareRow.cells.name as string | undefined) || "Scenario";
    const compareHorizon = (() => {
      const h = compareRow.cells.horizon_months;
      if (typeof h === "number" && Number.isFinite(h)) {
        return Math.max(1, Math.min(60, h));
      }
      return 12;
    })();
    let compareDeltas: AssumptionDelta[] = [];
    const cDeltasStr = compareRow.cells.deltas as string | null | undefined;
    if (cDeltasStr && cDeltasStr.trim() !== "") {
      try {
        compareDeltas = JSON.parse(cDeltasStr) as AssumptionDelta[];
      } catch {
        // ignore
      }
    }
    const secRes = await projectFinance(root, { asOf: input.asOf, horizonMonths: compareHorizon, deltas: compareDeltas });
    if (!secRes.ok) return secRes;
    secondary = secRes.value;
  }

  return {
    ok: true,
    value: {
      assumptionSetId: input.assumptionSetId,
      assumptionSetName: name,
      compareSetId,
      compareSetName,
      live: liveRes.value,
      primary: primaryRes.value,
      secondary,
    },
  };
}

export async function saveAssumptionSet(
  root: string,
  input: {
    rowId: string;
    name: string;
    horizonMonths: number;
    deltas: AssumptionDelta[];
    actor: Actor;
  },
): Promise<Result<AssumptionSetSaveResult>> {
  const kitRes = await checkKitInstalled(root);
  if (!kitRes.ok) return kitRes;

  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "Name is required" };
  }
  let horizon = Math.max(1, Math.min(60, input.horizonMonths));

  if (input.actor.type === "agent") {
    const { createDecision } = await import("./decisions.ts");
    const decisionRes = await createDecision(root, {
      target: { type: "assumption-set", rowId: input.rowId },
      proposedBodyMarkdown: JSON.stringify({
        rowId: input.rowId,
        name: input.name,
        horizonMonths: horizon,
        deltas: input.deltas,
      }),
      actor: input.actor,
    });
    if (!decisionRes.ok) return decisionRes;
    return { ok: true, value: { rowId: input.rowId, decision: decisionRes.value } };
  }

  // User actor: upsert
  const { upsertRow } = await import("./domain-databases.ts");
  const res = await upsertRow(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.assumptionSets, {
    id: input.rowId,
    cells: {
      name: input.name,
      horizon_months: horizon,
      deltas: JSON.stringify(input.deltas),
    },
  });
  if (!res.ok) return res;
  return { ok: true, value: { rowId: input.rowId, decision: null } };
}
