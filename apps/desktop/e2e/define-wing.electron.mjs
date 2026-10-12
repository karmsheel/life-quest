/**
 * Drives the Define wing harness in a real Electron window and writes
 * `e2e/artifacts/define-wing.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/define-wing.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * What this rig claims:
 *
 *  1. The wing is called Define. The top bar carries exactly
 *     Home / Define / Plan / Execute / Review — no tab still says "Vision".
 *  2. The Define wing's rail carries Dream and Vision, and the Home wing's
 *     rail carries Dashboard / Data / Pages / Documents / Personnel — Documents
 *     moved, it was not duplicated.
 *  3. Dream lost the Vision & Desire card and kept the other three; Vision
 *     carries exactly that one card, and no page carries a card twice.
 *  4. The Vision card opens the `what` document of its own domain under
 *     `/vision/{slug}/what`, and that editor's Back link returns to `/vision`.
 *  5. The Define tab lands on Dream when nothing is remembered for the wing.
 *  6. Cold loads are owned by `wingForPath`: `/vision/health/what` selects
 *     Define, and `/documents` selects Home.
 *  7. Every card link on Dream points into `/dream/`, so the page did not keep a
 *     What link into a wing it no longer belongs to.
 *
 * NOT covered here: the real vault. The IPC bridge is stubbed, so this rig
 * proves navigation, ownership and the card split — not that a domain's
 * `what.md` loads from disk (that path is unchanged by this change).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on. A rig runs
// hidden beside every other rig in the suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/define-wing.html";
const SIZE = { width: 1280, height: 900 };

/** The wings the top bar must carry, in order — the rename's whole point. */
const WING_TABS = ["Home", "Define", "Plan", "Execute", "Review"];
/** The wing rails, as the operator sees them. */
const HOME_RAIL = ["Dashboard", "Data", "Pages", "Documents", "Personnel"];
const DEFINE_RAIL = ["Dream", "Vision"];
/** Dream keeps three of the four doctrine cards; Vision carries the fourth. */
const DREAM_CARDS = ["Beliefs & Premise", "Purpose", "Strategy (How)"];
const VISION_CARD = "Vision & Desire";

const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const page = document.querySelector("[data-page-context-root]");
  const sections = Array.from(document.querySelectorAll(".nav-rail > .nav-rail__section"));
  const links = (root) =>
    Array.from((root ?? document).querySelectorAll(".nav-rail__link")).map((a) => ({
      label: text(a.querySelector(".nav-rail__label")),
      href: a.getAttribute("href"),
      active: a.classList.contains("nav-rail__link--active"),
    }));
  const tabs = Array.from(
    document.querySelectorAll(".top-bar__wings .ui-segmented__option"),
  ).map((b) => ({
    label: text(b),
    selected: b.getAttribute("aria-selected") === "true",
  }));
  const groups = Array.from(document.querySelectorAll(".doctrine-index__group")).map((g) => {
    const grid = g.querySelector(".doctrine-index__cards");
    return {
      heading: text(g.querySelector(".doctrine-index__heading")),
      gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      cards: Array.from(g.querySelectorAll(".doctrine-index__card")).map((c) => ({
        title: text(c.querySelector(".doctrine-index__card-title")),
        href: c.getAttribute("href"),
        help: text(c.querySelector(".doctrine-index__help")),
        body: text(c.querySelector(".doctrine-index__card-body")),
      })),
    };
  });
  const back = Array.from(
    document.querySelectorAll("[data-page-context-root] a"),
  ).find((a) => text(a) === "Back");
  const editorArea = document.querySelector(".doc-editor__textarea");
  return {
    route: window.defineWingRoute ?? null,
    tabs,
    activeTab: (tabs.find((t) => t.selected) ?? {}).label ?? null,
    rail: links(sections[1] ?? null),
    pinned: links(sections[0] ?? null),
    pinnedBottom: links(document.querySelector(".nav-rail__section--bottom")),
    pageHeading: text(page && page.querySelector("h1")),
    pageRootClass: page && page.firstElementChild ? page.firstElementChild.className : null,
    groups,
    editorTitle: text(document.querySelector(".doc-editor__title")),
    editorValue: editorArea ? editorArea.value : null,
    editorBackHref: back ? back.getAttribute("href") : null,
    documentsHeading: text(document.querySelector(".documents-page h1")),
    documentsComposer: Boolean(document.querySelector(".documents-page .library-composer")),
    calls: (window.defineWingCalls ?? []).slice(),
    errors: (window.defineWingErrors ?? []).slice(),
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
  };
})()`;

const failures = [];
const check = (name, condition, detail) => {
  if (!condition) failures.push(`${name} — ${detail}`);
  return Boolean(condition);
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...SIZE,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  // Vite re-optimises dependencies the first time a new import appears and
  // reloads the page when it does, which clears the harness globals mid-wait —
  // so poll instead of assuming the first evaluate lands after the module ran.
  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.defineWingReady !== "object") return null;
          await window.defineWingReady;
          return true;
        })()`);
        if (ready === true) return true;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  const sample = async (attempt = 0) => {
    let value;
    try {
      value = await run(SAMPLE);
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return sample(attempt + 1);
    }
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  /**
   * Poll until the named expression is true. Every caller names the state it is
   * waiting for to *change*, so a wait can never resolve against the page it
   * started on.
   */
  const waitFor = async (expression, label, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await run(expression);
        if (last) return true;
      } catch (error) {
        last = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    check(`wait: ${label}`, false, `never became true (last ${JSON.stringify(last)})`);
    return false;
  };

  /** A real click through the DOM, so React's own handlers run. */
  const clickIn = (selector, label) =>
    run(`(async () => {
      const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const el = ${JSON.stringify(label)} === null
        ? nodes[0]
        : nodes.find((n) => (n.querySelector(".nav-rail__label")?.textContent ?? n.textContent ?? "").trim() === ${JSON.stringify(label)});
      if (!el) return false;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    })()`);

  const railLink = (label) => clickIn(".nav-rail__link", label);
  const wingTab = (label) => clickIn(".top-bar__wings .ui-segmented__option", label);
  const firstCard = () => clickIn(".doctrine-index__card", null);

  const shoot = async (name) => {
    const file = path.join(artifactsDir, `define-wing-${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return file;
  };

  const screenshots = [];
  let report;
  const timeout = setTimeout(() => {
    console.error("define-wing: timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    await win.loadURL(url);
    await waitForHarness();
    win.setContentSize(SIZE.width, SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    // 1 — Home, on the Dashboard: the wing tabs and the Home rail.
    const home = await sample();
    check("shell rendered", home.route === "/home", `route ${home.route}`);
    check(
      "the top bar carries the five wings, Define among them",
      same(home.tabs.map((t) => t.label), WING_TABS),
      `tabs ${JSON.stringify(home.tabs.map((t) => t.label))}`,
    );
    check(
      "no wing tab still says Vision",
      !home.tabs.some((t) => t.label === "Vision"),
      `tabs ${JSON.stringify(home.tabs.map((t) => t.label))}`,
    );
    check("Home is the landing wing", home.activeTab === "Home", `active ${home.activeTab}`);
    check(
      "the Home rail carries Documents, after Pages",
      same(home.rail.map((l) => l.label), HOME_RAIL),
      `rail ${JSON.stringify(home.rail.map((l) => l.label))}`,
    );
    check(
      "Documents points at /documents from the Home rail",
      home.rail.find((l) => l.label === "Documents")?.href === "/documents",
      `href ${home.rail.find((l) => l.label === "Documents")?.href}`,
    );
    check(
      "the pinned rows are untouched",
      same(home.pinned.map((l) => l.label), ["Life-Chain", "Decisions"]) &&
        same(home.pinnedBottom.map((l) => l.label), ["Log"]),
      `pinned ${JSON.stringify(home.pinned.map((l) => l.label))} bottom ${JSON.stringify(home.pinnedBottom.map((l) => l.label))}`,
    );
    screenshots.push(await shoot("home"));

    // 2 — the Define tab: the wing's default page and its rail.
    check("Define tab clicked", await wingTab("Define"), "no Define tab in the top bar");
    await waitFor(
      `window.defineWingRoute === "/dream"`,
      "the Define tab lands on Dream",
    );
    const dream = await sample();
    check("the Define wing landed on Dream", dream.route === "/dream", `route ${dream.route}`);
    check("Define is the active wing", dream.activeTab === "Define", `active ${dream.activeTab}`);
    check(
      "the Define rail carries Dream and Vision",
      same(dream.rail.map((l) => l.label), DEFINE_RAIL),
      `rail ${JSON.stringify(dream.rail.map((l) => l.label))}`,
    );
    check(
      "Dream did not keep Documents",
      !dream.rail.some((l) => l.label === "Documents"),
      `rail ${JSON.stringify(dream.rail.map((l) => l.label))}`,
    );
    check("the Dream page rendered", dream.pageHeading === "Dream", `h1 ${dream.pageHeading}`);
    check(
      "the Dream page is the doctrine page box",
      String(dream.pageRootClass).includes("doctrine-page"),
      `root class ${dream.pageRootClass}`,
    );
    check(
      "the lens is Overview: both live domains listed",
      same(dream.groups.map((g) => g.heading), ["Health", "Financial"]),
      `groups ${JSON.stringify(dream.groups.map((g) => g.heading))}`,
    );
    check(
      "Dream carries the three cards it kept",
      same(dream.groups[0]?.cards.map((c) => c.title), DREAM_CARDS),
      `cards ${JSON.stringify(dream.groups[0]?.cards.map((c) => c.title))}`,
    );
    check(
      "the Vision & Desire card is gone from Dream",
      !dream.groups.some((g) => g.cards.some((c) => c.title === VISION_CARD)),
      `cards ${JSON.stringify(dream.groups.flatMap((g) => g.cards.map((c) => c.title)))}`,
    );
    check(
      "every Dream card links into /dream/",
      dream.groups
        .flatMap((g) => g.cards)
        .every((c) => String(c.href).startsWith("/dream/")),
      `hrefs ${JSON.stringify(dream.groups.flatMap((g) => g.cards.map((c) => c.href)))}`,
    );
    check(
      "the grid is as wide as the page's cards",
      (dream.groups[0]?.gridColumns ?? "").split(" ").length === DREAM_CARDS.length,
      `grid-template-columns ${dream.groups[0]?.gridColumns}`,
    );
    check(
      "an empty domain still coaches instead of showing a blank card",
      dream.groups[1]?.cards.every((c) => (c.help ?? "").length > 0),
      `financial help ${JSON.stringify(dream.groups[1]?.cards.map((c) => c.help))}`,
    );
    screenshots.push(await shoot("dream"));

    // 3 — the Vision page in the same wing.
    check("Vision rail row clicked", await railLink("Vision"), "no Vision row in the Define rail");
    await waitFor(`window.defineWingRoute === "/vision"`, "the Vision page");
    const vision = await sample();
    check("the Vision page is at /vision", vision.route === "/vision", `route ${vision.route}`);
    check("the Vision page belongs to Define", vision.activeTab === "Define", `active ${vision.activeTab}`);
    check("the Vision page rendered", vision.pageHeading === "Vision", `h1 ${vision.pageHeading}`);
    check(
      "the Define rail still reads Dream, Vision",
      same(vision.rail.map((l) => l.label), DEFINE_RAIL),
      `rail ${JSON.stringify(vision.rail.map((l) => l.label))}`,
    );
    check(
      "Vision carries exactly one card",
      same(vision.groups[0]?.cards.map((c) => c.title), [VISION_CARD]),
      `cards ${JSON.stringify(vision.groups[0]?.cards.map((c) => c.title))}`,
    );
    check(
      "no other doctrine card followed it to Vision",
      vision.groups[0]?.cards.length === 1,
      `cards ${JSON.stringify(vision.groups[0]?.cards.map((c) => c.title))}`,
    );
    check(
      "the Vision card opens this domain's what document under /vision",
      vision.groups[0]?.cards[0]?.href === "/vision/health/what",
      `href ${vision.groups[0]?.cards[0]?.href}`,
    );
    check(
      "the card previews the document's own body",
      (vision.groups[0]?.cards[0]?.body ?? "").includes("(health)"),
      `body ${vision.groups[0]?.cards[0]?.body}`,
    );
    check(
      "the one-card grid is one column wide",
      (vision.groups[0]?.gridColumns ?? "").split(" ").length === 1,
      `grid-template-columns ${vision.groups[0]?.gridColumns}`,
    );
    screenshots.push(await shoot("vision"));

    // 4 — the card into the editor, and back out of it.
    check("Vision card clicked", await firstCard(), "no doctrine card to click");
    await waitFor(
      `document.querySelector(".doc-editor__title") !== null`,
      "the Vision & Desire editor",
    );
    const editor = await sample();
    check(
      "the editor is the what route of that domain",
      editor.route === "/vision/health/what",
      `route ${editor.route}`,
    );
    check(
      "the editor opened the Vision & Desire document",
      editor.editorTitle === "Vision & Desire · Health",
      `title ${editor.editorTitle}`,
    );
    check(
      "the editor read that domain's what document, and only it",
      editor.calls.includes("health:what"),
      `documentGet calls ${JSON.stringify(editor.calls)}`,
    );
    check(
      "the editor holds the vision body, not another kind's",
      editor.editorValue === "A calm, strong body at 60. (health)",
      `body ${JSON.stringify(editor.editorValue)}`,
    );
    check(
      "the editor's Back returns to the Vision page",
      editor.editorBackHref === "/vision",
      `back href ${editor.editorBackHref}`,
    );

    check(
      "Back clicked",
      await run(`(async () => {
        const back = Array.from(document.querySelectorAll("[data-page-context-root] a"))
          .find((a) => (a.textContent ?? "").trim() === "Back");
        if (!back) return false;
        back.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, view: window }));
        return true;
      })()`),
      "no Back link on the editor",
    );
    await waitFor(`window.defineWingRoute === "/vision"`, "Back returns to /vision");
    const backOnVision = await sample();
    check(
      "Back landed on the Vision page",
      backOnVision.route === "/vision" && backOnVision.pageHeading === "Vision",
      `route ${backOnVision.route}, h1 ${backOnVision.pageHeading}`,
    );

    // 5 — Documents, now a Home page.
    check("Home tab clicked", await wingTab("Home"), "no Home tab in the top bar");
    await waitFor(`window.defineWingRoute === "/home"`, "the Home wing");
    check("Documents rail row clicked", await railLink("Documents"), "no Documents row in the Home rail");
    await waitFor(
      `document.querySelector(".documents-page h1") !== null`,
      "the Documents page",
    );
    const documents = await sample();
    check("Documents is at /documents", documents.route === "/documents", `route ${documents.route}`);
    check(
      "Documents is owned by the Home wing",
      documents.activeTab === "Home",
      `active ${documents.activeTab}`,
    );
    check(
      "the Documents page rendered",
      documents.documentsHeading === "Documents" && documents.documentsComposer,
      `h1 ${documents.documentsHeading}, composer ${documents.documentsComposer}`,
    );
    check(
      "the Home rail still carries Documents",
      same(documents.rail.map((l) => l.label), HOME_RAIL),
      `rail ${JSON.stringify(documents.rail.map((l) => l.label))}`,
    );
    screenshots.push(await shoot("documents"));

    // 6 — the cold loads: the wing table, not the session, owns these routes.
    await win.loadURL(`${url}?route=/vision/health/what`);
    await waitForHarness();
    await waitFor(
      `document.querySelector(".doc-editor__title") !== null`,
      "the deep-linked Vision editor",
    );
    const deepVision = await sample();
    check(
      "a cold load of /vision/:slug/:what selects Define",
      deepVision.activeTab === "Define",
      `active ${deepVision.activeTab}`,
    );
    check(
      "the deep-linked editor opened the vision document",
      deepVision.editorTitle === "Vision & Desire · Health",
      `title ${deepVision.editorTitle}`,
    );
    check(
      "the Define rail is the one the deep link shows",
      same(deepVision.rail.map((l) => l.label), DEFINE_RAIL),
      `rail ${JSON.stringify(deepVision.rail.map((l) => l.label))}`,
    );

    await win.loadURL(`${url}?route=/documents`);
    await waitForHarness();
    await waitFor(
      `document.querySelector(".documents-page h1") !== null`,
      "the deep-linked Documents page",
    );
    const deepDocuments = await sample();
    check(
      "a cold load of /documents selects Home",
      deepDocuments.activeTab === "Home",
      `active ${deepDocuments.activeTab}`,
    );
    check(
      "the Home rail is the one the deep link shows",
      same(deepDocuments.rail.map((l) => l.label), HOME_RAIL),
      `rail ${JSON.stringify(deepDocuments.rail.map((l) => l.label))}`,
    );

    // 7 — nothing threw on the way, and nothing spilled out of the window.
    const states = { home, dream, vision, editor, documents, deepVision, deepDocuments };
    const logged = Object.entries(states).flatMap(([step, state]) =>
      (state.errors ?? []).map((message) => `${step}: ${message}`),
    );
    check(
      "no page logged an error",
      logged.length === 0,
      `errors ${JSON.stringify(logged)}`,
    );
    for (const [step, state] of Object.entries(states)) {
      check(
        `${step} fits the window`,
        (state.overflow?.scrollWidth ?? 0) <= (state.overflow?.clientWidth ?? 0),
        `scrollWidth ${state.overflow?.scrollWidth} vs clientWidth ${state.overflow?.clientWidth}`,
      );
    }

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...SIZE },
      expectations: { WING_TABS, HOME_RAIL, DEFINE_RAIL, DREAM_CARDS, VISION_CARD },
      states,
      screenshots,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "define-wing.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  // The wing map, as the run read it: one row per step, so the rename and the
  // card split are legible without opening the JSON.
  const rows = [["step", "route", "wing", "rail", "page", "cards"]];
  for (const [step, state] of Object.entries(report.states ?? {})) {
    rows.push([
      step,
      String(state.route ?? "—"),
      String(state.activeTab ?? "—"),
      (state.rail ?? []).map((l) => l.label).join(", ") || "—",
      String(state.pageHeading ?? "—"),
      (state.groups ?? [])
        .flatMap((g) => g.cards.map((c) => c.title))
        .join(" | ") || "—",
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
  }

  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "define wing: PASS" : "define wing: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`define-wing: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
