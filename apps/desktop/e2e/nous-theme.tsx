/**
 * E2E harness for the two Nous skins (driven by `nous-theme.electron.mjs`).
 *
 * Both skins are **palettes and nothing else** — that is the design style being
 * implemented, not an omission. Hermes Desktop's theme model keeps layout,
 * sizing, radius and typography out of the palette, and both of its Nous themes
 * declare only the system font stacks, no imagery and no second accent. So there
 * is no `[data-skin]` CSS layer to measure any more, and this harness mounts the
 * real `WelcomePage` inside the real shell purely so the rig can photograph what
 * the palette actually paints.
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. The palette does not reach the DOM at all — `data-skin` unset, or a token
 *     name the app never writes. Every colour assertion then passes against
 *     `tokens.css` defaults while the app looks like Forge OS.
 *  2. **A derived accent tint drifts violet.** This is the failure the whole
 *     design style exists to prevent: blending a saturated blue toward a surface
 *     in gamma-encoded sRGB rotates its hue, so `--accent-tint`, the input edge
 *     and the chip fill come out lilac even though the palette's own hexes are
 *     correct. It cannot be caught by reading palette values, because the drift
 *     happens after them.
 *  3. A light-only or dark-only palette (the preset ships both), so one mode
 *     falls back to the other skin's colours.
 *  4. Nous Classic mistaken for Nous, or vice versa — the two share a brand blue
 *     and differ only in what they do with it.
 *  5. The control: Forge OS must be untouched.
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
import { applySkin } from "@/lib/themes/apply-skin";
import { mix, mixOklab } from "@/lib/themes/color";
import { resolveSkin } from "@/lib/themes/registry";
import { skinSupportsBothModes, skinSupportsMode } from "@/lib/themes/presets";
import "@/styles/global.css";

// Seed the product's own storage so `ThemeProvider` resolves the skin and the
// mode through its real code path, not through a test-only shortcut.
try {
  localStorage.setItem("lifequest-skin", "nous");
  localStorage.setItem("lifequest-theme", "light");
} catch {
  /* ignore */
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(null),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
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
if (!root) throw new Error("#root missing from nous-theme.html");

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

// --- Driver hooks -----------------------------------------------------------

(window as unknown as { nousHarness: unknown }).nousHarness = {
  /** Apply a skin and mode through the product's own writer. */
  apply(name: string, mode: "light" | "dark") {
    document.documentElement.setAttribute("data-theme", mode);
    applySkin(resolveSkin(name), mode);
    return document.documentElement.getAttribute("data-skin");
  },

  /** Which preferences each skin is offered under — the picker filters on this. */
  supportsModes(name: string) {
    const skin = resolveSkin(name);
    return {
      light: skinSupportsMode(skin, "light"),
      dark: skinSupportsMode(skin, "dark"),
      both: skinSupportsBothModes(skin),
    };
  },

  /**
   * The design-style invariant, measured rather than asserted by reading code:
   * blend the Nous brand seed 88% toward white both ways and report each
   * result's hue and its distance from the seed's.
   *
   * Hermes documents the expected outcome — "a saturated blue mixed 88% toward
   * white lands 7.6° violet of where it started" — so the rig checks that the
   * sRGB path really does drift and the OKLab path really does not. If `mixOklab`
   * ever degrades to a plain channel lerp, this fails.
   */
  oklabCheck(seed: string) {
    const hueOf = (hex: string) => {
      const n = parseInt(hex.replace("#", ""), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
        v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
      );
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
      const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
    };
    const delta = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);

    const srgb = mix(seed, "#ffffff", 0.88);
    const oklab = mixOklab(seed, "#ffffff", 0.88);
    const seedHue = hueOf(seed);
    return {
      seed,
      seedHue,
      srgb,
      srgbHue: hueOf(srgb),
      srgbDrift: delta(hueOf(srgb), seedHue),
      oklab,
      oklabHue: hueOf(oklab),
      oklabDrift: delta(hueOf(oklab), seedHue),
    };
  },
};

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the theme never applied".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForSurface = () => {
  const pane = document.querySelector(".welcome");
  if (!pane) {
    requestAnimationFrame(waitForSurface);
    return;
  }
  Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => settle())),
    );
  });
};
requestAnimationFrame(waitForSurface);

(window as unknown as { nousHarnessReady: Promise<void> }).nousHarnessReady = ready;
