import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPANION_SOUL,
  DEFAULT_API_PORT,
  MCP_URL,
  PROFILE_NAME,
  RESERVED_PORTS,
  attachCandidateBaseUrls,
  ensureMcpServer,
  hermesRoot,
  nextFreePort,
  portFromBaseUrl,
  profileDir,
  readEnv,
  shouldSeedSoul,
  upsertEnv,
} from "../electron/companion-profile.ts";

describe("companion-profile", () => {
  it("names the lifequest profile and reserved ports", () => {
    assert.equal(PROFILE_NAME, "lifequest");
    assert.equal(DEFAULT_API_PORT, 8650);
    assert.deepEqual([...RESERVED_PORTS], [8642, 8643, 8644]);
    assert.equal(MCP_URL, "http://127.0.0.1:8643/mcp");
    assert.match(COMPANION_SOUL, /LifeQuest companion/);
    assert.match(COMPANION_SOUL, /LOCKED/);
    assert.match(COMPANION_SOUL, /get_doctrine/);
  });

  it("resolves hermes root from HERMES_HOME, LOCALAPPDATA, or homedir", () => {
    assert.equal(
      hermesRoot({ HERMES_HOME: "D:\\data\\hermes" }, "C:\\Users\\x"),
      "D:\\data\\hermes",
    );
    assert.ok(
      hermesRoot(
        { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" },
        "C:\\Users\\x",
      ).replace(/\\/g, "/").endsWith("AppData/Local/hermes"),
    );
    assert.ok(hermesRoot({}, "C:\\Users\\x").endsWith(".hermes"));
  });

  it("walks up when HERMES_HOME is already a named profile", () => {
    const root = hermesRoot(
      { HERMES_HOME: "C:\\Users\\x\\.hermes\\profiles\\coder" },
      "C:\\Users\\x",
    );
    assert.ok(root.endsWith(".hermes"));
    assert.equal(root.includes("profiles"), false);
  });

  it("puts the profile under profiles/lifequest", () => {
    assert.ok(
      profileDir("/tmp/.hermes").replace(/\\/g, "/").endsWith("profiles/lifequest"),
    );
  });

  it("upserts env keys without dropping others", () => {
    const next = upsertEnv("FOO=1\nAPI_SERVER_PORT=1\n", {
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
    const existing = "mcp_servers:\n  github:\n    command: npx\n";
    const next = ensureMcpServer(existing, "lifequest", MCP_URL);
    assert.match(next, /github:/);
    assert.match(next, /lifequest:/);
    assert.match(next, /127\.0\.0\.1:8643\/mcp/);
    const again = ensureMcpServer(next, "lifequest", MCP_URL);
    assert.equal((again.match(/lifequest:/g) ?? []).length, 1);
  });

  it("seeds soul only when missing or empty", () => {
    assert.equal(shouldSeedSoul(null), true);
    assert.equal(shouldSeedSoul(""), true);
    assert.equal(shouldSeedSoul("   \n"), true);
    assert.equal(shouldSeedSoul("You are already named."), false);
  });

  it("never picks 8642, 8643, or 8644 as the companion port", () => {
    assert.equal(nextFreePort(new Set([8650]), 8650), 8651);
    assert.equal(nextFreePort(new Set([8642, 8643, 8644]), 8642), 8645);
  });

  it("probes /p/lifequest on shared gateways before a dedicated port", () => {
    const urls = attachCandidateBaseUrls(8645);
    assert.equal(urls[0], "http://127.0.0.1:8645/p/lifequest");
    assert.ok(urls.includes("http://127.0.0.1:8644/p/lifequest"));
    assert.ok(urls.includes("http://127.0.0.1:8642/p/lifequest"));
    assert.equal(portFromBaseUrl("http://127.0.0.1:8644/p/lifequest"), 8644);
  });
});
