/**
 * E2E harness for the Vault settings page (driven by
 * `settings-vault.electron.mjs`).
 *
 * A system-in-isolation rig, so the ways it can fail are written down first:
 *
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
 * 11. Rows go back to stacking: the label, its description and its control pile
 *     up against each other instead of the name sitting on the leading edge and
 *     the control on the trailing one. This is the exact layout the human asked
 *     to fix, so it is measured, not eyeballed: the gap between the copy and the
 *     control, and the row's own padding, are read back from the real layout.
 * 12. The week-start control is a full-width bar under its heading again, or it
 *     is no longer on the heading's line. The human asked for it smaller and in
 *     line with "Week starts on"; both are geometry assertions here.
 * 13. The restore checkbox is still a checkbox, the switch does not sit on the
 *     leading edge of the row's controls, it is too small to read as a switch,
 *     or floating without its owning row: the books rows are measured per
 *     domain, and the switch's own track is measured against the row.
 * 14. The destructive button is armed before the switch is: a restore fires with
 *     the gate closed. The rig clicks Restore on a fresh row and asserts it is
 *     disabled and that no restore call was made, then arms only one domain and
 *     proves the other domain's restore is still closed.
 * 15. A successful restore leaves the row armed, so the next stray press is a
 *     second destructive act the operator did not ask for.
 * 16. A refused restore shows nothing, or shows its error on a different row.
 * 17. Buttons in the rows keep the app's pill radius: the human asked for that
 *     to change on this page, and the computed radius is what the sheet wears.
 * 18. The "cannot change while weekly files exist" hint appears even when the
 *     setting is live — a paragraph explaining a constraint that is not there.
 *     The rig reloads with weekly files present and reads the disabled state.
 *
 * The IPC bridge is stubbed (there is no Electron preload on a dev-server
 * page); the settings page, the shell's own ancestor chain, the real CSS and
 * the real layout engine are all shipping code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettingsOverlay } from "@/components/settings/SettingsOverlay";
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
const RESTORE_REFUSAL = "Books.json for this domain could not be read.";

/** The settings object the stubbed settingsUpdate patches and hands back. */
const settings = {
  hermesBaseUrl: "http://127.0.0.1:1",
  theme: "dark" as const,
  weekStartDay: "monday" as const,
};

/**
 * `weeklyFiles` is read from the page's query string so the driver can reload
 * into the locked state the week-start row describes without a second harness.
 */
const weeklyFiles = Number(
  new URLSearchParams(window.location.search).get("weeklyFiles") ?? 0,
);

const snapshot = (id: string, name: string, rootPath: string) => ({
  rootPath,
  lifequest: {
    schemaVersion: 1 as const,
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: { ...settings },
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
    {
      slug: "finance",
      meta: {
        name: "Finance",
        description: null,
        color: null,
        sortOrder: 1,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      documents: { why: null, what: null, how: null, premise: null },
    },
    {
      slug: "retired",
      meta: {
        name: "Retired",
        description: null,
        color: null,
        sortOrder: 2,
        archivedAt: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
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
  weeklyFileCount: weeklyFiles,
});

/** The vault that is open when the page loads, and the one it switches to. */
const SNAPSHOT_A = snapshot("vault-a", "Harness Vault A", ROOT_A);
const SNAPSHOT_B = snapshot("vault-b", "Harness Vault B", ROOT_B);

type Calls = {
  dialog: (string | null)[];
  open: string[];
  recent: number;
  settings: Record<string, unknown>[];
  export: string[];
  restore: string[];
};
const calls: Calls = {
  dialog: [],
  open: [],
  recent: 0,
  settings: [],
  export: [],
  restore: [],
};

/** What the platform picker answers on the next click; null = cancelled. */
let dialogAnswer: string | null = ROOT_B;
/** Whether the next `vaultOpen` refuses the folder. */
let openRefuses = false;
/** How long `vaultOpen` takes, so the rig can catch the control mid-flight. */
let openDelayMs = 0;
/** Whether the next `dbRestoreBooks` refuses. */
let restoreRefuses = false;

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
  settingsUpdate: (patch: Record<string, unknown>) => {
    calls.settings.push(patch);
    Object.assign(settings, patch);
    return ok({ ...settings });
  },
  dbExportBooks: (slug: string) => {
    calls.export.push(slug);
    return ok(null);
  },
  dbRestoreBooks: (slug: string, options: { confirm: boolean }) => {
    calls.restore.push(slug);
    if (!options?.confirm) {
      return Promise.resolve({
        ok: false as const,
        error: "restore was not confirmed",
      });
    }
    if (restoreRefuses) {
      return Promise.resolve({ ok: false as const, error: RESTORE_REFUSAL });
    }
    return ok(null);
  },
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
  /** Make the next restore refuse. */
  setRestoreRefuses: (value: boolean) => {
    restoreRefuses = value;
  },
};
(window as unknown as { vaultKnobs: typeof knobs }).vaultKnobs = knobs;

/**
 * The shape of the sheet's scrolling column, not just its card: the section
 * spacing rule is a child combinator off `.settings-overlay__main-scroll`, and
 * a page mounted straight into `.shell__content` would measure a layout the
 * operator never sees.
 */
/*
 * The real settings sheet, opened on its Vault page — chrome, section nav,
 * search field and all. The page is measured inside the frame it ships in: the
 * panel takes ~90% of the window, the nav reserves its 13rem, and the page sits
 * in the scrolling main column. Mounting the page at the window's full width
 * would assert a layout the operator never sees.
 */
function HarnessPage() {
  return (
    <SettingsOverlay
      activeView="vault"
      onViewChange={() => {}}
      onClose={() => {}}
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from settings-vault.html");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <VaultProvider>
        <div className="app-root">
          <div className="app-root__body">
            <div className="shell">
              <HarnessPage />
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

// Every half of the page has to be up before the driver measures: the identity
// list, the folder row's control, the week-start control, and one books row's
// switch. Waiting on a single element would let the driver measure a page that
// is still painting its second card.
const waitForPage = () => {
  const identity = document.querySelector(".settings-vault");
  const rows = Array.from(document.querySelectorAll(".settings-card__row"));
  const labelOf = (row: Element) =>
    (row.querySelector(".settings-card__label")?.textContent ?? "").trim();
  const folderRow = rows.find((row) => labelOf(row) === "Vault folder");
  const weekRow = rows.find((row) => labelOf(row) === "Week starts on");
  const booksSwitch = rows
    .find((row) => row.classList.contains("settings-card__row--books"))
    ?.querySelector('[role="switch"]');
  const okToMeasure = Boolean(
    identity &&
      folderRow?.querySelector("button") &&
      weekRow?.querySelector(".ui-segmented") &&
      booksSwitch,
  );
  if (!okToMeasure) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

(window as unknown as { settingsVaultHarnessReady: Promise<void> }).settingsVaultHarnessReady =
  ready;
