import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createVault,
  openVault,
  createDatabase,
  listDatabases,
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  listPins,
  setPins,
  defaultPins,
  addDatabaseColumn,
  USER_ACTOR,
  type PageBlock,
} from "../src/index.ts";

const agent = { type: "agent" as const, id: "a1", name: "Hermes" };

describe("pages", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-pages-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "PagesTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("create/open without pages: listPages is []", async () => {
    const c = await createVault(path.join(dir, "no-pages"), "NoPages");
    assert.equal(c.ok, true);
    const o = await openVault(path.join(dir, "no-pages"));
    assert.equal(o.ok, true);
    const pages = await listPages(root);
    assert.equal(pages.ok, true);
    if (pages.ok) assert.deepEqual(pages.value, []);
  });

  it("generic page in Health: writes domains/health/pages/{id}.json", async () => {
    const res = await createPage(root, "health", { title: "Notes" });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const page = res.value;
    assert.equal(page.title, "Notes");
    assert.deepEqual(page.blocks, []);
    assert.equal(page.domainSlug, "health");
    // File exists
    const filePath = path.join(root, "domains/health/pages", `${page.id}.json`);
    await fs.access(filePath);
    // No sqlite created for pages
    const sqlitePath = path.join(root, "domains/health/data/domain.sqlite");
    await assert.rejects(() => fs.access(sqlitePath));
  });

  it("blocks + roundtrip: all seven kinds persist", async () => {
    // Create a database first
    const dbRes = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(dbRes.ok);
    if (!dbRes.ok) return;
    const dbId = dbRes.value.id;

    // Add columns
    const col1 = await addDatabaseColumn(root, "health", dbId, { name: "Note", type: "text" });
    assert.ok(col1.ok);
    if (!col1.ok) return;
    const textColId = col1.value.columns[0].id;

    const col2 = await addDatabaseColumn(root, "health", dbId, { name: "Score", type: "number" });
    assert.ok(col2.ok);
    if (!col2.ok) return;
    const numColId = col2.value.columns[1].id;

    const col3 = await addDatabaseColumn(root, "health", dbId, { name: "When", type: "date" });
    assert.ok(col3.ok);
    if (!col3.ok) return;
    const dateColId = col3.value.columns[2].id;

    const blocks: PageBlock[] = [
      { id: "b1", kind: "markdown", markdown: "# Hello" },
      { id: "b2", kind: "bound-table", databaseId: dbId },
      { id: "b3", kind: "metric", databaseId: dbId, columnId: numColId, agg: "sum" },
      { id: "b4", kind: "date-range", start: "2026-01-01", end: "2026-12-31" },
      { id: "b5", kind: "chart", chartType: "bar", databaseId: dbId, xColumnId: dateColId, yColumnId: numColId },
      { id: "b6", kind: "goal-progress" },
      { id: "b7", kind: "deadline" },
    ];

    const res = await createPage(root, "health", { title: "Full Page" });
    assert.ok(res.ok);
    if (!res.ok) return;
    const pageId = res.value.id;

    const updateRes = await updatePage(root, "health", pageId, { blocks }, USER_ACTOR);
    assert.ok(updateRes.ok);
    if (!updateRes.ok) return;
    assert.equal(updateRes.value.applied, true);

    const getRes = await getPage(root, "health", pageId);
    assert.ok(getRes.ok);
    if (!getRes.ok) return;
    assert.equal(getRes.value.blocks.length, 7);

    const listRes = await listPages(root, "health");
    assert.ok(listRes.ok);
    if (!listRes.ok) return;
    assert.equal(listRes.value.length, 2); // "Notes" + "Full Page"
  });

  it("second date-range rejected", async () => {
    const res = await createPage(root, "health", { title: "Date Test" });
    assert.ok(res.ok);
    if (!res.ok) return;
    const pageId = res.value.id;

    const blocks: PageBlock[] = [
      { id: "b1", kind: "date-range", start: "2026-01-01", end: "2026-06-30" },
      { id: "b2", kind: "date-range", start: "2026-07-01", end: "2026-12-31" },
    ];

    const updateRes = await updatePage(root, "health", pageId, { blocks }, USER_ACTOR);
    assert.equal(updateRes.ok, false);
  });

  it("bound-table unknown db rejected", async () => {
    const res = await createPage(root, "health", { title: "Bad DB" });
    assert.ok(res.ok);
    if (!res.ok) return;
    const pageId = res.value.id;

    const blocks: PageBlock[] = [
      { id: "b1", kind: "bound-table", databaseId: "nonexistent-db-id" },
    ];

    const updateRes = await updatePage(root, "health", pageId, { blocks }, USER_ACTOR);
    assert.equal(updateRes.ok, false);
  });

  it("path escape createPage fails", async () => {
    const res = await createPage(root, "../evil", { title: "Bad" });
    assert.equal(res.ok, false);
  });

  it("path escape getPage with ../ pageId fails", async () => {
    const res = await getPage(root, "health", "../evil");
    assert.equal(res.ok, false);
  });

  it("archived / missing domain: createPage fails", async () => {
    const missing = await createPage(root, "ghost", { title: "X" });
    assert.equal(missing.ok, false);
    const o = await openVault(root);
    assert.ok(o.ok);
  });

  it("agent updatePage files a Decision, page unchanged; user updatePage writes", async () => {
    const res = await createPage(root, "health", { title: "Agent Test" });
    assert.ok(res.ok);
    if (!res.ok) return;
    const pageId = res.value.id;

    const blocks: PageBlock[] = [
      { id: "b1", kind: "markdown", markdown: "agent proposed" },
    ];

    // Agent update → Decision
    const agentRes = await updatePage(root, "health", pageId, { blocks }, agent);
    assert.equal(agentRes.ok, true);
    if (!agentRes.ok) return;
    assert.equal(agentRes.value.applied, false);
    assert.equal(agentRes.value.decision.target.type, "page");

    // Page file unchanged
    const getRes = await getPage(root, "health", pageId);
    assert.ok(getRes.ok);
    if (!getRes.ok) return;
    assert.equal(getRes.value.blocks.length, 0);

    // User update → writes
    const userRes = await updatePage(root, "health", pageId, { blocks }, USER_ACTOR);
    assert.ok(userRes.ok);
    if (!userRes.ok) return;
    assert.equal(userRes.value.applied, true);

    const getRes2 = await getPage(root, "health", pageId);
    assert.ok(getRes2.ok);
    if (!getRes2.ok) return;
    assert.equal(getRes2.value.blocks.length, 1);
  });

  it("deletePage removes json and strips page pins", async () => {
    const res = await createPage(root, "health", { title: "Delete Me" });
    assert.ok(res.ok);
    if (!res.ok) return;
    const pageId = res.value.id;

    // Add a page pin to domain board
    const pins = defaultPins();
    pins.push({ id: "pin:page1", kind: "page", domainSlug: "health", pageId });
    const setRes = await setPins(root, "health", pins, USER_ACTOR);
    assert.ok(setRes.ok);

    // Delete page
    const delRes = await deletePage(root, "health", pageId);
    assert.ok(delRes.ok);

    // Page file gone
    const getRes = await getPage(root, "health", pageId);
    assert.equal(getRes.ok, false);

    // Pin stripped
    const listRes = await listPins(root, "health");
    assert.ok(listRes.ok);
    if (!listRes.ok) return;
    assert.equal(listRes.value.find((p) => p.kind === "page" && p.pageId === pageId), undefined);
  });
});

describe("pins", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-pins-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "PinsTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("listPins missing file returns six defaults including goal-progress and deadline", async () => {
    const res = await listPins(root, null);
    assert.ok(res.ok);
    if (!res.ok) return;
    assert.equal(res.value.length, 6);
    const kinds = res.value.map((p) => p.kind === "system" ? p.system : null);
    assert.ok(kinds.includes("goal-progress"));
    assert.ok(kinds.includes("deadline"));

    // File is still absent
    const pinsPath = path.join(root, ".lifequest/overview-pins.json");
    await assert.rejects(() => fs.access(pinsPath));
  });

  it("setPins user writes domain pins file; unpinning goal-progress allowed", async () => {
    const pins = defaultPins().filter((p) => p.system !== "goal-progress");
    const res = await setPins(root, "health", pins, USER_ACTOR);
    assert.ok(res.ok);

    const pinsPath = path.join(root, "domains/health/pins.json");
    await fs.access(pinsPath);

    // SYSTEM_PIN_KINDS still contains goal-progress and deadline
    const listRes = await listPins(root, "health");
    assert.ok(listRes.ok);
    if (!listRes.ok) return;
    assert.equal(listRes.value.find((p) => p.kind === "system" && p.system === "goal-progress"), undefined);

    // Add goal-progress back
    const allPins = defaultPins();
    const addRes = await setPins(root, "health", allPins, USER_ACTOR);
    assert.ok(addRes.ok);
    const listRes2 = await listPins(root, "health");
    assert.ok(listRes2.ok);
    if (!listRes2.ok) return;
    assert.ok(listRes2.value.find((p) => p.kind === "system" && p.system === "goal-progress"));
  });

  it("agent setPins files a Decision; board unchanged until approve", async () => {
    // Get current pins
    const current = await listPins(root, "health");
    assert.ok(current.ok);
    if (!current.ok) return;

    // Agent tries to set pins
    const agentRes = await setPins(root, "health", defaultPins(), agent);
    assert.equal(agentRes.ok, true);
    if (!agentRes.ok) return;
    assert.equal(agentRes.value.applied, false);
    assert.equal(agentRes.value.decision.target.type, "pins");

    // Board unchanged (still has the filtered pins from earlier)
    const after = await listPins(root, "health");
    assert.ok(after.ok);
    if (!after.ok) return;
    assert.equal(after.value.length, current.value.length);
  });

  it("page pin must exist in domain", async () => {
    const pins = defaultPins();
    pins.push({ id: "pin:ghost", kind: "page", domainSlug: "health", pageId: "nonexistent" });
    const res = await setPins(root, "health", pins, USER_ACTOR);
    assert.equal(res.ok, false);
  });
});
