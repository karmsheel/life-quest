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
  readAutoApproveInserts,
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
    assert.equal(partial.value.weekStartDay, "monday");
  });

  it("updateSettings rejects non-http(s) hermesBaseUrl", async () => {
    const beforeRaw = await fs.readFile(
      path.join(root, ".lifequest", "settings.json"),
      "utf8",
    );
    const before = JSON.parse(beforeRaw) as { hermesBaseUrl: string };

    for (const bad of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ftp://example.com",
      "not-a-url",
      "",
    ]) {
      const res = await updateSettings(root, { hermesBaseUrl: bad });
      assert.equal(res.ok, false, `expected reject for ${JSON.stringify(bad)}`);
      if (res.ok) return;
      assert.match(res.error, /http|empty|URL/i);
    }

    const afterRaw = await fs.readFile(
      path.join(root, ".lifequest", "settings.json"),
      "utf8",
    );
    const after = JSON.parse(afterRaw) as { hermesBaseUrl: string };
    assert.equal(after.hermesBaseUrl, before.hermesBaseUrl);

    const httpsOk = await updateSettings(root, {
      hermesBaseUrl: "https://gateway.example.com/v1",
    });
    assert.equal(httpsOk.ok, true);
    if (!httpsOk.ok) return;
    assert.equal(httpsOk.value.hermesBaseUrl, "https://gateway.example.com/v1");
  });

  it("updateSettings rejects weekStartDay change when weekly review files exist", async () => {
    const weeklyDir = path.join(root, "reviews", "weekly");
    await fs.mkdir(weeklyDir, { recursive: true });
    await fs.writeFile(path.join(weeklyDir, "2026-09-21.md"), "x\n", "utf8");
    const blocked = await updateSettings(root, { weekStartDay: "sunday" });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /week start/i);
    await fs.rm(path.join(root, "reviews"), { recursive: true, force: true });
    const ok = await updateSettings(root, { weekStartDay: "sunday" });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value.weekStartDay, "sunday");
  });

  it("updateSettings theme patch preserves weekStartDay", async () => {
    const next = await updateSettings(root, { theme: "dark" });
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.ok(next.value.weekStartDay === "monday" || next.value.weekStartDay === "sunday");
  });

  it("updateSettings stores autoApproveInserts and a theme patch keeps it", async () => {
    const missing = await readAutoApproveInserts(root);
    assert.deepEqual(missing, []);

    const saved = await updateSettings(root, {
      autoApproveInserts: [
        { domainSlug: "health", databaseId: "db-1" },
        { domainSlug: "health", databaseId: "db-1" },
        { domainSlug: "financial", databaseId: "finance:transactions" },
      ],
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.deepEqual(saved.value.autoApproveInserts, [
      { domainSlug: "health", databaseId: "db-1" },
      { domainSlug: "financial", databaseId: "finance:transactions" },
    ]);

    const themed = await updateSettings(root, { theme: "light" });
    assert.equal(themed.ok, true);
    if (!themed.ok) return;
    assert.deepEqual(themed.value.autoApproveInserts, saved.value.autoApproveInserts);
    assert.deepEqual(await readAutoApproveInserts(root), saved.value.autoApproveInserts);

    const before = await fs.readFile(path.join(root, ".lifequest", "settings.json"), "utf8");
    const rejected = await updateSettings(root, {
      autoApproveInserts: [{ domainSlug: "", databaseId: "db-1" }],
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.error, /autoApproveInserts/);
    const after = await fs.readFile(path.join(root, ".lifequest", "settings.json"), "utf8");
    assert.equal(after, before);
  });

  it("dismissAgent fails for unknown id", async () => {
    const res = await dismissAgent(root, "does-not-exist");
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /not found/i);
  });
});
