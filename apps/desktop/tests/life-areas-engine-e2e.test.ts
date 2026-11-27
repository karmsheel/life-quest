import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  AREA_SEEDS,
  BASE_AREA_SLUG,
  USER_ACTOR,
  archiveDomain,
  createDatabase,
  createDecision,
  createDomain,
  createPage,
  createVault,
  deleteDomain,
  executeDocumentTool,
  isDomainLive,
  listDatabases,
  listDomains,
  listPages,
  liveDomainSlugs,
  openVault,
  readLog,
  unarchiveDomain,
  unlockDomain,
} from "@lifequest/vault-core";
import { resolveRestoredLens } from "../src/state/lens-persistence.ts";

/**
 * P0: one Life surface, seven locked areas.
 *
 * This rig runs the engine half against a real vault on disk — no window, no
 * fixture objects. It holds the contract the renderer and the companion both
 * read:
 *
 *  1. A new vault seeds the base `life` area unlocked and Health, Mind, Finance,
 *     Business, Relationships, Spiritual and Career LOCKED. Locked is
 *     `unlockedAt: null`; an absent field means unlocked, so every existing
 *     vault keeps every area.
 *  2. Locked areas are invisible to every domain-scoped engine read and refuse
 *     writes, and unlocking is a flag flip that creates and moves nothing.
 *  3. The Life area cannot be archived or deleted.
 *  4. A persisted lens that names a locked or archived area resolves to Life.
 *
 * The artifact is `e2e/artifacts/life-areas-engine.json`: the same seed, the
 * same flags and the same refusals on every run, no eyeballing.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/life-areas-engine.json");

type Check = { label: string; pass: boolean; detail: string | null };
const checks: Check[] = [];

function check(label: string, pass: boolean, detail: unknown = null): void {
  checks.push({
    label,
    pass,
    detail: detail === null ? null : String(detail),
  });
}

function metaPath(root: string, slug: string): string {
  return path.join(root, "domains", slug, "domain.json");
}

function readMeta(root: string, slug: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(metaPath(root, slug), "utf8")) as Record<
    string,
    unknown
  >;
}

function writeMeta(root: string, slug: string, meta: unknown): void {
  fs.writeFileSync(metaPath(root, slug), `${JSON.stringify(meta, null, 2)}\n`);
}

describe("areas: one life, seven locked areas (engine)", () => {
  it("seeds life unlocked and the seven areas locked, and keeps locked areas invisible to every read and write", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-areas-engine-"));
    const vaultRoot = path.join(workDir, "vault");
    const created = await createVault(vaultRoot, "Areas engine rig");
    assert.equal(created.ok, true, created.ok ? "" : created.error);

    // ── 1. the seed ──────────────────────────────────────────────────────
    const listed = await listDomains(vaultRoot);
    assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
    if (!listed.ok) return;
    const domains = listed.value;
    check(
      "eight areas are seeded (Life + the seven)",
      domains.length === AREA_SEEDS.length,
      domains.length,
    );

    const bySlug = new Map(domains.map((d) => [d.slug, d]));
    const expected = AREA_SEEDS.map((s) => s.slug);
    check(
      "seed order follows AREA_SEEDS",
      domains.map((d) => d.slug).join(",") === expected.join(","),
      domains.map((d) => d.slug),
    );
    check(
      "the base area is named Life",
      bySlug.get(BASE_AREA_SLUG)?.meta.name === "Life",
      bySlug.get(BASE_AREA_SLUG)?.meta.name,
    );
    check(
      "the base area is unlocked at creation",
      typeof bySlug.get(BASE_AREA_SLUG)?.meta.unlockedAt === "string",
      bySlug.get(BASE_AREA_SLUG)?.meta.unlockedAt,
    );

    for (const slug of AREA_SEEDS.filter((seed) => seed.locked).map((seed) => seed.slug)) {
      const domain = bySlug.get(slug);
      check(
        `${slug} is seeded locked`,
        domain !== undefined && domain.meta.unlockedAt === null,
        domain?.meta.unlockedAt,
      );
      const live = await isDomainLive(vaultRoot, slug);
      check(`${slug} is not live`, live === false, live);
    }
    check(
      "only the base area is live",
      liveDomainSlugs(domains).join(",") === BASE_AREA_SLUG,
      liveDomainSlugs(domains),
    );

    // ── 2. locked areas refuse writes ────────────────────────────────────
    const lockedDb = await createDatabase(vaultRoot, "health", { name: "Sleep" });
    check("a database cannot be created in a locked area", lockedDb.ok === false, lockedDb);
    const lockedPage = await createPage(vaultRoot, "health", { title: "Training" });
    check("a page cannot be created in a locked area", lockedPage.ok === false, lockedPage);

    const lifeDb = await createDatabase(vaultRoot, BASE_AREA_SLUG, { name: "Inbox" });
    check("a database can be created in Life", lifeDb.ok === true, lifeDb.ok ? "" : lifeDb.error);

    const listedDbs = await listDatabases(vaultRoot, null);
    check(
      "the union lists Life's database only",
      listedDbs.ok && listedDbs.value.length === 1 && listedDbs.value[0]?.domainSlug === BASE_AREA_SLUG,
      listedDbs.ok ? listedDbs.value.map((e) => e.domainSlug) : listedDbs.error,
    );
    const listedPages = await listPages(vaultRoot, null);
    check("the union lists no locked page", listedPages.ok && listedPages.value.length === 0, listedPages.ok ? listedPages.value.length : listedPages.error);

    // The companion reads doctrine through the document tools, so a locked
    // area must be invisible there too — not just in the renderer.
    const docs = await executeDocumentTool(vaultRoot, USER_ACTOR, "list_documents", {});
    const doctrineSlugs = "records" in docs
      ? docs.records
          .map((record) => record.domainSlug)
          .filter((slug): slug is string => typeof slug === "string")
      : [];
    check(
      "list_documents carries no locked area's doctrine",
      "records" in docs && doctrineSlugs.every((slug) => slug === BASE_AREA_SLUG),
      doctrineSlugs,
    );
    const lockedDoc = await executeDocumentTool(vaultRoot, USER_ACTOR, "get_document", {
      domainSlug: "health",
      kind: "why",
    });
    check("get_document refuses a locked area", "error" in lockedDoc, lockedDoc);

    // A Decision that names a locked area must be refused at filing time, or
    // approving it would write doctrine into an invisible area.
    const lockedDecision = await createDecision(vaultRoot, {
      target: { type: "doctrine", domainSlug: "health", kind: "why" },
      proposedBodyMarkdown: "should never land",
      actor: USER_ACTOR,
    });
    check("a doctrine Decision cannot be filed for a locked area", lockedDecision.ok === false, lockedDecision);

    // ── 3. unlocking is a flag flip ──────────────────────────────────────
    const unlocked = await unlockDomain(vaultRoot, "health");
    check("Health unlocks", unlocked.ok === true, unlocked.ok ? "" : unlocked.error);
    const unlockedAgain = await unlockDomain(vaultRoot, "health");
    check("unlocking twice is idempotent", unlockedAgain.ok === true, unlockedAgain.ok ? "" : unlockedAgain.error);
    check(
      "unlocking writes an ISO unlockedAt",
      typeof readMeta(vaultRoot, "health").unlockedAt === "string",
      readMeta(vaultRoot, "health").unlockedAt,
    );
    check("Health is live after unlocking", await isDomainLive(vaultRoot, "health"), null);

    const healthDb = await createDatabase(vaultRoot, "health", { name: "Sleep" });
    check("Health accepts a database after unlocking", healthDb.ok === true, healthDb.ok ? "" : healthDb.error);
    const healthPage = await createPage(vaultRoot, "health", { title: "Training" });
    check("Health accepts a page after unlocking", healthPage.ok === true, healthPage.ok ? "" : healthPage.error);

    const unionAfter = await listDatabases(vaultRoot, null);
    check(
      "the union now carries both areas' databases",
      unionAfter.ok && unionAfter.value.length === 2,
      unionAfter.ok ? unionAfter.value.map((e) => e.domainSlug) : unionAfter.error,
    );

    const log = await readLog(vaultRoot);
    check(
      "unlocking is a log event",
      log.ok && log.value.some((e) => e.type === "domain.unlocked" && e.domainSlug === "health"),
      log.ok ? log.value.filter((e) => e.type === "domain.unlocked").map((e) => e.domainSlug) : log.error,
    );

    // ── 4. archive still works on an unlocked area ───────────────────────
    const archived = await archiveDomain(vaultRoot, "health");
    check("an unlocked area can be archived", archived.ok === true, archived.ok ? "" : archived.error);
    check("archiving takes Health off the lens", (await isDomainLive(vaultRoot, "health")) === false, null);
    const unarchived = await unarchiveDomain(vaultRoot, "health");
    check("unarchive brings it back", unarchived.ok === true && (await isDomainLive(vaultRoot, "health")), unarchived.ok ? "" : unarchived.error);

    // ── 5. Life is the vault's own container ─────────────────────────────
    const archivedLife = await archiveDomain(vaultRoot, BASE_AREA_SLUG);
    check("Life cannot be archived", archivedLife.ok === false, archivedLife.ok ? "" : archivedLife.error);
    const deletedLife = await deleteDomain(vaultRoot, BASE_AREA_SLUG);
    check("Life cannot be deleted", deletedLife.ok === false, deletedLife.ok ? "" : deletedLife.error);

    // ── 6. a user-created area arrives unlocked ──────────────────────────
    const woodworking = await createDomain(vaultRoot, { name: "Woodworking" });
    check(
      "a custom area is unlocked at creation",
      woodworking.ok && typeof woodworking.value.meta.unlockedAt === "string",
      woodworking.ok ? woodworking.value.meta.unlockedAt : woodworking.error,
    );

    // ── 7. the artifact ──────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: checks.every((c) => c.pass),
      vault: vaultRoot,
      seed: AREA_SEEDS,
      checks,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    const written = JSON.parse(fs.readFileSync(ARTIFACT, "utf8")) as { pass: boolean; checks: Check[] };
    assert.equal(written.pass, true, `one or more checks failed: ${JSON.stringify(written.checks.filter((c) => !c.pass))}`);
    assert.deepEqual(checks.filter((c) => !c.pass), [], "all checks must hold");
  });

  it("adds Spiritual and Career to an older vault and does not restore a deleted area", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-areas-stamp-"));
    const vaultRoot = path.join(workDir, "vault");
    const created = await createVault(vaultRoot, "Stamp rig");
    assert.equal(created.ok, true, created.ok ? "" : created.error);

    fs.rmSync(path.join(vaultRoot, "domains", "spiritual"), { recursive: true, force: true });
    fs.rmSync(path.join(vaultRoot, "domains", "career"), { recursive: true, force: true });
    fs.rmSync(path.join(vaultRoot, "domains", "health"), { recursive: true, force: true });
    fs.rmSync(path.join(vaultRoot, ".lifequest", "area-seeds.json"), { force: true });

    const opened = await openVault(vaultRoot);
    assert.equal(opened.ok, true, opened.ok ? "" : opened.error);
    const listed = await listDomains(vaultRoot);
    assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
    if (!listed.ok) return;
    const slugs = listed.value.map((domain) => domain.slug);
    assert.ok(slugs.includes("spiritual"), "Spiritual was not added");
    assert.ok(slugs.includes("career"), "Career was not added");
    assert.equal(slugs.includes("health"), false, "a deleted legacy area came back");
    const spiritual = listed.value.find((domain) => domain.slug === "spiritual");
    const career = listed.value.find((domain) => domain.slug === "career");
    assert.equal(spiritual?.meta.unlockedAt, null, "Spiritual was not seeded locked");
    assert.equal(career?.meta.unlockedAt, null, "Career was not seeded locked");
    assert.equal(
      fs.existsSync(path.join(vaultRoot, "domains", "spiritual", "premise.md")),
      true,
      "Spiritual has no doctrine file",
    );

    const log = await readLog(vaultRoot);
    assert.equal(log.ok, true, log.ok ? "" : log.error);
    if (!log.ok) return;
    assert.deepEqual(
      log.value.filter((event) => event.type === "domain.created").map((event) => event.domainSlug),
      ["life"],
      "adding a locked seed wrote a log line",
    );

    fs.rmSync(path.join(vaultRoot, "domains", "career"), { recursive: true, force: true });
    const reopened = await openVault(vaultRoot);
    assert.equal(reopened.ok, true, reopened.ok ? "" : reopened.error);
    const afterDelete = await listDomains(vaultRoot);
    assert.equal(afterDelete.ok, true, afterDelete.ok ? "" : afterDelete.error);
    if (!afterDelete.ok) return;
    assert.equal(
      afterDelete.value.some((domain) => domain.slug === "career"),
      false,
      "Career came back after it was deleted",
    );
  });

  it("reads a vault written before areas had a lock state as fully unlocked", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-areas-legacy-"));
    const vaultRoot = path.join(workDir, "vault");
    const created = await createVault(vaultRoot, "Legacy areas rig");
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    const listed = await listDomains(vaultRoot);
    assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
    if (!listed.ok) return;

    // The shape every vault had before `unlockedAt` existed: the key is absent.
    for (const domain of listed.value) {
      const meta = readMeta(vaultRoot, domain.slug);
      delete meta.unlockedAt;
      writeMeta(vaultRoot, domain.slug, meta);
    }

    const reread = await listDomains(vaultRoot);
    assert.equal(reread.ok, true, reread.ok ? "" : reread.error);
    if (!reread.ok) return;
    check(
      "an absent unlockedAt means unlocked",
      liveDomainSlugs(reread.value).length === AREA_SEEDS.length,
      liveDomainSlugs(reread.value),
    );
    check(
      "every legacy area is live",
      await isDomainLive(vaultRoot, "health"),
      null,
    );
  });

  it("resolves a persisted lens on a locked or archived area to Life", () => {
    const snapshot = (unlockedAt: string | null, archivedAt: string | null) => ({
      lifequest: { id: "vault-1" },
      domains: [
        { slug: BASE_AREA_SLUG, meta: { archivedAt: null, unlockedAt: "2026-01-01T00:00:00.000Z" } },
        { slug: "health", meta: { archivedAt, unlockedAt } },
      ],
    });

    const locked = resolveRestoredLens("health", snapshot(null, null));
    check("a saved lens on a locked area resolves to Life", locked.lens.kind === "overview", locked.lens);
    check("and the saved lens is cleared", locked.clearSaved === true, locked.clearSaved);

    const archived = resolveRestoredLens("health", snapshot("2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z"));
    check("a saved lens on an archived area resolves to Life", archived.lens.kind === "overview", archived.lens);
    check("and that saved lens is cleared too", archived.clearSaved === true, archived.clearSaved);

    const live = resolveRestoredLens("health", snapshot("2026-01-02T00:00:00.000Z", null));
    check("a saved lens on an unlocked area is restored", live.lens.kind === "domain", live.lens);
    check("and kept", live.clearSaved === false, live.clearSaved);

    assert.deepEqual(checks.filter((c) => !c.pass), [], "all lens checks must hold");
  });
});
