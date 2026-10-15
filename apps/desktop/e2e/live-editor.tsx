/**
 * E2E harness for the shared note box on the two surfaces that are not the Daily
 * Note: the doctrine document editor (`DocumentEditor`, reached through the real
 * `DoctrineEditorPage` route) and the Review page's own editor. Driven by
 * `live-editor.electron.mjs`.
 *
 * The real shell, the real pages and the real stylesheet render here; the pages
 * are the shipping ones, so what the driver reads is what the operator gets. Only
 * the IPC bridge is stubbed, and it is a *recording* stub: every method a page
 * calls is modelled, and anything else answers `{ ok: false }` and is NAMED in
 * `liveEditorUnexpectedCalls`, so a page that grows a dependency this rig does
 * not model fails the run loudly.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The box is not one box: a split grid or a preview pane is still drawn
 *     beside it, so the operator reads and writes in two places that can drift.
 *  2. The document does not read as prose — the file's own markdown is painted
 *     in the box — or it renders *all* of it, so opening one paragraph opens
 *     every paragraph and the file's blank lines disappear.
 *  3. Save sends something other than what the box holds: the draft the operator
 *     typed, blank line and all, is not what reaches `documentSave`.
 *  4. A locked document still offers a writing line, or a click still opens one,
 *     so a locked file can be edited in the UI even though the engine refuses.
 *  5. A pasted image is not saved (`documentMediaSave` never called), or the
 *     markdown for it never reaches the note, so the image is lost.
 *  6. The review editor is a different widget from the document editor, so the
 *     two surfaces the operator was told are one box are two.
 *  7. A bridge call this rig does not model, or a console error, passes
 *     unnoticed.
 *
 * The driver waits on `liveEditorReady`, set after the shell and the entry page
 * have committed, so it never samples a half-rendered page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type {
  DoctrineDocument,
  ReviewRecord,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { DoctrineEditorPage } from "@/components/doctrine/DoctrineEditorPage";
import ReviewPage from "@/pages/ReviewPage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin: this rig judges the page the operator sees.
const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

/** The document's body: two paragraphs, one of them carrying markdown. */
const BODY = "A calm, strong body at 60.\n\n**Three sessions** a week, no exceptions.";
const LOCKED_BODY = "Locked: the operator reads this and cannot write it.";
/** The review's body, as the file holds it below its frontmatter. */
const REVIEW_BODY = "# Week of 12 Oct 2026\n\n## Health\n\nTwo walks, and **one** late night.";

type SaveCall = { slug: string; kind: string; body: string; title?: string };
type MediaCall = { slug: string; mime: string; bytes: number };
type ReviewWrite = { cadence: string; period: string; body: string };

type HarnessWindow = Window & {
  liveEditorReady?: boolean;
  liveEditorSkin?: string;
  liveEditorGoto?: (path: string) => void;
  liveEditorCalls?: string[];
  liveEditorUnexpectedCalls?: string[];
  liveEditorSaves?: SaveCall[];
  liveEditorMedia?: MediaCall[];
  liveEditorReviewWrites?: ReviewWrite[];
  /** When true, the doctrine document is locked: the box must go read-only. */
  liveEditorLocked?: boolean;
  liveEditorDocument?: () => DoctrineDocument;
};

const harness = window as HarnessWindow;
harness.liveEditorCalls = [];
harness.liveEditorUnexpectedCalls = [];
harness.liveEditorSaves = [];
harness.liveEditorMedia = [];
harness.liveEditorReviewWrites = [];
harness.liveEditorLocked = false;

let body = BODY;

harness.liveEditorDocument = (): DoctrineDocument => ({
  kind: "what",
  title: "Vision & Desire · Health",
  locked: harness.liveEditorLocked === true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  bodyMarkdown: harness.liveEditorLocked ? LOCKED_BODY : body,
  mtimeMs: 1_700_000_000_000,
});

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "live-editor-vault",
    name: "Live Editor Rig",
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

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Live editor rig",
  lastActive: 1_700_000_000,
};

let reviewRecord: ReviewRecord | null = {
  cadence: "weekly",
  period: "2026-10-12",
  weekStartDay: "monday",
  locked: false,
  updatedAt: "2026-10-18T00:00:00.000Z",
  title: "Week of 12 Oct 2026",
  scopes: { overall: { status: "draft", sessionId: null } },
  bodyMarkdown: REVIEW_BODY,
};

/** Every bridge method the pages are allowed to reach. Anything else is named. */
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

  documentGet: (slug: string, kind: string) => {
    harness.liveEditorCalls?.push(`documentGet:${slug}:${kind}`);
    return Promise.resolve(ok(harness.liveEditorDocument?.()));
  },
  documentSave: (slug: string, kind: string, next: string, title?: string) => {
    harness.liveEditorCalls?.push(`documentSave:${slug}:${kind}`);
    harness.liveEditorSaves?.push({ slug, kind, body: next, title });
    body = next;
    return Promise.resolve(ok(harness.liveEditorDocument?.()));
  },
  documentSetLocked: (slug: string, kind: string, locked: boolean) => {
    harness.liveEditorCalls?.push(`documentSetLocked:${slug}:${kind}:${locked}`);
    harness.liveEditorLocked = locked;
    return Promise.resolve(ok(harness.liveEditorDocument?.()));
  },
  documentMediaSave: (slug: string, input: { bytes: Uint8Array; mime: string }) => {
    harness.liveEditorCalls?.push(`documentMediaSave:${slug}`);
    harness.liveEditorMedia?.push({ slug, mime: input.mime, bytes: input.bytes.length });
    return Promise.resolve(ok({ relPath: "media/rig-shot.png" }));
  },
  // The box renders an `img[data-media]` for the pasted image and resolves it
  // through this: one byte is enough to prove the box asked for the right name.
  documentMediaRead: (slug: string, rel: string) => {
    harness.liveEditorCalls?.push(`documentMediaRead:${slug}:${rel}`);
    return Promise.resolve(ok({ bytes: new Uint8Array([1]), mime: "image/png" }));
  },
  libraryList: () => ok({ records: [], skipped: 0 }),

  reviewGet: (cadence: string, period: string) => {
    harness.liveEditorCalls?.push(`reviewGet:${cadence}:${period}`);
    return Promise.resolve(
      reviewRecord ? ok(reviewRecord) : fail("Review file not found"),
    );
  },
  reviewEnsure: (cadence: string, period: string) => {
    harness.liveEditorCalls?.push(`reviewEnsure:${cadence}:${period}`);
    if (!reviewRecord) {
      reviewRecord = {
        cadence: "weekly",
        period,
        weekStartDay: "monday",
        locked: false,
        updatedAt: "2026-10-18T00:00:00.000Z",
        title: "Week of 12 Oct 2026",
        scopes: { overall: { status: "draft", sessionId: null } },
        bodyMarkdown: REVIEW_BODY,
      };
    }
    return Promise.resolve(ok(reviewRecord));
  },
  reviewWrite: (cadence: string, period: string, next: string) => {
    harness.liveEditorCalls?.push(`reviewWrite:${cadence}:${period}`);
    harness.liveEditorReviewWrites?.push({ cadence, period, body: next });
    if (reviewRecord) reviewRecord = { ...reviewRecord, bodyMarkdown: next };
    return Promise.resolve(ok(reviewRecord));
  },
  // The Review page's other controls are not this rig's subject, but they are
  // modelled so that "an unmodelled call" stays a real signal.
  reviewStartOrResume: () =>
    Promise.resolve(ok({ sessionId: SESSION.id, created: false, kickoff: null })),
  reviewMarkDone: () => Promise.resolve(ok(reviewRecord)),
  reviewUnlock: () => Promise.resolve(ok(reviewRecord)),
  planningStartOrResume: () =>
    Promise.resolve(ok({ sessionId: SESSION.id, created: false, kickoff: null })),
  dailyNoteWindow: () => Promise.resolve(ok([])),
  dailyNoteList: () => Promise.resolve(ok([])),
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      const name = String(prop);
      harness.liveEditorUnexpectedCalls?.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from live-editor.html");

/** One rig, two hosts: the document editor and the review editor. */
function RouterControl() {
  const navigate = useNavigate();
  harness.liveEditorGoto = (path: string) => navigate(path);
  return null;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/vision/health/what"]}>
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
                      <Route
                        path="/vision/:slug/:kind"
                        element={<DoctrineEditorPage backTo="/vision" />}
                      />
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

// The driver waits on this rather than on a timer: the editor is only painted
// after the document read resolves, so a slow first Vite transform cannot be
// mistaken for "the page never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
void ready.then(() => {
  harness.liveEditorReady = true;
});
harness.liveEditorSkin = skinName;

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
