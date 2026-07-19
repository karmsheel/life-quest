import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HERMES_SCAN_PATHS,
  isAgentHireStatus,
  normalizeScannedAgents,
} from "../../lib/personnel.ts";

describe("normalizeScannedAgents", () => {
  it("maps OpenAI-style models list", () => {
    const agents = normalizeScannedAgents({
      data: [{ id: "hermes-agent" }, { id: "gpt-test", name: "GPT Test" }],
    });
    assert.equal(agents.length, 2);
    assert.deepEqual(agents[0], { id: "hermes-agent", name: "hermes-agent" });
    assert.equal(agents[1].id, "gpt-test");
    assert.equal(agents[1].name, "GPT Test");
  });

  it("maps agents / profiles wrappers and description", () => {
    const agents = normalizeScannedAgents({
      agents: [
        {
          id: "a1",
          name: "Analyst",
          description: "Reads metrics",
        },
      ],
    });
    assert.deepEqual(agents, [
      { id: "a1", name: "Analyst", description: "Reads metrics" },
    ]);
  });

  it("maps Forge-style profileKey rows", () => {
    const agents = normalizeScannedAgents([
      {
        profileKey: "default",
        displayName: "default",
        description: "Main profile",
      },
    ]);
    assert.deepEqual(agents, [
      { id: "default", name: "default", description: "Main profile" },
    ]);
  });

  it("dedupes by id and skips empty", () => {
    const agents = normalizeScannedAgents({
      data: [{ id: "x" }, { id: "x" }, { name: "" }, null],
    });
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "x");
  });

  it("returns [] for garbage", () => {
    assert.deepEqual(normalizeScannedAgents(null), []);
    assert.deepEqual(normalizeScannedAgents({ foo: 1 }), []);
  });
});

describe("isAgentHireStatus", () => {
  it("accepts active and dismissed", () => {
    assert.equal(isAgentHireStatus("active"), true);
    assert.equal(isAgentHireStatus("dismissed"), true);
    assert.equal(isAgentHireStatus("pending"), false);
  });
});

describe("HERMES_SCAN_PATHS", () => {
  it("prefers agents endpoints before models fallback", () => {
    assert.ok(HERMES_SCAN_PATHS.includes("/v1/agents"));
    assert.ok(HERMES_SCAN_PATHS.includes("/v1/models"));
    assert.ok(
      HERMES_SCAN_PATHS.indexOf("/v1/agents") <
        HERMES_SCAN_PATHS.indexOf("/v1/models"),
    );
  });
});
