import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;

/**
 * The Decisions inbox cards, as the operator sees them.
 *
 * The report this wraps is the operator's own: the inbox read flat, and the cards
 * wanted a surface of their own, a hover/slash shading effect, a bigger `Pending`
 * badge, and the domain badge beside that status. The rig renders the real sheet
 * and inbox in a real Electron window and measures the painted result — card vs
 * sheet background, the hover sweep's translateX under Chromium's own `:hover`,
 * the Pending pill's computed size, and the domain badge's text and geometry.
 *
 * It needs the Vite dev server, like every render rig: with no server up it skips.
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

type Box = { width: number; height: number; top: number; right: number; left: number };

type Chip = { text: string; slug: string; box: Box; fontSize: number };

type Card = {
  id: string;
  background: string;
  backgroundImage: string;
  borderTopColor: string;
  contrastVsSheet: number;
  channelDeltaVsSheet: number;
  channelDeltaVsCanvas: number;
  status: string;
  statusBox: Box | null;
  statusFontSize: number | null;
  kindBox: Box | null;
  kindFontSize: number | null;
  domains: Chip[];
  domainsImmediatelyBeforeStatus: boolean;
  hovered: boolean;
  slashOpacity: number;
  slashBackgroundImage: string;
  sheenTranslateX: number | null;
  padding: { top: number; right: number };
};

type Screen = {
  theme: string | null;
  sheet: { background: string } | null;
  activeTab: string | null;
  cards: Card[];
};

type Scenario = { name: string; pass: boolean; detail: string | null };

type Report = {
  pass: boolean;
  failures: string[];
  claims: string;
  checks: {
    scenarios: Scenario[];
    dark: Screen;
    light: Screen;
    history: Screen;
    rest: Card;
    hover: Card;
    restAgain: Card;
    screenshots: string[];
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  } & Record<string, unknown>;
};

const WANTED = [
  "the-card-wears-a-surface-different-from-its-sheet",
  "the-card-carries-a-diagonal-shading-wash",
  "the-slash-waits-off-the-card-at-rest",
  "hovering-really-lands-on-the-card",
  "hover-sweeps-the-slash-across-the-card",
  "hover-reveals-a-diagonal-slash-of-shading",
  "hover-shades-the-card-and-its-edge",
  "leaving-the-card-puts-the-shading-back",
  "the-pending-badge-is-larger-than-the-kind-chip",
  "the-pending-badge-keeps-the-top-right-corner",
  "a-domain-badge-sits-beside-the-pending-badge",
  "the-domain-badge-names-the-domain-not-its-slug",
  "a-domainless-decision-wears-no-domain-badge",
  "the-card-surface-holds-in-the-light-skin",
  "the-larger-pending-badge-holds-in-the-light-skin",
  "history-s-logged-card-wears-its-domain-badge",
  "the-page-asks-the-bridge-for-nothing-else",
  "the-page-logs-no-errors",
];

const card = (screen: Screen, id: string): Card => {
  const found = screen.cards.find((candidate) => candidate.id === id);
  assert.ok(found, `the rig drew no card ${id}`);
  return found;
};

describe("decisions inbox cards e2e", () => {
  it("draws its own card surface, a hover slash, a larger Pending badge and the domain badge", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      throw new Error("dev server down");
    }

    const driver = "decisions-cards";
    const reportPath = path.join(desktopRoot, `e2e/artifacts/${driver}.json`);
    fs.rmSync(reportPath, { force: true });
    const exitCode = await runDriver(driver);
    assert.equal(fs.existsSync(reportPath), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    const byName = new Map(report.checks.scenarios.map((scenario) => [scenario.name, scenario]));
    for (const name of WANTED) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig never ran the claim ${name}`);
      assert.equal(scenario.pass, true, `${name}: ${scenario.detail ?? ""}`);
    }

    // ── the surface, from the numbers rather than the claim strings ──────────
    const { dark, light } = report.checks;
    assert.equal(dark.cards.length, 3);
    assert.ok(dark.sheet, "the rig drew no sheet panel to measure against");
    for (const one of dark.cards) {
      assert.notEqual(one.background, dark.sheet.background, `${one.id} is the sheet's own colour`);
      assert.ok(
        one.contrastVsSheet >= 1.05,
        `${one.id}: card/sheet contrast ${one.contrastVsSheet} is below 1.05`,
      );
      assert.ok(
        one.channelDeltaVsSheet >= 6,
        `${one.id}: card/sheet channel distance ${one.channelDeltaVsSheet} is below 6`,
      );
      assert.ok(
        one.channelDeltaVsCanvas >= 5,
        `${one.id}: card/page channel distance ${one.channelDeltaVsCanvas} is below 5`,
      );
      assert.match(one.backgroundImage, /linear-gradient/);
    }
    assert.equal(light.theme, "light");
    assert.ok(light.sheet);
    for (const one of light.cards) {
      assert.notEqual(one.background, light.sheet.background);
      assert.ok(one.contrastVsSheet >= 1.05);
      assert.ok(one.channelDeltaVsSheet >= 6);
    }

    // ── the hover: off one edge at rest, off the other under the pointer ─────
    const { rest, hover, restAgain } = report.checks;
    assert.equal(rest.hovered, false);
    assert.ok((rest.sheenTranslateX ?? 0) < -100, `rest slash translateX ${rest.sheenTranslateX}`);
    assert.equal(rest.slashOpacity, 0, `the slash is already showing at rest (${rest.slashOpacity})`);
    assert.match(rest.slashBackgroundImage, /linear-gradient/);
    assert.equal(hover.hovered, true);
    assert.ok((hover.sheenTranslateX ?? 0) > 100, `hover slash translateX ${hover.sheenTranslateX}`);
    assert.ok(hover.slashOpacity >= 0.5, `hover slash opacity ${hover.slashOpacity}`);
    assert.match(hover.slashBackgroundImage, /linear-gradient/);
    assert.notEqual(hover.background, rest.background);
    assert.notEqual(hover.borderTopColor, rest.borderTopColor);
    assert.equal(restAgain.hovered, false);
    assert.equal(restAgain.background, rest.background);
    assert.equal(restAgain.borderTopColor, rest.borderTopColor);
    assert.equal(restAgain.slashOpacity, 0);
    assert.ok((restAgain.sheenTranslateX ?? 0) < -100);

    // ── the larger Pending badge, top right ─────────────────────────────────
    for (const one of dark.cards.filter((entry) => entry.status === "pending")) {
      assert.ok(one.statusBox, `${one.id} has no status pill`);
      assert.ok(one.kindBox, `${one.id} has no kind chip to compare against`);
      assert.ok((one.statusFontSize ?? 0) >= 13, `${one.id} pending font ${one.statusFontSize}px`);
      assert.ok(
        (one.statusFontSize ?? 0) >= (one.kindFontSize ?? 0) + 2,
        `${one.id} pending is not larger than its kind chip`,
      );
      assert.ok(
        one.statusBox.height >= (one.kindBox.height ?? 0) + 4,
        `${one.id} pending pill ${one.statusBox.height}px is not taller than the kind chip`,
      );
      assert.ok(
        one.statusBox.right <= one.statusBox.left + one.statusBox.width + 1,
        `${one.id}: impossible status box`,
      );
    }

    // ── the domain badge beside the pending pill ─────────────────────────────
    const financial = card(dark, "decision-financial");
    const health = card(dark, "decision-health");
    for (const [one, name, slug] of [
      [financial, "Financial", "financial"],
      [health, "Health", "health"],
    ] as const) {
      assert.equal(one.domains.length, 1, `${one.id} should wear exactly one domain badge`);
      const [badge] = one.domains;
      assert.equal(badge?.text, name);
      assert.equal(badge?.slug, slug);
      assert.notEqual(badge?.text, badge?.slug, "the badge is showing the slug, not the domain name");
      assert.equal(one.domainsImmediatelyBeforeStatus, true);
      assert.ok(one.statusBox);
      assert.ok(badge);
      const gap = one.statusBox.left - badge.box.left - badge.box.width;
      assert.ok(gap >= 0 && gap <= 14, `${one.id}: domain/status gap ${gap}px`);
      const chipCentre = badge.box.top + badge.box.height / 2;
      const statusCentre = one.statusBox.top + one.statusBox.height / 2;
      assert.ok(Math.abs(chipCentre - statusCentre) <= 2, `${one.id}: badges are not on one line`);
    }
    assert.equal(card(dark, "decision-pairing").domains.length, 0);

    // ── the logged card in History wears its domain too ─────────────────────
    assert.equal(report.checks.history.activeTab, "History");
    const manual = card(report.checks.history, "manual-1");
    assert.equal(manual.status, "Logged");
    assert.equal(manual.domains[0]?.text, "Financial");
    assert.equal(manual.domainsImmediatelyBeforeStatus, true);

    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    // ── the repeatable artifact: the pictures this run wrote ────────────────
    const artifactDir = path.join(desktopRoot, "e2e/artifacts");
    for (const name of ["decisions-cards-dark.png", "decisions-cards-hover.png", "decisions-cards-light.png", "decisions-cards-history.png"]) {
      assert.ok(report.checks.screenshots.includes(name), `the rig did not record ${name}`);
      const file = path.join(artifactDir, name);
      assert.equal(fs.existsSync(file), true, `missing artifact ${name}`);
      const size = fs.statSync(file).size;
      assert.ok(size > 20_000, `${name} is only ${size} bytes — not a painted screen`);
    }
  });
});
