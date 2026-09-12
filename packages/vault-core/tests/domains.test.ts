import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import {
  archiveDomain,
  createDomain,
  listDomains,
  slugifyDomainName,
  updateDomain,
} from "../src/domains.ts";
import { openVault } from "../src/open-vault.ts";

describe("slugifyDomainName", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugifyDomainName("Career Path"), "career-path");
    assert.equal(slugifyDomainName("  Health  "), "health");
  });

  it("falls back to domain for empty result", () => {
    assert.equal(slugifyDomainName("!!!"), "domain");
    assert.equal(slugifyDomainName("   "), "domain");
  });
});

describe("createDomain / archiveDomain / updateDomain", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-domains-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "DomainsTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("createDomain Career → slug career and four md files", async () => {
    const res = await createDomain(root, { name: "Career" });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.slug, "career");
    assert.equal(res.value.meta.name, "Career");
    assert.equal(res.value.meta.archivedAt, null);
    assert.ok(res.value.documents.premise);
    assert.ok(res.value.documents.why);
    assert.ok(res.value.documents.what);
    assert.ok(res.value.documents.how);
    assert.equal(res.value.documents.premise.title, "Beliefs & Premise");

    for (const kind of ["why", "what", "how", "premise"] as const) {
      const md = await fs.readFile(
        path.join(root, "domains", "career", `${kind}.md`),
        "utf8",
      );
      assert.match(md, /^---\n/);
      assert.match(md, /locked: false/);
    }
    const metaRaw = await fs.readFile(path.join(root, "domains", "career", "domain.json"), "utf8");
    const meta = JSON.parse(metaRaw) as { name: string };
    assert.equal(meta.name, "Career");
  });

  it("openVault creates missing premise.md as an empty draft", async () => {
    const created = await createDomain(root, { name: "Legacy Three" });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const premisePath = path.join(
      root,
      "domains",
      created.value.slug,
      "premise.md",
    );
    await fs.rm(premisePath, { force: true });
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const domain = opened.value.domains.find(
      (d) => d.slug === created.value.slug,
    );
    assert.ok(domain);
    assert.equal(domain.documents.premise.bodyMarkdown.trim(), "");
    assert.equal(domain.documents.premise.locked, false);
    assert.equal(domain.documents.premise.title, "Beliefs & Premise");
    const raw = await fs.readFile(premisePath, "utf8");
    assert.match(raw, /title: "Beliefs & Premise"/);
  });

  it("disambiguates colliding slugs with -2, -3", async () => {
    const first = await createDomain(root, { name: "Side Project" });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.slug, "side-project");

    const second = await createDomain(root, { name: "Side Project" });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.value.slug, "side-project-2");
  });

  it("archiveDomain sets meta.archivedAt non-null", async () => {
    const created = await createDomain(root, { name: "Archive Me" });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const archived = await archiveDomain(root, created.value.slug);
    assert.equal(archived.ok, true);
    if (!archived.ok) return;
    assert.notEqual(archived.value.meta.archivedAt, null);
    assert.ok(typeof archived.value.meta.archivedAt === "string");

    const metaRaw = await fs.readFile(
      path.join(root, "domains", created.value.slug, "domain.json"),
      "utf8",
    );
    const meta = JSON.parse(metaRaw) as { archivedAt: string | null };
    assert.notEqual(meta.archivedAt, null);
  });

  it("updateDomain patches name and description", async () => {
    const created = await createDomain(root, { name: "Update Me" });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const updated = await updateDomain(root, created.value.slug, {
      name: "Updated",
      description: "A note",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.meta.name, "Updated");
    assert.equal(updated.value.meta.description, "A note");
    // slug unchanged
    assert.equal(updated.value.slug, created.value.slug);
  });

  it("listDomains includes seed and created domains", async () => {
    const listed = await listDomains(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const slugs = listed.value.map((d) => d.slug);
    assert.ok(slugs.includes("health"));
    assert.ok(slugs.includes("career"));
  });
});
