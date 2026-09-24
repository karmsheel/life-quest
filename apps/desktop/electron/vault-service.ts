import fs from "node:fs/promises";
import path from "node:path";
import {
  archiveDomain,
  createDatabase,
  createDecision,
  createDomain,
  createPage,
  createSignal,
  createVault,
  deletePage,
  deleteRow,
  deleteSignal,
  dismissAgent,
  DOCUMENT_KINDS,
  ensurePlanningStub,
  ensureReview,
  getDatabase,
  getDocument,
  getPage,
  getPeriodPack,
  getReview,
  getRow,
  hireAgent,
  libraryCreate,
  libraryDelete,
  libraryGet,
  libraryList,
  libraryUpdate,
  listAgents,
  listDatabases,
  listDecisions,
  listPages,
  listPins,
  listRows,
  listSignals,
  markReviewDone,
  openVault,
  readDocumentMedia,
  readLog,
  resolveDecision,
  saveDatabaseFile,
  saveDocument,
  saveDocumentMedia,
  setDocumentLocked,
  setLibraryLocked,
  setPins,
  unlockReview,
  updateDomain,
  updatePage,
  updateSettings,
  updateSignal,
  upsertRow,
  USER_ACTOR,
  vaultPaths,
  writeReview,
  addDatabaseColumn,
  exportDomainBooks,
  restoreDomainBooks,
  applyGoalsCommand,
  applyMapCommand,
  installFinanceKit,
  listInstalledKits,
  getFinanceKitSettings,
  acceptIngestRows,
  editIngestRow,
  ingestFile as ingestFileCore,
  listIngestBatches,
  listIngestRows,
  listMappings,
  proposeMapping,
  rejectIngestRows,
  type AgentHire,
  type DatabaseColumnType,
  type GoalsCommand,
  type IngestBatch,
  type IngestFileResult,
  type IngestMapping,
  type IngestRow,
  type IngestSourceKind,
  type MapActor,
  type MapCommand,
  type MapStoreState,
  type DecisionRecord,
  type DocumentKind,
  type DocumentTarget,
  type DoctrineDocument,
  type DomainMeta,
  type DomainRecord,
  type LibraryCreateInput,
  type LibraryDocument,
  type LibraryListResult,
  type LibraryUpdatePatch,
  type LifeEvent,
  type MappingWriteResult,
  type PeriodPack,
  type PlanningStub,
  type Result,
  type ReviewCadence,
  type ReviewRecord,
  type SignalChainListResult,
  type SignalCreateInput,
  type SignalRecord,
  type SignalUpdatePatch,
  type VaultSettings,
  type VaultSnapshot,
} from "@lifequest/vault-core";
import {
  listRecentVaults,
  recordRecentVault,
  type RecentEntry,
} from "./recent-vaults.js";
import {
  clearHermesKey,
  getHermesKey,
  hasHermesKey,
  setHermesKey,
} from "./secrets.js";
import {
  hermesChat,
  hermesScanAgents,
  hermesTest,
} from "./hermes-proxy.js";
import { runPlannerLoop } from "./map-tools.js";
import { startMcp, stopMcp } from "./mcp-server.js";
import * as companion from "./companion.js";
import type {
  ChatStreamEvent,
  CompanionInstructionsInput,
} from "./companion-client.js";
import {
  buildBoundReviewContext,
  startOrResumePlanSession as startOrResumePlanSessionCore,
  startOrResumeReviewSession as startOrResumeReviewSessionCore,
  type BoundSessionResult,
} from "./review-sessions.js";

let currentRoot: string | null = null;
let currentVaultId: string | null = null;
let currentLens: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Last-known mtimes for doctrine files (why/what/how.md) under the open vault. */
let doctrineMtimes: Map<string, number> = new Map();
/** Last MCP start error, surfaced in Settings while a vault is open. */
let mcpError: string | null = null;

function noVaultError<T>(): Result<T> {
  return { ok: false, error: "No vault is open" };
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  // Keep queue alive even if this task fails.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function withVault<T>(fn: (root: string) => Promise<Result<T>>): Promise<Result<T>> {
  return enqueue(async () => {
    if (!currentRoot) return noVaultError<T>();
    return fn(currentRoot);
  });
}

/** Snapshot mtimes for all doctrine markdown files under the vault. */
async function captureDoctrineMtimes(root: string): Promise<void> {
  const paths = vaultPaths(root);
  const next = new Map<string, number>();
  try {
    const domainEntries = await fs.readdir(paths.domainsDir, {
      withFileTypes: true,
    });
    for (const entry of domainEntries) {
      if (!entry.isDirectory()) continue;
      for (const kind of DOCUMENT_KINDS) {
        const filePath = paths.documentMd(entry.name, kind);
        try {
          const st = await fs.stat(filePath);
          next.set(filePath, st.mtimeMs);
        } catch {
          // Missing doctrine file — omit from snapshot.
        }
      }
    }
    // Watch Map store and Goals files so external edits surface in the focus reload prompt.
    for (const mapFile of [paths.mapJson, paths.aboutMd, paths.goalsJson]) {
      try {
        const st = await fs.stat(mapFile);
        next.set(mapFile, st.mtimeMs);
      } catch {
        // Map store not yet created — omit.
      }
    }
  } catch {
    // No domains dir — empty snapshot.
  }
  doctrineMtimes = next;
}

/**
 * Re-stat tracked doctrine files. Returns paths whose mtimeMs differs from
 * the last snapshot (or that are missing). Does not update the snapshot so
 * the UI can keep prompting until the user reloads.
 * Runs on the vault write queue so mtime reads do not race in-flight writes.
 */
export async function detectExternalDoctrineChanges(): Promise<
  { path: string }[]
> {
  return enqueue(async () => {
    if (!currentRoot || doctrineMtimes.size === 0) return [];
    const changed: { path: string }[] = [];
    for (const [filePath, prevMtime] of doctrineMtimes) {
      try {
        const st = await fs.stat(filePath);
        if (st.mtimeMs !== prevMtime) {
          changed.push({ path: filePath });
        }
      } catch {
        changed.push({ path: filePath });
      }
    }
    return changed;
  });
}

async function rememberOpen(snapshot: VaultSnapshot): Promise<void> {
  currentRoot = snapshot.rootPath;
  currentVaultId = snapshot.lifequest.id;
  currentLens = null;
  await captureDoctrineMtimes(snapshot.rootPath);
  await recordRecentVault({
    id: snapshot.lifequest.id,
    name: snapshot.lifequest.name,
    path: snapshot.rootPath,
  });
  // Open the loopback MCP door for this vault. A failed start keeps the vault
  // open; we record the error for Settings instead of throwing.
  mcpError = null;
  const mcpResult = await startMcp(
    snapshot.rootPath,
    snapshot.lifequest.id,
    () => currentLens,
  );
  if (!mcpResult.ok) {
    mcpError = mcpResult.error;
  }
}

export function getMcpError(): string | null {
  return mcpError;
}

export function getMcpUrl(): string {
  return mcpError ? "" : `http://127.0.0.1:8643/mcp`;
}

export function getCurrentRoot(): string | null {
  return currentRoot;
}

export function getCurrentVaultId(): string | null {
  return currentVaultId;
}

export async function vaultCreate(
  rootPath: string,
  name?: string,
): Promise<Result<VaultSnapshot>> {
  return enqueue(async () => {
    const abs = path.resolve(rootPath);
    const res = await createVault(abs, name ?? "Personal");
    if (!res.ok) return res;
    await rememberOpen(res.value);
    return res;
  });
}

export async function vaultOpen(
  rootPath: string,
): Promise<Result<VaultSnapshot>> {
  return enqueue(async () => {
    const abs = path.resolve(rootPath);
    const res = await openVault(abs);
    if (!res.ok) return res;
    await rememberOpen(res.value);
    return res;
  });
}

export async function vaultGetSnapshot(): Promise<Result<VaultSnapshot | null>> {
  return enqueue(async () => {
    if (!currentRoot) return { ok: true, value: null };
    const res = await openVault(currentRoot);
    if (res.ok) {
      await captureDoctrineMtimes(currentRoot);
    }
    return res;
  });
}

export async function vaultListRecent(): Promise<RecentEntry[]> {
  return listRecentVaults();
}

export async function domainCreate(input: {
  name: string;
  slug?: string;
}): Promise<Result<DomainRecord>> {
  return withVault(async (root) => {
    const res = await createDomain(root, input);
    if (res.ok) await captureDoctrineMtimes(root);
    return res;
  });
}

export async function domainUpdate(
  slug: string,
  patch: Partial<Pick<DomainMeta, "name" | "description" | "color" | "sortOrder">>,
): Promise<Result<DomainRecord>> {
  return withVault((root) => updateDomain(root, slug, patch));
}

export async function domainArchive(
  slug: string,
): Promise<Result<DomainRecord>> {
  return withVault((root) => archiveDomain(root, slug));
}

// KAR-53 ingest
export async function ingestFile(slug: string, input: {
  databaseId: string;
  bytes: Uint8Array;
  mime: string;
  name: string;
  extractedRows?: Record<string, string>[];
}): Promise<Result<import("@lifequest/vault-core").IngestFileResult>> {
  return withVault((root) => ingestFileCore(root, slug, { ...input, actor: USER_ACTOR }));
}

export async function ingestProposeMapping(slug: string, input: {
  mappingId?: string;
  databaseId: string;
  fingerprint: string;
  sourceKind: import("@lifequest/vault-core").IngestSourceKind;
  columns: import("@lifequest/vault-core").IngestColumnMapping[];
}): Promise<Result<import("@lifequest/vault-core").MappingWriteResult>> {
  return withVault((root) => proposeMapping(root, slug, { ...input, actor: USER_ACTOR }));
}

export async function ingestListMappings(slug: string, databaseId?: string): Promise<Result<import("@lifequest/vault-core").IngestMapping[]>> {
  return withVault((root) => listMappings(root, slug, databaseId));
}

export async function ingestListBatches(slug: string, databaseId?: string): Promise<Result<import("@lifequest/vault-core").IngestBatch[]>> {
  return withVault((root) => listIngestBatches(root, slug, databaseId));
}

export async function ingestListRows(slug: string, batchId: string): Promise<Result<import("@lifequest/vault-core").IngestRow[]>> {
  return withVault((root) => listIngestRows(root, slug, batchId));
}

export async function ingestEditRow(slug: string, batchId: string, rowId: string, cells: Record<string, unknown>): Promise<Result<import("@lifequest/vault-core").IngestRow>> {
  return withVault((root) => editIngestRow(root, slug, batchId, rowId, cells));
}

export async function ingestAccept(slug: string, batchId: string, rowIds?: string[]): Promise<Result<{ accepted: number; postedIds: string[] }>> {
  return withVault((root) => acceptIngestRows(root, slug, batchId, rowIds));
}

export async function ingestReject(slug: string, batchId: string, rowIds?: string[]): Promise<Result<{ rejected: number }>> {
  return withVault((root) => rejectIngestRows(root, slug, batchId, rowIds));
}

export async function domainSetActive(slug: string | null): Promise<Result<string | null>> {
  return enqueue(async () => {
    if (!currentRoot || !currentVaultId) return noVaultError<string | null>();
    if (slug === null) {
      currentLens = null;
      return { ok: true, value: null };
    }
    const snap = await openVault(currentRoot);
    if (!snap.ok) return snap;
    const domain = snap.value.domains.find((d) => d.slug === slug);
    if (!domain) {
      return { ok: false, error: `Domain not found: ${slug}` };
    }
    if (domain.meta.archivedAt) {
      return { ok: false, error: `Domain is archived: ${slug}` };
    }
    currentLens = slug;
    return { ok: true, value: slug };
  });
}

export async function domainGetActive(): Promise<string | null> {
  if (!currentVaultId) return null;
  return currentLens;
}

// KAR-55 domain databases
export async function dbList(domainSlug: string | null): Promise<Result<import("@lifequest/vault-core").DatabaseListEntry[]>> {
  return withVault((root) => listDatabases(root, domainSlug));
}

export async function dbGet(slug: string, dbId: string): Promise<Result<import("@lifequest/vault-core").DatabaseMeta>> {
  return withVault((root) => getDatabase(root, slug, dbId));
}

export async function dbCreate(slug: string, input: { name: string }): Promise<Result<import("@lifequest/vault-core").DatabaseMeta>> {
  return withVault((root) => createDatabase(root, slug, input));
}

export async function dbAddColumn(
  slug: string,
  dbId: string,
  input: { name: string; type: DatabaseColumnType; options?: string[]; relationDatabaseId?: string },
): Promise<Result<import("@lifequest/vault-core").DatabaseMeta>> {
  return withVault((root) => addDatabaseColumn(root, slug, dbId, input));
}

export async function dbListRows(slug: string, dbId: string): Promise<Result<import("@lifequest/vault-core").DatabaseRow[]>> {
  return withVault((root) => listRows(root, slug, dbId));
}

export async function dbGetRow(slug: string, dbId: string, rowId: string): Promise<Result<import("@lifequest/vault-core").DatabaseRow>> {
  return withVault((root) => getRow(root, slug, dbId, rowId));
}

export async function dbUpsertRow(
  slug: string,
  dbId: string,
  input: { id?: string; cells: Record<string, unknown> },
): Promise<Result<import("@lifequest/vault-core").DatabaseRow>> {
  return withVault((root) => upsertRow(root, slug, dbId, input));
}

export async function dbDeleteRow(slug: string, dbId: string, rowId: string): Promise<Result<{ id: string }>> {
  return withVault((root) => deleteRow(root, slug, dbId, rowId));
}

export async function dbFileSave(
  slug: string,
  input: { bytes: Uint8Array; mime: string; name: string },
): Promise<Result<{ relPath: string; fileId: string }>> {
  return withVault((root) => saveDatabaseFile(root, slug, input));
}

export async function dbExportBooks(
  slug: string,
): Promise<Result<import("@lifequest/vault-core").DomainBooksExport>> {
  return withVault((root) => exportDomainBooks(root, slug));
}

export async function dbRestoreBooks(
  slug: string,
  options: { confirm: boolean },
): Promise<Result<{ databases: number; rows: number }>> {
  return withVault((root) => restoreDomainBooks(root, slug, options));
}

// KAR-60 pages and pins
export async function pageList(domainSlug: string | null): Promise<Result<import("@lifequest/vault-core").PageListEntry[]>> {
  return withVault((root) => listPages(root, domainSlug));
}

export async function pageGet(slug: string, pageId: string): Promise<Result<import("@lifequest/vault-core").PageRecord>> {
  return withVault((root) => getPage(root, slug, pageId));
}

export async function pageCreate(slug: string, input: { title: string }): Promise<Result<import("@lifequest/vault-core").PageRecord>> {
  return withVault((root) => createPage(root, slug, input));
}

export async function pageUpdate(
  slug: string,
  pageId: string,
  input: { title?: string; blocks?: import("@lifequest/vault-core").PageBlock[] },
): Promise<Result<import("@lifequest/vault-core").PageWriteResult>> {
  return withVault((root) => updatePage(root, slug, pageId, input, USER_ACTOR));
}

export async function pageDelete(slug: string, pageId: string): Promise<Result<{ id: string }>> {
  return withVault((root) => deletePage(root, slug, pageId));
}

export async function pinsList(domainSlug: string | null): Promise<Result<import("@lifequest/vault-core").Pin[]>> {
  return withVault((root) => listPins(root, domainSlug));
}

export async function pinsSet(
  domainSlug: string | null,
  pins: import("@lifequest/vault-core").Pin[],
): Promise<Result<import("@lifequest/vault-core").PinWriteResult>> {
  return withVault((root) => setPins(root, domainSlug, pins, USER_ACTOR));
}

export async function documentGet(
  slug: string,
  kind: DocumentKind,
): Promise<Result<DoctrineDocument>> {
  return withVault((root) => getDocument(root, slug, kind));
}

export async function documentSave(
  slug: string,
  kind: DocumentKind,
  bodyMarkdown: string,
  title?: string,
): Promise<Result<DoctrineDocument>> {
  return withVault(async (root) => {
    const res = await saveDocument(root, slug, kind, bodyMarkdown, title);
    if (res.ok) {
      const filePath = vaultPaths(root).documentMd(slug, kind);
      doctrineMtimes.set(filePath, res.value.mtimeMs);
    }
    return res;
  });
}

export async function documentSetLocked(
  slug: string,
  kind: DocumentKind,
  locked: boolean,
): Promise<Result<DoctrineDocument>> {
  return withVault(async (root) => {
    const res = await setDocumentLocked(root, slug, kind, locked, USER_ACTOR);
    if (res.ok) {
      const filePath = vaultPaths(root).documentMd(slug, kind);
      doctrineMtimes.set(filePath, res.value.mtimeMs);
    }
    return res;
  });
}

export async function librarySetLocked(
  id: string,
  locked: boolean,
): Promise<Result<LibraryDocument>> {
  return withVault((root) => setLibraryLocked(root, id, locked, USER_ACTOR));
}

export async function documentMediaSave(
  slug: string,
  input: { bytes: Uint8Array; mime: string },
): Promise<Result<{ relPath: string }>> {
  return withVault((root) => saveDocumentMedia(root, slug, input));
}

export async function documentMediaRead(
  slug: string,
  relPath: string,
): Promise<Result<{ bytes: Uint8Array; mime: string }>> {
  return withVault((root) => readDocumentMedia(root, slug, relPath));
}

// KAR-61 finance kit
export async function kitInstallFinance(): Promise<Result<unknown>> {
  return withVault((root) => installFinanceKit(root, USER_ACTOR));
}

export async function kitList(slug: string): Promise<Result<string[]>> {
  return withVault((root) => listInstalledKits(root, slug));
}

export async function kitFinanceSettings(): Promise<Result<unknown>> {
  return withVault((root) => getFinanceKitSettings(root));
}

export async function decisionList(): Promise<Result<DecisionRecord[]>> {
  return withVault((root) => listDecisions(root));
}

export async function decisionCreate(input: {
  target: DocumentTarget;
  rationale?: string | null;
  proposedTitle?: string | null;
  previousTitle?: string | null;
  proposedBodyMarkdown: string;
  previousBodyMarkdown?: string | null;
}): Promise<Result<DecisionRecord>> {
  return withVault((root) =>
    createDecision(root, {
      ...input,
      actor: USER_ACTOR,
    }),
  );
}

export async function decisionResolve(
  id: string,
  resolution: "approved" | "rejected",
): Promise<Result<DecisionRecord>> {
  return withVault(async (root) => {
    const res = await resolveDecision(root, id, resolution);
    // Approval rewrites a doctrine file — refresh mtimes to avoid false stale.
    if (res.ok) await captureDoctrineMtimes(root);
    return res;
  });
}

export async function logList(): Promise<Result<LifeEvent[]>> {
  return withVault((root) => readLog(root));
}

export async function signalChainList(): Promise<Result<SignalChainListResult>> {
  return withVault((root) => listSignals(root));
}

export async function signalChainCreate(
  input: SignalCreateInput,
): Promise<Result<SignalRecord>> {
  return withVault((root) => createSignal(root, input));
}

export async function signalChainUpdate(
  id: string,
  patch: SignalUpdatePatch,
): Promise<Result<SignalRecord>> {
  return withVault((root) => updateSignal(root, id, patch));
}

export async function signalChainDelete(
  id: string,
): Promise<Result<SignalRecord>> {
  return withVault((root) => deleteSignal(root, id));
}

export async function libraryListCall(): Promise<Result<LibraryListResult>> {
  return withVault((root) => libraryList(root));
}

export async function libraryCreateCall(
  input: LibraryCreateInput,
): Promise<Result<LibraryDocument>> {
  return withVault((root) => libraryCreate(root, input));
}

export async function libraryGetCall(
  id: string,
): Promise<Result<LibraryDocument>> {
  return withVault((root) => libraryGet(root, id));
}

export async function libraryUpdateCall(
  id: string,
  patch: LibraryUpdatePatch,
): Promise<Result<LibraryDocument>> {
  return withVault((root) => libraryUpdate(root, id, patch));
}

export async function libraryDeleteCall(
  id: string,
): Promise<Result<LibraryDocument>> {
  return withVault((root) => libraryDelete(root, id));
}

export async function agentsList(): Promise<Result<AgentHire[]>> {
  return withVault((root) => listAgents(root));
}

export async function agentsHire(input: {
  hermesAgentId: string;
  name: string;
  roleLabel?: string | null;
  domainSlug?: string | null;
}): Promise<Result<AgentHire>> {
  return withVault((root) =>
    hireAgent(root, {
      hermesAgentId: input.hermesAgentId,
      name: input.name,
      roleLabel: input.roleLabel ?? null,
      domainSlug: input.domainSlug ?? null,
    }),
  );
}

export async function agentsDismiss(id: string): Promise<Result<AgentHire>> {
  return withVault((root) => dismissAgent(root, id));
}

export async function settingsUpdate(
  patch: Partial<VaultSettings>,
): Promise<Result<VaultSettings>> {
  return withVault((root) => updateSettings(root, patch));
}

export async function secretsHasHermesKey(): Promise<boolean> {
  return enqueue(async () => {
    if (!currentVaultId) return false;
    return hasHermesKey(currentVaultId);
  });
}

export async function secretsSetHermesKey(key: string): Promise<Result<true>> {
  return enqueue(async () => {
    if (!currentVaultId) return noVaultError<true>();
    return setHermesKey(currentVaultId, key);
  });
}

export async function secretsClearHermesKey(): Promise<Result<true>> {
  return enqueue(async () => {
    if (!currentVaultId) return noVaultError<true>();
    return clearHermesKey(currentVaultId);
  });
}

async function loadHermesCreds(): Promise<
  Result<{ baseUrl: string; apiKey: string }>
> {
  if (!currentRoot || !currentVaultId) {
    return noVaultError<{ baseUrl: string; apiKey: string }>();
  }
  try {
    const settingsRaw = await fs.readFile(
      path.join(currentRoot, ".lifequest", "settings.json"),
      "utf8",
    );
    const settings = JSON.parse(settingsRaw) as VaultSettings;
    const baseUrl = (settings.hermesBaseUrl || "").trim().replace(/\/$/, "");
    if (!baseUrl) {
      return { ok: false, error: "Hermes base URL is not configured" };
    }
    // Defense in depth: reject non-http(s) even if settings were written offline.
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      return { ok: false, error: `Invalid Hermes base URL: ${baseUrl}` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        error: `Hermes base URL must be http(s): ${baseUrl}`,
      };
    }
    const apiKey = await getHermesKey(currentVaultId);
    if (!apiKey) {
      return {
        ok: false,
        error: "Hermes API key is not set. Add it in Settings.",
      };
    }
    return { ok: true, value: { baseUrl, apiKey } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function hermesTestCall(): Promise<
  Result<{ latencyMs: number; baseUrl: string }>
> {
  const creds = await loadHermesCreds();
  if (!creds.ok) return creds;
  return hermesTest(creds.value.baseUrl, creds.value.apiKey);
}

export async function hermesChatCall(
  messages: { role: string; content: string }[],
): Promise<Result<{ content: string }>> {
  const creds = await loadHermesCreds();
  if (!creds.ok) return creds;
  return hermesChat(creds.value.baseUrl, creds.value.apiKey, messages);
}

export async function hermesChatToolsCall(
  messages: { role: string; content: string }[],
): Promise<Result<{ content: string }>> {
  const creds = await loadHermesCreds();
  if (!creds.ok) return creds;
  if (!currentRoot) return noVaultError<{ content: string }>();

  // Build read-only context the planner loop injects as extra system text:
  // active domain slug and About me.
  const activeSlug = currentLens;
  const snap = await openVault(currentRoot);
  const map = snap.ok ? snap.value.map : null;
  const aboutMe = map?.aboutMe ?? "";
  const extraSystem = [
    `Active domain: ${activeSlug ?? "overview"}`,
    `About me: ${aboutMe}`,
  ].join("\n");

  return runPlannerLoop({
    root: currentRoot,
    activeSlug,
    baseUrl: creds.value.baseUrl,
    apiKey: creds.value.apiKey,
    extraSystem,
    messages,
  });
}

export async function hermesScanAgentsCall(): Promise<
  Result<{ id: string; name: string }[]>
> {
  const creds = await loadHermesCreds();
  if (!creds.ok) return creds;
  return hermesScanAgents(creds.value.baseUrl, creds.value.apiKey);
}

export async function mapGetState(): Promise<Result<MapStoreState>> {
  return withVault(async (root) => {
    const snap = await openVault(root);
    if (!snap.ok) return snap;
    if (!snap.value.map) {
      return { ok: false, error: snap.value.mapError ?? "Map store unreadable" };
    }
    return { ok: true, value: snap.value.map };
  });
}

export async function mapApply(
  command: MapCommand,
  actor: MapActor = "user",
): Promise<Result<VaultSnapshot>> {
  return withVault(async (root) => {
    const applied = await applyMapCommand(root, command, actor);
    if (!applied.ok) return applied;
    return openVault(root);
  });
}

export async function goalsApply(
  command: GoalsCommand,
): Promise<Result<VaultSnapshot>> {
  return withVault(async (root) => {
    const applied = await applyGoalsCommand(root, command);
    if (!applied.ok) return applied;
    return openVault(root);
  });
}

export async function reviewGet(
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewRecord>> {
  return withVault((root) => getReview(root, cadence, period));
}

export async function reviewEnsure(
  cadence: ReviewCadence,
  period: string,
  scope: "overall" | string,
): Promise<Result<ReviewRecord>> {
  return withVault((root) => ensureReview(root, { cadence, period, scope }));
}

export async function reviewWrite(
  cadence: ReviewCadence,
  period: string,
  body: string,
): Promise<Result<ReviewRecord>> {
  return withVault((root) =>
    writeReview(root, {
      cadence,
      period,
      bodyMarkdown: body,
      actor: USER_ACTOR,
    }),
  );
}

export async function reviewMarkDone(
  cadence: ReviewCadence,
  period: string,
  scope: "overall" | string,
): Promise<Result<ReviewRecord>> {
  return withVault((root) => markReviewDone(root, { cadence, period, scope }));
}

export async function reviewUnlock(
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewRecord>> {
  return withVault((root) => unlockReview(root, cadence, period));
}

export async function reviewPeriodPack(
  cadence: ReviewCadence,
  period: string,
  scope: "overall" | string,
): Promise<Result<PeriodPack>> {
  return withVault((root) => getPeriodPack(root, { cadence, period, scope }));
}

export async function planningEnsure(
  cadence: ReviewCadence,
  period: string,
  scope: "overall" | string,
): Promise<Result<PlanningStub>> {
  return withVault((root) =>
    ensurePlanningStub(root, { cadence, period, scope }),
  );
}

const companionSessionFns = {
  list: () => companion.companionSessionsList(),
  create: (title: string) => companion.companionSessionCreate(title),
};

export async function reviewStartOrResume(
  cadence: ReviewCadence,
  period: string,
  scope: "overall" | string,
): Promise<Result<BoundSessionResult>> {
  return withVault((root) =>
    startOrResumeReviewSessionCore(
      root,
      { cadence, period, scope },
      companionSessionFns,
    ),
  );
}

export async function planningStartOrResume(
  cadence: ReviewCadence,
  period: string,
  scope: "overall" | string,
): Promise<Result<BoundSessionResult>> {
  return withVault((root) =>
    startOrResumePlanSessionCore(
      root,
      { cadence, period, scope },
      companionSessionFns,
    ),
  );
}

export async function companionChatStreamWithPack(
  sessionId: string,
  input: string,
  instructionsContext: CompanionInstructionsInput,
  onEvent: (evt: ChatStreamEvent) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx: CompanionInstructionsInput = { ...instructionsContext };
  if (currentRoot) {
    const snap = await openVault(currentRoot);
    if (snap.ok) {
      const reviewContext = await buildBoundReviewContext(
        currentRoot,
        snap.value,
        sessionId,
      );
      if (reviewContext) ctx.reviewContext = reviewContext;
    }
  }
  return companion.companionChatStream(sessionId, input, ctx, onEvent);
}
