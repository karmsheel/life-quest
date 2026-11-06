/**
 * E2E harness for the app's own confirm dialog on a settings surface (driven by
 * `settings-domains.electron.mjs`).
 *
 * A system-in-isolation rig, so the ways it can fail are written down first:
 *
 *  1. The platform's dialog: the click reaches `window.confirm` and no in-window
 *     card appears — the bug this rig exists for, since a platform dialog is
 *     centred on the *display* and a half-screen window puts it over the desktop.
 *  2. The card is not centred in the window. `position: fixed` centres on the
 *     nearest ancestor that created a containing block, and a transform, filter
 *     or `backdrop-filter` anywhere up the chain would hand it the sheet instead;
 *     `.shell__content` is also an `overflow: auto` scroller, which is exactly the
 *     ancestor chain worth measuring.
 *  3. The card is clipped by that scroller rather than escaping it.
 *  4. No scrim, or a scrim that paints nothing, so the page behind stays live.
 *  5. The question writes before it is answered: a cancelled ask must reach no
 *     bridge call at all.
 *  6. Archive wears the danger. It is the soft write — the folder and its
 *     database stay — so only the delete may wear the destructive token.
 *  7. The wrong write, or the wrong domain: the answer must carry the slug of the
 *     row the question was opened from, and archive must not call delete.
 *
 * The IPC bridge is stubbed (there is no Electron preload on a dev-server page);
 * the settings page, the shell's own ancestor chain, the real CSS and the real
 * layout engine are all shipping code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettingsDomains } from "@/components/settings/SettingsDomains";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/**
 * A never-called `window.confirm`: a platform dialog would block this page on a
 * prompt nobody can answer, so a stray call has to fail loudly instead of
 * hanging the driver.
 */
window.confirm = () => {
  throw new Error("the app asks through its own dialog, never window.confirm");
};

const archived = (value: string | null) => value;

const documents = { why: null, what: null, how: null, premise: null };

const domain = (
  slug: string,
  name: string,
  sortOrder: number,
  archivedAt: string | null,
  unlockedAt?: string | null,
) => ({
  slug,
  meta: {
    name,
    description: null,
    color: null,
    sortOrder,
    archivedAt: archived(archivedAt),
    // Absent means unlocked (a vault written before areas had a lock state);
    // `null` means locked and therefore never offered as a card.
    ...(unlockedAt === undefined ? {} : { unlockedAt }),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  documents,
});

/**
 * The vault as the settings page sees it: the base `life` area (never listed), two
 * unlocked areas, one archived area, and two seeded areas still locked. So the
 * page has all four blocks the contract names — Unlock another area, Your areas,
 * Archived, Create area — and the base area must stay invisible in every one.
 */
const SNAPSHOT = {
  rootPath: "C:/harness-vault",
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
  domains: [
    domain("life", "Life", -1, null, "2026-01-01T00:00:00.000Z"),
    domain("health", "Health", 0, null),
    domain("career", "Career", 1, null),
    domain("mind", "Mind", 2, null, null),
    domain("financial", "Finance", 3, null, null),
    domain("career-old", "Career (old)", 4, "2026-02-02T00:00:00.000Z"),
  ],
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

type Calls = { archive: string[]; remove: string[]; unlock: string[] };
const calls: Calls = { archive: [], remove: [], unlock: [] };

const bridge: Record<string, unknown> = {
  // A fresh object each read, like the real snapshot: the page's own `refresh()`
  // after an unlock must see the new flag, and React must see a new identity for
  // its memos to recompute.
  vaultGetSnapshot: () => ok(structuredClone(SNAPSHOT)),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  domainArchive: (slug: string) => {
    calls.archive.push(slug);
    return ok(null);
  },
  domainDelete: (slug: string) => {
    calls.remove.push(slug);
    return ok(null);
  },
  // Unlocking flips the flag on the fixture the same way the engine does, then
  // the page's own `refresh()` re-reads the snapshot: the row must leave the
  // locked list and the area must appear under "Your areas" without activating.
  domainUnlock: (slug: string) => {
    calls.unlock.push(slug);
    const target = SNAPSHOT.domains.find((entry) => entry.slug === slug) as
      | { meta: { unlockedAt?: string | null } }
      | undefined;
    if (target) target.meta.unlockedAt = new Date().toISOString();
    return ok(target ?? null);
  },
  // The theme provider talks to the window's own chrome, which a dev-server page
  // has no bridge for: the app always mounts it, so the rig does too.
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
(window as unknown as { domainCalls: Calls }).domainCalls = calls;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from settings-domains.html");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <VaultProvider>
        <div className="app-root">
          <div className="app-root__body">
            <div className="shell">
              <main className="shell__main">
                <div className="shell__content">
                  <SettingsDomains />
                </div>
              </main>
            </div>
          </div>
        </div>
      </VaultProvider>
    </ThemeProvider>
  </StrictMode>,
);

let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

// Both halves have to be up before the driver measures: a live domain card with
// its Archive control, and the archived row with its Delete.
const waitForPage = () => {
  const card = document.querySelector(".domain-card__actions");
  const archivedRow = document.querySelector(".archived-list__item");
  if (!card || !archivedRow) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

(window as unknown as { settingsDomainsHarnessReady: Promise<void> }).settingsDomainsHarnessReady =
  ready;
