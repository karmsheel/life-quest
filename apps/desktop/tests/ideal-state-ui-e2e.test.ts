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
 * captures — the page holding several documents, a row's open 3-dot menu, the
 * wide two-column layout on both chat sides, and the landing state.
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
type Box = { left: number; top: number; width: number; height: number };
type Layout = {
  shellClass: string | null;
  viewport: { width: number; height: number } | null;
  compose: Box | null;
  editor: Box | null;
  history: Box | null;
  workspace: Box | null;
  /** The strip's "+ New document", which now lives beside its heading. */
  newControl: Box | null;
  historyHeading: Box | null;
  pageHeading: Box | null;
  /** How many old-style "Title" eyebrows the page still draws: must be zero. */
  titleLabel: number;
  /** Delete controls inside the compose column: must be zero. */
  deleteUnderEditor: number;
  rowMenus: { row: Box | null; menu: Box | null }[];
  openMenus: number;
  openMenuBox: Box | null;
  openMenuItems: (string | null)[];
  chrome: {
    nav: Box | null;
    sheet: Box | null;
    content: Box | null;
    chat: Box | null;
  };
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
  layout: Layout;
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
    afterOtherDelete: State;
    afterDelete: State;
    restored: State;
    final: State;
    createWrites: Write[];
    idleWrites: { before: number; after: number };
    wide: Layout;
    wideLeft: Layout;
    wideCollapsed: Layout;
    wideLeftCollapsed: Layout;
    narrow: Layout;
    narrowCollapsed: Layout;
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
      afterOtherDelete,
      afterDelete,
      restored,
      final,
      createWrites,
      idleWrites,
      wide,
      wideCollapsed,
      wideLeft,
      wideLeftCollapsed,
      narrow,
      narrowCollapsed,
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

    // The strip's own furniture: no Title eyebrow over the field, no Delete under
    // the box, one closed menu per row, and New beside the Documents heading.
    assert.equal(landing.layout.titleLabel, 0, "the Title eyebrow came back");
    assert.equal(
      landing.layout.deleteUnderEditor,
      0,
      "a Delete control came back under the editor",
    );
    assert.equal(landing.layout.openMenus, 0, "a row menu was open on landing");
    assert.equal(
      landing.layout.rowMenus.length,
      landing.rows.length,
      "a row is missing its 3-dot menu",
    );
    assert.ok(landing.layout.newControl, "the New document control is missing");
    assert.ok(landing.layout.historyHeading, "the Documents heading is missing");
    if (landing.layout.newControl && landing.layout.historyHeading && landing.layout.history) {
      assert.ok(
        landing.layout.newControl.left >= landing.layout.history.left &&
          landing.layout.newControl.left + landing.layout.newControl.width <=
            landing.layout.history.left + landing.layout.history.width + 1,
        "New document is not inside the documents viewer",
      );
      assert.ok(
        Math.abs(
          landing.layout.newControl.top +
            landing.layout.newControl.height / 2 -
            (landing.layout.historyHeading.top +
              landing.layout.historyHeading.height / 2),
        ) <= 6,
        "New document is not on the Documents heading line",
      );
    }

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

    // Delete removes the row's own document: first one that is not on screen,
    // which must leave the editor alone, then the one that is.
    assert.equal(afterOtherDelete.rows.length, 3);
    assert.equal(
      afterOtherDelete.selectedId,
      recovered.selectedId,
      "deleting another row moved the editor",
    );
    assert.equal(
      afterOtherDelete.titleValue,
      recovered.titleValue,
      "deleting another row changed the title on screen",
    );
    assert.equal(
      afterOtherDelete.writes.filter((write) => write.op === "delete").length,
      1,
      "one row's delete was not one delete",
    );

    assert.equal(afterDelete.rows.length, 2);
    assert.equal(
      afterDelete.writes.filter((write) => write.op === "delete").length,
      2,
      "the second delete was not recorded",
    );
    assert.notEqual(afterDelete.selectedId, recovered.selectedId);
    assert.equal(
      Object.keys(afterDelete.store).length,
      2,
      "the deleted document is still in the store",
    );
    assert.equal(restored.rows.length, 3);
    assert.equal(restored.rows[0]?.title, "A garden in the evening");

    // The wide page balances the box between the library and the dock: one gap
    // on each side, and the two of them the same width.
    assert.ok(
      wide.compose && wide.editor && wide.history,
      "the wide layout reported no box or strip",
    );
    if (wide.compose && wide.editor && wide.history) {
      assert.ok(
        Math.abs(wide.history.top - wide.compose.top) <= 4,
        "the strip and the box do not share a top edge",
      );
      assert.ok(
        wide.history.left + wide.history.width <= wide.compose.left,
        "the strip does not lead the box with the dock on its shipped side",
      );
      assert.ok(wide.chrome.chat, "the wide layout did not measure the dock");
      if (wide.chrome.chat) {
        const libraryGap = wide.editor.left - (wide.history.left + wide.history.width);
        const dockGap = wide.chrome.chat.left - (wide.editor.left + wide.editor.width);
        assert.ok(
          Math.abs(libraryGap - dockGap) <= 6,
          `the box is not balanced: library ${libraryGap}px, dock ${dockGap}px`,
        );
        assert.ok(
          libraryGap >= 40 && dockGap >= 40,
          `the box's gaps are too tight: library ${libraryGap}px, dock ${dockGap}px`,
        );
      }
      assert.ok(wide.pageHeading, "the page title is missing");
      if (wide.pageHeading) {
        assert.ok(
          Math.abs(wide.pageHeading.left - wide.editor.left) <= 2,
          "the page title does not ride the box's column",
        );
      }
      assert.ok(wide.newControl && wide.newControl.left >= wide.history.left);
    }

    // Swapping the chat to the left swaps the strip to the other edge, with the
    // same balanced gaps around the box.
    assert.ok(
      wideLeft.compose && wideLeft.editor && wideLeft.history,
      "the flipped layout reported no box or strip",
    );
    if (wideLeft.compose && wideLeft.editor && wideLeft.history) {
      assert.ok(
        wideLeft.compose.left + wideLeft.compose.width <= wideLeft.history.left,
        "the strip did not move to the right when the chat moved left",
      );
      assert.ok(wideLeft.chrome.chat, "the flipped layout did not measure the dock");
      if (wideLeft.chrome.chat) {
        const dockGap =
          wideLeft.editor.left - (wideLeft.chrome.chat.left + wideLeft.chrome.chat.width);
        const libraryGap =
          wideLeft.history.left - (wideLeft.editor.left + wideLeft.editor.width);
        assert.ok(
          Math.abs(dockGap - libraryGap) <= 6,
          `the flipped box is not balanced: dock ${dockGap}px, library ${libraryGap}px`,
        );
        assert.ok(
          dockGap >= 40 && libraryGap >= 40,
          `the flipped box's gaps are too tight: dock ${dockGap}px, library ${libraryGap}px`,
        );
      }
      assert.ok(wideLeft.pageHeading, "the flipped page title is missing");
      if (wideLeft.pageHeading) {
        assert.ok(
          Math.abs(wideLeft.pageHeading.left - wideLeft.editor.left) <= 2,
          "the flipped page title does not follow the box",
        );
      }
    }

    // Collapsing the dock must not move the page: the width it gives back waits
    // as empty page past the box.
    assert.ok(
      wideCollapsed.compose && wideCollapsed.editor && wideCollapsed.history,
      "the collapsed layout reported no box or strip",
    );
    if (
      wide.compose &&
      wide.editor &&
      wide.history &&
      wideCollapsed.compose &&
      wideCollapsed.editor &&
      wideCollapsed.history
    ) {
      assert.ok(
        Math.abs(wideCollapsed.history.left - wide.history.left) <= 1 &&
          Math.abs(wideCollapsed.history.top - wide.history.top) <= 1,
        "collapsing the dock moved the library",
      );
      assert.ok(
        Math.abs(wideCollapsed.editor.left - wide.editor.left) <= 1 &&
          Math.abs(wideCollapsed.editor.width - wide.editor.width) <= 1,
        "collapsing the dock moved the box",
      );
      assert.ok(
        wide.pageHeading &&
          wideCollapsed.pageHeading &&
          Math.abs(wideCollapsed.pageHeading.left - wide.pageHeading.left) <= 1,
        "collapsing the dock moved the page title",
      );
    }

    // The leading dock's collapse holds the same line.
    assert.ok(
      wideLeftCollapsed.editor && wideLeft.editor,
      "the leading collapse reported no box",
    );
    if (wideLeftCollapsed.editor && wideLeft.editor) {
      assert.ok(
        Math.abs(wideLeftCollapsed.editor.left - wideLeft.editor.left) <= 1,
        "collapsing the leading dock moved the box",
      );
    }
    if (
      wideLeftCollapsed.history &&
      wideLeft.history &&
      wideLeftCollapsed.pageHeading &&
      wideLeft.pageHeading
    ) {
      assert.ok(
        Math.abs(wideLeftCollapsed.history.left - wideLeft.history.left) <= 1,
        "collapsing the leading dock moved the library",
      );
      assert.ok(
        Math.abs(wideLeftCollapsed.pageHeading.left - wideLeft.pageHeading.left) <= 1,
        "collapsing the leading dock moved the page title",
      );
    }

    // The one-column page keeps its line too.
    assert.ok(
      narrow.editor && narrowCollapsed.editor && narrow.history && narrowCollapsed.history,
      "the narrow collapse reported no box or strip",
    );
    if (
      narrow.editor &&
      narrowCollapsed.editor &&
      narrow.history &&
      narrowCollapsed.history
    ) {
      assert.ok(
        Math.abs(narrowCollapsed.editor.left - narrow.editor.left) <= 1,
        "collapsing the dock at the narrow size moved the box",
      );
      assert.ok(
        Math.abs(narrowCollapsed.history.left - narrow.history.left) <= 1,
        "collapsing the dock at the narrow size moved the library",
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
