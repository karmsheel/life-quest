/**
 * The companion refusal, driven inside the real app.
 *
 * The real app runs here — `dist-electron/main.js`, the real preload, the real
 * renderer, booted through `bootForE2e` — against the world
 * `companion-refusal.mjs` built: a temp `HERMES_HOME`, a fake `hermes` first on
 * PATH that refuses `gateway restart` and `gateway start` the way the real CLI
 * refuses (the message on STDOUT, an empty stderr, exit 1), and an app prefs file
 * that puts the companion on a profile no host on this machine serves. Nothing
 * the operator owns is read or written.
 *
 * WHAT IT DOES
 *
 * Waits for the app's own `companionEnsure` — the renderer runs it at mount, the
 * same call a fresh install makes — and then reads BOTH what the app reported and
 * what the setup screen shows:
 *
 *   - `window.lifequest.companionStatus()`, the status the whole UI is built on;
 *   - the rendered `.welcome-card` heading and body paragraphs, which is the
 *     surface the operator actually reads. A message that reaches the status and
 *     not the screen is still the reported bug.
 *
 * This driver makes no assertions of its own beyond "the app answered": the
 * verdict belongs to the launcher, which sees the CLI log and the app's exit as
 * well. What it does do is write down everything it observed verbatim, so the
 * artifact can be read without a re-run.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import { app } from "electron";

const RAW_SPEC = process.env.LIFEQUEST_COMPANION_REFUSAL;
if (!RAW_SPEC) {
  console.error("[refusal] LIFEQUEST_COMPANION_REFUSAL is not set; run e2e/companion-refusal.mjs");
  app.exit(1);
}
const SPEC = RAW_SPEC ? JSON.parse(RAW_SPEC) : {};
const notes = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function note(message) {
  notes.push(message);
  console.error(`[refusal] ${message}`);
}

/** Every `hermes` on PATH, in the order the shell would take them. */
function resolveHermes() {
  return new Promise((resolve) => {
    execFile(
      process.platform === "win32" ? "where.exe" : "which",
      ["hermes"],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve({ first: null, lines: [], error: error.message });
          return;
        }
        const lines = String(stdout)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        resolve({ first: lines[0] ?? null, lines, error: null });
      },
    );
  });
}

/**
 * `executeJavaScript` can stop settling while the renderer is busy; every read
 * here is bounded so a wedged renderer fails the run instead of hanging it.
 */
async function read(win, expression, timeoutMs = 10_000) {
  const result = await Promise.race([
    win.webContents
      .executeJavaScript(expression, true)
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) })),
    sleep(timeoutMs).then(() => ({ ok: false, error: `the read did not settle within ${timeoutMs}ms` })),
  ]);
  return result;
}

/**
 * The app's companion status.
 *
 * Polled rather than called: the status is the renderer's own `companionEnsure`
 * (it runs at mount, exactly as on a fresh install). Calling ensure from here
 * would run the CLI a second time and make the invocation log — the evidence —
 * unattributable, so this waits instead. A renderer that never mounts therefore
 * ends as a `needs_install` status and a loud failure, not as a race.
 *
 * `companionStatus` is unreachable until the window has loaded the renderer from
 * the dev server; a read that throws while the page is still coming up is
 * expected, so only the first is recorded and the loop keeps waiting.
 */
async function waitForStatus(win, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let readFailures = 0;
  for (;;) {
    const reply = await read(win, "window.lifequest.companionStatus()");
    if (reply.ok) {
      last = reply.value;
      if (last && last.kind && last.kind !== "needs_install") return last;
    } else {
      readFailures += 1;
      if (readFailures === 1) note(`companionStatus() is not answering yet: ${reply.error}`);
    }
    if (Date.now() > deadline) return last;
    await sleep(250);
  }
}

/**
 * The setup screen as the operator sees it. `p.muted` is read by position — the
 * screen renders the lead line then the body — so this works whether or not the
 * body paragraph carries a class of its own.
 */
const SCREEN = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const muted = Array.from(document.querySelectorAll(".welcome-card > p.muted"));
  return {
    heading: text(document.querySelector(".welcome-card h1")),
    lead: text(document.querySelector(".welcome-lead")) || text(muted[0]),
    body: text(document.querySelector(".welcome-detail")) || text(muted[1]),
    bodyLines: (text(muted[1]) || "").split("\\n").filter(Boolean).length,
    recheck: text(document.querySelector(".welcome-actions .btn")),
    splashHidden: Boolean(document.getElementById("splash")?.hasAttribute("hidden")),
  };
})()`;

async function run() {
  const hermes = await resolveHermes();
  note(`where hermes -> ${JSON.stringify(hermes.lines)}`);

  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();

  const status = await waitForStatus(win, SPEC.timeoutMs ?? 90_000);
  const kind = status?.kind ?? null;
  const detail = typeof status?.detail === "string" ? status.detail : "";
  note(`companion status kind=${JSON.stringify(kind)}`);

  // The screen needs a render tick after the status lands, and then the
  // cold-start splash stands down (a 50ms poll, then a 200ms fade). Both are
  // waited out rather than raced: a message behind a splash is a message the
  // operator cannot read, so `splashHidden` is part of what is observed here.
  let screen = {};
  for (let i = 0; i < 40; i++) {
    const reply = await read(win, SCREEN);
    if (reply.ok) {
      screen = reply.value ?? {};
      if (screen.body && screen.splashHidden) break;
    } else {
      note(`screen read failed: ${reply.error}`);
    }
    await sleep(250);
  }
  if (!screen.splashHidden) note("the cold-start splash was never reported hidden");

  const result = {
    ran: true,
    kind,
    detail,
    cliPath: hermes.first,
    cliPathLines: hermes.lines,
    cliLookupError: hermes.error,
    screen,
    profile: SPEC.profile,
    hermesHome: SPEC.hermesHome,
    notes: [...notes],
  };
  fs.writeFileSync(SPEC.resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  note(`wrote ${SPEC.resultFile}`);
}

app.whenReady()
  .then(run)
  .catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    note(`the driver threw: ${message}`);
    try {
      fs.writeFileSync(
        SPEC.resultFile,
        `${JSON.stringify({ ran: true, kind: null, detail: "", threw: message, notes: [...notes] }, null, 2)}\n`,
        "utf8",
      );
    } catch {
      /* nothing left to write to */
    }
  })
  .finally(() => {
    app.exit(0);
  });
