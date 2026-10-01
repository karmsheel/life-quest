/**
 * E2E harness for the chat dock's session management (run by
 * `chat-sessions.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. The list stays a strip — list view does not own the panel's height, so
 *     twenty chats still live in the old 11rem box instead of a page (the bug
 *     this rig was built for).
 *  2. The swap does not happen — clicking a row leaves the list up, the back
 *     control never returns to it, or the thread and the list paint at once.
 *  3. The composer keeps painting in list view (or the transcript does), so the
 *     list is never actually the panel's page.
 *  4. Archived rows stay listed — the client filter, or the local removal after
 *     archiving, regressed.
 *  5. Hidden rows are listed (same family, different flag).
 *  6. Pin is local-only — the bridge never sees `{pinned: true}` for that chat,
 *     so Hermes Desktop would never show it.
 *  7. The pinned section is wrong: no group header, the pinned row outside it,
 *     or no marker on the row itself.
 *  8. Rename is local-only, cannot be committed (dead Enter/submit), or the
 *     label does not change in both the thread and the list.
 *  9. Archive does not remove the row, or leaves the panel showing a thread for
 *     a chat that is no longer listed.
 * 10. The thread header loses its identity — no label for the open chat, or its
 *     actions (pin / rename / archive) unreachable.
 * 11. Wrong chat opened — the row click loads an id other than the row's.
 * 12. Tool rows painted as chat bubbles: Hermes stores tool traffic in the same
 *     message table, and only user/assistant rows are chat.
 * 13. Bridge stubs masking real calls — anything ChatPanel reaches for that is
 *     not named here must not throw.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page) and answers from `fixtures/companion-sessions.json`, which was seeded
 * out of the lifequest profile's real state.db. Everything else — the real
 * ChatPanel, the real CSS, the real layout engine — is shipping code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";
import {
  createdSessionFromPayload,
  messagesFromPayload,
  sessionFromPayload,
  sessionsFromPayload,
} from "../electron/companion-client";
import fixture from "./fixtures/companion-sessions.json";

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

type PatchCall = { id: string; patch: Record<string, unknown> };

type HarnessWindow = {
  chatHarnessReady?: Promise<void>;
  /** What the driver should expect to see, read off the fixture rather than typed twice. */
  chatHarnessExpected?: { rows: number; archived: number; hidden: number; newestLabel: string };
  /** Live rows in fixture order — the rendered order before anything is pinned. */
  chatHarnessIds?: string[];
  chatHarnessLabels?: string[];
  __lqPatchCalls?: PatchCall[];
  __lqMessageCalls?: string[];
  __lqCreateCalls?: string[];
  __lqListCalls?: number;
};

const harness = window as unknown as HarnessWindow;
harness.__lqPatchCalls = [];
harness.__lqMessageCalls = [];
harness.__lqCreateCalls = [];
harness.__lqListCalls = 0;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

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

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(null),
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
    const row: FixtureRow = {
      id: "harness-created",
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
  onCompanionStream: () => () => {},
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

// A previous run's "last chat" would decide the landing view; clear it so the
// harness always starts from the same place.
window.localStorage.removeItem("lifequest.companion.lastSessionId");

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chat-sessions.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <VaultProvider>
        <ChatDockProvider>
          <div className="shell">
            <div className="nav-rail" />
            <div className="shell__main" />
            <ChatPanel open onOpenChange={() => {}} />
          </div>
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the panel never rendered". Either surface
// counts as settled: which one came up is an assertion, not a precondition.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForPanel = () => {
  const settled =
    document.querySelector(".chat-panel__header--thread") ??
    document.querySelector(".chat-panel__list");
  if (!settled) {
    requestAnimationFrame(waitForPanel);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPanel);

(window as unknown as { chatHarnessReady: Promise<void> }).chatHarnessReady = ready;
