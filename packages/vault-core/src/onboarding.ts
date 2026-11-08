import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import {
  addDatabaseColumn,
  createDatabase,
  listDatabases,
} from "./domain-databases.ts";
import { saveDocument } from "./domain-documents.ts";
import { unlockDomain } from "./domains.ts";
import { COMPANION_ACTOR } from "./implied-decision.ts";
import { appendLog } from "./log.ts";
import { createPage, listPages, updatePage } from "./pages.ts";
import {
  assertNoSymlinkLeaf,
  assertPhysicalContainment,
  vaultPaths,
} from "./paths.ts";
import {
  AREA_SEEDS,
  BASE_AREA_SLUG,
  DATABASE_COLUMN_TYPES,
  DOCTRINE_ORDER,
  USER_ACTOR,
  type Actor,
  type DatabaseColumnType,
  type DocumentKind,
  type DomainMeta,
  type OnboardingAreaProposal,
  type OnboardingConfirmOptions,
  type OnboardingConfirmResult,
  type OnboardingNoteProposal,
  type OnboardingProposal,
  type OnboardingRecord,
  type OnboardingTableProposal,
  type PageRecord,
  type Result,
} from "./types.ts";
import { todayLocalIso } from "./map/public.ts";

/**
 * The onboarding interview (P1, 2026-11-08).
 *
 * The vault remembers, in `.lifequest/onboarding.json`, that the first-run
 * interview happened; the companion's single confirmation card is
 * `.lifequest/onboarding-proposal.json`. The rules below live here rather than in
 * the prompt because a prompt drifts:
 *
 *  - A vault with NO onboarding file reads as `completed` — the migration rule
 *    that keeps every existing vault out of the first-run card. A new vault gets
 *    the file at creation with `not_started`.
 *  - The cap and the "seeded area, currently locked" rule are checked against the
 *    vault directory directly (`domains/<slug>/domain.json`), deliberately
 *    bypassing the `isDomainLive` hinge: that hinge answers "may a record live
 *    here", and answering it would hide the locked areas the interview exists to
 *    offer. The area's display name always comes from `AREA_SEEDS`, never from
 *    the model.
 *  - Nothing the proposal contains is written until the operator confirms; the
 *    confirm is the consent record, and the companion is the author
 *    (`COMPANION_ACTOR`), so the batch is attributable without becoming five
 *    inbox Decisions.
 *  - Confirm's ordering is unlock → doctrine → table → note → completed record →
 *    delete proposal → log. A mid-batch failure returns an error with the
 *    proposal intact; every step is idempotent, so the retry is safe.
 */

/** The seeded areas the interview may unlock, in seed order. Never `life`. */
export const ONBOARDING_SEEDED_AREA_SLUGS: readonly string[] = AREA_SEEDS.filter(
  (seed) => seed.locked,
).map((seed) => seed.slug);

/** The interview cap: a first session that opens all five is a taxonomy delivery. */
export const ONBOARDING_AREA_MIN = 1;
export const ONBOARDING_AREA_MAX = 3;

/** At most one table, and it is a hand-written one, so its shape is bounded. */
export const ONBOARDING_TABLE_COLUMN_MIN = 1;
export const ONBOARDING_TABLE_COLUMN_MAX = 8;

/** The note's title when the model did not give one. */
export const ONBOARDING_NOTE_TITLE_PREFIX = "First conversation — ";

const COMPLETED_REFUSAL = "Onboarding is complete; the interview does not run again.";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * What a seeded area currently looks like on disk, as the validator needs it.
 * `locked` is exactly `unlockedAt === null`; an absent `unlockedAt` is unlocked,
 * the same legacy rule every other area read uses.
 */
export type OnboardingAreaState = { locked: boolean; archived: boolean };

export type OnboardingAreaStates = Readonly<Record<string, OnboardingAreaState>>;

/**
 * The record a vault with no onboarding file reads as. Synthetic: reading never
 * writes it, so an existing operator is never migrated just by opening the vault.
 */
export function legacyOnboardingRecord(): OnboardingRecord {
  return { status: "completed", startedAt: null, completedAt: null, unlockedAreas: [] };
}

function isStatus(value: unknown): value is OnboardingRecord["status"] {
  return value === "not_started" || value === "in_progress" || value === "completed";
}

function isDocumentKind(value: unknown): value is DocumentKind {
  return (DOCTRINE_ORDER as readonly unknown[]).includes(value);
}

/** The record as stored, or null when it cannot be trusted. */
function normalizeStoredRecord(raw: unknown): OnboardingRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isStatus(record.status)) return null;
  const startedAt = record.startedAt;
  const completedAt = record.completedAt;
  if (!(startedAt === null || typeof startedAt === "string")) return null;
  if (!(completedAt === null || typeof completedAt === "string")) return null;
  const unlockedAreas = Array.isArray(record.unlockedAreas)
    ? record.unlockedAreas.filter((slug): slug is string => typeof slug === "string")
    : [];
  return { status: record.status, startedAt, completedAt, unlockedAreas };
}

/**
 * Read the onboarding record.
 *
 * A missing OR malformed file reads as `completed`: a corrupt file must never
 * show an existing operator a first-run card, and the read must never fail the
 * whole vault open. Reading never creates the file.
 */
export async function readOnboardingRecord(root: string): Promise<Result<OnboardingRecord>> {
  try {
    const paths = vaultPaths(root);
    // A symlinked record is refused and read as legacy rather than followed: the
    // bytes it points at are not the vault's own memory.
    await assertPhysicalContainment(root, paths.onboardingJson, "read");
    await assertNoSymlinkLeaf(paths.onboardingJson);
    let raw: string;
    try {
      raw = await fs.readFile(paths.onboardingJson, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: legacyOnboardingRecord() };
      }
      throw e;
    }
    const normalized = normalizeStoredRecord(JSON.parse(raw));
    return { ok: true, value: normalized ?? legacyOnboardingRecord() };
  } catch {
    // Malformed JSON, an unreadable file, or a symlinked path: all read as the
    // legacy completed record. Never an error, never a throw.
    return { ok: true, value: legacyOnboardingRecord() };
  }
}

/**
 * Begin the interview. Idempotent: `in_progress` and `completed` are returned
 * unchanged, and `onboarding.started` is logged exactly once — on the transition
 * out of `not_started`. A vault with no record file is legacy/completed, so this
 * is a no-op there.
 *
 * The caller is the operator clicking *Begin* (or typing first), so the default
 * actor is the user; a companion turn that starts it passes its own actor.
 */
export async function startOnboarding(
  root: string,
  actor: Actor = USER_ACTOR,
): Promise<Result<OnboardingRecord>> {
  try {
    const recordRes = await readOnboardingRecord(root);
    if (!recordRes.ok) return recordRes;
    const current = recordRes.value;
    if (current.status !== "not_started") return { ok: true, value: current };

    const paths = vaultPaths(root);
    const next: OnboardingRecord = {
      status: "in_progress",
      startedAt: new Date().toISOString(),
      completedAt: null,
      unlockedAreas: [],
    };
    await assertPhysicalContainment(root, paths.onboardingJson, "write");
    await atomicWriteFile(paths.onboardingJson, `${JSON.stringify(next, null, 2)}\n`);

    const logRes = await appendLog(root, {
      domainSlug: null,
      type: "onboarding.started",
      summary: "Onboarding started",
      payload: {},
      actor,
    });
    if (!logRes.ok) return { ok: false, error: logRes.error };
    return { ok: true, value: next };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * Read the pending proposal, or null when there is none.
 *
 * The stored proposal is structurally re-checked (we wrote it, but a hand-edited
 * or half-written file must not reach the confirmation card); a malformed file is
 * an error here, and `openVault` falls back to "no card" rather than failing.
 */
export async function readOnboardingProposal(
  root: string,
): Promise<Result<OnboardingProposal | null>> {
  try {
    const paths = vaultPaths(root);
    await assertPhysicalContainment(root, paths.onboardingProposalJson, "read");
    await assertNoSymlinkLeaf(paths.onboardingProposalJson);
    let raw: string;
    try {
      raw = await fs.readFile(paths.onboardingProposalJson, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: null };
      throw e;
    }
    const parsed = normalizeStoredProposal(JSON.parse(raw));
    if (!parsed) {
      return { ok: false, error: "The stored onboarding proposal is malformed." };
    }
    return { ok: true, value: parsed };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

function normalizeStoredProposal(raw: unknown): OnboardingProposal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const proposal = raw as Record<string, unknown>;
  const createdAt = proposal.createdAt;
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) return null;

  const rawAreas = proposal.areas;
  if (!Array.isArray(rawAreas) || rawAreas.length < ONBOARDING_AREA_MIN || rawAreas.length > ONBOARDING_AREA_MAX) {
    return null;
  }
  const areas: OnboardingAreaProposal[] = [];
  for (const rawArea of rawAreas) {
    if (!rawArea || typeof rawArea !== "object") return null;
    const area = rawArea as Record<string, unknown>;
    const slug = area.slug;
    const name = area.name;
    if (typeof slug !== "string" || !ONBOARDING_SEEDED_AREA_SLUGS.includes(slug)) return null;
    if (typeof name !== "string" || !name.trim()) return null;
    if (!Array.isArray(area.doctrine) || area.doctrine.length !== DOCTRINE_ORDER.length) return null;
    const doctrine: OnboardingAreaProposal["doctrine"] = [];
    for (const rawDoc of area.doctrine) {
      if (!rawDoc || typeof rawDoc !== "object") return null;
      const doc = rawDoc as Record<string, unknown>;
      if (!isDocumentKind(doc.kind)) return null;
      if (typeof doc.bodyMarkdown !== "string" || !doc.bodyMarkdown.trim()) return null;
      if (doctrine.some((entry) => entry.kind === doc.kind)) return null;
      doctrine.push({ kind: doc.kind, bodyMarkdown: doc.bodyMarkdown });
    }
    areas.push({ slug, name, doctrine });
  }

  let table: OnboardingTableProposal | null = null;
  if (proposal.table !== null && proposal.table !== undefined) {
    const rawTable = proposal.table;
    if (typeof rawTable !== "object" || Array.isArray(rawTable)) return null;
    const candidate = rawTable as Record<string, unknown>;
    const areaSlug = candidate.areaSlug;
    if (typeof areaSlug !== "string" || !areas.some((area) => area.slug === areaSlug)) return null;
    if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
    if (
      !Array.isArray(candidate.columns) ||
      candidate.columns.length < ONBOARDING_TABLE_COLUMN_MIN ||
      candidate.columns.length > ONBOARDING_TABLE_COLUMN_MAX
    ) {
      return null;
    }
    const columns: OnboardingTableProposal["columns"] = [];
    for (const rawColumn of candidate.columns) {
      if (!rawColumn || typeof rawColumn !== "object") return null;
      const column = rawColumn as Record<string, unknown>;
      if (typeof column.name !== "string" || !column.name.trim()) return null;
      if (typeof column.type !== "string" || !isColumnType(column.type)) return null;
      if (column.type === "relation") return null;
      columns.push(
        column.type === "select" && Array.isArray(column.options)
          ? {
              name: column.name,
              type: column.type,
              options: column.options.filter((o): o is string => typeof o === "string" && Boolean(o.trim())),
            }
          : { name: column.name, type: column.type },
      );
    }
    table = { areaSlug, name: candidate.name, columns };
  }

  const rawNote = proposal.note;
  if (!rawNote || typeof rawNote !== "object" || Array.isArray(rawNote)) return null;
  const note = rawNote as Record<string, unknown>;
  if (typeof note.title !== "string" || !note.title.trim()) return null;
  if (typeof note.bodyMarkdown !== "string" || !note.bodyMarkdown.trim()) return null;

  return { areas, table, note: { title: note.title, bodyMarkdown: note.bodyMarkdown }, createdAt };
}

function isColumnType(value: unknown): value is DatabaseColumnType {
  return typeof value === "string" && (DATABASE_COLUMN_TYPES as readonly string[]).includes(value);
}

/**
 * Read the five seeded areas' lock state straight off disk.
 *
 * Deliberately NOT `isDomainLive`/`listDomains` through the hinge: the validator
 * must see a locked area in order to offer it. A missing area is simply absent
 * from the map, and the validator names it as unavailable.
 */
export async function readOnboardingAreaStates(
  root: string,
): Promise<Result<OnboardingAreaStates>> {
  try {
    const paths = vaultPaths(root);
    const states: Record<string, OnboardingAreaState> = {};
    for (const slug of ONBOARDING_SEEDED_AREA_SLUGS) {
      const metaPath = paths.domainJson(slug);
      await assertPhysicalContainment(root, metaPath, "read");
      await assertNoSymlinkLeaf(metaPath);
      let raw: string;
      try {
        raw = await fs.readFile(metaPath, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      const meta = JSON.parse(raw) as DomainMeta;
      states[slug] = {
        // The whole lock rule in one place: explicit null is locked; an absent
        // field is unlocked, so a legacy vault is never a locked one.
        locked: meta.unlockedAt === null,
        archived: meta.archivedAt != null,
      };
    }
    return { ok: true, value: states };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

type RawDoctrine =
  | { kind: DocumentKind; bodyMarkdown: string }[]
  | Record<string, unknown>;

/**
 * The proposal validator, pure: input in, normalized proposal out, no I/O.
 *
 * It accepts the tool's own argument shape (`doctrine` as an object of the four
 * kind→body strings, `note.body`) as well as the stored engine shape (`doctrine`
 * as an array of `{kind, bodyMarkdown}`, `note.bodyMarkdown`), because there is
 * one place that enforces the rules and it is this function.
 *
 * `areas` is the live lock state from `readOnboardingAreaStates`; the display
 * name always comes from `AREA_SEEDS`, and `createdAt` from `now`.
 */
export function validateOnboardingProposal(
  input: unknown,
  areas: OnboardingAreaStates,
  now: Date = new Date(),
): Result<OnboardingProposal> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "The proposal must be an object." };
  }
  const raw = input as Record<string, unknown>;

  const rawAreas = raw.areas;
  if (!Array.isArray(rawAreas)) {
    return { ok: false, error: "`areas` is required: the seeded areas the interview heard." };
  }
  if (rawAreas.length < ONBOARDING_AREA_MIN || rawAreas.length > ONBOARDING_AREA_MAX) {
    return {
      ok: false,
      error: `The interview unlocks between ${ONBOARDING_AREA_MIN} and ${ONBOARDING_AREA_MAX} areas per confirmation (got ${rawAreas.length}).`,
    };
  }

  const proposed: OnboardingAreaProposal[] = [];
  const seen = new Set<string>();
  for (const rawArea of rawAreas) {
    if (!rawArea || typeof rawArea !== "object" || Array.isArray(rawArea)) {
      return { ok: false, error: "Each proposed area must be an object with a `slug` and a `doctrine`." };
    }
    const area = rawArea as Record<string, unknown>;
    const slug = area.slug;
    if (typeof slug !== "string" || !slug.trim()) {
      return { ok: false, error: "Each proposed area needs a `slug`." };
    }
    const seed = AREA_SEEDS.find((entry) => entry.slug === slug);
    if (!seed || seed.slug === BASE_AREA_SLUG || !seed.locked) {
      return {
        ok: false,
        error: `\`${slug}\` is not one of the seeded areas the interview may unlock.`,
      };
    }
    if (seen.has(slug)) {
      return { ok: false, error: `The area ${seed.name} appears twice in the proposal.` };
    }
    seen.add(slug);

    const state = areas[slug];
    if (!state) {
      return { ok: false, error: `The area ${seed.name} (${slug}) is not present in this vault.` };
    }
    if (state.archived) {
      return { ok: false, error: `The area ${seed.name} is archived; unarchive it before proposing it.` };
    }
    if (!state.locked) {
      return { ok: false, error: `The area ${seed.name} is already unlocked, so it is not part of the interview.` };
    }

    const doctrineRes = normalizeDoctrine(area.doctrine);
    if (!doctrineRes.ok) {
      return { ok: false, error: `${seed.name}: ${doctrineRes.error}` };
    }
    proposed.push({ slug, name: seed.name, doctrine: doctrineRes.value });
  }

  // Table: at most one, on one of the proposal's own areas, hand-written columns.
  let table: OnboardingTableProposal | null = null;
  if (raw.table !== null && raw.table !== undefined) {
    if (typeof raw.table !== "object" || Array.isArray(raw.table)) {
      return { ok: false, error: "`table` must be an object or null." };
    }
    const rawTable = raw.table as Record<string, unknown>;
    const areaSlug = rawTable.areaSlug;
    if (typeof areaSlug !== "string" || !seen.has(areaSlug)) {
      return { ok: false, error: "`table.areaSlug` must be one of the proposal's areas." };
    }
    const name = rawTable.name;
    if (typeof name !== "string" || !name.trim()) {
      return { ok: false, error: "The table needs a non-empty `name`." };
    }
    const columnsRes = normalizeTableColumns(rawTable.columns);
    if (!columnsRes.ok) return columnsRes;
    table = { areaSlug, name: name.trim(), columns: columnsRes.value };
  }

  const noteRes = normalizeNote(raw.note, now);
  if (!noteRes.ok) return noteRes;

  return {
    ok: true,
    value: { areas: proposed, table, note: noteRes.value, createdAt: now.toISOString() },
  };
}

function normalizeDoctrine(raw: unknown): Result<OnboardingAreaProposal["doctrine"]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "a `doctrine` object with premise, what, why and how is required (one non-empty body each).",
    };
  }
  const record = raw as Record<string, unknown>;
  const bodyOf = (kind: DocumentKind): Result<string> => {
    const value = record[kind];
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, error: `the \`${kind}\` doctrine body must not be empty.` };
    }
    return { ok: true, value };
  };
  const doctrine: OnboardingAreaProposal["doctrine"] = [];
  for (const kind of DOCTRINE_ORDER) {
    const body = bodyOf(kind);
    if (!body.ok) return body;
    doctrine.push({ kind, bodyMarkdown: body.value });
  }
  return { ok: true, value: doctrine };
}

function normalizeTableColumns(
  rawColumns: unknown,
): Result<OnboardingTableProposal["columns"]> {
  if (!Array.isArray(rawColumns)) {
    return { ok: false, error: "The table's `columns` must be an array." };
  }
  if (
    rawColumns.length < ONBOARDING_TABLE_COLUMN_MIN ||
    rawColumns.length > ONBOARDING_TABLE_COLUMN_MAX
  ) {
    return {
      ok: false,
      error: `A table has ${ONBOARDING_TABLE_COLUMN_MIN}–${ONBOARDING_TABLE_COLUMN_MAX} columns (got ${rawColumns.length}).`,
    };
  }
  const columns: OnboardingTableProposal["columns"] = [];
  for (const rawColumn of rawColumns) {
    if (!rawColumn || typeof rawColumn !== "object" || Array.isArray(rawColumn)) {
      return { ok: false, error: "Each column must be an object with a `name` and a `type`." };
    }
    const column = rawColumn as Record<string, unknown>;
    if (typeof column.name !== "string" || !column.name.trim()) {
      return { ok: false, error: "Each table column needs a non-empty `name`." };
    }
    const type = column.type;
    if (!isColumnType(type)) {
      return { ok: false, error: `Unknown column type \`${String(type)}\` on column ${column.name}.` };
    }
    if (type === "relation") {
      return { ok: false, error: "Relation columns are not created in the first interview." };
    }
    if (type === "select") {
      const options = column.options;
      const cleaned = Array.isArray(options)
        ? options.filter((option): option is string => typeof option === "string" && Boolean(option.trim()))
        : [];
      if (cleaned.length < 1) {
        return { ok: false, error: `The select column ${column.name} needs at least one option.` };
      }
      columns.push({ name: column.name.trim(), type, options: cleaned });
      continue;
    }
    columns.push({ name: column.name.trim(), type });
  }
  return { ok: true, value: columns };
}

function normalizeNote(raw: unknown, now: Date): Result<OnboardingNoteProposal> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "`note` is required: the interview writes one note." };
  }
  const note = raw as Record<string, unknown>;
  const body = note.bodyMarkdown ?? note.body;
  if (typeof body !== "string" || !body.trim()) {
    return { ok: false, error: "The note's `body` must not be empty." };
  }
  if (!(note.title === undefined || note.title === null || typeof note.title === "string")) {
    return { ok: false, error: "The note's `title` must be a string." };
  }
  const title =
    typeof note.title === "string" && note.title.trim()
      ? note.title.trim()
      : `${ONBOARDING_NOTE_TITLE_PREFIX}${todayLocalIso(now)}`;
  return { ok: true, value: { title, bodyMarkdown: body } };
}

/**
 * Validate and store the companion's proposal, replacing any pending one.
 *
 * Refuses when the interview is complete. Validates against the live vault
 * (1–3 seeded, currently-locked areas; the four doctrine bodies; at most one
 * table on one of those areas, 1–8 typed non-relation columns; a required note);
 * a rejecting write writes nothing.
 */
export async function writeOnboardingProposal(
  root: string,
  input: unknown,
): Promise<Result<OnboardingProposal>> {
  try {
    const recordRes = await readOnboardingRecord(root);
    if (!recordRes.ok) return recordRes;
    if (recordRes.value.status === "completed") {
      return { ok: false, error: COMPLETED_REFUSAL };
    }

    const statesRes = await readOnboardingAreaStates(root);
    if (!statesRes.ok) return statesRes;
    const validated = validateOnboardingProposal(input, statesRes.value);
    if (!validated.ok) return validated;

    // A proposal means the interview is under way even when the record still says
    // `not_started` (a companion turn can propose before the operator clicks
    // Begin). Starting is idempotent, so this is a no-op for an in-progress vault.
    const started = await startOnboarding(root);
    if (!started.ok) return started;

    const paths = vaultPaths(root);
    await assertPhysicalContainment(root, paths.onboardingProposalJson, "write");
    await atomicWriteFile(
      paths.onboardingProposalJson,
      `${JSON.stringify(validated.value, null, 2)}\n`,
    );
    return { ok: true, value: validated.value };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * Drop the pending proposal and nothing else: the record stays `in_progress`, so
 * the dock returns to *Continue the interview*. Idempotent (no file is fine).
 */
export async function discardOnboardingProposal(root: string): Promise<Result<true>> {
  try {
    const paths = vaultPaths(root);
    await assertPhysicalContainment(root, paths.onboardingProposalJson, "write");
    await fs.rm(paths.onboardingProposalJson, { force: true });
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * The table step: find-or-create the database by name on its area, then add any
 * columns the proposal names that are not there yet. Both halves are what make a
 * failed batch safely retryable — the second run finds the first run's database
 * and columns instead of duplicating them.
 */
async function applyTable(root: string, table: OnboardingTableProposal): Promise<Result<true>> {
  const listed = await listDatabases(root, table.areaSlug);
  if (!listed.ok) return listed;
  let database = listed.value.find(
    (entry) => entry.domainSlug === table.areaSlug && entry.database.name === table.name,
  )?.database;
  if (!database) {
    const created = await createDatabase(root, table.areaSlug, { name: table.name });
    if (!created.ok) return created;
    database = created.value;
  }
  for (const column of table.columns) {
    if (database.columns.some((existing) => existing.name === column.name)) continue;
    const added = await addDatabaseColumn(root, table.areaSlug, database.id, {
      name: column.name,
      type: column.type,
      ...(column.options ? { options: column.options } : {}),
    });
    if (!added.ok) return added;
    database = added.value;
  }
  return { ok: true, value: true };
}

/**
 * The note step: find-or-create the page in the base `life` area by title, then
 * replace its single markdown block. Find-by-title is what keeps a retry from
 * writing the interview's note twice.
 *
 * The write is the operator's, not the companion's: `updatePage` with an agent
 * actor files a Decision, and the confirmation card is already the consent for
 * this batch (its authorship is recorded by the `onboarding.completed` event).
 */
async function applyNote(root: string, note: OnboardingNoteProposal): Promise<Result<PageRecord>> {
  const pagesRes = await listPages(root, BASE_AREA_SLUG);
  if (!pagesRes.ok) return pagesRes;
  const existing = pagesRes.value.find(
    (entry) => entry.domainSlug === BASE_AREA_SLUG && entry.page.title === note.title,
  )?.page;
  const block = { id: randomUUID(), kind: "markdown" as const, markdown: note.bodyMarkdown };

  let pageId: string;
  if (existing) {
    pageId = existing.id;
  } else {
    const created = await createPage(root, BASE_AREA_SLUG, { title: note.title });
    if (!created.ok) return created;
    pageId = created.value.id;
  }

  const updated = await updatePage(root, BASE_AREA_SLUG, pageId, { blocks: [block] }, USER_ACTOR);
  if (!updated.ok) return updated;
  if (!updated.value.applied) {
    return {
      ok: false,
      error: `The interview note page "${note.title}" is locked, so it was not written.`,
    };
  }
  return { ok: true, value: updated.value.page };
}

/**
 * Apply the confirmed proposal as ONE operator-confirmed batch.
 *
 * Refuses unless the record is `not_started`/`in_progress` AND a proposal exists.
 * Order: unlock → doctrine → table → note → completed record → delete proposal →
 * `onboarding.completed` with the manifest. A mid-batch failure returns an error
 * and leaves the proposal in place; a retry is safe because unlock is
 * idempotent, doctrine is an overwrite, and the table and note steps find-or-
 * create by name/title.
 *
 * The completed record is written and the proposal deleted LAST, so a batch can
 * never be marked complete while part of it was not applied.
 */
export async function confirmOnboarding(
  root: string,
  options: OnboardingConfirmOptions = {},
): Promise<Result<OnboardingConfirmResult>> {
  try {
    const recordRes = await readOnboardingRecord(root);
    if (!recordRes.ok) return recordRes;
    const record = recordRes.value;
    if (record.status === "completed") {
      return { ok: false, error: "Onboarding is already complete." };
    }

    const proposalRes = await readOnboardingProposal(root);
    if (!proposalRes.ok) return proposalRes;
    const proposal = proposalRes.value;
    if (!proposal) {
      return { ok: false, error: "There is no onboarding proposal to confirm." };
    }

    // Re-check the parts the IPC facade only checks for sender: the seeded areas
    // (never `life`), the cap, and no duplicates. The areas may already be
    // unlocked (Settings can unlock one while the card is pending), which the
    // idempotent unlock below handles.
    const areaSlugs: string[] = [];
    for (const area of proposal.areas) {
      if (!ONBOARDING_SEEDED_AREA_SLUGS.includes(area.slug) || area.slug === BASE_AREA_SLUG) {
        return { ok: false, error: `The proposal names an area that cannot be unlocked: ${area.slug}` };
      }
      if (areaSlugs.includes(area.slug)) {
        return { ok: false, error: `The proposal names ${area.slug} twice.` };
      }
      areaSlugs.push(area.slug);
    }
    if (areaSlugs.length < ONBOARDING_AREA_MIN || areaSlugs.length > ONBOARDING_AREA_MAX) {
      return {
        ok: false,
        error: `The interview unlocks between ${ONBOARDING_AREA_MIN} and ${ONBOARDING_AREA_MAX} areas (got ${areaSlugs.length}).`,
      };
    }
    const statesRes = await readOnboardingAreaStates(root);
    if (!statesRes.ok) return statesRes;
    for (const slug of areaSlugs) {
      const state = statesRes.value[slug];
      if (!state) return { ok: false, error: `The area ${slug} is not present in this vault.` };
      if (state.archived) return { ok: false, error: `The area ${slug} is archived and cannot be unlocked.` };
    }

    const skip = new Set<DocumentKind>(
      (options.skipDoctrineKinds ?? []).filter(isDocumentKind),
    );
    const includeTable = options.includeTable !== false;
    const includeNote = options.includeNote !== false;

    // 1. Unlock each area. This keeps the P0 `domain.unlocked` event.
    for (const slug of areaSlugs) {
      const unlocked = await unlockDomain(root, slug);
      if (!unlocked.ok) return unlocked;
    }

    // 2. Doctrine drafts, attributed to the companion.
    let doctrineCount = 0;
    for (const area of proposal.areas) {
      for (const draft of area.doctrine) {
        if (skip.has(draft.kind)) continue;
        const saved = await saveDocument(
          root,
          area.slug,
          draft.kind,
          draft.bodyMarkdown,
          undefined,
          COMPANION_ACTOR,
        );
        if (!saved.ok) return saved;
        doctrineCount += 1;
      }
    }

    // 3. The one table, on a now-unlocked area.
    let tableApplied = false;
    if (includeTable && proposal.table) {
      const applied = await applyTable(root, proposal.table);
      if (!applied.ok) return applied;
      tableApplied = true;
    }

    // 4. The one note, in the base area.
    let noteApplied = false;
    if (includeNote) {
      const applied = await applyNote(root, proposal.note);
      if (!applied.ok) return applied;
      noteApplied = true;
    }

    // 5. The completed record. `startedAt` is preserved: an interview confirmed
    // straight from `not_started` never began, and this write must not invent it.
    const paths = vaultPaths(root);
    const completed: OnboardingRecord = {
      status: "completed",
      startedAt: record.startedAt,
      completedAt: new Date().toISOString(),
      unlockedAreas: areaSlugs,
    };
    await assertPhysicalContainment(root, paths.onboardingJson, "write");
    await atomicWriteFile(paths.onboardingJson, `${JSON.stringify(completed, null, 2)}\n`);

    // 6. Only now is the proposal spent.
    await assertPhysicalContainment(root, paths.onboardingProposalJson, "write");
    await fs.rm(paths.onboardingProposalJson, { force: true });

    // 7. One event for the whole batch, with the manifest.
    const logRes = await appendLog(root, {
      domainSlug: null,
      type: "onboarding.completed",
      summary: "Onboarding complete",
      payload: {
        areas: areaSlugs,
        table: tableApplied,
        note: noteApplied,
        doctrineCount,
      },
      actor: COMPANION_ACTOR,
    });
    if (!logRes.ok) return { ok: false, error: logRes.error };

    return { ok: true, value: { areas: areaSlugs, table: tableApplied, note: noteApplied } };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
