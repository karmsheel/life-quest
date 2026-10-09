/**
 * E2E harness for Settings → Agent, the page that shows what the companion is
 * told and what it has been given to read (driven by
 * `settings-agent.electron.mjs`).
 *
 * A system-in-isolation rig, so the ways it can fail are written down first:
 *
 *  1. The section renders nothing: no prompt text, no instructions, no skills —
 *     the page exists in the nav and answers no question.
 *  2. The page shows a prompt the profile does not hold. The whole reason this
 *     surface exists is that the operator could not see what the agent received;
 *     a page that prints a seed while the profile holds their own words is the
 *     same blindness with a nicer font.
 *  3. The seeded/edited badge contradicts the text it sits above.
 *  4. The prompt body is unreadable: zero height, a transparent colour, or
 *     clipped rather than scrollable.
 *  5. A long prompt breaks the layout instead of wrapping: the sheet scrolls
 *     sideways, which is how one pasted paragraph takes the whole settings page
 *     with it.
 *  6. The skill list is empty, drops LifeQuest's own skills, or lists a skill
 *     with no description — "here are 60 folders" answers nothing.
 *  7. The count badge disagrees with the rows under it.
 *
 * The IPC bridge is stubbed (there is no Electron preload on a dev-server page);
 * the settings section, the real CSS and the real layout engine are shipping code.
 */
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsCompanionPrompts } from "@/components/settings/SettingsCompanionPrompts";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

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
  domains: [],
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

/**
 * Two payloads. The first is this app's own seed with a full skill library; the
 * second is a profile the operator has written themselves, which is the branch
 * the badge has to get right.
 */
const SEEDED = {
  profilePath: "C:/hermes/profiles/lifequest",
  soul: {
    path: "C:/hermes/profiles/lifequest/SOUL.md",
    text:
      "You are the LifeQuest companion — the app's own agent, pre-paired, acting as the operator with full access to this vault.\n\n" +
      "MAKING A CARD. One call does the whole job: save_view, carrying spec, the domainSlug that owns the view, and the boardSlug to pin it on. " +
      "A very long unbroken token follows so the body has to wrap rather than widen the page: " +
      `${"x".repeat(180)}\n\n<!-- lifequest-soul: 4 -->\n`,
    seeded: true,
    edited: false,
  },
  instructions: {
    text:
      "You are chatting inside the LifeQuest app.\nActive domain: Financial (financial)\nAbout me: I like tea\n" +
      'The operator is looking at the financial dashboard (domainSlug: "financial") right now — when they say "the Dashboard", they mean that board.\n' +
      "That dashboard is UNLOCKED: your view and pin changes land at once, so do not say a decision is waiting for them.\n",
    context: {
      domainName: "Financial",
      domainSlug: "financial",
      viewingBoard: "financial",
      viewingBoardLocked: false,
      aboutMe: "I like tea",
      locked: false,
      vaultOpen: true,
      fileUnsolicited: true,
    },
  },
  skills: [
    {
      name: "lifequest-dashboard-scripting",
      description: "Use when adding computed tables to LifeQuest dashboards — weekly and monthly totals, rollups, trends.",
      category: "lifequest",
      relPath: "skills/lifequest/lifequest-dashboard-scripting/SKILL.md",
      lifequest: true,
      bundled: false,
      pinned: false,
      useCount: 2,
      viewCount: 1,
      lastUsedAt: "2026-10-08T20:00:00+00:00",
      version: "1.0.0",
      tags: ["LifeQuest", "dashboards"],
    },
    {
      name: "lifequest-mcp",
      description: "Driving the LifeQuest MCP server from a Hermes session.",
      category: "productivity",
      relPath: "skills/productivity/lifequest-mcp/SKILL.md",
      lifequest: false,
      bundled: true,
      pinned: true,
      useCount: 7,
      viewCount: 3,
      lastUsedAt: "2026-10-08T21:00:00+00:00",
      version: "1.2.0",
      tags: [],
    },
    {
      name: "arxiv",
      description: "Searching arXiv.",
      category: "research",
      relPath: "skills/research/arxiv/SKILL.md",
      lifequest: false,
      bundled: true,
      pinned: false,
      useCount: 0,
      viewCount: 0,
      lastUsedAt: null,
      version: null,
      tags: [],
    },
  ],
  soulSeedPath: "companion-profile.ts → COMPANION_SOUL",
};

const EDITED = {
  ...SEEDED,
  soul: {
    ...SEEDED.soul,
    text: "Be terse. Never use emoji. Never write to the vault without asking.\n",
    seeded: false,
    edited: true,
  },
  skills: SEEDED.skills.slice(0, 2),
};

let current = SEEDED;

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionGetFiling: () => Promise.resolve(true),
  companionPrompts: () => ok(current),
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
// The second payload, for the driver's "the operator wrote their own SOUL" step:
// it is handed back through `settingsAgentSetPayload` rather than re-declared in
// the driver, so the two cannot drift.
(window as unknown as { settingsAgentEditedPayload: unknown }).settingsAgentEditedPayload = EDITED;

/** Install another payload and force the section to re-read it. */
function Harness() {
  const [generation, setGeneration] = useState(0);
  const install = useCallback((payload: typeof SEEDED) => {
    current = payload;
    setGeneration((g) => g + 1);
  }, []);
  useEffect(() => {
    (window as unknown as { settingsAgentSetPayload: unknown }).settingsAgentSetPayload = install;
  }, [install]);
  // The key remounts the section, which is how a re-read is forced without a
  // real bridge: the component reads on mount and on the vault path.
  return <SettingsCompanionPrompts key={generation} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from settings-agent.html");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <VaultProvider>
        <div className="app-root">
          <div className="app-root__body">
            <div className="shell">
              <main className="shell__main">
                <div className="shell__content">
                  <Harness />
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

const waitForPage = () => {
  const soul = document.querySelector('[data-testid="agent-soul-text"]');
  const skills = document.querySelectorAll('[data-testid="agent-skill"]');
  if (!soul || skills.length === 0) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

(window as unknown as { settingsAgentHarnessReady: Promise<void> }).settingsAgentHarnessReady =
  ready;
