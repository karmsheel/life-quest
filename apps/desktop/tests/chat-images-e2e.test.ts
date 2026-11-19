/**
 * Pictures in the chat, end to end: the chat-panel harness page
 * (`e2e/chat-panel.{html,tsx}?images=1`) driven by
 * `chat-images.electron.mjs` for the renderer half, and the same rig's main leg
 * for `electron/chat-image.ts`'s read door against a throwaway vault.
 *
 * The rig writes `e2e/artifacts/chat-images.{json,png}`; the assertions below
 * restate the contract from that JSON, so a driver that reports `pass` for a
 * picture that never reached the screen still fails the suite.
 *
 * The two halves are one feature and one rig: the renderer asks the read door
 * for a ref, and the door decides what may be read. A run that proves only one
 * side proves a mock.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-images.json");
const SHOT = path.join(desktopRoot, "e2e/artifacts/chat-images.png");

type Box = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

type Picture = {
  source: "answer" | "sent";
  state: "loading" | "ready" | "missing";
  title: string | null;
  insideUserImages: boolean;
  insideTurnUser: boolean;
  insideTurnAnswer: boolean;
  img: { src: string | null; alt: string | null } | null;
  text: string;
  box: Box | null;
};

type Turn = {
  status: string | null;
  userText: string;
  answerText: string;
  userImageRow: boolean;
  userImages: Picture[];
  answerImages: Picture[];
};

type Report = {
  pass: boolean;
  failures: string[];
  scenarios: { name: string; pass: boolean; detail: string | null }[];
  url: string;
  renderer: {
    history: {
      turn: Turn | null;
      askedRefs: string[];
      messagesText: string;
    };
    otherChat: { pictures: number; turns: Turn[] };
    overlay: {
      opened: boolean;
      closePresent: boolean;
      imageSrcs: string[];
      closedByEscape: boolean;
      backdropClicked: boolean;
      closedByBackdrop: boolean;
    };
    live: { turn: Turn | null; picture: Picture | null };
    composer: {
      attachCall: { mime: string; name: string; bytes: number } | null;
      sentTurn: Turn | null;
      sentThumbnail: Picture | null;
      chipsLeft: number;
    };
    reload: { turn: Turn | null; picture: Picture | null; calls: { ref: string }[] };
  } | null;
  readDoor: {
    ceiling: number;
    vaultRoot: string;
    profileHome: string;
    allowed: { storedRelative: string; storedAbsolute: string; nativeAbsolute: string };
  } | null;
  instruction: {
    pass: boolean;
    checks: { name: string; pass: boolean; detail: string | null }[];
    rule: { withRoot: string; withoutRoot: string } | null;
  } | null;
  screenshot: string | null;
};

/**
 * Every check the rig must report as passing. The names are the rig's own, so a
 * rig that quietly stops checking one is a failure here rather than a shorter
 * green run.
 */
const REQUIRED_CHECKS = [
  // The renderer half: the history row the gateway wrote, the answer's markdown
  // picture, the missing chip, the overlay, a live answer, the composer's send.
  "the pictures history chat can be opened from the rail",
  "the reloaded operator row keeps its turn",
  "the reloaded operator row draws its sent picture",
  "the sent picture paints from a blob the app minted, not a path",
  "the gateway's picture markers are not printed as words",
  "the operator's words survive the marker strip exactly",
  "the answer's markdown picture is drawn",
  "the answer's picture keeps its caption as the alt text",
  "the answer's picture paints from a blob, not the raw path",
  "an unreadable picture is the quiet missing chip, not a broken image",
  "the missing chip says why the picture is not there",
  "the words around the pictures survive exactly",
  "no raw markdown or vault path is printed in the thread",
  "no picture in the thread loads a raw path",
  "the thread asked the read door for the three refs its pictures name",
  "the picture-free chat can be opened from the rail",
  "a picture-free chat draws no picture at all",
  "a ready picture is a button that can be clicked",
  "clicking a picture opens the picture overlay",
  "the overlay shows the picture that was clicked",
  "Escape closes the picture overlay",
  "the overlay's backdrop is hit-testable outside the picture",
  "clicking the backdrop closes the picture overlay",
  "the composer sends the live message",
  "the live answer paints the picture its reply names",
  "the live answer's picture keeps the markdown caption as alt",
  "the live answer paints from a blob",
  "the live turn settled back to an idle composer",
  "the add control takes a picture into the composer",
  "the composer sends the attached picture",
  "the operator's sent picture shows as a thumbnail in their own bubble",
  "the sent thumbnail paints from a blob the app minted",
  "the sent picture is a mini square, not the answer column",
  "the composer's attachment chip is gone after the send",
  "an image-only message still shows its operator row",
  "the artifact picture was written",
  "a reload keeps the operator row's sent picture",
  "the reloaded page read the picture again through the door",
  "the reloaded page still prints no marker text",
  // The main half: the door reads the three refs a chat legitimately names and
  // refuses every shape it must not.
  "the read door module exports readChatImage and a size ceiling",
  "publishes the 24 MB picture ceiling",
  "reads a vault-relative picture",
  "reads an absolute path inside the vault",
  "reads an absolute path under the profile's native-inputs",
  "the vault's own picture is on disk where the ref says",
  "the profile's retained copy is on disk where the hint says",
  "refuses a path that climbs out of the vault",
  "refuses an absolute path outside both allowed roots",
  "refuses a remote URL",
  "refuses a data URL",
  "refuses a file that is not a picture extension",
  "refuses a picture whose bytes are text",
  "refuses a picture whose bytes are another format",
  "refuses a symlinked leaf",
  "refuses a picture over the size ceiling",
  "refuses a picture that is not on disk",
  "refuses an empty ref",
  "refuses a NUL in the ref",
  "a relative ref and the vault's absolute path name the same picture",
  // The instruction half: the picture rule the agent is handed every turn, and
  // the vault root it may save under only while a vault is open.
  "the instruction module exports buildInstructions",
  "an ordinary turn carries the picture rule",
  "the picture rule names the open vault's root",
  "a turn with no vault still carries the picture rule",
  "a turn with no vault names no root it cannot write",
  "the picture rule says a remote or data URL is never drawn",
  "both transports are handed the same picture rule",
];

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

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/chat-images.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000 },
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

/**
 * One picture control the transcript should hold: a ready one with a blob
 * source, or the quiet missing chip with no `<img>` at all.
 */
function assertPicture(
  label: string,
  picture: Picture | null | undefined,
  expected: { source: "answer" | "sent"; alt?: string },
): void {
  assert.ok(picture, `${label}: no picture`);
  assert.equal(picture.state, "ready", `${label}: state ${picture.state}`);
  assert.equal(picture.source, expected.source, `${label}: source ${picture.source}`);
  assert.ok(
    String(picture.img?.src ?? "").startsWith("blob:"),
    `${label}: src ${JSON.stringify(picture.img?.src)} is not a blob the app minted`,
  );
  if (expected.alt !== undefined) {
    assert.equal(picture.img?.alt, expected.alt, `${label}: alt ${JSON.stringify(picture.img?.alt)}`);
  }
}

describe("chat images", () => {
  it("reads, draws and keeps pictures in both directions", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
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
      `the chat-images rig exited ${exitCode}: ${report.failures.join("; ")}`,
    );
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true, `the rig reported failures: ${report.failures.join("; ")}`);

    // Every check the rig names must have run and passed: a rig that quietly
    // stops checking one is a shorter green run, not a green run.
    assert.ok(
      report.scenarios.length >= 55,
      `the rig reported only ${report.scenarios.length} check(s)`,
    );
    const byName = new Map(report.scenarios.map((scenario) => [scenario.name, scenario]));
    for (const name of REQUIRED_CHECKS) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig reported no check named "${name}"`);
      assert.equal(
        scenario.pass,
        true,
        `"${name}" failed: ${scenario.detail ?? "no detail"}`,
      );
    }

    // The run photographed the shipped screen, after the overlay was closed and
    // after the sent bubble showed its thumbnail. A missing picture is not a
    // report.
    assert.equal(fs.existsSync(SHOT), true, "driver wrote no screenshot artifact");
    assert.ok(fs.statSync(SHOT).size > 0, "the screenshot artifact is empty");
    assert.equal(report.screenshot, SHOT, "the report does not name its picture");
    assert.match(report.url, /\?images=1$/, `the rig did not open the pictures page: ${report.url}`);

    assert.ok(report.renderer, "the rig ran no renderer leg");
    const renderer = report.renderer;
    const { history, otherChat, overlay, live, composer, reload } = renderer;

    // A. The reloaded operator row: the gateway's markers become a picture in
    // the operator's own bubble, painted from bytes main handed over, and the
    // marker lines are gone from the words.
    assert.ok(history.turn, "the pictures history turn never rendered");
    assert.equal(history.turn.userText, "look at this", "the marker strip lost or kept words");
    assert.equal(history.turn.userImageRow, true, "the operator's row grew no picture row");
    const sentPicture = history.turn.userImages.find((picture) => picture.state === "ready");
    assertPicture("the reloaded operator picture", sentPicture, { source: "sent" });
    assert.equal(
      sentPicture?.insideUserImages,
      true,
      "the sent picture did not sit in the row above the words",
    );
    assert.doesNotMatch(history.messagesText, /\[screenshot\]/);
    assert.doesNotMatch(history.messagesText, /\[Image attached/);

    // B. The answer's markdown picture and its quiet missing sibling: the first
    // is drawn in the answer bubble with its caption as alt, the second is a
    // chip that explains itself instead of a broken image or raw markdown.
    const answerPictures = history.turn.answerImages;
    const presentAnswer = answerPictures.find(
      (picture) => picture.state === "ready" && picture.source === "answer",
    );
    assertPicture("the answer's markdown picture", presentAnswer, {
      source: "answer",
      alt: "the floor plan",
    });
    assert.equal(presentAnswer?.insideTurnAnswer, true, "the picture is not in the answer bubble");
    const missing = answerPictures.find((picture) => picture.state === "missing");
    assert.ok(missing, "the unreadable picture did not become a missing chip");
    assert.equal(missing.img, null, "the missing chip holds an <img> of something");
    assert.match(String(missing.title ?? ""), /could not be read/i, "the chip does not say why");

    // C. The text runs around the pictures are untouched, and nothing was
    // rendered twice as raw markdown.
    assert.match(history.turn.answerText, /Here is the plan:/);
    assert.match(history.turn.answerText, /and a missing one/);
    assert.doesNotMatch(history.messagesText, /!\[/);
    assert.doesNotMatch(history.messagesText, /attachments\/chat\//);

    // D. The read door was asked for exactly the refs the pictures name — the
    // vault picture, the unreadable one, and the gateway's retained copy.
    assert.ok(history.askedRefs.includes("attachments/chat/present-plan.png"));
    assert.ok(history.askedRefs.includes("attachments/chat/missing-plan.png"));
    assert.ok(
      history.askedRefs.some((ref) => ref.endsWith("native-inputs/present-user.png")),
      `the sent picture's hint was never read: ${JSON.stringify(history.askedRefs)}`,
    );

    // E. A chat with no pictures grows none.
    assert.equal(otherChat.pictures, 0, "a picture-free chat drew a picture");
    assert.equal(otherChat.turns.length > 0, true, "the picture-free chat never loaded");

    // F. The thumbnail opens the overlay, and both dismissals close it.
    assert.equal(overlay.opened, true, "clicking a picture opened no overlay");
    assert.equal(overlay.closePresent, true, "the overlay has no close control");
    assert.ok(
      overlay.imageSrcs.some((src) => String(src).startsWith("blob:")),
      `the overlay shows no picture: ${JSON.stringify(overlay.imageSrcs)}`,
    );
    assert.equal(overlay.closedByEscape, true, "Escape left the overlay up");
    assert.equal(overlay.backdropClicked, true, "the backdrop was not hit-testable");
    assert.equal(overlay.closedByBackdrop, true, "a backdrop click left the overlay up");

    // G. A live reply that names a markdown picture paints it in its answer
    // bubble, with the caption as alt.
    assert.ok(live.turn, "the live turn never rendered");
    assertPicture("the live answer's picture", live.picture, {
      source: "answer",
      alt: "the shot",
    });

    // H. The composer's sent picture rides the turn into the operator's bubble
    // as a thumbnail, and the composer does not keep its chip.
    assert.deepEqual(composer.attachCall, {
      mime: "image/png",
      name: "present-shot.png",
      bytes: 299,
    });
    assert.ok(composer.sentTurn, "the composer's turn never rendered");
    assertPicture("the sent thumbnail", composer.sentThumbnail, { source: "sent" });
    assert.equal(
      composer.sentThumbnail?.insideUserImages,
      true,
      "the sent thumbnail is not in the operator's picture row",
    );
    assert.ok(composer.sentThumbnail?.box, "the sent thumbnail has no box");
    assert.ok(
      Math.abs(
        (composer.sentThumbnail?.box.width ?? 0) - (composer.sentThumbnail?.box.height ?? 0),
      ) <= 2,
      `the sent thumbnail is not square: ${JSON.stringify(composer.sentThumbnail?.box)}`,
    );
    assert.ok(
      (composer.sentThumbnail?.box.width ?? Number.POSITIVE_INFINITY) < 96,
      `the sent thumbnail is not mini: ${JSON.stringify(composer.sentThumbnail?.box)}`,
    );
    assert.equal(composer.chipsLeft, 0, "the composer kept an attachment chip after the send");
    assert.equal(composer.sentTurn?.userText, "", "an image-only message grew words");
    assert.equal(
      composer.sentTurn?.userImageRow,
      true,
      "an image-only message drew no operator row",
    );

    // I. A reload of the pictures page keeps the operator row's picture, the
    // failure mode that only ever showed up live.
    assertPicture("the reloaded picture", reload.picture, { source: "sent" });
    assert.ok(reload.calls.length > 0, "the reloaded page never asked the read door");
    assert.doesNotMatch(reload.turn?.userText ?? "look at this", /\[screenshot\]/);

    // J. The read door itself: the ceiling is the spec's 24 MB, and its allowed
    // roots are the throwaway ones the rig made, not the operator's.
    assert.ok(report.readDoor, "the rig ran no read-door leg");
    assert.equal(report.readDoor.ceiling, 24 * 1024 * 1024);
    assert.match(report.readDoor.vaultRoot, /e2e\/artifacts\/userdata\/chat-images\//);
    assert.match(report.readDoor.profileHome, /e2e\/artifacts\/userdata\/chat-images\//);

    // K. The instruction leg: the agent is told the chat draws a picture only
    // when it is a file in the vault, that remote/data URLs are never drawn, and
    // the root it may save under — but only while a vault is open. A rule with a
    // root on a closed vault teaches the agent to write a path the app cannot
    // read; a rule that vanishes on an ordinary turn means the agent never knows
    // drawing exists.
    assert.ok(report.instruction, "the rig ran no instruction leg");
    assert.equal(report.instruction.pass, true, "the instruction leg reported a failure");
    assert.equal(
      report.instruction.checks.length,
      7,
      `the instruction leg ran ${report.instruction.checks.length} check(s)`,
    );
    const instructionRule = report.instruction.rule;
    assert.ok(instructionRule, "the instruction leg captured no picture rule");
    assert.match(instructionRule.withRoot, /!\[/, "the rule teaches no markdown picture tag");
    assert.match(instructionRule.withRoot, /\.(?:png|jpe?g|gif|webp)/i, "the rule names no picture extension");
    assert.match(instructionRule.withRoot, /picture/i, "the rule never says 'picture'");
    assert.ok(
      instructionRule.withRoot.includes("/tmp/vault-root"),
      `the rule does not name the open vault's root: ${instructionRule.withRoot}`,
    );
    assert.match(
      instructionRule.withRoot,
      /root on this machine/i,
      "the rule names no root sentence for the agent",
    );
    assert.match(instructionRule.withoutRoot, /!\[/, "the no-vault rule dropped the picture tag");
    assert.doesNotMatch(
      instructionRule.withoutRoot,
      /root on this machine/i,
      `the no-vault rule names a root: ${instructionRule.withoutRoot}`,
    );
    assert.doesNotMatch(
      instructionRule.withoutRoot,
      /\/tmp\/vault-root/,
      "the no-vault rule kept a vault root",
    );
    assert.match(
      instructionRule.withRoot,
      /remote URL or a data URL is never drawn/i,
      "the rule does not refuse remote and data URLs",
    );
  });
});
