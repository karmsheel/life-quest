import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

/**
 * The Hermes gateway's local control socket, for the one thing the CLI cannot do
 * without touching every profile: make the running host re-read one profile's
 * configuration.
 *
 * Hermes exposes this on a per-HERMES_HOME socket — a Unix domain socket on
 * POSIX, a named pipe on Windows (`gateway.control_socket`). The verbs this app
 * needs are `identify` (who is serving, and which profiles), `serve-profile` (hot
 * add one), `unserve-profile` (stop and unroute one), and `rescan-profiles`
 * (reconcile the whole `profiles/` directory). They are the same verbs the
 * Hermes CLI and Dashboard use; none of them stops the host process.
 *
 * The socket is deliberately local and same-user. A failure to reach it is a
 * normal, expected condition on an older Hermes or a machine with no gateway
 * yet, so every call resolves instead of throwing: the caller then leaves the
 * host alone rather than falling back to a restart.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const IDENTIFY_TIMEOUT_MS = 2_000;

/** One `identify` answer, reduced to the fields this app needs. */
type GatewayIdentity = {
  /** The launch profile: the one the host process itself is running as. */
  profile: string | null;
  /** Every profile the host currently serves, by absolute home. */
  homes: string[];
};

function requestLine(
  verb: string,
  params?: Record<string, unknown>,
): string {
  return `${JSON.stringify({
    protocol: 1,
    verb,
    id: 1,
    ...(params ? { params } : {}),
  })}\n`;
}

/**
 * The Windows named pipe Hermes derives from a home.
 *
 * Hermes hashes `os.path.normcase(str(Path(home).resolve()))` and takes the
 * first 16 hex characters. `normcase` on Windows lower-cases and normalises
 * separators, which is what `path.resolve(...).toLowerCase()` does for a path
 * that already exists. The home this app uses is the operator's real
 * `%LOCALAPPDATA%/hermes`, not a symlink, so a realpath is not needed here.
 */
function pipeName(home: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(path.resolve(home).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return `\\\\.\\pipe\\hermes-gateway-${hash}`;
}

/**
 * The POSIX socket path Hermes uses: `gateway.sock` in the home, or the private
 * path named by `gateway.sock.path` when the direct path was too long.
 */
async function unixSocketPath(home: string): Promise<string | null> {
  const direct = path.join(home, "gateway.sock");
  try {
    const st = await fs.stat(direct);
    if (st.isSocket()) return direct;
  } catch {
    /* fall through to the pointer */
  }
  try {
    const pointer = (
      await fs.readFile(path.join(home, "gateway.sock.path"), "utf8")
    ).trim();
    if (!path.isAbsolute(pointer)) return null;
    const st = await fs.stat(pointer);
    return st.isSocket() ? pointer : null;
  } catch {
    return null;
  }
}

/**
 * Ask one gateway a question. Resolves `null` for every reason a gateway is not
 * there to answer — no socket, no pipe, a refused connection, a malformed or
 * oversized reply, a timeout — because "no answer" is a fact the caller handles,
 * not an error the app should surface on the setup screen.
 */
export async function queryGatewayControl(
  home: string,
  verb: string,
  params?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
  const address =
    process.platform === "win32" ? pipeName(home) : await unixSocketPath(home);
  if (!address) return null;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let buffer = "";
    let timer: NodeJS.Timeout;

    const finish = (value: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };

    timer = setTimeout(() => finish(null), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(requestLine(verb, params));
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // The real control protocol caps a reply at 512 KiB. A local peer that
      // sends more than that is not a gateway this app should wait on.
      if (buffer.length > 512 * 1024) {
        finish(null);
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      let response: unknown;
      try {
        response = JSON.parse(buffer.slice(0, newline));
      } catch {
        finish(null);
        return;
      }
      const envelope = response as {
        ok?: unknown;
        protocol?: unknown;
        id?: unknown;
        result?: unknown;
      };
      // The control protocol is versioned and correlated. A reply that is not
      // protocol 1 with our id is not an answer this process may act on.
      if (
        envelope?.ok !== true ||
        envelope.protocol !== 1 ||
        envelope.id !== 1 ||
        !envelope.result ||
        typeof envelope.result !== "object"
      ) {
        finish(null);
        return;
      }
      finish(envelope.result as Record<string, unknown>);
    });
    socket.on("error", () => finish(null));
    socket.on("close", () => finish(null));
    socket.connect(address);
  });
}

function identityFrom(
  payload: Record<string, unknown> | null,
): GatewayIdentity | null {
  if (!payload) return null;
  const profile = typeof payload.profile === "string" ? payload.profile : null;
  const served = Array.isArray(payload.served_profiles)
    ? payload.served_profiles
    : [];
  const homes: string[] = [];
  for (const entry of served) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { home?: unknown; profile_id?: unknown };
    const home = row.home ?? row.profile_id;
    if (typeof home === "string" && home) homes.push(home);
  }
  return { profile, homes };
}

/** Hermes' own path identity: case-insensitive and separator-insensitive here. */
function sameHome(a: string, b: string): boolean {
  const normal = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normal(a) === normal(b);
}

/**
 * Make the running host re-read ONE profile's configuration, by cycling that
 * profile's served runtime: `unserve-profile` tears down its adapters and MCP
 * connections, and `serve-profile` brings them back from what is on disk now.
 *
 * This is the surgical alternative to `hermes gateway restart`. The host is the
 * single multiplexer for every profile on this machine, so restarting it to
 * refresh one profile takes every other profile down too — the operator's bots
 * and their open Hermes Desktop among them.
 *
 * Resolves true when this profile is served after the call, false when the host
 * has no control socket (an older Hermes), the profile is the host's own launch
 * profile (which cannot be unserved), or the host refused. False is not a
 * failure: the caller leaves the host alone and Hermes reconciles its own MCP
 * servers on its next housekeeping tick.
 */
export async function refreshServedProfile(
  home: string,
  profileName: string,
): Promise<boolean> {
  if (!profileName || profileName === "default") return false;

  const identity = identityFrom(
    await queryGatewayControl(home, "identify", undefined, IDENTIFY_TIMEOUT_MS),
  );
  if (!identity) return false;
  // The launch profile IS the host process; unserving it would stop the host.
  if (identity.profile === profileName) return false;

  const profileHome = path.join(home, "profiles", profileName);
  const servedNow = identity.homes.some((served) => sameHome(served, profileHome));

  if (!servedNow) {
    // The host is up but has not picked this profile up yet. Hot-serve it; there
    // is nothing to cycle, and nothing to restart.
    const added = await queryGatewayControl(home, "serve-profile", {
      name: profileName,
    });
    if (added && !added.error && added.served === profileName) return true;
    return false;
  }

  const removed = await queryGatewayControl(home, "unserve-profile", {
    name: profileName,
  });
  if (!removed || removed.error) return false;

  const added = await queryGatewayControl(home, "serve-profile", {
    name: profileName,
  });
  if (added && !added.error && added.served === profileName) return true;

  // The profile must not be left unserved. `rescan-profiles` reconciles the
  // installed `profiles/` directory and puts it back; if that also fails, the
  // caller reports an unavailable host and no gateway was stopped.
  await queryGatewayControl(home, "rescan-profiles", undefined, 10_000);
  const after = identityFrom(
    await queryGatewayControl(home, "identify", undefined, IDENTIFY_TIMEOUT_MS),
  );
  return Boolean(after && after.homes.some((served) => sameHome(served, profileHome)));
}
