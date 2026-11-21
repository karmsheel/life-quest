/**
 * Drives the review harness in a real Electron window and turns what the Review
 * page actually renders into `e2e/artifacts/review.json` plus eleven pictures.
 *
 * Run with the dev server up (`npm run dev`, or the repository's e2e runner):
 *
 *   node e2e/review.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims. The pictures, all from this same run:
 *
 *   review-document.png   the weekly review as the page opens: the 48rem reading
 *                         column with the Review checklist beside it
 *   review-checklist.png  the same moment, framed on the checklist: mixed
 *                         statuses, the gate on the Life review, the progress
 *   review-started.png    after the Finance row ran the snapshot pass: the
 *                         figures are in the file and the document is still open
 *   review-chat-sidebar.png  the moment the Finance interview starts: the new
 *                         chat is already a row in **Chats**, marked as the open
 *                         chat and as a live turn, while the agent is working
 *   review-calendar.png   the period's calendar open on the month before: the
 *                         grid the operator chooses another week from
 *   review-life-ready.png after the last area was completed: every row Done, the
 *                         Life review unlocked, the "ready" hint showing
 *   review-daily.png      the daily review: one general review, no checklist
 *   review-rules.png      the cadence's rules panel, read and written from the page
 *   review-wide.png       a wide window: the column keeps its measure and the
 *                         page+checklist pair is centred with room on both sides
 *   review-live-checklist.png  a scope the AGENT marked done, on a page that was
 *                         already open: the row flipped without a navigation
 *   review-daily-complete.png  the daily review the AGENT wrote and completed on
 *                         the open page: the report is in the box, the badge is
 *                         Locked, and the Mark-review-complete button is gone
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. The document is the page and the checklist is BESIDE it: one `.note-live`
 *     on arrival, no Edit/Save pair, and on a weekly review a rail to the right
 *     of a reading column that is still 48rem, with the pair centred in the
 *     sheet. A rail that is a second document, sits under the column at a window
 *     with room, or steals the column's measure fails here.
 *  2. The rail is the LIVE areas, in the vault's order, Life first: the fixture
 *     also has a locked `spirit` area on disk, so a rail built from every domain
 *     file gains a row and changes the progress denominator.
 *  3. The rail's statuses are the review file's own scopes: the fixture opens
 *     with one area Done and one In progress, so the three words and the progress
 *     count must all appear at once. It also means the rail can be checked
 *     against `window.reviewRigScopes()`, not just against its own text.
 *  4. The Life review is GATED until every live area is Done, and the gate is
 *     lifted by the last completion: the button is disabled at open, the hint
 *     counts the areas left, and it is enabled with "all areas reviewed" after
 *     the last `Done`.
 *  5. A rail row starts THAT row's review: pressing Finance asks for scope
 *     `financial`, binds the page's scope line to Finance, and the kickoff the
 *     dock receives names the area's own `## Finance` section. A page that
 *     starts the overall review from an area row hands over the wrong scope.
 *  6. The life review is the SUMMARY: its session is asked for scope `overall`
 *     and its kickoff says `whole-life review` across the areas, which is what
 *     the operator asked for when every area is done.
 *  7. Completing the life review LOCKS the file: the Locked badge appears, every
 *     rail row is disabled, the file reports locked, and a write attempted
 *     through the bridge afterwards is refused and leaves the body untouched.
 *  8. The daily review is ONE GENERAL REVIEW: no rail, no `review-area-*`
 *     controls, no scope line, one `Start the interview`, and the session it
 *     starts is scope `overall` with a kickoff that says there are no area
 *     sections. The file it creates has no `###` area headings either.
 *  9. The daily review ignores the title-bar area lens: the rig is on an area
 *     lens (Relationships) when it navigates to Daily, and the daily review still
 *     starts `overall`. Back on the weekly page the lens is still there.
 * 10. There is no second view of the file: no Document/Preview pair, no
 *     `review-mode-*` buttons and no preview surface — the one box holds the
 *     whole file, including the paragraph the operator wrote outside the
 *     skeleton and the area sections the rail maps. The old claims survive the
 *     surface: the document's blocks and the blank line the operator typed,
 *     Ctrl+B/U/2/3 on the selection, the snapshot filled once inside its markers
 *     in the right section with the agent down, and the cadence's rules read and
 *     written from the page.
 * 11. No bridge call this rig does not model, and no console error.
 * 12. A started review's chat is in the LEFT SIDEBAR from its first paint, while
 *     the agent is still working. The chat list was read before that session
 *     existed and is not read again until the turn settles, so the row can only
 *     be there if the dock adopted the row main handed back with the id. The
 *     turn is held open for the check — a chat that appears only once the run
 *     ends is the reported bug, not a pass.
 * 13. The header is the Daily Journal's shape, not a second title: the cadence is
 *     the eyebrow, the period is the page's one heading CENTRED over the prose
 *     with the calendar key beside it, and the two steps are wordless arrows with
 *     no frame, on the column's edges. The calendar walks to another week and the
 *     arrows walk back to the open week, where Next is the wall.
 * 14. A review marked done by an AGENT shows on the checklist of the page that is
 *     already open, with no navigation and no remount. The tool call happens in
 *     the main process, so the page can only learn about it from the vault's
 *     data-change announcement; the rig changes the file the way the tool does
 *     and fires that announcement the way main does. The row must flip, the
 *     progress must count it, the Life review's gate must lift on the live
 *     marks, and the final lock badge must appear — all while a DOM probe planted
 *     before the announcement survives, which a reload or a page navigation
 *     would destroy. The bridge's own `reviewGet` count is what proves the page
 *     re-read the vault instead of being handed the new state.
 * 15. The BOX follows a report the AGENT wrote, and a COMPLETED review keeps no
 *     dead Mark-done button. The companion writes the daily report and marks it
 *     complete with its own tool calls in main; the operator is on the page. The
 *     report must appear in the open box without a navigation (a background read
 *     counted through `reviewGet`, and no write back), and when the file locks
 *     the page must drop the Mark-review-complete button, show the Locked badge,
 *     and keep the agent's report in its now read-only box.
 * 16. Every review READ names a period of the cadence it asked for. A cadence
 *     switch is a different page: a Daily date carried into a Weekly read asks
 *     the vault for a review that cannot exist (a Friday weekly, say) and draws
 *     a heading-less skeleton while the real period loads — the transient the
 *     "back on the weekly review" leg used to fail on. The driver checks every
 *     `reviewGet` call's cadence/period pair, so the stale-period read is named
 *     even if a sample happens to miss the wrong paint.
 *
 * NOT covered here: that any of it reaches disk (that is the vault-core half,
 * `tests/review-areas-e2e.test.ts` and `tests/review-snapshot-e2e.test.ts`) and
 * the companion's own transport rules (that is `tests/companion-*`).
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
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/review.html";

/**
 * The default window. The review page's pair needs the sheet's room — a 48rem
 * reading column beside a 17rem checklist, plus the shell's 16rem sidebar and
 * the sheet's padding — so this is the smallest ordinary window where the column
 * can still be its measure. The chat dock is folded away before the layout
 * claims (that is what the operator's own dock control does, and the review
 * feature is not the dock's claim); when Start opens the dock again the review
 * page gives width back, which is the app's own graceful answer and not this
 * rig's claim.
 */
const DEFAULT_SIZE = { width: 1440, height: 900 };
/**
 * A window with more room than the pair needs. 1920px leaves the 1064px pair
 * more than 180px of page on either side, which is the shape the operator asked
 * about: a wide monitor should not stretch the prose, and the pair should read
 * as one centred block rather than as a page with a panel bolted to an edge.
 */
const WIDE_SIZE = { width: 1800, height: 1000 };
/** Narrower than the stylesheet's 78rem threshold: the rail must stack above. */
const NARROW_SIZE = { width: 900, height: 900 };

const INPUT = ".note-live textarea";

/** The measure the reading column and the inside of the checklist are drawn for. */
const READING_MEASURE = 48 * 16;
/** `--sidebar 16rem`/.review-page columns; the rail's own width sanity bounds. */
const RAIL_MIN_WIDTH = 180;
const RAIL_MAX_WIDTH = 420;
/** The rail's gap to the column (`1.5rem`), with a pixel of paint tolerance. */
const RAIL_GAP_MIN = 16;

/** The rail's rows, in order: the life review first, then the live areas. */
const AREA_ROWS = [
  { slug: "health", name: "Health" },
  { slug: "mind", name: "Mind" },
  { slug: "financial", name: "Finance" },
  { slug: "business", name: "Business" },
  { slug: "relationships", name: "Relationships" },
];
const RAIL_ROWS = ["review-area-overall", ...AREA_ROWS.map((a) => `review-area-${a.slug}`)];
const LOCKED_ROW = "review-area-spirit";
const TOTAL_AREAS = AREA_ROWS.length;

/** Read the review page and the box straight off the rendered DOM. */
const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const box = document.querySelector(".note-live");
  const input = box ? box.querySelector("textarea") : null;
  const blocks = box ? Array.from(box.querySelectorAll("[data-note-block]")) : [];
  const parts = blocks.map((el) => {
    const area = el.querySelector("textarea");
    if (area) return area.value;
    if (el.querySelector(".note-live__placeholder")) return "";
    if (el.querySelector(".note-live__blank")) return "";
    return el.textContent || "";
  });
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  const item = (testId) => {
    const el = document.querySelector('[data-testid="' + testId + '"]');
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      text: text(el),
      disabled: el.disabled === true,
      ariaCurrent: el.getAttribute("aria-current"),
      className: el.className,
    };
  };
  const status = (testId) => text(document.querySelector('[data-testid="' + testId + '"]'));
  const railButtons = Array.from(
    document.querySelectorAll('button[data-testid^="review-area-"]'),
  ).map((el) => el.getAttribute("data-testid"));
  return {
    boxes: document.querySelectorAll(".note-live").length,
    blockCount: blocks.length,
    blanks: box ? box.querySelectorAll(".note-live__blank").length : 0,
    writingLines: box ? box.querySelectorAll("textarea").length : 0,
    editing: Boolean(input),
    inputValue: input ? input.value : null,
    boxMarkdown: parts.join("\\n\\n").trim(),
    boxText: box ? box.textContent || "" : "",
    readOnly: box ? box.getAttribute("data-read-only") === "true" : null,
    strong: box ? box.querySelectorAll("strong").length : 0,
    underlines: box ? box.querySelectorAll("u").length : 0,
    tables: box ? box.querySelectorAll("table").length : 0,
    headers: box
      ? Array.from(box.querySelectorAll("th")).map((th) => (th.textContent || "").trim())
      : [],
    headings: box ? box.querySelectorAll("h1, h2, h3, h4, h5, h6").length : 0,
    title: text(document.querySelector(".review-page__title")),
    period: text(document.querySelector('[data-testid="review-period"]')),
    eyebrow: text(document.querySelector('[data-testid="wing-eyebrow"]')),
    // The period the page is on, as the page itself records it: the driver can
    // compare it to a computed week start without parsing a display label.
    periodData: (() => {
      const el = document.querySelector('[data-testid="review-period"]');
      return el ? el.dataset.period ?? null : null;
    })(),
    calendar: Boolean(document.querySelector('[data-testid="review-calendar"]')),
    nextDisabled: (() => {
      const el = document.querySelector('[data-testid="review-next"]');
      return el ? el.disabled === true : null;
    })(),
    // The header's shape: the two step keys' own boxes and computed chrome, the
    // period block they flank, and the page column all three ride. The steps are
    // keys — no label, no frame — and the steps sit on the column's edges while
    // the period block (headline + calendar) is centred on it.
    headerParts: (() => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
        };
      };
      const shape = (el) => {
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          text: (el.textContent || "").trim(),
          borderTop: style.borderTopWidth,
          borderStyle: style.borderTopStyle,
          background: style.backgroundColor,
          width: Math.round(el.getBoundingClientRect().width),
        };
      };
      return {
        page: box(document.querySelector(".review-page")),
        prev: box(document.querySelector('[data-testid="review-prev"]')),
        next: box(document.querySelector('[data-testid="review-next"]')),
        block: box(document.querySelector(".review-page__period-block")),
        prevShape: shape(document.querySelector('[data-testid="review-prev"]')),
        nextShape: shape(document.querySelector('[data-testid="review-next"]')),
      };
    })(),
    notice: text(document.querySelector(".review-page__notice")),
    error: text(document.querySelector(".form-error")),
    status: text(document.querySelector(".review-page__status")),
    lockedBadge: text(document.querySelector(".review-page__lock-badge")),
    actions: Array.from(document.querySelectorAll(".review-page__actions button")).map(
      (b) => (b.textContent || "").trim(),
    ),
    modes: Array.from(document.querySelectorAll(".review-page__modes button")).map(
      (b) => (b.textContent || "").trim(),
    ),
    previewShown: Boolean(document.querySelector('[data-testid="review-preview"]')),
    skillOpen: Boolean(document.querySelector('[data-testid="review-skill-editor"]')),
    skillValue: (() => {
      const el = document.querySelector('[data-testid="review-skill-editor"]');
      if (!el) return null;
      const area = el.querySelector("textarea");
      if (area) return area.value;
      return Array.from(el.querySelectorAll("[data-note-block]"))
        .map((n) => n.textContent || "")
        .join("\\n\\n")
        .trim();
    })(),
    // The new surface: the wrapper, the rail, its rows, the progress and the
    // scope line. Each is read by the testids the UI contract names, so a page
    // that renames or drops one fails the run rather than silently passing.
    layoutPresent: Boolean(document.querySelector('[data-testid="review-layout"]')),
    layoutSingle: (() => {
      const el = document.querySelector('[data-testid="review-layout"]');
      return el
        ? el.className.split(/\\s+/).includes("review-page-layout--single")
        : null;
    })(),
    railPresent: Boolean(document.querySelector('[data-testid="review-area-rail"]')),
    railLabel: (() => {
      const el = document.querySelector('[data-testid="review-area-rail"]');
      return el ? el.getAttribute("aria-label") : null;
    })(),
    progress: text(document.querySelector('[data-testid="review-area-progress"]')),
    hint: text(document.querySelector('[data-testid="review-area-hint"]')),
    railButtons,
    lifeItem: item("review-area-overall"),
    lifeStatus: status("review-area-overall-status"),
    healthItem: item("review-area-health"),
    healthStatus: status("review-area-health-status"),
    mindItem: item("review-area-mind"),
    mindStatus: status("review-area-mind-status"),
    financeItem: item("review-area-financial"),
    financeStatus: status("review-area-financial-status"),
    businessItem: item("review-area-business"),
    businessStatus: status("review-area-business-status"),
    relationshipsItem: item("review-area-relationships"),
    relationshipsStatus: status("review-area-relationships-status"),
    scopeLine: text(document.querySelector('[data-testid="review-scope"]')),
    scopeName: text(document.querySelector('[data-testid="review-scope-name"]')),
    scopeWholeLifeLink: Boolean(document.querySelector('[data-testid="review-scope-life"]')),
    markDoneLabel: (() => {
      const el = document.querySelector('[data-testid="review-mark-done"]');
      return el ? text(el) : null;
    })(),
    markDoneDisabled: (() => {
      const el = document.querySelector('[data-testid="review-mark-done"]');
      return el ? el.disabled === true : null;
    })(),
    startLabel: (() => {
      const el = document.querySelector('[data-testid="review-start"]');
      return el ? text(el) : null;
    })(),
    unlockPresent: Boolean(document.querySelector('[data-testid="review-unlock"]')),
    emptyPresent: Boolean(document.querySelector('[data-testid="review-empty"]')),
    // How the page is standing, read off the boxes rather than computed styles:
    // the sheet's own content box, the reading column, the checklist beside it,
    // and the parts of the page that must ride the column. The centre is solved
    // from the content box's client width so a vertical scrollbar does not read
    // as an off-centre page.
    layout: (() => {
      const content = document.querySelector(".shell__content");
      const shell = document.querySelector(".shell");
      const layoutEl = document.querySelector('[data-testid="review-layout"]');
      const page = document.querySelector(".review-page");
      const rail = document.querySelector('[data-testid="review-area-rail"]');
      return {
        shellClass: shell ? shell.className : null,
        content: content
          ? {
              ...rect(content),
              clientWidth: content.clientWidth,
              centerX: content.getBoundingClientRect().left + content.clientWidth / 2,
            }
          : null,
        layout: rect(layoutEl),
        // The page's own side padding: the pair is centred inside it, and the
        // trailing band is deliberately deeper than the leading one.
        layoutPadding: (() => {
          if (!layoutEl) return null;
          const style = getComputedStyle(layoutEl);
          return {
            left: Math.round(parseFloat(style.paddingLeft) || 0),
            right: Math.round(parseFloat(style.paddingRight) || 0),
          };
        })(),
        page: rect(page),
        pageMaxWidth: page ? getComputedStyle(page).maxWidth : null,
        rail: rect(rail),
        railPosition: rail ? getComputedStyle(rail).position : null,
        header: rect(document.querySelector(".review-page__header")),
        toolbar: rect(document.querySelector(".review-page__toolbar")),
        editor: rect(document.querySelector(".review-page__editor")),
        scope: rect(document.querySelector('[data-testid="review-scope"]')),
        pageActions: rect(document.querySelector(".review-page__actions")),
        notes: rect(document.querySelector(".review-notes")),
      };
    })(),
  };
})()`;

const errors = [];
/**
 * Everything sampled so far. Module-level rather than local to `main`, so a run
 * that throws part way still writes what it had already seen: a report with only
 * a message is a report nobody can diagnose from.
 */
const checks = {};
const failure = (message) => {
  errors.push(message);
  return message;
};

function waitFor(win, expression, label, timeoutMs = 10_000) {
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

function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

/** The review body as the file holds it, off the stub that stands in for disk. */
function fileBody(win) {
  return win.webContents.executeJavaScript("window.reviewRigBody()");
}

/** The loaded review file's scope states, so rail text can be cross-checked. */
function fileScopes(win) {
  return win.webContents.executeJavaScript("window.reviewRigScopes()");
}

/** Whether the loaded review file is locked. */
function fileLocked(win) {
  return win.webContents.executeJavaScript("window.reviewRigLocked()");
}

/**
 * How many times the page has READ a review through the bridge.
 *
 * The live leg's evidence that a changed checklist came from a re-read of the
 * vault and not from state handed to the page: the count has to move across the
 * agent's mark.
 */
async function reviewGetCount(win) {
  const calls = await setHarness(win, "window.reviewRigCalls");
  return calls.filter((call) => String(call).startsWith("reviewGet:")).length;
}

/** The status text of one rail row, or null when the row is not drawn. */
function railStatus(win, slug) {
  return win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('[data-testid="review-area-${slug}-status"]'); return el ? el.textContent.trim() : null; })()`,
  );
}

/** Wait for one rail row to read a given status. */
function waitForRailStatus(win, slug, expected, timeoutMs = 10_000) {
  return waitFor(
    win,
    `(document.querySelector('[data-testid="review-area-${slug}-status"]')?.textContent ?? "").trim() === ${JSON.stringify(expected)}`,
    `${slug} to read "${expected}"`,
    timeoutMs,
  );
}

/** Wait for the chat dock to have received N kickoff turns. */
function waitForDockKickoffs(win, expected, timeoutMs = 8_000) {
  return waitFor(
    win,
    `(window.reviewRigKickoffs ?? []).length === ${expected}`,
    `the dock to receive ${expected} kickoff turn(s)`,
    timeoutMs,
  );
}

/**
 * The rail's Chats list as the operator sees it: one row per chat, the label it
 * wears, and whether the row is the open chat and has a live turn.
 */
function chatSidebar(win) {
  return win.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll(".chats-rail__row"));
    return {
      present: Boolean(document.querySelector(".chats-rail")),
      rows: rows.map((row) => ({
        label: (row.querySelector(".chats-rail__label")?.textContent || "").trim(),
        active: row.hasAttribute("data-active"),
        live: row.hasAttribute("data-live"),
      })),
    };
  })()`);
}

/** The period the page records on its headline (`data-period`), e.g. 2026-11-09. */
function pagePeriod(win) {
  return win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="review-period"]')?.dataset.period ?? null`,
  );
}

/** The Monday-first week start of an ISO day, the way the page computes it. */
function weekStartOnOrBefore(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Whether that period is one the cadence can own.
 *
 * A review page is one cadence, and a period key is the cadence's own fold of a
 * date: a weekly period is a week start, a monthly one is `YYYY-MM`, and so on.
 * Asking for `weekly/2026-11-20` (a Friday) means the page carried another
 * cadence's period across a route change — the transient that used to draw a
 * heading-less skeleton on the way back from Daily.
 */
function periodBelongsToCadence(cadence, period) {
  if (cadence === "daily") return /^\d{4}-\d{2}-\d{2}$/.test(period);
  if (cadence === "weekly") {
    return /^\d{4}-\d{2}-\d{2}$/.test(period) && weekStartOnOrBefore(period) === period;
  }
  if (cadence === "monthly") return /^\d{4}-\d{2}$/.test(period);
  if (cadence === "quarterly") return /^\d{4}-Q[1-4]$/.test(period);
  if (cadence === "yearly") return /^\d{4}$/.test(period);
  return false;
}

/** Open a paragraph the way a person does — a click on the prose. */
async function openBlock(win, index) {
  await win.webContents.executeJavaScript(`(() => {
    const block = document.querySelectorAll(".note-live [data-note-block]")[${index}];
    if (!block) return false;
    block.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
    );
    return true;
  })()`);
  try {
    await waitFor(win, `Boolean(document.querySelector('${INPUT}'))`, `paragraph ${index} to open`);
  } catch (error) {
    // A paragraph that will not open is diagnosed by what the box was holding:
    // the block count, which one was aimed at, and whether the page locked it.
    const state = await win.webContents.executeJavaScript(`(() => {
      const box = document.querySelector(".note-live");
      return {
        boxes: document.querySelectorAll(".note-live").length,
        blocks: box ? box.querySelectorAll("[data-note-block]").length : 0,
        readOnly: box ? box.getAttribute("data-read-only") : null,
        aimed: document.querySelectorAll(".note-live [data-note-block]")[${index}]
          ? (document.querySelectorAll(".note-live [data-note-block]")[${index}].textContent || "").slice(0, 60)
          : null,
        writingLines: box ? box.querySelectorAll("textarea").length : 0,
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)} — ${JSON.stringify(state)}`);
  }
}

/** Replace the open writing line's text the way typing would. */
function type(win, value) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`);
}

/** Select a run of characters in the open writing line. */
function select(win, start, end) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return null;
    el.focus();
    el.setSelectionRange(${start}, ${end});
    return [el.selectionStart, el.selectionEnd];
  })()`);
}

/**
 * Press a formatting key on the open writing line.
 *
 * The page's handler is a React `onKeyDown`, which is a listener on the root
 * container: a real `keydown` dispatched on the textarea bubbles to it, which is
 * what makes this the same path an operator's keystroke takes.
 */
function pressKey(win, key, modifiers = {}) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return null;
    el.focus();
    const event = new KeyboardEvent("keydown", {
      key: ${JSON.stringify(key)},
      bubbles: true,
      cancelable: true,
      ctrlKey: ${modifiers.ctrl ? "true" : "false"},
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });
    el.dispatchEvent(event);
    return { value: el.value, start: el.selectionStart, end: el.selectionEnd, prevented: event.defaultPrevented };
  })()`);
}

/** Leave the writing line the way clicking away would: the paragraph renders. */
async function leaveTheLine(win) {
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('${INPUT}');
    if (!el) return;
    el.blur();
    // This window is shown without taking focus, so Chromium suppresses the
    // blur/focusout a real click-away delivers. The page is wired to the event,
    // so the event is what this dispatches — the same one, on the same node.
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  })()`);
  await waitFor(win, `!document.querySelector('${INPUT}')`, "the writing line to close");
}

function click(win, selector) {
  return win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  );
}

function setHarness(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

function frames(win) {
  return win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}

async function shot(win, name) {
  await frames(win);
  // A fresh checkout has no artifacts directory: it is gitignored, so the first
  // run in a worktree is the one that has to make it.
  fs.mkdirSync(artifactsDir, { recursive: true });
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, name), image.toPNG());
}

/** How many times a literal appears — the count, not a boolean. */
function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/**
 * The numbers the layout claims are made of, read off the boxes rather than the
 * stylesheet: the sheet's content box, the reading column, the checklist beside
 * it, and the gap between the two.
 */
function layoutReport(layout) {
  const page = layout?.page ?? null;
  const rail = layout?.rail ?? null;
  const content = layout?.content ?? null;
  const pageRight = page ? page.left + page.width : null;
  const railRight = rail ? rail.left + rail.width : null;
  return {
    shellClass: layout?.shellClass ?? null,
    contentLeft: content ? content.left : null,
    contentRight: content ? content.left + content.clientWidth : null,
    contentClientWidth: content ? content.clientWidth : null,
    contentCentre: content ? content.centerX : null,
    layoutLeft: layout?.layout?.left ?? null,
    layoutWidth: layout?.layout?.width ?? null,
    layoutPadLeft: layout?.layoutPadding?.left ?? null,
    layoutPadRight: layout?.layoutPadding?.right ?? null,
    innerLeft:
      layout?.layout && layout?.layoutPadding
        ? layout.layout.left + layout.layoutPadding.left
        : null,
    innerRight:
      layout?.layout && layout?.layoutPadding
        ? layout.layout.left + layout.layout.width - layout.layoutPadding.right
        : null,
    innerCentre:
      layout?.layout && layout?.layoutPadding
        ? layout.layout.left +
          layout.layoutPadding.left +
          (layout.layout.width - layout.layoutPadding.left - layout.layoutPadding.right) / 2
        : null,
    pageLeft: page ? page.left : null,
    pageRight,
    pageWidth: page ? page.width : null,
    pageTop: page ? page.top : null,
    pageMaxWidth: layout?.pageMaxWidth ?? null,
    railLeft: rail ? rail.left : null,
    railRight,
    railWidth: rail ? rail.width : null,
    railTop: rail ? rail.top : null,
    railBottom: rail ? rail.top + rail.height : null,
    railPosition: layout?.railPosition ?? null,
    gap: page && rail ? rail.left - pageRight : null,
    groupCentre: page && rail ? (page.left + railRight) / 2 : null,
    // The room either side of the pair, measured from the page's padded inner box.
    gapBefore:
      page && layout?.layout && layout?.layoutPadding
        ? page.left - (layout.layout.left + layout.layoutPadding.left)
        : null,
    gapAfter:
      rail && layout?.layout && layout?.layoutPadding
        ? layout.layout.left +
          layout.layout.width -
          layout.layoutPadding.right -
          railRight
        : null,
    headerLeft: layout?.header?.left ?? null,
    toolbarLeft: layout?.toolbar?.left ?? null,
    editorLeft: layout?.editor?.left ?? null,
    scopeLeft: layout?.scope?.left ?? null,
    actionsLeft: layout?.pageActions?.left ?? null,
    notesLeft: layout?.notes?.left ?? null,
  };
}

/**
 * Claim the two-column reading page: the column keeps its 48rem measure where the
 * sheet has room for it, the checklist is a real column to its right with the
 * stylesheet's gap, and the pair is centred together inside the page's own side
 * padding — not the page centred with the rail hung off one edge, and not the
 * pair run out to the sheet's edges.
 *
 * The trailing band is deliberately deeper than the leading one, so the checklist
 * reads as sitting inside the right padding. `spareFloor` is the empty page the
 * claim demands on each side of the pair; it is only meaningful when the window
 * is wider than the pair needs.
 */
function assertTwoColumn(layout, when, { spareFloor = 0 } = {}) {
  const report = layoutReport(layout);
  if (report.pageLeft === null || report.pageWidth === null || report.pageTop === null) {
    failure(`${when}: the reading column's own layout box could not be read`);
    return report;
  }
  if (report.railLeft === null || report.railWidth === null) {
    failure(`${when}: the Review checklist rail was not drawn`);
    return report;
  }
  if (report.contentCentre === null || report.contentLeft === null) {
    failure(`${when}: the sheet's content box could not be read`);
    return report;
  }
  // The page's own side padding: it must exist, and the trailing band must be
  // deeper than the leading one.
  if (report.layoutPadLeft === null || report.layoutPadRight === null) {
    failure(`${when}: the page's side padding could not be read`);
    return report;
  }
  if (!(report.layoutPadLeft >= 8)) {
    failure(`${when}: the page has only ${report.layoutPadLeft}px of leading padding`);
  }
  if (!(report.layoutPadRight > report.layoutPadLeft + 4)) {
    failure(
      `${when}: the trailing padding (${report.layoutPadRight}px) is not deeper than the leading padding (${report.layoutPadLeft}px)`,
    );
  }
  // The measure: the column never grows past 48rem.
  if (report.pageWidth > READING_MEASURE + 1) {
    failure(
      `${when}: the reading column is ${report.pageWidth}px wide, past its ${READING_MEASURE}px measure`,
    );
  }
  // Where the sheet has room, the column is exactly its measure: a column that
  // also narrows here is the layout this claim exists to keep out.
  if (spareFloor > 0 && report.pageWidth < READING_MEASURE - 1) {
    failure(
      `${when}: the reading column narrowed to ${report.pageWidth}px although the sheet had room for its ${READING_MEASURE}px measure`,
    );
  }
  if (report.railWidth < RAIL_MIN_WIDTH || report.railWidth > RAIL_MAX_WIDTH) {
    failure(
      `${when}: the checklist is ${report.railWidth}px wide — not the ~17rem column the page is drawn for`,
    );
  }
  // The rail is to the RIGHT of the column, with the stylesheet's own gap. A
  // stack under a wide window, or an overlap, fails both halves of this.
  if (report.railLeft < (report.pageRight ?? Infinity) + RAIL_GAP_MIN) {
    failure(
      `${when}: the checklist starts at ${report.railLeft}, not to the right of the column's ${report.pageRight} with a gap (gap ${report.gap}px)`,
    );
  }
  const offBy =
    report.groupCentre === null || report.innerCentre === null
      ? null
      : report.groupCentre - report.innerCentre;
  if (offBy === null || Math.abs(offBy) > 2) {
    failure(
      `${when}: the page+checklist group's centre is ${report.groupCentre}, ${offBy}px from the page's padded centre ${report.innerCentre}`,
    );
  }
  // Every part of the page rides the column: a centred title over a body run
  // from the leading edge would be a page divided against itself.
  for (const [part, left] of [
    ["header", report.headerLeft],
    ["toolbar", report.toolbarLeft],
    ["editor", report.editorLeft],
    ["scope line", report.scopeLeft],
    ["actions", report.actionsLeft],
    ["daily notes", report.notesLeft],
  ]) {
    if (left === null) continue;
    if (Math.abs(left - report.pageLeft) > 1) {
      failure(
        `${when}: the ${part} starts at ${left}, ${left - report.pageLeft}px off the column's ${report.pageLeft}`,
      );
    }
  }
  // Inside the page's padding the pair is centred: the leftover room is empty
  // page on both sides of it, split evenly.
  const before = report.gapBefore ?? 0;
  const after = report.gapAfter ?? 0;
  checks[`${when}:gaps`] = { before, after };
  if (spareFloor > 0) {
    if (!(before > spareFloor) || !(after > spareFloor)) {
      failure(
        `${when}: the pair did not leave its window's spare room as page on both sides (${before}px before, ${after}px after)`,
      );
    }
    if (Math.abs(before - after) > 2) {
      failure(
        `${when}: the room around the pair is lopsided — ${before}px before it and ${after}px after it`,
      );
    }
  }
  return report;
}

/**
 * Claim the narrow window: the checklist stacks ABOVE the reading column, spans
 * the same column, and the two do not overlap. This is the stylesheet's 78rem
 * answer to "there is no room for a page beside a rail".
 */
function assertStacked(layout, when) {
  const report = layoutReport(layout);
  if (report.pageTop === null || report.railTop === null) {
    failure(`${when}: the stacked layout boxes could not be read`);
    return report;
  }
  if (!(report.railTop < report.pageTop)) {
    failure(
      `${when}: the checklist starts at ${report.railTop}, not above the reading column's ${report.pageTop}`,
    );
  }
  if (!((report.railBottom ?? Infinity) <= report.pageTop + 1)) {
    failure(
      `${when}: the checklist (bottom ${report.railBottom}) overlaps the reading column (top ${report.pageTop})`,
    );
  }
  // It is the same column, not a floating card beside it.
  const overlap =
    Math.min(report.railRight ?? 0, report.pageRight ?? 0) -
    Math.max(report.railLeft ?? 0, report.pageLeft ?? 0);
  if (!(overlap > 100)) {
    failure(
      `${when}: the checklist spans ${overlap}px of the reading column's width — it is not stacked in the same column`,
    );
  }
  if (report.contentClientWidth !== null && (report.pageWidth ?? 0) > report.contentClientWidth + 1) {
    failure(
      `${when}: the reading column is ${report.pageWidth}px wide inside a ${report.contentClientWidth}px sheet`,
    );
  }
  return report;
}

/**
 * Fold the chat dock away, the way the operator's own collapse control does.
 *
 * The dock opens by default and takes a 22.5rem column out of the sheet. That is
 * not part of the review page's claim: the checklist and the 48rem column are
 * measured with the sheet's room available, exactly as the operator can arrange
 * before opening a review.
 */
async function foldDock(win) {
  const open = await win.webContents.executeJavaScript(
    `Boolean(document.querySelector('[data-testid="chat-collapse"]'))`,
  );
  if (!open) return;
  await click(win, '[data-testid="chat-collapse"]');
  await waitFor(
    win,
    `(document.querySelector(".shell")?.className ?? "").includes("shell--chat-collapsed")`,
    "the chat dock to fold away",
  );
  await frames(win);
}

/** The rail state as one small object, for both the driver's checks and the report. */
function railState(page) {
  return {
    progress: page.progress,
    hint: page.hint,
    rows: page.railButtons,
    lifeStatus: page.lifeStatus,
    lifeDisabled: page.lifeItem ? page.lifeItem.disabled : null,
    statuses: {
      health: page.healthStatus,
      mind: page.mindStatus,
      financial: page.financeStatus,
      business: page.businessStatus,
      relationships: page.relationshipsStatus,
    },
  };
}

/** Claim the checklist's rows, order and statuses as one falsifiable block. */
function assertRail(page, when, { statuses, progress, lifeStatus, lifeDisabled, lifeEnabled = false }) {
  if (!page.railPresent) failure(`${when}: the Review checklist rail is not on the page`);
  if (page.railLabel !== "Review checklist") {
    failure(`${when}: the checklist's aria-label read ${JSON.stringify(page.railLabel)}`);
  }
  if (!page.layoutPresent) failure(`${when}: the page's review-page-layout wrapper is not on the page`);
  if (page.layoutSingle === true) failure(`${when}: a weekly review was rendered as a single column`);
  if (JSON.stringify(page.railButtons) !== JSON.stringify(RAIL_ROWS)) {
    failure(
      `${when}: the checklist's rows are ${JSON.stringify(page.railButtons)}, expected ${JSON.stringify(RAIL_ROWS)} (Life first, then the live areas in vault order)`,
    );
  }
  if (page.railButtons.includes(LOCKED_ROW)) {
    failure(`${when}: the checklist offers a review for the locked spirit area`);
  }
  if (page.progress !== progress) {
    failure(`${when}: the checklist's progress reads ${JSON.stringify(page.progress)}, expected ${JSON.stringify(progress)}`);
  }
  for (const [slug, expected] of Object.entries(statuses)) {
    const actual = page[`${slug === "financial" ? "finance" : slug}Status`];
    if (actual !== expected) {
      failure(`${when}: the ${slug} row reads ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }
  if (lifeStatus !== undefined && page.lifeStatus !== lifeStatus) {
    failure(`${when}: the Life review's status reads ${JSON.stringify(page.lifeStatus)}, expected ${JSON.stringify(lifeStatus)}`);
  }
  if (lifeDisabled !== undefined && (!page.lifeItem || page.lifeItem.disabled !== lifeDisabled)) {
    failure(
      `${when}: the Life review button is ${page.lifeItem ? (page.lifeItem.disabled ? "disabled" : "enabled") : "missing"}, expected ${lifeDisabled ? "disabled" : "enabled"}`,
    );
  }
  if (lifeEnabled && page.lifeItem && page.lifeItem.disabled) {
    failure(`${when}: the Life review is still disabled although every area is done`);
  }
}

/** Claim the document surface the feature must not regress. */
function assertDocument(page, when, { blocks }) {
  if (page.boxes !== 1) failure(`${when}: the review page drew ${page.boxes} editor boxes`);
  if (page.editing) failure(`${when}: the review page opened a writing line on arrival`);
  if (page.blockCount !== blocks) {
    failure(`${when}: the review opened with ${page.blockCount} block(s), expected ${blocks}`);
  }
  if (page.blanks !== 1) {
    failure(`${when}: the review drew ${page.blanks} blank line(s), expected 1`);
  }
  if (!page.boxText.includes("Two walks, and one late night.")) {
    failure(`${when}: the rendered review read ${JSON.stringify(page.boxText.slice(0, 160))}`);
  }
  if (page.boxText.includes("**")) {
    failure(`${when}: raw markdown markers are painted in the review box`);
  }
  if (page.actions.includes("Edit") || page.actions.includes("Save")) {
    failure(`${when}: the review page still offers an Edit/Save pair: ${JSON.stringify(page.actions)}`);
  }
}

async function main() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `review-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();
  const consoleErrors = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") consoleErrors.push(e.message);
  });
  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.reviewRigReady)", "reviewRigReady");
  await foldDock(win);
  // With the dock out of the way the sheet is wide enough for the column's full
  // measure; without this wait the first picture could be of a mid-reflow page.
  await waitFor(
    win,
    `(document.querySelector(".shell__content")?.clientWidth ?? 0) > 1050`,
    "the sheet to take the window without the dock",
  );
  await frames(win);

  // ── 1. the weekly review: the document, and the checklist beside it ───────
  const opened = await sample(win);
  checks.opened = opened;
  checks.openedRail = railState(opened);
  assertDocument(opened, "on arrival", { blocks: 35 });
  // The header is the Daily Journal's shape: the cadence is the page's eyebrow
  // (the name is not repeated as the title), the period is the page's one
  // heading over the prose with a calendar key beside it, and the two step keys
  // sit on the column's own edges as arrows with no label and no frame.
  if (opened.eyebrow !== "Weekly") {
    failure(`the page's eyebrow reads ${JSON.stringify(opened.eyebrow)}, expected "Weekly"`);
  }
  if (!/^Week of \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(String(opened.title))) {
    failure(`the page's heading is not its period: ${JSON.stringify(opened.title)}`);
  }
  if (opened.title !== opened.period) {
    failure(
      `the heading and the period read differently: ${JSON.stringify(opened.title)} / ${JSON.stringify(opened.period)}`,
    );
  }
  if (!opened.calendar) {
    failure("the review header has no calendar key beside the period");
  }
  const headerParts = opened.headerParts;
  for (const [name, shape] of [
    ["previous", headerParts.prevShape],
    ["next", headerParts.nextShape],
  ]) {
    if (!shape) {
      failure(`the ${name} step is not on the page`);
      continue;
    }
    if (shape.text !== "") {
      failure(`the ${name} step carries text ${JSON.stringify(shape.text)}; it must be an arrow only`);
    }
    if (shape.borderStyle !== "none" || shape.borderTop !== "0px") {
      failure(`the ${name} step wears a frame (${shape.borderStyle} ${shape.borderTop})`);
    }
    if (shape.background !== "rgba(0, 0, 0, 0)" && shape.background !== "transparent") {
      failure(`the ${name} step wears a fill (${shape.background})`);
    }
  }
  if (!headerParts.page || !headerParts.block) {
    failure("the header's column or period block could not be measured");
  } else {
    const pageCentre = (headerParts.page.left + headerParts.page.right) / 2;
    const blockCentre = (headerParts.block.left + headerParts.block.right) / 2;
    if (Math.abs(blockCentre - pageCentre) > 2) {
      failure(`the period block is not centred over the column: ${blockCentre} vs ${pageCentre}`);
    }
    if (headerParts.prev && Math.abs(headerParts.prev.left - headerParts.page.left) > 2) {
      failure(
        `the previous step is not on the column's leading edge: ${headerParts.prev.left} vs ${headerParts.page.left}`,
      );
    }
    if (headerParts.next && Math.abs(headerParts.next.right - headerParts.page.right) > 2) {
      failure(
        `the next step is not on the column's trailing edge: ${headerParts.next.right} vs ${headerParts.page.right}`,
      );
    }
  }
  assertRail(opened, "on arrival", {
    statuses: {
      health: "Done",
      mind: "Not started",
      financial: "In progress",
      business: "Not started",
      relationships: "Not started",
    },
    progress: `1 of ${TOTAL_AREAS} areas done`,
    // Four areas are not done: the Life review must say how many are left and
    // must be unusable until there are none.
    lifeStatus: `${TOTAL_AREAS - 1} areas left`,
    lifeDisabled: true,
  });
  // The scope line names the scope the page is on, and only an area scope offers
  // the way back to the whole-life review.
  if (opened.scopeName !== "Life") {
    failure(`the scope line's name read ${JSON.stringify(opened.scopeName)}, expected "Life"`);
  }
  if (!String(opened.scopeLine).includes("Reviewing")) {
    failure(`the scope line does not say what is being reviewed: ${JSON.stringify(opened.scopeLine)}`);
  }
  if (opened.scopeWholeLifeLink) {
    failure("the whole-life link is offered while the page IS the whole-life review");
  }
  if (opened.markDoneLabel !== "Mark life review complete") {
    failure(`the mark-done button reads ${JSON.stringify(opened.markDoneLabel)}`);
  }
  // The pair must be centred at the default window, where the sheet has room for
  // the column's full measure.
  checks.centering = assertTwoColumn(opened.layout, "at the default window", {
    spareFloor: 2,
  });
  await shot(win, "review-document.png");
  await shot(win, "review-checklist.png");

  // ── 2. a wide window: the column keeps its measure, the pair centres ──────
  // The operator's report is about wide monitors: a page run from the leading
  // edge leaves every spare pixel on one side, and a rail pinned to the window's
  // edge leaves the pair split apart. The window is widened past what the pair
  // needs, so the only way both claims hold is if the column stayed 48rem and
  // the pair's own spare room is empty page on both sides, split evenly.
  win.setContentSize(WIDE_SIZE.width, WIDE_SIZE.height);
  await waitFor(
    win,
    `(document.querySelector(".shell__content")?.clientWidth ?? 0) > 1200`,
    "the sheet to take the wide window",
  );
  await frames(win);
  const wide = await sample(win);
  checks.wide = wide;
  checks.wideCentering = assertTwoColumn(wide.layout, "in a wide window", {
    spareFloor: 100,
  });
  await shot(win, "review-wide.png");

  // ── 3. a narrow window: no room for a rail beside the column, so it stacks ─
  win.setContentSize(NARROW_SIZE.width, NARROW_SIZE.height);
  await waitFor(
    win,
    `(() => {
      const rail = document.querySelector('[data-testid="review-area-rail"]');
      const page = document.querySelector(".review-page");
      if (!rail || !page) return false;
      return rail.getBoundingClientRect().bottom <= page.getBoundingClientRect().top + 1;
    })()`,
    "the checklist to stack above the reading column",
  );
  await frames(win);
  const narrow = await sample(win);
  checks.narrow = narrow;
  checks.narrowColumns = assertStacked(narrow.layout, "in a narrow window");
  // The rail is still the checklist, just moved: the rows and statuses do not
  // change with the layout.
  assertRail(narrow, "in a narrow window", {
    statuses: {
      health: "Done",
      mind: "Not started",
      financial: "In progress",
      business: "Not started",
      relationships: "Not started",
    },
    progress: `1 of ${TOTAL_AREAS} areas done`,
    lifeStatus: `${TOTAL_AREAS - 1} areas left`,
    lifeDisabled: true,
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  await waitFor(
    win,
    `(document.querySelector(".shell__content")?.clientWidth ?? 0) > 900`,
    "the default window back",
  );
  await frames(win);

  // ── 4. a blank line the operator typed reaches the file ──────────────────
  // Edited at the paragraph BELOW the blank line, so the write is caused by a
  // real change and the blank line has to survive the box's own re-cut of the
  // note — which is exactly what used to collapse it.
  await openBlock(win, 4);
  await type(win, "Slept badly, and it showed at work.");
  await leaveTheLine(win);
  await waitFor(
    win,
    "(window.reviewRigWrites ?? []).length > 0",
    "the autosave to reach the bridge",
  );
  const afterBlankLine = await fileBody(win);
  checks.blankLineBody = afterBlankLine;
  if (
    !afterBlankLine.includes(
      "Two walks, and **one** late night.\n\n\n\nSlept badly, and it showed at work.",
    )
  ) {
    failure(
      `the blank line the operator typed did not survive the write: ${JSON.stringify(afterBlankLine.slice(0, 220))}`,
    );
  }
  const blanksAfter = await sample(win);
  checks.blankLineBlocks = blanksAfter.blanks;
  if (blanksAfter.blanks !== 1) {
    failure(`the blank line disappeared from the box: ${blanksAfter.blanks} drawn`);
  }

  // ── 5. the formatting keys ───────────────────────────────────────────────
  await openBlock(win, 2);
  await type(win, "alpha beta gamma");
  await select(win, 6, 10);
  const bolded = await pressKey(win, "b", { ctrl: true });
  checks.bolded = bolded;
  if (!bolded || !bolded.prevented) failure("Ctrl+B was not claimed by the editor");
  if (bolded?.value !== "alpha **beta** gamma") {
    failure(`Ctrl+B wrote ${JSON.stringify(bolded?.value)}`);
  }
  if (bolded?.start !== 8 || bolded?.end !== 12) {
    failure(`Ctrl+B left the selection at ${bolded?.start}-${bolded?.end}, expected 8-12`);
  }
  await select(win, 0, 5);
  const underlined = await pressKey(win, "u", { ctrl: true });
  checks.underlined = underlined;
  if (underlined?.value !== "<u>alpha</u> **beta** gamma") {
    failure(`Ctrl+U wrote ${JSON.stringify(underlined?.value)}`);
  }
  await select(win, 0, 0);
  const headed = await pressKey(win, "2", { ctrl: true });
  checks.headed = headed;
  if (headed?.value !== "## <u>alpha</u> **beta** gamma") {
    failure(`Ctrl+2 wrote ${JSON.stringify(headed?.value)}`);
  }
  // Pressing it again replaces the heading rather than stacking a second one.
  const reheaded = await pressKey(win, "3", { ctrl: true });
  checks.reheaded = reheaded;
  if (reheaded?.value !== "### <u>alpha</u> **beta** gamma") {
    failure(`Ctrl+3 on an H2 wrote ${JSON.stringify(reheaded?.value)}`);
  }
  await leaveTheLine(win);
  await frames(win);
  const formatted = await sample(win);
  checks.formatted = formatted;
  if (formatted.underlines < 1) failure("the underline mark did not render as <u>");
  if (formatted.strong < 1) failure("the bold mark did not render as <strong>");
  if (formatted.headings < 5) {
    failure(`the review drew ${formatted.headings} headings, expected at least 5`);
  }
  if (!formatted.boxText.includes("alpha beta gamma")) {
    failure("the heading the formatting keys wrote is not rendered");
  }
  if (formatted.boxText.includes("<u>")) {
    failure("the underline tag is printed literally in the box");
  }

  // ── 6. the Finance row starts Finance — even with the agent down ─────────
  // A rail row is a start request, so the snapshot pass must run for the scope
  // the row names before the agent is asked for anything: the document is the
  // operator's and must be open and filled whether or not a gateway is up.
  await setHarness(win, "window.reviewRigAgentDown = true");
  await click(win, '[data-testid="review-area-financial"]');
  await waitFor(
    win,
    `(document.querySelector(".form-error")?.textContent ?? "").includes("Settings › Hermes")`,
    "the agent error",
  );
  await waitFor(
    win,
    "(window.reviewRigSnapshotCalls ?? []).length > 0",
    "the snapshot pass to run",
  );
  await frames(win);
  const agentDown = await sample(win);
  checks.agentDown = agentDown;
  checks.agentDownRail = railState(agentDown);
  if (!agentDown.error || !agentDown.error.includes("Settings › Hermes")) {
    failure(`the agent failure did not say where to fix it: ${JSON.stringify(agentDown.error)}`);
  }
  if (agentDown.error && /fetch failed/i.test(agentDown.error)) {
    failure("the page reported the transport's own words instead of the failure");
  }
  if (agentDown.boxes !== 1 || agentDown.editing) {
    failure("an agent that is not answering took the review document away");
  }
  // Pressing a row puts the page on that area: the scope line and the selected
  // row must agree, or the kickoff and the box are about different sections.
  if (agentDown.scopeName !== "Finance") {
    failure(`the rail press left the scope line on ${JSON.stringify(agentDown.scopeName)}`);
  }
  if (!agentDown.financeItem || !String(agentDown.financeItem.className).includes("is-active")) {
    failure("the Finance row is not the selected row after it was pressed");
  }
  if (!String(agentDown.scopeLine).includes("Whole-life review")) {
    failure(
      `an area scope does not offer the way back to the whole-life review: ${JSON.stringify(agentDown.scopeLine)}`,
    );
  }
  const snapshotCalls = await setHarness(win, "window.reviewRigSnapshotCalls");
  checks.agentDownSnapshotCalls = snapshotCalls;
  if (snapshotCalls.length !== 1) {
    failure(`the failed start ran the snapshot pass ${snapshotCalls.length} time(s), expected 1`);
  } else if (snapshotCalls[0]?.scope !== "financial") {
    failure(
      `the Finance row ran the snapshot pass for scope ${JSON.stringify(snapshotCalls[0]?.scope)}`,
    );
  }
  const filledBody = await fileBody(win);
  checks.filledBody = filledBody;
  if (occurrences(filledBody, "<!-- lifequest:snapshot:finance-spend -->") !== 1) {
    failure("the snapshot marker is not in the file exactly once");
  }
  if (!filledBody.includes("| Groceries | 1,234.56 |")) {
    failure("the snapshot did not carry the figure the rule asked for");
  }
  // The block belongs under `## Finance` / `### Look-back`, not under the overall
  // `## Look-back`: the rule names the financial domain's section.
  const financeAt = filledBody.indexOf("## Finance");
  const financeLookback = filledBody.indexOf("### Look-back", Math.max(financeAt, 0));
  const snapshotAt = filledBody.indexOf("<!-- lifequest:snapshot:finance-spend -->");
  const financeKeep = filledBody.indexOf("### Keep", Math.max(financeLookback, 0));
  if (!(financeAt !== -1 && financeLookback !== -1 && snapshotAt > financeLookback && snapshotAt < financeKeep)) {
    failure(
      `the snapshot did not land in Finance's Look-back section (finance ${financeAt}, lookback ${financeLookback}, snapshot ${snapshotAt}, keep ${financeKeep})`,
    );
  }
  // The markers are comments: the box prints the figure and hides the machinery.
  if (!agentDown.boxText.includes("Spending this period")) {
    failure("the filled snapshot is not visible in the review");
  }
  if (agentDown.boxText.includes("lifequest:snapshot")) {
    failure("the snapshot marker is printed in the review");
  }
  // And the figure is a TABLE, not a paragraph of pipes: a snapshot drawn as
  // `| Category | Total | | --- | --- |` is worse than no snapshot at all.
  if (agentDown.tables < 1) failure("the snapshot's table is not drawn as a table");
  if (!agentDown.headers.includes("Category") || !agentDown.headers.includes("Total (ZAR)")) {
    failure(`the snapshot's table headers read ${JSON.stringify(agentDown.headers)}`);
  }
  if (agentDown.boxText.includes("| --- |")) {
    failure("the snapshot's table is painted as markdown pipes");
  }
  await shot(win, "review-started.png");

  // ── 7. the Finance row opens the Finance interview, and finishing it flips
  //       the row ────────────────────────────────────────────────────────────
  await setHarness(win, "window.reviewRigAgentDown = false");
  // Hold the start's turn open until the sidebar has been sampled: the reported
  // bug was that the chat was missing from Chats FOR THE WHOLE RUN, so the check
  // is only meaningful while the turn is still going.
  await setHarness(win, "window.reviewRigHoldTurns = true");
  await click(win, '[data-testid="review-area-financial"]');
  await waitFor(
    win,
    "(window.reviewRigStarts ?? []).length === 1",
    "the Finance review session to be requested",
  );
  await frames(win);
  const started = await sample(win);
  checks.started = started;
  const starts = await setHarness(win, "window.reviewRigStarts");
  checks.starts = starts;
  if (started.error) failure(`the second Finance start reported ${JSON.stringify(started.error)}`);
  if (starts[0]?.scope !== "financial") {
    failure(`the Finance row started scope ${JSON.stringify(starts[0]?.scope)}`);
  }
  if (starts[0]?.cadence !== "weekly") {
    failure(`the Finance row started a ${JSON.stringify(starts[0]?.cadence)} review`);
  }
  // The kickoff is the interview's first turn, so it must name the section this
  // row is about — and say to leave the others alone.
  if (!String(starts[0]?.kickoff).includes("## Finance")) {
    failure(`the Finance kickoff does not name its own section: ${JSON.stringify(starts[0]?.kickoff)}`);
  }
  if (!String(starts[0]?.kickoff).includes("only")) {
    failure(`the Finance kickoff does not scope the companion to one section: ${JSON.stringify(starts[0]?.kickoff)}`);
  }
  await waitForDockKickoffs(win, 1);
  const kickoffs = await setHarness(win, "window.reviewRigKickoffs");
  checks.financeKickoffs = kickoffs;
  if (kickoffs.length !== 1 || !kickoffs[0].includes("## Finance")) {
    failure(`the dock was sent ${kickoffs.length} kickoff(s), not the Finance one`);
  }

  // ── 7b. the started interview is in Chats WHILE the agent is working ─────
  // The renderer read the chat list before this session existed, and it will
  // not read it again until the turn settles. So this row can only be there if
  // the dock adopted the row the page was handed; waiting for the next list
  // read is exactly the bug — the chat missing from Chats for the whole run.
  await frames(win);
  const createdChats = await setHarness(win, "window.reviewRigSessions()");
  const startedChat =
    createdChats.find((row) => row.id === starts[0]?.sessionId) ?? null;
  const sidebar = await chatSidebar(win);
  checks.startedSidebar = sidebar;
  checks.startedChat = startedChat;
  if (!sidebar.present) {
    failure("the shell has no Chats list to check the started interview against");
  }
  if (!startedChat) {
    failure(
      `the gateway has no chat for the Finance start ${JSON.stringify(starts[0]?.sessionId)}`,
    );
  }
  const listedChat = sidebar.rows.find((row) => row.label === startedChat?.title) ?? null;
  if (!listedChat) {
    failure(
      `the started review chat is not listed in Chats while it runs: ${JSON.stringify(
        sidebar.rows.map((row) => row.label),
      )}`,
    );
  } else {
    if (!listedChat.active) {
      failure("the started review chat's Chats row is not the open chat");
    }
    if (!listedChat.live) {
      failure("the started review chat's Chats row does not show its turn running");
    }
  }
  await shot(win, "review-chat-sidebar.png");
  // Release the held turn: the rest of the run is not about a live turn.
  await setHarness(win, "window.reviewRigHoldTurns = false");
  await setHarness(win, "window.reviewRigReleaseTurns()");

  // ── 7c. the calendar beside the period walks to another week ────────────
  // The period is the page's one heading, and the calendar key beside it opens
  // the app's day picker; choosing a day takes the page to that day's week. The
  // arrows then walk back to the open week, where Next is the wall.
  const baseWeek = opened.periodData;
  // Starting the Finance interview scrolled the reading column to Finance's
  // section; bring the header back into view so the calendar's popover is
  // anchored under a visible key (and the picture shows what the operator does).
  await win.webContents.executeJavaScript(`(() => {
    document.querySelector(".shell__content")?.scrollTo({ top: 0 });
    window.scrollTo(0, 0);
    return true;
  })()`);
  await frames(win);
  await click(win, '[data-testid="review-calendar"]');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="day-picker"]'))`,
    "the period calendar to open",
  );
  const pickerMonth = await setHarness(
    win,
    `document.querySelector('[data-testid="day-picker-month"]').textContent.trim()`,
  );
  await click(win, '[data-testid="day-picker-prev-month"]');
  await waitFor(
    win,
    `document.querySelector('[data-testid="day-picker-month"]').textContent.trim() !== ${JSON.stringify(pickerMonth)}`,
    "the calendar's previous month",
  );
  await shot(win, "review-calendar.png");
  const chosenDay = await win.webContents.executeJavaScript(`(() => {
    const day = Array.from(document.querySelectorAll('[data-testid^="day-picker-day-"]')).find(
      (el) => !el.disabled,
    );
    if (!day) return null;
    const iso = day.dataset.date;
    day.click();
    return iso;
  })()`);
  checks.picker = { baseWeek, pickerMonth, chosenDay };
  if (!chosenDay) {
    failure("the calendar drew no selectable day");
  } else {
    const expectedWeek = weekStartOnOrBefore(chosenDay);
    checks.picker.expectedWeek = expectedWeek;
    await waitFor(
      win,
      `(document.querySelector('[data-testid="review-period"]')?.dataset.period ?? "") === ${JSON.stringify(expectedWeek)}`,
      "the page to move to the chosen day's week",
    );
    await frames(win);
    const moved = await sample(win);
    checks.picker.moved = {
      period: moved.periodData,
      title: moved.title,
      nextDisabled: moved.nextDisabled,
    };
    if (moved.periodData !== expectedWeek) {
      failure(
        `the calendar opened week ${JSON.stringify(moved.periodData)}, expected ${JSON.stringify(expectedWeek)}`,
      );
    }
    if (!/^Week of /.test(String(moved.title))) {
      failure(`the moved page's heading is not a week: ${JSON.stringify(moved.title)}`);
    }
    if (moved.nextDisabled !== false) {
      failure("Next is disabled on an older week, where the open week is still ahead");
    }
    await waitFor(
      win,
      `!document.querySelector('[data-testid="day-picker"]')`,
      "the calendar to close after choosing",
    );
    // Walk back with the arrow steps; the open week is the wall.
    let steps = 0;
    while ((await pagePeriod(win)) !== baseWeek && steps < 12) {
      const before = await pagePeriod(win);
      const stepped = await click(win, '[data-testid="review-next"]');
      if (!stepped) {
        failure("the Next step disappeared while walking back to the open week");
        break;
      }
      await waitFor(
        win,
        `(document.querySelector('[data-testid="review-period"]')?.dataset.period ?? "") !== ${JSON.stringify(before)}`,
        "the Next step to move the page",
      );
      steps += 1;
    }
    const back = await sample(win);
    checks.picker.back = {
      period: back.periodData,
      nextDisabled: back.nextDisabled,
      steps,
    };
    if (back.periodData !== baseWeek) {
      failure(
        `the steps did not walk back to the open week: ended on ${JSON.stringify(back.periodData)}, expected ${JSON.stringify(baseWeek)}`,
      );
    }
    if (back.nextDisabled !== true) {
      failure("Next is not disabled on the open week");
    }
  }

  if (!started.notice || !/snapshot/i.test(started.notice)) {
    failure(`the page did not say what it filled: ${JSON.stringify(started.notice)}`);
  }
  if (!started.notice || !/chat/i.test(started.notice)) {
    failure(`the page did not say the interview opened: ${JSON.stringify(started.notice)}`);
  }
  if (started.markDoneLabel !== "Mark Finance review complete") {
    failure(`the mark-done button reads ${JSON.stringify(started.markDoneLabel)}, expected the Finance form`);
  }
  const twice = await fileBody(win);
  checks.startedTwiceBody = twice;
  if (occurrences(twice, "<!-- lifequest:snapshot:finance-spend -->") !== 1) {
    failure("a second start appended a second snapshot block");
  }
  if (occurrences(twice, "| Groceries | 1,234.56 |") !== 1) {
    failure("a second start appended the snapshot's own table again");
  }
  // Completing the area completes ONLY that area: the rail says so, and the file
  // it is reading says so — one scope `done`, not the file locked.
  await click(win, '[data-testid="review-mark-done"]');
  await waitForRailStatus(win, "financial", "Done");
  await frames(win);
  const financeDone = await sample(win);
  checks.financeDone = financeDone;
  checks.financeDoneRail = railState(financeDone);
  if (financeDone.notice && !/Finance review complete/.test(financeDone.notice)) {
    failure(`finishing Finance said ${JSON.stringify(financeDone.notice)}`);
  }
  if (financeDone.progress !== `2 of ${TOTAL_AREAS} areas done`) {
    failure(`the progress after Finance reads ${JSON.stringify(financeDone.progress)}, expected 2 of ${TOTAL_AREAS}`);
  }
  const scopesAfterFinance = await fileScopes(win);
  checks.scopesAfterFinance = scopesAfterFinance;
  if (scopesAfterFinance.financial?.status !== "done") {
    failure(`the review file's financial scope is ${JSON.stringify(scopesAfterFinance.financial)}, expected done`);
  }
  if (await fileLocked(win)) failure("marking one area done locked the whole file");

  // ── 8. finish the remaining areas; the last one unlocks the life review ──
  // Each remaining row starts its own scope and then completes it. The progress
  // line must count up, and the area that is last must be the one that lifts the
  // Life review's gate — not any earlier one.
  const remaining = [
    { slug: "mind", name: "Mind" },
    { slug: "business", name: "Business" },
    { slug: "relationships", name: "Relationships" },
  ];
  let completed = 2; // Health (fixture) and Finance.
  for (const area of remaining) {
    const expectedStarts = 1 + remaining.findIndex((r) => r.slug === area.slug);
    await click(win, `[data-testid="review-area-${area.slug}"]`);
    await waitFor(
      win,
      `(window.reviewRigStarts ?? []).length === ${expectedStarts + 1}`,
      `the ${area.name} review session to be requested`,
    );
    await frames(win);
    const areaStart = await sample(win);
    const areaStarts = await setHarness(win, "window.reviewRigStarts");
    const last = areaStarts[areaStarts.length - 1];
    checks[`started${area.name}`] = { page: areaStart, start: last };
    if (last?.scope !== area.slug) {
      failure(`the ${area.name} row started scope ${JSON.stringify(last?.scope)}`);
    }
    if (!String(last?.kickoff).includes(`## ${area.name}`)) {
      failure(`the ${area.name} kickoff does not name its own section: ${JSON.stringify(last?.kickoff)}`);
    }
    if (areaStart.scopeName !== area.name) {
      failure(`the ${area.name} row left the scope line on ${JSON.stringify(areaStart.scopeName)}`);
    }
    if (areaStart.markDoneLabel !== `Mark ${area.name} review complete`) {
      failure(`the mark-done button reads ${JSON.stringify(areaStart.markDoneLabel)}`);
    }
    if (areaStart.scopeWholeLifeLink !== true) {
      failure(`the ${area.name} scope does not offer the whole-life review link`);
    }
    await click(win, '[data-testid="review-mark-done"]');
    await waitForRailStatus(win, area.slug, "Done");
    await frames(win);
    completed += 1;
    const donePage = await sample(win);
    checks[`completed${area.name}`] = donePage;
    if (donePage.progress !== `${completed} of ${TOTAL_AREAS} areas done`) {
      failure(
        `the progress after ${area.name} reads ${JSON.stringify(donePage.progress)}, expected ${completed} of ${TOTAL_AREAS}`,
      );
    }
    const isLast = area.slug === remaining[remaining.length - 1].slug;
    if (isLast) {
      if (!/Every area is reviewed/.test(String(donePage.notice))) {
        failure(`finishing the last area said ${JSON.stringify(donePage.notice)}, not that every area is reviewed`);
      }
      if (!/All areas are reviewed/i.test(String(donePage.hint))) {
        failure(`the checklist hint after the last area reads ${JSON.stringify(donePage.hint)}`);
      }
      if (!donePage.lifeItem || donePage.lifeItem.disabled) {
        failure("the Life review is still disabled after the last area was completed");
      }
      if (donePage.lifeStatus !== "In progress") {
        failure(`the Life review's status reads ${JSON.stringify(donePage.lifeStatus)}, expected "In progress" (the file's overall scope is planted but unstarted)`);
      }
    } else if (!String(donePage.notice).includes(`${area.name} review complete`)) {
      failure(`finishing ${area.name} said ${JSON.stringify(donePage.notice)}`);
    }
  }
  const allDone = await sample(win);
  checks.allDone = allDone;
  checks.allDoneRail = railState(allDone);
  if (allDone.progress !== `${TOTAL_AREAS} of ${TOTAL_AREAS} areas done`) {
    failure(`every area is done but the progress reads ${JSON.stringify(allDone.progress)}`);
  }
  for (const area of AREA_ROWS) {
    const status = allDone[`${area.slug === "financial" ? "finance" : area.slug}Status`];
    if (status !== "Done") failure(`the ${area.name} row reads ${JSON.stringify(status)} after every area was completed`);
  }
  // The picture is of the checklist, not of the dock the starts opened.
  await foldDock(win);
  await shot(win, "review-life-ready.png");

  // ── 9. the daily review is one general review, with no checklist ─────────
  // The rig is on an area lens (Relationships, pressed in step 8) when it
  // navigates to Daily: the daily page must ignore it — one general review,
  // scope `overall`, and a kickoff that says there are no area sections.
  await setHarness(win, 'window.reviewRigGoto("/review/daily")');
  await waitFor(
    win,
    `(() => {
      const eyebrow = document.querySelector('[data-testid="wing-eyebrow"]');
      return Boolean(eyebrow) && eyebrow.textContent.trim() === "Daily";
    })()`,
    "the daily review page",
  );
  await waitFor(win, `Boolean(document.querySelector('[data-testid="review-empty"]'))`, "the daily empty state");
  await frames(win);
  const dailyOpen = await sample(win);
  checks.dailyOpen = dailyOpen;
  if (dailyOpen.railPresent) failure("the daily review drew an area checklist");
  if (dailyOpen.railButtons.length > 0) {
    failure(`the daily review drew area controls: ${JSON.stringify(dailyOpen.railButtons)}`);
  }
  if (dailyOpen.scopeLine !== null || dailyOpen.scopeName !== null) {
    failure(`the daily review drew a scope line: ${JSON.stringify(dailyOpen.scopeLine)}`);
  }
  if (!dailyOpen.layoutPresent || dailyOpen.layoutSingle !== true) {
    failure("the daily review is not rendered as the single-column review-page-layout");
  }
  if (dailyOpen.startLabel !== "Start the interview") {
    failure(`the daily review's empty-state button reads ${JSON.stringify(dailyOpen.startLabel)}`);
  }
  if (dailyOpen.emptyPresent !== true) {
    failure("the daily review did not draw its empty state for a day with no file");
  }
  const dailyStartCount = async () => (await setHarness(win, "window.reviewRigStarts")).length;
  const beforeDaily = await dailyStartCount();
  await click(win, '[data-testid="review-start"]');
  await waitFor(
    win,
    `(window.reviewRigStarts ?? []).length === ${beforeDaily + 1}`,
    "the daily review session to be requested",
  );
  await frames(win);
  const dailyStarted = await sample(win);
  checks.dailyStarted = dailyStarted;
  const dailyStarts = await setHarness(win, "window.reviewRigStarts");
  const dailyStart = dailyStarts[dailyStarts.length - 1];
  checks.dailyStart = dailyStart;
  if (dailyStart?.cadence !== "daily") {
    failure(`the daily start asked for a ${JSON.stringify(dailyStart?.cadence)} review`);
  }
  // The lens was Relationships; a daily review that honoured it would start an
  // area scope. It must start the one general `overall` scope.
  if (dailyStart?.scope !== "overall") {
    failure(`the daily review started scope ${JSON.stringify(dailyStart?.scope)}, expected overall (the lens must be ignored)`);
  }
  if (!String(dailyStart?.kickoff).includes("one general review")) {
    failure(`the daily kickoff does not say it is one general review: ${JSON.stringify(dailyStart?.kickoff)}`);
  }
  if (!String(dailyStart?.kickoff).includes("no area sections")) {
    failure(`the daily kickoff does not say there are no area sections: ${JSON.stringify(dailyStart?.kickoff)}`);
  }
  await waitForDockKickoffs(win, dailyStarts.length);
  const dailyKickoffs = await setHarness(win, "window.reviewRigKickoffs");
  if (!String(dailyKickoffs[dailyKickoffs.length - 1]).includes("no area sections")) {
    failure("the dock was not told the daily review has no area sections");
  }
  const dailyBody = await fileBody(win);
  checks.dailyBody = dailyBody;
  if (!dailyBody.includes("## Look-back")) {
    failure("the daily review file does not hold the overall skeleton");
  }
  if (dailyBody.includes("### ")) {
    failure("the daily review file grew area (###) sections");
  }
  for (const area of AREA_ROWS) {
    if (dailyBody.includes(`## ${area.name}`)) {
      failure(`the daily review file grew a ${area.name} section`);
    }
  }
  if (dailyStarted.railPresent || dailyStarted.railButtons.length > 0) {
    failure("the daily review grew a checklist after its interview started");
  }
  if (dailyStarted.markDoneLabel !== "Mark review complete") {
    failure(`the daily review's mark-done button reads ${JSON.stringify(dailyStarted.markDoneLabel)}`);
  }
  if (dailyStarted.boxes !== 1) failure("the started daily review is not one document box");
  await foldDock(win);
  await shot(win, "review-daily.png");

  // ── 9b. the agent fills the open daily review, then marks it complete ──────
  // The reported bug: the companion writes the report as the interview goes and
  // marks the daily review complete with its own tool calls in the main process.
  // The operator is sitting on the page. Before this leg's fix the box kept the
  // skeleton it was opened with until they left the page and came back, and the
  // locked page still offered a Mark-review-complete button although the agent
  // had already marked it. The rig writes and completes that week's file outside
  // the page's bridge and fires main's announcement, the only way a tool call in
  // main reaches the renderer.
  await waitFor(
    win,
    "Boolean(window.reviewRigDataListenerCount && window.reviewRigDataListenerCount() > 0)",
    "the daily page to subscribe to the vault's change signal",
  );
  // A probe on the editor's own DOM node: an update that remounts the page (or a
  // navigation) would lose it, and "the box filled" would then be a story about a
  // rebuilt page rather than about the page that was already open.
  await setHarness(
    win,
    `(() => {
      const box = document.querySelector(".note-live");
      if (!box) return false;
      box.dataset.liveProbe = "kept";
      return true;
    })()`,
  );
  const dailyGetsBefore = await reviewGetCount(win);
  const dailyWritesBefore = (await setHarness(win, "window.reviewRigWrites")).length;
  const filledDaily = `${dailyBody}\n\nA morning walk, a hard afternoon, and an early night.`;
  const dailyWrite = await setHarness(
    win,
    `window.reviewRigAgentWritesBody(${JSON.stringify(filledDaily)})`,
  );
  checks.dailyAgentWrite = dailyWrite;
  if (!dailyWrite || dailyWrite.ok !== true) {
    failure(`the agent's daily report was refused by the rig: ${JSON.stringify(dailyWrite)}`);
  }
  await waitFor(
    win,
    `(document.querySelector(".note-live")?.textContent ?? "").includes("A morning walk")`,
    "the agent's daily report to appear in the open box",
  );
  await frames(win);
  const dailyFilled = await sample(win);
  checks.dailyFilled = dailyFilled;
  checks.dailyFillReReads = (await reviewGetCount(win)) - dailyGetsBefore;
  checks.dailyFillWrites =
    (await setHarness(win, "window.reviewRigWrites")).length - dailyWritesBefore;
  if (!String(dailyFilled.boxText).includes("A morning walk, a hard afternoon")) {
    failure("the agent's daily report never appeared in the open box");
  }
  if (!(checks.dailyFillReReads > 0)) {
    failure("the daily box filled without the page re-reading the review from the vault");
  }
  if (checks.dailyFillWrites !== 0) {
    failure(
      `adopting the agent's report wrote it back to the vault ${checks.dailyFillWrites} time(s)`,
    );
  }
  if (dailyFilled.lockedBadge !== null) {
    failure(
      `the daily review is locked before the agent marked it complete: ${JSON.stringify(dailyFilled.lockedBadge)}`,
    );
  }

  // Now the completion: the file locks, and the page must adopt the final body
  // AND drop the Mark-review-complete button the agent has made redundant.
  const dailyComplete = await setHarness(win, 'window.reviewRigAgentMarksDone("overall")');
  checks.dailyAgentComplete = dailyComplete;
  if (!dailyComplete || dailyComplete.ok !== true) {
    failure(`the agent's daily completion was refused by the rig: ${JSON.stringify(dailyComplete)}`);
  }
  await waitFor(
    win,
    `(document.querySelector(".review-page__lock-badge")?.textContent ?? "").trim() === "Locked"`,
    "the daily review's locked badge",
  );
  await waitFor(
    win,
    `!document.querySelector('[data-testid="review-mark-done"]')`,
    "the mark-done button to leave the locked daily review",
  );
  await frames(win);
  const dailyLocked = await sample(win);
  checks.dailyLocked = dailyLocked;
  checks.dailyLockedBody = await fileBody(win);
  checks.dailyProbe = await setHarness(
    win,
    `document.querySelector(".note-live")?.dataset.liveProbe ?? null`,
  );
  if (dailyLocked.lockedBadge !== "Locked") {
    failure(`the locked daily review shows ${JSON.stringify(dailyLocked.lockedBadge)} instead of Locked`);
  }
  if (dailyLocked.markDoneLabel !== null) {
    failure(
      `the locked daily review still offers a mark-done button: ${JSON.stringify(dailyLocked.markDoneLabel)}`,
    );
  }
  if (!dailyLocked.unlockPresent) failure("the locked daily review offers no way to unlock it");
  if (dailyLocked.readOnly !== true) failure("the locked daily review's box is not read-only");
  if (!String(dailyLocked.boxText).includes("A morning walk, a hard afternoon")) {
    failure(
      `the locked daily review's box lost the report the agent wrote: ${JSON.stringify(String(dailyLocked.boxText).slice(0, 200))}`,
    );
  }
  if (checks.dailyProbe !== "kept") {
    failure("the locked daily review was remounted: the open page's own box is gone");
  }
  if (!(await fileLocked(win))) {
    failure("the daily review's file is not locked after the agent finished it");
  }
  await shot(win, "review-daily-complete.png");

  // ── 10. back on the weekly review: no second view, and the rules work ────
  // The daily review ignored the lens but did not consume it: the weekly page is
  // still on the area that was pressed last, which is the whole point of the
  // title-bar lens surviving a page that has no areas.
  await setHarness(win, 'window.reviewRigGoto("/review/weekly")');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="review-area-rail"]'))`,
    "back on the weekly review",
  );
  // The rail is drawn outside the loaded-record branch, so its presence only says
  // the weekly route rendered. The box is drawn once the period's review has been
  // read; wait for it, or a sample can catch the loading paint and read a
  // heading-less skeleton — the transient this leg used to fail on.
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="review-editor"]'))`,
    "the weekly review's box to load",
  );
  await frames(win);
  const back = await sample(win);
  checks.back = back;
  if (back.scopeName !== "Relationships") {
    failure(`returning to the weekly review left the scope on ${JSON.stringify(back.scopeName)}, expected Relationships`);
  }
  if (back.markDoneLabel !== "Mark Relationships review complete") {
    failure(`the weekly mark-done button reads ${JSON.stringify(back.markDoneLabel)}`);
  }
  // The box is the page: there is no Document/Preview pair to switch between,
  // and no second surface of the file. The whole file is in the one box, its
  // operator-written parts included.
  const modeButtons = await setHarness(
    win,
    `Array.from(document.querySelectorAll('[data-testid^="review-mode-"]')).map((el) => el.getAttribute("data-testid"))`,
  );
  checks.modeButtons = modeButtons;
  if (back.modes.length !== 0) {
    failure(`the review page still offers view controls: ${JSON.stringify(back.modes)}`);
  }
  if (modeButtons.length > 0) {
    failure(`the review page still has view buttons: ${JSON.stringify(modeButtons)}`);
  }
  if (back.previewShown) failure("the review page still draws a Preview surface");
  if (!String(back.boxText).includes("A note outside the skeleton.")) {
    failure("the one box dropped a section the operator wrote");
  }
  if (!String(back.boxText).includes("alpha beta gamma")) {
    failure("the one box dropped the heading the operator wrote");
  }
  assertRail(back, "back on the weekly review", {
    statuses: {
      health: "Done",
      mind: "Done",
      financial: "Done",
      business: "Done",
      relationships: "Done",
    },
    progress: `${TOTAL_AREAS} of ${TOTAL_AREAS} areas done`,
    lifeStatus: "In progress",
    lifeEnabled: true,
  });
  // The cadence's own rules: read from the page, written from the page.
  await click(win, '[data-testid="review-skill-toggle"]');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="review-skill-editor"]'))`,
    "the rules panel",
  );
  await waitFor(
    win,
    `(document.querySelector('[data-testid="review-skill-editor"]')?.textContent ?? "").includes("Keep it to a page.")`,
    "the cadence's rules to arrive",
  );
  const rules = await sample(win);
  checks.rules = rules;
  if (!(rules.skillValue ?? "").includes("Keep it to a page.")) {
    failure(`the rules panel did not show the cadence's rules: ${JSON.stringify(rules.skillValue)}`);
  }
  await foldDock(win);
  await shot(win, "review-rules.png");
  const nextRules = "# Weekly review skill\n\n- Always ask about sleep.\n";
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="review-skill-editor"] textarea')
      ?? document.querySelector('[data-testid="review-skill-editor"] [data-note-block]');
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    return true;
  })()`);
  await waitFor(win, `Boolean(document.querySelector('[data-testid="review-skill-editor"] textarea'))`, "the rules writing line");
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="review-skill-editor"] textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(nextRules)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`);
  await click(win, '[data-testid="review-skill-save"]');
  await waitFor(
    win,
    "(window.reviewRigSkillWrites ?? []).length > 0",
    "the rules write to reach the bridge",
  );
  const skillWrites = await setHarness(win, "window.reviewRigSkillWrites");
  checks.skillWrites = skillWrites;
  if (skillWrites.length !== 1) failure(`the rules were written ${skillWrites.length} times`);
  if (!String(skillWrites[0] ?? "").includes("Always ask about sleep.")) {
    failure(`the rules write carried ${JSON.stringify(skillWrites[0])}`);
  }
  await click(win, '[data-testid="review-skill-toggle"]');
  await waitFor(
    win,
    `!document.querySelector('[data-testid="review-skill-editor"]')`,
    "the rules panel to fold away",
  );

  // ── 11. the life review: summarise across the areas, then lock the file ──
  // The daily review also started scope `overall`, so the wait is for a NEW
  // session at the next index, not merely for the last one to be `overall`.
  const startsBeforeLife = (await setHarness(win, "window.reviewRigStarts")).length;
  await click(win, '[data-testid="review-area-overall"]');
  await waitFor(
    win,
    `(window.reviewRigStarts ?? []).length === ${startsBeforeLife + 1} &&
      window.reviewRigStarts[${startsBeforeLife}].scope === "overall"`,
    "the life review session to be requested",
  );
  await frames(win);
  const lifeStarted = await sample(win);
  checks.lifeStarted = lifeStarted;
  const lifeStarts = await setHarness(win, "window.reviewRigStarts");
  const lifeStart = lifeStarts[lifeStarts.length - 1];
  checks.lifeStart = lifeStart;
  if (lifeStart?.scope !== "overall") {
    failure(`the Life review row started scope ${JSON.stringify(lifeStart?.scope)}`);
  }
  // The life review is the summary pass: its kickoff must tell the companion to
  // read across the area sections, not to write one of them.
  if (!String(lifeStart?.kickoff).includes("whole-life review")) {
    failure(`the life-review kickoff is not the whole-life one: ${JSON.stringify(lifeStart?.kickoff)}`);
  }
  if (!String(lifeStart?.kickoff).includes("area")) {
    failure(`the life-review kickoff does not speak about the areas: ${JSON.stringify(lifeStart?.kickoff)}`);
  }
  await waitForDockKickoffs(win, lifeStarts.length);
  const lifeKickoffs = await setHarness(win, "window.reviewRigKickoffs");
  if (!String(lifeKickoffs[lifeKickoffs.length - 1]).includes("whole-life review")) {
    failure("the dock was not sent the whole-life kickoff");
  }
  if (lifeStarted.lifeStatus !== "In progress") {
    failure(`the Life review's status while it is being worked reads ${JSON.stringify(lifeStarted.lifeStatus)}`);
  }
  if (lifeStarted.scopeName !== "Life") {
    failure(`the life review left the scope line on ${JSON.stringify(lifeStarted.scopeName)}`);
  }
  if (lifeStarted.scopeWholeLifeLink) {
    failure("the whole-life link is offered while the page IS the whole-life review");
  }
  if (lifeStarted.markDoneLabel !== "Mark life review complete") {
    failure(`the life review's mark-done button reads ${JSON.stringify(lifeStarted.markDoneLabel)}`);
  }
  // Marking it complete is the only thing that locks the file. Every rail row
  // must be dead afterwards, and a write through the bridge must be refused.
  await click(win, '[data-testid="review-mark-done"]');
  await waitFor(
    win,
    `(document.querySelector(".review-page__lock-badge")?.textContent ?? "").trim() === "Locked"`,
    "the locked badge",
  );
  await waitForRailStatus(win, "overall", "Done");
  await frames(win);
  const locked = await sample(win);
  checks.locked = locked;
  checks.lockedRail = railState(locked);
  if (locked.lockedBadge !== "Locked") failure("the review did not show its Locked badge");
  if (locked.lifeStatus !== "Done") failure(`the Life review's status reads ${JSON.stringify(locked.lifeStatus)}`);
  if (locked.progress !== `${TOTAL_AREAS} of ${TOTAL_AREAS} areas done`) {
    failure(`the locked review's progress reads ${JSON.stringify(locked.progress)}`);
  }
  for (const row of [...AREA_ROWS, { slug: "overall", name: "Life" }]) {
    const item = row.slug === "overall" ? locked.lifeItem : locked[`${row.slug === "financial" ? "finance" : row.slug}Item`];
    if (!item || item.disabled !== true) {
      failure(`the ${row.name} row is still pressable on a locked review`);
    }
  }
  if (!locked.unlockPresent) failure("the locked review offers no way to unlock it");
  // The page's own Mark-done call is what locked this file; the button must not
  // survive it, or it offers to re-mark a review that is already final.
  if (locked.markDoneLabel !== null) {
    failure(`the locked review still offers a mark-done button: ${JSON.stringify(locked.markDoneLabel)}`);
  }
  if (locked.status !== "Locked") failure(`the page's status line reads ${JSON.stringify(locked.status)}`);
  if (!(await fileLocked(win))) failure("the file is not locked after the life review was marked complete");
  const lockedScopes = await fileScopes(win);
  checks.lockedScopes = lockedScopes;
  if (lockedScopes.overall?.status !== "done") {
    failure(`the review file's overall scope is ${JSON.stringify(lockedScopes.overall)}, expected done`);
  }
  // The lock is on the FILE, not only on the badge: a write attempted through
  // the bridge is refused, and the body does not move.
  const period = String(lifeStart?.period ?? "");
  const refusedWrite = await win.webContents.executeJavaScript(
    `window.lifequest.reviewWrite("weekly", ${JSON.stringify(period)}, "tampered after lock").then((r) => r.ok === false && typeof r.error === "string")`,
  );
  checks.refusedWrite = refusedWrite;
  if (refusedWrite !== true) failure("a write to the locked review was accepted");
  const lockedBody = await fileBody(win);
  checks.lockedBody = lockedBody;
  if (lockedBody.includes("tampered after lock")) failure("the refused write reached the locked review file");
  for (const area of AREA_ROWS) {
    if (occurrences(lockedBody, `\n## ${area.name}\n`) !== 1) {
      failure(`the locked review holds ${occurrences(lockedBody, `\n## ${area.name}\n`)} ${area.name} sections, expected 1`);
    }
  }
  if (occurrences(lockedBody, "<!-- lifequest:snapshot:finance-spend -->") !== 1) {
    failure("the lock changed the snapshot block");
  }

  // ── 12. an agent's mark reaches the checklist of the OPEN page ────────────
  // The reported bug: the companion finishes an interview and marks the area (or
  // the life review) done with its own tool call in the main process. The
  // operator is already on the review page, and the checklist stayed stale until
  // they left it and came back. This leg walks to the previous, still-open week
  // so the current week's locked story is untouched, leaves the page there, and
  // changes that week's file the way the agent's tool does — outside the page's
  // bridge — then fires main's change announcement.
  await click(win, '[data-testid="review-prev"]');
  await waitFor(
    win,
    `document.querySelector('[data-testid="review-period"]')?.dataset.period !== ${JSON.stringify(period)}`,
    "the page to move to the previous week",
  );
  await waitForRailStatus(win, "financial", "In progress");
  await waitFor(
    win,
    "Boolean(window.reviewRigDataListenerCount && window.reviewRigDataListenerCount() > 0)",
    "the page to subscribe to the vault's change signal",
  );
  await frames(win);
  const livePeriod = String(await pagePeriod(win));
  const beforeLive = await sample(win);
  checks.liveBefore = beforeLive;
  checks.livePeriod = livePeriod;
  checks.liveDataListeners = await setHarness(win, "window.reviewRigDataListenerCount()");
  if (!(checks.liveDataListeners > 0)) {
    failure(
      "the review page does not listen to the vault's change signal, so an agent's mark can never reach the open checklist",
    );
  }
  // A probe on the editor's own DOM node: a reload, a remount or a navigation
  // would lose it, and "the checklist updated" would then be a story about a
  // rebuilt page rather than about the page that was already open.
  await setHarness(
    win,
    `(() => {
      const box = document.querySelector(".note-live");
      if (!box) return false;
      box.dataset.liveProbe = "kept";
      return true;
    })()`,
  );
  const getsBefore = await reviewGetCount(win);

  const financeMark = await setHarness(win, 'window.reviewRigAgentMarksDone("financial")');
  checks.liveFinanceMark = financeMark;
  if (!financeMark || financeMark.ok !== true) {
    failure(`the agent's Finance mark was refused by the rig: ${JSON.stringify(financeMark)}`);
  }
  await waitForRailStatus(win, "financial", "Done");
  await frames(win);
  const liveFinance = await sample(win);
  checks.liveFinance = liveFinance;
  const getsAfter = await reviewGetCount(win);
  checks.liveReReads = getsAfter - getsBefore;
  if (!(getsAfter > getsBefore)) {
    failure(
      "the checklist flipped without the page re-reading the review — the new state was handed to it, not read from the vault",
    );
  }
  if (liveFinance.periodData !== livePeriod) {
    failure(
      `the agent's mark moved the page to ${JSON.stringify(liveFinance.periodData)}, from ${JSON.stringify(livePeriod)}`,
    );
  }
  if (liveFinance.progress !== `2 of ${TOTAL_AREAS} areas done`) {
    failure(
      `the live progress after the agent's Finance mark reads ${JSON.stringify(liveFinance.progress)}, expected 2 of ${TOTAL_AREAS}`,
    );
  }
  if (liveFinance.financeStatus !== "Done") {
    failure(`the Finance row reads ${JSON.stringify(liveFinance.financeStatus)} after the agent marked it done`);
  }
  if (liveFinance.mindStatus !== "Not started") {
    failure(`the Mind row reads ${JSON.stringify(liveFinance.mindStatus)} although the agent touched only Finance`);
  }
  const liveProbe = await setHarness(
    win,
    `document.querySelector(".note-live")?.dataset.liveProbe ?? null`,
  );
  checks.liveProbe = liveProbe;
  if (liveProbe !== "kept") failure("the live update replaced the page instead of updating it");
  await shot(win, "review-live-checklist.png");

  // The Life review's gate lifts on LIVE marks too. The remaining areas have no
  // scope on this week — nobody started them — so the rig first creates them the
  // way the operator's own row press does (`review:ensure`, a write main
  // announces), and then the agent finishes each one.
  for (const slug of ["mind", "business", "relationships"]) {
    await win.webContents.executeJavaScript(
      `window.lifequest.reviewEnsure("weekly", ${JSON.stringify(livePeriod)}, ${JSON.stringify(slug)})`,
    );
  }
  await setHarness(win, "window.reviewRigAnnounceDataChange()");
  for (const slug of ["mind", "business", "relationships"]) {
    await waitForRailStatus(win, slug, "In progress");
    const marked = await setHarness(win, `window.reviewRigAgentMarksDone(${JSON.stringify(slug)})`);
    if (!marked || marked.ok !== true) {
      failure(`the agent's ${slug} mark was refused by the rig: ${JSON.stringify(marked)}`);
    }
    await waitForRailStatus(win, slug, "Done");
  }
  await waitFor(
    win,
    `(document.querySelector('[data-testid="review-area-progress"]')?.textContent ?? "").includes("${TOTAL_AREAS} of ${TOTAL_AREAS}")`,
    "the live marks to count up",
  );
  await frames(win);
  const liveGated = await sample(win);
  checks.liveGated = liveGated;
  if (!/All areas are reviewed/i.test(String(liveGated.hint))) {
    failure(`the checklist hint after the agent finished every area reads ${JSON.stringify(liveGated.hint)}`);
  }
  if (!liveGated.lifeItem || liveGated.lifeItem.disabled) {
    failure("the Life review is still disabled after the agent finished every area live");
  }
  if (liveGated.lifeStatus !== "In progress") {
    failure(`the Life review's live status reads ${JSON.stringify(liveGated.lifeStatus)}, expected "In progress"`);
  }

  // And the life review itself, marked done by the agent, locks the open page —
  // badge, status line, and every rail row dead — with no reload.
  const overallMark = await setHarness(win, 'window.reviewRigAgentMarksDone("overall")');
  checks.liveOverallMark = overallMark;
  if (!overallMark || overallMark.ok !== true) {
    failure(`the agent's life-review mark was refused by the rig: ${JSON.stringify(overallMark)}`);
  }
  await waitFor(
    win,
    `(document.querySelector(".review-page__lock-badge")?.textContent ?? "").trim() === "Locked"`,
    "the live locked badge",
  );
  await waitForRailStatus(win, "overall", "Done");
  await frames(win);
  const liveLocked = await sample(win);
  checks.liveLocked = liveLocked;
  if (liveLocked.lifeStatus !== "Done") {
    failure(`the Life review row reads ${JSON.stringify(liveLocked.lifeStatus)} after the agent completed it`);
  }
  if (liveLocked.status !== "Locked") {
    failure(`the page's status line reads ${JSON.stringify(liveLocked.status)} after the agent locked the review`);
  }
  if (liveLocked.periodData !== livePeriod) {
    failure("the agent's life-review mark navigated the page");
  }
  if (!(await fileLocked(win))) failure("the previous week's file is not locked after the agent completed it");

  // ── 13. nothing unexpected, nothing on fire ──────────────────────────────
  const finalStarts = await setHarness(win, "window.reviewRigStarts");
  checks.startsAll = finalStarts;
  const finalKickoffs = await setHarness(win, "window.reviewRigKickoffs");
  checks.kickoffsAll = finalKickoffs;
  const scopeSequence = finalStarts.map((entry) => `${entry.cadence}:${entry.scope}`);
  checks.scopeSequence = scopeSequence;
  const expectedSequence = [
    "weekly:financial",
    "weekly:mind",
    "weekly:business",
    "weekly:relationships",
    "daily:overall",
    "weekly:overall",
  ];
  if (JSON.stringify(scopeSequence) !== JSON.stringify(expectedSequence)) {
    failure(
      `the sessions the page started are ${JSON.stringify(scopeSequence)}, expected ${JSON.stringify(expectedSequence)} (each row its own scope, the day general, the life review last)`,
    );
  }
  await waitFor(
    win,
    `(window.reviewRigKickoffs ?? []).length === ${finalStarts.length}`,
    "every start to hand its kickoff to the dock",
    5_000,
  );
  const kickoffsNow = await setHarness(win, "window.reviewRigKickoffs");
  checks.kickoffsMatched = kickoffsNow.length;
  if (kickoffsNow.length !== finalStarts.length) {
    failure(`${kickoffsNow.length} kickoff(s) reached the dock for ${finalStarts.length} start(s)`);
  }
  // One failed start (the agent-down press) attempted a session without opening
  // one; the successful Finance press is the only finance start.
  const calls = await setHarness(win, "window.reviewRigCalls");
  checks.calls = calls;
  // Every read must name a period of the cadence it asked for. A page that keeps
  // the previous cadence's period for a render reads a review that cannot exist
  // (and here, seeds one), so the bogus read is named rather than left to a
  // timing-dependent sample further up.
  const crossCadenceReads = calls
    .filter((call) => call.startsWith("reviewGet:"))
    .map((call) => call.split(":"))
    .filter(([, cadence, period]) => !periodBelongsToCadence(cadence, period));
  checks.crossCadenceReads = crossCadenceReads;
  if (crossCadenceReads.length > 0) {
    failure(
      `the page read a review for a period its cadence does not have: ${JSON.stringify(crossCadenceReads)}`,
    );
  }
  const failedFinanceStarts = calls.filter(
    (call) => call === "reviewStartOrResume:weekly:" + period + ":financial",
  ).length;
  checks.failedFinanceStarts = failedFinanceStarts;
  if (failedFinanceStarts !== 2) {
    failure(`the Finance row asked for a session ${failedFinanceStarts} time(s), expected 2 (agent down, then up)`);
  }
  const unexpected = await setHarness(win, "window.reviewRigUnexpectedCalls");
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "review.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `[review] ${errors.length === 0 ? "PASS" : "FAIL"} — ${errors.length} failure(s)`,
  );
  for (const message of errors) console.log(`  ✗ ${message}`);
  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

setTimeout(() => {
  console.error("review rig timed out");
  app.exit(1);
}, 120_000);

app
  .whenReady()
  .then(main)
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`review rig threw: ${message}`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "review.json"),
      `${JSON.stringify(
        {
          pass: false,
          failures: [...errors, message],
          checks,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    app.exit(1);
  });
