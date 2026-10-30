/**
 * E2E harness for Settings → Hermes (driven by `settings-hermes.electron.mjs`).
 *
 * A system-in-isolation rig, so the ways it can fail are written down first:
 *
 *  1. The MCP doors are not at the top of the page: the operator comes here to
 *     copy a door's address, and it is still below the profile picker.
 *  2. A profile's name and its value are stacked again — `Profile` on one line,
 *     the path on the next — so five facts read as ten rows.
 *  3. The companion profile choice is a stack of full-width bars again, taking
 *     the width of the whole page for four options.
 *  4. The cards do not select: a click never reaches `companionUseProfile`, or
 *     the chosen card never reads "In use".
 *  5. The filing preference is a raw checkbox again instead of the switch.
 *  6. The switch does not persist: the click never reaches `companionSetFiling`,
 *     or it sends the old value.
 *  7. A door that failed to bind loses its own error while the page is
 *     rearranged.
 *  8. Long profile paths widen the page instead of truncating inside a card.
 *
 * The IPC bridge is stubbed (there is no Electron preload on a dev-server page);
 * the settings page, the real CSS and the real layout engine are shipping code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettingsOverlay } from "@/components/settings/SettingsOverlay";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { CompanionProvider } from "@/state/CompanionProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const SNAPSHOT = {
  rootPath: "/harness-vault",
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
};

/** Three installed profiles, none of them the one the companion is on. */
const PROFILES = [
  {
    name: "default",
    path: "/root/.hermes",
    isDefault: true,
    hasConfig: true,
    hasSoul: false,
    hasEnv: true,
  },
  {
    name: "brook",
    path: "/root/.hermes/profiles/brook",
    isDefault: false,
    hasConfig: true,
    hasSoul: true,
    hasEnv: true,
  },
  {
    name: "coder",
    path: "/root/.hermes/profiles/coder",
    isDefault: false,
    hasConfig: true,
    hasSoul: true,
    hasEnv: true,
  },
];

/** The app runs on `lifequest`, which is not installed yet: the create card is
 * the one that reads "In use". That is the branch the old picker got wrong. */
let activeProfile = "lifequest";

const READY = {
  kind: "ready" as const,
  port: 8642,
  baseUrl: "http://127.0.0.1:8642/p/lifequest",
  startedByLifeQuest: false,
  profilePath: "/root/.hermes/profiles/lifequest",
  cliPath: "/usr/local/bin/hermes",
  childPid: null,
};

type Doors = {
  localUrl: string;
  inviteUrl: string;
  localError: string | null;
  inviteError: string | null;
};

const OPEN_DOORS: Doors = {
  localUrl: "http://127.0.0.1:8643/mcp",
  inviteUrl: "http://127.0.0.1:8646/mcp",
  localError: null,
  inviteError: null,
};

/**
 * The doors are read once per mount, so the "a door could not bind" state is a
 * second load with the flag in the URL — the same shape the operator sees when
 * the port was taken before the page opened.
 */
const DOORS_FAILED: Doors = {
  ...OPEN_DOORS,
  inviteError: "Port 8646 is already in use.",
};

const nextDoors = new URLSearchParams(window.location.search).has("doorsError")
  ? DOORS_FAILED
  : OPEN_DOORS;

/** The next state of the world; the driver swaps these then reloads. */
let doors = nextDoors;
let filing = true;

const calls = {
  ensure: 0,
  useProfile: [] as string[],
  filing: [] as boolean[],
  openFolder: 0,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionEnsure: () => {
    calls.ensure += 1;
    return Promise.resolve(READY);
  },
  companionStatus: () => Promise.resolve(READY),
  companionProfilesList: () =>
    Promise.resolve({ active: activeProfile, profiles: PROFILES }),
  companionUseProfile: (name: string) => {
    calls.useProfile.push(name);
    activeProfile = name;
    return Promise.resolve(READY);
  },
  companionGetFiling: () => Promise.resolve(filing),
  companionSetFiling: (enabled: boolean) => {
    calls.filing.push(enabled);
    filing = enabled;
    return Promise.resolve();
  },
  companionOpenProfileFolder: () => {
    calls.openFolder += 1;
    return Promise.resolve();
  },
  mcpGetDoors: () => Promise.resolve(doors),
  onCompanionStatusChanged: () => () => {},
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

(window as unknown as { lifequest: unknown }).lifequest = stubbed;
(window as unknown as { settingsHermesCalls: typeof calls }).settingsHermesCalls = calls;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from settings-hermes.html");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <VaultProvider>
        <CompanionProvider>
          {/* The real sheet, over the real frame: the artifact has to be the
              surface the operator opens, not a panel on a harness width. */}
          <div className="app-root">
            <div className="app-root__body">
              <div className="shell" />
            </div>
          </div>
          <SettingsOverlay
            activeView="hermes"
            onViewChange={() => {}}
            onClose={() => {}}
          />
        </CompanionProvider>
      </VaultProvider>
    </ThemeProvider>
  </StrictMode>,
);

const knobs = {
  /** Replace the doors the page will read on its next load. */
  setDoors: (next: Doors) => {
    doors = next;
  },
  /** Replace the profile the companion is on, before the next load. */
  setActiveProfile: (name: string) => {
    activeProfile = name;
  },
};
(window as unknown as { settingsHermesKnobs: typeof knobs }).settingsHermesKnobs = knobs;

let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

// The page is settled when its four blocks, the switch and at least one profile
// card are all up: a partial paint is what the driver would otherwise measure.
const waitForPage = () => {
  const blocks = document.querySelectorAll(".settings-hermes__block");
  const toggle = document.querySelector('[role="switch"]');
  const cards = document.querySelectorAll(".companion-profile-row");
  const facts = document.querySelectorAll(".settings-fact");
  if (blocks.length < 4 || !toggle || cards.length === 0 || facts.length < 5) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

(window as unknown as { settingsHermesHarnessReady: Promise<void> }).settingsHermesHarnessReady =
  ready;
