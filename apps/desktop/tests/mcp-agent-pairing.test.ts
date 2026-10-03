// KAR-70 Task 1 — the two loopback pairing doors.
//
// Drives 8643 (local) and 8646 (invite) over real HTTP against a temporary
// vault, then reads the vault as text. The proof artifact is pairing-e2e.json
// written inside that vault. Later tasks append scenarios to `scenarios`.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import {
  createVault,
  fingerprintOf,
  listConnectedAgents,
  markConnectedAgent,
  PENDING_PAIRING_CAP,
} from "@lifequest/vault-core";
import {
  startPairingDoors,
  LOCAL_MCP_PORT,
  INVITE_MCP_PORT,
} from "../electron/pairing-door.ts";
import { mintInvite } from "../electron/pairing-secrets.ts";

const scenarios: { name: string; code: string }[] = [];

function record(name: string, code: string): void {
  scenarios.push({ name, code });
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from({ length: count }, () =>
      new Promise<net.Server>((resolve, reject) => {
        const s = net.createServer();
        s.once("error", reject);
        s.listen(0, "127.0.0.1", () => resolve(s));
      }),
    ),
  );
  const ports = servers.map((s) => (s.address() as net.AddressInfo).port);
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  return ports;
}

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function decisionFiles(root: string): Promise<string[]> {
  const dir = path.join(root, ".lifequest", "decisions");
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
}

/** Walk a directory tree and hand back every file as one string. */
async function walkText(dir: string): Promise<string> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(await fs.readFile(full, "utf8"));
    }
  }
  await walk(dir);
  return out.join("\n");
}

async function rpc(
  port: number,
  headers: Record<string, string>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }),
  });
  const text = await res.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  const parsed = JSON.parse(dataLine ? dataLine.slice(6) : text) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}

const INIT_PARAMS = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "e2e", version: "0" },
};

function auth(bearer: string): Record<string, string> {
  return { authorization: `Bearer ${bearer}` };
}

function errorOf(body: Record<string, unknown>): { code: string; message: string } {
  const err = (body as { error?: { code?: string; message?: string } }).error;
  return { code: String(err?.code), message: String(err?.message) };
}

/** The JSON inside the first text content block of a tools/call result. */
function toolError(body: Record<string, unknown>): { code: string; message: string } {
  const result = (body as { result?: { content?: { text?: string }[] } }).result;
  const text = result?.content?.[0]?.text ?? "{}";
  return errorOf(JSON.parse(text) as Record<string, unknown>);
}

type Doors = Awaited<ReturnType<typeof startPairingDoors>>;

/** A fresh temp vault + temp secrets dir + both doors on free ports. */
async function openDoors(
  label: string,
  now?: () => Date,
): Promise<{
  root: string;
  secretsDir: string;
  vaultId: string;
  localPort: number;
  invitePort: number;
  doors: Doors;
}> {
  const root = await tempDir(`${label}-vault-`);
  const created = await createVault(root, "Pairing E2E");
  assert.equal(created.ok, true, `createVault failed: ${JSON.stringify(created)}`);
  const secretsDir = await tempDir(`${label}-secrets-`);
  const [localPort, invitePort] = await freePorts(2);
  const doors = await startPairingDoors({
    root,
    vaultId: "pairing-e2e",
    secretsDir,
    localPort,
    invitePort,
    ...(now ? { now } : {}),
  });
  assert.equal(doors.localError, null, `local door bind failed: ${doors.localError}`);
  assert.equal(doors.inviteError, null, `invite door bind failed: ${doors.inviteError}`);
  return { root, secretsDir, vaultId: "pairing-e2e", localPort, invitePort, doors };
}

// ── constants ────────────────────────────────────────────────────────────────

describe("KAR-70 pairing: production ports and the pending cap", () => {
  it("the production defaults are 8643 and 8646, and the cap is 20", () => {
    assert.equal(LOCAL_MCP_PORT, 8643);
    assert.equal(INVITE_MCP_PORT, 8646);
    assert.equal(PENDING_PAIRING_CAP, 20);
  });
});

// ── the local door ───────────────────────────────────────────────────────────

describe("KAR-70 pairing: the local door on 8643", () => {
  let ctx: Awaited<ReturnType<typeof openDoors>>;
  const rosterFile = () => path.join(ctx.root, ".lifequest", "connected-agents.json");

  before(async () => {
    ctx = await openDoors("kar70-local");
  });
  after(async () => {
    await ctx.doors.close();
  });

  it("no bearer is AUTH_REQUIRED and files nothing", async () => {
    const res = await rpc(ctx.localPort, {}, "initialize", INIT_PARAMS);
    record("no-bearer-local", errorOf(res.body).code);
    assert.equal(res.status, 401);
    assert.deepEqual(errorOf(res.body), {
      code: "AUTH_REQUIRED",
      message: "Authorization bearer is required",
    });
    assert.equal(await exists(rosterFile()), false);
    assert.deepEqual(await decisionFiles(ctx.root), []);
  });

  it("GET /mcp is 404 on the local door", async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.localPort}/mcp`, {
      method: "GET",
      headers: { accept: "application/json, text/event-stream" },
    });
    assert.equal(res.status, 404);
    record("get-mcp-local", "NOT_FOUND_HTTP");
  });

  it("a short bearer is AUTH_REQUIRED", async () => {
    const res = await rpc(ctx.localPort, auth("short"), "initialize", INIT_PARAMS);
    record("short-bearer", errorOf(res.body).code);
    assert.equal(res.status, 401);
    assert.equal(errorOf(res.body).code, "AUTH_REQUIRED");
    assert.equal(await exists(rosterFile()), false);
  });

  it("an 81-character name is NAME_REQUIRED and files nothing", async () => {
    const bearer = "bearer-81-char-name-abcdefghij";
    const res = await rpc(
      ctx.localPort,
      { ...auth(bearer), "x-lifequest-name": "N".repeat(81) },
      "initialize",
      INIT_PARAMS,
    );
    record("name-too-long", errorOf(res.body).code);
    assert.equal(res.status, 401);
    assert.deepEqual(errorOf(res.body), {
      code: "NAME_REQUIRED",
      message: "X-LifeQuest-Name is required",
    });
    assert.equal(await exists(rosterFile()), false);
    assert.deepEqual(await decisionFiles(ctx.root), []);
  });

  it("a 22-character bearer with no name is NAME_REQUIRED and files nothing", async () => {
    const bearer = "exactly-22-char-abcd!!";
    assert.equal(bearer.length, 22);
    const res = await rpc(ctx.localPort, auth(bearer), "initialize", INIT_PARAMS);
    record("name-missing", errorOf(res.body).code);
    assert.equal(res.status, 401);
    assert.equal(errorOf(res.body).code, "NAME_REQUIRED");
    assert.equal(await exists(rosterFile()), false);
    assert.deepEqual(await decisionFiles(ctx.root), []);
  });

  it("a named 22-character bearer is pending: one row, one Decision, no tools", async () => {
    const bearer = "exactly-22-char-abcd!!";
    const headers = { ...auth(bearer), "x-lifequest-name": "  Finance bot  " };
    const init = await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS);
    record("local-introduction", init.status === 200 ? "ACCEPTED" : "REJECTED");
    assert.equal(init.status, 200);
    assert.ok((init.body as { result?: unknown }).result, "initialize must return a result");

    const list = await rpc(ctx.localPort, headers, "tools/list");
    assert.deepEqual((list.body as { result?: { tools?: unknown[] } }).result?.tools, []);

    const call = await rpc(ctx.localPort, headers, "tools/call", { name: "get_state" });
    record("local-pending-tool", toolError(call.body).code);
    assert.equal(call.status, 200);
    assert.deepEqual(toolError(call.body), {
      code: "PAIRING_PENDING",
      message: "Waiting for approval",
    });

    const agents = await listConnectedAgents(ctx.root);
    assert.equal(agents.ok, true);
    const rows = (agents as { value: Record<string, unknown>[] }).value;
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.name, "Finance bot");
    assert.equal(row.fingerprint, fingerprintOf(bearer).slice(0, 12));
    assert.equal(row.status, "pending");
    assert.equal(row.access, "read");
    assert.deepEqual(row.domainSlugs, []);
    assert.equal(row.schedule, false);
    assert.equal(row.door, "local");
    assert.equal(row.decidedAt, null);
    assert.equal(typeof row.id, "string");

    const files = await decisionFiles(ctx.root);
    assert.equal(files.length, 1);
    const decision = await readJson(path.join(ctx.root, ".lifequest", "decisions", files[0]!));
    const target = decision.target as { type: string; agentId: string };
    assert.equal(target.type, "agent-pairing");
    assert.equal(target.agentId, row.id);
    assert.equal(decision.title, "Connect Finance bot");
    assert.deepEqual(JSON.parse(String(decision.proposedBodyMarkdown)), {
      fingerprint: fingerprintOf(bearer).slice(0, 12),
      door: "local",
    });
    assert.deepEqual(decision.domainSlugs, []);

    // A second first contact must reuse the row and file no second Decision.
    const again = await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS);
    assert.equal(again.status, 200);
    const after = await listConnectedAgents(ctx.root);
    assert.equal((after as { value: Record<string, unknown>[] }).value.length, 1);
    assert.deepEqual(await decisionFiles(ctx.root), files);
  });

  it("the raw bearer never reaches the vault and the secrets file lives outside it", async () => {
    const text = await walkText(ctx.root);
    assert.equal(text.includes("exactly-22-char-abcd!!"), false, "raw bearer leaked into the vault");

    // The hashes live in app userData, keyed by vault id, and the vault tree
    // never holds them. Only the 12-hex fingerprint reaches the roster.
    const secretsFile = path.join(ctx.secretsDir, "connected-agent-secrets.json");
    assert.equal(await exists(secretsFile), true, "the secrets file must be under secretsDir");
    assert.equal(await exists(path.join(ctx.root, "connected-agent-secrets.json")), false);
    const secrets = await readJson(secretsFile);
    assert.equal(text.includes(JSON.stringify(secrets).slice(0, 40)), false);
    const vault = (secrets.vaults as Record<string, { bearers: Record<string, string> }>)[
      ctx.vaultId
    ];
    assert.ok(vault, "secrets are keyed by vault id");
    const storedHashes = Object.values(vault.bearers);
    assert.equal(storedHashes.length > 0, true);
    for (const hash of storedHashes) {
      // A stored bearer value is the SHA-256 hex, not the raw bearer.
      assert.equal(hash.length, 64);
      assert.match(hash, /^[0-9a-f]{64}$/);
      assert.equal(hash.includes("exactly-22-char-abcd!!"), false);
    }
    record("secrets-outside-vault", "VERIFIED");
  });
});

// ── the invite door ──────────────────────────────────────────────────────────

describe("KAR-70 pairing: the invite door on 8646", () => {
  let ctx: Awaited<ReturnType<typeof openDoors>>;
  const rosterFile = () => path.join(ctx.root, ".lifequest", "connected-agents.json");

  before(async () => {
    ctx = await openDoors("kar70-invite");
  });
  after(async () => {
    await ctx.doors.close();
  });

  it("GET /mcp is 404 on the invite door", async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.invitePort}/mcp`, {
      method: "GET",
      headers: { accept: "application/json, text/event-stream" },
    });
    assert.equal(res.status, 404);
  });

  it("an unknown bearer with no code is INVITE_REQUIRED, and a blank code too", async () => {
    const bearer = "invite-door-bearer-000000001";
    const noCode = await rpc(
      ctx.invitePort,
      { ...auth(bearer), "x-lifequest-name": "Phone bot" },
      "initialize",
      INIT_PARAMS,
    );
    record("invite-no-code", errorOf(noCode.body).code);
    assert.equal(noCode.status, 401);
    assert.deepEqual(errorOf(noCode.body), {
      code: "INVITE_REQUIRED",
      message: "Invite code is required",
    });

    const blank = await rpc(
      ctx.invitePort,
      { ...auth(bearer), "x-lifequest-invite": "   " },
      "initialize",
      INIT_PARAMS,
    );
    record("invite-blank-code", errorOf(blank.body).code);
    assert.equal(blank.status, 401);
    assert.equal(errorOf(blank.body).code, "INVITE_REQUIRED");

    const random = await rpc(
      ctx.invitePort,
      { ...auth(bearer), "x-lifequest-invite": "definitely-not-a-real-code" },
      "initialize",
      INIT_PARAMS,
    );
    record("invite-unknown-code", errorOf(random.body).code);
    assert.equal(random.status, 401);
    assert.deepEqual(errorOf(random.body), {
      code: "INVITE_INVALID",
      message: "Invite code is no longer valid",
    });

    assert.equal(await exists(rosterFile()), false);
    assert.deepEqual(await decisionFiles(ctx.root), []);
  });

  it("a minted code introduces one invite-door agent and is then dead", async () => {
    const minted = await mintInvite(ctx.secretsDir, ctx.vaultId);
    assert.equal(minted.ok, true);
    const code = (minted as { value: { code: string } }).value.code;

    const bearer = "invite-door-bearer-000000002";
    const headers = {
      ...auth(bearer),
      "x-lifequest-name": "Phone bot",
      "x-lifequest-invite": code,
    };
    const init = await rpc(ctx.invitePort, headers, "initialize", INIT_PARAMS);
    record("invite-valid-code", init.status === 200 ? "ACCEPTED" : "REJECTED");
    assert.equal(init.status, 200);

    const call = await rpc(ctx.invitePort, headers, "tools/call", { name: "get_state" });
    record("invite-pending-tool", toolError(call.body).code);
    assert.equal(toolError(call.body).code, "PAIRING_PENDING");

    const agents = await listConnectedAgents(ctx.root);
    const rows = (agents as { value: Record<string, unknown>[] }).value;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.door, "invite");
    assert.equal(rows[0]!.name, "Phone bot");
    assert.equal(rows[0]!.fingerprint, fingerprintOf(bearer).slice(0, 12));
    assert.equal(rows[0]!.status, "pending");

    const reused = await rpc(
      ctx.invitePort,
      { ...auth("invite-door-bearer-000000003"), "x-lifequest-invite": code, "x-lifequest-name": "Second bot" },
      "initialize",
      INIT_PARAMS,
    );
    record("invite-code-reuse", errorOf(reused.body).code);
    assert.equal(reused.status, 401);
    assert.equal(errorOf(reused.body).code, "INVITE_INVALID");

    const text = await walkText(ctx.root);
    assert.equal(text.includes(code), false, "raw invite code leaked into the vault");
  });

  it("a valid code with no name is NAME_REQUIRED and the code stays usable", async () => {
    const minted = await mintInvite(ctx.secretsDir, ctx.vaultId);
    assert.equal(minted.ok, true);
    const code = (minted as { value: { code: string } }).value.code;

    const namelessBearer = "invite-door-bearer-000000004";
    const failed = await rpc(
      ctx.invitePort,
      { ...auth(namelessBearer), "x-lifequest-invite": code },
      "initialize",
      INIT_PARAMS,
    );
    record("invite-code-no-name", errorOf(failed.body).code);
    assert.equal(failed.status, 401);
    assert.equal(errorOf(failed.body).code, "NAME_REQUIRED");

    const ok = await rpc(
      ctx.invitePort,
      {
        ...auth("invite-door-bearer-000000005"),
        "x-lifequest-invite": code,
        "x-lifequest-name": "Late bot",
      },
      "initialize",
      INIT_PARAMS,
    );
    record("invite-code-reuse-after-name-failure", ok.status === 200 ? "ACCEPTED" : "REJECTED");
    assert.equal(ok.status, 200);
  });
});

describe("KAR-70 pairing: an expired invite code", () => {
  it("a code minted 25 hours ago is INVITE_INVALID and files nothing", async () => {
    // The doors run a clock 25 hours ahead, so a code minted against the real
    // clock reads as long expired.
    const future = () => new Date(Date.now() + 25 * 60 * 60 * 1000);
    const ctx = await openDoors("kar70-expired", future);
    try {
      const minted = await mintInvite(ctx.secretsDir, ctx.vaultId);
      assert.equal(minted.ok, true);
      const code = (minted as { value: { code: string } }).value.code;

      const res = await rpc(
        ctx.invitePort,
        {
          ...auth("expired-code-bearer-00000001"),
          "x-lifequest-invite": code,
          "x-lifequest-name": "Too late",
        },
        "initialize",
        INIT_PARAMS,
      );
      record("invite-expired-code", errorOf(res.body).code);
      assert.equal(res.status, 401);
      assert.deepEqual(errorOf(res.body), {
        code: "INVITE_INVALID",
        message: "Invite code is no longer valid",
      });
      assert.equal(
        await exists(path.join(ctx.root, ".lifequest", "connected-agents.json")),
        false,
      );
      assert.deepEqual(await decisionFiles(ctx.root), []);
    } finally {
      await ctx.doors.close();
    }
  });
});

// ── the pending cap ──────────────────────────────────────────────────────────

describe("KAR-70 pairing: the pending cap", () => {
  it("the 21st introduction is PAIRING_LIMIT on either door and the code survives", async () => {
    const ctx = await openDoors("kar70-cap");
    try {
      for (let i = 0; i < PENDING_PAIRING_CAP; i++) {
        const res = await rpc(
          ctx.localPort,
          {
            ...auth(`cap-local-bearer-${String(i).padStart(20, "0")}`),
            "x-lifequest-name": `Cap bot ${i}`,
          },
          "initialize",
          INIT_PARAMS,
        );
        assert.equal(res.status, 200, `introduction ${i} should be accepted`);
      }

      const local = await rpc(
        ctx.localPort,
        {
          ...auth("cap-local-bearer-000000000000000099"),
          "x-lifequest-name": "Twenty first",
        },
        "initialize",
        INIT_PARAMS,
      );
      record("cap-local-21st", errorOf(local.body).code);
      assert.equal(local.status, 429);
      assert.deepEqual(errorOf(local.body), {
        code: "PAIRING_LIMIT",
        message: "Too many agents are waiting for approval",
      });

      const minted = await mintInvite(ctx.secretsDir, ctx.vaultId);
      assert.equal(minted.ok, true);
      const code = (minted as { value: { code: string } }).value.code;

      const invite = await rpc(
        ctx.invitePort,
        {
          ...auth("cap-invite-bearer-000000000000000099"),
          "x-lifequest-invite": code,
          "x-lifequest-name": "Twenty first invite",
        },
        "initialize",
        INIT_PARAMS,
      );
      record("cap-invite-21st", errorOf(invite.body).code);
      assert.equal(invite.status, 429);
      assert.equal(errorOf(invite.body).code, "PAIRING_LIMIT");

      let rows = (await listConnectedAgents(ctx.root)) as { value: Record<string, unknown>[] };
      assert.equal(rows.value.length, PENDING_PAIRING_CAP);

      // One row leaves the pending set, so the unspent code works after all.
      const rejected = await markConnectedAgent(ctx.root, String(rows.value[0]!.id), "rejected");
      assert.equal(rejected.ok, true);

      const retry = await rpc(
        ctx.invitePort,
        {
          ...auth("cap-invite-bearer-000000000000000098"),
          "x-lifequest-invite": code,
          "x-lifequest-name": "Now twenty",
        },
        "initialize",
        INIT_PARAMS,
      );
      record("cap-invite-code-survives", retry.status === 200 ? "ACCEPTED" : "REJECTED");
      assert.equal(retry.status, 200);
      rows = (await listConnectedAgents(ctx.root)) as { value: Record<string, unknown>[] };
      assert.equal(rows.value.length, PENDING_PAIRING_CAP + 1);
    } finally {
      await ctx.doors.close();
    }
  });
});

// ── the artifact ─────────────────────────────────────────────────────────────

describe("KAR-70 pairing: the run artifact", () => {
  const artifact = path.join(
    os.tmpdir(),
    "lifequest-pairing-e2e-artifact",
    "pairing-e2e.json",
  );

  it("pairing-e2e.json exists in the vault and names every scenario of this task", async () => {
    const ctx = await openDoors("kar70-artifact");
    try {
      await fs.writeFile(
        path.join(ctx.root, "pairing-e2e.json"),
        `${JSON.stringify({ scenarios }, null, 2)}\n`,
        "utf8",
      );
      const written = await readJson(path.join(ctx.root, "pairing-e2e.json"));
      const names = (written.scenarios as { name: string; code: string }[]).map((s) => s.name);
      for (const expected of [
        "no-bearer-local",
        "get-mcp-local",
        "short-bearer",
        "name-too-long",
        "name-missing",
        "local-introduction",
        "local-pending-tool",
        "invite-no-code",
        "invite-blank-code",
        "invite-unknown-code",
        "invite-valid-code",
        "invite-pending-tool",
        "invite-code-reuse",
        "invite-code-no-name",
        "invite-code-reuse-after-name-failure",
        "secrets-outside-vault",
        "invite-expired-code",
        "cap-local-21st",
        "cap-invite-21st",
        "cap-invite-code-survives",
      ]) {
        assert.ok(names.includes(expected), `pairing-e2e.json is missing scenario ${expected}`);
      }
      // Prove the write path itself works, outside a vault.
      await fs.mkdir(path.dirname(artifact), { recursive: true });
      await fs.writeFile(
        artifact,
        `${JSON.stringify({ scenarios }, null, 2)}\n`,
        "utf8",
      );
      const copy = await readJson(artifact);
      assert.equal((copy.scenarios as unknown[]).length, scenarios.length);
    } finally {
      await ctx.doors.close();
    }
  });
});