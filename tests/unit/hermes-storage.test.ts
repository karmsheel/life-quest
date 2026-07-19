import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { connectionStatusFromProbe, defaultHermesConfig } from "../../lib/hermes-storage.ts";

describe("hermes-storage", () => {
  it("defaultHermesConfig has localhost base and empty key", () => {
    const d = defaultHermesConfig();
    assert.ok(d.baseUrl.includes("8642"));
    assert.equal(d.apiKey, "");
  });
  it("maps successful probe to connected status", () => {
    const s = connectionStatusFromProbe(
      { ok: true, baseUrl: "http://127.0.0.1:8642", latencyMs: 12, model: "hermes-agent" },
      "auto",
    );
    assert.equal(s.state, "connected");
    assert.equal(s.latencyMs, 12);
    assert.equal(s.source, "auto");
  });
  it("maps failed probe to error", () => {
    const s = connectionStatusFromProbe(
      { ok: false, baseUrl: "http://127.0.0.1:8642", latencyMs: 3, error: "down", kind: "not_running" },
      "manual",
    );
    assert.equal(s.state, "error");
    assert.equal(s.kind, "not_running");
  });
});
