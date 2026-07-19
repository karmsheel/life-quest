import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import {
  dismissAgent,
  hireAgent,
  listAgents,
  updateSettings,
} from "../src/agents.ts";

describe("agents + settings", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-agents-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "AgentsTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("listAgents starts empty", async () => {
    const listed = await listAgents(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.value, []);
  });

  it("hireAgent pushes active hire into agents.json hires[]", async () => {
    const hired = await hireAgent(root, {
      hermesAgentId: "agent-42",
      name: "Scout",
      roleLabel: "Researcher",
      domainSlug: "health",
    });
    assert.equal(hired.ok, true);
    if (!hired.ok) return;
    assert.equal(hired.value.hermesAgentId, "agent-42");
    assert.equal(hired.value.name, "Scout");
    assert.equal(hired.value.roleLabel, "Researcher");
    assert.equal(hired.value.domainSlug, "health");
    assert.equal(hired.value.status, "active");
    assert.equal(hired.value.dismissedAt, null);
    assert.ok(hired.value.id);
    assert.ok(hired.value.createdAt);

    const raw = await fs.readFile(path.join(root, ".lifequest", "agents.json"), "utf8");
    const parsed = JSON.parse(raw) as { hires: unknown[] };
    assert.ok(Array.isArray(parsed.hires));
    assert.equal(parsed.hires.length, 1);
    assert.equal((parsed.hires[0] as { name: string }).name, "Scout");

    const listed = await listAgents(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.value.length, 1);
    assert.equal(listed.value[0]!.status, "active");
  });

  it("dismissAgent sets status dismissed + dismissedAt", async () => {
    const hired = await hireAgent(root, {
      hermesAgentId: "agent-99",
      name: "Temp",
      roleLabel: null,
      domainSlug: null,
    });
    assert.equal(hired.ok, true);
    if (!hired.ok) return;

    const dismissed = await dismissAgent(root, hired.value.id);
    assert.equal(dismissed.ok, true);
    if (!dismissed.ok) return;
    assert.equal(dismissed.value.status, "dismissed");
    assert.ok(dismissed.value.dismissedAt);

    const listed = await listAgents(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const found = listed.value.find((a) => a.id === hired.value.id);
    assert.ok(found);
    assert.equal(found!.status, "dismissed");
    assert.ok(found!.dismissedAt);
  });

  it("updateSettings patches hermesBaseUrl and theme", async () => {
    const updated = await updateSettings(root, {
      hermesBaseUrl: "http://127.0.0.1:9000",
      theme: "dark",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.hermesBaseUrl, "http://127.0.0.1:9000");
    assert.equal(updated.value.theme, "dark");

    const raw = await fs.readFile(path.join(root, ".lifequest", "settings.json"), "utf8");
    const settings = JSON.parse(raw) as { hermesBaseUrl: string; theme: string };
    assert.equal(settings.hermesBaseUrl, "http://127.0.0.1:9000");
    assert.equal(settings.theme, "dark");

    const partial = await updateSettings(root, { theme: "light" });
    assert.equal(partial.ok, true);
    if (!partial.ok) return;
    assert.equal(partial.value.theme, "light");
    assert.equal(partial.value.hermesBaseUrl, "http://127.0.0.1:9000");
  });

  it("dismissAgent fails for unknown id", async () => {
    const res = await dismissAgent(root, "does-not-exist");
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /not found/i);
  });
});
