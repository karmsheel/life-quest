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
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const REPORT = path.join(ARTIFACTS, "layouts.json");

/**
 * The pictures the contract asks for: the popover open over the studio, the
 * two even splits (which must not look the same), full agent, and the studio
 * the round trip put back.
 */
const REQUIRED_SHOTS = [
  "layouts.png",
  "layouts-page-agent.png",
  "layouts-agent-page.png",
  "layouts-agent.png",
  "layouts-restored.png",
];

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/**
 * Only the report's measured shape, read back from JSON. The driver owns what
 * it samples; this test reads the artifact it wrote rather than re-deriving the
 * sample, so a driver change does not have to be mirrored here.
 */
type Arrangement = {
  viewport?: { width: number; height: number };
  shell?: {
    className?: string;
    dataLayout?: string | null;
    gridTemplateColumns?: string;
    box?: Box;
  } | null;
  rail?: { box?: Box; display?: string } | null;
  main?: { box?: Box; display?: string; visibility?: string } | null;
  chat?: { box?: Box; display?: string; visibility?: string } | null;
  divider?: { present?: boolean; box?: Box | null };
  trigger?: {
    found?: boolean;
    testid?: string | null;
    label?: string | null;
    title?: string | null;
    expanded?: string | null;
    haspopup?: string | null;
    icon?: string | null;
  };
  menu?: {
    present?: boolean;
    role?: string | null;
    label?: string | null;
    classes?: string;
    parentIsBody?: boolean;
    sectionTitles?: string[];
    cardCount?: number;
    activeCards?: string[];
    cards?: {
      id?: string | null;
      role?: string | null;
      checked?: string | null;
      classes?: string;
      text?: string;
      thumb?: { present?: boolean; classes?: string; panes?: unknown[] };
    }[];
  };
  cluster?: {
    classes?: string;
    testid?: string | null;
    box?: Box;
  }[];
  trailing?: { present?: boolean; childCount?: number; box?: Box | null };
};

type Report = {
  pass?: boolean;
  failures?: string[];
  scenarios?: { name?: string; pass?: boolean; failures?: string[] }[];
  screenshots?: string[];
  viewport?: { width: number; height: number };
  tokens?: {
    track?: number;
    collapsedTrack?: number;
    frame?: number;
    titlebarHeight?: number;
    rootFontSize?: number;
  };
  initial?: Arrangement;
  menuOpen?: Arrangement;
  pageAgent?: Arrangement;
  pageAgentMenu?: Arrangement;
  agentPage?: Arrangement;
  agentPageMenu?: Arrangement;
  restoredStudio?: Arrangement;
  restoredStudioMenu?: Arrangement;
  agentCard?: Arrangement;
  agentCardMenu?: Arrangement;
  dockFullscreen?: Arrangement;
  dockFullscreenMenu?: Arrangement;
  shortcutOn?: Arrangement;
  shortcutOnMenu?: Arrangement;
  agentOverSplit?: Arrangement;
  splitRestored?: Arrangement;
  splitRestoredMenu?: Arrangement;
  collapsedWhileSplit?: Arrangement;
  collapsedMenu?: Arrangement;
  reopened?: Arrangement;
  railCollapsedSplit?: Arrangement;
  railCollapsedAgentPage?: Arrangement;
  railCollapsedMenu?: Arrangement;
  final?: Arrangement;
  finalStudioLeading?: Arrangement;
  finalStudioLeadingRail?: Arrangement;
  [key: string]: unknown;
};

/**
 * The layouts rig drives a real Electron window against the real shell, so it
 * needs the Vite dev server. With the server down the test skips; the canonical
 * `./bin/agent-cli e2e run` invocation starts one. A skip is not evidence.
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
      [path.join(desktopRoot, "e2e/layouts.electron.mjs")],
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

const near = (a: number | undefined, b: number | undefined, tolerance = 2) =>
  typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tolerance;

const classesOf = (state: Arrangement | undefined) =>
  String(state?.shell?.className ?? "");
const hasClass = (state: Arrangement | undefined, name: string) =>
  classesOf(state).split(/\s+/).includes(name);

function assertPng(file: string, label: string) {
  assert.equal(
    fs.existsSync(file),
    true,
    `${label}: the driver wrote no picture at ${file}`,
  );
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length >= 5_000, `${label}: the picture is empty (${bytes.length} bytes)`);
  assert.equal(
    bytes.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    `${label}: the artifact is not a PNG (${file})`,
  );
}

describe("workspace layouts", () => {
  it("writes the studio, both even splits, full agent and the exact studio round trip", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    // A run is only evidence when the artifacts were written by this run.
    const startedAt = Date.now();
    fs.rmSync(REPORT, { force: true });
    for (const name of REQUIRED_SHOTS) {
      fs.rmSync(path.join(ARTIFACTS, name), { force: true });
    }

    const exitCode = await runDriver();
    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact — a crashed or skipped run is not evidence",
    );

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    // —— The driver's own verdict. ——
    assert.deepEqual(report.failures ?? [], []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);
    assert.ok(
      (report.scenarios?.length ?? 0) > 0,
      "the driver recorded no scenarios",
    );
    for (const scenario of report.scenarios ?? []) {
      assert.equal(
        scenario.pass,
        true,
        `scenario "${scenario.name}" failed: ${(scenario.failures ?? []).join("; ")}`,
      );
    }

    // —— The tokens the contract freezes. ——
    assert.deepEqual(
      report.viewport,
      { width: 1280, height: 900 },
      `the rig did not run at 1280x900 (${JSON.stringify(report.viewport)})`,
    );
    assert.equal(report.tokens?.titlebarHeight, 32);
    assert.equal(report.tokens?.frame, 12);
    assert.equal(report.tokens?.track, 256);
    assert.equal(report.tokens?.collapsedTrack, 56);
    assert.equal(report.tokens?.rootFontSize, 16);

    // —— The door, in the strip's trailing cluster. ——
    const trigger = report.initial?.trigger;
    assert.equal(trigger?.found, true, "the strip has no layouts trigger");
    assert.equal(trigger?.testid, "layouts-trigger");
    assert.equal(trigger?.label, "Layouts");
    assert.equal(trigger?.title, "Layouts");
    assert.equal(trigger?.haspopup, "menu");
    assert.equal(trigger?.expanded, "false");
    assert.match(String(trigger?.icon ?? ""), /lucide-/);
    const cluster = report.initial?.cluster ?? [];
    assert.equal(report.initial?.trailing?.childCount, 3);
    assert.equal(cluster.length, 3);
    assert.match(String(cluster[0]?.classes ?? ""), /layouts-menu__trigger/);
    assert.equal(cluster[0]?.testid, "layouts-trigger");
    assert.match(String(cluster[1]?.classes ?? ""), /theme-mode-toggle/);
    assert.match(String(cluster[2]?.classes ?? ""), /settings-menu/);
    assert.ok(
      (cluster[0]?.box?.right ?? Infinity) <= (cluster[1]?.box?.left ?? -Infinity),
    );
    assert.ok(
      (cluster[1]?.box?.right ?? Infinity) <= (cluster[2]?.box?.left ?? -Infinity),
    );
    assert.equal(cluster[0]?.box?.width, 44);

    // —— The popover and its four cards. ——
    const menuOpen = report.menuOpen;
    assert.equal(menuOpen?.menu?.present, true, "the popover never opened");
    assert.equal(menuOpen?.menu?.role, "menu");
    assert.equal(menuOpen?.menu?.label, "Layouts");
    assert.equal(menuOpen?.menu?.parentIsBody, true);
    assert.ok(
      (menuOpen?.menu?.sectionTitles ?? []).some((title) =>
        title.includes("Layouts"),
      ),
    );
    assert.equal(menuOpen?.menu?.cardCount, 4);
    assert.deepEqual(menuOpen?.menu?.activeCards, ["studio"]);
    const cards = menuOpen?.menu?.cards ?? [];
    assert.deepEqual(
      cards.map((card) => card.id),
      ["studio", "page-agent", "agent-page", "agent"],
    );
    assert.deepEqual(
      cards.map((card) => card.text),
      ["Studio", "Page · Agent", "Agent · Page", "Full agent"],
    );
    for (const card of cards) {
      assert.equal(card.role, "menuitemradio");
      assert.match(String(card.classes), /layouts-menu__card/);
      assert.match(String(card.thumb?.classes), /layout-thumb--/);
      assert.ok((card.thumb?.panes?.length ?? 0) >= 2);
    }
    assert.match(
      String(cards.find((card) => card.id === "studio")?.classes),
      /is-active/,
    );
    assert.equal(menuOpen?.trigger?.expanded, "true");

    // —— Page · Agent and Agent · Page are two different even splits. ——
    const pageAgent = report.pageAgent;
    const agentPage = report.agentPage;
    assert.equal(pageAgent?.shell?.dataLayout, "page-agent");
    assert.match(classesOf(pageAgent), /shell--layout-split/);
    assert.match(classesOf(pageAgent), /shell--chat-right/);
    assert.equal(pageAgent?.divider?.present, false);
    assert.equal(agentPage?.shell?.dataLayout, "agent-page");
    assert.match(classesOf(agentPage), /shell--layout-split/);
    assert.match(classesOf(agentPage), /shell--chat-left/);
    assert.equal(agentPage?.divider?.present, false);

    const railRight = pageAgent?.rail?.box?.right ?? 0;
    assert.equal(pageAgent?.main?.box?.left, railRight);
    assert.equal(pageAgent?.chat?.box?.right, report.viewport?.width);
    assert.equal(agentPage?.chat?.box?.left, railRight);
    assert.equal(agentPage?.main?.box?.right, report.viewport?.width);
    assert.ok(
      near(
        pageAgent?.chat?.box?.left,
        railRight + (1280 - railRight) / 2,
      ),
      `page-agent seam ${pageAgent?.chat?.box?.left}px is not the midpoint after the rail`,
    );
    assert.ok(
      near(
        agentPage?.main?.box?.left,
        railRight + (1280 - railRight) / 2,
      ),
      `agent-page seam ${agentPage?.main?.box?.left}px is not the midpoint after the rail`,
    );
    assert.ok(
      near(pageAgent?.main?.box?.width, pageAgent?.chat?.box?.width),
      `page ${pageAgent?.main?.box?.width}px vs agent ${pageAgent?.chat?.box?.width}px`,
    );
    assert.ok(
      near(agentPage?.main?.box?.width, agentPage?.chat?.box?.width),
      `page ${agentPage?.main?.box?.width}px vs agent ${agentPage?.chat?.box?.width}px`,
    );
    assert.notEqual(
      pageAgent?.main?.box?.left,
      agentPage?.main?.box?.left,
      "Page · Agent and Agent · Page laid the page out in the same place",
    );
    assert.notEqual(
      pageAgent?.chat?.box?.left,
      agentPage?.chat?.box?.left,
      "Page · Agent and Agent · Page laid the agent out in the same place",
    );
    assert.equal(pageAgent?.menu?.present, false); // the pick closed the popover
    assert.deepEqual(report.pageAgentMenu?.menu?.activeCards, ["page-agent"]);
    assert.deepEqual(report.agentPageMenu?.menu?.activeCards, ["agent-page"]);

    // —— Full agent is the dock's own full-screen state. ——
    const agentCard = report.agentCard;
    assert.equal(agentCard?.shell?.dataLayout, "agent");
    assert.match(classesOf(agentCard), /shell--chat-focus/);
    assert.notEqual(agentCard?.main?.display, "flex");
    assert.equal(agentCard?.chat?.box?.left, agentCard?.rail?.box?.right);
    assert.equal(agentCard?.chat?.box?.right, report.viewport?.width);
    assert.equal(agentCard?.divider?.present, false);
    assert.deepEqual(report.agentCardMenu?.menu?.activeCards, ["agent"]);
    assert.deepEqual(report.dockFullscreenMenu?.menu?.activeCards, ["agent"]);
    assert.deepEqual(
      report.dockFullscreen?.chat?.box,
      agentCard?.chat?.box,
      "the dock's own full-screen control laid the dock out differently from the Full agent card",
    );
    assert.deepEqual(
      report.dockFullscreen?.shell?.box,
      agentCard?.shell?.box,
    );
    assert.deepEqual(
      report.shortcutOnMenu?.menu?.activeCards,
      ["agent"],
      "Mod+Shift+F did not leave the picker reading Full agent",
    );

    // —— The mode lies over the arrangement, it does not replace it. ——
    // Picked from a split, Full agent is the same mode the dock's control
    // toggles, and leaving it puts the split back on the boxes it had.
    const agentOverSplit = report.agentOverSplit;
    assert.equal(agentOverSplit?.shell?.dataLayout, "agent");
    assert.match(classesOf(agentOverSplit), /shell--chat-focus/);
    assert.notEqual(agentOverSplit?.main?.display, "flex");
    const splitRestored = report.splitRestored;
    assert.equal(splitRestored?.shell?.dataLayout, "page-agent");
    assert.match(classesOf(splitRestored), /shell--layout-split/);
    assert.match(classesOf(splitRestored), /shell--chat-right/);
    assert.deepEqual(
      splitRestored?.main?.box,
      report.pageAgent?.main?.box,
      "the page did not come back to its split box",
    );
    assert.deepEqual(
      splitRestored?.chat?.box,
      report.pageAgent?.chat?.box,
      "the agent did not come back to its split box",
    );
    assert.deepEqual(report.splitRestoredMenu?.menu?.activeCards, ["page-agent"]);

    // —— Collapsing the dock leaves no split; Studio comes back exactly. ——
    const collapsed = report.collapsedWhileSplit;
    assert.match(classesOf(collapsed), /shell--chat-collapsed/);
    assert.equal(collapsed?.shell?.dataLayout, "studio");
    assert.equal(collapsed?.chat, null);
    assert.equal(collapsed?.divider?.present, false);
    assert.deepEqual(report.collapsedMenu?.menu?.activeCards, ["studio"]);

    const initial = report.initial;
    const restored = report.restoredStudio;
    assert.equal(restored?.shell?.dataLayout, "studio");
    assert.equal(restored?.shell?.className, initial?.shell?.className);
    assert.deepEqual(restored?.shell?.box, initial?.shell?.box);
    assert.deepEqual(restored?.main?.box, initial?.main?.box);
    assert.deepEqual(restored?.chat?.box, initial?.chat?.box);
    assert.equal(restored?.divider?.present, true);
    assert.deepEqual(report.restoredStudioMenu?.menu?.activeCards, ["studio"]);
    assert.deepEqual(report.final?.shell?.box, initial?.shell?.box);

    // The Studio card is "the dock at its own width, the current side": picked
    // from Agent · Page it comes back with the dock leading, and the swap lands
    // on the exact starting boxes.
    assert.equal(report.finalStudioLeading?.shell?.dataLayout, "studio");
    assert.match(classesOf(report.finalStudioLeading), /shell--chat-left/);
    assert.equal(
      report.finalStudioLeading?.chat?.box?.left,
      report.finalStudioLeading?.rail?.box?.right,
    );
    assert.equal(
      report.finalStudioLeading?.main?.box?.right,
      report.viewport?.width,
    );
    assert.equal(report.finalStudioLeading?.divider?.present, true);

    // —— The split holds with the rail at its icon column. ——
    const railSplit = report.railCollapsedSplit;
    assert.equal(railSplit?.shell?.dataLayout, "page-agent");
    assert.equal(railSplit?.rail?.box?.width, 56);
    assert.equal(railSplit?.main?.box?.left, 56);
    assert.equal(railSplit?.chat?.box?.right, report.viewport?.width);
    assert.ok(
      near(railSplit?.main?.box?.width, railSplit?.chat?.box?.width),
      `collapsed-rail page ${railSplit?.main?.box?.width}px vs agent ${railSplit?.chat?.box?.width}px`,
    );
    assert.equal(report.railCollapsedAgentPage?.shell?.dataLayout, "agent-page");
    assert.equal(report.railCollapsedAgentPage?.chat?.box?.left, 56);
    assert.deepEqual(report.railCollapsedMenu?.menu?.activeCards, ["agent-page"]);

    // —— The artifact: report recent, pictures real and recent. ——
    const reportStat = fs.statSync(REPORT);
    assert.ok(
      reportStat.mtimeMs >= startedAt - 5_000,
      "the report is stale — not written by this run",
    );
    const named = new Set(
      (report.screenshots ?? []).map((file) => path.basename(file)),
    );
    for (const name of REQUIRED_SHOTS) {
      assert.ok(
        named.has(name),
        `the report does not name the ${name} picture (${JSON.stringify([...named])})`,
      );
      const file = path.join(ARTIFACTS, name);
      assertPng(file, name);
      const stat = fs.statSync(file);
      assert.ok(
        stat.mtimeMs >= startedAt - 5_000,
        `${name} is stale — not written by this run`,
      );
      assert.ok(
        Date.now() - stat.mtimeMs < 10 * 60_000,
        `${name} is older than ten minutes`,
      );
    }
  });
});
