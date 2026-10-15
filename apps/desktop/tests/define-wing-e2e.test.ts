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
const REPORT = path.join(desktopRoot, "e2e/artifacts/define-wing.json");

type Link = { label: string; href: string | null; active: boolean };
type Card = { title: string; href: string | null; help: string | null; body: string | null };
type Group = { heading: string | null; gridColumns: string | null; cards: Card[] };
type State = {
  route: string | null;
  tabs: { label: string; selected: boolean }[];
  activeTab: string | null;
  rail: Link[];
  pinned: Link[];
  pinnedBottom: Link[];
  pageHeading: string | null;
  pageRootClass: string | null;
  groups: Group[];
  editorTitle: string | null;
  editorValue: string | null;
  editorReadOnly: boolean | null;
  editorBackHref: string | null;
  documentsHeading: string | null;
  documentsComposer: boolean;
  calls: string[];
  errors: string[];
  overflow: { scrollWidth: number; clientWidth: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  expectations: {
    WING_TABS: string[];
    HOME_RAIL: string[];
    DEFINE_RAIL: string[];
    DREAM_CARDS: string[];
    VISION_CARD: string;
  };
  states: Record<string, State>;
  screenshots: string[];
};

/**
 * The Define wing rig drives the real shell in a real Electron window, so it
 * needs the Vite dev server. With the server down the test skips; `npm run dev`
 * in another shell turns it on.
 */
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
      [path.join(desktopRoot, "e2e/define-wing.electron.mjs")],
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

const labels = (links: Link[]) => links.map((link) => link.label);
const tabLabels = (state: State) => state.tabs.map((tab) => tab.label);
const titles = (group: Group | undefined) =>
  (group?.cards ?? []).map((card) => card.title);

describe("define wing (Define rail, Dream / Vision split, Documents on Home)", () => {
  it("renames the wing, moves the Vision & Desire card to its own page, and gives Documents to Home", async (t) => {
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
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // Restated here so the numbers are asserted by the suite, not only inside
    // the driver — and so a regression names the wing it broke.
    const { WING_TABS, HOME_RAIL, DEFINE_RAIL, DREAM_CARDS, VISION_CARD } =
      report.expectations;
    const { home, dream, vision, editor, documents, deepVision, deepDocuments } =
      report.states;

    // The rename, and no tab left over.
    assert.deepEqual(
      tabLabels(home),
      WING_TABS,
      "the top bar no longer carries Home / Define / Plan / Execute / Review",
    );

    // Documents belongs to Home now, and is not duplicated into Define.
    assert.deepEqual(labels(home.rail), HOME_RAIL, "the Home rail moved");
    assert.deepEqual(labels(dream.rail), DEFINE_RAIL, "the Define rail moved");
    assert.equal(
      dream.rail.some((link) => link.label === "Documents"),
      false,
      "Documents is still in the Define rail",
    );

    // The card split.
    assert.equal(dream.pageHeading, "Dream");
    assert.deepEqual(titles(dream.groups[0]), DREAM_CARDS, "Dream's cards moved");
    assert.equal(
      dream.groups.some((group) => group.cards.some((card) => card.title === VISION_CARD)),
      false,
      "the Vision & Desire card is still on Dream",
    );
    assert.equal(vision.pageHeading, "Vision");
    assert.deepEqual(
      titles(vision.groups[0]),
      [VISION_CARD],
      "the Vision page does not carry exactly the Vision & Desire card",
    );
    assert.equal(
      vision.groups[0]?.cards[0]?.href,
      "/vision/health/what",
      "the Vision card does not open the what document under /vision",
    );

    // The editor the card opens, and the way back.
    assert.equal(editor.route, "/vision/health/what");
    assert.equal(editor.editorTitle, "Vision & Desire · Health");
    assert.equal(editor.editorBackHref, "/vision", "Back does not return to Vision");
    assert.equal(
      editor.editorValue,
      "A calm, strong body at 60. (health)",
      "the editor does not hold the what document's body",
    );
    assert.equal(editor.editorReadOnly, false, "an unlocked document came up read-only");
    assert.ok(
      editor.calls.includes("health:what"),
      `the editor did not read the what document (${JSON.stringify(editor.calls)})`,
    );

    // Documents, owned by Home.
    assert.equal(documents.route, "/documents");
    assert.equal(documents.activeTab, "Home");
    assert.equal(documents.documentsHeading, "Documents");
    assert.equal(documents.documentsComposer, true);

    // A cold load is owned by the wing table, not by the session that got there.
    assert.equal(deepVision.activeTab, "Define", "/vision/... did not select Define");
    assert.equal(deepDocuments.activeTab, "Home", "/documents did not select Home");

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
