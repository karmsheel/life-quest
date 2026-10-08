/**
 * The chat-panel harness page (`e2e/chat-panel.{html,tsx}`) and the three rigs
 * that drive it: composer sizing (`composer-autogrow.electron.mjs`), the
 * composer's runtime row (`composer-model-pills.electron.mjs`) and how tool
 * activity is shown (`tool-run.electron.mjs`). They are wrapped together
 * because they share one page, one dev-server probe and one shape of report
 * read back; each rig is still its own Electron process writing its own
 * artifact, so a failure names the concern it belongs to.
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

const REPORT = path.join(desktopRoot, "e2e/artifacts/composer-autogrow.json");

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

/** Alpha channel of a computed colour; 1 when the string carries none. */
function alphaOf(color: string | null): number {
  const numbers = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return numbers.length >= 4 ? numbers[3] : 1;
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/composer-autogrow.electron.mjs")],
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

/**
 * The composer autogrow rig needs the Vite dev server, because it measures the
 * real ChatPanel in a real layout engine rather than a stubbed DOM. With the
 * server down the test skips; `npm run dev` in another shell turns it on.
 */

describe("chat panel rigs", { concurrency: true }, () => {
  describe("composer autogrow", () => {
    it("grows the field with the draft and clamps it at half the panel", async (t) => {
      if (!(await devServerUp())) {
        t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
        return;
      }

      fs.rmSync(REPORT, { force: true });
      const exitCode = await runDriver();
      assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

      const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
        pass: boolean;
        failures: string[];
        restHeightPx: number;
        capPx: number;
        restPanelHeight: number;
        samples: { step: string; fieldHeight: number; fieldSpansRow: boolean }[];
        resizeChecks: { step: string; fieldHeight: number; expectedCap: number }[];
        send: {
          hiddenWhileEmpty: boolean;
          controlPx: number;
          gutterPx: number;
          removedColumnPx: number;
          insideField: { inside: boolean };
          click: { present: boolean; enabled: boolean; calls: string[]; draftAfter: string; sendPresentAfter: boolean };
          stream: {
            decoded: { type: string; runId: string } | null;
            decodedTerminal: { type: string } | null;
            decodedFailed: { type: string; reason: string } | null;
            live: { present: boolean; state: string | null; square: boolean; arrow: boolean; disabled: boolean | null };
            afterRunStarted: { present: boolean; state: string | null; disabled: boolean | null };
            afterStopClick: { stops: string[]; state: string | null; fieldDisabled: boolean };
            afterCancelled: { note: string | null; noteRole: string | null };
            settled: { present: boolean; fieldDisabled: boolean; note: string | null };
            submits: number;
          };
          shots: {
            held: { armed: boolean; polledMs: number };
            stopped: { clicked: boolean; cleared: boolean; waitedMs: number };
          };
        };
        composer: {
          restingRing: {
            borderWidth: string;
            borderStyle: string;
            borderColor: string;
            boxShadow: string;
            outlineStyle: string;
            focused: boolean;
            matchesFocus: boolean;
            matchesFocusVisible: boolean;
            documentFocused: boolean;
          };
          focused: {
            borderWidth: string;
            borderStyle: string;
            borderColor: string;
            boxShadow: string;
            outlineStyle: string;
            focused: boolean;
            matchesFocus: boolean;
            matchesFocusVisible: boolean;
            documentFocused: boolean;
          };
          accent: string;
          border: string;
          ring: { reference1px: string; reference2px: string };
          devicePixelRatio: number;
          borderWidthDevicePx: number;
          footerBackground: string;
          footerBorderTopWidth: string;
          footerPaddingTop: number;
        };
      };

      assert.deepEqual(report.failures, []);
      assert.equal(exitCode, 0, "driver exited non-zero");
      assert.equal(report.pass, true);

      // Restated here so the numbers are asserted by the suite, not only inside
      // the driver: the cap is half the panel and the resting shape is untouched.
      assert.equal(report.capPx, Math.max(Math.round(report.restPanelHeight / 2), 72));
      assert.ok(report.samples.length >= 10, "expected the full growth ladder");
      for (const sample of report.samples) {
        assert.ok(
          sample.fieldHeight <= report.capPx + 1,
          `${sample.step} exceeded the cap: ${sample.fieldHeight}px`,
        );
        assert.ok(
          sample.fieldHeight >= report.restHeightPx,
          `${sample.step} fell under the resting height: ${sample.fieldHeight}px`,
        );
      }
      for (const check of report.resizeChecks) {
        assert.ok(
          Math.abs(check.fieldHeight - check.expectedCap) <= 1,
          `${check.step} did not re-clamp to its panel: ${check.fieldHeight}px`,
        );
      }

      // The inline send control: hidden while the composer is empty, inside the
      // field's own box when it shows, and still submitting the form.
      assert.equal(report.send.hiddenWhileEmpty, true, "send control rendered on an empty composer");
      assert.equal(report.send.insideField.inside, true, "send control sat outside the field");
      assert.ok(
        report.send.gutterPx < report.send.removedColumnPx,
        `gutter ${report.send.gutterPx}px did not beat the removed ${report.send.removedColumnPx}px column`,
      );
      for (const sample of report.samples) {
        assert.equal(sample.fieldSpansRow, true, `${sample.step} did not give the field the full row width`);
      }
      assert.equal(report.send.click.present && report.send.click.enabled, true, "send control unusable");
      assert.equal(report.send.click.calls.length, 1, "icon button did not submit exactly once");
      assert.equal(report.send.click.calls[0]?.length > 0, true, "submitted draft was empty");
      assert.equal(report.send.click.draftAfter, "", "draft survived the send");
      assert.equal(report.send.click.sendPresentAfter, false, "send control stayed on screen after the send");

      // The streaming state: the same control becomes an interrupt, armed by the
      // run id from the wire, and it clears only when the stream actually ends.
      assert.equal(report.send.stream.decoded?.type, "run.started", "run.started did not decode");
      assert.equal(report.send.stream.decoded?.runId, "run_harness_1", "run id lost in decoding");
      assert.equal(report.send.stream.live.state, "stop", "no stop state while the run was live");
      assert.equal(report.send.stream.live.square, true, "arrow stayed up while streaming");
      assert.equal(report.send.stream.live.arrow, false, "arrow and stop square rendered together");
      assert.equal(report.send.stream.live.disabled, true, "stop was clickable before the run id arrived");
      assert.equal(report.send.stream.afterRunStarted.disabled, false, "stop never armed");
      assert.deepEqual(report.send.stream.afterStopClick.stops, ["run_harness_1"], "stop IPC not called with the run id");
      assert.equal(report.send.stream.afterStopClick.state, "stop", "control flipped back while the gateway was still working");
      assert.equal(report.send.stream.submits, 0, "the stop click routed through the composer form");
      assert.equal(report.send.stream.settled.present, false, "control outlived the stream");

      // The two lifecycle screenshots are taken across a driver-side capture, so
      // the state each photographs is asserted rather than assumed: the hold has
      // to still be armed when the streaming shot is written, and the stop square
      // still clickable when the settled shot's turn is stopped.
      assert.equal(report.send.shots.held.armed, true, "the streaming screenshot had no armed stop square");
      assert.equal(report.send.shots.stopped.clicked, true, "the stop square was gone before it could be clicked");
      assert.equal(report.send.shots.stopped.cleared, true, "the stopped screenshot still showed a live control");

      // ...and it does not leave the stopped turn reading like a finished one.
      assert.equal(report.send.stream.decodedTerminal?.type, "run.stopped", "run.cancelled did not decode");
      assert.equal(report.send.stream.decodedFailed?.type, "run.incomplete", "run.failed did not decode");
      assert.equal(report.send.stream.decodedFailed?.reason, "iteration budget", "turn exit reason lost");
      assert.match(
        report.send.stream.afterCancelled.note ?? "",
        /^Stopped/,
        "the interrupted turn carried no marker",
      );
      assert.equal(report.send.stream.afterCancelled.noteRole, "status", "the marker is not announced");
      assert.equal(
        report.send.stream.settled.note,
        report.send.stream.afterCancelled.note,
        "the marker vanished when the stream closed",
      );

      // The composer's own chrome: the accent ring lives on the field, the band
      // around it paints nothing of its own, and selecting the field adds light
      // rather than a second colour.
      assert.equal(
        alphaOf(report.composer.footerBackground),
        0,
        `the composer band paints its own fill: ${report.composer.footerBackground}`,
      );
      assert.equal(report.composer.footerBorderTopWidth, "0px", "the composer band kept its hairline");
      assert.ok(report.composer.footerPaddingTop > 0, "the composer band lost its gutter");
      assert.equal(report.composer.restingRing.borderStyle, "solid", "the field's ring is not solid");
      // Thickness is checked against a reference element measured in the same
      // renderer, never a hard-coded string: Chromium snaps a used border width
      // down to whole device pixels, so 2px renders as 1.6px on a 125% display.
      assert.equal(
        report.composer.restingRing.borderWidth,
        report.composer.ring.reference2px,
        `the field's ring is not the 2px reference: ${report.composer.restingRing.borderWidth} vs ${report.composer.ring.reference2px}`,
      );
      assert.ok(
        parseFloat(report.composer.ring.reference2px) >
          parseFloat(report.composer.ring.reference1px),
        `a 2px ring did not measure thicker than a 1px one: ${JSON.stringify(report.composer.ring)}`,
      );
      assert.ok(
        report.composer.borderWidthDevicePx >= 2,
        `the field's ring is under 2 device px: ${report.composer.borderWidthDevicePx} at dpr ${report.composer.devicePixelRatio}`,
      );
      assert.equal(
        report.composer.restingRing.borderColor,
        report.composer.accent,
        `the field's ring is not the accent: ${report.composer.restingRing.borderColor} vs ${report.composer.accent}`,
      );
      assert.notEqual(
        report.composer.restingRing.borderColor,
        report.composer.border,
        "the field still wears the neutral hairline",
      );
      assert.equal(report.composer.restingRing.boxShadow, "none", "an unselected field already glows");
      assert.equal(
        report.composer.focused.focused,
        true,
        "the field never took focus, so the glow could not be measured",
      );
      assert.equal(
        report.composer.focused.matchesFocus,
        true,
        "the field held activeElement without matching :focus, so a glow would measure nothing",
      );
      assert.match(report.composer.focused.boxShadow, /0px 0px 0px 3px/, "no focus ring in the glow");
      assert.match(report.composer.focused.boxShadow, /0px 0px 14px 2px/, "no soft halo in the glow");
      assert.equal(
        report.composer.focused.borderColor,
        report.composer.restingRing.borderColor,
        "selection changed the ring's colour instead of adding light",
      );
      assert.equal(report.composer.focused.outlineStyle, "none", "the focus outline was not suppressed");
    });
  });

  const PILLS_REPORT = path.join(desktopRoot, "e2e/artifacts/composer-model-pills.json");


  /** Alpha channel of a computed colour, as the string the driver reports. */
  function opacityIsOne(color: string): string {
    const numbers = (color.match(/[\d.]+/g) ?? []).map(Number);
    const alpha = numbers.length >= 4 ? numbers[3] : 1;
    return alpha === 1 ? color.replace(/\s/g, "") : `${color} (alpha ${alpha})`;
  }

  function runPillsDriver(): Promise<number> {
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

  type PillsReport = {
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
      /** The line under the field: its box, and where the attach control and
       *  the runtime pick sit on it. Null when either end is missing. */
      line: {
        fieldBottom: number;
        line: { left: number; right: number; top: number; bottom: number };
        attach: { left: number; right: number; top: number; bottom: number };
        pick: { left: number; right: number; top: number; bottom: number };
        sameLine: boolean;
        attachGroup: boolean;
      } | null;
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

  /**
   * The model/thinking pill rig drives the real ChatPanel in a real layout engine,
   * so it needs the Vite dev server; with the server down the test skips and
   * `npm run dev` in another shell turns it on.
   */

  describe("composer model and thinking pills", () => {
    it("carries a model and thinking pick from the pill to the turn", async (t) => {
      if (!(await devServerUp())) {
        t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
        return;
      }

      fs.rmSync(PILLS_REPORT, { force: true });
      const exitCode = await runPillsDriver();
      assert.equal(fs.existsSync(PILLS_REPORT), true, "driver wrote no report artifact");

      const report = JSON.parse(fs.readFileSync(PILLS_REPORT, "utf8")) as PillsReport;
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
      assert.ok(report.initial.line, "the footer line under the field was not measured");
      assert.ok(
        report.initial.line!.attach.top >= report.initial.line!.fieldBottom,
        `the attach control is not under the field: ${JSON.stringify(report.initial.line!.attach)} vs field bottom ${report.initial.line!.fieldBottom}`,
      );
      assert.ok(
        Math.abs(report.initial.line!.attach.left - report.initial.line!.line.left) <= 1 &&
          report.initial.line!.attach.right < report.initial.line!.pick.left,
        `the attach control is not at the left end of the line: attach ${JSON.stringify(report.initial.line!.attach)} pick left ${report.initial.line!.pick.left}`,
      );
      assert.equal(report.initial.line!.sameLine, true, "the attach control and the pick are not on one line");
      assert.ok(
        Math.abs(report.initial.line!.pick.right - report.initial.line!.line.right) <= 1,
        `the runtime pick is not at the right end of the line: pick ${JSON.stringify(report.initial.line!.pick)} line right ${report.initial.line!.line.right}`,
      );
      assert.equal(report.initial.line!.attachGroup, true, "the attach control left its receipt group");
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

  const TOOL_RUN_REPORT = path.join(desktopRoot, "e2e/artifacts/tool-run.json");


  function runToolRunDriver(): Promise<number> {
    return new Promise((resolve, reject) => {
      execFile(
        electron,
        [path.join(desktopRoot, "e2e/tool-run.electron.mjs")],
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

  /** The open disclosure's geometry, as the run grew under it. */
  type GrowthSample = {
    missing: boolean;
    rows: number;
    rowLineHeight?: number | null;
    rowHeightMin?: number | null;
    rowHeightMax?: number | null;
    blockHeight?: number;
    blockClientHeight?: number;
    blockScrollHeight?: number;
    blockMaxHeight?: string | null;
    blockScrollTop?: number;
    boxTop?: number;
    boxBottom?: number;
    scrollbarWidth?: number;
    blockOverflowY?: string;
    body?: { clientHeight: number; scrollHeight: number; top: number; bottom: number } | null;
    lastRowTop?: number | null;
    lastRowBottom?: number | null;
    innerHeight?: number;
  };

  /** What scrolling the capped block to its own bottom did. */
  type ScrolledSample = {
    missing: boolean;
    scrollTop?: number;
    maxScrollTop?: number;
    lastRowTop?: number;
    lastRowBottom?: number;
    boxTop?: number;
    boxBottom?: number;
    inside?: boolean;
    insideTranscript?: boolean;
  };

  type ToolRunReport = {
    pass: boolean;
    failures: string[];
    calls: number;
    transcript: {
      rest: string[];
      afterSend: string[];
      afterCalls: string[];
      toolBubbles: number;
    };
    decode: {
      path: { name: string; target: string };
      query: { target: string };
      longCommand: { target: string };
      stringArgs: { target: string };
      nameOnly: { name: string; target: string };
      completion: { name: string; ok?: unknown };
    };
    line: {
      livePartiallySettled: string;
      settled: string;
      wholeRun: string;
      sameName: string;
    };
    disclosure: {
      collapsed: { tag: string; expanded: string; rows: number; caretOpen: boolean };
      opened: { expanded: string; rows: string[]; caretOpen: boolean };
    };
    thinking: { beforeTools: boolean; withActivity: boolean; nextTurn: boolean };
    /** What the one row carrying underscores + descenders actually painted. */
    rowInk: {
      missing?: boolean;
      rows?: string[];
      text?: string;
      boxHeight?: number;
      rowHeight?: number;
      lineHeight?: string;
      font?: string;
      glyphBox?: number;
      inkBox?: number;
      descender?: number;
      truncated?: boolean;
      inkTop?: number | null;
      inkBottom?: number | null;
      painted?: number;
      boxBottom?: number;
    };
    reset: {
      newTurnBlocks: number;
      switchedActivity: boolean;
      switchedTranscript: string[];
    };
    screenshots: string[];
    /** What the open disclosure did as the run grew past the cap, and what scrolling it did. */
    growth: {
      added: number;
      opened: GrowthSample;
      grown: GrowthSample;
      scrolled: ScrolledSample;
    };
  };

  /**
   * The tool-run rig drives the real ChatPanel in a real window, so it needs the
   * Vite dev server. With the server down the test skips; `npm run dev` in another
   * shell turns it on.
   */

  describe("tool run display", () => {
    it("stands a turn's tool calls in as one line, and opens on demand", async (t) => {
      if (!(await devServerUp())) {
        t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
        return;
      }

      fs.rmSync(TOOL_RUN_REPORT, { force: true });
      const exitCode = await runToolRunDriver();
      assert.equal(fs.existsSync(TOOL_RUN_REPORT), true, "driver wrote no report artifact");

      const report = JSON.parse(fs.readFileSync(TOOL_RUN_REPORT, "utf8")) as ToolRunReport;

      assert.deepEqual(report.failures, []);
      assert.equal(report.pass, true);
      assert.equal(exitCode, 0, "driver exited non-zero");

      // Restated here so the suite asserts the numbers, not only the driver: eight
      // calls must leave the transcript exactly as the send left it, and add no
      // tool pseudo-messages.
      assert.equal(report.calls, 8);
      assert.deepEqual(
        report.transcript.afterCalls,
        report.transcript.afterSend,
        "tool frames wrote into the transcript",
      );
      assert.equal(report.transcript.toolBubbles, 0, "tool pseudo-messages reappeared");

      // The line itself: one clause per category, present tense only while running.
      assert.match(report.line.livePartiallySettled, /, running npm run test -w @lifequest\/desktop$/);
      assert.equal(report.line.settled, "Explored 2 files, ran 1 command");
      assert.equal(
        report.line.wholeRun,
        "Edited 2 files, explored 2 files, ran 1 command, delegated Review the composer diff, used 2 tools",
      );
      assert.equal(report.line.sameName, "Exploring AGENTS.md, ran 2 commands");

      // Closed on arrival, one row per call once opened.
      assert.equal(report.disclosure.collapsed.tag, "BUTTON");
      assert.equal(report.disclosure.collapsed.expanded, "false");
      assert.equal(report.disclosure.collapsed.rows, 0);
      assert.equal(report.disclosure.collapsed.caretOpen, false);
      assert.equal(report.disclosure.opened.expanded, "true");
      assert.equal(report.disclosure.opened.rows.length, report.calls);
      assert.equal(report.disclosure.opened.rows[0], "read_file · AGENTS.md");
      assert.equal(
        report.disclosure.opened.rows[3],
        "mcp__lq__get_pq · gap_pqy.ts",
        "a bridged MCP name lost its underscores in the row",
      );

      // Every row is `overflow: hidden` so it can ellipsize — which also clips it
      // vertically: a line box shorter than the font's glyph box cuts the bottoms
      // off letters, so `p` reads as `n` and `_` disappears. The window's own
      // pixels are the only honest witness, so the row that carries both is
      // measured: how tall its box is against the font it is set in, and how much
      // of its ink box (descender and underscore included) it actually paints.
      assert.equal(
        report.rowInk.truncated,
        false,
        "the probe row was ellipsized, so its ink is not the whole story",
      );
      assert.ok(
        (report.rowInk.rowHeight ?? 0) >= (report.rowInk.glyphBox ?? 0) + 1,
        `the row box is ${report.rowInk.rowHeight}px for a ${report.rowInk.glyphBox}px glyph box ` +
          `(font ${report.rowInk.font}, line-height ${report.rowInk.lineHeight})`,
      );
      assert.ok(
        (report.rowInk.boxBottom ?? 0) - (report.rowInk.inkBottom ?? 0) >= 1,
        `the row's ink ends ${((report.rowInk.boxBottom ?? 0) - (report.rowInk.inkBottom ?? 0)).toFixed(2)}px ` +
          `from the clip edge — a descender at the edge is a descender lost`,
      );
      assert.ok(
        (report.rowInk.painted ?? 0) >= (report.rowInk.inkBox ?? 0) * 0.85,
        `the row painted ${report.rowInk.painted}px of its ${report.rowInk.inkBox}px ink box ` +
          `(font ${report.rowInk.font}, line-height ${report.rowInk.lineHeight})`,
      );

      // The block is bounded and scrolls, and no row gives up its line box to fit
      // inside it. Both halves are asserted because either can come undone alone:
      // drop the cap and the block (and so the transcript) grows without bound,
      // drop the row's `flex-shrink: 0` and the cap presses 16.5px rows into 3.6px
      // instead of scrolling them out of sight -- the defect as it was reported.
      assert.equal(
        report.growth.grown.rows,
        report.growth.opened.rows + report.growth.added,
        "the block did not gain a row per call",
      );
      assert.equal(
        report.growth.grown.blockOverflowY,
        "auto",
        "the block has a cap but does not scroll its own overflow",
      );
      assert.ok(
        (report.growth.grown.blockClientHeight ?? 0) <= parseFloat(report.growth.grown.blockMaxHeight ?? "") + 1,
        `the block grew to ${report.growth.grown.blockClientHeight}px against a ${report.growth.grown.blockMaxHeight} cap`,
      );
      assert.ok(
        (report.growth.grown.blockClientHeight ?? 0) <= 12 * (report.growth.grown.rowLineHeight ?? 0),
        `the cap is not a cap: ${report.growth.grown.blockClientHeight}px is more than a dozen ` +
          `${report.growth.grown.rowLineHeight}px lines`,
      );
      assert.ok(
        (report.growth.grown.blockScrollHeight ?? 0) > (report.growth.grown.blockClientHeight ?? 0) + 1,
        `the cap hid nothing to scroll: ${report.growth.grown.blockScrollHeight}px of rows in ${report.growth.grown.blockClientHeight}px`,
      );
      assert.ok(
        (report.growth.grown.rowHeightMin ?? 0) >= (report.growth.grown.rowLineHeight ?? 0) - 0.5,
        `a row squeezed to ${report.growth.grown.rowHeightMin}px in a ${report.growth.grown.rowLineHeight}px line box`,
      );
      assert.ok(
        (report.growth.grown.blockScrollTop ?? 0) > 0 &&
          (report.growth.grown.lastRowBottom ?? 0) <= (report.growth.grown.boxBottom ?? 0) + 1,
        `the block is capped but sits at ${report.growth.grown.blockScrollTop}px, so the newest row ` +
          `(${report.growth.grown.lastRowBottom}px) is below the block's ${report.growth.grown.boxBottom}px edge`,
      );
      assert.ok(
        report.growth.scrolled.inside === true && report.growth.scrolled.insideTranscript === true,
        `scrolling the block to ${report.growth.scrolled.scrollTop}px of ${report.growth.scrolled.maxScrollTop}px ` +
          `left the newest row at ${report.growth.scrolled.lastRowTop}-${report.growth.scrolled.lastRowBottom}, ` +
          `outside the block ${report.growth.scrolled.boxTop}-${report.growth.scrolled.boxBottom}`,
      );
      // The wire keys, asserted through the app's own decoder.
      assert.equal(report.decode.path.name, "read_file");
      assert.equal(report.decode.path.target, "AGENTS.md");
      assert.equal(report.decode.query.target, "composer");
      assert.equal(report.decode.longCommand.target.length, 48);
      assert.equal(report.decode.stringArgs.target, "ls -la");
      assert.equal(report.decode.nameOnly.name, "read_file");
      assert.equal(report.decode.completion.ok, undefined, "a completion claimed a status");

      // The live markers, and the two resets.
      assert.equal(report.thinking.beforeTools, true);
      assert.equal(report.thinking.withActivity, false);
      assert.equal(report.thinking.nextTurn, true);
      assert.equal(report.reset.newTurnBlocks, 0);
      assert.equal(report.reset.switchedActivity, false);
      assert.equal(
        report.reset.switchedTranscript.some((text) => text.includes("Loaded the other chat")),
        true,
        "the switch to another chat did not land",
      );
    });
  });

  const RECEIPT_REPORT = path.join(desktopRoot, "e2e/artifacts/receipt-attach.json");

  /**
   * Every scenario the receipt rig must report as passing. The names are the
   * rig's own, so a rig that quietly stops checking one is a failure here rather
   * than a shorter green run.
   */
  const RECEIPT_SCENARIOS = [
    "posts a row citing the stored receipt",
    "refuses a path escape",
    "refuses another domain's store",
    "refuses a path that is not on disk",
    "refuses a backslash path",
    "posts without a receipt",
    "one receipt backs two rows",
    "correction keeps the receipt",
    "undo leaves the file",
    "stores the original in the finance file store",
    "keeps a PNG as stored and copies it to the model as JPEG",
    "re-encodes a busy original under the copy ceiling",
    "refuses bytes that are not an image",
    "refuses an original over 25 MB",
    "refuses when the Finance kit is missing",
    "holds the prepared receipt for the turn that follows",
    "will not hand over a receipt it does not hold",
    "posts a text-only turn as a plain string",
    "posts a receipt turn as a text part and an image part",
    "names the stored path in the turn's instructions",
    "keeps a busy receipt turn under the body ceiling",
    "refuses a turn naming a receipt it does not hold",
    "shows a chip when a receipt is picked",
    "carries the stored path on the turn and clears the chip",
    "shows a chip when a receipt is dropped",
    "shows a chip when a receipt is pasted",
    "replaces the pending receipt rather than adding one",
    "sends no receipt once the chip is removed",
    "clears the pending receipt when the chat changes",
    "photographs the chip and the turn that carried it",
    "shows the refusal and keeps no chip",
  ];

  function runReceiptDriver(): Promise<number> {
    return new Promise((resolve, reject) => {
      execFile(
        electron,
        [path.join(desktopRoot, "e2e/receipt-attach.electron.mjs")],
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

  type ReceiptReport = {
    pass: boolean;
    failures: string[];
    scenarios: { name: string; pass: boolean; detail: string | null }[];
    fixture?: { path: string; bytes: number };
  };

  describe("receipt attach", () => {
    it("stores an original and cites it on the row it produces", async (t) => {
      if (!(await devServerUp())) {
        t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
        return;
      }

      fs.rmSync(RECEIPT_REPORT, { force: true });
      const exitCode = await runReceiptDriver();
      assert.equal(fs.existsSync(RECEIPT_REPORT), true, "driver wrote no report artifact");

      const report = JSON.parse(fs.readFileSync(RECEIPT_REPORT, "utf8")) as ReceiptReport;
      assert.equal(
        exitCode,
        0,
        `the receipt rig exited ${exitCode}: ${report.failures.join("; ")}`,
      );
      assert.equal(report.pass, true, `the rig reported failures: ${report.failures.join("; ")}`);

      const byName = new Map(report.scenarios.map((s) => [s.name, s]));
      for (const name of RECEIPT_SCENARIOS) {
        const scenario = byName.get(name);
        assert.ok(scenario, `the rig reported no scenario named "${name}"`);
        assert.equal(scenario.pass, true, `"${name}" failed: ${scenario.detail ?? "no detail"}`);
      }

      // The path the row cites has to be the store's own shape, not a path the
      // rig invented and the tool happened to accept.
      assert.match(
        report.fixture?.path ?? "",
        /^domains\/financial\/data\/files\/[0-9a-f-]{36}\/receipt\.jpg$/,
        `the fixture was stored at ${report.fixture?.path}`,
      );
    });
  });
});
