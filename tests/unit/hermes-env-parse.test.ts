import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHermesEnv, buildCandidateUrls } from "../../lib/hermes-connection.ts";

describe("parseHermesEnv", () => {
  it("reads API_SERVER keys", () => {
    const env = parseHermesEnv(`
API_SERVER_ENABLED=true
API_SERVER_KEY=secret
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
`);
    assert.equal(env.apiServerEnabled, true);
    assert.equal(env.apiServerKey, "secret");
    assert.equal(env.apiServerPort, 8642);
  });
});

describe("buildCandidateUrls", () => {
  it("includes host and localhost variants", () => {
    const urls = buildCandidateUrls({ apiServerHost: "127.0.0.1", apiServerPort: 8642 });
    assert.ok(urls.some((u) => u.includes("8642")));
    assert.ok(urls.some((u) => u.includes("localhost")));
  });
});
