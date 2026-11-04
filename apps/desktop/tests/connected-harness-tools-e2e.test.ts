import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ALL_TOOL_DEFS,
  createPage,
  createSignal,
  createVault,
  effectiveGrant,
  listConnectedAgents,
  listDecisions,
  listSignals,
  projectCreate,
  resolveDecision,
  toolAllowed,
  updateConnectedAgent,
  type ConnectedAgent,
  type ConnectedGrant,
} from "@lifequest/vault-core";
import { startPairingDoors } from "../electron/pairing-door.ts";
import { ensureCompanionToken } from "../electron/pairing-secrets.ts";

/**
 * A connected agent's projects, pages and Life-Chain, end to end over the real
 * HTTP door, against a real vault on disk and the real `executeTool`.
 *
 * WHY THIS FILE EXISTS
 *
 * The projects, pages and signal tools shipped on 2026-10-27 for the companion
 * (`projects-tools-e2e.test.ts` covers that half) but were never classified in
 * `pairing-grant.ts`, so a connected agent with a domain grant was refused them
 * by name and never saw them in `tools/list` — even though the pairing design
 * already promised connected agents pages and projects. Classifying them is
 * only half a fix: each tool has to be projected per call, because a grant is
 * what decides which domains a record may come from, and `get_project` is one
 * read that reaches four surfaces at once.
 *
 * THE WAYS THIS LADDER COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 *   1. `tools/list` omits the tools (classification missing) or advertises a
 *      tool the per-call gate then refuses.
 *   2. A list keeps a row from an ungranted domain, or a project, page or
 *      signal with no domain — the companion's own records.
 *   3. A scoped list against an ungranted domain answers a successful empty
 *      list, which confirms the domain and its records exist.
 *   4. `get_project` collates a linked task or signal the agent may not read,
 *      a Decision whose domain list reaches outside the grant, or a log line
 *      from another domain.
 *   5. A capture of existing data is applied silently: `create_signal` with no
 *      domain, with an ungranted domain, or by a read-only agent.
 *   6. A write that was refused still lands, or a write that landed files no
 *      life-log line naming the roster agent.
 *   7. Classifying the tools narrows the companion's own surface.
 *
 * Artifact: `e2e/artifacts/connected-harness-tools.json` — the scenarios, the
 * ids and the bodies the door actually answered. The assertions run on the JSON
 * this run wrote.
 *
 * Runs under `node --experimental-strip-types --test
 * tests/connected-harness-tools-e2e.test.ts`, which needs no Electron and no dev
 * server. The live app's 8643/8646 are never touched.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/connected-harness-tools.json");

/** Test ports. The live app owns 8643 and 8646; other rigs own their own pair. */
const LOCAL_PORT = 18_453;
const INVITE_PORT = 18_456;

type Auth = { bearer?: string; name?: string };
type Reply = { status: number; json: unknown; raw: string };

/**
 * One JSON-RPC call to the local door. Same framing as the pairing rig: the
 * door's refusals are plain JSON while a served MCP call comes back as one
 * `data:` frame.
 */
async function mcp(auth: Auth, method: string, params: unknown = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (auth.bearer !== undefined) headers.authorization = `Bearer ${auth.bearer}`;
  if (auth.name !== undefined) headers["x-lifequest-name"] = auth.name;
  const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}/mcp`, {
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

/** The names the door advertises to this caller. */
async function toolsList(auth: Auth): Promise<string[]> {
  const reply = await mcp(auth, "tools/list");
  return (
    ((reply.json as { result?: { tools?: { name: string }[] } } | undefined)?.result?.tools ?? []) as {
      name: string;
    }[]
  ).map((tool) => tool.name);
}

/** One tool call, with the tool's own JSON answer unwrapped. */
async function callTool(
  auth: Auth,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const reply = await mcp(auth, "tools/call", { name, arguments: args });
  const text = (
    reply.json as { result?: { content?: { text?: string }[] } } | undefined
  )?.result?.content?.[0]?.text;
  assert.notEqual(text, undefined, `${name}: the door returned no tool text: ${reply.raw.slice(0, 300)}`);
  try {
    return JSON.parse(text as string);
  } catch {
    return text;
  }
}

function errorCode(value: unknown): string | null {
  return (value as { error?: { code?: string } } | undefined)?.error?.code ?? null;
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  assert.ok(value !== null && typeof value === "object", `${label}: not a JSON object`);
  return value as Record<string, unknown>;
};

const has = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/** A body that cannot collide with a real one, for a caller nobody paired. */
const bearerFor = (label: string): string =>
  `rig-${label}-${"b".repeat(11)}-${label.length}`.padEnd(40, "x");

describe("connected agents read projects, pages and the Life-Chain inside their grant", () => {
  it("projects each new tool per call, and keeps the companion's surface whole", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-connected-harness-"));
    const vaultRoot = path.join(workDir, "vault");
    const secretsDir = path.join(workDir, "userData", "pairing-secrets");
    fs.mkdirSync(secretsDir, { recursive: true });

    const scenarios: { name: string; pass: boolean; detail: string | null }[] = [];
    const scenario = (name: string, pass: boolean, detail: string | null = null): void => {
      scenarios.push({ name, pass, detail });
      assert.equal(pass, true, `${name}: ${detail ?? "failed"}`);
    };

    const created = await createVault(vaultRoot, "Connected harness");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
    const vaultId = (created as { ok: true; value: { lifequest: { id: string } } }).value.lifequest.id;

    // ── the operator's own records, in and outside one domain ───────────────
    // A fresh vault seeds health, intellectual, emotional and financial. The
    // grant under test is financial, so health is a live domain the agent is
    // NOT assigned — which is the state every projection below has to hide.
    const financialProject = await projectCreate(vaultRoot, {
      title: "Budget app",
      domainSlug: "financial",
      stateNote: "Numbers first",
    });
    assert.equal(financialProject.ok, true, "the financial project fixture failed");
    const financialProjectId = (financialProject as { ok: true; value: { id: string } }).value.id;

    const healthProject = await projectCreate(vaultRoot, {
      title: "Health project",
      domainSlug: "health",
    });
    assert.equal(healthProject.ok, true, "the health project fixture failed");
    const healthProjectId = (healthProject as { ok: true; value: { id: string } }).value.id;

    const looseProject = await projectCreate(vaultRoot, { title: "Loose idea" });
    assert.equal(looseProject.ok, true, "the unassigned project fixture failed");
    const looseProjectId = (looseProject as { ok: true; value: { id: string } }).value.id;

    const financialPage = await createPage(vaultRoot, "financial", { title: "Budget board" });
    assert.equal(financialPage.ok, true, "the financial page fixture failed");
    const financialPageId = (financialPage as { ok: true; value: { id: string } }).value.id;
    const healthPage = await createPage(vaultRoot, "health", { title: "Health board" });
    assert.equal(healthPage.ok, true, "the health page fixture failed");
    const healthPageId = (healthPage as { ok: true; value: { id: string } }).value.id;

    const financialSignal = await createSignal(vaultRoot, {
      type: "idea",
      body: "Track every jar of coffee in the budget app",
      domainSlug: "financial",
    });
    assert.equal(financialSignal.ok, true, "the financial signal fixture failed");
    const financialSignalId = (financialSignal as { ok: true; value: { id: string } }).value.id;
    const healthSignal = await createSignal(vaultRoot, {
      type: "notice",
      body: "Sleep is the health project's first metric",
      domainSlug: "health",
    });
    assert.equal(healthSignal.ok, true, "the health signal fixture failed");
    const healthSignalId = (healthSignal as { ok: true; value: { id: string } }).value.id;
    const looseSignal = await createSignal(vaultRoot, {
      type: "thought",
      body: "An unassigned thought",
    });
    assert.equal(looseSignal.ok, true, "the unassigned signal fixture failed");
    const looseSignalId = (looseSignal as { ok: true; value: { id: string } }).value.id;

    const doors = await startPairingDoors({
      root: vaultRoot,
      vaultId,
      secretsDir,
      localPort: LOCAL_PORT,
      invitePort: INVITE_PORT,
    });
    try {
      assert.equal(doors.localError, null, `the local door did not bind: ${doors.localError}`);
      assert.equal(doors.inviteError, null, `the invite door did not bind: ${doors.inviteError}`);

      const roster = async (): Promise<ConnectedAgent[]> =>
        ((await listConnectedAgents(vaultRoot)) as unknown as { value: ConnectedAgent[] }).value;
      const pendingIds = async (): Promise<string[]> =>
        ((await listDecisions(vaultRoot)) as unknown as {
          value: { id: string; status: string }[];
        }).value
          .filter((decision) => decision.status === "pending")
          .map((decision) => decision.id);
      const grantOf = async (agent: ConnectedAgent): Promise<ConnectedGrant> =>
        (await effectiveGrant(vaultRoot, agent)) as unknown as ConnectedGrant;
      const allowedByGrant = (grant: ConnectedGrant): string[] =>
        ALL_TOOL_DEFS.filter((tool) => toolAllowed(tool.name, grant) === "allow")
          .map((tool) => tool.name)
          .sort();

      // ── the companion keeps its whole surface ────────────────────────────
      const companion = await ensureCompanionToken(secretsDir, vaultId);
      const companionTools = await toolsList({ bearer: companion });
      scenario(
        "companion-surface-whole",
        companionTools.length === ALL_TOOL_DEFS.length,
        `the companion sees ${companionTools.length} of ${ALL_TOOL_DEFS.length} tools`,
      );

      // ── pair one agent: introduce, approve, assign financial ─────────────
      const agentBearer = bearerFor("surfaces");
      const introduced = await callTool(
        { bearer: agentBearer, name: "surfaces" },
        "get_state",
        {},
      );
      assert.equal(errorCode(introduced), "PAIRING_PENDING", "a new bearer was not pending");
      const pending = await pendingIds();
      assert.equal(pending.length, 1, `the introduction filed ${pending.length} Decisions`);
      const approved = await resolveDecision(vaultRoot, pending[0]!, "approved");
      assert.equal(approved.ok, true, "approving the introduction failed");
      const agentRow = (await roster()).find((agent) => agent.name === "surfaces");
      assert.ok(agentRow, "the approved agent is not on the roster");
      const granted = await updateConnectedAgent(vaultRoot, agentRow.id, {
        domainSlugs: ["financial"],
      });
      assert.equal(granted.ok, true, "assigning the financial domain failed");
      const readRow = (await roster()).find((agent) => agent.name === "surfaces")!;
      const readGrant = await grantOf(readRow);

      const readTools = await toolsList({ bearer: agentBearer });
      const expectedRead = allowedByGrant(readGrant);
      scenario(
        "read-grant-tool-list",
        JSON.stringify(readTools.slice().sort()) === JSON.stringify(expectedRead) &&
          readTools.includes("list_projects") &&
          readTools.includes("get_project") &&
          readTools.includes("list_pages") &&
          readTools.includes("get_page") &&
          readTools.includes("list_signals") &&
          readTools.includes("get_signal") &&
          !readTools.includes("create_signal"),
        `a read grant advertised ${JSON.stringify(readTools.slice().sort())}`,
      );

      // ── 1. projects: lists omit, single reads answer NOT_FOUND ───────────
      const projects = asRecord(await callTool({ bearer: agentBearer }, "list_projects"), "list_projects");
      const projectRows = (projects.projects ?? []) as { id?: string; domainSlug?: string }[];
      scenario(
        "list-projects-in-grant-only",
        projects.total === 1 &&
          projectRows.length === 1 &&
          projectRows[0]?.id === financialProjectId &&
          projectRows[0]?.domainSlug === "financial",
        `list_projects answered ${JSON.stringify(projects).slice(0, 400)}`,
      );
      const projectScopedOut = await callTool(
        { bearer: agentBearer },
        "list_projects",
        { domainSlug: "health" },
      );
      scenario(
        "list-projects-scoped-outside-grant",
        errorCode(projectScopedOut) === "NOT_FOUND",
        `list_projects(health) answered ${JSON.stringify(projectScopedOut).slice(0, 300)}`,
      );

      const inGrantProject = asRecord(
        await callTool({ bearer: agentBearer }, "get_project", { id: financialProjectId }),
        "get_project",
      );
      scenario(
        "get-project-in-grant",
        inGrantProject.id === financialProjectId &&
          inGrantProject.title === "Budget app" &&
          inGrantProject.domainSlug === "financial",
        `get_project answered ${JSON.stringify(inGrantProject).slice(0, 300)}`,
      );
      scenario(
        "get-project-omits-board-without-schedule",
        !has(inGrantProject, "tasks") && !has(inGrantProject, "signals"),
        `get_project carried the board with Schedule off: keys ${JSON.stringify(Object.keys(inGrantProject))}`,
      );
      scenario(
        "get-project-log-in-grant",
        Array.isArray(inGrantProject.log) &&
          (inGrantProject.log as { type?: string }[]).some((line) => line.type === "project.created"),
        `get_project.log is ${JSON.stringify(inGrantProject.log).slice(0, 300)}`,
      );
      for (const [label, id] of [
        ["outside the grant", healthProjectId],
        ["with no domain", looseProjectId],
        ["that does not exist", "no-such-project"],
      ] as const) {
        const refused = await callTool({ bearer: agentBearer }, "get_project", { id });
        scenario(
          `get-project-${label.replace(/ /g, "-")}`,
          errorCode(refused) === "NOT_FOUND",
          `get_project answered ${JSON.stringify(refused).slice(0, 300)}`,
        );
      }

      // ── 2. pages: same projection ────────────────────────────────────────
      const pages = asRecord(await callTool({ bearer: agentBearer }, "list_pages"), "list_pages");
      const pageRows = (pages.pages ?? []) as { domainSlug?: string; page?: { id?: string } }[];
      scenario(
        "list-pages-in-grant-only",
        pages.total === 1 &&
          pageRows.length === 1 &&
          pageRows[0]?.domainSlug === "financial" &&
          pageRows[0]?.page?.id === financialPageId,
        `list_pages answered ${JSON.stringify(pages).slice(0, 400)}`,
      );
      const pagesScopedOut = await callTool(
        { bearer: agentBearer },
        "list_pages",
        { domainSlug: "health" },
      );
      scenario(
        "list-pages-scoped-outside-grant",
        errorCode(pagesScopedOut) === "NOT_FOUND",
        `list_pages(health) answered ${JSON.stringify(pagesScopedOut).slice(0, 300)}`,
      );
      const inGrantPage = asRecord(
        await callTool({ bearer: agentBearer }, "get_page", {
          domainSlug: "financial",
          pageId: financialPageId,
        }),
        "get_page",
      );
      scenario(
        "get-page-in-grant",
        (inGrantPage.page as { id?: string; title?: string } | undefined)?.id === financialPageId,
        `get_page answered ${JSON.stringify(inGrantPage).slice(0, 300)}`,
      );
      const pageOut = await callTool({ bearer: agentBearer }, "get_page", {
        domainSlug: "health",
        pageId: healthPageId,
      });
      scenario(
        "get-page-outside-grant",
        errorCode(pageOut) === "NOT_FOUND",
        `get_page(health) answered ${JSON.stringify(pageOut).slice(0, 300)}`,
      );

      // ── 3. Life-Chain: same projection, and no phantom totals ────────────
      const signals = asRecord(await callTool({ bearer: agentBearer }, "list_signals"), "list_signals");
      const signalRows = (signals.signals ?? []) as { id?: string; domainSlug?: string }[];
      scenario(
        "list-signals-in-grant-only",
        signals.total === 1 &&
          signalRows.length === 1 &&
          signalRows[0]?.id === financialSignalId &&
          signalRows[0]?.domainSlug === "financial",
        `list_signals answered ${JSON.stringify(signals).slice(0, 400)}`,
      );
      const signalsScopedOut = await callTool(
        { bearer: agentBearer },
        "list_signals",
        { domainSlug: "health" },
      );
      scenario(
        "list-signals-scoped-outside-grant",
        errorCode(signalsScopedOut) === "NOT_FOUND",
        `list_signals(health) answered ${JSON.stringify(signalsScopedOut).slice(0, 300)}`,
      );
      const inGrantSignal = asRecord(
        await callTool({ bearer: agentBearer }, "get_signal", { id: financialSignalId }),
        "get_signal",
      );
      scenario(
        "get-signal-in-grant",
        (inGrantSignal.signal as { id?: string } | undefined)?.id === financialSignalId,
        `get_signal answered ${JSON.stringify(inGrantSignal).slice(0, 300)}`,
      );
      for (const [label, id] of [
        ["outside the grant", healthSignalId],
        ["with no domain", looseSignalId],
        ["that does not exist", "no-such-signal"],
      ] as const) {
        const refused = await callTool({ bearer: agentBearer }, "get_signal", { id });
        scenario(
          `get-signal-${label.replace(/ /g, "-")}`,
          errorCode(refused) === "NOT_FOUND",
          `get_signal answered ${JSON.stringify(refused).slice(0, 300)}`,
        );
      }

      // A read grant cannot capture, and a refused capture writes nothing.
      const beforeRefusedCapture = ((await listSignals(vaultRoot)) as unknown as {
        value: { records: unknown[] };
      }).value.records.length;
      const readOnlyCapture = await callTool({ bearer: agentBearer }, "create_signal", {
        type: "idea",
        body: "Should never land",
        domainSlug: "financial",
      });
      const afterRefusedCapture = ((await listSignals(vaultRoot)) as unknown as {
        value: { records: unknown[] };
      }).value.records.length;
      scenario(
        "read-grant-cannot-capture",
        errorCode(readOnlyCapture) === "FORBIDDEN" && afterRefusedCapture === beforeRefusedCapture,
        `a read-only capture answered ${JSON.stringify(readOnlyCapture).slice(0, 300)} and left ${
          afterRefusedCapture - beforeRefusedCapture
        } records`,
      );

      // ── 4. turn Write and Schedule on: the capture applies, the board is
      //      collated, and every crossing record is projected away ──────────
      const writeGranted = await updateConnectedAgent(vaultRoot, readRow.id, {
        access: "write",
        schedule: true,
      });
      assert.equal(writeGranted.ok, true, "turning Write and Schedule on failed");
      const writeRow = (await roster()).find((agent) => agent.name === "surfaces")!;
      const writeGrant = await grantOf(writeRow);
      const writeTools = await toolsList({ bearer: agentBearer });
      scenario(
        "write-grant-advertises-capture",
        JSON.stringify(writeTools.slice().sort()) === JSON.stringify(allowedByGrant(writeGrant)) &&
          writeTools.includes("create_signal"),
        `a write grant advertised ${JSON.stringify(writeTools.slice().sort())}`,
      );

      // The companion files two project Decisions: one that stays in financial
      // and one that would move the project to health. Only the first may be
      // collated for the agent.
      const inGrantDecision = asRecord(
        await callTool({ bearer: companion }, "update_project", {
          id: financialProjectId,
          nextAction: "Draft the ledger schema",
        }),
        "update_project",
      );
      const crossDomainDecision = asRecord(
        await callTool({ bearer: companion }, "update_project", {
          id: financialProjectId,
          domainSlug: "health",
        }),
        "update_project",
      );
      const inGrantDecisionId = String(inGrantDecision.decisionId ?? "");
      const crossDomainDecisionId = String(crossDomainDecision.decisionId ?? "");
      assert.ok(inGrantDecisionId && crossDomainDecisionId, "the project Decisions were not filed");

      // Two tasks on the project: one links the in-grant signal, one the health
      // signal. Both are the board (Schedule), which is on now.
      const taskOne = asRecord(
        await callTool({ bearer: agentBearer }, "create_task", {
          title: "Price the ledger",
          column: "today",
          links: { projectId: financialProjectId, signalId: financialSignalId },
        }),
        "create_task",
      );
      const taskTwo = asRecord(
        await callTool({ bearer: agentBearer }, "create_task", {
          title: "Ask about sleep metrics",
          column: "today",
          links: { projectId: financialProjectId, signalId: healthSignalId },
        }),
        "create_task",
      );
      // Each write answers with the whole projected board, so the second call
      // already carries the first task: the ids are de-duplicated and the
      // titles are what prove both writes landed.
      const boardTasks = (value: unknown): { id: string; title: string; origin?: string }[] =>
        ((value as { state?: { tasks?: { id: string; title: string; origin?: string }[] } } | undefined)
          ?.state?.tasks ?? []);
      const tasksAfterTwo = boardTasks(taskTwo);
      const taskIds = [...new Set([...boardTasks(taskOne), ...tasksAfterTwo].map((task) => task.id))];
      const taskTitles = tasksAfterTwo.map((task) => task.title);
      scenario(
        "agent-created-tasks-applied",
        taskIds.length === 2 &&
          taskTitles.includes("Price the ledger") &&
          taskTitles.includes("Ask about sleep metrics") &&
          tasksAfterTwo.every((task) => task.origin === "agent"),
        `tasks: ${JSON.stringify(tasksAfterTwo).slice(0, 400)}`,
      );

      const collated = asRecord(
        await callTool({ bearer: agentBearer }, "get_project", { id: financialProjectId }),
        "get_project",
      );
      const collatedTasks = (collated.tasks ?? []) as { id?: string }[];
      const collatedSignals = (collated.signals ?? []) as { id?: string; domainSlug?: string }[];
      const collatedDecisions = (collated.decisions ?? []) as { id?: string }[];
      const decisionIds = collatedDecisions.map((decision) => decision.id);
      scenario(
        "get-project-collates-board-with-schedule",
        collatedTasks.length === 2 && collatedSignals.some((signal) => signal.id === financialSignalId),
        `tasks ${JSON.stringify(collatedTasks.map((task) => task.id))}, signals ${JSON.stringify(collatedSignals)}`,
      );
      scenario(
        "get-project-drops-cross-domain-signal",
        !collatedSignals.some((signal) => signal.id === healthSignalId),
        `a health signal was collated: ${JSON.stringify(collatedSignals).slice(0, 300)}`,
      );
      scenario(
        "get-project-decisions-inside-grant-only",
        decisionIds.includes(inGrantDecisionId) && !decisionIds.includes(crossDomainDecisionId),
        `collated decisions: ${JSON.stringify(decisionIds)}`,
      );

      // ── 5. a capture applies at once, is attributed, and names its domain ─
      const pendingBeforeCapture = await pendingIds();
      const captured = asRecord(
        await callTool({ bearer: agentBearer }, "create_signal", {
          type: "idea",
          body: "Jars of coffee belong in a per-category column",
          title: "Coffee column",
          domainSlug: "financial",
        }),
        "create_signal",
      );
      const capturedSignal = captured.signal as { id?: string; domainSlug?: string; source?: string };
      const capturedId = String(capturedSignal?.id ?? "");
      scenario(
        "capture-applies-in-domain",
        capturedSignal?.domainSlug === "financial" &&
          capturedSignal?.source === "manual" &&
          capturedId.length > 0 &&
          (await pendingIds()).length === pendingBeforeCapture.length,
        `create_signal answered ${JSON.stringify(captured).slice(0, 300)}`,
      );
      const logLines = fs
        .readFileSync(path.join(vaultRoot, ".lifequest", "log.jsonl"), "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as { type?: string; payload?: { signalId?: string }; actor?: { type?: string; name?: string } });
      const captureLog = logLines.find(
        (line) => line.type === "signal.created" && line.payload?.signalId === capturedId,
      );
      scenario(
        "capture-logged-as-the-agent",
        captureLog?.actor?.type === "agent" && captureLog?.actor?.name === "surfaces",
        `the capture's log line is ${JSON.stringify(captureLog)}`,
      );

      // A capture with no domain, or outside the grant, is refused and writes
      // nothing — an unassigned signal is the companion's own record.
      const countSignals = async (): Promise<number> =>
        ((await listSignals(vaultRoot)) as unknown as { value: { records: unknown[] } }).value.records
          .length;
      const beforeRefusals = await countSignals();
      const noDomainCapture = await callTool({ bearer: agentBearer }, "create_signal", {
        type: "idea",
        body: "No domain capture",
      });
      const outsideCapture = await callTool({ bearer: agentBearer }, "create_signal", {
        type: "idea",
        body: "Outside capture",
        domainSlug: "health",
      });
      scenario(
        "capture-without-an-assigned-domain-refused",
        noDomainCapture !== null &&
          errorCode(noDomainCapture) === "FORBIDDEN" &&
          errorCode(outsideCapture) === "FORBIDDEN" &&
          (await countSignals()) === beforeRefusals,
        `refusals ${JSON.stringify({
          noDomain: errorCode(noDomainCapture),
          outside: errorCode(outsideCapture),
        })}, records ${(await countSignals()) - beforeRefusals}`,
      );

      // ── the artifact, and the assertions on the artifact itself ──────────
      const report = {
        pass: true,
        what:
          "A connected agent's projects, pages and Life-Chain over the real MCP door: temp vault, " +
          "real pairing door, real roster grant, real executeTool, real JSON-RPC tools/call",
        command:
          "cd apps/desktop && node --experimental-strip-types --test tests/connected-harness-tools-e2e.test.ts",
        doors: { local: doors.localPort, invite: doors.invitePort, livePorts: [8643, 8646] },
        vault: { id: vaultId, temp: true, seededDomains: ["health", "intellectual", "emotional", "financial"] },
        grant: {
          agent: "surfaces",
          domains: readGrant.domainSlugs,
          readTools: expectedRead.length,
          writeTools: allowedByGrant(writeGrant).length,
          of: ALL_TOOL_DEFS.length,
        },
        scenarios,
        ids: {
          financialProjectId,
          healthProjectId,
          looseProjectId,
          financialPageId,
          healthPageId,
          financialSignalId,
          healthSignalId,
          looseSignalId,
          capturedId,
          inGrantDecisionId,
          crossDomainDecisionId,
          taskIds,
        },
        bodies: {
          listProjects: projects,
          listPages: pages,
          listSignals: signals,
          projectInGrant: inGrantProject,
          projectCollated: collated,
          capture: captured,
        },
        generatedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);

      const written = JSON.parse(fs.readFileSync(ARTIFACT, "utf8")) as typeof report;
      assert.equal(written.pass, true);
      assert.deepEqual(
        written.scenarios.filter((entry) => !entry.pass),
        [],
        "the written artifact carries a failed scenario",
      );
      assert.equal(written.ids.financialProjectId, financialProjectId);
      assert.equal(written.ids.capturedId, capturedId);
      assert.ok(written.bodies.projectCollated.tasks, "the artifact's collated project lost its tasks");
    } finally {
      await doors.close();
    }

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
