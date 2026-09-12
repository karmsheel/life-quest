import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Actor, LifeEvent, Result } from "./types.ts";
import { vaultPaths } from "./paths.ts";

function asActor(value: unknown): Actor | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { type?: unknown; id?: unknown; name?: unknown };
  if (v.type === "user") return { type: "user" };
  if (v.type === "agent" && typeof v.id === "string" && typeof v.name === "string") {
    return { type: "agent", id: v.id, name: v.name };
  }
  return null;
}

export async function readLog(rootPath: string): Promise<Result<LifeEvent[]>> {
  try {
    const p = vaultPaths(rootPath).logJsonl;
    const raw = await fs.readFile(p, "utf8").catch(() => "");
    const events: LifeEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as LifeEvent & { actor?: unknown };
      events.push({ ...parsed, actor: asActor(parsed.actor) });
    }
    return { ok: true, value: events };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function appendLog(
  rootPath: string,
  event: Omit<LifeEvent, "id" | "createdAt"> & { id?: string; createdAt?: string },
): Promise<Result<LifeEvent>> {
  try {
    const full: LifeEvent = {
      id: event.id ?? randomUUID(),
      domainSlug: event.domainSlug,
      type: event.type,
      summary: event.summary,
      payload: event.payload ?? null,
      createdAt: event.createdAt ?? new Date().toISOString(),
      actor: event.actor ?? null,
    };
    const paths = vaultPaths(rootPath);
    await fs.mkdir(paths.lifequestDir, { recursive: true });
    await fs.appendFile(paths.logJsonl, `${JSON.stringify(full)}\n`, "utf8");
    return { ok: true, value: full };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
