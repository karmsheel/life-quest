/**
 * E2E harness for the Review page, driven by `review.electron.mjs`.
 *
 * The real shell, the real page and the real stylesheet render here, so what the
 * driver reads is what the operator gets. Only the IPC bridge is stubbed, and it
 * is a *recording* stub: every method the page calls is modelled and anything
 * else answers `{ ok: false }` and is NAMED in `reviewRigUnexpectedCalls`, so a
 * page that grows a dependency this rig does not model fails the run loudly.
 *
 * The stub is also the *vault*: every review is one in-memory file per
 * cadence+period with a body, per-scope state (`draft` / `done`), and a lock, and
 * the methods mutate those files exactly as the engine does. So "the rail says
 * Done" is a claim about the file the page loaded, not about a call that
 * happened, and "Start filled the figures" is checked by reading the body the
 * page wrote through the bridge.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The checklist is drawn from every domain on disk instead of the live areas
 *     (`unlockedAreas`), so a locked area offers a review and the progress
 *     denominator is not the operator's areas.
 *  2. The rail's statuses are someone else's truth — always "Not started", or
 *     read off the current lens — so an unfinished area can launch the life
 *     review, or a finished one is asked for again.
 *  3. The Life review is not gated: it starts while areas are missing, which is
 *     the exact thing the operator asked to be impossible.
 *  4. A rail click starts the wrong scope: it opens the overall interview, or
 *     the page's active scope disagrees with the row that was pressed, so the
 *     kickoff and the page are about different sections.
 *  5. The life review's kickoff is another area-style kickoff instead of one
 *     that tells the companion to summarise across every area section.
 *  6. The daily review grows area sections: a rail, an area start, or a kickoff
 *     that tells the companion to write per-area headings.
 *  7. Marking the life review complete does not lock the file (it can still be
 *     written through the bridge), or marking one area locks it.
 *  8. The checklist is a second document: it steals the reading column's
 *     measure, sits under it at a window with room, or overlaps it when the
 *     window is narrow.
 *  9. An existing claim regresses while the new surface is added: the document
 *     box, blank-line fidelity, the formatting keys, the figure pass (filled
 *     once, inside its markers, under its heading), the one full-width-enough box
 *     (no Document/Preview second view), or the cadence's rules read/written from
 *     the page.
 * 10. The checklist is a SNAPSHOT of the file the page loaded, not a live view:
 *     the companion marks a scope done in the main process, the page never made
 *     that call, and the open rail keeps showing the old status until the
 *     operator navigates away and back. This is the reported bug; the rig
 *     changes the file the way the agent's tool does and announces it the way
 *     main does, so a window that never listens stays stale here.
 * 11. The DOCUMENT is a snapshot too, and a finished review keeps a dead button:
 *     the companion writes the report and marks it complete in the main process,
 *     and the open box keeps the skeleton it was opened with until the operator
 *     navigates away and back; on the now-locked page a **Mark review complete**
 *     button is still offered, though the file is final and the agent's own tool
 *     marked it. The rig writes and completes the file the way the tools do and
 *     announces each change, so a page that does not adopt the body, or that
 *     leaves the button up on a locked review, fails here.
 * 12. A cadence switch carries the previous cadence's period. The page reads a
 *     review for a period the new cadence cannot have (a Friday weekly, say),
 *     which the rig seeds, so the page draws a heading-less skeleton of the
 *     wrong period for a paint. The rig keys the page by cadence; the driver
 *     refuses any read whose cadence and period do not belong together.
 * 13. A bridge call this rig does not model, or a console error, passes
 *     unnoticed.
 *
 * The driver waits on `reviewRigReady`, set after the shell, the page and the
 * checklist have committed, so it never samples a half-rendered page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type {
  ReviewCadence,
  ReviewNotebook,
  ReviewPageBody,
  ReviewPrepopulateResult,
  ReviewRecord,
  ReviewSkill,
  VaultSnapshot,
} from "@lifequest/vault-core";
import {
  DEFAULT_REVIEW_AVAILABILITY,
  periodTitle,
} from "@lifequest/vault-core/pure";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import ReviewPage from "@/pages/ReviewPage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import type { HermesSession } from "@/vite-env";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

const CADENCE: ReviewCadence = "weekly";
const WEEK_START_DAY = "monday" as const;

/** The exact sentence the engine returns for a daily area scope. */
const DAILY_NO_AREAS =
  "The daily review is one general review — it has no area sections.";

/**
 * The areas this vault shows, in its own order.
 *
 * `spirit` exists on disk but is locked (below), which is the fixture that
 * proves the rail is drawn from `unlockedAreas`: if the component counts every
 * domain file, the rail gains a sixth row and the progress denominator changes.
 * `life` is the base area and is not an area review of its own.
 */
const AREAS = [
  { slug: "health", name: "Health", sortOrder: 1 },
  { slug: "mind", name: "Mind", sortOrder: 2 },
  { slug: "financial", name: "Finance", sortOrder: 3 },
  { slug: "business", name: "Business", sortOrder: 4 },
  { slug: "relationships", name: "Relationships", sortOrder: 5 },
] as const;

/** On disk and deliberately locked: never a row in the checklist. */
const LOCKED_AREA = { slug: "spirit", name: "Spirit", sortOrder: 6 } as const;

const AREA_NAME = new Map<string, string>(AREAS.map((area) => [area.slug, area.name]));

const OVERALL_HEADINGS = ["Look-back", "Keep", "Change", "Next-period intent"] as const;

type ScopeState = { status: "draft" | "done"; sessionId: string | null };

/** One review as the vault would hold it: the file, its scopes, and its lock. */
type StoredReview = {
  cadence: ReviewCadence;
  period: string;
  body: string;
  scopes: Record<string, ScopeState>;
  locked: boolean;
  /** The content version the real engine keeps; a whole-body baseRev is checked against it. */
  rev: number;
  /** The pages this notebook has created, overall first, then in creation order. */
  pages: string[];
  /** Each page's own rev; a page write's baseRev is checked against its page. */
  pageRevs: Record<string, number>;
};

const files = new Map<string, StoredReview>();
/** The file the page last named, so the driver reads the file it is looking at. */
let activeKey: string | null = null;

function fileKey(cadence: string, period: string): string {
  return `${cadence}\u0000${period}`;
}

function titleFor(cadence: ReviewCadence, period: string): string {
  return periodTitle(cadence, period, WEEK_START_DAY);
}

function overallSkeleton(): string {
  return OVERALL_HEADINGS.map((heading) => `## ${heading}`).join("\n\n");
}

function areaSkeleton(name: string): string {
  return [`## ${name}`, ...OVERALL_HEADINGS.map((heading) => `### ${heading}`)].join(
    "\n\n",
  );
}

/**
 * The weekly fixture: one file holding the overall skeleton, one section per live
 * area, and a `## Notes` heading outside the skeleton — the operator's own
 * heading, which a summary that extracted only the required four used to drop.
 *
 * The blank block between the two Look-back paragraphs is deliberate: it is the
 * paragraph break the operator typed, and the claim that it survives a write is
 * only falsifiable if the file opens with it.
 */
function weeklyBlocks(period: string): string[] {
  return [
    `# ${titleFor("weekly", period)}`,
    "## Look-back",
    "Two walks, and **one** late night.",
    "",
    "Slept badly, and it showed.",
    "## Keep",
    "## Change",
    "## Next-period intent",
    ...AREAS.flatMap((area) => [
      `## ${area.name}`,
      "### Look-back",
      "### Keep",
      "### Change",
      "### Next-period intent",
    ]),
    "## Notes",
    "A note outside the skeleton.",
  ];
}

/**
 * The review the page opens on.
 *
 * It is mid-flight on purpose: `Health` is done and `Finance` is in progress, so
 * the rail must show `Done`, `In progress` and `Not started` at once and the
 * progress line must count one finished area of five. The overall scope is
 * planted (as the engine plants it when the file is created) but never started,
 * which is the state the life review's gate has to unlock from.
 */
function seedReview(cadence: ReviewCadence, period: string): StoredReview {
  const weekly = cadence === "weekly";
  return {
    cadence,
    period,
    body: weekly
      ? weeklyBlocks(period).join("\n\n")
      : `# ${titleFor(cadence, period)}\n\n${overallSkeleton()}`,
    rev: 7,
    pages: weekly ? ["overall", "health", "financial"] : ["overall"],
    pageRevs: weekly
      ? { overall: 5, health: 6, financial: 3 }
      : { overall: 5 },
    scopes: weekly
      ? {
          // The engine plants the overall scope when it creates the file, which
          // is why the Life row reads "In progress" once the gate lifts: the
          // file has the scope, nobody has started it. The areas are mid-flight:
          // Health finished, Finance started, the rest untouched.
          overall: { status: "draft", sessionId: null },
          health: { status: "done", sessionId: null },
          financial: { status: "draft", sessionId: null },
        }
      : { overall: { status: "draft", sessionId: null } },
    locked: false,
  };
}

function getOrSeed(cadence: ReviewCadence, period: string): StoredReview {
  const key = fileKey(cadence, period);
  let stored = files.get(key);
  if (!stored) {
    stored = seedReview(cadence, period);
    files.set(key, stored);
  }
  activeKey = key;
  return stored;
}

/**
 * The vault's change signal, played by the rig.
 *
 * The page cannot see the companion's tool calls — they happen in the main
 * process — so the only way it learns a scope was marked done is main's
 * `vault:dataChanged`. This is that announcement: the stub bridge registers the
 * listeners, and this fires them after the rig has changed the file, exactly as
 * main does once a tool call has settled (it coalesces them per frame, which one
 * announcement at a time cannot tell apart from this).
 */
let dataRevision = 0;
const dataChangeListeners = new Set<(revision: number) => void>();

function announceDataChanged(): number {
  dataRevision += 1;
  for (const listener of [...dataChangeListeners]) {
    try {
      listener(dataRevision);
    } catch {
      // A listener's failure is its own; the change it heard about still landed.
    }
  }
  return dataRevision;
}

/**
 * Write the review body the way the agent's `write_review` tool does: into the
 * file, outside the page's own bridge call, then announce the change.
 *
 * The companion writes the report as the interview goes; the operator is sitting
 * on the open page. Before the page re-read the body on the change signal, the
 * box kept the skeleton it was opened with until the operator navigated away and
 * back — the reported bug. This is that write, and the announcement is the only
 * thing the page can hear.
 */
function agentWritesBody(body: string): { ok: boolean; error?: string } {
  const key = activeKey;
  const stored = key ? files.get(key) : undefined;
  if (!stored) return { ok: false, error: "Review file not found" };
  // The engine refuses a write to a locked file; the rig mirrors it so a leg
  // that writes after the lock fails here rather than passing on a state the
  // real tool would refuse.
  if (stored.locked) return { ok: false, error: "LOCKED" };
  stored.body = body;
  stored.rev += 1;
  // The agent wrote the whole file, so every page it can see has moved: a page
  // write issued from the draft the operator loaded before this is stale.
  for (const scope of stored.pages) {
    stored.pageRevs[scope] = (stored.pageRevs[scope] ?? 0) + 1;
  }
  announceDataChanged();
  return { ok: true };
}

/**
 * Mark one scope done the way the agent's `mark_review_done` tool does: in the
 * file, outside the page's own bridge call, and then announce the change.
 *
 * This is the leg that proves the checklist is live. The page's own Mark-done
 * button already re-reads the record after its `reviewMarkDone` call, so driving
 * that path would prove nothing; this one changes the vault the way a tool call
 * in main does, and leaves the page to hear about it the only way it can.
 */
function agentMarksDone(
  scope: string,
): { ok: boolean; scopes?: Record<string, ScopeState>; error?: string } {
  const key = activeKey;
  const stored = key ? files.get(key) : undefined;
  if (!stored) return { ok: false, error: "Review file not found" };
  if (scope === "overall") {
    // The engine's own rule: the life review cannot be finished before the
    // areas are, but the daily review has no areas and is never gated. The rig
    // mirrors both, so a live leg that asks for a gate the engine does not have
    // fails here rather than passing on a state the real tool refuses.
    const refusal = stored.cadence === "daily" ? null : overallRefusal(stored);
    if (refusal) return { ok: false, error: refusal };
    stored.scopes.overall = {
      status: "done",
      sessionId: stored.scopes.overall?.sessionId ?? null,
    };
    stored.locked = true;
  } else {
    const state = stored.scopes[scope];
    if (!state) return { ok: false, error: `Domain scope not found: ${scope}` };
    state.status = "done";
  }
  announceDataChanged();
  return { ok: true, scopes: { ...stored.scopes } };
}

/**
 * The record a bridge call answers with.
 *
 * The scopes are copied rather than handed over by reference. The real bridge
 * crosses a process boundary and structured-clones its answer, so the page can
 * never hold the engine's own mutable object; in this same-realm stub, handing
 * the reference over would let a later `reviewMarkDone` rewrite the scopes a
 * page already holds — which quietly turned the "was every area already done?"
 * check inside `onMarkDone` into a no. The copy is what makes the stub behave
 * like the process boundary it stands in for.
 */
function recordOf(stored: StoredReview): ReviewRecord {
  const scopes: Record<string, { status: "draft" | "done"; sessionId: string | null }> = {};
  for (const [scope, state] of Object.entries(stored.scopes)) {
    scopes[scope] = { status: state.status, sessionId: state.sessionId };
  }
  return {
    cadence: stored.cadence,
    period: stored.period,
    weekStartDay: WEEK_START_DAY,
    locked: stored.locked,
    updatedAt: "2026-10-18T00:00:00.000Z",
    title: titleFor(stored.cadence, stored.period),
    rev: stored.rev,
    scopes,
    bodyMarkdown: stored.body,
  };
}

function hasAreaSection(body: string, name: string): boolean {
  return body.split("\n").some((line) => line.trim() === `## ${name}`);
}

/**
 * One page's body, projected out of the in-memory whole file.
 *
 * The real engine stores a page per scope; the rig keeps the same fixture it
 * always had and projects the page the way the engine's compatibility view does
 * the opposite (page bodies demote to area sections). That keeps the fixture
 * readable while the page API is what the page under test actually calls.
 */
function pageTitle(stored: StoredReview, scope: string): string {
  return scope === "overall"
    ? titleFor(stored.cadence, stored.period)
    : (AREA_NAME.get(scope) ?? scope);
}

function areaNames(): Set<string> {
  return new Set(AREAS.map((area) => area.name));
}

function pageSkeletonFor(stored: StoredReview, scope: string): string {
  return scope === "overall"
    ? `# ${pageTitle(stored, scope)}\n\n${overallSkeleton()}`
    : `# ${pageTitle(stored, scope)}\n\n${OVERALL_HEADINGS.map((heading) => `## ${heading}`).join("\n\n")}`;
}

/** The overall page: the H1, the non-area H2 blocks (the four headings and any extras). */
function overallPageBody(stored: StoredReview): string {
  const lines = stored.body.split("\n");
  const blocks: string[] = [];
  const areas = areaNames();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const match = /^##\s+(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const name = match[1]!.trim();
    const start = i;
    i += 1;
    while (i < lines.length && !/^##\s/.test(lines[i]!)) i += 1;
    if (!areas.has(name)) blocks.push(lines.slice(start, i).join("\n").trimEnd());
  }
  return [`# ${pageTitle(stored, "overall")}`, ...blocks].join("\n\n");
}

/** One area page: H1 = the area's name, then its four headings as H2. */
function areaPageBody(stored: StoredReview, scope: string): string {
  const name = pageTitle(stored, scope);
  const lines = stored.body.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${name}`);
  if (start === -1) return pageSkeletonFor(stored, scope);
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end]!)) end += 1;
  const body = lines
    .slice(start + 1, end)
    .map((line) => (/^###\s/.test(line) ? line.slice(1) : line))
    .join("\n")
    .trim();
  return body ? `# ${name}\n\n${body}` : pageSkeletonFor(stored, scope);
}

function pageBodyOf(stored: StoredReview, scope: string): string {
  return scope === "overall"
    ? overallPageBody(stored)
    : areaPageBody(stored, scope);
}

/** Split whole-file blocks: the H1, each H2 block, in order. */
function h2Blocks(body: string): Array<{ name: string; text: string }> {
  const lines = body.split("\n");
  const blocks: Array<{ name: string; text: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const match = /^##\s+(.*)$/.exec(lines[i]!);
    if (!match) {
      i += 1;
      continue;
    }
    const start = i;
    i += 1;
    while (i < lines.length && !/^##\s/.test(lines[i]!)) i += 1;
    blocks.push({ name: match[1]!.trim(), text: lines.slice(start, i).join("\n").trimEnd() });
  }
  return blocks;
}

/**
 * Write one page's body back into the whole fixture file.
 *
 * An area page's H2s become the area section's H3s under `## <Area>`; the overall
 * page's H2s replace the file's non-area H2s and keep every area block as it was.
 */
function writePageInto(stored: StoredReview, scope: string, pageBody: string): void {
  const lines = pageBody.split("\n");
  const firstH2 = lines.findIndex((line) => /^##\s/.test(line));
  const pageBlocks = firstH2 === -1 ? [] : h2Blocks(lines.slice(firstH2).join("\n"));
  const areas = areaNames();
  const existing = h2Blocks(stored.body);
  const areaBlocks = existing.filter((block) => areas.has(block.name));
  if (scope === "overall") {
    const overallBlocks = pageBlocks.filter((block) => !areas.has(block.name));
    stored.body = [
      `# ${titleFor(stored.cadence, stored.period)}`,
      ...overallBlocks.map((block) => block.text),
      ...areaBlocks.map((block) => block.text),
    ].join("\n\n");
    return;
  }
  const name = pageTitle(stored, scope);
  const areaBlock = [
    `## ${name}`,
    ...pageBlocks.map((block) =>
      block.text
        .split("\n")
        .map((line) => (/^##\s/.test(line) ? `#${line}` : line))
        .join("\n"),
    ),
  ].join("\n\n");
  const others = areaBlocks.filter((block) => block.name !== name);
  const overallBlocks = existing.filter((block) => !areas.has(block.name));
  const replaced = [...others, areaBlock];
  // Keep the vault's area order (AREAS), then any other area blocks after it.
  const ordered = [
    ...AREAS.flatMap((area) => replaced.filter((block) => block.name === area.name)),
    ...replaced.filter((block) => !AREAS.some((area) => area.name === block.name)),
  ];
  stored.body = [
    `# ${titleFor(stored.cadence, stored.period)}`,
    ...overallBlocks.map((block) => block.text),
    ...ordered.map((block) => block.text),
  ].join("\n\n");
}

/** The notebook summary the tabs read. */
function notebookOf(stored: StoredReview): ReviewNotebook {
  const pages = stored.pages.map((scope) => ({
    scope,
    title: pageTitle(stored, scope),
    status: (stored.scopes[scope]?.status ?? "draft") as "draft" | "done",
    sessionId: stored.scopes[scope]?.sessionId ?? null,
    rev: stored.pageRevs[scope] ?? 1,
    updatedAt: "2026-10-18T00:00:00.000Z",
    chars: pageBodyOf(stored, scope).length,
  }));
  return {
    cadence: stored.cadence,
    period: stored.period,
    title: titleFor(stored.cadence, stored.period),
    weekStartDay: WEEK_START_DAY,
    locked: stored.locked,
    order: stored.pages,
    rev: stored.rev,
    pages,
    path: "C:\\harness\\vault\\reviews",
    legacy: false,
  };
}

/** One page as the page API answers it. */
function pageOf(stored: StoredReview, scope: string): ReviewPageBody {
  const exists = stored.pages.includes(scope);
  return {
    scope,
    title: pageTitle(stored, scope),
    status: exists
      ? ((stored.scopes[scope]?.status ?? "draft") as "draft" | "done")
      : "missing",
    sessionId: exists ? (stored.scopes[scope]?.sessionId ?? null) : null,
    rev: exists ? (stored.pageRevs[scope] ?? 1) : 0,
    updatedAt: exists ? "2026-10-18T00:00:00.000Z" : null,
    locked: stored.locked,
    bodyMarkdown: exists
      ? pageBodyOf(stored, scope)
      : pageSkeletonFor(stored, scope),
  };
}

/**
 * The three figures the app writes into Finance's Look-back at Start, from the
 * shipped finance metric definitions. The values are fixtures, but the marker
 * ids, labels, units, window, as-of instant and provenance line are the shipped
 * shapes: a stub that still drew the skill's old `lifequest-snapshot` block would
 * let a page that never learned metric figures pass.
 */
type StubFigure = {
  /** The metric definition's id; the marker wraps `metric:<id>`. */
  id: string;
  label: string;
  /** The printed value with its unit. */
  value: string;
  /** The previous window's printed value, for the overall page's comparison table. */
  previous: string;
  /** The signed difference of the printed values, as the engine prints it. */
  delta: string;
};

const METRIC_FIGURES: StubFigure[] = [
  {
    id: "cash-in",
    label: "Cash in",
    value: "5,000 (ZAR)",
    previous: "4,000 (ZAR)",
    delta: "+1,000",
  },
  {
    id: "cash-out",
    label: "Cash out",
    value: "1,234.56 (ZAR)",
    previous: "980.10 (ZAR)",
    delta: "+254.46",
  },
  {
    id: "net-cash-flow",
    label: "Net cash flow (transfers included)",
    value: "3,765.44 (ZAR)",
    previous: "3,019.90 (ZAR)",
    delta: "+745.54",
  },
];

/**
 * The windows and as-of instant are fixed, not read from the clock: a second
 * Start then produces a byte-identical block, so "the file holds one block per
 * definition" is a claim about replacement, not about two timestamps differing.
 */
const FIGURE_WINDOW = "2026-10-12 → 2026-10-18";
const PREVIOUS_WINDOW = "2026-10-05 → 2026-10-11";
const FIGURE_AS_OF = "2026-10-18 08:00";
const FIGURE_SOURCE = "the finance:transactions database";

const OVERALL_OPEN = "<!-- lifequest:metrics:overall -->";
const OVERALL_CLOSE = "<!-- /lifequest:metrics:overall -->";

/**
 * One row of the overall page's cross-domain table: the area and metric the
 * number came from, and the three cells the table prints. The Health row is the
 * fixture's event-backed metric; the Finance rows are the three shipped
 * definitions above.
 */
type StubOverallRow = {
  area: string;
  label: string;
  current: string;
  previous: string;
  delta: string;
};

const OVERALL_ROWS: StubOverallRow[] = [
  {
    area: "Health",
    label: "Training sessions",
    current: "3 sessions",
    previous: "2 sessions",
    delta: "+1",
  },
  ...METRIC_FIGURES.map((figure) => ({
    area: "Finance",
    label: figure.label,
    current: figure.value,
    previous: figure.previous,
    delta: figure.delta,
  })),
];

function figureMarkerOpen(id: string): string {
  return `<!-- lifequest:metric:${id} -->`;
}

function figureMarkerClose(id: string): string {
  return `<!-- /lifequest:metric:${id} -->`;
}

/**
 * One figure's markdown — the block's inside, between its markers: bold label
 * with its window, then its number, as-of and source.
 */
function figureBlockText(figure: StubFigure): string {
  return [
    `**${figure.label}** · ${FIGURE_WINDOW}`,
    ``,
    figure.value,
    ``,
    `_As of ${FIGURE_AS_OF} · Source: ${FIGURE_SOURCE}_`,
  ].join("\n");
}

/**
 * The overall block's inside, between its markers: one row per measured metric,
 * then the as-of instant and the previous window.
 */
function overallBlockText(): string {
  return [
    `**Metrics this period** · ${FIGURE_WINDOW}`,
    ``,
    `| Area | Metric | This period | Previous period | Δ |`,
    `| --- | --- | --- | --- | --- |`,
    ...OVERALL_ROWS.map(
      (row) =>
        `| ${row.area} | ${row.label} | ${row.current} | ${row.previous} | ${row.delta} |`,
    ),
    ``,
    `_As of ${FIGURE_AS_OF} · Previous period: ${PREVIOUS_WINDOW}_`,
  ].join("\n");
}

/** The span of one heading's section: where it starts and where the next heading begins. */
type SectionSpan = { headingAt: number; endAt: number };

/** Find one heading at or after `from`, and the next heading that ends its section. */
function findSectionSpan(
  lines: string[],
  from: number,
  heading: string,
  next: RegExp,
): SectionSpan | null {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i]!.trim() !== heading) continue;
    let endAt = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (next.test(lines[j]!)) {
        endAt = j;
        break;
      }
    }
    return { headingAt: i, endAt };
  }
  return null;
}

/** Any app-written block's closing marker: where the next block goes after. */
const APP_BLOCK_CLOSE =
  /^<!-- \/(?:lifequest:snapshot:.+|lifequest:metric:.+|lifequest:metrics:overall) -->$/;

/**
 * Put one app-written block where it belongs: replace it by its own markers, or
 * open the section ahead of the operator's prose and after any block a previous
 * pass wrote — the engine's own placement, so a second Start rewrites one block
 * per figure instead of appending another.
 */
function upsertAppBlock(
  body: string,
  span: SectionSpan,
  open: string,
  close: string,
  markdown: string,
): { body: string; applied: boolean } {
  const lines = body.split("\n");
  const openAt = lines.indexOf(open);
  if (openAt !== -1) {
    const closeAt = lines.indexOf(close, openAt + 1);
    const end = closeAt === -1 ? openAt + 1 : closeAt + 1;
    const next = [
      ...lines.slice(0, openAt),
      open,
      ...markdown.split("\n"),
      close,
      ...lines.slice(end),
    ].join("\n");
    return { body: next, applied: next !== body };
  }
  let at = span.headingAt + 1;
  while (at < lines.length && lines[at]!.trim() === "") at += 1;
  for (let i = span.headingAt + 1; i < span.endAt && i < lines.length; i += 1) {
    if (!APP_BLOCK_CLOSE.test(lines[i]!)) continue;
    at = i + 1;
    while (at < lines.length && lines[at]!.trim() === "") at += 1;
  }
  const before = lines.slice(0, at);
  if (before.length > 0 && before[before.length - 1]!.trim() !== "") before.push("");
  const after = lines.slice(at);
  const next = [...before, open, ...markdown.split("\n"), close];
  if (after.length > 0 && after[0]!.trim() !== "") next.push("");
  next.push(...after);
  return { body: next.join("\n"), applied: true };
}

/**
 * Write the three figures into the Finance area's Look-back, in definition
 * order, each one upserted by its own marker.
 *
 * The definitions name the financial domain, so the blocks belong under
 * `## Finance` / `### Look-back` — not under the overall `## Look-back` — and,
 * like the engine, they open the section ahead of the operator's own prose.
 */
function writeAreaFigures(body: string): { body: string; applied: boolean } {
  let next = body;
  for (const figure of METRIC_FIGURES) {
    const lines = next.split("\n");
    const financeAt = lines.indexOf("## Finance");
    if (financeAt === -1) break;
    const span = findSectionSpan(lines, financeAt + 1, "### Look-back", /^#{2,3}\s/);
    if (!span) break;
    next = upsertAppBlock(
      next,
      span,
      figureMarkerOpen(figure.id),
      figureMarkerClose(figure.id),
      figureBlockText(figure),
    ).body;
  }
  return { body: next, applied: next !== body };
}

/**
 * Write the overall page's cross-domain table under its `## Look-back`, or
 * refresh it in place. The operator's prose below the block is kept, and the
 * marker is the anchor: a second Start rewrites the same block.
 */
function writeOverallMetrics(body: string): { body: string; applied: boolean } {
  const lines = body.split("\n");
  const span = findSectionSpan(lines, 0, "## Look-back", /^##\s/);
  if (!span) return { body, applied: false };
  return upsertAppBlock(body, span, OVERALL_OPEN, OVERALL_CLOSE, overallBlockText());
}

/**
 * The shipped Phase 5 default skill (weekly), verbatim: prose only.
 *
 * Figures come from the vault's metric definitions and are written by the app at
 * Start, so the default carries no `lifequest-snapshot` fences; the prose keeps
 * the one door that is still the operator's — a hand-written fence for a custom
 * figure no definition covers. The rules panel in the rig is this file, so a
 * stub whose rules disagreed with the shipped default would show a different
 * page than the operator gets.
 */
const SKILL_MARKDOWN = [
  `---`,
  `cadence: weekly`,
  `---`,
  `# Weekly review skill`,
  ``,
  `Standing rules for this cadence's review sessions. Edit freely, or ask the`,
  `companion to add a rule — the whole file is handed to the review session.`,
  ``,
  `## How to run this review`,
  ``,
  `- Work from the review page the app has open. Read it with \`get_review\` and the scope you were given before you change anything; a page is written with \`write_review(scope, body, baseRev)\`.`,
  `- Look-back is for what happened, told straight. Keep is for what worked and should stay. Change is for what to do differently. Next-period intent is for what the next period is for.`,
  `- Prefer the operator's own words over your summary of them. \`get_period_pack\` carries the period's daily notes, log, tasks, goals and events — use it rather than asking for facts it already holds.`,
  `- Write into the section you were asked about, and leave the other sections, and the other pages, as they are.`,
  `- On the overall page, read every area page first and put the areas back together under the four common headings; never rewrite an area's page from there.`,
  `- When the report is ready, propose \`mark_review_done\` rather than marking it done yourself.`,
  ``,
  `- A week is where patterns start to show. Name the one pattern worth changing, not five.`,
  `- Compare against the previous week's review when there is one.`,
  ``,
  `## Figures`,
  ``,
  `The app writes this review's figures itself when Start is pressed. Each one is`,
  `read from the area's own metric definitions, so the numbers are there whether`,
  `or not the agent is running, and a figure prints its label, its value and unit,`,
  `the window it covers, the as-of minute it was read, and the database or event`,
  `it came from. A review window opens before its period ends, so a figure read`,
  `early says "period to date" — the as-of line is what makes the number honest.`,
  ``,
  `Figures refresh on Start while the review is open and freeze once it is`,
  `locked: a finished review is history, not a live dashboard. To change what a`,
  `figure measures, change that area's metric definitions rather than this file.`,
  ``,
  `A hand-written \`lifequest-snapshot\` fence in this file is still honoured for a`,
  `custom figure the metric definitions do not cover; the app writes and refreshes`,
  `that block on Start exactly as before.`,
].join("\n");

/**
 * A kickoff shaped like the engine's, for the cadence and scope the page asked
 * for. The driver asserts the fragments the engine contract fixes — the daily
 * line says there are no area sections, the life line says it is the whole-life
 * review, the area line names the area's own `##` section — so a page that
 * binds a different scope than the row it pressed hands the dock the wrong text.
 */
function kickoffFor(cadence: ReviewCadence, period: string, scope: string): string {
  const title = titleFor(cadence, period);
  const figures =
    "Read your page with get_review (pass this scope) — the app has already filled in the figures from your metric definitions, inside `<!-- lifequest:metric:<id> -->` markers, so work from those numbers rather than fetching them again. Use get_period_pack for the period's own days.";
  if (cadence === "daily") {
    return `Let's assemble the ${title}. This is one general review of the day as a whole — the daily review has no area sections, so write the overall sections only. Interview me through look-back, keep, change, and next-period intent. ${figures} When the report is ready, propose marking this review complete with mark_review_done.`;
  }
  if (scope === "overall") {
    return `Let's assemble the ${title}. This is the whole-life review: every area review for this period is complete (${AREAS.length} areas). Read every area page with get_review first (one call per area scope). The overall page has no area sections: synthesise the area pages under the four common headings — Look-back, Keep, Change, Next-period intent — without copying an area's own extra sections, and never rewrite an area page. Write the overall page only (get_review with scope "overall", then write_review with that scope and its rev), synthesising from the areas rather than repeating a single one. Interview me through the four overall headings. ${figures} When the report is ready, propose marking this review complete with mark_review_done.`;
  }
  const name = AREA_NAME.get(scope) ?? scope;
  return `Let's assemble the ${title}. This is the ${name} review — this period's part of the life review. Your page is get_review with scope "${scope}" → write_review with the same scope, the page body (one # title and the four common ## headings) and the rev it returned. Leave every other page alone. Interview me through the four common headings. ${figures} When this area's report is ready, propose marking the ${name} review complete with mark_review_done.`;
}

/** The refusal the engine builds when the life review is pressed too early. */
function overallRefusal(stored: StoredReview): string | null {
  const remaining = AREAS.filter((area) => stored.scopes[area.slug]?.status !== "done");
  if (remaining.length === 0) return null;
  const parts = remaining.map((area) => {
    const status =
      stored.scopes[area.slug]?.status === "draft" ? "in progress" : "not started";
    return `${area.name}: ${status}`;
  });
  return `Finish every area review first — ${parts.join("; ")}.`;
}

type ReviewWrite = { cadence: string; period: string; body: string };
type FigurePassCall = { cadence: string; period: string; scope: string };
type StartCall = {
  cadence: string;
  period: string;
  scope: string;
  sessionId: string;
  kickoff: string;
};

type HarnessWindow = Window & {
  reviewRigReady?: boolean;
  reviewRigSkin?: string;
  reviewRigGoto?: (path: string) => void;
  reviewRigCalls?: string[];
  reviewRigUnexpectedCalls?: string[];
  reviewRigWrites?: ReviewWrite[];
  /** Every figure pass the page asked the vault to run, with the scope it named. */
  reviewRigFigureCalls?: FigurePassCall[];
  /** Every session the page asked Start to open, with the scope it named. */
  reviewRigStarts?: StartCall[];
  /** The turn text the dock sent when a start opened the interview. */
  reviewRigKickoffs?: string[];
  reviewRigSkillWrites?: string[];
  /** Flipped by the driver: makes `reviewStartOrResume` answer "agent down". */
  reviewRigAgentDown?: boolean;
  /**
   * Held open by the driver so the chat list can be sampled while the start's
   * turn is still RUNNING — the moment the reported bug was about. Released with
   * `reviewRigReleaseTurns`.
   */
  reviewRigHoldTurns?: boolean;
  reviewRigReleaseTurns?: () => void;
  /** The chats the gateway holds, so the driver can find the one a start made. */
  reviewRigSessions?: () => HermesSession[];
  /** The review body as the whole file holds it, for the driver to assert against. */
  reviewRigBody?: () => string;
  /** One page's body as the engine would serve it, for page-level assertions. */
  reviewRigPageBody?: (scope: string) => string;
  /** The pages the notebook holds, in order. */
  reviewRigPages?: () => string[];
  /** The loaded file's scope states, so "the rail said Done" can be cross-checked. */
  reviewRigScopes?: () => Record<string, ScopeState>;
  /** The loaded file's lock, so the lock claim is about the file, not just a badge. */
  reviewRigLocked?: () => boolean;
  /** How many listeners the page holds on the vault's change signal. */
  reviewRigDataListenerCount?: () => number;
  /** Fire main's data-change announcement, as it does after a tool call settles. */
  reviewRigAnnounceDataChange?: () => number;
  /** The agent's `write_review`, in the file and outside the page's bridge. */
  reviewRigAgentWritesBody?: (body: string) => { ok: boolean; error?: string };
  /** The agent's `mark_review_done`, in the file and outside the page's bridge. */
  reviewRigAgentMarksDone?: (
    scope: string,
  ) => { ok: boolean; scopes?: Record<string, ScopeState>; error?: string };
};

const harness = window as HarnessWindow;
harness.reviewRigCalls = [];
harness.reviewRigUnexpectedCalls = [];
harness.reviewRigWrites = [];
harness.reviewRigFigureCalls = [];
harness.reviewRigStarts = [];
harness.reviewRigKickoffs = [];
harness.reviewRigSkillWrites = [];
harness.reviewRigAgentDown = false;
harness.reviewRigHoldTurns = false;
harness.reviewRigReleaseTurns = () => {
  for (const release of heldTurns.splice(0)) release();
};
harness.reviewRigSessions = () => gatewaySessions.map((row) => ({ ...row }));

harness.reviewRigBody = () => (activeKey ? (files.get(activeKey)?.body ?? "") : "");
harness.reviewRigPageBody = (scope: string) => {
  const stored = activeKey ? files.get(activeKey) : undefined;
  return stored ? pageOf(stored, scope).bodyMarkdown : "";
};
harness.reviewRigPages = () => {
  const stored = activeKey ? files.get(activeKey) : undefined;
  return stored ? [...stored.pages] : [];
};
harness.reviewRigScopes = () => {
  const stored = activeKey ? files.get(activeKey) : undefined;
  return stored ? { ...stored.scopes } : {};
};
harness.reviewRigLocked = () => Boolean(activeKey && files.get(activeKey)?.locked);
harness.reviewRigDataListenerCount = () => dataChangeListeners.size;
harness.reviewRigAnnounceDataChange = () => announceDataChanged();
harness.reviewRigAgentWritesBody = (body: string) => agentWritesBody(body);
harness.reviewRigAgentMarksDone = (scope: string) => agentMarksDone(scope);

/**
 * One chat row, as the gateway hands it back.
 *
 * The list belongs to the gateway, not to the page: a session a start creates
 * is added here, exactly as `harnessSessionCreate` adds one in main. The
 * renderer reads that list once on mount (and again only after a turn settles),
 * so a chat created by a start is NOT in the store until the dock is handed its
 * row. That is the thing this rig checks.
 */
function chatRow(id: string, title: string, lastActive: number): HermesSession {
  return {
    id,
    title,
    preview: null,
    lastActive,
    pinned: false,
    archived: false,
    model: null,
    source: "desktop",
  };
}

/** The one conversation the operator already had before the review started. */
const SESSION = chatRow("review-rig-session", "Packing list for the trip", 1_700_000_000);

/** Every chat the gateway holds, oldest first. */
const gatewaySessions: HermesSession[] = [SESSION];
let sessionsMade = 0;

/** Add the chat a start just asked the gateway for, and hand it back. */
function madeSession(title: string): HermesSession {
  sessionsMade += 1;
  const row = chatRow(
    `review-rig-session-${sessionsMade}`,
    title,
    1_700_000_000 + sessionsMade,
  );
  gatewaySessions.push(row);
  return row;
}

/**
 * The name main gives a review or plan chat: the period, then the scope's own
 * area for an area scope. The sidebar row must wear this name from its first
 * paint, so the driver compares the two.
 */
function reviewSessionTitle(
  cadence: ReviewCadence,
  period: string,
  scope: string,
): string {
  const periodName = titleFor(cadence, period);
  return scope === "overall"
    ? periodName
    : `${periodName} · ${AREA_NAME.get(scope) ?? scope}`;
}

/** Every turn the rig is holding open, so the driver can release them. */
const heldTurns: Array<() => void> = [];

const UNLOCKED_AT = "2026-02-01T00:00:00.000Z";

function domainRecord(
  slug: string,
  name: string,
  sortOrder: number,
  unlockedAt: string | null,
): VaultSnapshot["domains"][number] {
  return {
    slug,
    meta: {
      name,
      description: null,
      color: null,
      sortOrder,
      archivedAt: null,
      unlockedAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    documents: {} as VaultSnapshot["domains"][number]["documents"],
  };
}

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "review-rig-vault",
    name: "Review Rig",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
    /**
     * The page now opens on the latest OPEN period, so it reads the vault's
     * windows. This harness serves whatever period it is asked for rather than
     * pinning a clock, so the shipped defaults keep it on the current week; a
     * snapshot without the key would leave the page to guess.
     */
    reviewAvailability: DEFAULT_REVIEW_AVAILABILITY,
  },
  domains: [
    domainRecord("life", "Life", 0, UNLOCKED_AT),
    ...AREAS.map((area) => domainRecord(area.slug, area.name, area.sortOrder, UNLOCKED_AT)),
    // Seeded on disk and locked: `unlockedAreas` excludes it, and the checklist
    // must not offer a review for an area the operator cannot see.
    domainRecord(LOCKED_AREA.slug, LOCKED_AREA.name, LOCKED_AREA.sortOrder, null),
  ],
  agents: [],
  decisions: [],
  log: [],
  map: null,
  mapError: null,
  goals: [],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

let skillMarkdown: string | null = null;

/** Every bridge method the page is allowed to reach. Anything else is named. */
const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  /**
   * The vault's change signal, as preload exposes it. The page subscribes to
   * hear about a scope the companion marked done in main — a tool call that
   * never passes through this renderer's bridge — and the driver fires it with
   * `reviewRigAgentMarksDone`, after the rig has changed the file.
   */
  onVaultDataChanged: (cb: (revision: number) => void) => {
    dataChangeListeners.add(cb);
    return () => {
      dataChangeListeners.delete(cb);
    };
  },
  domainGetActive: () => ok(null),
  domainSetActive: () => ok(null),
  // The gateway's chat list, answered as copies the way the real IPC hop does —
  // a mutable array would let a later create appear in the store's list by
  // aliasing, hiding the very bug this rig is for.
  companionSessionsList: () => ok(gatewaySessions.map((row) => ({ ...row }))),
  companionSessionCreate: (title: string) => ok(madeSession(title)),
  companionSessionMessages: () => ok([]),
  companionModelOptions: () =>
    ok({ providers: [], current: { model: "harness", provider: "harness" } }),
  /**
   * A start opens the interview, which means the dock sends the kickoff turn.
   * This rig is not about the chat's every frame: the turn is accepted and
   * recorded, and no stream events are emitted.
   *
   * The driver can hold the turn open (`reviewRigHoldTurns`) so the chat can be
   * looked up in the sidebar while the agent is still working; releasing it
   * settles the turn exactly as a finished stream would.
   */
  companionChatStream: (payload: { sessionId: string; input: string }) => {
    harness.reviewRigCalls?.push(`companionChatStream:${payload.sessionId}`);
    harness.reviewRigKickoffs?.push(payload.input);
    if (harness.reviewRigHoldTurns === true) {
      return new Promise((resolve) => {
        heldTurns.push(() => resolve({ ok: true } as const));
      });
    }
    return Promise.resolve({ ok: true } as const);
  },
  pinsList: () => ok({ pins: [], locked: false }),
  // The shell's pending-decisions badge reads the inbox on mount. These pages
  // are not about that badge, so the list is empty — but the call is modelled:
  // a rig that leaves it unnamed fails on the shell's own read, not on the page
  // under test.
  decisionList: () => ok([]),
  onCompanionStream: () => () => {},
  // The theme store reads the profile's themes directory on mount and watches
  // it. A review rig is not about themes, so the list is empty and the watcher
  // is a no-op — but both must be modelled: the proxy's catch-all answers with a
  // Promise, and ThemeProvider throws on an `unsubscribe` that is not a
  // function, leaving the harness never ready.
  themesList: () => ok([]),
  themeGetState: () => ok({ keptFile: null }),
  onThemesChanged: () => () => {},
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
  },

  reviewGet: (cadence: string, period: string) => {
    harness.reviewRigCalls?.push(`reviewGet:${cadence}:${period}`);
    const key = fileKey(cadence, period);
    const stored = files.get(key);
    // A daily period the rig has no file for is the empty state, not an error:
    // the page treats "not found" as "nobody has reviewed this day yet".
    if (!stored && cadence === "daily") {
      activeKey = key;
      return Promise.resolve(fail("Review file not found"));
    }
    const found = stored ?? getOrSeed(cadence as ReviewCadence, period);
    activeKey = key;
    return Promise.resolve(ok(recordOf(found)));
  },
  reviewNotebookGet: (cadence: string, period: string) => {
    harness.reviewRigCalls?.push(`reviewNotebookGet:${cadence}:${period}`);
    const key = fileKey(cadence, period);
    const stored =
      files.get(key) ??
      (cadence === "daily" ? undefined : getOrSeed(cadence as ReviewCadence, period));
    if (!stored) return Promise.resolve(fail("Review file not found"));
    activeKey = key;
    return Promise.resolve(ok(notebookOf(stored)));
  },
  reviewPageGet: (cadence: string, period: string, scope: string) => {
    harness.reviewRigCalls?.push(`reviewPageGet:${cadence}:${period}:${scope}`);
    const key = fileKey(cadence, period);
    const stored =
      files.get(key) ??
      (cadence === "daily" ? undefined : getOrSeed(cadence as ReviewCadence, period));
    if (!stored) return Promise.resolve(fail("Review file not found"));
    if (scope !== "overall" && !AREA_NAME.has(scope)) {
      return Promise.resolve(fail(`Area not found: ${scope}`));
    }
    activeKey = key;
    return Promise.resolve(ok(pageOf(stored, scope)));
  },
  reviewPageEnsure: (cadence: string, period: string, scope: string) => {
    harness.reviewRigCalls?.push(`reviewPageEnsure:${cadence}:${period}:${scope}`);
    if (cadence === "daily" && scope !== "overall") {
      return Promise.resolve(fail(DAILY_NO_AREAS));
    }
    if (scope !== "overall" && !AREA_NAME.has(scope)) {
      return Promise.resolve(fail(`Area not found: ${scope}`));
    }
    const stored = getOrSeed(cadence as ReviewCadence, period);
    if (!stored.scopes[scope]) {
      stored.scopes[scope] = { status: "draft", sessionId: null };
    }
    if (!stored.pages.includes(scope)) {
      stored.pages.push(scope);
      stored.pageRevs[scope] = 1;
      if (scope !== "overall") {
        const name = pageTitle(stored, scope);
        if (!hasAreaSection(stored.body, name)) {
          stored.body = `${stored.body}\n\n${areaSkeleton(name)}`;
        }
      }
    }
    return Promise.resolve(ok(notebookOf(stored)));
  },
  reviewPageWrite: (
    cadence: string,
    period: string,
    scope: string,
    body: string,
    baseRev: number,
  ) => {
    harness.reviewRigCalls?.push(`reviewPageWrite:${cadence}:${period}:${scope}`);
    const stored = getOrSeed(cadence as ReviewCadence, period);
    harness.reviewRigWrites?.push({ cadence, period, body });
    if (stored.locked) {
      return Promise.resolve({
        ok: false as const,
        error: "LOCKED",
        message: "This review is locked.",
        code: "LOCKED" as const,
        current: pageOf(stored, scope),
      });
    }
    const current = pageOf(stored, scope);
    if (baseRev !== current.rev) {
      return Promise.resolve({
        ok: false as const,
        error: "CONFLICT",
        message: "This page changed on disk. Reload it and re-apply your text.",
        code: "CONFLICT" as const,
        current,
      });
    }
    if (body === current.bodyMarkdown) {
      return Promise.resolve({
        ok: true as const,
        page: current,
        notebookRev: stored.rev,
      });
    }
    if (!stored.pages.includes(scope)) {
      return Promise.resolve({
        ok: false as const,
        error: "NOT_FOUND",
        message: "Review page not found",
        code: "NOT_FOUND" as const,
      });
    }
    writePageInto(stored, scope, body);
    stored.pageRevs[scope] = (stored.pageRevs[scope] ?? 0) + 1;
    stored.rev += 1;
    return Promise.resolve({
      ok: true as const,
      page: pageOf(stored, scope),
      notebookRev: stored.rev,
    });
  },
  reviewEnsure: (cadence: string, period: string, scope: string) => {
    harness.reviewRigCalls?.push(`reviewEnsure:${cadence}:${period}:${scope}`);
    if (cadence === "daily" && scope !== "overall") {
      return Promise.resolve(fail(DAILY_NO_AREAS));
    }
    const stored = getOrSeed(cadence as ReviewCadence, period);
    if (!stored.scopes.overall) {
      stored.scopes.overall = { status: "draft", sessionId: null };
    }
    if (!stored.pages.includes("overall")) stored.pages.unshift("overall");
    if (scope !== "overall") {
      const name = AREA_NAME.get(scope) ?? scope;
      if (!hasAreaSection(stored.body, name)) {
        stored.body = `${stored.body}\n\n${areaSkeleton(name)}`;
      }
      if (!stored.scopes[scope]) {
        stored.scopes[scope] = { status: "draft", sessionId: null };
      }
      if (!stored.pages.includes(scope)) {
        stored.pages.push(scope);
        stored.pageRevs[scope] = 1;
      }
    }
    return Promise.resolve(ok(recordOf(stored)));
  },
  reviewWrite: (cadence: string, period: string, next: string, baseRev?: number) => {
    harness.reviewRigCalls?.push(`reviewWrite:${cadence}:${period}`);
    harness.reviewRigWrites?.push({ cadence, period, body: next });
    const stored = getOrSeed(cadence as ReviewCadence, period);
    // Locking means "this is finished": the engine refuses a write to a locked
    // file, and the rig models that so "marking the life review complete locks
    // it" is checked against the file rather than against a badge.
    if (stored.locked) {
      return Promise.resolve({
        ok: false as const,
        error: "This review is locked.",
        code: "LOCKED" as const,
        current: recordOf(stored),
      });
    }
    // The engine's compare-and-swap: a save from a body the file has moved past
    // is refused with the file as it now stands, not applied.
    if (typeof baseRev === "number" && baseRev !== stored.rev) {
      return Promise.resolve({
        ok: false as const,
        error: "CONFLICT",
        code: "CONFLICT" as const,
        current: recordOf(stored),
      });
    }
    if (next === stored.body) return Promise.resolve(ok(recordOf(stored)));
    stored.body = next;
    stored.rev += 1;
    return Promise.resolve(ok(recordOf(stored)));
  },
  reviewPrepopulate: (cadence: string, period: string, scope: string) => {
    harness.reviewRigCalls?.push(`reviewPrepopulate:${cadence}:${period}:${scope}`);
    harness.reviewRigFigureCalls?.push({ cadence, period, scope });
    const stored = getOrSeed(cadence as ReviewCadence, period);
    const value = (patch: Partial<ReviewPrepopulateResult>): Result<ReviewPrepopulateResult> =>
      ok({
        cadence: cadence as ReviewCadence,
        period,
        scope,
        outcomes: [],
        applied: 0,
        planted: [],
        locked: stored.locked,
        bodyMarkdown: stored.body,
        ...patch,
      });
    // A locked review is frozen: the engine touches nothing, so a rig that
    // rewrote it would let a page claim a fill the vault refuses.
    if (stored.locked) return Promise.resolve(value({}));
    // The overall page — the daily review included — gets the cross-domain table
    // and nothing else. A daily review has no area pages, so it never grows an
    // area figure block; the table is found by its own marker. The engine reports
    // one `overall` outcome for the block, not one per row.
    if (scope === "overall") {
      const written = writeOverallMetrics(stored.body);
      if (written.applied) stored.body = written.body;
      return Promise.resolve(
        value({
          applied: written.applied ? 1 : 0,
          outcomes: [
            {
              kind: "overall",
              id: "metrics:overall",
              domain: "",
              section: "Look-back",
              title: "Metrics this period",
              status: written.applied ? ("written" as const) : ("unchanged" as const),
            },
          ],
        }),
      );
    }
    // Only the Finance area has definitions in this vault; the other areas'
    // passes find nothing to write and leave their pages alone.
    if (scope !== "financial") return Promise.resolve(value({}));
    const written = writeAreaFigures(stored.body);
    if (written.applied) stored.body = written.body;
    return Promise.resolve(
      value({
        applied: written.applied ? METRIC_FIGURES.length : 0,
        outcomes: METRIC_FIGURES.map((figure) => ({
          kind: "metric",
          id: `metric:${figure.id}`,
          definitionId: figure.id,
          domain: "financial",
          section: "Look-back",
          title: figure.label,
          status: written.applied ? ("written" as const) : ("unchanged" as const),
        })),
      }),
    );
  },
  reviewStartOrResume: (cadence: string, period: string, scope: string) => {
    harness.reviewRigCalls?.push(`reviewStartOrResume:${cadence}:${period}:${scope}`);
    if (harness.reviewRigAgentDown === true) {
      return Promise.resolve(
        fail(
          "Starting a chat: the agent is not answering. Open Settings › Hermes and press Recheck, then try again — the review itself is unaffected.",
        ),
      );
    }
    activeKey = fileKey(cadence, period);
    const kickoff = kickoffFor(cadence as ReviewCadence, period, scope);
    // The gateway makes the chat; main hands the page back both its id and its
    // row, so the dock can list it by name from the first paint.
    const session = madeSession(
      reviewSessionTitle(cadence as ReviewCadence, period, scope),
    );
    harness.reviewRigStarts?.push({
      cadence,
      period,
      scope,
      sessionId: session.id,
      kickoff,
    });
    return Promise.resolve(
      ok({ sessionId: session.id, created: true, kickoff, session }),
    );
  },
  reviewMarkDone: (cadence: string, period: string, scope: string) => {
    harness.reviewRigCalls?.push(`reviewMarkDone:${cadence}:${period}:${scope}`);
    const stored = getOrSeed(cadence as ReviewCadence, period);
    if (cadence === "daily" && scope !== "overall") {
      return Promise.resolve(fail(DAILY_NO_AREAS));
    }
    if (scope === "overall") {
      // The life review is the summary of the area reviews, so it cannot be
      // marked done before they are — daily has no areas and is never gated.
      if (cadence !== "daily") {
        const refusal = overallRefusal(stored);
        if (refusal) return Promise.resolve(fail(refusal));
      }
      stored.scopes.overall = {
        status: "done",
        sessionId: stored.scopes.overall?.sessionId ?? null,
      };
      stored.locked = true;
    } else {
      const scopeState = stored.scopes[scope];
      if (!scopeState) {
        return Promise.resolve(fail(`Domain scope not found: ${scope}`));
      }
      scopeState.status = "done";
    }
    return Promise.resolve(ok(recordOf(stored)));
  },
  reviewUnlock: (cadence: string, period: string) => {
    harness.reviewRigCalls?.push(`reviewUnlock:${cadence}:${period}`);
    const stored = getOrSeed(cadence as ReviewCadence, period);
    stored.locked = false;
    return Promise.resolve(ok(recordOf(stored)));
  },
  reviewSkillGet: (cadence: string) => {
    harness.reviewRigCalls?.push(`reviewSkillGet:${cadence}`);
    // The Phase 5 default carries no directives: the figures come from metric
    // definitions, so a `snapshots` list here would model the retired skill pass.
    const value: ReviewSkill = {
      cadence: cadence as ReviewCadence,
      markdown: skillMarkdown ?? SKILL_MARKDOWN,
      snapshots: [],
      problems: [],
      exists: skillMarkdown !== null,
    };
    return Promise.resolve(ok(value));
  },
  reviewSkillWrite: (cadence: string, markdown: string) => {
    harness.reviewRigCalls?.push(`reviewSkillWrite:${cadence}`);
    harness.reviewRigSkillWrites?.push(markdown);
    skillMarkdown = markdown;
    // A prose-only rules file is normal since Phase 5 — figures are not read off
    // the skill — so a write without fences parses clean. A fence that fails to
    // yield a directive is what `problems` names, and this fixture writes none.
    const value: ReviewSkill = {
      cadence: cadence as ReviewCadence,
      markdown,
      snapshots: [],
      problems: [],
      exists: true,
    };
    return Promise.resolve(ok(value));
  },
  planningStartOrResume: () => {
    const session = madeSession("Plan · this period");
    return Promise.resolve(
      ok({ sessionId: session.id, created: true, kickoff: "", session }),
    );
  },
  reviewPeriodPack: () => Promise.resolve(fail("not modelled here")),
  dailyNoteWindow: () => Promise.resolve(ok([])),
  dailyNoteList: () => Promise.resolve(ok([])),
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      const name = String(prop);
      harness.reviewRigUnexpectedCalls?.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from review.html");

function RouterControl() {
  const navigate = useNavigate();
  harness.reviewRigGoto = (path: string) => navigate(path);
  return null;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[`/review/${CADENCE}`]}>
      <RouterControl />
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="/review/:cadence" element={<ReviewPage />} />
                    </Route>
                  </Routes>
                </div>
              </div>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
void ready.then(() => {
  harness.reviewRigReady = true;
});
harness.reviewRigSkin = skinName;

const waitForPage = () => {
  const rail = document.querySelector(".nav-rail");
  const box = document.querySelector(".note-live");
  const tabs = document.querySelector('[data-testid="review-tabs"]');
  const daily = document.querySelector('[data-testid="review-layout"]');
  if (!rail || !box || (!tabs && !daily)) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);
