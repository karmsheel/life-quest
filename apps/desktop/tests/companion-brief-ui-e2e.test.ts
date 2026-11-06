import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  BRIEF_KIND_LABELS,
  BRIEF_OPERATOR_REASONS,
  BRIEF_REASON_LABELS,
  BRIEF_STALE_MS,
  createVault,
  dismissBriefItem,
  executeCompanionBriefTool,
  readCompanionBrief,
  type Actor,
  type BriefDismissalReason,
  type CompanionBriefRead,
} from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const REPORT = path.join(ARTIFACTS, "companion-brief-ui.json");
const SHOTS = [
  "companion-brief-ui.png",
  "companion-brief-ui-expired.png",
  "companion-brief-ui-stale.png",
  "companion-brief-ui-empty.png",
  "companion-brief-ui-menu.png",
];

/** The companion's actor, exactly as the MCP door passes it. */
const COMPANION: Actor = { type: "agent", id: "companion", name: "Hermes" };
const USER: Actor = { type: "user" };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The companion brief, rendered by the real Dashboard card and driven from
 * scenario reads the REAL vault produced.
 *
 * This is the whole feature in one run. The wrapper half builds a temp vault and
 * uses the real engine — `executeCompanionBriefTool` for the companion's write
 * and read, `readCompanionBrief` for the card's read, `dismissBriefItem` for the
 * operator's verb — so the reads the page draws cannot drift from the server's
 * shape. The driver half mounts the real HomePage in a real Electron window over
 * a recording bridge, feeds it those reads, and reads the shipped card back off
 * the DOM. Together they claim:
 *
 *   1. Five items render in priority order, each with the kind label, line and
 *      justification the server stored — even though the writer sent them in a
 *      different order.
 *   2. A sixth write is refused by the real set tool with the exact
 *      "too many brief items (max 5)", and the rendered five-item board does not
 *      move when the post-refusal read is mounted.
 *   3. An item past its `expiresAt` renders faded, with the `is-expired` class
 *      and the literal word "expired", while the live items beside it do not.
 *   4. A `writtenAt` older than 48 hours renders "Not refreshed since <date>".
 *   5. An empty brief renders "Nothing on the brief today" rather than nothing.
 *   6. The dismissal control offers Done / Not useful / Wrong / Later and a real
 *      press on "Not useful" calls `briefDismiss(itemId, "not-useful")` and
 *      draws the real vault's post-dismissal read: the item leaves, the other
 *      four keep their words and order.
 *
 * The artifact is `e2e/artifacts/companion-brief-ui.json` plus five screenshots.
 * The report carries the server evidence beside the rendered samples, so the
 * file alone shows both halves of every claim.
 *
 * The rig renders a real page in a real layout engine, so it needs the Vite dev
 * server. `lifequest-e2e` puts this checkout on the bench and starts it; with
 * the server down the test skips rather than passing on nothing.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(fixturePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/companion-brief-ui.electron.mjs")],
      {
        cwd: desktopRoot,
        timeout: 120_000,
        env: { ...process.env, LIFEQUEST_BRIEF_FIXTURE: fixturePath },
      },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

function readOf(result: unknown, label: string): CompanionBriefRead {
  const res = result as { ok: true; value: CompanionBriefRead } | { ok: false; error: string };
  assert.equal(res.ok, true, `${label} failed: ${res.ok ? "" : res.error}`);
  return res.value;
}

function toolError(result: unknown): { code: string; message: string } {
  const res = result as { error?: { code: string; message: string } };
  assert.ok(res.error, "the tool call was expected to be refused and was not");
  return res.error;
}

type ServerEvidence = {
  vaultRoot: string;
  emptyVaultRoot: string;
  fiveWrite: {
    actor: string;
    writtenAt: string | null;
    writtenBy: string | null;
    itemIds: string[];
    priorities: number[];
    kinds: string[];
    itemCount: number;
  };
  toolRead: { writtenAt: string | null; itemIds: string[] };
  sixthWrite: { attempted: number; refused: boolean; code: string; message: string };
  readUnchangedAfterRefusal: boolean;
  afterRefusal: { writtenAt: string | null; itemIds: string[]; itemCount: number };
  expired: {
    writtenAt: string | null;
    activeIds: string[];
    recentlyExpiredIds: string[];
    expiredAt: string;
  };
  stale: { writtenAt: string | null; ageHours: number; itemIds: string[] };
  empty: {
    writtenAt: string | null;
    writtenBy: string | null;
    itemCount: number;
    recentlyExpiredCount: number;
    dismissals: number;
    problems: string[];
  };
  dismiss: {
    actor: string;
    itemId: string;
    reason: string;
    remainingIds: string[];
    dismissalLogged: boolean;
  };
};

type Fixture = {
  generatedAt: string;
  labels: Record<string, string>;
  reasonLabels: string[];
  scenarios: {
    five: { read: CompanionBriefRead };
    fiveAfterRefusal: { read: CompanionBriefRead };
    expired: { read: CompanionBriefRead };
    stale: { read: CompanionBriefRead };
    empty: { read: CompanionBriefRead };
    dismiss: {
      before: CompanionBriefRead;
      after: CompanionBriefRead;
      call: { itemId: string; reason: BriefDismissalReason };
    };
  };
  server: ServerEvidence;
};

/**
 * Build every scenario read with the real engine, and keep the server's own
 * evidence beside them. The clock is anchored to the wall clock so the shipped
 * card's own `Date.now()` and the fixture agree on what "past" and "stale" mean.
 */
async function buildFixture(workDir: string): Promise<Fixture> {
  const briefRoot = path.join(workDir, "brief-vault");
  const emptyRoot = path.join(workDir, "empty-vault");
  const created = await createVault(briefRoot);
  assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
  const createdEmpty = await createVault(emptyRoot);
  assert.equal(createdEmpty.ok, true, `createVault (empty vault) failed: ${createdEmpty.ok ? "" : createdEmpty.error}`);

  const real = Date.now();
  const fiveWriteAt = new Date(real - 60_000);
  const fiveReadAt = new Date(real);
  const farFuture = new Date(real + DAY).toISOString();

  // Five items, one per kind, written in an order that is NOT priority order:
  // the server sorts them and the card must draw the server's order. Unique
  // priorities 1..5 make "priority order" a single falsifiable sequence.
  const fiveItems = [
    {
      kind: "commitment",
      text: "Send the signed lease back to the agent",
      why: "You said you would on Tuesday and it is still open",
      sourceRef: "conversation 2026-11-03",
      priority: 3,
      expiresAt: farFuture,
    },
    {
      kind: "watch",
      text: "The bond payment leaves on Thursday",
      why: "The account was short this month last time",
      sourceRef: "note 2026-11-05",
      priority: 1,
      expiresAt: farFuture,
    },
    {
      kind: "pattern",
      text: "Three late nights in a row",
      why: "The same sentence appears in three daily notes",
      sourceRef: "note 2026-11-02",
      priority: 5,
      expiresAt: farFuture,
    },
    {
      kind: "prompt",
      text: "What would make this week feel finished?",
      why: "The week has no stated win yet",
      sourceRef: "note 2026-11-05",
      priority: 2,
      expiresAt: farFuture,
    },
    {
      kind: "ahead",
      text: "Vehicle licence renews on the 20th",
      why: "The renewal takes a week and nothing is booked",
      sourceRef: "signal:veh-licence",
      priority: 4,
      expiresAt: farFuture,
    },
  ];

  const fiveWrite = await executeCompanionBriefTool(
    briefRoot,
    COMPANION,
    "set_companion_brief",
    { items: fiveItems },
    fiveWriteAt,
  );
  assert.equal(
    (fiveWrite as { error?: unknown }).error,
    undefined,
    `the five-item write was refused: ${JSON.stringify(fiveWrite)}`,
  );
  const fiveRead = readOf(await readCompanionBrief(briefRoot, fiveReadAt), "the five-item read");
  // The companion's own read of the same vault must agree with the card's read.
  const fiveTool = (await executeCompanionBriefTool(
    briefRoot,
    COMPANION,
    "get_companion_brief",
    {},
    fiveReadAt,
  )) as { items?: { id: string }[]; writtenAt?: string | null };

  // The sixth write: the real tool, six real items, the real refusal.
  const sixthWrite = await executeCompanionBriefTool(
    briefRoot,
    COMPANION,
    "set_companion_brief",
    {
      items: [
        ...fiveItems,
        {
          kind: "watch",
          text: "A sixth item the brief must refuse",
          why: "The brief is a glance, not a report",
          sourceRef: "note 2026-11-05",
          priority: 5,
          expiresAt: farFuture,
        },
      ],
    },
    new Date(real + 1_000),
  );
  const sixthError = toolError(sixthWrite);
  const afterRefusalRead = readOf(
    await readCompanionBrief(briefRoot, new Date(real + 2_000)),
    "the read after the refused sixth write",
  );

  // The operator's verb, against the same real vault: dismiss the priority-2
  // item and hand the card the server's own post-dismissal read.
  const dismissedItem = fiveRead.items[1]!;
  const dismissCall = {
    itemId: dismissedItem.id,
    reason: "not-useful" as BriefDismissalReason,
  };
  const dismissAfter = readOf(
    await dismissBriefItem(
      briefRoot,
      USER,
      dismissCall.itemId,
      dismissCall.reason,
      new Date(real + 3_000),
    ),
    "the operator dismissal",
  );

  // An item that lapses an hour before the read: still inside the one-day
  // "recently expired" window, so the card draws it faded.
  const expiredWriteAt = new Date(real - 2 * HOUR);
  const expiredReadAt = new Date(real - 20 * 60_000);
  const expiredAt = new Date(real - 30 * 60_000).toISOString();
  const expiredWrite = await executeCompanionBriefTool(
    briefRoot,
    COMPANION,
    "set_companion_brief",
    {
      items: [
        {
          kind: "watch",
          text: "The roof repair quote runs out tonight",
          why: "The quote is the only one on file",
          sourceRef: "note 2026-11-05",
          priority: 1,
          expiresAt: new Date(real + DAY).toISOString(),
        },
        {
          kind: "prompt",
          text: "Where did the weekend actually go?",
          why: "Two notes disagree about Saturday",
          sourceRef: "note 2026-11-04",
          priority: 2,
          expiresAt: expiredAt,
        },
        {
          kind: "ahead",
          text: "Passport appointment is on Friday",
          why: "The renewal needs the old passport",
          sourceRef: "note 2026-11-05",
          priority: 3,
          expiresAt: new Date(real + 2 * DAY).toISOString(),
        },
      ],
    },
    expiredWriteAt,
  );
  assert.equal(
    (expiredWrite as { error?: unknown }).error,
    undefined,
    `the expired-scenario write was refused: ${JSON.stringify(expiredWrite)}`,
  );
  const expiredRead = readOf(
    await readCompanionBrief(briefRoot, expiredReadAt),
    "the expired-scenario read",
  );

  // A brief written 52 hours ago: over the card's 48-hour staleness line.
  const staleWriteAt = new Date(real - 52 * HOUR);
  const staleWrite = await executeCompanionBriefTool(
    briefRoot,
    COMPANION,
    "set_companion_brief",
    {
      items: [
        {
          kind: "prompt",
          text: "Is the studio still the right shape?",
          why: "The last three notes all question it",
          sourceRef: "note 2026-11-02",
          priority: 1,
          expiresAt: new Date(real + DAY).toISOString(),
        },
        {
          kind: "watch",
          text: "The rate on the bond moved this week",
          why: "The fix expires at the end of the month",
          sourceRef: "signal:bond-rate",
          priority: 2,
          expiresAt: new Date(real + DAY).toISOString(),
        },
      ],
    },
    staleWriteAt,
  );
  assert.equal(
    (staleWrite as { error?: unknown }).error,
    undefined,
    `the stale-scenario write was refused: ${JSON.stringify(staleWrite)}`,
  );
  const staleRead = readOf(
    await readCompanionBrief(briefRoot, new Date(real - HOUR)),
    "the stale-scenario read",
  );

  // A vault where the companion has never written: the card's empty state.
  const emptyRead = readOf(
    await readCompanionBrief(emptyRoot, new Date(real)),
    "the empty-vault read",
  );

  const fixture: Fixture = {
    generatedAt: new Date().toISOString(),
    labels: { ...BRIEF_KIND_LABELS },
    reasonLabels: BRIEF_OPERATOR_REASONS.map((reason) => BRIEF_REASON_LABELS[reason]),
    scenarios: {
      five: { read: fiveRead },
      fiveAfterRefusal: { read: afterRefusalRead },
      expired: { read: expiredRead },
      stale: { read: staleRead },
      empty: { read: emptyRead },
      dismiss: { before: fiveRead, after: dismissAfter, call: dismissCall },
    },
    server: {
      vaultRoot: briefRoot,
      emptyVaultRoot: emptyRoot,
      fiveWrite: {
        actor: `${COMPANION.type}:${COMPANION.id}`,
        writtenAt: fiveRead.writtenAt,
        writtenBy: fiveRead.writtenBy,
        itemIds: fiveRead.items.map((item) => item.id),
        priorities: fiveRead.items.map((item) => item.priority),
        kinds: fiveRead.items.map((item) => item.kind),
        itemCount: fiveRead.items.length,
      },
      toolRead: {
        writtenAt: fiveTool.writtenAt ?? null,
        itemIds: (fiveTool.items ?? []).map((item) => item.id),
      },
      sixthWrite: {
        attempted: 6,
        refused: true,
        code: sixthError.code,
        message: sixthError.message,
      },
      readUnchangedAfterRefusal:
        JSON.stringify(afterRefusalRead.items.map((item) => item.id)) ===
          JSON.stringify(fiveRead.items.map((item) => item.id)) &&
        afterRefusalRead.writtenAt === fiveRead.writtenAt,
      afterRefusal: {
        writtenAt: afterRefusalRead.writtenAt,
        itemIds: afterRefusalRead.items.map((item) => item.id),
        itemCount: afterRefusalRead.items.length,
      },
      expired: {
        writtenAt: expiredRead.writtenAt,
        activeIds: expiredRead.items.map((item) => item.id),
        recentlyExpiredIds: expiredRead.recentlyExpired.map((item) => item.id),
        expiredAt,
      },
      stale: {
        writtenAt: staleRead.writtenAt,
        ageHours: Math.round((real - Date.parse(staleRead.writtenAt ?? "")) / HOUR),
        itemIds: staleRead.items.map((item) => item.id),
      },
      empty: {
        writtenAt: emptyRead.writtenAt,
        writtenBy: emptyRead.writtenBy,
        itemCount: emptyRead.items.length,
        recentlyExpiredCount: emptyRead.recentlyExpired.length,
        dismissals: emptyRead.dismissals.length,
        problems: emptyRead.problems,
      },
      dismiss: {
        actor: "user",
        itemId: dismissCall.itemId,
        reason: dismissCall.reason,
        remainingIds: dismissAfter.items.map((item) => item.id),
        dismissalLogged:
          dismissAfter.dismissals[0]?.itemId === dismissCall.itemId &&
          dismissAfter.dismissals[0]?.reason === dismissCall.reason,
      },
    },
  };

  // ── the server's own half, asserted before the UI is asked anything ─────
  assert.equal(fiveRead.items.length, 5, "the server stored five items");
  assert.deepEqual(
    fiveRead.items.map((item) => item.priority),
    [1, 2, 3, 4, 5],
    "the server did not sort the five items into priority order",
  );
  assert.deepEqual(
    fiveRead.items.map((item) => item.text),
    [
      "The bond payment leaves on Thursday",
      "What would make this week feel finished?",
      "Send the signed lease back to the agent",
      "Vehicle licence renews on the 20th",
      "Three late nights in a row",
    ],
    "the server's priority order does not match the items",
  );
  assert.equal(fiveRead.writtenBy, "companion");
  assert.equal(fiveRead.writtenAt, fiveWriteAt.toISOString());
  assert.deepEqual(
    (fiveTool.items ?? []).map((item) => item.id),
    fiveRead.items.map((item) => item.id),
    "the companion's tool read disagrees with the card's read",
  );
  assert.deepEqual(
    sixthError,
    { code: "MALFORMED", message: "too many brief items (max 5)" },
    "the sixth write was not refused with the exact message",
  );
  assert.equal(fixture.server.readUnchangedAfterRefusal, true, "the refused write changed the brief");
  assert.deepEqual(
    afterRefusalRead.items.map((item) => item.id),
    fiveRead.items.map((item) => item.id),
  );
  assert.equal(expiredRead.recentlyExpired.length, 1, "the expired scenario has one expired item");
  assert.equal(expiredRead.items.length, 2, "the expired scenario still has two live items");
  assert.equal(expiredRead.recentlyExpired[0]!.expiresAt, expiredAt);
  assert.ok(expiredRead.recentlyExpired[0]!.priority === 2);
  assert.equal(staleRead.items.length, 2);
  assert.ok(
    real - Date.parse(staleRead.writtenAt ?? "") > BRIEF_STALE_MS,
    "the stale scenario's writtenAt is not older than 48 hours",
  );
  assert.equal(emptyRead.writtenAt, null);
  assert.deepEqual(emptyRead.items, []);
  assert.deepEqual(emptyRead.recentlyExpired, []);
  assert.equal(dismissAfter.items.length, 4, "the dismissal left four items");
  assert.ok(
    !dismissAfter.items.some((item) => item.id === dismissCall.itemId),
    "the dismissed item is still active in the server's read",
  );
  assert.deepEqual(
    dismissAfter.items.map((item) => item.id),
    fiveRead.items.filter((item) => item.id !== dismissCall.itemId).map((item) => item.id),
    "the dismissal disturbed more than the one item",
  );
  assert.equal(
    dismissAfter.dismissals[0]?.itemId,
    dismissCall.itemId,
    "the dismissal was not recorded in the log",
  );

  return fixture;
}

type Box = { top: number; right: number; bottom: number; left: number; width: number; height: number };

type DrawnItem = {
  itemId: string | null;
  kind: string | null;
  priority: string | null;
  expired: string | null;
  classList: string[];
  opacity: number;
  kindLabel: string | null;
  text: string | null;
  why: string | null;
  expiredWord: string | null;
  box: Box | null;
};

type Sample = {
  title: string | null;
  cardPresent: boolean;
  cardPinId: string | null;
  cardBox: Box | null;
  gridPresent: boolean;
  pinCount: number;
  pinIds: (string | null)[];
  firstPinId: string | null;
  firstPinHoldsCard: boolean;
  itemCount: number;
  itemIds: (string | null)[];
  items: DrawnItem[];
  stale: { text: string; box: Box } | null;
  empty: { text: string; box: Box } | null;
  staleCount: number;
  emptyCount: number;
  cardCount: number;
  itemSelectorCount: number;
  menuOpen: boolean;
  menuReasons: (string | null)[];
  reasonButtons: { text: string | null; role: string | null; box: Box }[];
  dismissButtons: {
    itemId: string | null;
    label: string | null;
    expanded: string | null;
    disabled: boolean;
    box: Box;
  }[];
  dismissCalls: { itemId: string; reason: string }[];
  calls: string[];
  unexpectedCalls: string[];
};

type Report = {
  pass: boolean;
  failures: string[];
  server: ServerEvidence;
  labels: Record<string, string>;
  reasonLabels: string[];
  checks: {
    skin: { name: string | null; applied: string | null };
    five: Sample;
    fiveAtCapture: Sample;
    fiveAfterRefusal: Sample;
    expired: Sample;
    stale: Sample;
    staleExpected?: string;
    empty: Sample;
    dismissBefore: Sample;
    menu: Sample;
    menuAtCapture: Sample;
    dismissed: Sample;
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
};

describe("companion brief ui e2e", () => {
  it("renders five priority-ordered items, the refused sixth write, expiry, staleness, emptiness and a dismissal", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-companion-brief-ui-"));
    try {
      const fixture = await buildFixture(workDir);
      const fixturePath = path.join(workDir, "companion-brief-fixture.json");
      fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

      // Stale artifacts are evidence of a previous run, not this one: a driver
      // that dies before writing must fail on the missing report, not pass on
      // an old one.
      fs.rmSync(REPORT, { force: true });
      for (const shot of SHOTS) fs.rmSync(path.join(ARTIFACTS, shot), { force: true });

      const exitCode = await runDriver(fixturePath);
      assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

      const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
      assert.deepEqual(report.failures, []);
      assert.equal(report.pass, true);
      assert.equal(exitCode, 0, "driver exited non-zero");

      // ── the report carries the server's own evidence ─────────────────────
      assert.deepEqual(report.server, fixture.server, "the report's server evidence is not the fixture's");
      const server = report.server;
      assert.equal(server.sixthWrite.refused, true);
      assert.equal(server.sixthWrite.attempted, 6);
      assert.equal(server.sixthWrite.code, "MALFORMED");
      assert.equal(server.sixthWrite.message, "too many brief items (max 5)");
      assert.equal(server.readUnchangedAfterRefusal, true);
      assert.equal(server.fiveWrite.itemCount, 5);
      assert.deepEqual(server.fiveWrite.priorities, [1, 2, 3, 4, 5]);
      assert.equal(server.expired.recentlyExpiredIds.length, 1);
      assert.ok(server.stale.ageHours > 48);
      assert.equal(server.empty.itemCount, 0);
      assert.equal(server.dismiss.remainingIds.length, 4);

      // ── the harness painted in the app's own skin ────────────────────────
      assert.ok(report.checks.skin.name, "the harness applied no skin");
      assert.equal(report.checks.skin.applied, report.checks.skin.name);

      // ── 1. five items in priority order, with kind, text and why ─────────
      const five = report.checks.five;
      assert.equal(five.title, "Companion brief");
      assert.equal(five.firstPinId, "sys:companion-brief", "the brief is not the board's first card");
      assert.equal(five.firstPinHoldsCard, true, "the first card is not the companion brief card");
      assert.equal(five.cardPresent, true);
      assert.equal(five.cardCount, 1);
      assert.ok(five.cardBox && five.cardBox.width > 0 && five.cardBox.height > 0);
      assert.equal(five.itemCount, 5, "five items did not render");
      assert.deepEqual(
        five.itemIds,
        fixture.scenarios.five.read.items.map((item) => item.id),
        "the items did not render in the server's priority order",
      );
      assert.deepEqual(
        five.items.map((item) => Number(item.priority)),
        [1, 2, 3, 4, 5],
        "the rendered priorities are not 1..5 in order",
      );
      fixture.scenarios.five.read.items.forEach((item, index) => {
        const drawn = five.items[index]!;
        assert.equal(drawn.kind, item.kind);
        assert.equal(drawn.kindLabel, fixture.labels[item.kind]);
        assert.equal(drawn.text, item.text);
        assert.equal(drawn.why, item.why);
        assert.equal(drawn.expired, "false");
        assert.equal(drawn.opacity, 1);
        assert.equal(drawn.expiredWord, null);
      });
      assert.equal(five.stale, null, "a fresh brief drew the stale line");
      assert.equal(five.empty, null, "a five-item brief drew the empty state");
      assert.ok(five.calls.includes("briefGet"), "the card never read the brief through briefGet");
      // The primary screenshot is taken from this same board: the DOM read at
      // the instant of capture must still be the five-item order above.
      assert.deepEqual(
        report.checks.fiveAtCapture.itemIds,
        five.itemIds,
        "the board changed between the five-item sample and its screenshot",
      );

      // ── 2. the refused sixth write did not move the rendered board ───────
      const afterRefusal = report.checks.fiveAfterRefusal;
      assert.equal(afterRefusal.itemCount, 5, "the refused write changed the rendered item count");
      assert.deepEqual(
        afterRefusal.itemIds,
        five.itemIds,
        "the refused write changed or reordered the rendered board",
      );
      assert.deepEqual(
        afterRefusal.items.map((item) => ({ id: item.itemId, kind: item.kind, text: item.text, why: item.why, priority: item.priority })),
        five.items.map((item) => ({ id: item.itemId, kind: item.kind, text: item.text, why: item.why, priority: item.priority })),
        "the refused write changed a rendered item",
      );

      // ── 3. the expired item is faded and marked ─────────────────────────
      const expired = report.checks.expired;
      const expiredRead = fixture.scenarios.expired.read;
      const expectedExpiredOrder = [...expiredRead.items, ...expiredRead.recentlyExpired].sort(
        (a, b) =>
          a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      assert.deepEqual(
        expired.itemIds,
        expectedExpiredOrder.map((item) => item.id),
        "the expired board is not in one priority order",
      );
      const expiredIds = new Set(expiredRead.recentlyExpired.map((item) => item.id));
      assert.equal(expiredIds.size, 1, "the fixture carries exactly one recently-expired item");
      for (const drawn of expired.items) {
        if (expiredIds.has(drawn.itemId ?? "")) {
          assert.equal(drawn.expired, "true", "the expired item is not marked expired");
          assert.ok(drawn.classList.includes("is-expired"), "the expired item drew without is-expired");
          assert.ok(drawn.opacity < 1, `the expired item was not faded (opacity ${drawn.opacity})`);
          assert.equal(drawn.expiredWord, "expired", "the expired item did not say expired");
        } else {
          assert.equal(drawn.expired, "false");
          assert.equal(drawn.opacity, 1);
          assert.equal(drawn.expiredWord, null);
        }
      }

      // ── 4. an old writtenAt draws the stale line ─────────────────────────
      const stale = report.checks.stale;
      assert.ok(stale.stale, "the stale line did not render");
      assert.equal(stale.staleCount, 1);
      assert.equal(stale.stale.text, report.checks.staleExpected);
      assert.match(stale.stale.text, /^Not refreshed since .+$/);
      assert.doesNotMatch(stale.stale.text, /Invalid Date/);
      assert.equal(stale.itemCount, fixture.scenarios.stale.read.items.length);

      // ── 5. an empty brief says so ────────────────────────────────────────
      const empty = report.checks.empty;
      assert.equal(empty.itemCount, 0, "an empty brief drew items");
      assert.ok(empty.empty, "an empty brief drew no empty state");
      assert.equal(empty.emptyCount, 1);
      assert.equal(empty.empty.text, "Nothing on the brief today");

      // ── 6. the dismissal menu: four reasons, one call, one item gone ─────
      const before = report.checks.dismissBefore;
      assert.equal(before.itemCount, 5, "the dismissal scenario did not start with five items");
      const menu = report.checks.menu;
      assert.deepEqual(menu.menuReasons, fixture.reasonLabels);
      assert.deepEqual(menu.menuReasons, ["Done", "Not useful", "Wrong", "Later"]);
      assert.equal(menu.reasonButtons.length, 4);
      assert.ok(menu.reasonButtons.every((entry) => entry.role === "menuitem"));
      assert.equal(menu.menuOpen, true, "the reasons menu was not open when it was sampled");
      assert.equal(
        report.checks.menuAtCapture.menuOpen,
        true,
        "the reasons menu was not open when its screenshot was captured",
      );
      assert.deepEqual(report.checks.menuAtCapture.menuReasons, fixture.reasonLabels);
      const dismissed = report.checks.dismissed;
      assert.deepEqual(
        dismissed.dismissCalls,
        [{ itemId: fixture.scenarios.dismiss.call.itemId, reason: "not-useful" }],
        "the dismissal did not call briefDismiss(itemId, reason) exactly once",
      );
      assert.equal(dismissed.menuOpen, false, "the reasons menu stayed open");
      assert.ok(
        !dismissed.itemIds.includes(fixture.scenarios.dismiss.call.itemId),
        "the dismissed item is still on the board",
      );
      assert.deepEqual(
        dismissed.itemIds,
        fixture.scenarios.dismiss.after.items.map((item) => item.id),
        "the remaining items do not match the server's post-dismissal read",
      );
      assert.equal(dismissed.itemCount, 4);

      // ── nothing unexpected, nothing on fire ──────────────────────────────
      assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
      assert.deepEqual(report.checks.consoleErrors, []);

      // ── the artifacts the hand-over points at ────────────────────────────
      for (const shot of SHOTS) {
        const file = path.join(ARTIFACTS, shot);
        assert.equal(fs.existsSync(file), true, `${shot} was not written`);
        assert.ok(fs.statSync(file).size > 1000, `${shot} is not a rendered screenshot`);
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
