# MCP Agent Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require every MCP caller except the companion to pair, then limit that caller to the domains, write switch, and schedule switch the operator grants.

**Architecture:** `127.0.0.1:8643` accepts a local introduction. `127.0.0.1:8646` accepts an introduction only with a one-time invite code. The roster lives in the vault with no secrets. Bearer hashes and invite-code hashes live in app userData. A grant check runs before `executeTool` for every connected agent. The companion bearer skips that check.

**Tech Stack:** TypeScript, Node `node:test` with `--experimental-strip-types`, existing `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`, vault-core Decisions, Electron IPC.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-03-mcp-agent-pairing-design.md`. When this plan and the spec disagree on behavior, follow the spec.
- Local door `http://127.0.0.1:8643/mcp`. Invite door `http://127.0.0.1:8646/mcp`. Both are `POST /mcp` only. Any other method or path returns 404. Bind `127.0.0.1` only.
- The product does not listen on a public address, terminate TLS, or bind a private-network interface.
- Bearer header: `Authorization: Bearer <token>`. Name header: `X-LifeQuest-Name`. Invite header: `X-LifeQuest-Invite`.
- A bearer shorter than 22 characters is `AUTH_REQUIRED`. A name is trimmed and must be 1 to 80 characters.
- Fingerprint is the first 12 hex characters of the SHA-256 hex of the bearer. Invite codes are 128 bits, shown once, stored as a SHA-256 hash, single-use, and expire 24 hours after mint.
- At most 20 roster rows may have status `pending`.
- Approval starts `access: "read"`, `domainSlugs: []`, `schedule: false`.
- The stored Decision title is `Connect <name>`. The body JSON is `{ "fingerprint": "<12 hex>", "door": "local" | "invite" }`.
- HTTP auth failures return `{ "error": { "code": "<CODE>", "message": "<message>" } }` with the status in the table below. Tool refusals are a successful MCP `tools/call` whose text content is that same JSON shape.
- Exact auth messages: `AUTH_REQUIRED` "Authorization bearer is required". `NAME_REQUIRED` "X-LifeQuest-Name is required". `INVITE_REQUIRED` "Invite code is required". `INVITE_INVALID` "Invite code is no longer valid". `PAIRING_LIMIT` "Too many agents are waiting for approval".
- Exact tool messages: `PAIRING_PENDING` "Waiting for approval". `PAIRING_REJECTED` "This agent was rejected". `PAIRING_REVOKED` "This agent was revoked". `NO_GRANT` "No domain or schedule is assigned". `FORBIDDEN` "Outside this agent's grant". `NOT_FOUND` "Not found".
- Raw bearers and raw invite codes are never written to the vault, the life log, or an error message.
- The companion token is generated once per vault (`base64url` of 32 random bytes) and stored in userData. `ensure` writes `mcp_servers.lifequest.headers.Authorization` to `Bearer <companion-token>` and the url `http://127.0.0.1:8643/mcp`. Other MCP servers and other keys on the lifequest entry stay.
- Connected-agent life-log actor is `{ type: "agent", id: <roster id>, name: <roster name> }`. The caller cannot supply a different actor.
- Proof is one test, `apps/desktop/tests/mcp-agent-pairing.test.ts`. It writes `pairing-e2e.json` inside its temporary vault. Do not add a second test file. The test may bind ephemeral ports; the production defaults stay 8643 and 8646.
- Do not edit `LAWS`, `README`, `PRODUCT`, `VISION`, or the spec. Do not stage them.
- Windows commits use two `-m` flags. Stage explicit paths. Do not `git add -A`. Do not merge or push.
- Work in an isolated worktree. Do not `npm install` there. Do not delete the shared `node_modules/@lifequest/vault-core` junction.

### Auth result table

| Code | HTTP | When |
|---|---|---|
| `AUTH_REQUIRED` | 401 | No bearer, or a bearer shorter than 22 characters. |
| `NAME_REQUIRED` | 401 | New bearer, name missing or not 1–80 characters after trim. On `8646`, only after the invite code is valid. The code stays unused. |
| `INVITE_REQUIRED` | 401 | Unknown bearer on the invite door with no code or a blank code. |
| `INVITE_INVALID` | 401 | Invite code is used, expired, or unknown. |
| `PAIRING_LIMIT` | 429 | A new introduction would exceed 20 pending rows. A presented invite code stays unused. |

---

### Task 1: Doors, roster, and the pairing Decision

**Files:**
- Create: `packages/vault-core/src/connected-agents.ts`
- Create: `apps/desktop/electron/pairing-secrets.ts`
- Create: `apps/desktop/electron/pairing-door.ts`
- Modify: `packages/vault-core/src/types.ts` (`DocumentTarget`)
- Modify: `packages/vault-core/src/paths.ts` (add `connectedAgentsJson`)
- Modify: `packages/vault-core/src/decisions.ts` (`normalizeDecision`, `createDecision`, `applyApprovedBody`)
- Modify: `packages/vault-core/src/documents.ts` (`documentTargetLabel`)
- Modify: `packages/vault-core/src/index.ts` (export the roster API)
- Test: `apps/desktop/tests/mcp-agent-pairing.test.ts`

**Interfaces:**
- Consumes: `createVault`, `createDecision`, `resolveDecision`, `normalizeDecision`
- Produces:
  - `export type ConnectedAgentStatus = "pending" | "active" | "rejected" | "revoked"`
  - `export type ConnectedAgent = { id: string; name: string; fingerprint: string; status: ConnectedAgentStatus; access: "read" | "write"; domainSlugs: string[]; schedule: boolean; door: "local" | "invite"; createdAt: string; decidedAt: string | null }`
  - `export function fingerprintOf(bearer: string): string`
  - `export async function listConnectedAgents(root: string): Promise<Result<ConnectedAgent[]>>`
  - `export async function introduceConnectedAgent(root: string, input: { name: string; fingerprint: string; door: "local" | "invite" }): Promise<Result<{ agent: ConnectedAgent; decisionId: string }>>`
  - `export async function markConnectedAgent(root: string, id: string, status: "active" | "rejected" | "revoked"): Promise<Result<ConnectedAgent>>`
  - `export const LOCAL_MCP_PORT = 8643`
  - `export const INVITE_MCP_PORT = 8646`
  - `export const PENDING_PAIRING_CAP = 20`
  - `export async function startPairingDoors(opts: { root: string; vaultId: string; secretsDir: string; localPort?: number; invitePort?: number; now?: () => Date }): Promise<{ localPort: number; invitePort: number; localError: string | null; inviteError: string | null; close: () => Promise<void>; rebind: (root: string, vaultId: string) => void }>`
  - `DocumentTarget` gains `{ type: "agent-pairing"; agentId: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/mcp-agent-pairing.test.ts`. Use `node:test`, `node:assert/strict`, a temp vault from `createVault`, and `startPairingDoors` with ports `0` is not available from our listener, so pass two free ports from `net.createServer().listen(0)`. Record each scenario in `scenarios: { name: string; code: string }[]`.

Cover these cases in this task:

- No bearer on the local port returns HTTP 401 `AUTH_REQUIRED`, and `.lifequest/connected-agents.json` does not exist.
- `GET /mcp` on either port returns 404.
- Bearer `short` returns `AUTH_REQUIRED`. A name of 81 characters returns `NAME_REQUIRED` and files nothing. A name of `  Finance bot  ` is stored as `Finance bot`.
- A 22-character bearer on the local port with no name returns `NAME_REQUIRED` and files nothing.
- The same bearer plus `X-LifeQuest-Name: Finance bot` returns HTTP 200 for `initialize`. `tools/list` has `tools: []`. `tools/call` of `get_state` returns tool text whose JSON `error.code` is `PAIRING_PENDING`. The roster has one pending row, fingerprint equal to `fingerprintOf(bearer).slice(0, 12)`, `access: "read"`, `domainSlugs: []`, `schedule: false`, `door: "local"`. Exactly one decision file exists, `target.type === "agent-pairing"`, `title === "Connect Finance bot"`, and `proposedBodyMarkdown` parses to `{ fingerprint, door: "local" }`. A second `initialize` does not create a second decision or a second roster row.
- Unknown bearer on the invite port with no code returns `INVITE_REQUIRED`. A blank code does too. A random code returns `INVITE_INVALID`. Nothing is filed.
- Mint a code through `mintInvite(secretsDir, vaultId)`, then introduce with that code and a name. One pending row has `door: "invite"`. The same code then returns `INVITE_INVALID`.
- Pass `now` so a freshly minted code is 25 hours old. That code returns `INVITE_INVALID` and files nothing.
- A valid code and a new bearer with no name returns `NAME_REQUIRED`, and a later use of that same code still succeeds.
- Create 20 pending local agents. The 21st local introduction and a 21st invite introduction both return `PAIRING_LIMIT`. The invite code used for that 21st attempt still works after one pending row is no longer pending (mark one `rejected` through `markConnectedAgent` for this setup only).
- Walk the temp vault as text. The bearer string and the invite code string do not occur. The secrets file is under `secretsDir`, not under the vault.
- `LOCAL_MCP_PORT === 8643` and `INVITE_MCP_PORT === 8646`.

HTTP helper:

```ts
async function rpc(
  port: number,
  headers: Record<string, string>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }),
  });
  const text = await res.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  const parsed = JSON.parse(dataLine ? dataLine.slice(6) : text) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}
```

`initialize` params: `{ protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "0" } }`.

At the end of the file, write `pairing-e2e.json` with `{ scenarios }` and assert every name pushed in this task is present. Later tasks append scenarios. Do not yet assert the full spec list.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: FAIL because `startPairingDoors` is not exported.

- [ ] **Step 3: Implement the roster, the Decision target, and both doors**

`connectedAgentsJson` is `.lifequest/connected-agents.json`. Missing file reads as `{ agents: [] }`.

`fingerprintOf` returns the full SHA-256 hex. The stored `fingerprint` field is `fingerprintOf(bearer).slice(0, 12)`.

`introduceConnectedAgent` refuses a blank name, reuses an existing row with the same fingerprint, and when `status === "pending"` count is already 20 returns `{ ok: false, error: "PAIRING_LIMIT" }` without writing. A new row uses `crypto.randomUUID()`, the field defaults from the spec, and files a Decision with actor `{ type: "agent", id, name }`, `proposedTitle: "Connect " + name`, and `proposedBodyMarkdown` the fingerprint/door JSON. `createDecision` must store `title` as that `proposedTitle` for `agent-pairing` only, with `domainSlugs: []`. The library fallthrough in `applyApprovedBody` must not run for this target: add the branch before the doctrine/library split, and make approve call `markConnectedAgent(root, agentId, "active")`. If the row is missing, return `{ ok: false, error: "Agent not found", terminal: true }`. If the row is already `active`, return success and do not change `access`, `domainSlugs`, or `schedule`.

`normalizeDecision` parses `{ type: "agent-pairing", agentId: string }`. Any other unrecognized explicit target returns a thrown or read failure. Do not map it to `{ type: "library" }`.

`documentTargetLabel` for this target returns the fallback title when it is non-empty, otherwise `"Agent pairing"`.

`pairing-secrets.ts` stores `{ vaults: { [vaultId]: { companionToken: string | null; bearers: { [fingerprint12]: string }; invites: { id: string; codeHash: string; expiresAt: string; usedAt: string | null }[] } } }`. The bearer map value is the SHA-256 hex, not the raw bearer. `mintInvite` returns the raw code once (`base64url` of 16 bytes) and stores the hash and `expiresAt` 24 hours ahead. `takeInvite` returns `used` only when the hash matches, `usedAt` is null, and `expiresAt` is in the future; it then sets `usedAt`. A failed take does not write.

`pairing-door.ts` listens on both ports. A bind error on one port sets that door's error string and leaves the other listening. `EADDRINUSE` on the invite port uses the message `MCP invite port is in use.` The local port uses today's message `MCP port 8643 is in use. Close the other process or quit LifeQuest.` when the port is 8643, and `MCP local port is in use.` otherwise.

Auth runs before a new `McpServer` is constructed. The MCP server for a pending, rejected, or revoked bearer registers no vault tools. `tools/call` returns the matching tool error JSON. `initialize` returns the SDK's normal result.

Serialize introductions for one `secretsDir` on a promise chain so two identical bearers create one row.

`rebind(root, vaultId)` replaces the vault used by later requests. `close()` closes both servers.

Export `LOCAL_MCP_PORT` and `INVITE_MCP_PORT` from `pairing-door.ts`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: PASS. `pairing-e2e.json` exists in the temp vault and contains this task's scenario names.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/vault-core/src/connected-agents.ts packages/vault-core/src/types.ts packages/vault-core/src/paths.ts packages/vault-core/src/decisions.ts packages/vault-core/src/documents.ts packages/vault-core/src/index.ts apps/desktop/electron/pairing-secrets.ts apps/desktop/electron/pairing-door.ts apps/desktop/tests/mcp-agent-pairing.test.ts
git commit -m "feat(desktop): pair MCP agents on two loopback doors" -m "A new bearer on 8643 files one pairing Decision. The invite door requires a one-time code. Pending callers get no vault tools."
```

---

### Task 2: Approval, rejection, revoke, and the companion bearer

**Files:**
- Modify: `apps/desktop/electron/pairing-door.ts`
- Modify: `apps/desktop/electron/pairing-secrets.ts`
- Modify: `packages/vault-core/src/connected-agents.ts`
- Modify: `packages/vault-core/src/decisions.ts` (reject path sets the roster row to `rejected`)
- Test: `apps/desktop/tests/mcp-agent-pairing.test.ts`

**Interfaces:**
- Consumes: `startPairingDoors`, `resolveDecision`, `markConnectedAgent`, `listConnectedAgents`
- Produces:
  - `export async function ensureCompanionToken(secretsDir: string, vaultId: string): Promise<string>`
  - `companionBearer(secretsDir, vaultId)` used by the door to recognize the companion
  - Rejecting an `agent-pairing` Decision sets the roster row to `rejected` and sets `decidedAt`
  - Revoke is `markConnectedAgent(root, id, "revoked")` and keeps the bearer hash

- [ ] **Step 1: Extend the failing test**

Add scenarios:

- Approve the Task 1 decision with `resolveDecision(root, id, "approved")`. The roster row is `active`, `access` is still `"read"`, domains are still empty, `schedule` is still false, and `decidedAt` is set. `tools/call` of `get_state` returns `NO_GRANT`. `tools/list` is empty.
- Resolve the same decision again. The result is not ok, and the row's `access` is unchanged.
- A new bearer, introduced and then `resolveDecision(..., "rejected")`, returns `PAIRING_REJECTED` on `tools/call`. A second introduction with that bearer does not add a row or a decision.
- `markConnectedAgent(..., "revoked")` on an active agent makes `tools/call` return `PAIRING_REVOKED` and does not add a row when the bearer connects again.
- `ensureCompanionToken` twice returns the same string. Requests with `Authorization: Bearer <that token>` on both ports do not create a roster row. `tools/list` includes `get_state`. `tools/call` of `get_state` does not return `PAIRING_PENDING`, `NO_GRANT`, or `AUTH_REQUIRED`.
- A request with no bearer still returns `AUTH_REQUIRED` after the companion token exists.

- [ ] **Step 2: Run the test and confirm the new scenarios fail**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: FAIL on the approve or companion assertion.

- [ ] **Step 3: Implement the status transitions and the companion bypass**

On `resolveDecision(..., "rejected")` for `agent-pairing`, call `markConnectedAgent(root, agentId, "rejected")` before writing the decision file. On approve, Task 1 already activates the row. `markConnectedAgent` sets `decidedAt` when moving to `active`, `rejected`, or `revoked`, and refuses a missing id. Moving an already-`active` row to `active` changes nothing and returns the row.

`ensureCompanionToken` generates the token only when that vault's `companionToken` is null. The door treats that exact bearer as the companion on either port: register the full `ALL_TOOL_DEFS` list and call `executeTool(root, null, name, args)` with the companion actor. Do not pass a grant.

An active connected agent with no live domain and `schedule === false` gets `NO_GRANT` from `tools/call` and an empty `tools/list`. Domain and schedule behavior is Task 3 and Task 5. This task only has to recognize the active-but-empty grant.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: PASS, including Task 1 scenarios.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/electron/pairing-door.ts apps/desktop/electron/pairing-secrets.ts packages/vault-core/src/connected-agents.ts packages/vault-core/src/decisions.ts apps/desktop/tests/mcp-agent-pairing.test.ts
git commit -m "feat(desktop): approve or reject a paired MCP agent" -m "Approval leaves the agent read-only with no domains. The companion bearer stays pre-paired and does not file a Decision."
```

---

### Task 3: Domain read grant

**Files:**
- Create: `packages/vault-core/src/pairing-grant.ts`
- Modify: `packages/vault-core/src/index.ts`
- Modify: `apps/desktop/electron/pairing-door.ts` (pass the grant into `executeTool`)
- Modify: `apps/desktop/electron/map-tools.ts` (`executeTool` accepts an optional grant)
- Test: `apps/desktop/tests/mcp-agent-pairing.test.ts`

**Interfaces:**
- Consumes: `ConnectedAgent`, `executeTool(root, activeSlug, name, args, actor?)`
- Produces:
  - `export type ConnectedGrant = { agentId: string; name: string; access: "read" | "write"; domainSlugs: string[]; schedule: boolean }`
  - `export function toolAllowed(name: string, grant: ConnectedGrant): "allow" | "NO_GRANT" | "FORBIDDEN"`
  - `export function projectConnectedState(state: MapStoreState, grant: ConnectedGrant): { events: MapEvent[]; tasks?: Task[]; week?: unknown }`
  - `export function projectConnectedPack(pack: PeriodPack, grant: ConnectedGrant): PeriodPack`
  - `export function connectedLibraryVisible(domainSlugs: string[], grant: ConnectedGrant): boolean`
  - `executeTool(..., actor = AGENT_ACTOR, grant?: ConnectedGrant)`

- [ ] **Step 1: Extend the failing test**

Build a vault with live domains `financial` and `health`, a doctrine document in each, one database row in each, a library note tagged `["financial", "health"]`, a library note tagged `["financial"]`, a goal and an event with `domainSlug: "health"`, a goal and an event with `domainSlug: null`, and a period pack scope of `health` that would otherwise include tasks. Approve an agent and set `domainSlugs: ["financial"]`, `access: "read"`, `schedule: false` by writing the roster file through `updateConnectedAgent` (add this writer in this task).

Assert:

- `get_doctrine` for `financial` succeeds. `get_doctrine` for `health` returns `NOT_FOUND`.
- `list_rows` for the financial database returns the row. `get_row` for the health row returns `NOT_FOUND`. `list_databases` omits the health database.
- `list_documents` includes the financial-only note and omits the note tagged with both domains. `get_document` of the both-tagged note returns `NOT_FOUND`.
- `list_goals` and `get_state` omit the null-domain goal and event and omit the health records. `get_state` has no `tasks` and no `week` keys.
- `get_period_pack` with `scope: "overall"` returns `FORBIDDEN`. With `scope: "health"` it returns `FORBIDDEN`. With `scope: "financial"` it succeeds and the body has `tasks: []` and `liveDays: []`, and no `previousReview` content and no `domainSections` entries.
- `list_decisions` omits pairing decisions and omits decisions whose `domainSlugs` are empty or include `health`.
- `create_year`, `set_about_me`, `set_month_notes`, `capture_transaction`, and `create_task` each return `FORBIDDEN` and leave the vault byte-for-byte unchanged aside from no new decision file.
- Call `executeTool` with no grant and `activeSlug: "health"`. `get_doctrine` without a domain argument still resolves `health`. The same call with a financial grant ignores `activeSlug` and does not return the health document.
- Archive `financial` after it was assigned. The next `get_doctrine` for `financial` returns `NOT_FOUND`, and the roster file still contains the slug.

- [ ] **Step 2: Run the test and confirm the new scenarios fail**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: FAIL on the financial doctrine read or on `FORBIDDEN`.

- [ ] **Step 3: Implement the read projection**

`updateConnectedAgent(root, id, patch)` accepts `{ access?, domainSlugs?, schedule? }` for an `active` row only. `domainSlugs` must be a unique list of live, non-archived domain slugs. An unknown or archived slug returns an error and does not write.

`effectiveGrant` copies the row and removes archived slugs from `domainSlugs` at call time.

`toolAllowed` returns `NO_GRANT` when `domainSlugs` is empty and `schedule` is false. It returns `FORBIDDEN` for `create_year`, `delete_year`, `set_month_day`, `set_month_objectives`, `set_month_notes`, and `set_about_me`. It returns `FORBIDDEN` for every schedule, day-template, capture, and write tool while `access` is `"read"` or `schedule` is false. Those write and schedule lists are fixed in Task 4 and Task 5; this task still refuses them. Read tools `get_doctrine`, `list_documents`, `get_document`, `list_databases`, `get_database`, `list_rows`, `get_row`, `list_decisions`, `list_goals`, `get_state`, `get_review`, `list_reviews`, `get_period_pack`, and `run_script_block` return `allow` when at least one domain remains.

Before `executeTool` runs a single-record read, if the argument `domainSlug` is absent from the grant, return `NOT_FOUND` without calling the tool. After a list tool returns, drop rows outside the grant. `connectedLibraryVisible` is true only when `domainSlugs.length > 0` and every entry is in the grant. `projectConnectedState` returns `{ events }` filtered to granted domains. It adds `tasks` and `week` only when `grant.schedule` is true (Task 5 fills those fields; this task omits them). `projectConnectedPack` clears `tasks`, `liveDays`, `previousReview`, and `domainSections`.

`executeTool` uses `actor = { type: "agent", id: grant.agentId, name: grant.name }` when a grant is passed, and ignores `activeSlug` for permission decisions. The companion call passes no grant.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/vault-core/src/pairing-grant.ts packages/vault-core/src/index.ts packages/vault-core/src/connected-agents.ts apps/desktop/electron/pairing-door.ts apps/desktop/electron/map-tools.ts apps/desktop/tests/mcp-agent-pairing.test.ts
git commit -m "feat(vault): filter MCP reads by the agent's domains" -m "A connected agent reads only records whose domains are all inside its grant. A record outside the grant reads as not found."
```

---

### Task 4: Domain write grant

**Files:**
- Modify: `packages/vault-core/src/pairing-grant.ts`
- Modify: `apps/desktop/electron/map-tools.ts`
- Test: `apps/desktop/tests/mcp-agent-pairing.test.ts`

**Interfaces:**
- Consumes: `ConnectedGrant`, `toolAllowed`, `executeTool`
- Produces: write classification for the tool names listed in Step 3. No new exported type.

- [ ] **Step 1: Extend the failing test**

Using the financial/health vault from Task 3, with the finance kit installed, one transactional account, and an empty insert allowlist:

- Read-only agent: `upsert_row`, `create_library_document`, `create_goal`, `create_event`, `create_project`, `capture_transaction`, and `apply_script_block` each return `FORBIDDEN`, file no Decision, and do not change the database or the page.
- Set `access: "write"`. A clear `capture_transaction` posts a row. `undo_capture` and `correct_capture` for that capture succeed. The same capture calls return `FORBIDDEN` when `financial` is removed from `domainSlugs`.
- `upsert_row` of a new financial row returns a `decisionId` and the row is absent until `resolveDecision(..., "approved")`. `delete_row`, `create_database`, and `add_column` also return a decision id and do not apply immediately.
- `create_goal` and `create_project` for `financial` file Decisions. `create_goal` with `domainSlug: null` or `health` returns `FORBIDDEN` and files nothing. `create_event` for `financial` applies immediately. `create_event` with `domainSlug: null` returns `FORBIDDEN`. `update_event` that moves a financial event to `health` returns `FORBIDDEN` and leaves the event on `financial`.
- `apply_script_block` on a financial page writes the page. On a health page it returns `NOT_FOUND` for `run_script_block` and `FORBIDDEN` for `apply_script_block`.
- The life-log line for the successful capture has `actor` equal to `{ type: "agent", id: <roster id>, name: <roster name> }`.
- The companion bearer, with no grant, still files a doctrine Decision on `update_document` and does not receive `FORBIDDEN` for that call.

- [ ] **Step 2: Run the test and confirm the new scenarios fail**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: FAIL because write tools still return `FORBIDDEN` after Write is turned on, or because a forbidden goal files a Decision.

- [ ] **Step 3: Implement write checks before any vault write**

When `grant.access === "write"`, these tools are allowed only if every domain they name is in the effective grant, and a null domain is `FORBIDDEN`:

- Decision-filing: `update_document`, `create_library_document`, `create_goal`, `update_goal`, `delete_goal`, `create_project`, `close_project`, `upsert_row`, `delete_row`, `create_database`, `add_column`, `write_review`, `mark_review_done`, `unlock_review`.
- Immediate: `create_event`, `update_event`, `delete_event`, `apply_script_block`, `capture_transaction`, `undo_capture`, `correct_capture`.

Capture tools also require the effective grant to include `financial`. Review tools require `scope` to be an assigned domain. `scope: "overall"` is `FORBIDDEN`.

Check the domain before calling the existing tool body. A failed check returns `FORBIDDEN` or `NOT_FOUND` as the spec describes and does not call `createDecision` or `applyMapCommand`.

Do not add an insert-allowlist implementation in this task. The empty-allowlist test is the required proof. If `upsert_row` already auto-applies because a future allowlist matches, keep that path and only let it run when Write is on and the database domain is assigned.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/vault-core/src/pairing-grant.ts apps/desktop/electron/map-tools.ts apps/desktop/tests/mcp-agent-pairing.test.ts
git commit -m "feat(vault): apply the companion's write rules inside an agent's domains" -m "Write stays off until Personnel grants it. Capture posts only for the financial domain. Out-of-domain writes file nothing."
```

---

### Task 5: Schedule grant

**Files:**
- Modify: `packages/vault-core/src/pairing-grant.ts`
- Modify: `apps/desktop/electron/map-tools.ts`
- Test: `apps/desktop/tests/mcp-agent-pairing.test.ts`

**Interfaces:**
- Consumes: `ConnectedGrant.schedule`, `projectConnectedState`, `projectConnectedPack`
- Produces: no new exports. Schedule tools recognized by `toolAllowed`:
  - Read: `get_week`
  - Immediate write: `create_task`, `update_task`, `delete_task`, `set_week_day_type`, `set_week_day_items`, `set_week_weekly_items`, `place_grid_block`, `clear_grid_block`, `reset_week`
  - Decision write: `create_day_type`, `update_day_type`, `delete_day_type`, `set_default_weekday_type`, `set_default_weekly_items`

- [ ] **Step 1: Extend the failing test**

Agent with `domainSlugs: ["financial"]`, `schedule: false`:

- `get_week`, `create_task`, and `create_day_type` return `FORBIDDEN`.
- `get_state` has no `tasks` and no `week`.
- `get_period_pack` for `financial` has `tasks: []` and `liveDays: []`.

Set `schedule: true` and leave `access: "read"`:

- `get_week` succeeds. `get_state` includes `tasks` and `week`. `create_task` and `create_day_type` return `FORBIDDEN` and file nothing.

Set `access: "write"` as well:

- `create_task` applies immediately and the life log actor is the connected agent.
- `create_day_type` returns a `decisionId` and does not add the day type until approve.

Agent with `domainSlugs: []` and `schedule: true`:

- `tools/list` contains `get_week` and, once Write is on, `create_task`.
- `get_doctrine` returns `NO_GRANT` or `FORBIDDEN`. It must not return a document. Use `FORBIDDEN` when the tool is hidden because no domain is assigned, and keep `NO_GRANT` only when both the domain list is empty and `schedule` is false.

- [ ] **Step 2: Run the test and confirm the new scenarios fail**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: FAIL on `get_week` or `create_task`.

- [ ] **Step 3: Implement the schedule switch**

`toolAllowed` allows `get_week` when `schedule` is true. It allows the immediate task and live-week tools when `schedule` and `access === "write"`. It allows the five day-template tools on that same condition, and `executeTool` keeps filing a day-template Decision for them.

`projectConnectedState` includes `tasks` from the map and `week` from the same payload `get_week` would return for the current week when `schedule` is true. `projectConnectedPack` leaves `tasks` and `liveDays` in place only when `schedule` is true. It still clears `previousReview` and `domainSections`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/vault-core/src/pairing-grant.ts apps/desktop/electron/map-tools.ts apps/desktop/tests/mcp-agent-pairing.test.ts
git commit -m "feat(vault): gate tasks and the live week behind Schedule" -m "Schedule starts off. Read can see the week. Write posts tasks immediately and still files a Decision for day templates."
```

---

### Task 6: Electron wiring, Personnel, and Settings

**Files:**
- Modify: `apps/desktop/electron/mcp-server.ts` (delegate to `startPairingDoors` / `rebind` / `close`)
- Modify: `apps/desktop/electron/vault-service.ts` (rebind on vault switch; surface both door errors)
- Modify: `apps/desktop/electron/companion-profile.ts` (`ensureMcpServer` preserves headers)
- Modify: `apps/desktop/electron/companion-lifecycle.ts` (write the companion Authorization header)
- Modify: `apps/desktop/electron/main.ts` and `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/src/components/personnel/PersonnelStudio.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsHermes.tsx`
- Modify: `apps/desktop/src/components/decisions/DecisionsInbox.tsx`
- Modify: `apps/desktop/src/components/decisions/DecisionBody.tsx`
- Test: `apps/desktop/tests/mcp-agent-pairing.test.ts`

**Interfaces:**
- Consumes: `startPairingDoors`, `ensureCompanionToken`, `mintInvite`, `updateConnectedAgent`, `markConnectedAgent`, `listConnectedAgents`
- Produces IPC:
  - `mcp:getDoors` → `{ localUrl: string; inviteUrl: string; localError: string | null; inviteError: string | null }`
  - `connectedAgents:list` → `Result<ConnectedAgent[]>`
  - `connectedAgents:update` → `(id: string, patch: { access?: "read" | "write"; domainSlugs?: string[]; schedule?: boolean }) => Result<ConnectedAgent>`
  - `connectedAgents:revoke` → `(id: string) => Result<ConnectedAgent>`
  - `connectedAgents:invite` → `Result<{ code: string; expiresAt: string }>`
  - `connectedAgents:dropInvite` → `(id: string) => Result<{ dropped: true }>`
  - `window.lifequest` methods of the same names

- [ ] **Step 1: Extend the failing test**

Add the remaining HTTP scenarios and source assertions to the same test file:

- Start doors with the invite port already bound. `inviteError` is non-null, `localError` is null, and a companion `tools/call` of `get_state` on the local port succeeds.
- `rebind` to a second vault makes a bearer from the first vault return `AUTH_REQUIRED` or `PAIRING_PENDING` only against the second vault's roster. A companion token from the second vault's secrets works, and `get_state` reads the second vault. Assert with a marker event created only in the second vault.
- `ensureMcpServer` on yaml that already has `mcp_servers.other.url` leaves that entry in place and sets `mcp_servers.lifequest.headers.Authorization` to `Bearer <token>` and the lifequest url to `http://127.0.0.1:8643/mcp`.
- Read `PersonnelStudio.tsx` and assert it contains the headings `Companion` and `Connected agents`, contains `Waiting for approval`, and does not contain an approve button labeled for a connected agent. The hire scan heading `Scan` remains.
- Read `SettingsHermes.tsx` and assert it renders both `8643/mcp` and `8646/mcp`.
- Read `DecisionsInbox.tsx` and assert the `agent-pairing` branch returns `Agent pairing`.
- The artifact assertion at the bottom of the file now requires every scenario name from the spec's Verification section to be present in `pairing-e2e.json`.

- [ ] **Step 2: Run the test and confirm the new scenarios fail**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: FAIL on rebind, the occupied invite port, or a missing UI string.

- [ ] **Step 3: Wire the app**

Replace the body of `startMcp` / `stopMcp` so vault open calls `startPairingDoors` with the open vault root, vault id, and `path.join(app.getPath("userData"), "pairing-secrets")`. The production call uses the default ports. If a server is already listening, call `rebind` instead of keeping the first vault's root. `getMcpDoors()` returns the two urls when that door's error is null, and empty string urls when the vault is closed.

`companionEnsure` calls `ensureCompanionToken` for the open vault and passes the token into the profile writer. Extend `ensureMcpServer(yaml, name, url, headers?)`. When the named server exists, update its `url` and merge `headers` without removing other keys. When it does not exist, append the block from the spec.

Personnel order is Companion, then Connected agents, then the existing Scan and Active hires sections. The Companion card shows Hermes and the text `Full access`, with no switches. A pending connected agent shows the name, fingerprint, and `Waiting for approval`. An active row has a live-domain multi-select, a Write switch, a Schedule switch, and a Revoke button. Invite shows the returned code and expiry once. Unused invites list expiry and a Drop button, not the code. Rejected and revoked rows are not rendered.

`DecisionsInbox` `kindLabel` handles `agent-pairing` with `Agent pairing`. `DecisionBody` renders the fingerprint and the door from `proposedBodyMarkdown` instead of falling through to the library body.

`mcp:getUrl` may remain as the local url so existing callers keep working. Settings reads `mcp:getDoors`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -w @lifequest/desktop -- tests/mcp-agent-pairing.test.ts`

Expected: PASS. Then run `npm test -w @lifequest/desktop` and `npm test -w @lifequest/vault-core`.

Expected: both PASS. The temp vault's `pairing-e2e.json` includes every scenario name from the spec Verification section.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/electron/mcp-server.ts apps/desktop/electron/vault-service.ts apps/desktop/electron/companion-profile.ts apps/desktop/electron/companion-lifecycle.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/src/vite-env.d.ts apps/desktop/src/components/personnel/PersonnelStudio.tsx apps/desktop/src/components/settings/SettingsHermes.tsx apps/desktop/src/components/decisions/DecisionsInbox.tsx apps/desktop/src/components/decisions/DecisionBody.tsx apps/desktop/tests/mcp-agent-pairing.test.ts
git commit -m "feat(desktop): show connected agents and both MCP doors" -m "Personnel lists the companion and paired agents. Settings shows the local door and the invite door. Switching vaults rebinds both."
```
