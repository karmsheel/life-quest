/**
 * The acceptance asset: put a summary table on the operator's real dashboard,
 * through the companion's own tool surface.
 *
 * This is the step that answers "does it actually work", so it runs against the
 * live vault rather than a fixture. It calls the exact tools the companion calls
 * over MCP — `preview_view`, then `save_view` — with the companion's actor, so
 * what it produces is what a chat turn would produce.
 *
 *   node e2e/dashboard-live-summary.mts [vaultPath]
 *
 * The vault defaults to the first entry of the app's `recent.json`, which is the
 * vault the studio would reopen. It is deliberately NOT part of `npm test`: it
 * writes to the operator's own vault, and a test that mutates the thing it is
 * checking cannot be re-run blindly. Run it, then `dashboard-live-app.mjs`
 * verifies what it left behind.
 *
 * The artifact is `e2e/artifacts/dashboard-live-summary.json`: the preview, the
 * save, the board before and after, and the card as the dashboard draws it.
 * `dashboard-live-card.electron.mjs` turns that into a screenshot.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeViewTool,
  getDatabase,
  getView,
  isPinBoardLocked,
  listPinBoard,
  runSavedView,
} from "../../../packages/vault-core/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT = path.join(here, "artifacts/dashboard-live-summary.json");

/** The companion's actor, exactly as the MCP door passes it. */
const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;

/** The vault to write to, or `null` when the app has no recent vault yet. */
function vaultFromRecent(): string | null {
  const recentPath = path.join(os.homedir(), "AppData", "Roaming", "LifeQuest", "recent.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(recentPath, "utf8")) as {
      recent?: { path?: string }[];
    };
    const first = parsed.recent?.[0]?.path?.trim();
    return first || null;
  } catch {
    return null;
  }
}

const VAULT = process.argv[2] ?? vaultFromRecent();
if (!VAULT) {
  console.error(
    "no vault: pass one as an argument, or open a vault in the app so recent.json names it",
  );
  process.exit(1);
}
if (!fs.existsSync(path.join(VAULT, "lifequest.json"))) {
  console.error(`${VAULT} is not a LifeQuest vault`);
  process.exit(1);
}

const steps: Array<Record<string, unknown>> = [];
const say = (label: string, value: unknown) => {
  steps.push({ step: label, value });
  const text = JSON.stringify(value, null, 2);
  console.log(`\n── ${label}\n${text.length > 2400 ? `${text.slice(0, 2400)}…` : text}`);
};

// 1. the board as it stands, and its lock
const before = await listPinBoard(VAULT, null);
if (!before.ok) {
  console.error(before.error);
  process.exit(1);
}
say("get_dashboard (Overview, before)", {
  locked: before.value.locked,
  pins: before.value.pins.map((p) => p.id),
});

if (before.value.locked) {
  console.error(
    "the Overview dashboard is locked: unlock it in the app (or set locked:false in " +
      ".lifequest/overview-pins.json) and run this again — this step is the unlocked path",
  );
  process.exit(1);
}

// 2. the ledger's columns, as a tool would see them
const live = await getDatabase(VAULT, "financial", "finance:transactions");
if (!live.ok) {
  console.error(`the financial domain has no ledger to summarise: ${live.error}`);
  process.exit(1);
}
say(
  "the Transactions database",
  live.value.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
);

// A month-by-month summary: the table is the requested shape, the metric is the
// same window in one number. One composed card, not two views.
const shared = {
  groupBy: "date",
  timeBucket: "month" as const,
  timeColumnId: "date",
  timeWindow: { kind: "last-weeks" as const, weeks: 26 },
  filters: [],
  sort: { by: "label" as const, dir: "asc" as const },
  limit: 12,
  convertToZar: false,
};
const measure = { measure: "sum" as const, measureColumnId: "amount" };
const spec = {
  schemaVersion: 1 as const,
  databaseId: "finance:transactions",
  title: "Spending by month",
  presentation: "table" as const,
  ...shared,
  ...measure,
  blocks: [
    { id: "total", title: "Last 6 months", presentation: "metric" as const, groupBy: null, ...measure },
    { id: "months", title: "Month by month", presentation: "table" as const, ...measure },
  ],
};

// 3. preview: what the card would show, before anything is written
const preview = await executeViewTool(VAULT, COMPANION, "preview_view", {
  domainSlug: "financial",
  spec,
  boardSlug: null,
});
say("preview_view", preview);

// 4. save it and pin it, in the one call
const saved = await executeViewTool(VAULT, COMPANION, "save_view", {
  domainSlug: "financial",
  boardSlug: null,
  spec,
  span: 2,
});
say("save_view", saved);

// 5. read the board back, and run the saved card exactly as the dashboard does
const after = await listPinBoard(VAULT, null);
say("get_dashboard (Overview, after)", {
  locked: after.ok ? after.value.locked : after.error,
  pins: after.ok ? after.value.pins.map((p) => p.id) : [],
});
const viewId = (saved as { viewId?: string }).viewId;
let savedView: unknown = null;
if (viewId) {
  // The card's own file, exactly as the app reads it. The artifact carries it
  // whole (blocks included) so a renderer downstream draws the real thing
  // rather than a reconstruction that has quietly dropped a field.
  const readBack = await getView(VAULT, "financial", viewId);
  if (!readBack.ok) {
    console.error(`saved view could not be read back: ${readBack.error}`);
    process.exit(1);
  }
  savedView = readBack.value;
  const run = await runSavedView(VAULT, "financial", viewId, new Date());
  say("the card as the dashboard draws it", run.ok ? run.value : run.error);
}

const pass =
  Boolean(viewId) &&
  (saved as { applied?: boolean }).applied === true &&
  (await isPinBoardLocked(VAULT, null)) === false;

fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
fs.writeFileSync(
  ARTIFACT,
  `${JSON.stringify(
    {
      pass,
      what: "a month-by-month summary table put on the operator's real Overview dashboard through the companion's own tools",
      vault: VAULT,
      savedView,
      steps,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`\nwrote ${ARTIFACT}`);
console.log(`pass=${pass} — next: node e2e/dashboard-live-app.mjs`);
process.exit(pass ? 0 : 1);
