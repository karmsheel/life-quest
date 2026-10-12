/**
 * E2E harness for the Settings → Updates view (driven by
 * `update-badge.electron.mjs` with `view=settings`).
 *
 * A harness of its own rather than a branch inside `update-badge.tsx`, because a
 * page's module graph is evaluated once per load: a flag read off the query
 * string decides what that one page mounts, and flipping it for a later
 * navigation turns out to be decided by whatever the dev server and the browser
 * cache do with a module URL that has not changed. Two surfaces, two pages — each
 * one mounting only what it asserts on.
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. The token row reports the wrong state — "Stored" when nothing is stored, or
 *     "Not set" after a save, which is the one lie that would let an operator
 *     believe the feed is authenticated when it is not.
 *  2. Saving never reaches the bridge, or reaches it with a value that was not
 *     what was typed.
 *  3. The secret is left in the field after it has been stored — a shoulder-surfed
 *     token and a second save on the next keystroke.
 *  4. `Remove` is offered with nothing to remove, or never enabled once there is.
 *  5. A refusal from the bridge is reported as success.
 *  6. "Check now" does not force the feed, so the operator asking by hand is
 *     answered from the session's cache instead of from GitHub.
 *
 * The bridge is stubbed (there is no Electron preload on the dev-server page);
 * the real `UpdateProvider`, the real `SettingsUpdates`, the real `Button`,
 * `SettingsSection` and `SettingsRow`, and the real CSS are shipping code.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { version as appVersion } from "../package.json";
import { SettingsContent } from "@/components/settings/SettingsContent";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { UpdateProvider } from "@/state/UpdateProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/**
 * The offered release, with `current` read off the app's own `package.json` — the
 * same file the view renders its own number from, so a version bump cannot make
 * the two disagree.
 */
const AVAILABLE = {
  state: "available" as const,
  current: appVersion,
  latest: "0.4.0",
  title: "LifeQuest 0.4.0",
  notes: "## Added\n\n- The build number glows when a newer release exists",
  publishedAt: "2026-03-01T09:00:00Z",
  releaseUrl: "https://github.com/karmsheel/life-quest/releases/tag/v0.4.0",
  installer: {
    name: "LifeQuest-0.4.0-setup.exe",
    url: "https://github.com/karmsheel/life-quest/releases/download/v0.4.0/LifeQuest-0.4.0-setup.exe",
    size: 4_194_304,
  },
};

/** What the stub bridge was asked for, so the driver can assert on the calls. */
const calls: {
  check: ({ force?: boolean } | null)[];
  setToken: unknown[];
  clearToken: number;
  openRoll: unknown[];
} = { check: [], setToken: [], clearToken: 0, openRoll: [] };

/** Whether the stub says a token is stored, and what a save does to it. */
let tokenStored = false;
let refuseNext = false;

const bridge: Record<string, unknown> = {
  updateCheck: (options?: { force?: boolean }) => {
    calls.check.push(options ?? null);
    return Promise.resolve({ ok: true as const, decision: AVAILABLE });
  },
  updateTokenStatus: () => Promise.resolve(tokenStored),
  updateSetToken: (token: unknown) => {
    calls.setToken.push(token);
    if (refuseNext) {
      return Promise.resolve({
        ok: false as const,
        error: "OS secure storage is unavailable; cannot persist the token",
      });
    }
    tokenStored = true;
    return ok(true);
  },
  updateClearToken: () => {
    calls.clearToken += 1;
    tokenStored = false;
    return ok(true);
  },
  updateOpenReleasePage: (url: unknown) => {
    calls.openRoll.push(url);
    return ok(true);
  },
  updateInstall: () => Promise.resolve({ ok: true as const, launched: true as const, installer: "", bytes: 0 }),
  onUpdateProgress: () => () => {},
  // ThemeProvider reaches for this on every mount, and the proxy's generic answer
  // is a *function* — so `windowChrome.setTitleBarOverlay` would be undefined and
  // the whole tree would come down before anything could be asserted.
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
if (!root) throw new Error("#root missing from update-settings.html");

/**
 * The provider is keyed so the driver can unmount and remount it, the same way
 * the badge harness does: it is the only way to run the progress subscription's
 * cleanup.
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
        {/* The real Settings surface, with Updates selected — not the panel on its
            own: the split layout and its scroll column are what constrain the
            field's width, and a rig that skipped them would judge the view on a
            shape the app never renders. */}
        <div className="settings-page-shell">
          <SettingsContent activeView="updates" onViewChange={() => {}} />
        </div>
      </UpdateProvider>
    </ThemeProvider>
  );
}

createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the view never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
requestAnimationFrame(function waitForView() {
  const summary = document.querySelector("[data-update-summary]");
  const input = document.querySelector(".settings-updates__token input");
  if (!summary || !input) {
    requestAnimationFrame(waitForView);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
});

(Object.assign(window, {
  updateHarnessReady: ready,
  updateHarness: {
    calls,
    tokenStored: () => tokenStored,
    /** Make the next save fail, for the refusal path. */
    refuseNextSave: (refuse: boolean) => {
      refuseNext = refuse;
      return true;
    },
    remount: () => {
      remount();
      return true;
    },
  },
}) as unknown as Record<string, unknown>);
