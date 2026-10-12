/**
 * E2E harness for the Define wing — driven by `define-wing.electron.mjs`.
 *
 * The claim under test is a *shape of the app*, so the rig mounts the shipping
 * shell and the shipping pages rather than a description of them: the real
 * `AppShell` (real nav rail, real wing tabs, real `wingForPath`), the real
 * `DreamPage`, `VisionPage`, `DocumentsPage` and `DoctrineEditorPage`.
 *
 * This is a system-in-isolation rig, so the ways it can lie are written down
 * before the assertions:
 *
 *  1. The IPC stub answers a shape the real main process never returns, so a
 *     page throws, React 19 unmounts the tree, and every read comes back `null`.
 *     A driver that only compares lists would then read two absences as equal.
 *     So every stub is a real shape, and the driver asserts each surface's own
 *     marker (a heading, a card title) before it compares anything.
 *  2. React Router navigates inside a transition, so a route read at render time
 *     runs ahead of the DOM: `window.defineWingRoute` is written from an effect,
 *     and still every wait here names the route it is waiting for and polls for
 *     a *change*, never a fixed settle.
 *  3. A click on the already-active wing tab navigates nowhere, so no step
 *     depends on clicking the tab a step already left.
 *  4. The rail has three groups (top-pinned, this wing, bottom-pinned). Reading
 *     "the rail" without scoping to the wing's own section would pass with
 *     Documents sitting in the pinned list, which is not the same claim.
 *  5. Two `h1`s can be on screen (page title and, on the editor route, the
 *     editor's own). Every read is scoped to `[data-page-context-root]` — the
 *     one column the shell declares to be the page.
 *  6. The lens is read from `domainGetActive`, which the stub answers `null`:
 *     Overview lists every live domain, so a page that accidentally showed only
 *     one domain would still look right. The fixture is two live domains and the
 *     driver counts the groups.
 *  7. The bridge has no Electron preload, so anything the shell or the pages
 *     reach for that is not named here must not throw.
 *  8. `MemoryRouter` never touches the window URL, so a deep link cannot be
 *     exercised by typing a hash. The harness takes its entry from `?route=`, and
 *     the driver reloads the page to run the cold-load cases.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { DoctrineEditorPage } from "@/components/doctrine/DoctrineEditorPage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import DreamPage from "@/pages/DreamPage";
import VisionPage from "@/pages/VisionPage";
import DocumentsPage from "@/pages/DocumentsPage";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const KINDS = ["premise", "what", "why", "how"] as const;
type Kind = (typeof KINDS)[number];

/** The bodies the fixture hangs on each document, one per kind and domain. */
const BODIES: Record<Kind, string> = {
  premise: "I believe health compounds.",
  what: "A calm, strong body at 60.",
  why: "So the work I do outlives me.",
  how: "Three sessions a week, no exceptions.",
};

function documentFor(slug: string, kind: Kind, index: number) {
  return {
    kind,
    title: `${slug} — ${kind}`,
    locked: false,
    updatedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    bodyMarkdown: `${BODIES[kind]} (${slug})`,
    mtimeMs: 1_700_000_000_000 + index,
  };
}

type Docs = Record<string, ReturnType<typeof documentFor>>;

const healthDocs: Docs = Object.fromEntries(
  KINDS.map((kind, index) => [kind, documentFor("health", kind, index)]),
);
/** Financial carries no doctrine at all: the pages' own empty state. */
const financialDocs: Docs = {};

/** Two live domains, so a page that dropped one from its list would fail. */
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
    documents: healthDocs,
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
    documents: financialDocs,
  },
];

const SNAPSHOT = {
  rootPath: "C:/define-wing-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "define-wing-vault",
    name: "Define Wing Vault",
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
  map: null,
  mapError: null,
  goals: [],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

const SESSION = {
  id: "define-wing-session",
  title: "Define wing",
  preview: "Define wing harness",
  lastActive: 1_700_000_000,
};

/** Every `documentGet` the pages ask for, in order — the editor's own read. */
const calls: string[] = [];
/** Anything the page logged as an error: a stub that lied, or a thrown render. */
const errors: string[] = [];

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    ok([{ role: "user" as const, content: "Define wing harness" }]),
  onCompanionStream: () => () => {},
  documentGet: (slug: string, kind: Kind) => {
    calls.push(`${slug}:${kind}`);
    const domain = DOMAINS.find((d) => d.slug === slug);
    const doc = domain?.documents[kind];
    return doc
      ? ok(doc)
      : Promise.resolve({ ok: false as const, error: "NOT_FOUND" });
  },
  libraryList: () => ok({ records: [], skipped: 0 }),
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
  defineWingRoute?: string;
  defineWingCalls?: string[];
  defineWingErrors?: string[];
  defineWingReady?: Promise<void>;
};
harness.lifequest = stubbed;
harness.defineWingCalls = calls;
harness.defineWingErrors = errors;
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
  useEffect(() => {
    harness.defineWingRoute = pathname;
  }, [pathname]);
  return null;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from define-wing.html");

// A cold-load case (a deep link) is how the driver exercises `wingForPath`: the
// entry rides the query string because `MemoryRouter` owns the URL in here.
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
                      <Route
                        path="/home"
                        element={
                          <div className="stub-page">
                            <h1 className="stub-page__title">Dashboard</h1>
                          </div>
                        }
                      />
                      <Route path="/dream" element={<DreamPage />} />
                      <Route
                        path="/dream/:slug/:kind"
                        element={<DoctrineEditorPage backTo="/dream" />}
                      />
                      <Route path="/vision" element={<VisionPage />} />
                      <Route
                        path="/vision/:slug/:kind"
                        element={<DoctrineEditorPage backTo="/vision" />}
                      />
                      <Route path="/documents" element={<DocumentsPage />} />
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
  const tabs = document.querySelector(".top-bar__wings");
  const page = document.querySelector("[data-page-context-root] > *");
  if (!rail || !tabs || !page) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

harness.defineWingReady = ready;
