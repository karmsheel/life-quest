/**
 * The real app process's picture read door, driven by
 * `e2e/chat-image-ipc.electron.mjs`: the built `dist-electron/main.js` boots the
 * real main, the real preload and this checkout's built renderer, the rig
 * creates and opens a throwaway vault through the real IPC, and then asks
 * `window.lifequest.chatImageRead` for a real picture — and for the refs the
 * door must refuse.
 *
 * This is the seam `AGENTS.md` asks a changed IPC channel and preload to be
 * checked against: the harness page stubs `window.lifequest`, and the bundled
 * module leg calls `readChatImage` directly, so neither would catch a missing
 * `chat:imageRead` handler, a preload that dropped the method, or a vault-service
 * entry that throws instead of answering.
 *
 * The rig writes `e2e/artifacts/chat-image-ipc.{json,png}`; the assertions below
 * restate the contract from that JSON.
 *
 * The rig needs a BUILT renderer (`dist/`) and the DEV-built main bundle
 * (`dist-electron/main.js`, which is the one that keeps the e2e profile seam):
 * `npm run build` makes the first and the dev server makes the second. A
 * main bundle without the seam would open the operator's real profile, so the
 * suite skips rather than run it.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const artifactsDir = path.join(desktopRoot, "e2e/artifacts");
const rig = path.join(desktopRoot, "e2e/chat-image-ipc.electron.mjs");
const REPORT = path.join(artifactsDir, "chat-image-ipc.json");
const MAIN_BUNDLE = path.join(desktopRoot, "dist-electron/main.js");
const DIST_INDEX = path.join(desktopRoot, "dist/index.html");

type ReadResult = {
  ok: boolean;
  mime?: string | null;
  bytes?: number | null;
  isBytes?: boolean;
  error?: string;
};

type Report = {
  pass: boolean;
  failures: string[];
  scenarios: { name: string; pass: boolean; detail: string | null }[];
  vault: string;
  userData: string;
  hermesHome: string;
  mcpPorts: { local: number; invite: number };
  companion: { settings: string; switched: string };
  bridge: { present: boolean; chatImageRead: string; methodCount: number };
  reads: {
    relative: ReadResult;
    absolute: ReadResult;
    escaped: ReadResult;
    remote: ReadResult;
    empty: ReadResult;
    text: ReadResult;
    reloaded: ReadResult;
  };
  shell: { rendered: boolean };
  screenshot: string | null;
};

/**
 * Every check the rig must report as passing. The names are the rig's own, so a
 * rig that quietly stops checking one is a failure here rather than a shorter
 * green run.
 */
const REQUIRED_CHECKS = [
  "the real main process honoured the rig's throwaway profile",
  "the built preload exposes chatImageRead",
  "the built-in companion is ready so the studio opens",
  "the rig's vault is created through the real IPC",
  "the rig's vault is opened through the real IPC",
  "the picture is on disk inside the opened vault",
  "a vault-relative picture reads through the real IPC",
  "an absolute path inside the vault reads through the real IPC",
  "the two refs return the same picture",
  "a path that climbs out of the vault is refused through the real IPC",
  "a remote URL is refused through the real IPC",
  "an empty ref is refused through the real IPC",
  "a non-picture file is refused through the real IPC",
  "the shell renders after boot with the splash gone",
  "the reloaded page reads the picture again through the built bridge",
  "the artifact picture was written",
];

/** The operator's sentence every refusal must carry (design §2). */
const UNREADABLE = /could not be read/i;

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [rig],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        // Electron hosts export this; left in place the rig runs as plain Node
        // and never opens a window.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv,
      },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

function refused(result: ReadResult): void {
  assert.equal(result.ok, false, `the door returned a picture: ${JSON.stringify(result)}`);
  assert.equal(typeof result.error, "string", `the refusal carries no sentence: ${JSON.stringify(result)}`);
  assert.match(String(result.error), UNREADABLE, "the refusal is not the operator's sentence");
}

describe("chat images through the real app process", () => {
  it("reads a live vault's picture over the built preload bridge", async (t) => {
    for (const needed of [DIST_INDEX, MAIN_BUNDLE]) {
      if (!fs.existsSync(needed)) {
        t.skip(`no build at ${path.relative(desktopRoot, needed)} — run \`npm run build\` to include this e2e`);
        return;
      }
    }
    // The e2e profile seam is compiled out of the shipped bundle on purpose.
    // Booting a seam-less main would open the operator's real profile, so the
    // suite refuses rather than run it; the dev server rebuilds the main bundle
    // with the seam on.
    if (!fs.readFileSync(MAIN_BUNDLE, "utf8").includes("LIFEQUEST_E2E")) {
      t.skip(
        "the main bundle has no e2e profile seam — run through `lifequest-e2e` (or with `npm run dev` up) so the dev-built main is in place",
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(
      exitCode,
      0,
      `the chat-image IPC rig exited ${exitCode}: ${report.failures.join("; ")}`,
    );
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true, `the rig reported failures: ${report.failures.join("; ")}`);

    // Every check must have run and passed: a rig that silently drops one is a
    // shorter green run, not a green run.
    assert.ok(
      report.scenarios.length >= REQUIRED_CHECKS.length,
      `the rig reported only ${report.scenarios.length} check(s)`,
    );
    const byName = new Map(report.scenarios.map((scenario) => [scenario.name, scenario]));
    for (const name of REQUIRED_CHECKS) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig reported no check named "${name}"`);
      assert.equal(scenario.pass, true, `"${name}" failed: ${scenario.detail ?? "no detail"}`);
    }

    // A real preload, not a stub: many methods, and the picture door among them.
    assert.equal(report.bridge.present, true, "the window had no preload bridge");
    assert.equal(report.bridge.chatImageRead, "function", "the preload dropped chatImageRead");
    assert.ok(report.bridge.methodCount > 20, `the bridge exposes only ${report.bridge.methodCount} methods`);

    // The studio gates on a ready companion; the rig configured the built-in one
    // against a loopback model list so the shell (and the screenshot) exist.
    assert.ok(
      report.companion.settings === "ready" || report.companion.switched === "ready",
      `the built-in companion never reached ready: ${JSON.stringify(report.companion)}`,
    );

    // The world is this rig's own: a vault under the artifacts directory, a
    // throwaway profile, throwaway Hermes home and doors off the product's.
    const realArtifacts = fs.realpathSync(artifactsDir);
    assert.ok(
      report.vault.startsWith(path.join(realArtifacts, "ipc-vault")),
      `the rig's vault is not its own: ${report.vault}`,
    );
    assert.equal(
      report.userData,
      fs.realpathSync(path.join(artifactsDir, "userdata", "chat-image-ipc")),
      `the app did not run on the rig's throwaway profile: ${report.userData}`,
    );
    assert.ok(
      report.hermesHome.startsWith(artifactsDir),
      `the rig used a Hermes home outside its artifacts: ${report.hermesHome}`,
    );
    for (const port of [report.mcpPorts.local, report.mcpPorts.invite]) {
      assert.notEqual(port, 8643, "the rig bound the product's local MCP door");
      assert.notEqual(port, 8646, "the rig bound the product's invite MCP door");
    }
    assert.notEqual(report.mcpPorts.local, report.mcpPorts.invite, "the two MCP doors share a port");

    // Allowed refs: the same real picture, through the live vault. The bytes
    // are the fixture's own: 299 for the 120×80 PNG both chat-image rigs use.
    const pictureFile = path.join(report.vault, "attachments/chat/present-ipc.png");
    assert.equal(fs.existsSync(pictureFile), true, `the pictured file is gone: ${pictureFile}`);
    const onDisk = fs.statSync(pictureFile).size;
    assert.equal(onDisk, 299, `the fixture on disk is ${onDisk} bytes`);
    for (const [label, result] of [
      ["relative", report.reads.relative],
      ["absolute", report.reads.absolute],
    ] as const) {
      assert.equal(result.ok, true, `the ${label} ref did not read: ${JSON.stringify(result)}`);
      assert.equal(result.mime, "image/png", `the ${label} ref came back as ${result.mime}`);
      assert.equal(result.bytes, onDisk, `the ${label} ref returned ${result.bytes} bytes`);
      assert.equal(result.isBytes, true, `the ${label} ref's bytes did not survive IPC as a Uint8Array`);
    }
    assert.equal(report.reads.relative.bytes, report.reads.absolute.bytes);

    // Refused refs: the same live door answers the operator's one sentence and
    // never bytes.
    refused(report.reads.escaped);
    refused(report.reads.remote);
    refused(report.reads.empty);
    refused(report.reads.text);

    // A reload of the real renderer still shows the shipped shell (with this
    // vault open) and still reads the picture through the built bridge — the
    // AGENTS "verify the changed IPC against the restarted process" leg.
    assert.equal(report.shell.rendered, true, "the shipped shell never rendered with the vault open");
    assert.equal(report.reads.reloaded.ok, true, `the reloaded page could not read: ${JSON.stringify(report.reads.reloaded)}`);
    assert.equal(report.reads.reloaded.mime, "image/png");
    assert.equal(report.reads.reloaded.bytes, onDisk);

    // The picture is the shipped shell with this vault open.
    assert.ok(report.screenshot, "the rig recorded no picture");
    assert.equal(fs.existsSync(report.screenshot), true, `missing screenshot: ${report.screenshot}`);
    assert.ok(fs.statSync(report.screenshot).size > 0, "the screenshot is empty");
    assert.equal(report.screenshot, path.join(artifactsDir, "chat-image-ipc.png"));
  });
});
