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
  it("requires session_list and a stream flag", () => {
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
    const port = await choosePort("", async (p) => p !== 8650);
    assert.equal(port, 8651);
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
    spawnGateway: partial.spawnGateway ?? (async () => ({ pid: 42 })),
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
        spawnGateway: async () => {
          spawned = true;
          return { pid: 1 };
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
        spawnGateway: async () => {
          spawned = true;
          return { pid: 1 };
        },
      }),
    );
    assert.equal(status.kind, "ready");
    assert.equal((status as CompanionReady).startedByLifeQuest, false);
    assert.match((status as CompanionReady).baseUrl, /\/p\/lifequest$/);
    assert.equal(spawned, false);
  });

  it("spawns when health is down", async () => {
    let spawned = false;
    let healthy = false;
    const status = await ensureCompanion(
      io({
        whichHermes: async () => "C:\\hermes\\hermes.exe",
        health: async () => healthy,
        capabilities: async () => caps,
        spawnGateway: async () => {
          spawned = true;
          healthy = true;
          return { pid: 7 };
        },
      }),
    );
    assert.equal(status.kind, "ready");
    assert.equal((status as CompanionReady).startedByLifeQuest, true);
    assert.equal((status as CompanionReady).childPid, 7);
    assert.equal(spawned, true);
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
