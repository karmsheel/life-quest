import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { openVault } from "../src/open-vault.ts";
import { applyMapCommand } from "../src/map/persist.ts";
import { vaultPaths } from "../src/paths.ts";

describe("map persist", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-map-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("createVault writes map.json without aboutMe and empty about.md", async () => {
    const root = path.join(dir, "seeded");
    const res = await createVault(root, "Personal");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.ok(res.value.map);
    assert.equal(res.value.mapError, null);
    assert.equal("locked" in (res.value.map ?? {}), false);
    assert.ok(res.value.map?.years.some((y) => y.status === "live"));
    const raw = JSON.parse(await fs.readFile(vaultPaths(root).mapJson, "utf8")) as {
      aboutMe?: unknown;
      locked?: unknown;
    };
    assert.equal("aboutMe" in raw, false);
    assert.equal("locked" in raw, false);
    const about = await fs.readFile(vaultPaths(root).aboutMd, "utf8");
    assert.equal(about, "");
  });

  it("openVault seeds missing map files on an existing vault", async () => {
    const root = path.join(dir, "late-seed");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    await fs.unlink(vaultPaths(root).mapJson);
    await fs.unlink(vaultPaths(root).aboutMd);
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.ok(opened.value.map);
    await fs.access(vaultPaths(root).mapJson);
    await fs.access(vaultPaths(root).aboutMd);
  });

  it("malformed map.json does not get overwritten", async () => {
    const root = path.join(dir, "bad-map");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).mapJson;
    await fs.writeFile(p, "{not-json", "utf8");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.value.map, null);
    assert.ok(opened.value.mapError);
    const still = await fs.readFile(p, "utf8");
    assert.equal(still, "{not-json");
  });

  it("applyMapCommand setAboutMe writes about.md not map.json aboutMe", async () => {
    const root = path.join(dir, "about");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const applied = await applyMapCommand(
      root,
      { type: "setAboutMe", text: "early nights" },
      "user",
      "2026-08-27",
    );
    assert.equal(applied.ok, true);
    const about = await fs.readFile(vaultPaths(root).aboutMd, "utf8");
    assert.equal(about, "early nights");
    const raw = JSON.parse(await fs.readFile(vaultPaths(root).mapJson, "utf8")) as {
      aboutMe?: unknown;
    };
    assert.equal("aboutMe" in raw, false);
  });

  it("loads map.json that omits locked", async () => {
    const root = path.join(dir, "no-lock-field");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).mapJson;
    const raw = JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    delete raw.locked;
    await fs.writeFile(p, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.ok(opened.value.map);
    assert.equal(opened.value.mapError, null);
    assert.equal("locked" in (opened.value.map ?? {}), false);
  });

  it("ignores leftover locked in map.json and drops it on write", async () => {
    const root = path.join(dir, "legacy-lock");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).mapJson;
    const raw = JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    raw.locked = true;
    await fs.writeFile(p, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const agent = await applyMapCommand(
      root,
      { type: "setAboutMe", text: "early nights" },
      "agent",
      "2026-08-27",
    );
    assert.equal(agent.ok, true);
    if (!agent.ok) return;
    assert.equal("locked" in agent.value, false);
    const after = JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    assert.equal("locked" in after, false);
  });
});
