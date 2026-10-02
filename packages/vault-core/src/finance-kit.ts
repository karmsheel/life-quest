import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  ensureVaultDatabaseGitignore,
  isDomainLive,
  listRows,
  readRegistry,
} from "./domain-databases.ts";
import {
  FINANCE_KIT_ID,
  FINANCE_DOMAIN_SLUG,
  FINANCE_DB_IDS,
  FINANCE_PAGE_IDS,
  type Actor,
  type DatabaseColumn,
  type DatabaseMeta,
  type DomainDatabaseRegistry,
  type FinanceKitSettings,
  type KitInstallResult,
  type Pin,
  type PinWriteResult,
  type Result,
  type PageRecord,
} from "./types.ts";
import { USER_ACTOR } from "./types.ts";

// Re-export constants
export const FINANCE_KIT_ID_CONST = FINANCE_KIT_ID;
export const FINANCE_DOMAIN_SLUG_CONST = FINANCE_DOMAIN_SLUG;
export { FINANCE_DB_IDS, FINANCE_PAGE_IDS };

const FINANCE_DB_DEFS: Array<{
  id: string;
  name: string;
  columns: Array<{ id: string; name: string; type: string; options?: string[]; relationDatabaseId?: string }>;
}> = [
  {
    id: FINANCE_DB_IDS.accounts,
    name: "Accounts",
    columns: [
      { id: "name", name: "name", type: "text" },
      { id: "type", name: "type", type: "select", options: ["checking", "credit", "cash", "brokerage", "property", "other"] },
      { id: "currency", name: "currency", type: "select", options: ["ZAR", "USD"] },
      { id: "opening_balance", name: "opening_balance", type: "number" },
      { id: "opening_as_of", name: "opening_as_of", type: "date" },
      { id: "apr", name: "apr", type: "number" },
    ],
  },
  {
    id: FINANCE_DB_IDS.categories,
    name: "Categories",
    columns: [
      { id: "name", name: "name", type: "text" },
    ],
  },
  {
    id: FINANCE_DB_IDS.transactions,
    name: "Transactions",
    columns: [
      { id: "date", name: "date", type: "date" },
      { id: "amount", name: "amount", type: "number" },
      { id: "account", name: "account", type: "relation", relationDatabaseId: FINANCE_DB_IDS.accounts },
      { id: "category", name: "category", type: "relation", relationDatabaseId: FINANCE_DB_IDS.categories },
      { id: "payee", name: "payee", type: "text" },
      { id: "notes", name: "notes", type: "text" },
      { id: "source_file", name: "source_file", type: "file" },
      { id: "provenance", name: "provenance", type: "text" },
      { id: "external_id", name: "external_id", type: "text" },
      { id: "transfer_id", name: "transfer_id", type: "text" },
    ],
  },
  {
    id: FINANCE_DB_IDS.budgets,
    name: "Budgets",
    columns: [
      { id: "period", name: "period", type: "text" },
      { id: "category", name: "category", type: "relation", relationDatabaseId: FINANCE_DB_IDS.categories },
      { id: "amount", name: "amount", type: "number" },
      { id: "currency", name: "currency", type: "select", options: ["ZAR", "USD"] },
    ],
  },
  {
    id: FINANCE_DB_IDS.recurring,
    name: "Recurring",
    columns: [
      { id: "name", name: "name", type: "text" },
      { id: "amount", name: "amount", type: "number" },
      { id: "currency", name: "currency", type: "select", options: ["ZAR", "USD"] },
      { id: "cadence", name: "cadence", type: "select", options: ["weekly", "monthly", "yearly"] },
      { id: "next_date", name: "next_date", type: "date" },
      { id: "account", name: "account", type: "relation", relationDatabaseId: FINANCE_DB_IDS.accounts },
      { id: "category", name: "category", type: "relation", relationDatabaseId: FINANCE_DB_IDS.categories },
      { id: "kind", name: "kind", type: "select", options: ["inflow", "outflow"] },
    ],
  },
  {
    id: FINANCE_DB_IDS.holdings,
    name: "Holdings",
    columns: [
      { id: "name", name: "name", type: "text" },
      { id: "account", name: "account", type: "relation", relationDatabaseId: FINANCE_DB_IDS.accounts },
      { id: "quantity", name: "quantity", type: "number" },
      { id: "price", name: "price", type: "number" },
      { id: "market_value", name: "market_value", type: "number" },
      { id: "price_currency", name: "price_currency", type: "select", options: ["ZAR", "USD"] },
      { id: "as_of", name: "as_of", type: "date" },
      { id: "expected_return", name: "expected_return", type: "number" },
    ],
  },
  {
    id: FINANCE_DB_IDS.assumptionSets,
    name: "Assumption sets",
    columns: [
      { id: "name", name: "name", type: "text" },
      { id: "horizon_months", name: "horizon_months", type: "number" },
      { id: "deltas", name: "deltas", type: "text" },
    ],
  },
];

function columnIds(columns: Array<{ id: string }>): Set<string> {
  return new Set(columns.map((c) => c.id));
}

function mergeColumns(
  existing: DatabaseColumn[],
  defColumns: Array<{ id: string; name: string; type: string; options?: string[]; relationDatabaseId?: string }>,
): DatabaseColumn[] {
  const result = [...existing];
  const existingIds = columnIds(existing);
  for (const dc of defColumns) {
    if (!existingIds.has(dc.id)) {
      result.push({
        id: dc.id,
        name: dc.name,
        type: dc.type as DatabaseColumn["type"],
        ...(dc.options ? { options: dc.options } : {}),
        ...(dc.relationDatabaseId ? { relationDatabaseId: dc.relationDatabaseId } : {}),
      });
    }
  }
  return result;
}

async function mergeRegistry(root: string): Promise<DomainDatabaseRegistry> {
  const paths = vaultPaths(root);
  const registry = await readRegistry(paths.domainRegistry(FINANCE_DOMAIN_SLUG));
  const existingIds = new Set(registry.databases.map((d) => d.id));
  const now = new Date().toISOString();

  for (const def of FINANCE_DB_DEFS) {
    const existing = registry.databases.find((d) => d.id === def.id);
    if (existing) {
      existing.columns = mergeColumns(existing.columns, def.columns);
      existing.updatedAt = now;
    } else {
      registry.databases.push({
        id: def.id,
        name: def.name,
        sotMode: "local-canonical-mirror",
        adapter: null,
        columns: mergeColumns([], def.columns),
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return registry;
}

function buildRegistryForWrite(registry: DomainDatabaseRegistry): DomainDatabaseRegistry {
  return { ...registry };
}

async function writeRegistry(root: string, registry: DomainDatabaseRegistry): Promise<void> {
  const paths = vaultPaths(root);
  const existing = await readRegistry(paths.domainRegistry(FINANCE_DOMAIN_SLUG));
  const merged: DomainDatabaseRegistry = {
    schemaVersion: 1,
    databases: registry.databases,
    installedKits: Array.from(new Set([...existing.installedKits, ...registry.installedKits])),
    finance: registry.finance ?? existing.finance,
  };
  await atomicWriteFile(paths.domainRegistry(FINANCE_DOMAIN_SLUG), JSON.stringify(merged, null, 2) + "\n");
}

async function writeStarterPages(root: string): Promise<void> {
  const paths = vaultPaths(root);
  const pagesDir = paths.domainPagesDir(FINANCE_DOMAIN_SLUG);
  await fs.mkdir(pagesDir, { recursive: true });

  const now = new Date().toISOString();

  const pages: Array<{ id: string; title: string; blocks: unknown[] }> = [
    {
      id: FINANCE_PAGE_IDS.ledger,
      title: "Ledger",
      blocks: [
        { id: "ledger-intro", kind: "markdown", markdown: "Transaction history across all accounts." },
        { id: "ledger-table", kind: "bound-table", databaseId: FINANCE_DB_IDS.transactions },
      ],
    },
    {
      id: FINANCE_PAGE_IDS.spend,
      title: "Spend",
      blocks: [
        { id: "spend-intro", kind: "markdown", markdown: "Where money goes." },
        { id: "spend-metric", kind: "metric", databaseId: FINANCE_DB_IDS.transactions, columnId: "amount", agg: "sum" },
        { id: "spend-chart", kind: "chart", chartType: "bar", databaseId: FINANCE_DB_IDS.transactions, xColumnId: "date", yColumnId: "amount" },
      ],
    },
    {
      id: FINANCE_PAGE_IDS.budget,
      title: "Budget",
      blocks: [
        { id: "budget-block", kind: "budget-vs-actual" },
      ],
    },
    {
      id: FINANCE_PAGE_IDS.netWorth,
      title: "Net worth",
      blocks: [
        { id: "net-worth-block", kind: "net-worth" },
      ],
    },
    {
      id: FINANCE_PAGE_IDS.scenario1,
      title: "Scenario 1",
      blocks: [
        { id: "scenario1-intro", kind: "markdown", markdown: "First planning scenario." },
        { id: "scenario1-compare", kind: "scenario-compare", assumptionSetId: "finance-assumption-scenario-1" },
      ],
    },
    {
      id: FINANCE_PAGE_IDS.scenario2,
      title: "Scenario 2",
      blocks: [
        { id: "scenario2-intro", kind: "markdown", markdown: "Second planning scenario." },
        { id: "scenario2-compare", kind: "scenario-compare", assumptionSetId: "finance-assumption-scenario-2" },
      ],
    },
  ];

  for (const p of pages) {
    const filePath = paths.domainPage(FINANCE_DOMAIN_SLUG, p.id);
    const page: PageRecord = {
      id: p.id,
      domainSlug: FINANCE_DOMAIN_SLUG,
      title: p.title,
      blocks: p.blocks as PageRecord["blocks"],
      createdAt: now,
      updatedAt: now,
    };
    await atomicWriteFile(filePath, `${JSON.stringify(page, null, 2)}\n`);
  }
}

async function insertAssumptionSets(root: string): Promise<void> {
  const { upsertRow } = await import("./domain-databases.ts");
  const id1 = "finance-assumption-scenario-1";
  const id2 = "finance-assumption-scenario-2";

  const existing1 = await listRows(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.assumptionSets);
  const has1 = existing1.ok && existing1.value.some((r) => r.id === id1);
  const has2 = existing1.ok && existing1.value.some((r) => r.id === id2);

  if (!has1) {
    await upsertRow(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.assumptionSets, {
      id: id1,
      cells: { name: "Scenario 1", horizon_months: 12, deltas: "" },
    });
  }
  if (!has2) {
    await upsertRow(root, FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS.assumptionSets, {
      id: id2,
      cells: { name: "Scenario 2", horizon_months: 12, deltas: "" },
    });
  }
}

async function writeFinancialPins(root: string): Promise<void> {
  const paths = vaultPaths(root);
  const pinsPath = paths.domainPins(FINANCE_DOMAIN_SLUG);
  await fs.mkdir(path.dirname(pinsPath), { recursive: true });

  const pins: Pin[] = [
    { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
    { id: "sys:deadline", kind: "system", system: "deadline" },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.ledger}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.ledger },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.spend}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.spend },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.budget}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.budget },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.netWorth}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.netWorth },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.scenario1}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.scenario1 },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.scenario2}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.scenario2 },
  ];

  const board = { schemaVersion: 1, pins };
  await atomicWriteFile(pinsPath, `${JSON.stringify(board, null, 2)}\n`);
}

async function mergeOverviewPins(root: string): Promise<void> {
  const paths = vaultPaths(root);
  const overviewPath = paths.overviewPins;
  await fs.mkdir(path.dirname(overviewPath), { recursive: true });

  let board: { schemaVersion?: number; pins: Pin[] } | null = null;
  try {
    const raw = await fs.readFile(overviewPath, "utf8");
    board = JSON.parse(raw);
  } catch {
    board = null;
  }

  let pins: Pin[];
  if (!board || !Array.isArray(board.pins)) {
    // Missing: start from defaultPins()
    const { defaultPins } = await import("./pins.ts");
    pins = defaultPins();
  } else {
    pins = board.pins;
  }

  const presentIds = new Set(pins.map((p) => p.id));

  // Ensure goal-progress and deadline are at front if missing
  const frontPins: Pin[] = [];
  if (!presentIds.has("sys:goal-progress")) {
    frontPins.push({ id: "sys:goal-progress", kind: "system", system: "goal-progress" });
  }
  if (!presentIds.has("sys:deadline")) {
    frontPins.push({ id: "sys:deadline", kind: "system", system: "deadline" });
  }
  if (frontPins.length > 0) {
    pins = [...frontPins, ...pins];
  }

  // Append the six starter page pins if not present
  const pagePins: Pin[] = [
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.ledger}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.ledger },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.spend}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.spend },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.budget}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.budget },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.netWorth}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.netWorth },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.scenario1}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.scenario1 },
    { id: `page:${FINANCE_DOMAIN_SLUG}:${FINANCE_PAGE_IDS.scenario2}`, kind: "page", domainSlug: FINANCE_DOMAIN_SLUG, pageId: FINANCE_PAGE_IDS.scenario2 },
  ];
  const presentPageIds = new Set(
    pins
      .filter((p) => p.kind === "page")
      .map((p) => `${p.domainSlug}:${p.pageId}`),
  );
  for (const pp of pagePins) {
    const key = `${pp.domainSlug}:${pp.pageId}`;
    if (!presentPageIds.has(key)) {
      pins = [...pins, pp];
    }
  }

  const newBoard = { schemaVersion: 1, pins };
  await atomicWriteFile(overviewPath, `${JSON.stringify(newBoard, null, 2)}\n`);
}

/**
 * The actual install write path — used by both user install and approved Decision.
 * Does NOT create Decisions.
 */
export async function applyFinanceKitInstall(
  root: string,
  actor: Actor = USER_ACTOR,
): Promise<Result<KitInstallResult>> {
  // 1. Refuse if financial is missing or archived
  const paths = vaultPaths(root);
  const slug = FINANCE_DOMAIN_SLUG;

  let metaRaw: string;
  try {
    metaRaw = await fs.readFile(paths.domainJson(slug), "utf8");
  } catch {
    return { ok: false, error: `Domain not found or archived: ${slug}` };
  }
  try {
    const meta = JSON.parse(metaRaw);
    if (meta.archivedAt != null) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
  } catch {
    return { ok: false, error: `Domain not found or archived: ${slug}` };
  }

  // 2. Ensure financial exists; check already installed
  const registryPath = paths.domainRegistry(slug);
  const registry = await readRegistry(registryPath);
  if (registry.installedKits.includes(FINANCE_KIT_ID)) {
    return { ok: true, value: { applied: true, alreadyInstalled: true } };
  }

  // 3. Create data/ + pages/ if needed
  await fs.mkdir(paths.domainDataDir(slug), { recursive: true });
  await fs.mkdir(paths.domainPagesDir(slug), { recursive: true });

  // 4. Merge kit databases into registry
  const merged = await mergeRegistry(root);

  // 5. Set installedKits to include "finance"
  merged.installedKits = Array.from(new Set([...merged.installedKits, FINANCE_KIT_ID]));

  // 6. Set finance settings if missing
  const financeSettings: FinanceKitSettings = merged.finance ?? { homeCurrency: "ZAR", usdZarRate: null, usdZarAsOf: null, defaultCaptureAccountId: null };
  // Ensure defaultCaptureAccountId is present even if settings existed before
  financeSettings.defaultCaptureAccountId = financeSettings.defaultCaptureAccountId ?? null;
  merged.finance = financeSettings;

  // Write registry (merge with existing to preserve operator-created generic DBs)
  await writeRegistry(root, merged);

  // Open/create sqlite to ensure rows table exists
  const { DatabaseSync } = await import("node:sqlite");
  const sqlitePath = paths.domainSqlite(slug);
  const sqlite = new DatabaseSync(sqlitePath);
  sqlite.exec("PRAGMA journal_mode=WAL;");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS rows (
    database_id TEXT NOT NULL,
    id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cells TEXT NOT NULL,
    PRIMARY KEY (database_id, id)
  );`);
  sqlite.close();

  // Gitignore
  await ensureVaultDatabaseGitignore(root);

  // 7. Write starter pages
  await writeStarterPages(root);

  // 8. Insert assumption sets
  await insertAssumptionSets(root);

  // 9. Write pins
  await writeFinancialPins(root);
  await mergeOverviewPins(root);

  // 10. Log kit.installed
  await appendLog(root, {
    domainSlug: slug,
    type: "kit.installed",
    summary: `Installed finance kit into ${slug}`,
    payload: { kit: FINANCE_KIT_ID, domainSlug: slug },
    actor,
  });

  return { ok: true, value: { applied: true, alreadyInstalled: false } };
}

/**
 * Public API: install Finance kit.
 * - missing/archived financial → error
 * - already installed → { applied: true, alreadyInstalled: true } (no writes, no log)
 * - actor.agent → create Decision, do NOT write
 * - actor.user → perform install
 */
export async function installFinanceKit(root: string, actor: Actor): Promise<Result<KitInstallResult>> {
  // Check if already installed first (fast path — no writes for already-installed)
  const paths = vaultPaths(root);
  const slug = FINANCE_DOMAIN_SLUG;

  // Validate financial exists and is live
  try {
    const metaRaw = await fs.readFile(paths.domainJson(slug), "utf8");
    const meta = JSON.parse(metaRaw);
    if (meta.archivedAt != null) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
  } catch {
    return { ok: false, error: `Domain not found or archived: ${slug}` };
  }

  // Check already installed
  const registry = await readRegistry(paths.domainRegistry(slug));
  if (registry.installedKits.includes(FINANCE_KIT_ID)) {
    return { ok: true, value: { applied: true, alreadyInstalled: true } };
  }

  // Agent actor → create Decision, do NOT write
  if (actor.type === "agent") {
    const { createDecision } = await import("./decisions.ts");
    const decisionRes = await createDecision(root, {
      target: { type: "kit-install", kit: "finance" },
      proposedBodyMarkdown: JSON.stringify({ kit: FINANCE_KIT_ID }),
      actor,
    });
    if (!decisionRes.ok) return decisionRes;
    return { ok: true, value: { applied: false, decision: decisionRes.value } };
  }

  // User actor → perform install
  return applyFinanceKitInstall(root);
}

export async function listInstalledKits(root: string, slug: string): Promise<Result<string[]>> {
  try {
    const paths = vaultPaths(root);
    const registry = await readRegistry(paths.domainRegistry(slug));
    return { ok: true, value: registry.installedKits };
  } catch {
    return { ok: true, value: [] };
  }
}

export async function getFinanceKitSettings(root: string): Promise<Result<FinanceKitSettings | null>> {
  try {
    const paths = vaultPaths(root);
    const registry = await readRegistry(paths.domainRegistry(FINANCE_DOMAIN_SLUG));
    return { ok: true, value: registry.finance ?? null };
  } catch {
    return { ok: true, value: null };
  }
}

export async function setFinanceCaptureAccount(
  root: string,
  accountRowId: string | null,
): Promise<Result<FinanceKitSettings>> {
  // 1. Refuse if kit is missing or financial is archived
  const paths = vaultPaths(root);
  const slug = FINANCE_DOMAIN_SLUG;

  let metaRaw: string;
  try {
    metaRaw = await fs.readFile(paths.domainJson(slug), "utf8");
  } catch {
    return { ok: false, error: `Domain not found or archived: ${slug}` };
  }
  try {
    const meta = JSON.parse(metaRaw);
    if (meta.archivedAt != null) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
  } catch {
    return { ok: false, error: `Domain not found or archived: ${slug}` };
  }

  const registry = await readRegistry(paths.domainRegistry(slug));
  if (!registry.installedKits.includes(FINANCE_KIT_ID)) {
    return { ok: false, error: "Install the Finance kit first" };
  }

  // 2. null clears the setting
  if (accountRowId === null) {
    if (!registry.finance) {
      registry.finance = { homeCurrency: "ZAR", usdZarRate: null, usdZarAsOf: null, defaultCaptureAccountId: null };
    } else {
      registry.finance.defaultCaptureAccountId = null;
    }
    await atomicWriteFile(paths.domainRegistry(slug), JSON.stringify(registry, null, 2) + "\n");
    return { ok: true, value: registry.finance };
  }

  // 3. Validate: row must exist, be in accounts DB, be transactional
  const accounts = await listRows(root, slug, FINANCE_DB_IDS.accounts);
  if (!accounts.ok) return accounts;

  const account = accounts.value.find((r) => r.id === accountRowId);
  if (!account) {
    return { ok: false, error: `Unknown account row: ${accountRowId}` };
  }

  const type = account.cells.type as string;
  if (!["checking", "credit", "cash", "other"].includes(type)) {
    return { ok: false, error: `Account ${account.cells.name} is not a transactional account` };
  }

  // 4. Write
  if (!registry.finance) {
    registry.finance = { homeCurrency: "ZAR", usdZarRate: null, usdZarAsOf: null, defaultCaptureAccountId: accountRowId };
  } else {
    registry.finance.defaultCaptureAccountId = accountRowId;
  }
  await atomicWriteFile(paths.domainRegistry(slug), JSON.stringify(registry, null, 2) + "\n");
  return { ok: true, value: registry.finance };
}
