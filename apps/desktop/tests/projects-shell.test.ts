import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ALL_TOOL_DEFS, PROJECT_TOOL_DEFS } from "@lifequest/vault-core";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

/** Body of executeTool in map-tools.ts. */
function executeToolBody(): string {
  const src = read("electron/map-tools.ts");
  const start = src.indexOf("export async function executeTool");
  assert.notEqual(start, -1, "executeTool must exist in map-tools.ts");
  return src.slice(start);
}

describe("KAR-7: agent project tools file Decisions", () => {
  it("create_project and close_project are routed through createDecision", () => {
    const src = read("electron/map-tools.ts");
    assert.match(src, /PROJECT_TOOL_DEFS/);
    assert.match(src, /commandForProjectTool/);
    assert.match(src, /type: "project"/);

    const body = executeToolBody();
    // The agent path must never call the direct write helpers.
    assert.equal(/\bprojectCreate\s*\(/.test(body), false, "no projectCreate on the agent path");
    assert.equal(/\bprojectClose\s*\(/.test(body), false, "no projectClose on the agent path");
    // The command is built in vault-core; executeTool routes it to the proposer.
    assert.match(body, /commandForProjectTool/);
    assert.match(body, /proposeProjectDecision/);
    assert.match(body, /type: "project"/);
    // The proposer files a Decision rather than writing the file.
    const proposer = body.slice(body.indexOf("async function proposeProjectDecision"));
    assert.match(proposer, /createDecision/);
    assert.match(proposer, /target: \{ type: "project" \}/);
    assert.equal(/\bprojectCreate\s*\(/.test(proposer), false);
    assert.equal(/\bprojectClose\s*\(/.test(proposer), false);
    // The two command shapes come from vault-core's commandForProjectTool.
    const core = read("../../packages/vault-core/src/projects.ts");
    assert.match(core, /type: "createProject"/);
    assert.match(core, /type: "closeProject"/);
  });

  it("both project tool defs are registered in the OpenAI tool list and the MCP server", () => {
    // KAR-63: the planner's list and the MCP server both spread the one composed
    // constant, so membership is asserted against the arrays themselves.
    for (const def of PROJECT_TOOL_DEFS) {
      assert.ok(
        ALL_TOOL_DEFS.some((t) => t.name === def.name),
        `${def.name} must be in the composed list the planner and MCP server both use`,
      );
    }
    const mapTools = read("electron/map-tools.ts");
    const openaiList = mapTools.slice(
      mapTools.indexOf("const openaiTools"),
      mapTools.indexOf("const openaiTools") + 400,
    );
    assert.match(openaiList, /ALL_TOOL_DEFS/);

    const mcp = read("electron/mcp-server.ts");
    assert.match(mcp, /ALL_TOOL_DEFS/);
  });

  it("create_task still reaches applyMapCommand and is not gated", () => {
    const body = executeToolBody();
    // KAR-9 added the vault actor after `today`; the map actor stays "agent".
    assert.match(body, /applyMapCommand\(root, command, "agent", undefined, actor\)/);
    const gate = body.slice(body.indexOf("DAY_TEMPLATE_TOOLS.has(name)"));
    const before = gate.slice(0, gate.indexOf("applyMapCommand"));
    assert.equal(/create_task/.test(before), false);
  });

  it("no update_project or delete_project tool exists", () => {
    const src = read("electron/map-tools.ts");
    assert.equal(/"update_project"/.test(src), false);
    assert.equal(/"delete_project"/.test(src), false);
  });
});

describe("KAR-7: operator project writes stay direct", () => {
  it("vault-service projectsCreate calls projectCreate and projectsUpdate calls projectUpdate", () => {
    const src = read("electron/vault-service.ts");
    const create = src.slice(
      src.indexOf("export async function projectsCreate"),
      src.indexOf("export async function projectsCreate") + 400,
    );
    assert.notEqual(create, "", "projectsCreate must exist in vault-service.ts");
    assert.match(create, /projectCreate\(root, input\)/);
    assert.equal(/createDecision/.test(create), false);

    const update = src.slice(
      src.indexOf("export async function projectsUpdate"),
      src.indexOf("export async function projectsUpdate") + 400,
    );
    assert.notEqual(update, "", "projectsUpdate must exist in vault-service.ts");
    assert.match(update, /projectUpdate\(root, id, patch\)/);
    assert.equal(/createDecision/.test(update), false);

    assert.match(src, /export async function projectsList/);
    assert.match(src, /export async function projectsGet/);
  });

  it("preload and main wire projects:list, projects:get, projects:create, projects:update", () => {
    const main = read("electron/main.ts");
    for (const channel of [
      "projects:list",
      "projects:get",
      "projects:create",
      "projects:update",
    ]) {
      assert.ok(main.includes(channel), `main.ts must handle ${channel}`);
    }
    const preload = read("electron/preload.ts");
    for (const channel of ["projects:list", "projects:get", "projects:create", "projects:update"]) {
      assert.ok(preload.includes(channel), `preload.ts must invoke ${channel}`);
    }
    assert.match(preload, /projectsList/);
    assert.match(preload, /projectsCreate/);
    assert.match(preload, /projectsUpdate/);
  });
});

describe("KAR-7: the Plan wing has a Projects page", () => {
  it("nav item id projects sits in the plan wing after goals", () => {
    const nav = read("src/components/shell/nav-items.ts");
    assert.match(nav, /id: "projects"/);
    assert.match(nav, /href: "\/projects"/);
    assert.match(nav, /label: "Projects"/);
    const planIds = [
      ...nav.matchAll(/id: "(goals|projects|chart|track)"/g),
    ].map((m) => m[1]);
    assert.deepEqual(planIds, ["goals", "projects", "chart", "track"]);
  });

  it("the /projects route renders a ProjectsPage", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="\/projects"/);
    assert.match(app, /ProjectsPage/);
    assert.ok(fs.existsSync(path.join(desktopRoot, "src/pages/ProjectsPage.tsx")));
  });

  it("the Projects page writes directly and has no Decision button", () => {
    const page = read("src/pages/ProjectsPage.tsx");
    assert.match(page, /projectsCreate/);
    assert.match(page, /projectsUpdate/);
    assert.equal(/createDecision|fileDecision|Propose/.test(page), false);
  });
});

describe("KAR-7: Act tasks can point at a project", () => {
  it("TaskBoard has a Project select with the task-scoped aria-label", () => {
    const board = read("src/components/tasks/TaskBoard.tsx");
    assert.match(board, /projectId/);
    assert.match(board, /\$\{task\.title\} project/);
    // Clearing the select removes projectId, like goalId.
    assert.match(board, /"projectId" in patch && !patch\.projectId/);
  });

  it("ActPage loads the project list", () => {
    const act = read("src/pages/ActPage.tsx");
    assert.match(act, /projectsList/);
    assert.match(act, /projects=/);
  });
});

describe("KAR-7: a project fence still files nothing", () => {
  it("implied-decision still treats kind project as filing nothing", () => {
    const src = read("../../packages/vault-core/src/implied-decision.ts");
    assert.match(src, /"project"/);
    assert.match(src, /reason: "project"/);
  });

  it("project write tools were added to WRITE_TOOL_NAMES only", () => {
    const src = read("../../packages/vault-core/src/implied-decision.ts");
    const list = src.slice(
      src.indexOf("export const WRITE_TOOL_NAMES"),
      src.indexOf("];", src.indexOf("export const WRITE_TOOL_NAMES")),
    );
    assert.match(list, /"create_project"/);
    assert.match(list, /"close_project"/);
  });
});
