/**
 * E2E harness for the companion setup screen — the "Agent connecting" screen
 * an operator is stranded on when the companion cannot attach (driven by
 * `companion-setup.electron.mjs`).
 *
 * A system-in-isolation rig, so the ways it can fail are written down first:
 *
 *  1. The picker never renders and the screen still offers only Recheck and
 *     the docs link — the exact dead end this feature exists to remove.
 *  2. Not every installed profile is listed: `default` dropped, a named
 *     profile missing, or a listed row with no path.
 *  3. The active profile is not marked, or the wrong one is ("In use" on a
 *     profile the app is not on).
 *  4. A row is decorative: clicking it never reaches the bridge, or reaches
 *     it with the wrong name.
 *  5. `lifequest` missing from the install is not offered as "create", or the
 *     create row switches to some other name.
 *  6. A row stays live while an ensure is in flight — a second switch racing
 *     the first gateway start.
 *  7. A failed switch strands the operator: the picker must stay up with the
 *     error body, and Recheck must still answer.
 *  8. The picker landing breaks the screen around it: the Recheck button, the
 *     docs link (on `needs_install`), or the title/body vanish.
 *  9. An unreadable profiles list takes the screen down with it — an operator
 *     whose profiles dir cannot be read must still get Recheck.
 * 10. The list answers before the ensure settles and the "In use" marker lies
 *     about which profile the app is on.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page) and answers from `window.__lq*` knobs, so one page serves every shape
 * the screen has to survive: a stuck connect, a switch that succeeds, a
 * switch that fails, and no profile list at all. The real screen, the real
 * picker, the real CSS and the real layout engine are shipping code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { CompanionSetupScreen } from "@/components/hermes/CompanionSetupScreen";
import { CompanionProvider } from "@/state/CompanionProvider";
import type { CompanionProfileInfo, CompanionStatus } from "@/vite-env";
import "@/styles/global.css";

type EnsureKind =
  | "gateway_exited"
  | "needs_install"
  | "disconnected"
  | "auth_error"
  | "ready";

type HarnessWindow = {
  chatSetupHarnessReady?: Promise<void>;
  /** What the driver should expect to see, read off the fixture, not typed twice. */
  chatSetupExpected?: {
    names: string[];
    active: string;
    hasLifequest: boolean;
  };
  /** Which status the next ensure answers with. */
  __lqEnsureKind?: EnsureKind;
  /** Which status a switch answers with. */
  __lqUseKind?: EnsureKind;
  /** The installed profiles, `default` first. */
  __lqProfiles?: CompanionProfileInfo[];
  /** The profile the app reports as active before any switch. */
  __lqActive?: string;
  /** How long an ensure takes, in ms: a switch must be observable in flight. */
  __lqEnsureDelay?: number;
  /** Bridge calls the driver reads back. */
  __lqUseCalls?: string[];
  __lqEnsureCalls?: number;
  /** Set when the profiles list itself fails. */
  __lqProfilesFail?: boolean;
};

const harness = window as unknown as HarnessWindow;

/** The machine this rig answers for: two profiles, no `lifequest` yet. */
const PROFILES: CompanionProfileInfo[] = [
  {
    name: "default",
    path: "/harness/.hermes",
    isDefault: true,
    hasConfig: true,
    hasSoul: true,
    hasEnv: true,
  },
  {
    name: "coder",
    path: "/harness/.hermes/profiles/coder",
    isDefault: false,
    hasConfig: true,
    hasSoul: false,
    hasEnv: true,
  },
];

harness.__lqEnsureKind = "gateway_exited";
harness.__lqUseKind = "gateway_exited";
harness.__lqProfiles = PROFILES;
harness.__lqActive = "lifequest";
harness.__lqEnsureDelay = 0;
harness.__lqUseCalls = [];
harness.__lqEnsureCalls = 0;
// The list is read once, at mount, so a rig that wants the unreadable-list
// shape has to ask for it before the provider mounts — hence the URL flag
// rather than a knob set later.
harness.__lqProfilesFail =
  new URLSearchParams(window.location.search).get("profilesFail") === "1";

harness.chatSetupExpected = {
  names: PROFILES.map((p) => p.name),
  active: harness.__lqActive ?? "lifequest",
  hasLifequest: false,
};

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

function statusFor(kind: EnsureKind): CompanionStatus {
  if (kind === "ready") {
    return {
      kind: "ready",
      port: 8642,
      baseUrl: "http://127.0.0.1:8642/p/coder",
      startedByLifeQuest: false,
      profilePath: "/harness/.hermes/profiles/coder",
      cliPath: "/harness/bin/hermes",
      childPid: null,
    };
  }
  if (kind === "needs_install") return { kind: "needs_install" };
  if (kind === "disconnected") return { kind: "disconnected" };
  if (kind === "auth_error") return { kind: "auth_error" };
  return {
    kind: "gateway_exited",
    stderr: "Host gateway did not serve /p/coder.",
  };
}

const bridge: Record<string, unknown> = {
  companionEnsure: async () => {
    harness.__lqEnsureCalls = (harness.__lqEnsureCalls ?? 0) + 1;
    const delay = harness.__lqEnsureDelay ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return statusFor(harness.__lqEnsureKind ?? "gateway_exited");
  },
  companionProfilesList: async () => {
    if (harness.__lqProfilesFail) {
      throw new Error("profiles directory unreadable");
    }
    // Bare, the way the real handler answers: `companionProfilesList` returns
    // `{active, profiles}` itself, not a Result envelope.
    return {
      active: harness.__lqActive ?? "lifequest",
      profiles: (harness.__lqProfiles ?? PROFILES).map((p) => ({ ...p })),
    };
  },
  companionUseProfile: async (name: string) => {
    harness.__lqUseCalls = [...(harness.__lqUseCalls ?? []), name];
    // The switch persists, the way `setCompanionProfile` does: the next list
    // answers with the new active, so a re-read cannot report a lie.
    harness.__lqActive = name;
    const delay = harness.__lqEnsureDelay ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return statusFor(harness.__lqUseKind ?? "gateway_exited");
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
if (!root) throw new Error("#root missing from companion-setup.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <CompanionProvider>
        {/* The app's own frame, because the welcome screen fills it and a rig
            without the frame would measure a page the app never paints. */}
        <div className="app-root">
          <div className="app-root__body">
            <CompanionSetupScreen />
          </div>
        </div>
      </CompanionProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the screen never rendered". Either the
// rows or the empty state counts as settled: which one came up is an
// assertion, not a precondition.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForScreen = () => {
  const settled =
    document.querySelector(".companion-profile-row") ??
    document.querySelector(".companion-profile-picker__empty");
  if (!settled) {
    requestAnimationFrame(waitForScreen);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForScreen);

(window as unknown as { chatSetupHarnessReady: Promise<void> }).chatSetupHarnessReady =
  ready;
