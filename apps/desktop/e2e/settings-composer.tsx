/**
 * E2E harness for Settings → Composer (driven by `settings-composer.electron.mjs`).
 *
 * A system-in-isolation rig, so the ways it can fail are written down first:
 *
 *  1. The tab is missing from the sheet's nav, or it is not the second one after
 *     Keyboard: the setting is reached from the same section column as the rest,
 *     and its place there is part of what the operator was promised.
 *  2. The page renders no page: no "Composer" heading, no "How the message box
 *     sends" subtitle, and no `[data-composer-settings]` root for a rig (or a
 *     future test) to read the live choice from.
 *  3. The send key reads back wrong: the root does not say `modified` on a fresh
 *     window, or the `Ctrl/Cmd+Enter` radio is not the checked one.
 *  4. The hint under the row lies about the consequence: in `modified` it must
 *     say Enter breaks the line and Ctrl/Cmd+Enter sends.
 *  5. Pressing "Enter" does not reach the root, the radio, the hint — or
 *     `localStorage`, so the choice dies with the window.
 *  6. Reloading loses the choice: the page is the window's memory, and a reload
 *     is the cheapest proof it is really stored.
 *  7. Pressing `Ctrl/Cmd+Enter` does not put the window back, in the root, the
 *     radio and storage at once.
 *  8. The sheet's own search cannot find the page: typing "enter" must narrow
 *     the nav and keep Composer in it — a settings page nobody can find is a
 *     page nobody uses.
 *  9. A long line widens the sheet instead of wrapping inside it.
 *
 * The IPC bridge is stubbed (there is no Electron preload on a dev-server page);
 * the settings sheet, the real CSS and the real layout engine are shipping code.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsOverlay } from "@/components/settings/SettingsOverlay";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import type { SettingsViewId } from "@/lib/settings-views";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/**
 * The bridge a settings page asks for. The Composer page itself is window
 * storage and nothing else, but `ThemeProvider` and the sheet's frame read the
 * window chrome, and the Proxy below answers every unnamed channel with
 * `ok(null)` so no later page in the sheet can throw on a missing stub.
 */
const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(null),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  // ThemeProvider reads the profile's theme files at mount and subscribes for
  // writes from the companion. `themesList` is iterated and `onThemesChanged`
  // hands back an unsubscribe the effect calls on cleanup, so both need a real
  // shape: the generic fallback's `ok(null)`/Promise throws and takes the tree
  // down, leaving the driver a blank window.
  themesList: () => ok([]),
  themeGetState: () => ok({ keptFile: null }),
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
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    // Every `on*` channel is a subscription: main answers with an unsubscribe
    // function and the caller runs it from an effect cleanup. A Promise here
    // throws on cleanup and takes the tree with it.
    if (typeof prop === "string" && prop.startsWith("on")) return () => () => {};
    return () => ok(null);
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

/**
 * The real sheet over a page behind it: the sheet is a surface over the app, and
 * the artifact has to be the surface the operator opens. The active view is
 * state, not a constant, so the sheet's search can move the panel the way it
 * moves it in the app.
 */
function Harness() {
  const [view, setView] = useState<SettingsViewId>("composer");
  return (
    <>
      <div className="app-root">
        <div className="app-root__body">
          <div className="shell">
            <div className="rig-background" data-rig-page="home">
              <h1>The page behind the sheet</h1>
              <p>
                The settings sheet is drawn over this page, the way it is drawn
                over the app.
              </p>
            </div>
          </div>
        </div>
      </div>
      <SettingsOverlay
        activeView={view}
        onViewChange={setView}
        onClose={() => {}}
      />
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from settings-composer.html");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <Harness />
    </ThemeProvider>
  </StrictMode>,
);

// The driver waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the sheet never painted".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

/**
 * The page is settled when the shipped page is up: the request's root, the
 * "Send key" group, the hint, one nav row per section and the sheet's real
 * search field. A partial paint is what the driver would otherwise measure.
 */
const waitForPage = () => {
  const page = document.querySelector("[data-composer-settings]");
  const group = document.querySelector('[role="group"][aria-label="Send key"]');
  const hint = document.querySelector("[data-composer-send-hint]");
  const search = document.querySelector(".settings-overlay__search-input");
  const nav = document.querySelectorAll(".settings-nav-item").length;
  if (!page || !group || !hint || !search || nav < 13) {
    requestAnimationFrame(waitForPage);
    return;
  }
  Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => settle())),
    );
  });
};
requestAnimationFrame(waitForPage);

(window as unknown as { settingsComposerHarnessReady: Promise<void> }).settingsComposerHarnessReady =
  ready;
