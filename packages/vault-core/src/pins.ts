import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { vaultPaths } from "./paths.ts";
import { VIEW_ID_PATTERN } from "./views.ts";
import {
  SYSTEM_PIN_KINDS,
  type Actor,
  type Pin,
  type PinBoard,
  type PinWriteResult,
  type Result,
  type SystemPinKind,
} from "./types.ts";

function isSystemPinKind(kind: string): kind is SystemPinKind {
  return (SYSTEM_PIN_KINDS as readonly string[]).includes(kind);
}

export function defaultPins(): Pin[] {
  return SYSTEM_PIN_KINDS.map((kind) => ({
    id: `sys:${kind}`,
    kind: "system" as const,
    system: kind,
  }));
}

function validatePins(
  pins: unknown,
  liveDomainSlugs: Set<string>,
  pageExists: (slug: string, pageId: string) => Promise<boolean>,
): Result<Pin[]> {
  if (!Array.isArray(pins)) {
    return { ok: false, error: "pins must be an array" };
  }
  const seenIds = new Set<string>();
  for (const raw of pins) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "pin must be an object" };
    }
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id) {
      return { ok: false, error: "pin id is required" };
    }
    if (seenIds.has(p.id)) {
      return { ok: false, error: `Duplicate pin id: ${p.id}` };
    }
    seenIds.add(p.id);
    if (p.kind === "system") {
      if (!isSystemPinKind(p.system)) {
        return { ok: false, error: `Unknown system pin kind: ${String(p.system)}` };
      }
    } else if (p.kind === "page") {
      if (typeof p.domainSlug !== "string" || !p.domainSlug) {
        return { ok: false, error: "page pin requires domainSlug" };
      }
      if (typeof p.pageId !== "string" || !p.pageId) {
        return { ok: false, error: "page pin requires pageId" };
      }
      // Overview may pin a page from any live domain; domain board must belong to that domain
      // We'll validate page existence separately in setPins/listPins where we know the context
    } else if (p.kind === "view") {
      // Agent-built view pin (plan.md design): the shape guard here, existence
      // validated in listPins where the live domain and view file are known.
      if (typeof p.domainSlug !== "string" || !p.domainSlug) {
        return { ok: false, error: "view pin requires domainSlug" };
      }
      if (typeof p.viewId !== "string" || !p.viewId) {
        return { ok: false, error: "view pin requires viewId" };
      }
      if (p.span !== 1 && p.span !== 2) {
        return { ok: false, error: "view pin span must be 1 or 2" };
      }
    } else {
      return { ok: false, error: `Invalid pin kind: ${String(p.kind)}` };
    }
  }
  return { ok: true, value: pins as Pin[] };
}

async function readPinBoard(filePath: string): Promise<PinBoard | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.schemaVersion === 1 &&
      Array.isArray(parsed.pins)
    ) {
      return parsed as PinBoard;
    }
    return null;
  } catch {
    return null;
  }
}

async function pageExists(root: string, slug: string, pageId: string): Promise<boolean> {
  try {
    const pagePath = vaultPaths(root).domainPage(slug, pageId);
    await fs.access(pagePath);
    return true;
  } catch {
    return false;
  }
}

async function viewExists(root: string, slug: string, viewId: string): Promise<boolean> {
  if (!VIEW_ID_PATTERN.test(viewId)) return false;
  try {
    await fs.access(vaultPaths(root).domainView(slug, viewId));
    return true;
  } catch {
    return false;
  }
}

export async function listPins(
  root: string,
  domainSlug?: string | null,
): Promise<Result<Pin[]>> {
  try {
    const paths = vaultPaths(root);
    const filePath = domainSlug == null ? paths.overviewPins : paths.domainPins(domainSlug);

    const board = await readPinBoard(filePath);
    if (!board) {
      // Missing file → return defaults, do not write
      return { ok: true, value: defaultPins() };
    }

    // Validate pins against live domains and existing pages
    const liveSlugs = new Set<string>();
    try {
      const domainEntries = await fs.readdir(paths.domainsDir, { withFileTypes: true });
      for (const entry of domainEntries) {
        if (!entry.isDirectory()) continue;
        const metaPath = paths.domainJson(entry.name);
        try {
          const raw = await fs.readFile(metaPath, "utf8");
          const meta = JSON.parse(raw);
          if (meta.archivedAt == null) liveSlugs.add(entry.name);
        } catch {}
      }
    } catch {}

    const validPins: Pin[] = [];
    for (const pin of board.pins) {
      if (pin.kind === "system") {
        validPins.push(pin);
      } else if (pin.kind === "view") {
        // A view pin needs a live domain and an existing view file; a deleted
        // view drops off the board instead of crashing the dashboard.
        if (!liveSlugs.has(pin.domainSlug)) continue;
        if (domainSlug !== null && pin.domainSlug !== domainSlug) continue;
        if (!(await viewExists(root, pin.domainSlug, pin.viewId))) continue;
        validPins.push(pin);
      } else {
        // Page pin: domain must be live and page must exist
        if (!liveSlugs.has(pin.domainSlug)) continue;
        if (!(await pageExists(root, pin.domainSlug, pin.pageId))) continue;
        // Domain board: page pin must belong to that domain
        if (domainSlug !== null && pin.domainSlug !== domainSlug) continue;
        validPins.push(pin);
      }
    }

    return { ok: true, value: validPins };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setPins(
  root: string,
  domainSlug: string | null,
  pins: Pin[],
  actor: Actor,
): Promise<Result<PinWriteResult>> {
  try {
    const paths = vaultPaths(root);
    const filePath = domainSlug == null ? paths.overviewPins : paths.domainPins(domainSlug);

    // Validate shape
    const liveSlugs = new Set<string>();
    try {
      const domainEntries = await fs.readdir(paths.domainsDir, { withFileTypes: true });
      for (const entry of domainEntries) {
        if (!entry.isDirectory()) continue;
        const metaPath = paths.domainJson(entry.name);
        try {
          const raw = await fs.readFile(metaPath, "utf8");
          const meta = JSON.parse(raw);
          if (meta.archivedAt == null) liveSlugs.add(entry.name);
        } catch {}
      }
    } catch {}

    for (const pin of pins) {
      if (pin.kind === "system") {
        if (!isSystemPinKind(pin.system)) {
          return { ok: false, error: `Unknown system pin kind: ${String(pin.system)}` };
        }
      } else if (pin.kind === "page") {
        if (!liveSlugs.has(pin.domainSlug)) {
          return { ok: false, error: `Domain not live: ${pin.domainSlug}` };
        }
        if (!(await pageExists(root, pin.domainSlug, pin.pageId))) {
          return { ok: false, error: `Page not found: ${pin.pageId}` };
        }
        if (domainSlug !== null && pin.domainSlug !== domainSlug) {
          return { ok: false, error: `Page pin belongs to different domain: ${pin.domainSlug}` };
        }
      } else {
        return { ok: false, error: `Invalid pin kind: ${String((pin as { kind?: unknown }).kind)}` };
      }
    }

    // Validate no duplicates
    const seenIds = new Set<string>();
    for (const pin of pins) {
      if (seenIds.has(pin.id)) {
        return { ok: false, error: `Duplicate pin id: ${pin.id}` };
      }
      seenIds.add(pin.id);
    }

    // Agent actor → create Decision, do NOT write
    if (actor.type === "agent") {
      const { createDecision } = await import("./decisions.ts");
      const label = domainSlug == null ? "Overview pins" : `${domainSlug} pins`;
      const decisionRes = await createDecision(root, {
        target: { type: "pins", domainSlug },
        proposedTitle: label,
        proposedBodyMarkdown: JSON.stringify({ pins }, null, 2),
        actor,
      });
      if (!decisionRes.ok) return decisionRes;
      return { ok: true, value: { applied: false, decision: decisionRes.value } };
    }

    // User actor → write file
    const board: PinBoard = { schemaVersion: 1, pins };
    await atomicWriteFile(filePath, `${JSON.stringify(board, null, 2)}\n`);
    return { ok: true, value: { applied: true, pins } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
