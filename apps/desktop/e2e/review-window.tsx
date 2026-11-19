/**
 * E2E harness for the review opening windows, driven by
 * `review-window.electron.mjs`.
 *
 * The real shell, the real Review page and the real Settings sheet render here,
 * so what the driver reads is what the operator gets. Only the IPC bridge is
 * stubbed, and it is a *recording* stub: every method these surfaces call is
 * modelled and anything else answers `{ ok: false }` and is NAMED in
 * `reviewWindowRig.unexpectedCalls`, so a page that grows a dependency this rig
 * does not model fails the run loudly.
 *
 * ── The clock is the query string ───────────────────────────────────────────
 *
 * A review opens at a wall-clock minute, so a rig that ran at the suite's own
 * hour could only test one of the ten boundary scenarios per day. The driver
 * pins the instant through the URL (`?now=2026-11-15T17:59:00`, read as LOCAL
 * time like the page's own period math), and this file replaces `globalThis.Date`
 * with a `FixedDate` subclass BEFORE React mounts: the zero-argument constructor
 * and `now()` answer that instant, while `new Date(y, m, d, h, m)` still builds
 * the real Date the engine asks for (reviewOpensAt constructs its opening
 * instant exactly that way). Every period computation the page makes therefore
 * sees the pinned minute, and nothing else in the page has to know.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The page opens on the calendar's period instead of the latest OPEN period:
 *     before 18:00 it shows today's review, which the engine will refuse to
 *     write, and the operator types into a page that cannot save.
 *  2. The note that explains why is missing, names the wrong cadence, or dates
 *     the opening instant by the wrong day/time — the operator is left to guess
 *     when their review appears.
 *  3. Next stays enabled at the open period, so the pager walks into a period
 *     whose window has not opened. (Prev must stay reachable: the previous
 *     period is still the operator's to write.)
 *  4. The window shown is the shipped default rather than the vault's setting:
 *     a vault that opens daily at 20:00 still shows today's review at 19:00.
 *  5. The Settings review tab draws five rows that do not match the defaults,
 *     or a Save sends a partial patch (the engine replaces the whole field, so a
 *     partial write would silently reset the other four cadences).
 *  6. A Save does not send the WHOLE `reviewAvailability` object, or Restore
 *     defaults does not put the five rows back.
 *  7. A bridge call this rig does not model, or a console error, passes
 *     unnoticed.
 *  8. The header says the cadence twice: the eyebrow is the cadence and the
 *     period is the page's one heading, with the calendar key beside it and the
 *     two wordless arrow steps — on every cadence, not just weekly.
 *
 * The driver waits on `window.reviewWindowRigReady`, set after the shell and the
 * requested surface (review page or settings sheet) have committed, so it never
 * samples a half-rendered page.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type {
  ReviewPrepopulateResult,
  ReviewRecord,
  ReviewSkill,
  VaultSettings,
  VaultSnapshot,
} from "@lifequest/vault-core";
import {
  DEFAULT_REVIEW_AVAILABILITY,
  isReviewCadence,
  periodTitle,
  reviewAvailabilityFromUnknown,
  type ReviewAvailability,
  type ReviewCadence,
} from "@lifequest/vault-core/pure";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { useSettingsBackground } from "@/components/settings/useSettingsBackground";
import ReviewPage from "@/pages/ReviewPage";
import SettingsPage from "@/pages/SettingsPage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

// ── the pinned clock, installed before anything renders ─────────────────────
const params = new URLSearchParams(window.location.search);
const nowParam = params.get("now");

/** The local instant the whole page will see, or the real clock when unpinned. */
const pinned = nowParam ? new Date(nowParam) : new Date();
if (Number.isNaN(pinned.getTime())) {
  throw new Error(`review-window harness: ?now is not a date: ${String(nowParam)}`);
}
const REAL_DATE = Date;
class FixedDate extends REAL_DATE {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(pinned.getTime());
      return;
    }
    // Any other shape is the caller building a specific Date (the engine's
    // `new Date(y, m, d, h, min)`); it must behave exactly as the real one.
    // eslint-disable-next-line prefer-spread
    super(...(args as [number]));
  }

  static now(): number {
    return pinned.getTime();
  }
}
globalThis.Date = FixedDate as unknown as DateConstructor;

// ── the scenario, read from the query string ────────────────────────────────
const cadenceParam = params.get("cadence") ?? "daily";
const cadence: ReviewCadence = isReviewCadence(cadenceParam)
  ? (cadenceParam as ReviewCadence)
  : "daily";
const view: "review" | "settings" =
  params.get("view") === "settings" ? "settings" : "review";
const weekStartDay = params.get("weekStartDay") === "sunday" ? "sunday" : "monday";

/** The seeded `settings.reviewAvailability`, normalized like the vault would. */
function availabilityFromParam(): ReviewAvailability {
  const raw = params.get("availability");
  if (!raw) return DEFAULT_REVIEW_AVAILABILITY;
  try {
    return reviewAvailabilityFromUnknown(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_REVIEW_AVAILABILITY;
  }
}
const availability = availabilityFromParam();

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

/** The settings the stub vault holds; a successful write replaces the field. */
let currentSettings: VaultSettings = {
  hermesBaseUrl: "http://127.0.0.1:1",
  theme: "dark",
  weekStartDay,
  autoApproveInserts: [],
  chatQuestions: [],
  decisionInbox: { autoOpen: true, autoClose: true },
  agentScopes: [],
  reviewAvailability: availability,
};

/** Each period the page asks about, with the file it would find on disk. */
const bodies = new Map<string, string>();

function bodyOf(period: string): string {
  let body = bodies.get(period);
  if (body === undefined) {
    body = [
      `# ${periodTitle(cadence, period, weekStartDay)}`,
      "## Look-back",
      "A period worth writing down.",
      "## Keep",
      "## Change",
      "## Next-period intent",
    ].join("\n\n");
    bodies.set(period, body);
  }
  return body;
}

function record(period: string, locked = false): ReviewRecord {
  const title = periodTitle(cadence, period, weekStartDay);
  return {
    cadence,
    period,
    weekStartDay,
    locked,
    updatedAt: "2026-11-15T00:00:00.000Z",
    title,
    scopes: { overall: { status: "draft", sessionId: null } },
    bodyMarkdown: bodyOf(period),
  };
}

function snapshot(): VaultSnapshot {
  return {
    rootPath: "C:\\harness\\vault",
    lifequest: {
      schemaVersion: 1,
      id: "review-window-rig",
      name: "Review Window Rig",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    settings: currentSettings,
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
  } as unknown as VaultSnapshot;
}

const SESSION = {
  id: "review-window-rig-session",
  title: `Review · ${cadence} · harness`,
  preview: "Review window rig",
  lastActive: 1_700_000_000,
};

type ReviewWrite = { cadence: string; period: string; body: string };

type HarnessWindow = Window & {
  reviewWindowRigReady?: boolean;
  reviewWindowRigView?: string;
  reviewWindowRigNow?: string;
  reviewWindowRig?: {
    calls: string[];
    unexpectedCalls: string[];
    writes: ReviewWrite[];
    settingsUpdates: Record<string, unknown>[];
  };
};

const harness = window as HarnessWindow;
harness.reviewWindowRig = {
  calls: [],
  unexpectedCalls: [],
  writes: [],
  settingsUpdates: [],
};
harness.reviewWindowRigView = view;
harness.reviewWindowRigNow = pinned.toISOString();
(window as unknown as { reviewWindowRigSkin?: string }).reviewWindowRigSkin =
  skinName;

const rig = () => harness.reviewWindowRig!;

/** Every bridge method these two surfaces are allowed to reach. */
const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(snapshot()),
  vaultListRecent: () => Promise.resolve([]),
  vaultOpen: () => ok(snapshot()),
  onVaultFileChanged: () => () => {},
  // The Review page is this rig's subject and subscribes to the vault's change
  // signal. This rig is about WHEN a review may be written, not about live
  // updates (that is `e2e/review.tsx`), so the channel is a quiet watcher here.
  onVaultDataChanged: () => () => {},
  domainGetActive: () => ok(null),
  domainSetActive: () => ok(null),
  dialogOpenDirectory: () => Promise.resolve(null),
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
  companionChatStream: (payload: { sessionId: string }) => {
    rig().calls.push(`companionChatStream:${payload.sessionId}`);
    return Promise.resolve({ ok: true } as const);
  },
  pinsList: () => ok({ pins: [], locked: false }),
  // The shell's pending-decisions badge reads the inbox on mount.
  decisionList: () => ok([]),
  onCompanionStream: () => () => {},
  // The theme store reads the profile's themes directory on mount and watches
  // it. This rig is not about themes, so the list is empty and the watcher is a
  // no-op — but both must be modelled: the proxy's catch-all answers with a
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
  /**
   * The one write the Settings review tab makes. The stub vault replaces the
   * whole `reviewAvailability` field exactly as the engine does, so the second
   * read of the page shows what was saved rather than the stub's old value.
   */
  settingsUpdate: (patch: Partial<VaultSettings>) => {
    rig().calls.push("settingsUpdate");
    rig().settingsUpdates.push(patch as Record<string, unknown>);
    currentSettings = { ...currentSettings, ...patch };
    return Promise.resolve(ok(currentSettings));
  },

  reviewGet: (_cadence: string, period: string) => {
    rig().calls.push(`reviewGet:${cadence}:${period}`);
    return Promise.resolve(ok(record(period)));
  },
  reviewEnsure: (_cadence: string, period: string) => {
    rig().calls.push(`reviewEnsure:${cadence}:${period}`);
    return Promise.resolve(ok(record(period)));
  },
  reviewWrite: (_cadence: string, period: string, next: string) => {
    rig().calls.push(`reviewWrite:${cadence}:${period}`);
    rig().writes.push({ cadence, period, body: next });
    bodies.set(period, next);
    return Promise.resolve(ok(record(period)));
  },
  reviewPrepopulate: (_cadence: string, period: string, scope: string) => {
    rig().calls.push(`reviewPrepopulate:${cadence}:${period}:${scope}`);
    const value: ReviewPrepopulateResult = {
      cadence,
      period,
      scope,
      outcomes: [],
      applied: 0,
      planted: [],
      locked: false,
      bodyMarkdown: bodyOf(period),
    };
    return Promise.resolve(ok(value));
  },
  reviewStartOrResume: (_cadence: string, period: string) => {
    rig().calls.push(`reviewStartOrResume:${cadence}:${period}`);
    return Promise.resolve(ok({ sessionId: SESSION.id, created: true, kickoff: "go" }));
  },
  reviewMarkDone: (_cadence: string, period: string) => {
    rig().calls.push(`reviewMarkDone:${cadence}:${period}`);
    return Promise.resolve(ok(record(period, true)));
  },
  reviewUnlock: (_cadence: string, period: string) => {
    rig().calls.push(`reviewUnlock:${cadence}:${period}`);
    return Promise.resolve(ok(record(period, false)));
  },
  reviewSkillGet: () => {
    rig().calls.push("reviewSkillGet");
    const value: ReviewSkill = {
      cadence,
      markdown: `# ${cadence} review skill\n`,
      snapshots: [],
      problems: [],
      exists: false,
    };
    return Promise.resolve(ok(value));
  },
  reviewSkillWrite: (_cadence: string, markdown: string) => {
    rig().calls.push("reviewSkillWrite");
    const value: ReviewSkill = {
      cadence,
      markdown,
      snapshots: [],
      problems: [],
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
      rig().unexpectedCalls.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

// ── the app, over the stub ──────────────────────────────────────────────────
const root = document.getElementById("root");
if (!root) throw new Error("#root missing from review-window.html");

function Harness() {
  const location = useLocation();
  const navigate = useNavigate();
  const { background, sheet, sheetOverBackground } = useSettingsBackground();

  // A cold start cannot open a sheet over a page it never mounted, so the rig
  // lands on the Review page first and then opens Settings from the app, which is
  // how an operator reaches it. The blob persists behind the sheet, so the
  // screenshot shows the shipped surface over the page it was opened from.
  useEffect(() => {
    if (view === "settings" && !sheet) {
      navigate("/settings?tab=review");
    }
  }, [navigate, sheet]);

  useEffect(() => {
    document.body.dataset.rigPath = `${location.pathname}${location.search}`;
  }, [location]);

  return (
    <div className="app-root">
      <WindowTitleBar />
      <div className="app-root__body">
        <Routes location={background}>
          <Route element={<AppShell />}>
            <Route path="/review/:cadence" element={<ReviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </div>
      {sheetOverBackground && sheet === "settings" ? <SettingsPage /> : null}
    </div>
  );
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[`/review/${cadence}`]}>
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <Harness />
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The driver waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the surface never painted".
const Painted = () =>
  view === "settings"
    ? // The rows paint as soon as the sheet does, before the vault's settings have
      // arrived; the review page behind it only exists once the snapshot is in, so
      // waiting for both pins the sample to the vault's real values.
      document.querySelector('[data-testid="settings-review-days-daily"]') &&
      document.querySelector(".review-page")
    : // The period label paints before the record arrives; the document beside it
      // is what proves the page has settled on the pinned period.
      document.querySelector('[data-testid="review-period"]') &&
      document.querySelector(".note-live");

const waitForPaint = () => {
  if (!Painted()) {
    requestAnimationFrame(waitForPaint);
    return;
  }
  Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        harness.reviewWindowRigReady = true;
      }),
    );
  });
};
requestAnimationFrame(waitForPaint);
