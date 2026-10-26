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
 * 10. Delete lives in a row's 3-dot menu, asks first, removes the row's own
 *     document, leaves the editor alone when another row's document goes, and
 *     moves the page to another when the document on screen is the one removed.
 * 11. "+ New document" lives beside the Documents heading rather than over the
 *     box, and the title field carries no "Title" eyebrow.
 * 12. With room for two columns the strip takes the page's leading edge — the
 *     one away from the chat — and the gap between it and the box grows with the
 *     window; moving the chat to the left swaps the pair.
 * 13. No save control, one editor box, no unmodelled bridge call, no console
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
      viewport: { width: window.innerWidth, height: window.innerHeight },
      compose: rect(document.querySelector(".ideal-state__compose")),
      editor: rect(document.querySelector(".ideal-state__editor")),
      history: rect(document.querySelector(".ideal-state__history")),
      workspace: rect(document.querySelector(".ideal-state__workspace")),
      newControl: rect(document.querySelector('[data-testid="ideal-state-new"]')),
      historyHeading: rect(document.querySelector(".ideal-state__history-heading h2")),
      pageHeading: rect(document.querySelector(".ideal-state__header h1")),
      titleLabel: document.querySelectorAll(".ideal-state__title-label").length,
      deleteUnderEditor: document.querySelectorAll(
        '.ideal-state__compose [data-testid="ideal-state-delete"]',
      ).length,
      rowMenus: Array.from(document.querySelectorAll(".ideal-state__history-item")).map(
        (item) => ({
          row: rect(item.querySelector(".ideal-state__history-row")),
          menu: rect(item.querySelector(".ideal-state__row-menu-btn")),
        }),
      ),
      openMenus: document.querySelectorAll(".ideal-state__row-menu").length,
      openMenuBox: rect(document.querySelector(".ideal-state__row-menu")),
      chrome: {
        nav: rect(document.querySelector(".nav-rail")),
        sheet: rect(document.querySelector(".shell__main")),
        content: rect(document.querySelector(".shell__content")),
        chat: rect(document.querySelector(".chat-panel")),
      },
      openMenuItems: Array.from(
        document.querySelectorAll('.ideal-state__row-menu [role="menuitem"]'),
      ).map((el) => text(el)),
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
    check(
      "the title field carries no eyebrow",
      landing.layout.titleLabel === 0,
      `eyebrow labels ${landing.layout.titleLabel}`,
    );
    check(
      "no Delete control sits under the editor",
      landing.layout.deleteUnderEditor === 0,
      `delete controls in the compose column ${landing.layout.deleteUnderEditor}`,
    );
    check(
      "no row menu is open until asked",
      landing.layout.openMenus === 0,
      `open menus ${landing.layout.openMenus}`,
    );
    check(
      "the page draws both the box and the strip",
      Boolean(landing.layout.history && landing.layout.compose),
      JSON.stringify(landing.layout),
    );
    if (landing.layout.history && landing.layout.newControl && landing.layout.historyHeading) {
      const { history, newControl, historyHeading } = landing.layout;
      check(
        "+ New document sits in the strip, on the Documents heading line",
        newControl.left >= history.left &&
          newControl.left + newControl.width <= history.left + history.width + 1 &&
          Math.abs(
            newControl.top + newControl.height / 2 -
              (historyHeading.top + historyHeading.height / 2),
          ) <= 6,
        `new ${JSON.stringify(newControl)}, heading ${JSON.stringify(historyHeading)}`,
      );
    }
    for (const { row, menu } of landing.layout.rowMenus) {
      if (!row || !menu) {
        check("every row has a 3-dot", false, JSON.stringify({ row, menu }));
        continue;
      }
      check(
        "each 3-dot sits at the end of its row",
        menu.left >= row.left &&
          menu.left + menu.width <= row.left + row.width &&
          row.left + row.width - (menu.left + menu.width) <= 12 &&
          Math.abs(menu.top + menu.height / 2 - (row.top + row.height / 2)) <= 6,
        `row ${JSON.stringify(row)}, menu ${JSON.stringify(menu)}`,
      );
    }
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

    // ── 8. delete lives in the row's own menu, not under the editor ──────────
    const beforeDelete = recovered;
    const deleteId = beforeDelete.selectedId;
    const victim = beforeDelete.rows.find((row) => row.id !== deleteId);
    check(
      "there is a second row to delete from its menu",
      Boolean(victim),
      `rows ${JSON.stringify(beforeDelete.rows)}`,
    );

    const openRowMenu = async (id) => {
      check(
        `the row menu for ${id} opened`,
        await click(`ideal-state-doc-menu-${id}`),
        "no row menu control",
      );
      await waitFor(
        `document.querySelectorAll('.ideal-state__row-menu [role="menuitem"]').length === 1`,
        "the row menu",
      );
    };
    const askToDelete = async () => {
      await waitFor(
        `Boolean(document.querySelector(".confirm-dialog__confirm"))`,
        "the delete question",
      );
    };
    const confirmTheDelete = async (expectedRows) => {
      await clickSelector(".confirm-dialog__confirm");
      await waitFor(
        `document.querySelectorAll(".ideal-state__history-row").length === ${expectedRows}`,
        "the document to leave the strip",
      );
    };

    if (victim) {
      await openRowMenu(victim.id);
      const rowMenu = await sample();
      check(
        "the row menu offers Delete and nothing else",
        JSON.stringify(rowMenu.layout.openMenuItems) === '["Delete"]',
        `items ${JSON.stringify(rowMenu.layout.openMenuItems)}`,
      );
      screenshots.push(await shoot("row-menu"));
      check(
        "the open menu is fully inside the window",
        Boolean(rowMenu.layout.openMenuBox) &&
          Boolean(rowMenu.layout.viewport) &&
          rowMenu.layout.openMenuBox.top >= 0 &&
          rowMenu.layout.openMenuBox.top +
            rowMenu.layout.openMenuBox.height <=
            rowMenu.layout.viewport.height,
        `menu ${JSON.stringify(rowMenu.layout.openMenuBox)}, viewport ${JSON.stringify(rowMenu.layout.viewport)}`,
      );
      check(
        "Delete is inside the row menu",
        await click("ideal-state-delete"),
        "no Delete menu item",
      );
      await askToDelete();
      const asked = await js(
        `document.querySelector(".confirm-dialog")?.textContent.includes(${JSON.stringify(victim.title ?? "Untitled")}) === true`,
      );
      check("the question names the row's document", asked, `victim ${JSON.stringify(victim)}`);
      await confirmTheDelete(beforeDelete.rows.length - 1);
      const afterOtherDelete = await sample();
      checks.afterOtherDelete = afterOtherDelete;
      check(
        "the row's own document is the one deleted",
        !(victim.id in afterOtherDelete.store),
        `store ${JSON.stringify(Object.keys(afterOtherDelete.store))}`,
      );
      check(
        "deleting another row left the editor alone",
        afterOtherDelete.selectedId === deleteId &&
          afterOtherDelete.titleValue === beforeDelete.titleValue,
        `selected ${afterOtherDelete.selectedId}, title ${JSON.stringify(afterOtherDelete.titleValue)}`,
      );
      check(
        "the other row's delete was recorded once",
        afterOtherDelete.writes.filter((write) => write.op === "delete").length === 1,
        `writes ${JSON.stringify(afterOtherDelete.writes)}`,
      );
    }

    // Deleting the document on screen still moves the page to another one.
    await openRowMenu(deleteId);
    check("Delete clicked", await click("ideal-state-delete"), "no Delete menu item");
    await askToDelete();
    await confirmTheDelete(beforeDelete.rows.length - 2);
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
      "the deletes were recorded twice",
      afterDelete.writes.filter((write) => write.op === "delete").length === 2,
      `writes ${JSON.stringify(afterDelete.writes)}`,
    );

    // The strip's own button still starts a document, so the round trip ends with
    // a library of three for the wide-page pictures.
    await waitFor(
      `!document.querySelector('[data-testid="ideal-state-new"]')?.disabled`,
      "the New document control to be ready",
    );
    check(
      "New document clicked from the strip",
      await click("ideal-state-new"),
      "no New document control",
    );
    await waitFor(
      `document.querySelector('[data-testid="ideal-state-title"]')?.value === ""`,
      "the new draft",
    );
    await setTitle("A garden in the evening");
    await waitForSaved();
    await leaveTheLine();
    await waitFor(
      `document.querySelectorAll(".ideal-state__history-row").length === 3`,
      "three documents after the deletes",
    );
    const restored = await sample();
    checks.restored = restored;
    check(
      "the strip's button made a document",
      restored.rows.length === 3 && restored.rows[0]?.title === "A garden in the evening",
      `rows ${JSON.stringify(restored.rows)}`,
    );

    // ── 9. the wide page spreads the strip and the box apart ─────────────────
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
    const { compose, editor, history, newControl, historyHeading, pageHeading } =
      wide.layout;
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
      const chat = wide.layout.chrome.chat;
      check(
        "the wide page measured the dock it is balancing against",
        Boolean(chat),
        JSON.stringify(wide.layout.chrome),
      );
      if (chat) {
        const libraryGap = editor.left - (history.left + history.width);
        const dockGap = chat.left - (editor.left + editor.width);
        check(
          "the library and the dock stand the same distance from the box",
          Math.abs(libraryGap - dockGap) <= 6,
          `library ${libraryGap}px, dock ${dockGap}px`,
        );
        check(
          "both of the box's gaps breathe",
          libraryGap >= 40 && dockGap >= 40,
          `library ${libraryGap}px, dock ${dockGap}px`,
        );
      }
      check(
        "the page title rides the box's column",
        Boolean(pageHeading) && Math.abs(pageHeading.left - editor.left) <= 2,
        `title ${JSON.stringify(pageHeading)}, box ${JSON.stringify(editor)}`,
      );
      check(
        "the strip's New control sits inside the strip",
        Boolean(newControl) &&
          newControl.left >= history.left &&
          newControl.left + newControl.width <= history.left + history.width + 1,
        `new ${JSON.stringify(newControl)}, strip ${JSON.stringify(history)}`,
      );
      check(
        "New and Documents share a line",
        Boolean(newControl) &&
          Boolean(historyHeading) &&
          Math.abs(
            newControl.top +
              newControl.height / 2 -
              (historyHeading.top + historyHeading.height / 2),
          ) <= 6,
        `new ${JSON.stringify(newControl)}, heading ${JSON.stringify(historyHeading)}`,
      );
    }
    screenshots.push(await shoot("wide"));

    // The same menu on the wide page, where the strip is not at the window's
    // edge: there is room below the row, so it opens downward.
    const wideMenuRow = wide.rows[0]?.id;
    if (wideMenuRow) {
      check(
        "the wide row menu opened",
        await click(`ideal-state-doc-menu-${wideMenuRow}`),
        "no row menu control",
      );
      await waitFor(
        `document.querySelectorAll(".ideal-state__row-menu").length === 1`,
        "the wide row menu",
      );
      const wideMenu = await sample();
      const menuBox = wideMenu.layout.openMenuBox;
      const viewport = wideMenu.layout.viewport;
      check(
        "the wide menu is fully inside the window",
        Boolean(menuBox) &&
          Boolean(viewport) &&
          menuBox.top >= 0 &&
          menuBox.top + menuBox.height <= viewport.height,
        `menu ${JSON.stringify(menuBox)}, viewport ${JSON.stringify(viewport)}`,
      );
      check(
        "the wide menu opens below its row",
        Boolean(menuBox) &&
          Boolean(wideMenu.layout.rowMenus[0]?.row) &&
          menuBox.top >=
            (wideMenu.layout.rowMenus[0]?.row?.top ?? Infinity),
        `menu ${JSON.stringify(menuBox)}, row ${JSON.stringify(wideMenu.layout.rowMenus[0]?.row)}`,
      );
      screenshots.push(await shoot("wide-menu"));
      check(
        "the wide row menu closed",
        await click(`ideal-state-doc-menu-${wideMenuRow}`),
        "no row menu control",
      );
      await waitFor(
        `document.querySelectorAll(".ideal-state__row-menu").length === 0`,
        "the wide row menu to close",
      );
    }

    // Collapsing the dock gives its column to the sheet. The page must not move
    // with it: the documents, the box and the title stay exactly where they were,
    // and the reclaimed width opens as empty page past the box.
    check(
      "the chat toggle collapsed the dock",
      await clickSelector(".window-titlebar__chat-toggle"),
      "no chat toggle",
    );
    await waitFor(
      `document.querySelector(".shell")?.classList.contains("shell--chat-collapsed") === true`,
      "the chat to collapse",
    );
    await js(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const wideCollapsed = await sample();
    checks.wideCollapsed = wideCollapsed.layout;
    if (compose && history && wideCollapsed.layout.compose && wideCollapsed.layout.history) {
      check(
        "collapsing the dock leaves the documents where they were",
        Math.abs(wideCollapsed.layout.history.left - history.left) <= 1 &&
          Math.abs(wideCollapsed.layout.history.top - history.top) <= 1,
        `before ${JSON.stringify(history)}, after ${JSON.stringify(wideCollapsed.layout.history)}`,
      );
      check(
        "collapsing the dock leaves the box where it was",
        Boolean(wideCollapsed.layout.editor) &&
          Boolean(editor) &&
          Math.abs(wideCollapsed.layout.editor.left - editor.left) <= 1 &&
          Math.abs(wideCollapsed.layout.editor.width - editor.width) <= 1,
        `before ${JSON.stringify(editor)}, after ${JSON.stringify(wideCollapsed.layout.editor)}`,
      );
      check(
        "collapsing the dock leaves the title where it was",
        Boolean(wideCollapsed.layout.pageHeading) &&
          Boolean(pageHeading) &&
          Math.abs(wideCollapsed.layout.pageHeading.left - pageHeading.left) <= 1,
        `before ${JSON.stringify(pageHeading)}, after ${JSON.stringify(wideCollapsed.layout.pageHeading)}`,
      );
    }
    screenshots.push(await shoot("wide-collapsed"));
    check(
      "the chat toggle reopened the dock",
      await clickSelector(".window-titlebar__chat-toggle"),
      "no chat toggle",
    );
    await waitFor(
      `document.querySelector(".shell")?.classList.contains("shell--chat-collapsed") === false`,
      "the chat to reopen",
    );

    // Chat on the left swaps the pair: the strip goes to the page's trailing
    // edge, past the box, and the header follows the box to the leading one.
    check(
      "the chat-side switch clicked",
      await clickSelector(".window-titlebar__side-switch"),
      "no chat-side switch",
    );
    await waitFor(
      `document.querySelector(".shell")?.classList.contains("shell--chat-left") === true`,
      "the chat to move to the left",
    );
    await js(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const wideLeft = await sample();
    checks.wideLeft = wideLeft.layout;
    const flipped = wideLeft.layout;
    if (!flipped.compose || !flipped.history) {
      check("the flipped page has a box and a strip", false, JSON.stringify(flipped));
    } else {
      check(
        "with the chat on the left, the box leads",
        flipped.compose.left + flipped.compose.width <= flipped.history.left,
        `box ${flipped.compose.left}+${flipped.compose.width}, strip ${flipped.history.left}`,
      );
      const flippedChat = flipped.chrome.chat;
      check(
        "the flipped page measured the dock it is balancing against",
        Boolean(flippedChat),
        JSON.stringify(flipped.chrome),
      );
      if (flippedChat) {
        const dockGap = flipped.editor.left - (flippedChat.left + flippedChat.width);
        const libraryGap =
          flipped.history.left - (flipped.editor.left + flipped.editor.width);
        check(
          "the flipped box stands the same distance from the dock and the library",
          Math.abs(dockGap - libraryGap) <= 6,
          `dock ${dockGap}px, library ${libraryGap}px`,
        );
        check(
          "the flipped box's gaps breathe",
          dockGap >= 40 && libraryGap >= 40,
          `dock ${dockGap}px, library ${libraryGap}px`,
        );
      }
      check(
        "the flipped page title follows the box",
        Boolean(flipped.pageHeading) &&
          Math.abs(flipped.pageHeading.left - flipped.editor.left) <= 2,
        `title ${JSON.stringify(flipped.pageHeading)}, box ${JSON.stringify(flipped.editor)}`,
      );
      check(
        "the flipped strip still holds New",
        Boolean(flipped.newControl) &&
          flipped.newControl.left >= flipped.history.left &&
          flipped.newControl.left + flipped.newControl.width <=
            flipped.history.left + flipped.history.width + 1,
        `new ${JSON.stringify(flipped.newControl)}, strip ${JSON.stringify(flipped.history)}`,
      );
    }
    screenshots.push(await shoot("wide-left"));

    // The leading dock has its own inset, and collapsing it must hold the page
    // still on that side too.
    check(
      "the leading chat toggle collapsed the dock",
      await clickSelector(".window-titlebar__chat-toggle"),
      "no chat toggle",
    );
    await waitFor(
      `document.querySelector(".shell")?.classList.contains("shell--chat-collapsed") === true`,
      "the leading chat to collapse",
    );
    await js(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const leftCollapsed = await sample();
    checks.wideLeftCollapsed = leftCollapsed.layout;
    if (
      flipped.editor &&
      flipped.history &&
      flipped.pageHeading &&
      leftCollapsed.layout.editor &&
      leftCollapsed.layout.history &&
      leftCollapsed.layout.pageHeading
    ) {
      check(
        "collapsing the leading dock leaves the page where it was",
        Math.abs(leftCollapsed.layout.editor.left - flipped.editor.left) <= 1 &&
          Math.abs(leftCollapsed.layout.history.left - flipped.history.left) <= 1 &&
          Math.abs(leftCollapsed.layout.history.top - flipped.history.top) <= 1 &&
          Math.abs(
            leftCollapsed.layout.pageHeading.left - flipped.pageHeading.left,
          ) <= 1,
        `box ${flipped.editor.left}→${leftCollapsed.layout.editor.left}, library ${flipped.history.left}→${leftCollapsed.layout.history.left}, title ${flipped.pageHeading.left}→${leftCollapsed.layout.pageHeading.left}`,
      );
    }
    screenshots.push(await shoot("wide-left-collapsed"));
    check(
      "the leading chat toggle reopened the dock",
      await clickSelector(".window-titlebar__chat-toggle"),
      "no chat toggle",
    );
    await waitFor(
      `document.querySelector(".shell")?.classList.contains("shell--chat-collapsed") === false`,
      "the leading chat to reopen",
    );

    // Put the dock back where it started for the rest of the run.
    check(
      "the chat-side switch restored the dock",
      await clickSelector(".window-titlebar__side-switch"),
      "no chat-side switch",
    );
    await waitFor(
      `document.querySelector(".shell")?.classList.contains("shell--chat-right") === true`,
      "the chat to move back to the right",
    );
    win.setContentSize(SIZE.width, SIZE.height);
    await waitFor(`window.innerWidth <= ${SIZE.width + 10}`, "the default window");
    await js(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );

    // The one-column page reserves the dock's column too: collapsing it at the
    // default size leaves the prose and the strip under it exactly in place.
    const narrow = await sample();
    checks.narrow = narrow.layout;
    check(
      "the chat toggle collapsed the dock at the narrow size",
      await clickSelector(".window-titlebar__chat-toggle"),
      "no chat toggle",
    );
    await waitFor(
      `document.querySelector(".shell")?.classList.contains("shell--chat-collapsed") === true`,
      "the narrow chat to collapse",
    );
    await js(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const narrowCollapsed = await sample();
    checks.narrowCollapsed = narrowCollapsed.layout;
    if (
      narrow.editor &&
      narrow.history &&
      narrow.pageHeading &&
      narrowCollapsed.editor &&
      narrowCollapsed.history &&
      narrowCollapsed.pageHeading
    ) {
      check(
        "collapsing the dock at the narrow size leaves the page where it was",
        Math.abs(narrowCollapsed.editor.left - narrow.editor.left) <= 1 &&
          Math.abs(narrowCollapsed.history.left - narrow.history.left) <= 1 &&
          Math.abs(narrowCollapsed.pageHeading.left - narrow.pageHeading.left) <= 1,
        `box ${narrow.editor.left}→${narrowCollapsed.editor.left}, library ${narrow.history.left}→${narrowCollapsed.history.left}, title ${narrow.pageHeading.left}→${narrowCollapsed.pageHeading.left}`,
      );
    }
    check(
      "the narrow chat toggle reopened the dock",
      await clickSelector(".window-titlebar__chat-toggle"),
      "no chat toggle",
    );
    await waitFor(
      `document.querySelector(".shell")?.classList.contains("shell--chat-collapsed") === false`,
      "the narrow chat to reopen",
    );

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
