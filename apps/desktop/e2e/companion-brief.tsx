/**
 * E2E harness page for the Dashboard's companion brief card (`pages/HomePage`).
 *
 * What this rig renders is the real HomePage with the real `CompanionBriefCard`
 * on it: the card's own read through `briefGet`, its own lens filter, its own
 * priority sort, its own clock decision about expiry and staleness, and its own
 * dismissal menu. Nothing in `src/` is copied here — the card is the one the
 * operator runs.
 *
 * The bridge is a recording stub, because a dev-server page has no preload.
 * Every method the page calls is listed, and anything else answers
 * `{ ok: false }` and is NAMED in `companionBriefUnexpectedCalls`, so a page that
 * grows a new dependency fails the run loudly instead of rendering a quietly
 * empty board.
 *
 * The read behind the page is switched by two setters, deliberately one
 * generation at a time so the driver can never sample a half-painted card:
 *
 *   `companionBriefSetRead(read)`
 *       installs the exact `CompanionBriefRead` the card will be served by
 *       `briefGet` on its next mount. `null` is the no-bridge answer.
 *   `companionBriefSetDismissRead(read)`
 *       installs the read `briefDismiss` answers with. The stub does not invent
 *       a dismissal: the driver hands over the read the REAL vault returns after
 *       the operator settles an item, and this rig asserts the card draws it.
 *
 * The dismissal stub records every call with its arguments in
 * `companionBriefDismissCalls`, which is how the driver checks that clicking a
 * reason calls `briefDismiss(itemId, reason)` and not something else.
 *
 * `companionBriefRender(generation)` mounts the page again with a new key, so a
 * driver can change the read behind it and see the card fetch the new one. The
 * driver waits on `companionBriefCommits`, bumped from an effect after React has
 * committed, so it never samples a half-painted page.
 */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  CompanionBriefRead,
  DomainRecord,
  Pin,
  PinBoardRead,
  SavedView,
  VaultSnapshot,
} from "@lifequest/vault-core";
import HomePage from "@/pages/HomePage";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first: this rig judges the Dashboard the operator sees, so
// it has to paint in the palette they run rather than in the base tokens.
const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

/** The board the harness serves: the companion brief FIRST, then two cards
 * beside it, so "the brief is where the vault seeds it" is a fact about the
 * rendered board and not only about the pin list. */
const PINS: Pin[] = [
  { id: "sys:companion-brief", kind: "system", system: "companion-brief" },
  { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
  { id: "sys:recent-log", kind: "system", system: "recent-log" },
];

/** One live domain, so the Overview board has something to list views from. */
const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "harness-vault",
    name: "Harness",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://localhost:8642",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
  },
  domains: [
    {
      slug: "financial",
      meta: {
        name: "Financial",
        description: null,
        color: null,
        sortOrder: 3,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      documents: {} as DomainRecord["documents"],
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

/** The read the card will be served. `null` means the bridge answers `{ ok: false }`,
 * which is the no-bridge case the card is written to survive. */
let served: CompanionBriefRead | null = null;

/** The read the dismissal stub answers with; installed by the driver from the
 * REAL vault's post-dismissal read. */
let dismissAnswer: CompanionBriefRead | null = null;

type HarnessWindow = Window & {
  companionBriefReady?: boolean;
  companionBriefCommits?: number;
  companionBriefCalls?: string[];
  companionBriefUnexpectedCalls?: string[];
  companionBriefDismissCalls?: { itemId: string; reason: string }[];
  companionBriefSkin?: string;
  companionBriefSetRead?: (read: CompanionBriefRead | null) => CompanionBriefRead | null;
  companionBriefSetDismissRead?: (read: CompanionBriefRead | null) => CompanionBriefRead | null;
  companionBriefRender?: (generation: number) => boolean;
};

const harness = window as HarnessWindow;

harness.companionBriefCalls = [];
harness.companionBriefUnexpectedCalls = [];
harness.companionBriefDismissCalls = [];

/**
 * Every bridge method the page uses, with the value it answers. A method the
 * page calls that is not here is recorded and answered `{ ok: false }`, so the
 * run reports it by name.
 */
function bridge(): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return {
    vaultGetSnapshot: async () => ok(SNAPSHOT),
    vaultListRecent: async () => [],
    domainGetActive: async () => null,
    onVaultFileChanged: () => () => {},
    decisionList: async () => ok([]),
    logList: async () => ok([]),
    pageList: async () => ok([]),
    viewList: async () => ok([] as SavedView[]),
    kitList: async () => ok([]),
    deadlineGetDismissed: async () => ok(false),
    deadlineMaybeNotify: async () => ok(null),
    deadlineDismiss: async () => ok(true),
    goalsApply: async () => ok({}),
    pinsList: async () =>
      ok({ pins: PINS, locked: false } satisfies PinBoardRead),
    // The one read this rig is about: the card's own read of the brief.
    briefGet: async () => (served ? ok(served) : { ok: false, error: "no brief read installed" }),
    // The operator's one verb. The stub records the exact arguments and answers
    // with the driver-installed read, which is the real vault's post-dismissal
    // read — so "the item leaves and the others stay" is judged against the
    // server's own answer, not against the stub's bookkeeping.
    briefDismiss: async (itemId: unknown, reason: unknown) => {
      harness.companionBriefDismissCalls!.push({
        itemId: String(itemId),
        reason: String(reason),
      });
      const answer = dismissAnswer ?? served;
      return answer ? ok(answer) : { ok: false, error: "no brief read installed" };
    },
  };
}

const stubs = bridge();

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.companionBriefCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.companionBriefUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

/** Install the read the next mount will fetch. Installing a read also clears the
 * dismissal answer, so one scenario's post-dismissal read cannot leak into the
 * next. */
harness.companionBriefSetRead = (read) => {
  served = read;
  dismissAnswer = null;
  return served;
};

/** Install the read `briefDismiss` answers with (the real server's post-dismissal read). */
harness.companionBriefSetDismissRead = (read) => {
  dismissAnswer = read;
  return dismissAnswer;
};

function Harness({ generation }: { generation: number }) {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.companionBriefCommits = commits.current;
  }, [generation]);
  return (
    <MemoryRouter initialEntries={["/"]}>
      <VaultProvider>
        {/* The board's cards hand a card to the chat dock, so the dock has to be
            up: `useChatDock` throws without it. */}
        <ChatDockProvider>
          {/* `key` forces the page to mount again, so a driver can change the
              read behind it and see the card fetch the new one. */}
          <HomePage key={generation} />
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  );
}

const root = createRoot(document.getElementById("root")!);

harness.companionBriefRender = (generation) => {
  root.render(
    <StrictMode>
      <Harness generation={generation} />
    </StrictMode>,
  );
  return true;
};

harness.companionBriefReady = true;
harness.companionBriefSkin = skinName;
