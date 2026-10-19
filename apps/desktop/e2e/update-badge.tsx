/**
 * E2E harness for the auto-update badge and its popup (driven by
 * `update-badge.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. The version line is a control when there is nothing to install — a focus
 *     stop and a click target in a column of quiet nav rows, for no reason. At
 *     rest it must be the same paragraph it has always been.
 *  2. The glow is missing when a newer release exists, so the operator never
 *     learns about it.
 *  3. The glow is drawn as something other than the state ink, or with no alpha
 *     at all: a `box-shadow: none`, or a shadow on a colour the theme does not
 *     hand out. It must be a real, accent-tinted halo.
 *  4. Clicking the glowing number opens nothing.
 *  5. The popup does not name both versions, so the operator cannot tell what
 *     they are being asked to move from and to.
 *  6. The popup cannot be dismissed — a modal with no way out but the installer.
 *  7. Clicking "Download and install" never reaches the bridge, or reaches it
 *     more than once.
 *  8. The download's progress never appears, so a long install looks hung.
 *  9. A failed install is reported as nothing, leaving the popup looking like it
 *     is still working.
 * 10. An update-check answer the bridge does not recognise (`{ ok: true,
 *     value: null }`, from a stub that never heard of this channel) is treated as
 *     an available update, or throws and takes the whole rail down with it.
 * 11. An `onUpdateProgress` handle that is not a function — the cleanup must not
 *     call it.
 * 12. The glow makes the rail taller than its own column, so the build number
 *     scrolls the rail's topband away.
 * 13. The glow arrives without a sentence: a pill reading `v0.1.4` and nothing
 *     else leaves the operator to guess. The words must sit above it, stay a
 *     paragraph rather than a second focus stop, leave the Log row above
 *     themselves, and be gone again when there is nothing to install.
 *
 * The bridge is stubbed (there is no Electron preload on the dev-server page);
 * everything else — the real `UpdateProvider`, the real `NavRail`, the real
 * `UpdateBadge`, the real `UpdateDialog`, the real CSS — is shipping code.
 *
 * Which answer the stub gives is read from `localStorage`, the same way the
 * sidebar rig reads the theme: the driver flips a preference and reloads, so one
 * page can be driven through every state without a second harness.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { version as appVersion } from "../package.json";
import { AppShell } from "@/components/shell/AppShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { UpdateProvider } from "@/state/UpdateProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const VAULT_NAME = "Harness Vault";

type Scenario = "available" | "current" | "junk" | "install-fails";

/**
 * Which answer the stub feed gives, off the page's own query string.
 *
 * A query parameter rather than `localStorage`, because the driver has to pick a
 * scenario *before* the page is loaded even once — and there is no origin to
 * write to until then. The driver flips the query and reloads, so one page can be
 * driven through every state without a second harness.
 */
const scenario = ((): Scenario => {
  const asked = new URLSearchParams(window.location.search).get("scenario");
  return asked === "current" || asked === "junk" || asked === "install-fails"
    ? asked
    : "available";
})();

/**
 * The release the stub feed answers with, and the build this page *is*.
 *
 * `current` is read off the app's own `package.json` rather than written down
 * here: the badge's number comes from that same file, so a hard-coded copy would
 * start failing the day the version is bumped — a rig breaking on a release, for
 * a reason that has nothing to do with what it tests.
 *
 * The offered release is a fixed fixture, deliberately far ahead. It has to stay
 * newer than `appVersion`; the driver guards that rather than assuming it.
 */
const AVAILABLE = {
  state: "available" as const,
  current: appVersion,
  latest: "0.4.0",
  title: "LifeQuest 0.4.0",
  notes: "## Added\n\n- The build number glows when a newer release exists\n- A popup that names what changed",
  publishedAt: "2026-03-01T09:00:00Z",
  releaseUrl: "https://github.com/karmsheel/life-quest/releases/tag/v0.4.0",
  installer: {
    name: "LifeQuest-0.4.0-setup.exe",
    url: "https://github.com/karmsheel/life-quest/releases/download/v0.4.0/LifeQuest-0.4.0-setup.exe",
    size: 4_194_304,
  },
};

const CURRENT = {
  state: "current" as const,
  current: appVersion,
  latest: appVersion,
};

const SNAPSHOT = {
  rootPath: "C:/harness-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "harness-vault",
    name: VAULT_NAME,
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

/** One chat row, so the dock has something of the right shape to render. */
const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Update badge harness",
  lastActive: 1_700_000_000,
};

/** What the stub bridge was asked for, so the driver can assert on the calls. */
const calls: {
  check: unknown[];
  install: unknown[];
  openRoll: unknown[];
} = { check: [], install: [], openRoll: [] };

/** The progress channel, held so the driver can push an event through it. */
let progressListener: ((progress: { downloaded: number; total: number }) => void) | null =
  null;

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  // The dock is part of the real shell this harness mounts, so the channels its
  // own mount reaches for are answered here. The rest fall through to the proxy
  // below; a channel that returns `ok(null)` where a list was expected takes the
  // whole tree down with it, which is what happened before these three lines.
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () => ok([]),
  onCompanionStream: () => () => {},

  updateCheck: (options?: { force?: boolean }) => {
    calls.check.push(options ?? null);
    // A stub that has never heard of this channel answers junk. That is the
    // answer the whole renderer has to survive.
    if (scenario === "junk") return Promise.resolve(null);
    // The real bridge's own shape: `{ ok, decision }`, not the generic
    // `{ ok, value }` the rest of this proxy hands out. Main's `checkForUpdate`
    // is what decides that, and a harness that got it wrong would be testing a
    // shape no product code produces.
    return Promise.resolve({
      ok: true as const,
      decision: scenario === "current" ? CURRENT : AVAILABLE,
    });
  },
  updateInstall: (asset: unknown) => {
    calls.install.push(asset);
    if (scenario === "install-fails") {
      return Promise.resolve({
        ok: false as const,
        error: "Windows would not start the installer: no handler for .exe",
      });
    }
    // Never resolves: a successful install ends with the app quitting, so the
    // popup must sit in its installing state rather than fall back to an offer.
    return new Promise(() => {});
  },
  updateOpenReleasePage: (url: unknown) => {
    calls.openRoll.push(url);
    return ok(true);
  },
  onUpdateProgress: (cb: unknown) => {
    progressListener =
      typeof cb === "function"
        ? (cb as (progress: { downloaded: number; total: number }) => void)
        : null;
    // Scenario "junk" answers with a non-function, exactly as a Proxy-based stub
    // that does not know this channel would. The provider's cleanup must not
    // call it.
    return scenario === "junk" ? null : () => {};
  },

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

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from update-badge.html");

/**
 * The provider is keyed so the driver can unmount and remount it. That is the
 * only way to run the progress subscription's *cleanup*, which is where a bridge
 * that answers with junk instead of an unsubscribe handle would be called and
 * throw — a failure mode no amount of clicking can reach.
 */
let generation = 0;
let remount: () => void = () => {};

function Harness() {
  const [generationState, setGeneration] = useState(generation);
  useEffect(() => {
    remount = () => setGeneration((value) => value + 1);
  }, []);
  return (
    <ThemeProvider>
      <UpdateProvider key={generationState}>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <div className="app-root__body">
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route
                        path="/home"
                        element={<div className="stub-page">Update badge harness</div>}
                      />
                    </Route>
                  </Routes>
                </div>
              </div>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </UpdateProvider>
    </ThemeProvider>
  );
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <Harness />
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the chip never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
requestAnimationFrame(function waitForRail() {
  const found =
    document.querySelector(".nav-rail") &&
    document.querySelector(".nav-rail__version");
  if (!found) {
    requestAnimationFrame(waitForRail);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
});

const harness = {
  scenario,
  appVersion,
  calls,
  /** Push a progress event through the bridge listener the provider installed. */
  push: (downloaded: number, total: number) => {
    if (!progressListener) return false;
    progressListener({ downloaded, total });
    return true;
  },
  listenerAttached: () => typeof progressListener === "function",
  /** Unmount and remount the provider, so its effect cleanups really run. */
  remount: () => {
    remount();
    return true;
  },
  vaultName: VAULT_NAME,
};

(Object.assign(window, {
  updateHarnessReady: ready,
  updateHarness: harness,
}) as unknown as Record<string, unknown>);
