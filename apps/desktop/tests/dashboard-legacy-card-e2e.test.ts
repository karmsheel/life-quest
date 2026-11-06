import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createVault, listPinBoard } from "@lifequest/vault-core";

/**
 * A board file written by an older build, read by this one.
 *
 * Removing a built-in card from the app leaves its id in every board file that
 * was saved while it existed. The read path must drop it the way it drops a
 * deleted view or page: a board that kept the pin would draw a card frame with
 * no card in it, and the operator would have to unpin furniture by hand.
 *
 * The claim is made against a real vault on disk and the real read path —
 * `createVault`, a board file in the shape the old build wrote, then
 * `listPinBoard` — so it says what the product does rather than what a fixture
 * says it does.
 *
 * Two halves, because either alone can pass for the wrong reason:
 *
 *  1. A saved board naming the removed card reads back WITHOUT it, between the
 *     cards that still exist, and the read does not rewrite the file: dropping
 *     the pin is a read-path rule, not a migration that touches the operator's
 *     vault behind their back.
 *  2. A brand-new board does not seed the removed card either, so "it is gone"
 *     is not a claim about one old file.
 *
 * The artifact is `e2e/artifacts/dashboard-legacy-card.json`.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/dashboard-legacy-card.json");

/** The built-in cards a fresh board seeds, in order — the app's current set. */
const SEEDED_IDS = [
  "sys:companion-brief",
  "sys:goal-progress",
  "sys:deadline",
  "sys:today-week",
  "sys:pending-decisions",
  "sys:recent-log",
];

describe("dashboard legacy card e2e", () => {
  it("drops a built-in card the app no longer ships, and never seeds it again", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-dashboard-legacy-"));
    const checks: Record<string, unknown> = {};

    // ── an old board: a removed built-in between two that still exist ───────
    const oldVault = path.join(workDir, "old");
    const oldCreated = await createVault(oldVault, "Old");
    assert.equal(oldCreated.ok, true, `createVault failed: ${oldCreated.ok ? "" : oldCreated.error}`);

    const boardFile = path.join(oldVault, ".lifequest", "overview-pins.json");
    const legacy = {
      schemaVersion: 1 as const,
      pins: [
        { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
        { id: "sys:doctrine-progress", kind: "system", system: "doctrine-progress" },
        { id: "sys:recent-log", kind: "system", system: "recent-log" },
      ],
      locked: false,
    };
    fs.writeFileSync(boardFile, `${JSON.stringify(legacy, null, 2)}\n`);
    checks.legacyBoard = legacy.pins.map((pin) => pin.system);

    const readOld = await listPinBoard(oldVault, null);
    assert.equal(readOld.ok, true, `listPinBoard failed: ${readOld.ok ? "" : readOld.error}`);
    const oldPins = (readOld as { ok: true; value: { pins: { id: string }[] } }).value.pins;
    checks.oldBoardOnRead = oldPins.map((pin) => pin.id);
    assert.deepEqual(
      oldPins.map((pin) => pin.id),
      ["sys:goal-progress", "sys:recent-log"],
      "a board naming a removed built-in card still drew it",
    );

    // A read is not a migration: the operator's file is byte-for-byte unchanged
    // until they edit the board themselves.
    const onDisk = fs.readFileSync(boardFile, "utf8");
    checks.fileAfterRead = JSON.parse(onDisk);
    assert.equal(
      onDisk,
      `${JSON.stringify(legacy, null, 2)}\n`,
      "reading the board rewrote the operator's file",
    );

    // ── a new board does not seed it either ─────────────────────────────────
    const freshVault = path.join(workDir, "fresh");
    const freshCreated = await createVault(freshVault, "Fresh");
    assert.equal(
      freshCreated.ok,
      true,
      `createVault failed: ${freshCreated.ok ? "" : freshCreated.error}`,
    );
    const readFresh = await listPinBoard(freshVault, null);
    assert.equal(readFresh.ok, true, `listPinBoard failed: ${readFresh.ok ? "" : readFresh.error}`);
    const freshPins = (readFresh as { ok: true; value: { pins: { id: string }[] } }).value.pins;
    checks.freshBoard = freshPins.map((pin) => pin.id);
    assert.deepEqual(
      freshPins.map((pin) => pin.id),
      SEEDED_IDS,
      "a new board seeded the cards the app still ships, plus or minus one",
    );

    const report = { pass: true, failures: [], checks, generatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
