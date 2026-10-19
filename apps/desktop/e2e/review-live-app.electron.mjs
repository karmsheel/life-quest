/**
 * The wired-app half of the Reviews feature: the built `main.js`, the real
 * preload, the real page, and the operator's own vault, with no stub anywhere.
 *
 * See `review-live-app.mjs` for what it claims and why every call it makes is
 * answerable without writing a file. The report is
 * `e2e/artifacts/review-live-app.json`, plus a picture of the real page reading
 * the real review (`review-live-app.png`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "review-live-app.json");

/** A period no vault has a review for, so a write to it cannot land. */
const UNREVIEWED = "2020-01-06";

const errors = [];
/**
 * What the run had sampled when it stopped. Module-level so a throw still writes
 * a report with the screen it died on rather than a bare message.
 */
const pendingChecks = {};
/** How long each step took, in seconds. A wired-app boot is slow; this says where. */
const timings = {};
const failure = (m) => {
  errors.push(m);
  return m;
};

/** Run one step and record how long it took. */
async function step(name, run) {
  const started = Date.now();
  try {
    return await run();
  } finally {
    timings[name] = Math.round((Date.now() - started) / 100) / 10;
  }
}

function waitFor(win, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
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
      setTimeout(poll, 50);
    };
    void poll();
  });
}

/** The review page as the operator's own app draws it. */
const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const box = document.querySelector(".note-live");
  const blocks = box ? Array.from(box.querySelectorAll("[data-note-block]")) : [];
  return {
    page: Boolean(document.querySelector(".review-page")),
    title: text(document.querySelector(".review-page__title")),
    period: text(document.querySelector(".review-page__period")),
    error: text(document.querySelector(".form-error")),
    status: text(document.querySelector(".review-page__status")),
    boxes: document.querySelectorAll(".note-live").length,
    blocks: blocks.length,
    blanks: box ? box.querySelectorAll(".note-live__blank").length : 0,
    tables: box ? box.querySelectorAll("table").length : 0,
    headings: box ? box.querySelectorAll("h1, h2, h3, h4, h5, h6").length : 0,
    boxText: box ? box.textContent || "" : "",
    body: blocks.map((el) => {
      const area = el.querySelector("textarea");
      if (area) return area.value;
      if (el.querySelector(".note-live__blank")) return "";
      if (el.querySelector(".note-live__placeholder")) return "";
      return el.textContent || "";
    }).join("\\n\\n").trim(),
    actions: Array.from(document.querySelectorAll(".review-page__actions button")).map(
      (b) => (b.textContent || "").trim(),
    ),
  };
})()`;

/** Every review file under the open vault, hashed, so "unchanged" is provable. */
function hashReviews(root) {
  const dir = path.join(root, "reviews");
  const out = {};
  const walk = (at) => {
    let entries = [];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        out[path.relative(root, full).split(path.sep).join("/")] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(full))
          .digest("hex");
      }
    }
  };
  walk(dir);
  return out;
}

/** The vault the seeded profile opened, taken from the app itself. */
async function openVaultRoot(win) {
  const snapshot = await win.webContents.executeJavaScript("window.lifequest.vaultGetSnapshot()");
  return snapshot && snapshot.ok ? snapshot.value.rootPath : null;
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-app-"));
  const SOURCE_RECENT = path.join(os.homedir(), "AppData", "Roaming", "LifeQuest", "recent.json");
  if (!fs.existsSync(SOURCE_RECENT)) {
    console.error(`no recent.json at ${SOURCE_RECENT} — cannot open a vault`);
    app.exit(1);
    return;
  }
  fs.copyFileSync(SOURCE_RECENT, path.join(workDir, "recent.json"));

  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();
  const checks = pendingChecks;

  /**
   * What the renderer logged. A page that renders nothing has usually thrown, and
   * a throw is only visible as an error on the console — so this is sampled
   * before every other claim is believed, and reported either way.
   */
  const consoleErrors = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") consoleErrors.push(String(e.message).slice(0, 600));
  });
  checks.consoleErrors = consoleErrors;

  /**
   * What the app is showing right now.
   *
   * A cold boot paints Welcome, then holds a splash while the companion is
   * settled, and only then swaps to the shell — so a rig that waits on one
   * selector and gives up cannot say which of those it was looking at. This is
   * sampled on a failed wait, so the report names the screen instead.
   */
  const screenNow = () =>
    win.webContents.executeJavaScript(`(async () => {
      const splash = document.getElementById("splash");
      let snapshot = null;
      try {
        snapshot = await Promise.race([
          window.lifequest.vaultGetSnapshot(),
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 4000)),
        ]);
      } catch (error) {
        snapshot = { threw: String(error) };
      }
      return {
        url: location.hash || location.pathname,
        rail: Boolean(document.querySelector(".nav-rail")),
        welcome: Boolean(document.querySelector(".welcome")),
        setup: Boolean(document.querySelector(".companion-setup")),
        splash: Boolean(splash) && !splash.hasAttribute("hidden"),
        dashboard: Boolean(document.querySelector(".home-dashboard")),
        /** What React actually put on the page: an empty root is a blank window. */
        rootChildren: document.getElementById("root")?.children.length ?? null,
        rootHtmlLength: (document.getElementById("root")?.innerHTML ?? "").length,
        snapshot: snapshot && snapshot.ok
          ? { ok: true, vault: snapshot.value?.lifequest?.name ?? null }
          : snapshot,
        bodyClass: document.body.className,
        text: (document.body.textContent || "").trim().slice(0, 160),
      };
    })()`);

  await step("boot", async () => {
    try {
      await waitFor(win, `Boolean(document.querySelector(".nav-rail"))`, "the shell to mount", 120_000);
    } catch (error) {
      checks.screenAtShell = await screenNow();
      throw error;
    }
    await waitFor(
      win,
      `Boolean(document.querySelector(".home-dashboard"))`,
      "the vault to open and the Dashboard to mount",
      90_000,
    );
  });

  const root = await step("vault", () => openVaultRoot(win));
  checks.vault = root;
  if (!root) {
    failure("the app reported no open vault, so there is nothing to verify against");
  }
  const before = root ? hashReviews(root) : {};
  checks.reviewsBefore = Object.keys(before).sort();

  // ── the real page, on the real file ──────────────────────────────────────
  const page = await step("review page", async () => {
    await win.webContents.executeJavaScript(`window.location.hash = "#/review/weekly"`);
    await waitFor(win, `Boolean(document.querySelector(".review-page"))`, "the Review page", 60_000);
    // The page opens on the CURRENT week, which may be a week nobody has reviewed.
    // One step back lands on a period the operator has written, which is what this
    // rig is here to read. The step is only taken when there is nothing to read.
    const first = await win.webContents.executeJavaScript(SAMPLE);
    checks.opened = first;
    if (first.boxes === 0) {
      await win.webContents.executeJavaScript(
        `document.querySelector('[data-testid="review-prev"]').click()`,
      );
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="review-editor"]'))`,
        "a review file the operator wrote",
        60_000,
      );
    }
    return win.webContents.executeJavaScript(SAMPLE);
  });
  checks.page = page;
  if (!page.page) failure("the Review page did not render");
  if (page.boxes !== 1) failure(`the real review page drew ${page.boxes} editor boxes`);
  if (page.error) failure(`the real review page reported ${JSON.stringify(page.error)}`);
  if (page.blocks < 3) {
    failure(`the real review file rendered ${page.blocks} block(s), which is not a review`);
  }
  if (page.status !== "Saved") {
    failure(`the real review page's autosave line read ${JSON.stringify(page.status)}`);
  }
  // The file is RENDERED, so its headings are elements and its marks are marks.
  // The box joins its blocks' rendered text, which is why these claims are about
  // the words and not about the `#` characters the renderer has already eaten.
  if (page.headings < 5) {
    failure(`the real review drew ${page.headings} heading(s), which is not a review's skeleton`);
  }
  if (!page.boxText.includes("Look-back") || !page.boxText.includes("Next-period intent")) {
    failure("the real review does not carry its own skeleton headings");
  }
  if (page.body.includes("**") || page.body.includes("## ")) {
    failure("the real review is painted as raw markdown");
  }
  checks.realBlocks = page.blocks;
  checks.realBlanks = page.blanks;
  checks.realHeadings = page.headings;

  // ── the channel join, without writing anything ───────────────────────────
  const bridgeShape = await step("channels", () =>
    win.webContents.executeJavaScript(`({
    skillGet: typeof window.lifequest.reviewSkillGet,
    skillWrite: typeof window.lifequest.reviewSkillWrite,
    prepopulate: typeof window.lifequest.reviewPrepopulate,
    write: typeof window.lifequest.reviewWrite,
    ensure: typeof window.lifequest.reviewEnsure,
  })`),
  );
  checks.bridgeShape = bridgeShape;
  for (const [name, kind] of Object.entries(bridgeShape)) {
    if (kind !== "function") failure(`the preload does not expose review ${name} (${String(kind)})`);
  }

  // A read that must not create a file: the shipped default is answered, and the
  // skill stays unwritten until something actually starts a review.
  const skill = await win.webContents.executeJavaScript("window.lifequest.reviewSkillGet('weekly')");
  checks.skill = skill && skill.ok
    ? {
        exists: skill.value.exists,
        snapshots: skill.value.snapshots.map((s) => s.id),
        problems: skill.value.problems,
        hasFence: skill.value.markdown.includes("lifequest-snapshot"),
      }
    : { error: skill && skill.error };
  if (!skill || skill.ok !== true) {
    failure(`review:skillGet failed in the real process: ${JSON.stringify(skill)}`);
  } else {
    if (skill.value.problems.length > 0) {
      failure(`the shipped weekly skill does not parse: ${JSON.stringify(skill.value.problems)}`);
    }
    if (!skill.value.markdown.includes("lifequest-snapshot")) {
      failure("the shipped weekly skill carries no snapshot directive");
    }
    if (skill.value.exists) {
      // Legitimate once the operator has edited theirs: the claim is only that
      // reading it did NOT create it, which the hash guard below carries.
      checks.skillFilePresent = true;
    }
  }

  // The write channels, asked about a period with no review. Both refuse from the
  // engine's own read — so the refusal IS the proof the channel is registered,
  // because an unregistered one answers "No handler registered for …" instead.
  const prepopulate = await win.webContents.executeJavaScript(
    `window.lifequest.reviewPrepopulate('weekly', ${JSON.stringify(UNREVIEWED)}, 'overall')`,
  );
  checks.prepopulateOnUnreviewed = prepopulate;
  if (!prepopulate || prepopulate.ok !== false) {
    failure(`review:prepopulate did not refuse an unreviewed period: ${JSON.stringify(prepopulate)}`);
  } else if (!/not found/i.test(prepopulate.error)) {
    failure(
      `review:prepopulate answered ${JSON.stringify(prepopulate.error)} — that is not the engine's own read, so the channel may not be registered`,
    );
  }

  const write = await win.webContents.executeJavaScript(
    `window.lifequest.reviewWrite('weekly', ${JSON.stringify(UNREVIEWED)}, '# nope')`,
  );
  checks.writeOnUnreviewed = write;
  if (!write || write.ok !== false) {
    failure(`review:write did not refuse an unreviewed period: ${JSON.stringify(write)}`);
  } else if (!/not found/i.test(write.error)) {
    failure(`review:write answered ${JSON.stringify(write.error)}`);
  }

  // ── the operator's own files, untouched ─────────────────────────────────
  if (root) {
    const after = hashReviews(root);
    checks.reviewsAfter = Object.keys(after).sort();
    const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
    checks.reviewsChanged = changed;
    if (changed.length > 0) {
      failure(`this run changed the operator's review files: ${changed.join(", ")}`);
    }
    if (Object.keys(after).length !== Object.keys(before).length) {
      failure(
        `this run added or removed a review file (${Object.keys(before).length} -> ${Object.keys(after).length})`,
      );
    }
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what:
      "the built app renders the operator's own review file, and the review channels answer " +
      "over the real IPC bridge without writing anything",
    timings,
    checks,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  // A picture of the operator's own review, and nothing that can hang the run:
  // this window is the PRODUCT's, opened hidden, and a window that never paints
  // never fires requestAnimationFrame — so the frame wait is inside the time box
  // with the capture, not before it. The report is already on disk either way.
  try {
    const image = await Promise.race([
      (async () => {
        await win.webContents.executeJavaScript(
          `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
        );
        return win.webContents.capturePage();
      })(),
      new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    if (image) {
      fs.writeFileSync(path.join(artifactsDir, "review-live-app.png"), image.toPNG());
    } else {
      console.error("[review-app] the screenshot timed out; the report stands");
    }
  } catch (err) {
    console.error("[review-app] the screenshot failed:", err);
  }

  console.log(`review page: ${checks.page?.period} · ${checks.page?.blocks} blocks`);
  console.log(`review files: ${JSON.stringify(checks.reviewsBefore)} (unchanged: ${(checks.reviewsChanged ?? []).length === 0})`);
  console.log(`timings (s): ${JSON.stringify(timings)}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  fs.rmSync(workDir, { recursive: true, force: true });
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`review-app rig threw: ${message}`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      REPORT,
      `${JSON.stringify(
        { pass: false, failures: [message], checks: pendingChecks, generatedAt: new Date().toISOString() },
        null,
        2,
      )}\n`,
    );
    app.exit(1);
  });

setTimeout(() => {
  console.error("review-app rig timed out");
  app.exit(1);
}, 300_000);
