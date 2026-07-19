import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { upsertEnvLines } from "../../lib/hermes-setup.ts";
import {
  connectionErrorExplanation,
  setupSummaryMessage,
} from "../../lib/hermes-setup-shared.ts";

describe("upsertEnvLines", () => {
  it("updates existing and appends missing keys", () => {
    const { next, changes } = upsertEnvLines("FOO=1\nAPI_SERVER_ENABLED=false\n", {
      API_SERVER_ENABLED: "true",
      API_SERVER_KEY: "k",
    });
    assert.match(next, /API_SERVER_ENABLED=true/);
    assert.match(next, /API_SERVER_KEY=k/);
    assert.ok(changes.length >= 1);
  });
});

describe("connectionErrorExplanation", () => {
  it("mentions LifeQuest or Hermes Agent not Hermes Forge", () => {
    const text = connectionErrorExplanation("misconfigured", false);
    assert.equal(/Hermes Forge/i.test(text), false);
    assert.match(text, /Hermes/i);
  });
});

describe("setupSummaryMessage", () => {
  it("explains restart when not reachable", () => {
    const msg = setupSummaryMessage({ ok: true, gatewayReachable: false });
    assert.match(msg, /restart/i);
  });
});
