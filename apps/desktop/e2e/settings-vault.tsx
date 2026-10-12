/**
 * E2E harness for the settings vault-folder switch (driven by
 * `settings-vault.electron.mjs`).
 *
 * A system-in-isolation rig, so the ways it can fail are written down first:
 *  1. The page shows the folder and nothing else — no control to change it.
 *     A static path with no switch is the exact regression this rig guards.
 *  2. The click does nothing: the platform picker is never asked for a folder.
 *  3. The switch skips the picker and opens a path the operator never chose
 *     (a hardcoded folder, or one the picker did not return).
 *  4. A cancelled picker (null) opens a vault anyway.
 *  5. A refused folder (vaultOpen not-ok) leaves the operator on the old vault
 *     with no error, so a failed switch looks like nothing happened.
 *  6. A refused folder unmounts the page or drops the vault, so the operator
 *     loses the surface — and the old vault — on a failed switch.
 *  7. A successful switch does not re-read the recent list, so the next cold
 *     start reopens the vault the operator just left.
 *  8. A successful switch leaves the old vault's identity on screen: the
 *     name/id/path still describe the vault that was closed.
 *  9. The control is a raw button instead of the app's own Button primitive.
 * 10. The control stays live while an open is in flight, so a second dialog
 *     can be asked over the first one.
 *
 * The IPC bridge is stubbed (there is no Electron preload on a dev-server
 * page); the settings page, the shell's own ancestor chain, the real CSS and
 * the real layout engine are all shipping code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettingsVault } from "@/components/settings/SettingsVault";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/**
 * A never-called `window.confirm`: a platform dialog would block this page on
 * a prompt nobody can answer, so a stray call has to fail loudly instead of
 * hanging the driver.
 */
window.confirm = () => {
  throw new Error("the app asks through its own dialog, never window.confirm");
};

const ROOT_A = "/harness/vault-a";
const ROOT_B = "/harness/vault-b";
const REFUSAL = "No LifeQuest vault in that folder.";

const snapshot = (id: string, name: string, rootPath: string) => ({
  rootPath,
  lifequest: {
    schemaVersion: 1 as const,
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark" as const,
    weekStartDay: "monday" as const,
  },
  domains: [
    {
      slug: "health",
      meta: {
        name: "Health",
        description: null,
        color: null,
        sortOrder: 0,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      documents: { why: null, what: null, how: null, premise: null },
    },
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
});

/** The vault that is open when the page loads, and the one it switches to. */
const SNAPSHOT_A = snapshot("vault-a", "Harness Vault A", ROOT_A);
const SNAPSHOT_B = snapshot("vault-b", "Harness Vault B", ROOT_B);

type Calls = { dialog: (string | null)[]; open: string[]; recent: number };
const calls: Calls = { dialog: [], open: [], recent: 0 };

/** What the platform picker answers on the next click; null = cancelled. */
let dialogAnswer: string | null = ROOT_B;
/** Whether the next `vaultOpen` refuses the folder. */
let openRefuses = false;
/** How long `vaultOpen` takes, so the rig can catch the control mid-flight. */
let openDelayMs = 0;

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT_A),
  vaultListRecent: () => {
    calls.recent += 1;
    return Promise.resolve([
      { id: "vault-a", name: "Harness Vault A", path: ROOT_A, lastOpenedAt: "2026-01-01T00:00:00.000Z" },
      { id: "vault-b", name: "Harness Vault B", path: ROOT_B, lastOpenedAt: "2026-01-02T00:00:00.000Z" },
    ]);
  },
  onVaultFileChanged: () => () => {},
  domainGetActive: () => Promise.resolve(null),
  domainSetActive: () => ok(null),
  dialogOpenDirectory: () => {
    calls.dialog.push(dialogAnswer);
    return Promise.resolve(dialogAnswer);
  },
  vaultOpen: (rootPath: string) => {
    calls.open.push(rootPath);
    if (openRefuses) {
      return Promise.resolve({ ok: false as const, error: REFUSAL });
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve(ok(SNAPSHOT_B)), openDelayMs);
    });
  },
  // The theme provider talks to the window's own chrome, which a dev-server
  // page has no bridge for: the app always mounts it, so the rig does too.
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
(window as unknown as { vaultCalls: Calls }).vaultCalls = calls;

const knobs = {
  /** What the picker answers next (null = cancelled). */
  setDialogAnswer: (value: string | null) => {
    dialogAnswer = value;
  },
  /** Make the next open refuse the folder. */
  setOpenRefuses: (value: boolean) => {
    openRefuses = value;
  },
  /** Make the next open take `ms`, so the control can be caught mid-flight. */
  setOpenDelay: (ms: number) => {
    openDelayMs = ms;
  },
};
(window as unknown as { vaultKnobs: typeof knobs }).vaultKnobs = knobs;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from settings-vault.html");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <VaultProvider>
        <div className="app-root">
          <div className="app-root__body">
            <div className="shell">
              <main className="shell__main">
                <div className="shell__content">
                  <SettingsVault />
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

// Both halves have to be up before the driver measures: the vault's own
// identity list, and the folder switch's control inside it.
const waitForPage = () => {
  const identity = document.querySelector(".settings-vault");
  const folderRow = Array.from(
    document.querySelectorAll(".settings-card__row"),
  ).find((row) =>
    (row.querySelector(".settings-card__label")?.textContent ?? "").trim() ===
    "Vault folder",
  );
  if (!identity || !folderRow?.querySelector("button")) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

(window as unknown as { settingsVaultHarnessReady: Promise<void> }).settingsVaultHarnessReady =
  ready;
