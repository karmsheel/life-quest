/**
 * E2E harness for the Review page, driven by `review.electron.mjs`.
 *
 * The real shell, the real page and the real stylesheet render here, so what the
 * driver reads is what the operator gets. Only the IPC bridge is stubbed, and it
 * is a *recording* stub: every method the page calls is modelled and anything
 * else answers `{ ok: false }` and is NAMED in `reviewRigUnexpectedCalls`, so a
 * page that grows a dependency this rig does not model fails the run loudly.
 *
 * The stub is also the *vault*: `reviewWrite` and `reviewPrepopulate` mutate the
 * one in-memory review body, exactly as the file would, so "the document still
 * holds what Start filled in" is a claim about state rather than about a call
 * having happened.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. Start is all-or-nothing again: an agent that is not running loses the
 *     document, the snapshot and the interview together, and the operator reads
 *     the transport's own words ("fetch failed") instead of what to do.
 *  2. The snapshot is not filled, or is filled outside the marker pair, so the
 *     figure the operator asked for is missing or the file grows a second copy
 *     on every Start.
 *  3. A blank line the operator typed does not survive: the box re-cuts the file
 *     and the paragraph break is gone, which is the reported "I cannot place
 *     empty lines between paragraphs".
 *  4. The formatting keys do nothing, or do the wrong thing: a heading is
 *     stacked rather than replaced, an underline mark is lost, or a mark is
 *     written where the caret was instead of around the selection.
 *  5. The cadence's own rules cannot be read or written from the page, so the
 *     operator has no way to add a rule except through the agent.
 *  6. A bridge call this rig does not model, or a console error, passes
 *     unnoticed.
 *
 * The driver waits on `reviewRigReady`, set after the shell and the page have
 * committed, so it never samples a half-rendered page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type {
  ReviewPrepopulateResult,
  ReviewRecord,
  ReviewSkill,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { periodTitle } from "@lifequest/vault-core/pure";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import ReviewPage from "@/pages/ReviewPage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

const CADENCE = "weekly";

/** Each period the page asks about, with the file it would find on disk. */
const bodies = new Map<string, string>();
let activePeriod: string | null = null;

function bodyOf(period: string): string {
  let body = bodies.get(period);
  if (body === undefined) {
    body = blocksFor(period).join("\n\n");
    bodies.set(period, body);
  }
  return body;
}

/**
 * The review as a real file holds it, written the way the box writes it: blocks
 * joined by one blank line, with a block of its own that holds nothing between
 * the two Look-back paragraphs — the blank line the operator typed.
 *
 * `## Notes` is here on purpose. It is not one of the four headings the review
 * skeleton plants, so a summary that extracted only those four dropped it, which
 * is how a heading the operator wrote could vanish from their own review.
 *
 * The heading is the period's own title, because the page opens on the CURRENT
 * week: the rig serves whatever period it is asked for rather than pinning a
 * date, so the same run passes on any day the suite happens to run.
 */
function blocksFor(period: string): string[] {
  return [
    `# ${periodTitle("weekly", period, "monday")}`,
    "## Look-back",
    "Two walks, and **one** late night.",
    "",
    "Slept badly, and it showed.",
    "## Keep",
    "## Change",
    "## Next-period intent",
    "## Financial",
    "### Look-back",
    "### Keep",
    "### Change",
    "### Next-period intent",
    "## Notes",
    "A note outside the skeleton.",
  ];
}

/** What the app's snapshot pass writes into the Financial Look-back. */
const SNAPSHOT_MARKER_OPEN = "<!-- lifequest:snapshot:finance-spend -->";
const SNAPSHOT_MARKER_CLOSE = "<!-- /lifequest:snapshot:finance-spend -->";
const SNAPSHOT_BLOCK = [
  SNAPSHOT_MARKER_OPEN,
  ``,
  `**Spending this period** · 2026-10-12 → 2026-10-18`,
  ``,
  `| Category | Total (ZAR) |`,
  `| --- | --- |`,
  `| Groceries | 1,234.56 |`,
  ``,
  SNAPSHOT_MARKER_CLOSE,
].join("\n");

const SKILL_MARKDOWN = [
  `---`,
  `cadence: weekly`,
  `---`,
  `# Weekly review skill`,
  ``,
  `- Keep it to a page.`,
  ``,
  '```lifequest-snapshot',
  `{"id":"finance-spend","domain":"financial","section":"Look-back","window":"period"}`,
  "```",
  ``,
].join("\n");

/** The one place a snapshot block belongs, as a line-indexed insert. */
function writeSnapshot(body: string): string {
  if (body.includes(SNAPSHOT_MARKER_OPEN)) {
    const lines = body.split("\n");
    const open = lines.indexOf(SNAPSHOT_MARKER_OPEN);
    const close = lines.indexOf(SNAPSHOT_MARKER_CLOSE);
    const next = [
      ...lines.slice(0, open),
      ...SNAPSHOT_BLOCK.split("\n"),
      ...lines.slice(close + 1),
    ];
    return next.join("\n");
  }
  const lines = body.split("\n");
  const heading = lines.indexOf("### Look-back");
  if (heading === -1) return body;
  let at = heading + 1;
  while (at < lines.length && lines[at]!.trim() === "") at += 1;
  return [
    ...lines.slice(0, at),
    ...SNAPSHOT_BLOCK.split("\n"),
    "",
    ...lines.slice(at),
  ].join("\n");
}

type ReviewWrite = { cadence: string; period: string; body: string };
type SnapshotCall = { cadence: string; period: string; scope: string };

type HarnessWindow = Window & {
  reviewRigReady?: boolean;
  reviewRigSkin?: string;
  reviewRigGoto?: (path: string) => void;
  reviewRigCalls?: string[];
  reviewRigUnexpectedCalls?: string[];
  reviewRigWrites?: ReviewWrite[];
  reviewRigSnapshotCalls?: SnapshotCall[];
  reviewRigStarts?: { sessionId: string; kickoff: string | null }[];
  /** The turn text the dock sent when Start opened the interview. */
  reviewRigKickoffs?: string[];
  reviewRigSkillWrites?: string[];
  /** Flipped by the driver: makes `reviewStartOrResume` answer "agent down". */
  reviewRigAgentDown?: boolean;
  /** The review body as the file holds it, for the driver to assert against. */
  reviewRigBody?: () => string;
};

const harness = window as HarnessWindow;
harness.reviewRigCalls = [];
harness.reviewRigUnexpectedCalls = [];
harness.reviewRigWrites = [];
harness.reviewRigSnapshotCalls = [];
harness.reviewRigStarts = [];
harness.reviewRigKickoffs = [];
harness.reviewRigSkillWrites = [];
harness.reviewRigAgentDown = false;

let body = "";
let locked = false;
let skillMarkdown: string | null = null;

harness.reviewRigBody = () => (activePeriod ? bodyOf(activePeriod) : body);

function record(period: string): ReviewRecord {
  return {
    cadence: CADENCE,
    period,
    weekStartDay: "monday",
    locked,
    updatedAt: "2026-10-18T00:00:00.000Z",
    title: periodTitle(CADENCE, period, "monday"),
    scopes: {
      overall: { status: "draft", sessionId: null },
      financial: { status: "draft", sessionId: null },
    },
    bodyMarkdown: bodyOf(period),
  };
}

const SESSION = {
  id: "review-rig-session",
  title: "Review · Weekly · Week of 12 Oct 2026",
  preview: "Review rig",
  lastActive: 1_700_000_000,
};

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
  },
  domains: [
    {
      slug: "financial",
      meta: {
        slug: "financial",
        name: "Financial",
        description: null,
        color: null,
        sortOrder: 0,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      documents: {},
    },
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

/** Every bridge method the page is allowed to reach. Anything else is named. */
const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  domainGetActive: () => ok(null),
  domainSetActive: () => ok(null),
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () => ok([]),
  companionModelOptions: () =>
    ok({ providers: [], current: { model: "harness", provider: "harness" } }),
  /**
   * Start opens the interview, which means the dock sends the kickoff turn. This
   * rig is not about the chat: the turn is accepted and recorded, and no stream
   * events are emitted, so the page settles rather than waiting on an agent.
   */
  companionChatStream: (payload: { sessionId: string; input: string }) => {
    harness.reviewRigCalls?.push(`companionChatStream:${payload.sessionId}`);
    harness.reviewRigKickoffs?.push(payload.input);
    return Promise.resolve({ ok: true } as const);
  },
  pinsList: () => ok({ pins: [], locked: false }),
  onCompanionStream: () => () => {},
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
    activePeriod = period;
    return Promise.resolve(ok(record(period)));
  },
  reviewEnsure: (cadence: string, period: string, scope: string) => {
    harness.reviewRigCalls?.push(`reviewEnsure:${cadence}:${period}:${scope}`);
    activePeriod = period;
    return Promise.resolve(ok(record(period)));
  },
  reviewWrite: (cadence: string, period: string, next: string) => {
    harness.reviewRigCalls?.push(`reviewWrite:${cadence}:${period}`);
    harness.reviewRigWrites?.push({ cadence, period, body: next });
    activePeriod = period;
    bodies.set(period, next);
    body = next;
    return Promise.resolve(ok(record(period)));
  },
  reviewPrepopulate: (cadence: string, period: string, scope: string) => {
    harness.reviewRigCalls?.push(`reviewPrepopulate:${cadence}:${period}:${scope}`);
    harness.reviewRigSnapshotCalls?.push({ cadence, period, scope });
    activePeriod = period;
    const next = writeSnapshot(bodyOf(period));
    bodies.set(period, next);
    body = next;
    const value: ReviewPrepopulateResult = {
      cadence: CADENCE,
      period,
      scope,
      outcomes: [
        {
          id: "finance-spend",
          domain: "financial",
          section: "Look-back",
          title: "Spending this period",
          status: "written",
          groups: 2,
        },
      ],
      applied: 1,
      planted: [],
      locked: false,
      bodyMarkdown: next,
    };
    return Promise.resolve(ok(value));
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
    harness.reviewRigStarts?.push({
      sessionId: SESSION.id,
      kickoff: `Let's assemble the Week of 12 Oct 2026.`,
    });
    return Promise.resolve(ok({ sessionId: SESSION.id, created: true, kickoff: `go` }));
  },
  reviewMarkDone: (cadence: string, period: string) => {
    locked = true;
    return Promise.resolve(ok(record(period)));
  },
  reviewUnlock: (cadence: string, period: string) => {
    locked = false;
    return Promise.resolve(ok(record(period)));
  },
  reviewSkillGet: (cadence: string) => {
    harness.reviewRigCalls?.push(`reviewSkillGet:${cadence}`);
    const value: ReviewSkill = {
      cadence: CADENCE,
      markdown: skillMarkdown ?? SKILL_MARKDOWN,
      snapshots: [
        {
          id: "finance-spend",
          domain: "financial",
          section: "Look-back",
          title: "Spending this period",
          window: "period",
          spec: {
            databaseId: "finance:transactions",
            title: "Spending this period",
            presentation: "metric",
            groupBy: null,
            timeBucket: null,
            timeColumnId: "date",
            timeWindow: "all",
            filters: [],
            measure: "sum",
            measureColumnId: "amount",
            per: null,
            sort: { by: "value", dir: "desc" },
            limit: 12,
            convertToZar: true,
            columns: [],
          },
        },
      ],
      problems: [],
      exists: skillMarkdown !== null,
    };
    return Promise.resolve(ok(value));
  },
  reviewSkillWrite: (cadence: string, markdown: string) => {
    harness.reviewRigCalls?.push(`reviewSkillWrite:${cadence}`);
    harness.reviewRigSkillWrites?.push(markdown);
    skillMarkdown = markdown;
    // A rule the page cannot read is reported rather than thrown, exactly as the
    // vault reports it.
    const problems = markdown.includes("lifequest-snapshot")
      ? []
      : ["snapshot 1: not valid JSON (Unexpected end of JSON input)"];
    const value: ReviewSkill = {
      cadence: CADENCE,
      markdown,
      snapshots: [],
      problems,
      exists: true,
    };
    return Promise.resolve(ok(value));
  },
  planningStartOrResume: () =>
    Promise.resolve(ok({ sessionId: SESSION.id, created: false, kickoff: "" })),
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
  if (!rail || !box) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);
