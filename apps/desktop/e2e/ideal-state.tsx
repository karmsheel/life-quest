/**
 * E2E harness for Ideal State — driven by `ideal-state.electron.mjs`.
 *
 * The real shell, the real rail, the real page and the real stylesheet render
 * here; only the IPC bridge is stubbed, and it is a *recording* stub: every
 * method the page calls is listed, and anything else answers `{ ok: false }` and
 * is NAMED in `idealStateUnexpectedCalls`, so a page that grows a dependency
 * this rig does not model fails the run loudly instead of rendering an empty
 * editor.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The Define rail entry is missing, misnamed, or points somewhere other
 *     than `/ideal-state`, so the operator cannot find the page.
 *  2. The page lands on nothing: a page with documents must open the newest one,
 *     and a page with none must open an empty draft ready for a title.
 *  3. A new document is written before it has a title, so the library fills with
 *     untitled rows.
 *  4. The title does not reach the file, or a rename creates a second document
 *     instead of editing the one on screen.
 *  5. The body does not autosave, or it autosaves to the document that is no
 *     longer on screen.
 *  6. Creating a document loses the body typed with it, or its title.
 *  7. Selecting a row opens an empty editor rather than that document's own
 *     title and prose.
 *  8. An idle page keeps writing — the failure mode of an autosave.
 *  9. A refused write loses the operator's draft or retries at the vault forever.
 * 10. Delete removes a document without asking, or leaves the page on the file
 *     it just deleted.
 * 11. The page is more than one box, draws a Save control, or a bridge call this
 *     rig does not model slips through.
 *
 * The driver waits on `idealStateReady`, set after the shell and the page have
 * painted, so it never samples a half-rendered page.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { IdealStateDocument, VaultSnapshot } from "@lifequest/vault-core";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import IdealStatePage from "@/pages/IdealStatePage";
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

type WriteCall = {
  op: "create" | "update" | "delete";
  id: string | null;
  title: string | null;
  body: string | null;
  /** The title field at the moment the page asked for the write. */
  shownTitle: string | null;
  /** The row marked current at that moment, if any. */
  shownId: string | null;
};

type HarnessWindow = Window & {
  idealStateReady?: boolean;
  idealStateSkin?: string;
  idealStateStore?: Map<string, IdealStateDocument>;
  idealStateCalls?: string[];
  idealStateUnexpectedCalls?: string[];
  idealStateWrites?: WriteCall[];
  idealStateFailNextWrite?: boolean;
  idealStateThrowNextWrite?: boolean;
  idealStateNextId?: number;
};

const harness = window as HarnessWindow;
harness.idealStateCalls = [];
harness.idealStateUnexpectedCalls = [];
harness.idealStateWrites = [];
harness.idealStateFailNextWrite = false;
harness.idealStateThrowNextWrite = false;
harness.idealStateNextId = 1;

/** The same normalization the vault applies: prose, then exactly one newline. */
function canonical(body: string): string {
  const trimmed = body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
}

const store = new Map<string, IdealStateDocument>();
harness.idealStateStore = store;

function seed(id: string, title: string, body: string, updatedAt: string): void {
  store.set(id, {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    bodyMarkdown: canonical(body),
  });
}

// Two documents with different stamps, so "newest first" is a claim about the
// vault's order rather than about insertion order.
seed(
  "doc-alpha",
  "A calm morning",
  "Wake before the house.\n\nWalk while it is quiet.",
  "2026-10-20T06:00:00.000Z",
);
seed(
  "doc-beta",
  "Work that matters",
  "Build one thing well.",
  "2026-10-19T06:00:00.000Z",
);

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "ideal-state-vault",
    name: "Ideal State Rig",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
  },
  domains: [],
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
  id: "harness-session",
  title: "Harness",
  preview: "Ideal State rig",
  lastActive: 1_700_000_000,
};

function clone(document: IdealStateDocument): IdealStateDocument {
  return { ...document };
}

/** What the page is showing when it asks for a write. */
function shown(): { title: string | null; id: string | null } {
  const title =
    document.querySelector<HTMLInputElement>('[data-testid="ideal-state-title"]')
      ?.value ?? null;
  const current = document.querySelector(
    '.ideal-state__history-row[aria-current="true"]',
  );
  const testId = current?.getAttribute("data-testid") ?? "";
  const id = testId.startsWith("ideal-state-doc-")
    ? testId.slice("ideal-state-doc-".length)
    : null;
  return { title, id };
}

function record(call: Omit<WriteCall, "shownTitle" | "shownId">): void {
  const visible = shown();
  harness.idealStateWrites?.push({
    ...call,
    shownTitle: visible.title,
    shownId: visible.id,
  });
}

function nextId(): string {
  const id = `doc-new-${harness.idealStateNextId ?? 1}`;
  harness.idealStateNextId = (harness.idealStateNextId ?? 1) + 1;
  return id;
}

/** Every bridge method the page and the shell are allowed to reach. */
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

  idealStateList: () => {
    harness.idealStateCalls?.push("idealStateList");
    const rows = [...store.values()]
      .map((document) => ({
        id: document.id,
        title: document.title,
        updatedAt: document.updatedAt,
      }))
      .sort((a, b) => {
        const byUpdated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
        return byUpdated !== 0 ? byUpdated : a.id.localeCompare(b.id);
      });
    return Promise.resolve(ok(rows));
  },
  idealStateGet: (id: string) => {
    harness.idealStateCalls?.push(`idealStateGet:${id}`);
    const document = store.get(id);
    return Promise.resolve(document ? ok(clone(document)) : fail("Ideal state document not found"));
  },
  idealStateCreate: (input: { title: string; bodyMarkdown?: string }) => {
    harness.idealStateCalls?.push("idealStateCreate");
    if (harness.idealStateThrowNextWrite) {
      harness.idealStateThrowNextWrite = false;
      record({ op: "create", id: null, title: input.title, body: input.bodyMarkdown ?? null });
      return Promise.reject(new Error("The bridge dropped the write"));
    }
    if (harness.idealStateFailNextWrite) {
      harness.idealStateFailNextWrite = false;
      record({ op: "create", id: null, title: input.title, body: input.bodyMarkdown ?? null });
      return Promise.resolve(fail("The vault refused the write"));
    }
    const title = input.title.trim();
    if (!title) {
      record({ op: "create", id: null, title: input.title, body: input.bodyMarkdown ?? null });
      return Promise.resolve(fail("A title is required"));
    }
    const id = nextId();
    const stamp = new Date().toISOString();
    const document: IdealStateDocument = {
      id,
      title,
      createdAt: stamp,
      updatedAt: stamp,
      bodyMarkdown: canonical(input.bodyMarkdown ?? ""),
    };
    store.set(id, document);
    record({ op: "create", id, title, body: document.bodyMarkdown });
    return Promise.resolve(ok(clone(document)));
  },
  idealStateUpdate: (
    id: string,
    patch: { title?: string; bodyMarkdown?: string },
  ) => {
    harness.idealStateCalls?.push(`idealStateUpdate:${id}`);
    if (harness.idealStateThrowNextWrite) {
      harness.idealStateThrowNextWrite = false;
      record({
        op: "update",
        id,
        title: patch.title ?? null,
        body: patch.bodyMarkdown ?? null,
      });
      return Promise.reject(new Error("The bridge dropped the write"));
    }
    if (harness.idealStateFailNextWrite) {
      harness.idealStateFailNextWrite = false;
      record({
        op: "update",
        id,
        title: patch.title ?? null,
        body: patch.bodyMarkdown ?? null,
      });
      return Promise.resolve(fail("The vault refused the write"));
    }
    const existing = store.get(id);
    if (!existing) return Promise.resolve(fail("Ideal state document not found"));
    if (patch.title !== undefined && patch.title.trim() === "") {
      record({
        op: "update",
        id,
        title: patch.title,
        body: patch.bodyMarkdown ?? null,
      });
      return Promise.resolve(fail("A title is required"));
    }
    const document: IdealStateDocument = {
      ...existing,
      title: patch.title === undefined ? existing.title : patch.title.trim(),
      updatedAt: new Date().toISOString(),
      bodyMarkdown:
        patch.bodyMarkdown === undefined
          ? existing.bodyMarkdown
          : canonical(patch.bodyMarkdown),
    };
    store.set(id, document);
    record({ op: "update", id, title: document.title, body: document.bodyMarkdown });
    return Promise.resolve(ok(clone(document)));
  },
  idealStateDelete: (id: string) => {
    harness.idealStateCalls?.push(`idealStateDelete:${id}`);
    const existing = store.get(id);
    if (!existing) return Promise.resolve(fail("Ideal state document not found"));
    store.delete(id);
    record({ op: "delete", id, title: existing.title, body: existing.bodyMarkdown });
    return Promise.resolve(ok(clone(existing)));
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      const name = String(prop);
      harness.idealStateUnexpectedCalls?.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from ideal-state.html");

function RouteProbe() {
  const { pathname } = useLocation();
  // Written from an effect, not from render: `navigate` runs in a transition, and
  // a render-phase write would publish the new path before the page commits.
  useEffect(() => {
    (harness as HarnessWindow & { idealStateRoute?: string }).idealStateRoute =
      pathname;
  }, [pathname]);
  return null;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/ideal-state"]}>
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
                      <Route path="/ideal-state" element={<IdealStatePage />} />
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

const waitForPage = () => {
  const rail = document.querySelector(".nav-rail");
  const page = document.querySelector(".ideal-state");
  const title = document.querySelector('[data-testid="ideal-state-title"]');
  const editor = document.querySelector('[data-testid="ideal-state-editor"]');
  if (!rail || !page || !title || !editor) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

harness.idealStateReady = false;
void ready.then(() => {
  harness.idealStateReady = true;
});
harness.idealStateSkin = skinName;
