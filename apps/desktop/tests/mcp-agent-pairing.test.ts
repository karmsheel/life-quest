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
import { readFileSync } from "node:fs";
import { describe, it, before, after } from "node:test";
import { fileURLToPath } from "node:url";
import {
  addDatabaseColumn,
  applyGoalsCommand,
  applyMapCommand,
  archiveDomain,
  createDatabase,
  createDecision,
  createPage,
  createVault,
  ensureReview,
  fingerprintOf,
  getDatabase,
  getPage,
  installFinanceKit,
  libraryCreate,
  listConnectedAgents,
  listDatabases,
  listRows,
  loadGoals,
  loadMapState,
  markConnectedAgent,
  mondayOnOrBefore,
  readLog,
  resolveDecision,
  setFinanceCaptureAccount,
  todayLocalIso,
  updateConnectedAgent,
  upsertRow,
  writeReview,
  effectiveGrant,
  FINANCE_DB_IDS,
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
  dropInvite,
  ensureCompanionToken,
  listUnusedInvites,
  mintInvite,
  takeInvite,
} from "../electron/pairing-secrets.ts";
import { executeTool } from "../electron/map-tools.ts";
import { ensureMcpServer, MCP_URL } from "../electron/companion-profile.ts";


/** KAR-70 Task 6: the desktop package root, for reading a component's source. */
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relFromDesktop: string): string {
  return readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

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

    // A period with no review file at all must be indistinguishable from a
    // review that exists but shares no scope with the grant. The engine answers
    // the first with its own "Review file not found"; the difference between the
    // two payloads is what tells an agent the period was reviewed.
    const noFile = await executeTool(
      f.ctx.root,
      null,
      "get_review",
      { cadence: "daily", period: "1999-01-01" },
      undefined,
      f.grant,
    );
    record("grant-get-review-no-file", codeOf(noFile));
    assert.deepEqual(
      noFile,
      NOT_FOUND,
      "a missing review file uses the grant's NOT_FOUND shape",
    );
    assert.notEqual(
      (noFile as { error: { message: string } }).error.message,
      "Review file not found",
      "the engine's message would tell the agent the file is missing rather than ungranted",
    );
    assert.deepEqual(
      noFile,
      empty,
      "a missing file and an ungranted review must be the same answer",
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

  it("mark_review_done returns only the assigned domain's slice", async () => {
    // The leak needed Write to get past the gate at all, so the row is flipped
    // to write first — and flipped back, so the read assertions that follow in
    // this describe still run against a read grant.
    const promoted = await updateConnectedAgent(f.ctx.root, f.grant.agentId, {
      access: "write",
    });
    assert.equal(promoted.ok, true, `promote to write: ${JSON.stringify(promoted)}`);
    const writeGrant: ConnectedGrant = { ...f.grant, access: "write" };

    const write = await call(
      f,
      "mark_review_done",
      {
        cadence: f.reviewCadence,
        period: f.reviewPeriod,
        scope: "financial",
      },
      null,
      writeGrant,
    );
    record("grant-mark-review-done", "MARKED");

    // The engine answers with the whole review file it just marked: the overall
    // preamble and every domain's section. The write is checked against the
    // assigned scope, but the response has to be cut to the same slice
    // get_review returns.
    const done = write as {
      review?: { scopes: Record<string, unknown>; bodyMarkdown: string };
      error?: { code?: string };
    };
    assert.equal(
      done.error?.code ?? "",
      "",
      `mark_review_done must succeed for an assigned scope: ${JSON.stringify(done)}`,
    );
    assert.ok(done.review, "the tool answers with the review it marked");
    record("grant-mark-review-done-scopes", Object.keys(done.review.scopes).join(","));
    assert.deepEqual(
      Object.keys(done.review.scopes),
      ["financial"],
      "no scope but the assigned one may appear",
    );

    const body = done.review.bodyMarkdown;
    assert.ok(
      body.includes(FINANCIAL_MARKER),
      `the assigned section must survive: ${body}`,
    );
    assert.equal(
      body.includes(HEALTH_MARKER),
      false,
      `the Health section must be absent: ${body}`,
    );
    assert.equal(
      body.includes("## Health"),
      false,
      "no Health heading may survive either",
    );
    assert.equal(
      body.includes(PREAMBLE_MARKER),
      false,
      `the overall preamble must be absent: ${body}`,
    );

    // get_review, after the same marking, agrees with what mark_review_done
    // returned, so the two paths cannot drift apart.
    const reread = (await call(
      f,
      "get_review",
      { cadence: f.reviewCadence, period: f.reviewPeriod },
      null,
      writeGrant,
    )) as { review: { scopes: Record<string, unknown>; bodyMarkdown: string } };
    record("grant-mark-review-done-matches-read", "SAME");
    assert.equal(reread.review.bodyMarkdown, body);

    const demoted = await updateConnectedAgent(f.ctx.root, f.grant.agentId, {
      access: "read",
    });
    assert.equal(demoted.ok, true, `restore read access: ${JSON.stringify(demoted)}`);
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

// ── the domain write grant ───────────────────────────────────────────────────

describe("KAR-70 pairing: the domain write grant", () => {
  type Fixture = {
    ctx: Awaited<ReturnType<typeof openDoors>>;
    /** Roster id and name, which the life log must record for a write. */
    agentId: string;
    agentName: string;
    readGrant: ConnectedGrant;
    writeGrant: ConnectedGrant;
    /** A hand-made financial database with one text column and one row. */
    writeDatabase: string;
    writeColumn: string;
    writeRow: string;
    financialPage: string;
    healthPage: string;
    financialGoal: string;
    /** Transaction rows before any capture, so a posted row is visible. */
    transactionsBefore: number;
  };

  let doorsHandle: Doors | null = null;

  async function buildFixture(): Promise<Fixture> {
    const ctx = await openDoors("kar70-write");
    doorsHandle = ctx.doors;
    const { root } = ctx;

    // The finance kit, one transactional account, and nothing on an insert
    // allowlist: the allowlist is empty by construction, so a database write
    // files a Decision exactly as the companion's does.
    assert.equal((await installFinanceKit(root, USER_ACTOR)).ok, true, "finance kit install");
    const account = await upsertRow(root, "financial", FINANCE_DB_IDS.accounts, {
      cells: {
        name: "Cheque",
        type: "checking",
        currency: "ZAR",
        opening_balance: 0,
        opening_as_of: null,
        apr: null,
      },
    });
    assert.equal(account.ok, true, `account: ${JSON.stringify(account)}`);
    assert.equal((await setFinanceCaptureAccount(root, account.value.id)).ok, true);

    const db = await createDatabase(root, "financial", { name: "Write ledger" });
    assert.equal(db.ok, true, `createDatabase: ${JSON.stringify(db)}`);
    const withColumn = await addDatabaseColumn(root, "financial", db.value.id, {
      name: "Label",
      type: "text",
    });
    assert.equal(withColumn.ok, true, `addDatabaseColumn: ${JSON.stringify(withColumn)}`);
    const writeColumn = withColumn.value.columns[withColumn.value.columns.length - 1]!.id;
    const row = await upsertRow(root, "financial", db.value.id, {
      cells: { [writeColumn]: "seed row" },
    });
    assert.equal(row.ok, true, `seed row: ${JSON.stringify(row)}`);

    const financialPage = await createPage(root, "financial", { title: "Financial board" });
    const healthPage = await createPage(root, "health", { title: "Health board" });
    assert.equal(financialPage.ok, true, `financial page: ${JSON.stringify(financialPage)}`);
    assert.equal(healthPage.ok, true, `health page: ${JSON.stringify(healthPage)}`);

    // create_project validates that the goal exists, so the fixture needs one
    // inside the assignment.
    const goal = await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Save more",
      domainSlug: "financial",
    });
    assert.equal(goal.ok, true, `createGoal fixture: ${JSON.stringify(goal)}`);

    const before = await listRows(root, "financial", FINANCE_DB_IDS.transactions);
    assert.equal(before.ok, true);

    // Introduce, approve, and assign financial read. Write is turned on later,
    // by the test that needs it, so the read-only proof runs first.
    const bearer = "write-door-bearer-0000000001";
    const headers = { ...auth(bearer), "x-lifequest-name": "Write bot" };
    assert.equal((await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS)).status, 200);
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

    const rows = (await listConnectedAgents(root)) as { value: Record<string, unknown>[] };
    const stored = rows.value.find((r) => r.id === agentId)!;
    const base = {
      agentId: String(stored.id),
      name: String(stored.name),
      domainSlugs: [...(stored.domainSlugs as string[])],
      schedule: false,
    };
    return {
      ctx,
      agentId: base.agentId,
      agentName: base.name,
      readGrant: { ...base, access: "read" },
      writeGrant: { ...base, access: "write" },
      writeDatabase: db.value.id,
      writeColumn,
      writeRow: row.value.id,
      financialPage: financialPage.value.id,
      healthPage: healthPage.value.id,
      financialGoal: goal.value[0]!.id,
      transactionsBefore: before.ok ? before.value.length : 0,
    };
  }

  function codeOf(result: unknown): string {
    const err = (result as { error?: { code?: string } }).error;
    return err?.code ?? "";
  }

  async function call(
    name: string,
    args: Record<string, unknown> = {},
    grant: ConnectedGrant = f.writeGrant,
  ): Promise<unknown> {
    return executeTool(f.ctx.root, null, name, args, undefined, grant);
  }

  const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Outside this agent's grant" } };
  const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };

  /** Transaction row count, the proof that a capture posted or did not. */
  async function transactionCount(root: string): Promise<number> {
    const listed = await listRows(root, "financial", FINANCE_DB_IDS.transactions);
    assert.equal(listed.ok, true, `listRows transactions: ${JSON.stringify(listed)}`);
    return listed.ok ? listed.value.length : -1;
  }

  let f: Fixture;

  before(async () => {
    f = await buildFixture();
  });
  after(async () => {
    await doorsHandle?.close();
  });

  it("every write is FORBIDDEN while access is read, and the vault does not move", async () => {
    const before = await walkText(f.ctx.root);
    const decisionsBefore = await decisionFiles(f.ctx.root);
    const year = Number(todayLocalIso().slice(0, 4));

    for (const [name, args] of [
      ["upsert_row", { domainSlug: "financial", databaseId: f.writeDatabase, cells: { [f.writeColumn]: "no" } }],
      ["create_library_document", { title: "No", body: "no", domainSlugs: ["financial"] }],
      ["create_goal", { name: "No", domainSlug: "financial" }],
      ["create_event", { year, title: "No", date: todayLocalIso(), domainSlug: "financial" }],
      ["create_project", { title: "No", goalId: f.financialGoal, domainSlug: "financial" }],
      ["capture_transaction", { text: "Bought food for R85 today" }],
      ["apply_script_block", { domainSlug: "financial", pageId: f.financialPage, name: "No", source: "SELECT 1" }],
    ] as [string, Record<string, unknown>][]) {
      const result = await call(name, args, f.readGrant);
      record(`write-read-refused-${name}`, codeOf(result));
      assert.deepEqual(result, FORBIDDEN, `${name} must be FORBIDDEN while access is read`);
    }

    assert.equal(await walkText(f.ctx.root), before, "a refused write must not write");
    assert.deepEqual(await decisionFiles(f.ctx.root), decisionsBefore, "and file no Decision");
    record("write-read-refused-unchanged", "UNCHANGED");
  });

  it("a clear capture posts a row, and undo and correct follow it", async () => {
    const posted = (await call("capture_transaction", {
      text: "Bought food for R85 today",
      threadId: "kar70",
    })) as { posted: boolean; rowId: string | null; amount?: number };
    record("write-capture", posted.posted ? "POSTED" : codeOf(posted));
    assert.equal(posted.posted, true, `capture must post: ${JSON.stringify(posted)}`);
    assert.equal(posted.amount, -85);
    assert.equal(
      await transactionCount(f.ctx.root),
      f.transactionsBefore + 1,
      "a posted capture is a row in the transactions database",
    );

    const corrected = (await call("correct_capture", {
      text: "Bought food for R95 today",
      threadId: "kar70",
    })) as { posted: boolean; amount?: number };
    record("write-correct-capture", corrected.posted ? "POSTED" : codeOf(corrected));
    assert.equal(corrected.posted, true, `correct_capture: ${JSON.stringify(corrected)}`);
    assert.equal(corrected.amount, -95);

    const undone = (await call("undo_capture", { threadId: "kar70" })) as { posted: boolean };
    record("write-undo-capture", undone.posted ? "POSTED" : "UNDONE");
    assert.equal(undone.posted, false, `undo_capture: ${JSON.stringify(undone)}`);
    assert.equal(
      await transactionCount(f.ctx.root),
      f.transactionsBefore,
      "an undone capture leaves no row",
    );
  });

  it("capture needs financial in the grant", async () => {
    // Write on, but the assignment no longer covers financial. The gate is the
    // domain, not the Write switch.
    const noFinancial: ConnectedGrant = { ...f.writeGrant, domainSlugs: ["health"] };
    for (const [name, args] of [
      ["capture_transaction", { text: "Bought food for R85 today" }],
      ["undo_capture", { threadId: "kar70" }],
      ["correct_capture", { text: "Bought food for R85 today" }],
    ] as [string, Record<string, unknown>][]) {
      const result = await call(name, args, noFinancial);
      record(`write-capture-no-financial-${name}`, codeOf(result));
      assert.deepEqual(result, FORBIDDEN, `${name} needs financial in the grant`);
    }
  });

  it("the capture life-log line names the roster agent", async () => {
    const posted = (await call("capture_transaction", {
      text: "Bought food for R120 today",
      threadId: "kar70-log",
    })) as { posted: boolean; rowId: string | null };
    assert.equal(posted.posted, true, `capture for the log: ${JSON.stringify(posted)}`);

    const logged = await readLog(f.ctx.root);
    assert.equal(logged.ok, true);
    const line = logged.ok
      ? logged.value.find((e) => e.type === "capture.posted" && (e.payload as { rowId?: string })?.rowId === posted.rowId)
      : undefined;
    assert.ok(line, "the posted capture must have a life-log line");
    assert.deepEqual(line.actor, { type: "agent", id: f.agentId, name: f.agentName });
    record("write-capture-actor", "ROSTER_AGENT");
  });

  it("a database write files a Decision and lands only on approval", async () => {
    const proposal = (await call("upsert_row", {
      domainSlug: "financial",
      databaseId: f.writeDatabase,
      cells: { [f.writeColumn]: "proposed row" },
    })) as { decisionId?: string; status?: string };
    record("write-upsert-row", proposal.decisionId ? "DECISION" : codeOf(proposal));
    assert.ok(proposal.decisionId, `upsert_row must file a Decision: ${JSON.stringify(proposal)}`);

    let rows = await listRows(f.ctx.root, "financial", f.writeDatabase);
    assert.equal(rows.ok, true);
    assert.equal(
      rows.ok ? rows.value.length : -1,
      1,
      "the row must be absent until the operator approves",
    );

    assert.equal((await resolveDecision(f.ctx.root, proposal.decisionId!, "approved")).ok, true);
    rows = await listRows(f.ctx.root, "financial", f.writeDatabase);
    assert.equal(rows.ok ? rows.value.length : -1, 2, "approval is what writes the row");
    record("write-upsert-row-approved", "APPLIED");
  });

  it("delete_row, create_database, and add_column file Decisions and apply nothing", async () => {
    const deleted = (await call("delete_row", {
      domainSlug: "financial",
      databaseId: f.writeDatabase,
      id: f.writeRow,
    })) as { decisionId?: string };
    record("write-delete-row", deleted.decisionId ? "DECISION" : codeOf(deleted));
    assert.ok(deleted.decisionId, `delete_row: ${JSON.stringify(deleted)}`);

    const created = (await call("create_database", {
      domainSlug: "financial",
      name: "Proposed ledger",
    })) as { decisionId?: string };
    record("write-create-database", created.decisionId ? "DECISION" : codeOf(created));
    assert.ok(created.decisionId, `create_database: ${JSON.stringify(created)}`);

    const column = (await call("add_column", {
      domainSlug: "financial",
      databaseId: f.writeDatabase,
      name: "Extra",
      type: "text",
    })) as { decisionId?: string };
    record("write-add-column", column.decisionId ? "DECISION" : codeOf(column));
    assert.ok(column.decisionId, `add_column: ${JSON.stringify(column)}`);

    // Nothing landed: the row is still there, the proposed database does not
    // exist, and the column is not on the schema.
    const rows = await listRows(f.ctx.root, "financial", f.writeDatabase);
    assert.ok(
      rows.ok && rows.value.some((r) => r.id === f.writeRow),
      "a pending delete must leave the row",
    );
    const dbs = await listDatabases(f.ctx.root, "financial");
    assert.ok(dbs.ok);
    assert.equal(
      dbs.ok ? dbs.value.some((d) => d.name === "Proposed ledger") : true,
      false,
      "a pending create_database must not create the database",
    );
    const schema = await getDatabase(f.ctx.root, "financial", f.writeDatabase);
    assert.ok(schema.ok);
    assert.equal(
      schema.ok ? schema.value.columns.some((c) => c.name === "Extra") : true,
      false,
      "a pending add_column must not add the column",
    );
    record("write-database-decisions-unapplied", "PENDING");
  });

  it("a goal or project for financial files a Decision, and another domain files nothing", async () => {
    const goal = (await call("create_goal", {
      name: "Agent goal",
      domainSlug: "financial",
    })) as { decisionId?: string };
    record("write-create-goal", goal.decisionId ? "DECISION" : codeOf(goal));
    assert.ok(goal.decisionId, `create_goal financial: ${JSON.stringify(goal)}`);

    const project = (await call("create_project", {
      title: "Agent project",
      goalId: f.financialGoal,
      domainSlug: "financial",
    })) as { decisionId?: string };
    record("write-create-project", project.decisionId ? "DECISION" : codeOf(project));
    assert.ok(project.decisionId, `create_project financial: ${JSON.stringify(project)}`);

    const before = await decisionFiles(f.ctx.root);
    for (const [name, args] of [
      ["create_goal", { name: "Unscoped", domainSlug: null }],
      ["create_goal", { name: "Health goal", domainSlug: "health" }],
    ] as [string, Record<string, unknown>][]) {
      const result = await call(name, args);
      record(`write-forbidden-${name}-${String(args.domainSlug)}`, codeOf(result));
      assert.deepEqual(result, FORBIDDEN, `${name} on ${String(args.domainSlug)} must be FORBIDDEN`);
    }
    assert.deepEqual(await decisionFiles(f.ctx.root), before, "a forbidden goal files nothing");
    record("write-forbidden-goal-unfiled", "UNFILED");
  });

  it("an event applies inside the grant and is refused outside or without one", async () => {
    const today = todayLocalIso();
    const year = Number(today.slice(0, 4));

    const created = await call("create_event", {
      year,
      title: "Financial event",
      date: today,
      domainSlug: "financial",
    });
    record("write-create-event", codeOf(created) || "APPLIED");
    assert.equal(codeOf(created), "", `create_event financial: ${JSON.stringify(created)}`);

    const state = (await call("get_state")) as { state: { events: { id: string; title: string; domainSlug: string | null }[] } };
    const event = state.state.events.find((e) => e.title === "Financial event");
    assert.ok(event, "the event must be in the granted domain's state");

    const unscoped = await call("create_event", {
      year,
      title: "Unscoped agent event",
      date: today,
      domainSlug: null,
    });
    record("write-create-event-unscoped", codeOf(unscoped));
    assert.deepEqual(unscoped, FORBIDDEN, "an event with no domain is FORBIDDEN");

    const moved = await call("update_event", {
      year,
      id: event.id,
      domainSlug: "health",
    });
    record("write-update-event-move-out", codeOf(moved));
    assert.deepEqual(moved, FORBIDDEN, "moving an event out of the grant is FORBIDDEN");

    const after = (await call("get_state")) as { state: { events: { id: string; domainSlug: string | null }[] } };
    assert.equal(
      after.state.events.find((e) => e.id === event.id)?.domainSlug,
      "financial",
      "a refused move leaves the event where it was",
    );
    record("write-update-event-unchanged", "FINANCIAL");
  });

  it("an update that names no domain keeps the record where it is", async () => {
    const today = todayLocalIso();
    const year = Number(today.slice(0, 4));

    // A title-only event edit: no domainSlug argument at all. The event is
    // financial and financial is assigned, so this must apply — an omitted
    // domain means "leave it alone", not "no domain".
    const created = await call("create_event", {
      year,
      title: "Retitled event",
      date: today,
      domainSlug: "financial",
    });
    assert.equal(codeOf(created), "", `create_event: ${JSON.stringify(created)}`);
    const before = (await call("get_state")) as {
      state: { events: { id: string; title: string; domainSlug: string | null }[] };
    };
    const event = before.state.events.find((e) => e.title === "Retitled event");
    assert.ok(event, "the event must exist in the granted domain");

    const renamed = await call("update_event", { year, id: event.id, title: "Renamed in place" });
    record("write-update-event-no-domain", codeOf(renamed) || "APPLIED");
    assert.equal(
      codeOf(renamed),
      "",
      `a title-only update_event must apply: ${JSON.stringify(renamed)}`,
    );
    const after = (await call("get_state")) as {
      state: { events: { id: string; title: string; domainSlug: string | null }[] };
    };
    const moved = after.state.events.find((e) => e.id === event.id);
    assert.equal(moved?.title, "Renamed in place", "the title must have changed");
    assert.equal(
      moved?.domainSlug,
      "financial",
      "an update that names no domain leaves the record on its own domain",
    );
    record("write-update-event-no-domain-kept", "FINANCIAL");

    // An explicit null is the other case: a move onto no domain, still refused.
    const unscoped = await call("update_event", { year, id: event.id, domainSlug: null });
    record("write-update-event-explicit-null", codeOf(unscoped));
    assert.deepEqual(unscoped, FORBIDDEN, "an explicit null domain is still a move");

    // The same for a goal: an id-and-name update files a Decision, and the
    // goal is untouched until the operator approves it.
    const proposal = (await call("update_goal", {
      id: f.financialGoal,
      name: "Save much more",
    })) as { decisionId?: string; status?: string };
    record("write-update-goal-no-domain", proposal.decisionId ? "DECISION" : codeOf(proposal));
    assert.ok(
      proposal.decisionId,
      `a name-only update_goal must file a Decision: ${JSON.stringify(proposal)}`,
    );
    const goalsBefore = await loadGoals(f.ctx.root);
    assert.ok(goalsBefore.ok);
    assert.equal(
      goalsBefore.ok
        ? goalsBefore.value.find((g) => g.id === f.financialGoal)?.name
        : null,
      "Save more",
      "the goal must not change until the Decision is approved",
    );

    assert.equal(
      (await resolveDecision(f.ctx.root, proposal.decisionId!, "approved")).ok,
      true,
    );
    const goalsAfter = await loadGoals(f.ctx.root);
    assert.equal(
      goalsAfter.ok ? goalsAfter.value.find((g) => g.id === f.financialGoal)?.name : null,
      "Save much more",
      "approval is what renames the goal",
    );
    assert.equal(
      goalsAfter.ok ? goalsAfter.value.find((g) => g.id === f.financialGoal)?.domainSlug : null,
      "financial",
      "and the domain is unchanged",
    );
    record("write-update-goal-no-domain-approved", "APPROVED");
  });

  it("a script block writes an assigned page and is refused on another domain", async () => {
    const applied = await call("apply_script_block", {
      domainSlug: "financial",
      pageId: f.financialPage,
      name: "Spend count",
      source: "SELECT 1",
    });
    record("write-apply-script-financial", codeOf(applied) || "APPLIED");
    assert.equal(codeOf(applied), "", `apply_script_block financial: ${JSON.stringify(applied)}`);
    const page = await getPage(f.ctx.root, "financial", f.financialPage);
    assert.ok(page.ok);
    assert.equal(
      page.ok ? page.value.blocks.some((b) => b.kind === "script") : false,
      true,
      "an applied script block is on the page",
    );

    const other = await call("apply_script_block", {
      domainSlug: "health",
      pageId: f.healthPage,
      name: "Spend count",
      source: "SELECT 1",
    });
    record("write-apply-script-health", codeOf(other));
    assert.deepEqual(other, FORBIDDEN, "an unassigned page's domain is FORBIDDEN");
    const untouched = await getPage(f.ctx.root, "health", f.healthPage);
    assert.ok(untouched.ok);
    assert.equal(untouched.ok ? untouched.value.blocks.length : -1, 0, "and writes no block");

    const ran = await call("run_script_block", { domainSlug: "health", source: "SELECT 1" });
    record("write-run-script-health", codeOf(ran));
    assert.deepEqual(ran, NOT_FOUND, "the same domain is missing to a script read");
  });

  it("the companion with no grant still files a doctrine Decision", async () => {
    const result = (await executeTool(
      f.ctx.root,
      null,
      "update_document",
      { domainSlug: "financial", kind: "why", body: "Because the agent asked." },
      undefined,
      undefined,
    )) as { decisionId?: string };
    record("write-companion-update-document", result.decisionId ? "DECISION" : codeOf(result));
    assert.ok(result.decisionId, `the companion must still file: ${JSON.stringify(result)}`);
    assert.notEqual(codeOf(result), "FORBIDDEN");
  });
});

// ── the schedule grant ───────────────────────────────────────────────────────

describe("KAR-70 pairing: the schedule grant", () => {
  type Fixture = {
    ctx: Awaited<ReturnType<typeof openDoors>>;
    /** The bearer and headers the fixture introduced the agent with. */
    bearer: string;
    headers: Record<string, string>;
    agentId: string;
    agentName: string;
    /** The roster id as `updateConnectedAgent` and `effectiveGrant` see it. */
    grantFor: (patch: Partial<ConnectedGrant>) => Promise<ConnectedGrant>;
    financialGoal: string;
    seedTask: string;
    /** Monday of the week `get_week` and `get_state` resolve by default. */
    monday: string;
  };

  let doorsHandle: Doors | null = null;

  /**
   * A vault with one financial goal, a task on it dated today, and a live day
   * for today, so "Schedule off empties the pack" is a statement about the
   * projection rather than about an empty vault.
   */
  async function buildFixture(): Promise<Fixture> {
    const ctx = await openDoors("kar70-schedule");
    doorsHandle = ctx.doors;
    const { root } = ctx;

    const goal = await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Save more",
      domainSlug: "financial",
    });
    assert.equal(goal.ok, true, `createGoal: ${JSON.stringify(goal)}`);

    const today = todayLocalIso();
    const created = await applyMapCommand(
      root,
      {
        type: "createTask",
        title: "Seed task",
        links: { goalId: goal.value[0]!.id, date: today },
      },
      "user",
      today,
      USER_ACTOR,
    );
    assert.equal(created.ok, true, `seed task: ${JSON.stringify(created)}`);
    const liveDay = await applyMapCommand(
      root,
      { type: "ensureLiveDay", date: today },
      "user",
      today,
      USER_ACTOR,
    );
    assert.equal(liveDay.ok, true, `seed live day: ${JSON.stringify(liveDay)}`);

    // An event in a domain the agent is never granted. Every connected write
    // returns a filtered map, so this is what proves the filter ran rather than
    // the map simply having no events in it.
    const healthEvent = await applyMapCommand(
      root,
      {
        type: "createEvent",
        year: Number(today.slice(0, 4)),
        title: "Health event",
        date: today,
        domainSlug: "health",
      },
      "user",
      today,
      USER_ACTOR,
    );
    assert.equal(healthEvent.ok, true, `seed health event: ${JSON.stringify(healthEvent)}`);

    const bearer = "schedule-door-bearer-000000001";
    const headers = { ...auth(bearer), "x-lifequest-name": "Schedule bot" };
    assert.equal((await rpc(ctx.localPort, headers, "initialize", INIT_PARAMS)).status, 200);
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
    assert.equal(assigned.value.schedule, false);

    /**
     * The roster as the door computes it for the next call. Reading the row
     * back rather than reusing a local copy is the point: the switch under test
     * is the one the operator set, through the same path the door uses.
     */
    const grantFor = async (patch: Partial<ConnectedGrant>): Promise<ConnectedGrant> => {
      if (Object.keys(patch).length > 0) {
        const updated = await updateConnectedAgent(root, agentId, patch);
        assert.equal(updated.ok, true, `updateConnectedAgent: ${JSON.stringify(updated)}`);
      }
      const listed = (await listConnectedAgents(root)) as {
        value: Record<string, unknown>[];
      };
      const row = listed.value.find((r) => r.id === agentId)!;
      return {
        agentId: String(row.id),
        name: String(row.name),
        access: row.access as "read" | "write",
        domainSlugs: [...(row.domainSlugs as string[])],
        schedule: row.schedule === true,
      };
    };

    return {
      ctx,
      bearer,
      headers,
      agentId,
      agentName: "Schedule bot",
      grantFor,
      financialGoal: goal.value[0]!.id,
      seedTask: "Seed task",
      monday: mondayOnOrBefore(today),
    };
  }

  function codeOf(result: unknown): string {
    const err = (result as { error?: { code?: string } }).error;
    return err?.code ?? "";
  }

  async function call(
    name: string,
    args: Record<string, unknown> = {},
    grant: ConnectedGrant,
  ): Promise<unknown> {
    return executeTool(f.ctx.root, null, name, args, undefined, grant);
  }

  const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Outside this agent's grant" } };

  let f: Fixture;

  before(async () => {
    f = await buildFixture();
  });
  after(async () => {
    await doorsHandle?.close();
  });

  it("Schedule off keeps tasks, the live week, and the day templates away", async () => {
    const grant = await f.grantFor({ access: "read", domainSlugs: ["financial"], schedule: false });
    const year = Number(todayLocalIso().slice(0, 4));
    const before = await walkText(f.ctx.root);

    for (const [name, args] of [
      ["get_week", { year, monday: f.monday }],
      ["create_task", { title: "not yours" }],
      ["create_day_type", { name: "Not yours", color: "teal" }],
      ["set_week_day_items", { year, monday: f.monday, weekday: 0, items: [] }],
    ] as [string, Record<string, unknown>][]) {
      const result = await call(name, args, grant);
      record(`schedule-off-${name}`, codeOf(result));
      assert.deepEqual(result, FORBIDDEN, `${name} must be FORBIDDEN while Schedule is off`);
    }

    const state = (await call("get_state", {}, grant)) as { state: Record<string, unknown> };
    assert.equal("tasks" in state.state, false, "get_state must have no tasks key");
    assert.equal("week" in state.state, false, "get_state must have no week key");

    const pack = (await call(
      "get_period_pack",
      { cadence: "daily", period: todayLocalIso(), scope: "financial" },
      grant,
    )) as { pack: { tasks: unknown[]; liveDays: unknown[] } };
    assert.deepEqual(pack.pack.tasks, [], "Schedule off empties the pack's tasks");
    assert.deepEqual(pack.pack.liveDays, [], "Schedule off empties the pack's live days");

    assert.equal(await walkText(f.ctx.root), before, "a refused call must not write");
    record("schedule-off-vault-unchanged", "UNCHANGED");
  });

  it("Schedule on and read-only reads the week and posts nothing", async () => {
    const grant = await f.grantFor({ access: "read", domainSlugs: ["financial"], schedule: true });
    const year = Number(todayLocalIso().slice(0, 4));

    const week = (await call("get_week", { year, monday: f.monday }, grant)) as {
      week: { monday: string };
    };
    record("schedule-on-get-week", codeOf(week) || "READ");
    assert.equal(codeOf(week), "", `get_week must read: ${JSON.stringify(week)}`);
    assert.equal(week.week.monday, f.monday);

    const state = (await call("get_state", {}, grant)) as {
      state: { tasks?: { title: string }[]; week?: { monday: string } };
    };
    record("schedule-on-get-state", codeOf(state) || "READ");
    assert.ok(Array.isArray(state.state.tasks), "get_state must carry tasks");
    assert.ok(
      state.state.tasks!.some((t) => t.title === f.seedTask),
      "the seeded task must be in the state",
    );
    assert.ok(state.state.week, "get_state must carry the week");
    assert.equal(state.state.week!.monday, f.monday);

    const pack = (await call(
      "get_period_pack",
      { cadence: "daily", period: todayLocalIso(), scope: "financial" },
      grant,
    )) as { pack: { tasks: { title: string }[]; liveDays: { date: string }[] } };
    record("schedule-on-pack", codeOf(pack) || "READ");
    assert.ok(
      pack.pack.tasks.some((t) => t.title === f.seedTask),
      "Schedule on leaves the pack's tasks in place",
    );
    assert.ok(pack.pack.liveDays.length > 0, "and its live days");
    // The overall-only fields stay gone whatever Schedule says.
    assert.equal(pack.pack.previousReview, null);
    assert.deepEqual(pack.pack.domainSections, []);

    const decisionsBefore = await decisionFiles(f.ctx.root);
    for (const [name, args] of [
      ["create_task", { title: "read-only agent task" }],
      ["create_day_type", { name: "Read only day", color: "teal" }],
    ] as [string, Record<string, unknown>][]) {
      const result = await call(name, args, grant);
      record(`schedule-read-refused-${name}`, codeOf(result));
      assert.deepEqual(
        result,
        FORBIDDEN,
        `${name} needs Write as well as Schedule`,
      );
    }
    assert.deepEqual(
      await decisionFiles(f.ctx.root),
      decisionsBefore,
      "a refused write files nothing",
    );
    record("schedule-read-refused-unfiled", "UNFILED");
  });

  it("Write plus Schedule posts a task at once and still files a day template", async () => {
    const grant = await f.grantFor({ access: "write", domainSlugs: ["financial"], schedule: true });
    const year = Number(todayLocalIso().slice(0, 4));
    const monday = f.monday;

    const posted = await call(
      "create_task",
      { title: "Agent task", links: { goalId: f.financialGoal, date: todayLocalIso() } },
      grant,
    );
    record("schedule-write-create-task", codeOf(posted) || "APPLIED");
    assert.equal(codeOf(posted), "", `create_task must apply: ${JSON.stringify(posted)}`);

    // A connected write returns the agent's map, not the vault's. Returning the
    // applied store whole would hand over About me, the day-type catalogue, and
    // every domain's events through the back of a tool whose reads are filtered.
    const postedState = (posted as { state: Record<string, unknown> }).state;
    record("schedule-write-create-task-filtered", "PROJECTED");
    for (const leaked of ["aboutMe", "years", "dayTypes", "defaultWeek", "liveDays"]) {
      assert.equal(
        leaked in postedState,
        false,
        `create_task must not return ${leaked}: ${Object.keys(postedState).join(",")}`,
      );
    }
    assert.deepEqual(
      (postedState.events as { title: string }[]).map((e) => e.title),
      [],
      "an ungranted domain's event must not be in a connected write's state",
    );

    const logged = await readLog(f.ctx.root);
    assert.equal(logged.ok, true);
    const line = logged.ok
      ? logged.value.find(
          (e) => e.type === "map.task.created" && (e.payload as { title?: string })?.title === "Agent task",
        )
      : undefined;
    assert.ok(line, "the posted task must have a life-log line");
    assert.deepEqual(line.actor, { type: "agent", id: f.agentId, name: f.agentName });
    record("schedule-write-create-task-actor", "ROSTER_AGENT");

    // A live-week edit applies at once too, and leaves the week detached so
    // the change survives the next read.
    const dayItems = await call(
      "set_week_day_items",
      { year, monday, weekday: 0, items: [{ id: "i1", text: "Walk" }] },
      grant,
    );
    record("schedule-write-set-week-day-items", codeOf(dayItems) || "APPLIED");
    assert.equal(codeOf(dayItems), "", `set_week_day_items: ${JSON.stringify(dayItems)}`);
    const week = (await call("get_week", { year, monday }, grant)) as {
      week: { days: { text: string }[][] };
    };
    assert.ok(
      week.week.days[0]!.some((i) => i.text === "Walk"),
      "the live-week edit must be in the resolved week",
    );
    record("schedule-write-week-applied", "APPLIED");

    // The day-template tools are on the same switch, and still wait.
    const decisionsBefore = await decisionFiles(f.ctx.root);
    const dayTypesBefore = (await loadMapState(f.ctx.root)).value.dayTypes.map((d) => d.name);
    const proposal = (await call(
      "create_day_type",
      { name: "Agent day type", color: "teal" },
      grant,
    )) as { decisionId?: string; status?: string };
    record("schedule-write-create-day-type", proposal.decisionId ? "DECISION" : codeOf(proposal));
    assert.ok(
      proposal.decisionId,
      `create_day_type must still file a Decision: ${JSON.stringify(proposal)}`,
    );

    const dayTypesAfter = (await loadMapState(f.ctx.root)).value.dayTypes.map((d) => d.name);
    assert.deepEqual(
      dayTypesAfter,
      dayTypesBefore,
      "the day type must not exist until the operator approves",
    );
    assert.equal(
      (await decisionFiles(f.ctx.root)).length,
      decisionsBefore.length + 1,
      "and exactly one Decision was filed",
    );

    assert.equal(
      (await resolveDecision(f.ctx.root, proposal.decisionId!, "approved")).ok,
      true,
    );
    const approved = (await loadMapState(f.ctx.root)).value.dayTypes.map((d) => d.name);
    assert.ok(
      approved.includes("Agent day type"),
      `approval is what creates the day type: ${JSON.stringify(approved)}`,
    );
    record("schedule-write-create-day-type-approved", "APPLIED");
  });

  it("Schedule on with no domains gets the schedule tools and no documents", async () => {
    await f.grantFor({ access: "write", domainSlugs: [], schedule: true });
    const year = Number(todayLocalIso().slice(0, 4));

    const list = await rpc(f.ctx.localPort, f.headers, "tools/list");
    const listed = ((list.body as { result?: { tools?: Record<string, unknown>[] } }).result
      ?.tools ?? []) as Record<string, unknown>[];
    const tools = listed.map((t) => t.name);
    record("schedule-only-tools", tools.includes("get_week") ? "PRESENT" : "ABSENT");
    assert.ok(tools.includes("get_week"), "Schedule alone must hand over get_week");
    assert.ok(tools.includes("create_task"), "and create_task once Write is on");
    assert.ok(tools.includes("create_day_type"), "and the day-template tools");
    // The list has to be something an MCP client can act on: a def carrying
    // `parameters` instead of `inputSchema` is not a tool definition, and the
    // client rejects the whole list rather than the one bad entry.
    assert.ok(
      listed.every((t) => t.inputSchema !== undefined && t.description !== undefined),
      `every listed tool needs inputSchema and description: ${JSON.stringify(listed[0])}`,
    );
    for (const absent of [
      "get_doctrine",
      "list_documents",
      "get_document",
      "list_databases",
      "get_period_pack",
      "create_year",
      "set_about_me",
      // A domain write is not a schedule write. With no domain there is nothing
      // for it to write into, so it is not offered even though Write is on.
      "create_goal",
      "create_event",
      "upsert_row",
      "create_library_document",
      "update_document",
    ]) {
      assert.equal(tools.includes(absent), false, `${absent} must not be offered with no domain`);
    }

    // And a call for one is refused, not merely hidden.
    const decisionsBefore = await decisionFiles(f.ctx.root);
    const vaultBefore = await walkText(f.ctx.root);
    for (const name of ["create_goal", "create_event"]) {
      const result = await rpc(f.ctx.localPort, f.headers, "tools/call", {
        name,
        arguments: { name: "No", title: "No", domainSlug: "financial", year, date: todayLocalIso() },
      });
      const code = toolError(result.body).code;
      record(`schedule-only-refused-${name}`, code);
      assert.equal(code, "FORBIDDEN", `${name} with no domain must be FORBIDDEN`);
    }
    assert.deepEqual(
      await decisionFiles(f.ctx.root),
      decisionsBefore,
      "a refused domain write files nothing",
    );
    assert.equal(await walkText(f.ctx.root), vaultBefore, "and writes nothing");
    record("schedule-only-refused-unfiled", "UNFILED");

    // The door hides those tools, so a call for one is refused rather than
    // answered. Either grant code is right; what must not happen is a document.
    const doctrine = await rpc(f.ctx.localPort, f.headers, "tools/call", {
      name: "get_doctrine",
      arguments: {},
    });
    const code = toolError(doctrine.body).code;
    record("schedule-only-get-doctrine", code);
    assert.ok(
      code === "FORBIDDEN" || code === "NO_GRANT",
      `get_doctrine must be refused, not answered: ${code}`,
    );
    const text = (doctrine.body as { result?: { content?: { text?: string }[] } }).result?.content?.[0]
      ?.text ?? "";
    assert.equal(text.includes("why"), false, "no doctrine document may come back");

    // The schedule read itself still works over the door.
    const week = await rpc(f.ctx.localPort, f.headers, "tools/call", {
      name: "get_week",
      arguments: { year, monday: f.monday },
    });
    const weekText =
      (week.body as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text ?? "{}";
    const weekPayload = JSON.parse(weekText) as {
      week?: { monday: string };
      error?: { code: string };
    };
    record("schedule-only-get-week", weekPayload.error?.code ?? "READ");
    assert.equal(
      weekPayload.error,
      undefined,
      `get_week over the door: ${weekText}`,
    );
    assert.equal(weekPayload.week?.monday, f.monday);

    // NO_GRANT is for the row that reaches nothing at all: no domain, and
    // Schedule off. Both switches off, and the row is inert.
    await f.grantFor({ access: "read", domainSlugs: [], schedule: false });
    const inert = await rpc(f.ctx.localPort, f.headers, "tools/call", {
      name: "get_week",
      arguments: {},
    });
    record("schedule-none-get-week", toolError(inert.body).code);
    assert.equal(toolError(inert.body).code, "NO_GRANT");
    const inertList = await rpc(f.ctx.localPort, f.headers, "tools/list");
    assert.deepEqual(
      (inertList.body as { result?: { tools?: unknown[] } }).result?.tools,
      [],
      "a row with no grant has an empty tool list",
    );
    record("schedule-none-tools", "EMPTY");
  });
});

// ── Task 6: an occupied invite port ───────────────────────────────────────────

describe("KAR-70 pairing: an occupied invite port", () => {
  it("keeps the invite door down and still serves the companion on the local door", async () => {
    const root = await tempDir("kar70-occupied-vault-");
    const created = await createVault(root, "Occupied Invite");
    assert.equal(created.ok, true, `createVault failed: ${JSON.stringify(created)}`);
    const secretsDir = await tempDir("kar70-occupied-secrets-");
    const [localPort, invitePort] = await freePorts(2);

    // Something else already owns the invite port.
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(invitePort, "127.0.0.1", () => resolve());
    });

    const doors = await startPairingDoors({
      root,
      vaultId: "occupied-invite",
      secretsDir,
      localPort,
      invitePort,
    });
    try {
      assert.notEqual(doors.inviteError, null, "the invite door must report its bind failure");
      assert.equal(doors.localError, null, "the local door must still bind");
      record("invite-port-taken-invite-error", doors.inviteError as string);

      // The vault still opened, and the companion still has its door.
      const token = await ensureCompanionToken(secretsDir, "occupied-invite");
      const call = await rpc(localPort, auth(token), "tools/call", { name: "get_state", arguments: {} });
      assert.equal(call.status, 200, "the local door must answer the companion");
      const payload = JSON.parse(
        (call.body as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text ?? "{}",
      ) as { error?: { code?: string } };
      assert.equal(payload.error, undefined, `companion get_state: ${JSON.stringify(payload)}`);
      record("invite-port-taken-local-call", "SERVES_COMPANION");
    } finally {
      await doors.close();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

/** The raw text of a companion get_state over a door. */
async function companionText(port: number, token: string): Promise<string> {
  const res = await rpc(port, auth(token), "tools/call", { name: "get_state", arguments: {} });
  assert.equal(res.status, 200, `companion get_state: ${JSON.stringify(res.body)}`);
  const text =
    (res.body as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text ?? "";
  const parsed = JSON.parse(text) as { error?: { code?: string } };
  assert.equal(parsed.error, undefined, `companion get_state must not be gated: ${text.slice(0, 400)}`);
  return text;
}

// ── Task 6: switching vaults ──────────────────────────────────────────────────

describe("KAR-70 pairing: switching vaults", () => {
  it("rebind moves both doors to the new root, roster, and companion credential", async () => {
    const firstRoot = await tempDir("kar70-rebind-first-");
    assert.equal((await createVault(firstRoot, "First Vault")).ok, true);
    const secondRoot = await tempDir("kar70-rebind-second-");
    assert.equal((await createVault(secondRoot, "Second Vault")).ok, true);
    const secretsDir = await tempDir("kar70-rebind-secrets-");
    const [localPort, invitePort] = await freePorts(2);

    const today = todayLocalIso();
    const year = Number(today.slice(0, 4));
    async function seedEvent(root: string, title: string): Promise<void> {
      const res = await applyMapCommand(
        root,
        { type: "createEvent", year, title, date: today, domainSlug: null },
        "user",
        today,
        USER_ACTOR,
      );
      assert.equal(res.ok, true, `seed ${title}: ${JSON.stringify(res)}`);
    }
    await seedEvent(firstRoot, "First vault marker");
    await seedEvent(secondRoot, "Second vault marker");

    const doors = await startPairingDoors({
      root: firstRoot,
      vaultId: "first-vault",
      secretsDir,
      localPort,
      invitePort,
    });
    try {
      assert.equal(doors.localError, null);
      assert.equal(doors.inviteError, null);

      // A bearer introduced against the first vault, and the first vault's
      // companion token.
      const firstBearer = "rebind-agent-bearer-0123456789";
      const introduced = await rpc(
        localPort,
        { ...auth(firstBearer), "x-lifequest-name": "Rebind Agent" },
        "initialize",
        INIT_PARAMS,
      );
      assert.equal(introduced.status, 200, `first introduction: ${JSON.stringify(introduced.body)}`);
      const firstToken = await ensureCompanionToken(secretsDir, "first-vault");

      const firstText = await companionText(localPort, firstToken);
      assert.ok(
        firstText.includes("First vault marker"),
        `the first vault must serve its own marker: ${firstText.slice(0, 400)}`,
      );
      assert.equal(firstText.includes("Second vault marker"), false);

      // Switch vaults: the open vault is the second one from here on.
      const secondToken = await ensureCompanionToken(secretsDir, "second-vault");
      doors.rebind(secondRoot, "second-vault");

      // The first vault's bearer is a stranger to the second roster.
      const after = await rpc(
        localPort,
        { ...auth(firstBearer), "x-lifequest-name": "Rebind Agent" },
        "tools/call",
        { name: "get_state", arguments: {} },
      );
      const afterCode = toolError(after.body).code;
      record("rebind-first-bearer", afterCode);
      assert.ok(
        afterCode === "AUTH_REQUIRED" || afterCode === "PAIRING_PENDING",
        `the first vault's bearer must not be served by the second: ${afterCode}`,
      );

      // And the second vault's roster is the one that grew.
      const secondRoster = await listConnectedAgents(secondRoot);
      assert.equal(secondRoster.ok, true);
      assert.equal(
        (secondRoster.ok ? secondRoster.value : []).some((a) => a.name === "Rebind Agent"),
        true,
        "the introduction after the rebind belongs to the second vault's roster",
      );
      const firstRoster = await listConnectedAgents(firstRoot);
      assert.equal(
        (firstRoster.ok ? firstRoster.value : []).length,
        1,
        "the first vault's own roster is untouched",
      );

      // The second vault's companion credential works, and reads the second
      // vault.
      const secondText = await companionText(localPort, secondToken);
      record("rebind-second-companion-read", "READ");
      assert.ok(
        secondText.includes("Second vault marker"),
        `get_state must read the second vault: ${secondText.slice(0, 400)}`,
      );
      assert.equal(
        secondText.includes("First vault marker"),
        false,
        "the first vault's records must be gone from the state",
      );

      // The first vault's companion token is no longer the companion.
      const stale = await rpc(localPort, auth(firstToken), "tools/call", { name: "get_state", arguments: {} });
      assert.equal(stale.status, 401, `a stale companion token must not be served: ${JSON.stringify(stale.body)}`);
      record("rebind-stale-companion", errorOf(stale.body).code);
    } finally {
      await doors.close();
    }
  });
});

// ── Task 6: the companion profile header ─────────────────────────────────────

describe("KAR-70 pairing: the lifequest profile header", () => {
  it("ensureMcpServer sets the companion Authorization and keeps every other MCP server", () => {
    const existing = [
      "mcp_servers:",
      "  other:",
      "    url: http://127.0.0.1:9999/mcp",
      "",
    ].join("\n");
    const token = "companion-token-value-0123456789";
    const next = ensureMcpServer(existing, "lifequest", MCP_URL, {
      Authorization: `Bearer ${token}`,
    });
    record("profile-other-server-kept", "KEPT");
    assert.match(next, /other:/);
    assert.match(next, /127\.0\.0\.1:9999\/mcp/, "another MCP server must survive");

    record("profile-companion-header", "WRITTEN");
    assert.match(next, /lifequest:/);
    assert.match(next, /url: http:\/\/127\.0\.0\.1:8643\/mcp/);
    assert.ok(
      next.includes(`Authorization: Bearer ${token}`),
      `the companion Authorization header must be written: ${next}`,
    );

    // A later ensure refreshes the header and does not duplicate the entry.
    const refreshed = ensureMcpServer(next, "lifequest", MCP_URL, {
      Authorization: "Bearer second-token-9876543210",
    });
    assert.equal((refreshed.match(/lifequest:/g) ?? []).length, 1);
    assert.ok(refreshed.includes("Authorization: Bearer second-token-9876543210"));
    assert.match(refreshed, /other:/);
    assert.equal(
      refreshed.includes(token),
      false,
      "the old companion token must not linger in the profile",
    );
  });
});

// ── Task 6: the UI ────────────────────────────────────────────────────────────

describe("KAR-70 pairing: the wiring surfaces", () => {
  it("Personnel lists the companion, then the connected agents, with no approve control", () => {
    const source = readSource("src/components/personnel/PersonnelStudio.tsx");
    record("personnel-companion-section", "COMPANION");
    assert.match(source, />\s*Companion\s*</, "Personnel needs a Companion heading");
    assert.ok(source.includes("Full access"), "the Companion card reads Full access");
    assert.ok(source.includes("Hermes"), "the Companion card names Hermes");

    record("personnel-connected-section", "CONNECTED");
    assert.match(source, />\s*Connected agents\s*</, "Personnel needs a Connected agents heading");
    assert.ok(
      source.includes("Waiting for approval"),
      "a pending connected agent reads Waiting for approval",
    );
    assert.ok(source.includes("Revoke"), "an active row needs a Revoke button");
    assert.ok(source.includes("Schedule"), "an active row needs a Schedule switch");
    assert.ok(source.includes("Write"), "an active row needs a Write switch");

    record("personnel-no-approve-control", "NO_APPROVE");
    assert.doesNotMatch(
      source,
      /\bApprove\b/,
      "the pairing Decision is approved in Decisions, not on the Personnel row",
    );
    assert.match(source, />\s*Scan\s*</, "the hire scan heading stays");
  });

  it("Settings shows the local door and the invite door", () => {
    const source = readSource("src/components/settings/SettingsHermes.tsx");
    record("settings-both-doors", "BOTH");
    assert.ok(source.includes("8643/mcp"), "Settings must name the local door");
    assert.ok(source.includes("8646/mcp"), "Settings must name the invite door");
    assert.match(source, /mcpGetDoors|mcp:getDoors/);
  });

  it("Decisions label a pairing Decision as Agent pairing", () => {
    const source = readSource("src/components/decisions/DecisionsInbox.tsx");
    record("decision-agent-pairing-label", "Agent pairing");
    assert.match(
      source,
      /case\s+["']agent-pairing["']:\s*return\s+["']Agent pairing["']/,
      "kindLabel must handle agent-pairing",
    );

    const body = readSource("src/components/decisions/DecisionBody.tsx");
    assert.match(body, /agent-pairing/, "DecisionBody must render the pairing body");
    assert.match(body, /proposedBodyMarkdown|fingerprint/, "DecisionBody shows the fingerprint and door");
  });
});


// ── Fix pass: the companion header survives a cold start and follows the vault

describe("KAR-70 pairing: the companion header across a vault switch", () => {
  it("an ensure with no token leaves an existing header alone, and a token replaces it", () => {
    const first = ensureMcpServer(
      ["mcp_servers:", "  lifequest:", "    url: http://127.0.0.1:1/mcp", ""].join("\n"),
      "lifequest",
      MCP_URL,
      { Authorization: "Bearer vault-one-token-0123456789" },
    );
    assert.ok(first.includes("Authorization: Bearer vault-one-token-0123456789"));

    // The cold-start path: CompanionProvider calls companionEnsure before any
    // vault is open, so there is no token to write. That must not strip the
    // header the companion depends on.
    const cold = ensureMcpServer(first, "lifequest", MCP_URL);
    record("header-cold-start-preserved", cold.includes("vault-one-token-0123456789") ? "KEPT" : "STRIPPED");
    assert.ok(
      cold.includes("Authorization: Bearer vault-one-token-0123456789"),
      `a cold ensure must not strip the companion header: ${cold}`,
    );
    assert.equal(
      (cold.match(/url: http:\/\/127\.0\.0\.1:8643\/mcp/g) ?? []).length,
      1,
      `a cold ensure must not duplicate the url: ${cold}`,
    );

    // Switching vaults refreshes the header to the credential the rebound doors
    // accept, and drops the old token.
    const switched = ensureMcpServer(cold, "lifequest", MCP_URL, {
      Authorization: "Bearer vault-two-token-9876543210",
    });
    record("header-vault-switch", "REFRESHED");
    assert.ok(switched.includes("Authorization: Bearer vault-two-token-9876543210"));
    assert.equal(switched.includes("vault-one-token-0123456789"), false, switched);
    assert.equal((switched.match(/url: http:\/\/127\.0\.0\.1:8643/g) ?? []).length, 1);
  });

  it("merges one header key without touching the others on the entry", () => {
    const yaml = [
      "mcp_servers:",
      "  lifequest:",
      "    url: http://127.0.0.1:1/mcp",
      "    timeout: 30",
      "    headers:",
      "      Authorization: Bearer old-token",
      "      X-Trace: keep-me",
      "",
    ].join("\n");
    const next = ensureMcpServer(yaml, "lifequest", MCP_URL, {
      Authorization: "Bearer new-token",
    });
    record("header-other-keys-kept", next.includes("keep-me") ? "KEPT" : "LOST");
    assert.ok(next.includes("Authorization: Bearer new-token"), next);
    assert.ok(next.includes("X-Trace: keep-me"), `a sibling header must survive: ${next}`);
    assert.ok(next.includes("timeout: 30"), `another key on the entry must survive: ${next}`);
  });
});

// ── Fix pass: unused invites are a list, and a refusal is a refusal

describe("KAR-70 pairing: unused invites", () => {
  it("lists { id, expiresAt } with no code, drops by id, and refuses a spent code", async () => {
    const root = await tempDir("kar70-invites-vault-");
    assert.equal((await createVault(root, "Invites")).ok, true);
    const secretsDir = await tempDir("kar70-invites-secrets-");
    const vaultId = "invites-e2e";

    const one = await mintInvite(secretsDir, vaultId);
    assert.equal(one.ok, true, `mint one: ${JSON.stringify(one)}`);
    const two = await mintInvite(secretsDir, vaultId);
    assert.equal(two.ok, true, `mint two: ${JSON.stringify(two)}`);

    const listed = await listUnusedInvites(secretsDir, vaultId);
    record("invite-list", `${listed.length}`);
    assert.equal(listed.length, 2, `both mints are unused: ${JSON.stringify(listed)}`);
    for (const row of listed) {
      assert.deepEqual(Object.keys(row).sort(), ["expiresAt", "id"], "no code in the list");
      assert.equal(Date.parse(row.expiresAt) > Date.now(), true, "an unused invite has not expired");
    }

    // Spending one code must remove it from the list, and only that one.
    const spent = await takeInvite(secretsDir, vaultId, one.ok ? one.value.code : "");
    record("invite-take-once", spent ? "SPENT" : "REFUSED");
    assert.equal(spent, true, "an unused code is spendable once");
    assert.equal(
      await takeInvite(secretsDir, vaultId, one.ok ? one.value.code : ""),
      false,
      "a spent code cannot be taken again",
    );
    const afterSpend = await listUnusedInvites(secretsDir, vaultId);
    record("invite-list-after-spend", `${afterSpend.length}`);
    assert.equal(afterSpend.length, 1, `the spent code leaves the list: ${JSON.stringify(afterSpend)}`);

    // Dropping the remaining one works; dropping it again is refused.
    const id = afterSpend[0]!.id;
    const firstDrop = await dropInvite(secretsDir, vaultId, id);
    assert.equal(firstDrop.ok && firstDrop.value, true, `first drop: ${JSON.stringify(firstDrop)}`);
    const dropped = await dropInvite(secretsDir, vaultId, id);
    record("invite-drop-twice", dropped.ok && dropped.value ? "OK" : "REFUSED");
    assert.equal(
      dropped.ok && dropped.value,
      false,
      `a second drop must be refused: ${JSON.stringify(dropped)}`,
    );
    assert.deepEqual(await listUnusedInvites(secretsDir, vaultId), []);

    // ...and the IPC layer turns that refusal into an error rather than
    // reporting a drop that did not happen.
    const service = readSource("electron/vault-service.ts");
    assert.match(
      service,
      /if \(!res\.value\)[\s\S]{0,200}ok: false/,
      "connectedAgentsDropInvite must refuse when dropInvite returns false",
    );
  });
});

// ── Fix pass: a pairing Decision is not hidden by a domain lens

describe("KAR-70 pairing: the pairing Decision under a lens", () => {
  it("keeps an agent-pairing Decision visible whatever the lens filter says", () => {
    const source = readSource("src/components/decisions/DecisionsInbox.tsx");
    record("inbox-pairing-lens-exempt", "KEEP");
    assert.match(
      source,
      /d\.target\.type === ["']agent-pairing["']\s*\|\|/,
      "the inbox filter must exempt a pairing Decision from the lens",
    );
    // It must still be a real filter for everything else.
    assert.match(source, /recordVisibleMulti\(lens, d\.domainSlugs\)/);
  });
});

// ── Fix pass: the companion's lens at the production call site

describe("KAR-70 pairing: the companion's lens", () => {
  it("passes the live lens for a companion call and null for a granted agent", () => {
    const door = readSource("electron/pairing-door.ts");
    record("door-companion-lens", "IN_MEMORY");
    assert.match(
      door,
      /grant \? null : ctx\.lens\(\)/,
      "a companion call must carry the desktop lens; only a granted agent gets null",
    );
    assert.equal(door.includes("getActiveDomain"), false, "the door must not read the persisted lens");

    const service = readSource("electron/vault-service.ts");
    assert.match(
      service,
      /\(\) => currentLens/,
      "vault-service must hand the doors the in-memory lens",
    );

    const server = readSource("electron/mcp-server.ts");
    assert.match(server, /lens: \(\) => currentLens\(\)/);
  });

  it("a granted agent's lens is its grant, and a companion read follows the desktop lens", async () => {
    const ctx = await openDoors("kar70-companion-lens");
    try {
      const token = await ensureCompanionToken(ctx.secretsDir, ctx.vaultId);
      // The companion, with the overview lens, falls through to the first live
      // domain rather than resolving the one the desktop is looking at.
      const overview = (await executeTool(ctx.root, null, "get_doctrine", {})) as {
        slug?: string;
        domains?: { slug: string }[];
      };
      record("lens-null-is-not-a-lens", overview.slug ?? "DOMAINS");
      assert.equal(
        overview.slug !== "health",
        true,
        `a null lens does not resolve the desktop domain: ${JSON.stringify(overview)}`,
      );

      // An active agent assigned to one domain sees only that one, whatever the
      // lens is: the grant is the lens.
      const bearer = "companion-lens-agent-bearer-01";
      const intro = await rpc(
        ctx.localPort,
        { ...auth(bearer), "x-lifequest-name": "Lens Agent" },
        "initialize",
        INIT_PARAMS,
      );
      assert.equal(intro.status, 200, JSON.stringify(intro.body));
      const roster = await listConnectedAgents(ctx.root);
      assert.equal(roster.ok, true);
      const row = (roster.ok ? roster.value : []).find((a) => a.name === "Lens Agent");
      assert.ok(row, "the introduction filed a roster row");
      assert.equal((await markConnectedAgent(ctx.root, row.id, "active")).ok, true);
      await updateConnectedAgent(ctx.root, row.id, {
        access: "read",
        domainSlugs: ["financial"],
        schedule: false,
      });
      const scoped = (await executeTool(
        ctx.root,
        null,
        "get_doctrine",
        {},
        undefined,
        {
          agentId: row.id,
          name: row.name,
          access: "read",
          domainSlugs: ["financial"],
          schedule: false,
        },
      )) as { domains?: { slug: string }[] };
      const slugs = (scoped.domains ?? []).map((d) => d.slug);
      record("grant-lens-overrides-desktop", "GRANT");
      assert.deepEqual(slugs, ["financial"], "a granted agent reads only its own domains");
    } finally {
      await ctx.doors.close();
    }
  });
});

// ── Fix pass: an archived domain already on the row can stay there

describe("KAR-70 pairing: a grant edit after an archive", () => {
  it("keeps an archived assigned slug but still refuses a newly added archived one", async () => {
    const ctx = await openDoors("kar70-archive-grant");
    try {
      const bearer = "archive-grant-agent-bearer-01";
      const intro = await rpc(
        ctx.localPort,
        { ...auth(bearer), "x-lifequest-name": "Archive Agent" },
        "initialize",
        INIT_PARAMS,
      );
      assert.equal(intro.status, 200, JSON.stringify(intro.body));
      const roster = await listConnectedAgents(ctx.root);
      const row = (roster.ok ? roster.value : []).find((a) => a.name === "Archive Agent");
      assert.ok(row, "the introduction filed a roster row");

      // Approval is the pairing Decision's job, and only an active row has a
      // grant to edit.
      let pairing: Record<string, unknown> | null = null;
      for (const file of await decisionFiles(ctx.root)) {
        const candidate = await readJson(path.join(ctx.root, ".lifequest", "decisions", file));
        if ((candidate.target as { type?: string }).type === "agent-pairing") {
          pairing = candidate;
          break;
        }
      }
      assert.ok(pairing, "the introduction filed a pairing Decision");
      assert.equal(
        (await resolveDecision(ctx.root, pairing.id as string, "approved")).ok,
        true,
      );
      const assigned = await updateConnectedAgent(ctx.root, row.id, {
        access: "read",
        domainSlugs: ["financial", "health"],
        schedule: false,
      });
      assert.equal(assigned.ok, true, JSON.stringify(assigned));

      assert.equal((await archiveDomain(ctx.root, "health")).ok, true, "archive health");

      // A grant edit resubmits the whole array, archived slug included. Keeping
      // it must work, or the row becomes uneditable exactly when the operator
      // most needs to change it.
      const kept = await updateConnectedAgent(ctx.root, row.id, {
        domainSlugs: ["financial", "health"],
      });
      record("grant-keep-archived", kept.ok ? "ACCEPTED" : "REFUSED");
      assert.equal(
        kept.ok,
        true,
        `keeping an archived slug already on the row must work: ${JSON.stringify(kept)}`,
      );

      // Narrowing it away is the common edit, and it must not be refused for
      // the archived slug it no longer lists.
      const narrowed = await updateConnectedAgent(ctx.root, row.id, {
        domainSlugs: ["financial"],
      });
      record("grant-narrow-after-archive", narrowed.ok ? "ACCEPTED" : "REFUSED");
      assert.equal(
        narrowed.ok,
        true,
        `narrowing a grant that carried an archived slug must work: ${JSON.stringify(narrowed)}`,
      );
      assert.deepEqual(narrowed.ok ? narrowed.value.domainSlugs : null, ["financial"]);

      // A newly added archived or unknown slug is still refused: health is off
      // the row now, so adding it back is a new assignment.
      const readded = await updateConnectedAgent(ctx.root, row.id, {
        domainSlugs: ["financial", "health"],
      });
      record("grant-add-archived", readded.ok ? "ACCEPTED" : "REFUSED");
      assert.equal(
        readded.ok,
        false,
        "adding an archived slug that is not on the row must be refused",
      );

      const unknown = await updateConnectedAgent(ctx.root, row.id, {
        domainSlugs: ["financial", "does-not-exist"],
      });
      record("grant-add-unknown", unknown.ok ? "ACCEPTED" : "REFUSED");
      assert.equal(unknown.ok, false, "an unknown slug must still be refused");

      const effective = await effectiveGrant(ctx.root, {
        ...row,
        status: "active",
        domainSlugs: ["financial", "health"],
      });
      record("grant-effective-drops-archived", effective.domainSlugs.join(","));
      assert.deepEqual(
        effective.domainSlugs,
        ["financial"],
        "the archived domain drops out of the effective grant",
      );
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

  it("pairing-e2e.json exists in the vault and names every scenario of the spec", async () => {
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
        "grant-get-review-no-file",
        "grant-review-refused-write_review",
        "grant-review-refused-mark_review_done",
        "grant-mark-review-done",
        "grant-mark-review-done-scopes",
        "grant-mark-review-done-matches-read",
        "grant-review-refused-unlock_review",
        "grant-list-databases-health",
        "grant-list-databases-financial",
        "grant-get-document-missing",
        "write-read-refused-upsert_row",
        "write-read-refused-create_library_document",
        "write-read-refused-create_goal",
        "write-read-refused-create_event",
        "write-read-refused-create_project",
        "write-read-refused-capture_transaction",
        "write-read-refused-apply_script_block",
        "write-read-refused-unchanged",
        "write-capture",
        "write-correct-capture",
        "write-undo-capture",
        "write-capture-no-financial-capture_transaction",
        "write-capture-no-financial-undo_capture",
        "write-capture-no-financial-correct_capture",
        "write-capture-actor",
        "write-upsert-row",
        "write-upsert-row-approved",
        "write-delete-row",
        "write-create-database",
        "write-add-column",
        "write-database-decisions-unapplied",
        "write-create-goal",
        "write-create-project",
        "write-forbidden-create_goal-null",
        "write-forbidden-create_goal-health",
        "write-forbidden-goal-unfiled",
        "write-create-event",
        "write-create-event-unscoped",
        "write-update-event-move-out",
        "write-update-event-unchanged",
        "write-apply-script-financial",
        "write-apply-script-health",
        "write-run-script-health",
        "write-companion-update-document",
        "write-update-event-no-domain",
        "write-update-event-no-domain-kept",
        "write-update-event-explicit-null",
        "write-update-goal-no-domain",
        "write-update-goal-no-domain-approved",
        "schedule-off-get_week",
        "schedule-off-create_task",
        "schedule-off-create_day_type",
        "schedule-off-set_week_day_items",
        "schedule-off-vault-unchanged",
        "schedule-on-get-week",
        "schedule-on-get-state",
        "schedule-on-pack",
        "schedule-read-refused-create_task",
        "schedule-read-refused-create_day_type",
        "schedule-read-refused-unfiled",
        "schedule-write-create-task",
        "schedule-write-create-task-actor",
        "schedule-write-set-week-day-items",
        "schedule-write-week-applied",
        "schedule-write-create-day-type",
        "schedule-write-create-day-type-approved",
        "schedule-only-tools",
        "schedule-only-get-doctrine",
        "schedule-only-get-week",
        "schedule-only-refused-create_goal",
        "schedule-only-refused-create_event",
        "schedule-only-refused-unfiled",
        "schedule-none-get-week",
        "schedule-none-tools",
        "schedule-write-create-task-filtered",
        "invite-port-taken-invite-error",
        "invite-port-taken-local-call",
        "rebind-first-bearer",
        "rebind-second-companion-read",
        "rebind-stale-companion",
        "profile-other-server-kept",
        "profile-companion-header",
        "personnel-companion-section",
        "personnel-connected-section",
        "personnel-no-approve-control",
        "settings-both-doors",
        "decision-agent-pairing-label",
        "header-cold-start-preserved",
        "header-vault-switch",
        "header-other-keys-kept",
        "invite-list",
        "invite-list-after-spend",
        "invite-drop-twice",
        "inbox-pairing-lens-exempt",
        "door-companion-lens",
        "grant-lens-overrides-desktop",
        "grant-narrow-after-archive",
        "grant-keep-archived",
        "grant-add-unknown",
        "grant-effective-drops-archived",
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