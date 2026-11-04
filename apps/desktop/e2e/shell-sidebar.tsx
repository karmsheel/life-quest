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
 *     control crept into the header, or the toggle never rendered at one of the
 *     rail's two widths.
 *  5. Dead toggle — clicking it leaves the shell in the arrangement it was in:
 *     the rail does not narrow to the icon column and the sheet does not move
 *     to meet it.
 *  6. One-way door — collapsed with no control left to expand, or the way back
 *     placed somewhere other than the rail's own header (the titlebar toggle the
 *     reported bug put over the vault chip).
 *  7. Column not narrowed — the shell's first track changes but the sheet or the
 *     chip keeps the wide rail's offset, so the page starts in a column the rail
 *     does not fill. The rail and the page must share one edge at both widths.
 *  7a. Rail unmounted on collapse — `display: none` on the rail (or no
 *     `.nav-rail` at all), the old behaviour that gave the column back to the
 *     sheet and slid the chip to the window's leading edge.
 *  7b. A second toggle in the titlebar — the reported bug: a
 *     `.window-titlebar__nav-toggle` rendered in the strip when the rail
 *     collapsed, overlapping the Personal chip. No such element may exist in
 *     either state; the rail keeps its one toggle, and the chip lives in the
 *     rail's foot, out of the strip entirely (round 2).
 *  7c. Contents left behind in the thin rail — the labelled chats section, the
 *     divider above it or the row labels still rendered in the 56px column; or
 *     the rows themselves hidden with them, leaving an icon column with no pages
 *     in it.
 *  7d. The wing switcher abandoned on collapse — the five-wing band hidden when
 *     the rail narrows (round 1's behaviour), or left horizontal/overflowing
 *     instead of a vertical stack of all five wings inside the icon column, or
 *     the wing's page rows rendered above it. The wings must stay reachable at
 *     both widths.
 *  7e. The vault chip still in the titlebar — a `.window-titlebar__vault` in the
 *     strip. Round 2 moved it into the rail's foot: the strip's leading half is
 *     an empty drag handle and the titlebar carries no nav-column classes.
 *  7f. The chip outside the rail's foot — a chip floating somewhere else in the
 *     rail, or a `.nav-rail__foot[data-nav-group="footer"]` that is not exactly
 *     the Log row and the chip.
 *  7g. The wide foot not split — the chip hugging its text or taking the whole
 *     row, so the Log is not half the footer, or the two not sharing one height.
 *  7h. The thin chip not reduced — the full name or the chevron still drawn in
 *     the 56px column, no initials mark, the wrong initials (the harness vault
 *     "Harness Vault" must read "HV"), or the chip not the rail's last control.
 *  8. Titlebar text still in the strip — the LQ badge, title or a vault chip
 *     still rendered in the window's top row. The strip's open room on either
 *     side of the domain tab is the window's drag handle; the only control in
 *     its row now is that tab (20b-20f).
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
 * 15. The dock's action band drifting off the strip — the bottom icon row a
 *     near-miss grey instead of the titlebar's own fill, so the dock stops being
 *     capped top and bottom by one material.
 * 16. Lines creeping back between the panes — a hairline on the sheet's top,
 *     leading or bottom edge, on the rail's top, leading or bottom edge, or on
 *     any edge of the dock. The studio has exactly two: the rail's trailing edge
 *     (the rail|sheet seam, inside the rail's width at both widths) and the
 *     sheet's trailing edge, the seam with the dock. The sheet's leading edge
 *     must stay unpainted so the rail's line is a line and not a two-pixel band.
 *     The sheet has no band of its own any more, so no line runs across it
 *     under the strip: the page starts at the strip's bottom edge. The dock's
 *     header keeps its own hairline — that line is the dock's, not a shared
 *     band's — and the rail's own band paints nothing of its own, so the line
 *     stops at the dock's leading edge.
 * 17a. Mats creeping back under the strip — the titlebar's night fill starting at
 *     the window's leading edge instead of at the rail's trailing edge, a pane
 *     gap reopening between the strip and the sheet/dock, or the raised domain
 *     tab failing to reach the page's top edge so a mat line separates them.
 * 18. Native bar left in place — a scroller whose gutter is the platform's own
 *     15-17px instead of the app's 8px, which is what a `::-webkit-scrollbar`
 *     rule that never applied looks like.
 * 18. Scrollbar ink off the palette — a thumb reading a colour from another skin,
 *     or worse the accent, so the chrome wears the brand.
 * 19. Thumb invisible at rest, or unstrengthened on hover — a bar an operator
 *     cannot find, or one that never responds to the pointer. It is quiet at rest
 *     on purpose and must still be DRAWN; a custom scrollbar also follows its own
 *     region, not hover anywhere in the app.
 * 20. A frame back around the lens's selector — `.ui-segmented`'s shared hairline,
 *     sitting one pixel outside the active tab's own, is what made the old pair
 *     (wing switcher + domain lens) read as concentric outlines in a row. Inside
 *     the raised page-ink tab the lens carries no outer frame; the fill is what
 *     sets it off the strip, and the active tab keeps its line. Both the frame and
 *     the fill are measured, so "frameless" cannot be satisfied by a control that
 *     stopped rendering its fill or its tab.
 * 20a. The wing switcher back in the sheet — five tabs in the sheet again, or a
 *     switcher in the rail's band that does not start at the strip's bottom edge
 *     (32px) in its 44px band, above the wing's rows, or does not navigate. Its
 *     band is measured against the strip and the dock's header, its options' boxes
 *     prove the collapsed stack, and its trip (Home → Define → Home) is read off
 *     the rail's rows.
 * 20b. The lens still in the sheet — a `.top-bar` band back at the top of
 *     `.shell__main`, or the real `.domain-switcher` never raised into
 *     `.window-titlebar__lens`. The strip's first element child must be the lens,
 *     it must hold the real switcher, and the page must start at the strip's
 *     bottom edge (32px) rather than 44px below it.
 * 20c. The lens not part of the page — the wrong fill (not the page canvas), a
 *     mat gap between the tab's bottom edge and the sheet's top, a tab that stops
 *     short of the strip's top, a drag-region tab the operator cannot click.
 * 20c. The lens off the strip's centre — the tab pinned to the strip's leading
 *     edge (the old placement, 12px past the rail), or centred by absolute
 *     positioning that lets it cover the rail or push into the trailing cluster.
 *     It must hold the strip's centre line at both rail widths rather than
 *     sliding with the rail when it collapses, and the gaps to the rail and to
 *     the trailing cluster must both stay positive — a tab is not centred if
 *     centring took an operator's controls with it.
 * 20d. The tab's connection square — the two bottom fillets missing, not 8×8,
 *     or painted in the wrong ink, so the page meets the strip on two hard inside
 *     corners instead of flaring into it. The top corners must be rounded by the
 *     same 8px step (and the bottom corners must stay square on the box — their
 *     rounding is the flare, not a radius), so the silhouette reads as a tab at
 *     both ends rather than a block with one softened edge.
 * 20e. The lens overflowing the strip — the segmented control taller than
 *     `--window-titlebar-height`, poking out of the lens, or the lens shoving the
 *     trailing cluster (theme, shortcuts, settings, side and chat toggles) off
 *     the window.
 * 20f. The lens list wrong — the tab not naming the vault's live domains, an
 *     archived domain offered, or the "Overview" option missing. The harness seeds
 *     three domains so "a tab" cannot be satisfied by a control with nothing to
 *     choose.
 * 20g. The band row broken by the reclaim — the rail's wing band or the dock's
 *     header dragged up with the page (losing the 44px band), or the dock's
 *     header losing its own hairline.
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
import type { DocumentKind, DomainRecord } from "@lifequest/vault-core";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import {
  ThemeProvider,
  syncTitleBarOverlay,
} from "@/components/theme/ThemeProvider";
import { applySkin } from "@/lib/themes/apply-skin";
import { BUILTIN_SKINS, DEFAULT_SKIN_NAME } from "@/lib/themes/presets";
import { applyThemePreference } from "@/lib/theme";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** The vault name the rail's chip must wear — the driver reads it off the page
 *  rather than hard-coding the same string twice. */
const VAULT_NAME = "Harness Vault";

const SEEDED_AT = "2026-01-01T00:00:00.000Z";

/**
 * The live domains the titlebar's lens must offer. The tab is a real choice, not
 * a decoration: with an empty list the switcher renders "Overview" alone and every
 * "it is a tab" claim would pass on a control with nothing to pick. Three of them,
 * so the compacted segmented control also has to fit more than one label inside
 * the 32px strip. The driver reads the same names off `window.shellHarnessDomainNames`.
 */
const DOMAIN_NAMES = ["Health", "Financial", "Craft"];

function domainDocuments(name: string): DomainRecord["documents"] {
  const doc = (
    kind: DocumentKind,
    title: string,
  ): DomainRecord["documents"][DocumentKind] => ({
    kind,
    title,
    locked: false,
    bodyMarkdown: `${name}: ${title.toLowerCase()}.`,
    updatedAt: SEEDED_AT,
    mtimeMs: 0,
  });
  return {
    premise: doc("premise", "Beliefs & Premise"),
    what: doc("what", "Vision & Desire"),
    why: doc("why", "Purpose"),
    how: doc("how", "Strategy (How)"),
  };
}

const DOMAINS: DomainRecord[] = DOMAIN_NAMES.map((name, index) => ({
  slug: name.toLowerCase(),
  meta: {
    name,
    description: null,
    color: null,
    sortOrder: index,
    archivedAt: null,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  },
  documents: domainDocuments(name),
}));

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
  domains: DOMAINS,
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

/** Every `setTitleBarOverlay` the provider made, oldest first. */
const overlayCalls: { color: string; symbolColor: string }[] = [];

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
  // The overlay calls are kept: the native strip the OS paints beside the web
  // content has to wear the same fill the CSS titlebar does, and that hand-off is
  // the one part of the strip no computed style can answer for.
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: (opts: { color: string; symbolColor: string }) => {
      overlayCalls.push(opts);
      return Promise.resolve();
    },
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
                      {/*
                        One route for every path. The rail's wing switcher really
                        navigates (that is part of what this rig measures), and a
                        pathless layout route with no matching child would unmount
                        the shell instead of leaving it on screen — the wing rows
                        would then be missing on the way back, which would read as
                        a switcher that does not work.
                      */}
                      <Route
                        path="*"
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

// ...and the titlebar lens's claims need the domain list it was handed: the tab
// must name them, in order, after "Overview".
(
  window as unknown as { shellHarnessDomainNames: string[] }
).shellHarnessDomainNames = DOMAIN_NAMES.slice();

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
  // The provider's third call after a repaint: the native caption strip takes the
  // same fill the CSS titlebar just did.
  syncTitleBarOverlay();
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

/**
 * The overlay hand-offs the provider made on mount. The rig compares the last one
 * with the computed `.window-titlebar` fill: the OS paints its caption buttons in
 * the strip beside the web content, so a mismatch there is a titlebar in two
 * colours on the one edge the operator's window controls sit on.
 */
(
  window as unknown as {
    shellHarnessOverlayCalls: () => { color: string; symbolColor: string }[];
  }
).shellHarnessOverlayCalls = () => overlayCalls.slice();
