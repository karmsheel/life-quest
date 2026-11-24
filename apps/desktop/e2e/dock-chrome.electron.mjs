/**
 * Drives the dock-chrome harness page (`e2e/chat-panel.html?caps=full&agents=1`)
 * in a real Electron window and turns the layout engine's own measurements into
 * `e2e/artifacts/dock-chrome.{json,png}`.
 *
 * Run with the dev server up on 5173 (the Lead's `lifequest-e2e` wrapper puts
 * THIS checkout there):
 *
 *   node e2e/dock-chrome.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, and two pictures of the shipped screen
 * (the narrow dock and the wide one) so nobody has to eyeball the app.
 *
 * ── the three surfaces this rig exists to measure ────────────────────────────
 *
 *  1. The thread's NAME ROW is the name itself, not a band: a single quiet
 *     button — the whole name is the target — sized to the chat's title,
 *     horizontally centred, hanging flush under the tab strip. It has no
 *     border, no fill and no pencil; its ink is the neutral `--muted` token,
 *     quieter than the transcript's `--fg` prose. The label keeps the heading
 *     classes and carries the title and nothing else, one type step down (about
 *     0.7rem). Clicking the name opens the rename field in its own place — a
 *     bare input with no Save/Cancel keys: blur (clicking away) saves, Enter
 *     blurs into that same save, and Escape cancels without writing anything.
 *     The tab menu's Rename opens that same field.
 *
 *  2. The COMPOSER'S SIDE GUTTERS grow with the dock. `--composer-gutter` is
 *     defined on `.chat-panel__footer` and spent as the composer form's
 *     horizontal padding, so the composer box is inset symmetrically by a
 *     measured gutter that is 12px at the 300px floor, follows
 *     `12 + 0.16 * (C - 300)` while it is under the cap, and is finally capped
 *     at 12.5% of the band's content width. At 360 the composer still nearly
 *     fills the dock; at 900 it leaves real gaps.
 *
 *  3. The AGENT SWITCHER now lives on the composer form, not over the top-right
 *     of the transcript. Wide dock: it stands in the right-hand gutter, centred
 *     in it, its bottom level with the composer box's. Narrow dock: that gutter
 *     is too thin, so the same block steps up just above the composer form —
 *     never up over the band's interview card or retired-model notice, which is
 *     why the form and not the band is its anchor — and takes the corner over
 *     the transcript's bottom-right. `.chat-panel__footer` is a CSS container
 *     (`container-type: inline-size`) and the `@container` query is what makes
 *     the switch.
 *
 *  4. The TRANSCRIPT'S TEXT COLUMN keeps the composer's measure: on a wide dock
 *     the body's content box is exactly the composer box's width — the same
 *     gutter on the leading side, and on the trailing side that gutter less the
 *     reserved scrollbar's 0.5rem, so the text's right edge (not a scrollbar's
 *     width inside the column) lands on the composer box's edge. At the 300px
 *     floor the body's 0.875rem minimum is a couple of pixels wider than the
 *     composer's 12px, so the column may be up to 4px narrower there and no
 *     more. The message rows are the second witness: their union must cover that
 *     column (some row starts on its leading edge, some ends on its trailing
 *     edge) and no row may escape it. Which side the operator's bubble sits on is
 *     the transcript's business, not this rig's, so the witness is the rows as a
 *     block rather than one role's bubble.
 *
 * ── every way this could fail, written down before the code ───────────────────
 *
 * The rig is a system-in-isolation test (the real ChatPanel, the real CSS, the
 * real layout engine; only the IPC bridge is stubbed). So the failure modes are
 * listed first, and each one has a named check below:
 *
 *  Chip
 *   C1. The chip never renders — component not changed, `data-testid` missing or
 *       misspelled, or the thread header drew the old band instead.
 *   C2. The chip is a full-width band rather than a box sized to its text: its
 *       width tracks the panel, not the label.
 *   C3. The chip is not flush under the strip — a margin, padding or an extra
 *       row pushed it down (or the strip is gone).
 *   C4. The chip is off-centre — `justify-content: flex-start` left behind.
 *   C5. The chip overflows the panel at the narrow dock — no max-width, or the
 *       title's ellipsis lost.
 *   C6. The name's font-size regressed to the band's 0.85rem (13.6px), or was
 *       squeezed under 9px by the chip's layout.
 *   C7. The label lost `.chat-panel__heading`/`--thread`, or carries icon text
 *       (a pencil SVG's accessible name leaking into `textContent`).
 *   C8. The name is not the control: not a button, or the chip still carries a
 *       pencil/SVG (the retired rename control regressed back in).
 *   C9. The chip still paints chrome: a border, a card fill, or bright ink —
 *       the row is meant to be neutral gray text, quieter than the transcript's
 *       own prose.
 *  C10. Clicking the name does not open the rename field, the field is not
 *       prefilled, or it opens somewhere other than the name's own row (or
 *       brings back Save/Cancel keys the contract removed).
 *  C11. Escape does not cancel: the field stays open, or a title is committed
 *       anyway (a write with no operator behind it).
 *  C12. Blur does not save: clicking away leaves the field open or writes no
 *       title patch. Enter fails to commit through that same save path.
 *  C13. The tab menu's Rename no longer opens the same field, or a longer saved
 *       name no longer grows the chip.
 *  C14. The old `.chat-panel__header--thread` wrapper was removed, or it no
 *       longer starts at the strip's bottom edge (the name is right but the
 *       header regressed).
 *
 *  Gutters
 *   G1. `--composer-gutter` is not defined on the footer, so the gutter is the
 *       band's flat 12px at every width and the wide dock is still edge-to-edge.
 *   G2. The gutter is asymmetric: one side wider than the other.
 *   G3. The gutter falls as the dock grows (the wrong sign in the `calc`).
 *   G4. The narrow dock loses composer width (gutter too large at the floor):
 *       composer/panel under 0.84 at W=360.
 *   G5. The wide dock still stretches edge to edge: composer/panel over 0.80 at
 *       W=900, i.e. the 12.5% cap never binds.
 *   G6. The curve is the wrong curve (wrong slope or wrong intercept): measured
 *       gutter misses the expected value by more than the tolerance.
 *   G7. The drive itself fails: `--chatbar-width` on `.shell` does not resolve
 *       into the dock's column, so every number is measured at the wrong width.
 *
 *  Transcript column
 *   T1. The transcript keeps the retired band's flat 0.875rem gutter while the
 *       composer grows with the dock, so a wide dock has a narrow text column
 *       over a wide field — the operator's request, unfixed.
 *   T2. The trailing padding forgets the reserved scrollbar, so the text's right
 *       edge lands a scrollbar's width (0.5rem) inside the composer box's edge.
 *   T3. `scrollbar-gutter` is not `stable` on the scroller: the reserved bar
 *       appears and disappears with the conversation, so the text column changes
 *       width as the chat grows and the two edges drift apart.
 *   T4. The padding moves the rows but not the text the operator reads: the
 *       message rows' union no longer covers the column's edges (a row escaped it
 *       or the rows collapsed away from it), i.e. the text is not actually in the
 *       measured content box.
 *   T5. At the 300px floor the body's 0.875rem floor is wider than the composer's
 *       12px, so the column is legitimately a few pixels narrower — a bounded
 *       exception, not a silent loosening: 4px, checked by name.
 *
 *  Agent switcher
 *   S1. The switcher does not render at all — `AgentsProvider` missing from the
 *       `?agents=1` page, the component moved but returns null, or the harness
 *       list never arrives.
 *   S2. The switcher did not leave the old top-right corner (still a direct
 *       child of the panel) or is not a child of the composer form it belongs
 *       to — the fallback's anchor is what decides where it floats.
 *   S3. Wide dock: the block overlaps the composer box (`left` left of the
 *       box's right edge) — the gutter is not wide enough or the block is not
 *       centred in it.
 *   S4. Wide dock: the block is not centred on the gutter — the form's trailing
 *       edge measured from the wrong 0.75rem is the classic way to be 12px out.
 *   S5. Wide dock: its bottom edge is not level with the composer box's.
 *   S6. Wide dock: the block escapes the panel's right edge.
 *   S7. Narrow dock: the fallback anchors to the band instead of the composer,
 *       so the band's interview card or retired-model notice pushes the block up
 *       mid-panel over the transcript instead of just above the composer; or it
 *       covers the composer box; or its trailing edge is not the dock's own
 *       0.75rem inset.
 *   S8. The footer is not a CSS container, so the `@container` query is inert
 *       and the narrow layout never happens — the reason the block overlaps at
 *       narrow widths even though the rule is written.
 *   S9. Only one pill renders, or none is marked active: the harness fixture
 *       stopped feeding the switcher both companions.
 *  S10. The `?agents=1` page itself fails to mount (a provider order mistake —
 *       `AgentsProvider` reads the vault, so it must sit inside `VaultProvider`),
 *       taking the dock down with it.
 *
 *  Report / harness
 *   R1. The driver throws and leaves no artifact: caught, written to the report,
 *       and the process exits non-zero.
 *   R2. The driver hangs (a wait that never settles): a watchdog writes the
 *       report with the marks it reached and exits non-zero.
 *   R3. A screenshot is missing or empty: both PNGs are written through
 *       `capturePage` and checked to exist with bytes.
 *   R4. `report.pass` and the exit code disagree: both are derived from
 *       `failures`, and the wrapper re-reads them.
 *
 * Every check is named, and every failure lands in `report.failures` with its
 * measured numbers, so a regression names the field it broke rather than just
 * "dock chrome failed".
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
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/chat-panel.html?caps=full&agents=1";

// Each rig gets its own Electron profile: the app keeps window state in
// localStorage, and two rigs sharing one profile can see each other's writes.
const userDataDir = path.join(artifactsDir, "userdata", "dock-chrome");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

/**
 * The window is wide enough for the widest panel this rig asks for (1100px)
 * plus the 16rem rail, and tall enough for the composer band to be fully
 * visible. Fixed, so the panel height — and therefore the band and the chip —
 * is a known quantity rather than whatever the WM decided.
 */
const WINDOW = { width: 1440, height: 900 };

/** The widths the gutter ladder is sampled at, narrow to wide. */
const WIDTHS = [300, 360, 480, 600, 760, 900, 1100];

/** The narrow dock's two sample widths (both below the 34rem band threshold). */
const NARROW_AT = [360, 500];

/** The wide dock's two sample widths (both well above the band's 34rem switch). */
const WIDE_AT = [620, 900];

/** The panel width at which the switcher's container query changes sides. */
const WIDE_MODE_MIN_WIDTH = 568;

/** The dock's own 0.75rem inset: its trailing edge in the narrow layout. */
const NARROW_RIGHT_INSET_PX = 12;

/**
 * The narrow fallback's float above the composer: the shipped rule is
 * `bottom: calc(100% + 0.35rem)`, i.e. 5.6px above the form's (and here the
 * composer box's) top edge. This is the number that catches a fallback anchored
 * to the band again: with the band's own 12px padding under it, a band-anchored
 * block ends 17.6px above the box even on a band with no cards, and far higher
 * once an interview card or the retired-model notice is in it.
 */
const NARROW_COMPOSER_GAP_PX = 5.6;
const NARROW_GAP_TOLERANCE_PX = 1.5;

const GUTTER_TOLERANCE_PX = 2.5;
const GUTTER_SYMMETRY_PX = 1;
const COMPOSER_NARROW_RATIO_MIN = 0.84;
const COMPOSER_WIDE_RATIO_MAX = 0.8;
const CHIP_TOP_PX = 1;
/**
 * The name row has no trailing actions slot any more — the full-screen door moved
 * to the bottom action bar — so the name should sit on the dock's centre line.
 * 4px accepts the sub-pixel disagreement between the name's box and the dock's
 * while still catching the regression this check exists for: a row left on
 * `justify-content: flex-start` puts the name tens (or hundreds) of pixels out.
 */
const CHIP_CENTRE_PX = 4;
const CHIP_FONT_MIN_PX = 9;
const CHIP_FONT_MAX_PX = 12.5;
/**
 * How much quieter than the transcript's ink the name's ink has to be, as a
 * contrast-ratio margin against the dock's own canvas: the name must draw at
 * least this much less contrast than the `--fg` prose. `--muted` clears it by a
 * wide margin; a regression back to `--fg` (the old chip's colour) scores the
 * same contrast as the transcript and fails.
 */
const CHIP_CONTRAST_MARGIN = 1;
const SWITCHER_CENTRE_PX = 3;
const SWITCHER_BOTTOM_PX = 2;
const SWITCHER_RIGHT_PX = 3;

/**
 * The name the rename leg commits. Long enough that the chip's box has to grow
 * from the one-word fixture title, short enough that it stays off the chip's
 * max-width at 900px so "grew with the title" measures the title and not the
 * clamp.
 */
const LONG_TITLE = "A deliberately longer conversation title for the dock chip";

/** A title typed and then cancelled: it must never reach the bridge or the chip. */
const CANCELLED_TITLE = "A name Escape must throw away";

/**
 * The title the blur leg saves. The field has no Save key at all — clicking
 * anywhere else is the save — so this is the name that must reach the bridge
 * patch and the chip after the field loses focus.
 */
const BLUR_TITLE = "A name saved by clicking away";

/**
 * The expected gutter, straight from the contract, in px:
 *
 *   G(C) = min(0.75rem + (C - 18.75rem) * 0.16, 12.5% of the band)
 *        = min(12 + (C - 300) * 0.16, 0.125 * (C - 12))
 *
 * C is the dock's half of the grid — `--chat-column` — not the panel's rendered
 * box: the dock carries the shell's trailing frame (12px) into the window's
 * slack, so `panel.clientWidth === C + 12`, and the percentage cap resolves
 * against the footer's own content width (`panel.clientWidth - 24`), i.e.
 * `C - 12`. That is why the measured cap at C=1100 is 136px, not the 134.5 a
 * cap expressed on C itself would give. The two branches meet between 900 and
 * 1100, so the ladder measures both: the linear climb up to 900, and the
 * percentage cap at 1100.
 *
 * The drive's own check proves C is what was asked for, so this function is fed
 * the measured column rather than the requested width.
 */
const expectedGutterPx = (columnWidth) =>
  Math.min(12 + 0.16 * (columnWidth - 300), 0.125 * (columnWidth - 12));

/**
 * The page-side snapshot: every box this rig asserts on, plus the three derived
 * positions (chip under strip, chip on the panel's centre line, switcher on the
 * gutter's centre line). One read keeps all of them from one layout pass, so a
 * number can never be compared with a box measured after a later reflow.
 */
const SAMPLE = `(() => {
  const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const px = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: round(r.left),
      top: round(r.top),
      right: round(r.right),
      bottom: round(r.bottom),
      width: round(r.width),
      height: round(r.height)
    };
  };

  const panelEl = document.querySelector(".chat-panel");
  const shellEl = document.querySelector(".shell");
  if (!panelEl || !shellEl) return null;

  const stripEl = document.querySelector(".chat-panel__tabs");
  const headerEl = document.querySelector(".chat-panel__header--thread");
  const chipEl = document.querySelector('[data-testid="chat-name-chip"]');
  const labelEl = document.querySelector(".chat-panel__heading.chat-panel__heading--thread");
  const editEl = document.querySelector('[data-testid="chat-name-edit"]');
  // The retired pencil's class, kept as its own witness: a regression that
  // brought the control back would otherwise hide behind a missing test id.
  const nameEditClassCount = document.querySelectorAll(".chat-panel__name-edit").length;
  const footerEl = document.querySelector(".chat-panel__footer");
  const composerFormEl = document.querySelector("form.chat-panel__composer");
  const composerBoxEl = document.querySelector(".chat-panel__composer-box");
  // The visible thread transcript. The chain body and the shortcuts reference are
  // in the DOM too but hidden; this is the one the thread's messages render into.
  const transcriptBodyEl = document.querySelector(
    ".chat-panel__body:not(.chat-panel__body--chain):not(.chat-panel__body--shortcuts)",
  );
  const messagesEl = document.querySelector(".chat-panel__messages");
  const messageEls = Array.from(document.querySelectorAll(".chat-panel__message"));
  const userMessageEl = document.querySelector(".chat-panel__message--user");
  const assistantMessages = Array.from(
    document.querySelectorAll(".chat-panel__message--assistant"),
  );
  const lastAssistantEl = assistantMessages[assistantMessages.length - 1] ?? null;
  const switcherEl = document.querySelector(".agent-switcher");
  const tabLabelEl = document.querySelector(".chat-panel__tab--active .chat-panel__tab-label");

  const panel = rect(panelEl);
  const strip = rect(stripEl);
  const header = rect(headerEl);
  const chip = rect(chipEl);
  const label = rect(labelEl);
  const edit = rect(editEl);
  const footer = rect(footerEl);
  const composerForm = rect(composerFormEl);
  const composerBox = rect(composerBoxEl);
  const transcriptBody = rect(transcriptBodyEl);
  const messages = rect(messagesEl);
  const messageRows = messageEls.map((el) => rect(el)).filter(Boolean);
  const userMessage = rect(userMessageEl);
  const lastAssistant = rect(lastAssistantEl);
  const switcher = rect(switcherEl);

  const chipStyle = chipEl ? getComputedStyle(chipEl) : null;
  const labelStyle = labelEl ? getComputedStyle(labelEl) : null;
  const footerStyle = footerEl ? getComputedStyle(footerEl) : null;
  const transcriptStyle = transcriptBodyEl ? getComputedStyle(transcriptBodyEl) : null;
  const switcherStyle = switcherEl ? getComputedStyle(switcherEl) : null;
  const shellStyle = getComputedStyle(shellEl);

  // ── the name's resting ink, as colours rather than tokens ─────────────────
  // The contract is a colour claim, so the tokens are resolved into computed
  // colours and compared numerically: the name wears var(--muted), and it has
  // to read quieter than the transcript's var(--fg) prose. "Quieter" is
  // measured as a lower contrast ratio against the dock's own canvas, which
  // holds in either theme (gray on dark and gray on light are both nearer the
  // canvas than full ink).
  const parseRgb = (css) => {
    if (!css) return null;
    const numbers = css
      .replace(/[^0-9.,]/g, " ")
      .split(/[ ,]+/)
      .filter(Boolean)
      .map(Number);
    const rgb = numbers.slice(0, 3);
    return rgb.length === 3 && rgb.every((n) => Number.isFinite(n)) ? rgb : null;
  };
  const linear = (channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = (css) => {
    const rgb = parseRgb(css);
    return rgb === null
      ? null
      : Math.round(
          (0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])) * 1000,
        ) / 1000;
  };
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    if (la === null || lb === null) return null;
    const light = Math.max(la, lb);
    const dark = Math.min(la, lb);
    return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
  };
  // A custom property is text, not a colour, until something wears it: a probe
  // resolves var(--muted) through the same cascade the chip's color takes.
  const tokenColor = (name) => {
    const probe = document.createElement("span");
    probe.style.color = "var(" + name + ")";
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  };
  const inkEl = document.querySelector(".chat-panel__message-content");
  const roleLabelEl = document.querySelector(".chat-panel__message-role");
  const mutedToken = chipEl ? tokenColor("--muted") : null;
  const chipColor = chipStyle ? chipStyle.color : null;
  const inkColor = inkEl ? getComputedStyle(inkEl).color : null;
  const roleLabelColor = roleLabelEl ? getComputedStyle(roleLabelEl).color : null;
  const panelBackground = getComputedStyle(panelEl).backgroundColor;

  // The --chat-column custom property's computed value is the literal token
  // text, so it is read back through the panel's own box: the dock is the column
  // plus the frame it carries into the window's slack. The drive's own assertion
  // uses this.
  const shellFramePx = px(getComputedStyle(document.documentElement).getPropertyValue("--shell-frame")) ?? 12;
  const columnWidthPx = round(panel.width - shellFramePx);

  const gutterLeft = composerBox ? round(composerBox.left - panel.left) : null;
  const gutterRight = composerBox ? round(panel.right - composerBox.right) : null;
  const gutterCentre = composerBox ? round((composerBox.right + panel.right) / 2) : null;
  const switcherCentre = switcher ? round((switcher.left + switcher.right) / 2) : null;
  const headerTopVsStripBottom = header && strip ? round(header.top - strip.bottom) : null;
  const chipTopVsStripBottom = chip && strip ? round(chip.top - strip.bottom) : null;
  const chipCentreVsPanelCentre = chip
    ? round((chip.left + chip.right) / 2 - (panel.left + panel.right) / 2)
    : null;
  // Whether the two boxes share any pixel: the narrow layout must not cover the
  // composer it belongs to, and a bottom-edge comparison alone would not catch
  // a block that overlaps sideways while ending above the composer's bottom.
  const boxesIntersect = (a, b) =>
    a !== null &&
    b !== null &&
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top;
  const switcherIntersectsComposerBox = boxesIntersect(switcher, composerBox);
  const switcherBottomVsComposerBoxTop =
    switcher && composerBox ? round(switcher.bottom - composerBox.top) : null;

  // The transcript's text column, read the way the browser lays it out. The body
  // scroller reserves its scrollbar (scrollbar-gutter: stable), so clientWidth
  // already excludes that bar while still including padding: the content box's
  // right edge is where the text actually ends, not the padding box's edge with a
  // scrollbar's width still to come. The message rows are the second witness:
  // their union must cover this column and every row must stay inside it, so a
  // padding that only moved the rows would show up as rows that no longer land on
  // the composer box's edges.
  const transcriptPaddingLeft = transcriptStyle ? px(transcriptStyle.paddingLeft) : null;
  const transcriptPaddingRight = transcriptStyle ? px(transcriptStyle.paddingRight) : null;
  const transcriptClientWidth = transcriptBodyEl ? transcriptBodyEl.clientWidth : null;
  const transcriptContentLeft =
    transcriptBody && transcriptPaddingLeft !== null
      ? round(transcriptBody.left + transcriptPaddingLeft)
      : null;
  const transcriptContentWidth =
    transcriptClientWidth !== null &&
    transcriptPaddingLeft !== null &&
    transcriptPaddingRight !== null
      ? round(transcriptClientWidth - transcriptPaddingLeft - transcriptPaddingRight)
      : null;
  const transcriptContentRight =
    transcriptContentLeft !== null && transcriptContentWidth !== null
      ? round(transcriptContentLeft + transcriptContentWidth)
      : null;
  // The role-agnostic witness. Which side the operator's bubble sits on is the
  // transcript's own business (the chat and the review surfaces have chosen
  // differently over time), so the claim is about the rows as a block: their
  // union covers the column, and every row stays inside it. A padding that moved
  // the rows but not the text, or a row that escaped the column, shows up here.
  const rowsLeft =
    messageRows.length > 0 ? Math.min(...messageRows.map((row) => row.left)) : null;
  const rowsRight =
    messageRows.length > 0 ? Math.max(...messageRows.map((row) => row.right)) : null;
  const rowsOutsideLeft =
    messageRows.length > 0 && transcriptContentLeft !== null
      ? Math.min(...messageRows.map((row) => row.left - transcriptContentLeft))
      : null;
  const rowsOutsideRight =
    messageRows.length > 0 && transcriptContentRight !== null
      ? Math.min(...messageRows.map((row) => transcriptContentRight - row.right))
      : null;

  return {
    chatSurface: panelEl.getAttribute("data-chat-surface"),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    },
    panel,
    columnWidthPx,
    shellFramePx,
    strip,
    header,
    composerForm,
    composerBox,
    gutterLeftPx: gutterLeft,
    gutterRightPx: gutterRight,
    gutterAveragePx:
      gutterLeft === null || gutterRight === null
        ? null
        : round((gutterLeft + gutterRight) / 2),
    gutterCentrePx: gutterCentre,
    composerWidthRatio: composerBox ? round(composerBox.width / panel.width) : null,
    // The text column the transcript renders into, beside the composer box it
    // must line up with.
    transcript: transcriptBodyEl
      ? {
          body: transcriptBody,
          clientWidthPx: transcriptClientWidth,
          scrollbarWidthPx:
            transcriptBody && transcriptClientWidth !== null
              ? round(transcriptBody.width - transcriptClientWidth)
              : null,
          paddingLeftPx: transcriptPaddingLeft,
          paddingRightPx: transcriptPaddingRight,
          scrollbarGutter: transcriptStyle.scrollbarGutter,
          contentLeftPx: transcriptContentLeft,
          contentWidthPx: transcriptContentWidth,
          contentRightPx: transcriptContentRight,
          messages: messages
            ? {
                rect: messages,
                leftDeltaPx:
                  transcriptContentLeft === null
                    ? null
                    : round(messages.left - transcriptContentLeft),
                rightDeltaPx:
                  transcriptContentRight === null
                    ? null
                    : round(transcriptContentRight - messages.right),
                rowCount: messageRows.length,
                rowsLeftDeltaPx:
                  rowsLeft === null || transcriptContentLeft === null
                    ? null
                    : round(rowsLeft - transcriptContentLeft),
                rowsRightDeltaPx:
                  rowsRight === null || transcriptContentRight === null
                    ? null
                    : round(transcriptContentRight - rowsRight),
                rowsOutsideLeftPx:
                  rowsOutsideLeft === null ? null : round(rowsOutsideLeft),
                rowsOutsideRightPx:
                  rowsOutsideRight === null ? null : round(rowsOutsideRight)
              }
            : null,
          userMessage: userMessageEl
            ? {
                rect: userMessage,
                leftDeltaPx:
                  transcriptContentLeft === null
                    ? null
                    : round(userMessage.left - transcriptContentLeft)
              }
            : null,
          lastAssistant: lastAssistantEl
            ? {
                rect: lastAssistant,
                rightDeltaPx:
                  transcriptContentRight === null
                    ? null
                    : round(lastAssistant.right - transcriptContentRight)
              }
            : null
        }
      : null,
    // The name's ink beside the two things it is compared with: the token it
    // must wear, the transcript's ink it must stay quieter than, and the role
    // label that also wears the token.
    theme: {
      chipColor,
      chipLuminance: luminance(chipColor),
      mutedToken,
      mutedLuminance: luminance(mutedToken),
      inkColor,
      inkLuminance: luminance(inkColor),
      roleLabelColor,
      roleLabelLuminance: luminance(roleLabelColor),
      panelBackground,
      panelLuminance: luminance(panelBackground),
      chipContrast: contrast(chipColor, panelBackground),
      inkContrast: contrast(inkColor, panelBackground)
    },
    nameEditClassCount,
    hasStrip: Boolean(stripEl),
    hasHeader: Boolean(headerEl),
    headerTopVsStripBottomPx: headerTopVsStripBottom,
    chipTopVsStripBottomPx: chipTopVsStripBottom,
    chipCentreVsPanelCentrePx: chipCentreVsPanelCentre,
    tabTitle: tabLabelEl ? tabLabelEl.textContent : null,
    chip: chipEl
      ? {
          rect: chip,
          display: chipStyle.display,
          // The whole name is the control: a real button, no icon, a box that
          // stays inside the row holding it.
          tag: chipEl.tagName,
          role: chipEl.getAttribute("role"),
          ariaLabel: chipEl.getAttribute("aria-label"),
          text: chipEl.textContent,
          hasSvg: Boolean(chipEl.querySelector("svg")),
          cursor: chipStyle.cursor,
          color: chipStyle.color,
          background: chipStyle.backgroundColor,
          // No border at rest: every side is measured, not just the top.
          borderWidthsPx: {
            top: px(chipStyle.borderTopWidth),
            right: px(chipStyle.borderRightWidth),
            bottom: px(chipStyle.borderBottomWidth),
            left: px(chipStyle.borderLeftWidth)
          },
          borderStyles: {
            top: chipStyle.borderTopStyle,
            right: chipStyle.borderRightStyle,
            bottom: chipStyle.borderBottomStyle,
            left: chipStyle.borderLeftStyle
          },
          borderRadius: chipStyle.borderRadius,
          outlineWidthPx: px(chipStyle.outlineWidth),
          fontSizePx: px(chipStyle.fontSize),
          insideRow:
            header !== null &&
            chip.left >= header.left - 0.5 &&
            chip.right <= header.right + 0.5 &&
            chip.top >= header.top - 0.5 &&
            chip.bottom <= header.bottom + 0.5,
          containsLabel: labelEl !== null && chipEl.contains(labelEl)
        }
      : null,
    label: labelEl
      ? {
          rect: label,
          text: labelEl.textContent,
          classes: labelEl.className,
          fontSizePx: px(labelStyle.fontSize),
          fontWeight: labelStyle.fontWeight,
          color: labelStyle.color,
          hasSvg: Boolean(labelEl.querySelector("svg")),
          tag: labelEl.tagName
        }
      : null,
    edit: editEl
      ? {
          rect: edit,
          tag: editEl.tagName,
          hasSvg: Boolean(editEl.querySelector("svg")),
          ariaLabel: editEl.getAttribute("aria-label"),
          insideChip:
            chip !== null && edit.left >= chip.left - 0.5 && edit.right <= chip.right + 0.5,
          afterLabel: label !== null && edit.left >= label.right - 1,
          insidePanel:
            edit.left >= panel.left - 0.5 && edit.right <= panel.right + 0.5
        }
      : null,
    footer: footerEl
      ? {
          rect: footer,
          containerType: footerStyle.containerType,
          position: footerStyle.position,
          paddingLeftPx: px(footerStyle.paddingLeft),
          paddingRightPx: px(footerStyle.paddingRight)
        }
      : null,
    switcher: switcherEl
      ? {
          rect: switcher,
          position: switcherStyle.position,
          role: switcherEl.getAttribute("role"),
          ariaLabel: switcherEl.getAttribute("aria-label"),
          // The anchor is the composer form, not the band: the band also holds
          // the interview card and the retired-model notice, and a fallback
          // anchored to the band floats up over them. insideFooter stays for
          // the record (the form is inside it), insideComposerForm is the
          // claim.
          insideFooter: footerEl !== null && footerEl.contains(switcherEl),
          insideComposerForm: composerFormEl !== null && composerFormEl.contains(switcherEl),
          pillCount: switcherEl.querySelectorAll(".agent-switcher__pill").length,
          pills: Array.from(switcherEl.querySelectorAll(".agent-switcher__pill")).map((pill) => ({
            name: pill.getAttribute("aria-label"),
            active: pill.getAttribute("aria-checked"),
            disabled: pill.disabled
          })),
          centrePx: switcherCentre,
          centreVsGutterCentrePx:
            gutterCentre === null || switcherCentre === null
              ? null
              : round(switcherCentre - gutterCentre),
          leftOfComposerGapPx: composerBox ? round(switcher.left - composerBox.right) : null,
          rightInsetPx: round(panel.right - switcher.right),
          bottomVsComposerBoxBottomPx: composerBox
            ? round(switcher.bottom - composerBox.bottom)
            : null,
          bottomVsComposerBoxTopPx: switcherBottomVsComposerBoxTop,
          // Diagnostic: the narrow rule's own anchor is the form, and its
          // 0.35rem float above the form's top edge is the expected -5.6px.
          bottomVsComposerFormTopPx: composerForm
            ? round(switcher.bottom - composerForm.top)
            : null,
          intersectsComposerBox: switcherIntersectsComposerBox,
          bottomVsFooterTopPx: footer ? round(switcher.bottom - footer.top) : null,
          insidePanel: switcher.left >= panel.left - 0.5 && switcher.right <= panel.right + 0.5
        }
      : null
  };
})()`;

const failures = [];
const marks = [];
const startedAt = Date.now();
const mark = (label) => marks.push({ ms: Date.now() - startedAt, label });

const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to (tokens.css, [data-theme="dark"]) so a
  // test run is not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...WINDOW,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real hold becomes a
    // coin toss without this. Painting is the switch above.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  /** Wait on a page predicate: a real wait, never a fixed sleep. */
  const waitFor = async (expression, budget = 10_000) => {
    const deadline = Date.now() + budget;
    for (;;) {
      if (await run(`Boolean(${expression})`)) return true;
      if (Date.now() >= deadline) return false;
      await sleep(100);
    }
  };

  /**
   * Drive the dock's width from inside the page: `--chatbar-width` is what the
   * shell's grid resolves the dock's track from, so setting it is the same
   * gesture the seam's drag makes, without a pointer the rig cannot place.
   */
  const readAt = async (width) => {
    const sample = await run(`(async () => {
      const shell = document.querySelector(".shell");
      if (!shell) return null;
      shell.style.setProperty("--chatbar-width", ${JSON.stringify(`${width}px`)});
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      // Let any width transition finish before the boxes are read: a rig that
      // measures mid-transition reports a gutter that never ships.
      await new Promise((resolve) => setTimeout(resolve, 80));
      return ${SAMPLE};
    })()`);
    if (!sample) throw new Error(`the dock disappeared while the width was driven to ${width}px`);
    return { width, ...sample };
  };

  /** The page's own read of the name and its rename field, for the rename legs. */
  const readName = () =>
    run(`(() => {
      const field = document.querySelector(".chat-panel__rename-input");
      const chip = document.querySelector('[data-testid="chat-name-chip"]');
      const label = document.querySelector(".chat-panel__heading.chat-panel__heading--thread");
      const edit = document.querySelector('[data-testid="chat-name-edit"]');
      const row = document.querySelector(".chat-panel__header--thread");
      const form = field ? field.closest("form") : null;
      const tab = document.querySelector(".chat-panel__tab--active .chat-panel__tab-label");
      return {
        fieldPresent: Boolean(field),
        fieldTag: field ? field.tagName : null,
        fieldValue: field ? field.value : null,
        inForm: Boolean(form && form.classList.contains("chat-panel__rename")),
        formInRow: Boolean(form && row && row.contains(form)),
        formButtonCount: form ? form.querySelectorAll("button").length : 0,
        chipPresent: Boolean(chip),
        editPresent: Boolean(edit),
        labelText: label ? label.textContent : null,
        tabTitle: tab ? tab.textContent : null,
        patches: (window.__lqPatchCalls || []).slice()
      };
    })()`);

  /** Click the name itself, the way the operator opens the rename field. */
  const clickName = () => {
    mark("click-name");
    return run(`(async () => {
      const chip = document.querySelector('[data-testid="chat-name-chip"]');
      if (!chip) return false;
      chip.click();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      return true;
    })()`);
  };

  /** Type into the rename field through React's own input event. */
  const typeRename = (text) => {
    mark("type-rename");
    return run(`(async () => {
      const field = document.querySelector(".chat-panel__rename-input");
      if (!field) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(field, ${JSON.stringify(text)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      return true;
    })()`);
  };

  /**
   * Blur the field: the contract's save gesture. There is no Save button, so
   * clicking anywhere else is what an operator does — and blur is the event that
   * click would fire on the field.
   */
  const blurRename = () => {
    mark("blur-rename");
    return run(`(async () => {
      const field = document.querySelector(".chat-panel__rename-input");
      if (!field) return false;
      field.blur();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      return true;
    })()`);
  };

  /**
   * The tab strip's other door: right-click the active tab and press its Rename
   * item. The menu is portalled to the document, so it is found outside the
   * dock's own subtree; the fields it opens are read from the page, not here.
   */
  const openTabRename = () => {
    mark("open-tab-rename");
    return run(`(async () => {
      const frame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        );
      const tab = document.querySelector(".chat-panel__tab--active");
      if (!tab) return { tabFound: false, menuOpened: false, itemClicked: false };
      const rect = tab.getBoundingClientRect();
      tab.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2)
        })
      );
      await frame();
      const menu = document.querySelector(".chat-panel__tab-menu");
      const item = menu
        ? Array.from(menu.querySelectorAll('[role="menuitem"]')).find(
            (el) => el.getAttribute("aria-label") === "Rename chat"
          )
        : null;
      if (!item) {
        return { tabFound: true, menuOpened: Boolean(menu), itemClicked: false };
      }
      item.click();
      await frame();
      return { tabFound: true, menuOpened: true, itemClicked: true };
    })()`);
  };

  /**
   * A real keystroke through Chromium's own input path. Enter is the operator's
   * save key: the field's own handler blurs it, so the save takes the same path
   * a click elsewhere does. Escape is the field's own cancel. A synthetic
   * KeyboardEvent would prove nothing about a key delivered to a focused field.
   */
  const pressKey = async (keyCode) => {
    mark(`press-${keyCode}`);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    await sleep(30);
    if (keyCode === "Enter") win.webContents.sendInputEvent({ type: "char", keyCode });
    await sleep(30);
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await sleep(140);
    await run(`(async () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))()`);
  };

  /**
   * Park Chromium's pointer in the window's top-left corner, off every box this
   * rig measures. The name's resting colour is a hover-free claim, and a real
   * pointer left over the chip (the bench is watched over VNC) would paint the
   * hover wash and turn the measured colour into the hover one.
   */
  const clearHover = async () => {
    win.webContents.sendInputEvent({ type: "mouseMove", x: 1, y: 1 });
    await sleep(60);
  };

  let report;
  const timeout = setTimeout(() => {
    // A hang must still leave an artifact that says where it hung: the wrapper
    // reads `failures` and the marks say which step never settled.
    fs.writeFileSync(
      path.join(artifactsDir, "dock-chrome.json"),
      `${JSON.stringify(
        {
          url,
          ranAt: new Date().toISOString(),
          window: WINDOW,
          marks,
          failures: [...failures, "timed out after 150s"],
          pass: false,
        },
        null,
        2,
      )}\n`,
    );
    console.error("dock-chrome: timed out after 150s");
    app.exit(1);
  }, 150_000);

  try {
    await win.loadURL(url);
    mark("loaded");
    await run("window.chatPanelHarnessReady.then(() => true)");
    mark("harness-ready");

    win.setContentSize(WINDOW.width, WINDOW.height);
    await sleep(250);
    win.showInactive();

    // The composer is the one box the gutter ladder is measured against; it is
    // also the harness's own readiness signal. If it is absent the page never
    // mounted, and every later read would throw without saying why.
    const composerMounted = await waitFor(
      `document.querySelector(".chat-panel__composer-box") !== null`,
    );
    if (!composerMounted) throw new Error("the dock never rendered its composer box");

    // The chip and strip are the code under test: wait for them, but report
    // their absence as named failures rather than throwing, so the gutters and
    // the switcher are still measured and the artifact says what did render.
    const chromeMounted = await waitFor(
      `document.querySelector('[data-testid="chat-name-chip"]') !== null`,
    );
    mark("chip-mounted");
    if (!chromeMounted) failures.push('chip-present: no [data-testid="chat-name-chip"] in the dock');
    const stripMounted = await waitFor(
      `document.querySelector(".chat-panel__tabs") !== null`,
    );
    if (!stripMounted) failures.push("chip-strip: the thread drew no .chat-panel__tabs");

    // The switcher only draws once the agents provider has main's harness list
    // and the companion provider has the active harness. Give it the same
    // generous budget as the page's own providers, then report rather than hang.
    const switcherMounted = await waitFor(
      `document.querySelectorAll(".agent-switcher__pill").length >= 2`,
    );
    mark("switcher-mounted");
    if (!switcherMounted) {
      failures.push(
        "switcher-present: the agent switcher never drew two pills on the ?agents=1 page",
      );
    }

    // The name's resting ink is a hover-free claim: park the pointer before the
    // ladder reads it, so a real cursor left over the chip cannot turn the
    // measured colour into the hover wash.
    await clearHover();

    // ── the gutter ladder, and the chip at every width ──────────────────────
    const samples = [];
    for (const width of WIDTHS) {
      const sample = await readAt(width);
      sample.mode = width >= WIDE_MODE_MIN_WIDTH ? "wide" : "narrow";
      // The drive's own check below proves the column is the width asked for;
      // the expectation is fed the *measured* column so the curve is compared
      // with the dock that actually rendered, not with the request.
      sample.gutterExpectedPx = expectedGutterPx(sample.columnWidthPx ?? width);
      sample.gutterDeltaPx =
        sample.gutterAveragePx === null
          ? null
          : Math.round((sample.gutterAveragePx - sample.gutterExpectedPx) * 100) / 100;
      samples.push(sample);
      mark(`width-${width}`);

      // G7 — the drive actually resized the dock: the panel is the column plus
      // its frame, so a column that did not move would make every next number
      // a measurement of the wrong width.
      check(
        `width:${width}:column`,
        sample.columnWidthPx !== null && Math.abs(sample.columnWidthPx - width) <= 1,
        `the dock's column measured ${sample.columnWidthPx}px for a ${width}px drive`,
      );

      // G1, G2, G6 — the gutter is present, symmetric, and on the curve.
      check(
        `width:${width}:gutter-left`,
        sample.gutterLeftPx !== null &&
          Math.abs(sample.gutterLeftPx - sample.gutterExpectedPx) <= GUTTER_TOLERANCE_PX,
        `left gutter ${sample.gutterLeftPx}px vs expected ${sample.gutterExpectedPx}px`,
      );
      check(
        `width:${width}:gutter-right`,
        sample.gutterRightPx !== null &&
          Math.abs(sample.gutterRightPx - sample.gutterExpectedPx) <= GUTTER_TOLERANCE_PX,
        `right gutter ${sample.gutterRightPx}px vs expected ${sample.gutterExpectedPx}px`,
      );
      check(
        `width:${width}:gutter-symmetric`,
        sample.gutterLeftPx !== null &&
          sample.gutterRightPx !== null &&
          Math.abs(sample.gutterLeftPx - sample.gutterRightPx) <= GUTTER_SYMMETRY_PX,
        `left ${sample.gutterLeftPx}px / right ${sample.gutterRightPx}px`,
      );

      // C1, C3, C4, C13 — the chip is there, flush under the strip and centred,
      // and the header wrapper still starts where the strip ends.
      check(
        `width:${width}:header-under-strip`,
        sample.hasStrip &&
          sample.hasHeader &&
          sample.headerTopVsStripBottomPx !== null &&
          Math.abs(sample.headerTopVsStripBottomPx) <= CHIP_TOP_PX,
        `header top is ${sample.headerTopVsStripBottomPx}px from the strip's bottom`,
      );
      check(
        `width:${width}:chip-under-strip`,
        sample.chip !== null &&
          sample.chipTopVsStripBottomPx !== null &&
          Math.abs(sample.chipTopVsStripBottomPx) <= CHIP_TOP_PX,
        sample.chip
          ? `chip top is ${sample.chipTopVsStripBottomPx}px from the strip's bottom`
          : "the chip did not render",
      );
      check(
        `width:${width}:chip-centred`,
        sample.chip !== null &&
          sample.chipCentreVsPanelCentrePx !== null &&
          Math.abs(sample.chipCentreVsPanelCentrePx) <= CHIP_CENTRE_PX,
        sample.chip
          ? `chip centre is ${sample.chipCentreVsPanelCentrePx}px off the panel's centre`
          : "the chip did not render",
      );
      // C5 — the chip is bounded inside the dock at the narrow widths.
      check(
        `width:${width}:chip-inside-panel`,
        sample.chip !== null &&
          sample.chip.rect.left >= sample.panel.left - 0.5 &&
          sample.chip.rect.right <= sample.panel.right + 0.5,
        sample.chip
          ? `chip ${JSON.stringify(sample.chip.rect)} against panel ` +
            `${sample.panel.left}..${sample.panel.right}`
          : "the chip did not render",
      );
    }

    // G3 — non-decreasing across the ladder. A gutter that narrows as the dock
    // grows is the wrong sign in the `calc`, and no single width would catch it.
    for (let i = 1; i < samples.length; i += 1) {
      const previous = samples[i - 1];
      const current = samples[i];
      check(
        `gutter-monotonic:${current.width}`,
        previous.gutterAveragePx !== null &&
          current.gutterAveragePx !== null &&
          current.gutterAveragePx >= previous.gutterAveragePx - 0.1,
        `${previous.width}px → ${previous.gutterAveragePx}px then ` +
          `${current.width}px → ${current.gutterAveragePx}px`,
      );
    }

    // G4, G5 — the two ends of the ladder, as width ratios. The narrow dock keeps
    // the composer nearly full-width; the wide one leaves real gaps.
    const at360 = samples.find((sample) => sample.width === 360);
    const at900 = samples.find((sample) => sample.width === 900);
    check(
      "gutter-ratio:360",
      at360.composerWidthRatio !== null &&
        at360.composerWidthRatio >= COMPOSER_NARROW_RATIO_MIN,
      `composer/panel is ${at360.composerWidthRatio} at 360px (min ${COMPOSER_NARROW_RATIO_MIN})`,
    );
    check(
      "gutter-ratio:900",
      at900.composerWidthRatio !== null && at900.composerWidthRatio <= COMPOSER_WIDE_RATIO_MAX,
      `composer/panel is ${at900.composerWidthRatio} at 900px (max ${COMPOSER_WIDE_RATIO_MAX})`,
    );

    // ── T1–T5: the transcript's text column lines up with the composer box ──
    // Read per width off the ladder's own samples, so the padding is compared at
    // the same dock widths as the composer's gutters. The content box is the
    // browser's: clientWidth (already less the reserved scrollbar) minus the two
    // paddings, which is where the text really sits.
    const transcriptColumn = samples.map((sample) => {
      const transcript = sample.transcript;
      const box = sample.composerBox;
      const leftDeltaPx =
        transcript && transcript.contentLeftPx !== null && box
          ? Math.round((transcript.contentLeftPx - box.left) * 100) / 100
          : null;
      const rightDeltaPx =
        transcript && transcript.contentRightPx !== null && box
          ? Math.round((transcript.contentRightPx - box.right) * 100) / 100
          : null;
      const widthDeltaPx =
        transcript && transcript.contentWidthPx !== null && box
          ? Math.round((transcript.contentWidthPx - box.width) * 100) / 100
          : null;
      return {
        width: sample.width,
        panelWidthPx: sample.panel.width,
        composerBox: box ? { left: box.left, right: box.right, width: box.width } : null,
        content:
          transcript && transcript.contentLeftPx !== null
            ? {
                left: transcript.contentLeftPx,
                right: transcript.contentRightPx,
                width: transcript.contentWidthPx,
              }
            : null,
        body: transcript
          ? {
              left: transcript.body ? transcript.body.left : null,
              right: transcript.body ? transcript.body.right : null,
              width: transcript.body ? transcript.body.width : null,
              clientWidthPx: transcript.clientWidthPx,
              scrollbarWidthPx: transcript.scrollbarWidthPx,
              paddingLeftPx: transcript.paddingLeftPx,
              paddingRightPx: transcript.paddingRightPx,
              scrollbarGutter: transcript.scrollbarGutter,
            }
          : null,
        leftDeltaPx,
        rightDeltaPx,
        widthDeltaPx,
        messages: transcript?.messages ?? null,
        messagesPresent: Boolean(
          transcript?.messages && transcript.messages.rowCount > 0,
        ),
      };
    });
    check(
      "transcript-present",
      transcriptColumn.every((entry) => entry.content !== null && entry.body !== null),
      "the thread's transcript body (or its content box) was not measurable",
    );
    // T3 — the reserved bar is a property of the scroller, not of whether this
    // particular transcript happens to overflow.
    check(
      "transcript-scrollbar-gutter",
      transcriptColumn.every((entry) => entry.body?.scrollbarGutter === "stable"),
      `scrollbarGutter per width: ${JSON.stringify(transcriptColumn.map((entry) => entry.body?.scrollbarGutter))}`,
    );
    // T4 — the message rows are the second witness: they must be on screen at
    // every rung, so the column's edges can be shown to be used by the text.
    check(
      "transcript-messages-present",
      transcriptColumn.every((entry) => entry.messagesPresent === true),
      `the transcript's message rows were not measurable per width: ` +
        `${JSON.stringify(transcriptColumn.map((entry) => entry.messagesPresent))}`,
    );
    for (const entry of transcriptColumn) {
      // T5 — the 300px floor is the one width where the body's 0.875rem minimum
      // outruns the composer's 12px gutter; the column may be up to 4px narrower
      // there and no more. Every other rung gets the full 2px alignment.
      const tolerancePx = entry.width === 300 ? 4 : 2;
      check(
        `transcript-column:${entry.width}:left`,
        entry.leftDeltaPx !== null && Math.abs(entry.leftDeltaPx) <= tolerancePx,
        `text column left is ${entry.leftDeltaPx}px from the composer box's left ` +
          `(tolerance ${tolerancePx}px)`,
      );
      check(
        `transcript-column:${entry.width}:right`,
        entry.rightDeltaPx !== null && Math.abs(entry.rightDeltaPx) <= tolerancePx,
        `text column right is ${entry.rightDeltaPx}px from the composer box's right ` +
          `(tolerance ${tolerancePx}px; a scrollbar's width left in the column shows up here)`,
      );
      check(
        `transcript-column:${entry.width}:width`,
        entry.widthDeltaPx !== null && Math.abs(entry.widthDeltaPx) <= tolerancePx,
        `text column is ${entry.widthDeltaPx}px from the composer box's width ` +
          `(tolerance ${tolerancePx}px)`,
      );
      // T4 — the message rows fill the column: the messages container is the
      // column's box, their union covers both edges, and no row escapes it.
      check(
        `transcript-messages:${entry.width}:left`,
        entry.messages !== null &&
          entry.messages.leftDeltaPx !== null &&
          Math.abs(entry.messages.leftDeltaPx) <= tolerancePx,
        `the message rows start ${entry.messages?.leftDeltaPx}px from the text column's left ` +
          `(tolerance ${tolerancePx}px)`,
      );
      check(
        `transcript-messages:${entry.width}:right`,
        entry.messages !== null &&
          entry.messages.rightDeltaPx !== null &&
          Math.abs(entry.messages.rightDeltaPx) <= tolerancePx,
        `the message rows end ${entry.messages?.rightDeltaPx}px from the text column's right ` +
          `(tolerance ${tolerancePx}px)`,
      );
      check(
        `transcript-rows:${entry.width}:span`,
        entry.messages !== null &&
          entry.messages.rowsLeftDeltaPx !== null &&
          entry.messages.rowsRightDeltaPx !== null &&
          Math.abs(entry.messages.rowsLeftDeltaPx) <= 2 &&
          Math.abs(entry.messages.rowsRightDeltaPx) <= 2,
        `the rows' union is ${entry.messages?.rowsLeftDeltaPx}px / ` +
          `${entry.messages?.rowsRightDeltaPx}px off the column's edges`,
      );
      check(
        `transcript-rows:${entry.width}:inside`,
        entry.messages !== null &&
          entry.messages.rowsOutsideLeftPx !== null &&
          entry.messages.rowsOutsideRightPx !== null &&
          entry.messages.rowsOutsideLeftPx >= -2 &&
          entry.messages.rowsOutsideRightPx >= -2,
        `a message row escaped the column by ${entry.messages?.rowsOutsideLeftPx}px / ` +
          `${entry.messages?.rowsOutsideRightPx}px`,
      );
    }

    // ── C1–C9, C14: the chip's own chrome, measured once at 900px ────────────
    const wide = at900;
    const chip = wide.chip;
    const label = wide.label;
    const edit = wide.edit;
    const colors = wide.theme;

    check("chip-present", chip !== null, "the thread name chip did not render");
    if (chip) {
      // C8 — the name itself is the control: a real button carrying the row's
      // one accessible name, not a static box beside a pencil.
      check(
        "chip-control",
        chip.tag === "BUTTON" &&
          typeof chip.ariaLabel === "string" &&
          chip.ariaLabel.length > 0,
        `the name is a ${chip.tag} with aria-label ${JSON.stringify(chip.ariaLabel)}`,
      );
      check(
        "chip-box",
        chip.display === "inline-flex" || chip.display === "flex",
        `chip display is ${chip.display}, not an inline/flex box`,
      );
      // C9 — no chrome at rest: no border on any side, no fill.
      const borderWidths = Object.values(chip.borderWidthsPx ?? {});
      const borderStyles = Object.values(chip.borderStyles ?? {});
      check(
        "chip-no-border",
        borderWidths.length === 4 &&
          borderWidths.every((value) => value === 0) &&
          borderStyles.length === 4 &&
          borderStyles.every((style) => style === "none"),
        `chip borders are ${JSON.stringify(chip.borderWidthsPx)} ` +
          `${JSON.stringify(chip.borderStyles)}`,
      );
      check(
        "chip-no-fill",
        typeof chip.background === "string" &&
          /rgba\(0, 0, 0, 0\)|transparent/.test(chip.background),
        `chip background is ${chip.background}`,
      );
      // C9 — the resting ink is the neutral `--muted` token, and it reads
      // quieter than the transcript's `--fg` prose. Both are recorded, so a
      // failure names the colours rather than saying "wrong colour".
      check(
        "chip-color-muted",
        colors.chipColor !== null && colors.chipColor === colors.mutedToken,
        `chip colour ${colors.chipColor} vs the --muted token ${colors.mutedToken}`,
      );
      check(
        "chip-color-quieter-than-ink",
        colors.chipContrast !== null &&
          colors.inkContrast !== null &&
          colors.chipContrast < colors.inkContrast - CHIP_CONTRAST_MARGIN,
        `chip contrast ${colors.chipContrast} vs the transcript's ink ${colors.inkContrast} ` +
          `(must be at least ${CHIP_CONTRAST_MARGIN} lower)`,
      );
      // C2 — the box is sized to its content, not the row: the room over the
      // label is the chip's own padding and nothing more.
      const contentSlackPx = label
        ? Math.round((chip.rect.width - label.rect.width) * 100) / 100
        : null;
      check(
        "chip-sized-to-text",
        contentSlackPx !== null && contentSlackPx >= 0 && contentSlackPx <= 40,
        `chip is ${chip.rect.width}px for a ${label ? label.rect.width : "?"}px label ` +
          `(${contentSlackPx}px of chrome)`,
      );
      check(
        "chip-not-a-band",
        chip.rect.width < wide.panel.width - 40,
        `chip is ${chip.rect.width}px wide in a ${wide.panel.width}px panel — a band, not a box`,
      );
      // The name is a child of the thread's row and stays inside its box.
      check(
        "chip-inside-row",
        chip.insideRow === true,
        `chip ${JSON.stringify(chip.rect)} against the row ${JSON.stringify(wide.header)}`,
      );
      check(
        "chip-contains-label",
        chip.containsLabel === true,
        "the chip's label is not inside the chip's own box",
      );
      // C8 — the retired pencil is gone, and nothing grew back in its place.
      check(
        "chip-no-pencil",
        edit === null,
        `a [data-testid="chat-name-edit"] control still rendered: ${JSON.stringify(edit)}`,
      );
      check(
        "chip-no-pencil-class",
        wide.nameEditClassCount === 0,
        `${wide.nameEditClassCount} .chat-panel__name-edit control(s) still rendered`,
      );
      check(
        "chip-no-icon",
        chip.hasSvg === false && label !== null && label.hasSvg === false,
        `the chip carries an SVG icon (chip ${chip.hasSvg}, label ${label ? label.hasSvg : "?"})`,
      );
    }
    check("chip-strip", wide.hasStrip, "the tab strip was not drawn under the chip");
    check(
      "chip-header",
      wide.hasHeader && wide.headerTopVsStripBottomPx !== null &&
        Math.abs(wide.headerTopVsStripBottomPx) <= CHIP_TOP_PX,
      `the .chat-panel__header--thread wrapper is missing or off the strip ` +
        `(${wide.headerTopVsStripBottomPx}px)`,
    );

    if (label) {
      // C7 — the label is the title and nothing else: no icon's accessible name
      // leaked into its text, and it kept the heading classes.
      const classes = (label.classes || "").split(/\s+/);
      check(
        "chip-label-classes",
        classes.includes("chat-panel__heading") &&
          classes.includes("chat-panel__heading--thread"),
        `label classes are "${label.classes}"`,
      );
      check(
        "chip-label-text",
        Boolean(label.text) &&
          label.text === label.text.trim() &&
          label.hasSvg === false &&
          (wide.tabTitle === null || label.text === wide.tabTitle),
        `label text ${JSON.stringify(label.text)} against the tab's ` +
          `${JSON.stringify(wide.tabTitle)} (label has svg: ${label.hasSvg})`,
      );
      // C6 — one type step down from the old band's 0.85rem.
      check(
        "chip-label-font",
        label.fontSizePx !== null &&
          label.fontSizePx > CHIP_FONT_MIN_PX &&
          label.fontSizePx < CHIP_FONT_MAX_PX,
        `label font-size is ${label.fontSizePx}px (expected ~11.2px, ` +
          `${CHIP_FONT_MIN_PX}–${CHIP_FONT_MAX_PX}px)`,
      );
    } else {
      check("chip-label-classes", false, "the chip's label did not render");
      check("chip-label-text", false, "the chip's label did not render");
      check("chip-label-font", false, "the chip's label did not render");
    }

    // S8 — the footer is the container the narrow/wide switch is written on.
    check(
      "footer-is-container",
      wide.footer !== null &&
        typeof wide.footer.containerType === "string" &&
        wide.footer.containerType.includes("inline-size"),
      `footer container-type is ${wide.footer ? wide.footer.containerType : "?"}`,
    );

    // ── S1–S8: where the agent switcher stands, in both layouts ─────────────
    check("switcher-present", wide.switcher !== null, "the agent switcher did not render");
    if (wide.switcher) {
      check(
        "switcher-role",
        wide.switcher.role === "radiogroup",
        `switcher role is ${wide.switcher.role}`,
      );
      check(
        "switcher-inside-composer-form",
        wide.switcher.insideComposerForm === true,
        "the switcher is not a child of the composer form, so the band (and the " +
          "cards/notices in it) is what its fallback is anchored to",
      );
      check(
        "switcher-pills",
        wide.switcher.pillCount >= 2,
        `only ${wide.switcher.pillCount} agent pill(s) rendered`,
      );
      check(
        "switcher-active-pill",
        wide.switcher.pills.filter((pill) => pill.active === "true").length === 1,
        `pills ${JSON.stringify(wide.switcher.pills)}`,
      );
    }

    const wideModes = [];
    for (const width of WIDE_AT) {
      // A fresh read: the wide samples are a subset of the gutter ladder plus
      // one extra width, so they are not looked up in the ladder's list.
      const sample = await readAt(width);
      mark(`wide-${width}`);
      const switcher = sample.switcher;
      wideModes.push({
        width,
        present: Boolean(switcher),
        noOverlap: switcher ? switcher.leftOfComposerGapPx > 0 : null,
        composerGapPx: switcher ? switcher.leftOfComposerGapPx : null,
        centreDeltaPx: switcher ? switcher.centreVsGutterCentrePx : null,
        rightInsetPx: switcher ? switcher.rightInsetPx : null,
        bottomVsComposerBoxPx: switcher ? switcher.bottomVsComposerBoxBottomPx : null,
        insidePanel: switcher ? switcher.insidePanel : null,
      });
      check(
        `switcher-wide:${width}:present`,
        Boolean(switcher),
        "the switcher did not render at a wide dock",
      );
      if (!switcher) continue;
      // S3 — the whole point of the gutter: the block stands in empty space and
      // never covers the composer.
      check(
        `switcher-wide:${width}:no-overlap`,
        switcher.leftOfComposerGapPx > 0,
        `switcher left is ${switcher.leftOfComposerGapPx}px from the composer box's right edge`,
      );
      // S4 — centred on the gutter the composer leaves, not 12px off it.
      check(
        `switcher-wide:${width}:gutter-centre`,
        switcher.centreVsGutterCentrePx !== null &&
          Math.abs(switcher.centreVsGutterCentrePx) <= SWITCHER_CENTRE_PX,
        `switcher centre is ${switcher.centreVsGutterCentrePx}px from the gutter's centre`,
      );
      // S5 — bottom edge level with the composer box's.
      check(
        `switcher-wide:${width}:bottom-level`,
        switcher.bottomVsComposerBoxBottomPx !== null &&
          Math.abs(switcher.bottomVsComposerBoxBottomPx) <= SWITCHER_BOTTOM_PX,
        `switcher bottom is ${switcher.bottomVsComposerBoxBottomPx}px from the composer box's bottom`,
      );
      // S6 — it stays inside the dock's own box.
      check(
        `switcher-wide:${width}:inside-panel`,
        switcher.insidePanel === true && switcher.rightInsetPx >= 2,
        `switcher right inset is ${switcher.rightInsetPx}px (expected ≥ 2px)`,
      );
    }

    const narrowModes = [];
    for (const width of NARROW_AT) {
      const sample = await readAt(width);
      sample.mode = "narrow";
      mark(`narrow-${width}`);
      const switcher = sample.switcher;
      const rightInsetDeltaPx =
        switcher === null
          ? null
          : Math.round((switcher.rightInsetPx - NARROW_RIGHT_INSET_PX) * 100) / 100;
      narrowModes.push({
        width,
        present: Boolean(switcher),
        aboveComposerBox:
          switcher && switcher.bottomVsComposerBoxTopPx !== null
            ? switcher.bottomVsComposerBoxTopPx <= 1
            : null,
        bottomVsComposerBoxTopPx: switcher ? switcher.bottomVsComposerBoxTopPx : null,
        // Diagnostic: the narrow rule floats 0.35rem above the form's own top.
        bottomVsComposerFormTopPx: switcher ? switcher.bottomVsComposerFormTopPx : null,
        intersectsComposerBox: switcher ? switcher.intersectsComposerBox : null,
        insideComposerForm: switcher ? switcher.insideComposerForm : null,
        rightInsetPx: switcher ? switcher.rightInsetPx : null,
        rightInsetDeltaPx,
      });
      check(
        `switcher-narrow:${width}:present`,
        Boolean(switcher),
        "the switcher did not render at a narrow dock",
      );
      if (!switcher) continue;
      // S7 — the fallback floats just above the composer it belongs to, not up
      // the panel over the transcript: the band's own cards and notices must not
      // push it anywhere. (The old bug: anchored to the band, so an interview
      // card under the transcript carried it mid-panel.)
      check(
        `switcher-narrow:${width}:above-composer-box`,
        switcher.bottomVsComposerBoxTopPx !== null &&
          switcher.bottomVsComposerBoxTopPx <= 1,
        `switcher bottom is ${switcher.bottomVsComposerBoxTopPx}px from the composer ` +
          `box's top (expected just above it, ≤ 1px)`,
      );
      check(
        `switcher-narrow:${width}:just-above-composer`,
        switcher.bottomVsComposerBoxTopPx !== null &&
          switcher.bottomVsComposerBoxTopPx >= -(NARROW_COMPOSER_GAP_PX + NARROW_GAP_TOLERANCE_PX),
        `switcher bottom is ${switcher.bottomVsComposerBoxTopPx}px above the composer ` +
          `box's top (expected ≈ −${NARROW_COMPOSER_GAP_PX}px; a block anchored to the ` +
          `band floats ~${-(NARROW_COMPOSER_GAP_PX + 12)}px above an empty band and ` +
          `higher once the band holds a card)`,
      );
      check(
        `switcher-narrow:${width}:clears-composer-box`,
        switcher.intersectsComposerBox === false,
        "the narrow switcher overlaps the composer box it floats beside",
      );
      check(
        `switcher-narrow:${width}:right-inset`,
        rightInsetDeltaPx !== null && Math.abs(rightInsetDeltaPx) <= SWITCHER_RIGHT_PX,
        `switcher right inset is ${switcher.rightInsetPx}px (expected ` +
          `${NARROW_RIGHT_INSET_PX}px ± ${SWITCHER_RIGHT_PX})`,
      );
    }

    // S8 — the container query really ran: the same block occupies a different
    // place in the two layouts. A static rule that never fired would leave one
    // of these two true.
    const wideModeSample = samples.find((entry) => entry.width === 900);
    const narrowModeSample = samples.find((entry) => entry.width === 360);
    check(
      "switcher-moved-between-modes",
      Boolean(
        wideModeSample.switcher &&
          narrowModeSample.switcher &&
          // Wide: bottom on the composer box's bottom (≈0 from it). Narrow: above
          // the box's top, which is that much further up — a large negative.
          Math.abs(wideModeSample.switcher.bottomVsComposerBoxBottomPx) <=
            SWITCHER_BOTTOM_PX &&
          narrowModeSample.switcher.bottomVsComposerBoxBottomPx <
            wideModeSample.switcher.bottomVsComposerBoxBottomPx - 10,
      ),
      `wide switcher bottom is ${wideModeSample.switcher?.bottomVsComposerBoxBottomPx}px from ` +
        `the composer box's bottom; narrow is ${narrowModeSample.switcher?.bottomVsComposerBoxBottomPx}px`,
    );

    // ── the two pictures of the shipped screen ──────────────────────────────
    const capture = async (width, file) => {
      const sample = await readAt(width);
      mark(`capture-${width}`);
      const image = await win.webContents.capturePage();
      fs.writeFileSync(file, image.toPNG());
      const bytes = fs.statSync(file).size;
      return { sample, file, bytes, width };
    };
    const wideShot = await capture(
      900,
      path.join(artifactsDir, "dock-chrome-wide.png"),
    );
    const narrowShot = await capture(
      360,
      path.join(artifactsDir, "dock-chrome-narrow.png"),
    );
    check(
      "screenshot:wide",
      fs.existsSync(wideShot.file) && wideShot.bytes > 0,
      `dock-chrome-wide.png missing or empty (${wideShot.bytes} bytes)`,
    );
    check(
      "screenshot:narrow",
      fs.existsSync(narrowShot.file) && narrowShot.bytes > 0,
      `dock-chrome-narrow.png missing or empty (${narrowShot.bytes} bytes)`,
    );

    // ── C10–C13: the name's rename path, through the bridge ─────────────────
    const beforeRename = await readName();
    const renameBaselinePatches = beforeRename.patches.length;
    const renameBaseTitle = beforeRename.labelText;
    const chipWidthBeforePx = wide.chip ? wide.chip.rect.width : null;

    // The window must have real focus for a real keystroke to be delivered to
    // the focused field: `showInactive()` alone leaves document.hasFocus() false.
    win.show();
    win.focus();
    win.webContents.focus();
    await sleep(250);

    // C10 — clicking the name opens the rename field in its own place, prefilled
    // with the title it is renaming.
    const nameClicked = await clickName();
    const opened = await readName();
    check("rename-opens", nameClicked === true, "clicking the name did nothing");
    check(
      "rename-prefilled",
      opened.fieldPresent === true && opened.fieldValue === renameBaseTitle,
      `field ${JSON.stringify(opened.fieldValue)} vs title ${JSON.stringify(renameBaseTitle)}`,
    );
    check(
      "rename-field-is-input",
      opened.fieldTag === "INPUT" && opened.inForm === true,
      `the rename field is a ${opened.fieldTag} in .chat-panel__rename: ${opened.inForm}`,
    );
    check(
      "rename-field-in-place",
      opened.formInRow === true && opened.chipPresent === false,
      "the rename field did not replace the name in the name's own row",
    );
    // The contract removed the Save/Cancel keys: blur saves, Escape cancels.
    check(
      "rename-no-buttons",
      opened.formButtonCount === 0,
      `the rename field drew ${opened.formButtonCount} button(s)`,
    );

    // C11 — Escape cancels: nothing written, field closed, name unchanged.
    if (opened.fieldPresent) {
      await typeRename(CANCELLED_TITLE);
      await pressKey("Escape");
      await sleep(150);
    }
    const escaped = await readName();
    const escapeClosedField = escaped.fieldPresent === false;
    const escapePatchDelta = escaped.patches.length - renameBaselinePatches;
    let escapeRecovered = null;
    if (escaped.fieldPresent) {
      // Recover for the next legs and say so: put the field back to the title it
      // opened with (which writes nothing) and blur it. The check below still
      // reports the field as it stood before this recovery.
      await typeRename(renameBaseTitle);
      await blurRename();
      await sleep(150);
      escapeRecovered = "reverted-and-blurred";
    }
    const afterEscape = await readName();
    check(
      "rename-escape-closes",
      opened.fieldPresent === true && escapeClosedField,
      "the rename field stayed open after Escape",
    );
    check(
      "rename-escape-writes-nothing",
      escapePatchDelta === 0,
      `${escapePatchDelta} session patch(es) were sent after Escape`,
    );
    check(
      "rename-escape-keeps-title",
      afterEscape.labelText === renameBaseTitle,
      `title became ${JSON.stringify(afterEscape.labelText)} after Escape ` +
        `(was ${JSON.stringify(renameBaseTitle)})`,
    );

    // C12 — blur saves: there is no Save key, so clicking away must commit the
    // typed title through the bridge patch and close the field.
    const blurBaselinePatches = afterEscape.patches.length;
    const nameClickedForBlur = await clickName();
    const blurOpened = await readName();
    check(
      "rename-blur-reopens",
      nameClickedForBlur === true && blurOpened.fieldPresent === true,
      "the name could not reopen the rename field for the blur leg",
    );
    let blurCommitted = false;
    if (blurOpened.fieldPresent) {
      await typeRename(BLUR_TITLE);
      await blurRename();
      const deadline = Date.now() + 3_000;
      for (;;) {
        const state = await readName();
        if (!state.fieldPresent && state.patches.length > blurBaselinePatches) {
          blurCommitted = true;
          break;
        }
        if (Date.now() >= deadline) break;
        await sleep(100);
      }
    }
    const blurred = await readName();
    const blurPatch = blurred.patches[blurBaselinePatches] ?? null;
    check(
      "rename-blur-commits",
      blurCommitted === true,
      "blurring the rename field did not save the title",
    );
    check(
      "rename-blur-patch-title",
      Boolean(blurPatch) &&
        blurPatch.patch &&
        blurPatch.patch.title === BLUR_TITLE &&
        typeof blurPatch.id === "string" &&
        blurPatch.id.length > 0,
      `session patch was ${JSON.stringify(blurPatch)}, expected the title ` +
        `${JSON.stringify(BLUR_TITLE)}`,
    );
    check(
      "rename-blur-field-closes",
      blurred.fieldPresent === false,
      "the rename field stayed open after blurring it",
    );
    check(
      "rename-blur-label-takes-title",
      blurred.labelText === BLUR_TITLE,
      `label text is ${JSON.stringify(blurred.labelText)}, expected ${JSON.stringify(BLUR_TITLE)}`,
    );

    // C12 — Enter takes the same save path and commits the longer title, which
    // the chip has to grow with.
    const enterBaselinePatches = blurred.patches.length;
    const nameClickedForEnter = await clickName();
    const reopen = await readName();
    check(
      "rename-reopens",
      nameClickedForEnter === true && reopen.fieldPresent === true,
      "the name could not reopen the rename field for the Enter leg",
    );
    let enterCommitted = false;
    let enterUsedBlurFallback = false;
    if (reopen.fieldPresent) {
      await typeRename(LONG_TITLE);
      // The key the operator presses, delivered through Chromium's own input
      // path: Enter blurs the field, which runs the same save a click away does.
      await pressKey("Enter");
      // Poll for the write: the commit is a bridge call, so the label and the
      // field settle a frame or two after the key.
      const deadline = Date.now() + 3_000;
      for (;;) {
        const state = await readName();
        if (!state.fieldPresent && state.patches.length > enterBaselinePatches) {
          enterCommitted = true;
          break;
        }
        if (Date.now() >= deadline) break;
        await sleep(100);
      }
      if (enterCommitted === false) {
        // Diagnose rather than mask: the field's own blur is the save path, so
        // if calling it directly commits, the commit works and the key never
        // reached (or never blurred) the field.
        await blurRename();
        const deadline2 = Date.now() + 2_000;
        for (;;) {
          const state = await readName();
          if (!state.fieldPresent && state.patches.length > enterBaselinePatches) {
            enterUsedBlurFallback = true;
            break;
          }
          if (Date.now() >= deadline2) break;
          await sleep(100);
        }
      }
    }
    await sleep(150);
    const committed = await readName();
    const renameSample = await readAt(900);
    const chipWidthAfterPx = renameSample.chip ? renameSample.chip.rect.width : null;
    const enterPatch = committed.patches[enterBaselinePatches] ?? null;
    check(
      "rename-enter-commits",
      enterCommitted === true,
      enterUsedBlurFallback
        ? "Enter did not blur the field (the blur itself committed, so the save path " +
          "works and the key never reached it)"
        : "Enter left the rename field open and sent no session patch",
    );
    check(
      "rename-enter-patch-title",
      Boolean(enterPatch) &&
        enterPatch.patch &&
        enterPatch.patch.title === LONG_TITLE &&
        typeof enterPatch.id === "string" &&
        enterPatch.id.length > 0,
      `session patch was ${JSON.stringify(enterPatch)}`,
    );
    check(
      "rename-field-closes",
      committed.fieldPresent === false,
      "the rename field stayed open after the commit",
    );
    check(
      "rename-label-takes-title",
      committed.labelText === LONG_TITLE,
      `label text is ${JSON.stringify(committed.labelText)}, expected ${JSON.stringify(LONG_TITLE)}`,
    );
    check(
      "rename-chip-grows",
      chipWidthBeforePx !== null &&
        chipWidthAfterPx !== null &&
        chipWidthAfterPx > chipWidthBeforePx + 1,
      `chip was ${chipWidthBeforePx}px for the fixture title and ${chipWidthAfterPx}px ` +
        `for the longer one`,
    );
    // The chip still hangs under the strip and on the centre line after the
    // rewrite — a name whose box moves the row is a regression the first
    // measurement alone cannot see.
    check(
      "rename-chip-stays-pinned",
      renameSample.chip !== null &&
        renameSample.chipTopVsStripBottomPx !== null &&
        Math.abs(renameSample.chipTopVsStripBottomPx) <= CHIP_TOP_PX &&
        renameSample.chipCentreVsPanelCentrePx !== null &&
        Math.abs(renameSample.chipCentreVsPanelCentrePx) <= CHIP_CENTRE_PX,
      `after rename: top ${renameSample.chipTopVsStripBottomPx}px, ` +
        `centre ${renameSample.chipCentreVsPanelCentrePx}px`,
    );
    check(
      "rename-chip-inside-panel",
      renameSample.chip !== null &&
        renameSample.chip.rect.left >= renameSample.panel.left - 0.5 &&
        renameSample.chip.rect.right <= renameSample.panel.right + 0.5,
      "the long title's chip overflowed the dock",
    );
    // C5, after the rewrite: the long title must stay inside the dock at 360.
    const narrowAfterRename = await readAt(360);
    check(
      "rename-chip-inside-panel:360",
      narrowAfterRename.chip !== null &&
        narrowAfterRename.chip.rect.left >= narrowAfterRename.panel.left - 0.5 &&
        narrowAfterRename.chip.rect.right <= narrowAfterRename.panel.right + 0.5,
      `the long title's chip overflows the 360px dock ` +
        `(${JSON.stringify(narrowAfterRename.chip ? narrowAfterRename.chip.rect : null)})`,
    );

    // C13 — the tab menu's Rename is the same field: right-click the tab in
    // front, press Rename, and the name's own field opens prefilled. Escape it
    // away again without a write — the menu's door must not save by itself.
    const tabMenuBaselinePatches = committed.patches.length;
    const tabRename = await openTabRename();
    const tabMenuFlow = await readName();
    check(
      "rename-tab-menu-opens",
      tabRename.tabFound === true &&
        tabRename.itemClicked === true &&
        tabMenuFlow.fieldPresent === true,
      `right-click Rename: ${JSON.stringify(tabRename)}, field present ` +
        `${tabMenuFlow.fieldPresent}`,
    );
    check(
      "rename-tab-menu-prefilled",
      tabMenuFlow.fieldPresent === true && tabMenuFlow.fieldValue === LONG_TITLE,
      `field ${JSON.stringify(tabMenuFlow.fieldValue)} vs title ${JSON.stringify(LONG_TITLE)}`,
    );
    check(
      "rename-tab-menu-same-field",
      tabMenuFlow.fieldTag === "INPUT" &&
        tabMenuFlow.inForm === true &&
        tabMenuFlow.formInRow === true,
      `the menu's Rename opened a ${tabMenuFlow.fieldTag} in the name's row: ` +
        `${tabMenuFlow.formInRow}`,
    );
    if (tabMenuFlow.fieldPresent) {
      await pressKey("Escape");
      await sleep(150);
    }
    const tabMenuCancelled = await readName();
    check(
      "rename-tab-menu-cancels",
      tabMenuCancelled.fieldPresent === false &&
        tabMenuCancelled.patches.length === tabMenuBaselinePatches,
      `after Escape: field ${tabMenuCancelled.fieldPresent ? "open" : "closed"}, ` +
        `${tabMenuCancelled.patches.length - tabMenuBaselinePatches} patch(es) written`,
    );

    // ── the artifact ────────────────────────────────────────────────────────
    report = {
      url,
      ranAt: new Date().toISOString(),
      window: WINDOW,
      tolerances: {
        gutterPx: GUTTER_TOLERANCE_PX,
        gutterSymmetryPx: GUTTER_SYMMETRY_PX,
        chipTopPx: CHIP_TOP_PX,
        chipCentrePx: CHIP_CENTRE_PX,
        chipFontMinPx: CHIP_FONT_MIN_PX,
        chipFontMaxPx: CHIP_FONT_MAX_PX,
        chipContrastMargin: CHIP_CONTRAST_MARGIN,
        switcherCentrePx: SWITCHER_CENTRE_PX,
        switcherBottomPx: SWITCHER_BOTTOM_PX,
        switcherRightPx: SWITCHER_RIGHT_PX,
        narrowRightInsetPx: NARROW_RIGHT_INSET_PX,
        narrowComposerGapPx: NARROW_COMPOSER_GAP_PX,
        narrowGapTolerancePx: NARROW_GAP_TOLERANCE_PX,
        composerNarrowRatioMin: COMPOSER_NARROW_RATIO_MIN,
        composerWideRatioMax: COMPOSER_WIDE_RATIO_MAX,
        wideModeMinWidth: WIDE_MODE_MIN_WIDTH,
      },
      widths: WIDTHS,
      expectedGutters: samples.map((sample) => ({
        width: sample.width,
        columnWidthPx: sample.columnWidthPx,
        expectedPx: sample.gutterExpectedPx,
      })),
      samples: samples.map((sample) => ({
        width: sample.width,
        mode: sample.mode,
        chatSurface: sample.chatSurface,
        panel: sample.panel,
        columnWidthPx: sample.columnWidthPx,
        shellFramePx: sample.shellFramePx,
        gutterLeftPx: sample.gutterLeftPx,
        gutterRightPx: sample.gutterRightPx,
        gutterAveragePx: sample.gutterAveragePx,
        gutterExpectedPx: sample.gutterExpectedPx,
        gutterDeltaPx: sample.gutterDeltaPx,
        composerForm: sample.composerForm,
        composerBox: sample.composerBox,
        composerWidthRatio: sample.composerWidthRatio,
        hasStrip: sample.hasStrip,
        hasHeader: sample.hasHeader,
        headerTopVsStripBottomPx: sample.headerTopVsStripBottomPx,
        chipTopVsStripBottomPx: sample.chipTopVsStripBottomPx,
        chipCentreVsPanelCentrePx: sample.chipCentreVsPanelCentrePx,
        tabTitle: sample.tabTitle,
        chip: sample.chip,
        label: sample.label,
        edit: sample.edit,
        nameEditClassCount: sample.nameEditClassCount,
        footer: sample.footer,
        switcher: sample.switcher,
      })),
      gutters: {
        widths: WIDTHS,
        expectedPx: samples.map((sample) => sample.gutterExpectedPx),
        measuredLeftPx: samples.map((sample) => sample.gutterLeftPx),
        measuredRightPx: samples.map((sample) => sample.gutterRightPx),
        measuredAveragePx: samples.map((sample) => sample.gutterAveragePx),
        monotonic: samples.every(
          (sample, index) =>
            index === 0 || sample.gutterAveragePx >= samples[index - 1].gutterAveragePx - 0.1,
        ),
        tolerancePx: GUTTER_TOLERANCE_PX,
        symmetryTolerancePx: GUTTER_SYMMETRY_PX,
        narrowRatio: {
          width: 360,
          value: at360.composerWidthRatio,
          min: COMPOSER_NARROW_RATIO_MIN,
        },
        wideRatio: {
          width: 900,
          value: at900.composerWidthRatio,
          max: COMPOSER_WIDE_RATIO_MAX,
        },
      },
      // The operator's request, as numbers: the transcript's content box against
      // the composer box at every rung of the ladder. `present` is false only
      // when the thread body itself could not be measured; each sample then
      // carries its own nulls and the named checks above have already failed.
      transcriptColumn: {
        present: transcriptColumn.every(
          (entry) => entry.content !== null && entry.body !== null,
        ),
        bodyScrollbarGutter: transcriptColumn[0]?.body?.scrollbarGutter ?? null,
        tolerancePx: 2,
        narrowTolerancePx: 4,
        samples: transcriptColumn,
      },
      chip: {
        present: chip !== null,
        stripPresent: wide.hasStrip,
        headerPresent: wide.hasHeader,
        rect: chip ? chip.rect : null,
        display: chip ? chip.display : null,
        tag: chip ? chip.tag : null,
        role: chip ? chip.role : null,
        ariaLabel: chip ? chip.ariaLabel : null,
        text: chip ? chip.text : null,
        hasSvg: chip ? chip.hasSvg : null,
        cursor: chip ? chip.cursor : null,
        color: chip ? chip.color : null,
        background: chip ? chip.background : null,
        borderWidthsPx: chip ? chip.borderWidthsPx : null,
        borderStyles: chip ? chip.borderStyles : null,
        borderRadius: chip ? chip.borderRadius : null,
        outlineWidthPx: chip ? chip.outlineWidthPx : null,
        fontSizePx: chip ? chip.fontSizePx : null,
        labelText: label ? label.text : null,
        labelColor: label ? label.color : null,
        tabTitle: wide.tabTitle,
        labelClasses: label ? label.classes : null,
        labelFontSizePx: label ? label.fontSizePx : null,
        headerTopVsStripBottomPx: wide.headerTopVsStripBottomPx,
        topVsStripBottomPx: wide.chipTopVsStripBottomPx,
        centreVsPanelCentrePx: wide.chipCentreVsPanelCentrePx,
        insidePanel:
          chip !== null &&
          chip.rect.left >= wide.panel.left - 0.5 &&
          chip.rect.right <= wide.panel.right + 0.5,
        insideRow: chip ? chip.insideRow : false,
        containsLabel: chip ? chip.containsLabel : false,
        // The retired pencil: present/absent is itself evidence.
        editPresent: edit !== null,
        editTag: edit ? edit.tag : null,
        editHasSvg: edit ? edit.hasSvg : null,
        nameEditClassCount: wide.nameEditClassCount,
        widthPx: chip ? chip.rect.width : null,
        heightPx: chip ? chip.rect.height : null,
        // The colour claim, recorded as computed colours and their contrast
        // against the dock's canvas rather than as text.
        colors: {
          chip: colors.chipColor,
          chipLuminance: colors.chipLuminance,
          chipContrast: colors.chipContrast,
          mutedToken: colors.mutedToken,
          mutedLuminance: colors.mutedLuminance,
          ink: colors.inkColor,
          inkLuminance: colors.inkLuminance,
          inkContrast: colors.inkContrast,
          roleLabel: colors.roleLabelColor,
          roleLabelLuminance: colors.roleLabelLuminance,
          panelBackground: colors.panelBackground,
          panelLuminance: colors.panelLuminance,
        },
      },
      rename: {
        opened: {
          fieldPresent: opened.fieldPresent,
          value: opened.fieldValue,
          title: renameBaseTitle,
          fieldTag: opened.fieldTag,
          inForm: opened.inForm,
          formInRow: opened.formInRow,
          formButtonCount: opened.formButtonCount,
          chipHidden: opened.chipPresent === false,
        },
        escape: {
          fieldClosed: opened.fieldPresent === true && escapeClosedField,
          chipBack: afterEscape.chipPresent,
          labelText: afterEscape.labelText,
          patchesBefore: renameBaselinePatches,
          patchesAfter: escaped.patches.length,
          patchDelta: escapePatchDelta,
          usedRecovery: escapeRecovered,
        },
        blur: {
          typedTitle: BLUR_TITLE,
          committed: blurCommitted,
          patchLanded: Boolean(blurPatch),
          patch: blurPatch,
          fieldClosed: blurred.fieldPresent === false,
          labelText: blurred.labelText,
          patchesBefore: blurBaselinePatches,
          patchDelta: blurred.patches.length - blurBaselinePatches,
        },
        enter: {
          typedTitle: LONG_TITLE,
          enterCommitted,
          usedBlurFallback: enterUsedBlurFallback,
          patchLanded: Boolean(enterPatch),
          patch: enterPatch,
          fieldClosed: committed.fieldPresent === false,
          labelText: committed.labelText,
          tabTitle: committed.tabTitle,
          patchesBefore: enterBaselinePatches,
          patchDelta: committed.patches.length - enterBaselinePatches,
          chipWidthBeforePx,
          chipWidthAfterPx,
          chipGrew:
            chipWidthBeforePx !== null &&
            chipWidthAfterPx !== null &&
            chipWidthAfterPx > chipWidthBeforePx + 1,
          topVsStripBottomPx: renameSample.chipTopVsStripBottomPx,
          centreVsPanelCentrePx: renameSample.chipCentreVsPanelCentrePx,
          insidePanel: renameSample.chip
            ? renameSample.chip.rect.left >= renameSample.panel.left - 0.5 &&
              renameSample.chip.rect.right <= renameSample.panel.right + 0.5
            : false,
          insidePanelAt360:
            narrowAfterRename.chip !== null &&
            narrowAfterRename.chip.rect.left >= narrowAfterRename.panel.left - 0.5 &&
            narrowAfterRename.chip.rect.right <= narrowAfterRename.panel.right + 0.5,
          chipWidthAt360Px: narrowAfterRename.chip ? narrowAfterRename.chip.rect.width : null,
        },
        tabMenu: {
          tabFound: tabRename.tabFound,
          menuOpened: tabRename.menuOpened,
          itemClicked: tabRename.itemClicked,
          fieldPresent: tabMenuFlow.fieldPresent,
          value: tabMenuFlow.fieldValue,
          expectedTitle: LONG_TITLE,
          fieldTag: tabMenuFlow.fieldTag,
          inForm: tabMenuFlow.inForm,
          formInRow: tabMenuFlow.formInRow,
          fieldClosed: tabMenuCancelled.fieldPresent === false,
          patchesBefore: tabMenuBaselinePatches,
          patchDelta: tabMenuCancelled.patches.length - tabMenuBaselinePatches,
          labelText: tabMenuCancelled.labelText,
        },
      },
      footer: wide.footer
        ? {
            containerType: wide.footer.containerType,
            isSizeContainer:
              typeof wide.footer.containerType === "string" &&
              wide.footer.containerType.includes("inline-size"),
            position: wide.footer.position,
            paddingLeftPx: wide.footer.paddingLeftPx,
            paddingRightPx: wide.footer.paddingRightPx,
          }
        : null,
      agentSwitcher: {
        present: wide.switcher !== null,
        role: wide.switcher ? wide.switcher.role : null,
        insideFooter: wide.switcher ? wide.switcher.insideFooter : null,
        insideComposerForm: wide.switcher ? wide.switcher.insideComposerForm : null,
        pillCount: wide.switcher ? wide.switcher.pillCount : 0,
        pills: wide.switcher ? wide.switcher.pills : [],
        wide: wideModes,
        narrow: narrowModes,
      },
      screenshots: {
        wide: { path: wideShot.file, bytes: wideShot.bytes },
        narrow: { path: narrowShot.file, bytes: narrowShot.bytes },
      },
      marks,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      window: WINDOW,
      marks,
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "dock-chrome.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  // A short table for the console: the gutter ladder, then the two layouts.
  const rows = (report.samples ?? []).map((sample) => [
    `${sample.width}px`,
    sample.mode,
    `${sample.columnWidthPx}px`,
    `${sample.gutterLeftPx}/${sample.gutterRightPx}px`,
    `${sample.gutterExpectedPx}px`,
    `${sample.gutterDeltaPx}px`,
    sample.composerWidthRatio === null ? "?" : String(sample.composerWidthRatio),
    sample.chipTopVsStripBottomPx === null ? "?" : `${sample.chipTopVsStripBottomPx}px`,
    sample.chipCentreVsPanelCentrePx === null ? "?" : `${sample.chipCentreVsPanelCentrePx}px`,
    sample.switcher === null
      ? "-"
      : `${sample.switcher.centreVsGutterCentrePx}px / ` +
        `${sample.switcher.bottomVsComposerBoxBottomPx}px`,
  ]);
  const header = [
    "width",
    "mode",
    "column",
    "gutter l/r",
    "expected",
    "delta",
    "composer/panel",
    "chip↓strip",
    "chip↔centre",
    "switcher centreΔ/bandΔ",
  ];
  if (rows.length > 0) {
    const widths = header.map((_, i) =>
      Math.max(header[i].length, ...rows.map((row) => row[i].length)),
    );
    const format = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
    console.log(format(header));
    console.log(widths.map((width) => "-".repeat(width)).join("  "));
    for (const row of rows) console.log(format(row));
    console.log("");
  }
  if (report.transcriptColumn) {
    console.log(
      `transcript column: scrollbar-gutter ${report.transcriptColumn.bodyScrollbarGutter}`,
    );
    for (const entry of report.transcriptColumn.samples) {
      console.log(
        `  ${entry.width}px: text ${entry.content?.left}..${entry.content?.right} ` +
          `(${entry.content?.width}px) vs composer ${entry.composerBox?.left}..${entry.composerBox?.right} ` +
          `(${entry.composerBox?.width}px) — Δl ${entry.leftDeltaPx}, Δr ${entry.rightDeltaPx}, ` +
          `Δw ${entry.widthDeltaPx}; rows Δ ${entry.messages?.rowsLeftDeltaPx}/${entry.messages?.rowsRightDeltaPx}`,
      );
    }
    console.log("");
  }
  if (report.chip) {
    console.log(
      `chip: ${JSON.stringify(report.chip.labelText)} — ` +
        `${report.chip.tag} ${report.chip.widthPx}px box, ${report.chip.labelFontSizePx}px name, ` +
        `top ${report.chip.topVsStripBottomPx}px off the strip, ` +
        `centre ${report.chip.centreVsPanelCentrePx}px off the panel; ` +
        `ink ${report.chip.colors?.chip} (contrast ${report.chip.colors?.chipContrast} vs the ` +
        `muted token ${report.chip.colors?.mutedToken}, prose ${report.chip.colors?.inkContrast}); ` +
        `pencil present ${report.chip.editPresent}`,
    );
    console.log(
      `rename: escape closed ${report.rename.escape.fieldClosed} / patches ` +
        `${report.rename.escape.patchDelta}; blur committed ${report.rename.blur.committed} / ` +
        `patch ${JSON.stringify(report.rename.blur.patch)}; enter committed ` +
        `${report.rename.enter.enterCommitted} / patch ${JSON.stringify(report.rename.enter.patch)}; ` +
        `tab menu opened ${report.rename.tabMenu.itemClicked} / patches ` +
        `${report.rename.tabMenu.patchDelta}; chip ${report.rename.enter.chipWidthBeforePx}px → ` +
        `${report.rename.enter.chipWidthAfterPx}px`,
    );
    console.log("");
  }
  if (report.agentSwitcher) {
    console.log(
      `agent switcher: ${report.agentSwitcher.pillCount} pills in the footer ` +
        `(composer form: ${report.agentSwitcher.insideComposerForm}); ` +
        `footer ${report.footer?.containerType}`,
    );
    for (const mode of report.agentSwitcher.wide) {
      console.log(
        `  wide ${mode.width}px: gap ${mode.composerGapPx}px, centre ${mode.centreDeltaPx}px, ` +
          `bottom ${mode.bottomVsComposerBoxPx}px, right inset ${mode.rightInsetPx}px`,
      );
    }
    for (const mode of report.agentSwitcher.narrow) {
      console.log(
        `  narrow ${mode.width}px: above composer box ${mode.aboveComposerBox} ` +
          `(bottom ${mode.bottomVsComposerBoxTopPx}px vs box top), ` +
          `right inset ${mode.rightInsetPx}px`,
      );
    }
    console.log("");
  }
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "dock chrome: PASS" : "dock chrome: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`dock-chrome: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
