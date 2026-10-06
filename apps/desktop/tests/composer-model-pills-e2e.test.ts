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
const REPORT = path.join(desktopRoot, "e2e/artifacts/composer-model-pills.json");

/**
 * The model/thinking pill rig drives the real ChatPanel in a real layout engine,
 * so it needs the Vite dev server; with the server down the test skips and
 * `npm run dev` in another shell turns it on.
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

/** Alpha channel of a computed colour, as the string the driver reports. */
function opacityIsOne(color: string): string {
  const numbers = (color.match(/[\d.]+/g) ?? []).map(Number);
  const alpha = numbers.length >= 4 ? numbers[3] : 1;
  return alpha === 1 ? color.replace(/\s/g, "") : `${color} (alpha ${alpha})`;
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/composer-model-pills.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
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

type Pill = {
  label: string;
  override: string;
  hasDot: boolean;
  disabled: boolean;
  hasPopup: string;
  expanded: string;
  height: number;
};

type Report = {
  pass: boolean;
  failures: string[];
  initial: {
    rowPresent: boolean;
    rowBackground: string;
    rowBorderTopWidth: string;
    rowHeight: number;
    rowBelowField: boolean;
    menuClosed: boolean;
    pills: Pill[];
  };
  defaultThinking: { rows: string[]; closedByEscape: boolean };
  menu: {
    menuPresent: boolean;
    menuBackground: string;
    menuBorderWidth: string;
    menuShadow: boolean;
    opensUpward: boolean;
    menuBottom: number;
    pillTop: number;
    insidePanel: boolean;
    providerChips: { label: string; checked: string; authenticated: string; disabled: boolean }[];
    rows: { label: string; checked: string }[];
  };
  guard: {
    submits: number;
    chatCalls: number;
    draft: string;
    closedByOutsideClick: boolean;
    menuClosed: boolean;
  };
  pickedModel: {
    clicked: boolean;
    pills: Pill[];
    menuClosed: boolean;
    stored: string | null;
  };
  restoredRow: { pills: Pill[] };
  secondRow: { pills: Pill[] };
  secondPick: { clicked: boolean };
  secondStored: string | null;
  secondTurn: {
    runtime: { model?: string; provider?: string; reasoningEffort?: string } | null;
    sessionId: string | null;
    added: number;
  };
  backRow: { pills: Pill[] };
  providerBleed: { rows: string[]; chip: string; closed: boolean };
  thinking: { rows: string[]; label: string; override: string; stored: string | null };
  noReasoning: { clicked: boolean; pills: Pill[] };
  providers: {
    inertLabel: string;
    afterInert: string[];
    rows: string[];
    currentChip: string;
  };
  sent: {
    runtime: { provider?: string; model?: string; reasoningEffort?: string } | null;
    added: number;
    sessionId: string | null;
    during: boolean[];
    after: boolean[];
    input: string | null;
  };
  withoutCatalog: { row: boolean; field: boolean; send: boolean; stored: string | null };
  finalRow: { height: number; pills: number } | null;
};

describe("composer model and thinking pills", () => {
  it("carries a model and thinking pick from the pill to the turn", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // The resting row: two pills, naming the profile's own default, painting
    // nothing, sitting under the field they belong to.
    assert.equal(report.initial.rowPresent, true, "the runtime row never rendered");
    assert.equal(
      report.initial.rowBackground.replace(/\s/g, ""),
      "rgba(0,0,0,0)",
      `the runtime row painted a fill: ${report.initial.rowBackground}`,
    );
    assert.equal(report.initial.rowBorderTopWidth, "0px", "the runtime row painted a hairline");
    assert.equal(report.initial.rowBelowField, true, "the pills are not under the field");
    assert.equal(report.initial.pills.length, 2, "expected exactly the model and thinking pills");
    assert.equal(report.initial.pills[0]?.label, "space-bunny-alpha", "the model pill lost the default label");
    assert.equal(report.initial.pills[0]?.override, "false", "an unpicked model pill claimed an override");
    assert.equal(report.initial.pills[0]?.hasDot, false, "an unpicked model pill carried the override dot");
    assert.equal(report.initial.pills[0]?.hasPopup, "menu", "the model pill does not announce a menu");
    assert.equal(report.initial.menuClosed, true, "a menu rendered on an untouched composer");

    // The capability gates, both directions.
    assert.equal(
      report.defaultThinking.rows.includes("Thinking level Off"),
      false,
      "thinking off was offered for a model the catalog says cannot switch it off",
    );
    assert.equal(report.defaultThinking.closedByEscape, true, "Escape did not close the menu");
    assert.equal(
      report.noReasoning.pills.length,
      1,
      "the thinking pill survived a model with no reasoning control",
    );
    assert.equal(
      report.thinking.rows.includes("Thinking level Off"),
      true,
      "thinking off was missing for a model that allows it",
    );

    // The menu: upward, opaque, inside the panel, with the gateway's providers.
    assert.equal(report.menu.menuPresent, true, "the model menu never opened");
    assert.equal(report.menu.opensUpward, true, "the menu opened downward off the panel");
    assert.equal(report.menu.insidePanel, true, "the menu escaped the panel's box");
    assert.equal(
      report.menu.menuBackground.replace(/\s/g, ""),
      opacityIsOne(report.menu.menuBackground),
      `the menu surface is translucent: ${report.menu.menuBackground}`,
    );
    assert.equal(report.menu.menuShadow, true, "the menu carried no shadow");
    assert.equal(
      report.menu.rows[1]?.label,
      "moonshotai/kimi-linear",
      "the model list did not open on the catalogue's newest model",
    );
    assert.equal(
      report.menu.rows[report.menu.rows.length - 1]?.label,
      "stealth/space-bunny-alpha",
      "the model list is not reversed",
    );
    assert.equal(report.menu.providerChips.length, 3, "the provider strip lost a provider");
    assert.equal(
      report.menu.providerChips.filter((chip) => chip.checked === "true").length,
      1,
      "the provider strip marked more than the current provider",
    );
    assert.equal(
      report.menu.providerChips.some((chip) => chip.authenticated === "false" && chip.disabled),
      true,
      "an unauthenticated provider was offered as choosable",
    );

    // The guard the row's placement makes necessary.
    assert.equal(report.guard.submits, 0, "a pill submitted the composer's form");
    assert.equal(report.guard.chatCalls, 0, "a pill sent the draft");
    assert.equal(report.guard.closedByOutsideClick, true, "a click outside did not close the menu");
    assert.equal(report.guard.menuClosed, true, "the trigger did not toggle the menu shut");

    // A pick, and what it becomes.
    assert.equal(report.pickedModel.pills[0]?.label, "gpt-6-sol", "the pill did not take the model's short name");
    assert.equal(report.pickedModel.pills[0]?.override, "true", "the pick is not marked as the operator's own");
    assert.equal(report.pickedModel.pills[0]?.hasDot, true, "the pick carried no override dot");
    assert.equal(report.pickedModel.menuClosed, true, "the menu stayed open after a choice");
    assert.equal(
      report.restoredRow.pills[0]?.label,
      "gpt-6-sol",
      "a fresh launch did not come back on the pick",
    );
    assert.equal(
      report.restoredRow.pills[0]?.override,
      "true",
      "the restored pick is not marked as the operator's own",
    );

    // The pin belongs to the chat: a second chat opens unpinned, keeps its own
    // pair side by side, and each chat's turn carries only its own.
    assert.equal(
      report.secondRow.pills[0]?.label,
      "space-bunny-alpha",
      "the second chat opened on the first chat's pin",
    );
    assert.equal(
      report.secondRow.pills[0]?.override,
      "false",
      "the second chat claimed a pin it never had",
    );
    assert.equal(report.secondPick.clicked, true, "the second chat could not be pinned");
    assert.deepEqual(
      { ...report.secondTurn.runtime, sessionId: report.secondTurn.sessionId, added: report.secondTurn.added },
      {
        model: "anthropic/claude-opus-5",
        provider: "anthropic",
        reasoningEffort: "medium",
        sessionId: "harness-session-2",
        added: 1,
      },
      "the second chat's turn did not carry its own pin",
    );
    const secondPins = JSON.parse(report.secondStored ?? "{}") as Record<
      string,
      { model?: string; provider?: string; reasoningEffort?: string }
    >;
    assert.equal(
      secondPins["harness-session-2"]?.model,
      "anthropic/claude-opus-5",
      "the second chat's model was not kept",
    );
    assert.equal(
      secondPins["harness-session-2"]?.reasoningEffort,
      "medium",
      "the second chat's level was not kept",
    );
    assert.equal(
      secondPins["harness-session"]?.model,
      "openai/gpt-6-sol",
      "the second chat's pick overwrote the first chat's",
    );
    assert.equal(
      secondPins["harness-session"]?.reasoningEffort,
      undefined,
      "the first chat picked up the second chat's level",
    );
    assert.equal(
      report.backRow.pills[0]?.label,
      "gpt-6-sol",
      "switching back did not restore the first chat's pin",
    );
    assert.equal(
      report.providerBleed.chip,
      "Nous Portal",
      "the model menu opened on a provider browsed in the other chat",
    );
    assert.equal(report.providerBleed.closed, true, "Escape did not close the menu");
    assert.equal(
      report.thinking.label,
      "High",
      "the thinking pill did not take the chosen level",
    );
    assert.equal(report.thinking.override, "true", "the chosen level is not marked as an override");
    const pins = JSON.parse(report.thinking.stored ?? "{}") as Record<
      string,
      { model?: string; provider?: string; reasoningEffort?: string }
    >;
    assert.equal(
      pins["harness-session"]?.model,
      "openai/gpt-6-sol",
      "the model pick was not remembered against its chat",
    );
    assert.equal(
      pins["harness-session"]?.reasoningEffort,
      "high",
      "the level was not remembered with it",
    );

    // The provider strip drives the model list.
    assert.equal(report.providers.currentChip, "Anthropic", "a provider chip did not take the list");
    assert.equal(
      report.providers.rows.includes("anthropic/claude-opus-5"),
      true,
      "the switched provider's models did not appear",
    );
    assert.equal(
      report.providers.afterInert.includes("moonshotai/kimi-linear"),
      true,
      "the unauthenticated provider chip changed the list",
    );

    // The turn: the pick rides the chat call, and only the parts that were chosen.
    assert.deepEqual(
      report.sent.runtime,
      {
        provider: "anthropic",
        model: "anthropic/claude-opus-5",
        reasoningEffort: "high",
      },
      "the turn did not carry the picked runtime",
    );
    assert.equal(report.sent.added, 1, "the pick turn did not send exactly once");
    assert.equal(report.sent.sessionId, "harness-session", "the turn went to another chat");
    assert.equal(
      report.sent.during.every(Boolean),
      true,
      "the pills stayed live while the turn was streaming",
    );
    assert.equal(
      report.sent.after.every((disabled) => disabled === false),
      true,
      "the pills never came back after the turn",
    );

    // And the absence state: no catalog, no row, composer unchanged.
    assert.equal(report.withoutCatalog.row, false, "the runtime row rendered without a catalog");
    assert.equal(
      (JSON.parse(report.withoutCatalog.stored ?? "{}") as Record<string, { model?: string }>)[
        "harness-session"
      ]?.model,
      "anthropic/claude-opus-5",
      "the pick did not outlive a reload",
    );
    assert.equal(report.withoutCatalog.field, true, "the composer field vanished without a catalog");
    assert.equal(report.withoutCatalog.send, false, "the send control rendered on an empty draft");

    // The row's own cost, for the report: one line of chrome under the field.
    assert.ok(
      report.finalRow && report.finalRow.height > 0 && report.finalRow.height < 40,
      `the runtime row is ${report.finalRow?.height}px tall`,
    );
    assert.equal(
      report.finalRow?.height,
      report.initial.rowHeight,
      "the row changed size over a session",
    );
  });
});
