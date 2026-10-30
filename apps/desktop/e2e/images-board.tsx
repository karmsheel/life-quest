/**
 * E2E harness for Define → Images and the Vision board — driven by
 * `images-board.electron.mjs`.
 *
 * The real shell, the real rail, the real Images page, the real Vision page and
 * the real stylesheet render here; only the IPC bridge is stubbed, and it is a
 * *recording* stub:
 * every method the page calls is listed, and anything else answers a refusal and
 * is NAMED in `imagesBoardUnexpectedCalls`, so a page that grows a dependency
 * this rig does not model fails the run loudly instead of rendering an empty
 * sheet.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The Define rail entry is missing, misnamed, or points somewhere other
 *     than `/images`, so the operator cannot find the page; or the board is
 *     still on Images instead of under the Vision page, where the operator
 *     asked for it.
 *  2. The bridge stub stores the bytes it was handed but the page never draws
 *     them: a blob URL that is never made, or an `<img>` that never decodes.
 *  3. The stub does not model a write. An upload would report success and the
 *     library would stay empty; a board save would return the blocks it was
 *     given but never keep them, and "autosave works" would be asserted against
 *     the harness's own lie. Every write mutates the store the reads answer from.
 *  4. A wait resolves against a state that was already true. Every wait is a
 *     predicate chosen to become true only after the action.
 *  5. A hidden Electron window suspends rAF and throttles timers: the driver
 *     appends `disable-backgrounding-occluded-windows` and the window runs with
 *     `backgroundThrottling: false`, so a debounce really is 700 ms.
 *  6. React 19 unmounts the tree when a component throws; readiness would still
 *     resolve and every measurement read null. The driver records console
 *     errors for exactly this.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { VaultImage, VisionBoardBlock } from "@lifequest/vault-core";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import ImagesPage from "@/pages/ImagesPage";
import VisionPage from "@/pages/VisionPage";
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

type WriteCall =
  | { op: "save"; id: string; name: string; mime: string; bytes: number }
  | { op: "update"; id: string; caption: string | null; name: string | null }
  | { op: "delete"; id: string }
  | { op: "board"; blocks: number; kinds: string[] };

type HarnessWindow = Window & {
  imagesBoardReady?: boolean;
  imagesBoardSkin?: string;
  imagesBoardRoute?: string;
  imagesBoardCalls?: string[];
  imagesBoardUnexpectedCalls?: string[];
  imagesBoardWrites?: WriteCall[];
  imagesBoardFailNextWrite?: boolean;
  imagesBoardSnapshot?: () => {
    images: VaultImage[];
    blocks: VisionBoardBlock[];
    bytes: Record<string, number>;
  };
};

const harness = window as HarnessWindow;
harness.imagesBoardCalls = [];
harness.imagesBoardUnexpectedCalls = [];
harness.imagesBoardWrites = [];
harness.imagesBoardFailNextWrite = false;

/** The ids the stub mints. Shaped like the vault's uuids, so the page's block
 *  ids and image ids are the ones the real vault would validate. */
const UUID = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
let nextImage = 1;

const images = new Map<string, VaultImage>();
const bytesByRelPath = new Map<string, Uint8Array>();
const mimeByRelPath = new Map<string, string>();
let board: VisionBoardBlock[] = [];

function snapshot() {
  return {
    images: [...images.values()],
    blocks: board.map((block) => ({ ...block })),
    bytes: Object.fromEntries(bytesByRelPath),
  };
}
harness.imagesBoardSnapshot = snapshot;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Images rig",
  lastActive: 1_700_000_000,
};

const SNAPSHOT = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "images-vault",
    name: "Images Rig",
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
      slug: "health",
      meta: {
        name: "Health",
        description: null,
        color: null,
        sortOrder: 0,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      documents: {
        what: {
          kind: "what",
          title: "Vision & Desire",
          bodyMarkdown: "A body that carries me through the years.",
          locked: false,
          updatedAt: "2026-09-30T09:00:00.000Z",
        },
      },
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
  decisionList: () => ok([]),
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

  imagesList: () => {
    harness.imagesBoardCalls?.push("imagesList");
    return Promise.resolve(ok([...images.values()]));
  },

  imagesSave: (input: {
    bytes: Uint8Array;
    mime: string;
    name: string;
    width?: number | null;
    height?: number | null;
  }) => {
    harness.imagesBoardCalls?.push(`imagesSave:${input.name}`);
    const id = UUID(nextImage++);
    const mime = input.mime in EXT ? input.mime : "image/png";
    const ext = EXT[mime] ?? "png";
    const relPath = `images/files/${id}.${ext}`;
    const image: VaultImage = {
      id,
      relPath,
      name: input.name,
      caption: "",
      mime: mime as VaultImage["mime"],
      bytes: input.bytes.byteLength,
      width: input.width ?? null,
      height: input.height ?? null,
      createdAt: new Date().toISOString(),
    };
    images.set(id, image);
    bytesByRelPath.set(relPath, input.bytes);
    mimeByRelPath.set(relPath, mime);
    harness.imagesBoardWrites?.push({
      op: "save",
      id,
      name: image.name,
      mime,
      bytes: image.bytes,
    });
    return Promise.resolve(ok({ ...image }));
  },

  imagesRead: (relPath: string) => {
    harness.imagesBoardCalls?.push(`imagesRead:${relPath}`);
    const bytes = bytesByRelPath.get(relPath);
    if (!bytes) return Promise.resolve(fail("That image is missing from the vault."));
    return Promise.resolve(
      ok({ bytes, mime: mimeByRelPath.get(relPath) ?? "image/png" }),
    );
  },

  imagesUpdate: (id: string, patch: { name?: string; caption?: string }) => {
    harness.imagesBoardCalls?.push(`imagesUpdate:${id}`);
    const existing = images.get(id);
    if (!existing) return Promise.resolve(fail("Image not found"));
    const next: VaultImage = {
      ...existing,
      name: patch.name === undefined ? existing.name : patch.name,
      caption: patch.caption === undefined ? existing.caption : patch.caption,
    };
    images.set(id, next);
    harness.imagesBoardWrites?.push({
      op: "update",
      id,
      caption: patch.caption ?? null,
      name: patch.name ?? null,
    });
    return Promise.resolve(ok({ ...next }));
  },

  imagesDelete: (id: string) => {
    harness.imagesBoardCalls?.push(`imagesDelete:${id}`);
    const existing = images.get(id);
    if (!existing) return Promise.resolve(fail("Image not found"));
    images.delete(id);
    bytesByRelPath.delete(existing.relPath);
    mimeByRelPath.delete(existing.relPath);
    harness.imagesBoardWrites?.push({ op: "delete", id });
    return Promise.resolve(ok({ id }));
  },

  imagesBoardGet: () => {
    harness.imagesBoardCalls?.push("imagesBoardGet");
    return Promise.resolve(
      ok({ blocks: board.map((block) => ({ ...block })), updatedAt: new Date().toISOString() }),
    );
  },

  imagesBoardSave: (input: { blocks: VisionBoardBlock[] }) => {
    harness.imagesBoardCalls?.push(`imagesBoardSave:${input.blocks.length}`);
    if (harness.imagesBoardFailNextWrite) {
      harness.imagesBoardFailNextWrite = false;
      return Promise.resolve(fail("The vault refused the write"));
    }
    board = input.blocks.map((block) => ({ ...block }));
    harness.imagesBoardWrites?.push({
      op: "board",
      blocks: board.length,
      kinds: board.map((block) => block.kind),
    });
    return Promise.resolve(
      ok({ blocks: board.map((block) => ({ ...block })), updatedAt: new Date().toISOString() }),
    );
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      const name = String(prop);
      harness.imagesBoardUnexpectedCalls?.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from images-board.html");

function RouteProbe() {
  const { pathname } = useLocation();
  // Written from an effect, not from render: `navigate` runs in a transition, and
  // a render-phase write would publish the new path before the page commits.
  useEffect(() => {
    harness.imagesBoardRoute = pathname;
  }, [pathname]);
  return null;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/images"]}>
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
                      <Route path="/images" element={<ImagesPage />} />
                      <Route path="/vision" element={<VisionPage />} />
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
  const page = document.querySelector(".images-studio");
  const library = document.querySelector('[data-testid="images-library"]');
  // The library's own first read has landed: the Images page is the library and
  // nothing else now, so its settled state is the empty card or the grid — not a
  // vision board (that lives on the Vision page).
  const settled =
    document.querySelector('[data-testid="images-empty"]') ||
    document.querySelector('[data-testid="images-grid"]');
  if (!rail || !page || !library || !settled) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

harness.imagesBoardReady = false;
void ready.then(() => {
  harness.imagesBoardReady = true;
});
harness.imagesBoardSkin = skinName;
