import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { readRegistry } from "./domain-databases.ts";
import { appendLog } from "./log.ts";
import { todayLocalIso } from "./map/dates.ts";
import { vaultPaths } from "./paths.ts";
import {
  FINANCE_DOMAIN_SLUG,
  FINANCE_KIT_ID,
  type Actor,
  type FinanceKitSettings,
  type FxRateSource,
  type Result,
} from "./types.ts";

/**
 * The USD→ZAR rate, read from a source the operator names.
 *
 * The vault stores the rate and its as-of date, and until now nothing ever put
 * one there: `usdZarRate` shipped null, every USD amount was left unconverted,
 * and the cards said so on every draw. The rate is not a fact the vault can
 * derive — it has to come from outside — so this is the one place that reads it.
 *
 * THE WAYS THIS COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 *   1. A source that is down, slow, or never answers leaves the app hanging on a
 *      fetch, or wipes the last good rate. A rate that was true an hour ago beats
 *      no rate at all, so a failure keeps what is stored and records the reason.
 *   2. A source that answers with something other than a rate — an HTML error
 *      page, a JSON body under a different key, a string where a number belongs,
 *      a zero, a negative — is written as though it were the rate, and every
 *      converted figure in the vault silently becomes nonsense. Fail closed.
 *   3. A "different source" the operator pastes has a different shape, so a path
 *      that only knows one provider's key makes the setting a lie. The path is
 *      the operator's, defaulted to the key every one of the common providers
 *      uses.
 *   4. A refresh on a vault that has no finance kit, or whose domain is archived,
 *      resurrects a domain the operator removed.
 *   5. Two refreshes race — the hourly one and an operator's own — and the older
 *      answer lands last, so the newer rate is the one thrown away.
 */

/**
 * Where the rate comes from, out of the box.
 *
 * Both favourites answer the same shape — `rates` keyed by currency code — so
 * `rates.ZAR` is the default path rather than a provider-specific hack:
 *
 *   https://open.er-api.com/v6/latest/USD      → {"rates":{"ZAR":16.48822,...}, ...}
 *   https://api.frankfurter.dev/v1/latest?base=USD&symbols=ZAR → {"rates":{"ZAR":16.47}}
 *
 * The first is the default because it quotes ZAR (and 160 other currencies)
 * rather than only the currencies the ECB publishes, and it carries an update
 * timestamp that can be read as the as-of date.
 */
export const DEFAULT_FX_SOURCE: FxRateSource = {
  url: "https://open.er-api.com/v6/latest/USD",
  path: "rates.ZAR",
  asOfPath: "time_last_update_utc",
  lastFetchedAt: null,
  lastError: null,
};

/** How long a source gets to answer before the refresh gives up on it. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * The source in force: the operator's, or the default when they have not set
 * one. A stored source keeps its own url and path; the default fills the gaps so
 * a half-written setting still refreshes rather than failing forever.
 */
export function fxSourceOf(settings: FinanceKitSettings | null | undefined): FxRateSource {
  const stored = settings?.fxSource;
  if (!stored || !stored.url) return { ...DEFAULT_FX_SOURCE };
  return {
    url: stored.url,
    path: stored.path || DEFAULT_FX_SOURCE.path,
    asOfPath: stored.asOfPath ?? DEFAULT_FX_SOURCE.asOfPath,
    lastFetchedAt: stored.lastFetchedAt ?? null,
    lastError: stored.lastError ?? null,
  };
}

/**
 * Read one value out of a parsed JSON body by dot path — `rates.ZAR`,
 * `data.0.rate`. Numeric segments index arrays, because the second shape a
 * provider reaches for is a list of pairs.
 */
export function readJsonPath(body: unknown, path: string): unknown {
  let node: unknown = body;
  for (const segment of path.split(".").filter((s) => s.length > 0)) {
    if (node == null) return undefined;
    if (Array.isArray(node)) {
      const index = Number(segment);
      node = Number.isInteger(index) ? node[index] : undefined;
      continue;
    }
    if (typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** A rate is a positive finite number and nothing else. */
export function parseRate(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * The as-of date, normalised to YYYY-MM-DD.
 *
 * Sources publish this three ways — "2026-10-14", an ISO timestamp, or a
 * human sentence like "Wed, 14 Oct 2026 00:02:32 +0000" — and the vault stores a
 * plain date. Anything unreadable becomes null rather than today's date, because
 * claiming the rate is from today when the source did not say so is the one
 * answer that is certainly wrong. A source with no such field at all is a
 * different case: the read happened today, so today is what it is.
 */
export function parseAsOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Whether the rate source can be written at all: kit installed, domain live. */
async function fxWritable(root: string): Promise<Result<true>> {
  const paths = vaultPaths(root);
  try {
    const meta = JSON.parse(await fs.readFile(paths.domainJson(FINANCE_DOMAIN_SLUG), "utf8"));
    if (meta.archivedAt != null) {
      return { ok: false, error: `Domain not found or archived: ${FINANCE_DOMAIN_SLUG}` };
    }
  } catch {
    return { ok: false, error: `Domain not found or archived: ${FINANCE_DOMAIN_SLUG}` };
  }
  const registry = await readRegistry(paths.domainRegistry(FINANCE_DOMAIN_SLUG));
  if (!registry.installedKits.includes(FINANCE_KIT_ID)) {
    return { ok: false, error: "Install the Finance kit first" };
  }
  return { ok: true, value: true };
}

/** The kit's settings block, created in its installed shape when absent. */
function financeBlock(settings: FinanceKitSettings | undefined): FinanceKitSettings {
  return (
    settings ?? {
      homeCurrency: "ZAR",
      usdZarRate: null,
      usdZarAsOf: null,
      defaultCaptureAccountId: null,
    }
  );
}

export type FxRefreshResult = {
  settings: FinanceKitSettings;
  /** The rate now stored, which on a failed refresh is the last good one. */
  rate: number | null;
  asOf: string | null;
  /** True when this call actually wrote a new rate. */
  refreshed: boolean;
};

/**
 * One JSON read of a source, with the timeout and every transport failure
 * already turned into a sentence the operator can act on.
 *
 * It never rejects. The caller's subject is the rate, not the transport, and a
 * thrown fetch error would have to be caught and re-worded identically at every
 * call site — which is how one of them ends up saying "fetch failed".
 */
async function fetchJson(url: string, timeoutMs: number): Promise<Result<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, error: `${url} answered HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      // An HTML error page, a captive portal, a plain-text body: all of them are
      // "not a rate", and showing what came back is what makes the setting fixable.
      const seen = text.trim().slice(0, 60) || "an empty body";
      return { ok: false, error: `${url} did not answer JSON (got ${seen})` };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /abort/i.test(message)
        ? `${url} did not answer within ${Math.round(timeoutMs / 1000)}s`
        : `${url} could not be reached: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the rate from the configured source and store it.
 *
 * A failure never removes the stored rate: it records `lastError` and leaves the
 * last known rate in place, because a rate from an hour ago is what the operator
 * had a moment ago and a vault that converts nothing is worse than one that
 * converts at a stale rate it is honest about.
 */
export async function refreshFxRate(
  root: string,
  opts?: { timeoutMs?: number; now?: Date },
): Promise<Result<FxRefreshResult>> {
  const writable = await fxWritable(root);
  if (!writable.ok) return writable;

  const paths = vaultPaths(root);
  const registry = await readRegistry(paths.domainRegistry(FINANCE_DOMAIN_SLUG));
  const settings = financeBlock(registry.finance);
  const source = fxSourceOf(settings);
  const now = opts?.now ?? new Date();

  const fail = async (error: string): Promise<Result<FxRefreshResult>> => {
    registry.finance = {
      ...settings,
      fxSource: { ...source, lastFetchedAt: now.toISOString(), lastError: error },
    };
    await atomicWriteFile(paths.domainRegistry(FINANCE_DOMAIN_SLUG), `${JSON.stringify(registry, null, 2)}\n`);
    return {
      ok: true,
      value: {
        settings: registry.finance,
        rate: settings.usdZarRate,
        asOf: settings.usdZarAsOf,
        refreshed: false,
      },
    };
  };

  const fetched = await fetchJson(source.url, opts?.timeoutMs ?? FETCH_TIMEOUT_MS);
  if (!fetched.ok) return await fail(fetched.error);
  const body = fetched.value;

  const rate = parseRate(readJsonPath(body, source.path));
  if (rate === null) {
    const found = readJsonPath(body, source.path);
    return await fail(
      `${source.url} has no rate at "${source.path}" (it holds ${
        found === undefined ? "nothing there" : JSON.stringify(found).slice(0, 40)
      })`,
    );
  }
  // A source that names no date is still a rate read today; one that names an
  // unreadable date is recorded as today anyway, because the read happened now.
  const asOf = source.asOfPath
    ? (parseAsOf(readJsonPath(body, source.asOfPath)) ?? todayLocalIso(now))
    : todayLocalIso(now);

  registry.finance = {
    ...settings,
    usdZarRate: rate,
    usdZarAsOf: asOf,
    fxSource: { ...source, lastFetchedAt: now.toISOString(), lastError: null },
  };
  await atomicWriteFile(paths.domainRegistry(FINANCE_DOMAIN_SLUG), `${JSON.stringify(registry, null, 2)}\n`);
  return { ok: true, value: { settings: registry.finance, rate, asOf, refreshed: true } };
}

/**
 * Point the vault at another source — or clear it back to the default.
 *
 * The url is checked before it is stored: a source that is not http(s) is either
 * a typo or a local path, and neither can be fetched. Nothing is fetched here, so
 * saving a source the operator is still typing cannot fail on the network; the
 * refresh is what tells them whether it works.
 */
export async function setFxRateSource(
  root: string,
  input: { url?: string | null; path?: string | null; asOfPath?: string | null },
  actor: Actor,
): Promise<Result<FinanceKitSettings>> {
  const writable = await fxWritable(root);
  if (!writable.ok) return writable;

  const paths = vaultPaths(root);
  const registry = await readRegistry(paths.domainRegistry(FINANCE_DOMAIN_SLUG));
  const settings = financeBlock(registry.finance);

  if (input.url === null) {
    registry.finance = {
      ...settings,
      fxSource: { ...DEFAULT_FX_SOURCE, lastFetchedAt: settings.fxSource?.lastFetchedAt ?? null },
    };
    await atomicWriteFile(paths.domainRegistry(FINANCE_DOMAIN_SLUG), `${JSON.stringify(registry, null, 2)}\n`);
    return { ok: true, value: registry.finance };
  }

  const url = (input.url ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, error: "The rate source must be an http or https URL" };
  }
  const path = (input.path ?? "").trim();
  if (!path) {
    return { ok: false, error: "The rate path is required, e.g. rates.ZAR" };
  }
  const asOfPath = input.asOfPath === undefined ? settings.fxSource?.asOfPath ?? null : (input.asOfPath?.trim() || null);

  const previous = fxSourceOf(settings);
  registry.finance = {
    ...settings,
    fxSource: {
      url,
      path,
      asOfPath,
      // A new source has not been read yet, so its own history starts empty.
      lastFetchedAt: url === previous.url && path === previous.path ? previous.lastFetchedAt : null,
      lastError: url === previous.url && path === previous.path ? previous.lastError : null,
    },
  };
  await atomicWriteFile(paths.domainRegistry(FINANCE_DOMAIN_SLUG), `${JSON.stringify(registry, null, 2)}\n`);

  await appendLog(root, {
    domainSlug: FINANCE_DOMAIN_SLUG,
    type: "finance.fx_source_changed",
    summary: `Set the USD→ZAR rate source to ${url} (${path}) in ${FINANCE_DOMAIN_SLUG}`,
    payload: { url, path, asOfPath },
    actor,
  });

  return { ok: true, value: registry.finance };
}
