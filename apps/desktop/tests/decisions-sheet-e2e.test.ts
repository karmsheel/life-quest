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
const REPORT = path.join(desktopRoot, "e2e/artifacts/decisions-sheet.json");
const ARTIFACT_SCREENSHOTS = [
  "decisions-sheet-opened.png",
  "decisions-sheet-approved.png",
  "decisions-sheet-closed.png",
];

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type CardRow = {
  id: string;
  title: string;
  status: string;
  actions: string[];
};

type Sample = {
  path: string | null;
  overlay: {
    box: Box;
    position: string;
    zIndex: string;
    backdropFilter: string | null;
    background: string;
    panel: {
      box: Box;
      radius: string;
      background: string;
      borderColor: string;
    } | null;
    chrome: Box | null;
  } | null;
  close: { box: Box; label: string | null; title: string | null } | null;
  title: string | null;
  subtitle: string | null;
  cardBox: Box | null;
  cards: CardRow[];
  actionMessage: string | null;
  bodyOverflow: string;
  backgroundPage: boolean;
  workspace: {
    mounts: number;
    top: number;
    max: number;
    height: number;
    markerTop: number | null;
  };
  resolveCalls: Array<{ id: string; resolution: string }>;
  focus: {
    tag: string;
    className: string;
    label: string | null;
    insideSheet: boolean;
    openTrigger: boolean;
  } | null;
};

type Report = {
  url: string;
  window: { width: number; height: number };
  fixture: { workspaceTop: number };
  states: Record<string, Sample>;
  steps: {
    scroll?: boolean;
    openedClick?: boolean;
    insidePressHit?: string | null;
    approveId?: string | null;
    approveClick?: boolean;
    crossClick?: boolean;
    escapePress?: boolean;
    closedByScrimHit?: string | null;
  };
  screenshots: string[];
  failures: string[];
  pass: boolean;
};

/** Alpha of a computed colour: 1 when it carries none. */
function alphaOf(color: string | null): number {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length >= 4 ? raw[3] : 1;
}

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
      [path.join(desktopRoot, "e2e/decisions-sheet.electron.mjs")],
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

describe("the decisions sheet over the app", () => {
  it("opens over the page the operator was reading, approves in place, and closes back onto the same place", async (t) => {
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

    const {
      landing,
      parked,
      opened,
      insidePress,
      approved,
      closedByCross,
      closedByEscape,
      closedByScrimPress,
    } = report.states;

    // 1 — the page underneath is a real, scrollable page, and no sheet is up yet.
    assert.equal(landing.overlay, null, "the sheet was open on arrival");
    assert.equal(landing.path, "/work", "the rig did not start on its page");
    assert.equal(landing.backgroundPage, true, "the workspace never painted");
    assert.ok(landing.workspace.max > 0, "the workspace has nothing to scroll");
    assert.equal(landing.workspace.top, 0, "the workspace did not start at its top");

    // 2 — the operator is somewhere down the page, not at its top.
    assert.equal(report.steps.scroll, true, "the driver could not scroll the workspace");
    assert.equal(parked.workspace.top, report.fixture.workspaceTop, "the workspace did not park");
    assert.notEqual(parked.workspace.markerTop, null, "the workspace marker is missing");

    // 3 — opening the inbox is a surface over that page, not navigation away.
    assert.equal(report.steps.openedClick, true, "the rig could not open decisions");
    const panel = opened.overlay?.panel;
    assert.ok(panel, "opening decisions painted no panel");
    assert.equal(opened.path, "/decisions", "opening decisions did not change the route");
    assert.equal(
      opened.backgroundPage,
      true,
      "opening decisions unmounted the page behind it — the backdrop blurs nothing",
    );
    assert.equal(
      opened.workspace.mounts,
      parked.workspace.mounts,
      "opening decisions remounted the workspace",
    );
    assert.equal(
      opened.workspace.top,
      parked.workspace.top,
      "opening decisions moved the page behind it",
    );
    assert.equal(
      opened.workspace.markerTop,
      parked.workspace.markerTop,
      "the workspace's content shifted when the sheet opened",
    );
    assert.equal(opened.bodyOverflow, "hidden", "the page behind the sheet still scrolls");

    // 4 — a 56rem reading frame, centred, over a blurred and dimmed app. The
    //     decisions sheet is deliberately narrower than Settings: it stops at
    //     the inbox's own measure instead of claiming 90% of a wide window.
    const widthShare = panel.box.width / opened.overlay!.box.width;
    const heightShare = panel.box.height / report.window.height;
    assert.ok(
      Math.abs(heightShare - 0.9) <= 0.02,
      `the panel is ${(heightShare * 100).toFixed(1)}% of the window's height, not ~90%`,
    );
    assert.ok(
      panel.box.width <= 56 * 16 + 2,
      `the panel is ${panel.box.width}px wide, wider than the 56rem reading frame`,
    );
    assert.ok(
      widthShare >= 0.68 && widthShare <= 0.72,
      `the panel is ${(widthShare * 100).toFixed(1)}% of the 1280px window, not ~70% at the 56rem measure`,
    );
    assert.ok(
      opened.cardBox,
      "no card was measured, so the frame's side gutters are unknown",
    );
    const leftGutter = opened.cardBox!.left - panel.box.left;
    const rightGutter = panel.box.right - opened.cardBox!.right;
    assert.ok(
      leftGutter <= 40 && rightGutter <= 40,
      `the cards still float in empty panel: ${leftGutter}px left and ${rightGutter}px right`,
    );
    const viewport = opened.overlay!.box;
    assert.ok(
      Math.abs(panel.box.left + panel.box.width / 2 - viewport.width / 2) <= 2 &&
        Math.abs(panel.box.top + panel.box.height / 2 - viewport.height / 2) <= 2,
      `the panel is not centred in the window: ${panel.box.left},${panel.box.top}`,
    );
    assert.ok(parseFloat(panel.radius) > 0, `the panel has square corners: ${panel.radius}`);

    const scrim = opened.overlay;
    assert.equal(scrim?.position, "fixed", "the scrim is not fixed over the window");
    assert.ok(
      Number(scrim?.zIndex) >= 20 && Number(scrim?.zIndex) < 60,
      `the scrim sits at z-index ${scrim?.zIndex}, outside the chrome-to-dialog band`,
    );
    assert.equal(scrim?.box.width, viewport.width, "the scrim does not cover the width");
    assert.equal(scrim?.box.height, viewport.height, "the scrim does not cover the height");
    assert.match(
      scrim?.backdropFilter ?? "",
      /blur\(/,
      `the app behind the sheet is not blurred: "${scrim?.backdropFilter}"`,
    );
    assert.ok(
      alphaOf(scrim?.background ?? null) > 0.15,
      `the scrim does not dim the app: ${scrim?.background}`,
    );

    // 5 — the cross is the sheet's top-right control, and the title says what
    //     surface this is before any card is read.
    assert.ok(opened.close, "the sheet has no close control");
    assert.equal(opened.close?.label, "Close decisions", "the close control is unlabelled");
    assert.ok(
      panel.box.right - opened.close.box.right <= 40 &&
        opened.close.box.top - panel.box.top <= 40,
      `the cross is not at the top right: ${opened.close.box.right},${opened.close.box.top}`,
    );
    assert.ok(
      opened.close.box.left + opened.close.box.width / 2 >
        panel.box.left + panel.box.width / 2,
      "the cross sits on the leading half, not the trailing one",
    );
    assert.equal(opened.title, "Decisions", "the sheet does not name its surface");
    assert.match(
      opened.subtitle ?? "",
      /^Approve a proposal/,
      `the sheet does not say what the inbox is for: "${opened.subtitle}"`,
    );

    // 6 — the real inbox is in the frame, and the caret is inside it.
    assert.equal(opened.cards.length, 3, "the seeded proposals did not reach the sheet");
    assert.equal(
      opened.cards[0]?.status.toLowerCase(),
      "pending",
      "the newest card is not pending",
    );
    // The pending card now offers three controls: Edit sits between the two
    // answers, so the operator can correct the proposal in place instead of
    // accepting or refusing the agent's wording verbatim. Both answers are still
    // offered; the sheet just also offers the amendment that precedes them.
    assert.deepEqual(
      opened.cards[0]?.actions,
      ["Reject", "Edit", "Approve"],
      "the card does not offer both answers with the amend control between them",
    );
    assert.equal(opened.focus?.insideSheet, true, "the caret escaped the modal sheet");

    // 7 — a press inside the panel is not a dismissal.
    assert.ok(insidePress.overlay, "a press on the panel closed the sheet");
    assert.match(
      report.steps.insidePressHit ?? "",
      /sheet-overlay__panel/,
      "the press did not land on the panel",
    );
    assert.equal(insidePress.path, "/decisions", "a press inside the panel navigated away");

    // 8 — approving works from the surface, and the answered card leaves Pending.
    const approvedId = report.steps.approveId;
    assert.equal(report.steps.approveClick, true, "the Approve control could not be pressed");
    assert.equal(approved.actionMessage, "Decision approved.", "the approve said nothing");
    assert.deepEqual(
      approved.resolveCalls,
      [{ id: approvedId, resolution: "approved" }],
      "the card did not ask the vault to approve exactly that Decision",
    );
    assert.equal(
      approved.cards.some((card) => card.id === approvedId),
      false,
      "the approved Decision is still in Pending",
    );
    assert.equal(approved.cards.length, 2, "the other proposals left the inbox");

    // 9 — closing hands the page back: same route, same scroll, same content,
    //     and the same mounted workspace the operator never left.
    assert.equal(report.steps.crossClick, true, "the cross could not be pressed");
    assert.equal(closedByCross.overlay, null, "the cross did not close the sheet");
    assert.equal(closedByCross.path, "/work", "the cross did not return to the page behind");
    assert.equal(closedByCross.backgroundPage, true, "closing lost the page behind");
    assert.equal(
      closedByCross.workspace.mounts,
      parked.workspace.mounts,
      "closing remounted the workspace",
    );
    assert.equal(
      closedByCross.workspace.top,
      parked.workspace.top,
      "closing did not restore the operator's scroll position",
    );
    assert.equal(
      closedByCross.workspace.markerTop,
      parked.workspace.markerTop,
      "closing moved the content the operator was reading",
    );
    assert.notEqual(closedByCross.bodyOverflow, "hidden", "closing left the page locked");

    // 10 — Escape leaves the same way.
    assert.equal(report.steps.escapePress, true, "the driver could not press Escape");
    assert.equal(closedByEscape.overlay, null, "Escape did not close the sheet");
    assert.equal(closedByEscape.path, "/work", "Escape did not return to the page behind");
    assert.equal(
      closedByEscape.workspace.top,
      parked.workspace.top,
      "Escape moved the page behind the sheet",
    );

    // 11 — so does a press on the scrim.
    assert.equal(
      report.steps.closedByScrimHit,
      "scrim",
      "the press outside did not land on the scrim",
    );
    assert.equal(closedByScrimPress.overlay, null, "the scrim did not close the sheet");
    assert.equal(closedByScrimPress.path, "/work", "the scrim did not return to the page behind");
    assert.equal(
      closedByScrimPress.workspace.top,
      parked.workspace.top,
      "the scrim moved the page behind the sheet",
    );

    // The repeatable artifact: a JSON report plus the frames it measured.
    for (const shot of ARTIFACT_SCREENSHOTS) {
      assert.ok(
        report.screenshots.includes(shot),
        `the run did not record ${shot}`,
      );
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts", shot)),
        true,
        `${shot} was reported but not written`,
      );
    }
  });
});
