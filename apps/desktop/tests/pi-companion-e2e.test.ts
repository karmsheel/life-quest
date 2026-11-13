import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The built-in companion, end to end.
 *
 * The rig boots the real app against a throwaway profile and vault, points the
 * built-in companion at a fake OpenAI-compatible endpoint, runs two turns
 * through the real preload bridge — one plain, one that asks the fake model for
 * a genuine read-only vault tool call — and reads them back through the real
 * dock, live and after a reload. Its report and pictures are the artifact; the
 * assertions below restate the important ones so a regression fails here by
 * name.
 */
const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const REPORT = path.join(desktopRoot, "e2e/artifacts/pi-companion.json");
const THREAD_SHOT = path.join(desktopRoot, "e2e/artifacts/pi-companion-thread.png");
const PICKER_SHOT = path.join(desktopRoot, "e2e/artifacts/pi-companion-picker.png");
const TURN_SHOT = path.join(desktopRoot, "e2e/artifacts/pi-companion-turn.png");
const TURN_HISTORY_SHOT = path.join(
  desktopRoot,
  "e2e/artifacts/pi-companion-turn-history.png",
);

/** What the fake endpoint's second completion says, once the tool result is in. */
const TOOL_ANSWER = "The rig ledger is empty.";

type DomUsage = {
  present: boolean;
  text?: string;
  numeric?: boolean;
  numbers?: { input: number | null; output: number | null; total: number | null };
};

type ToolTurnDom = {
  turnOk: boolean;
  turnError: string | null;
  toolName: string | null;
  rowText: string;
  target: string;
  rowState: string;
  rowSeenWhileRunning: boolean;
  duration:
    | { source: string; value?: number; native?: boolean; durationSource?: string | null }
    | null;
  foldHeader: string | null;
  footerStatus: string | null;
  answer: string | null;
  answerOutsideProcess: boolean | null;
  usage: DomUsage;
  /** What pi-harness reported the tool returned, clipped for the DOM disclosure. */
  resultPreview: string | null;
  resultText: string;
  wire: {
    eventTypes: string[];
    toolStarted: {
      type: string;
      name: string;
      target: string;
      callId?: string;
      args?: unknown;
    } | null;
    toolCompleted: {
      type: string;
      name: string;
      isError?: boolean;
      durationMs?: number;
      resultPreview?: string;
    } | null;
    usage: { input?: number; output?: number; total?: number } | null;
    final: string | null;
    runCompleted: boolean;
    snapshotToolRows: {
      toolName: string | null;
      toolCallId: string | null;
      isError: boolean;
      contentLength: number;
    }[];
  };
};

type ToolHistoryDom = {
  textHasAnswer: boolean;
  toolRowSeen: boolean;
  rowText: string;
  target: string;
  rowState: string;
  foldHeader: string | null;
  footerStatus: string | null;
  answer: string | null;
  answerOutsideProcess: boolean | null;
  usage: DomUsage;
  resultText: string;
};
const SWITCHER_SHOT = path.join(
  desktopRoot,
  "e2e/artifacts/pi-companion-switcher.png",
);
const DAY_SHOT = path.join(
  desktopRoot,
  "e2e/artifacts/pi-companion-switcher-day.png",
);

type Report = {
  ok: boolean;
  configured: {
    settings: string;
    switched: string;
    openedOk: boolean;
    /** The rig unlocks the two seeded areas it scopes agents in. */
    unlocked: boolean;
    database: { id: string; name: string } | null;
    databaseError?: string | null;
  };
  mounted: boolean;
  turn: { ok: boolean; sessionId: string | null; eventTypes: string[] };
  deltas: string;
  completed: boolean;
  stored: string[];
  threadHasReply: boolean;
  picker: {
    shown: boolean;
    items?: string[];
    marks?: {
      label: string;
      kind: "glyph" | "image" | "none";
      src: string | null;
      decoded: boolean;
      viewBox: string | null;
      pathCount: number;
      fills: string[];
      ink: string | null;
      rendered: {
        width: number;
        height: number;
        centered: boolean;
        fitsCircle: boolean;
        sizeRatio: number;
      } | null;
    }[];
    box?: { x: number; y: number; width: number; height: number } | null;
  };
  tool: {
    checks: Record<string, boolean>;
    database: { id: string; name: string } | null;
    databaseError: string | null;
    mcpPorts: { local: number; invite: number } | null;
    plan: {
      kind: string;
      name?: string;
      args?: Record<string, unknown>;
      reason?: string;
    } | null;
    live: ToolTurnDom;
    history: ToolHistoryDom;
    /**
     * Observation, not a gate: whether the reloaded turn reads like the live
     * one. Answer parity is prose only — the bubble's role label and stamp are
     * not the answer, and the stamp can differ between send time and the stored
     * row's time (reported separately as `answerStampDiffers`).
     */
    reloadParity: {
      rowTextMatchesLive: boolean;
      targetMatchesLive: boolean;
      footerStatusMatchesLive: boolean;
      answerMatchesLive: boolean | null;
      answerProseLive: string | null;
      answerProseHistory: string | null;
      answerStampDiffers: boolean;
      usageVsLive: {
        harnessFrame: { input?: number; output?: number; total?: number } | null;
        liveFooter: { input: number | null; output: number | null; total: number | null } | null;
        historyFooter: { input: number | null; output: number | null; total: number | null } | null;
        totalsMatch: boolean | null;
      };
    };
    requests: {
      lastRole: string | null;
      lastUserText: string;
      hasToolResult: boolean;
      toolCount: number;
      plan: { kind: string; name?: string; text?: string; reason?: string };
    }[];
    toolsAdvertised: string[];
  };
  inkThemes: { light: string | null; dark: string | null };
  dayCrop: { inkPixels: number };
  scopes: {
    scopedHermes: boolean;
    defaultedHermes: boolean;
    defaultedPi: boolean;
    persisted: { agentId: string; domains: string[]; defaultFor: string[] }[];
    overview: { pills: { name: string; active: boolean }[] };
    health: { pills: { name: string; active: boolean }[] };
    healthGated: { gated: boolean; lead: string };
    financial: { pills: { name: string; active: boolean }[] };
  };
  screenshots: string[];
};

/** Relative luminance of a computed `rgb(...)` colour: 0 black, 255 white. */
function luminance(color: string | null): number {
  const [r, g, b] = (color ?? "").match(/[\d.]+/g)?.map(Number) ?? [];
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function runRig(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/pi-companion.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000, env: { ...process.env } },
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

describe("built-in companion (Pi)", () => {
  it("answers a turn in the dock and offers both companions", async (t) => {
    fs.rmSync(REPORT, { force: true });
    const exitCode = await runRig();
    assert.equal(fs.existsSync(REPORT), true, "rig wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(exitCode, 0, "rig exited non-zero");
    assert.equal(report.ok, true);

    assert.equal(report.configured.settings, "ready");
    assert.equal(report.configured.switched, "ready");
    assert.equal(report.configured.openedOk, true);
    assert.equal(
      report.configured.unlocked,
      true,
      "the rig could not unlock the seeded Health and Finance areas",
    );
    assert.equal(report.mounted, true, "the dock never mounted");
    assert.equal(report.turn.ok, true);
    assert.ok(
      report.turn.eventTypes.includes("assistant.delta"),
      "the turn produced no streamed text",
    );
    assert.ok(report.deltas.includes("Hello from Pi."), `streamed text: ${report.deltas}`);
    assert.equal(report.completed, true, "the turn never completed");
    assert.ok(
      (report.stored ?? []).some((line) => line.includes("Hello from Pi.")),
      "the harness did not persist the reply",
    );
    assert.equal(report.threadHasReply, true, "the dock did not show the reply");

    /*
     * The tool turn: a real read-only vault call, executed by the real
     * pi-harness through the real MCP door, rendered by the dock's work log.
     * The checks are named in the report so a failure says which fact broke;
     * these restate them by name here.
     */
    assert.ok(
      report.tool.database?.id,
      `the rig could not seed the table its tool call reads: ${report.tool.databaseError}`,
    );
    assert.equal(
      report.tool.checks.toolTurnOk,
      true,
      `the tool turn did not resolve: ${report.tool.live.turnError}`,
    );
    assert.equal(
      report.tool.checks.toolsAdvertised,
      true,
      "the model request advertised no vault tools — the MCP door did not bind",
    );
    assert.equal(
      report.tool.checks.endpointRequestedToolCall,
      true,
      "the fake endpoint never scripted a tool call",
    );
    assert.equal(
      report.tool.checks.harnessRanTool,
      true,
      "pi-harness emitted no tool start/completion for the scripted call",
    );
    assert.equal(
      report.tool.checks.toolSucceeded,
      true,
      `the read-only tool call failed: ${JSON.stringify(report.tool.live.wire.toolCompleted)}`,
    );
    assert.ok(
      report.tool.live.wire.eventTypes.includes("tool.started") &&
        report.tool.live.wire.eventTypes.includes("tool.completed"),
      `tool frames missing from the stream: ${report.tool.live.wire.eventTypes.join(", ")}`,
    );
    assert.ok(
      report.tool.live.wire.eventTypes.includes("assistant.final") &&
        report.tool.live.wire.eventTypes.includes("usage") &&
        report.tool.live.wire.runCompleted,
      `tool turn did not complete with a final answer and usage: ${report.tool.live.wire.eventTypes.join(", ")}`,
    );
    assert.equal(
      report.tool.live.toolName,
      report.tool.plan?.name ?? report.tool.live.toolName,
      "the executed tool is not the one the endpoint asked for",
    );
    assert.ok(
      report.tool.toolsAdvertised.includes(report.tool.live.toolName ?? ""),
      `the tool the endpoint asked for was not advertised: ${report.tool.live.toolName}`,
    );

    // While it ran: a row named after the real tool, with a non-empty target.
    assert.equal(
      report.tool.live.rowSeenWhileRunning,
      true,
      "the dock showed no tool row before the turn settled",
    );
    assert.ok(
      (report.tool.live.rowText ?? "").includes(report.tool.live.toolName ?? ""),
      `the live row does not name the tool: ${report.tool.live.rowText}`,
    );
    assert.ok(
      report.tool.live.target.length > 0,
      `the live tool row has no target: ${report.tool.live.rowText}`,
    );
    assert.equal(
      report.tool.checks.liveRowTargetNamesTable,
      true,
      `the live row's target is not the seeded table: ${report.tool.live.target}`,
    );
    assert.equal(
      report.tool.checks.liveResultNamesTable,
      true,
      `the live row's result never names the seeded table: ${report.tool.live.resultPreview?.slice(0, 200)}`,
    );
    // After it ran: closed as done, with the harness-measured duration.
    assert.equal(
      report.tool.checks.toolSucceeded,
      true,
      `the tool call did not return the rig's table: ${report.tool.live.resultPreview?.slice(0, 200)}`,
    );
    assert.equal(
      report.tool.live.rowState,
      "done",
      `the settled tool row is ${report.tool.live.rowState}, not done: ${report.tool.live.rowText}`,
    );
    assert.ok(
      report.tool.live.duration !== null,
      "the settled tool row carries no duration in its DOM data",
    );
    assert.equal(
      report.tool.live.duration?.native,
      true,
      "the duration is not the harness-measured one (data-tool-duration-source)",
    );
    assert.ok(
      typeof report.tool.live.wire.toolCompleted?.durationMs === "number",
      "pi-harness reported no native duration on tool.completed",
    );

    // The settled turn: a process fold, the answer outside it, and a footer.
    assert.match(
      report.tool.live.foldHeader ?? "",
      /worked for/i,
      `no "Worked for …" process fold: ${report.tool.live.foldHeader}`,
    );
    assert.ok(
      (report.tool.live.answer ?? "").includes(TOOL_ANSWER),
      `the answer bubble is not the second completion: ${report.tool.live.answer}`,
    );
    assert.equal(
      report.tool.live.answerOutsideProcess,
      true,
      "the final answer was rendered inside the folded process",
    );
    assert.equal(
      report.tool.live.footerStatus,
      "completed",
      `the turn footer is ${report.tool.live.footerStatus}, not completed`,
    );
    assert.equal(
      report.tool.live.usage.present,
      true,
      "the turn footer carries no token usage",
    );
    assert.equal(
      report.tool.live.usage.numeric,
      true,
      `the footer's usage carries no numbers: ${report.tool.live.usage.text}`,
    );

    // History: the same row survives a reload, rebuilt from the transcript.
    assert.equal(
      report.tool.history.toolRowSeen,
      true,
      "the reloaded chat shows no tool row from history",
    );
    assert.ok(
      (report.tool.history.rowText ?? "").includes(report.tool.live.toolName ?? ""),
      `the history row does not name the tool: ${report.tool.history.rowText}`,
    );
    assert.ok(
      report.tool.history.target.length > 0,
      `the history tool row has no target: ${report.tool.history.rowText}`,
    );
    assert.equal(
      report.tool.checks.historyRowTargetNamesTable,
      true,
      `the history row's target is not the seeded table: ${report.tool.history.target}`,
    );
    assert.equal(
      report.tool.checks.historyResultNamesTable,
      true,
      `the history row lost the tool result: ${report.tool.history.resultText.slice(0, 200)}`,
    );
    assert.equal(
      report.tool.checks.historyRowClosedDone,
      true,
      `the reloaded tool row is ${report.tool.history.rowState}, not done`,
    );
    assert.match(
      report.tool.history.foldHeader ?? "",
      /worked for/i,
      `the reloaded turn has no process fold: ${report.tool.history.foldHeader}`,
    );
    assert.ok(
      (report.tool.history.answer ?? "").includes(TOOL_ANSWER),
      `the reloaded turn lost its answer: ${report.tool.history.answer}`,
    );
    assert.equal(
      report.tool.reloadParity.answerMatchesLive,
      true,
      "the reloaded answer's prose differs from the live turn's: " +
        `live=${JSON.stringify(report.tool.reloadParity.answerProseLive)} ` +
        `history=${JSON.stringify(report.tool.reloadParity.answerProseHistory)}`,
    );
    assert.equal(
      report.tool.checks.liveRowSeenWhileRunning &&
        report.tool.checks.liveRowClosedDone &&
        report.tool.checks.historyToolRowSeen,
      true,
      `tool-turn checks: ${JSON.stringify(
        Object.fromEntries(
          Object.entries(report.tool.checks).filter(([, pass]) => pass !== true),
        ),
      )}`,
    );

    assert.equal(report.picker.shown, true, "the dock offers no agent switcher");
    assert.deepEqual(
      (report.picker.items ?? []).sort(),
      ["Hermes", "Pi"],
      "the switcher does not offer both agents",
    );

    // Pi's block wears the press kit's mark as a black-and-white glyph: the
    // same three blocks, one ink, drawn whole inside the circular block. A
    // block whose mark failed to load would fall back to its initial, and one
    // drawn too large would be clipped by the circle — both are pictures of
    // the wrong thing, so both are asserted here rather than left to the eye.
    const piMark = (report.picker.marks ?? []).find((mark) => mark.label === "Pi");
    assert.ok(piMark, "the switcher drew no mark for Pi");
    assert.equal(piMark.kind, "glyph", "Pi's block does not wear the glyph mark");
    assert.equal(piMark.viewBox, "0 0 800 800", "Pi's mark is not the official logo");
    assert.equal(piMark.pathCount, 3, "Pi's mark lost a block of the logo");
    assert.deepEqual(
      new Set(piMark.fills).size,
      1,
      `Pi's mark is not one ink: ${piMark.fills.join(", ")}`,
    );
    assert.equal(piMark.fills[0], piMark.ink, "Pi's mark is not drawn in the theme's ink");
    assert.ok(piMark.rendered, "Pi's mark painted nothing");
    assert.equal(piMark.rendered.centered, true, "Pi's mark is not centered in its block");
    assert.equal(piMark.rendered.fitsCircle, true, "Pi's mark is clipped by its block");
    assert.ok(
      piMark.rendered.sizeRatio > 0.5 && piMark.rendered.sizeRatio < 0.95,
      `Pi's mark fills ${piMark.rendered.sizeRatio.toFixed(2)} of its block`,
    );

    const hermesMark = (report.picker.marks ?? []).find(
      (mark) => mark.label === "Hermes",
    );
    assert.equal(hermesMark?.kind, "image", "Hermes' block lost its artwork");
    assert.equal(hermesMark?.decoded, true, "Hermes' artwork did not load");

    // One ink, two values: the mark is black on the day page and white at
    // night. The day read comes from a real boot under the light preference.
    const { light: dayInk, dark: nightInk } = report.inkThemes;
    assert.notEqual(dayInk, nightInk, "Pi's mark does not follow the app's ink");
    assert.ok(luminance(dayInk) < 90, `day ink is not black: ${dayInk}`);
    assert.ok(luminance(nightInk) > 180, `night ink is not white: ${nightInk}`);

    // Domain scoping: Hermes narrowed to Health and default there; Pi everywhere
    // and default in Financial.
    assert.equal(report.scopes.scopedHermes, true, "no Hermes scope chip");
    assert.equal(report.scopes.defaultedHermes, true, "no Hermes default chip");
    assert.equal(report.scopes.defaultedPi, true, "no Pi default chip");
    assert.ok(
      report.scopes.persisted.some(
        (scope) => scope.agentId === "hermes" && scope.domains.includes("health"),
      ),
      `the scope did not reach the vault: ${JSON.stringify(report.scopes.persisted)}`,
    );
    assert.deepEqual(
      report.scopes.overview.pills.map((pill) => pill.name),
      ["Pi"],
      "Overview offered an agent scoped to another domain",
    );
    if (report.scopes.healthGated.gated) {
      // No ready Hermes in this world: the gate naming Hermes is the domain
      // default having fired.
      assert.match(
        report.scopes.healthGated.lead,
        /hermes/i,
        "entering Health did not attempt its default agent",
      );
    } else {
      assert.deepEqual(
        report.scopes.health.pills.map((pill) => pill.name).sort(),
        ["Hermes", "Pi"],
        "the Health domain did not offer both agents",
      );
      assert.equal(
        report.scopes.health.pills.find((pill) => pill.name === "Hermes")?.active,
        true,
        "entering Health did not select its default agent",
      );
    }
    assert.deepEqual(
      report.scopes.financial.pills.map((pill) => pill.name),
      ["Pi"],
      "the Financial domain offered an agent scoped away from it",
    );
    assert.equal(
      report.scopes.financial.pills.find((pill) => pill.name === "Pi")?.active,
      true,
      "entering Financial did not return to its default agent",
    );

    assert.equal(fs.existsSync(THREAD_SHOT), true, "no thread screenshot");
    assert.equal(fs.existsSync(PICKER_SHOT), true, "no picker screenshot");
    assert.equal(fs.existsSync(TURN_SHOT), true, "no settled tool-turn screenshot");
    assert.equal(
      fs.existsSync(TURN_HISTORY_SHOT),
      true,
      "no tool-turn history screenshot",
    );
    assert.equal(fs.existsSync(SWITCHER_SHOT), true, "no switcher screenshot");
    assert.ok(
      fs.statSync(SWITCHER_SHOT).size > 500,
      "the switcher screenshot is empty",
    );
    assert.equal(fs.existsSync(DAY_SHOT), true, "no day switcher screenshot");
    assert.ok(fs.statSync(DAY_SHOT).size > 500, "the day switcher screenshot is empty");
    assert.ok(
      report.dayCrop.inkPixels > 60,
      `the day crop shows no ink: ${report.dayCrop.inkPixels} px`,
    );
    for (const name of [
      "pi-companion-scope-overview.png",
      "pi-companion-scope-domain.png",
    ]) {
      assert.equal(fs.existsSync(path.join(desktopRoot, "e2e/artifacts", name)), true, `no ${name}`);
    }
    t.diagnostic(`artifact: ${REPORT}`);
  });
});
