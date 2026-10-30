/**
 * E2E harness for the left chats column and the dock's parallel tabs (driven by
 * `chat-tabs.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. The sidebar does not list the profile's chats — the list is still only
 *     reachable from inside the dock, which is the bug this rig exists for.
 *  2. A row click loads the wrong chat, or loads it without opening the dock.
 *  3. The tab strip appears with one chat (noise) or not at all with two (the
 *     parallel affordance never shows).
 *  4. A second send waits on the first — the store kept one `sending` flag, so
 *     the two turns serialise instead of running together.
 *  5. Deltas cross: a frame tagged with one chat lands in the other chat's
 *     transcript. This is the whole reason the frame carries a session id.
 *  6. Switching tabs drops the turn that is still streaming in the one left
 *     behind, or reloads the streaming transcript over itself.
 *  7. A background run (a scheduled automation, or any chat the operator did not
 *     open) does not appear as a tab, or steals the active chat.
 *  8. Closing a tab does not stop that tab's run, or leaves the panel on a chat
 *     whose tab is gone.
 *  9. Sidebar management is local-only: pin/rename/archive never reach the
 *     bridge, or archive/delete leave the row listed.
 * 10. Delete writes without asking, or the ask is a platform dialog rather than
 *     the app's own.
 * 11. The live state (dot, "N running") is not visible on the row/tab that is
 *     actually running.
 * 12. Bridge stubs masking real calls — anything the two surfaces reach for that
 *     is not named here must not throw.
 * 13. A header without its controls — no search icon or view-options icon in
 *     line with the "Chats" heading; or a search field that does not replace
 *     that row (title and icons still drawn behind it, or the field landing
 *     under the New chat button), does not take focus, or does not narrow the
 *     rows; or a field that cannot be dismissed by its cross, a press outside
 *     it, or Escape.
 * 14. A view option that lies — hide/show archived not marked, the shown view
 *     not asking the list for archived rows, archived rows openable or untagged,
 *     or unarchive failing to rejoin the working list.
 * 15. Archived chats leaking into the default view — the archived rows are only
 *     drawn when the view asks for them, and never while the view is off.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page); everything else — the real ChatsSidebar, the real ChatPanel, the real
 * ChatSessionsProvider, the real CSS and layout engine — is shipping code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import type { CompanionStreamFrame } from "@/vite-env";
import {
  createdSessionFromPayload,
  sessionFromPayload,
  sessionsFromPayload,
} from "../electron/companion-client";
import type { VaultSnapshot } from "@lifequest/vault-core/pure";
import "@/styles/global.css";

type ChatCall = { sessionId: string; input: string };
type PatchCall = { id: string; patch: Record<string, unknown> };

type HarnessWindow = {
  __lqEmit?: (sessionId: string, event: unknown) => void;
  __lqCalls?: ChatCall[];
  __lqPatchCalls?: PatchCall[];
  __lqDeleteCalls?: string[];
  __lqMessageCalls?: string[];
  __lqStopCalls?: string[];
  __lqListOptions?: ({ includeArchived?: boolean } | null)[];
  __lqFinishChat?: (sessionId: string) => void;
  chatTabsHarnessReady?: Promise<void>;
};

const harness = window as unknown as HarnessWindow;
harness.__lqCalls = [];
harness.__lqPatchCalls = [];
harness.__lqDeleteCalls = [];
harness.__lqMessageCalls = [];
harness.__lqStopCalls = [];
harness.__lqListOptions = [];

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const SNAPSHOT = {
  rootPath: "C:/harness-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "harness-vault",
    name: "Harness Vault",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark" as const,
    weekStartDay: "monday" as const,
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
} as unknown as VaultSnapshot;

/**
 * The profile's session table, in the gateway's own row shape: `sessionsFromPayload`
 * is the shipping parser, so the fixture exercises the real archived/hidden
 * filter instead of a description of it. Five live chats, two archived ones and
 * one hidden one: a view option that shows everything must show the archived
 * pair and never the hidden one.
 */
type FixtureRow = {
  id: string;
  title: string | null;
  preview: string | null;
  last_active: number;
  started_at: number;
  pinned: number;
  archived: number;
  hidden: number;
};

const ROWS: FixtureRow[] = [
  {
    id: "chat-alpha",
    title: "Alpha planning",
    preview: "Plan the alpha launch",
    last_active: 1_700_000_300,
    started_at: 1_700_000_300,
    pinned: 0,
    archived: 0,
    hidden: 0,
  },
  {
    id: "chat-bravo",
    title: "Bravo budget",
    preview: "Plan the bravo budget",
    last_active: 1_700_000_200,
    started_at: 1_700_000_200,
    pinned: 0,
    archived: 0,
    hidden: 0,
  },
  {
    id: "chat-charlie",
    title: "Charlie retro",
    preview: "What went well",
    last_active: 1_700_000_100,
    started_at: 1_700_000_100,
    pinned: 0,
    archived: 0,
    hidden: 0,
  },
  {
    id: "chat-pinned",
    title: "Pinned note",
    preview: "Keep this one",
    last_active: 1_700_000_050,
    started_at: 1_700_000_050,
    pinned: 1,
    archived: 0,
    hidden: 0,
  },
  {
    id: "chat-delta",
    title: "Delta automation",
    preview: "Scheduled run",
    last_active: 1_700_000_400,
    started_at: 1_700_000_400,
    pinned: 0,
    archived: 0,
    hidden: 0,
  },
  {
    id: "chat-echo",
    title: "Echo archived",
    preview: "Old notes kept for reference",
    last_active: 1_699_000_000,
    started_at: 1_699_000_000,
    pinned: 0,
    archived: 1,
    hidden: 0,
  },
  {
    id: "chat-foxtrot",
    title: "Foxtrot archived",
    preview: "Another retired thread",
    last_active: 1_698_000_000,
    started_at: 1_698_000_000,
    pinned: 0,
    archived: 1,
    hidden: 0,
  },
  {
    id: "chat-hidden",
    title: "Hidden scratch",
    preview: "Hermes Desktop's own",
    last_active: 1_697_000_000,
    started_at: 1_697_000_000,
    pinned: 0,
    archived: 0,
    hidden: 1,
  },
];

const MESSAGES: Record<string, { role: "user" | "assistant"; content: string }[]> = {
  "chat-alpha": [
    { role: "user", content: "Alpha seed question" },
    { role: "assistant", content: "Alpha seed answer" },
  ],
  "chat-bravo": [
    { role: "user", content: "Bravo seed question" },
    { role: "assistant", content: "Bravo seed answer" },
  ],
  "chat-charlie": [{ role: "user", content: "Charlie seed" }],
  "chat-pinned": [{ role: "user", content: "Pinned seed" }],
  "chat-delta": [{ role: "user", content: "Delta seed" }],
};

const rows: FixtureRow[] = ROWS.map((row) => ({ ...row }));
const listeners = new Set<(frame: CompanionStreamFrame) => void>();
/** The pending `companionChatStream` promise per chat, so the driver owns time. */
const chatResolvers = new Map<string, (value: { ok: true }) => void>();

harness.__lqEmit = (sessionId, event) => {
  for (const listener of [...listeners]) {
    listener({ sessionId, event: event as CompanionStreamFrame["event"] });
  }
};
harness.__lqFinishChat = (sessionId) => {
  const resolve = chatResolvers.get(sessionId);
  chatResolvers.delete(sessionId);
  resolve?.({ ok: true });
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  pinsList: () => ok({ locked: false, pins: [] }),
  companionSessionsList: (options?: { includeArchived?: boolean }) => {
    harness.__lqListOptions = [...(harness.__lqListOptions ?? []), options ?? null];
    // The shipping parser and filter decide what the sidebar receives; hidden
    // rows never cross, archived rows only when the view option asks.
    return ok(sessionsFromPayload({ data: rows }, options));
  },
  companionSessionMessages: (id: string) => {
    harness.__lqMessageCalls = [...(harness.__lqMessageCalls ?? []), id];
    return ok((MESSAGES[id] ?? []).map((message) => ({ ...message })));
  },
  companionSessionCreate: (title: string) => {
    const row: FixtureRow = {
      id: "chat-new",
      title: title || null,
      preview: null,
      last_active: Date.now() / 1000,
      started_at: Date.now() / 1000,
      pinned: 0,
      archived: 0,
      hidden: 0,
    };
    rows.unshift(row);
    return ok(createdSessionFromPayload({ session: row }, title));
  },
  companionSessionPatch: (id: string, patch: Record<string, unknown>) => {
    harness.__lqPatchCalls = [...(harness.__lqPatchCalls ?? []), { id, patch }];
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return Promise.resolve({ ok: false as const, error: `no such chat ${id}` });
    if (typeof patch.title === "string") row.title = patch.title;
    if (typeof patch.pinned === "boolean") row.pinned = patch.pinned ? 1 : 0;
    if (typeof patch.archived === "boolean") row.archived = patch.archived ? 1 : 0;
    // Mirrors the shipping handler: the reply is parsed back into a session.
    return ok(sessionFromPayload(row));
  },
  companionSessionDelete: (id: string) => {
    harness.__lqDeleteCalls = [...(harness.__lqDeleteCalls ?? []), id];
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) rows.splice(index, 1);
    return ok({ id, deleted: true });
  },
  companionModelOptions: () =>
    Promise.resolve({ ok: false as const, error: "no catalog in this harness" }),
  /*
   * A turn stays open until the driver closes it. The point of this rig is two
   * turns in the air at once, and a stub that settles in a microtask would make
   * every live-state claim measure a turn that had already ended.
   */
  companionChatStream: (payload: ChatCall) => {
    harness.__lqCalls = [...(harness.__lqCalls ?? []), payload];
    return new Promise((resolve) => {
      chatResolvers.set(payload.sessionId, resolve as (value: { ok: true }) => void);
    });
  },
  companionApproval: () => Promise.resolve({ ok: true as const }),
  companionRunStop: (runId: string) => {
    harness.__lqStopCalls = [...(harness.__lqStopCalls ?? []), runId];
    return Promise.resolve({ ok: true as const });
  },
  onCompanionStream: (cb: (frame: CompanionStreamFrame) => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
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

// A previous run's last chat would decide the landing view; clear it so the rig
// always starts on the same chat. The pinned order is client-side state too, so
// a leftover order from an earlier run would reorder the list under the rig.
window.localStorage.removeItem("lifequest.companion.lastSessionId");
window.localStorage.removeItem("lifequest.companion.runtimePins");
window.localStorage.removeItem("lifequest.companion.pinnedOrder");

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chat-tabs.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <VaultProvider>
        <ChatDockProvider>
          <NavDockProvider>
            {/* The real shell, sidebar and dock: the chats section is a part of
                the sidebar now, so a rig that mounted it as its own column
                would measure a layout the app no longer has. */}
            <Routes>
              <Route element={<AppShell />}>
                <Route
                  path="/home"
                  element={<div className="chat-tabs-harness-page" />}
                />
              </Route>
            </Routes>
          </NavDockProvider>
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForSurface = () => {
  const settled =
    document.querySelector(".nav-rail") &&
    document.querySelector(".chats-rail") &&
    document.querySelector(".chat-panel__header--thread");
  if (!settled) {
    requestAnimationFrame(waitForSurface);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForSurface);

(window as unknown as { chatTabsHarnessReady: Promise<void> }).chatTabsHarnessReady =
  ready;
