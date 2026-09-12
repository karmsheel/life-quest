import fs from "node:fs/promises";
import path from "node:path";
import {
  archiveDomain,
  createDecision,
  createDomain,
  createSignal,
  createVault,
  deleteSignal,
  dismissAgent,
  DOCUMENT_KINDS,
  getDocument,
  hireAgent,
  libraryCreate,
  libraryDelete,
  libraryGet,
  libraryList,
  libraryUpdate,
  listAgents,
  listDecisions,
  listSignals,
  openVault,
  readDocumentMedia,
  readLog,
  resolveDecision,
  saveDocument,
  saveDocumentMedia,
  setDocumentLocked,
  setLibraryLocked,
  updateDomain,
  updateSettings,
  updateSignal,
  USER_ACTOR,
  vaultPaths,
  applyGoalsCommand,
  applyMapCommand,
  type AgentHire,
  type GoalsCommand,
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
  type Result,
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
