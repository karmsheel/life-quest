/**
 * E2E harness for the Decisions badge on the real `NavRail` (driven by
 * `decisions-badge.electron.mjs`).
 *
 * The operator's complaint this rig exists for: the rail's Decisions badge was a
 * still life. It drew the count the vault had at boot and never heard about a
 * Decision the companion filed afterwards, so a proposal a human was supposed to
 * act on waited behind a number that never moved. The fix makes the badge listen
 * to `vault:dataChanged`, re-read the vault, count what is pending, and mark an
 * arrival for a few seconds.
 *
 * WHAT THIS RIG IS, AND WHAT IT IS NOT
 *
 * It renders the REAL `NavRail` inside the REAL `VaultProvider`,
 * `LiveDataProvider`, `WingProvider`, `NavDockProvider` and `UpdateProvider`, in a
 * real Electron window with the real layout. The only thing stubbed is
 * `window.lifequest`, because the dev-server page has no preload. The stub plays
 * the MAIN PROCESS: it holds the vault's decisions, and `decisionsBadgeFile`
 * writes one and then fires the same `vault:dataChanged` event the real write path
 * fires. A rig that called a React setter would be testing its own plumbing; a rig
 * that reloaded the page would be testing the workaround the operator used before
 * the fix.
 *
 * WHAT THE STUB DELIBERATELY DOES NOT DO
 *
 * `vaultGetSnapshot` always reports `decisions: []`. The badge's count therefore
 * cannot come from the snapshot the page booted with — the only place a pending
 * Decision can be found is `decisionList()`. That is what makes "the badge re-read
 * the vault" a falsifiable claim rather than a coincidence.
 *
 * FAILURE MODES, WRITTEN DOWN BEFORE THE ASSERTIONS
 *
 *  1. Stale source — the badge is still derived from `vaultGetSnapshot`'s
 *     `decisions` (frozen at boot), so a filing never appears. The stub keeps the
 *     snapshot empty forever, so this mode reads as "no badge".
 *  2. Missed event — the rail never re-reads on `vault:dataChanged`; the badge
 *     appears only if something else remounts the rail. The identity and mount
 *     counters below are what make that answer visible.
 *  3. Count read but not drawn — `decisionList()` is called and the number never
 *     reaches the DOM (a state update on the wrong value, an early return, a
 *     count that is computed and discarded).
 *  4. Wrong number — total decisions instead of pending, resolved included, or
 *     the badge text disagrees with the link's accessible name.
 *  5. Stale label — the visible number moves and the anchor's `aria-label` /
 *     `title` still say the old count, so a screen reader is lied to.
 *  6. Arrival not marked — the count appears with neither `data-arrived="true"`
 *     nor `nav-rail__badge--arrived`, so nothing tells the eye something landed.
 *  7. Sticky mark — the mark is set and never cleared: the badge claims an arrival
 *     forever, which is the same lie as a badge that never moves.
 *  8. Mark on the wrong edge — a DECREASE (a Decision resolved elsewhere) is
 *     marked as an arrival, so "something needs you" flashes when work went away.
 *  9. Badge never leaves — with nothing pending the number stays on the rail,
 *     sending the operator to an empty inbox.
 * 10. Value appears via a remount or reload — the count is only right because the
 *     rail (or the whole page) was rebuilt. The mount counter is cumulative and
 *     the anchor node is stamped with a token; either changing between the
 *     baseline and the end fails the claim.
 * 11. Bridge stubs masking real calls — anything the rail reaches for that this
 *     stub does not name must fail the run, not be swallowed silently.
 * 12. Console errors — React, the providers or the badge logging an error while
 *     every visual claim above happens to hold.
 *
 * The driver samples the page on a timer for the one claim two endpoints cannot
 * answer: how long the mark was up, and that it went away on its own. A hidden
 * window throttles timers, which is why the driver turns `backgroundThrottling`
 * off and this page samples with `setInterval` rather than `requestAnimationFrame`.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { version as appVersion } from "../package.json";
import type {
  DecisionRecord,
  DomainRecord,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { NavRail } from "@/components/shell/NavRail";
import { WingProvider } from "@/components/shell/WingProvider";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { ChatSessionsProvider } from "@/state/ChatSessionsProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { UpdateProvider } from "@/state/UpdateProvider";
import { VaultProvider, useVault } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const NOW = "2026-10-16T09:00:00.000Z";

// ── the world the rail reads ────────────────────────────────────────────────

function domain(slug: string, name: string, sortOrder: number): DomainRecord {
  return {
    slug,
    meta: {
      name,
      description: null,
      color: null,
      sortOrder,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    documents: {} as DomainRecord["documents"],
  };
}

const DOMAINS = [domain("financial", "Financial", 1), domain("health", "Health", 2)];

/**
 * The vault as the main process holds it.
 *
 * `decisions` here is the SOURCE OF TRUTH the stub's `decisionList` reads. The
 * snapshot's own `decisions` is always empty: a badge that could only have come
 * from the boot snapshot would fail every count claim below.
 */
const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "harness-vault",
    name: "Harness",
    createdAt: NOW,
  },
  settings: {
    hermesBaseUrl: "http://localhost:8642",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
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

const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;

/** One pending proposal, shaped exactly as the vault files one. */
function makeDecision(index: number, domainSlug = "financial"): DecisionRecord {
  const minute = String(index % 60).padStart(2, "0");
  const title = `Premise revision ${index}`;
  return {
    id: `decision-${String(index).padStart(3, "0")}`,
    target: { type: "doctrine", domainSlug, kind: "premise" },
    domainSlugs: [domainSlug],
    status: "pending",
    title,
    rationale:
      "The last quarter's ledger says the premise costs more than it claims, so the wording should say what it actually costs.",
    proposedTitle: title,
    previousTitle: title,
    proposedBodyMarkdown: `## Premise\n\nRevision ${index}: the monthly cost of staying here is the number the ledger holds, not the number the premise claims.\n`,
    previousBodyMarkdown: `## Premise\n\nRevision ${index - 1}: the monthly cost of staying here.\n`,
    actor: COMPANION,
    createdAt: `2026-10-16T09:${minute}:00.000Z`,
    resolvedAt: null,
    reason: null,
  };
}

type Vault = {
  decisions: DecisionRecord[];
  /** The next id a filing takes. */
  seq: number;
  /** The vault's live revision, exactly like the one `data-revision.ts` counts. */
  revision: number;
  /** Every listener the rail's providers registered through `onVaultDataChanged`. */
  listeners: Array<(revision: number) => void>;
  /** How many times the rail has asked for the decision list: the re-read itself. */
  listCalls: number;
};

const vault: Vault = {
  decisions: [],
  seq: 0,
  revision: 0,
  listeners: [],
  listCalls: 0,
};

/**
 * Publish a write the way `main.ts` does: bump the revision once, then tell every
 * open window. The coalescing `setTimeout(send, 16)` `main.ts` wraps this in is
 * deliberately NOT reproduced — it exists to merge a burst of writes inside one
 * frame, and this harness has one window and one write to tell.
 */
function announce(): void {
  vault.revision += 1;
  for (const listener of [...vault.listeners]) listener(vault.revision);
}

// ── the instrument ──────────────────────────────────────────────────────────

type Screen = {
  railPresent: boolean;
  href: string | null;
  ariaLabel: string | null;
  title: string | null;
  badgePresent: boolean;
  badgeText: string | null;
  badgeAriaLabel: string | null;
  badgeTitle: string | null;
  /** The mark, as the DOM carries it. */
  arrived: string | null;
  arrivedClass: boolean;
  /** Cumulative mounts of the rail's tree. Never decremented. */
  mounts: number;
  /** A value generated once at module load: a reload generates a new one. */
  nonce: string;
  /** The token stamped on the first anchor this page saw, and whether it is still it. */
  linkToken: string | null;
  sameLinkNode: boolean;
  booted: boolean;
  decisionListCalls: number;
  listenerCount: number;
  /** The snapshot's own decisions — always 0, so it can never explain a count. */
  snapshotDecisions: number;
  calls: string[];
  unexpected: string[];
  harnessErrors: string[];
};

type Pulse = {
  arrivedAt: number | null;
  goneAt: number | null;
  samples: Array<{ at: number; present: boolean; text: string | null }>;
  timer: number | null;
};

type PulseReport = {
  arrivedAt: number | null;
  goneAt: number | null;
  durationMs: number | null;
  samples: number;
};

type HarnessWindow = Window & {
  decisionsBadgeReady?: boolean;
  decisionsBadgeSkin?: string;
  decisionsBadgeCalls?: string[];
  decisionsBadgeUnexpectedCalls?: string[];
  decisionsBadgeBooted?: boolean;
  decisionsBadgeScreen?: () => Screen;
  /** The agent's filing: a pending Decision written, then the one event the page hears. */
  decisionsBadgeFile?: (title?: string) => string;
  /** A Decision resolved in another window: status flipped in the vault, then the event. */
  decisionsBadgeResolve?: (id: string) => boolean;
  /** Sample the badge on a timer from before a filing. */
  decisionsBadgeStartPulseWatch?: () => boolean;
  decisionsBadgeStopPulseWatch?: () => boolean;
  decisionsBadgePulse?: () => PulseReport;
};

const harness = window as HarnessWindow;
harness.decisionsBadgeCalls = [];
harness.decisionsBadgeUnexpectedCalls = [];

/** Generated once per page load: a reload is the only thing that changes it. */
const DOC_NONCE = `badge-${Math.random().toString(36).slice(2)}`;
harness.decisionsBadgeSkin = skinName;

let mounts = 0;

/**
 * The token stamped on the Decisions anchor the first time this page sees one.
 *
 * React keeps the same DOM node across a re-render and makes a new one across an
 * unmount/remount. A token that disappears is therefore a remount the mount
 * counter above could miss (the counter lives in a sibling, not in the rail).
 */
const LINK_TOKEN = `link-${Math.random().toString(36).slice(2)}`;
let stampedLink: HTMLAnchorElement | null = null;

function link(): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>('a[href="/decisions"]');
}

function badge(): HTMLElement | null {
  return document.querySelector<HTMLElement>('a[href="/decisions"] .nav-rail__badge');
}

function text(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function screen(): Screen {
  const anchor = link();
  if (anchor && stampedLink === null) {
    stampedLink = anchor;
    anchor.dataset.badgeRigToken = LINK_TOKEN;
  }
  const chip = badge();
  return {
    railPresent: Boolean(document.querySelector(".nav-rail")),
    href: anchor?.getAttribute("href") ?? null,
    ariaLabel: anchor?.getAttribute("aria-label") ?? null,
    title: anchor?.getAttribute("title") ?? null,
    badgePresent: Boolean(chip),
    badgeText: chip ? text(chip) : null,
    badgeAriaLabel: chip?.getAttribute("aria-label") ?? null,
    badgeTitle: chip?.getAttribute("title") ?? null,
    arrived: chip?.dataset.arrived ?? null,
    arrivedClass: chip?.classList.contains("nav-rail__badge--arrived") ?? false,
    mounts,
    nonce: DOC_NONCE,
    linkToken: stampedLink?.dataset.badgeRigToken ?? null,
    sameLinkNode: Boolean(anchor) && anchor === stampedLink,
    booted: Boolean(harness.decisionsBadgeBooted),
    decisionListCalls: vault.listCalls,
    listenerCount: vault.listeners.length,
    snapshotDecisions: SNAPSHOT.decisions.length,
    calls: [...(harness.decisionsBadgeCalls ?? [])],
    unexpected: [...(harness.decisionsBadgeUnexpectedCalls ?? [])],
    harnessErrors: (window as unknown as { __harnessErrors?: string[] }).__harnessErrors ?? [],
  };
}

harness.decisionsBadgeScreen = screen;

harness.decisionsBadgeFile = (title) => {
  vault.seq += 1;
  const decision = makeDecision(vault.seq);
  if (title) {
    decision.title = title;
    decision.proposedTitle = title;
  }
  vault.decisions.push(decision);
  // The tool call is answered first; the window is told afterwards, which is the
  // order the real write path has.
  setTimeout(announce, 0);
  return decision.id;
};

harness.decisionsBadgeResolve = (id) => {
  const found = vault.decisions.find((decision) => decision.id === id);
  if (!found) return false;
  found.status = "approved";
  found.resolvedAt = "2026-10-16T10:00:00.000Z";
  setTimeout(announce, 0);
  return true;
};

/**
 * Watch the mark from before a filing until it clears itself.
 *
 * A timer rather than `requestAnimationFrame`: a hidden window throttles frames,
 * and a throttled sampler reports a history of one sample as if the mark had
 * never been up. 100ms is fine enough to say "about four seconds" and coarse
 * enough not to compete with the page's own work.
 */
let pulse: Pulse = { arrivedAt: null, goneAt: null, samples: [], timer: null };
/** The current watch's sample function, so a read can force one last look. */
let sampleNow: (() => void) | null = null;

function stopPulseWatch(): void {
  if (pulse.timer !== null) {
    window.clearInterval(pulse.timer);
    pulse.timer = null;
  }
  sampleNow = null;
}

harness.decisionsBadgeStartPulseWatch = () => {
  stopPulseWatch();
  pulse = { arrivedAt: null, goneAt: null, samples: [], timer: null };
  const sample = () => {
    const chip = badge();
    const up =
      Boolean(chip) &&
      (chip!.dataset.arrived === "true" ||
        chip!.classList.contains("nav-rail__badge--arrived"));
    const at = performance.now();
    if (up && pulse.arrivedAt === null) pulse.arrivedAt = at;
    if (!up && pulse.arrivedAt !== null && pulse.goneAt === null) pulse.goneAt = at;
    pulse.samples.push({ at: Math.round(at), present: up, text: chip ? text(chip) : null });
  };
  sampleNow = sample;
  sample();
  pulse.timer = window.setInterval(sample, 100);
  return true;
};

harness.decisionsBadgeStopPulseWatch = () => {
  stopPulseWatch();
  return true;
};

harness.decisionsBadgePulse = () => {
  /*
   * Take one more look before reporting, on the caller's own clock.
   *
   * The driver notices the mark clear by polling the DOM every 50ms, which can
   * beat this watch's 100ms beat; without a forced sample the report would say
   * "the mark arrived" and never "it left", even though the page had cleared it.
   * Measuring the mark is this rig's instrument, so the instrument takes the
   * reading rather than hoping the timer is between two polls.
   */
  sampleNow?.();
  return {
    arrivedAt: pulse.arrivedAt === null ? null : Math.round(pulse.arrivedAt),
    goneAt: pulse.goneAt === null ? null : Math.round(pulse.goneAt),
    durationMs:
      pulse.arrivedAt !== null && pulse.goneAt !== null
        ? Math.round(pulse.goneAt - pulse.arrivedAt)
        : null,
    samples: pulse.samples.length,
  };
};

// ── the bridge, playing the main process ────────────────────────────────────

const stubs: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {
  vaultGetSnapshot: async () => ok(SNAPSHOT),
  vaultListRecent: async () => [],
  domainGetActive: async () => null,
  domainSetActive: async () => ok(null),
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: (cb: unknown) => {
    const listener = cb as (revision: number) => void;
    vault.listeners.push(listener);
    return () => {
      const index = vault.listeners.indexOf(listener);
      if (index >= 0) vault.listeners.splice(index, 1);
    };
  },
  // The rail now also carries the chats column. Its provider reads the session
  // list at mount and the board lock for the active lens; both are answered
  // empty, because no chat claim is made here.
  companionSessionsList: async () => ok([]),
  // The chats column's provider owns a stream listener for its whole life; the
  // rail has no chat to stream into here, so it subscribes to nothing.
  onCompanionStream: () => () => {},
  pinsList: async () => ok({ pins: [], locked: false }),
  decisionList: async () => {
    vault.listCalls += 1;
    // A read hands back copies: the rail must never be able to edit the vault by
    // holding on to what it was given, and `decisionResolve` is the only writer.
    return ok(vault.decisions.map((decision) => ({ ...decision })));
  },
  // The rail renders the real `UpdateBadge`, so the real `UpdateProvider` asks
  // its own channel at mount. Answering it here is what keeps "unexpected bridge
  // calls" an assertion about the badge rather than about the update feed.
  updateCheck: async () => ({
    ok: true,
    decision: { state: "current", current: appVersion, latest: appVersion },
  }),
  onUpdateProgress: () => () => {},
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.decisionsBadgeCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.decisionsBadgeUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

// ── the probes ──────────────────────────────────────────────────────────────

/**
 * One mount of the rail's tree, counted cumulatively.
 *
 * Deliberately never decremented: this answers "was the page rebuilt since the
 * baseline", and a count that went down on unmount would let a remount look like
 * a page that never moved.
 */
function MountProbe() {
  useEffect(() => {
    mounts += 1;
    harness.decisionsBadgeReady = true;
    return () => {
      harness.decisionsBadgeReady = false;
    };
  }, []);
  return null;
}

/** Publish the vault's own boot state, so the driver can take its baseline after it. */
function BootProbe() {
  const { booting } = useVault();
  useEffect(() => {
    harness.decisionsBadgeBooted = !booting;
  }, [booting]);
  return null;
}

// ── the page ────────────────────────────────────────────────────────────────

/**
 * The rail in the shell geometry the app gives it.
 *
 * `NavRail` alone is a column of rows: its width, the titlebar band it reaches
 * across, and the page it sits beside all come from the shell's own grid. The
 * shell wrapper here is the same element chain `AppShell` renders, without the
 * chat panel and titlebar this rig is not testing. The page area holds no app
 * class the claims read, so it cannot stand in for the thing under test.
 */
function Harness() {
  return (
    <div className="app-root">
      <div className="app-root__body">
        <div className="shell shell--chat-collapsed shell--chat-right">
          <MountProbe />
          <BootProbe />
          <NavRail />
          <div className="shell__main">
            <div className="shell__content" data-page-context-root="">
              <p className="muted">
                A Decision filed by the companion arrives on the rail without a reload.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/decisions"]}>
      <UpdateProvider>
        <VaultProvider>
          <LiveDataProvider>
            <ChatDockProvider>
              <NavDockProvider>
                <WingProvider>
                  <ChatSessionsProvider>
                    <Harness />
                  </ChatSessionsProvider>
                </WingProvider>
              </NavDockProvider>
            </ChatDockProvider>
          </LiveDataProvider>
        </VaultProvider>
      </UpdateProvider>
    </MemoryRouter>
  </StrictMode>,
);
