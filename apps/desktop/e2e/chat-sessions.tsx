/**
 * E2E harness for the dock's Life-Chain surface (run by
 * `chat-chain.electron.mjs`).
 *
 * The page was built for the dock's chat list, which used to be a surface of
 * this pane with a rig of its own. The list is the sidebar's now — a pane-wide
 * history page inside the dock no longer exists — so the list rig and its page
 * half went with it, and the chain rig is the driver that remains. The page
 * still carries the whole dock (thread, chain, composer, action bar) on one
 * stubbed bridge, which is what the chain rig needs: it starts by landing on a
 * thread and then swaps the pane to the chain.
 *
 * The chain rig's own failure modes are written down in its header
 * (`chat-chain.electron.mjs`); what this page guarantees to it is:
 *
 *  1. A landing thread is up: a chat to resume is seeded in the fixture, so the
 *     dock opens on a thread rather than on a blank slate, and the chain has a
 *     chat to come back to.
 *  2. The dock's surface is the shipped `data-chat-surface` attribute
 *     ("thread" | "chain" | "shortcuts") — a rig reads which surface is up from
 *     the markup instead of inferring it from a selector that might paint
 *     underneath.
 *  3. Bridge stubs masking real calls — anything ChatPanel reaches for that is
 *     not named here must not throw (the Proxy fallback).
 *  4. The chain fixture answers from `fixtures/signal-chain.json` through the
 *     same bridge calls the main process exposes, so "the write reached the
 *     gateway" is asserted at the bridge boundary, not against a mock of the
 *     panel's logic.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page) and the session fixture answers from `fixtures/companion-sessions.json`,
 * which was seeded out of the lifequest profile's real state.db. Everything
 * else — the real ChatPanel, the real CSS, the real layout engine — is shipping
 * code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import type { VaultSnapshot } from "@lifequest/vault-core/pure";
import "@/styles/global.css";
import {
  createdSessionFromPayload,
  messagesFromPayload,
  sessionFromPayload,
  sessionsFromPayload,
} from "../electron/companion-client";
import fixture from "./fixtures/companion-sessions.json";
import signalFixture from "./fixtures/signal-chain.json";

type FixtureRow = {
  id: string;
  title: string | null;
  preview: string | null;
  last_active: number;
  started_at: number;
  message_count: number;
  pinned: number;
  archived: number;
  hidden: number;
};

type FixtureMessage = { role: string; content: string };

/** A chain record, in the shape the vault answers with. */
type SignalRecordRow = {
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
};

/** What `signalChainCreate` is handed. */
type SignalCreateRow = {
  type: string;
  body: string;
  title?: string | null;
  domainSlug?: string | null;
};

type PatchCall = { id: string; patch: Record<string, unknown> };

type HarnessWindow = {
  chatHarnessReady?: Promise<void>;
  /** What the driver should expect to see, read off the fixture rather than typed twice. */
  chatHarnessExpected?: { rows: number; archived: number; hidden: number; newestLabel: string };
  /** Live rows in fixture order — the rendered order before anything is pinned. */
  chatHarnessIds?: string[];
  chatHarnessLabels?: string[];
  /**
   * The chain fixture's own facts, so the chain driver reads the newest and
   * oldest bodies off the data instead of retyping them beside it.
   */
  chatHarnessSignals?: {
    total: number;
    newestId: string;
    newestBody: string;
    oldestId: string;
    oldestBody: string;
    domainBody: string;
    domainSlug: string;
    titledBody: string;
    title: string;
    /** Every picker offers exactly this: unassigned, then the live domains. */
    assignOptions: string[];
    /** Archived, so no picker may offer it. */
    archivedDomain: string;
  };
  /**
   * How many chain records the next list answers with, newest first. One
   * fixture then serves both shapes the dock has to survive: a stack that rests
   * on the composer and one that overflows the panel.
   */
  __lqSignalLimit?: number | null;
  /**
   * How long the next chain write takes, in ms. Zero (the default) answers in a
   * microtask; a rig that measures what the composer looks like *during* a write
   * has to hold it open.
   */
  __lqSignalDelay?: number;
  __lqSignalListCalls?: number;
  __lqSignalCreateCalls?: SignalCreateRow[];
  __lqSignalUpdateCalls?: PatchCall[];
  __lqSignalDeleteCalls?: { id: string; body: string | null }[];
  __lqPatchCalls?: PatchCall[];
  __lqMessageCalls?: string[];
  __lqCreateCalls?: string[];
  __lqDeleteCalls?: string[];
  __lqListCalls?: number;
};

const harness = window as unknown as HarnessWindow;
harness.__lqPatchCalls = [];
harness.__lqMessageCalls = [];
harness.__lqCreateCalls = [];
harness.__lqDeleteCalls = [];
harness.__lqListCalls = 0;
harness.__lqSignalCreateCalls = [];
harness.__lqSignalUpdateCalls = [];
harness.__lqSignalDeleteCalls = [];
harness.__lqSignalListCalls = 0;
harness.__lqSignalLimit = null;
harness.__lqSignalDelay = 0;

/**
 * Nothing here stubs `window.confirm`: the dock's destructive writes ask through
 * its own `ConfirmDialog`, so the question is real DOM the driver clicks. A
 * platform dialog would block the page until somebody answered it and could not
 * be clicked at all — so a stray call is made to fail loudly rather than hang.
 */
window.confirm = () => {
  throw new Error("the dock asks through ConfirmDialog, never window.confirm");
};

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/**
 * The vault the dock reads its domains from. Two of them, and only one is live:
 * the assignment picker has to offer a domain to assign, and it has to leave an
 * archived one out, which is a claim only a fixture with both can carry. Nothing
 * else in this harness mounts a page that reads the snapshot.
 */
const harnessDomains = [
  { slug: "health", meta: { name: "Health", archivedAt: null } },
  { slug: "retired", meta: { name: "Retired", archivedAt: "2026-01-01T00:00:00.000Z" } },
];

const harnessSnapshot = {
  rootPath: "/harness/vault",
  lifequest: { id: "harness-vault" },
  settings: {},
  domains: harnessDomains,
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

/** The bridge's own copy: a patch has to survive the next list call. */
const rows: FixtureRow[] = (fixture.list.data as FixtureRow[]).map((row) => ({ ...row }));
const messages = fixture.messages as Record<string, { data: FixtureMessage[] }>;
/** Ids this harness created, so its message page can be empty like the real one. */
const createdIds = new Set<string>();

const isLive = (row: FixtureRow) => row.archived !== 1 && row.hidden !== 1;

const labelOf = (row: FixtureRow) => (row.title ?? "").trim() || (row.preview ?? "").trim();

harness.chatHarnessIds = rows.filter(isLive).map((row) => row.id);
harness.chatHarnessLabels = rows.filter(isLive).map(labelOf);
harness.chatHarnessExpected = {
  rows: rows.filter(isLive).length,
  archived: rows.filter((row) => row.archived === 1).length,
  hidden: rows.filter((row) => row.hidden === 1).length,
  newestLabel: labelOf(rows.filter(isLive)[0]!),
};

/**
 * The chain fixture, in the bridge's own copy: a signal logged here has to
 * survive the next list call, the way the vault's write survives its own read.
 */
const signalRecords: SignalRecordRow[] = (signalFixture.records as SignalRecordRow[]).map(
  (row) => ({ ...row }),
);
const newestSignal = signalRecords[0]!;
const oldestSignal = signalRecords[signalRecords.length - 1]!;
const assignedSignal = signalRecords.find((row) => row.domainSlug)!;
const titledSignal = signalRecords.find((row) => row.title)!;

harness.chatHarnessSignals = {
  total: signalRecords.length,
  newestId: newestSignal.id,
  newestBody: newestSignal.body,
  oldestId: oldestSignal.id,
  oldestBody: oldestSignal.body,
  domainBody: assignedSignal.body,
  domainSlug: assignedSignal.domainSlug!,
  titledBody: titledSignal.body,
  title: titledSignal.title!,
  // The picker's own list, read off the snapshot the dock was handed rather than
  // retyped: unassigned first, then every live domain, and no archived one.
  assignOptions: [
    "",
    ...harnessDomains.filter((domain) => !domain.meta.archivedAt).map((domain) => domain.slug),
  ],
  archivedDomain: harnessDomains.find((domain) => domain.meta.archivedAt)!.slug,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(harnessSnapshot),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => {
    harness.__lqListCalls = (harness.__lqListCalls ?? 0) + 1;
    // The whole table goes over the wire, archived and hidden rows included.
    // `sessionsFromPayload` is the shipping parser, so what the dock lists is
    // decided by the real filter, not by this harness.
    return ok(sessionsFromPayload({ ...fixture.list, data: rows }));
  },
  companionSessionMessages: (id: string) => {
    harness.__lqMessageCalls = [...(harness.__lqMessageCalls ?? []), id];
    // A chat that was just created has no transcript yet: the gateway answers
    // with an empty page and the rig has to as well, or the empty-thread check
    // would be asserting against its own placeholder.
    if (createdIds.has(id)) return ok(messagesFromPayload({ data: [] }));
    const page = messages[id] ?? { data: [{ role: "user", content: "Harness message" }] };
    return ok(messagesFromPayload(page));
  },
  companionSessionCreate: (title: string) => {
    harness.__lqCreateCalls = [...(harness.__lqCreateCalls ?? []), title];
    // A fresh id per create, the same way the gateway mints one: the store keys
    // tabs and transcripts by it, and the archive path can create more than once.
    const row: FixtureRow = {
      id: `harness-created-${harness.__lqCreateCalls.length}`,
      title: title || null,
      preview: null,
      last_active: Date.now() / 1000,
      started_at: Date.now() / 1000,
      message_count: 0,
      pinned: 0,
      archived: 0,
      hidden: 0,
    };
    rows.unshift(row);
    createdIds.add(row.id);
    return ok(createdSessionFromPayload({ session: row }, title));
  },
  companionSessionPatch: (id: string, patch: Record<string, unknown>) => {
    harness.__lqPatchCalls = [...(harness.__lqPatchCalls ?? []), { id, patch }];
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return Promise.resolve({ ok: false as const, error: `no such session ${id}` });
    Object.assign(row, patch);
    // Mirrors the shipping handler: the reply is parsed back into a session.
    return ok(sessionFromPayload(row));
  },
  companionSessionDelete: (id: string) => {
    harness.__lqDeleteCalls = [...(harness.__lqDeleteCalls ?? []), id];
    // The row is gone from the store after this, the way the gateway's own
    // delete leaves it: the next list call must not answer with it.
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return Promise.resolve({ ok: false as const, error: `no such session ${id}` });
    rows.splice(index, 1);
    createdIds.delete(id);
    return ok({ id, deleted: true });
  },
  onCompanionStream: () => () => {},
  signalChainList: () => {
    harness.__lqSignalListCalls = (harness.__lqSignalListCalls ?? 0) + 1;
    // Newest first, the order the vault's own list is sorted in. The limit knob
    // lets one fixture stand in for both a short chain and a long one. Deleted
    // records are gone from the list, as the vault's own read leaves them.
    const limit = harness.__lqSignalLimit;
    const live = signalRecords.filter((row) => !row.deletedAt);
    const served = typeof limit === "number" ? live.slice(0, limit) : live.slice();
    return ok({
      records: served.map((row) => ({ ...row })),
      skipped: signalFixture.skipped,
    });
  },
  signalChainCreate: async (input: SignalCreateRow) => {
    harness.__lqSignalCreateCalls = [
      ...(harness.__lqSignalCreateCalls ?? []),
      { ...input },
    ];
    // How long the write takes. The composer disables its field while a write
    // is in flight, and a stub that answers in a microtask can settle inside one
    // React batch, so the disabled state never reaches the DOM and the caret
    // never leaves the field. A rig that wants to see the field it disables has
    // to make the write take real time — the same knob `__lqChatDelay` is for
    // the chat stream.
    const delay = harness.__lqSignalDelay ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const now = new Date().toISOString();
    const record: SignalRecordRow = {
      id: `sig-harness-created-${signalRecords.length + 1}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      type: input.type,
      source: "manual",
      sourceRef: null,
      title: input.title ?? null,
      body: input.body,
      domainSlug: input.domainSlug ?? null,
    };
    signalRecords.unshift(record);
    return ok(record);
  },
  // The row's own writes, mirroring the shipping handlers: a patch lands on the
  // record the vault holds, so the next list answers with it.
  signalChainUpdate: (id: string, patch: Record<string, unknown>) => {
    harness.__lqSignalUpdateCalls = [
      ...(harness.__lqSignalUpdateCalls ?? []),
      { id, patch: { ...patch } },
    ];
    const record = signalRecords.find((row) => row.id === id);
    if (!record) return Promise.resolve({ ok: false as const, error: "No such signal" });
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    return ok({ ...record });
  },
  signalChainDelete: (id: string) => {
    // The id, and what the vault holds under it: a rig can then say the id the
    // panel sent pointed at the row whose menu was used, not just at some id.
    const record = signalRecords.find((row) => row.id === id);
    harness.__lqSignalDeleteCalls = [
      ...(harness.__lqSignalDeleteCalls ?? []),
      { id, body: record?.body ?? null },
    ];
    if (!record) return Promise.resolve({ ok: false as const, error: "No such signal" });
    record.deletedAt = new Date().toISOString();
    return ok({ ...record });
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

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

// A previous run's "last chat" would decide the landing view, and a remembered
// tab strip would decide how many tabs the dock opens; clear both so the harness
// always starts from the same place.
window.localStorage.removeItem("lifequest.companion.lastSessionId");
window.localStorage.removeItem("lifequest.companion.openTabs");

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chat-sessions.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <VaultProvider>
        <ChatDockProvider>
          <div className="app-root">
            {/* The real frame container, because the dock escapes the right and
                bottom halves of that frame: a rig without the padding would push
                the panel past the window edge and measure a geometry the app
                never has. */}
            <div className="app-root__body">
              <div className="shell">
                <div className="nav-rail" />
                <div className="shell__main" />
                <ChatPanel open onOpenChange={() => {}} />
              </div>
            </div>
          </div>
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the panel never rendered". The landing is a
// thread — the fixture always has a chat to resume, and a dock with nothing to
// resume would show the blank slate on the same surface.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForPanel = () => {
  const settled = document.querySelector(".chat-panel__header--thread");
  if (!settled) {
    requestAnimationFrame(waitForPanel);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPanel);

(window as unknown as { chatHarnessReady: Promise<void> }).chatHarnessReady = ready;
