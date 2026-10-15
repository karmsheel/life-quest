import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DEFAULT_FX_SOURCE,
  applyFinanceKitInstall,
  createVault,
  getFinanceKitSettings,
  refreshFxRate,
  runViewBlocks,
  setFxRateSource,
  upsertRow,
} from "@lifequest/vault-core";

/**
 * The USD→ZAR rate: read from a source the operator names, stored in the vault,
 * and actually used to convert money.
 *
 * WHY THIS FILE EXISTS
 *
 * `usdZarRate` shipped null and nothing ever wrote one, so every USD amount in
 * every card and report was left unconverted and said so. The rate is the one
 * number in the finance kit that cannot be derived from anything in the vault, so
 * the only question worth testing is whether the vault can be trusted to fetch
 * it, keep it, and not lie about it.
 *
 * THE WAYS THIS PATH COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 *   1. The rate is fetched but never lands — a bug in the write leaves the
 *      registry as it was, and the setting looks saved and does nothing.
 *   2. A source that answers with an HTML error page, a JSON body under a
 *      different key, an HTTP 500, or nothing at all, has its answer stored as
 *      the rate. Every converted figure in the vault then silently becomes
 *      nonsense — this is the failure that matters most, because the card looks
 *      perfectly healthy while being wrong.
 *   3. A failed refresh throws away the last good rate, so a source that blips
 *      takes the vault from "an hour stale" to "cannot convert anything".
 *   4. The failure is not recorded, so the operator cannot tell a wrong source
 *      from a slow one and has nothing to act on.
 *   5. A source URL that is not http(s), or a path that is empty, is stored
 *      anyway and fails forever after.
 *   6. The as-of date is invented — a source that says nothing is recorded as
 *      saying "today", so a stale rate is presented as a fresh one.
 *   7. The rate is stored and never applied: cards keep leaving USD amounts
 *      unconverted, which is the entire point of the exercise.
 *
 * Every source this file reads is a LOCAL HTTP SERVER it starts itself, so the
 * suite is hermetic and repeatable — the same rule the adapter tests follow. The
 * one live read of the real default source is a separate case that SKIPS when the
 * network is unavailable, so a machine with no connection reports a skip rather
 * than a failure.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`), which
 * needs no Electron: the fetch belongs to vault-core, and the main process only
 * decides when to call it.
 *
 * The artifact is `e2e/artifacts/finance-fx.json`.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/finance-fx.json");
const PANEL_REPORT = path.join(desktopRoot, "e2e/artifacts/fx-panel.json");
const PANEL_SHOT = path.join(desktopRoot, "e2e/artifacts/fx-panel.png");
const DEV_PORT = 5173;

const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

/** ISO date `days` before an ISO date, in UTC arithmetic on a plain date. */
function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * A rate source the test owns: one endpoint per failure mode, so each is
 * exercised against a real response rather than a mocked one.
 */
type Source = { url: string; close: () => Promise<void> };

async function startSource(): Promise<Source> {
  const server = http.createServer((req, res) => {
    const route = (req.url ?? "/").split("?")[0];
    if (route === "/rates") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ rates: { ZAR: 17.5 }, date: "2026-03-04" }));
      return;
    }
    if (route === "/pairs") {
      // The second shape a provider reaches for: a list of pairs, where the path
      // needs a numeric segment.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ quote: "ZAR", rate: "18.25" }] }));
      return;
    }
    if (route === "/html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>502 Bad Gateway</body></html>");
      return;
    }
    if (route === "/wrong-shape") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ rates: { USD: 1, EUR: 0.89 } }));
      return;
    }
    if (route === "/zero") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ rates: { ZAR: 0 } }));
      return;
    }
    if (route === "/broken") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{not json");
      return;
    }
    if (route === "/slow") return; // never answers: the timeout's job
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "boom" }));
  });
  // The timeout case leaves a request hanging on purpose, and `server.close()`
  // waits for every open connection — so the sockets are held and destroyed here
  // rather than left to make teardown hang for as long as the abort took.
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object", "the source did not bind");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

type FxSettings = {
  usdZarRate: number | null;
  usdZarAsOf: string | null;
  fxSource?: { url: string; path: string; asOfPath: string | null; lastFetchedAt: string | null; lastError: string | null } | null;
};

async function settingsOf(root: string): Promise<FxSettings> {
  const res = await getFinanceKitSettings(root);
  assert.equal(res.ok, true, "getFinanceKitSettings failed");
  const value = (res as { ok: true; value: FxSettings | null }).value;
  assert.ok(value, "the kit reported no settings block");
  return value;
}

/** The rows one single-aggregate view runs to, for the conversion claim. */
async function runRows(
  root: string,
  spec: Record<string, unknown>,
): Promise<{ rows: Array<Array<string | number>>; warnings: string[]; currency: string | null }> {
  const run = await runViewBlocks(root, "financial", { schemaVersion: 1, ...spec } as never);
  assert.equal(run.ok, true, `the view did not run: ${run.ok ? "" : run.error}`);
  const block = (run as { ok: true; value: { blocks: { result: { listRows?: unknown[][]; rows: unknown[][]; warnings: string[]; currency: string | null } }[] } })
    .value.blocks[0]!;
  return {
    rows: (block.result.listRows ?? block.result.rows) as Array<Array<string | number>>,
    warnings: block.result.warnings,
    currency: block.result.currency,
  };
}

describe("finance fx rate e2e", () => {
  it("reads the rate from the operator's source and converts USD rows with it", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-fx-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    const created = await createVault(vaultRoot, "E2E");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
    const kit = await applyFinanceKitInstall(vaultRoot);
    assert.equal(kit.ok, true, `applyFinanceKitInstall failed: ${kit.ok ? "" : kit.error}`);

    const source = await startSource();
    try {
      // ── 1. out of the box the vault reads SOMEWHERE ──────────────────────
      // A vault nobody has pointed anywhere must still refresh, or the setting
      // ships unconfigured and the feature ships off.
      const fresh = await settingsOf(vaultRoot);
      checks.freshSettings = fresh;
      assert.equal(fresh.usdZarRate, null, "a fresh kit should have no rate yet");
      // The default is a real, keyless, JSON endpoint whose rate sits at
      // `rates.ZAR` — the shape all three of the common providers share.
      assert.match(DEFAULT_FX_SOURCE.url, /^https:\/\//, "the default source is not https");
      assert.equal(DEFAULT_FX_SOURCE.path, "rates.ZAR");

      // ── 2. the operator's own source, read into the vault ────────────────
      const pointed = await setFxRateSource(
        vaultRoot,
        { url: `${source.url}/rates`, path: "rates.ZAR", asOfPath: "date" },
        ACTOR,
      );
      checks.pointed = pointed;
      assert.equal(pointed.ok, true, `setFxRateSource failed: ${pointed.ok ? "" : pointed.error}`);

      const read = await refreshFxRate(vaultRoot);
      checks.refresh = read;
      assert.equal(read.ok, true, `refreshFxRate failed: ${read.ok ? "" : read.error}`);
      const value = (read as { ok: true; value: { rate: number | null; asOf: string | null; refreshed: boolean } }).value;
      assert.equal(value.refreshed, true, "the refresh did not read the source");
      assert.equal(value.rate, 17.5, `the rate read was ${value.rate}, expected 17.5`);
      assert.equal(value.asOf, "2026-03-04", `the as-of read was ${value.asOf}, expected the source's own date`);

      // It has to be ON DISK, not just in the return value: the cards read the
      // registry, and a write that did not land looks exactly like a success.
      const stored = await settingsOf(vaultRoot);
      checks.stored = stored;
      assert.equal(stored.usdZarRate, 17.5, "the rate never reached the registry");
      assert.equal(stored.usdZarAsOf, "2026-03-04");
      assert.equal(stored.fxSource?.lastError, null, "a successful read recorded an error");
      assert.ok(stored.fxSource?.lastFetchedAt, "a successful read recorded no time");

      // ── 3. the rate is APPLIED, which is the whole point ─────────────────
      const zar = await upsertRow(vaultRoot, "financial", "finance:accounts", {
        cells: { name: "Cheque", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: daysBefore("2026-03-04", 30) },
      });
      const usd = await upsertRow(vaultRoot, "financial", "finance:accounts", {
        cells: { name: "Travel", type: "credit", currency: "USD", opening_balance: 0, opening_as_of: daysBefore("2026-03-04", 30) },
      });
      assert.equal(zar.ok, true);
      assert.equal(usd.ok, true);
      const zarId = (zar as { ok: true; value: { id: string } }).value.id;
      const usdId = (usd as { ok: true; value: { id: string } }).value.id;

      for (const [date, amount, account, payee] of [
        ["2026-03-01", -100, zarId, "Local"],
        ["2026-03-02", -10, usdId, "Abroad"],
      ] as const) {
        const row = await upsertRow(vaultRoot, "financial", "finance:transactions", {
          cells: { date, amount, account, payee },
        });
        assert.equal(row.ok, true, `transaction seed failed: ${row.ok ? "" : row.error}`);
      }

      // A listing prints the converted amount, not the dollar figure.
      const listing = await runRows(vaultRoot, {
        databaseId: "finance:transactions",
        title: "Recent transactions",
        presentation: "list",
        columns: ["date", "payee", "amount"],
        timeColumnId: "date",
        timeWindow: "all",
        limit: 10,
        filters: [],
      });
      checks.listing = listing;
      const abroad = listing.rows.find((r) => r[1] === "Abroad");
      assert.ok(abroad, "the USD row is missing from the listing");
      assert.equal(
        abroad[2],
        -175,
        `the USD row converted to ${abroad[2]}, expected -175 (10 × 17.5)`,
      );
      assert.equal(
        listing.rows.find((r) => r[1] === "Local")?.[2],
        -100,
        "a ZAR row was converted when it should have been left alone",
      );
      assert.equal(listing.currency, "ZAR", `the card reported ${listing.currency} after conversion`);
      assert.equal(
        listing.warnings.some((w) => /usdZarRate is unset|more than one currency/.test(w)),
        false,
        `the card still warns about the rate it just used: ${listing.warnings.join("; ")}`,
      );

      // And an aggregate sums one currency rather than two.
      const total = await runRows(vaultRoot, {
        databaseId: "finance:transactions",
        title: "Total",
        presentation: "metric",
        measure: "sum",
        measureColumnId: "amount",
        groupBy: null,
        timeColumnId: "date",
        timeWindow: "all",
      });
      checks.total = total;
      assert.equal(total.rows[0]?.[1], -275, `the metric totalled ${total.rows[0]?.[1]}, expected -275`);

      // ── 4. a source that is wrong is not believed ────────────────────────
      // The failure that matters most: a card that looks healthy while holding a
      // number that came from an error page.
      async function refuse(route: string, path_: string, asOfPath: string | null, expect: RegExp) {
        const set = await setFxRateSource(
          vaultRoot,
          { url: `${source.url}${route}`, path: path_, asOfPath },
          ACTOR,
        );
        assert.equal(set.ok, true, `pointing at ${route} failed: ${set.ok ? "" : set.error}`);
        const res = await refreshFxRate(vaultRoot, { timeoutMs: route === "/slow" ? 800 : 8_000 });
        assert.equal(res.ok, true, `a failed refresh must still answer, got ${res.ok ? "" : res.error}`);
        const v = (res as { ok: true; value: { rate: number | null; refreshed: boolean } }).value;
        assert.equal(v.refreshed, false, `${route} was believed`);
        // The last good rate survives: an hour-stale rate beats none.
        assert.equal(v.rate, 17.5, `${route} threw away the last good rate`);
        const now = await settingsOf(vaultRoot);
        assert.equal(now.usdZarRate, 17.5, `${route} overwrote the stored rate`);
        assert.match(now.fxSource?.lastError ?? "", expect, `${route} was refused without a reason`);
        return now;
      }

      checks.refusalHtml = await refuse("/html", "rates.ZAR", null, /did not answer JSON/);
      checks.refusalBroken = await refuse("/broken", "rates.ZAR", null, /did not answer JSON/);
      await refuse("/wrong-shape", "rates.ZAR", null, /has no rate at "rates.ZAR"/);
      await refuse("/zero", "rates.ZAR", null, /has no rate at "rates.ZAR"/);
      await refuse("/boom", "rates.ZAR", null, /answered HTTP 500/);
      await refuse("/slow", "rates.ZAR", null, /did not answer within/);
      // A path that names nothing at all is the same refusal, and the reply says
      // what it actually found so the operator can fix the path.
      const missingPath = await refuse("/rates", "rates.GBP", null, /has no rate at "rates.GBP"/);
      checks.refusalMissingPath = missingPath;

      // ── 5. a source with a different shape is still usable ───────────────
      // "A different source" is the point of the setting, and the second shape a
      // provider reaches for is a list of pairs — where the path needs an index.
      const pairsSet = await setFxRateSource(
        vaultRoot,
        { url: `${source.url}/pairs`, path: "data.0.rate", asOfPath: null },
        ACTOR,
      );
      assert.equal(pairsSet.ok, true, `pointing at /pairs failed: ${pairsSet.ok ? "" : pairsSet.error}`);
      const pairs = await refreshFxRate(vaultRoot);
      const pairsValue = (pairs as { ok: true; value: { rate: number | null; asOf: string | null; refreshed: boolean } }).value;
      checks.pairs = pairsValue;
      assert.equal(pairsValue.refreshed, true, "a list-of-pairs source was not read");
      // A string where a number belongs is still a rate, and is parsed as one.
      assert.equal(pairsValue.rate, 18.25, `the pairs source read ${pairsValue.rate}, expected 18.25`);
      // This source names no date, so the read is dated today — the read DID
      // happen now, so today is a fact rather than a guess.
      assert.match(pairsValue.asOf ?? "", /^\d{4}-\d{2}-\d{2}$/, "an undated source recorded no date");

      // ── 6. the setting refuses what cannot be fetched ────────────────────
      for (const [label, input, expect] of [
        ["a file path", { url: "file:///etc/passwd", path: "rates.ZAR" }, /http or https URL/],
        ["a bare word", { url: "not-a-url", path: "rates.ZAR" }, /http or https URL/],
        ["an empty path", { url: `${source.url}/rates`, path: "  " }, /rate path is required/],
      ] as const) {
        const res = await setFxRateSource(vaultRoot, input, ACTOR);
        assert.equal(res.ok, false, `${label} was accepted as a rate source`);
        assert.match(
          (res as { ok: false; error: string }).error,
          expect,
          `${label} was refused without saying why`,
        );
      }
      // A refused setting leaves the working one in place rather than half-written.
      const survivor = await settingsOf(vaultRoot);
      assert.equal(survivor.fxSource?.url, `${source.url}/pairs`, "a refused setting moved the source");

      // ── 7. clearing it goes back to the default, not to nothing ──────────
      const cleared = await setFxRateSource(vaultRoot, { url: null }, ACTOR);
      assert.equal(cleared.ok, true, `clearing the source failed: ${cleared.ok ? "" : cleared.error}`);
      const afterClear = await settingsOf(vaultRoot);
      checks.afterClear = afterClear;
      assert.equal(afterClear.fxSource?.url, DEFAULT_FX_SOURCE.url, "clearing did not restore the default");
      assert.equal(afterClear.fxSource?.path, "rates.ZAR");
      // Clearing the SOURCE must not clear the rate: the operator changed where
      // it comes from, not what the vault knows.
      assert.equal(afterClear.usdZarRate, 18.25, "clearing the source discarded the last known rate");

      // ── the artifact ─────────────────────────────────────────────────────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(
        ARTIFACT,
        `${JSON.stringify(
          {
            pass: true,
            what: "the USD→ZAR rate read from a source the operator names, stored in the vault, and applied to USD rows",
            command: "npm test  (this file: tests/finance-fx-e2e.test.ts)",
            defaultSource: DEFAULT_FX_SOURCE,
            checks,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      await source.close();
    }

    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("reads the real default source when the network is available", async (t) => {
    // The one claim the hermetic case above cannot make: that the source this
    // ships with actually answers, at the path this ships with. It is a live
    // read, so an offline machine reports a skip rather than a failure.
    const probe = await fetch(DEFAULT_FX_SOURCE.url, { headers: { accept: "application/json" } }).catch(
      () => null,
    );
    if (!probe || !probe.ok) {
      t.skip(`no answer from ${DEFAULT_FX_SOURCE.url} — this case needs the network`);
      return;
    }
    const body = (await probe.json()) as { rates?: Record<string, number> };
    const rate = body.rates?.ZAR;
    assert.equal(typeof rate, "number", `${DEFAULT_FX_SOURCE.url} answered without rates.ZAR`);
    assert.ok(
      typeof rate === "number" && rate > 5 && rate < 60,
      `the live ZAR rate read ${rate}, which is not a plausible USD→ZAR rate`,
    );
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-fx-live-"));
    const vaultRoot = path.join(workDir, "vault");
    try {
      await createVault(vaultRoot, "E2E");
      await applyFinanceKitInstall(vaultRoot);
      const res = await refreshFxRate(vaultRoot);
      assert.equal(res.ok, true, "the default source could not be read into a vault");
      const stored = await settingsOf(vaultRoot);
      assert.equal(stored.usdZarRate, rate, "the vault stored a different rate from the one served");
      assert.ok(stored.fxSource?.lastFetchedAt, "a live read recorded no time");
      console.log(`live: ${stored.usdZarRate} ZAR per USD as of ${stored.usdZarAsOf}`);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("draws the rate-source setting and drives its three controls", async (t) => {
    // The panel is the part of this feature the operator actually touches, so it
    // is rendered in a real layout engine and its controls are really clicked.
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(PANEL_REPORT, { force: true });
    fs.rmSync(PANEL_SHOT, { force: true });
    const exitCode = await runRig();
    assert.equal(fs.existsSync(PANEL_REPORT), true, "the rig wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(PANEL_REPORT, "utf8")) as {
      pass: boolean;
      failures: string[];
      checks: {
        initial: { present: boolean; url: string; path: string; controls: string[]; rate: string };
        afterSave: { rate: string; status: string };
        afterRefused: { status: string; lastError: string };
        afterBadUrl: { error: string };
        afterReset: { url: string; rate: string };
      };
    };
    assert.deepEqual(report.failures, [], "the rig's own claims failed");
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "the rig exited non-zero");

    // The form arrives filled with the source in force, not three empty boxes.
    assert.equal(report.checks.initial.present, true);
    assert.equal(report.checks.initial.url, "https://open.er-api.com/v6/latest/USD");
    assert.equal(report.checks.initial.path, "rates.ZAR");
    assert.deepEqual(report.checks.initial.controls, [
      "Save and read now",
      "Refresh now",
      "Use the default",
    ]);
    // A rate, a failed read and a refused value are three different things, and
    // the panel says which is which.
    assert.match(report.checks.afterSave.status, /Read 16\.49 ZAR per USD as of 2026-10-14/);
    assert.match(report.checks.afterRefused.status, /answered HTTP 500/);
    assert.match(report.checks.afterRefused.lastError, /answered HTTP 500/);
    assert.match(report.checks.afterBadUrl.error, /http or https URL/);
    // Going back to the default keeps the rate the vault already knows.
    assert.equal(report.checks.afterReset.url, "https://open.er-api.com/v6/latest/USD");
    assert.match(report.checks.afterReset.rate, /16\.49/);
    assert.equal(fs.existsSync(PANEL_SHOT), true, "the rig captured no screenshot");
  });
});

/**
 * The panel rig renders a React component in a real layout engine, so it needs
 * the Vite dev server. With the server down the case skips.
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

function runRig(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/fx-panel.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
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
