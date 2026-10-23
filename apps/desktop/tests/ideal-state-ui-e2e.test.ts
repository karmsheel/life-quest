import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Ideal State page, rendered by the real shell in a real layout engine. The
 * claims themselves live in `e2e/ideal-state.electron.mjs`, which drives the
 * harness; this file runs that driver and refuses a report that does not hold.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `lifequest-e2e` puts this checkout's server on 5173 for the run.
 *
 * The artifact is `e2e/artifacts/ideal-state.json` plus the pictures the driver
 * captures — the page holding several documents, the wide two-column layout,
 * and the landing state.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/ideal-state.json");

type Row = {
  id: string;
  title: string | null;
  edited: string | null;
  current: boolean;
  unreadable: boolean;
};
type Write = {
  op: "create" | "update" | "delete";
  id: string | null;
  title: string | null;
  body: string | null;
  shownTitle: string | null;
  shownId: string | null;
};
type State = {
  route: string | null;
  rail: { label: string | null; href: string | null; active: boolean }[];
  activeRail: string | null;
  activeWing: string | null;
  heading: string | null;
  titleValue: string | null;
  titleFocused: boolean;
  focusedTestId: string | null;
  body: string | null;
  status: string | null;
  error: string | null;
  rows: Row[];
  selectedId: string | null;
  editorBoxes: number;
  splits: number;
  previews: number;
  writingLines: number;
  saveControls: number;
  writes: Write[];
  calls: string[];
  unexpected: string[];
  store: Record<string, { title: string; body: string }>;
};
type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    landing: State;
    afterBody: State;
    afterRename: State;
    blank: State;
    afterNew: State;
    switched: State;
    refused: State;
    recovered: State;
    afterDelete: State;
    final: State;
    createWrites: Write[];
    idleWrites: { before: number; after: number };
    wide: {
      compose: { left: number; top: number; width: number; height: number } | null;
      editor: { left: number; top: number; width: number; height: number } | null;
      history: { left: number; top: number; width: number; height: number } | null;
    };
  };
  screenshots: string[];
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

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/ideal-state.electron.mjs")],
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

describe("ideal state (Define rail, titled documents, one live editor)", () => {
  it("creates, renames, switches between and deletes titled markdown documents", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`lifequest-e2e\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    const {
      landing,
      afterBody,
      afterRename,
      blank,
      afterNew,
      switched,
      refused,
      recovered,
      afterDelete,
      final,
      createWrites,
      idleWrites,
      wide,
    } = report.checks;

    // The page belongs to Define, and the rail names it.
    assert.equal(landing.route, "/ideal-state");
    assert.equal(landing.activeWing, "Define", "/ideal-state did not select Define");
    assert.equal(landing.activeRail, "Ideal State");
    assert.ok(
      landing.rail.some((item) => item.label === "Ideal State"),
      `the Define rail lost Ideal State: ${JSON.stringify(landing.rail)}`,
    );
    assert.equal(landing.heading, "Ideal State");
    assert.equal(landing.editorBoxes, 1, "the page drew more than one editor");
    assert.equal(landing.splits, 0, "a split editor came back");
    assert.equal(landing.previews, 0, "a preview pane came back");
    assert.equal(landing.saveControls, 0, "a Save control came back");

    // Landing opens the newest document, prose and all.
    assert.equal(landing.titleValue, "A calm morning");
    assert.match(landing.body ?? "", /Wake before the house\./);
    assert.equal(landing.status, "Saved");
    assert.deepEqual(
      landing.rows.map((row) => row.id),
      ["doc-alpha", "doc-beta"],
      "the strip is not newest first",
    );
    assert.equal(landing.selectedId, "doc-alpha");

    // A body edit reaches that document; a rename reaches the same one.
    assert.ok(
      afterBody.writes.some(
        (write) =>
          write.op === "update" &&
          write.id === "doc-alpha" &&
          write.body?.includes("Walk while it is quiet, then write."),
      ),
      `the body edit did not reach the document: ${JSON.stringify(afterBody.writes)}`,
    );
    assert.ok(
      afterRename.rows.some((row) => row.title === "A calm, strong morning"),
      `the renamed title is not in the list: ${JSON.stringify(afterRename.rows)}`,
    );
    assert.equal(
      afterRename.writes.filter((write) => write.op === "create").length,
      0,
      "a rename created a document",
    );

    // An untitled draft writes nothing; once titled, it creates one document.
    assert.equal(blank.titleValue, "");
    assert.equal(blank.focusedTestId, "ideal-state-title");
    assert.equal(blank.status, "Give this document a title");
    assert.equal(
      blank.writes.length,
      afterRename.writes.length,
      "an untitled draft wrote something",
    );
    assert.equal(
      createWrites.filter((write) => write.op === "create").length,
      1,
      "creating one document made more than one",
    );
    assert.match(createWrites.at(-1)?.body ?? "", /Wake to the water\./);
    assert.equal(afterNew.rows.length, 3);
    assert.equal(afterNew.rows[0]?.title, "A house by the sea");
    assert.equal(afterNew.selectedId, createWrites.at(-1)?.id);

    // Selecting another row loads its own title and prose.
    assert.equal(switched.titleValue, "Work that matters");
    assert.match(switched.body ?? "", /Build one thing well\./);
    assert.equal(switched.selectedId, "doc-beta");

    // A refused write keeps the draft, then Ctrl+S lands it.
    assert.match(refused.error ?? "", /refused/, "the refusal had no reason on screen");
    assert.equal(refused.titleValue, "Refused document");
    assert.equal(refused.status, "Not saved");
    assert.ok(
      Object.values(refused.store).every((doc) => doc.title !== "Refused document"),
      "a refused create still made a document",
    );
    assert.equal(idleWrites.after, idleWrites.before, "an idle page kept writing");
    assert.equal(recovered.status, "Saved");
    assert.ok(
      Object.values(recovered.store).some((doc) => doc.title === "Refused document"),
      "Ctrl+S did not release the refused draft",
    );

    // Delete asks, removes, and the page lands on another document.
    assert.equal(afterDelete.rows.length, 3);
    assert.equal(
      afterDelete.writes.filter((write) => write.op === "delete").length,
      1,
    );
    assert.notEqual(afterDelete.selectedId, recovered.selectedId);
    assert.equal(
      Object.keys(afterDelete.store).length,
      3,
      "the deleted document is still in the store",
    );

    // The wide page puts the strip beside the box, sharing a top edge.
    assert.ok(wide.compose && wide.history, "the wide layout reported no box or strip");
    if (wide.compose && wide.history) {
      assert.ok(
        Math.abs(wide.history.top - wide.compose.top) <= 4,
        "the strip and the box do not share a top edge",
      );
      assert.ok(
        wide.history.left + wide.history.width <= wide.compose.left,
        "the strip does not lead the box with the dock on its shipped side",
      );
    }

    assert.deepEqual(final.unexpected, [], "the page called a bridge method the rig does not model");
    assert.equal(final.error, null);
    assert.equal(final.rows.length, 3);

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
