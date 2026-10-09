/**
 * E2E harness page for a dashboard card in the chat's context (`ChatPanel`).
 *
 * The Dashboard's chat control ends at the dock: it puts a card in
 * `ChatDockProvider`. Everything after that is the chat's, and this is where it
 * is judged — the pill above the composer, what the turn carries, and what
 * happens when the operator takes the card off.
 *
 * This is a system-in-isolation rig: the real `ChatPanel`, the real dock
 * provider, the real CSS and layout engine, with only the IPC bridge stubbed
 * (there is no preload on a dev-server page). `companionChatStream` records whole
 * payloads rather than a summary, because the claim is about the instruction
 * context the turn carries, field by field.
 *
 * `ChatDockProbe` is the seam in the other direction: the Dashboard is not
 * mounted here, so a driver installs a card through the probe exactly as the
 * card control installs one.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { VaultSnapshot } from "@lifequest/vault-core";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { ChatDockProbe } from "./chat-dock-probe";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Card context harness",
  lastActive: 1_700_000_000,
  pinned: false,
};

/** One live domain, so the panel's lens lines have something to read. */
const SNAPSHOT = {
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

/** One turn as the panel sent it — the whole payload, not a summary of it. */
type ChatCall = {
  sessionId: string;
  input: string;
  instructionsContext: Record<string, unknown>;
};

type HarnessWindow = Window & {
  __cardChatCalls?: ChatCall[];
  cardContextReady?: Promise<void>;
  cardContextSkin?: string;
};

const harness = window as unknown as HarnessWindow;
harness.__cardChatCalls = [];

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  // Absent on Overview, and the panel asks for it on every render.
  pinsList: () => ok({ pins: [], locked: false }),
  companionSessionsList: () => ok([SESSION]),
  companionSessionMessages: () =>
    ok([
      { role: "user" as const, content: "Card context harness" },
      { role: "assistant" as const, content: "Ready." },
    ]),
  // No catalog, so the composer draws its plain footer line: this rig is about
  // the card, and a model pill row would only add noise to the geometry claim.
  companionModelOptions: () => Promise.resolve({ ok: false as const, error: "no catalog" }),
  companionChatStream: async (payload: ChatCall) => {
    harness.__cardChatCalls = [...(harness.__cardChatCalls ?? []), payload];
    return ok(true);
  },
  companionSessionCreate: () => ok(SESSION),
  onCompanionStream: () => () => {},
};

(window as unknown as { lifequest: unknown }).lifequest = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return () => ok(null);
  },
  has: () => true,
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from card-context.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <VaultProvider>
        <ChatDockProvider>
          <ChatDockProbe channel="cardContext" />
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

harness.cardContextSkin = skinName;

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the panel never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForComposer = () => {
  const el = document.querySelector(".chat-panel__composer-input");
  if (!el) {
    requestAnimationFrame(waitForComposer);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForComposer);

harness.cardContextReady = ready;
