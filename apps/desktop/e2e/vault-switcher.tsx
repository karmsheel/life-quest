/**
 * E2E harness for the titlebar vault switcher (driven by
 * `vault-switcher.electron.mjs`).
 *
 * A system-in-isolation rig, so the ways it can fail are written down first:
 *  1. The chip is still a NavLink (or an inert button): the dead control the
 *     human reported, where clicking the vault's name visibly does nothing.
 *  2. The chip opens something that is not a modal dialog, or the dialog lacks
 *     the recents — the popup is decoration rather than a switcher.
 *  3. The recents are hardcoded in the dialog instead of read from
 *     `useVault().recent`: a vault this window has opened is missing, or one it
 *     has never opened is offered.
 *  4. The open vault is not marked, or every row is marked, so the operator
 *     cannot tell which folder is currently writing their files.
 *  5. A row click asks the platform folder picker instead of opening exactly the
 *     path the row carries (or opens a different path than the one clicked).
 *  6. A successful switch leaves the dialog up, leaves the old name on the chip,
 *     or never goes to /home.
 *  7. A cancelled picker closes the dialog, opens a vault anyway, or asks a
 *     second question.
 *  8. A refused folder closes the dialog or drops the old vault instead of
 *     naming the refusal inline in the dialog.
 *  9. Rows (and the folder action) stay live while an open is in flight, so a
 *     second switch can be asked over the first.
 * 10. Escape, the scrim or the close X do not dismiss; or they dismiss
 *     mid-flight, when the answer has nowhere to be shown.
 * 11. Focus is not moved into the dialog on open, or is not handed back to the
 *     chip on close, stranding a keyboard operator at the top of the page.
 * 12. The dialog is not portalled to the body, so the titlebar's `overflow:
 *     hidden` strip and its drag band clip or swallow it.
 *
 * The IPC bridge is stubbed (there is no Electron preload on a dev-server page);
 * the titlebar, the dialog, the shell's own provider chain, the real CSS and the
 * real layout engine are all shipping code.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider, useVault } from "@/state/VaultProvider";
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

const ROOT_A = "/harness/vault-a";
const ROOT_B = "/harness/vault-b";
const ROOT_C = "/harness/vault-c";
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

/** The vault that is open when the page loads, and the two it can switch to. */
const SNAPSHOT_A = snapshot("vault-a", "Harness Vault A", ROOT_A);
const SNAPSHOT_B = snapshot("vault-b", "Harness Vault B", ROOT_B);
const SNAPSHOT_C = snapshot("vault-c", "Harness Vault C", ROOT_C);

const SNAPSHOT_BY_PATH: Record<string, ReturnType<typeof snapshot>> = {
  [ROOT_A]: SNAPSHOT_A,
  [ROOT_B]: SNAPSHOT_B,
  [ROOT_C]: SNAPSHOT_C,
};

/** What `vaultListRecent` offers: the whole known set, current vault included. */
const RECENT = [
  {
    id: "vault-a",
    name: "Harness Vault A",
    path: ROOT_A,
    lastOpenedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "vault-b",
    name: "Harness Vault B",
    path: ROOT_B,
    lastOpenedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "vault-c",
    name: "Harness Vault C",
    path: ROOT_C,
    lastOpenedAt: "2026-01-03T00:00:00.000Z",
  },
];

type Calls = { dialog: (string | null)[]; open: string[]; recent: number };
const calls: Calls = { dialog: [], open: [], recent: 0 };

/** What the platform picker answers on the next click; null = cancelled. */
let dialogAnswer: string | null = ROOT_B;
/** Whether the next `vaultOpen` refuses the folder. */
let openRefuses = false;
/** How long `vaultOpen` takes, so the driver can catch the dialog mid-flight. */
let openDelayMs = 0;

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT_A),
  vaultListRecent: () => {
    calls.recent += 1;
    return Promise.resolve(RECENT);
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
      setTimeout(() => resolve(ok(SNAPSHOT_BY_PATH[rootPath] ?? SNAPSHOT_B)), openDelayMs);
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
// The probe below records every location it sees here, so the driver can prove
// a successful switch navigated even though the harness starts on /home and the
// destination is /home again.
(window as unknown as { routerTrail?: string[] }).routerTrail = [];

const knobs = {
  /** What the picker answers next (null = cancelled). */
  setDialogAnswer: (value: string | null) => {
    dialogAnswer = value;
  },
  /** Make the next open refuse the folder. */
  setOpenRefuses: (value: boolean) => {
    openRefuses = value;
  },
  /** Make the next open take `ms`, so the dialog can be caught mid-flight. */
  setOpenDelay: (ms: number) => {
    openDelayMs = ms;
  },
};
(window as unknown as { vaultKnobs: typeof knobs }).vaultKnobs = knobs;

/**
 * The driver's two windows onto harness state the DOM alone cannot show: the
 * provider's boot (so the first measurement is never taken against an empty
 * recents list) and the router's location (so "goes home" is proved, not
 * assumed). Hidden, because neither is part of the screen under test.
 */
function HarnessProbe() {
  const { snapshot, recent, booting } = useVault();
  const location = useLocation();

  useEffect(() => {
    const scope = window as unknown as { routerTrail?: string[] };
    scope.routerTrail = [
      ...(scope.routerTrail ?? []),
      `${location.pathname}|${location.key}`,
    ];
  }, [location]);

  return (
    <>
      <output
        id="harness-probe"
        hidden
        data-vault={snapshot?.rootPath ?? ""}
        data-recents={recent.length}
        data-booting={String(booting)}
      />
      <output
        id="router-probe"
        hidden
        data-pathname={location.pathname}
        data-key={location.key}
      />
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from vault-switcher.html");

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
                  <HarnessProbe />
                </div>
              </div>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

// Both halves have to be up before the driver measures: the chip (the control
// under test) and the provider's boot (the recent list it is supposed to read).
const waitForPage = () => {
  const chip = document.querySelector(".window-titlebar__vault");
  const probe = document.querySelector("#harness-probe");
  const recents = Number(probe?.getAttribute("data-recents") ?? "-1");
  const booting = probe?.getAttribute("data-booting");
  if (!chip || booting !== "false" || recents !== RECENT.length) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

(window as unknown as { vaultSwitcherHarnessReady: Promise<void> }).vaultSwitcherHarnessReady =
  ready;
