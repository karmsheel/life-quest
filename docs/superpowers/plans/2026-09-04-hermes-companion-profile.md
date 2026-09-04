# Hermes Companion Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LifeQuest a Sessions API client of a dedicated `lifequest` Hermes profile: detect/create the profile, attach-or-start its gateway, stream chat from Hermes, and gate the app until the companion is ready.

**Architecture:** Pure helpers in Electron main (`companion-profile.ts`, `companion-lifecycle.ts`, `companion-client.ts`) own paths, `.env`, MCP yaml, spawn/attach, and HTTP. Renderer is a session viewer plus a first-run gate. Hermes owns transcripts. MCP on 8643 is unchanged.

**Tech Stack:** Electron 35, Vite + React 19, `node:test` with `--experimental-strip-types` in `apps/desktop/tests/`. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-hermes-companion-profile-design.md`

## Global Constraints

- Companion identity is Hermes profile **`lifequest`**, never the default `~/.hermes` profile and never a LifeQuest `userData` `HERMES_HOME`
- Transcripts live in Hermes; do not write chat JSON into the vault
- Chat panel uses Sessions API (`/api/sessions`, `/chat/stream`); do not call `runPlannerLoop` from the Chat panel; do not fall back to the in-process planner
- Default Hermes **8642** untouched; LifeQuest MCP **8643** unchanged (fail if busy, do not move); companion API **8644** (may move to next free port, never 8642 or 8643)
- `API_SERVER_KEY` stays in the profile `.env`; renderer never receives it
- Attach if gateway is up; start only if down; stop on quit only if `startedByLifeQuest` and the PID is still ours
- First-run gate before Welcome/shell; missing CLI → `needs_install`, no bundled Hermes
- Seed `SOUL.md` only when missing or empty; never overwrite a non-empty SOUL
- Register MCP `http://127.0.0.1:8643/mcp` on this profile only; merge yaml; do not clobber other `mcp_servers`
- Do not set a LifeQuest-only `X-Hermes-Session-Key`
- Act / Personnel / `hermes:chatTools` stay; Chat panel ignores vault `hermesBaseUrl` and vault-scoped keys
- Tests: `node --experimental-strip-types --test` under `apps/desktop/tests/`
- Windows-safe; no new YAML library

---

## File map

| File | Role |
|------|------|
| `apps/desktop/electron/companion-profile.ts` | Paths, `.env` upsert, MCP yaml merge, SOUL seed, port pick |
| `apps/desktop/electron/companion-lifecycle.ts` | CLI resolve, bootstrap files, attach vs spawn, quit |
| `apps/desktop/electron/companion-client.ts` | Instructions, sessions HTTP, SSE parse |
| `apps/desktop/electron/companion.ts` | Facade used by main: ensure/ready/retry, sessions, chat stream, shutdown |
| `apps/desktop/electron/main.ts` | IPC + `before-quit` also shuts companion |
| `apps/desktop/electron/preload.ts` | Companion IPC on `window.lifequest` |
| `apps/desktop/src/vite-env.d.ts` | Types |
| `apps/desktop/src/state/CompanionProvider.tsx` | Status + ensure on boot |
| `apps/desktop/src/components/hermes/CompanionSetupScreen.tsx` | First-run gate UI |
| `apps/desktop/src/components/hermes/ChatPanel.tsx` | Session client |
| `apps/desktop/src/components/settings/SettingsHermes.tsx` | Companion status |
| `apps/desktop/src/App.tsx` | Gate routes until `ready` |
| `apps/desktop/tests/companion-profile.test.ts` | Profile helpers |
| `apps/desktop/tests/companion-lifecycle.test.ts` | Attach/start/quit/capabilities |
| `apps/desktop/tests/companion-client.test.ts` | Instructions + SSE |
| `apps/desktop/tests/companion-shell.test.ts` | Source asserts: gate, chat, settings, no planner in ChatPanel |

---

## Task 1: Profile helpers

**Files:**
- Create: `apps/desktop/electron/companion-profile.ts`
- Test: `apps/desktop/tests/companion-profile.test.ts`

**Interfaces:**
- Produces: `PROFILE_NAME`, `DEFAULT_API_PORT`, `RESERVED_PORTS`, `MCP_URL`, `COMPANION_SOUL`, `hermesRoot`, `profileDir`, `upsertEnv`, `readEnv`, `ensureMcpServer`, `shouldSeedSoul`, `nextFreePort`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPANION_SOUL,
  DEFAULT_API_PORT,
  MCP_URL,
  PROFILE_NAME,
  RESERVED_PORTS,
  ensureMcpServer,
  hermesRoot,
  nextFreePort,
  profileDir,
  readEnv,
  shouldSeedSoul,
  upsertEnv,
} from "../electron/companion-profile.ts";

describe("companion-profile", () => {
  it("names the lifequest profile and reserved ports", () => {
    assert.equal(PROFILE_NAME, "lifequest");
    assert.equal(DEFAULT_API_PORT, 8644);
    assert.deepEqual([...RESERVED_PORTS], [8642, 8643]);
    assert.equal(MCP_URL, "http://127.0.0.1:8643/mcp");
    assert.match(COMPANION_SOUL, /LifeQuest companion/);
    assert.match(COMPANION_SOUL, /LOCKED/);
    assert.match(COMPANION_SOUL, /get_doctrine/);
  });

  it("resolves hermes root from HERMES_HOME or homedir", () => {
    assert.equal(
      hermesRoot({ HERMES_HOME: "D:\\\\data\\\\hermes" }, "C:\\\\Users\\\\x"),
      "D:\\\\data\\\\hermes",
    );
    assert.ok(hermesRoot({}, "C:\\\\Users\\\\x").endsWith(".hermes"));
  });

  it("walks up when HERMES_HOME is already a named profile", () => {
    const root = hermesRoot(
      { HERMES_HOME: "C:\\\\Users\\\\x\\\\.hermes\\\\profiles\\\\coder" },
      "C:\\\\Users\\\\x",
    );
    assert.ok(root.endsWith(".hermes"));
    assert.equal(root.includes("profiles"), false);
  });

  it("puts the profile under profiles/lifequest", () => {
    assert.ok(profileDir("/tmp/.hermes").replace(/\\\\/g, "/").endsWith("profiles/lifequest"));
  });

  it("upserts env keys without dropping others", () => {
    const next = upsertEnv("FOO=1\\nAPI_SERVER_PORT=1\\n", {
      API_SERVER_ENABLED: "true",
      API_SERVER_PORT: "8644",
      API_SERVER_KEY: "secret",
    });
    const map = readEnv(next);
    assert.equal(map.FOO, "1");
    assert.equal(map.API_SERVER_PORT, "8644");
    assert.equal(map.API_SERVER_KEY, "secret");
    assert.equal(map.API_SERVER_ENABLED, "true");
  });

  it("merges mcp_servers.lifequest without clobbering siblings", () => {
    const existing = "mcp_servers:\\n  github:\\n    command: npx\\n";
    const next = ensureMcpServer(existing, "lifequest", MCP_URL);
    assert.match(next, /github:/);
    assert.match(next, /lifequest:/);
    assert.match(next, /127\\.0\\.0\\.1:8643\\/mcp/);
    const again = ensureMcpServer(next, "lifequest", MCP_URL);
    assert.equal((again.match(/lifequest:/g) ?? []).length, 1);
  });

  it("seeds soul only when missing or empty", () => {
    assert.equal(shouldSeedSoul(null), true);
    assert.equal(shouldSeedSoul(""), true);
    assert.equal(shouldSeedSoul("   \\n"), true);
    assert.equal(shouldSeedSoul("You are already named."), false);
  });

  it("never picks 8642 or 8643 as the companion port", () => {
    assert.equal(nextFreePort(new Set([8644]), 8644), 8645);
    assert.equal(nextFreePort(new Set([8642, 8643, 8644]), 8642), 8645);
  });
});
```

(Use real newlines in the test file, not `\\n` in strings except where the source string contains a newline.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --prefix apps/desktop node --experimental-strip-types --test apps/desktop/tests/companion-profile.test.ts` from repo root (or `npm test` in `apps/desktop` once the file exists).

Expected: FAIL — module not found.

- [ ] **Step 3: Write `companion-profile.ts`**

Constants:

```ts
export const PROFILE_NAME = "lifequest";
export const DEFAULT_API_PORT = 8644;
export const RESERVED_PORTS = [8642, 8643] as const;
export const MCP_URL = "http://127.0.0.1:8643/mcp";
export const COMPANION_SOUL = `You are the LifeQuest companion. Help the user set up and use LifeQuest: vaults, domains, Why → What → How, Life Map, Architecture, tasks, and the agent lock. Prefer LifeQuest MCP tools (lifequest) for map and task changes. If a tool returns LOCKED, tell the user the map is locked and do not retry writes. Do not rewrite Why, What, or How; use get_doctrine to read them. Do not flip the agent lock. You also exist in Hermes Desktop and other channels on this same profile — stay consistent.
`;
```

`hermesRoot(env, homedir)`: if `env.HERMES_HOME` is set, normalize slashes; if the path contains `profiles/<segment>` as its tail (`/profiles/` followed by one name, no further segments), return the parent of `profiles`; else return `HERMES_HOME`. If unset, `path.join(homedir, ".hermes")`.

`profileDir(root)`: `path.join(root, "profiles", PROFILE_NAME)`.

`upsertEnv`: parse lines `KEY=VALUE`, skip blanks and comments when matching keys, replace or append.

`readEnv`: same parse → `Record<string, string>`.

`ensureMcpServer(yaml, name, url)`:
- If yaml already has a `lifequest:` key under an `mcp_servers:` block, return yaml unchanged.
- If `mcp_servers:` exists, insert two-space indented:

```yaml
  lifequest:
    url: http://127.0.0.1:8643/mcp
```

immediately after the `mcp_servers:` line.
- Else append a new block at end of file (ensure trailing newline before):

```yaml
mcp_servers:
  lifequest:
    url: http://127.0.0.1:8643/mcp
```

`shouldSeedSoul(existing)`: true when `existing` is null or `existing.trim() === ""`.

`nextFreePort(taken, start)`: increment from `start` skipping any port in `taken` or `RESERVED_PORTS`, return first free. Cap search at start+100; if none, still skip reserved and return start+100 if not reserved.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```
git add apps/desktop/electron/companion-profile.ts apps/desktop/tests/companion-profile.test.ts
git commit -m "feat(desktop): add lifequest Hermes profile helpers"
```

---

## Task 2: Lifecycle (attach vs start)

**Files:**
- Create: `apps/desktop/electron/companion-lifecycle.ts`
- Test: `apps/desktop/tests/companion-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers
- Produces: `CompanionStatus`, `CompanionRuntime`, `capabilitiesSupportSessions(payload)`, `choosePort(envText, isPortFree)`, `shouldStopChild(startedByUs, childPid, listeningPid)`

Inject IO via a `CompanionIo` object so tests do not spawn Hermes:

```ts
export type CompanionIo = {
  whichHermes: () => Promise<string | null>;
  readFile: (p: string) => Promise<string | null>;
  writeFile: (p: string, body: string) => Promise<void>;
  mkdirp: (p: string) => Promise<void>;
  isPortFree: (port: number) => Promise<boolean>;
  health: (port: number) => Promise<boolean>;
  capabilities: (port: number, key: string) => Promise<unknown | null>;
  spawnGateway: (cli: string, profileDir: string) => Promise<{ pid: number }>;
  stopPid: (pid: number) => Promise<void>;
  listeningPid: (port: number) => Promise<number | null>;
};
```

- [ ] **Step 1: Failing tests**

Cover:

1. `capabilitiesSupportSessions` true when `features.session_chat_stream` or `endpoints.session_chat_stream` or nested `features.chat_stream` / `session_*` flags from spec (`session_list` + chat stream). Treat payload as supporting sessions when `features` has `session_chat_stream === true` OR (`features.session_list === true` and (`features.session_chat_stream === true` OR `endpoints.session_chat_stream` is a string)). Also accept `{ features: { session_list: true, chat_stream: true } }` if that is what we document in the client. **Lock this:** `capabilitiesSupportSessions` returns true iff JSON has `features.session_list === true` AND (`features.session_chat_stream === true` OR `features.chat_stream === true` OR typeof `endpoints.session_chat_stream` === "string").
2. `choosePort`: env `API_SERVER_PORT=8644` and 8644 free → 8644; 8644 taken → 8645 (or next free not 8642/8643).
3. `shouldStopChild(true, 10, 10)` true; `shouldStopChild(true, 10, 99)` false; `shouldStopChild(false, 10, 10)` false; `shouldStopChild(true, 10, null)` false.
4. `ensureCompanion(io)` when `whichHermes` null → `{ kind: "needs_install" }` and does not spawn.
5. When CLI present, health 200 and capabilities ok → `{ kind: "ready", startedByLifeQuest: false }` and `spawnGateway` not called.
6. When CLI present, health down → spawn, then health 200 → `{ kind: "ready", startedByLifeQuest: true }`.
7. Capabilities missing session flags after attach → `{ kind: "hermes_too_old" }`.
8. `shutdownCompanion(state)` calls `stopPid` only when `shouldStopChild` is true.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement lifecycle**

`ensureCompanion` algorithm:

1. `cli = await whichHermes()`; if null return `needs_install`.
2. `root = hermesRoot(process.env, homedir)`; `dir = profileDir(root)`.
3. `mkdirp(dir)`.
4. Read `.env`; if write fails, `profile_error`.
5. Generate `API_SERVER_KEY` with `crypto.randomBytes(24).toString("hex")` if missing.
6. `port = choosePort(envText, isPortFree)` starting at parsed `API_SERVER_PORT` or 8644.
7. Upsert `.env`: `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, `API_SERVER_PORT`, `API_SERVER_KEY`. Write. On throw → `profile_error` with path.
8. Read `config.yaml` (empty if missing); `ensureMcpServer`; write.
9. Read `SOUL.md`; if `shouldSeedSoul`, write `COMPANION_SOUL`.
10. If `health(port)`: attach. Else `spawnGateway(cli, dir)` then poll health (tests: fake health becomes true after spawn). If still down → `gateway_exited`.
11. `caps = capabilities(port, key)`; if not `capabilitiesSupportSessions` → `hermes_too_old`.
12. Return `ready` with port, flag, profilePath, cliPath.

Do not implement real `net`/`child_process` in this task beyond types; the facade in Task 4 supplies real IO. This module stays injectable.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** `feat(desktop): attach or start lifequest Hermes gateway`

---

## Task 3: Sessions client (pure)

**Files:**
- Create: `apps/desktop/electron/companion-client.ts`
- Test: `apps/desktop/tests/companion-client.test.ts`

**Interfaces:**
- Produces: `CompanionInstructionsInput`, `buildInstructions(input)`, `parseSseBlock(raw)`, `mapStreamEvent(evt)`, `HermesSession`, `ChatStreamEvent`

```ts
export type CompanionInstructionsInput = {
  domainName: string | null;
  domainSlug: string | null;
  aboutMe: string;
  locked: boolean;
  vaultOpen: boolean;
};

export type ChatStreamEvent =
  | { type: "assistant.delta"; text: string }
  | { type: "tool.started"; name: string }
  | { type: "tool.completed"; name: string; ok: boolean }
  | { type: "approval.request"; runId: string; requestId: string; summary: string }
  | { type: "run.completed" }
  | { type: "error"; message: string };
```

- [ ] **Step 1: Failing tests**

- `buildInstructions` includes domain name/slug when set, `About me:`, `Agent lock: true|false`, `Vault: open|closed`. Does **not** include the strings `Why` / `What` / `How` as doctrine bodies (allow the words only if they appear in About me). Pass aboutMe `"I like tea"` and assert no `## Why`.
- `parseSseBlock` of `event: assistant.delta\ndata: {"text":"Hi"}\n` maps to `{ type: "assistant.delta", text: "Hi" }`.
- Also accept `data: {"type":"assistant.delta","text":"Hi"}` with no event line.
- `tool.started` / `tool.completed` from `event: tool.started` + data `{ "name": "get_state" }`.
- Unknown event → ignore (`null`).
- `event: error` → `{ type: "error", message }`.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

`buildInstructions`:

```
You are chatting inside the LifeQuest app.
Active domain: {name} ({slug}) | none
About me: {aboutMe or "(empty)"}
Agent lock: {true|false}
Vault: open | closed
LifeQuest MCP server name is lifequest. Use it for map and task changes. If a tool returns LOCKED, tell the user the map is locked.
```

SSE: split on `\n\n`; parse `event:` and `data:`; JSON parse data; map as tests require. If `data.type` is set, prefer it.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat(desktop): parse Hermes session stream events`

---

## Task 4: Facade + IPC + quit

**Files:**
- Create: `apps/desktop/electron/companion.ts`
- Modify: `apps/desktop/electron/main.ts` (IPC + before-quit)
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`

**Interfaces:**
- Produces IPC:

```
companion:ensure → CompanionStatus
companion:status → CompanionStatus
companion:sessionsList → Result<HermesSession[]>
companion:sessionCreate → Result<HermesSession>
companion:sessionMessages → Result<{ role: string; content: string }[]>
companion:chatStream  (renderer sends { sessionId, input, instructions }; main POSTs stream and emits companion:stream on the sender)
companion:approval { runId, requestId, allow: boolean }
companion:openProfileFolder
```

`HermesSession`: `{ id: string; title: string }`.

Real IO in `companion.ts`:
- `whichHermes`: `where hermes` / `where hermes.cmd` on win32, `command -v hermes` else; take first line; null if empty/error.
- `health`: GET `http://127.0.0.1:{port}/health` 800ms timeout, ok if 2xx.
- `capabilities`: GET `/v1/capabilities` with `Authorization: Bearer {key}`.
- `spawnGateway`: `spawn(cli, ["-p", "lifequest", "gateway"], { env: { ...process.env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })`. Do not set `HERMES_HOME` (CLI `-p` owns it).
- Port free: try `net.createServer().listen(port, "127.0.0.1")` then close.
- Chat stream: POST `/api/sessions/{id}/chat/stream` with JSON `{ input, instructions }`, header Authorization, read SSE, send `companion:stream` events to `event.sender`.
- Persist last session id in `app.getPath("userData")` file `companion-session.json` `{ lastSessionId: string }`.

`before-quit`: `event.preventDefault()` already exists; chain `stopCompanion()` then `stopMcp()` then `app.exit(0)`.

- [ ] **Step 1: Source/unit tests in `companion-shell.test.ts` (partial)** asserting `main.ts` registers `companion:ensure` and `before-quit` mentions companion stop. This file grows in later tasks. Write the main/preload assertions first so they fail.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement facade + IPC + types**

Chat stream body: `{ input, instructions }` as spec. If Hermes expects `{ prompt }` instead, try `input` first (documented Sessions API).

Session create title: `LifeQuest` if no vault name passed; IPC `companion:sessionCreate` accepts optional `{ title: string }`.

- [ ] **Step 4: `npm test` in apps/desktop and `npm run typecheck` PASS**

- [ ] **Step 5: Commit** `feat(desktop): expose companion Sessions API over IPC`

---

## Task 5: First-run gate

**Files:**
- Create: `apps/desktop/src/state/CompanionProvider.tsx`
- Create: `apps/desktop/src/components/hermes/CompanionSetupScreen.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/tests/companion-shell.test.ts`

**Interfaces:**
- Consumes: `companionEnsure`, `companionStatus`
- Provider value: `{ status, ensuring, error, retry }`

- [ ] **Step 1: Failing source tests**

`companion-shell.test.ts`:
- `App.tsx` imports `CompanionProvider` and `CompanionSetupScreen`.
- `CompanionSetupScreen.tsx` contains `needs_install` copy (install Hermes) and a Recheck control.
- `App.tsx` does not render `AppRoutes` (or Welcome) until companion is ready — assert `CompanionSetupScreen` is used when status is not ready.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

`CompanionProvider` on mount calls `api().companionEnsure()`. `retry` calls it again.

`App.tsx`: wrap inside HashRouter with CompanionProvider. If `status.kind !== "ready"`, render titlebar + `CompanionSetupScreen`. Else existing routes.

Setup screen statuses:
- `needs_install`: official docs URL `https://hermes-agent.nousresearch.com/docs/` and Recheck.
- `profile_error`: message + path.
- `port_busy`: something else on the port; Recheck (lifecycle already picks next port on retry after writing `.env`).
- `gateway_exited`: stderr tail.
- `hermes_too_old`: upgrade Hermes.
- `disconnected` / `auth_error`: Recheck.
- while ensuring: “Connecting to your LifeQuest companion…”

Do not enter Welcome until `ready`.

- [ ] **Step 4: tests PASS**

- [ ] **Step 5: Commit** `feat(desktop): gate the shell on the lifequest companion`

---

## Task 6: Chat panel + Settings

**Files:**
- Modify: `apps/desktop/src/components/hermes/ChatPanel.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsHermes.tsx`
- Modify: `apps/desktop/tests/companion-shell.test.ts`
- Modify: `apps/desktop/src/components/settings/SettingsContent.tsx` only if needed (Hermes tab still renders SettingsHermes)

**Interfaces:**
- Chat uses `companionSessionsList`, `companionSessionCreate`, `companionSessionMessages`, `companionChatStream`, `onCompanionStream`
- Settings uses `companionStatus` / `companionEnsure` / `companionOpenProfileFolder`; MCP door block stays
- ChatPanel must **not** call `hermesChatTools`

- [ ] **Step 1: Failing source tests**

- `ChatPanel.tsx` includes `companionChatStream` or `companionSession` and does not include `hermesChatTools`.
- `SettingsHermes.tsx` includes `companionEnsure` or `companionStatus` and does not include the label `Base URL` as a required field (companion status, not arbitrary gateway form). Keep MCP door text.
- `SettingsHermes.tsx` includes “Open profile folder” or `companionOpenProfileFolder`.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement ChatPanel**

On open: `ensure` if needed; `sessionsList`; if `last` from list matching stored id (IPC can return last id on status, or list[0]); else `sessionCreate({ title: "LifeQuest" })`; `sessionMessages` → map to panel messages.

Subscribe `onCompanionStream`. Send: `companionChatStream({ sessionId, input })`. Main builds instructions from vault snapshot: ChatPanel should pass domain/about/lock/vaultOpen in the IPC payload so main does not need vault for chat — **lock this:** renderer sends `instructionsContext: { domainName, domainSlug, aboutMe, locked, vaultOpen }` and main runs `buildInstructions`. That keeps ChatPanel testable and main free of React.

Stream: append deltas to an in-progress assistant message; tool rows as muted lines `tool: {name}`; on `run.completed` call `refresh()` from `useVault` (no-op if no vault); on approval show Allow / Deny buttons calling `companionApproval`.

Composer disabled when companion status is not ready (ChatPanel only mounts in shell, which is after ready — still disable while `sending`).

Session header: select of sessions + New session.

- [ ] **Step 4: Implement SettingsHermes**

Replace URL/key form with:
- CLI path / missing
- Profile path
- Port
- Attached vs started by LifeQuest
- Last error
- Recheck (`companionEnsure`)
- Open profile folder
- MCP door (existing)

Do not delete vault key IPC; just stop using it on this page.

- [ ] **Step 5: tests + typecheck PASS**

- [ ] **Step 6: Commit** `feat(desktop): stream companion sessions in chat and settings`

---

## Task 7: Wire ChatPanel IPC types + stream listener in preload

If Task 4 missed `onCompanionStream`, add:

```ts
onCompanionStream: (cb: (evt: ChatStreamEvent) => void) => () => void
```

`ipcRenderer.on("companion:stream", ...)`.

Source-assert in `companion-shell.test.ts` that preload contains `companion:stream`.

Commit with Task 6 if already done; otherwise `fix(desktop): subscribe companion stream events in preload`.

---

## Self-review

- Spec first-run, ports, attach-or-start, Sessions API, SOUL seed, MCP merge, no vault transcripts, no planner fallback, Settings status, Chat panel, lock via MCP: Tasks 1–6.
- Hire/import, ACP, SOUL editor, Act dispatch: out of plan.
- Types: `CompanionStatus.kind` union used in provider, settings, setup screen.
- `RESERVED_PORTS` = 8642, 8643 everywhere.

## Execution

After this plan is saved, execute with subagent-driven-development or executing-plans (this work is tightly coupled; inline execution is acceptable). Work on a feature branch, not `master`.
