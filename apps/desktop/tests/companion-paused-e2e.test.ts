import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The paused-conversation banner, end to end, against the real dock.
 *
 * `e2e/companion-paused.electron.mjs` opens the chat-panel harness in a real
 * Electron window, feeds it the SSE frame Hermes really sends for a conversation
 * it has paused, and reads back what the dock paints. The frame goes through
 * `window.__lqParseSse`, which the harness page binds to the real
 * `parseSseBlock` from `electron/companion-client.ts`, and the resulting event is
 * pushed through the callback ChatPanel itself registered — so both halves under
 * test are the ship code, not a fixture's idea of it. This file only decides
 * whether the artifact says what the fix claims.
 *
 * WHY THIS RIG EXISTS
 *
 * On 2026-10-19 an operator's in-app agent "was not working": two sends into one
 * conversation produced no reply at all. The host had paused that conversation
 * after a turn was killed mid-run, and the only thing the app had to say about it
 * was the runtime's own token —
 *
 *   WARNING gateway.session_authority: Session api_… paused: unknown_execution
 *
 * — which names neither the cause nor the control that recovers. The dock now
 * has to say what happened and what to do about it.
 *
 * THE WAYS THIS COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 *   1. THE FRAME STOPS BEING THE HOST'S: if a later edit softens the fixture
 *      frame into something Hermes never sends, the rig would prove a shape the
 *      app will never meet. So the frame is asserted here as well as in the rig,
 *      and it must carry `event: error` and the `unknown_execution` token.
 *   2. THE DOCK SAYS THE RIGHT WORDS FROM A STUB: the bridge is stubbed (a
 *      dev-server page has no preload) but the decoder is not, and the panel is
 *      the real component, so a translation that never happened would leave the
 *      token on screen. The artifact's `checks.pausedBanner` is the painted text.
 *   3. IT GOES GREEN BY TRANSLATING EVERYTHING: a mapper that answered every
 *      error with the pause sentence would pass the first check and lose real
 *      diagnoses. The artifact's control banner must read the ordinary error's
 *      own words.
 */
const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/companion-paused.json");

/** The sentence the dock must paint. Pinned here so a silent reword fails. */
const PAUSED_SENTENCE =
  "This conversation is paused because a turn was interrupted — start a new chat.";

/** An ordinary failure, which must reach the screen untouched. */
const OTHER_SENTENCE = "provider said no";

type Report = {
  pass: boolean;
  failures: string[];
  expected: { pausedSentence: string; otherSentence: string };
  frames: { paused: string; control: string };
  checks: {
    parsedPausedMessage: string | null;
    parsedPausedIsError: boolean;
    pausedBanner: string | null;
    pausedBannerIsSentence: boolean;
    pausedBannerHoldsToken: boolean;
    parsedOtherMessage: string | null;
    otherBanner: string | null;
    consoleErrors: string[];
  };
};

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/companion-paused.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({ code: error ? (error.code as number) : 0, stderr });
      },
    );
  });
}

describe("companion paused banner e2e", () => {
  it("tells the operator the conversation is paused, and how to get a working one", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const run = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "the rig wrote no report artifact");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.equal(
      report.pass,
      true,
      `the rig's own verdict failed: ${report.failures.join("; ")}`,
    );
    assert.equal(run.code, 0, `the rig exited ${run.code}: ${run.stderr.slice(-2000)}`);
    assert.deepEqual(
      report.checks.consoleErrors,
      [],
      "the page logged console errors",
    );

    // The frame under test is the host's, not one this suite invented.
    assert.match(report.frames.paused, /^event: error\n/);
    assert.match(report.frames.paused, /unknown_execution/);

    // The real decoder turned the runtime token into something an operator can
    // act on, rather than passing the token through.
    assert.equal(report.checks.parsedPausedIsError, true);
    assert.equal(report.checks.parsedPausedMessage, PAUSED_SENTENCE);
    assert.equal(report.expected.pausedSentence, PAUSED_SENTENCE);

    // And the dock painted it.
    assert.equal(report.checks.pausedBanner, PAUSED_SENTENCE);
    assert.equal(report.checks.pausedBannerIsSentence, true);
    assert.equal(report.checks.pausedBannerHoldsToken, false);
    assert.doesNotMatch(report.checks.pausedBanner ?? "", /unknown_execution/i);

    // The translation is specific: an ordinary failure still says its own words.
    assert.equal(report.checks.parsedOtherMessage, OTHER_SENTENCE);
    assert.equal(report.checks.otherBanner, OTHER_SENTENCE);
    assert.equal(report.expected.otherSentence, OTHER_SENTENCE);
  });
});
