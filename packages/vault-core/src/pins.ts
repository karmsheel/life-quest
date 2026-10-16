import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import { VIEW_ID_PATTERN } from "./views.ts";
import {
  SYSTEM_PIN_KINDS,
  type Actor,
  type Pin,
  type PinBoard,
  type PinBoardRead,
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

/**
 * A board's default lock state. A brand-new dashboard is unlocked, so the
 * operator can arrange it, and only becomes read-only when they say so — the
 * same default every doctrine document and library note ships with.
 */
export const DEFAULT_BOARD_LOCKED = false;

/** How a board is named in copy and in Decision headlines. */
export function boardLabel(domainSlug: string | null): string {
  return domainSlug == null ? "Overview dashboard" : `${domainSlug} dashboard`;
}

/**
 * Where a view's pin goes on a board, which for a card that is already there is
 * exactly where it already is.
 *
 * THE FAULT THIS REPAIRS (reported, then measured):
 *
 *   "I edited a card on the dashboard. After the change, the card moved to the
 *    bottom of the dashboard — though it told me it had stayed in place."
 *
 * The write was never wrong: the view file kept its id, its `createdAt` and its
 * contents, and the card the companion named is the card that changed. What was
 * wrong was the BOARD. The pin list was rebuilt as "every pin except this one,
 * then this one" — a filter followed by an append — which is a fine way to put a
 * NEW card on the end of a board and a wrong way to change one that is already
 * on it. The card left its slot, the grid closed the gap behind it and opened one
 * at the bottom, and the operator's dashboard rearranged itself around an edit
 * they had been told was in place.
 *
 * So the rule is stated once, here, and both write paths call it: **a card that
 * is already pinned keeps its index in the array, because a pin's index in the
 * array is its place on the board.** Only a pin the board does not already carry
 * is appended.
 *
 * There are two write paths and they must not drift: `writeViewAndPin` in
 * `views-tools.ts`, which applies an unlocked `save_view` at once, and
 * `applyViewDecision` in `decisions.ts`, which applies the same change when the
 * operator approves the Decision a locked board filed. Both used to spell the
 * filter-then-append out for themselves; the second is the one a fix to the
 * first would have left behind, sending the card to the bottom on approval only.
 *
 * A duplicate is dropped rather than replaced in place. Two pins for one view on
 * one board is a state nothing is supposed to produce — but a board that has one
 * (hand-edited, or written before this rule existed) must not be left with a
 * third after an edit, and the FIRST occurrence is the one the operator has been
 * looking at.
 *
 * `width.spanNamed` is whether the caller asked for a width at all. A missing
 * span means 1 for a card being CREATED — the width that lets the board size the
 * card to its own content, which is what a caller saying nothing is asking for.
 * It does not mean 1 for a card being CHANGED: a full-row card edited without
 * naming a width would silently shrink to the board's own choice, which is the
 * card leaving its place by a second route. On an edit the card's own width
 * stands unless the caller names a different one.
 */
export function placeViewPin(
  pins: Pin[],
  domainSlug: string,
  viewId: string,
  width: { span: 1 | 2; spanNamed: boolean },
): { pins: Pin[]; existed: boolean; position: number; span: 1 | 2 } {
  const isTheCard = (pin: Pin) =>
    pin.kind === "view" && pin.domainSlug === domainSlug && pin.viewId === viewId;
  const position = pins.findIndex(isTheCard);
  if (position < 0) {
    const pin: Pin = {
      id: `view:${domainSlug}:${viewId}`,
      kind: "view",
      domainSlug,
      viewId,
      span: width.span,
    };
    return { pins: [...pins, pin], existed: false, position: pins.length, span: pin.span };
  }
  const existing = pins[position] as Extract<Pin, { kind: "view" }>;
  const span = width.spanNamed ? width.span : existing.span;
  const pin: Pin = { id: `view:${domainSlug}:${viewId}`, kind: "view", domainSlug, viewId, span };
  const next: Pin[] = [];
  let replaced = false;
  let at = position;
  for (const candidate of pins) {
    if (!isTheCard(candidate)) {
      next.push(candidate);
      continue;
    }
    if (replaced) continue;
    at = next.length;
    next.push(pin);
    replaced = true;
  }
  return { pins: next, existed: true, position: at, span };
}

/**
 * The board file as it stands, lock flag included, with no validation of the
 * pins themselves. Callers that are about to write need exactly this: the lock
 * is a property of the stored file, not of the pins the read path kept, so a
 * lock gate that asked the filtered list would see a board whose only difference
 * from an unlocked one is which cards survived.
 */
async function readBoard(root: string, domainSlug: string | null): Promise<PinBoard | null> {
  const paths = vaultPaths(root);
  const filePath = domainSlug == null ? paths.overviewPins : paths.domainPins(domainSlug);
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

/**
 * One board's page lock. A board file that predates the lock, or that is not
 * there at all, reads as unlocked: the flag is added on the next write, and the
 * absence of a file is not a lock. That is the same read-migration doctrine
 * documents use, and it keeps `schemaVersion` at 1.
 */
export async function isPinBoardLocked(
  root: string,
  domainSlug: string | null,
): Promise<boolean> {
  const board = await readBoard(root, domainSlug);
  return board?.locked === true;
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

export async function listPinBoard(
  root: string,
  domainSlug?: string | null,
): Promise<Result<PinBoardRead>> {
  try {
    const paths = vaultPaths(root);
    const slug = domainSlug ?? null;
    const board = await readBoard(root, slug);
    if (!board) {
      // Missing file → the seeded defaults, and unlocked. Reading never writes.
      return { ok: true, value: { pins: defaultPins(), locked: DEFAULT_BOARD_LOCKED } };
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
        // view drops off the board instead of crashing the dashboard. A domain
        // board shows only its own views; Overview takes any live domain's,
        // which is the rule setPins enforces on the way in.
        if (!liveSlugs.has(pin.domainSlug)) continue;
        if (slug !== null && pin.domainSlug !== slug) continue;
        if (!(await viewExists(root, pin.domainSlug, pin.viewId))) continue;
        validPins.push(pin);
      } else {
        // Page pin: domain must be live and page must exist
        if (!liveSlugs.has(pin.domainSlug)) continue;
        if (!(await pageExists(root, pin.domainSlug, pin.pageId))) continue;
        // Domain board: page pin must belong to that domain
        if (slug !== null && pin.domainSlug !== slug) continue;
        validPins.push(pin);
      }
    }

    return { ok: true, value: { pins: validPins, locked: board.locked === true } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The pins alone, for callers that do not care about the lock. */
export async function listPins(
  root: string,
  domainSlug?: string | null,
): Promise<Result<Pin[]>> {
  const res = await listPinBoard(root, domainSlug);
  return res.ok ? { ok: true, value: res.value.pins } : res;
}

export async function setPins(
  root: string,
  domainSlug: string | null,
  pins: Pin[],
  actor: Actor,
  /**
   * Set only by the Decision applier. Approving a board Decision IS the
   * operator's consent, so the write must land even though the board it lands
   * on is still locked — the lock is what put the change in the inbox, not a
   * bar the approval then has to clear a second time.
   */
  opts?: { approvedChange?: boolean },
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
      } else if (pin.kind === "view") {
        // Agent-built view pin (plan.md design): the shape guard runs in the
        // tool's own parser; existence is checked like a page pin — a view
        // pointed at a dead domain, a foreign board, or a missing file is a hard
        // error here, while listPinBoard (the read path) drops it silently.
        if (!liveSlugs.has(pin.domainSlug)) {
          return { ok: false, error: `Domain not live: ${pin.domainSlug}` };
        }
        if (!(await viewExists(root, pin.domainSlug, pin.viewId))) {
          return { ok: false, error: `View not found: ${pin.viewId}` };
        }
        // A view pin carries the domain that OWNS the view, and the board it
        // sits on is a separate thing. A domain board shows only its own
        // views; the Overview board is the cross-domain board and takes any
        // live domain's view, because that is the only place a summary that
        // spans domains can live. This is the same rule listPins already
        // applies, and the two must not disagree: a pin the read path accepts
        // and the write path refuses is a card the operator can see and never
        // create.
        if (domainSlug !== null && pin.domainSlug !== domainSlug) {
          return { ok: false, error: `View pin belongs to different domain: ${pin.domainSlug}` };
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

    // The page lock is the gate, and it is the ONLY one — the actor no longer
    // decides. Unlocked, the operator and the companion change the board in
    // place, and a connected hire does too, because the operator has said this
    // board is still being worked on. Locked, the board is read-only and every
    // change becomes one pending Decision: the operator's own click (a locked
    // board has no chrome to click), the companion's arrange, and a hire's
    // alike. The old rule special-cased the companion by name, which is exactly
    // the kind of rule that drifts from what the operator believes they set.
    const board = await readBoard(root, domainSlug);
    const locked = board?.locked === true;
    if (locked && !opts?.approvedChange) {
      const { createDecision } = await import("./decisions.ts");
      const decisionRes = await createDecision(root, {
        target: { type: "pins", domainSlug },
        proposedTitle: `${boardLabel(domainSlug)} pins`,
        proposedBodyMarkdown: JSON.stringify({ pins }, null, 2),
        actor,
      });
      if (!decisionRes.ok) return decisionRes;
      return { ok: true, value: { applied: false, decision: decisionRes.value, locked } };
    }

    // Unlocked (or an approval landing through the gate) → write file. The lock
    // flag is carried over: a pin write must never silently unlock the page.
    const next: PinBoard = { schemaVersion: 1, pins, locked };
    await atomicWriteFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
    return { ok: true, value: { applied: true, pins, locked } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The operator's page lock on one dashboard. User-only, exactly like a document
 * lock: an agent that could unlock the page could then edit it unapproved, which
 * would make the gate advisory. The Life log line names who toggled it.
 */
export async function setPinBoardLocked(
  root: string,
  domainSlug: string | null,
  locked: boolean,
  actor: Actor,
): Promise<Result<PinBoardRead>> {
  if (actor.type !== "user") {
    return { ok: false, error: "Only the user can lock or unlock a dashboard" };
  }
  try {
    const paths = vaultPaths(root);
    const filePath = domainSlug == null ? paths.overviewPins : paths.domainPins(domainSlug);
    const board = await readBoard(root, domainSlug);
    // Reading and writing the lock are separate acts: a lock toggle on a board
    // that has never been arranged must keep the seeded pins, not empty it.
    // The stored pins are taken as-is — listPins is the validated view, and a
    // pin dropped for pointing at a dead domain must not be deleted by a lock.
    const pins = board?.pins ?? defaultPins();
    const next: PinBoard = { schemaVersion: 1, pins, locked };
    await atomicWriteFile(filePath, `${JSON.stringify(next, null, 2)}\n`);

    await appendLog(root, {
      domainSlug,
      type: "board.lock_changed",
      summary: locked
        ? `Locked the ${boardLabel(domainSlug)}`
        : `Unlocked the ${boardLabel(domainSlug)}`,
      payload: { domainSlug, locked },
      actor,
    });

    return { ok: true, value: { pins, locked } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

