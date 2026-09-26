import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyScriptBlock,
  createDatabase,
  createPage,
  createVault,
  getPage,
  listDecisions,
  runScriptBlock,
  updatePage,
  upsertRow,
  type PageBlock,
} from "../src/index.ts";

const agent = { type: "agent" as const, id: "companion", name: "Hermes" };

describe("script-block (KAR-56)", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-script-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "ScriptTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("query is domain-scoped: health sees its row, financial does not, ../ fails closed", async () => {
    const res = await createDatabase(root, "health", { name: "Habits" });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const row = await upsertRow(root, "health", res.value.id, {
      id: "row-health-1",
      cells: {},
    });
    assert.equal(row.ok, true);
    if (!row.ok) return;

    const healthRun = await runScriptBlock(root, {
      domainSlug: "health",
      source: "SELECT id, cells FROM rows",
    });
    assert.equal(healthRun.ok, true);
    if (!healthRun.ok) return;
    const ids = healthRun.value.queries[0].rows.map((r) => String(r[0]));
    assert.equal(ids.includes("row-health-1"), true);
    assert.deepEqual(healthRun.value.queries[0].columns, ["id", "cells"]);

    // financial has no domain.sqlite at all -> warning, no rows
    const finRun = await runScriptBlock(root, {
      domainSlug: "financial",
      source: "SELECT id, cells FROM rows",
    });
    assert.equal(finRun.ok, true);
    if (!finRun.ok) return;
    const finIds = finRun.value.queries.flatMap((q) => q.rows.map((r) => String(r[0])));
    assert.equal(finIds.includes("row-health-1"), false);
    assert.equal(finRun.value.warnings.includes("No database for this domain yet."), true);

    // path traversal fails closed
    const escape = await runScriptBlock(root, {
      domainSlug: "../health",
      source: "SELECT id FROM rows",
    });
    assert.equal(escape.ok, false);
    if (!escape.ok) {
      assert.match(escape.error, /invalid domain slug|escapes vault root/i);
    }
  });

  it("read-only: INSERT and ATTACH are rejected and change nothing", async () => {
    const insert = await runScriptBlock(root, {
      domainSlug: "health",
      source: "INSERT INTO rows VALUES ('db','x','now','now','{}')",
    });
    assert.equal(insert.ok, false);
    if (!insert.ok) assert.match(insert.error, /read-only SELECT/i);

    const attach = await runScriptBlock(root, {
      domainSlug: "health",
      source: "ATTACH DATABASE 'x' AS other",
    });
    assert.equal(attach.ok, false);
    if (!attach.ok) assert.match(attach.error, /read-only SELECT/i);

    // second statement is rejected
    const two = await runScriptBlock(root, {
      domainSlug: "health",
      source: "SELECT 1; SELECT 2",
    });
    assert.equal(two.ok, false);
    if (!two.ok) assert.match(two.error, /read-only SELECT/i);

    // the original row survives
    const after = await runScriptBlock(root, {
      domainSlug: "health",
      source: "SELECT id FROM rows",
    });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.queries[0].rows.length, 1);
    assert.equal(String(after.value.queries[0].rows[0][0]), "row-health-1");
  });

  it("missing sqlite is not created", async () => {
    const fresh = path.join(dir, "vault-empty-db");
    assert.equal((await createVault(fresh, "EmptyDb")).ok, true);
    const run = await runScriptBlock(fresh, { domainSlug: "health", source: "SELECT 1" });
    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.deepEqual(run.value.queries, []);
    assert.equal(run.value.warnings.includes("No database for this domain yet."), true);
    await assert.rejects(() => fs.access(path.join(fresh, "domains/health/data/domain.sqlite")));
  });

  it("fetches must be https", async () => {
    let called = 0;
    const fetchImpl = async () => {
      called += 1;
      return { status: 200, body: "ok" };
    };

    const bad = await runScriptBlock(root, {
      domainSlug: "health",
      source: JSON.stringify({ fetches: [{ url: "http://example.com" }] }),
      fetchImpl,
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error, "Script fetch requires https");
    assert.equal(called, 0);

    const good = await runScriptBlock(root, {
      domainSlug: "health",
      source: JSON.stringify({ fetches: [{ url: "https://example.com/rate" }] }),
      fetchImpl,
    });
    assert.equal(good.ok, true);
    if (!good.ok) return;
    assert.equal(called, 1);
    assert.equal(good.value.fetches.length, 1);
    assert.equal(good.value.fetches[0].url, "https://example.com/rate");
    assert.equal(good.value.fetches[0].status, 200);
    assert.equal(good.value.fetches[0].body, "ok");
  });

  it("empty source and non-JSON garbage", async () => {
    const empty = await runScriptBlock(root, { domainSlug: "health", source: "   " });
    assert.equal(empty.ok, true);
    if (!empty.ok) return;
    assert.deepEqual(empty.value, {
      queries: [],
      fetches: [],
      warnings: ["No script yet."],
    });

    const badJson = await runScriptBlock(root, { domainSlug: "health", source: "{ nope" });
    assert.equal(badJson.ok, false);
    if (!badJson.ok) assert.equal(badJson.error, "Script JSON is unreadable");

    const notSelect = await runScriptBlock(root, { domainSlug: "health", source: "hello world" });
    assert.equal(notSelect.ok, false);
    if (!notSelect.ok) assert.equal(notSelect.error, "Script must be a read-only SELECT or JSON");
  });

  it("agent apply writes no Decision and updates in place by blockId", async () => {
    const page = await createPage(root, "financial", { title: "Money" });
    assert.equal(page.ok, true);
    if (!page.ok) return;
    const pageId = page.value.id;

    const before = await listDecisions(root);
    assert.equal(before.ok, true);
    const beforeCount = before.ok ? before.value.length : -1;

    const applied = await applyScriptBlock(root, {
      domainSlug: "financial",
      pageId,
      name: "Spend count",
      source: "SELECT 1",
      actor: agent,
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.value.applied, true);
    assert.equal(applied.value.name, "Spend count");
    assert.equal(applied.value.decision, null);

    const after = await listDecisions(root);
    assert.equal(after.ok, true);
    if (after.ok) assert.equal(after.value.length, beforeCount);

    const read = await getPage(root, "financial", pageId);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const scripts = read.value.blocks.filter((b) => b.kind === "script");
    assert.equal(scripts.length, 1);
    const script = scripts[0] as Extract<PageBlock, { kind: "script" }>;
    assert.equal(script.name, "Spend count");
    assert.equal(script.source, "SELECT 1");

    const replaced = await applyScriptBlock(root, {
      domainSlug: "financial",
      pageId,
      blockId: script.id,
      name: "Spend count",
      source: "SELECT 2",
      actor: agent,
    });
    assert.equal(replaced.ok, true);
    const read2 = await getPage(root, "financial", pageId);
    assert.equal(read2.ok, true);
    if (!read2.ok) return;
    const scripts2 = read2.value.blocks.filter((b) => b.kind === "script");
    assert.equal(scripts2.length, 1);
    assert.equal((scripts2[0] as Extract<PageBlock, { kind: "script" }>).source, "SELECT 2");
  });

  it("agent updatePage still files a Decision and leaves the title unchanged", async () => {
    const page = await createPage(root, "health", { title: "Original" });
    assert.equal(page.ok, true);
    if (!page.ok) return;
    const before = await listDecisions(root);
    const beforeCount = before.ok ? before.value.length : -1;

    const res = await updatePage(root, "health", page.value.id, { title: "Renamed" }, agent);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.value.applied, false);

    const after = await listDecisions(root);
    assert.equal(after.ok, true);
    if (after.ok) {
      assert.equal(after.value.length, beforeCount + 1);
      assert.equal(after.value[after.value.length - 1].target.type, "page");
    }

    const read = await getPage(root, "health", page.value.id);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.value.title, "Original");
  });

  it("a non-script blockId is rejected without a write", async () => {
    const page = await createPage(root, "health", { title: "Blocks" });
    assert.equal(page.ok, true);
    if (!page.ok) return;
    const md: PageBlock = { id: "md-1", kind: "markdown", markdown: "Keep me" };
    const written = await updatePage(root, "health", page.value.id, { blocks: [md] }, { type: "user" });
    assert.equal(written.ok, true);

    const res = await applyScriptBlock(root, {
      domainSlug: "health",
      pageId: page.value.id,
      blockId: "md-1",
      name: "Nope",
      source: "SELECT 1",
      actor: agent,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error, "Block is not a script");

    const read = await getPage(root, "health", page.value.id);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.deepEqual(read.value.blocks, [md]);
  });

  it("name and source validation, and a missing page", async () => {
    const page = await createPage(root, "health", { title: "Validation" });
    assert.equal(page.ok, true);
    if (!page.ok) return;

    const noName = await applyScriptBlock(root, {
      domainSlug: "health",
      pageId: page.value.id,
      name: "   ",
      source: "SELECT 1",
      actor: agent,
    });
    assert.equal(noName.ok, false);
    if (!noName.ok) assert.equal(noName.error, "Script name is required");

    const noSource = await applyScriptBlock(root, {
      domainSlug: "health",
      pageId: page.value.id,
      name: "X",
      source: 42 as unknown as string,
      actor: agent,
    });
    assert.equal(noSource.ok, false);

    const noPage = await applyScriptBlock(root, {
      domainSlug: "health",
      pageId: "does-not-exist",
      name: "X",
      source: "SELECT 1",
      actor: agent,
    });
    assert.equal(noPage.ok, false);

    const read = await getPage(root, "health", page.value.id);
    assert.equal(read.ok, true);
    if (read.ok) assert.deepEqual(read.value.blocks, []);
  });
});
