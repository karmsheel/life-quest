/**
 * E2E harness page for the decisions inbox cards.
 *
 * The operator's report this rig is for: the inbox reads flat — a card is the
 * same paper as the sheet it sits on — and asks for three things on top of that:
 * a card surface of its own, a hover/slash shading effect, a larger `Pending`
 * badge at the top right, and the domain it was filed for as a badge beside that
 * status.
 *
 * It renders the REAL `DecisionsOverlay` / `DecisionsInbox` — the real sheet
 * frame, tabs, card list, status pills, domain badges and manual store — inside
 * the real `VaultProvider` and `LiveDataProvider`, in a real Electron window.
 * The only thing stubbed is `window.lifequest`, which plays the main process:
 * `decisionList` and `manualDecisionList` hand back copies, exactly as the real
 * handlers do.
 *
 * WHAT IS MEASURED, RATHER THAN EYEBALLED
 *
 *  - The card's painted background against the SHEET's painted background, as
 *    colour distance and WCAG contrast. The sheet panel wears `--card`, the same
 *    token the card did, which is the reason it was flat; "different colour"
 *    therefore has a number, in both the dark and the light skin.
 *  - The diagonal shading: a real `linear-gradient` on the card, and a
 *    pseudo-element whose translateX is off the card at rest and across it while
 *    the pointer is on the card. The driver moves the pointer with
 *    `sendInputEvent`, so this is Chromium's own `:hover`, not a class the rig
 *    set.
 *  - The `Pending` pill's computed font-size and box against the kind chip's, and
 *    its distance from the card's top-right corner.
 *  - The domain badge's text, its `data-domain-slug`, and that it is the status
 *    pill's immediately preceding sibling, centred on the same line.
 *
 * `?theme=light` re-runs the same page in the light skin, so the surface claim is
 * not one palette's accident.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  DecisionRecord,
  DomainRecord,
  ManualDecisionRecord,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { DecisionsOverlay } from "@/components/decisions/DecisionsOverlay";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

type Theme = "light" | "dark";
const requestedTheme: Theme =
  new URLSearchParams(window.location.search).get("theme") === "light"
    ? "light"
    : "dark";
const skinName = applyAppSkin(requestedTheme);

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const NOW = "2026-10-21T09:00:00.000Z";

// ── the world the page reads ────────────────────────────────────────────────

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
const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;

function proposal(
  id: string,
  domainSlug: string | null,
  title: string,
  createdAt: string,
): DecisionRecord {
  const target: DecisionRecord["target"] = domainSlug
    ? { type: "doctrine", domainSlug, kind: "premise" }
    : { type: "agent-pairing", agentId: "agent-1" };
  return {
    id,
    target,
    domainSlugs: domainSlug ? [domainSlug] : [],
    status: "pending",
    title,
    rationale:
      "The last quarter's ledger says the premise costs more than it claims, so the wording should say what it actually costs.",
    proposedTitle: title,
    previousTitle: title,
    proposedBodyMarkdown: domainSlug
      ? `## Premise\n\n${title}: the monthly cost of staying here is the number the ledger holds, not the number the premise claims.\n`
      : JSON.stringify({ fingerprint: "a1b2c3d4e5f6", door: "companion-mcp" }),
    previousBodyMarkdown: domainSlug
      ? `## Premise\n\n${title}: the monthly cost of staying here.\n`
      : null,
    actor: COMPANION,
    createdAt,
    resolvedAt: null,
    reason: null,
  };
}

/**
 * Newest first in the list: the pairing proposal is domainless on purpose (KAR-70),
 * so "no domain badge" is a fact the page can be asked for rather than a guess.
 */
const DECISIONS: DecisionRecord[] = [
  proposal(
    "decision-financial",
    "financial",
    "Premise revision — financial",
    "2026-10-21T09:10:00.000Z",
  ),
  proposal(
    "decision-health",
    "health",
    "Premise revision — health",
    "2026-10-21T09:20:00.000Z",
  ),
  proposal(
    "decision-pairing",
    null,
    "Connect a new companion",
    "2026-10-21T09:30:00.000Z",
  ),
];

const MANUAL: ManualDecisionRecord = {
  id: "manual-1",
  title: "Stop the gym membership",
  rationale: "The ledger says it costs more than it returns.",
  domainSlug: "financial",
  actor: { type: "user" },
  createdAt: "2026-10-21T08:40:00.000Z",
};

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
    theme: requestedTheme,
    weekStartDay: "monday",
    autoApproveInserts: [],
  },
  domains: DOMAINS,
  agents: [],
  decisions: DECISIONS.map((d) => ({ ...d })),
  log: [],
  map: null,
  mapError: null,
  goals: [],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

// ── the instrument ──────────────────────────────────────────────────────────

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type Chip = {
  text: string;
  slug: string;
  box: Box;
  fontSize: number;
  background: string;
  color: string;
};

type CardSample = {
  id: string;
  title: string;
  cardBox: Box;
  background: string;
  backgroundImage: string;
  borderTopColor: string;
  borderLeftColor: string;
  padding: { top: number; right: number; bottom: number; left: number };
  /** WCAG contrast of the card against the sheet's own painted background. */
  contrastVsSheet: number;
  /** Largest per-channel difference against the sheet (0–255). */
  channelDeltaVsSheet: number;
  /** Largest per-channel difference against the page canvas behind the sheet. */
  channelDeltaVsCanvas: number;
  status: string;
  statusBox: Box | null;
  statusFontSize: number | null;
  statusPaddingY: number | null;
  statusBackground: string | null;
  statusColor: string | null;
  kind: string | null;
  kindBox: Box | null;
  kindFontSize: number | null;
  domains: Chip[];
  /** True when every domain badge is the status pill's immediately preceding sibling. */
  domainsImmediatelyBeforeStatus: boolean;
  /** Chromium's own ":hover" on this card, i.e. the pointer really is on it. */
  hovered: boolean;
  /** The hover-revealed slash: one diagonal band of shading (::before). */
  slashBackgroundImage: string;
  slashOpacity: number;
  sheenBackgroundImage: string;
  sheenTransform: string;
  /** The pseudo-element's translateX in px: negative = off one edge, positive = the other. */
  sheenTranslateX: number | null;
  meta: string;
};

type SheetSample = {
  background: string;
  box: Box;
};

type Screen = {
  ready: boolean;
  skin: string;
  theme: string | null;
  sheet: SheetSample | null;
  bodyBackground: string;
  activeTab: string | null;
  cards: CardSample[];
};

type HarnessWindow = Window & {
  decisionsCardsReady?: boolean;
  decisionsCardsSkin?: string;
  decisionsCardsCalls?: string[];
  decisionsCardsUnexpectedCalls?: string[];
  decisionsCardsScreen?: () => Screen;
  decisionsCardsTab?: (label: string) => boolean;
};

const harness = window as HarnessWindow;
harness.decisionsCardsCalls = [];
harness.decisionsCardsUnexpectedCalls = [];

function text(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
    top: Math.round(r.top),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
    left: Math.round(r.left),
  };
}

/** A computed colour string as sRGB bytes, for contrast arithmetic. */
function channels(color: string): [number, number, number] {
  const srgb = color.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/,
  );
  if (srgb) {
    return [
      Math.round(Number(srgb[1]) * 255),
      Math.round(Number(srgb[2]) * 255),
      Math.round(Number(srgb[3]) * 255),
    ];
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) {
    return [Math.round(Number(rgb[1])), Math.round(Number(rgb[2])), Math.round(Number(rgb[3]))];
  }
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = Number.parseInt(hex[1]!, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  return [0, 0, 0];
}

function luminance(color: string): number {
  const [r, g, b] = channels(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return Number(((light + 0.05) / (dark + 0.05)).toFixed(3));
}

function channelDelta(a: string, b: string): number {
  const ca = channels(a);
  const cb = channels(b);
  return Math.max(...ca.map((value, index) => Math.abs(value - cb[index]!)));
}

function sampleCard(card: HTMLElement, sheetBackground: string, canvasBackground: string): CardSample {
  const statusEl = card.querySelector<HTMLElement>(".decision-status");
  const kindEl = card.querySelector<HTMLElement>(".decision-kind");
  const statusStyle = statusEl ? getComputedStyle(statusEl) : null;
  const kindStyle = kindEl ? getComputedStyle(kindEl) : null;
  const cardStyle = getComputedStyle(card);
  const slash = getComputedStyle(card, "::before");
  const sheen = getComputedStyle(card, "::after");
  const chips = [...card.querySelectorAll<HTMLElement>(".decision-domain")];
  let translateX: number | null = null;
  try {
    const matrix = new DOMMatrixReadOnly(sheen.transform);
    translateX = Math.round(matrix.m41);
  } catch {
    translateX = null;
  }
  const background = cardStyle.backgroundColor;
  return {
    id: card.dataset.decisionId ?? card.dataset.manualDecisionId ?? "",
    title: text(card.querySelector(".decision-card__title")),
    cardBox: box(card),
    background,
    backgroundImage: cardStyle.backgroundImage,
    borderTopColor: cardStyle.borderTopColor,
    borderLeftColor: cardStyle.borderLeftColor,
    padding: {
      top: parseFloat(cardStyle.paddingTop),
      right: parseFloat(cardStyle.paddingRight),
      bottom: parseFloat(cardStyle.paddingBottom),
      left: parseFloat(cardStyle.paddingLeft),
    },
    contrastVsSheet: contrast(background, sheetBackground),
    channelDeltaVsSheet: channelDelta(background, sheetBackground),
    channelDeltaVsCanvas: channelDelta(background, canvasBackground),
    status: statusEl ? text(statusEl) : "",
    statusBox: statusEl ? box(statusEl) : null,
    statusFontSize: statusStyle ? parseFloat(statusStyle.fontSize) : null,
    statusPaddingY: statusStyle ? parseFloat(statusStyle.paddingTop) : null,
    statusBackground: statusStyle ? statusStyle.backgroundColor : null,
    statusColor: statusStyle ? statusStyle.color : null,
    kind: kindEl ? text(kindEl) : null,
    kindBox: kindEl ? box(kindEl) : null,
    kindFontSize: kindStyle ? parseFloat(kindStyle.fontSize) : null,
    domains: chips.map((chip) => {
      const style = getComputedStyle(chip);
      return {
        text: text(chip),
        slug: chip.dataset.domainSlug ?? "",
        box: box(chip),
        fontSize: parseFloat(style.fontSize),
        background: style.backgroundColor,
        color: style.color,
      };
    }),
    domainsImmediatelyBeforeStatus: (() => {
      if (chips.length === 0) return true;
      let node: Element | null = statusEl;
      for (let i = chips.length - 1; i >= 0; i -= 1) {
        node = node?.previousElementSibling ?? null;
        if (node !== chips[i]) return false;
      }
      return true;
    })(),
    hovered: card.matches(":hover"),
    slashBackgroundImage: slash.backgroundImage,
    slashOpacity: Number(slash.opacity),
    sheenBackgroundImage: sheen.backgroundImage,
    sheenTransform: sheen.transform,
    sheenTranslateX: translateX,
    meta: text(card.querySelector(".decision-card__meta")),
  };
}

function screen(): Screen {
  const panel = document.querySelector<HTMLElement>(".sheet-overlay__panel");
  const sheetBackground = panel ? getComputedStyle(panel).backgroundColor : "rgb(0, 0, 0)";
  const canvasBackground = getComputedStyle(document.documentElement).getPropertyValue(
    "--canvas-base",
  );
  // `--canvas-base` is a hex the theme writes; use the sheet's sibling backdrop as
  // the painted page when the token is not resolvable to a colour.
  const canvas = canvasBackground.trim() || "rgb(0, 0, 0)";
  const cards = [...document.querySelectorAll<HTMLElement>(".decision-card")];
  return {
    ready: Boolean(harness.decisionsCardsReady),
    skin: skinName,
    theme: document.documentElement.getAttribute("data-theme"),
    sheet: panel
      ? { background: sheetBackground, box: box(panel) }
      : null,
    bodyBackground: canvas,
    activeTab:
      text(document.querySelector('.decisions-inbox__tab[aria-selected="true"]')) || null,
    cards: cards.map((card) => sampleCard(card, sheetBackground, canvas)),
  };
}

harness.decisionsCardsScreen = screen;
harness.decisionsCardsTab = (label) => {
  const tab = [...document.querySelectorAll<HTMLElement>(".decisions-inbox__tab")].find(
    (button) => text(button) === label,
  );
  if (!tab) return false;
  tab.click();
  return true;
};

// ── the bridge stub, playing the main process ───────────────────────────────

const stubs: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  vaultGetSnapshot: async () => ok(SNAPSHOT),
  vaultListRecent: async () => [],
  domainGetActive: async () => null,
  domainSetActive: async () => ok(null),
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: () => () => {},
  decisionList: async () => ok(DECISIONS.map((decision) => ({ ...decision }))),
  manualDecisionList: async () => ok([{ ...MANUAL }]),
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.decisionsCardsCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.decisionsCardsUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

function MountProbe() {
  useEffect(() => {
    harness.decisionsCardsReady = true;
    return () => {
      harness.decisionsCardsReady = false;
    };
  }, []);
  return null;
}

/**
 * The shipped shape: the real sheet over a page, portalled to `<body>` exactly as
 * `DecisionsPage` renders it. No wrapper frame of this rig's own, so the card's
 * background is measured against the panel the operator actually sees.
 */
function Harness() {
  return (
    <MemoryRouter initialEntries={["/decisions"]}>
      <VaultProvider>
        <LiveDataProvider>
          <MountProbe />
          <DecisionsOverlay onClose={() => {}} />
        </LiveDataProvider>
      </VaultProvider>
    </MemoryRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

harness.decisionsCardsSkin = skinName;
