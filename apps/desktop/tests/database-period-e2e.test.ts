import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Data page's period deep link: `/data/<area>/<db>?from=&to=&columnId=`.
 *
 * The claims themselves live in `e2e/database-period.electron.mjs`, which
 * drives a real Electron window over the real shell and the real
 * `DatabasePage`; this file runs that driver and refuses a report that does not
 * hold. Every claim is restated here so a regression names the surface rather
 * than only the rig's own failure list.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up (the repository's
 * `lifequest-e2e` runner starts one itself, so the final run does not skip).
 *
 * The artifact is `e2e/artifacts/database-period.json` plus
 * `database-period.png`: same command, same claims, no eyeballing required.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/database-period.json");

const SLUG = "financial";
const DB_ID = "finance:transactions";
const ROUTE = `/data/${SLUG}/${DB_ID}`;
const FROM = "2026-10-12";
const TO = "2026-10-18";
const COLUMN_ID = "date";

const ALL_DATES = [
  "2026-10-03",
  "2026-10-08",
  "2026-10-12",
  "2026-10-14",
  "2026-10-16",
  "2026-10-21",
];
const IN_RANGE_DATES = ["2026-10-12", "2026-10-14", "2026-10-16"];
const OUT_OF_RANGE_DATES = ["2026-10-03", "2026-10-08", "2026-10-21"];
const HEADERS = ["Date", "Payee", "Amount", "Actions"];

type Chip = { text: string | null; range: string | null; clear: boolean } | null;

type DrawState = {
  location: string | null;
  dates: string[];
  payees?: string[];
  chip: Chip;
  rowsServed?: number;
  unexpectedCalls?: string[];
};

type WriteCall = {
  kind: "upsert";
  slug: string;
  dbId: string;
  id: string | null;
  cells: Record<string, unknown>;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    deepLink: DrawState & {
      title: string | null;
      error: string | null;
      headers: string[];
      loads: number;
      dataListenerCount: number;
      expected: {
        columns: Array<{ id: string; name: string; type: string }>;
        range: { from: string; to: string; columnId: string };
        dates: string[];
        inRangeDates: string[];
      } | null;
    };
    addRow: { writes: WriteCall[]; loads: number; dates: string[]; chip: Chip };
    clear: { location: string | null; dates: string[]; payees: string[]; chip: Chip; rows: number };
    plain: DrawState;
    badColumn: DrawState;
    invalidLinks: {
      malformed: { dates: string[]; chip: Chip };
      missingTo: { dates: string[]; chip: Chip };
    };
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
  fixtures: {
    route: string;
    range: { from: string; to: string; columnId: string };
    dates: string[];
    inRangeDates: string[];
    outOfRangeDates: string[];
    headers: string[];
  };
  screenshots: string[];
};

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

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/database-period.electron.mjs")],
      { cwd: desktopRoot, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 },
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

describe("database period deep link (Data page filtered to an Analytics period)", () => {
  it("filters the rendered rows, names the range, clears it, and ignores invalid links", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // The fixture the driver claims against, so a change to it is visible here.
    assert.deepEqual(report.fixtures.route, ROUTE);
    assert.deepEqual(report.fixtures.range, { from: FROM, to: TO, columnId: COLUMN_ID });
    assert.deepEqual(report.fixtures.dates, ALL_DATES);
    assert.deepEqual(report.fixtures.inRangeDates, IN_RANGE_DATES);
    assert.deepEqual(report.fixtures.outOfRangeDates, OUT_OF_RANGE_DATES);
    assert.deepEqual(report.fixtures.headers, HEADERS);

    // 1. The link opens the page filtered to the period's rows.
    const deepLink = report.checks.deepLink;
    assert.equal(
      deepLink.location,
      `${ROUTE}?from=${FROM}&to=${TO}&columnId=${COLUMN_ID}`,
      "the deep link did not keep its three params",
    );
    assert.equal(deepLink.title, "Transactions");
    assert.equal(deepLink.error, null, "the page paints an error on the deep link");
    assert.deepEqual(deepLink.headers, HEADERS, "the Rows table is not the shipping one");
    assert.deepEqual(deepLink.dates, IN_RANGE_DATES, "the page does not draw exactly the in-range rows");
    for (const date of OUT_OF_RANGE_DATES) {
      assert.equal(
        deepLink.dates.includes(date),
        false,
        `the out-of-range row ${date} is still drawn`,
      );
    }
    assert.equal(
      deepLink.rowsServed,
      ALL_DATES.length,
      "the bridge did not serve all six rows — the page narrowed the read, not the display",
    );
    assert.deepEqual(
      deepLink.expected?.range,
      { from: FROM, to: TO, columnId: COLUMN_ID },
      "the harness fixture does not carry the range under test",
    );
    assert.ok(deepLink.dataListenerCount >= 1, "the page holds no vault-change listener");

    // The chip names the range and offers its one control.
    assert.ok(deepLink.chip, "the period chip (db-period-filter) did not render");
    assert.equal(deepLink.chip?.range, `Showing ${FROM} → ${TO}`);
    assert.equal(deepLink.chip?.clear, true, "the chip has no clear button");

    // 2. Create still writes; the new undated row is outside the period.
    const addRow = report.checks.addRow;
    assert.equal(addRow.writes.length > 0, true, "Add row reached no write");
    assert.equal(addRow.writes[0]?.kind, "upsert");
    assert.equal(addRow.writes[0]?.slug, SLUG);
    assert.equal(addRow.writes[0]?.dbId, DB_ID);
    assert.equal(addRow.writes[0]?.id, null, "Add row asked to upsert a named row");
    assert.ok(addRow.loads >= 2, "the page did not reload after Add row");
    assert.deepEqual(addRow.dates, IN_RANGE_DATES, "Add row changed the filtered rows");
    assert.ok(addRow.chip, "the period chip vanished after Add row");

    // 3. Clear: the params leave the URL and every row comes back.
    const clear = report.checks.clear;
    assert.equal(clear.location, ROUTE, "clearing the chip left params in the URL");
    assert.equal(clear.chip, null, "the chip is still drawn after Clear");
    assert.equal(
      clear.rows,
      ALL_DATES.length + 1,
      "Clear does not show the six rows plus the one Add row made",
    );
    assert.deepEqual(clear.dates.slice(0, ALL_DATES.length), ALL_DATES);
    for (const date of OUT_OF_RANGE_DATES) {
      assert.equal(clear.dates.includes(date), true, `Clear did not bring back ${date}`);
    }

    // 4. A plain open behaves exactly as it does today.
    const plain = report.checks.plain;
    assert.equal(plain.location, ROUTE);
    assert.deepEqual(plain.dates, ALL_DATES, "a plain open does not draw all six rows");
    assert.equal(plain.chip, null, "a plain open draws the period chip");

    // 5. A non-date `columnId` is ignored.
    const badColumn = report.checks.badColumn;
    assert.deepEqual(badColumn.dates, ALL_DATES, "a number column was trusted as the date column");
    assert.equal(badColumn.chip, null, "a number column drew the chip");

    // 6. Malformed or incomplete links are ignored.
    assert.deepEqual(
      report.checks.invalidLinks.malformed.dates,
      ALL_DATES,
      "an impossible date was trusted",
    );
    assert.equal(report.checks.invalidLinks.malformed.chip, null);
    assert.deepEqual(
      report.checks.invalidLinks.missingTo.dates,
      ALL_DATES,
      "an incomplete link was trusted",
    );
    assert.equal(report.checks.invalidLinks.missingTo.chip, null);

    // 7. Nothing unmodelled, nothing thrown.
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    // The picture is from this run and shows the shipped screen.
    assert.equal(report.screenshots.length > 0, true, "driver wrote no screenshot");
    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
      assert.ok(fs.statSync(file).size > 0, `screenshot ${file} is empty`);
    }
    assert.ok(
      report.screenshots.some((file) => file.endsWith(`${path.sep}database-period.png`)),
      "the run has no database-period.png",
    );
  });
});
