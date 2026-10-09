import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ALL_TOOL_DEFS,
  createVault,
  effectiveGrant,
  listConnectedAgents,
  listDecisions,
  markConnectedAgent,
  resolveDecision,
  toolAllowed,
  updateConnectedAgent,
  type ConnectedAgent,
  type ConnectedGrant,
} from "@lifequest/vault-core";
import { PENDING_PAIRING_CAP, startPairingDoors } from "../electron/pairing-door.ts";
import {
  ensureCompanionToken,
  listUnusedInvites,
  mintInvite,
} from "../electron/pairing-secrets.ts";

/**
 * The MCP agent pairing and permission gate, end to end, over real HTTP on both
 * doors, against a real vault and a real secrets dir on disk.
 *
 * This file replaces the proof that `d4ecbeb` ("keep only the e2e rigs") deleted
 * with `tests/mcp-agent-pairing.test.ts`. It keeps that proof's shape — one run
 * drives both doors, then reads the vault and the life log — and its artifact,
 * `e2e/artifacts/pairing-e2e.json`.
 *
 * WHY A TEST AT ALL, AND WHAT IT IS ALLOWED TO PROVE
 *
 * The door is not a page, so this is not a harness-page rig: the thing under
 * test IS the HTTP listener, and the only honest way to ask it what an agent may
 * do is to be an agent and ask. Every assertion below is an HTTP request or a
 * read of what that request left on disk. The door is booted on test ports
 * (`18_643` / `18_646`) so a running LifeQuest — which holds the real 8643 and
 * 8646 — is neither disturbed nor consulted.
 *
 * The seam this rig cannot cross: it calls the door, the door calls
 * `executeTool`, and `executeTool` is the real one. There is no stub anywhere.
 * The other half of the same feature is the *operator's* side — the Personnel
 * panel and the Settings URLs — and that half belongs to the Electron rigs.
 *
 * THE WAYS THIS LADDER COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 * The point of the run below is to make each of these impossible to do quietly.
 * Every one of them has a step that fails if it happens.
 *
 *   1. A caller with no bearer, or a stub bearer, reaches tools.
 *   2. A new bearer that sends no name opens a Decision anyway — a stranger
 *      parks rows it cannot be held to.
 *   3. The companion bearer is treated as a stranger: it files a Decision,
 *      gets an empty tool list, or is filtered as if it had a grant. The
 *      companion is pre-paired and must never need approval.
 *   4. Approval alone grants something. Approving must leave the row read-only,
 *      domainless, Schedule off — and therefore `NO_GRANT`.
 *   5. A refused caller is told a tool does not exist (protocol `NOT_FOUND`)
 *      instead of that it may not call it (`FORBIDDEN`). The two mean different
 *      things to an agent, and only one of them is true.
 *   6. `tools/list` advertises a tool the grant refuses, so an agent plans
 *      around a call that can only fail.
 *   7. A grant reads outside its domains, or a read of one out-of-grant record
 *      reports `FORBIDDEN` where a missing record reports `NOT_FOUND`. The
 *      spec makes those the same answer so the door cannot be used to probe
 *      what exists.
 *   8. Write without `access: write` lands. Read must not be able to write,
 *      whatever domains it holds.
 *   9. Revoked and rejected keys re-pair. A revocation that a reconnect undoes
 *      is not a revocation, and the hash must stay so the key cannot come back.
 *  10. An invite code survives its first use, works with a bad or missing code,
 *      or is spent by an introduction that never happened (no name).
 *  11. The pending cap is unbounded: strangers can fill the Decisions card.
 *  12. Rebinding a door to a new vault leaves the old vault's companion token
 *      working, or locks out the new one.
 *  13. The connected agent's actor is written as anything but its own roster
 *      row — or the agent gets to choose the actor.
 *  14. A raw bearer or a raw invite code reaches the vault tree. Only hashes
 *      belong there; the door is the only holder of the secret.
 *
 * Runs under `npm test` (`node --experimental-strip-types --test`), which needs
 * no Electron: `pairing-door.ts` imports no Electron module, and the tool body
 * it reaches is loaded on demand.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/pairing-e2e.json");

/** Test ports. The live app owns 8643 and 8646; this run must not touch them. */
const LOCAL_PORT = 18_643;
const INVITE_PORT = 18_646;

type Auth = { bearer?: string; name?: string; invite?: string };
type Reply = { status: number; json: unknown; raw: string };

/**
 * One JSON-RPC call to one door. `Accept` asks for both shapes the Streamable
 * HTTP transport may answer with; the door's own refusals are plain JSON while a
 * served MCP call comes back as one `data:` frame.
 */
async function mcp(port: number, auth: Auth, method: string, params: unknown = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (auth.bearer !== undefined) headers.authorization = `Bearer ${auth.bearer}`;
  if (auth.name !== undefined) headers["x-lifequest-name"] = auth.name;
  if (auth.invite !== undefined) headers["x-lifequest-invite"] = auth.invite;

  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await res.text();
  const frame = raw.split("\n").find((line) => line.startsWith("data: "));
  let json: unknown;
  try {
    json = JSON.parse(frame ? frame.slice(6) : raw);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, raw };
}

/** The names a door advertises to this caller. */
async function toolsList(port: number, auth: Auth): Promise<string[]> {
  const reply = await mcp(port, auth, "tools/list");
  const tools = (reply.json as { result?: { tools?: { name: string }[] } } | undefined)?.result?.tools;
  return (tools ?? []).map((t) => t.name);
}

/** One tool call, with the tool's own JSON answer unwrapped. */
async function callTool(
  port: number,
  auth: Auth,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ status: number; value: unknown }> {
  const reply = await mcp(port, auth, "tools/call", { name, arguments: args });
  const text = (
    reply.json as { result?: { content?: { text?: string }[] } } | undefined
  )?.result?.content?.[0]?.text;
  let value: unknown;
  try {
    value = text === undefined ? undefined : JSON.parse(text);
  } catch {
    value = text;
  }
  return { status: reply.status, value };
}

function errorCode(value: unknown): string | null {
  return (value as { error?: { code?: string } } | undefined)?.error?.code ?? null;
}

/** Every file under `root`, keyed by relative path, as a content digest. */
function treeDigest(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full)] = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

/** Which files in the vault tree contain one of the raw secrets. Must be none. */
function secretsInTree(root: string, secrets: string[]): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const bytes = fs.readFileSync(full);
      for (const secret of secrets) {
        if (bytes.includes(secret)) hits.push(`${path.relative(root, full)} contains a raw secret`);
      }
    }
  };
  walk(root);
  return hits;
}

/** A body that cannot collide with a real one, for a caller nobody paired. */
const bearerFor = (label: string): string =>
  `rig-${label}-${"b".repeat(11)}-${label.length}`.padEnd(40, "x");

describe("MCP agent pairing and permission gate e2e", () => {
  it("walks both doors from first contact to revoke, and leaves the vault clean", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-pairing-"));
    const vaultRoot = path.join(workDir, "vault");
    const secretsDir = path.join(workDir, "userData", "pairing-secrets");
    fs.mkdirSync(secretsDir, { recursive: true });

    const checks: Record<string, unknown> = {};
    const transcript: Array<Record<string, unknown>> = [];
    const secrets: string[] = [];

    const created = await createVault(vaultRoot, "E2E");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
    const vaultId = (created as { ok: true; value: { lifequest: { id: string } } }).value.lifequest.id;

    const doors = await startPairingDoors({ root: vaultRoot, vaultId, secretsDir, localPort: LOCAL_PORT, invitePort: INVITE_PORT });
    try {
      checks.bothDoorsBound = doors.localError === null && doors.inviteError === null;
      assert.equal(doors.localError, null, `the local door did not bind: ${doors.localError}`);
      assert.equal(doors.inviteError, null, `the invite door did not bind: ${doors.inviteError}`);
      // The door's own record of the host reaching it. `companionSeenAt` staying
      // null while the door serves is how the app knows a running Hermes host
      // parked on a door that was not listening yet — and has to be made to
      // re-read its config, because its sessions have no lifequest tools.
      checks.doorsStateAtBind = doors.doorsState();
      assert.equal(doors.doorsState().companionSeenAt, null, "the door claimed the companion had used it before serving anything");
      assert.ok(doors.doorsState().boundAt > 0, "the door recorded no bind time");

      // ── reads over the vault, used by most assertions below ────────────────
      const roster = async (): Promise<ConnectedAgent[]> =>
        ((await listConnectedAgents(vaultRoot)) as unknown as { ok: boolean; value: ConnectedAgent[] }).value;
      const pendingIds = async (): Promise<string[]> =>
        ((await listDecisions(vaultRoot)) as unknown as { value: { id: string; status: string }[] }).value
          .filter((d) => d.status === "pending")
          .map((d) => d.id);
      const rowFor = async (name: string): Promise<ConnectedAgent | undefined> =>
        (await roster()).find((a) => a.name === name);
      const grantOf = async (agent: ConnectedAgent): Promise<ConnectedGrant> =>
        (await effectiveGrant(vaultRoot, agent)) as unknown as ConnectedGrant;
      /** What the vault's own verdicts say this grant may call. The door's
       *  `tools/list` has to agree with it, or one of the two is lying. */
      const allowedByGrant = (grant: ConnectedGrant): string[] =>
        ALL_TOOL_DEFS.filter((t) => toolAllowed(t.name, grant) === "allow").map((t) => t.name).sort();
      /** What the door actually advertises, in the same sort, so the two are
       *  comparable: the door's order is ALL_TOOL_DEFS order, not alphabetical. */
      const advertised = async (auth: Auth): Promise<string[]> =>
        (await toolsList(LOCAL_PORT, auth)).slice().sort();

      transcript.push({ step: "doors bound", local: doors.localPort, invite: doors.invitePort });

      // ── 1. an empty or stub bearer reaches nothing ─────────────────────────
      const beforeNothing = treeDigest(vaultRoot);
      const noBearer = await mcp(LOCAL_PORT, {}, "tools/list");
      checks.noBearer = { status: noBearer.status, code: errorCode(noBearer.json) };
      assert.equal(noBearer.status, 401, "a door answered a caller with no bearer");
      assert.equal(errorCode(noBearer.json), "AUTH_REQUIRED");
      const stub = await mcp(LOCAL_PORT, { bearer: "short" }, "tools/list");
      assert.equal(stub.status, 401, "a bearer under 22 characters was accepted");
      assert.equal(errorCode(stub.json), "AUTH_REQUIRED");
      assert.deepEqual(treeDigest(vaultRoot), beforeNothing, "an unauthenticated call wrote to the vault");

      // Other methods and paths are not the door.
      const wrongMethod = await fetch(`http://127.0.0.1:${LOCAL_PORT}/mcp`, { method: "GET" });
      const wrongPath = await fetch(`http://127.0.0.1:${LOCAL_PORT}/`, { method: "POST" });
      checks.notTheDoor = { get: wrongMethod.status, elsewhere: wrongPath.status };
      assert.equal(wrongMethod.status, 404, "the door answered GET");
      assert.equal(wrongPath.status, 404, "the door answered a path that is not /mcp");

      // ── 2. the companion is pre-paired, on both doors ──────────────────────
      const companion = await ensureCompanionToken(secretsDir, vaultId);
      assert.equal(await ensureCompanionToken(secretsDir, vaultId), companion, "the companion token was rotated under the running app");
      secrets.push(companion);

      for (const [label, port] of [["local", LOCAL_PORT], ["invite", INVITE_PORT]] as const) {
        const names = await toolsList(port, { bearer: companion });
        checks[`companionTools_${label}`] = names.length;
        assert.equal(names.length, ALL_TOOL_DEFS.length, `the companion saw ${names.length} tools on the ${label} door`);
        assert.ok(names.includes("get_state"), `the companion's list on the ${label} door has no get_state`);
      }
      const companionState = await callTool(LOCAL_PORT, { bearer: companion }, "get_state");
      checks.companionGetState = Object.keys((companionState.value as { state?: object }).state ?? {}).sort();
      assert.ok(
        (companionState.value as { state?: { years?: unknown[] } }).state?.years,
        "the companion's get_state was scoped like an agent's",
      );
      assert.deepEqual(await roster(), [], "the companion's own calls created a roster row");
      assert.deepEqual(await pendingIds(), [], "the companion's own calls filed a pairing Decision");
      const companionSeenAt = doors.doorsState().companionSeenAt;
      checks.companionSeenAt = companionSeenAt;
      assert.ok(typeof companionSeenAt === "number", "the door did not record the companion reaching it");

      // ── 2b. a near-miss companion credential is a mistake, not an agent ───
      // The 2026-10-08 incident in one scenario: an agent copied the token out
      // of a listing that masks the middle, hand-rolled the handshake, and
      // paired itself as a new agent named after the active domain. That row
      // then sat in Personnel with no grant, answering NO_GRANT to everything.
      // A truncated or padded companion credential must fail auth and file
      // nothing at all.
      for (const [label, nearMiss] of [
        ["truncated", companion.slice(0, 24)],
        ["padded", `${companion}xyz`],
      ] as const) {
        const answer = await mcp(LOCAL_PORT, { bearer: nearMiss, name: "financial" }, "tools/call", {
          name: "get_state",
          arguments: {},
        });
        checks[`companionNearMiss_${label}`] = { status: answer.status, code: errorCode(answer.json) };
        assert.equal(answer.status, 401, `a ${label} companion credential was accepted at the door`);
        assert.equal(errorCode(answer.json), "AUTH_REQUIRED", `a ${label} companion credential was not an auth failure`);
      }
      assert.deepEqual(await roster(), [], "a near-miss companion credential filed a roster row");
      assert.deepEqual(await pendingIds(), [], "a near-miss companion credential filed a Decision");
      // The real credential is untouched by that rule.
      assert.equal((await toolsList(LOCAL_PORT, { bearer: companion })).length, ALL_TOOL_DEFS.length);

      // ── 3. a stranger with no name files nothing ──────────────────────────
      const unknown = bearerFor("nobody");
      secrets.push(unknown);
      const noName = await mcp(LOCAL_PORT, { bearer: unknown }, "tools/list");
      checks.noName = { status: noName.status, code: errorCode(noName.json) };
      assert.equal(noName.status, 401);
      assert.equal(errorCode(noName.json), "NAME_REQUIRED");
      assert.deepEqual(await roster(), [], "a bearer with no name was introduced anyway");
      assert.deepEqual(await pendingIds(), [], "a bearer with no name filed a Decision");

      // ── 4. arrive and ask: one Decision, empty tools, and it stays one ─────
      const financialBearer = bearerFor("financial");
      secrets.push(financialBearer);
      const firstContact = await callTool(LOCAL_PORT, { bearer: financialBearer, name: "financial" }, "get_state");
      checks.pendingCall = { status: firstContact.status, code: errorCode(firstContact.value) };
      assert.equal(errorCode(firstContact.value), "PAIRING_PENDING", "a new bearer's call was not pending");
      assert.deepEqual(await toolsList(LOCAL_PORT, { bearer: financialBearer }), [], "a pending agent was shown tools");
      const firstDecisions = await pendingIds();
      assert.equal(firstDecisions.length, 1, `the first contact filed ${firstDecisions.length} Decisions, not one`);
      assert.equal((await rowFor("financial"))?.status, "pending", "the pending row is not on the roster");

      // A second call is still the same open Decision.
      assert.equal(errorCode((await callTool(LOCAL_PORT, { bearer: financialBearer, name: "financial" }, "get_state")).value), "PAIRING_PENDING");
      assert.deepEqual(await pendingIds(), firstDecisions, "a second call from the same bearer filed another Decision");
      transcript.push({ step: "first contact", agent: "financial", decisions: firstDecisions.length });

      // ── 5. the invite door needs a code, and spends it exactly once ────────
      const inviteStranger = bearerFor("invitee");
      secrets.push(inviteStranger);
      const noCode = await mcp(INVITE_PORT, { bearer: inviteStranger, name: "ledger" }, "tools/list");
      checks.inviteNoCode = { status: noCode.status, code: errorCode(noCode.json) };
      assert.equal(noCode.status, 401);
      assert.equal(errorCode(noCode.json), "INVITE_REQUIRED");
      assert.deepEqual(await roster().then((r) => r.length), 1, "the invite door introduced a caller with no code");
      const badCode = await mcp(INVITE_PORT, { bearer: inviteStranger, name: "ledger", invite: "not-a-real-code" }, "tools/list");
      assert.equal(badCode.status, 401);
      assert.equal(errorCode(badCode.json), "INVITE_INVALID");

      const minted = await mintInvite(secretsDir, vaultId);
      assert.equal(minted.ok, true, `mintInvite failed: ${minted.ok ? "" : minted.error}`);
      const code = (minted as { ok: true; value: { code: string } }).value.code;
      secrets.push(code);

      // A valid code with no name must not spend the code.
      const codeNoName = await mcp(INVITE_PORT, { bearer: inviteStranger, invite: code }, "tools/list");
      assert.equal(codeNoName.status, 401);
      assert.equal(errorCode(codeNoName.json), "NAME_REQUIRED");
      const invitesLeft = await listUnusedInvites(secretsDir, vaultId);
      assert.equal(invitesLeft.length, 1, "an introduction with no name spent the invite code");

      // With the name, the same code opens one pending Decision and is spent.
      const inviteIntroduced = await callTool(INVITE_PORT, { bearer: inviteStranger, name: "ledger", invite: code }, "get_state");
      assert.equal(errorCode(inviteIntroduced.value), "PAIRING_PENDING", "a valid invite did not open a pairing");
      const afterInvite = await pendingIds();
      assert.equal(afterInvite.length, 2, `the invite filed ${afterInvite.length} pending Decisions, not two`);
      const ledgerDecision = afterInvite.find((id) => !firstDecisions.includes(id));
      assert.ok(ledgerDecision, "the invite's Decision could not be told apart from the first one");
      const again = await mcp(INVITE_PORT, { bearer: inviteStranger, name: "ledger", invite: code }, "tools/list");
      assert.equal(again.status, 200, "a spent code was refused at the door instead of the MCP layer");
      assert.deepEqual(await pendingIds(), afterInvite, "a spent code filed a second Decision");
      transcript.push({ step: "invite accepted", agent: "ledger", spent: true });

      // ── 6. approval grants nothing on its own ─────────────────────────────
      const approved = await resolveDecision(vaultRoot, firstDecisions[0]!, "approved");
      assert.equal(approved.ok, true, `approving failed: ${approved.ok ? "" : approved.error}`);
      const financialRow = await rowFor("financial");
      assert.ok(financialRow, "the approved row is gone");
      checks.approvedRow = {
        status: financialRow.status,
        access: financialRow.access,
        domains: financialRow.domainSlugs,
        schedule: financialRow.schedule,
        decided: Boolean(financialRow.decidedAt),
      };
      assert.equal(financialRow.status, "active");
      assert.equal(financialRow.access, "read", "approval handed over write");
      assert.deepEqual(financialRow.domainSlugs, [], "approval assigned a domain");
      assert.equal(financialRow.schedule, false, "approval turned Schedule on");
      assert.ok(financialRow.decidedAt, "approval did not stamp decidedAt");

      assert.deepEqual(await toolsList(LOCAL_PORT, { bearer: financialBearer }), [], "an empty grant was shown tools");
      const noGrant = await callTool(LOCAL_PORT, { bearer: financialBearer }, "get_state");
      checks.noGrantCall = { status: noGrant.status, code: errorCode(noGrant.value) };
      assert.equal(errorCode(noGrant.value), "NO_GRANT", "an active agent with no domain did not answer NO_GRANT");

      // ── 7. a read grant reads its domain and nothing else ─────────────────
      const readGranted = await updateConnectedAgent(vaultRoot, financialRow.id, { domainSlugs: ["financial"] });
      assert.equal(readGranted.ok, true, `granting the domain failed: ${readGranted.ok ? "" : readGranted.error}`);
      const readRow = (await rowFor("financial"))!;
      const readGrant = await grantOf(readRow);
      checks.readGrant = { tools: allowedByGrant(readGrant).length, of: ALL_TOOL_DEFS.length };
      assert.deepEqual(await advertised({ bearer: financialBearer }), allowedByGrant(readGrant), "tools/list disagrees with the grant's own verdicts");

      const scoped = await callTool(LOCAL_PORT, { bearer: financialBearer }, "get_state");
      const scopedState = (scoped.value as { state?: Record<string, unknown> }).state ?? {};
      checks.scopedStateKeys = Object.keys(scopedState).sort();
      assert.equal(scopedState.years, undefined, "a connected agent's get_state carried years");
      assert.equal(scopedState.dayTypes, undefined, "a connected agent's get_state carried the day-type catalog");
      assert.equal(scopedState.defaultWeek, undefined, "a connected agent's get_state carried the live week with Schedule off");

      const inDomain = await callTool(LOCAL_PORT, { bearer: financialBearer }, "get_doctrine", { domainSlug: "financial" });
      assert.equal(errorCode(inDomain.value), null, `a granted read of its own domain failed: ${JSON.stringify(inDomain.value).slice(0, 120)}`);
      const outOfDomain = await callTool(LOCAL_PORT, { bearer: financialBearer }, "get_doctrine", { domainSlug: "health" });
      checks.outOfGrantRead = errorCode(outOfDomain.value);
      assert.equal(errorCode(outOfDomain.value), "NOT_FOUND", "an out-of-grant read was not answered as a missing record");

      // Read must not write, and a refused write must not become a Decision.
      const pendingBeforeWrite = await pendingIds();
      const refusedWrite = await callTool(LOCAL_PORT, { bearer: financialBearer }, "create_event", {
        year: new Date().getFullYear(),
        title: "Should not land",
        date: new Date().toISOString().slice(0, 10),
        domainSlug: "financial",
      });
      checks.readOnlyWrite = errorCode(refusedWrite.value);
      assert.equal(errorCode(refusedWrite.value), "FORBIDDEN", "a read-only agent wrote");
      assert.deepEqual(await pendingIds(), pendingBeforeWrite, "a refused write filed a Decision");
      const refusedCapture = await callTool(LOCAL_PORT, { bearer: financialBearer }, "capture_transaction", { text: "Spent R50 on coffee today" });
      assert.equal(errorCode(refusedCapture.value), "FORBIDDEN", "a read-only agent captured a transaction");
      transcript.push({ step: "read grant", tools: allowedByGrant(readGrant).length });

      // ── 8. write lands in the domain, and the log names the agent ─────────
      const writeGranted = await updateConnectedAgent(vaultRoot, readRow.id, { access: "write" });
      assert.equal(writeGranted.ok, true, `turning Write on failed: ${writeGranted.ok ? "" : writeGranted.error}`);
      const writeRow = (await rowFor("financial"))!;
      const writeGrant = await grantOf(writeRow);
      const writeToolCount = allowedByGrant(writeGrant).length;
      checks.writeGrant = { tools: writeToolCount, of: ALL_TOOL_DEFS.length };
      assert.deepEqual(await advertised({ bearer: financialBearer }), allowedByGrant(writeGrant), "tools/list disagrees with the write grant");

      const today = new Date().toISOString().slice(0, 10);
      const applied = await callTool(LOCAL_PORT, { bearer: financialBearer }, "create_event", {
        year: new Date().getFullYear(),
        title: "Groceries",
        date: today,
        domainSlug: "financial",
      });
      const events = (applied.value as { state?: { events?: { title: string; domainSlug: string | null }[] } }).state?.events ?? [];
      checks.inDomainEventApplied = events.some((e) => e.title === "Groceries" && e.domainSlug === "financial");
      assert.ok(checks.inDomainEventApplied, `an in-domain event did not apply: ${JSON.stringify(applied.value).slice(0, 160)}`);

      // The life log records the roster row, not a name the agent chose.
      const logLines = fs
        .readFileSync(path.join(vaultRoot, ".lifequest", "log.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { actor: { type: string; id: string; name: string } | null; domainSlug: string | null });
      const agentEntry = logLines.find((e) => e.actor?.id === writeRow.id);
      checks.lifeLogActor = agentEntry?.actor ?? null;
      assert.ok(agentEntry, "the agent's write left no life-log entry with its own id");
      assert.deepEqual(agentEntry.actor, { type: "agent", id: writeRow.id, name: "financial" }, "the life log did not record the roster row");

      // Schedule and companion-only tools stay shut.
      const dayTemplate = await callTool(LOCAL_PORT, { bearer: financialBearer }, "create_day_type", { name: "Deep work" });
      checks.dayTemplateWithScheduleOff = errorCode(dayTemplate.value);
      assert.equal(errorCode(dayTemplate.value), "FORBIDDEN", "a day template was reachable with Schedule off");
      const companionOnly = await callTool(LOCAL_PORT, { bearer: financialBearer }, "delete_year", { year: new Date().getFullYear() });
      assert.equal(errorCode(companionOnly.value), "FORBIDDEN", "a companion-only tool was reachable by an agent");

      // ── 9. Schedule is its own switch ─────────────────────────────────────
      const scheduled = await updateConnectedAgent(vaultRoot, writeRow.id, { schedule: true });
      assert.equal(scheduled.ok, true, `turning Schedule on failed: ${scheduled.ok ? "" : scheduled.error}`);
      const scheduleGrant = await grantOf((await rowFor("financial"))!);
      checks.scheduleGrant = { tools: allowedByGrant(scheduleGrant).length, of: ALL_TOOL_DEFS.length };
      assert.deepEqual(await advertised({ bearer: financialBearer }), allowedByGrant(scheduleGrant), "tools/list disagrees with the Schedule grant");
      assert.ok(allowedByGrant(scheduleGrant).includes("create_day_type"), "Schedule + Write did not reach the day-template tools");
      assert.ok(allowedByGrant(scheduleGrant).length > writeToolCount, "Schedule on advertised no additional tools");

      // ── 10. revoke sticks, and does not re-pair ───────────────────────────
      const revoked = await markConnectedAgent(vaultRoot, writeRow.id, "revoked");
      assert.equal(revoked.ok, true, `revoking failed: ${revoked.ok ? "" : revoked.error}`);
      const afterRevoke = await callTool(LOCAL_PORT, { bearer: financialBearer }, "get_state");
      checks.revokedCall = errorCode(afterRevoke.value);
      assert.equal(errorCode(afterRevoke.value), "PAIRING_REVOKED", "a revoked key still reached the vault");
      assert.deepEqual(await toolsList(LOCAL_PORT, { bearer: financialBearer }), [], "a revoked key was shown tools");
      const pendingBeforeReconnect = await pendingIds();
      const reconnect = await callTool(LOCAL_PORT, { bearer: financialBearer, name: "financial" }, "get_state");
      assert.equal(errorCode(reconnect.value), "PAIRING_REVOKED", "a revoked key re-introduced itself");
      assert.deepEqual(await pendingIds(), pendingBeforeReconnect, "a revoked key filed a new Decision");
      assert.equal((await roster()).length, 2, "a revoked key added a roster row");

      // ── 11. reject sticks the same way ────────────────────────────────────
      const rejected = await resolveDecision(vaultRoot, ledgerDecision!, "rejected");
      assert.equal(rejected.ok, true, `rejecting failed: ${rejected.ok ? "" : rejected.error}`);
      assert.equal((await rowFor("ledger"))?.status, "rejected", "the rejected row is not rejected on the roster");
      const rejectedCall = await callTool(INVITE_PORT, { bearer: inviteStranger, name: "ledger" }, "get_state");
      checks.rejectedCall = errorCode(rejectedCall.value);
      assert.equal(errorCode(rejectedCall.value), "PAIRING_REJECTED", "a rejected key still reached the vault");
      const pendingBeforeRejectedReconnect = await pendingIds();
      assert.equal(errorCode((await callTool(INVITE_PORT, { bearer: inviteStranger, name: "ledger" }, "get_state")).value), "PAIRING_REJECTED");
      assert.deepEqual(await pendingIds(), pendingBeforeRejectedReconnect, "a rejected key filed a new Decision");

      // ── 12. the pending cap holds ─────────────────────────────────────────
      let introduced = (await roster()).length;
      let limited: { status: number; code: string | null } | null = null;
      for (let i = 0; i < PENDING_PAIRING_CAP + 4; i += 1) {
        const bearer = bearerFor(`flood${i}`);
        secrets.push(bearer);
        const answer = await mcp(LOCAL_PORT, { bearer, name: `stranger-${i}` }, "tools/call", { name: "get_state", arguments: {} });
        const body = answer.json as
          | { error?: { code?: string }; result?: { content?: { text?: string }[] } }
          | undefined;
        // The cap is an HTTP refusal, not a tool result, so its code is on the
        // body; a served call carries its code inside the tool text instead.
        const toolCode = (() => {
          const text = body?.result?.content?.[0]?.text;
          if (!text) return null;
          try {
            return (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? null;
          } catch {
            return null;
          }
        })();
        if (answer.status === 429 || body?.error?.code === "PAIRING_LIMIT" || toolCode === "PAIRING_LIMIT") {
          limited = { status: answer.status, code: body?.error?.code ?? toolCode };
          break;
        }
        assert.equal(toolCode, "PAIRING_PENDING", `introduction ${i} was neither pending nor limited`);
        introduced += 1;
      }
      checks.pendingCap = { cap: PENDING_PAIRING_CAP, introduced, limited };
      assert.ok(limited, `the pending cap of ${PENDING_PAIRING_CAP} was never reached`);
      assert.equal(limited.status, 429, "the cap answered with the wrong HTTP status");
      assert.equal(limited.code, "PAIRING_LIMIT", "the cap answered without its own code");

      // ── 13. the door rebinds to the vault that is open ────────────────────
      const otherRoot = path.join(workDir, "other-vault");
      const otherCreated = await createVault(otherRoot, "Other");
      assert.equal(otherCreated.ok, true, "the second vault could not be created");
      const otherId = (otherCreated as { ok: true; value: { lifequest: { id: string } } }).value.lifequest.id;
      const otherCompanion = await ensureCompanionToken(secretsDir, otherId);
      secrets.push(otherCompanion);
      assert.notEqual(otherCompanion, companion, "two vaults share one companion token");
      const beforeRebindState = doors.doorsState();
      doors.rebind(otherRoot, otherId);
      const reboundState = doors.doorsState();
      checks.doorsStateAfterRebind = reboundState;
      assert.equal(reboundState.companionSeenAt, null, "a rebind kept the previous vault's companion sighting");
      assert.ok(reboundState.boundAt >= beforeRebindState.boundAt, "a rebind did not re-stamp the bind time");
      assert.equal((await toolsList(LOCAL_PORT, { bearer: otherCompanion })).length, ALL_TOOL_DEFS.length, "the rebound door lost the new vault's companion");
      const staleCompanion = await mcp(LOCAL_PORT, { bearer: companion }, "tools/list");
      checks.afterRebind = { newVaultTools: ALL_TOOL_DEFS.length, staleToken: errorCode(staleCompanion.json) };
      assert.equal(staleCompanion.status, 401, "the previous vault's companion token still reached the new vault");
      const otherPending = ((await listDecisions(otherRoot)) as unknown as { value: { status: string }[] }).value.filter(
        (d) => d.status === "pending",
      );
      assert.deepEqual(otherPending, [], "the previous vault's companion token filed a pairing row in the new vault");
      doors.rebind(vaultRoot, vaultId);

      // ── 14. no raw secret reaches the vault tree ──────────────────────────
      const leaks = secretsInTree(vaultRoot, secrets);
      checks.rawSecretsInVault = leaks;
      assert.deepEqual(leaks, [], `a raw secret was written into the vault: ${leaks.join("; ")}`);

      transcript.push({ step: "revoked", agent: "financial" });
      transcript.push({ step: "rejected", agent: "ledger" });

      // ── the artifact ──────────────────────────────────────────────────────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      const report = {
        pass: true,
        what: "the MCP pairing and permission gate: both doors, first contact to revoke, over real HTTP",
        command: "npm test  (this file: tests/mcp-agent-pairing-e2e.test.ts)",
        doors: { local: doors.localPort, invite: doors.invitePort, livePorts: [8643, 8646] },
        checks,
        transcript,
        generatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      await doors.close();
    }

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
