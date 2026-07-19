import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { LifeEvent, Result } from "./types.ts";
import { vaultPaths } from "./paths.ts";

export async function readLog(rootPath: string): Promise<Result<LifeEvent[]>> {
  try {
    const p = vaultPaths(rootPath).logJsonl;
    const raw = await fs.readFile(p, "utf8").catch(() => "");
    const events: LifeEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line) as LifeEvent);
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
    };
    const paths = vaultPaths(rootPath);
    await fs.mkdir(paths.lifequestDir, { recursive: true });
    await fs.appendFile(paths.logJsonl, `${JSON.stringify(full)}\n`, "utf8");
    return { ok: true, value: full };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
