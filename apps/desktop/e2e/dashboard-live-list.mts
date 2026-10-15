/**
 * The acceptance asset: put a "recent transactions" listing on the operator's
 * real FINANCIAL dashboard, through the companion's own tool surface.
 *
 *   node e2e/dashboard-live-list.mts [vaultPath]
 *
 * The vault defaults to the first entry of the app's `recent.json`, which is the
 * vault the studio would reopen. It is deliberately NOT part of `npm test`: it
 * writes to the operator's own vault, and a test that mutates the thing it is
 * checking cannot be re-run blindly — `save_view` with no `viewId` makes a NEW
 * card each time, so two runs leave two cards on the board and the operator
 * deletes one by hand.
 *
 * Like `dashboard-live-summary.mts`, this calls the exact tools the companion
 * calls over MCP — `get_dashboard`, then `save_view` — with the companion's
 * actor, so what it produces is what a chat turn would produce.
 *
 * The artifact is `e2e/artifacts/dashboard-live-list.json`: the board before and
 * after, the card the vault saved, and the card as the dashboard draws it.
 * `node e2e/view-list.electron.mjs` draws that card at 1:1 when
 * `LIFEQUEST_LIST_SOURCE` points at the artifact.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeViewTool,
  getDatabase,
  getView,
  listPinBoard,
  listViews,
  runSavedView,
} from "../../../packages/vault-core/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT = path.join(here, "artifacts/dashboard-live-list.json");

/** The companion's actor, exactly as the MCP door passes it. */
const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;

/** The domain that owns the ledger, and the board the card is meant to land on. */
const DOMAIN = "financial";
const DATABASE = "finance:transactions";

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
const before = await listPinBoard(VAULT, DOMAIN);
if (!before.ok) {
  console.error(before.error);
  process.exit(1);
}
say("get_dashboard (Financial, before)", {
  locked: before.value.locked,
  pins: before.value.pins.map((p) => p.id),
});

if (before.value.locked) {
  console.error(
    "the Financial dashboard is locked: unlock it in the app (or set locked:false in " +
      "domains/financial/pins.json) and run this again — this step is the unlocked path",
  );
  process.exit(1);
}

// 2. the ledger's columns, as a tool would see them
const live = await getDatabase(VAULT, DOMAIN, DATABASE);
if (!live.ok) {
  console.error(`the financial domain has no ledger to list: ${live.error}`);
  process.exit(1);
}
const columns = live.value.columns.map((c) => c.id);
say(
  "the Transactions database",
  live.value.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
);

// The four columns the operator asked for. A column the ledger does not have
// would make the card refuse to save, so the spec is built from what is there.
const WANTED = ["date", "payee", "category", "amount"];
const chosen = WANTED.filter((id) => columns.includes(id));
if (chosen.length === 0) {
  console.error(`the ledger has none of ${WANTED.join(", ")}; nothing to list`);
  process.exit(1);
}

// 3. preview: the rows the card would show, before anything is written
const spec = {
  databaseId: DATABASE,
  title: "Recent transactions",
  presentation: "list" as const,
  columns: chosen,
  timeColumnId: columns.includes("date") ? "date" : null,
  timeWindow: columns.includes("date") ? { kind: "last-weeks" as const, weeks: 8 } : "all" as const,
  limit: 12,
  filters: [],
  span: 2 as const,
};

const preview = await executeViewTool(VAULT, COMPANION, "preview_view", {
  domainSlug: DOMAIN,
  spec,
  boardSlug: DOMAIN,
});
say("preview_view", preview);

// 4. save it and pin it, in the one call.
//
// A card with this title that already exists is UPDATED rather than joined by a
// second one: re-running this asset is how the operator refreshes the card, and
// an acceptance step that leaves a duplicate behind every time is a step nobody
// dares run twice.
const existing = await listViews(VAULT, DOMAIN);
const already = existing.ok ? existing.value.find((v) => v.title === spec.title) : undefined;
if (already) say("updating the card that already carries this title", { viewId: already.id });

const saved = await executeViewTool(VAULT, COMPANION, "save_view", {
  domainSlug: DOMAIN,
  boardSlug: DOMAIN,
  spec,
  span: 2,
  ...(already ? { viewId: already.id } : {}),
});
say("save_view", saved);

// 4b. put it at the top of the board, which is where the operator asked for it.
const viewId = (saved as { viewId?: string }).viewId;
if (viewId) {
  const board = await listPinBoard(VAULT, DOMAIN);
  if (board.ok) {
    const own = board.value.pins.filter((p) => "viewId" in p && p.viewId === viewId);
    const rest = board.value.pins.filter((p) => !("viewId" in p) || p.viewId !== viewId);
    const arranged = await executeViewTool(VAULT, COMPANION, "arrange_dashboard", {
      domainSlug: DOMAIN,
      pins: [...own, ...rest],
    });
    say("arrange_dashboard (the card to the top)", arranged);
  }
}

// 5. read the board back, and run the saved card exactly as the dashboard does
const after = await listPinBoard(VAULT, DOMAIN);
say("get_dashboard (Financial, after)", {
  locked: after.ok ? after.value.locked : after.error,
  pins: after.ok ? after.value.pins.map((p) => p.id) : [],
});

let savedView: unknown = null;
let run: unknown = null;
if (viewId) {
  // The card's own file, exactly as the app reads it, carried whole so a
  // renderer downstream draws the real thing rather than a reconstruction.
  const readBack = await getView(VAULT, DOMAIN, viewId);
  if (!readBack.ok) {
    console.error(`saved view could not be read back: ${readBack.error}`);
    process.exit(1);
  }
  savedView = readBack.value;
  const ran = await runSavedView(VAULT, DOMAIN, viewId, new Date());
  run = ran.ok ? ran.value : { error: ran.error };
  say("the card as the dashboard draws it", run);
} else {
  console.error(`save_view wrote no card: ${JSON.stringify(saved)}`);
}

const pins = after.ok ? after.value.pins.map((p) => p.id) : [];
const pass =
  Boolean(viewId) &&
  (saved as { applied?: boolean }).applied === true &&
  pins.some((id) => id.includes(viewId as string)) &&
  // "At the top" is a claim about the board, so it is checked on the board.
  pins[0]?.includes(viewId as string) === true;

fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
fs.writeFileSync(
  ARTIFACT,
  `${JSON.stringify(
    {
      pass,
      what: "a recent-transactions listing put on the operator's real Financial dashboard through the companion's own tools",
      vault: VAULT,
      board: DOMAIN,
      savedView,
      run,
      steps,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`\nwrote ${ARTIFACT}`);
console.log(
  `pass=${pass} — draw it with: LIFEQUEST_LIST_SOURCE="${ARTIFACT}" node e2e/view-list.electron.mjs`,
);
process.exit(pass ? 0 : 1);
