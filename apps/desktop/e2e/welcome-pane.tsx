/**
 * E2E harness for the welcome pane's frame (driven by
 * `welcome-pane.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. Pane still framed — a top/right/bottom inset where the change asks for a
 *     pane flush with the window's own edges (the bug this rig was built for).
 *  2. Pane short of an edge it should reach — bottom or trailing inset, or a
 *     leading inset it should not have (the rail does not exist here).
 *  3. Pane tucked under the titlebar — its top edge level with the window's top
 *     rather than one pane gap below the strip, so the strip and the pane read
 *     as one surface instead of two.
 *  4. Rounded corners — a corner radius on a box flush with the window's edge
 *     leaves a notch the canvas shows through, which is the gap coming back.
 *  5. Floating on a shadow — a pane flush with three window edges has its shadow
 *     clipped on all three, so what survives is a halo along the one seam it
 *     does not share with the window; the sheet is the only pane that keeps one.
 *  6. No frame of its own — the pane is the one box here, so the hairline on its
 *     four sides is the only line the window draws.
 *  7. Pane spills past the window — a negative margin that overshoots turns into
 *     a scrollbar the operator can drag the layout sideways with.
 *  8. Right surface — the pane stopped wearing `--card`, so it no longer matches
 *     the workspace sheet it stands in for.
 *  9. Bridge stubs masking real calls — anything the boot surfaces reach for
 *     that is not named here must not throw.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page) and the vault is reported as none, so `WelcomePage` renders; everything
 * else — the real `WindowTitleBar`, the real pane markup, the real CSS and the
 * real layout engine — is shipping code. `CompanionSetupScreen` renders the same
 * `.welcome` box inside the same `.app-root__body`, so this rig's contract
 * covers both boot surfaces.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import WelcomePage from "@/pages/WelcomePage";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const bridge: Record<string, unknown> = {
  // No vault: this is the surface the operator sees before one is open.
  vaultGetSnapshot: () => ok(null),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar shows
  // its trailing cluster and not the fallback controls.
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
if (!root) throw new Error("#root missing from welcome-pane.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/welcome"]}>
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Routes>
                    <Route path="/welcome" element={<WelcomePage />} />
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
// transform cannot be mistaken for "the pane never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForPane = () => {
  const pane = document.querySelector(".welcome");
  const titlebar = document.querySelector(".window-titlebar");
  if (!pane || !titlebar) {
    requestAnimationFrame(waitForPane);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPane);

(window as unknown as { welcomeHarnessReady: Promise<void> }).welcomeHarnessReady =
  ready;
