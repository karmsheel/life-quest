import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createPage,
  createVault,
  listDecisions,
  listDomains,
  loadGoals,
  projectCreate,
  resolveDecision,
  unlockDomain,
} from "@lifequest/vault-core";
import { startPairingDoors } from "../electron/pairing-door.ts";
import { ensureCompanionToken } from "../electron/pairing-secrets.ts";

/**
 * Projects and the four harness fixes, as the companion really reaches them: a
 * temp vault on disk, the real pairing door on test ports, a real companion
 * bearer, and JSON-RPC `tools/call` over real HTTP. The door calls the real
 * `executeTool`; there is no stub between the request and the vault file.
 *
 * The request this rig is about: the companion could not answer "where are my
 * projects?". It had only create/close, `create_database` returned a
 * `decisionId` and took no columns, and there were no page or Life-Chain read
 * tools. Every claim below is one of the spec's acceptance clauses
 * (`docs/superpowers/specs/2026-10-27-projects-execute-wing-design.md`), read
 * back through the companion's own door:
 *
 *   1. `list_projects` on a fresh vault answers an empty list.
 *   2. `create_project` with every attribute files ONE Decision and writes no
 *      file; after approve, `list_projects` and `get_project` carry every field.
 *      The idea-provenance fields (type, source, source link) survive the file
 *      round trip even when their text would read as YAML (`[]`, `true`), an
 *      invalid `sourceUrl` is refused by name and writes nothing, and
 *      `list_projects` filters by type case-insensitively. The `repoUrls` list
 *      is written as a YAML block sequence, read back in order by both reads,
 *      replaced whole by an update, and an entry that is not an absolute
 *      http(s) URL is refused by its field and index.
 *   3. `update_project` with `stateNote` + `addUpdate` files a Decision; after
 *      approve the progress percent and the timeline entry are there.
 *   4. `close_project` files a Decision; after approve the status is `closed`.
 *   5. A task created with `links.projectId` is collated by `get_project`; a
 *      signal created by `create_signal` and linked from that task is collated
 *      too.
 *   6. `create_database` with three columns is ONE call: it returns
 *      `applied: true`, the `databaseId` and `columns: 3`, the database and all
 *      three columns exist immediately (adding data writes at once, 2026-10-28),
 *      and it files no Decision.
 *   7. `list_pages` / `get_page` read a page the operator created.
 *   8. `list_signals` / `get_signal` / `create_signal` round-trip.
 *
 * The ways this ladder could fail are the steps below: a write that lands
 * before approval, an approve that only half-applies, an attribute the tools
 * accept but never read back, collated context that is assembled from the
 * wrong link, or a tool that exists in the spec but not on the door.
 *
 * Artifact: `e2e/artifacts/projects-tools.json` — pass/fail, the scenario list,
 * the ids, and the bodies the door actually answered. The assertions run on the
 * same JSON this run wrote.
 *
 * Runs under `node --experimental-strip-types --test
 * tests/projects-tools-e2e.test.ts`, which needs no Electron and no dev server.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/projects-tools.json");

/** Test ports. The live app owns 8643 and 8646; this run must not touch them. */
const LOCAL_PORT = 18_443;
const INVITE_PORT = 18_446;

type Auth = { bearer?: string };
type Reply = { status: number; json: unknown; raw: string };

/** The exact companion tools this feature adds or fixes. */
const PROJECT_TOOLS = ["list_projects", "get_project", "create_project", "update_project", "close_project"];
const HARNESS_TOOLS = [
  "create_database",
  "list_pages",
  "get_page",
  "list_signals",
  "get_signal",
  "create_signal",
];
const EXPECTED_TOOLS = [...PROJECT_TOOLS, ...HARNESS_TOOLS];

/**
 * One JSON-RPC call to the local door. Same framing as the pairing rig: the door
 * answers a served MCP call as one `data:` frame.
 */
let rpcId = 0;
async function mcp(auth: Auth, method: string, params: unknown = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (auth.bearer !== undefined) headers.authorization = `Bearer ${auth.bearer}`;
  rpcId += 1;
  const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
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

/** One tool call, with the tool's own JSON answer unwrapped from the MCP text. */
async function callTool(
  bearer: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const reply = await mcp({ bearer }, "tools/call", { name, arguments: args });
  assert.equal(reply.status, 200, `${name}: the door answered HTTP ${reply.status}: ${reply.raw.slice(0, 200)}`);
  const text = (reply.json as { result?: { content?: { text?: string }[] } } | undefined)?.result
    ?.content?.[0]?.text;
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

/** Every decision from one target type, so an approve can be counted. */
async function pendingFor(root: string, targetType: string): Promise<{ id: string; target: unknown }[]> {
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
  return (listed.ok ? listed.value : [])
    .filter((decision) => decision.status === "pending" && decision.target.type === targetType)
    .map((decision) => ({ id: decision.id, target: decision.target }));
}

const projectFiles = (root: string): string[] => {
  const dir = path.join(root, "projects");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".md"));
};

describe("projects and harness tools over the real MCP door", () => {
  it("walks create → approve → read, addUpdate, close, link, database, pages and signals", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-projects-tools-"));
    const vaultRoot = path.join(workDir, "vault");
    const secretsDir = path.join(workDir, "userData", "pairing-secrets");
    fs.mkdirSync(secretsDir, { recursive: true });

    const scenarios: { name: string; pass: boolean; detail: string | null }[] = [];
    const scenario = (name: string, pass: boolean, detail: string | null = null): void => {
      scenarios.push({ name, pass, detail });
      assert.equal(pass, true, `${name}: ${detail ?? "failed"}`);
    };

    const created = await createVault(vaultRoot, "Projects E2E");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
    const vaultId = (created as { ok: true; value: { lifequest: { id: string } } }).value.lifequest.id;

    // This rig projects into the seeded Health and Finance areas, so both are
    // unlocked before the door opens.
    for (const area of ["health", "financial"]) {
      const unlock = await unlockDomain(vaultRoot, area);
      assert.equal(unlock.ok, true, `unlockDomain(${area}) failed: ${unlock.ok ? "" : unlock.error}`);
    }

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
      scenario("door-bound", true, `local ${doors.localPort}, invite ${doors.invitePort}`);

      const bearer = await ensureCompanionToken(secretsDir, vaultId);

      // ── the tool surface the companion is promised ────────────────────────
      const list = await mcp({ bearer }, "tools/list");
      assert.equal(list.status, 200);
      const toolNames = (
        (list.json as { result?: { tools?: { name: string }[] } } | undefined)?.result?.tools ?? []
      ).map((tool) => tool.name);
      const missing = EXPECTED_TOOLS.filter((name) => !toolNames.includes(name));
      scenario("tools-present", missing.length === 0, `missing from tools/list: ${missing.join(", ")}`);

      // ── 1. a fresh vault has no projects ──────────────────────────────────
      const empty = asRecord(await callTool(bearer, "list_projects", {}), "list_projects");
      scenario(
        "list-projects-empty",
        Array.isArray(empty.projects) && empty.projects.length === 0 && empty.total === 0,
        `fresh vault answered ${JSON.stringify(empty).slice(0, 200)}`,
      );

      // ── a live goal and domain for the project to name ────────────────────
      // The companion files the goal Decision and the operator approves it: the
      // same write path this file then tests for projects. The goal id is minted
      // on apply, so it is read back from the store rather than assumed.
      const filedGoal = asRecord(
        await callTool(bearer, "create_goal", {
          name: "Make Projects first-class",
          domainSlug: "health",
        }),
        "create_goal",
      );
      const goalDecisionId = String(filedGoal.decisionId ?? "");
      assert.ok(goalDecisionId, "create_goal filed no Decision");
      const approvedGoal = await resolveDecision(vaultRoot, goalDecisionId, "approved");
      assert.equal(approvedGoal.ok, true, `approving the goal failed: ${approvedGoal.ok ? "" : approvedGoal.error}`);
      const goals = await loadGoals(vaultRoot);
      assert.equal(goals.ok, true);
      const goalId = (goals.ok ? goals.value : []).find((goal) => goal.name === "Make Projects first-class")?.id;
      assert.ok(goalId, "the approved goal is not in the goals store");
      const liveDomains = await listDomains(vaultRoot);
      assert.equal(liveDomains.ok, true);
      assert.ok(
        (liveDomains.ok ? liveDomains.value : []).some((domain) => domain.slug === "health" && !domain.meta.archivedAt),
        "the health seed domain is not live",
      );

      // ── 2. create with every attribute → ONE Decision, no file ───────────
      const CREATE_ARGS = {
        title: "Ship the Execute wing",
        summary: "Move Projects to Execute and make it agent-readable",
        projectType: "Mobile App",
        source: "A friend's recommendation",
        sourceUrl: "https://example.com/ideas/execute-wing",
        repoUrls: [
          "https://github.com/karmsheel/life-quest",
          "https://gitlab.com/karmsheel/vault-core",
        ],
        stateNote: "Kickoff done; the tools are half-written",
        goalId,
        domainSlug: "health",
        body: "## Context\n\nThis is the project's context document.",
        status: "active",
        priority: "high",
        startDate: "2026-10-01",
        targetDate: "2026-12-31",
        progress: 25,
        nextAction: "Land the companion tools",
      };
      const createFiled = asRecord(await callTool(bearer, "create_project", CREATE_ARGS), "create_project");
      const createDecisionId = String(createFiled.decisionId ?? "");
      scenario(
        "create-project-decision",
        createFiled.status === "pending" && createDecisionId.length > 0,
        `create_project answered ${JSON.stringify(createFiled).slice(0, 240)}`,
      );
      scenario(
        "create-project-writes-nothing",
        projectFiles(vaultRoot).length === 0,
        `the vault already has project files before approval: ${JSON.stringify(projectFiles(vaultRoot))}`,
      );
      const pendingProjects = await pendingFor(vaultRoot, "project");
      scenario(
        "create-project-one-decision",
        pendingProjects.length === 1,
        `${pendingProjects.length} pending project Decisions for one create`,
      );

      const approveCreate = await resolveDecision(vaultRoot, createDecisionId, "approved");
      assert.equal(
        approveCreate.ok,
        true,
        `approving the project failed: ${approveCreate.ok ? "" : approveCreate.error}`,
      );
      const createdFiles = projectFiles(vaultRoot);
      scenario("create-project-approve", createdFiles.length === 1, `project files: ${JSON.stringify(createdFiles)}`);

      const listed = asRecord(await callTool(bearer, "list_projects", {}), "list_projects");
      const entries = (listed.projects ?? []) as Record<string, unknown>[];
      const projectId = String(entries[0]?.id ?? "");
      assert.ok(projectId, `list_projects returned no project id: ${JSON.stringify(listed).slice(0, 300)}`);
      scenario(
        "list-projects-row",
        listed.total === 1 &&
          entries.length === 1 &&
          entries[0]?.title === CREATE_ARGS.title &&
          entries[0]?.summary === CREATE_ARGS.summary &&
          entries[0]?.projectType === CREATE_ARGS.projectType &&
          entries[0]?.source === CREATE_ARGS.source &&
          entries[0]?.sourceUrl === CREATE_ARGS.sourceUrl &&
          JSON.stringify(entries[0]?.repoUrls) === JSON.stringify(CREATE_ARGS.repoUrls) &&
          entries[0]?.stateNote === CREATE_ARGS.stateNote &&
          entries[0]?.status === "active" &&
          entries[0]?.priority === "high" &&
          entries[0]?.startDate === "2026-10-01" &&
          entries[0]?.targetDate === "2026-12-31" &&
          entries[0]?.progress === 25 &&
          entries[0]?.nextAction === "Land the companion tools" &&
          entries[0]?.goalId === goalId &&
          entries[0]?.domainSlug === "health",
        `list_projects answered ${JSON.stringify(entries[0]).slice(0, 400)}`,
      );
      scenario(
        "list-projects-compact",
        entries[0]?.bodyMarkdown === undefined && entries[0]?.updates === undefined,
        "list_projects carried the body or the timeline",
      );

      // ── get_project: the flat full record ────────────────────────────────
      const readCreate = asRecord(await callTool(bearer, "get_project", { id: projectId }), "get_project");
      const readAfterCreate = readCreate;
      scenario(
        "get-project-attributes",
        readCreate.id === projectId &&
          readCreate.title === CREATE_ARGS.title &&
          readCreate.summary === CREATE_ARGS.summary &&
          readCreate.projectType === CREATE_ARGS.projectType &&
          readCreate.source === CREATE_ARGS.source &&
          readCreate.sourceUrl === CREATE_ARGS.sourceUrl &&
          JSON.stringify(readCreate.repoUrls) === JSON.stringify(CREATE_ARGS.repoUrls) &&
          readCreate.stateNote === CREATE_ARGS.stateNote &&
          // The file's body gains the trailing newline the frontmatter
          // serializer writes; the content is what the tool must carry back.
          String(readCreate.bodyMarkdown).trimEnd() === CREATE_ARGS.body &&
          readCreate.goalId === goalId &&
          readCreate.domainSlug === "health" &&
          readCreate.status === "active" &&
          readCreate.priority === "high" &&
          readCreate.startDate === "2026-10-01" &&
          readCreate.targetDate === "2026-12-31" &&
          readCreate.progress === 25 &&
          readCreate.nextAction === "Land the companion tools" &&
          Array.isArray(readCreate.updates) &&
          Array.isArray(readCreate.tasks) &&
          Array.isArray(readCreate.signals) &&
          Array.isArray(readCreate.decisions) &&
          Array.isArray(readCreate.log),
        `get_project answered ${JSON.stringify(readCreate).slice(0, 500)}`,
      );
      scenario(
        "get-project-collates-create-decision",
        (readCreate.decisions as { id?: string; status?: string }[]).some(
          (decision) => decision.id === createDecisionId && decision.status === "approved",
        ),
        `the approved create Decision is not collated onto the project: ${JSON.stringify(
          readCreate.decisions,
        ).slice(0, 300)}`,
      );

      // The repositories are a YAML block sequence in the file itself, not a
      // one-line JSON array: the vault is the operator's, so the list has to be
      // readable there, and the read path hands the same order back.
      const createdProjectText = fs.readFileSync(
        path.join(vaultRoot, "projects", `${projectId}.md`),
        "utf8",
      );
      const expectedRepoBlock = `repoUrls:\n${CREATE_ARGS.repoUrls
        .map((url) => `  - ${url}`)
        .join("\n")}`;
      scenario(
        "repo-urls-yaml-list",
        createdProjectText.includes(expectedRepoBlock),
        `the project file's repository block is ${JSON.stringify(
          createdProjectText
            .split("\n")
            .filter((line) => line.includes("repoUrls") || /^\s*-\s/.test(line))
            .join("\n"),
        )}`,
      );

      // ── 2b. the idea-provenance fields ────────────────────────────────────
      // "[]" and "true" are the values that would read back as a YAML array or
      // boolean if the writer left them bare. The file itself must carry them
      // quoted, and both the compact list and the full read must hand the text
      // back as strings — that is the whole point of quoteTextScalar.
      const AWKWARD_TYPE = "[]";
      const AWKWARD_SOURCE = "true";
      const AWKWARD_URL = "https://example.com/ideas/awkward";
      const awkwardFiled = asRecord(
        await callTool(bearer, "create_project", {
          title: "Idea with awkward text",
          projectType: AWKWARD_TYPE,
          source: AWKWARD_SOURCE,
          sourceUrl: AWKWARD_URL,
        }),
        "create_project",
      );
      const awkwardDecisionId = String(awkwardFiled.decisionId ?? "");
      scenario(
        "create-project-awkward-scalars-decision",
        awkwardFiled.status === "pending" && awkwardDecisionId.length > 0,
        `create_project answered ${JSON.stringify(awkwardFiled).slice(0, 240)}`,
      );
      const approveAwkward = await resolveDecision(vaultRoot, awkwardDecisionId, "approved");
      assert.equal(
        approveAwkward.ok,
        true,
        `approving the awkward-text project failed: ${approveAwkward.ok ? "" : approveAwkward.error}`,
      );
      const listedAwkward = asRecord(await callTool(bearer, "list_projects", {}), "list_projects");
      const awkwardEntry = ((listedAwkward.projects ?? []) as Record<string, unknown>[]).find(
        (entry) => entry.title === "Idea with awkward text",
      );
      const awkwardId = String(awkwardEntry?.id ?? "");
      assert.ok(awkwardId, "the awkward-text project is not in list_projects");
      // Read the file the approve path actually wrote, not the object in memory.
      const awkwardText = fs.readFileSync(path.join(vaultRoot, "projects", `${awkwardId}.md`), "utf8");
      const awkwardRead = asRecord(
        await callTool(bearer, "get_project", { id: awkwardId }),
        "get_project",
      );
      scenario(
        "provenance-round-trip",
        awkwardEntry?.projectType === AWKWARD_TYPE &&
          awkwardEntry?.source === AWKWARD_SOURCE &&
          awkwardEntry?.sourceUrl === AWKWARD_URL &&
          awkwardRead.projectType === AWKWARD_TYPE &&
          awkwardRead.source === AWKWARD_SOURCE &&
          awkwardRead.sourceUrl === AWKWARD_URL &&
          awkwardText.includes(`projectType: "${AWKWARD_TYPE}"`) &&
          awkwardText.includes(`source: "${AWKWARD_SOURCE}"`) &&
          awkwardText.includes(`sourceUrl: "${AWKWARD_URL}"`),
        `entry ${JSON.stringify(awkwardEntry)}, read ${JSON.stringify({
          projectType: awkwardRead.projectType,
          source: awkwardRead.source,
          sourceUrl: awkwardRead.sourceUrl,
        })}, file ${JSON.stringify(awkwardText.slice(0, 500))}`,
      );

      // The type filter is case-insensitive, and it filters rather than guesses.
      const filteredByType = asRecord(
        await callTool(bearer, "list_projects", { projectType: "mobile app" }),
        "list_projects",
      );
      const typeRows = (filteredByType.projects ?? []) as Record<string, unknown>[];
      scenario(
        "list-projects-type-filter",
        filteredByType.total === 1 && typeRows.length === 1 && typeRows[0]?.id === projectId,
        `the case-insensitive projectType filter answered ${JSON.stringify(filteredByType).slice(0, 300)}`,
      );

      // A source link that is not an absolute http(s) URL is refused by name
      // and writes nothing: no file, no pending Decision, no half-applied update.
      const filesBeforeBadUrl = projectFiles(vaultRoot).length;
      const badUrlFiled = asRecord(
        await callTool(bearer, "create_project", {
          title: "Bad link",
          sourceUrl: "example.com/not-a-url",
        }),
        "create_project",
      );
      scenario(
        "invalid-source-url-refused",
        /sourceUrl/.test(
          String((badUrlFiled.error as { message?: string } | undefined)?.message ?? ""),
        ) &&
          projectFiles(vaultRoot).length === filesBeforeBadUrl &&
          (await pendingFor(vaultRoot, "project")).length === 0,
        `create_project with a bad sourceUrl answered ${JSON.stringify(badUrlFiled).slice(0, 300)}`,
      );
      const directBadUrl = await projectCreate(vaultRoot, {
        title: "Bad direct link",
        sourceUrl: "javascript:alert(1)",
      });
      scenario(
        "invalid-source-url-operator",
        !directBadUrl.ok &&
          /sourceUrl/.test(directBadUrl.error) &&
          projectFiles(vaultRoot).length === filesBeforeBadUrl,
        `projectCreate with a bad sourceUrl answered ${
          directBadUrl.ok ? "ok" : directBadUrl.error
        }`,
      );

      // A repository entry is validated the same way sourceUrl is; the refusal
      // names the list and the entry, and nothing is filed or written.
      const badRepoFiled = asRecord(
        await callTool(bearer, "create_project", {
          title: "Bad repo list",
          repoUrls: ["https://github.com/karmsheel/life-quest", "example.com/not-a-url"],
        }),
        "create_project",
      );
      scenario(
        "invalid-repo-url-refused",
        /repoUrls\[1\]/.test(
          String((badRepoFiled.error as { message?: string } | undefined)?.message ?? ""),
        ) &&
          projectFiles(vaultRoot).length === filesBeforeBadUrl &&
          (await pendingFor(vaultRoot, "project")).length === 0,
        `create_project with a bad repoUrls entry answered ${JSON.stringify(badRepoFiled).slice(0, 300)}`,
      );
      const directBadRepos = await projectCreate(vaultRoot, {
        title: "Bad direct repos",
        repoUrls: ["javascript:alert(1)"],
      });
      scenario(
        "invalid-repo-url-operator",
        !directBadRepos.ok &&
          /repoUrls/.test(directBadRepos.error) &&
          projectFiles(vaultRoot).length === filesBeforeBadUrl,
        `projectCreate with a bad repoUrls entry answered ${
          directBadRepos.ok ? "ok" : directBadRepos.error
        }`,
      );
      const beforeBadUpdate = asRecord(
        await callTool(bearer, "get_project", { id: projectId }),
        "get_project",
      );
      const badUrlUpdate = asRecord(
        await callTool(bearer, "update_project", {
          id: projectId,
          stateNote: "Should never land",
          sourceUrl: "ftp://example.com/not-web",
        }),
        "update_project",
      );
      const afterBadUpdate = asRecord(
        await callTool(bearer, "get_project", { id: projectId }),
        "get_project",
      );
      scenario(
        "invalid-source-url-update-refused",
        /sourceUrl/.test(
          String((badUrlUpdate.error as { message?: string } | undefined)?.message ?? ""),
        ) &&
          afterBadUpdate.stateNote === beforeBadUpdate.stateNote &&
          afterBadUpdate.sourceUrl === beforeBadUpdate.sourceUrl &&
          (await pendingFor(vaultRoot, "project")).length === 0,
        `update_project with a bad sourceUrl answered ${JSON.stringify(badUrlUpdate).slice(0, 300)}`,
      );

      const beforeBadRepoUpdate = asRecord(
        await callTool(bearer, "get_project", { id: projectId }),
        "get_project",
      );
      const badRepoUpdate = asRecord(
        await callTool(bearer, "update_project", {
          id: projectId,
          stateNote: "A repo edit that must not land",
          repoUrls: ["ftp://example.com/not-web"],
        }),
        "update_project",
      );
      const afterBadRepoUpdate = asRecord(
        await callTool(bearer, "get_project", { id: projectId }),
        "get_project",
      );
      scenario(
        "invalid-repo-url-update-refused",
        /repoUrls/.test(
          String((badRepoUpdate.error as { message?: string } | undefined)?.message ?? ""),
        ) &&
          afterBadRepoUpdate.stateNote === beforeBadRepoUpdate.stateNote &&
          JSON.stringify(afterBadRepoUpdate.repoUrls) ===
            JSON.stringify(CREATE_ARGS.repoUrls) &&
          (await pendingFor(vaultRoot, "project")).length === 0,
        `update_project with a bad repoUrls entry answered ${JSON.stringify(badRepoUpdate).slice(0, 300)}`,
      );

      // ── 3. update: stateNote + addUpdate → Decision → approve ────────────
      const UPDATE_PROVENANCE = {
        projectType: "Desktop/web",
        source: "First noticed on a YouTube channel",
        sourceUrl: "https://example.com/watch?v=execute-wing",
        repoUrls: ["https://github.com/karmsheel/vault-core"],
      };
      const updateFiled = asRecord(
        await callTool(bearer, "update_project", {
          id: projectId,
          stateNote: "The companion tools landed",
          ...UPDATE_PROVENANCE,
          addUpdate: { note: "Wired the MCP door test", progress: 60 },
        }),
        "update_project",
      );
      const updateDecisionId = String(updateFiled.decisionId ?? "");
      scenario(
        "update-project-decision",
        updateFiled.status === "pending" && updateDecisionId.length > 0,
        `update_project answered ${JSON.stringify(updateFiled).slice(0, 240)}`,
      );
      const beforeUpdateApprove = asRecord(await callTool(bearer, "get_project", { id: projectId }), "get_project");
      scenario(
        "update-project-not-before-approve",
        beforeUpdateApprove.stateNote === CREATE_ARGS.stateNote &&
          (beforeUpdateApprove.updates as unknown[]).length === 0 &&
          beforeUpdateApprove.progress === 25,
        `the file changed before approval: ${JSON.stringify(beforeUpdateApprove).slice(0, 300)}`,
      );

      const approveUpdate = await resolveDecision(vaultRoot, updateDecisionId, "approved");
      assert.equal(
        approveUpdate.ok,
        true,
        `approving the update failed: ${approveUpdate.ok ? "" : approveUpdate.error}`,
      );
      const readAfterUpdate = asRecord(await callTool(bearer, "get_project", { id: projectId }), "get_project");
      const updates = readAfterUpdate.updates as {
        id?: string;
        at?: string;
        note?: string;
        progress?: number | null;
        actorName?: string | null;
      }[];
      scenario(
        "update-project-provenance",
        readAfterUpdate.projectType === UPDATE_PROVENANCE.projectType &&
          readAfterUpdate.source === UPDATE_PROVENANCE.source &&
          readAfterUpdate.sourceUrl === UPDATE_PROVENANCE.sourceUrl &&
          JSON.stringify(readAfterUpdate.repoUrls) ===
            JSON.stringify(UPDATE_PROVENANCE.repoUrls),
        `update_project carried ${JSON.stringify({
          projectType: readAfterUpdate.projectType,
          source: readAfterUpdate.source,
          sourceUrl: readAfterUpdate.sourceUrl,
          repoUrls: readAfterUpdate.repoUrls,
        })}`,
      );
      scenario(
        "update-project-approve",
        readAfterUpdate.stateNote === "The companion tools landed" && readAfterUpdate.progress === 60,
        `stateNote=${String(readAfterUpdate.stateNote)}, progress=${String(readAfterUpdate.progress)}`,
      );
      scenario(
        "log-progress-timeline",
        updates.length === 1 &&
          updates[0]?.note === "Wired the MCP door test" &&
          updates[0]?.progress === 60 &&
          typeof updates[0]?.id === "string" &&
          typeof updates[0]?.at === "string" &&
          !Number.isNaN(Date.parse(String(updates[0]?.at))) &&
          updates[0]?.actorName === "Hermes",
        `the timeline entry is ${JSON.stringify(updates)}`,
      );

      // ── 5. a task and a signal, collated onto the project ────────────────
      const signalCreated = asRecord(
        await callTool(bearer, "create_signal", {
          type: "idea",
          title: "Projects should collate",
          body: "A project page is the place the work around it is read from.",
          domainSlug: "health",
        }),
        "create_signal",
      );
      const signal = asRecord(signalCreated.signal, "create_signal.signal");
      const signalId = String(signal.id ?? "");
      assert.ok(signalId, `create_signal returned no signal: ${JSON.stringify(signalCreated).slice(0, 300)}`);

      const taskApplied = asRecord(
        await callTool(bearer, "create_task", {
          title: "Write the MCP door test",
          column: "today",
          links: { projectId, signalId },
        }),
        "create_task",
      );
      const mapState = asRecord(taskApplied.state, "create_task.state");
      const createdTask = (mapState.tasks as {
        id: string;
        title: string;
        origin?: string;
      }[]).find((task) => task.title === "Write the MCP door test");
      const taskId = String(createdTask?.id ?? "");
      assert.ok(taskId, `create_task did not apply: ${JSON.stringify(taskApplied).slice(0, 300)}`);
      // The Act board's "Added by agent" mark reads the task's origin. This door
      // is the only real path by which an agent adds a card, so the stamp has to
      // be proved here: a door that passed "user" would mark every agent card as
      // the operator's and every other rig would stay green.
      scenario(
        "agent-created-task-origin",
        createdTask?.origin === "agent",
        `create_task stored origin ${JSON.stringify(createdTask?.origin)} for ${taskId}`,
      );

      const readCollated = asRecord(await callTool(bearer, "get_project", { id: projectId }), "get_project");
      scenario(
        "task-links-project",
        (readCollated.tasks as { id?: string }[]).some((task) => task.id === taskId),
        `get_project.tasks is ${JSON.stringify(readCollated.tasks).slice(0, 300)}`,
      );
      scenario(
        "signal-through-task",
        (readCollated.signals as { id?: string; body?: string }[]).some(
          (entry) => entry.id === signalId && entry.body === signal.body,
        ),
        `get_project.signals is ${JSON.stringify(readCollated.signals).slice(0, 300)}`,
      );
      scenario(
        "get-project-collates-update-decision",
        (readCollated.decisions as { id?: string }[]).some((decision) => decision.id === updateDecisionId),
        `the approved update Decision is not collated: ${JSON.stringify(readCollated.decisions).slice(0, 300)}`,
      );

      // ── 6. create_database: one call, written at once, three columns ─────
      // Operator policy (2026-10-28): creating a database is ADDING data, so the
      // tool writes it and files no Decision; the chat confirmation is the yes.
      const CREATE_DB_ARGS = {
        domainSlug: "financial",
        name: "Bottles",
        columns: [
          { name: "Bottle", type: "text" },
          { name: "Volume", type: "number" },
          { name: "Opened On", type: "date" },
        ],
      };
      const databaseFiled = asRecord(
        await callTool(bearer, "create_database", CREATE_DB_ARGS),
        "create_database",
      );
      const databaseId = String(databaseFiled.databaseId ?? "");
      scenario(
        "create-database-one-call",
        databaseFiled.applied === true &&
          databaseFiled.columns === 3 &&
          databaseId.length > 0 &&
          databaseFiled.name === "Bottles",
        `create_database answered ${JSON.stringify(databaseFiled).slice(0, 300)}`,
      );

      const afterCreateDb = asRecord(
        await callTool(bearer, "get_database", { domainSlug: "financial", databaseId }),
        "get_database",
      );
      const database = asRecord(afterCreateDb.database, "get_database.database");
      const columns = (database.columns ?? []) as { id?: string; name?: string; type?: string }[];
      scenario(
        "database-written-before-any-approval",
        database.id === databaseId &&
          database.name === "Bottles" &&
          columns.length === 3 &&
          JSON.stringify(columns.map((column) => [column.name, column.type])) ===
            JSON.stringify(CREATE_DB_ARGS.columns.map((column) => [column.name, column.type])) &&
          columns.every((column) => typeof column.id === "string" && column.id.length > 0),
        `the created database is ${JSON.stringify(database).slice(0, 400)}`,
      );
      const pendingDatabases = await pendingFor(vaultRoot, "database");
      scenario(
        "create-database-files-no-decision",
        pendingDatabases.length === 0,
        `${pendingDatabases.length} pending database Decisions for one written create`,
      );

      // ── 7. pages: list_pages / get_page over an operator-created page ────
      const pageCreated = await createPage(vaultRoot, "health", { title: "Projects context" });
      assert.equal(pageCreated.ok, true, `createPage failed: ${pageCreated.ok ? "" : pageCreated.error}`);
      const pageId = (pageCreated as { ok: true; value: { id: string } }).value.id;
      const pagesListed = asRecord(
        await callTool(bearer, "list_pages", { domainSlug: "health" }),
        "list_pages",
      );
      const pageEntries = (pagesListed.pages ?? []) as {
        domainSlug?: string;
        page?: { id?: string; title?: string };
      }[];
      scenario(
        "list-pages",
        pagesListed.total === pageEntries.length &&
          pageEntries.some(
            (entry) => entry.domainSlug === "health" && entry.page?.id === pageId && entry.page?.title === "Projects context",
          ),
        `list_pages answered ${JSON.stringify(pagesListed).slice(0, 400)}`,
      );
      const pageGot = asRecord(
        await callTool(bearer, "get_page", { domainSlug: "health", pageId }),
        "get_page",
      );
      scenario(
        "get-page",
        (pageGot.page as { id?: string; title?: string; blocks?: unknown[] } | undefined)?.id === pageId &&
          (pageGot.page as { title?: string }).title === "Projects context" &&
          Array.isArray((pageGot.page as { blocks?: unknown[] }).blocks),
        `get_page answered ${JSON.stringify(pageGot).slice(0, 400)}`,
      );

      // ── 8. signals: list / get / filter ──────────────────────────────────
      const signalsListed = asRecord(
        await callTool(bearer, "list_signals", { domainSlug: "health", type: "idea" }),
        "list_signals",
      );
      const signalRows = (signalsListed.signals ?? []) as { id?: string }[];
      scenario(
        "list-signals",
        signalsListed.total === signalRows.length &&
          signalRows.some((entry) => entry.id === signalId) &&
          typeof signalsListed.skipped === "number",
        `list_signals answered ${JSON.stringify(signalsListed).slice(0, 400)}`,
      );
      const signalGot = asRecord(await callTool(bearer, "get_signal", { id: signalId }), "get_signal");
      scenario(
        "get-signal",
        (signalGot.signal as { id?: string; body?: string; type?: string; source?: string } | undefined)?.id ===
          signalId &&
          (signalGot.signal as { body?: string }).body === signal.body &&
          (signalGot.signal as { type?: string }).type === "idea" &&
          (signalGot.signal as { source?: string }).source === "manual",
        `get_signal answered ${JSON.stringify(signalGot).slice(0, 400)}`,
      );
      const filteredSignals = asRecord(
        await callTool(bearer, "list_signals", { type: "notice" }),
        "list_signals",
      );
      scenario(
        "list-signals-filter",
        !((filteredSignals.signals ?? []) as { id?: string }[]).some((entry) => entry.id === signalId),
        "the type filter did not exclude the idea signal",
      );
      const missingSignal = asRecord(await callTool(bearer, "get_signal", { id: "no-such-signal" }), "get_signal");
      scenario(
        "get-signal-not-found",
        errorCode(missingSignal) === "NOT_FOUND",
        `a missing signal answered ${JSON.stringify(missingSignal).slice(0, 200)}`,
      );

      // ── 4. close: Decision → approve → closed ────────────────────────────
      const closeFiled = asRecord(
        await callTool(bearer, "close_project", { id: projectId }),
        "close_project",
      );
      const closeDecisionId = String(closeFiled.decisionId ?? "");
      scenario(
        "close-project-decision",
        closeFiled.status === "pending" && closeDecisionId.length > 0,
        `close_project answered ${JSON.stringify(closeFiled).slice(0, 240)}`,
      );
      const beforeCloseApprove = asRecord(await callTool(bearer, "get_project", { id: projectId }), "get_project");
      scenario(
        "close-not-before-approve",
        beforeCloseApprove.status === "active",
        `the project closed before approval: ${String(beforeCloseApprove.status)}`,
      );
      const approveClose = await resolveDecision(vaultRoot, closeDecisionId, "approved");
      assert.equal(
        approveClose.ok,
        true,
        `approving the close failed: ${approveClose.ok ? "" : approveClose.error}`,
      );
      const readClosed = asRecord(await callTool(bearer, "get_project", { id: projectId }), "get_project");
      scenario("close-project-approve", readClosed.status === "closed", `status is ${String(readClosed.status)}`);
      scenario(
        "get-project-log",
        (readClosed.log as { type?: string; summary?: string }[]).some(
          (entry) => entry.type === "project.created" || entry.type === "project.closed",
        ),
        `get_project.log is ${JSON.stringify(readClosed.log).slice(0, 300)}`,
      );

      // A missing project is a NOT_FOUND, not a MALFORMED.
      const missingProject = asRecord(
        await callTool(bearer, "get_project", { id: "no-such-project" }),
        "get_project",
      );
      scenario(
        "get-project-not-found",
        errorCode(missingProject) === "NOT_FOUND",
        `a missing project answered ${JSON.stringify(missingProject).slice(0, 200)}`,
      );

      // ── the artifact, and the assertions on the artifact itself ──────────
      const report = {
        pass: true,
        what:
          "Projects and the four harness fixes, over the real MCP door: temp vault, real pairing " +
          "door, real companion bearer, real executeTool, real JSON-RPC tools/call",
        command:
          "cd apps/desktop && node --experimental-strip-types --test tests/projects-tools-e2e.test.ts",
        doors: { local: doors.localPort, invite: doors.invitePort, livePorts: [8643, 8646] },
        vault: { id: vaultId, liveSeedDomains: ["life", "health", "financial"], temp: true },
        scenarios,
        tools: { advertised: EXPECTED_TOOLS.filter((name) => toolNames.includes(name)), missing },
        ids: {
          goalId,
          projectId,
          createDecisionId,
          updateDecisionId,
          closeDecisionId,
          signalId,
          taskId,
          databaseId,
          pageId,
        },
        bodies: {
          listProjectsFresh: { projects: [], total: 0 },
          projectAfterCreate: readAfterCreate,
          projectAfterUpdate: readAfterUpdate,
          projectCollated: readCollated,
          projectClosed: readClosed,
          database: afterCreateDb,
          pages: pagesListed,
          page: pageGot,
          signals: signalsListed,
          signal: signalGot,
          createDatabaseResult: databaseFiled,
          createProjectProposal: createFiled,
          updateProjectProposal: updateFiled,
          closeProjectProposal: closeFiled,
        },
        generatedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);

      // The file on disk is the artifact a reader will open: assert on what was
      // WRITTEN, not on the object still in memory.
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
      const written = JSON.parse(fs.readFileSync(ARTIFACT, "utf8")) as typeof report;
      assert.equal(written.pass, true);
      assert.deepEqual(
        written.scenarios.map((entry) => entry.name),
        scenarios.map((entry) => entry.name),
        "the written scenario list moved",
      );
      assert.deepEqual(
        written.scenarios.filter((entry) => !entry.pass),
        [],
        "the written artifact carries a failed scenario",
      );
      assert.equal(written.ids.projectId, projectId);
      assert.equal(written.ids.databaseId, databaseId);
      assert.equal(written.ids.pageId, pageId);
      assert.equal(written.ids.signalId, signalId);
      assert.equal(written.ids.taskId, taskId);
      assert.equal(written.bodies.projectAfterUpdate.progress, 60);
      assert.equal(
        (written.bodies.database.database as { columns?: unknown[] }).columns?.length,
        3,
      );
    } finally {
      await doors.close();
    }

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
