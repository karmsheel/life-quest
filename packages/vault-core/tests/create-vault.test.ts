import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { openVault } from "../src/open-vault.ts";
import { assertUnderRoot, safeJoin, vaultPaths } from "../src/paths.ts";

describe("createVault", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-vault-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("seeds four domains and lifequest.json", async () => {
    const root = path.join(dir, "my-vault");
    const res = await createVault(root, "Personal");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.lifequest.schemaVersion, 1);
    assert.equal(res.value.domains.length, 4);
    const why = await fs.readFile(path.join(root, "domains/health/why.md"), "utf8");
    assert.match(why, /^---\n/);
    assert.match(why, /locked: false/);
    const premise = await fs.readFile(
      path.join(root, "domains/health/premise.md"),
      "utf8",
    );
    assert.match(premise, /^---\n/);
    assert.match(premise, /title: "Beliefs & Premise"/);
    assert.match(premise, /locked: false/);
    const health = res.value.domains.find((d) => d.slug === "health");
    assert.ok(health);
    assert.equal(health.documents.premise.title, "Beliefs & Premise");
    assert.equal(health.documents.why.title, "Purpose");
    assert.equal(health.documents.what.title, "Vision & Desire");
    assert.equal(health.documents.how.title, "Strategy (How)");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    assert.ok(res.value.map);
    assert.equal(res.value.mapError, null);
    assert.deepEqual(res.value.goals, []);
    assert.equal(res.value.goalsError, null);
    await fs.access(path.join(root, ".lifequest/map.json"));
    await fs.access(path.join(root, ".lifequest/about.md"));
  });

  it("refuses when lifequest.json already exists", async () => {
    const root = path.join(dir, "existing-vault");
    const first = await createVault(root, "First");
    assert.equal(first.ok, true);
    const second = await createVault(root, "Second");
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.error, /already exists/i);
  });
});

describe("openVault", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-vault-open-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses schemaVersion !== 1", async () => {
    const root = path.join(dir, "bad-schema");
    const created = await createVault(root, "BadSchema");
    assert.equal(created.ok, true);
    const metaPath = path.join(root, "lifequest.json");
    const raw = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
    raw.schemaVersion = 2;
    await fs.writeFile(metaPath, `${JSON.stringify(raw, null, 2)}\n`);
    const opened = await openVault(root);
    assert.equal(opened.ok, false);
    if (opened.ok) return;
    assert.match(opened.error, /schemaVersion/i);
    assert.match(opened.error, /2/);
  });
});

describe("safeJoin / assertUnderRoot", () => {
  const root = path.resolve("/tmp/lifequest-vault-root");

  it("rejects path escape via safeJoin segments", () => {
    assert.throws(
      () => safeJoin(root, "domains", "../../outside"),
      /escapes vault root/i,
    );
    assert.throws(
      () => safeJoin(root, "..", "outside"),
      /escapes vault root/i,
    );
  });

  it("rejects path escape via vaultPaths slug helpers", () => {
    const paths = vaultPaths(root);
    // slug/id/kind that resolve outside root (need enough .. to climb past domains/.lifequest)
    assert.throws(() => paths.domainDir("../../outside"), /escapes vault root/i);
    assert.throws(() => paths.domainJson("../../outside"), /escapes vault root/i);
    assert.throws(() => paths.documentMd("health", "../../../evil"), /escapes vault root/i);
    assert.throws(() => paths.decisionJson("../../../escape"), /escapes vault root/i);
  });

  it("does not false-positive on ..foo segment names", () => {
    const joined = safeJoin(root, "domains", "..foo");
    assert.equal(joined, path.resolve(root, "domains", "..foo"));
    assert.doesNotThrow(() => assertUnderRoot(root, path.join(root, "..foo")));
  });

  it("allows paths under root", () => {
    const joined = safeJoin(root, "domains", "health", "why.md");
    assert.equal(joined, path.resolve(root, "domains", "health", "why.md"));
    assert.doesNotThrow(() => assertUnderRoot(root, joined));
  });
});
