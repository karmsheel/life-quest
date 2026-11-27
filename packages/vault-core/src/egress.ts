/**
 * The one place the vault is allowed to make an outbound request on behalf of
 * stored content.
 *
 * Two callers: a script block's `fetches` (operator-authored or agent-written)
 * and the finance FX refresh (whose URL comes from the vault's own
 * `registry.json`, i.e. from a file an attacker may control). Both are classic
 * SSRF surfaces, so the rules live here, once:
 *
 *  - https only, no credentials in the URL, no non-ASCII host tricks;
 *  - resolve the host and refuse loopback, private, link-local, CGNAT,
 *    multicast, unspecified, ULA, IPv4-mapped/6to4/NAT64-embedded forms and the
 *    cloud metadata range — checked against EVERY address the name resolves to;
 *  - follow redirects manually (max 3) and re-run the whole check on every hop,
 *    so an https URL cannot bounce the request to `http://127.0.0.1`;
 *  - one wall-clock budget for the whole chain, and the body is streamed under a
 *    byte cap instead of being buffered and then sliced.
 *
 * Residual risk, deliberately documented rather than hidden: DNS is resolved
 * here and again by `fetch`, so a name whose answer changes between the two
 * lookups (classic rebinding) can still point at an address this check never
 * saw. Closing that needs a pinned `undici` dispatcher; the redirect and
 * address checks above still stop the trivial forms of the attack.
 */
import dns from "node:dns/promises";
import net from "node:net";

export const EGRESS_TIMEOUT_MS = 5_000;
export const EGRESS_MAX_BODY_BYTES = 64 * 1024;
export const EGRESS_MAX_REDIRECTS = 3;

export class EgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressError";
  }
}

/** Hostnames that only ever mean "this machine" or a private namespace. */
const PRIVATE_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

function ipv4Blocked(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // unparseable: fail closed
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a === 192 && b === 88) return true; // 6to4 relay anycast
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 literal into 8 hextets (null when it is not one). */
function ipv6Hextets(address: string): number[] | null {
  const withoutZone = address.split("%")[0] ?? address;
  if (net.isIP(withoutZone) !== 6) return null;
  let text = withoutZone;
  const v4Tail = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const octets = (v4Tail[2] ?? "").split(".").map((p) => Number(p));
    if (octets.length !== 4 || octets.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    text = `${v4Tail[1]}${hi}:${lo}`;
  }
  const [head = "", tail = ""] = text.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const fill = 8 - headParts.length - tailParts.length;
  if (fill < 0) return null;
  const groups = [...headParts, ...Array.from({ length: fill }, () => "0"), ...tailParts].map(
    (group) => Number.parseInt(group || "0", 16),
  );
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) {
    return null;
  }
  return groups;
}

function embeddedV4(groups: number[]): string {
  const last = groups.slice(6);
  return last.map((g) => `${g >> 8}.${g & 0xff}`).join(".");
}

function ipv6Blocked(address: string): boolean {
  const groups = ipv6Hextets(address);
  if (!groups) return true; // fail closed
  const [g0, g1, g2, g3, g4, g5] = groups as [number, number, number, number, number, number, number, number];

  const allZeroExceptLast = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (allZeroExceptLast && groups[6] === 0 && groups[7] === 0) return true; // ::
  if (allZeroExceptLast && groups[6] === 0 && groups[7] === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2001 && g1 === 0x0000) return true; // Teredo
  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 carry a v4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return ipv4Blocked(embeddedV4(groups));
  }
  if (g0 === 0x0064 && g1 === 0xff9b) return true; // NAT64 64:ff9b::/96
  if (g0 === 0x2002) return true; // 6to4 2002::/16 embeds an arbitrary v4
  return false;
}

/** True when the address is one we never egress to. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return ipv4Blocked(address);
  if (family === 6) return ipv6Blocked(address);
  return true; // not an IP: fail closed
}

/**
 * Syntax + address-family validation for a URL the operator typed. No DNS is
 * performed here (that would make saving a source a network call); the literal
 * forms and obviously-private hostnames are refused, and the fetch path repeats
 * the full check including resolution.
 */
export function assertAllowedHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressError(`Not a URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new EgressError(`Only https is allowed: ${raw}`);
  }
  if (url.username || url.password) {
    throw new EgressError(`URL must not carry credentials: ${raw}`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) throw new EgressError(`URL has no host: ${raw}`);
  if (hostname === "localhost" || PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new EgressError(`Refusing a private hostname: ${hostname}`);
  }
  if (net.isIP(hostname) && isBlockedAddress(hostname)) {
    throw new EgressError(`Refusing a private address: ${hostname}`);
  }
  return url;
}

/** Resolve the host and refuse if ANY answer is a non-public address. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  const url = assertAllowedHttpsUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return url; // literal already checked above
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new EgressError(`Could not resolve host: ${hostname}`);
  }
  if (addresses.length === 0) throw new EgressError(`Could not resolve host: ${hostname}`);
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) {
      throw new EgressError(`Refusing a private address for ${hostname}`);
    }
  }
  return url;
}

async function readCappedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const room = maxBytes - total;
      const take = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(take);
      total += take.byteLength;
      if (take.byteLength < value.byteLength) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed or errored; nothing to release.
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export type EgressFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /**
   * Test-only escape hatch. Production callers never set it; a request to a
   * loopback/private address (or over plain http) is refused without it. It is
   * not reachable through IPC, so a renderer or paired agent cannot ask for it.
   */
  allowPrivateNetwork?: boolean;
};

export type EgressFetchResult = {
  status: number;
  body: string;
  url: string;
};

/**
 * Fetch a URL under the rules above. Redirects are walked here, not by `fetch`,
 * and the byte cap is applied while streaming.
 */
export async function fetchPublicText(
  rawUrl: string,
  options: EgressFetchOptions = {},
): Promise<EgressFetchResult> {
  const timeoutMs = options.timeoutMs ?? EGRESS_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? EGRESS_MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? EGRESS_MAX_REDIRECTS;
  const privateAllowed = options.allowPrivateNetwork === true;
  const deadline = AbortSignal.timeout(timeoutMs);

  let current = privateAllowed ? new URL(rawUrl) : await assertPublicHttpsUrl(rawUrl);

  for (let hop = 0; ; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: deadline,
        headers: { accept: "text/plain, application/json;q=0.9, */*;q=0.8" },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new EgressError(
        /abort|timed out|timeout/i.test(message)
          ? `${current.toString()} did not answer within ${Math.round(timeoutMs / 1000)}s`
          : `${current.toString()} could not be reached: ${message}`,
      );
    }

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      try {
        await response.body?.cancel();
      } catch {
        // The redirect body is discarded; nothing to release.
      }
      if (!location) {
        throw new EgressError(`${current.toString()} answered ${response.status} without a location`);
      }
      if (hop >= maxRedirects) {
        throw new EgressError(`${rawUrl} redirected more than ${maxRedirects} times`);
      }
      const next = new URL(location, current);
      current = privateAllowed ? next : await assertPublicHttpsUrl(next.toString());
      continue;
    }

    const body = await readCappedBody(response, maxBytes);
    return { status: response.status, body, url: current.toString() };
  }
}
