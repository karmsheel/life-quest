import fs from "node:fs/promises";
import path from "node:path";
import {
  archiveDomain,
  createDecision,
  createDomain,
  createVault,
  dismissAgent,
  getDocument,
  hireAgent,
  listAgents,
  listDecisions,
  openVault,
  readLog,
  resolveDecision,
  saveDocument,
  setDocumentStatus,
  updateDomain,
  updateSettings,
  type AgentHire,
  type DecisionRecord,
  type DocumentKind,
  type DocumentStatus,
  type DoctrineDocument,
  type DomainMeta,
  type DomainRecord,
  type LifeEvent,
  type Result,
  type VaultSettings,
  type VaultSnapshot,
} from "@lifequest/vault-core";
import {
  getActiveDomain,
  listRecentVaults,
  recordRecentVault,
  setActiveDomain,
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

let currentRoot: string | null = null;
let currentVaultId: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

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

async function rememberOpen(snapshot: VaultSnapshot): Promise<void> {
  currentRoot = snapshot.rootPath;
  currentVaultId = snapshot.lifequest.id;
  await recordRecentVault({
    id: snapshot.lifequest.id,
    name: snapshot.lifequest.name,
    path: snapshot.rootPath,
  });
  // Seed active domain if unset (new vaults → first domain, typically health).
  const existing = await getActiveDomain(snapshot.lifequest.id);
  if (!existing) {
    const first =
      snapshot.domains.find((d) => !d.meta.archivedAt)?.slug ??
      snapshot.domains[0]?.slug;
    if (first) {
      await setActiveDomain(snapshot.lifequest.id, first);
    }
  }
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
    return openVault(currentRoot);
  });
}

export async function vaultListRecent(): Promise<RecentEntry[]> {
  return listRecentVaults();
}

export async function domainCreate(input: {
  name: string;
  slug?: string;
}): Promise<Result<DomainRecord>> {
  return withVault((root) => createDomain(root, input));
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

export async function domainSetActive(slug: string): Promise<Result<string>> {
  return enqueue(async () => {
    if (!currentRoot || !currentVaultId) return noVaultError<string>();
    // Validate domain exists and is not archived.
    const snap = await openVault(currentRoot);
    if (!snap.ok) return snap;
    const domain = snap.value.domains.find((d) => d.slug === slug);
    if (!domain) {
      return { ok: false, error: `Domain not found: ${slug}` };
    }
    if (domain.meta.archivedAt) {
      return { ok: false, error: `Domain is archived: ${slug}` };
    }
    await setActiveDomain(currentVaultId, slug);
    return { ok: true, value: slug };
  });
}

export async function domainGetActive(): Promise<string | null> {
  if (!currentVaultId) return null;
  return getActiveDomain(currentVaultId);
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
  return withVault((root) => saveDocument(root, slug, kind, bodyMarkdown, title));
}

export async function documentSetStatus(
  slug: string,
  kind: DocumentKind,
  status: DocumentStatus,
): Promise<Result<DoctrineDocument>> {
  return withVault((root) => setDocumentStatus(root, slug, kind, status));
}

export async function decisionList(): Promise<Result<DecisionRecord[]>> {
  return withVault((root) => listDecisions(root));
}

export async function decisionCreate(input: {
  domainSlug: string;
  documentKind: DocumentKind;
  title: string;
  rationale?: string | null;
  proposedBodyMarkdown: string;
  previousBodyMarkdown?: string | null;
}): Promise<Result<DecisionRecord>> {
  return withVault((root) =>
    createDecision(root, {
      domainSlug: input.domainSlug,
      documentKind: input.documentKind,
      title: input.title,
      rationale: input.rationale ?? null,
      proposedBodyMarkdown: input.proposedBodyMarkdown,
      previousBodyMarkdown: input.previousBodyMarkdown ?? null,
    }),
  );
}

export async function decisionResolve(
  id: string,
  resolution: "approved" | "rejected",
): Promise<Result<DecisionRecord>> {
  return withVault((root) => resolveDecision(root, id, resolution));
}

export async function logList(): Promise<Result<LifeEvent[]>> {
  return withVault((root) => readLog(root));
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
  if (!currentVaultId) return false;
  return hasHermesKey(currentVaultId);
}

export async function secretsSetHermesKey(key: string): Promise<Result<true>> {
  if (!currentVaultId) return noVaultError<true>();
  return setHermesKey(currentVaultId, key);
}

export async function secretsClearHermesKey(): Promise<Result<true>> {
  if (!currentVaultId) return noVaultError<true>();
  return clearHermesKey(currentVaultId);
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

export async function hermesScanAgentsCall(): Promise<
  Result<{ id: string; name: string }[]>
> {
  const creds = await loadHermesCreds();
  if (!creds.ok) return creds;
  return hermesScanAgents(creds.value.baseUrl, creds.value.apiKey);
}
