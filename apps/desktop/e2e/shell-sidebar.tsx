/**
 * E2E harness for the left sidebar's docked layout (driven by
 * `shell-sidebar.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. Rail still framed — any top/left/bottom inset where the change asks for a
 *     panel flush with the window (the bug this rig was built for).
 *  2. Rail stops at the tray instead of the window — top edge level with the
 *     workspace sheet rather than with the window's own top.
 *  3. Rail painted *under* the titlebar — the rail's box overlaps the titlebar
 *     row, but the titlebar wins paint order, so the rail's topband and its one
 *     control are covered by the titlebar's background.
 *  4. Topband shows more than the collapse toggle (or nothing) — a second
 *     control crept into the header, or the toggle never rendered.
 *  5. Dead toggle — clicking it leaves the rail on screen.
 *  6. One-way door — collapsed with no control left anywhere to reopen.
 *  7. Column not returned — collapsing leaves the 4.25rem track (and its gap)
 *     behind, so the workspace sheet never reclaims the width.
 *  8. Titlebar text still in the rail's corner — the LQ badge and title not
 *     stepping aside by the track width, so they sit on top of the sidebar.
 *  9. Rail scrolls its own topband away, or spills past the window box.
 * 10. Bridge stubs masking real calls — anything the shell reaches for that is
 *     not named here must not throw.
 * 11. Night ladder half-applied — the sheet keeps the card step it used to wear,
 *     so the page canvas and the cards are one tone and the cards stop reading as
 *     surfaces on a page.
 * 12. Night ladder applied to the wrong side — the rail and the strip painted
 *     *below* the page canvas, which is the "darkest chrome, lightest page" order
 *     this rig exists to keep out.
 * 13. Cards left on the pre-swap panel ink — `.home-card` / `.view-card` deeper
 *     than the page canvas, so the cards punch holes in the page instead of
 *     stepping up off it.
 * 14. Day knocked over — the shared sheet rule dragging the night ladder into the
 *     light theme, where the mat and the panels must keep sinking below the sheet.
 * 15. The mat drifting off the dock's own band — the sidebar and the strip a
 *     near-miss grey beside the `.chat-panel__actions` row they are meant to match.
 * 16. Lines creeping back between the panes — a hairline on the sheet's top,
 *     leading or bottom edge, on the rail's trailing edge, or on any edge of the
 *     dock. The studio has exactly one: the sheet's trailing edge, the seam with
 *     the dock. The line under the strip belongs to the top bar, and it must
 *     survive: lose it and the wing and domain selectors lose their underline.
 * 17. Native bar left in place — a scroller whose gutter is the platform's own
 *     15-17px instead of the app's 8px, which is what a `::-webkit-scrollbar`
 *     rule that never applied looks like.
 * 18. Scrollbar ink off the palette — a thumb reading a colour from another skin,
 *     or worse the accent, so the chrome wears the brand.
 * 19. Thumb invisible at rest, or unstrengthened on hover — a bar an operator
 *     cannot find, or one that never responds to the pointer. It is quiet at rest
 *     on purpose and must still be DRAWN; a custom scrollbar also follows its own
 *     region, not hover anywhere in the app.
 * 20. A frame back around either selector on the band — `.ui-segmented`'s shared
 *     hairline, sitting one pixel outside the active tab's own, is what made the
 *     wing switcher and the domain lens read as two concentric outlines in a row.
 *     The pair carries no outer frame; the fill is what sets each off the band,
 *     and the active tab keeps its line. Both halves are measured, so "frameless"
 *     cannot be satisfied by a control that stopped rendering its fill or its tab.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page); everything else — the real AppShell, the real NavRail, the real
 * WindowTitleBar, the real CSS and the real layout engine — is shipping code.
 *
 * The sheet and the transcript are both seeded to overflow (60 filler lines, 40
 * turns) because a scrollbar claim needs a scroller that actually scrolls: with
 * nothing to scroll there is no bar, and every claim about one would pass for the
 * wrong reason.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { applySkin } from "@/lib/themes/apply-skin";
import { BUILTIN_SKINS, DEFAULT_SKIN_NAME } from "@/lib/themes/presets";
import { applyThemePreference } from "@/lib/theme";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** The vault name the titlebar chip must wear — the driver reads it off the page
 *  rather than hard-coding the same string twice. */
const VAULT_NAME = "Harness Vault";

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

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Shell sidebar harness",
  lastActive: 1_700_000_000,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    // Long enough that the transcript really overflows its scrollport. The
    // scrollbar claims need a scroller that scrolls: a one-line transcript has no
    // bar to measure, and "no bar" would pass every claim below for the wrong
    // reason.
    ok(
      Array.from({ length: 40 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Shell sidebar harness turn ${i + 1}`,
      })),
    ),
  onCompanionStream: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar shows
  // its trailing cluster (theme, settings, chat) and not the fallback controls.
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
if (!root) throw new Error("#root missing from shell-sidebar.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route
                        path="/home"
                        element={
                          <div className="stub-page">
                            {/*
                              Card probes. The ladder is measured on the shipping
                              card rules — these two classes are what the dashboard
                              paints — so a change to them shows up here instead of
                              passing on a fill no page in the app renders.
                            */}
                            <div className="home-dashboard">
                              <div className="home-card" data-probe="home-card" />
                              <div className="view-card" data-probe="view-card" />
                            </div>
                            {/*
                              The sheet's scroller has to really overflow, for the
                              same reason the transcript does: a scrollbar claim
                              measured on a region with nothing to scroll is a claim
                              about an empty box. Drawn AFTER the two probes, and
                              carrying no app class, so the ladder probes keep the
                              geometry and the ink they were measured with.
                            */}
                            {Array.from({ length: 60 }, (_, i) => (
                              <p key={i} className="muted" data-probe="sheet-filler">
                                Sheet filler line {i + 1}
                              </p>
                            ))}
                          </div>
                        }
                      />
                    </Route>
                  </Routes>
                </div>
              </div>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the rail never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const rail = document.querySelector(".nav-rail");
  const titlebar = document.querySelector(".window-titlebar");
  if (!rail || !titlebar) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

(window as unknown as { shellHarnessReady: Promise<void> }).shellHarnessReady =
  ready;

// Paired with `shellHarnessReady`: the assertions about the vault chip need the
// name the harness actually handed the shell.
(
  window as unknown as { shellHarnessVaultName: string }
).shellHarnessVaultName = VAULT_NAME;

/**
 * Switch the harness's skin and mode for the rig's night sweep — the same two
 * product calls `ThemeProvider` makes when the preference or the skin changes
 * (`applyThemePreference` + `applySkin`), so the sweep measures the shipping
 * writer on every palette rather than a stub. Reached this way instead of through
 * the stored preference so a sweep of six palettes costs no page reloads and
 * leaves the operator's own stored theme and skin untouched.
 *
 * The stored-preference path itself is the provider's, and the rigs that mount
 * `ThemeProvider` cover it.
 *
 * Returns the resolved skin name, so a driver can assert the palette landed and a
 * sweep cannot quietly measure the previous one.
 */
(
  window as unknown as {
    shellHarnessApplyTheme: (
      skinName: string,
      mode: "light" | "dark",
    ) => string;
  }
).shellHarnessApplyTheme = (skinName, mode) => {
  const skin = BUILTIN_SKINS[skinName] ?? BUILTIN_SKINS[DEFAULT_SKIN_NAME]!;
  applyThemePreference(mode);
  applySkin(skin, mode);
  return skin.name;
};

/**
 * Which way a skin's night ladder runs. The rig reads this rather than hardcoding
 * a name: a skin that is a faithful copy of an upstream theme may inherit that
 * theme's own elevation direction (GitHub Dark Default puts its cards below its
 * page), and the rig asserts the declared direction instead of the standard one.
 */
(
  window as unknown as {
    shellHarnessDarkLadder: (skinName: string) => string;
  }
).shellHarnessDarkLadder = (skinName) =>
  (BUILTIN_SKINS[skinName] ?? BUILTIN_SKINS[DEFAULT_SKIN_NAME]!)?.darkLadder ??
  "standard";
