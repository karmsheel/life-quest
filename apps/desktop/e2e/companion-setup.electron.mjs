/**
 * Drives the companion setup screen — the "Agent connecting" screen — in a
 * real Electron window and turns the measurements into
 * `e2e/artifacts/companion-setup.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/companion-setup.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * This rig answers the complaint the feature was built for: the app was stuck
 * on a connect screen that offered only Recheck and a docs link, with no way
 * to see the Hermes profiles this machine actually has or to pick one. Every
 * failure mode is listed in `companion-setup.tsx`; this driver is where they
 * are asserted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/companion-setup.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const SAMPLE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right),
      bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const rows = Array.from(document.querySelectorAll(".companion-profile-list .companion-profile-row"));
  const create = document.querySelector(".companion-profile-row--create");
  const muted = Array.from(document.querySelectorAll(".welcome-card > p.muted"));
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    heading: text(document.querySelector(".welcome-card h1")),
    title: text(muted[0]),
    body: text(muted[1]) || null,
    empty: Boolean(document.querySelector(".companion-profile-picker__empty")),
    rows: rows.map((row) => ({
      name: row.getAttribute("aria-label"),
      checked: row.getAttribute("aria-checked"),
      disabled: row.disabled === true,
      tag: text(row.querySelector(".companion-profile-row__tag")) || null,
      desc: text(row.querySelector(".companion-profile-row__desc")),
      inUse: text(row.querySelector(".companion-profile-row__in-use")) || null,
      box: box(row)
    })),
    createRow: create
      ? {
          checked: create.getAttribute("aria-checked"),
          disabled: create.disabled === true,
          label: create.getAttribute("aria-label"),
          box: box(create)
        }
      : null,
    recheck: (() => {
      const btn = document.querySelector(".welcome-actions .btn");
      return btn ? { label: text(btn), disabled: btn.disabled === true, box: box(btn) } : null;
    })(),
    docsHref: (() => {
      const link = document.querySelector(".welcome-actions a");
      return link ? link.getAttribute("href") : null;
    })(),
    listBox: box(document.querySelector(".companion-profile-list")),
    useCalls: window.__lqUseCalls ?? [],
    ensureCalls: window.__lqEnsureCalls ?? 0,
    active: window.__lqActive ?? null,
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // Paint it in the theme the app itself defaults to, so a test run is not a
  // white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 260) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  /** One profile row, by the aria-label the picker wears. */
  const clickRow = (label) =>
    run(`(async () => {
      const el = document.querySelector('.companion-profile-row[aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']');
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    })()`);

  const clickRecheck = () =>
    run(`(async () => {
      const el = document.querySelector('.welcome-actions .btn');
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    })()`);

  const setKind = (ensureKind, useKind) =>
    run(`(() => {
      window.__lqEnsureKind = ${JSON.stringify(ensureKind)};
      window.__lqUseKind = ${JSON.stringify(useKind)};
      return true;
    })()`);

  const setDelay = (ms) =>
    run(`(() => { window.__lqEnsureDelay = ${JSON.stringify(ms)}; return true; })()`);

  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `companion-setup-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  let report;
  const screenshots = [];
  const timeout = setTimeout(() => {
    console.error("companion-setup: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatSetupHarnessReady.then(() => true)");
    const expected = await run("window.chatSetupExpected");

    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    // 1 — the stuck connect the operator complained about: the screen still
    // says what went wrong, and now it also lists every profile on the
    // machine, with the app's own `lifequest` offered for creation.
    const stuck = await settle();
    check(
      "the stuck screen still names its failure",
      stuck.body?.includes("Host gateway did not serve /p/coder") === true,
      `body ${JSON.stringify(stuck.body)}`,
    );
    check(
      "the picker lists every installed profile",
      JSON.stringify(stuck.rows.map((row) => row.name)) ===
        JSON.stringify(expected.names.map((name) => `Use the ${name} profile`)),
      `rows ${JSON.stringify(stuck.rows.map((row) => row.name))} vs ${JSON.stringify(expected.names)}`,
    );
    check(
      "the default profile is marked as the default",
      stuck.rows[0]?.tag === "default" &&
        stuck.rows.slice(1).every((row) => row.tag === null),
      `tags ${JSON.stringify(stuck.rows.map((row) => row.tag))}`,
    );
    check(
      "a profile with no SOUL of its own is not claimed to have one",
      stuck.rows[1]?.desc?.includes("has config") === true &&
        stuck.rows[1]?.desc?.includes("has SOUL") === false,
      `desc ${JSON.stringify(stuck.rows[1]?.desc)}`,
    );
    check(
      "the lifequest profile is offered for creation when it does not exist",
      stuck.createRow?.label === "Create and use the lifequest profile",
      `create row ${JSON.stringify(stuck.createRow)}`,
    );
    check(
      "nothing installed is marked in use while the app is on an unlisted profile",
      stuck.rows.every((row) => row.inUse === null && row.checked === "false") &&
        stuck.createRow?.checked === "true",
      `in-use marks ${JSON.stringify(stuck.rows.map((row) => row.inUse))}, create row ${JSON.stringify(stuck.createRow?.checked)}`,
    );
    check(
      "Recheck survives the picker landing",
      stuck.recheck?.label === "Recheck" && stuck.recheck?.disabled === false,
      `recheck ${JSON.stringify(stuck.recheck)}`,
    );
    check(
      "needs_install keeps its docs link and nothing else does",
      stuck.docsHref === null,
      `docs link ${JSON.stringify(stuck.docsHref)}`,
    );
    check(
      "nothing spills past the window",
      stuck.overflow.scrollWidth <= stuck.overflow.clientWidth,
      `scrollWidth ${stuck.overflow.scrollWidth}px vs window ${stuck.overflow.clientWidth}px`,
    );
    screenshots.push(await shot("stuck"));

    // 2 — picking an installed profile reaches the bridge with that name, and
    // the row reads "In use" from then on.
    const picked = await clickRow("Use the coder profile");
    const switched = await settle();
    check("clicked a profile row", picked, "no row for the coder profile");
    check(
      "the switch reached the bridge with the profile's name",
      JSON.stringify(switched.useCalls) === JSON.stringify(["coder"]),
      `bridge saw ${JSON.stringify(switched.useCalls)}`,
    );
    check(
      "the chosen profile is marked in use",
      switched.rows.find((row) => row.name === "Use the coder profile")?.inUse === "In use" &&
        switched.rows.find((row) => row.name === "Use the coder profile")?.checked === "true",
      `rows ${JSON.stringify(switched.rows.map((row) => [row.name, row.inUse]))}`,
    );
    check(
      "the other rows are not marked",
      switched.rows
        .filter((row) => row.name !== "Use the coder profile")
        .every((row) => row.inUse === null && row.checked === "false"),
      `rows ${JSON.stringify(switched.rows.map((row) => [row.name, row.inUse]))}`,
    );
    check(
      "a switch that still cannot attach keeps the screen, not a blank one",
      switched.title === "Connecting to your LifeQuest companion…" ||
        switched.body !== null,
      `title ${JSON.stringify(switched.title)}, body ${JSON.stringify(switched.body)}`,
    );

    // 3 — a switch that fails outright: the operator is not stranded. The
    // picker stays, the new profile stays marked, and Recheck still answers.
    await setKind("gateway_exited", "disconnected");
    const failedClicked = await clickRow("Use the default profile");
    const failed = await settle();
    check("clicked the default profile row", failedClicked, "no default row");
    check(
      "a failed switch says why",
      failed.body ===
        "Could not reach the default profile on the Hermes host gateway.",
      `body ${JSON.stringify(failed.body)}`,
    );
    check(
      "a failed switch keeps every row and the create row",
      failed.rows.length === expected.names.length && failed.createRow !== null,
      `${failed.rows.length} rows, create row ${JSON.stringify(failed.createRow)}`,
    );
    check(
      "the failed switch still moves the in-use mark",
      failed.rows.find((row) => row.name === "Use the default profile")?.inUse === "In use",
      `rows ${JSON.stringify(failed.rows.map((row) => [row.name, row.inUse]))}`,
    );
    const rechecked = await clickRecheck();
    const afterRecheck = await settle();
    check("clicked Recheck", rechecked, "no Recheck control");
    check(
      "Recheck after a failed switch runs the ensure again",
      afterRecheck.ensureCalls > failed.ensureCalls,
      `ensure calls ${failed.ensureCalls} → ${afterRecheck.ensureCalls}`,
    );

    // 4 — creating the app's own profile: the create row reaches the bridge
    // with exactly `lifequest`, and then offers itself no longer.
    await setKind("gateway_exited", "gateway_exited");
    const createClicked = await clickRow("Create and use the lifequest profile");
    const created = await settle();
    check("clicked the create row", createClicked, "no create row");
    check(
      "the create row switched the bridge to the lifequest profile",
      created.useCalls.at(-1) === "lifequest",
      `bridge saw ${JSON.stringify(created.useCalls)}`,
    );
    check(
      "the create row marks itself in use",
      created.createRow?.checked === "true",
      `create row ${JSON.stringify(created.createRow)}`,
    );

    // 5 — a switch that lands: the error copy is gone and the chosen profile
    // is the one the app is on.
    await setKind("gateway_exited", "ready");
    const landedClicked = await clickRow("Use the default profile");
    const landed = await settle();
    check("clicked a profile row while a ready switch was queued", landedClicked, "no row");
    check(
      "a switch that attaches drops the error copy",
      landed.body === null || landed.body?.includes("did not serve") === false,
      `body ${JSON.stringify(landed.body)}`,
    );
    check(
      "the attached profile is the one marked in use",
      landed.rows.find((row) => row.name === "Use the default profile")?.inUse === "In use",
      `rows ${JSON.stringify(landed.rows.map((row) => [row.name, row.inUse]))}`,
    );

    // 6 — mid-flight: while an ensure is running, no row may be clicked. A
    // second switch racing the first gateway start is how the host ends up
    // with two lifecycles at once.
    await setKind("gateway_exited", "gateway_exited");
    await setDelay(500);
    const inflightClicked = await clickRow("Use the coder profile");
    const inflight = await settle(120);
    check("clicked a row with a slow ensure in flight", inflightClicked, "no row");
    check(
      "every row is inert while the ensure runs",
      inflight.rows.every((row) => row.disabled === true) &&
        (inflight.createRow?.disabled ?? false) === true,
      `disabled flags ${JSON.stringify(inflight.rows.map((row) => row.disabled))}, create ${inflight.createRow?.disabled}`,
    );
    check(
      "Recheck reads Connecting… while the ensure runs",
      inflight.recheck?.label === "Connecting…" && inflight.recheck?.disabled === true,
      `recheck ${JSON.stringify(inflight.recheck)}`,
    );
    check(
      "the in-flight switch reached the bridge exactly once",
      inflight.useCalls.length === landed.useCalls.length + 1,
      `bridge saw ${JSON.stringify(inflight.useCalls)} vs ${JSON.stringify(landed.useCalls)}`,
    );
    await settle(500);
    await setDelay(0);

    // 7 — an unreadable profiles list must not take the screen down: the
    // operator still gets Recheck, exactly as before the picker existed. The
    // failure has to happen at boot (the list is read once), so this is a
    // second load with the flag carried in the URL; the ensure counter resets
    // with the page, so this asserts the ensure ran at all.
    await win.loadURL(`${url}?profilesFail=1`);
    await run("window.chatSetupHarnessReady.then(() => true)");
    const noList = await settle(400);
    check(
      "a failed profiles read degrades to Recheck, not a blank screen",
      noList.empty === true && noList.recheck?.label !== null,
      `empty ${noList.empty}, recheck ${JSON.stringify(noList.recheck)}`,
    );
    check(
      "the heading survives a failed profiles read",
      noList.heading === "LifeQuest companion",
      `heading ${JSON.stringify(noList.heading)}`,
    );
    check(
      "a failed profiles read still runs the ensure",
      noList.ensureCalls >= 1,
      `ensure calls ${noList.ensureCalls} (the counter resets with the reload)`,
    );
    screenshots.push(await shot("no-profiles"));

    // 8 — needs_install is the one state with a docs link, and the picker
    // does not eat it. Loaded fresh again, so the flag from step 7 is gone.
    await win.loadURL(url);
    await run("window.chatSetupHarnessReady.then(() => true)");
    await run(
      "(() => { window.__lqEnsureKind = 'needs_install'; window.__lqUseKind = 'needs_install'; return true; })()",
    );
    const installClicked = await clickRecheck();
    const install = await settle();
    check("clicked Recheck into needs_install", installClicked, "no Recheck control");
    check(
      "needs_install keeps its docs link",
      install.docsHref === "https://hermes-agent.nousresearch.com/docs/",
      `docs link ${JSON.stringify(install.docsHref)}`,
    );
    check(
      "the picker is still up next to the docs link",
      install.rows.length === expected.names.length,
      `${install.rows.length} rows`,
    );
    screenshots.push(await shot("needs-install"));

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      fixture: expected,
      states: {
        stuck,
        switched,
        failed,
        afterRecheck,
        created,
        landed,
        inflight,
        noList,
        install,
      },
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
        `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "companion-setup.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "companion setup: PASS" : "companion setup: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`companion-setup: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
