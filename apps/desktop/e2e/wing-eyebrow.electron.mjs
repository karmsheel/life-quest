/**
 * Drives the wing-eyebrow harness in a real Electron window and writes
 * `e2e/artifacts/wing-eyebrow.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/wing-eyebrow.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * What this rig claims:
 *
 *  1. Every page under every wing opens with the eyebrow convention: the wing
 *     it belongs to, a dot, then the page's own name — "Home · Dashboard",
 *     "Define · Dream", "Plan · Life Map", "Act · Task Manager",
 *     "Review · Daily".
 *  2. The eyebrow is drawn in capitals by CSS, not by the markup, and it sits
 *     above the page's own title.
 *  3. The wing a page belongs to is the wing the RAIL says it belongs to: the
 *     Images page is under Home (it moved from Define), and no Define page
 *     claims to be one.
 *  4. Personnel is renamed Agents, and the Act page is renamed Task Manager —
 *     in the rail and in the eyebrow.
 *  5. The five review cadences each carry their own name.
 *  6. No page under a wing is missing its eyebrow, and no page carries two.
 *
 * NOT covered here: the real vault. The IPC bridge is stubbed, so this rig
 * proves chrome and navigation — not that a page's data loads from disk.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/wing-eyebrow.html";
const SIZE = { width: 1280, height: 900 };

/**
 * Every wing page, and the eyebrow it must open with.
 *
 * The eyebrow is `wing · page`. The list is the claim: a page missing from it
 * is a page whose eyebrow the rig does not check, and a page in it with the
 * wrong text is a failure.
 */
const PAGES = [
  // Home
  { route: "/home", eyebrow: "Home · Dashboard", wing: "Home", heading: "Overview" },
  { route: "/data", eyebrow: "Home · Data", wing: "Home", heading: "Databases" },
  { route: "/pages", eyebrow: "Home · Pages", wing: "Home", heading: "Pages" },
  { route: "/documents", eyebrow: "Home · Documents", wing: "Home", heading: "Documents" },
  { route: "/personnel", eyebrow: "Home · Agents", wing: "Home", heading: "Agents" },
  { route: "/images", eyebrow: "Home · Images", wing: "Home", heading: "Images" },
  // Define
  { route: "/dream", eyebrow: "Define · Dream", wing: "Define", heading: "Dream" },
  { route: "/vision", eyebrow: "Define · Vision", wing: "Define", heading: "Vision" },
  { route: "/ideal-state", eyebrow: "Define · Ideal State", wing: "Define", heading: "Ideal State" },
  // Plan
  { route: "/goals", eyebrow: "Plan · Goals", wing: "Plan", heading: "Goals" },
  { route: "/chart", eyebrow: "Plan · Life Map", wing: "Plan", heading: "Life Map" },
  { route: "/track", eyebrow: "Plan · Architecture", wing: "Plan", heading: "Architecture" },
  // Act
  { route: "/projects", eyebrow: "Act · Projects", wing: "Act", heading: "Projects" },
  { route: "/daily", eyebrow: "Act · Daily Schedule", wing: "Act", heading: "Daily Schedule" },
  { route: "/act", eyebrow: "Act · Task Manager", wing: "Act", heading: "Overview" },
  // Review
  { route: "/review/daily", eyebrow: "Review · Daily", wing: "Review", heading: "Daily review" },
  { route: "/review/weekly", eyebrow: "Review · Weekly", wing: "Review", heading: "Weekly review" },
  { route: "/review/monthly", eyebrow: "Review · Monthly", wing: "Review", heading: "Monthly review" },
  { route: "/review/quarterly", eyebrow: "Review · Quarterly", wing: "Review", heading: "Quarterly review" },
  { route: "/review/yearly", eyebrow: "Review · Yearly", wing: "Review", heading: "Yearly review" },
];

/** The rail labels, per wing — the claim that Images moved to Home. */
const RAILS = {
  Home: ["Dashboard", "Data", "Pages", "Documents", "Agents", "Images"],
  Define: ["Dream", "Vision", "Ideal State"],
  Plan: ["Goals", "Life Map", "Architecture"],
  Act: ["Projects", "Daily Schedule", "Task Manager"],
  Review: ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"],
};

const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const page = document.querySelector("[data-page-context-root]");
  const root = page && page.firstElementChild;
  const eyebrows = root
    ? Array.from(root.querySelectorAll("[data-testid='wing-eyebrow']"))
    : [];
  const eyebrow = eyebrows[0] ?? null;
  const style = eyebrow ? getComputedStyle(eyebrow) : null;
  // The WING's own rows, not the whole rail: the rail also carries the
  // governed shelf (Quick Notes, Decisions, Daily Journal, Automations) and the
  // Log, and reading "the rail" without scoping would claim those belong to
  // the wing.
  const links = Array.from(
    document.querySelectorAll('[data-nav-group="wing"] .nav-rail__link'),
  ).map((a) => ({
    label: text(a.querySelector(".nav-rail__label")),
    href: a.getAttribute("href"),
    active: a.classList.contains("nav-rail__link--active"),
  }));
  const tabs = Array.from(
    document.querySelectorAll(".nav-rail__wings .ui-segmented__option"),
  ).map((b) => ({
    label: text(b),
    selected: b.getAttribute("aria-selected") === "true",
  }));
  const h1 = root ? root.querySelector("h1") : null;
  // The title's OWN text: the Dashboard's h1 also carries the board's state
  // badge, and "OverviewUnlocked" is not the page's name.
  const h1OwnText = h1
    ? Array.from(h1.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim()
    : null;
  const eyebrowRect = eyebrow ? eyebrow.getBoundingClientRect() : null;
  const h1Rect = h1 ? h1.getBoundingClientRect() : null;
  return {
    route: window.wingEyebrowRoute ?? null,
    eyebrow: eyebrow ? text(eyebrow) : null,
    eyebrowCount: eyebrows.length,
    eyebrowUpper: style ? style.textTransform : null,
    eyebrowWeight: style ? style.fontWeight : null,
    eyebrowSize: style ? style.fontSize : null,
    eyebrowLetterSpacing: style ? style.letterSpacing : null,
    eyebrowPage: eyebrow ? eyebrow.getAttribute("data-wing-page") : null,
    heading: h1OwnText,
    eyebrowAboveTitle:
      eyebrowRect && h1Rect ? eyebrowRect.bottom <= h1Rect.top + 1 : null,
    activeTab: (tabs.find((t) => t.selected) ?? {}).label ?? null,
    tabs,
    rail: links,
    // The WHOLE rail, wing rows and governed shelf alike — the claim that
    // Images left Define is about where a row sits, so the full list is what
    // answers it.
    allRail: Array.from(document.querySelectorAll(".nav-rail__link")).map((a) =>
      text(a.querySelector(".nav-rail__label")),
    ),
    // A page that shows an error banner has failed in a way a stub can hide
    // behind a rendered eyebrow — the banner is the page saying so.
    errorBanner: root
      ? text(root.querySelector(".form-error, [role='alert']"))
      : null,
    errors: window.wingEyebrowErrors ?? [],
  };
})()`;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const checks = {};
  const failures = [];
  const check = (name, ok, detail) => {
    checks[name] = ok ? "pass" : "fail";
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  };

  const win = new BrowserWindow({
    width: SIZE.width,
    height: SIZE.height,
    show: false,
    webPreferences: {
      preload: path.join(here, "..", "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  nativeTheme.themeSource = "dark";
  win.setContentSize(SIZE.width, SIZE.height);

  const js = (expression) => win.webContents.executeJavaScript(expression, true);
  const sample = () => js(SAMPLE);

  const waitFor = async (expression, label, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await js(expression);
        if (last) return true;
      } catch (error) {
        last = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    check(`wait: ${label}`, false, `never became true (last ${JSON.stringify(last)})`);
    return false;
  };

  const shoot = async (name) => {
    const file = path.join(artifactsDir, `wing-eyebrow-${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return file;
  };

  const screenshots = [];
  let report;
  const timeout = setTimeout(() => {
    console.error("wing-eyebrow: timed out after 180s");
    app.exit(1);
  }, 180_000);

  try {
    await win.loadURL(url);
    await waitFor("Boolean(window.wingEyebrowReady)", "wingEyebrowReady", 30_000);
    win.showInactive();

    const states = {};

    for (const page of PAGES) {
      // Move through the router, the way a click on a rail row does — the
      // rail only carries the ACTIVE wing's rows, so a page outside it has
      // no link to click, and the router's own navigate is the same code path
      // a click takes.
      await js(`window.wingEyebrowNavigate(${JSON.stringify(page.route)})`);
      await waitFor(
        `window.wingEyebrowRoute === ${JSON.stringify(page.route)}`,
        `route ${page.route}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));

      const state = await sample();
      states[page.route] = state;

      // The page proved it rendered — its own title is on screen.
      check(
        `${page.route} renders its own title`,
        state.heading === page.heading,
        `h1 read ${JSON.stringify(state.heading)}, expected ${JSON.stringify(page.heading)}`,
      );

      // The eyebrow says the wing, a dot, and the page's own name.
      check(
        `${page.route} eyebrow reads "${page.eyebrow}"`,
        state.eyebrow === page.eyebrow,
        `eyebrow read ${JSON.stringify(state.eyebrow)}`,
      );

      // Exactly one eyebrow — a page that doubled it reads right on the first.
      check(
        `${page.route} carries exactly one eyebrow`,
        state.eyebrowCount === 1,
        `found ${state.eyebrowCount}`,
      );

      // The capitals are the CSS's doing, and it sits above the title.
      check(
        `${page.route} eyebrow is drawn in capitals`,
        state.eyebrowUpper === "uppercase",
        `text-transform read ${JSON.stringify(state.eyebrowUpper)}`,
      );
      check(
        `${page.route} eyebrow sits above the title`,
        state.eyebrowAboveTitle === true,
        `eyebrow above title read ${JSON.stringify(state.eyebrowAboveTitle)}`,
      );

      // The wing the eyebrow names is the wing the rail has selected.
      check(
        `${page.route} belongs to the ${page.wing} wing`,
        state.activeTab === page.wing,
        `active wing tab read ${JSON.stringify(state.activeTab)}`,
      );

      // The rail under that wing carries exactly the rows the claim lists.
      check(
        `${page.route} ${page.wing} rail reads ${JSON.stringify(RAILS[page.wing])}`,
        same(
          state.rail.map((link) => link.label),
          RAILS[page.wing],
        ),
        `rail read ${JSON.stringify(state.rail.map((link) => link.label))}`,
      );

      check(
        `${page.route} rendered no error`,
        state.errors.length === 0 && state.errorBanner === null,
        `errors ${JSON.stringify(state.errors)}, banner ${JSON.stringify(state.errorBanner)}`,
      );
    }

    // The renames, read off the rail itself.
    const homeRail = states["/home"].rail.map((link) => link.label);
    check(
      "the Home rail says Agents, not Personnel",
      homeRail.includes("Agents") && !homeRail.includes("Personnel"),
      `rail read ${JSON.stringify(homeRail)}`,
    );
    const actRail = states["/act"].rail.map((link) => link.label);
    check(
      "the Act rail says Task Manager, not Act",
      actRail.includes("Task Manager") && !actRail.includes("Act"),
      `rail read ${JSON.stringify(actRail)}`,
    );
    check(
      "the Home rail carries Images",
      homeRail.includes("Images"),
      `rail read ${JSON.stringify(homeRail)}`,
    );
    const defineRail = states["/dream"].rail.map((link) => link.label);
    check(
      "the Define rail does not carry Images any more",
      !defineRail.includes("Images"),
      `rail read ${JSON.stringify(defineRail)}`,
    );
    // The row moved rather than being copied: it is in Home's list, and in no
    // other wing's. The sample visits six Home routes, so the wings are
    // counted, not the routes.
    const wingsCarryingImages = new Set(
      PAGES.filter((page) =>
        states[page.route].rail.some((link) => link.label === "Images"),
      ).map((page) => page.wing),
    );
    check(
      "Images is in exactly one wing's rail",
      wingsCarryingImages.size === 1 && wingsCarryingImages.has("Home"),
      `Images found under ${JSON.stringify([...wingsCarryingImages])}`,
    );

    // One picture per wing, so the artifact shows the convention on every
    // wing's own page rather than only the one the loop ended on.
    const SHOTS = [
      { name: "home", route: "/home" },
      { name: "define-dream", route: "/dream" },
      { name: "plan-goals", route: "/goals" },
      { name: "act-task-manager", route: "/act" },
      { name: "review-daily", route: "/review/daily" },
    ];
    for (const shot of SHOTS) {
      await js(`window.wingEyebrowNavigate(${JSON.stringify(shot.route)})`);
      await waitFor(
        `window.wingEyebrowRoute === ${JSON.stringify(shot.route)}`,
        `route ${shot.route}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      screenshots.push(await shoot(shot.name));
    }

    report = {
      pass: failures.length === 0,
      failures,
      checks,
      expectations: { PAGES, RAILS },
      states,
      screenshots,
    };
    fs.writeFileSync(
      path.join(artifactsDir, "wing-eyebrow.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `wing-eyebrow: ${failures.length === 0 ? "pass" : "FAIL"} (${Object.keys(checks).length} checks)`,
    );
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    app.exit(failures.length === 0 ? 0 : 1);
  } catch (error) {
    console.error("wing-eyebrow: driver failed", error);
    try {
      fs.writeFileSync(
        path.join(artifactsDir, "wing-eyebrow.json"),
        JSON.stringify(
          { pass: false, failures: [...failures, String(error)], checks, states: {} },
          null,
          2,
        ),
      );
    } catch {
      /* the report is best-effort */
    }
    app.exit(1);
  } finally {
    clearTimeout(timeout);
    win.destroy();
  }
}

app.whenReady().then(() => {
  main();
});
