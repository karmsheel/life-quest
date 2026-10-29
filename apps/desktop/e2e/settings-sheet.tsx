/**
 * E2E harness for the settings sheet (driven by `settings-sheet.electron.mjs`).
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. **The sheet is still a page.** If `/settings` unmounts the page behind it,
 *     the blurred backdrop is a picture of nothing and closing has nowhere to go
 *     back to. The rig mounts the same `useSettingsBackground` + route shape the
 *     app renders, so the background page is asserted by the driver while the
 *     sheet is up.
 *  2. **It is the window's share, not the sheet's measure.** The settings sheet
 *     stops at `72rem`; a panel sized in `%` inside a padded, scrolling column
 *     measures its parent, not the window. At this rig's 1280px window the two
 *     happen to coincide (~90%), which is exactly why the driver also asserts
 *     the absolute width — and why `settings-vault` proves the cap on a wider
 *     window: the panel must not grow while the mat beside it does.
 *  3. **The search is a full-width top bar again, or it misses the frame's
 *     edge.** It is a short field centred over the panel with the panel's top
 *     border running through its horizontal axis — half in the sheet, half over
 *     the scrim. A rig that only checked "a search input exists" would pass a
 *     bar that runs edge to edge, sits under the border, or hugs one side.
 *  4. **The backdrop does not blur.** `backdrop-filter` is a computed property a
 *     stylesheet typo silently drops; the scrim then reads as a plain dim and the
 *     "glass" is gone. The rig reads the property back, it does not trust the CSS.
 *  5. **The cross drifts to the trailing edge.** Hermes puts its close on the
 *     right; this sheet's brief puts it top *left*, beside the search bar. A rig
 *     that only checked "a close button exists" would pass either.
 *  6. **The search filters nothing, or filters the panel away.** A query must
 *     narrow the section list, move the panel to a match it can no longer see in
 *     the list, and leave the panel standing when nothing matches — a blank
 *     settings page is not an empty result.
 *  7. **A press inside closes it.** The scrim's `mousedown` handler must not fire
 *     for presses that land on the panel; a sheet dismissed by clicking the
 *     search bar would be unusable.
 *  8. **Escape closes a half-typed search.** It must clear the query first, and
 *     only close on the second press.
 *  9. **A starred theme does not reach the quick menu**, or reaches it in the
 *     wrong group, or does not survive a reload. The star is written to the same
 *     storage the popover reads at mount; the rig reloads the window to prove it.
 *
 * The rig seeds `lifequest-theme` and deliberately does not touch the favourites
 * key: the driver clears it before the first load, and the reload later must not
 * wipe what the star wrote.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { useSettingsBackground } from "@/components/settings/useSettingsBackground";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { UpdateProvider } from "@/state/UpdateProvider";
import { VaultProvider } from "@/state/VaultProvider";
import SettingsPage from "@/pages/SettingsPage";
import "@/styles/global.css";

/*
 * A stubbed bridge, the same shape the other settings rigs use: the sheet's
 * panels read the vault and the updater, and this window has neither. Every
 * unnamed channel answers ok(null), so a panel renders its empty state rather
 * than throwing. The Hermes and Agent pages want a live companion and are not
 * reached by this rig.
 */
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(null),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionEnsure: () => ok({ kind: "disconnected" }),
  companionProfilesList: () => ok({ profiles: [], active: null }),
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

/*
 * Dark, so the theme grid is deterministic: every built-in skin resolves a night
 * palette, so all seven tiles are in the quick menu's grid.
 */
try {
  localStorage.setItem("lifequest-theme", "dark");
} catch {
  /* ignore */
}

function RigPage() {
  return (
    <div className="rig-background" data-rig-page="home">
      <h1>The page behind the sheet</h1>
      <p>
        This page is what the scrim blurs. It stays mounted for as long as the
        sheet is open, and the sheet closes back onto it.
      </p>
    </div>
  );
}

function Harness() {
  const location = useLocation();
  const { background, sheetOverBackground } = useSettingsBackground();
  /*
   * A settings action that asks a question (deleting a domain) is the one thing
   * the sheet must not paint over: the dialog is raised from inside the sheet, so
   * it has to land ABOVE it, take the Escape key, and keep the caret while it is
   * up. The rig raises the app's own `ConfirmDialog` from a control of its own —
   * the sheet's panels ask the same way — so the driver can prove the stack
   * without a vault to delete from.
   */
  const [asking, setAsking] = useState(false);

  // The path a MemoryRouter never writes to the window; the driver reads it.
  useEffect(() => {
    document.body.dataset.rigPath = `${location.pathname}${location.search}`;
  }, [location]);

  return (
    <div className="app-root">
      <header className="rig-chrome">
        <Link to="/home" className="rig-link" data-rig-link="home">
          Home
        </Link>
        <Link to="/settings" className="rig-link" data-rig-open-settings="">
          Settings
        </Link>
        <button
          type="button"
          className="rig-link"
          data-rig-ask=""
          onClick={() => setAsking(true)}
        >
          Ask a question
        </button>
        <div className="rig-chrome__spacer" />
        <SettingsMenu placement="bottom-end" />
      </header>
      <div className="app-root__body">
        <Routes location={background}>
          <Route path="/home" element={<RigPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        {sheetOverBackground ? <SettingsPage /> : null}
      </div>
      <ConfirmDialog
        open={asking}
        title="Delete domain"
        message="Career (old) leaves the switcher for good. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onCancel={() => setAsking(false)}
        onConfirm={() => setAsking(false)}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from settings-sheet.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <ThemeProvider>
        <UpdateProvider>
          <VaultProvider>
            <Harness />
          </VaultProvider>
        </UpdateProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite transform
// cannot be mistaken for "the background page never painted".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForBackground = () => {
  if (!document.querySelector("[data-rig-page]")) {
    requestAnimationFrame(waitForBackground);
    return;
  }
  Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => settle())),
    );
  });
};
requestAnimationFrame(waitForBackground);

(window as unknown as { settingsSheetReady: Promise<void> }).settingsSheetReady =
  ready;
