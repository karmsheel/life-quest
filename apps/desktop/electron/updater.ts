/**
 * Auto-update: read the newest GitHub release for this app, and — when the
 * operator asks — download its installer, hand it to Windows, and step aside.
 *
 * This system talks to the network and then *runs a downloaded executable*, so
 * the ways it can fail are written down before the code:
 *
 *  1. The feed answers 404 — a repository with nothing published, or one that
 *     stopped being public. Must report "could not check", never "up to date",
 *     and never glow. A check that did not happen is not a check that found
 *     nothing.
 *  2. The feed answers 200 naming an older or equal version — no offer. A
 *     downgrade is not an upgrade.
 *  3. A tag that cannot be read (`nightly`, `release-2`, `2026-01-01`) — fail
 *     closed: no glow, no download. An unreadable tag is not a licence to run
 *     an installer.
 *  4. `0.10.0` against `0.9.0` compared as text — 0.10.0 is the newer one.
 *     Compared numerically.
 *  5. A prerelease (`0.2.0-beta.1`) offered over the release it precedes — the
 *     prerelease is the older one.
 *  6. The release carries no installer asset — still an available upgrade, but
 *     the offer is the release page and nothing is downloaded.
 *  7. The asset's url does not point at GitHub — refuse to download it. The one
 *     executable this app runs must come from the place it was told to look.
 *  8. The body is truncated or never ends — the partial file is deleted and the
 *     failure reported. A half-written exe is never launched.
 *  9. The bytes on disk do not match the size the feed declared — same.
 * 10. The operator triggers the install twice — one flight. The second call
 *     joins the first rather than downloading a second copy, and two installers
 *     are never launched.
 * 11. The launch itself fails (no handler, missing file) — the error is
 *     reported and the app does NOT quit, so a failed upgrade never leaves the
 *     operator with no app at all.
 * 12. The check is asked for again in the same session — the session's answer is
 *     kept, because the product asks once, at launch. `force` is the operator
 *     asking by hand, and only Settings does that.
 */
import { app, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import pkg from "../package.json";

/**
 * The version this build *is*, baked where it is bundled.
 *
 * Deliberately the same `package.json` the renderer's badge reads its own number
 * from, rather than `app.getVersion()`: one source, bundled into both halves, so
 * the number on screen and the number the feed is compared against cannot
 * disagree. `app.getVersion()` answers with Electron's own version whenever the
 * entry point is a script rather than an app folder, which is exactly what a rig
 * that boots this bundle directly looks like — a difference between the product
 * and its own test that would have been invisible until it mattered.
 */
export const APP_VERSION: string = pkg.version;

/** The repository whose releases are the app's own releases. */
export const OWNER_REPO = "karmsheel/life-quest";

const DEFAULT_FEED_URL = `https://api.github.com/repos/${OWNER_REPO}/releases/latest`;

const DEFAULT_TRUST_HOSTS = ["github.com", "githubusercontent.com"];

/**
 * Where an installer is allowed to come from.
 *
 * This is the one policy standing between the feed's answer and running an
 * executable, so it is a policy *object* rather than a constant: the
 * auto-update rig serves its own bytes over loopback (neither https nor GitHub)
 * and has to move the line, and it moves the line somewhere else again to prove
 * the refusal still fires. The product never calls the setter.
 */
type TrustPolicy = { hosts: string[]; allowHttp: boolean };

const DEFAULT_TRUST: TrustPolicy = {
  hosts: DEFAULT_TRUST_HOSTS,
  allowHttp: false,
};

let trust: TrustPolicy = DEFAULT_TRUST;

export function setUpdateTrustPolicy(policy: TrustPolicy | null): void {
  trust = policy ?? DEFAULT_TRUST;
}

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export type UpdateAsset = {
  name: string;
  /** The `browser_download_url` the feed declared. */
  url: string;
  /** Declared size in bytes; 0 when the feed did not say. */
  size: number;
};

export type UpdateDecision =
  | {
      state: "available";
      /** The version this build is running, as the app reports it. */
      current: string;
      latest: string;
      /** The release's own title, when it has one. */
      title: string | null;
      notes: string;
      publishedAt: string | null;
      releaseUrl: string;
      /** Null when the release has no `-setup.exe`; the offer is then the page. */
      installer: UpdateAsset | null;
    }
  | { state: "current"; current: string; latest: string }
  | { state: "no_release"; current: string; error: string }
  | { state: "error"; current: string; error: string };

// —— versions ————————————————————————————————————————————————————————————————

type ParsedVersion = {
  core: [number, number, number];
  /** Dot-separated prerelease identifiers, empty for a release. */
  pre: string[];
};

/**
 * `v1.2.3`, `1.2.3`, `1.2`, `1.2.3-beta.1`, `1.2.3+build`. Anything else is
 * null — and null is what keeps an unreadable tag from being treated as newer.
 */
export function parseVersion(input: string): ParsedVersion | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    input.trim(),
  );
  if (!match) return null;
  return {
    core: [
      Number(match[1]),
      Number(match[2] ?? 0),
      Number(match[3] ?? 0),
    ],
    pre: match[4] ? match[4].split(".") : [],
  };
}

/** One prerelease identifier against another, per semver: numeric below text. */
function compareIdentifier(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b);
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Negative when `a` is older than `b`, 0 when they are the same release, null
 * when either side cannot be read.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;

  for (let i = 0; i < 3; i += 1) {
    const diff = left.core[i] - right.core[i];
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  // A release outranks any prerelease of itself.
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;

  const length = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const diff = compareIdentifier(l, r);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

// —— the release payload ————————————————————————————————————————————————————

type GitHubAsset = {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
};

type GitHubRelease = {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** A host the policy names, and not something that merely ends in its name. */
export function isTrustedAssetUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && !(trust.allowHttp && parsed.protocol === "http:")) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return trust.hosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * A GitHub page, for the one link this app opens in the operator's own browser.
 *
 * Deliberately *not* the installer's trust policy, which is about where an
 * executable may come from: the release page is a link, and it should be the
 * repository's page whether or not the machine's download policy has been moved.
 */
export function isGitHubPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "github.com" || host.endsWith(".github.com");
  } catch {
    return false;
  }
}

/**
 * The installer this app is willing to run: the first asset named for the
 * Windows setup, at a GitHub url. Null when the release carries none.
 */
export function installerAssetOf(assets: unknown): UpdateAsset | null {
  if (!Array.isArray(assets)) return null;
  for (const raw of assets as GitHubAsset[]) {
    const name = asString(raw?.name);
    const url = asString(raw?.browser_download_url);
    if (!name || !url) continue;
    if (!/setup.*\.exe$/i.test(name)) continue;
    if (!isTrustedAssetUrl(url)) continue;
    const size = typeof raw.size === "number" && raw.size > 0 ? raw.size : 0;
    return { name, url, size };
  }
  return null;
}

/**
 * The release payload, and the version this build is running, as one answer the
 * renderer can render: is there something newer, and what is it.
 */
export function decideUpdate(
  current: string,
  release: GitHubRelease | null,
): UpdateDecision {
  if (!parseVersion(current)) {
    return {
      state: "error",
      current,
      error: `This build's own version (${current}) could not be read.`,
    };
  }
  if (!release) {
    return {
      state: "no_release",
      current,
      error: "The repository has no published release to compare against.",
    };
  }
  if (release.draft === true) {
    // A draft is not published; the feed should not have handed it over.
    return {
      state: "no_release",
      current,
      error: "The newest release is still a draft.",
    };
  }

  const tag = asString(release.tag_name);
  if (!tag || !parseVersion(tag)) {
    return {
      state: "error",
      current,
      error: `The release's tag (${tag ?? "missing"}) is not a version number.`,
    };
  }
  const latest = tag.trim().replace(/^v/, "");

  const diff = compareVersions(latest, current);
  if (diff === null) {
    return {
      state: "error",
      current,
      error: `Cannot compare ${latest} with ${current}.`,
    };
  }
  if (diff <= 0) {
    return { state: "current", current, latest };
  }

  const releaseUrl = asString(release.html_url);
  return {
    state: "available",
    current,
    latest,
    title: asString(release.name),
    notes: asString(release.body) ?? "",
    publishedAt: asString(release.published_at),
    releaseUrl:
      releaseUrl && isGitHubPage(releaseUrl)
        ? releaseUrl
        : `https://github.com/${OWNER_REPO}/releases`,
    installer: installerAssetOf(release.assets),
  };
}

// —— the fetch ———————————————————————————————————————————————————————————————

export type UpdateCheckResult =
  | { ok: true; decision: UpdateDecision }
  | { ok: false; error: string };

/**
 * Overridable only by the e2e seam (`LIFEQUEST_E2E.updateFeedUrl`), so a rig can
 * point the real fetcher at a server it owns. Absent in the product.
 */
let feedUrlOverride: string | null = null;

export function setUpdateFeedUrl(url: string | null): void {
  feedUrlOverride = url;
}

/** Overridable only by the e2e seam; the product always uses `shell.openPath`. */
let launcherOverride: { exe: string; args?: string[] } | null = null;

export function setUpdateLauncher(
  launcher: { exe: string; args?: string[] } | null,
): void {
  launcherOverride = launcher;
}

function feedUrl(): string {
  return feedUrlOverride ?? DEFAULT_FEED_URL;
}

/**
 * The newest published release, read **unauthenticated**.
 *
 * The repository is public, so there is no token to hold and nothing to store in
 * OS secure storage: the check is one anonymous GET. That also keeps the app
 * honest about what it is — a read of a public feed, with no secret in it.
 */
async function fetchLatestRelease(): Promise<
  { ok: true; release: GitHubRelease } | { ok: false; error: string }
> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `LifeQuest/${APP_VERSION}`,
  };

  let response: Response;
  try {
    response = await fetch(feedUrl(), {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        ok: false,
        error: `GitHub has no release to compare against (HTTP 404) — nothing has been published for ${OWNER_REPO} yet.`,
      };
    }
    return { ok: false, error: `GitHub answered HTTP ${response.status}.` };
  }

  try {
    return { ok: true, release: (await response.json()) as GitHubRelease };
  } catch (error) {
    return {
      ok: false,
      error: `GitHub's answer was not JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// —— the session's one answer ————————————————————————————————————————————————

let sessionCheck: Promise<UpdateCheckResult> | null = null;

/**
 * Ask for the newest release. Without `force` the session keeps its first
 * answer, which is what makes the product's cadence "once, at launch"; Settings
 * passes `force` because the operator asked by hand.
 */
export async function checkForUpdate(
  options: { force?: boolean } = {},
): Promise<UpdateCheckResult> {
  if (!options.force && sessionCheck) return sessionCheck;

  const run = (async (): Promise<UpdateCheckResult> => {
    const fetched = await fetchLatestRelease();
    if (!fetched.ok) return { ok: false, error: fetched.error };
    return { ok: true, decision: decideUpdate(APP_VERSION, fetched.release) };
  })();

  sessionCheck = run;
  const result = await run;
  // A failed check is not an answer worth keeping: the operator's next attempt
  // should reach the network again rather than replay a dead end.
  if (!result.ok) sessionCheck = null;
  return result;
}

/** Test seam only: forget the session's answer. */
export function resetUpdateSession(): void {
  sessionCheck = null;
}

// —— download and hand over ——————————————————————————————————————————————————

export type UpdateProgress = { downloaded: number; total: number };

function updatesDir(): string {
  return path.join(app.getPath("temp"), "LifeQuest-update");
}

export type InstallResult =
  | { ok: true; launched: true; installer: string; bytes: number }
  | { ok: false; error: string };

let installFlight: Promise<InstallResult> | null = null;

/**
 * The asset the renderer asked for, read defensively.
 *
 * `update:install` runs a downloaded executable, and the argument comes across
 * the IPC boundary from the renderer — so it is checked here rather than trusted.
 * A renderer bug that sent nothing would otherwise surface as a TypeError inside
 * the download, and a renderer that sent a name with a path separator would
 * choose where the file lands.
 */
export function readAsset(input: unknown): UpdateAsset | null {
  if (!input || typeof input !== "object") return null;
  const { name, url, size } = input as {
    name?: unknown;
    url?: unknown;
    size?: unknown;
  };
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof url !== "string" || !url.trim()) return null;
  return {
    name,
    url,
    size:
      typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0,
  };
}

/**
 * The one executable this app runs on the operator's behalf. Downloading and
 * launching are one flight: a second request joins the first, so a double click
 * cannot put two installers on the machine.
 */
export function installUpdate(
  input: unknown,
  onProgress: (progress: UpdateProgress) => void,
): Promise<InstallResult> {
  const asset = readAsset(input);
  if (!asset) {
    return Promise.resolve({
      ok: false,
      error:
        "The release did not describe a Windows installer, so nothing was downloaded.",
    });
  }
  if (installFlight) return installFlight;
  const flight = runInstall(asset, onProgress).then((result) => {
    // Only a success stays as the session's answer: an attempt that failed —
    // no network, a truncated file, Windows refusing — must be able to try
    // again rather than replay a dead end.
    if (!result.ok) installFlight = null;
    return result;
  });
  installFlight = flight;
  return flight;
}

async function runInstall(
  asset: UpdateAsset,
  onProgress: (progress: UpdateProgress) => void,
): Promise<InstallResult> {
  if (!isTrustedAssetUrl(asset.url)) {
    return {
      ok: false,
      error: `Refusing to download an installer from ${asset.url} — it is not a trusted host.`,
    };
  }

  const dir = updatesDir();
  let file: string;
  try {
    await fs.mkdir(dir, { recursive: true });
    // The name comes from the release, so it is sanitised to a basename before
    // it is used as a path: a name carrying `..\` must not choose the location.
    file = path.join(dir, path.basename(asset.name));
  } catch (error) {
    return {
      ok: false,
      error: `Could not prepare ${dir}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // A left-over file from a previous attempt would make the size check below
  // pass for the wrong reason.
  await fs.rm(file, { force: true });

  const headers: Record<string, string> = {
    Accept: "application/octet-stream",
    "User-Agent": `LifeQuest/${APP_VERSION}`,
  };

  let response: Response;
  try {
    response = await fetch(asset.url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not download the installer: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok || !response.body) {
    return {
      ok: false,
      error: `The installer download answered HTTP ${response.status}.`,
    };
  }
  // After the redirects, this is where the bytes really came from.
  if (!isTrustedAssetUrl(response.url)) {
    return {
      ok: false,
      error: `The installer redirected to ${response.url}, which is not a trusted host.`,
    };
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  const total = asset.size || (Number.isFinite(declared) ? declared : 0);

  let downloaded = 0;
  const counted = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            downloaded += value.byteLength;
            onProgress({ downloaded, total });
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(counted as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(file),
    );
  } catch (error) {
    await fs.rm(file, { force: true });
    return {
      ok: false,
      error: `The download did not finish: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (asset.size > 0 && downloaded !== asset.size) {
    await fs.rm(file, { force: true });
    return {
      ok: false,
      error: `The installer is ${downloaded} bytes but the release declares ${asset.size}; the file was discarded.`,
    };
  }

  const launched = await launchInstaller(file);
  if (!launched.ok) return launched;

  return { ok: true, launched: true, installer: file, bytes: downloaded };
}

/**
 * Hand the installer to the OS and step aside, so it can replace the files this
 * process is holding open. Returns before the app goes away.
 */
async function launchInstaller(file: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const exists = await fs.stat(file);
    if (!exists.isFile() || exists.size === 0) {
      return { ok: false, error: `${file} is not a file with bytes in it.` };
    }
  } catch (error) {
    return {
      ok: false,
      error: `The downloaded installer is gone: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (launcherOverride) {
    const { spawn } = await import("node:child_process");
    try {
      const child = spawn(
        launcherOverride.exe,
        [...(launcherOverride.args ?? []), file],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
    } catch (error) {
      return {
        ok: false,
        error: `Could not start the installer: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else {
    const problem = await shell.openPath(file);
    // `openPath` answers with an empty string on success, and the reason on
    // failure. A failure here must leave the app running: the operator still has
    // a studio, and an upgrade that did not start is not an upgrade.
    if (problem) {
      return { ok: false, error: `Windows would not start the installer: ${problem}` };
    }
  }

  // Only now — the download is verified and the installer is up. The app quits
  // so nothing holds the files the installer has to replace, with a beat first:
  // the installer is a separate process that has to reach its own window, and a
  // process that exits under it looks like a crash rather than a hand-over.
  setTimeout(() => {
    app.quit();
  }, 1000);

  return { ok: true };
}
