/**
 * E2E harness for the wing eyebrow — driven by `wing-eyebrow.electron.mjs`.
 *
 * The claim under test is the chrome every wing page opens with: a small
 * uppercase eyebrow naming the wing it sits under, a dot, then the page's own
 * name — "Home · Dashboard", "Define · Dream", "Act · Task Manager".
 *
 * This rig mounts the SHIPPING shell and the SHIPPING pages, because the
 * eyebrow is a property of the real page, not of a description of it. The
 * claim has three parts and each can lie, so they are written down first:
 *
 *  1. A page that throws leaves an empty column, and "no eyebrow found" would
 *     then read the same as "the eyebrow says the wrong thing". So every page
 *     must ALSO show its own `<h1>` — the eyebrow is read only where the page
 *     proved it rendered.
 *  2. The eyebrow's text is CSS-uppercased, so `textContent` reads "Home ·
 *     Dashboard" while the operator sees "HOME · DASHBOARD". The rig asserts
 *     the DOM text AND the computed `text-transform`, so the capitals are
 *     checked where they actually happen.
 *  3. Two `h1`s can be on screen (the page's own and the shell's). Every read
 *     is scoped to `[data-page-context-root]`, the one column the shell
 *     declares to be the page.
 *  4. React Router navigates inside a transition, so a route read at render
 *     time runs ahead of the DOM. The harness publishes the route from an
 *     effect, and the driver polls for the route it is waiting for.
 *  5. The bridge has no Electron preload, so anything a page reaches for that
 *     is not named here must not throw — the proxy answers `ok(null)` for the
 *     rest.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import HomePage from "@/pages/HomePage";
import DataPage from "@/pages/DataPage";
import PagesPage from "@/pages/PagesPage";
import DocumentsPage from "@/pages/DocumentsPage";
import PersonnelPage from "@/pages/PersonnelPage";
import ImagesPage from "@/pages/ImagesPage";
import DreamPage from "@/pages/DreamPage";
import VisionPage from "@/pages/VisionPage";
import IdealStatePage from "@/pages/IdealStatePage";
import GoalsPage from "@/pages/GoalsPage";
import ChartPage from "@/pages/ChartPage";
import ArchitecturePage from "@/pages/ArchitecturePage";
import ProjectsPage from "@/pages/ProjectsPage";
import DailySchedulePage from "@/pages/DailySchedulePage";
import ActPage from "@/pages/ActPage";
import ReviewPage from "@/pages/ReviewPage";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** Two live domains, so a page that showed only one would still look right. */
const DOMAINS = [
  {
    slug: "health",
    meta: {
      slug: "health",
      name: "Health",
      description: null,
      color: null,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    documents: {},
  },
  {
    slug: "financial",
    meta: {
      slug: "financial",
      name: "Financial",
      description: null,
      color: null,
      sortOrder: 1,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    documents: {},
  },
];

/**
 * The map's own state — the Life Map and Architecture pages read their years
 * from it, and the map year provider reaches for `map.years` on every render.
 * One live year is enough for both pages to draw their chrome.
 */
const MAP_STATE = {
  dayTypes: [],
  // The default week: one day-type slot per weekday, and the weekly checklist
  // that rides with it. The Architecture page reads both by index, so the
  // shapes are the real ones and not empty stand-ins.
  defaultWeek: { dayTypeByWeekday: [null, null, null, null, null, null, null], weeklyItems: [] },
  years: [
    {
      year: 2026,
      status: "live",
      events: [],
      months: [],
      detachedWeeks: {},
    },
  ],
  tasks: [],
  liveDays: {},
  aboutMe: "",
};

const SNAPSHOT = {
  rootPath: "C:/wing-eyebrow-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "wing-eyebrow-vault",
    name: "Wing Eyebrow Vault",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark" as const,
    weekStartDay: "monday" as const,
  },
  domains: DOMAINS,
  agents: [],
  decisions: [],
  log: [],
  map: MAP_STATE,
  mapError: null,
  goals: [],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

const SESSION = {
  id: "wing-eyebrow-session",
  title: "Wing eyebrow harness",
  preview: "Wing eyebrow harness",
  lastActive: 1_700_000_000,
};

/** Any page that threw: the stub lied, or a render failed. */
const errors: string[] = [];

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    ok([{ role: "user" as const, content: "Wing eyebrow harness" }]),
  onCompanionStream: () => () => {},
  documentGet: () => Promise.resolve({ ok: false as const, error: "NOT_FOUND" }),
  libraryList: () => ok({ records: [], skipped: 0 }),
  imagesList: () => ok([]),
  // The vision board's own shape: the blocks it is drawn from.
  imagesBoardGet: () => ok({ blocks: [] }),
  idealStateList: () => ok([]),
  // The board's own shape: the pins that are on it, and whether it is locked.
  pinsList: () => ok({ pins: [], locked: false }),
  viewList: () => ok([]),
  pageList: () => ok([]),
  dbList: () => ok([]),
  // The projects board's own shape: the records, not a bare list.
  projectsList: () => ok({ records: [] }),
  logList: () => ok([]),
  decisionList: () => ok([]),
  kitList: () => ok([]),
  // The Agents page reads both rosters and filters one of them, so an empty
  // list — not a null — is what the page expects.
  agentsList: () => ok([]),
  connectedAgentsList: () => ok([]),
  connectedAgentsListInvites: () => ok([]),
  hermesScanAgents: () => ok([]),
  kitFinanceSettings: () => ok(null),
  goalsApply: () => ok(null),
  planningStartOrResume: () => ok(null),
  mapApply: () => ok(null),
  // A period nobody has reviewed yet: the page reads this as its empty state,
  // not as a failure, and it matches on the words "not found".
  reviewGet: () =>
    Promise.resolve({ ok: false as const, error: "Review not found" }),
  reviewEnsure: () => ok(null),
  reviewSkillGet: () => ok(null),
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return () => ok(null);
  },
  has: () => true,
});

const harness = window as unknown as {
  lifequest: unknown;
  wingEyebrowRoute?: string;
  wingEyebrowNavigate?: (path: string) => void;
  wingEyebrowErrors?: string[];
  wingEyebrowReady?: Promise<void>;
};
harness.lifequest = stubbed;
harness.wingEyebrowErrors = errors;
window.addEventListener("error", (event) => {
  errors.push(String(event.message));
});
window.addEventListener("unhandledrejection", (event) => {
  errors.push(`unhandled rejection: ${String(event.reason)}`);
});

/**
 * The page the router is on, published for the driver.
 *
 * Written from an effect, not from render: `navigate` runs inside a React
 * transition, so a render-phase write publishes the new pathname *before* the
 * commit that draws it — and a driver that waits on the route would then sample
 * the page it just left.
 */
function RouteProbe() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    harness.wingEyebrowRoute = pathname;
  }, [pathname]);
  // The driver moves between wings, and the rail only carries the ACTIVE
  // wing's rows — so a page outside it has no link to click. The router's own
  // navigate is published for the driver, and it goes through the same code
  // path a click does (React Router's own handler), so the wing table is
  // exercised exactly as it is in the app.
  useEffect(() => {
    harness.wingEyebrowNavigate = (path: string) => navigate(path);
  }, [navigate]);
  return null;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from wing-eyebrow.html");

const entry =
  new URLSearchParams(window.location.search).get("route") ?? "/home";

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[entry]}>
      <RouteProbe />
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="/home" element={<HomePage />} />
                      <Route path="/data" element={<DataPage />} />
                      <Route path="/pages" element={<PagesPage />} />
                      <Route path="/documents" element={<DocumentsPage />} />
                      <Route path="/personnel" element={<PersonnelPage />} />
                      <Route path="/images" element={<ImagesPage />} />
                      <Route path="/dream" element={<DreamPage />} />
                      <Route path="/vision" element={<VisionPage />} />
                      <Route path="/ideal-state" element={<IdealStatePage />} />
                      <Route path="/goals" element={<GoalsPage />} />
                      <Route path="/chart" element={<ChartPage />} />
                      <Route path="/track" element={<ArchitecturePage />} />
                      <Route path="/projects" element={<ProjectsPage />} />
                      <Route path="/daily" element={<DailySchedulePage />} />
                      <Route path="/act" element={<ActPage />} />
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

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the shell never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

/**
 * Ready means the shell AND the entry page committed: a rail that rendered
 * before the router had a page would let the first sample read an empty sheet.
 */
const waitForShell = () => {
  const rail = document.querySelector(".nav-rail");
  const tabs = document.querySelector(".nav-rail__wings");
  const page = document.querySelector("[data-page-context-root] > *");
  if (!rail || !tabs || !page) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

harness.wingEyebrowReady = ready;
