import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  addDatabaseColumn,
  createDatabase,
  createDecision,
  createVault,
  getDatabase,
  listDecisions,
  unlockDomain,
  upsertRow,
  type DecisionRecord,
} from "@lifequest/vault-core";

/**
 * The decision:list memo, end to end, through the REAL main process, the REAL
 * preload bridge and a REAL vault on disk.
 *
 * WHY THIS RIG EXISTS
 *
 * The operator reported that approving Decisions is slow. Measured on their own
 * vault (819 Decision files), one `decision:list` costs ~1.1-2.1 s — it reads and
 * parses every Decision file and then resolves display labels for database-row
 * cards — and one approve press asked for the list five or six times, serialised
 * behind the main process's single vault write queue. The fix is a per-open-vault
 * memo of the LABELED list in `electron/decision-list-cache.ts`, wired into
 * `decisionList()`: a cold read goes to disk once, the repeat is served from the
 * memo, a Decision write patches the cached record instead of throwing the memo
 * away, and any OTHER mutating channel (plus a vault open/switch, an MCP tool
 * write and a window focus) invalidates it so a file changed by a sync client or
 * the companion is never invisible.
 *
 * WHAT THIS RIG PROVES
 *
 *   1. COLD: a throwaway vault seeded with 600 Decisions (594 resolved history,
 *      six pending, 91 database-row cards whose relation cells must resolve to
 *      labels) lists every record, statuses intact and labels resolved.
 *   2. WARM: the immediately repeated read returns the same records (count and a
 *      hash of the whole list) in < 150 ms, dramatically faster than cold.
 *   3. RESOLVE: `decision:resolve` through the bridge, then `decision:list` —
 *      the card is approved with the exact `resolvedAt` the write returned, it
 *      is NEVER handed back as still pending, and the read is still warm-speed
 *      (the cached record was patched, not re-read from disk).
 *   4. CREATE: `decision:create` through the bridge appears in the very next
 *      list, at warm speed.
 *   5. INVALIDATION: a non-decision mutating channel (`db:upsertRow` on a seeded
 *      database) forces a fresh disk read — hundreds of ms again, the control
 *      that proves "warm" was the memo and not the OS page cache — and the list
 *      is still correct.
 *   6. OPTIONAL focus: a Decision JSON written directly on disk is invisible
 *      until a real window focus invalidates the memo. The driver counts real
 *      `focus` events; if the headless window never focuses, the leg is recorded
 *      as not-covered and the external file is proven valid through a forced
 *      invalidation instead of being faked.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The main process or bridge is stubbed. It is not: the rig spawns Electron
 *      with `e2e/decisions-list-cache.electron.mjs`, which imports
 *      `../dist-electron/main.js` and calls `bootForE2e()`, and every call is
 *      made from the app's own page through `window.lifequest.*` (the preload).
 *   2. The vault is the operator's. It is not: `LIFEQUEST_E2E` points userData at
 *      a temp dir, the vault is a throwaway `createVault()` world in a temp dir,
 *      `HERMES_HOME` is a temp dir with a stub `hermes` first on PATH, and the
 *      MCP doors are moved to free ports.
 *   3. "Warm" is fast because the files are in the OS page cache. The invalidation
 *      leg runs the SAME read after a non-decision write and requires it to be
 *      slow again; that is the control.
 *   4. The cold read was already warm because some renderer path read the list
 *      first. The world boots onto CompanionSetupScreen (no companion), which
 *      has no Decision reader, and the cold leg asserts a real disk read
 *      (>= 300 ms or >= 3x the warm read). A pre-warmed first read fails loudly.
 *   5. A resolve is only checked for status. The check also compares the listed
 *      `resolvedAt` to the value the write returned, and requires the patched
 *      read to be under 150 ms.
 *   6. The driver's own word is taken for it. The test re-reads the artifact and
 *      restates every required fact by name (counts, hashes, timings, statuses),
 *      so a regression fails on the field rather than on a generic exit code.
 *
 * SKIP: never, deliberately. A skipped rig is evidence of nothing (AGENTS.md);
 * with no dev server on 5173 the rig fails and says to use the bench wrapper:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> tests/decisions-list-cache-e2e.test.ts
 *
 * Artifact: `e2e/artifacts/decisions-list-cache.json`.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/decisions-list-cache.electron.mjs");
const REPORT = path.join(ARTIFACTS, "decisions-list-cache.json");
const DEV_PORT = 5173;

/** The profile no real Hermes install has. */
const PROFILE = "lq-decisions-cache-e2e";

/**
 * The seeded world, in one place: 600 Decisions, of which 594 are resolved
 * history (90 of those database-row cards that need display labels), 5 pending
 * board changes, and 1 pending database-row card the rig approves through the
 * bridge.
 */
const SEED = {
  total: 600,
  historyResolved: 594,
  historyRows: 90,
  pendingPins: 5,
  expectedStatuses: { pending: 6, approved: 396, rejected: 198 },
} as const;

type Check = { label: string; pass: boolean; detail: string | null };

type FocusedRecord = {
  present: boolean;
  status?: string;
  resolvedAt?: string | null;
  title?: string;
  targetType?: string;
};

type ListLeg = {
  ms: number;
  ok: boolean | null;
  count: number | null;
  hash: number | null;
  statuses: { pending: number; approved: number; rejected: number; other: number } | null;
  byId?: Record<string, FocusedRecord>;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  observations: { label: string; value: unknown }[];
  what?: string;
  why?: string;
  ranAt?: string;
  world?: {
    profile: string;
    vaultDir: string;
    vaultId: string;
    seed: {
      total: number;
      expectedStatuses: { pending: number; approved: number; rejected: number };
      resolveTargetId: string;
      externalTemplateId: string;
      database: { slug: string; accountsId: string; accountsNameColumnId: string; transactionsId: string };
    };
    screen: { hash: string; route: string; hasBridge: boolean; setupHeading: string };
    snapshotDecisions: number | null;
    window: { focusedAtStart: boolean; focusedAfterBlur: boolean; focusEvents: number };
  };
  timings?: { leg: string; ms: number }[];
  bars?: { warmMaxMs: number; freshMinMs: number; freshRatio: number };
  legs?: {
    cold: ListLeg & { bytes: number | null; databaseRow: { id: string; labelsResolved: boolean; cellLabels: Record<string, string> | null; columnNames: Record<string, string> | null; cellCount: number } | null };
    warm: ListLeg & { sameRecordsAsCold: boolean; speedup: number | null };
    resolve: {
      write: { ok: boolean; error?: string; status: string | null; resolvedAt: string | null; id: string | null };
      listMs: number;
      listed: FocusedRecord;
      statusHistogram: ListLeg["statuses"];
      labelsOnResolvedRecord: { labelsResolved: boolean } | null;
    };
    create: {
      write: { ok: boolean; error?: string; id: string | null; status: string | null };
      listMs: number;
      listed: FocusedRecord;
      statusHistogram: ListLeg["statuses"];
    };
    invalidation: {
      channel: string;
      writeOk: boolean | null;
      listMs: number;
      warmBeforeMs: number;
      looksFresh: boolean;
      count: number | null;
      statusHistogram: ListLeg["statuses"];
      created: FocusedRecord | null;
      resolved: FocusedRecord | null;
    };
    concurrentColdReads: { ms: number | null; ok: boolean | null; counts: number[] | null; singleFreshReadMs: number } | null;
    focus: {
      status: "covered" | "not-covered";
      externalId?: string;
      reason?: string;
      memoStaleBeforeFocus?: boolean;
      visibleAfterFocus?: boolean;
      readAfterFocusMs?: number;
      focusEvents?: number;
      focusEventsBefore?: number;
      focusEventsAfter?: number;
      isFocused?: Record<string, boolean>;
    };
  };
  notes?: string[];
};

type World = {
  dir: string;
  hermesHome: string;
  userData: string;
  vaultDir: string;
  vaultId: string;
  binDir: string;
  worldFile: string;
  mcpPorts: { local: number; invite: number };
  seed: SeedInfo;
};

type SeedInfo = {
  total: number;
  historyRows: number;
  expectedStatuses: { pending: number; approved: number; rejected: number };
  dbRowPendingId: string;
  externalTemplateId: string;
  database: {
    slug: string;
    accountsId: string;
    accountsNameColumnId: string;
    transactionsId: string;
  };
};

type DriverOutcome = { code: number | null; stdout: string; stderr: string };

const USER = { type: "user" } as const;

/** The Vite dev server, without which the app's window has nothing to load. */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

/** A port nothing is listening on, asked by binding it rather than guessing. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** A decision file written straight into the inbox directory (history seeding). */
function writeDecisionFile(
  decisionsDir: string,
  record: DecisionRecord,
): void {
  fs.writeFileSync(
    path.join(decisionsDir, `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Seed the throwaway vault with real DBs and 600 real Decision files.
 *
 * The database-row cards are the ones that need display labels: their payload
 * carries a relation cell holding the account row's id, so a correct
 * `decision:list` must resolve that id to the account's name (and the column ids
 * to column names) before it hands the list over.
 */
async function seedVault(vaultDir: string): Promise<SeedInfo> {
  const unlocked = await unlockDomain(vaultDir, "financial");
  assert.equal(
    unlocked.ok,
    true,
    unlocked.ok ? "" : `unlockDomain(financial) failed: ${unlocked.error}`,
  );

  // ── the accounts database the row cards point at ─────────────────────────
  const accounts = await createDatabase(vaultDir, "financial", {
    name: "Accounts",
  });
  assert.equal(
    accounts.ok,
    true,
    accounts.ok ? "" : `createDatabase(Accounts) failed: ${accounts.error}`,
  );
  if (!accounts.ok) throw new Error("accounts database was not created");
  const accountsId = accounts.value.id;
  const accountsName = await addDatabaseColumn(vaultDir, "financial", accountsId, {
    name: "name",
    type: "text",
  });
  assert.equal(
    accountsName.ok,
    true,
    accountsName.ok ? "" : `addDatabaseColumn(Accounts.name) failed: ${accountsName.error}`,
  );
  const accountsMeta = await getDatabase(vaultDir, "financial", accountsId);
  assert.equal(accountsMeta.ok, true);
  if (!accountsMeta.ok) throw new Error("accounts database could not be read");
  const accountsNameColumnId = accountsMeta.value.columns.find(
    (column) => column.name === "name",
  )?.id;
  assert.ok(accountsNameColumnId, "the accounts database has no name column id");

  const accountRow = await upsertRow(vaultDir, "financial", accountsId, {
    cells: { [accountsNameColumnId]: "Everyday account" },
  });
  assert.equal(
    accountRow.ok,
    true,
    accountRow.ok ? "" : `upsertRow(Accounts) failed: ${accountRow.error}`,
  );
  if (!accountRow.ok) throw new Error("the account row was not written");

  // ── the transactions database the Decision bodies write into ─────────────
  const transactions = await createDatabase(vaultDir, "financial", {
    name: "Transactions",
  });
  assert.equal(
    transactions.ok,
    true,
    transactions.ok ? "" : `createDatabase(Transactions) failed: ${transactions.error}`,
  );
  if (!transactions.ok) throw new Error("transactions database was not created");
  const transactionsId = transactions.value.id;
  for (const column of [
    { name: "payee", type: "text" as const },
    { name: "amount", type: "number" as const },
  ]) {
    const added = await addDatabaseColumn(
      vaultDir,
      "financial",
      transactionsId,
      column,
    );
    assert.equal(
      added.ok,
      true,
      added.ok ? "" : `addDatabaseColumn(${column.name}) failed: ${added.error}`,
    );
  }
  const relation = await addDatabaseColumn(
    vaultDir,
    "financial",
    transactionsId,
    { name: "account", type: "relation", relationDatabaseId: accountsId },
  );
  assert.equal(
    relation.ok,
    true,
    relation.ok ? "" : `addDatabaseColumn(account relation) failed: ${relation.error}`,
  );
  const transactionsMeta = await getDatabase(
    vaultDir,
    "financial",
    transactionsId,
  );
  assert.equal(transactionsMeta.ok, true);
  if (!transactionsMeta.ok) throw new Error("transactions database could not be read");
  const columnId = (name: string): string => {
    const found = transactionsMeta.value.columns.find(
      (column) => column.name === name,
    )?.id;
    assert.ok(found, `the transactions database has no ${name} column id`);
    return found;
  };

  // A row-write proposal whose relation cell holds the account row's ID: the
  // display labels are what the cold read must resolve.
  const databaseRowBody = JSON.stringify(
    {
      op: "upsert",
      cells: {
        [columnId("payee")]: "Groceries",
        [columnId("amount")]: 128.5,
        [columnId("account")]: accountRow.value.id,
      },
    },
    null,
    2,
  );

  // ── the one pending database-row card the rig resolves through the bridge ─
  const pendingDbRow = await createDecision(vaultDir, {
    target: {
      type: "database-row",
      domainSlug: "financial",
      databaseId: transactionsId,
      rowId: null,
    },
    rationale: "A transaction the operator approves during the rig.",
    proposedBodyMarkdown: databaseRowBody,
    actor: USER,
  });
  assert.equal(
    pendingDbRow.ok,
    true,
    pendingDbRow.ok ? "" : `createDecision(database-row) failed: ${pendingDbRow.error}`,
  );
  if (!pendingDbRow.ok) throw new Error("the pending database-row card was not filed");

  // ── a pending board change: the template for the history and the create ───
  const pendingPin = await createDecision(vaultDir, {
    target: { type: "pins", domainSlug: null },
    proposedTitle: "A seeded board change",
    rationale: "Seeded history for the decision-list memo rig.",
    proposedBodyMarkdown: JSON.stringify({ pins: [] }),
    actor: USER,
  });
  assert.equal(
    pendingPin.ok,
    true,
    pendingPin.ok ? "" : `createDecision(pins) failed: ${pendingPin.error}`,
  );
  if (!pendingPin.ok) throw new Error("the pending board card was not filed");

  // The remaining pending board changes (the template is the first one).
  for (let index = 1; index < SEED.pendingPins; index += 1) {
    const pending = await createDecision(vaultDir, {
      target: { type: "pins", domainSlug: null },
      proposedTitle: `A seeded board change ${index}`,
      proposedBodyMarkdown: JSON.stringify({ pins: [] }),
      actor: USER,
    });
    assert.equal(
      pending.ok,
      true,
      pending.ok ? "" : `createDecision(pins ${index}) failed: ${pending.error}`,
    );
  }

  // ── 594 resolved Decisions, written as the store's own JSON shape ────────
  const decisionsDir = path.join(vaultDir, ".lifequest", "decisions");
  const base = Date.UTC(2025, 0, 1);
  for (let index = 0; index < SEED.historyResolved; index += 1) {
    const isRow = index < SEED.historyRows;
    const template = isRow ? pendingDbRow.value : pendingPin.value;
    const status = index % 3 === 0 ? "rejected" : "approved";
    const record: DecisionRecord = {
      ...template,
      id: `seed-${isRow ? "row" : "pin"}-${String(index).padStart(3, "0")}`,
      title: isRow
        ? `Proposed change to transaction ${index}`
        : `Proposed change to board ${index}`,
      rationale: `Seeded ${status} history ${index}.`,
      status,
      createdAt: new Date(base + index * 60_000).toISOString(),
      resolvedAt:
        status === "pending"
          ? null
          : new Date(base + index * 60_000 + 30_000).toISOString(),
    };
    writeDecisionFile(decisionsDir, record);
  }

  // ── the seed is real: read it back through the production read path ──────
  const listed = await listDecisions(vaultDir);
  assert.equal(
    listed.ok,
    true,
    listed.ok ? "" : `listDecisions(seed) failed: ${listed.error}`,
  );
  if (!listed.ok) throw new Error("the seeded vault could not be read");
  assert.equal(
    listed.value.length,
    SEED.total,
    `the seeded vault lists ${listed.value.length} Decisions (expected ${SEED.total})`,
  );
  const pending = listed.value.filter((record) => record.status === "pending");
  assert.equal(
    pending.length,
    SEED.expectedStatuses.pending,
    `the seeded vault has ${pending.length} pending Decisions (expected ${SEED.expectedStatuses.pending})`,
  );
  assert.ok(
    pending.some((record) => record.id === pendingDbRow.value.id),
    "the database-row card the rig resolves is not pending in the seed",
  );

  return {
    total: SEED.total,
    historyRows: SEED.historyRows,
    expectedStatuses: { ...SEED.expectedStatuses },
    dbRowPendingId: pendingDbRow.value.id,
    externalTemplateId: pendingPin.value.id,
    database: {
      slug: "financial",
      accountsId,
      accountsNameColumnId,
      transactionsId,
    },
  };
}

/**
 * The throwaway world the app boots into: a temp `HERMES_HOME`, a throwaway
 * vault the app auto-opens, the userData that makes it auto-open, and a fake
 * `hermes` first on PATH so no real CLI is ever run.
 */
async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-decisions-cache-"));
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const vaultDir = path.join(dir, "vault");
  const binDir = path.join(dir, "bin");
  const profileDir = path.join(hermesHome, "profiles", PROFILE);
  for (const made of [hermesHome, profileDir, userData, binDir]) {
    fs.mkdirSync(made, { recursive: true });
  }

  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(stub, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    "model:\n  default: some-model\n",
    "utf8",
  );

  const created = await createVault(vaultDir, "Decision list cache rig");
  assert.equal(
    created.ok,
    true,
    created.ok ? "" : `createVault failed: ${created.error}`,
  );
  if (!created.ok) throw new Error("createVault failed");
  const vault = created.value.lifequest;

  const seed = await seedVault(vaultDir);

  // The same shape the other real-main rigs write, with one real vault entry so
  // the app auto-opens it.
  fs.writeFileSync(
    path.join(userData, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: vault.id,
            name: vault.name,
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: PROFILE,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const mcpPorts = { local: await freePort(), invite: await freePort() };

  const worldFile = path.join(dir, "world.json");
  fs.writeFileSync(
    worldFile,
    `${JSON.stringify(
      {
        dir,
        hermesHome,
        userData,
        vaultDir,
        vaultId: vault.id,
        binDir,
        profile: PROFILE,
        mcpPorts,
        seed,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    dir,
    hermesHome,
    userData,
    vaultDir,
    vaultId: vault.id,
    binDir,
    worldFile,
    mcpPorts,
    seed,
  };
}

/** Run the Electron driver against one world, with the app's spawn contract. */
function runDriver(world: World): Promise<DriverOutcome> {
  const electron = createRequire(import.meta.url)("electron") as string;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_HOME = world.hermesHome;
  // The fake CLI must resolve first: this is the only thing that keeps the app
  // from running the operator's real `hermes`.
  env.PATH = `${world.binDir}${path.delimiter}${env.PATH ?? ""}`;
  env.VITE_DEV_SERVER_URL =
    process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${DEV_PORT}`;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: world.userData,
    showWindow: true,
    mcpPorts: world.mcpPorts,
  });
  env.LQ_DECISIONS_CACHE_WORLD = world.dir;
  env.ELECTRON_DISABLE_SANDBOX = env.ELECTRON_DISABLE_SANDBOX ?? "1";

  return new Promise((resolve) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 240_000, env },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number" ? (error.code as number) : 0;
        const spawnFailure =
          error && typeof error.code !== "number"
            ? `${error.message}\n${error.stack ?? ""}`
            : "";
        resolve({
          code: error && typeof error.code !== "number" ? null : code,
          stdout: String(stdout ?? ""),
          stderr: `${String(stderr ?? "")}${spawnFailure ? `\n${spawnFailure}` : ""}`,
        });
      },
    );
  });
}

/** The tail of a stream, for failure messages that have to stay readable. */
function tail(text: string, limit = 3_000): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

function assertArtifactExists(outcome: DriverOutcome): Report {
  const where = path.relative(desktopRoot, REPORT);
  assert.equal(
    fs.existsSync(REPORT),
    true,
    `the driver wrote no ${where} (exit ${outcome.code}). stderr: ${tail(outcome.stderr)}`,
  );
  let report: Report;
  try {
    report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
  } catch (error) {
    assert.fail(
      `the driver's ${where} is not JSON: ${error instanceof Error ? error.message : String(error)}; stderr: ${tail(outcome.stderr)}`,
    );
  }
  return report;
}

describe("decision:list memo (cold, warm, patched, invalidated) through the real main process", () => {
  it("proves the memo without ever handing a resolved card back as pending", async () => {
    assert.equal(
      await devServerUp(),
      true,
      `nothing is listening on 127.0.0.1:${DEV_PORT}; run this through /root/.local/bin/lifequest-e2e <checkout> tests/decisions-list-cache-e2e.test.ts`,
    );
    // The driver imports the main bundle the bench's dev server built. Missing
    // it is a setup failure, not a reason to skip.
    assert.equal(
      fs.existsSync(path.join(desktopRoot, "dist-electron/main.js")),
      true,
      "no dist-electron/main.js — the bench's dev server must have built main before this rig runs (lifequest-e2e does that)",
    );

    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.rmSync(REPORT, { force: true });

    const world = await buildWorld();
    try {
      const outcome = await runDriver(world);
      const report = assertArtifactExists(outcome);

      // ── the driver's own verdict, re-read from the artifact ──────────────
      assert.deepEqual(
        report.failures ?? [],
        [],
        `the driver reported failures: ${(report.failures ?? []).join("; ")}; stderr: ${tail(outcome.stderr)}`,
      );
      assert.equal(report.pass, true, "the driver did not pass");
      for (const check of report.checks ?? []) {
        assert.equal(
          check.pass,
          true,
          `the driver failed a check: ${check.label}${check.detail ? ` — ${check.detail}` : ""}`,
        );
      }
      assert.ok(report.legs, "the artifact has no legs block");

      // ── the world: this is the throwaway vault, not the operator's ───────
      assert.equal(
        report.world?.vaultDir,
        world.vaultDir,
        "the artifact is not about the throwaway vault",
      );
      assert.equal(
        report.world?.snapshotDecisions,
        SEED.total,
        `the app's startup snapshot listed ${report.world?.snapshotDecisions} Decisions (expected ${SEED.total})`,
      );
      assert.equal(report.world?.screen.hasBridge, true, "the real preload bridge was not present");
      assert.equal(
        report.world?.seed.resolveTargetId,
        world.seed.dbRowPendingId,
        "the artifact's resolve target is not the seeded database-row card",
      );

      // ── (1) cold correctness ──────────────────────────────────────────────
      const cold = report.legs.cold;
      assert.equal(cold.ok, true, "the cold read did not answer ok");
      assert.equal(
        cold.count,
        SEED.total,
        `the cold read listed ${cold.count} Decisions (expected ${SEED.total})`,
      );
      assert.deepEqual(
        cold.statuses,
        { ...SEED.expectedStatuses, other: 0 },
        "the cold read's status histogram is not the seeded one",
      );
      assert.equal(
        cold.databaseRow?.id,
        world.seed.dbRowPendingId,
        "the cold read did not include the database-row card",
      );
      assert.equal(
        cold.databaseRow?.labelsResolved,
        true,
        `the database-row card's display labels were not resolved: ${JSON.stringify(cold.databaseRow)}`,
      );
      // The relation cell holds the account row's id; the operator must read the
      // account's name, and the field column must read column names, not ids.
      const cellLabels = Object.values(cold.databaseRow?.cellLabels ?? {});
      assert.ok(
        cellLabels.includes("Everyday account"),
        `the relation cell did not resolve to the account's name: ${JSON.stringify(cellLabels)}`,
      );
      const columnNames = Object.values(cold.databaseRow?.columnNames ?? {});
      for (const name of ["payee", "amount", "account"]) {
        assert.ok(
          columnNames.includes(name),
          `the card's column names do not include "${name}": ${JSON.stringify(columnNames)}`,
        );
      }

      // ── (2) warm: same records, dramatically faster, a real disk read cold ─
      const warm = report.legs.warm;
      assert.equal(warm.ok, true, "the warm read did not answer ok");
      assert.equal(
        warm.sameRecordsAsCold,
        true,
        `the warm read returned different records (cold ${cold.count}/${cold.hash}, warm ${warm.count}/${warm.hash})`,
      );
      assert.ok(
        typeof warm.ms === "number" && warm.ms < 150,
        `the warm read took ${warm.ms} ms (bar: < 150 ms)`,
      );
      assert.ok(
        typeof cold.ms === "number" &&
          (cold.ms >= 300 || cold.ms >= 3 * Math.max(1, warm.ms)),
        `the cold read took ${cold.ms} ms, warm ${warm.ms} ms — the cold read does not look like a disk read (was decision:list called before the rig?)`,
      );
      assert.ok(
        (warm.speedup ?? 0) >= 3,
        `the warm read was only ${warm.speedup}x faster than cold`,
      );

      // ── (3) resolve: approved, never pending, still warm ─────────────────
      const resolve = report.legs.resolve;
      assert.equal(
        resolve.write.ok,
        true,
        `decision:resolve failed: ${JSON.stringify(resolve.write)}`,
      );
      assert.equal(
        resolve.write.status,
        "approved",
        `decision:resolve returned ${JSON.stringify(resolve.write.status)}`,
      );
      assert.ok(
        typeof resolve.write.resolvedAt === "string" && resolve.write.resolvedAt.length > 0,
        "decision:resolve returned no resolvedAt",
      );
      assert.equal(
        resolve.listed.present,
        true,
        "the resolved card disappeared from the list",
      );
      assert.equal(
        resolve.listed.status,
        "approved",
        `the list still hands the resolved card back as ${JSON.stringify(resolve.listed.status)} — it must never be pending after an approve`,
      );
      assert.equal(
        resolve.listed.resolvedAt,
        resolve.write.resolvedAt,
        "the listed resolvedAt is not the value the write returned",
      );
      assert.notEqual(resolve.listed.status, "pending");
      assert.ok(
        typeof resolve.listMs === "number" && resolve.listMs < 150,
        `the read after the resolve took ${resolve.listMs} ms (bar: < 150 ms — the patch, not a re-read)`,
      );
      assert.equal(
        resolve.statusHistogram?.approved,
        SEED.expectedStatuses.approved + 1,
        `the list after the resolve has ${resolve.statusHistogram?.approved} approved (expected ${SEED.expectedStatuses.approved + 1})`,
      );

      // ── (4) create: appears in the very next list, warm ──────────────────
      const create = report.legs.create;
      assert.equal(
        create.write.ok,
        true,
        `decision:create failed: ${JSON.stringify(create.write)}`,
      );
      assert.equal(create.write.status, "pending");
      assert.equal(
        create.listed.present,
        true,
        `the filed card ${JSON.stringify(create.write.id)} is missing from the next list`,
      );
      assert.equal(create.listed.status, "pending");
      assert.ok(
        typeof create.listMs === "number" && create.listMs < 150,
        `the read after the create took ${create.listMs} ms (bar: < 150 ms)`,
      );

      // ── (5) invalidation: a fresh disk read, still correct ───────────────
      const invalidation = report.legs.invalidation;
      assert.equal(
        invalidation.channel,
        "db:upsertRow",
        "the invalidation was not driven through a non-decision mutating channel",
      );
      assert.equal(
        invalidation.writeOk,
        true,
        "the non-decision mutating channel did not write through the bridge",
      );
      assert.ok(
        invalidation.listMs >= 250 ||
          invalidation.listMs >= 3 * Math.max(1, invalidation.warmBeforeMs),
        `the read after db:upsertRow took ${invalidation.listMs} ms (warm before it: ${invalidation.warmBeforeMs} ms) — it was not a fresh disk read`,
      );
      assert.equal(
        invalidation.count,
        SEED.total + 1,
        `the fresh read listed ${invalidation.count} Decisions (expected ${SEED.total + 1})`,
      );
      assert.deepEqual(
        invalidation.statusHistogram,
        {
          pending: SEED.expectedStatuses.pending,
          approved: SEED.expectedStatuses.approved + 1,
          rejected: SEED.expectedStatuses.rejected,
          other: 0,
        },
        "the fresh read's status histogram is wrong",
      );
      assert.equal(
        invalidation.resolved?.status,
        "approved",
        "the fresh read handed the resolved card back as not approved",
      );
      assert.equal(
        invalidation.created?.status,
        "pending",
        "the fresh read lost the card the rig filed",
      );

      // ── (6) the optional focus leg: covered, or honestly not ─────────────
      const focus = report.legs.focus;
      assert.ok(
        focus.status === "covered" || focus.status === "not-covered",
        `the focus leg has no status: ${JSON.stringify(focus)}`,
      );
      if (focus.status === "covered") {
        assert.equal(
          focus.memoStaleBeforeFocus,
          true,
          "the memo already showed the external edit before any focus — the focus leg proved nothing",
        );
        assert.equal(
          focus.visibleAfterFocus,
          true,
          "an external edit on disk did not become visible after a real window focus",
        );
      } else {
        assert.ok(
          typeof focus.reason === "string" && focus.reason.length > 0,
          "the focus leg is marked not-covered with no reason",
        );
      }
    } finally {
      fs.rmSync(world.dir, { recursive: true, force: true });
    }
  });
});
