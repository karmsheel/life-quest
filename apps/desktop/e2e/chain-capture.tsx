/**
 * E2E harness for the Life-Chain page — the general capture surface — driven by
 * `chain-capture.electron.mjs`.
 *
 * The real shell, the real rail, the real `ChainPage`/`SignalChainFeed`, the real
 * stylesheet and the real layout engine render here. Only the IPC bridge is
 * stubbed, and it is a *recording* stub: every method the page calls is listed,
 * unknown calls are NAMED in `chainCaptureUnexpectedCalls`, and every write
 * mutates the store the next read answers from. A page that grows a dependency
 * this rig does not model fails the run loudly instead of painting an empty
 * sheet.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A dropped or picked file never reaches the page as bytes: the pending
 *     thumbnail stays absent, or is painted from a filename rather than decoded
 *     pixels (`naturalWidth === 0`). The drop path dispatches real `DragEvent`s
 *     carrying a real `File` decoded from `fixtures/chain-capture.json`, and the
 *     picker path sets `input.files` the way the OS file dialog does.
 *  2. The capture writes an attachment the page then cannot draw. This bridge
 *     mints the vault-relative path and keeps the bytes it was handed, exactly
 *     as the main process does; `signalChainReadImage` serves those bytes back,
 *     so a row that paints has gone through the same bridge the app would.
 *  3. An image-only capture is refused by a `required` body: the page must allow
 *     an empty body when an attachment says why, and the bridge must be handed
 *     `body: ""` with the attachment (not a placeholder invented by the page).
 *  4. The link path validates in the wrong place: text that is not an absolute
 *     http(s) URL must leave an error and no attachment, and a valid URL must
 *     reach the bridge unchanged. A chip that shows no host cannot tell the
 *     operator what is attached.
 *  5. A write mutates a copy: the harness's `signalChainCreate` stores the
 *     record the next `signalChainList` answers with, so "the row is on the
 *     chain" is the vault's own read, not the harness's echo.
 *  6. A hidden Electron window suspends rAF and throttles timers: the driver
 *     appends `disable-backgrounding-occluded-windows` and the window runs with
 *     `backgroundThrottling: false`, so a decode or a debounce really settles.
 *  7. React 19 unmounts the tree when a component throws; `chainCaptureReady`
 *     would never resolve and the driver reports the page it waited for, rather
 *     than measuring an empty document.
 *  8. The seeded image is only a path in the fixture. Its bytes live beside it
 *     in the fixture too and are handed to the bridge, so a seeded row paints
 *     through `signalChainReadImage` like a captured one — a fixture name that
 *     no reader serves is a missing picture, not a passing one.
 *  9. Triage paints a label the contract does not name. A row whose stored
 *     status/priority/project differs from its chip text, or a select that
 *     writes a patch other than the one it names, is a contract the operator
 *     cannot act on. The fixture's inbox fields are published in
 *     `chainCaptureInbox`, and `signalChainUpdate` records every patch, so the
 *     driver compares what the page painted and wrote against the one contract;
 *     `projectsList` is modelled here because the renderer reads it on mount and
 *     an unmodelled call would name itself in `chainCaptureUnexpectedCalls`.
 * 10. The shell's ThemeProvider reads and subscribes to the profile's theme
 *     directory on mount. Those bridge calls are modelled too: an unmodelled
 *     subscription answers with a refusal Promise, StrictMode's cleanup calls
 *     it as `unsubscribe()`, and the thrown "not a function" unmounts the whole
 *     React tree — a blank page every later check would still "read".
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { VaultSnapshot } from "@lifequest/vault-core/pure";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import ChainPage from "@/pages/ChainPage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";
import fixture from "./fixtures/chain-capture.json";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

type FixtureDomain = { slug: string; name: string; archived?: boolean };
type FixtureProject = { id: string; title: string };

/** The five triage states the store writes; an absent key reads as "inbox". */
type SignalStatus = "inbox" | "triaged" | "acting" | "done" | "dropped";
type SignalPriority = "high" | "normal" | "low";

type ImageAttachment = {
  kind: "image";
  relPath: string;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
};

type LinkAttachment = { kind: "link"; url: string };
type Attachment = ImageAttachment | LinkAttachment;

/** A chain record, in the shape the vault answers with. */
type SignalRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  type: string;
  source: string;
  sourceRef: string | null;
  title: string | null;
  body: string;
  domainSlug: string | null;
  /** Triage fields: optional on disk, answered as values by the store. */
  projectId?: string | null;
  status?: SignalStatus;
  priority?: SignalPriority | null;
  capturedFrom?: string | null;
  attachment: Attachment | null;
};

/** What `signalChainCreate` is handed, summarised for the report. */
type CreateSummary = {
  type: string;
  title: string | null;
  body: string;
  domainSlug: string | null;
  /** The inbox fields the page handed over, as handed (never invented here). */
  projectId?: string | null;
  status?: SignalStatus;
  priority?: SignalPriority | null;
  capturedFrom?: string | null;
  attachment: {
    kind: "image" | "link";
    name?: string;
    url?: string;
    mime?: string;
    width?: number | null;
    height?: number | null;
    byteLength?: number;
    /** The path this harness minted for the bytes it stored. */
    relPath?: string;
  } | null;
};

/** One seeded record, with the labels the contract says the row must paint. */
type InboxSeed = {
  id: string;
  body: string;
  attachment: "text" | "image" | "link";
  domainSlug: string | null;
  domainLabel: string;
  projectId: string | null;
  projectLabel: string;
  status: SignalStatus;
  statusLabel: string;
  priority: SignalPriority | null;
  priorityLabel: string;
  capturedFrom: string | null;
};

type HarnessWindow = Window & {
  chainCaptureReady?: boolean;
  chainCaptureSkin?: string;
  chainCaptureRoute?: string;
  chainCaptureCalls?: string[];
  chainCaptureUnexpectedCalls?: string[];
  chainCaptureCreates?: CreateSummary[];
  chainCaptureReads?: string[];
  chainCaptureUpdates?: { id: string; patch: Record<string, unknown> }[];
  chainCaptureDeletes?: string[];
  /** The picture the driver drops or picks, so it never retypes the bytes. */
  chainCaptureImageBase64?: string;
  chainCaptureImage?: { name: string; mime: string; width: number; height: number };
  chainCaptureExpected?: {
    seeded: {
      count: number;
      textBody: string;
      imageBody: string;
      imageName: string;
      imageRelPath: string;
      linkBody: string;
      linkUrl: string;
    };
  };
  /** The fixture's live projects, the list `projectsList` answers with. */
  chainCaptureProjects?: FixtureProject[];
  /**
   * The fixture's inbox, so the driver compares painted labels and written
   * patches against the contract's own maps instead of retyping the fixture.
   */
  chainCaptureInbox?: {
    projects: FixtureProject[];
    seeded: InboxSeed[];
    /** The row the triage phase moves: the first seed filed under a project. */
    target: { id: string; body: string };
  };
  chainCaptureSnapshot?: () => {
    records: SignalRow[];
    projects: FixtureProject[];
    bytes: Record<string, number>;
    reads: string[];
    creates: CreateSummary[];
    updates: { id: string; patch: Record<string, unknown> }[];
    deletes: string[];
  };
};

const harness = window as HarnessWindow;
harness.chainCaptureCalls = [];
harness.chainCaptureUnexpectedCalls = [];
harness.chainCaptureCreates = [];
harness.chainCaptureReads = [];
harness.chainCaptureUpdates = [];
harness.chainCaptureDeletes = [];

const domains = fixture.snapshot.domains as FixtureDomain[];
const projects = fixture.projects as FixtureProject[];
const seededRows = fixture.records as SignalRow[];

/**
 * The label maps the renderer contract fixes. The driver compares each row's
 * painted chip against these, so a chip that says something else — or a row
 * whose stored value and chip disagree — is named rather than eyeballed.
 */
const STATUS_LABELS: Record<SignalStatus, string> = {
  inbox: "Inbox",
  triaged: "Triaged",
  acting: "Acting",
  done: "Done",
  dropped: "Dropped",
};
const PRIORITY_LABELS: Record<SignalPriority | "none", string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
  none: "None",
};

/** The bytes the seeded image attachment points at, and the picture the driver drops. */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const fixtureImage = fixture.image;
const seededImageBytes = fromBase64(fixtureImage.base64);
harness.chainCaptureImageBase64 = fixtureImage.base64;
harness.chainCaptureImage = {
  name: fixtureImage.name,
  mime: fixtureImage.mime,
  width: fixtureImage.width,
  height: fixtureImage.height,
};

/** The bridge's own copy: a create has to survive the next list call. */
const records: SignalRow[] = seededRows.map((row) => ({
  ...row,
  attachment: row.attachment ? { ...row.attachment } : null,
}));
const bytesByRelPath = new Map<string, Uint8Array>([
  [fixtureImage.relPath, seededImageBytes],
]);
const mimeByRelPath = new Map<string, string>([[fixtureImage.relPath, fixtureImage.mime]]);

const seeded = {
  text: seededRows.find((row) => row.attachment === null)!,
  image: seededRows.find((row) => row.attachment?.kind === "image")!,
  link: seededRows.find((row) => row.attachment?.kind === "link")!,
};

harness.chainCaptureExpected = {
  seeded: {
    count: seededRows.length,
    textBody: seeded.text.body,
    imageBody: seeded.image.body,
    imageName: (seeded.image.attachment as ImageAttachment).name,
    imageRelPath: (seeded.image.attachment as ImageAttachment).relPath,
    linkBody: seeded.link.body,
    linkUrl: (seeded.link.attachment as LinkAttachment).url,
  },
};

const copyRow = (row: SignalRow): SignalRow => ({
  ...row,
  attachment: row.attachment ? { ...row.attachment } : null,
});

function snapshot() {
  return {
    records: records.map(copyRow),
    projects: projects.map((project) => ({ ...project })),
    bytes: Object.fromEntries([...bytesByRelPath].map(([relPath, bytes]) => [relPath, bytes.byteLength])),
    reads: [...(harness.chainCaptureReads ?? [])],
    creates: (harness.chainCaptureCreates ?? []).map((create) => ({ ...create })),
    updates: (harness.chainCaptureUpdates ?? []).map((update) => ({ ...update })),
    deletes: [...(harness.chainCaptureDeletes ?? [])],
  };
}
harness.chainCaptureSnapshot = snapshot;
harness.chainCaptureProjects = projects.map((project) => ({ ...project }));

/**
 * The fixture's inbox in contract terms: every seeded row's stored value beside
 * the label the row must paint. The driver reads this once and compares the
 * live DOM against it; the target is the first row filed under a project, so
 * the triage phase also proves the project link follows the row it moved.
 */
const inboxSeeds: InboxSeed[] = seededRows.map((row) => {
  const status = row.status ?? "inbox";
  const priority = row.priority ?? null;
  return {
    id: row.id,
    body: row.body,
    attachment: (row.attachment?.kind ?? "text") as InboxSeed["attachment"],
    domainSlug: row.domainSlug,
    domainLabel: row.domainSlug
      ? (domains.find((domain) => domain.slug === row.domainSlug)?.name ?? row.domainSlug)
      : "Unassigned",
    projectId: row.projectId ?? null,
    projectLabel: row.projectId
      ? (projects.find((project) => project.id === row.projectId)?.title ?? row.projectId)
      : "No project",
    status,
    statusLabel: STATUS_LABELS[status],
    priority,
    priorityLabel: PRIORITY_LABELS[priority ?? "none"],
    capturedFrom: row.capturedFrom ?? null,
  };
});
const inboxTarget = inboxSeeds.find((seed) => seed.projectId) ?? inboxSeeds[0];
harness.chainCaptureInbox = {
  projects: projects.map((project) => ({ ...project })),
  seeded: inboxSeeds,
  target: { id: inboxTarget.id, body: inboxTarget.body },
};

/** Uuid-shaped ids, so the page's keys are the ids the real vault would mint. */
let nextId = 1;
const mintId = () =>
  `0192f4a0-7c1e-4e2b-9a51-${(nextId++).toString(16).padStart(12, "0")}`;

/**
 * The bytes decide the kind and the extension, never the uploaded name — the
 * same rule the vault's own store follows. The fixture is a PNG; a JPEG, GIF or
 * WebP dropped by a future rig is read from its magic bytes too.
 */
function sniffMime(bytes: Uint8Array): { mime: string; ext: string } {
  const at = (index: number) => bytes[index] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
    return { mime: "image/gif", ext: "gif" };
  }
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return { mime: "image/png", ext: "png" };
}

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Chain capture rig",
  lastActive: 1_700_000_000,
};

const SNAPSHOT = {
  rootPath: fixture.snapshot.rootPath,
  lifequest: {
    schemaVersion: 1,
    id: "chain-capture-vault",
    name: "Chain Capture Rig",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
  },
  domains: domains.map((domain, index) => ({
    slug: domain.slug,
    meta: {
      name: domain.name,
      description: null,
      color: null,
      sortOrder: index,
      archivedAt: domain.archived ? "2026-01-01T00:00:00.000Z" : null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    documents: {},
  })),
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

type SignalCreateInput = {
  type: string;
  title?: string | null;
  body: string;
  domainSlug?: string | null;
  projectId?: string | null;
  status?: SignalStatus;
  priority?: SignalPriority | null;
  capturedFrom?: string | null;
  attachment?:
    | {
        kind: "image";
        bytes: Uint8Array | ArrayBuffer;
        name: string;
        width?: number | null;
        height?: number | null;
      }
    | { kind: "link"; url: string }
    | null;
};

const rawBridge: Record<string, unknown> = {
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
  // The real `ThemeProvider` reads the app profile's theme directory once and
  // subscribes to its changes; both are modelled because the harness renders
  // the real provider. The subscription must answer with a function — an
  // unmodelled name resolves to a refusal Promise, and StrictMode's unmount
  // cleanup then calls that Promise as `unsubscribe()`, which throws and makes
  // React 19 unmount the whole tree (a blank page with no visible cause).
  themesList: () => ok([]),
  themeGetState: () => ok({ keptFile: null }),
  themeSetKept: () => ok({ keptFile: null }),
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

  signalChainList: () => {
    // Newest first, the order the vault's own list is sorted in. Deleted
    // records are gone from the list, as the vault's own read leaves them.
    const live = records.filter((row) => !row.deletedAt);
    return ok({ records: live.map(copyRow), skipped: 0 });
  },

  // The renderer reads the live projects on mount to paint a row's project
  // title; an unmodelled call here would be recorded as unexpected and fail.
  projectsList: () =>
    ok({ records: projects.map((project) => ({ ...project })), skipped: 0 }),

  signalChainCreate: (input: SignalCreateInput) => {
    const id = mintId();
    const now = new Date().toISOString();
    let attachment: Attachment | null = null;
    const summary: CreateSummary["attachment"] = input.attachment
      ? input.attachment.kind === "image"
        ? {
            kind: "image",
            name: input.attachment.name,
            width: input.attachment.width ?? null,
            height: input.attachment.height ?? null,
          }
        : { kind: "link", url: input.attachment.url }
      : null;
    if (input.attachment?.kind === "image") {
      const bytes =
        input.attachment.bytes instanceof Uint8Array
          ? input.attachment.bytes
          : new Uint8Array(input.attachment.bytes);
      const { mime, ext } = sniffMime(bytes);
      // The shipped vault stores capture pictures under `.lifequest/`; the
      // harness mints the same shape so the report names a path the app writes.
      const relPath = `.lifequest/signal-chain/files/${id}.${ext}`;
      bytesByRelPath.set(relPath, bytes);
      mimeByRelPath.set(relPath, mime);
      attachment = {
        kind: "image",
        relPath,
        name: input.attachment.name,
        mime,
        width: input.attachment.width ?? fixtureImage.width,
        height: input.attachment.height ?? fixtureImage.height,
      };
      // The summary keeps what the page actually handed over — the minted path
      // is the vault's answer, and the bytes are proven by their length, never
      // by copying the picture into the report.
      Object.assign(summary as Record<string, unknown>, {
        mime,
        byteLength: bytes.byteLength,
        relPath,
      });
    } else if (input.attachment?.kind === "link") {
      attachment = { kind: "link", url: input.attachment.url };
      Object.assign(summary as Record<string, unknown>, { url: input.attachment.url });
    }
    const status = input.status ?? "inbox";
    const record: SignalRow = {
      id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      type: input.type,
      source: "manual",
      sourceRef: null,
      title: input.title ?? null,
      body: input.body,
      domainSlug: input.domainSlug ?? null,
      // The inbox fields the page hands over, defaulted exactly as the store
      // defaults them: an omitted status is "inbox", omitted others are null.
      projectId: input.projectId ?? null,
      status,
      priority: input.priority ?? null,
      capturedFrom: input.capturedFrom ?? null,
      attachment,
    };
    records.unshift(record);
    harness.chainCaptureCreates?.push({
      type: input.type,
      title: input.title ?? null,
      body: input.body,
      domainSlug: input.domainSlug ?? null,
      projectId: input.projectId ?? null,
      status,
      priority: input.priority ?? null,
      capturedFrom: input.capturedFrom ?? null,
      attachment: summary,
    });
    return ok(copyRow(record));
  },

  signalChainUpdate: (id: string, patch: Record<string, unknown>) => {
    harness.chainCaptureUpdates?.push({ id, patch: { ...patch } });
    const record = records.find((row) => row.id === id);
    if (!record) return Promise.resolve(fail("No such signal"));
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    return ok(copyRow(record));
  },

  signalChainDelete: (id: string) => {
    harness.chainCaptureDeletes?.push(id);
    const record = records.find((row) => row.id === id);
    if (!record) return Promise.resolve(fail("No such signal"));
    record.deletedAt = new Date().toISOString();
    return ok(copyRow(record));
  },

  signalChainReadImage: (relPath: string) => {
    harness.chainCaptureReads?.push(relPath);
    const bytes = bytesByRelPath.get(relPath);
    if (!bytes) return Promise.resolve(fail("That image is missing from the vault."));
    return ok({ bytes, mime: mimeByRelPath.get(relPath) ?? "image/png" });
  },
};

/**
 * Every modelled call is recorded, and an unmodelled one is named *and* refused:
 * a stub that silently answered `null` would let a page render a blank sheet and
 * still "pass".
 */
const bridge: Record<string, unknown> = {};
for (const [name, value] of Object.entries(rawBridge)) {
  if (typeof value === "function") {
    bridge[name] = (...args: unknown[]) => {
      harness.chainCaptureCalls?.push(name);
      return (value as (...inner: unknown[]) => unknown)(...args);
    };
  } else if (value && typeof value === "object") {
    const wrapped: Record<string, unknown> = {};
    for (const [innerName, inner] of Object.entries(value)) {
      wrapped[innerName] =
        typeof inner === "function"
          ? (...args: unknown[]) => {
              harness.chainCaptureCalls?.push(`${name}.${innerName}`);
              return (inner as (...innerArgs: unknown[]) => unknown)(...args);
            }
          : inner;
    }
    bridge[name] = wrapped;
  } else {
    bridge[name] = value;
  }
}

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      void args;
      harness.chainCaptureUnexpectedCalls?.push(prop);
      return Promise.resolve(fail(`unmodelled bridge call: ${prop}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chain-capture.html");

function RouteProbe() {
  const { pathname } = useLocation();
  // Written from an effect, not render: `navigate` runs in a transition, and a
  // render-phase write would publish the path before the page commits.
  useEffect(() => {
    harness.chainCaptureRoute = pathname;
  }, [pathname]);
  return null;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/chain"]}>
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
                      <Route path="/chain" element={<ChainPage />} />
                      <Route
                        path="/home"
                        element={
                          <div className="stub-page">
                            <h1 className="stub-page__title">Dashboard</h1>
                          </div>
                        }
                      />
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
  const page = document.querySelector(".signal-chain");
  const composer = document.querySelector('[data-testid="chain-composer"]');
  const rows = document.querySelectorAll('[data-testid="signal-row"]');
  // The chain's own first read has landed: the fixture rows are painted (or,
  // with a broken selector contract, the home stub is — and the driver names
  // the selector it waited for).
  if (!rail || !page || !composer || rows.length < seededRows.length) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

harness.chainCaptureReady = false;
void ready.then(() => {
  harness.chainCaptureReady = true;
});
harness.chainCaptureSkin = skinName;
