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
const DRIVER = "decision-amend";
const REPORT = path.join(desktopRoot, `e2e/artifacts/${DRIVER}.json`);
const SCREENSHOTS = [
  "decision-amend-editor.png",
  "decision-amend-saved.png",
  "decision-amend-history.png",
];

/**
 * Amend then approve, end to end through the shipped page.
 *
 * This wraps the rig that drives the real `DecisionsInbox` and the real
 * `DecisionEditor` over a bridge stub that plays the main process, and asserts
 * every claim its artifact makes — including the facts a screenshot cannot show:
 * one amendment call per save, the amend-before-resolve order behind "Approve
 * with changes", and that an invalid JSON proposal never reaches the bridge.
 *
 * It renders a real page in a real layout engine, so it needs the Vite dev
 * server. With the server down the test skips; `lifequest-e2e` puts the checkout
 * under test on it. A skipped rig is evidence of nothing, so the artifact must
 * exist and the run must exit zero.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, `e2e/${name}.electron.mjs`)],
      { cwd: desktopRoot, timeout: 180_000 },
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

type Scenario = { name: string; pass: boolean; detail: string | null };

type Card = {
  id: string;
  title: string;
  status: string;
  kind: string | null;
  chip: string | null;
  hasEdit: boolean;
  hasApprove: boolean;
  hasReject: boolean;
  editing: boolean;
};

type Editor = {
  title: string;
  note: string;
  json: string;
  prose: boolean;
  fields: Record<string, string>;
  fieldInputCount: number;
  exactOpen: boolean;
  error: string | null;
  saveDisabled: boolean;
  approveChangesDisabled: boolean;
  revertVisible: boolean;
};

type Screen = {
  tabs: string[];
  activeTab: string | null;
  rows: Card[];
  editor: Editor | null;
  message: string | null;
  error: string | null;
  amendmentCalls: Array<{ id: string; input: Record<string, unknown> }>;
  resolveCalls: Array<{ id: string; resolution: string }>;
  callLog: Array<{ method: string } & Record<string, unknown>>;
  listCalls: number;
  unexpectedCalls: string[];
};

type Decision = {
  id: string;
  status: string;
  proposedTitle: string | null;
  proposedBodyMarkdown: string;
  amendedAt: string | null;
  amendedBy: { type: string } | null;
  amendmentNote: string | null;
  originalProposedTitle: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  scenarios: Scenario[];
  screenshots: string[];
  checks: {
    landing: Screen;
    editorOpen: Screen;
    expectedEditorJson: string;
    invalidJson: Screen;
    saved: Screen;
    savedBody: Record<string, unknown>;
    savedCall: { id: string; input: Record<string, unknown> };
    approved: Screen;
    approveAmend: { id: string; input: Record<string, unknown> };
    approveBody: Record<string, unknown>;
    resolveCall: { id: string; resolution: string };
    history: Screen;
    historyRow: Card;
    storedDeck: Decision;
    storedDeckBody: Record<string, unknown>;
    reverted: Screen;
    revertCall: { id: string; input: Record<string, unknown> };
    revertedRecord: Decision;
    proseEditor: Screen;
    proseCall: { id: string; input: Record<string, unknown> };
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  } & Record<string, unknown>;
};

describe("decision amend e2e", () => {
  it("edits, approves with changes, and reverts a pending proposal in the shipped inbox", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`lifequest-e2e\` to include this e2e`,
      );
      throw new Error("dev server down");
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver(DRIVER);
    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact — a skipped or silent rig is evidence of nothing",
    );

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // Every claim the rig exists to make, by name, so a silently dropped claim is
    // a failure rather than a report that happens to have fewer lines in it.
    const wanted = [
      "1-pending-cards-offer-edit-and-no-editor-is-open",
      "2-edit-opens-the-real-editor-prefilled-from-the-record",
      "3-save-changes-sends-one-amend-and-shows-the-edited-pending-card",
      "4-approve-with-changes-sends-amend-then-approve-and-history-says-edited",
      "5-revert-restores-the-agents-version-and-removes-the-chip",
      "6-invalid-json-shows-inline-and-disables-both-saves-with-no-call",
      "7-a-prose-decision-edits-markdown-not-fields",
      "8-the-page-logs-no-errors-and-asks-for-nothing-unexpected",
    ];
    const byName = new Map(report.scenarios.map((scenario) => [scenario.name, scenario]));
    for (const name of wanted) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig never ran the claim ${name}`);
      assert.equal(scenario.pass, true, `${name}: ${scenario.detail ?? ""}`);
    }

    // The facts the claims are made of, read straight off the artifact.
    const {
      landing,
      editorOpen,
      expectedEditorJson,
      invalidJson,
      saved,
      savedBody,
      savedCall,
      approved,
      approveAmend,
      approveBody,
      resolveCall,
      historyRow,
      storedDeck,
      storedDeckBody,
      reverted,
      revertCall,
      revertedRecord,
      proseEditor,
      proseCall,
    } = report.checks;

    // 1 — Pending is the landing tab, both proposals are there, and only the
    //     already-amended one wears the chip. No editor is open yet.
    assert.deepEqual(landing.tabs, ["Pending", "History", "Manual"]);
    assert.equal(landing.activeTab, "Pending");
    assert.deepEqual(
      landing.rows.map((row) => row.id),
      ["decision-deck", "decision-premise"],
    );
    const landingDeck = landing.rows.find((row) => row.id === "decision-deck");
    const landingPremise = landing.rows.find((row) => row.id === "decision-premise");
    assert.equal(landingDeck?.hasEdit, true);
    assert.equal(landingDeck?.chip, null);
    assert.equal(landingPremise?.hasEdit, true);
    assert.equal(landingPremise?.chip, "Edited by you");
    assert.equal(landing.editor, null);

    // 2 — The editor is the real one: the body-carried project title is in the
    //     title input, the summary is a typed field, the exact proposal is the
    //     record's JSON formatted for reading.
    assert.equal(editorOpen.editor?.title, "Buid a garden deck");
    assert.equal(editorOpen.editor?.fields.summary, "Outdoor build");
    assert.equal(editorOpen.editor?.prose, false);
    assert.equal(editorOpen.editor?.exactOpen, false);
    assert.equal(editorOpen.editor?.json, expectedEditorJson);
    assert.deepEqual(JSON.parse(expectedEditorJson), {
      type: "createProject",
      id: "proj-deck",
      title: "Buid a garden deck",
      summary: "Outdoor build",
      domainSlug: null,
      goalId: null,
    });

    // 6 — Invalid JSON is a local state: the editor says so, both saves wait,
    //     and the bridge has heard nothing.
    assert.match(invalidJson.editor?.error ?? "", /not valid JSON/i);
    assert.equal(invalidJson.editor?.saveDisabled, true);
    assert.equal(invalidJson.editor?.approveChangesDisabled, true);
    assert.deepEqual(invalidJson.amendmentCalls, []);

    // 3 — One amend carries the corrected title, the corrected summary and the
    //     operator's note; the card is pending, corrected and chipped.
    assert.equal(saved.amendmentCalls.length, 1);
    assert.equal(savedCall.id, "decision-deck");
    assert.equal(savedCall.input.proposedTitle, "Build a garden deck");
    assert.equal(savedCall.input.note, "Fix the spelling");
    assert.equal(savedBody.type, "createProject");
    assert.equal(savedBody.id, "proj-deck");
    assert.equal(savedBody.title, "Build a garden deck");
    assert.equal(savedBody.summary, "Outdoor build, cedar frame");
    assert.equal(savedBody.domainSlug, null);
    assert.equal(savedBody.goalId, null);
    const savedDeck = saved.rows.find((row) => row.id === "decision-deck");
    assert.equal(savedDeck?.title, "Build a garden deck");
    assert.equal(savedDeck?.status, "pending");
    assert.equal(savedDeck?.chip, "Edited by you");
    assert.equal(saved.message, "Changes saved.");

    // 4 — Approve with changes: one more amend (with the added detail), then the
    //     approve; the card leaves Pending and History names what was applied.
    assert.equal(approved.amendmentCalls.length, 2);
    assert.equal(approveAmend.id, "decision-deck");
    assert.equal(approveAmend.input.proposedTitle, "Build a garden deck");
    assert.equal(approveAmend.input.note, "Add the frame detail");
    assert.equal(approveBody.title, "Build a garden deck");
    assert.equal(approveBody.summary, "Outdoor build, cedar frame");
    assert.equal(approveBody.bodyMarkdown, "Cedar frame, two planters, sealed.");
    assert.deepEqual(resolveCall, { id: "decision-deck", resolution: "approved" });
    const writes = approved.callLog.filter(
      (entry) => entry.method === "decisionAmend" || entry.method === "decisionResolve",
    );
    assert.deepEqual(
      writes.map((entry) => entry.method),
      ["decisionAmend", "decisionAmend", "decisionResolve"],
      "Approve with changes did not amend before it approved",
    );
    assert.equal(approved.rows.some((row) => row.id === "decision-deck"), false);
    assert.equal(historyRow.id, "decision-deck");
    assert.equal(historyRow.status, "approved · edited");
    assert.equal(storedDeck.status, "approved");
    assert.equal(storedDeck.proposedTitle, "Build a garden deck");
    assert.equal(storedDeckBody.title, "Build a garden deck");
    assert.equal(storedDeckBody.summary, "Outdoor build, cedar frame");
    assert.equal(storedDeckBody.bodyMarkdown, "Cedar frame, two planters, sealed.");

    // 5 — Revert is exactly one call carrying only {revert:true}, and the card
    //     goes back to the agent's spelling with no chip.
    assert.deepEqual(revertCall, { id: "decision-premise", input: { revert: true } });
    const revertedRow = reverted.rows.find((row) => row.id === "decision-premise");
    assert.equal(revertedRow?.title, "Sleep more");
    assert.equal(revertedRow?.chip, null);
    assert.equal(reverted.message, "Reverted to the agent's version.");
    assert.equal(revertedRecord.proposedTitle, "Sleep more");
    assert.equal(revertedRecord.proposedBodyMarkdown, "Rest when you can.");
    assert.equal(revertedRecord.amendedAt, null);
    assert.equal(revertedRecord.amendedBy, null);
    assert.equal(revertedRecord.amendmentNote, null);
    assert.equal(revertedRecord.originalProposedTitle, null);

    // 7 — A doctrine body is prose: the markdown textarea, no typed fields, and
    //     the saved markdown is what the bridge was sent.
    assert.equal(proseEditor.editor?.prose, true);
    assert.equal(proseEditor.editor?.fieldInputCount, 0);
    assert.equal(
      proseEditor.editor?.json,
      "Rest when you can.",
      "the prose editor did not start on the agent's markdown",
    );
    assert.equal(proseCall.input.proposedBodyMarkdown, "Rest is when the body repairs. Eight hours, no screens.");
    assert.equal(proseCall.input.proposedTitle, "Sleep more");

    // 8 — Nothing unexpected was asked of the bridge, the page logged no errors,
    //     and the three pictures exist on disk.
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);
    for (const file of SCREENSHOTS) {
      assert.ok(report.screenshots.includes(file), `rig did not capture ${file}`);
      const full = path.join(desktopRoot, "e2e/artifacts", file);
      assert.ok(fs.existsSync(full), `missing screenshot ${file}`);
      assert.ok(
        fs.statSync(full).size > 10_000,
        `${file} is too small to be a screenshot of the page`,
      );
    }
  });
});
