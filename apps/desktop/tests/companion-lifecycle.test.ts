import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capabilitiesSupportSessions,
  choosePort,
  ensureCompanion,
  shouldStopChild,
  shutdownCompanion,
  type CompanionIo,
  type CompanionReady,
} from "../electron/companion-lifecycle.ts";

describe("capabilitiesSupportSessions", () => {
  it("requires session list and a stream flag", () => {
    assert.equal(
      capabilitiesSupportSessions({
        features: { session_list: true, session_chat_stream: true },
      }),
      true,
    );
    assert.equal(
      capabilitiesSupportSessions({
        features: { session_list: true, chat_stream: true },
      }),
      true,
    );
    assert.equal(
      capabilitiesSupportSessions({
        features: { session_list: true },
        endpoints: { session_chat_stream: "/api/sessions/{id}/chat/stream" },
      }),
      true,
    );
    assert.equal(
      capabilitiesSupportSessions({
        features: { session_chat: true, session_chat_streaming: true },
      }),
      true,
    );
    assert.equal(
      capabilitiesSupportSessions({
        features: { session_resources: true, session_chat_streaming: true },
      }),
      true,
    );
    assert.equal(capabilitiesSupportSessions({ features: { session_list: true } }), false);
    assert.equal(capabilitiesSupportSessions({}), false);
    assert.equal(capabilitiesSupportSessions(null), false);
  });
});

describe("choosePort", () => {
  it("keeps the env port when free", async () => {
    const port = await choosePort("API_SERVER_PORT=8650\n", async () => true);
    assert.equal(port, 8650);
  });

  it("skips reserved ports when the default is taken", async () => {
    const port = await choosePort("", async () => true);
    assert.equal(port, 8645);
  });
});

describe("shouldStopChild", () => {
  it("stops only the child we started that still owns the port", () => {
    assert.equal(shouldStopChild(true, 10, 10), true);
    assert.equal(shouldStopChild(true, 10, 99), false);
    assert.equal(shouldStopChild(false, 10, 10), false);
    assert.equal(shouldStopChild(true, 10, null), false);
  });
});

function io(partial: Partial<CompanionIo> & Pick<CompanionIo, "whichHermes" | "health">): CompanionIo {
  const files = new Map<string, string>();
  return {
    homedir: "C:\\Users\\x",
    env: {},
    whichHermes: partial.whichHermes,
    readFile: partial.readFile ?? (async (p) => files.get(p) ?? null),
    writeFile: partial.writeFile ?? (async (p, body) => {
      files.set(p, body);
    }),
    mkdirp: partial.mkdirp ?? (async () => {}),
    isPortFree: partial.isPortFree ?? (async () => true),
    health: partial.health,
    capabilities: partial.capabilities ?? (async () => ({
      features: { session_list: true, session_chat_stream: true },
    })),
    ensureHostGateway: partial.ensureHostGateway ?? (async () => {}),
    stopPid: partial.stopPid ?? (async () => {}),
    listeningPid: partial.listeningPid ?? (async () => 42),
  };
}

const caps = { features: { session_list: true, session_chat_stream: true } };

describe("ensureCompanion", () => {
  it("returns needs_install when hermes is missing", async () => {
    let spawned = false;
    const status = await ensureCompanion(
      io({
        whichHermes: async () => null,
        health: async () => false,
        ensureHostGateway: async () => {
          spawned = true;
        },
      }),
    );
    assert.equal(status.kind, "needs_install");
    assert.equal(spawned, false);
  });

  it("attaches when health is already up", async () => {
    let spawned = false;
    const status = await ensureCompanion(
      io({
        whichHermes: async () => "C:\\hermes\\hermes.exe",
        health: async () => true,
        capabilities: async () => caps,
        ensureHostGateway: async () => {
          spawned = true;
        },
      }),
    );
    assert.equal(status.kind, "ready");
    assert.equal((status as CompanionReady).startedByLifeQuest, false);
    assert.match((status as CompanionReady).baseUrl, /\/p\/lifequest$/);
    assert.equal(spawned, false);
  });

  it("ensures the host multiplexer when /p/lifequest is down", async () => {
    let ensured = false;
    let healthy = false;
    const written: Record<string, string> = {};
    const status = await ensureCompanion(
      io({
        whichHermes: async () => "C:\\hermes\\hermes.exe",
        health: async () => healthy,
        capabilities: async () => caps,
        writeFile: async (p, body) => {
          written[p.replace(/\\/g, "/")] = body;
        },
        ensureHostGateway: async () => {
          ensured = true;
          healthy = true;
        },
      }),
    );
    assert.equal(status.kind, "ready");
    assert.equal((status as CompanionReady).startedByLifeQuest, false);
    assert.equal((status as CompanionReady).childPid, null);
    assert.match((status as CompanionReady).baseUrl, /\/p\/lifequest$/);
    assert.equal(ensured, true);
    const envBody = Object.entries(written).find(([p]) => p.endsWith("/.env"))?.[1] ?? "";
    assert.equal(/API_SERVER_PORT=/.test(envBody), false);
  });

  it("returns hermes_too_old when sessions are missing", async () => {
    const status = await ensureCompanion(
      io({
        whichHermes: async () => "C:\\hermes\\hermes.exe",
        health: async () => true,
        capabilities: async () => ({ features: {} }),
      }),
    );
    assert.equal(status.kind, "hermes_too_old");
  });

  it("returns auth_error when capabilities cannot be read", async () => {
    const status = await ensureCompanion(
      io({
        whichHermes: async () => "C:\\hermes\\hermes.exe",
        health: async () => true,
        capabilities: async () => null,
      }),
    );
    assert.equal(status.kind, "auth_error");
  });
});

describe("shutdownCompanion", () => {
  it("stops the child only when we still own the listener", async () => {
    const stopped: number[] = [];
    await shutdownCompanion(
      {
        kind: "ready",
        port: 8644,
        baseUrl: "http://127.0.0.1:8644/p/lifequest",
        startedByLifeQuest: true,
        profilePath: "p",
        cliPath: "c",
        apiKey: "k",
        childPid: 10,
      },
      {
        stopPid: async (pid) => {
          stopped.push(pid);
        },
        listeningPid: async () => 10,
      },
    );
    assert.deepEqual(stopped, [10]);

    stopped.length = 0;
    await shutdownCompanion(
      {
        kind: "ready",
        port: 8644,
        baseUrl: "http://127.0.0.1:8644/p/lifequest",
        startedByLifeQuest: true,
        profilePath: "p",
        cliPath: "c",
        apiKey: "k",
        childPid: 10,
      },
      {
        stopPid: async (pid) => {
          stopped.push(pid);
        },
        listeningPid: async () => 99,
      },
    );
    assert.deepEqual(stopped, []);
  });
});
