import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { vaultPaths } from "./paths.ts";
import { isWeekStartDay } from "./period.ts";
import type { AgentHire, Result, VaultSettings, WeekStartDay } from "./types.ts";

type AgentsFile = { hires: AgentHire[] };

async function readAgentsFile(rootPath: string): Promise<AgentsFile> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.agentsJson, "utf8");
    const parsed = JSON.parse(raw) as { hires?: AgentHire[] };
    return { hires: Array.isArray(parsed.hires) ? parsed.hires : [] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { hires: [] };
    }
    throw e;
  }
}

async function writeAgentsFile(rootPath: string, data: AgentsFile): Promise<void> {
  const paths = vaultPaths(rootPath);
  await atomicWriteFile(paths.agentsJson, `${JSON.stringify(data, null, 2)}\n`);
}

export async function listAgents(rootPath: string): Promise<Result<AgentHire[]>> {
  try {
    const data = await readAgentsFile(rootPath);
    return { ok: true, value: data.hires };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function hireAgent(
  rootPath: string,
  input: Omit<AgentHire, "id" | "status" | "createdAt" | "dismissedAt">,
): Promise<Result<AgentHire>> {
  try {
    const hermesAgentId = input.hermesAgentId?.trim();
    if (!hermesAgentId) {
      return { ok: false, error: "hermesAgentId is required" };
    }
    const name = input.name?.trim();
    if (!name) {
      return { ok: false, error: "name is required" };
    }

    const data = await readAgentsFile(rootPath);
    const now = new Date().toISOString();
    const hire: AgentHire = {
      id: randomUUID(),
      hermesAgentId,
      name,
      roleLabel: input.roleLabel ?? null,
      domainSlug: input.domainSlug ?? null,
      status: "active",
      createdAt: now,
      dismissedAt: null,
    };
    data.hires.push(hire);
    await writeAgentsFile(rootPath, data);
    return { ok: true, value: hire };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function dismissAgent(
  rootPath: string,
  id: string,
): Promise<Result<AgentHire>> {
  try {
    const data = await readAgentsFile(rootPath);
    const idx = data.hires.findIndex((h) => h.id === id);
    if (idx === -1) {
      return { ok: false, error: `Agent not found: ${id}` };
    }
    const existing = data.hires[idx]!;
    if (existing.status === "dismissed") {
      return { ok: false, error: `Agent is already dismissed: ${id}` };
    }
    const now = new Date().toISOString();
    const updated: AgentHire = {
      ...existing,
      status: "dismissed",
      dismissedAt: now,
    };
    data.hires[idx] = updated;
    await writeAgentsFile(rootPath, data);
    return { ok: true, value: updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Accept only http(s) Hermes gateway URLs (blocks file:, javascript:, etc.). */
export function isHttpOrHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function countMdFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
}

export async function countWeeklyVaultFiles(rootPath: string): Promise<number> {
  const paths = vaultPaths(rootPath);
  const reviews = await countMdFiles(paths.reviewsCadenceDir("weekly"));
  const planning = await countMdFiles(paths.planningCadenceDir("weekly"));
  return reviews + planning;
}

export async function updateSettings(
  rootPath: string,
  patch: Partial<VaultSettings>,
): Promise<Result<VaultSettings>> {
  try {
    const paths = vaultPaths(rootPath);
    let current: VaultSettings;
    try {
      const raw = await fs.readFile(paths.settingsJson, "utf8");
      current = JSON.parse(raw) as VaultSettings;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: "settings.json not found" };
      }
      throw e;
    }

    const currentWeekStart: WeekStartDay =
      current.weekStartDay === "sunday" || current.weekStartDay === "monday"
        ? current.weekStartDay
        : "monday";
    const next: VaultSettings = {
      hermesBaseUrl:
        patch.hermesBaseUrl !== undefined ? patch.hermesBaseUrl : current.hermesBaseUrl,
      theme: patch.theme !== undefined ? patch.theme : current.theme,
      weekStartDay: currentWeekStart,
    };

    if (patch.hermesBaseUrl !== undefined) {
      const trimmed = String(patch.hermesBaseUrl).trim().replace(/\/$/, "");
      if (!trimmed) {
        return { ok: false, error: "Hermes base URL must not be empty" };
      }
      if (!isHttpOrHttpsUrl(trimmed)) {
        return {
          ok: false,
          error: `Hermes base URL must be http(s): ${patch.hermesBaseUrl}`,
        };
      }
      next.hermesBaseUrl = trimmed;
    }

    if (patch.theme !== undefined) {
      if (next.theme !== "system" && next.theme !== "light" && next.theme !== "dark") {
        return { ok: false, error: `Invalid theme: ${String(patch.theme)}` };
      }
    }

    if (patch.weekStartDay !== undefined) {
      if (!isWeekStartDay(patch.weekStartDay)) {
        return { ok: false, error: `Invalid weekStartDay: ${String(patch.weekStartDay)}` };
      }
      if (patch.weekStartDay !== currentWeekStart) {
        const n = await countWeeklyVaultFiles(rootPath);
        if (n > 0) {
          return {
            ok: false,
            error: `Cannot change week start while ${n} weekly review/planning file(s) exist.`,
          };
        }
      }
      next.weekStartDay = patch.weekStartDay;
    }

    await atomicWriteFile(paths.settingsJson, `${JSON.stringify(next, null, 2)}\n`);
    return { ok: true, value: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
