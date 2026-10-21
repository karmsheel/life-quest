/**
 * E2E harness for the Settings surfaces the update feature owns — Updates and
 * Developer (driven by `update-badge.electron.mjs` with `view=settings` or
 * `view=developer`).
 *
 * A harness of its own rather than a branch inside `update-badge.tsx`, because a
 * page's module graph is evaluated once per load: a flag read off the query
 * string decides what that one page mounts, and flipping it for a later
 * navigation turns out to be decided by whatever the dev server and the browser
 * cache do with a module URL that has not changed. Separate pages, each mounting
 * only what its own assertions cover — and which of the two panels it opens is
 * itself read off the query string, for the same reason.
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. "Check now" does not force the feed, so the operator asking by hand is
 *     answered from the session's cache instead of from GitHub.
 *  2. The page still asks for a token, or still claims the feed needs one, after
 *     the repository became public.
 *  3. The Developer switch does not write its preference, so the rail never
 *     glows from it.
 *  4. The switch writes the preference but does not clear it, leaving the app
 *     glowing on the next launch with no visible cause.
 *  5. The switch reports a state the rail is not actually in — "previewing" while
 *     a real release is the thing being shown.
 *
 * The bridge is stubbed (there is no Electron preload on the dev-server page);
 * the real `UpdateProvider`, the real `SettingsContent` with its real split
 * layout, the real `SettingsUpdates` and `SettingsDeveloper`, and the real CSS
 * are shipping code.
 */
import { StrictMode } from "react";
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

/** The feed with nothing to offer — what "up to date" looks like. */
const CURRENT = {
  state: "current" as const,
  current: appVersion,
  latest: appVersion,
};

/**
 * A harness shares the Electron profile — and therefore `localStorage` — with
 * every other rig. The card width handle is a developer flag that defaults OFF,
 * but a previous run (or the operator's own build) may have left it on. Clear it
 * before mounting, so "off by default" is measured from the default rather than
 * from whatever the last run chose. The update preview beside it is seeded from
 * the query string for the same reason.
 */
try {
  window.localStorage.removeItem("lifequest-dev-card-width-handle");
} catch {
  // No storage: the flag reads off, which is the state this page is about.
}

/** Which answer the stub feed gives, off the page's own query string. */
const scenario = new URLSearchParams(window.location.search).get("scenario");

/**
 * Which Settings panel this page opens, off the query string. A prop decided at
 * mount rather than something switched later, so each page load mounts one panel
 * and the driver navigates by loading another.
 */
const view = ((): "updates" | "developer" =>
  new URLSearchParams(window.location.search).get("view") === "developer"
    ? "developer"
    : "updates")();

/** What the stub bridge was asked for, so the driver can assert on the calls. */
const calls: {
  check: ({ force?: boolean } | null)[];
  openRoll: unknown[];
} = { check: [], openRoll: [] };

const bridge: Record<string, unknown> = {
  updateCheck: (options?: { force?: boolean }) => {
    calls.check.push(options ?? null);
    return Promise.resolve({
      ok: true as const,
      decision: scenario === "available" ? AVAILABLE : CURRENT,
    });
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

function Harness() {
  return (
    <ThemeProvider>
      <UpdateProvider>
        {/* The real Settings surface, with one panel selected — not the panel on
            its own: the split layout and its scroll column are what constrain the
            content's width, and a rig that skipped them would judge the view on a
            shape the app never renders. */}
        <div className="settings-page-shell">
          <SettingsContent activeView={view} onViewChange={() => {}} />
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
  // Whichever panel this page opened, its own first element is the signal.
  const found =
    view === "developer"
      ? document.querySelector("[data-developer-preview]")
      : document.querySelector("[data-update-summary]");
  if (!found) {
    requestAnimationFrame(waitForView);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
});

(Object.assign(window, {
  updateHarnessReady: ready,
  updateHarness: { view, calls },
}) as unknown as Record<string, unknown>);
