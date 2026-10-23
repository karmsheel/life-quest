/**
 * Drives the saved-questions harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/chat-questions.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node_modules/.bin/electron e2e/chat-questions.electron.mjs
 *
 * Exit 0 = every step ran and every check held. The JSON report is the
 * repeatable artifact: the test file (`tests/chat-questions-e2e.test.ts`) holds
 * the assertions, this file holds the interactions and the measurements, so a
 * failure names a state rather than a line of driver code.
 *
 * The bridge is a stub (there is no Electron preload on a dev-server page). The
 * last section is not: it creates a throwaway vault on disk, writes the same
 * question shapes through the shipping `updateSettings`, and reopens it through
 * `openVault`, so the file the feature depends on is proven by the same run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";
import { createVault, openVault, updateSettings } from "@lifequest/vault-core";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame would hang until
// its watchdog instead of failing.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/chat-questions.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The questions this run writes, in the order the settings page will list them. */
const FINANCIAL = "How is my current expenditure tracking with my monthly budget?";
const HEALTH = "What are the top three health issues I have been hinting at?";
const REVIEW = "What did I avoid this week?";
const HOME_PAGE = "What changed on my dashboard today?";
const GLOBAL = "What should I focus on this week?";
const GLOBAL_EDITED = "What should I focus on this week, in one sentence?";
const TEMP = "Temporary question the rig will delete.";

const SAMPLE = `(() => {
  const round = (n) => Math.round(n);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: round(r.left), top: round(r.top), right: round(r.right),
      bottom: round(r.bottom), width: round(r.width), height: round(r.height),
    };
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const rows = Array.from(document.querySelectorAll('[data-testid="chat-question"]'))
    .map((row) => ({
      id: row.getAttribute("data-question-id"),
      text: text(row.querySelector('[data-testid="chat-question-text"]')),
      scope: text(row.querySelector('[data-testid="chat-question-scope-label"]')),
      editing: Boolean(row.querySelector('[data-testid="chat-question-edit-input"]')),
    }));
  const starters = Array.from(document.querySelectorAll('[data-testid="chat-starter"]'))
    .map((button) => ({
      id: button.getAttribute("data-question-id"),
      text: text(button.querySelector(".chat-panel__starter-text")),
      scope: text(button.querySelector(".chat-panel__starter-scope")),
      box: box(button),
    }));
  const panel = document.querySelector(".chat-panel");
  const composer = document.querySelector(".chat-panel__composer-input");
  return {
    route: document.body.dataset.rigRoute || null,
    settingsView:
      (document.querySelector("[data-settings-view]") || { getAttribute: () => null })
        .getAttribute("data-settings-view") || null,
    settingsTitle: text(document.querySelector(".settings-panel__title")),
    activeNav: text(document.querySelector(".settings-nav-item.is-active .settings-nav-item__label")),
    navCount: document.querySelectorAll(".settings-nav-item").length,
    questionCount: Number(text(document.querySelector('[data-testid="chat-question-count"]')) || "0"),
    questions: rows,
    error: text(document.querySelector('[data-testid="chat-question-error"]')) || null,
    patches: (window.__lqPatches || []).map((patch) => ({
      count: Array.isArray(patch.chatQuestions) ? patch.chatQuestions.length : null,
      questions: Array.isArray(patch.chatQuestions)
        ? patch.chatQuestions.map((q) => ({ text: q.text, scope: q.scope, value: q.value }))
        : null,
    })),
    streamCalls: (window.__lqStreamCalls || []).map((call) => ({
      sessionId: call.sessionId,
      input: call.input,
      pageRoute: call.instructionsContext?.pageContext?.route ?? null,
      domainSlug: call.instructionsContext?.domainSlug ?? null,
    })),
    starters,
    messages: Array.from(document.querySelectorAll(".chat-panel__message")).map((m) => ({
      role: m.classList.contains("chat-panel__message--user") ? "user" : "assistant",
      text: text(m.querySelector(".chat-panel__message-content")),
    })),
    emptyTitle: text(document.querySelector(".chat-panel__empty-title")) || null,
    panel: box(panel),
    composer: box(composer),
    windowOverflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    panelOverflow: panel
      ? { scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth }
      : null,
    state: typeof window.__lqState === "function" ? window.__lqState() : null,
  };
})()`;

const failures = [];
const checks = [];
function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
  return Boolean(pass);
}

async function main() {
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.on("console-message", (_event, level, message) => {
    // The renderer's own errors are the difference between "the harness never
    // settled" and "the page threw before it could": keep them in the run log.
    console.log(`renderer[${level}] ${message}`);
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`did-fail-load ${code} ${description} ${url}`);
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const waitFor = (expression, label, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const poll = async () => {
        let value;
        try {
          value = await run(expression);
        } catch {
          value = undefined;
        }
        if (value) {
          resolve(value);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`timed out waiting for ${label}`));
          return;
        }
        setTimeout(poll, 60);
      };
      void poll();
    });
  };

  const click = (selector) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("no element for the requested selector");
      el.click();
      return true;
    })()`);

  const setControl = (selector, value, kind) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("no control for the requested selector");
      const proto = ${kind === "select" ? "HTMLSelectElement" : "HTMLTextAreaElement"};
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    })()`);

  const addQuestion = async (text, scope, expectedCount) => {
    if (scope === "everywhere") {
      await setControl('[data-testid="chat-question-scope"]', "everywhere", "select");
    } else {
      await setControl('[data-testid="chat-question-scope"]', scope, "select");
    }
    await setControl('[data-testid="chat-question-input"]', text, "textarea");
    await click('[data-testid="chat-question-add"]');
    await waitFor(
      `document.querySelectorAll('[data-testid="chat-question"]').length === ${expectedCount}`,
      `${expectedCount} saved questions`,
    );
  };

  const findRowButton = (text, testId) =>
    run(`(() => {
      const row = Array.from(document.querySelectorAll('[data-testid="chat-question"]'))
        .find((candidate) => candidate.textContent.includes(${JSON.stringify(text)}));
      if (!row) throw new Error("no question row for the requested text");
      const button = row.querySelector('[data-testid="${testId}"]');
      if (!button) throw new Error("row has no ${testId}");
      button.click();
      return true;
    })()`);

  const clickStarter = (text) =>
    run(`(() => {
      const button = Array.from(document.querySelectorAll('[data-testid="chat-starter"]'))
        .find((candidate) => candidate.textContent.includes(${JSON.stringify(text)}));
      if (!button) throw new Error("no starter for the requested text");
      button.click();
      return true;
    })()`);

  const screenshots = [];
  const shot = async (name) => {
    // A hidden window can be a frame behind its DOM: the state was read from the
    // renderer, but the compositor has not painted it yet. Ask for frames, ask
    // the window to paint, and only then capture — otherwise a screenshot named
    // for the saved list holds the empty form one step earlier.
    await run(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))",
    );
    win.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const image = await win.webContents.capturePage();
    fs.mkdirSync(artifactsDir, { recursive: true });
    const file = path.join(artifactsDir, `chat-questions-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    screenshots.push(path.basename(file));
    return file;
  };

  const report = {
    pass: false,
    failures,
    checks,
    states: {},
    screenshots,
    persistence: null,
  };

  try {
    await win.loadURL(url);
    await run("window.chatQuestionsHarnessReady");
    const landing = await sample();

    // ── 1. the section is a section ────────────────────────────────────────
    check(
      "the Questions panel is the open settings view",
      landing.settingsView === "questions",
      `panel view is ${landing.settingsView}`,
    );
    check(
      "the nav row points at it",
      landing.activeNav === "Questions",
      `active nav is "${landing.activeNav}"`,
    );
    check(
      "the page is named for what it holds",
      landing.settingsTitle === "Chat questions",
      `page title is "${landing.settingsTitle}"`,
    );
    check(
      "the section is one of the settings sections",
      landing.navCount >= 9,
      `only ${landing.navCount} settings sections rendered`,
    );
    await shot("settings-empty");

    // ── 2–4. add, edit, delete — every write goes to settings ──────────────
    await addQuestion(FINANCIAL, "domain:financial", 1);
    await addQuestion(HEALTH, "domain:health", 2);
    await addQuestion(REVIEW, "wing:review", 3);
    await addQuestion(HOME_PAGE, "page:/home", 4);
    await addQuestion(GLOBAL, "everywhere", 5);

    const added = await sample();
    check(
      "all five questions are listed",
      added.questions.length === 5,
      `listed ${added.questions.length}`,
    );
    check(
      "the list keeps the operator's order",
      added.questions.map((row) => row.text).join(" | ") ===
        [FINANCIAL, HEALTH, REVIEW, HOME_PAGE, GLOBAL].join(" | "),
      added.questions.map((row) => row.text).join(" | "),
    );
    check(
      "the domain scope is stored and shown as a domain",
      added.questions[0]?.scope === "Financial domain",
      `first scope is "${added.questions[0]?.scope}"`,
    );
    check(
      "the wing scope is stored and shown as a wing",
      added.questions[2]?.scope === "Review wing",
      `third scope is "${added.questions[2]?.scope}"`,
    );
    check(
      "the page scope is stored and shown as a page",
      added.questions[3]?.scope === "Dashboard page",
      `fourth scope is "${added.questions[3]?.scope}"`,
    );
    check(
      "each add wrote one settings patch",
      added.patches.length === 5,
      `${added.patches.length} patches after five adds`,
    );
    check(
      "the patch kept the scope target",
      added.patches[0]?.questions?.[0]?.scope === "domain" &&
        added.patches[0]?.questions?.[0]?.value === "financial" &&
        added.patches[2]?.questions?.[2]?.scope === "wing" &&
        added.patches[2]?.questions?.[2]?.value === "review" &&
        added.patches[3]?.questions?.[3]?.scope === "page" &&
        added.patches[3]?.questions?.[3]?.value === "/home",
      JSON.stringify(added.patches.map((patch) => patch.questions?.map((q) => [q.scope, q.value]))),
    );

    await findRowButton(GLOBAL, "chat-question-edit");
    await waitFor(
      "Boolean(document.querySelector('[data-testid=\"chat-question-edit-input\"]'))",
      "the edit field",
    );
    await setControl('[data-testid="chat-question-edit-input"]', GLOBAL_EDITED, "textarea");
    await click('[data-testid="chat-question-save"]');
    await waitFor(
      "!document.querySelector('[data-testid=\"chat-question-edit-input\"]')",
      "the edit field to close",
    );

    await addQuestion(TEMP, "everywhere", 6);
    await findRowButton(TEMP, "chat-question-delete");
    await waitFor(
      "document.querySelectorAll('[data-testid=\"chat-question\"]').length === 5",
      "the temporary question to be deleted",
    );

    const afterEdit = await sample();
    check(
      "editing rewrites the question in place",
      afterEdit.questions[4]?.text === GLOBAL_EDITED,
      `row five reads "${afterEdit.questions[4]?.text}"`,
    );
    check(
      "editing keeps the question in its scope",
      afterEdit.questions[4]?.scope === "Everywhere",
      `row five scope is "${afterEdit.questions[4]?.scope}"`,
    );
    check(
      "delete removes the row and the stored question",
      afterEdit.questions.length === 5 &&
        afterEdit.questions.every((row) => row.text !== TEMP),
      `rows after delete: ${afterEdit.questions.map((row) => row.text).join(" | ")}`,
    );
    check(
      "edit and delete wrote their own patches",
      afterEdit.patches.length === 8,
      `${afterEdit.patches.length} patches, expected 8`,
    );
    check(
      "the delete patch is the five questions that remain",
      afterEdit.patches[7]?.questions?.length === 5,
      `delete patch carries ${afterEdit.patches[7]?.questions?.length}`,
    );
    await shot("settings-list");

    // ── close the sheet; the app lands on the page behind it ───────────────
    await click(".settings-overlay__close");
    await waitFor(
      "document.body.dataset.rigRoute === '/home' && Boolean(document.querySelector('.chat-panel'))",
      "the dashboard and the chat dock",
    );

    // ── 5–8. a new chat offers exactly this screen's questions ─────────────
    await click('[aria-label="New chat"]');
    await waitFor(
      "document.querySelectorAll('[data-testid=\"chat-starter\"]').length > 0",
      "the saved questions in the new chat",
    );
    const home = await sample();
    check(
      "the Financial lens is active on the Dashboard",
      home.state?.activeDomain === "financial",
      `active domain is ${home.state?.activeDomain}`,
    );
    check(
      "the empty thread is the place the questions appear",
      home.emptyTitle === "Ask Hermes",
      `empty title is "${home.emptyTitle}"`,
    );
    check(
      "the domain question appears under its domain",
      home.starters.some((row) => row.text === FINANCIAL && row.scope === "Financial"),
      JSON.stringify(home.starters),
    );
    check(
      "the everywhere question appears too",
      home.starters.some((row) => row.text === GLOBAL_EDITED && row.scope === "Everywhere"),
      JSON.stringify(home.starters),
    );
    check(
      "the page question appears on its page",
      home.starters.some((row) => row.text === HOME_PAGE && row.scope === "Dashboard page"),
      JSON.stringify(home.starters),
    );
    check(
      "the other domain is not offered here",
      home.starters.every((row) => row.text !== HEALTH),
      "the Health question was offered in the Financial lens",
    );
    check(
      "the other wing is not offered here",
      home.starters.every((row) => row.text !== REVIEW),
      "the Review question was offered on the Dashboard",
    );
    check(
      "the dock does not widen the window",
      home.windowOverflow.scrollWidth <= home.windowOverflow.clientWidth + 1,
      `${home.windowOverflow.scrollWidth} > ${home.windowOverflow.clientWidth}`,
    );
    check(
      "the panel wraps its own content",
      (home.panelOverflow?.scrollWidth ?? 0) <= (home.panelOverflow?.clientWidth ?? 0) + 1,
      `${home.panelOverflow?.scrollWidth} > ${home.panelOverflow?.clientWidth}`,
    );
    check(
      "a starter has real height",
      (home.starters[0]?.box?.height ?? 0) > 20,
      `starter height is ${home.starters[0]?.box?.height}`,
    );
    await shot("starters-home");

    await clickStarter(FINANCIAL);
    await waitFor("(window.__lqStreamCalls || []).length === 1", "the first turn to be sent");
    await waitFor(
      "Array.from(document.querySelectorAll('.chat-panel__message')).some((m) => m.textContent.includes('monthly budget'))",
      "the sent question to appear in the transcript",
    );
    const sent = await sample();
    check(
      "one click sends the question itself",
      sent.streamCalls[0]?.input === FINANCIAL,
      `the wire got "${sent.streamCalls[0]?.input}"`,
    );
    check(
      "the question rides the current page context",
      sent.streamCalls[0]?.pageRoute === "/home" &&
        sent.streamCalls[0]?.domainSlug === "financial",
      JSON.stringify({
        route: sent.streamCalls[0]?.pageRoute,
        domain: sent.streamCalls[0]?.domainSlug,
      }),
    );
    check(
      "the sent turn becomes a user bubble",
      sent.messages.some((message) => message.role === "user" && message.text === FINANCIAL),
      JSON.stringify(sent.messages),
    );
    check(
      "the question list gives way to the transcript",
      sent.starters.length === 0,
      `${sent.starters.length} starters still visible`,
    );
    await shot("sent");

    // ── 6. another wing and another domain offer a different set ───────────
    await run("window.__lqNavigate('/review/weekly')");
    await run("window.__lqSetDomain('health')");
    await waitFor(
      "document.body.dataset.rigRoute === '/review/weekly' && document.querySelector('.chat-panel')",
      "the Weekly review page",
    );
    await click('[aria-label="New chat"]');
    await waitFor(
      "document.querySelectorAll('[data-testid=\"chat-starter\"]').length > 0",
      "the saved questions in the review chat",
    );
    const review = await sample();
    check(
      "the Health lens is now active",
      review.state?.activeDomain === "health",
      `active domain is ${review.state?.activeDomain}`,
    );
    check(
      "the domain question follows the lens",
      review.starters.some((row) => row.text === HEALTH && row.scope === "Health"),
      JSON.stringify(review.starters),
    );
    check(
      "the wing question appears in its wing",
      review.starters.some((row) => row.text === REVIEW && row.scope === "Review wing"),
      JSON.stringify(review.starters),
    );
    check(
      "the old page question does not follow the operator",
      review.starters.every((row) => row.text !== HOME_PAGE),
      "the Dashboard question was offered on Weekly",
    );
    check(
      "the old domain question does not follow the lens",
      review.starters.every((row) => row.text !== FINANCIAL),
      "the Financial question was offered in Health",
    );
    await shot("starters-review");

    // A live route change while the blank chat stays open: the page rule is
    // read at render, not frozen when the chat was made.
    await run("window.__lqNavigate('/goals')");
    await waitFor(
      "document.body.dataset.rigRoute === '/goals' && document.querySelectorAll('[data-testid=\"chat-starter\"]').length > 0",
      "the questions on the Goals page",
    );
    const goals = await sample();
    check(
      "the wing question leaves with its wing",
      goals.starters.every((row) => row.text !== REVIEW),
      "the Review question was offered on Goals",
    );
    check(
      "the domain question stays in its domain",
      goals.starters.some((row) => row.text === HEALTH),
      JSON.stringify(goals.starters),
    );

    await run("window.__lqNavigate('/review/weekly')");
    await waitFor(
      "Array.from(document.querySelectorAll('[data-testid=\"chat-starter\"]')).some((b) => b.textContent.includes('What did I avoid this week?'))",
      "the Review question to come back",
    );
    await clickStarter(REVIEW);
    await waitFor("(window.__lqStreamCalls || []).length === 2", "the second turn to be sent");
    const second = await sample();
    check(
      "the review question is sent as its own first turn",
      second.streamCalls[1]?.input === REVIEW,
      `the wire got "${second.streamCalls[1]?.input}"`,
    );
    check(
      "the second question starts a different chat",
      second.streamCalls[1]?.sessionId !== second.streamCalls[0]?.sessionId,
      "the two questions were sent in one chat",
    );
    check(
      "the second turn carries the review page and health lens",
      second.streamCalls[1]?.pageRoute === "/review/weekly" &&
        second.streamCalls[1]?.domainSlug === "health",
      JSON.stringify({
        route: second.streamCalls[1]?.pageRoute,
        domain: second.streamCalls[1]?.domainSlug,
      }),
    );
    await shot("sent-review");

    report.states = { landing, added, afterEdit, home, sent, review, goals, second };

    // ── 9. the shipping vault can reopen what the page wrote ───────────────
    const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-chat-questions-"));
    const created = await createVault(world, "Questions Rig");
    check("a throwaway vault can be created", created.ok, created.ok ? null : created.error);

    if (created.ok) {
      const seed = [
        {
          id: "persist-domain",
          text: FINANCIAL,
          scope: "domain",
          value: "financial",
          createdAt: "2026-10-23T08:00:00.000Z",
        },
        {
          id: "persist-page",
          text: HOME_PAGE,
          scope: "page",
          value: "/home",
          createdAt: "2026-10-23T08:01:00.000Z",
        },
      ];
      const saved = await updateSettings(world, { chatQuestions: seed });
      check(
        "the vault's settings writer accepts saved questions",
        saved.ok,
        saved.ok ? null : saved.error,
      );
      const reopened = await openVault(world);
      const loaded = reopened.ok ? reopened.value.settings.chatQuestions : [];
      check(
        "the vault's reader gives them back unchanged",
        reopened.ok &&
          loaded.length === seed.length &&
          loaded.every(
            (question, index) =>
              question.id === seed[index]?.id &&
              question.text === seed[index]?.text &&
              question.scope === seed[index]?.scope &&
              question.value === seed[index]?.value,
          ),
        reopened.ok ? JSON.stringify(loaded) : reopened.error,
      );
      const refused = await updateSettings(world, {
        chatQuestions: [
          {
            id: "broken",
            text: "No target",
            scope: "domain",
            value: null,
            createdAt: "2026-10-23T08:02:00.000Z",
          },
        ],
      });
      check(
        "a question with no valid target is refused",
        refused.ok === false,
        refused.ok ? "the malformed question was written" : null,
      );
      report.persistence = {
        world,
        created: created.ok,
        saved: saved.ok,
        reopened: reopened.ok,
        loaded,
        refused: refused.ok,
      };
    }

    report.pass = failures.length === 0;
  } catch (error) {
    report.failures = [
      ...failures,
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    ];
    report.pass = false;
  }

  const reportFile = path.join(artifactsDir, "chat-questions.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures) console.log(`FAIL ${failure}`);
  for (const row of report.checks) {
    console.log(`${row.pass ? "PASS" : "FAIL"} ${row.label}${row.detail ? ` — ${row.detail}` : ""}`);
  }
  console.log(report.pass ? "chat questions: PASS" : "chat questions: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-questions: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
