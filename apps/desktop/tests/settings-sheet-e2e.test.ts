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
const REPORT = path.join(desktopRoot, "e2e/artifacts/settings-sheet.json");
const ARTIFACT_SCREENSHOTS = [
  "settings-sheet-opened.png",
  "settings-sheet-search-theme.png",
  "settings-sheet-question-over-sheet.png",
  "settings-sheet-quick-menu-curated.png",
  "settings-sheet-quick-menu-empty.png",
  "settings-sheet-installed.png",
  "settings-sheet-quick-menu-after-reload.png",
];

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type NavRow = {
  label: string;
  match: string | null;
  active: boolean;
};

type ThemeRow = {
  name: string | null;
  label: string;
  active: boolean | null;
  starred: boolean | null;
};

type Sample = {
  path: string | null;
  viewport: { width: number; height: number };
  bodyOverflow: string;
  backgroundPage: boolean;
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
  search: {
    box: Box;
    bar: Box | null;
    radius: number | null;
    value: string;
    placeholder: string | null;
    label: string | null;
    focused: boolean;
  } | null;
  navBox: Box;
  chromeBox: Box | null;
  searchInputs: number;
  nav: NavRow[];
  navEmpty: string | null;
  panelView: string | null;
  panelTitle: string | null;
  themes: ThemeRow[];
  themeCount: number;
  starredNote: string | null;
  installed: { name: string | null; label: string }[];
  installInput: boolean;
  installError: string | null;
  installNotice: string | null;
  menuOpen: boolean;
  menu: { labels: string[]; empty: string | null; grid: Box | null } | null;
  question: {
    zIndex: string;
    box: Box | null;
    centreHit: string | null;
    focus: string | null;
  } | null;
  storedFavorites: string | null;
};

type Report = {
  url: string;
  window: { width: number; height: number };
  fixture: {
    starredSkin: string;
    sectionCount: number;
    installedTheme: { name: string; label: string };
  };
  states: Record<string, Sample>;
  steps: {
    openedClick?: boolean;
    clearedClick?: boolean;
    insidePressHit?: string;
    questionClick?: boolean;
    unstarredCount?: number;
    closedByScrimHit?: string;
    crossClick?: boolean;
    unstarredLast?: boolean;
    reStarred?: boolean;
    installPick?: boolean;
    brokenPick?: boolean;
    removeClick?: boolean;
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
      [path.join(desktopRoot, "e2e/settings-sheet.electron.mjs")],
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

describe("the settings sheet over the app", () => {
  it("takes its own measure over a blurred app, searches its own sections, and curates the quick menu's themes", async (t) => {
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
      opened,
      searchedVault,
      searchedTheme,
      searchedNone,
      cleared,
      insidePress,
      question,
      questionCancelled,
      closedByScrimPress,
      queryBeforeEscape,
      escapeCleared,
      closedByEscape,
      appearance,
      curatedOne,
      closedByCross,
      menuCurated,
      curatedNone,
      menuEmpty,
      restarred,
      installed,
      searchInstalled,
      installRefused,
      removed,
      menuAfterInstall,
      menuAfterReload,
    } = report.states;

    // 1 — the sheet is not up until it is opened, and the page underneath is the
    //     page it will be drawn over, not a blank shell.
    assert.equal(landing.overlay, null, "the sheet was open on arrival");
    assert.equal(landing.path, "/home", "the rig did not start on its page");
    assert.equal(landing.backgroundPage, true, "the page behind the sheet is missing");

    // 2 — the sheet's own 72rem measure, centred, over a blurred and dimmed
    //     app. At this rig's 1280px window that measure is ~90% wide, so the
    //     absolute width is asserted first: the panel is capped, not a share.
    assert.equal(report.steps.openedClick, true, "the rig could not open settings");
    const panel = opened.overlay?.panel;
    assert.ok(panel, "opening settings painted no panel");
    assert.equal(opened.path, "/settings", "opening settings did not change the route");
    assert.equal(
      opened.backgroundPage,
      true,
      "opening settings unmounted the page behind it — the backdrop blurs nothing",
    );
    assert.equal(opened.bodyOverflow, "hidden", "the page behind the sheet still scrolls");

    const widthShare = panel.box.width / opened.viewport.width;
    const heightShare = panel.box.height / opened.viewport.height;
    assert.ok(
      Math.abs(heightShare - 0.9) <= 0.02,
      `the panel is ${(heightShare * 100).toFixed(1)}% of the window's height, not ~90%`,
    );
    assert.ok(
      Math.abs(panel.box.width - 72 * 16) <= 1,
      `the settings panel is ${panel.box.width}px, not its 72rem measure — the sheet stretches with the window`,
    );
    assert.ok(
      widthShare <= 0.905,
      `the panel is ${(widthShare * 100).toFixed(1)}% of the window's width — wider than its measure`,
    );
    assert.ok(
      Math.abs(panel.box.left + panel.box.width / 2 - opened.viewport.width / 2) <= 2 &&
        Math.abs(panel.box.top + panel.box.height / 2 - opened.viewport.height / 2) <= 2,
      `the panel is not centred in the window: ${panel.box.left},${panel.box.top}`,
    );
    assert.ok(
      parseFloat(panel.radius) > 0,
      `the panel has square corners: radius "${panel.radius}"`,
    );

    const scrim = opened.overlay;
    assert.equal(scrim?.position, "fixed", "the scrim is not fixed over the window");
    // Above the studio's chrome (the rail paints at 20) and below the app's own
    // questions (`.confirm-dialog-backdrop` sits at 60): a settings action that
    // asks — deleting a domain — has to ask over the sheet, not behind it.
    assert.ok(
      Number(scrim?.zIndex) >= 20 && Number(scrim?.zIndex) < 60,
      `the scrim sits at z-index ${scrim?.zIndex}, outside the chrome-to-dialog band`,
    );
    assert.equal(scrim?.box.width, opened.viewport.width, "the scrim does not cover the width");
    assert.equal(scrim?.box.height, opened.viewport.height, "the scrim does not cover the height");
    assert.match(
      scrim?.backdropFilter ?? "",
      /blur\(/,
      `the app behind the sheet is not blurred: "${scrim?.backdropFilter}"`,
    );
    assert.ok(
      alphaOf(scrim?.background ?? null) > 0.15,
      `the scrim does not dim the app: ${scrim?.background}`,
    );

    // 3 — the cross is the sheet's top *right* control, and the search floats
    //     centred on the sheet's top border, clear of it.
    assert.ok(opened.close, "the sheet has no close control");
    assert.equal(opened.close?.label, "Close settings", "the close control is unlabelled");
    assert.ok(
      panel.box.right - opened.close.box.right <= 40 &&
        opened.close.box.top - panel.box.top <= 40,
      `the cross is not at the top right: ${opened.close.box.right},${opened.close.box.top} inside a panel ending at ${panel.box.right},${panel.box.top}`,
    );
    assert.ok(
      opened.close.box.left + opened.close.box.width / 2 >
        panel.box.left + panel.box.width / 2,
      "the cross sits on the leading half, not the trailing one",
    );

    assert.equal(opened.searchInputs, 1, "the sheet does not hold exactly one search field");
    assert.ok(opened.search, "the sheet has no search field");
    assert.equal(opened.search?.placeholder, "Search settings", "the search is unlabelled");
    assert.equal(opened.search?.focused, true, "opening the sheet did not focus the search");

    // 3b — the floating search: a short, pill-ended field centred over the
    //      panel, with the panel's top border running through its own horizontal
    //      axis (half in the sheet, half over the scrim). This is the Hermes
    //      Desktop shape the operator asked for; a full-width bar, a bar sitting
    //      entirely below the edge, or a box-cornered field all fail here.
    const bar = opened.search?.bar;
    assert.ok(bar, "the search field has no bar to measure");
    assert.ok(
      Math.abs(bar.width - 20 * 16) <= 1,
      `the search bar is ${bar.width}px wide, not its 20rem measure`,
    );
    assert.ok(
      bar.width < panel.box.width * 0.5,
      `the search bar is still a top bar: ${bar.width}px of a ${panel.box.width}px sheet`,
    );
    assert.ok(
      (opened.search?.radius ?? 0) >= bar.height / 2 - 1,
      `the search bar is not pill-ended: radius ${opened.search?.radius} for a ${bar.height}px bar`,
    );
    assert.ok(
      Math.abs(bar.left + bar.width / 2 - (panel.box.left + panel.box.width / 2)) <= 2,
      `the search bar is not centred over the sheet: ${bar.left + bar.width / 2} vs ${
        panel.box.left + panel.box.width / 2
      }`,
    );
    assert.ok(
      Math.abs(bar.top + bar.height / 2 - panel.box.top) <= 2,
      `the sheet's top border does not run through the search bar's axis: bar centre ${
        bar.top + bar.height / 2
      }, border ${panel.box.top}`,
    );
    assert.ok(
      bar.top < panel.box.top && bar.bottom > panel.box.top,
      `the search bar does not straddle the top border: ${bar.top}..${bar.bottom} vs ${panel.box.top}`,
    );
    assert.ok(
      bar.right <= opened.close.box.left,
      `the search bar does not end before the cross: ${bar.right} vs ${opened.close.box.left}`,
    );

    // 3c — no title band: the section column starts at the panel's own top edge,
    //      so the gap the operator saw between the floating search and the page
    //      (the strip that held only the cross) is gone.
    assert.ok(
      opened.navBox.top - panel.box.top <= 2,
      `there is a title band above the page: nav top ${opened.navBox.top}, panel top ${panel.box.top}`,
    );

    // 4 — a query narrows the section list and takes the panel with it.
    assert.deepEqual(
      searchedVault.nav.map((row) => row.label),
      ["Vault"],
      'searching "vault" did not narrow the sections to Vault',
    );
    assert.equal(searchedVault.nav[0].active, true, "the search left another section open");
    assert.equal(searchedVault.panelView, "vault", "the panel did not follow the search");

    assert.deepEqual(
      searchedTheme.nav.map((row) => row.label),
      ["Appearance"],
      "a theme name did not find the Appearance page",
    );
    assert.equal(
      searchedTheme.nav[0].match,
      "ember",
      "the row does not say which word it matched",
    );
    assert.equal(
      searchedTheme.panelView,
      "appearance",
      "the panel did not follow the theme name",
    );

    // 5 — no match is an empty list, not an empty sheet.
    assert.deepEqual(searchedNone.nav, [], "a query matching nothing listed sections");
    assert.match(searchedNone.navEmpty ?? "", /zzzz/, "the empty state does not name the query");
    assert.equal(
      searchedNone.panelView,
      "appearance",
      "a search with no match blanked the panel",
    );

    // 6 — clearing restores the whole sidebar.
    assert.equal(report.steps.clearedClick, true, "the clear control could not be pressed");
    assert.equal(cleared.search?.value, "", "the clear control left the query behind");
    assert.equal(
      cleared.nav.length,
      report.fixture.sectionCount,
      `clearing the search did not restore ${report.fixture.sectionCount} sections`,
    );
    assert.equal(cleared.navEmpty, null, "the empty state outlived the query");

    // 7 — a press on the frame is not a dismissal.
    assert.ok(insidePress.overlay, "a press on the panel's own search field closed the sheet");
    assert.match(
      insidePress.path ?? "",
      /^\/settings/,
      `a press inside the panel navigated away: ${insidePress.path}`,
    );

    // 8 — a question raised over the sheet asks above it, keeps the caret, and
    //     takes the Escape key before the sheet does.
    assert.equal(report.steps.questionClick, true, "the rig could not raise a question");
    assert.ok(question.question, "no confirm dialog over the sheet");
    assert.ok(
      Number(question.question?.zIndex) > Number(opened.overlay?.zIndex),
      `the question paints at z-index ${question.question?.zIndex}, the sheet at ${opened.overlay?.zIndex}`,
    );
    assert.match(
      question.question?.centreHit ?? "",
      /confirm-dialog/,
      `the sheet paints over the question: "${question.question?.centreHit}" is at the card's centre`,
    );
    assert.match(
      question.question?.focus ?? "",
      /confirm-dialog__cancel/,
      `the question does not hold the caret: "${question.question?.focus}"`,
    );
    assert.equal(questionCancelled.question, null, "Escape did not cancel the question");
    assert.ok(questionCancelled.overlay, "Escape closed the sheet behind the question");
    assert.match(
      questionCancelled.path ?? "",
      /^\/settings/,
      `cancelling the question navigated away: ${questionCancelled.path}`,
    );

    // 9 — a press on the scrim closes it, and hands the page back.
    assert.equal(
      report.steps.closedByScrimHit,
      "scrim",
      "the press outside did not land on the scrim",
    );
    assert.equal(closedByScrimPress.overlay, null, "the scrim did not close the sheet");
    assert.equal(closedByScrimPress.path, "/home", "closing did not return to the page behind");
    assert.equal(closedByScrimPress.backgroundPage, true, "closing lost the page behind");
    assert.notEqual(closedByScrimPress.bodyOverflow, "hidden", "closing left the page locked");

    // 10 — Escape clears a half-typed search first, and closes on the next press.
    assert.equal(queryBeforeEscape.search?.value, "vault", "the query was not typed");
    assert.ok(escapeCleared.overlay, "Escape closed the sheet without clearing the query");
    assert.equal(escapeCleared.search?.value, "", "Escape left the query in the field");
    assert.equal(
      escapeCleared.nav.length,
      report.fixture.sectionCount,
      "Escape cleared the field but not the filter",
    );
    assert.equal(closedByEscape.overlay, null, "the second Escape did not close the sheet");
    assert.equal(closedByEscape.path, "/home", "Escape did not return to the page behind");

    // 11 — every theme starts starred, so the quick menu opens on the full set.
    assert.equal(appearance.panelView, "appearance", "the nav press did not open Appearance");
    assert.ok(
      appearance.themeCount >= 5,
      `only ${appearance.themeCount} themes are offered`,
    );
    assert.equal(
      appearance.themes.every((theme) => theme.starred === true),
      true,
      `a theme is unstarred on a fresh install: ${JSON.stringify(
        appearance.themes.filter((theme) => theme.starred !== true),
      )}`,
    );
    assert.equal(
      appearance.storedFavorites,
      null,
      `a fresh install should not have written a curated list: ${appearance.storedFavorites}`,
    );
    assert.match(
      appearance.starredNote ?? "",
      new RegExp(`^${appearance.themeCount} of ${appearance.themeCount} themes are starred`),
      `the page does not say every theme is starred: "${appearance.starredNote}"`,
    );
    assert.deepEqual(appearance.installed, [], "a theme was installed before anything was picked");

    // 12 — unstarring the rest leaves one theme in the quick menu, and the star
    //      list becomes explicit storage.
    assert.equal(
      report.steps.unstarredCount,
      appearance.themeCount - 1,
      "the driver did not unstar the other themes",
    );
    assert.equal(
      curatedOne.themes.filter((theme) => theme.starred).length,
      1,
      "more than one theme is still starred",
    );
    assert.equal(
      curatedOne.themes.find((theme) => theme.name === "ember")?.starred,
      true,
      "the theme the driver kept is not the starred one",
    );
    assert.equal(
      curatedOne.storedFavorites,
      JSON.stringify(["ember"]),
      `curating did not write the star list: ${curatedOne.storedFavorites}`,
    );
    assert.match(
      curatedOne.starredNote ?? "",
      /^1 of \d+ themes is starred/,
      `the page does not say one theme is starred: "${curatedOne.starredNote}"`,
    );

    // 13 — the quick settings menu offers the starred list and nothing else.
    assert.equal(report.steps.crossClick, true, "the cross could not be pressed");
    assert.equal(closedByCross.overlay, null, "the cross did not close the sheet");
    assert.equal(closedByCross.path, "/home", "the cross did not return to the page behind");
    assert.equal(menuCurated.menuOpen, true, "the settings menu did not open");
    assert.deepEqual(
      menuCurated.menu?.labels,
      ["Ember"],
      `the quick menu offers more than the starred theme: ${JSON.stringify(menuCurated.menu?.labels)}`,
    );
    assert.equal(menuCurated.menu?.empty, null, "the quick menu shows an empty state and a tile");

    // 14 — with nothing starred the menu says so, and offers the way to fix it.
    assert.equal(report.steps.unstarredLast, true, "the last star could not be cleared");
    assert.equal(
      curatedNone.themes.every((theme) => theme.starred === false),
      true,
      "a theme is still starred after clearing the last one",
    );
    assert.equal(curatedNone.storedFavorites, "[]", "an empty star list was not written");
    assert.match(
      menuEmpty.menu?.empty ?? "",
      /No starred themes/,
      `the empty quick menu does not say why it is empty: "${menuEmpty.menu?.empty}"`,
    );
    assert.deepEqual(menuEmpty.menu?.labels, [], "the empty quick menu still offers themes");

    // 15 — installing a theme from a file: it lands in the grid, starred, and in
    //      the menu. The curated single star is kept.
    assert.equal(report.steps.reStarred, true, "the driver could not star Ember again");
    assert.equal(report.steps.installPick, true, "the driver could not pick a theme file");
    assert.equal(installed.installInput, true, "the Appearance page has no theme file input");
    assert.equal(
      installed.themeCount,
      appearance.themeCount + 1,
      "the installed theme did not join the grid",
    );
    const harbour = installed.themes.find(
      (theme) => theme.name === report.fixture.installedTheme.name,
    );
    assert.ok(harbour, "the installed theme is not in the grid");
    assert.equal(harbour?.label, report.fixture.installedTheme.label, "the tile wears another label");
    assert.equal(harbour?.starred, true, "an installed theme does not arrive starred");
    assert.deepEqual(
      installed.installed.map((item) => item.name),
      [report.fixture.installedTheme.name],
      "the installed list does not carry the new theme",
    );
    assert.match(
      installed.installNotice ?? "",
      new RegExp(`Installed “${report.fixture.installedTheme.label}”`),
      `installing said nothing: "${installed.installNotice}"`,
    );
    assert.equal(installed.installError, null, `installing reported an error: ${installed.installError}`);
    assert.equal(
      installed.storedFavorites,
      JSON.stringify(["ember", report.fixture.installedTheme.name]),
      `installing did not star the theme: ${installed.storedFavorites}`,
    );

    // 15b — the sheet's search knows the theme that was just installed.
    assert.deepEqual(
      searchInstalled.nav.map((row) => row.label),
      ["Appearance"],
      "an installed theme's name does not find the Appearance page",
    );
    assert.equal(
      searchInstalled.nav[0].match,
      report.fixture.installedTheme.label.toLowerCase(),
      `the row does not say which word the installed theme matched: ${searchInstalled.nav[0].match}`,
    );

    // 16 — a file that is not a theme is refused by field, and changes nothing.    assert.equal(report.steps.brokenPick, true, "the driver could not pick the broken file");
    assert.match(
      installRefused.installError ?? "",
      /colors\.foreground/,
      `the refusal does not name the field: "${installRefused.installError}"`,
    );
    assert.equal(
      installRefused.themeCount,
      installed.themeCount,
      "a refused file still added a theme",
    );
    assert.equal(
      installRefused.storedFavorites,
      installed.storedFavorites,
      "a refused file still wrote the star list",
    );

    // 17 — removing the installed theme takes it out of the grid, the list and
    //      the menu, and leaves the curated star alone.
    assert.equal(report.steps.removeClick, true, "the installed theme could not be removed");
    assert.equal(
      removed.themeCount,
      appearance.themeCount,
      "removing the installed theme left it in the grid",
    );
    assert.equal(
      removed.themes.some((theme) => theme.name === report.fixture.installedTheme.name),
      false,
      "the removed theme is still in the grid",
    );
    assert.deepEqual(removed.installed, [], "the installed list still carries the removed theme");
    assert.equal(
      removed.storedFavorites,
      JSON.stringify(["ember"]),
      `removing did not unstar the theme: ${removed.storedFavorites}`,
    );

    // 18 — the curated list is storage, not session state: the menu and the list
    //      both survive the window reloading.
    assert.deepEqual(
      menuAfterInstall.menu?.labels,
      ["Ember"],
      "the quick menu lost the curated theme after an install",
    );
    assert.equal(
      menuAfterReload.storedFavorites,
      JSON.stringify(["ember"]),
      "the curated list did not survive a reload",
    );
    assert.deepEqual(
      menuAfterReload.menu?.labels,
      ["Ember"],
      "the quick menu lost the curated theme across a reload",
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
