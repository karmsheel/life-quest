import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  COMPANION_SOUL,
  DEFAULT_API_PORT,
  MCP_URL,
  PROFILE_NAME,
  RESERVED_PORTS,
  attachCandidateBaseUrls,
  ensureMcpServer,
  ensureEagerToolSearch,
  ensureRootCompanionHeader,
  hasRootCompanionEntry,
  removeCompanionAuthorizationHeader,
  removeCompanionMcpEntry,
  seedModelFromRoot,
  hermesRoot,
  portFromBaseUrl,
  profileDir,
  readEnv,
  shouldSeedSoul,
  upsertEnv,
} from "./companion-profile.ts";

const RESERVED = new Set<number>(RESERVED_PORTS);

export type CompanionReady = {
  kind: "ready";
  port: number;
  baseUrl: string;
  startedByLifeQuest: boolean;
  profilePath: string;
  cliPath: string;
  apiKey: string;
  childPid: number | null;
  /**
   * Set by the model probe AFTER the ready status is published, never before.
   *
   * The gateway is up but the profile's pinned model is not in its catalog, so
   * every chat would end before finishing with no visible reason. It rides on
   * the status rather than on a separate channel because the status is already
   * what the settings surface reads, and it is added late because asking the
   * host for its catalog takes ~0.6s — time the splash must not spend (§ the
   * cold-start spec, 2026-10-17).
   */
  modelWarning?: string;
};

export type CompanionStatus =
  | CompanionReady
  | { kind: "needs_install" }
  | { kind: "profile_error"; message: string; path?: string }
  | { kind: "port_busy"; port: number }
  /**
   * What the Hermes CLI said when the gateway could not be brought up. Not a
   * stderr tail: Hermes prints its refusals on STDOUT (`hermes_cli/cli_output.py`)
   * and exits non-zero with an empty stderr, so this carries whichever stream had
   * the explanation — usually both, labelled by the command that produced them.
   */
  | { kind: "gateway_exited"; detail: string }
  | { kind: "disconnected" }
  | { kind: "hermes_too_old"; version?: string }
  | { kind: "auth_error" };

export type CompanionIo = {
  homedir: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  whichHermes: () => Promise<string | null>;
  readFile: (p: string) => Promise<string | null>;
  writeFile: (p: string, body: string) => Promise<void>;
  mkdirp: (p: string) => Promise<void>;
  /**
   * DOOR-02: correct the mode of a profile file the app owns (0600), for an
   * install whose files predate the rule. Absent in rigs, which have nothing to
   * protect; best-effort by contract (a missing file is not an error).
   */
  hardenFile?: (p: string) => Promise<void>;
  isPortFree: (port: number) => Promise<boolean>;
  health: (url: string) => Promise<boolean>;
  capabilities: (baseUrl: string, key: string) => Promise<unknown | null>;
  ensureHostGateway: (
    cli: string,
    hermesHome: string,
    /**
     * Ask a running host to re-read this profile's config (a credential that was
     * just written, or a profile that parked on a door). The refresh cycles only
     * this profile's served runtime; it never restarts the shared host gateway.
     */
    force?: boolean,
    /**
     * The profile whose `/p/<name>` prefix the host must serve. Absent means
     * the app's own `lifequest` profile, which is what every caller used
     * before the picker existed.
     */
    profileName?: string,
  ) => Promise<void>;
  stopPid: (pid: number) => Promise<void>;
  listeningPid: (port: number) => Promise<number | null>;
  /**
   * The app's own MCP doors: when they bound, and whether the companion has
   * used them since. Absent (an older caller, or a rig with no doors) means the
   * app cannot tell, and nothing is forced on that account.
   */
  doorsState?: () => Promise<{ boundAt: number; companionSeenAt: number | null } | null>;
  /**
   * When the running host itself started, from the host's own record — or null
   * when the app cannot tell (no host record, an unreadable one, an older
   * Hermes). Null is not a verdict: the caller waits the long window instead of
   * guessing, because the two mistakes are not equally cheap. Restarting a host
   * that was about to connect costs a boot; leaving a parked one alone costs the
   * operator every tool the app has.
   */
  hostStartedAt?: () => Promise<number | null>;
  /**
   * The url the profile must be told the local door answers on. Absent means the
   * product's own 8643 (`MCP_URL`); an e2e rig moves the door and passes its
   * url here, because a profile pointing at a port no door is listening on is
   * the very failure this app is trying not to have.
   */
  mcpUrl?: () => string;
  /**
   * KAR-70: the open vault's companion token, or null when no vault is
   * open or the token cannot be minted. Defaults to the open vault's own
   * token; a test may pass its own.
   */
  companionToken?: () => Promise<string | null>;
  /**
   * DOOR-01: whether the local door is actually bound to 127.0.0.1 by THIS
   * process. `attempted` separates "no vault is open yet, so no door was asked
   * to bind" (leave the profile alone) from "the app tried to bind and a foreign
   * process owns the port" (the profile must not carry a url or bearer).
   *
   * Absent means "assume bound", which is what every existing rig that has no
   * doors to speak of expects; the real app always supplies it.
   */
  localDoor?: () => Promise<{ attempted: boolean; bound: boolean } | null>;
};

/**
 * KAR-70: the token for the vault that is open right now, for the profile
 * writer's Authorization header.
 *
 * Imported lazily: vault-service imports this module for the companion's
 * chat stream, so a static import here would close a cycle. A failure to
 * reach it (no vault open, the secrets file unwritable) yields null and
 * the profile is written without the header, which the door answers
 * AUTH_REQUIRED — a loud failure, not a silent one, and never a Decision
 * filed for Hermes.
 */
/**
 * KAR-70: write (or refresh) the profile's `mcp_servers.lifequest` entry.
 * KAR-71: and the profile's `tools.tool_search.enabled: off` line.
 *
 * With no token the `mcp_servers` entry is left untouched — rewriting it with an
 * empty header list would strip the header the companion needs. `ensure` runs on
 * app start, before any vault is open, so there is nothing to write then for the
 * credential. Opening a vault calls this again with that vault's token, which is
 * the credential the rebound doors accept.
 *
 * The tool-search line is independent of the token and is written on either
 * call, because it decides which tools the model may see rather than what the
 * door accepts (see `ensureEagerToolSearch`).
 */
export async function writeCompanionMcpProfile(
  io: Pick<CompanionIo, "readFile" | "writeFile" | "mcpUrl">,
  configPath: string,
  companionToken: string | null,
  rootConfigPath?: string | null,
): Promise<{ credentialChanged: boolean }> {
  const yaml = (await io.readFile(configPath)) ?? "";

  // KAR-71: the tool-surface line lands even with NO token, so it does not wait
  // on a vault being open. It needs no credential — it decides which of the
  // profile's tools the model may see — and without it the companion cannot see
  // the Dashboard tools at all (see ensureEagerToolSearch). Only a file that
  // already exists is rewritten: before the first vault is opened there is no
  // profile config yet, and the token path below is what creates it.
  const eager = ensureEagerToolSearch(yaml);
  if (eager !== yaml && yaml !== "") await io.writeFile(configPath, eager);

  // A missing token must not rewrite the mcp_servers entry: the header it would
  // strip is the only thing making the companion work.
  if (!companionToken) return { credentialChanged: false };

  const authorization = `Bearer ${companionToken}`;
  const current = (await io.readFile(configPath)) ?? "";
  const rootYaml = rootConfigPath ? await io.readFile(rootConfigPath) : null;
  // Did either file already carry THIS credential? A host that is already
  // running read its config when it started, so a header written now is invisible
  // to it until it restarts. This is the flag that says so, and it is the reason
  // a profile seeded before today can have no lifequest tools at all.
  //
  // The root file only counts when it actually lists our server. `ensureRootCompanionHeader`
  // never adds the entry to a root that has none — it only fills in a header on
  // an entry that is already there — so demanding a header from a root without
  // one asked a question that could never be answered yes. It answered no on
  // every launch, on every machine whose root config lists no `lifequest`, which
  // is the default: `credentialChanged` stayed true forever, `ensureCompanion`
  // took the `hostMustReRead` path forever, and every launch paid for two
  // `hermes config set` invocations and a `hermes gateway restart` — restarting
  // a host that was already serving the profile, on the splash, before the first
  // paint. Measured: 56s of a 57s cold start.
  const rootCarriesCompanion =
    rootYaml !== null && hasRootCompanionEntry(rootYaml);
  const hadCredential =
    hasCompanionHeader(current, authorization) &&
    (!rootCarriesCompanion || hasCompanionHeader(rootYaml, authorization));
  let next = ensureMcpServer(current, PROFILE_NAME, io.mcpUrl?.() ?? MCP_URL, {
    Authorization: authorization,
  });
  if (rootYaml) next = seedModelFromRoot(next, rootYaml);
  if (next !== current) await io.writeFile(configPath, next);
  if (rootConfigPath && rootYaml) {
    const rootNext = ensureRootCompanionHeader(rootYaml, authorization);
    if (rootNext !== rootYaml) await io.writeFile(rootConfigPath, rootNext);
  }
  // The door is about to serve this vault, so the host's cached picture of what
  // this server offers is stale by definition. Drop it and let the next turn
  // re-list.
  await dropCachedToolManifest(io, configPath);
  return { credentialChanged: !hadCredential };
}

/**
 * DOOR-01: take this app's door out of the Hermes profile when the local door is
 * NOT bound by this process.
 *
 * Why leave nothing behind: the profile is what the running Hermes host reads to
 * find `lifequest`. If the app failed to bind the local port — another local
 * process owns 127.0.0.1:8643 — a profile that still names `http://127.0.0.1:8643/mcp`
 * and still carries `Authorization: Bearer <companion token>` hands the master
 * credential to that process the moment the host reconnects. Skipping the write
 * is not enough: the previous successful run's entry is already there. So the
 * neutral state is to remove our entry from the profile and the Authorization
 * header from the root entry, and let a later successful bind write them again.
 *
 * Returns true when a file changed. `writeFile` is the caller's private-mode
 * writer, so the rewrite does not re-expose the files.
 */
export async function stripCompanionMcpProfile(
  io: Pick<CompanionIo, "readFile" | "writeFile">,
  configPath: string,
  rootConfigPath?: string | null,
): Promise<boolean> {
  let changed = false;
  const current = await io.readFile(configPath);
  if (current !== null) {
    const next = removeCompanionMcpEntry(current);
    if (next !== current) {
      await io.writeFile(configPath, next);
      changed = true;
    }
  }
  if (rootConfigPath) {
    const rootYaml = await io.readFile(rootConfigPath);
    if (rootYaml !== null) {
      const next = removeCompanionAuthorizationHeader(rootYaml);
      if (next !== rootYaml) {
        await io.writeFile(rootConfigPath, next);
        changed = true;
      }
    }
  }
  if (changed) await dropCachedToolManifest(io, configPath);
  return changed;
}

/**
 * Remove this profile's cached `lifequest` tool manifest, so the host re-lists
 * our tools on its next turn instead of serving the picture it cached earlier.
 *
 * This is the other half of the empty-schema fix, and it is not optional. Hermes
 * caches `tools/list` per server in `cache/mcp_schema_cache.json` with the
 * `ttl_ms` the server sent; the manifest recorded on 2026-10-08 was written by a
 * door that advertised no argument schemas at all and carried `ttl_ms: 0`, so it
 * never expired. Fixing the door would therefore have changed nothing on the
 * operator's own profile: the companion would keep reading the same empty
 * `properties: {}` from disk forever, keep inventing `spec` as a string, and keep
 * failing. The door now sends `ttlMs` (one hour) so this cannot recur on its own;
 * this is what makes it not recur TODAY.
 *
 * Only OUR key is dropped, and only when a vault's token has just been written —
 * that is the moment the door starts serving, and the moment the cached manifest
 * stops describing it. Every other server's entry, and the file's shape, are left
 * exactly as they were; a cache with no entries left is removed outright rather
 * than left as `{}` for another writer to trip over.
 */
async function dropCachedToolManifest(
  io: Pick<CompanionIo, "readFile" | "writeFile">,
  configPath: string,
): Promise<void> {
  const cachePath = path.join(path.dirname(configPath), "cache", "mcp_schema_cache.json");
  let parsed: unknown;
  try {
    const raw = await io.readFile(cachePath);
    if (raw === null) return;
    parsed = JSON.parse(raw);
  } catch {
    // Unreadable or malformed: not ours to repair, and the next write replaces it.
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const bag = parsed as Record<string, unknown>;
  if (!(PROFILE_NAME in bag)) return;
  delete bag[PROFILE_NAME];
  try {
    // `{}` rather than an empty file: this stays valid JSON for whoever reads
    // it next, and an absent key is exactly what "not cached" means.
    await io.writeFile(cachePath, `${JSON.stringify(bag, null, 2)}\n`);
  } catch {
    // A cache we cannot rewrite is a slow first turn, not a broken app.
  }
}

/** Whether a YAML file already carries exactly this Authorization header. */
function hasCompanionHeader(yaml: string, authorization: string): boolean {
  return (
    yaml.includes(`Authorization: ${authorization}`) ||
    yaml.includes(`Authorization: "${authorization}"`)
  );
}

async function openVaultCompanionToken(): Promise<string | null> {
  try {
    const vault = await import("./vault-service.ts");
    const res = await vault.ensureCurrentCompanionToken();
    return res.ok ? res.value : null;
  } catch {
    return null;
  }
}

export function capabilitiesSupportSessions(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as {
    features?: Record<string, unknown>;
    endpoints?: Record<string, unknown>;
  };
  const features = obj.features ?? {};
  const hasSessions =
    features.session_list === true ||
    features.session_resources === true ||
    features.session_chat === true;
  if (!hasSessions) return false;
  if (features.session_chat_stream === true) return true;
  if (features.session_chat_streaming === true) return true;
  if (features.chat_stream === true) return true;
  return typeof obj.endpoints?.session_chat_stream === "string";
}

function sessionCapsKind(
  caps: unknown,
): "ok" | "auth_error" | "hermes_too_old" {
  if (caps == null) return "auth_error";
  return capabilitiesSupportSessions(caps) ? "ok" : "hermes_too_old";
}

export async function choosePort(
  envText: string,
  isPortFree: (port: number) => Promise<boolean>,
): Promise<number> {
  const map = readEnv(envText);
  const parsed = Number.parseInt(map.API_SERVER_PORT ?? "", 10);
  let start =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_API_PORT;
  if (RESERVED.has(start)) start = DEFAULT_API_PORT;
  for (let port = start; port < start + 100; port++) {
    if (RESERVED.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  let fallback = start + 100;
  while (RESERVED.has(fallback)) fallback += 1;
  return fallback;
}

export function shouldStopChild(
  startedByUs: boolean,
  childPid: number | null | undefined,
  listeningPid: number | null,
): boolean {
  if (!startedByUs || childPid == null || listeningPid == null) return false;
  return childPid === listeningPid;
}

/**
 * How long a bound door may go without a single companion request before the
 * host is presumed to have parked on it. A host discovers its MCP servers when
 * it starts, so a door that is up when the host starts sees the companion within
 * seconds. Hermes then re-probes a parked server every 300s, so "wait and hope"
 * is not a fix — and the session in front of the operator is tool-less the whole
 * time.
 *
 * This is the window `ensureCompanion` judges a host by. It is not the window
 * the post-bind check uses: that one runs after the doors are up, and it picks
 * between `DOOR_PARKED_GRACE_MS` and `DOOR_HANDSHAKE_GRACE_MS` from the host's
 * own start record, because at that moment it can tell a host that has already
 * looked from one that is still looking.
 */
export const HOST_REREAD_GRACE_MS = 30_000;

/**
 * Whether a running host has to re-read its configuration before the app can
 * trust it. Two things make it necessary, and both have the same consequence —
 * a session with no lifequest tools, an agent that improvises its own way in:
 *
 *  - this run wrote a credential the configs did not already carry, which a host
 *    that is already up cannot see; or
 *  - the doors have been serving for a while and the companion has never used
 *    them, so this host's one discovery attempt happened before the door it
 *    needed was listening (the app started after Hermes, or the vault was
 *    reopened and the door re-bound under a new credential).
 *
 * No door bound means no vault is open and there is nothing to conclude; a door
 * the companion has used means the host is connected and must be left alone.
 *
 * This runs inside `ensureCompanion`, once, at app start — where a vault need not
 * be open yet, so the second case is usually invisible to it. `hostMissedDoors`
 * is the same question asked where it can be answered: after the doors bind.
 */
export function hostMustReRead(opts: {
  credentialChanged: boolean;
  doors: { boundAt: number; companionSeenAt: number | null } | null;
  now: number;
  graceMs?: number;
}): boolean {
  if (opts.credentialChanged) return true;
  const doors = opts.doors;
  if (!doors) return false;
  if (doors.companionSeenAt !== null) return false;
  return opts.now - doors.boundAt >= (opts.graceMs ?? HOST_REREAD_GRACE_MS);
}

/**
 * How long a door that just bound waits for a host whose own startup overlaps
 * that binding.
 *
 * A host discovers its MCP servers as it boots, and the first connect is not
 * instant: on 2026-10-08 the host process started at 17:07:50 and its third
 * failed attempt to reach a door that did not exist yet was logged at 17:08:27.
 * So a host that is starting now has not finished looking, and restarting it
 * under that window would throw away the boot that was about to succeed.
 */
export const DOOR_HANDSHAKE_GRACE_MS = 45_000;

/**
 * How long a door that just bound waits for a host that was already running
 * before it.
 *
 * That host read its `mcp_servers` at ITS start, tried a door that was not
 * listening, and parked; Hermes will not probe a parked server again for 300s
 * (`_PARKED_RETRY_INTERVAL`), so nothing about this binding is going to reach it
 * on its own. Five seconds is the margin for a host that started seconds before
 * the bind and is still mid-discovery — the wait below re-reads the door after
 * it, so a companion that arrives in that window is left alone.
 */
export const DOOR_PARKED_GRACE_MS = 5_000;

/**
 * The same question as `hostMustReRead`, asked at the one moment that matters:
 * after the doors have bound.
 *
 * `ensureCompanion` runs once, at app start, and at app start no vault need be
 * open — so it usually finds no doors and concludes nothing. The host, however,
 * read its `mcp_servers` when it started, and if that was before these doors
 * bound it has already tried, failed, and parked: Hermes will not probe a parked
 * server again for 300s, and every session on the profile has no lifequest tools
 * until it does. That is 2026-10-08's report, word for word — an app started at
 * 17:38 against a host started at 17:07, a chat that could not read finance or
 * pin a card, and a host that revived on its own four minutes later.
 *
 * So this waits the binding's window out and answers with the binding the
 * companion never reached. `null` means there is nothing to fix: no vault open,
 * the companion already used this door, or it arrived while we waited.
 *
 * WHICH WINDOW, AND WHY IT IS NOT ONE NUMBER
 *
 * The host's own record of when it started (`io.hostStartedAt`, the host's pid
 * file) is compared with the bind. A host that started BEFORE the doors bound has
 * already run its one discovery pass over a door that was not there, so it gets
 * the short window and is restarted promptly; a host that started with or after
 * them is still looking, so it gets the long one and is left alone.
 *
 * The loop is not decoration. A vault switch rebinds the doors, and the binding
 * a decision is owed for is the one that is up when the decision is made: a
 * rebind while we sleep is a new question with a fresh clock, and this answers
 * that one rather than standing down on the old one.
 */
export async function hostMissedDoors(
  io: Pick<CompanionIo, "doorsState" | "hostStartedAt">,
  opts: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    graceMs?: number;
  } = {},
): Promise<{ boundAt: number } | null> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // A caller whose doors move on every read would otherwise keep this loop
  // alive forever, waiting on a binding that never settles — and a rebind that
  // tracks the clock never even reaches the comparison below, because its
  // deadline is always in the future. Bound the passes, not just the rebinds, and
  // stand down: the next vault open asks again, and the app is not owed a verdict
  // it cannot reach.
  const MAX_PASSES = 8;
  let passes = 0;

  for (;;) {
    passes += 1;
    if (passes > MAX_PASSES) return null;

    const doors = (await io.doorsState?.()) ?? null;
    if (!doors || doors.companionSeenAt !== null) return null;

    const hostStartedAt = (await io.hostStartedAt?.()) ?? null;
    const grace =
      opts.graceMs ??
      (hostStartedAt !== null && hostStartedAt < doors.boundAt
        ? DOOR_PARKED_GRACE_MS
        : DOOR_HANDSHAKE_GRACE_MS);

    const remaining = doors.boundAt + grace - now();
    if (remaining > 0) {
      await sleep(remaining);
      continue;
    }

    const after = (await io.doorsState?.()) ?? null;
    if (!after || after.companionSeenAt !== null) return null;
    if (after.boundAt !== doors.boundAt) continue;
    return { boundAt: after.boundAt };
  }
}

/**
 * Bring the companion up on ONE profile — `lifequest` unless the operator has
 * chosen another in the picker (see `companionUseProfile`).
 *
 * The profile name decides three things and nothing else: the directory the
 * app writes its `.env` / `config.yaml` / `SOUL.md` into, the `/p/<name>`
 * prefix it attaches to, and where Settings opens. Everything the companion
 * is TOLD (the soul, the MCP entry, the eager tool-search line) is identical
 * on every profile — an operator's profile becomes the LifeQuest companion
 * the moment it is chosen, and stays theirs everywhere else.
 */
export async function ensureCompanion(
  io: CompanionIo,
  profileName: string = PROFILE_NAME,
): Promise<CompanionStatus> {
  const cli = await io.whichHermes();
  if (!cli) return { kind: "needs_install" };

  const root = hermesRoot(io.env, io.homedir);
  const dir = profileDir(root, profileName);
  const envPath = path.join(dir, ".env");
  const configPath = path.join(dir, "config.yaml");
  const soulPath = path.join(dir, "SOUL.md");

  try {
    await io.mkdirp(dir);
  } catch (e) {
    return {
      kind: "profile_error",
      message: e instanceof Error ? e.message : String(e),
      path: dir,
    };
  }

  // DOOR-02: an upgraded install can carry profile files written with the old
  // umask-derived modes. Correct them on every ensure, before anything is read
  // back into the app or left for the host; `hardenFile` is best-effort and is
  // supplied by the real app (a rig without it has nothing to harden).
  for (const guarded of [
    envPath,
    configPath,
    soulPath,
    path.join(root, ".env"),
    path.join(root, "config.yaml"),
  ]) {
    try {
      await io.hardenFile?.(guarded);
    } catch {
      /* Best effort: a mode that cannot be corrected is not a profile failure. */
    }
  }

  let envText = (await io.readFile(envPath)) ?? "";
  const existing = readEnv(envText);
  const apiKey =
    existing.API_SERVER_KEY?.trim() || randomBytes(24).toString("hex");

  // The API server's startup guard reads API_SERVER_KEY from the home the
  // gateway PROCESS runs as — the root, not the profile — and refuses to bind
  // without one (`api_server.py`: missing, or fewer than 16 chars). The
  // profile key written below authorises /p/<profile> requests; this one is
  // what makes the listener exist at all, so a machine that has never run an
  // API server gets one here instead of a companion that can never attach.
  // An existing root key is never replaced: Hermes Desktop and every other
  // client on this machine may already hold it.
  const rootEnvText = (await io.readFile(path.join(root, ".env"))) ?? "";
  if ((readEnv(rootEnvText).API_SERVER_KEY?.trim() ?? "").length < 16) {
    await io.writeFile(
      path.join(root, ".env"),
      upsertEnv(rootEnvText, { API_SERVER_KEY: randomBytes(24).toString("hex") }),
    );
  }

  // Set by the profile writer below when it had to write a credential the files
  // did not already carry. A running host cannot see that write, so it forces
  // the refresh that makes it visible (scoped to this profile, never the host).
  let credentialChanged = false;
  try {
    envText = upsertEnv(envText, { API_SERVER_KEY: apiKey });
    await io.writeFile(envPath, envText);
    // DOOR-01: only hand the host a credential for a door THIS process bound.
    // The default getter mints/reads the open vault's token; when the local door
    // failed to bind, that token would be sent to whichever process owns the
    // port. `localDoor` absent means "a rig with no doors", which keeps the old
    // behaviour for callers that never had a listener to speak of.
    const localDoor = (await io.localDoor?.()) ?? null;
    const localBound = localDoor === null ? true : localDoor.bound;
    const companionToken = localBound
      ? await (io.companionToken ?? openVaultCompanionToken)()
      : null;
    const wrote = await writeCompanionMcpProfile(
      io,
      configPath,
      companionToken,
      path.join(root, "config.yaml"),
    );
    credentialChanged = wrote.credentialChanged;
    if (localDoor?.attempted && !localDoor.bound) {
      // The previous run's entry is still in the profile; remove it so the host
      // cannot reconnect to a foreign listener with our bearer.
      await stripCompanionMcpProfile(io, configPath, path.join(root, "config.yaml"));
      credentialChanged = false;
    }
    const soul = await io.readFile(soulPath);
    if (shouldSeedSoul(soul)) {
      await io.writeFile(soulPath, COMPANION_SOUL);
    }
  } catch (e) {
    return {
      kind: "profile_error",
      message: e instanceof Error ? e.message : String(e),
      path: dir,
    };
  }

  const hostEnv = readEnv((await io.readFile(path.join(root, ".env"))) ?? "");
  const hostPortParsed = Number.parseInt(hostEnv.API_SERVER_PORT ?? "", 10);
  const hostPort =
    Number.isFinite(hostPortParsed) && hostPortParsed > 0
      ? hostPortParsed
      : DEFAULT_API_PORT;

  const tryAttach = async (): Promise<CompanionStatus | null> => {
    for (const baseUrl of attachCandidateBaseUrls(hostPort, profileName)) {
      if (!(await io.health(baseUrl))) continue;
      const caps = await io.capabilities(baseUrl, apiKey);
      const capsKind = sessionCapsKind(caps);
      if (capsKind !== "ok") return { kind: capsKind };
      return {
        kind: "ready",
        port: portFromBaseUrl(baseUrl),
        baseUrl,
        startedByLifeQuest: false,
        profilePath: dir,
        cliPath: cli,
        apiKey,
        childPid: null,
      };
    }
    return null;
  };

  const doors = (await io.doorsState?.()) ?? null;
  const forceRefresh = hostMustReRead({ credentialChanged, doors, now: Date.now() });

  const attached = await tryAttach();
  // A host that is already serving is normally good enough, but not when it has
  // no way to know about this vault: either this run wrote a credential it never
  // read, or the door it would have discovered was not listening when it tried
  // and it has parked. In both cases every session on the profile is left with
  // no lifequest tools, and an agent with no tools improvises its own way in —
  // that is the 2026-10-08 pairing, a truncated token copied out of a masked
  // listing and a self-chosen name, filed as a new agent and then granted by
  // hand.
  if (attached && !forceRefresh) return attached;

  try {
    await io.ensureHostGateway(cli, root, forceRefresh, profileName);
  } catch (e) {
    // A refresh that fails must not take a working companion away. The host is
    // still serving; it just did not re-read its config.
    if (attached) return attached;
    return {
      kind: "gateway_exited",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const after = await tryAttach();
  if (after) return after;
  if (attached) return attached;
  return {
    kind: "gateway_exited",
    detail:
      profileName === "default"
        ? "Host gateway did not serve the default profile."
        : `Host gateway did not serve /p/${profileName}.`,
  };
}

export async function shutdownCompanion(
  status: CompanionStatus,
  io: Pick<CompanionIo, "stopPid" | "listeningPid">,
): Promise<void> {
  if (status.kind !== "ready") return;
  const listening = await io.listeningPid(status.port);
  if (!shouldStopChild(status.startedByLifeQuest, status.childPid, listening)) {
    return;
  }
  if (status.childPid != null) await io.stopPid(status.childPid);
}

/**
 * Is the profile's pinned model still one the gateway can route?
 *
 * WHY THIS ASKS THE HOST AND NOT THE PROVIDER
 *
 * The check used to GET the provider's own `/models` endpoint with a bearer key
 * taken from the profile's `.env` — which is `API_SERVER_KEY`, the credential
 * this app mints for the host's loopback API server. It is not the provider's
 * key and nothing in the app has ever held one: the provider credentials live
 * with the host, which is what every chat goes through. So the check either
 * leaked a local credential to a third party or, for a provider that wants a
 * key, answered 401 and reported "unreachable" — a verdict of silence. It also
 * meant the "model was retired" warning could never fire at all.
 *
 * `GET /api/model/options` on the host is the same inventory the composer's
 * model menu is built from, authorized with the key this app does hold, so the
 * list a warning is judged against is exactly the list the operator can pick
 * from. If the pinned id is missing from a provider the host has authenticated,
 * the chat cannot route it.
 *
 * Silence is not a verdict, and it has two shapes here: no catalog at all, and
 * a pinned provider the catalog does not describe (unknown slug, or no credential
 * configured on the host). Neither may retire a model.
 */
export type ModelCheck =
  | { kind: "ok" }
  | { kind: "unknown" }
  | { kind: "retired"; model: string; provider: string };

/** The part of `CompanionModelCatalog` a verdict needs, so this module stays IO-free. */
export type ModelCatalogView = {
  current: { model: string; provider: string };
  providers: Array<{
    slug: string;
    authenticated: boolean;
    models: Array<{ id: string }>;
  }>;
};

export function modelVerdict(catalog: ModelCatalogView | null): ModelCheck {
  if (!catalog) return { kind: "unknown" };
  const model = catalog.current.model.trim();
  const provider = catalog.current.provider.trim();
  if (!model || !provider) return { kind: "unknown" };
  const row = catalog.providers.find((entry) => entry.slug === provider);
  // A provider the host does not describe, or one it has no credential for, is
  // a list we cannot judge against — and a wrong "retired" would tell the
  // operator to replace a model that works.
  if (!row || !row.authenticated || row.models.length === 0) {
    return { kind: "unknown" };
  }
  return row.models.some((choice) => choice.id === model)
    ? { kind: "ok" }
    : { kind: "retired", model, provider };
}

/** The sentence the settings surface shows for a retired model, or null. */
export function modelWarningFor(verdict: ModelCheck): string | null {
  if (verdict.kind !== "retired") return null;
  return `The companion's model "${verdict.model}" is not in this profile's model catalog any more — every chat will fail until you pick a live model in the chat composer.`;
}

