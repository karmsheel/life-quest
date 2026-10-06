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
  ensureRootCompanionHeader,
  hermesRoot,
  seedModelFromRoot,
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
    assert.equal(DEFAULT_API_PORT, 8642);
    assert.deepEqual([...RESERVED_PORTS], [8642, 8643, 8644]);
    assert.equal(MCP_URL, "http://127.0.0.1:8643/mcp");
    assert.match(COMPANION_SOUL, /LifeQuest companion/);
    assert.match(COMPANION_SOUL, /LOCKED/);
    assert.match(COMPANION_SOUL, /get_doctrine/);
    assert.match(COMPANION_SOUL, /Premise/);
    assert.match(COMPANION_SOUL, /Strategy \(How\)/);
    assert.match(COMPANION_SOUL, /Do not rewrite/);
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

  it("copies the root model into a profile that has none and leaves a chosen model alone", () => {
    const root = [
      "model:",
      "  default: stealth/space-bunny-alpha",
      "  provider: nous",
      "fallback_providers: []",
      "",
    ].join("\r\n");
    const profile = "mcp_servers:\n  lifequest:\n    url: http://127.0.0.1:8643/mcp\n";
    const next = seedModelFromRoot(profile, root);
    assert.match(next, /^mcp_servers:\n/);
    assert.match(
      next,
      /model:\n  default: stealth\/space-bunny-alpha\n  provider: nous\n$/,
    );
    assert.equal(next.includes("fallback_providers"), false);
    const chosen = seedModelFromRoot(
      "model:\n  default: other\n  provider: x\n",
      root,
    );
    assert.match(chosen, /default: other/);
    assert.equal(chosen.includes("space-bunny"), false);
  });

  it("adds the companion bearer to an existing root lifequest server without creating one", () => {
    const root = [
      "model:",
      "  default: a",
      "  provider: nous",
      "mcp_servers:",
      "  lifequest:",
      "    url: http://127.0.0.1:8643/mcp",
      "    connect_timeout: 20.0",
      "    enabled: true",
      "",
    ].join("\r\n");
    const next = ensureRootCompanionHeader(root, "Bearer abc_def");
    assert.match(next, /model:\r\n  default: a\r\n/);
    assert.match(next, /connect_timeout: 20\.0\r\n/);
    assert.match(next, /enabled: true\r\n/);
    assert.match(next, /Authorization: Bearer abc_def\r\n/);
    assert.equal((next.match(/lifequest:/g) ?? []).length, 1);
    assert.equal((next.match(/mcp_servers:/g) ?? []).length, 1);
    const again = ensureRootCompanionHeader(next, "Bearer abc_def");
    assert.equal(again, next);
    assert.equal(
      ensureRootCompanionHeader("model:\n  default: a\n", "Bearer abc"),
      "model:\n  default: a\n",
    );
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

  it("probes only /p/lifequest prefixes on the host listener", () => {
    const urls = attachCandidateBaseUrls(8642);
    assert.equal(urls[0], "http://127.0.0.1:8642/p/lifequest");
    assert.ok(urls.includes("http://127.0.0.1:8644/p/lifequest"));
    assert.equal(
      urls.some((url) => /^http:\/\/127\.0\.0\.1:\d+$/.test(url)),
      false,
      "raw host URLs would attach to the default profile",
    );
    assert.equal(portFromBaseUrl("http://127.0.0.1:8642/p/lifequest"), 8642);
  });
});
