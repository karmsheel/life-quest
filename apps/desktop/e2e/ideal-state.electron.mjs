/**
 * Drives the ideal-state harness in a real Electron window and writes
 * `e2e/artifacts/ideal-state.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/ideal-state.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims, no eyeballing the app required.
 *
 * What this rig claims:
 *
 *  1. The Define wing's rail carries Ideal State, and `/ideal-state` is the
 *     active row under that wing.
 *  2. The page lands on the newest document, with its title in the title field
 *     and its prose in the one note box.
 *  3. A body edit autosaves to the document on screen and nowhere else.
 *  4. A rename edits the same document; it does not create a second one.
 *  5. "New document" opens an empty draft with the caret in the title, and a
 *     document is not written until it has a title.
 *  6. A named document is created with the body typed beside its title, and it
 *     appears at the top of the list.
 *  7. Selecting a row loads that document's own title and prose.
 *  8. An idle page writes nothing.
 *  9. A refused write keeps the draft, says why, does not retry by itself, and
 *     Ctrl+S is what releases it.
 * 10. Delete asks first, removes that document and moves the page to another.
 * 11. No save control, one editor box, no unmodelled bridge call, no console
 *     error.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/ideal-state.html";
const SIZE = { width: 1280, height: 900 };
const AUTOSAVE_SETTLE_MS = 2_200;

const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const railItems = Array.from(document.querySelectorAll(".nav-rail__link")).map((el) => ({
    label: text(el.querySelector(".nav-rail__label")),
    href: el.getAttribute("href"),
    active: el.classList.contains("nav-rail__link--active"),
  }));
  const tabs = Array.from(
    document.querySelectorAll(".top-bar__wings .ui-segmented__option"),
  ).map((el) => ({
    label: text(el),
    selected: el.getAttribute("aria-selected") === "true",
  }));
  const box = document.querySelector(".ideal-state .note-live");
  const blocks = box ? Array.from(box.querySelectorAll("[data-note-block]")) : [];
  const body = blocks
    .map((el) => {
      const area = el.querySelector("textarea");
      return area ? area.value : (el.textContent || "");
    })
    .join("\\n\\n")
    .trim();
  const input = document.querySelector('[data-testid="ideal-state-editor-input"]');
  const title = document.querySelector('[data-testid="ideal-state-title"]');
  const status = document.querySelector('[data-testid="ideal-state-status"]');
  const rows = Array.from(document.querySelectorAll(".ideal-state__history-row")).map((row) => {
    const testId = row.getAttribute("data-testid") ?? "";
    return {
      id: testId.startsWith("ideal-state-doc-")
        ? testId.slice("ideal-state-doc-".length)
        : testId,
      title: text(row.querySelector(".ideal-state__history-title")),
      edited: text(row.querySelector(".ideal-state__history-edited")),
      current: row.getAttribute("aria-current") === "true",
      unreadable: row.classList.contains("ideal-state__history-unreadable"),
    };
  });
  return {
    route: window.idealStateRoute ?? null,
    rail: railItems,
    activeRail: railItems.find((item) => item.active)?.label ?? null,
    activeWing: (tabs.find((tab) => tab.selected) ?? {}).label ?? null,
    heading: text(document.querySelector(".ideal-state h1")),
    titleValue: title ? title.value : null,
    titleFocused: document.activeElement === title,
    focusedTestId: document.activeElement ? document.activeElement.getAttribute("data-testid") : null,
    body,
    status: text(status),
    error: text(document.querySelector(".ideal-state .form-error")),
    rows,
    selectedId: rows.find((row) => row.current)?.id ?? null,
    editorBoxes: document.querySelectorAll(".ideal-state .note-live").length,
    splits: document.querySelectorAll(".ideal-state .doc-editor__split").length,
    previews: document.querySelectorAll(".ideal-state .doc-editor__preview").length,
    writingLines: document.querySelectorAll('[data-testid="ideal-state-editor-input"]').length,
    inputValue: input ? input.value : null,
    saveControls: Array.from(document.querySelectorAll(".ideal-state button")).filter((b) =>
      /^save$/i.test(text(b) ?? ""),
    ).length,
    layout: {
      shellClass: document.querySelector(".shell")?.className ?? null,
      compose: rect(document.querySelector(".ideal-state__compose")),
      editor: rect(document.querySelector(".ideal-state__editor")),
      history: rect(document.querySelector(".ideal-state__history")),
      workspace: rect(document.querySelector(".ideal-state__workspace")),
    },
    writes: (window.idealStateWrites ?? []).slice(),
    calls: (window.idealStateCalls ?? []).slice(),
    unexpected: (window.idealStateUnexpectedCalls ?? []).slice(),
    store: Object.fromEntries(
      [...(window.idealStateStore ?? new Map())].map(([id, doc]) => [
        id,
        { title: doc.title, body: doc.bodyMarkdown },
      ]),
    ),
  };
})()`;

const failures = [];
const check = (name, condition, detail) => {
  if (!condition) failures.push(`${name} — ${detail}`);
  return Boolean(condition);
};

async function run() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const js = (expression) => win.webContents.executeJavaScript(expression, true);

  const waitFor = async (expression, label, timeoutMs = 12_000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await js(expression);
        if (last) return true;
      } catch (error) {
        last = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    check(`wait: ${label}`, false, `never became true (last ${JSON.stringify(last)})`);
    return false;
  };

  const waitForHarness = async () => {
    const deadline = Date.now() + 30_000;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await js(`(async () => {
          if (typeof window.idealStateReady !== "boolean") return null;
          return window.idealStateReady === true;
        })()`);
        if (ready === true) return true;
        lastError = "harness not ready yet";
      } catch (error) {
        lastError = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  const sample = () => js(SAMPLE);
  const writesOf = () => js("window.idealStateWrites ?? []");
  const waitForWrite = async (count, label) => {
    await waitFor(
      `(window.idealStateWrites ?? []).length > ${count}`,
      label,
      AUTOSAVE_SETTLE_MS + 8_000,
    );
    return writesOf();
  };
  const waitForSaved = () =>
    waitFor(
      `document.querySelector('[data-testid="ideal-state-status"]')?.textContent.trim() === "Saved"`,
      "the page to report its write",
    );
  const idle = (ms) =>
    js(`new Promise((resolve) => setTimeout(resolve, ${ms}))`);

  const click = (testId) =>
    js(`(() => {
      const el = document.querySelector('[data-testid="${testId}"]');
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const clickSelector = (selector) =>
    js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const setTitle = (value) =>
    js(`(() => {
      const el = document.querySelector('[data-testid="ideal-state-title"]');
      if (!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

  const openBlock = async (index) => {
    await js(`(() => {
      const block = document.querySelectorAll(".ideal-state [data-note-block]")[${index}];
      if (!block) return false;
      block.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      return true;
    })()`);
    await waitFor(
      `Boolean(document.querySelector('[data-testid="ideal-state-editor-input"]'))`,
      `paragraph ${index} to open`,
    );
  };

  const type = async (value) => {
    const open = await js(
      `Boolean(document.querySelector('[data-testid="ideal-state-editor-input"]'))`,
    );
    if (!open) await openBlock(0);
    return js(`(() => {
      const el = document.querySelector('[data-testid="ideal-state-editor-input"]');
      if (!el) return null;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return el.value;
    })()`);
  };

  const leaveTheLine = async () => {
    await js(`(() => {
      const el = document.querySelector('[data-testid="ideal-state-editor-input"]');
      if (!el) return;
      el.blur();
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    })()`);
    await waitFor(
      `!document.querySelector('[data-testid="ideal-state-editor-input"]')`,
      "the writing line to close",
    );
  };

  const pressShortcut = () =>
    js(`(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    })()`);

  const shoot = async (name) => {
    const file = path.join(artifactsDir, `ideal-state-${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return file;
  };

  const screenshots = [];
  const checks = {};
  let report;
  const timeout = setTimeout(() => {
    console.error("ideal-state: timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    await win.loadURL(url);
    await waitForHarness();
    win.setContentSize(SIZE.width, SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    // ── 1. the Define rail, and the newest document on landing ───────────────
    const landing = await sample();
    checks.landing = landing;
    check("shell rendered", landing.route === "/ideal-state", `route ${landing.route}`);
    check(
      "the Define rail carries Ideal State",
      landing.rail.some((item) => item.label === "Ideal State"),
      `rail ${JSON.stringify(landing.rail.map((item) => item.label))}`,
    );
    check(
      "Ideal State is the active rail row",
      landing.activeRail === "Ideal State",
      `active ${landing.activeRail}`,
    );
    check("the Define wing is selected", landing.activeWing === "Define", `wing ${landing.activeWing}`);
    check("the page rendered", landing.heading === "Ideal State", `h1 ${landing.heading}`);
    check(
      "the newest document was opened",
      landing.titleValue === "A calm morning",
      `title ${JSON.stringify(landing.titleValue)}`,
    );
    check(
      "its prose is in the one box",
      (landing.body ?? "").includes("Wake before the house.") &&
        (landing.body ?? "").includes("Walk while it is quiet."),
      `body ${JSON.stringify(landing.body)}`,
    );
    check("a loaded document is saved", landing.status === "Saved", `status ${landing.status}`);
    check(
      "both documents are listed, newest first",
      JSON.stringify(landing.rows.map((row) => row.id)) ===
        JSON.stringify(["doc-alpha", "doc-beta"]),
      `rows ${JSON.stringify(landing.rows)}`,
    );
    check(
      "the newest row is marked as the one on screen",
      landing.selectedId === "doc-alpha",
      `selected ${landing.selectedId}`,
    );
    check("the page draws one editor box", landing.editorBoxes === 1, `boxes ${landing.editorBoxes}`);
    check("there is no split editor", landing.splits === 0, `splits ${landing.splits}`);
    check("there is no preview pane", landing.previews === 0, `previews ${landing.previews}`);
    check("there is no save control", landing.saveControls === 0, `save controls ${landing.saveControls}`);
    check("landing wrote nothing", landing.writes.length === 0, `writes ${JSON.stringify(landing.writes)}`);
    check("no error at landing", !landing.error, `error ${JSON.stringify(landing.error)}`);
    check(
      "the page read the newest document",
      landing.calls.includes("idealStateGet:doc-alpha"),
      `calls ${JSON.stringify(landing.calls)}`,
    );
    screenshots.push(await shoot("landing"));

    // ── 2. a body edit autosaves to the document on screen ───────────────────
    await openBlock(1);
    const changed = "Walk while it is quiet, then write.";
    await type(changed);
    const bodyWrites = await waitForWrite(0, "the body edit to write itself");
    checks.bodyWrites = bodyWrites;
    const bodyWrite = bodyWrites[bodyWrites.length - 1];
    check(
      "the body edit wrote the document on screen",
      bodyWrite?.op === "update" && bodyWrite?.id === "doc-alpha",
      `write ${JSON.stringify(bodyWrite)}`,
    );
    check(
      "the write carried the edited prose",
      (bodyWrite?.body ?? "").includes(changed),
      `body ${JSON.stringify(bodyWrite?.body)}`,
    );
    check(
      "the write came from the visible document",
      bodyWrite?.shownId === "doc-alpha",
      `shown ${bodyWrite?.shownId}`,
    );
    await waitForSaved();
    await leaveTheLine();
    const afterBody = await sample();
    checks.afterBody = afterBody;
    check(
      "the box settled into the two paragraphs",
      (afterBody.body ?? "").includes("Wake before the house.") &&
        (afterBody.body ?? "").includes(changed),
      `body ${JSON.stringify(afterBody.body)}`,
    );
    check(
      "the vault holds the edit",
      (afterBody.store["doc-alpha"]?.body ?? "").includes(changed),
      `store ${JSON.stringify(afterBody.store["doc-alpha"])}`,
    );

    // ── 3. a rename edits the same document ──────────────────────────────────
    const beforeRename = (await writesOf()).length;
    await setTitle("A calm, strong morning");
    const titleWrites = await waitForWrite(beforeRename, "the rename to write itself");
    checks.titleWrites = titleWrites;
    const titleWrite = titleWrites[titleWrites.length - 1];
    check(
      "the rename wrote the same document",
      titleWrite?.op === "update" && titleWrite?.id === "doc-alpha",
      `write ${JSON.stringify(titleWrite)}`,
    );
    check(
      "the rename carried the new title",
      titleWrite?.title === "A calm, strong morning",
      `title ${JSON.stringify(titleWrite?.title)}`,
    );
    check(
      "the rename did not create a document",
      titleWrites.filter((write) => write.op === "create").length === 0,
      `creates ${titleWrites.filter((write) => write.op === "create").length}`,
    );
    await waitForSaved();
    await waitFor(
      `Array.from(document.querySelectorAll(".ideal-state__history-title")).some((el) => el.textContent.trim() === "A calm, strong morning")`,
      "the renamed row to appear",
    );
    const afterRename = await sample();
    checks.afterRename = afterRename;
    check(
      "the list shows the new title",
      afterRename.rows.some((row) => row.title === "A calm, strong morning"),
      `rows ${JSON.stringify(afterRename.rows)}`,
    );
    check(
      "the file kept its id",
      afterRename.rows.filter((row) => row.id === "doc-alpha").length === 1,
      `rows ${JSON.stringify(afterRename.rows)}`,
    );

    // ── 4. New document: empty, titled, and not written before it has a title ─
    const beforeNew = (await writesOf()).length;
    check("New document clicked", await click("ideal-state-new"), "no New document control");
    await waitFor(
      `document.querySelector('[data-testid="ideal-state-title"]')?.value === ""` +
        ` && (document.querySelector(".ideal-state .note-live")?.textContent ?? "").trim() === ""` +
        ` && !document.querySelector('[data-testid="ideal-state-editor-input"]')`,
      "an empty new draft",
    );
    const blank = await sample();
    checks.blank = blank;
    check("the new draft is empty", blank.body === "", `body ${JSON.stringify(blank.body)}`);
    check(
      "the page asks for a title",
      blank.status === "Give this document a title",
      `status ${blank.status}`,
    );
    check(
      "the caret is in the title field",
      blank.focusedTestId === "ideal-state-title",
      `focused ${blank.focusedTestId}`,
    );
    check(
      "an untitled draft wrote nothing",
      (await writesOf()).length === beforeNew,
      `writes ${JSON.stringify(await writesOf())}`,
    );

    await setTitle("A house by the sea");
    const newBody = "Wake to the water.\n\nWrite before the world wakes.";
    await type(newBody);
    const createWrites = await waitForWrite(beforeNew, "the new document to write itself");
    checks.createWrites = createWrites;
    const createWrite = createWrites[createWrites.length - 1];
    check(
      "the new document was created, once",
      createWrites.filter((write) => write.op === "create").length === 1,
      `creates ${createWrites.filter((write) => write.op === "create").length}`,
    );
    check(
      "the create carried its title and body",
      createWrite?.op === "create" &&
        createWrite?.title === "A house by the sea" &&
        (createWrite?.body ?? "").includes("Wake to the water."),
      `write ${JSON.stringify(createWrite)}`,
    );
    check(
      "the create came from the visible draft",
      createWrite?.shownTitle === "A house by the sea",
      `shown ${JSON.stringify(createWrite?.shownTitle)}`,
    );
    await waitForSaved();
    await leaveTheLine();
    await waitFor(
      `document.querySelectorAll(".ideal-state__history-row").length === 3`,
      "three documents in the strip",
    );
    const afterNew = await sample();
    checks.afterNew = afterNew;
    check(
      "the new document leads the list",
      afterNew.rows.length === 3 && afterNew.rows[0]?.title === "A house by the sea",
      `rows ${JSON.stringify(afterNew.rows)}`,
    );
    check(
      "the new document is the one on screen",
      afterNew.selectedId === createWrite?.id,
      `selected ${afterNew.selectedId}, created ${createWrite?.id}`,
    );
    check(
      "the vault holds the new document",
      Object.values(afterNew.store).some(
        (doc) => doc.title === "A house by the sea" && doc.body.includes("Write before the world wakes."),
      ),
      `store ${JSON.stringify(afterNew.store)}`,
    );

    // ── 5. selecting a row loads that document ───────────────────────────────
    check("the older row clicked", await click("ideal-state-doc-doc-beta"), "no beta row");
    await waitFor(
      `document.querySelector('[data-testid="ideal-state-title"]')?.value === "Work that matters"` +
        ` && (document.querySelector(".ideal-state .note-live")?.textContent ?? "").includes("Build one thing well.")`,
      "the older document to load",
    );
    const switched = await sample();
    checks.switched = switched;
    check(
      "the row loaded its own prose",
      (switched.body ?? "").includes("Build one thing well."),
      `body ${JSON.stringify(switched.body)}`,
    );
    check(
      "the row is marked current",
      switched.selectedId === "doc-beta",
      `selected ${switched.selectedId}`,
    );
    check("a loaded document is saved", switched.status === "Saved", `status ${switched.status}`);

    // ── 6. a refused write keeps the draft and waits for the operator ────────
    await click("ideal-state-new");
    await waitFor(
      `document.querySelector('[data-testid="ideal-state-title"]')?.value === ""` +
        ` && (document.querySelector(".ideal-state .note-live")?.textContent ?? "").trim() === ""` +
        ` && !document.querySelector('[data-testid="ideal-state-editor-input"]')`,
      "a second new draft",
    );
    await js("window.idealStateFailNextWrite = true");
    const beforeRefusal = (await writesOf()).length;
    await setTitle("Refused document");
    const refusedWrites = await waitForWrite(beforeRefusal, "the refused write to land");
    checks.refusedWrites = refusedWrites;
    await waitFor(
      `document.querySelector('[data-testid="ideal-state-status"]')?.textContent.trim() === "Not saved"`,
      "the refusal to be reported",
    );
    const refused = await sample();
    checks.refused = refused;
    check(
      "the refusal is on screen with a reason",
      (refused.error ?? "").includes("refused"),
      `error ${JSON.stringify(refused.error)}`,
    );
    check(
      "the draft is still there",
      refused.titleValue === "Refused document",
      `title ${JSON.stringify(refused.titleValue)}`,
    );
    check(
      "a refused create did not make a document",
      Object.keys(refused.store).length === 3,
      `store ${JSON.stringify(Object.keys(refused.store))}`,
    );
    const quietBefore = (await writesOf()).length;
    await idle(AUTOSAVE_SETTLE_MS);
    const quietAfter = (await writesOf()).length;
    check(
      "a refused write is not retried by itself",
      quietAfter === quietBefore,
      `wrote ${quietAfter - quietBefore} more time(s)`,
    );
    await pressShortcut();
    await waitFor(
      `(window.idealStateWrites ?? []).filter((write) => write.op === "create" && write.id !== null).length === 2`,
      "Ctrl+S to release the refused draft",
    );
    await waitForSaved();
    const recovered = await sample();
    checks.recovered = recovered;
    check(
      "the released draft became a document",
      Object.values(recovered.store).some((doc) => doc.title === "Refused document"),
      `store ${JSON.stringify(recovered.store)}`,
    );
    check(
      "the released document is on screen",
      recovered.status === "Saved",
      `status ${recovered.status}`,
    );

    // ── 7. an idle page writes nothing ───────────────────────────────────────
    const idleBefore = (await writesOf()).length;
    await idle(AUTOSAVE_SETTLE_MS);
    const idleAfter = (await writesOf()).length;
    checks.idleWrites = { before: idleBefore, after: idleAfter };
    check(
      "an untouched page writes nothing",
      idleAfter === idleBefore,
      `wrote ${idleAfter - idleBefore} more time(s)`,
    );

    // ── 8. delete asks, removes that document, and moves the page ────────────
    const deleteId = recovered.selectedId;
    const createdIds = recovered.rows.map((row) => row.id);
    check("Delete clicked", await click("ideal-state-delete"), "no Delete control");
    await waitFor(
      `Boolean(document.querySelector(".confirm-dialog__confirm"))`,
      "the delete question",
    );
    await clickSelector(".confirm-dialog__confirm");
    await waitFor(
      `document.querySelectorAll(".ideal-state__history-row").length === ${createdIds.length - 1}`,
      "the document to leave the strip",
    );
    const afterDelete = await sample();
    checks.afterDelete = afterDelete;
    check(
      "the deleted document is gone from the vault",
      !(deleteId in afterDelete.store),
      `store ${JSON.stringify(Object.keys(afterDelete.store))}`,
    );
    check(
      "the page moved to another document",
      afterDelete.selectedId !== deleteId && afterDelete.selectedId !== null,
      `selected ${afterDelete.selectedId}`,
    );
    check(
      "the delete was recorded once",
      afterDelete.writes.filter((write) => write.op === "delete").length === 1,
      `writes ${JSON.stringify(afterDelete.writes)}`,
    );

    // ── 9. the wide page keeps the box and the strip side by side ────────────
    win.setContentSize(1800, 1040);
    await waitFor(
      `window.innerWidth >= 1790`,
      "the wide window",
    );
    await js(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const wide = await sample();
    checks.wide = wide.layout;
    const { compose, editor, history } = wide.layout;
    if (!compose || !editor || !history) {
      check("the wide page has a box and a strip", false, JSON.stringify(wide.layout));
    } else {
      check(
        "the strip shares the box's top edge",
        Math.abs(history.top - compose.top) <= 4,
        `strip ${history.top}, compose ${compose.top}`,
      );
      check(
        "with the chat on the right, the strip leads",
        history.left + history.width <= compose.left,
        `strip ${history.left}+${history.width}, compose ${compose.left}`,
      );
    }
    screenshots.push(await shoot("wide"));
    win.setContentSize(SIZE.width, SIZE.height);
    await waitFor(`window.innerWidth <= ${SIZE.width + 10}`, "the default window");

    // ── 10. nothing unexpected ───────────────────────────────────────────────
    const final = await sample();
    checks.final = final;
    check(
      "no unmodelled bridge call",
      final.unexpected.length === 0,
      `unexpected ${JSON.stringify(final.unexpected)}`,
    );
    check("no error is on screen", !final.error, `error ${JSON.stringify(final.error)}`);
    check(
      "the round trip left three documents",
      final.rows.length === 3,
      `rows ${JSON.stringify(final.rows)}`,
    );
    screenshots.push(await shoot("page"));

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...SIZE },
      checks,
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

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "ideal-state.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`rail:       ${JSON.stringify(report.checks?.landing?.rail?.map((item) => item.label) ?? null)}`);
  console.log(`landing:    ${JSON.stringify(report.checks?.landing?.titleValue ?? null)} — ${JSON.stringify(report.checks?.landing?.status ?? null)}`);
  console.log(`writes:     ${JSON.stringify(report.checks?.final?.writes?.map((write) => write.op) ?? null)}`);
  console.log(`documents:  ${JSON.stringify(report.checks?.final?.rows?.map((row) => row.title) ?? null)}`);
  console.log(`failures:   ${failures.length === 0 ? "none" : failures.join("; ")}`);

  win.destroy();
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(run, (error) => {
  console.error(error);
  app.exit(1);
});

setTimeout(() => {
  console.error("ideal-state rig timed out");
  app.exit(1);
}, 120_000);
