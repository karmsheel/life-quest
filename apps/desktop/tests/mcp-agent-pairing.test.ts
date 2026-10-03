// KAR-70 Tasks 1 and 2 — the two loopback pairing doors, and approval,
// rejection, revoke, and the companion bearer.
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
  addDatabaseColumn,
  applyGoalsCommand,
  applyMapCommand,
  archiveDomain,
  createDatabase,
  createDecision,
  createVault,
  ensureReview,
  fingerprintOf,
  libraryCreate,
  listConnectedAgents,
  markConnectedAgent,
  resolveDecision,
  todayLocalIso,
  updateConnectedAgent,
  upsertRow,
  writeReview,
  effectiveGrant,
  USER_ACTOR,
  PENDING_PAIRING_CAP,
  type ConnectedGrant,
} from "@lifequest/vault-core";
import {
  startPairingDoors,
  LOCAL_MCP_PORT,
  INVITE_MCP_PORT,
} from "../electron/pairing-door.ts";
import {
  ensureCompanionToken,
  mintInvite,
} from "../electron/pairing-secrets.ts";
import { executeTool } from "../electron/map-tools.ts";

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

// ── overlapping introductions ────────────────────────────────────────────────

describe("KAR-70 pairing: overlapping first contacts", () => {
  it("one code and two bearers in flight: one row, one Decision, the loser refused", async () => {
    const ctx = await openDoors("kar70-race-different");
    try {
      const minted = await mintInvite(ctx.secretsDir, ctx.vaultId);
      assert.equal(minted.ok, true);
      const code = (minted as { value: { code: string } }).value.code;

      // Both requests are sent without awaiting, so both reach the door before
      // either has been introduced. The code is valid for both at send time.
      const [a, b] = await Promise.all([
        rpc(
          ctx.invitePort,
          {
            ...auth("race-bearer-a-000000000000000001"),
            "x-lifequest-name": "Racer A",
            "x-lifequest-invite": code,
          },
          "initialize",
          INIT_PARAMS,
        ),
        rpc(
          ctx.invitePort,
          {
            ...auth("race-bearer-b-000000000000000002"),
            "x-lifequest-name": "Racer B",
            "x-lifequest-invite": code,
          },
          "initialize",
          INIT_PARAMS,
        ),
      ]);

      const statuses = [a.status, b.status].sort();
      // Exactly one introduction is filed; the other is told the code is dead.
      assert.deepEqual(statuses, [200, 401]);
      const loser = a.status === 401 ? a : b;
      assert.deepEqual(errorOf(loser.body), {
        code: "INVITE_INVALID",
        message: "Invite code is no longer valid",
      });
      record("race-two-bearers-one-code", errorOf(loser.body).code);

      const agents = await listConnectedAgents(ctx.root);
      const rows = (agents as { value: Record<string, unknown>[] }).value;
      assert.equal(rows.length, 1, "one code must not introduce two agents");
      const files = await decisionFiles(ctx.root);
      assert.equal(files.length, 1, "one row must mean exactly one Decision");
    } finally {
      await ctx.doors.close();
    }
  });

  it("the same bearer twice in flight still creates one row and one Decision", async () => {
    const ctx = await openDoors("kar70-race-same");
    try {
      const minted = await mintInvite(ctx.secretsDir, ctx.vaultId);
      assert.equal(minted.ok, true);
      const code = (minted as { value: { code: string } }).value.code;
      const headers = {
        ...auth("race-same-bearer-00000000000001"),
        "x-lifequest-name": "Twin",
        "x-lifequest-invite": code,
      };

      const [a, b] = await Promise.all([
        rpc(ctx.invitePort, headers, "initialize", INIT_PARAMS),
        rpc(ctx.invitePort, headers, "initialize", INIT_PARAMS),
      ]);

      // Both are the same agent, so both succeed against the one row.
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      record("race-same-bearer", "ACCEPTED");

      const agents = await listConnectedAgents(ctx.root);
      const rows = (agents as { value: Record<string, unknown>[] }).value;
      assert.equal(rows.length, 1, "one bearer must create one row");
      const files = await decisionFiles(ctx.root);
      assert.equal(files.length, 1, "one bearer must file one Decision");

      // The loser of the pair did not spend a second code: the same code is
      // now dead, not resurrected.
      const reused = await rpc(
        ctx.invitePort,
        {
          ...auth("race-third-bearer-00000000000003"),
          "x-lifequest-name": "Third",
          "x-lifequest-invite": code,
        },
        "initialize",
        INIT_PARAMS,
      );
      record("race-code-spent-once", errorOf(reused.body).code);
      assert.equal(reused.status, 401);
      assert.equal(errorOf(reused.body).code, "INVITE_INVALID");
    } finally {
      await ctx.doors.close();
    }
  });
});

// ── approval, rejection, revoke ──────────────────────────────────────────────

describe("KAR-70 pairing: approval", () => {
  it("an approved agent with no grant is NO_GRANT and an empty tool list", async () => {
    const ctx = await openDoors("kar70-approve");
    try {
      const bearer = "approve-door-bearer-000000001";
      const headers = { ...auth(bearer), "x-lifequest-name": "Approve bot" };
      assert.equal((await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS)).status, 200);

      const files = await decisionFiles(ctx.root);
      assert.equal(files.length, 1);
      const decision = await readJson(
        path.join(ctx.root, ".lifequest", "decisions", files[0]!),
      );
      const agentId = (decision.target as { agentId: string }).agentId;

      const resolved = await resolveDecision(ctx.root, decision.id as string, "approved");
      record("approve-resolve", resolved.ok ? "APPROVED" : "FAILED");
      assert.equal(resolved.ok, true, `approve failed: ${JSON.stringify(resolved)}`);

      const rows = (await listConnectedAgents(ctx.root)) as {
        value: Record<string, unknown>[];
      };
      assert.equal(rows.value.length, 1);
      const row = rows.value[0]!;
      assert.equal(row.id, agentId);
      assert.equal(row.status, "active");
      // Approval never grants anything by itself: those are operator grants.
      assert.equal(row.access, "read");
      assert.deepEqual(row.domainSlugs, []);
      assert.equal(row.schedule, false);
      assert.equal(typeof row.decidedAt, "string");

      const list = await rpc(ctx.localPort, headers, "tools/list");
      record("approve-empty-tools", "EMPTY");
      assert.deepEqual((list.body as { result?: { tools?: unknown[] } }).result?.tools, []);

      const call = await rpc(ctx.localPort, headers, "tools/call", { name: "get_state" });
      record("approve-no-grant", toolError(call.body).code);
      assert.equal(call.status, 200);
      assert.deepEqual(toolError(call.body), {
        code: "NO_GRANT",
        message: "No domain or schedule is assigned",
      });

      // The same Decision cannot be resolved twice, and the refused second
      // resolution leaves the grant exactly where the first one put it.
      const again = await resolveDecision(ctx.root, decision.id as string, "approved");
      record("approve-twice", again.ok ? "ACCEPTED" : "REFUSED");
      assert.equal(again.ok, false);
      const after = (await listConnectedAgents(ctx.root)) as { value: Record<string, unknown>[] };
      assert.equal(after.value.length, 1);
      assert.equal(after.value[0]!.access, "read");
      assert.deepEqual(after.value[0]!.domainSlugs, []);
      assert.equal(after.value[0]!.schedule, false);
    } finally {
      await ctx.doors.close();
    }
  });
});

describe("KAR-70 pairing: rejection", () => {
  it("a rejected agent is PAIRING_REJECTED and cannot introduce itself again", async () => {
    const ctx = await openDoors("kar70-reject");
    try {
      const bearer = "reject-door-bearer-0000000001";
      const headers = { ...auth(bearer), "x-lifequest-name": "Reject bot" };
      assert.equal((await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS)).status, 200);

      const files = await decisionFiles(ctx.root);
      assert.equal(files.length, 1);
      const decision = await readJson(
        path.join(ctx.root, ".lifequest", "decisions", files[0]!),
      );
      const resolved = await resolveDecision(ctx.root, decision.id as string, "rejected");
      record("reject-resolve", resolved.ok ? "REJECTED" : "FAILED");
      assert.equal(resolved.ok, true, `reject failed: ${JSON.stringify(resolved)}`);

      const rows = (await listConnectedAgents(ctx.root)) as { value: Record<string, unknown>[] };
      assert.equal(rows.value.length, 1);
      assert.equal(rows.value[0]!.status, "rejected");
      assert.equal(typeof rows.value[0]!.decidedAt, "string");

      const list = await rpc(ctx.localPort, headers, "tools/list");
      assert.deepEqual((list.body as { result?: { tools?: unknown[] } }).result?.tools, []);
      const call = await rpc(ctx.localPort, headers, "tools/call", { name: "get_state" });
      record("reject-tool", toolError(call.body).code);
      assert.equal(call.status, 200);
      assert.deepEqual(toolError(call.body), {
        code: "PAIRING_REJECTED",
        message: "This agent was rejected",
      });

      // The bearer hash stays, so a reconnect is the same known agent: no new
      // row and no new Decision.
      const again = await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS);
      assert.equal(again.status, 200);
      const after = (await listConnectedAgents(ctx.root)) as { value: Record<string, unknown>[] };
      assert.equal(after.value.length, 1);
      assert.equal(after.value[0]!.status, "rejected");
      assert.deepEqual(await decisionFiles(ctx.root), files);
    } finally {
      await ctx.doors.close();
    }
  });
});

describe("KAR-70 pairing: revoke", () => {
  it("a revoked bearer is PAIRING_REVOKED and files nothing on reconnect", async () => {
    const ctx = await openDoors("kar70-revoke");
    try {
      const bearer = "revoke-door-bearer-0000000001";
      const headers = { ...auth(bearer), "x-lifequest-name": "Revoke bot" };
      assert.equal((await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS)).status, 200);

      const files = await decisionFiles(ctx.root);
      const decision = await readJson(
        path.join(ctx.root, ".lifequest", "decisions", files[0]!),
      );
      const agentId = (decision.target as { agentId: string }).agentId;
      assert.equal((await resolveDecision(ctx.root, decision.id as string, "approved")).ok, true);

      const revoked = await markConnectedAgent(ctx.root, agentId, "revoked");
      record("revoke-mark", revoked.ok ? "REVOKED" : "FAILED");
      assert.equal(revoked.ok, true);
      assert.equal(revoked.value.status, "revoked");
      assert.equal(typeof revoked.value.decidedAt, "string");
      // The bearer hash is kept, so the row is still found by fingerprint.
      assert.equal(revoked.value.fingerprint.length, 12);

      const list = await rpc(ctx.localPort, headers, "tools/list");
      assert.deepEqual((list.body as { result?: { tools?: unknown[] } }).result?.tools, []);
      const call = await rpc(ctx.localPort, headers, "tools/call", { name: "get_state" });
      record("revoke-tool", toolError(call.body).code);
      assert.equal(call.status, 200);
      assert.deepEqual(toolError(call.body), {
        code: "PAIRING_REVOKED",
        message: "This agent was revoked",
      });

      const again = await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS);
      assert.equal(again.status, 200);
      const rows = (await listConnectedAgents(ctx.root)) as { value: Record<string, unknown>[] };
      assert.equal(rows.value.length, 1, "a revoked bearer must not file a second row");
      assert.deepEqual(await decisionFiles(ctx.root), files);
    } finally {
      await ctx.doors.close();
    }
  });
});

// ── the companion bearer ─────────────────────────────────────────────────────

describe("KAR-70 pairing: the companion bearer", () => {
  it("is minted once, answers on both doors, and never files a row", async () => {
    const ctx = await openDoors("kar70-companion");
    try {
      const token = await ensureCompanionToken(ctx.secretsDir, ctx.vaultId);
      assert.equal(typeof token, "string");
      assert.ok(token.length >= 22, "the companion token must clear the bearer length floor");
      const again = await ensureCompanionToken(ctx.secretsDir, ctx.vaultId);
      assert.equal(again, token, "the companion token is minted once per vault");
      record("companion-token-stable", "VERIFIED");

      const headers = auth(token);
      for (const [port, label] of [
        [ctx.localPort, "local"],
        [ctx.invitePort, "invite"],
      ] as [number, string][]) {
        const init = await rpc(port, headers, "initialize", INIT_PARAMS);
        assert.equal(init.status, 200, `${label} door must answer the companion`);

        const list = await rpc(port, headers, "tools/list");
        const tools = ((list.body as { result?: { tools?: { name: string }[] } }).result
          ?.tools ?? []) as { name: string }[];
        record(`companion-tools-${label}`, tools.length > 0 ? "REGISTERED" : "EMPTY");
        assert.ok(
          tools.some((t) => t.name === "get_state"),
          `${label} companion tools/list must include get_state`,
        );

        // The companion is never gated. The test process cannot load
        // map-tools (it reaches Electron's safeStorage), so this asserts the
        // refusal codes are absent rather than the shape of the read.
        const call = await rpc(port, headers, "tools/call", { name: "get_state" });
        assert.equal(call.status, 200);
        const text = (call.body as { result?: { content?: { text?: string }[] } }).result
          ?.content?.[0]?.text ?? "";
        for (const code of ["PAIRING_PENDING", "NO_GRANT", "AUTH_REQUIRED"]) {
          assert.equal(
            text.includes(code),
            false,
            `${label} companion get_state must not be gated with ${code}`,
          );
        }
        record(`companion-call-${label}`, "NOT_GATED");
      }

      // The companion is pre-paired: neither door filed anything for it.
      assert.equal(
        await exists(path.join(ctx.root, ".lifequest", "connected-agents.json")),
        false,
      );
      assert.deepEqual(await decisionFiles(ctx.root), []);

      // A missing bearer is still AUTH_REQUIRED now that a token exists.
      const noBearer = await rpc(ctx.localPort, {}, "initialize", INIT_PARAMS);
      record("companion-no-bearer", errorOf(noBearer.body).code);
      assert.equal(noBearer.status, 401);
      assert.deepEqual(errorOf(noBearer.body), {
        code: "AUTH_REQUIRED",
        message: "Authorization bearer is required",
      });
    } finally {
      await ctx.doors.close();
    }
  });
});

// ── the domain read grant ────────────────────────────────────────────────────

describe("KAR-70 pairing: the domain read grant", () => {
  type Fixture = {
    ctx: Awaited<ReturnType<typeof openDoors>>;
    grant: ConnectedGrant;
    /** The database id in financial, used wherever a database argument is needed. */
    financialDatabase: string;
    financialRow: string;
    healthRow: string;
    financialOnlyNote: string;
    bothDomainsNote: string;
    healthGoal: string;
    nullGoal: string;
    /** A daily review whose body carries an overall preamble and a Health section. */
    reviewCadence: string;
    reviewPeriod: string;
  };

  /**
   * Held the moment the doors exist, so a fixture that fails later still has
   * them closed: a leaked listener turns one failure into a suite that never
   * exits.
   */
  let doorsHandle: Doors | null = null;

  /**
   * A vault with two live domains, one database row in each, library notes with
   * one and with two tags, and goals and events with and without a domain — so
   * a projection that filtered nothing, or filtered the wrong way, shows up.
   */
  async function buildFixture(): Promise<Fixture> {
    const ctx = await openDoors("kar70-grant");
    doorsHandle = ctx.doors;
    const { root } = ctx;

    const ids: Record<string, { databaseId: string; rowId: string }> = {};
    for (const slug of ["financial", "health"]) {
      const db = await createDatabase(root, slug, { name: `Ledger ${slug}` });
      assert.equal(db.ok, true, `createDatabase ${slug}: ${JSON.stringify(db)}`);
      const withColumn = await addDatabaseColumn(root, slug, db.value.id, {
        name: "Label",
        type: "text",
      });
      assert.equal(withColumn.ok, true, `addDatabaseColumn ${slug}`);
      const columnId = withColumn.value.columns[withColumn.value.columns.length - 1]!.id;
      const row = await upsertRow(root, slug, db.value.id, {
        cells: { [columnId]: `${slug} row` },
      });
      assert.equal(row.ok, true, `upsertRow ${slug}: ${JSON.stringify(row)}`);
      ids[slug] = { databaseId: db.value.id, rowId: row.value.id };
    }

    const financialOnly = await libraryCreate(
      root,
      { title: "Financial note", bodyMarkdown: "Money only.", domainSlugs: ["financial"] },
      USER_ACTOR,
    );
    assert.equal(financialOnly.ok, true);
    const both = await libraryCreate(
      root,
      {
        title: "Both domains note",
        bodyMarkdown: "Spans two.",
        domainSlugs: ["financial", "health"],
      },
      USER_ACTOR,
    );
    assert.equal(both.ok, true);

    const healthGoal = await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Run a lot",
      domainSlug: "health",
    });
    assert.equal(healthGoal.ok, true, `createGoal health: ${JSON.stringify(healthGoal)}`);
    const nullGoal = await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Life admin",
      domainSlug: null,
    });
    assert.equal(nullGoal.ok, true);

    const today = todayLocalIso();
    // The vault already carries the current year, so the events go into it.
    const year = Number(today.slice(0, 4));
    assert.equal(
      (
        await applyMapCommand(
          root,
          { type: "createEvent", year, title: "Health event", date: today, domainSlug: "health" },
          "user",
          today,
          USER_ACTOR,
        )
      ).ok,
      true,
    );
    assert.equal(
      (
        await applyMapCommand(
          root,
          { type: "createEvent", year, title: "Unscoped event", date: today, domainSlug: null },
          "user",
          today,
          USER_ACTOR,
        )
      ).ok,
      true,
    );

    // A task a health-scoped pack would otherwise include, so clearing tasks is
    // visible as an emptied field rather than an empty vault.
    assert.equal(
      (
        await applyMapCommand(
          root,
          {
            type: "createTask",
            title: "Stretch",
            links: { goalId: healthGoal.value[0]!.id, date: today },
          },
          "user",
          today,
          USER_ACTOR,
        )
      ).ok,
      true,
    );

    // One Decision per domain shape, so list_decisions has both an in-grant and
    // an out-of-grant record to separate.
    for (const [slug, title] of [
      ["health", "Health goal change"],
      ["financial", "Financial goal change"],
    ] as [string, string][]) {
      assert.equal(
        (
          await createDecision(root, {
            target: { type: "goal" },
            proposedTitle: title,
            proposedBodyMarkdown: JSON.stringify({ title }),
            domainSlugs: [slug],
            actor: USER_ACTOR,
          })
        ).ok,
        true,
        `createDecision ${slug}`,
      );
    }

    // One review whose body has the overall preamble plus a Financial and a
    // Health section, so the projection has something to keep and something to
    // drop. The Health section carries a marker string so its absence is an
    // assertion rather than an inference from the section list.
    const reviewPeriod = todayLocalIso();
    const reviewBody = [
      `# Daily review`,
      ``,
      `PREAMBLE_MARKER spans every domain and belongs to nobody here.`,
      ``,
      `## Look-back`,
      ``,
      `The month in general.`,
      ``,
      `## Keep`,
      ``,
      `Nothing in particular.`,
      ``,
      `## Change`,
      ``,
      `Nothing in particular.`,
      ``,
      `## Next-period intent`,
      ``,
      `Stay steady.`,
      ``,
      `## Financial`,
      ``,
      `### Look-back`,
      ``,
      `FINANCIAL_MARKER money went somewhere.`,
      ``,
      `### Keep`,
      ``,
      `Saving every month.`,
      ``,
      `### Change`,
      ``,
      `Nothing.`,
      ``,
      `### Next-period intent`,
      ``,
      `Save more.`,
      ``,
      `## Health`,
      ``,
      `### Look-back`,
      ``,
      `HEALTH_MARKER ran a lot.`,
      ``,
      `### Keep`,
      ``,
      `Stretching.`,
      ``,
      `### Change`,
      ``,
      `Nothing.`,
      ``,
      `### Next-period intent`,
      ``,
      `Run further.`,
      ``,
    ].join("\n");
    // writeReview edits an existing review, and a domain section is only
    // canonicalized for a slug the frontmatter already carries. So the review is
    // ensured once per scope before it is written, or both domain sections come
    // back empty and there is nothing to project.
    for (const scope of ["overall", "financial", "health"]) {
      assert.equal(
        (
          await ensureReview(root, {
            cadence: "daily",
            period: reviewPeriod,
            scope,
          })
        ).ok,
        true,
        `ensureReview ${scope}`,
      );
    }
    const wrote = await writeReview(root, {
      cadence: "daily",
      period: reviewPeriod,
      bodyMarkdown: reviewBody,
      actor: USER_ACTOR,
    });
    assert.equal(wrote.ok, true, `the fixture review must be written: ${JSON.stringify(wrote)}`);

    // Approve one agent, then assign it financial read with Schedule off.
    const bearer = "grant-door-bearer-00000000001";
    const headers = { ...auth(bearer), "x-lifequest-name": "Grant bot" };
    assert.equal((await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS)).status, 200);
    // The fixture also files ordinary Decisions, so the pairing one is found by
    // its target rather than by being the only file there.
    let pairing: Record<string, unknown> | null = null;
    for (const file of await decisionFiles(root)) {
      const candidate = await readJson(path.join(root, ".lifequest", "decisions", file));
      if ((candidate.target as { type?: string }).type === "agent-pairing") {
        pairing = candidate;
        break;
      }
    }
    assert.ok(pairing, "the introduction must have filed a pairing Decision");
    const agentId = (pairing.target as { agentId: string }).agentId;
    assert.equal((await resolveDecision(root, pairing.id as string, "approved")).ok, true);

    const assigned = await updateConnectedAgent(root, agentId, {
      access: "read",
      domainSlugs: ["financial"],
      schedule: false,
    });
    assert.equal(assigned.ok, true, `updateConnectedAgent: ${JSON.stringify(assigned)}`);
    assert.deepEqual(assigned.value.domainSlugs, ["financial"]);
    assert.equal(assigned.value.access, "read");
    assert.equal(assigned.value.schedule, false);

    const rows = (await listConnectedAgents(root)) as { value: Record<string, unknown>[] };
    const row = rows.value.find((r) => r.id === agentId)!;
    return {
      ctx,
      grant: {
        agentId: String(row.id),
        name: String(row.name),
        access: "read",
        domainSlugs: [...(row.domainSlugs as string[])],
        schedule: false,
      },
      financialDatabase: ids.financial!.databaseId,
      financialRow: ids.financial!.rowId,
      healthRow: ids.health!.rowId,
      financialOnlyNote: financialOnly.value.id,
      bothDomainsNote: both.value.id,
      healthGoal: healthGoal.value[0]!.id,
      nullGoal: nullGoal.value[0]!.id,
      reviewCadence: "daily",
      reviewPeriod,
    };
  }

  function codeOf(result: unknown): string {
    const err = (result as { error?: { code?: string } }).error;
    return err?.code ?? "";
  }

  /**
   * One connected-agent call. `activeSlug` is passed only where the test is
   * checking that the desktop lens does not decide anything.
   */
  async function call(
    f: Fixture,
    name: string,
    args: Record<string, unknown> = {},
    activeSlug: string | null = null,
    grant: ConnectedGrant = f.grant,
  ): Promise<unknown> {
    return executeTool(f.ctx.root, activeSlug, name, args, undefined, grant);
  }

  const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };
  const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Outside this agent's grant" } };

  // Each marker stands for a sentence only one part of the review can contain.
  const PREAMBLE_MARKER = "PREAMBLE_MARKER";
  const FINANCIAL_MARKER = "FINANCIAL_MARKER";
  const HEALTH_MARKER = "HEALTH_MARKER";


  let f: Fixture;

  before(async () => {
    f = await buildFixture();
  });
  after(async () => {
    await doorsHandle?.close();
  });

  it("get_doctrine reads the assigned domain and NOT_FOUNDs the other", async () => {
    const doctrine = await call(f, "get_doctrine", { domainSlug: "financial" });
    assert.equal(codeOf(doctrine), "", `financial doctrine must read: ${JSON.stringify(doctrine)}`);
    assert.equal((doctrine as { slug: string }).slug, "financial");
    record("grant-doctrine-financial", "READ");

    const health = await call(f, "get_doctrine", { domainSlug: "health" });
    record("grant-doctrine-health", codeOf(health));
    assert.deepEqual(health, NOT_FOUND);
  });

  it("list_databases drops the other domain and list_rows reads only its own", async () => {
    const listed = (await call(f, "list_databases")) as {
      kits: { domainSlug: string }[];
      databases: { domainSlug: string; id: string }[];
    };
    const domains = listed.databases.map((d) => d.domainSlug);
    assert.equal(domains.includes("health"), false, "list_databases must omit the health database");
    assert.ok(domains.includes("financial"));
    assert.equal(listed.kits.some((k) => k.domainSlug === "health"), false);
    record("grant-list-databases", "FILTERED");

    const rows = (await call(f, "list_rows", {
      domainSlug: "financial",
      databaseId: f.financialDatabase,
    })) as { rows: { id: string }[] };
    assert.deepEqual(rows.rows.map((r) => r.id), [f.financialRow]);
    record("grant-list-rows", "READ");

    const healthRow = await call(f, "get_row", {
      domainSlug: "health",
      databaseId: f.financialDatabase,
      id: f.healthRow,
    });
    record("grant-get-row-health", codeOf(healthRow));
    assert.deepEqual(healthRow, NOT_FOUND);
  });

  it("a library note needs every one of its domains assigned", async () => {
    const listed = (await call(f, "list_documents")) as { records: { id: string }[] };
    const ids = listed.records.map((r) => r.id);
    assert.ok(ids.includes(f.financialOnlyNote), "the financial-only note must be listed");
    assert.equal(
      ids.includes(f.bothDomainsNote),
      false,
      "a note tagged with an unassigned domain must not be listed",
    );
    record("grant-list-documents", "FILTERED");

    const one = await call(f, "get_document", { id: f.financialOnlyNote });
    assert.equal(codeOf(one), "", "the financial-only note must be readable");

    const both = await call(f, "get_document", { id: f.bothDomainsNote });
    record("grant-get-document-both", codeOf(both));
    assert.deepEqual(both, NOT_FOUND);

    const healthDoctrine = await call(f, "get_document", { domainSlug: "health", kind: "why" });
    record("grant-get-document-health", codeOf(healthDoctrine));
    assert.deepEqual(healthDoctrine, NOT_FOUND);
  });

  it("list_goals and get_state drop the unscoped and unassigned records", async () => {
    const goals = (await call(f, "list_goals")) as { goals: { id: string }[] };
    const goalIds = goals.goals.map((g) => g.id);
    assert.equal(goalIds.includes(f.healthGoal), false, "a health goal must not be listed");
    assert.equal(goalIds.includes(f.nullGoal), false, "an unscoped goal must not be listed");
    record("grant-list-goals", "FILTERED");

    const state = (await call(f, "get_state")) as { state: Record<string, unknown> };
    const events = (state.state.events ?? []) as { title: string }[];
    const titles = events.map((e) => e.title);
    assert.equal(titles.includes("Health event"), false, "a health event must not be in the state");
    assert.equal(
      titles.includes("Unscoped event"),
      false,
      "an unscoped event stays with the companion",
    );
    // Schedule is off, so neither key is present at all — an empty array would
    // read as "the week was empty".
    assert.equal("tasks" in state.state, false, "get_state must have no tasks key");
    assert.equal("week" in state.state, false, "get_state must have no week key");
    record("grant-get-state", "FILTERED");
  });

  it("get_period_pack takes an assigned scope and clears the Schedule and overall fields", async () => {
    const args = { cadence: "daily", period: todayLocalIso() };

    const overall = await call(f, "get_period_pack", { ...args, scope: "overall" });
    record("grant-pack-overall", codeOf(overall));
    assert.deepEqual(overall, FORBIDDEN);

    const health = await call(f, "get_period_pack", { ...args, scope: "health" });
    record("grant-pack-health", codeOf(health));
    assert.deepEqual(health, FORBIDDEN);

    const pack = (await call(f, "get_period_pack", { ...args, scope: "financial" })) as {
      pack: {
        tasks: unknown[];
        liveDays: unknown[];
        previousReview: unknown;
        domainSections: unknown[];
      };
    };
    assert.deepEqual(pack.pack.tasks, []);
    assert.deepEqual(pack.pack.liveDays, []);
    assert.equal(pack.pack.previousReview, null);
    assert.deepEqual(pack.pack.domainSections, []);
    record("grant-pack-financial", "PROJECTED");
  });

  it("list_decisions drops the pairing Decision and every decision outside the grant", async () => {
    const listed = (await call(f, "list_decisions")) as { decisions: Record<string, unknown>[] };
    const titles = listed.decisions.map((d) => String(d.proposedTitle));
    assert.equal(
      titles.some((t) => t.startsWith("Connect ")),
      false,
      "a pairing Decision is not the agent's business",
    );
    assert.equal(
      titles.includes("Health goal change"),
      false,
      "a decision on an unassigned domain must not be listed",
    );
    assert.ok(
      titles.includes("Financial goal change"),
      "a decision inside the assignment must be listed",
    );
    // The pairing Decision exists and is approved: it was dropped, not absent.
    const files = await decisionFiles(f.ctx.root);
    assert.equal(files.length, 3, "pairing, health, and financial Decisions all exist");
    record("grant-list-decisions", "FILTERED");
  });

  it("run_script_block follows the same grant as the other single-record reads", async () => {
    const ungranted = await call(f, "run_script_block", {
      domainSlug: "health",
      source: "SELECT 1",
    });
    record("grant-run-script-health", codeOf(ungranted));
    assert.deepEqual(
      ungranted,
      NOT_FOUND,
      "a script block against an ungranted domain must not reach the tool",
    );
    // NOT_FOUND rather than FAILED is the proof the engine never ran: a query
    // against a missing domain answers the engine's own error instead.
    assert.equal(
      (ungranted as { error: { message: string } }).error.message,
      "Not found",
    );

    const granted = await call(f, "run_script_block", {
      domainSlug: "financial",
      source: "SELECT 1",
    });
    record("grant-run-script-financial", codeOf(granted) || "REACHED");
    assert.notDeepEqual(
      granted,
      NOT_FOUND,
      "an assigned domain must still reach executeScriptTool",
    );
    assert.equal(
      (granted as { error?: { code?: string } }).error?.code ?? "",
      "",
      "the tool answers for itself; the gate must not have refused it",
    );
  });

  it("a review keeps only its assigned sections and drops the overall preamble", async () => {
    const args = { cadence: f.reviewCadence, period: f.reviewPeriod };

    const review = (await call(f, "get_review", args)) as {
      review: { scopes: Record<string, unknown>; bodyMarkdown: string };
    };
    record("grant-get-review", "READ");
    assert.deepEqual(Object.keys(review.review.scopes), ["financial"]);
    assert.equal(
      review.review.bodyMarkdown.includes(HEALTH_MARKER),
      false,
      "the Health section must be absent from the body",
    );
    assert.equal(review.review.bodyMarkdown.includes("## Health"), false);
    assert.equal(
      review.review.bodyMarkdown.includes(PREAMBLE_MARKER),
      false,
      "the overall preamble must be absent",
    );
    assert.ok(
      review.review.bodyMarkdown.includes(FINANCIAL_MARKER),
      "the assigned section must survive in full",
    );

    const listed = (await call(f, "list_reviews", { cadence: f.reviewCadence })) as {
      reviews: { scopes: Record<string, unknown> }[];
    };
    const entry = listed.reviews.find((r) => Object.keys(r.scopes).length > 0);
    assert.ok(entry, "the review must still be listed for an assigned domain");
    assert.deepEqual(Object.keys(entry.scopes), ["financial"]);
    assert.equal(
      Object.keys(entry.scopes).includes("overall"),
      false,
      "the overall scope stays with the companion",
    );
    record("grant-list-reviews", "FILTERED");

    // A grant with no scope in this review reads as missing rather than as an
    // empty success. `emotional` is a live seeded domain the fixture review has
    // no section for, so nothing granted remains.
    const noOverlap: ConnectedGrant = { ...f.grant, domainSlugs: ["emotional"] };
    const empty = await executeTool(f.ctx.root, null, "get_review", args, undefined, noOverlap);
    record("grant-get-review-missing", codeOf(empty));
    assert.deepEqual(
      empty,
      NOT_FOUND,
      "a review with no granted scope is missing, not an empty success",
    );

    // The same grant sees nothing in the index either.
    const emptyList = (await executeTool(
      f.ctx.root,
      null,
      "list_reviews",
      { cadence: f.reviewCadence },
      undefined,
      noOverlap,
    )) as { reviews: unknown[] };
    assert.deepEqual(
      emptyList.reviews,
      [],
      "an index entry with no granted scope is dropped, not returned",
    );
  });

  it("a review write stays FORBIDDEN while access is read", async () => {
    const before = await walkText(f.ctx.root);
    for (const [name, args] of [
      ["write_review", { cadence: f.reviewCadence, period: f.reviewPeriod, body: "## Look-back" }],
      ["mark_review_done", { cadence: f.reviewCadence, period: f.reviewPeriod, scope: "financial" }],
      ["unlock_review", { cadence: f.reviewCadence, period: f.reviewPeriod }],
    ] as [string, Record<string, unknown>][]) {
      const result = await call(f, name, args);
      record(`grant-review-refused-${name}`, codeOf(result));
      assert.deepEqual(result, FORBIDDEN, `${name} must be FORBIDDEN while access is read`);
    }
    assert.equal(await walkText(f.ctx.root), before, "a refused review write must not write");
  });

  it("an ungranted domain is missing, not an empty list", async () => {
    const databases = await call(f, "list_databases", { domainSlug: "health" });
    record("grant-list-databases-health", codeOf(databases));
    assert.deepEqual(
      databases,
      NOT_FOUND,
      "list_databases on an ungranted domain must not answer a successful empty list",
    );

    // The granted form still works, so the refusal above is about the domain
    // rather than about the argument.
    const granted = await call(f, "list_databases", { domainSlug: "financial" });
    assert.notDeepEqual(granted, NOT_FOUND);
    record("grant-list-databases-financial", "READ");

    const missing = await call(f, "get_document", { id: "no-such-library-note" });
    record("grant-get-document-missing", codeOf(missing));
    assert.deepEqual(
      missing,
      NOT_FOUND,
      "a library miss uses the grant's NOT_FOUND shape, not the engine's message",
    );
  });

  it("a write and a companion-only tool are both refused, and the vault does not move", async () => {
    const before = await walkText(f.ctx.root);
    const decisionsBefore = await decisionFiles(f.ctx.root);

    for (const [name, args] of [
      ["create_year", { year: 2031 }],
      ["set_about_me", { text: "not yours" }],
      ["set_month_notes", { year: 2026, month: 1, text: "not yours" }],
      ["capture_transaction", { text: "coffee 40" }],
      ["create_task", { title: "not yours" }],
    ] as [string, Record<string, unknown>][]) {
      const result = await call(f, name, args);
      record(`grant-refused-${name}`, codeOf(result));
      assert.deepEqual(
        result,
        FORBIDDEN,
        `${name} must be FORBIDDEN while access is read`,
      );
    }

    assert.equal(await walkText(f.ctx.root), before, "a refused call must not write");
    assert.deepEqual(await decisionFiles(f.ctx.root), decisionsBefore, "and file no Decision");
    record("grant-refused-vault-unchanged", "UNCHANGED");
  });

  it("with no grant the desktop lens applies, and with a grant it does not", async () => {
    const noGrant = await executeTool(
      f.ctx.root,
      "health",
      "get_doctrine",
      {},
      undefined,
      undefined,
    );
    assert.equal(
      (noGrant as { slug?: string }).slug,
      "health",
      "a call with no grant still resolves through activeSlug",
    );
    record("grant-lens-no-grant", "ACTIVE_SLUG");

    const withGrant = await call(f, "get_doctrine", {}, "health");
    const slugs = ((withGrant as { domains?: { slug: string }[] }).domains ?? []).map((d) => d.slug);
    assert.deepEqual(slugs, ["financial"], "the desktop lens must not decide a granted read");
    record("grant-lens-with-grant", "IGNORED");
  });

  it("archiving an assigned domain closes the grant but keeps the roster row", async () => {
    assert.equal((await archiveDomain(f.ctx.root, "financial")).ok, true);

    // What the door computes for the next call: the row with the archived
    // domain dropped out of it.
    const row = (await listConnectedAgents(f.ctx.root)) as {
      value: Record<string, unknown>[];
    };
    const stored = row.value.find((r) => r.id === f.grant.agentId)!;
    const effective = await effectiveGrant(f.ctx.root, {
      id: String(stored.id),
      name: String(stored.name),
      fingerprint: String(stored.fingerprint),
      status: stored.status as "active",
      access: stored.access as "read" | "write",
      domainSlugs: [...(stored.domainSlugs as string[])],
      schedule: stored.schedule === true,
      door: "local",
      createdAt: String(stored.createdAt),
      decidedAt: stored.decidedAt === null ? null : String(stored.decidedAt),
    });
    record("grant-after-archive-effective", effective.domainSlugs.join(",") || "EMPTY");
    assert.deepEqual(
      effective.domainSlugs,
      [],
      "an archived domain must drop out of the effective grant",
    );

    // The roster is unchanged: the operator's assignment is still on file, and
    // unarchiving is what brings it back.
    assert.deepEqual(
      stored.domainSlugs,
      ["financial"],
      "the roster keeps the assignment; only the effective grant drops it",
    );

    const after = await executeTool(
      f.ctx.root,
      null,
      "get_doctrine",
      { domainSlug: "financial" },
      undefined,
      effective,
    );
    record("grant-after-archive", codeOf(after));
    assert.equal(
      codeOf(after),
      "NO_GRANT",
      "a grant whose only domain has been archived reaches nothing",
    );
  });
});

// ── the artifact ─────────────────────────────────────────────────────────────

describe("KAR-70 pairing: the run artifact", () => {
  const artifact = path.join(
    os.tmpdir(),
    "lifequest-pairing-e2e-artifact",
    "pairing-e2e.json",
  );

  it("pairing-e2e.json exists in the vault and names every scenario of tasks 1 to 3", async () => {
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
        "race-two-bearers-one-code",
        "race-same-bearer",
        "race-code-spent-once",
        "approve-resolve",
        "approve-empty-tools",
        "approve-no-grant",
        "approve-twice",
        "reject-resolve",
        "reject-tool",
        "revoke-mark",
        "revoke-tool",
        "companion-token-stable",
        "companion-tools-local",
        "companion-call-local",
        "companion-tools-invite",
        "companion-call-invite",
        "companion-no-bearer",
        "grant-doctrine-financial",
        "grant-doctrine-health",
        "grant-list-databases",
        "grant-list-rows",
        "grant-get-row-health",
        "grant-list-documents",
        "grant-get-document-both",
        "grant-get-document-health",
        "grant-list-goals",
        "grant-get-state",
        "grant-pack-overall",
        "grant-pack-health",
        "grant-pack-financial",
        "grant-list-decisions",
        "grant-refused-create_year",
        "grant-refused-set_about_me",
        "grant-refused-set_month_notes",
        "grant-refused-capture_transaction",
        "grant-refused-create_task",
        "grant-refused-vault-unchanged",
        "grant-lens-no-grant",
        "grant-lens-with-grant",
        "grant-after-archive",
        "grant-after-archive-effective",
        "grant-run-script-health",
        "grant-run-script-financial",
        "grant-get-review",
        "grant-list-reviews",
        "grant-get-review-missing",
        "grant-review-refused-write_review",
        "grant-review-refused-mark_review_done",
        "grant-review-refused-unlock_review",
        "grant-list-databases-health",
        "grant-list-databases-financial",
        "grant-get-document-missing",
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