import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { openVault } from "../src/open-vault.ts";

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
    assert.match(why, /status: draft/);
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
  });
});
