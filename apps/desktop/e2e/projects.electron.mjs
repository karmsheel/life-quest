/**
 * Drives Projects on the Execute wing in a real Electron window and turns what
 * the shipped pages actually render into `e2e/artifacts/projects.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/projects.electron.mjs
 *
 * Exit code 0 = every claim held. The JSON report and the screenshots are the
 * repeatable artifact; the test file `tests/projects-e2e.test.ts` refuses a
 * report that does not hold.
 *
 * The rig mounts the real `AppShell` (real `NavRail`, `TopBar`, `WingTabs`,
 * `WingProvider`/`wingForPath`) with the real `ProjectsPage` and `ProjectPage` on
 * their routes, against a recording stub vault. The claims, and what makes each
 * falsifiable:
 *
 *  1. `rail-execute` — a cold load of `/projects` selects Execute, and the rail's
 *     wing group reads Projects, Daily Schedule, Act with Projects active. This
 *     is the move from Plan to Execute, read off the shipped rail.
 *  2. `rail-plan` / `wing-switch` — clicking Plan shows Goals, Life Map,
 *     Architecture and NOT Projects; clicking Execute lands back on `/projects`
 *     with the Projects row active. The route is the wing's own.
 *  3. `list-attributes` / `list-count` — every built-in attribute a row is
 *     specified to show is on the row: state note, status chip, priority, goal,
 *     domain, target date, next action and percent.
 *  4. `list-filter` — the status filter narrows the register, and "All" restores
 *     it.
 *  5. `detail-header` — the detail page's header carries title, status, summary,
 *     goal, domain, priority, dates, state note, next action and percent.
 *  6. `detail-progress` — the progress timeline is read newest-first from the
 *     file's own `updates`.
 *  7. `detail-context` — the context document is the project's markdown body,
 *     shown in the shared live markdown editor.
 *  8. `detail-collated` — tasks linked by `links.projectId`, the signals reached
 *     through those tasks, the Decisions whose project target names this id, and
 *     the project's log lines are all gathered on the page.
 *  9. `log-progress` — typing a note and moving the percent then pressing "Log
 *     progress" writes through the page's own `projectsUpdate` call with
 *     `{ progress, addUpdate }`, and the percent and timeline change on screen.
 * 10. `no-overflow` — neither page paints sideways at the app's sheet width.
 *
 * NOT covered here: disk persistence (the tools rig covers the write path), and
 * the parts of the shell this feature does not touch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/projects.html";

const SIZE = { width: 1280, height: 1000 };
/** The detail page is long; a taller capture shows the header and the timeline. */
const DETAIL_SIZE = { width: 1280, height: 1180 };

const WING_TABS = ["Home", "Define", "Plan", "Execute", "Review"];
const EXECUTE_RAIL = ["Projects", "Daily Schedule", "Act"];
const PLAN_RAIL = ["Goals", "Life Map", "Architecture"];
const LIST_ORDER = ["p-exec", "p-paused", "p-closed", "p-trip"];

const SHOTS = {
  list: path.join(artifactsDir, "projects.png"),
  wing: path.join(artifactsDir, "projects-execute-wing.png"),
  detail: path.join(artifactsDir, "projects-detail.png"),
  modal: path.join(artifactsDir, "projects-new-modal.png"),
};

const errors = [];
const scenarios = [];

function failure(message) {
  errors.push(message);
  return message;
}

function check(name, pass, detail) {
  scenarios.push({ name, pass: Boolean(pass), detail: detail ?? null });
  if (!pass) failure(`${name}: ${detail ?? "failed"}`);
  return Boolean(pass);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Everything the rig reads off the committed page: the shell, the register, the
 * project page and the bridge transcript. Selectors are the shipped classes and
 * `data-testid`s, so a page that stops drawing a claimed thing stops answering.
 */
const SAMPLE = `(() => {
  const round = (n) => Math.round(n * 10) / 10;
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const attr = (el, name) => (el ? el.getAttribute(name) : null);
  const value = (el) => (el && typeof el.value === "string" ? el.value : null);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: round(r.left),
      top: round(r.top),
      right: round(r.right),
      bottom: round(r.bottom),
      width: round(r.width),
      height: round(r.height),
      centerX: round(r.left + r.width / 2),
      centerY: round(r.top + r.height / 2),
    };
  };
  const byTestId = (id) => document.querySelector('[data-testid="' + id + '"]');
  const page = document.querySelector("[data-page-context-root]");
  const links = (group) =>
    Array.from(document.querySelectorAll('[data-nav-group="' + group + '"] .nav-rail__link')).map((a) => ({
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

  const rows = Array.from(document.querySelectorAll('[data-testid="project-row"]')).map((row) => {
    const meta = Array.from(row.querySelectorAll(".projects-row__meta > span")).map(text);
    return {
      id: row.dataset.projectId ?? null,
      statusAttr: row.dataset.status ?? null,
      title: text(row.querySelector(".projects-row__title")),
      status: text(row.querySelector(".projects-chip")),
      statusClass: row.querySelector(".projects-chip")?.className ?? null,
      priority: text(row.querySelector(".projects-row__priority")),
      summary: text(row.querySelector(".projects-row__summary")),
      meta,
      goal: meta[0] ?? null,
      domain: meta[1] ?? null,
      target: meta.find((line) => (line ?? "").startsWith("Target")) ?? null,
      next: text(row.querySelector(".projects-row__next")),
      progress: text(row.querySelector(".projects-progress__value")),
      href: row.getAttribute("href"),
    };
  });

  const timeline = Array.from(document.querySelectorAll('[data-testid="project-update-row"]')).map((row) => ({
    when: text(row.querySelector("time")),
    dateTime: attr(row.querySelector("time"), "datetime"),
    note: text(row.querySelector(".project-detail__timeline-note")),
    progress: text(row.querySelector(".projects-chip--progress")),
    actor: text(row.querySelector(".project-detail__actor")),
  }));

  const collated = (id) =>
    Array.from(document.querySelectorAll('[data-testid="' + id + '"] .act-activity-row')).map((row) => ({
      type: text(row.querySelector(".act-activity-row__type")),
      summary: text(row.querySelector(".act-activity-row__summary")),
    }));

  const details = byTestId("project-details")
    ? {
        title: value(byTestId("project-detail-title")),
        summary: value(byTestId("project-detail-summary")),
        status: value(byTestId("project-detail-status")),
        priority: value(byTestId("project-detail-priority")),
        goal: value(byTestId("project-detail-goal")),
        domain: value(byTestId("project-detail-domain")),
        start: value(byTestId("project-detail-start")),
        target: value(byTestId("project-detail-target")),
      }
    : null;

  const content = document.querySelector(".shell__content");
  const detail = byTestId("project-detail");
  const newButton = byTestId("project-new");
  const heading = page && page.querySelector(".act-page__title");
  const header = page && page.querySelector(".act-page__header");
  const dialog = byTestId("project-create-modal");
  const backdrop = byTestId("project-create-backdrop");
  const form = byTestId("project-create");
  const labelledBy = dialog ? attr(dialog, "aria-labelledby") : null;

  return {
    route: window.projectsHarnessRoute ?? null,
    tabs,
    activeTab: (tabs.find((t) => t.selected) ?? {}).label ?? null,
    rail: links("wing"),
    pinned: links("governance"),
    footer: links("footer"),
    pageHeading: text(page && page.querySelector("h1")),
    eyebrow: text(page && page.querySelector(".act-page__eyebrow")),
    count: text(page && page.querySelector(".projects-page__count")),
    headingRect: rect(heading),
    headerRect: rect(header),
    newButton: newButton
      ? {
          label: text(newButton),
          type: attr(newButton, "type"),
          rect: rect(newButton),
          inHeader: Boolean(header && header.contains(newButton)),
        }
      : null,
    formPresent: Boolean(form),
    modal: dialog
      ? {
          rect: rect(dialog),
          role: attr(dialog, "role"),
          ariaModal: attr(dialog, "aria-modal"),
          labelledBy,
          labelledText: labelledBy ? text(document.getElementById(labelledBy)) : null,
          backdrop: Boolean(backdrop),
          backdropRect: rect(backdrop),
          backdropCoversViewport: backdrop
            ? (() => {
                const r = backdrop.getBoundingClientRect();
                return (
                  r.left <= 1 &&
                  r.top <= 1 &&
                  r.right >= window.innerWidth - 1 &&
                  r.bottom >= window.innerHeight - 1
                );
              })()
            : false,
          formInside: Boolean(
            form && form.closest('[data-testid="project-create-modal"]') === dialog,
          ),
          formPresent: Boolean(form),
          focused: document.activeElement?.getAttribute?.("data-testid") ?? null,
        }
      : null,
    rows,
    filters: Array.from(document.querySelectorAll('[data-testid^="project-filter-"]')).map((b) => ({
      id: b.dataset.testid ?? null,
      label: text(b),
      active: b.getAttribute("aria-checked") === "true",
    })),
    detail: detail
      ? {
          present: true,
          title: text(byTestId("project-title")),
          status: text(byTestId("project-status")),
          statusData: attr(byTestId("project-status"), "data-status"),
          summary: text(document.querySelector(".project-detail__summary")),
          meta: Array.from(document.querySelectorAll(".project-detail__meta > span")).map(text),
          stateNote: text(document.querySelector(".project-detail__state-note")),
          nextAction: text(document.querySelector(".project-detail__next-text")),
          progress: text(byTestId("project-progress-value")),
          progressData: attr(byTestId("project-progress"), "data-value"),
          timeline,
          contextPresent: Boolean(byTestId("project-context")),
          contextText: text(byTestId("project-context")),
          details,
          tasks: collated("project-tasks"),
          signals: collated("project-signals"),
          decisions: collated("project-decisions"),
          log: collated("project-log"),
        }
      : null,
    overflow: {
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      content: content
        ? { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth }
        : null,
      body: document.body.scrollWidth,
    },
    calls: (window.projectsHarnessCalls ?? []).slice(),
    unmodelled: (window.projectsHarnessUnmodelled ?? []).slice(),
  };
})()`;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `projects-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(SIZE.width, SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  // Vite re-optimises dependencies the first time a new import appears and
  // reloads the page when it does, which clears the harness globals mid-wait.
  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.projectsHarnessReady !== "object") return null;
          await window.projectsHarnessReady;
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

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("the harness returned no sample");
    return value;
  };

  /** Poll until the named expression is true; every wait names a state to change. */
  const waitFor = async (expression, label, timeoutMs = 12_000) => {
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
  const clickIn = (selector, label = null) =>
    run(`(async () => {
      const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const el = ${JSON.stringify(label)} === null
        ? nodes[0]
        : nodes.find((n) => ((n.querySelector(".nav-rail__label")?.textContent ?? n.textContent ?? "").trim()) === ${JSON.stringify(label)});
      if (!el) return false;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    })()`);

  const clickTestId = (id) => clickIn(`[data-testid="${id}"]`);
  const wingTab = (label) => clickIn(".top-bar__wings .ui-segmented__option", label);

  /** Type into a React-controlled field by driving the native value setter. */
  const typeInto = (selector, next) =>
    run(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(el, ${JSON.stringify(next)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return el.value === ${JSON.stringify(next)};
    })()`);

  const shoot = async (file) => {
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return file;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** The real Escape key, at whichever control has the caret. */
  const pressEscape = async () => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await sleep(120);
  };

  /**
   * A real pointer press on the scrim itself: the click has to land on the
   * backdrop element, not on the dialog card, or the "click outside closes"
   * path is not the path under test.
   */
  const clickBackdrop = async () => {
    // The window's own title bar paints above the scrim, so the point has to be
    // chosen by hit test rather than assumed: any point that really is the
    // backdrop is a click outside the dialog.
    const point = await run(`(() => {
      const backdrop = document.querySelector('[data-testid="project-create-backdrop"]');
      if (!backdrop) return null;
      const r = backdrop.getBoundingClientRect();
      const candidates = [
        [r.left + 8, r.bottom - 8],
        [r.right - 8, r.bottom - 8],
        [r.left + 8, r.top + r.height / 2],
        [r.right - 8, r.top + r.height / 2],
        [r.left + 8, r.top + 8],
      ];
      for (const [x, y] of candidates) {
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === backdrop || backdrop.contains(hit))) {
          return { x, y, lands: true };
        }
      }
      return { x: r.left + 8, y: r.bottom - 8, lands: false };
    })()`);
    if (!point) throw new Error("the modal's backdrop is not on screen");
    if (!point.lands) throw new Error("the backdrop is not hit-testable anywhere clear of the dialog");
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: "left",
      clickCount: 1,
    });
    await sleep(30);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: "left",
      clickCount: 1,
    });
    await sleep(160);
  };

  /** Open the new-project modal from the heading's button and wait for the form. */
  const openModal = async () => {
    if (!(await clickTestId("project-new"))) throw new Error("no New project button to click");
    await waitFor(
      `Boolean(document.querySelector('[data-testid="project-create-modal"]'))`,
      "the new-project modal to open",
    );
    await waitFor(
      `document.activeElement?.getAttribute?.("data-testid") === "project-create-title"`,
      "the title field to take focus",
    );
  };

  /** Wait for the modal to leave the DOM and the heading button to get focus back. */
  const waitForModalClosed = async (label) => {
    await waitFor(
      `document.querySelector('[data-testid="project-create-modal"]') === null`,
      `${label}: the modal to close`,
    );
    await waitFor(
      `document.activeElement?.getAttribute?.("data-testid") === "project-new"`,
      `${label}: focus to return to the New project button`,
    );
  };

  const bridgeCall = (calls, method) => calls.filter((call) => call.method === method);

  const timeout = setTimeout(() => {
    console.error("projects: timed out after 150s");
    app.exit(1);
  }, 150_000);

  let report;
  try {
    await win.loadURL(url);
    await waitForHarness();
    win.setContentSize(SIZE.width, SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await waitFor(`document.querySelectorAll('[data-testid="project-row"]').length === 4`, "the register's four rows");

    // ── the shell, and Projects under Execute ────────────────────────────────
    const initial = await sample();
    check(
      "skin",
      (await run("document.documentElement.dataset.theme ?? null")) === "dark",
      "the harness did not paint the dark theme",
    );
    check(
      "rail-execute",
      initial.route === "/projects" &&
        initial.activeTab === "Execute" &&
        same(initial.rail.map((row) => row.label), EXECUTE_RAIL) &&
        initial.rail[0]?.href === "/projects" &&
        initial.rail[0]?.active === true,
      `route ${initial.route}, active wing ${initial.activeTab}, rail ${JSON.stringify(
        initial.rail.map((row) => [row.label, row.href, row.active]),
      )}`,
    );
    check(
      "top-bar-tabs",
      same(initial.tabs.map((tab) => tab.label), WING_TABS),
      `tabs ${JSON.stringify(initial.tabs.map((tab) => tab.label))}`,
    );
    check(
      "page-eyebrow",
      initial.eyebrow === "Execute" && initial.pageHeading === "Projects",
      `eyebrow ${JSON.stringify(initial.eyebrow)}, heading ${JSON.stringify(initial.pageHeading)}`,
    );

    // The "New project" button is part of the heading row, read as boxes: it
    // overlaps the h1 vertically, sits to its right, and its centre is on the
    // h1's centre line — not in some section further down the page.
    const button = initial.newButton;
    const h1 = initial.headingRect;
    const headerBox = initial.headerRect;
    const overlapsHeading =
      button && h1 ? button.rect.top < h1.bottom && button.rect.bottom > h1.top : false;
    const rightOfHeading = button && h1 ? button.rect.left >= h1.right - 1 : false;
    const centredOnHeading = button && h1 ? Math.abs(button.rect.centerY - h1.centerY) <= 6 : false;
    const insideHeader =
      button && headerBox
        ? button.rect.left >= headerBox.left - 1 &&
          button.rect.right <= headerBox.right + 1 &&
          button.rect.top >= headerBox.top - 1 &&
          button.rect.bottom <= headerBox.bottom + 1
        : false;
    check(
      "new-project-inline",
      Boolean(button) &&
        button.label === "New project" &&
        button.type === "button" &&
        button.inHeader &&
        insideHeader &&
        overlapsHeading &&
        rightOfHeading &&
        centredOnHeading,
      `button ${JSON.stringify(button)}, h1 ${JSON.stringify(h1)}, header ${JSON.stringify(headerBox)}`,
    );
    check(
      "modal-closed-by-default",
      initial.formPresent === false && initial.modal === null,
      `form present ${initial.formPresent}, modal ${JSON.stringify(initial.modal)}`,
    );
    check(
      "list-count",
      initial.count === "4 projects" && initial.rows.length === 4,
      `count ${JSON.stringify(initial.count)}, rows ${initial.rows.length}`,
    );
    check(
      "list-attributes",
      same(initial.rows.map((row) => row.id), LIST_ORDER) &&
        initial.rows[0]?.title === "Ship the Execute wing" &&
        initial.rows[0]?.status === "Active" &&
        initial.rows[0]?.priority === "High priority" &&
        initial.rows[0]?.goal === "Ship a calmer operating system" &&
        initial.rows[0]?.domain === "Health" &&
        (initial.rows[0]?.target ?? "").includes("2026") &&
        initial.rows[0]?.next === "Next: Wire the rail and ship the rig" &&
        initial.rows[0]?.progress === "60%" &&
        (initial.rows[0]?.summary ?? "").includes("Tools landed") &&
        initial.rows[1]?.status === "Paused" &&
        initial.rows[1]?.domain === "Unassigned" &&
        initial.rows[1]?.goal === "No goal" &&
        initial.rows[1]?.progress === "20%" &&
        initial.rows[2]?.status === "Closed" &&
        initial.rows[2]?.progress === "100%" &&
        initial.rows[3]?.status === "Open" &&
        initial.rows[3]?.priority === "Low priority",
      `rows ${JSON.stringify(initial.rows)}`,
    );
    const listShot = await shoot(SHOTS.list);

    // ── the status filter narrows the register ──────────────────────────────
    await clickTestId("project-filter-active");
    await waitFor(`document.querySelectorAll('[data-testid="project-row"]').length === 1`, "the active filter");
    const activeOnly = await sample();
    check(
      "list-filter",
      same(activeOnly.rows.map((row) => row.id), ["p-exec"]) &&
        activeOnly.filters.find((filter) => filter.id === "project-filter-active")?.active === true,
      `active filter shows ${JSON.stringify(activeOnly.rows.map((row) => row.id))}`,
    );
    await clickTestId("project-filter-closed");
    await waitFor(`document.querySelectorAll('[data-testid="project-row"]').length === 1`, "the closed filter");
    const closedOnly = await sample();
    check(
      "list-filter-closed",
      same(closedOnly.rows.map((row) => row.id), ["p-closed"]),
      `closed filter shows ${JSON.stringify(closedOnly.rows.map((row) => row.id))}`,
    );
    await clickTestId("project-filter-all");
    await waitFor(`document.querySelectorAll('[data-testid="project-row"]').length === 4`, "the All filter");

    // ── the wing wiring: Projects is Execute's, not Plan's ─────────────────
    check("wing-tab-plan", await wingTab("Plan"), "no Plan tab in the top bar");
    await waitFor(`window.projectsHarnessRoute === "/goals"`, "the Plan tab to land on Goals");
    const plan = await sample();
    check(
      "rail-plan",
      plan.activeTab === "Plan" &&
        same(plan.rail.map((row) => row.label), PLAN_RAIL) &&
        !plan.rail.some((row) => row.label === "Projects"),
      `active wing ${plan.activeTab}, rail ${JSON.stringify(plan.rail.map((row) => row.label))}`,
    );
    check("wing-tab-execute", await wingTab("Execute"), "no Execute tab in the top bar");
    await waitFor(`window.projectsHarnessRoute === "/projects"`, "the Execute tab to land back on Projects");
    await waitFor(`document.querySelectorAll('[data-testid="project-row"]').length === 4`, "the register to come back");
    const executeAgain = await sample();
    check(
      "wing-switch",
      executeAgain.activeTab === "Execute" &&
        same(executeAgain.rail.map((row) => row.label), EXECUTE_RAIL) &&
        executeAgain.rail[0]?.active === true,
      `active wing ${executeAgain.activeTab}, rail ${JSON.stringify(executeAgain.rail.map((row) => [row.label, row.active]))}`,
    );
    const wingShot = await shoot(SHOTS.wing);

    // ── the project's own page ─────────────────────────────────────────────
    await clickIn('[data-testid="project-row"][data-project-id="p-exec"]');
    await waitFor(`window.projectsHarnessRoute === "/projects/p-exec"`, "the project page");
    await waitFor(`Boolean(document.querySelector('[data-testid="project-detail"]'))`, "the project detail to render");
    win.setContentSize(DETAIL_SIZE.width, DETAIL_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const detail = await sample();
    const view = detail.detail;
    check("detail-route", detail.route === "/projects/p-exec", `route ${detail.route}`);
    check(
      "detail-header",
      view?.title === "Ship the Execute wing" &&
        view?.status === "Active" &&
        view?.statusData === "active" &&
        (view?.summary ?? "").includes("Move Projects to Execute") &&
        (view?.meta ?? []).some((line) => (line ?? "").includes("Ship a calmer operating system")) &&
        (view?.meta ?? []).some((line) => line === "Health") &&
        (view?.meta ?? []).some((line) => line === "High priority") &&
        (view?.meta ?? []).some((line) => (line ?? "").includes("2026")) &&
        (view?.stateNote ?? "").includes("Tools landed") &&
        view?.nextAction === "Wire the rail and ship the rig" &&
        view?.progress === "60%" &&
        view?.progressData === "60",
      `header ${JSON.stringify(view)}`,
    );
    check(
      "detail-progress",
      same(view?.timeline.map((row) => row.note), [
        "Companion tools landed",
        "Kickoff and the schema landed",
      ]) &&
        same(view?.timeline.map((row) => row.progress), ["60%", "25%"]) &&
        view?.timeline.every((row) => row.actor === "Hermes" && Boolean(row.dateTime)),
      `timeline ${JSON.stringify(view?.timeline)}`,
    );
    check(
      "detail-context",
      view?.contextPresent === true &&
        (view?.contextText ?? "").includes("Context") &&
        (view?.contextText ?? "").includes("get_project"),
      `context ${JSON.stringify(view?.contextText)}`,
    );
    check(
      "detail-attributes",
      view?.details?.title === "Ship the Execute wing" &&
        view?.details?.status === "active" &&
        view?.details?.priority === "high" &&
        view?.details?.goal === "g-exec" &&
        view?.details?.domain === "health" &&
        view?.details?.start === "2026-10-01" &&
        view?.details?.target === "2026-12-31",
      `details ${JSON.stringify(view?.details)}`,
    );
    check(
      "detail-collated",
      same(view?.tasks.map((row) => row.summary), [
        "Write the MCP door test",
        "Move Projects into the Execute rail",
      ]) &&
        (view?.signals ?? []).some((row) => (row.summary ?? "").includes("Projects should collate")) &&
        (view?.signals ?? []).some((row) => (row.summary ?? "").includes("The rail reads Execute now")) &&
        (view?.decisions ?? []).length === 2 &&
        (view?.decisions ?? []).some((row) => (row.summary ?? "").includes("Create project: Ship the Execute wing")) &&
        !(view?.decisions ?? []).some((row) => (row.summary ?? "").includes("Pause Renew the studio lease")) &&
        same(view?.log.map((row) => row.type), ["project.updated", "project.created"]),
      `tasks ${JSON.stringify(view?.tasks)}, signals ${JSON.stringify(view?.signals)}, ` +
        `decisions ${JSON.stringify(view?.decisions)}, log ${JSON.stringify(view?.log)}`,
    );
    check(
      "no-overflow",
      (detail.overflow.document.scrollWidth ?? 0) <= (detail.overflow.document.clientWidth ?? 0) + 1 &&
        (detail.overflow.content?.scrollWidth ?? 0) <= (detail.overflow.content?.clientWidth ?? 0) + 1,
      `detail overflow ${JSON.stringify(detail.overflow)}`,
    );
    const detailShot = await shoot(SHOTS.detail);

    // ── log progress: the page's own write, and what it changes ────────────
    const NOTE = "Shipped the rig and proved the wing";
    const callsBefore = (await sample()).calls.length;
    check(
      "log-progress-range",
      await (async () => {
        const set = await run(`(async () => {
          const el = document.querySelector('[data-testid="project-progress-input"]');
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
          setter?.call(el, "75");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return el.value === "75";
        })()`);
        return set;
      })(),
      "the progress range would not move",
    );
    check(
      "log-progress-note",
      await typeInto('[data-testid="project-progress-note"]', NOTE),
      "the progress note would not type",
    );
    await waitFor(
      `document.querySelector('[data-testid="project-log-progress"]')?.disabled === false`,
      "Log progress to become enabled",
    );
    await clickTestId("project-log-progress");
    await waitFor(
      `document.querySelector('[data-testid="project-progress-value"]')?.textContent.trim() === "75%"`,
      "the percent to read 75%",
    );
    await waitFor(
      `document.querySelectorAll('[data-testid="project-update-row"]').length === 3`,
      "the timeline to gain the new entry",
    );
    const logged = await sample();
    const updates = bridgeCall(logged.calls.slice(callsBefore), "projectsUpdate");
    const lastUpdate = updates[updates.length - 1];
    check(
      "log-progress",
      logged.detail?.progress === "75%" &&
        logged.detail?.timeline.length === 3 &&
        logged.detail?.timeline[0]?.note === NOTE &&
        logged.detail?.timeline[0]?.progress === "75%" &&
        lastUpdate?.args?.[0] === "p-exec" &&
        lastUpdate?.args?.[1]?.progress === 75 &&
        lastUpdate?.args?.[1]?.addUpdate?.note === NOTE,
      `percent ${JSON.stringify(logged.detail?.progress)}, timeline ${JSON.stringify(
        logged.detail?.timeline,
      )}, calls ${JSON.stringify(updates)}`,
    );
    check(
      "no-overflow-after-write",
      (logged.overflow.document.scrollWidth ?? 0) <= (logged.overflow.document.clientWidth ?? 0) + 1 &&
        (logged.overflow.content?.scrollWidth ?? 0) <= (logged.overflow.content?.clientWidth ?? 0) + 1,
      `overflow ${JSON.stringify(logged.overflow)}`,
    );

    // ── the New-project button and its modal, on the register ──────────────
    // Back from the project page first: the heading's button belongs to the
    // register, and the modal is the register's one create path now.
    await clickTestId("project-back");
    await waitFor(`window.projectsHarnessRoute === "/projects"`, "the register after Back");
    await waitFor(`document.querySelectorAll('[data-testid="project-row"]').length === 4`, "the register's four rows");
    win.setContentSize(SIZE.width, SIZE.height);
    await sleep(220);

    await openModal();
    await sleep(120);
    const opened = await sample();
    check(
      "modal-opens",
      opened.modal !== null &&
        opened.modal?.role === "dialog" &&
        opened.modal?.ariaModal === "true" &&
        opened.modal?.labelledBy === "new-project-title" &&
        opened.modal?.labelledText === "New project" &&
        opened.modal?.backdrop === true &&
        opened.modal?.backdropCoversViewport === true &&
        opened.modal?.formInside === true &&
        opened.modal?.formPresent === true &&
        opened.modal?.focused === "project-create-title",
      `modal ${JSON.stringify(opened.modal)}`,
    );
    const modalShot = await shoot(SHOTS.modal);

    // Escape closes, and the caret goes back to the button that opened it.
    await pressEscape();
    await waitForModalClosed("modal-escape");
    const escaped = await sample();
    const escapeFocus = await run(
      `document.activeElement?.getAttribute?.("data-testid") ?? null`,
    );
    check(
      "modal-escape",
      escaped.modal === null &&
        escaped.formPresent === false &&
        escapeFocus === "project-new",
      `modal ${JSON.stringify(escaped.modal)}, focus ${JSON.stringify(escapeFocus)}`,
    );

    // A press on the scrim itself closes it.
    await openModal();
    await clickBackdrop();
    await waitForModalClosed("modal-backdrop");
    const backdropClosed = await sample();
    const backdropFocus = await run(
      `document.activeElement?.getAttribute?.("data-testid") ?? null`,
    );
    check(
      "modal-backdrop",
      backdropClosed.modal === null &&
        backdropClosed.formPresent === false &&
        backdropFocus === "project-new",
      `modal ${JSON.stringify(backdropClosed.modal)}, focus ${JSON.stringify(backdropFocus)}`,
    );

    // Cancel closes it too.
    await openModal();
    check("modal-cancel-click", await clickTestId("project-create-cancel"), "no Cancel control in the modal");
    await waitForModalClosed("modal-cancel");
    const cancelled = await sample();
    check(
      "modal-cancel",
      cancelled.modal === null && cancelled.formPresent === false,
      `modal ${JSON.stringify(cancelled.modal)}`,
    );

    // Create: title, one attribute (summary) and the context document, then
    // submit. The page's own projectsCreate call must fire, the modal must
    // close, and the register must gain the row.
    const NEW_TITLE = "Draft the winter plan";
    const NEW_SUMMARY = "Three weeks, one bag, no laptop";
    const NEW_CONTEXT = "Book the flights before the fare rises.";
    await openModal();
    const callsBeforeCreate = (await sample()).calls.length;
    check(
      "modal-create-title",
      await typeInto('[data-testid="project-create-title"]', NEW_TITLE),
      "the title field would not take the new project's name",
    );
    check(
      "modal-create-summary",
      await typeInto('[data-testid="project-create-summary"]', NEW_SUMMARY),
      "the summary field would not take the one attribute",
    );
    check(
      "modal-create-context-open",
      await run(`(() => {
        const box = document.querySelector('[data-testid="project-create-context"]');
        if (!box) return false;
        box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, view: window }));
        return true;
      })()`),
      "the context editor is not in the modal",
    );
    await waitFor(
      `Boolean(document.querySelector('[data-testid="project-create-context-input"]'))`,
      "the context editor's block to open",
    );
    check(
      "modal-create-context",
      await typeInto('[data-testid="project-create-context-input"]', NEW_CONTEXT),
      "the context block would not take the text",
    );
    check(
      "modal-create-submit",
      await clickTestId("project-create-submit"),
      "no Create project button in the modal",
    );
    await waitForModalClosed("modal-create");
    await waitFor(`document.querySelectorAll('[data-testid="project-row"]').length === 5`, "the register's fifth row");
    await waitFor(
      `document.querySelector('[data-testid="projects-page"] .projects-page__count')?.textContent.trim() === "5 projects"`,
      "the register count to read five",
    );
    await sleep(160);
    const created = await sample();
    const createCalls = bridgeCall(created.calls.slice(callsBeforeCreate), "projectsCreate");
    const createArg = createCalls[createCalls.length - 1]?.args?.[0];
    check(
      "modal-create",
      created.modal === null &&
        created.formPresent === false &&
        created.count === "5 projects" &&
        created.rows.length === 5 &&
        created.rows[0]?.title === NEW_TITLE &&
        (created.rows[0]?.summary ?? "").includes(NEW_SUMMARY) &&
        createCalls.length === 1 &&
        createArg?.title === NEW_TITLE &&
        createArg?.summary === NEW_SUMMARY &&
        String(createArg?.bodyMarkdown ?? "").includes(NEW_CONTEXT),
      `modal ${JSON.stringify(created.modal)}, count ${JSON.stringify(created.count)}, ` +
        `rows ${JSON.stringify(created.rows.slice(0, 1))}, calls ${JSON.stringify(createCalls)}`,
    );

    // ── clean: no page errors, and nothing outside the chat surface unmodelled
    const unmodelled = created.unmodelled.filter(
      (name) => !/^companion/.test(name) && !/^onCompanion/.test(name),
    );
    check(
      "clean",
      consoleErrors.length === 0 && unmodelled.length === 0,
      `${consoleErrors.length} console error(s), ${unmodelled.length} unmodelled bridge call(s)` +
        `${unmodelled.length ? `: ${unmodelled.join(", ")}` : ""}`,
    );

    report = {
      pass: errors.length === 0,
      failures: errors,
      what:
        "Projects on the Execute wing: the shipped rail puts Projects under Execute (and not Plan), " +
        "the register shows every built-in attribute, the project page renders the header, progress " +
        "timeline, context document and the collated tasks/signals/Decisions/log, logging progress " +
        "writes addUpdate through the page's own bridge call, and the heading's New project button " +
        "opens a real modal that Escape, the scrim and Cancel close and whose form creates a row",
      command: "LIFEQUEST_E2E_URL=<dev>/e2e/projects.html node e2e/projects.electron.mjs",
      checks: {
        scenarios,
        initial: {
          route: initial.route,
          activeTab: initial.activeTab,
          tabs: initial.tabs,
          rail: initial.rail,
          pinned: initial.pinned,
          footer: initial.footer,
          eyebrow: initial.eyebrow,
          count: initial.count,
          headingRect: initial.headingRect,
          headerRect: initial.headerRect,
          newButton: initial.newButton,
          rows: initial.rows,
        },
        newProject: {
          inline: initial.newButton,
          heading: initial.headingRect,
          header: initial.headerRect,
          closedByDefault:
            initial.formPresent === false && initial.modal === null,
          modal: opened.modal,
          escape: { modalClosed: escaped.modal === null, focus: escapeFocus },
          backdrop: {
            modalClosed: backdropClosed.modal === null,
            focus: backdropFocus,
          },
          cancel: { modalClosed: cancelled.modal === null },
          create: {
            count: created.count,
            newRow: created.rows[0] ?? null,
            call: createCalls[createCalls.length - 1] ?? null,
          },
        },
        wing: {
          plan: { activeTab: plan.activeTab, rail: plan.rail },
          execute: { activeTab: executeAgain.activeTab, rail: executeAgain.rail },
        },
        detail: view,
        afterLogProgress: {
          progress: logged.detail?.progress,
          timeline: logged.detail?.timeline,
          call: lastUpdate ?? null,
        },
        overflow: { detail: detail.overflow, afterWrite: logged.overflow },
        screenshots: [listShot, wingShot, detailShot, modalShot],
        unmodelled: logged.unmodelled,
        consoleErrors,
      },
      generatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
    if (report) {
      fs.writeFileSync(
        path.join(artifactsDir, "projects.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
    win.destroy();
    app.exit(errors.length === 0 ? 0 : 1);
  }
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
