/**
 * The phone door: a small HTTP surface for one phone, one vault, one pinned
 * metric, and a draft queue — and nothing else.
 *
 * Why this is not MCP and not the pairing doors: the companion's doors speak
 * tools and grants to agents. The phone is not an agent. It may queue a draft
 * and read one number; it may not read a ledger row, a document, a database, a
 * page, or a chat message, and it may never post a transaction. The route table
 * below is the whole product surface, so the absence of a "read anything" route
 * is a property of the design rather than a promise in a comment.
 *
 * The door binds loopback only. TLS, the tailnet, and the certificate are the
 * operator's tunnel; this process refuses to pretend it can serve the internet.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  PHONE_API_PREFIX,
  PHONE_APP_PREFIX,
  PHONE_COOKIE_NAME,
  PHONE_DRAFT_MAX_TEXT,
  PHONE_HOST,
  PHONE_PENDING_CAP,
  PHONE_PORT,
  addPhoneDevice,
  isClientId,
  isIsoDate,
  listPhoneDrafts,
  phoneMetric,
  queuePhoneDraft,
  readPhoneDevices,
  readPhoneSettings,
  removePhoneDevice,
  touchPhoneDevice,
  withdrawPhoneDraft,
  type PhoneDevice,
  type PhoneDraft,
  type PhoneState,
  type Result,
} from "@lifequest/vault-core";
import {
  clearedDeviceCookie,
  cookieMatches,
  cookieValue,
  createPairingCodes,
  deviceCookie,
  newDeviceToken,
} from "./phone-pairing.ts";

const MAX_BODY_BYTES = 16 * 1024;
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; manifest-src 'self'; worker-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

export type PhoneDoorOptions = {
  root: string;
  vaultName: string | (() => string);
  staticDir: string;
  port?: number;
  host?: string;
  /** The https origin the operator will reach this door on; CSRF compares it. */
  publicOrigin: string;
  pairingTtlMs?: number;
  /** Called when a draft arrives or is withdrawn, so the desktop can refresh. */
  onQueueChanged?: () => void;
};

export type PhoneDoor = {
  port: number;
  url: string;
  mintPairingCode(): Result<{ code: string; expiresAt: string }>;
  cancelPairingCode(): void;
  revokeDevice(id: string): Promise<Result<{ removed: boolean }>>;
  close(): Promise<void>;
};

type JsonBody = { ok: true; value: unknown } | { ok: false; error: "malformed" | "too_large" };

async function readJsonBody(req: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) return { ok: false, error: "too_large" };
    chunks.push(buf);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, error: "malformed" };
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(text);
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { "Cache-Control": "no-store" });
  res.end();
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function publicDraft(draft: PhoneDraft) {
  return {
    clientId: draft.clientId,
    text: draft.text,
    captureDate: draft.captureDate,
    captureDateClamped: draft.captureDateClamped,
    capturedAt: draft.capturedAt,
    receivedAt: draft.receivedAt,
    status: draft.status,
    rowId: draft.rowId,
    receipt: draft.receipt,
    resolvedAt: draft.resolvedAt,
  };
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

export async function createPhoneDoor(
  options: PhoneDoorOptions,
): Promise<Result<PhoneDoor>> {
  const host = options.host ?? PHONE_HOST;
  const staticRoot = path.resolve(options.staticDir);
  const publicOrigin = normalizeOrigin(options.publicOrigin);
  const setVaultName = () =>
    typeof options.vaultName === "function" ? options.vaultName() : options.vaultName;
  const pairing = createPairingCodes({ ttlMs: options.pairingTtlMs });
  let boundPort = options.port ?? PHONE_PORT;

  const originAllowed = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    return publicOrigin.length > 0 && typeof origin === "string" && origin === publicOrigin;
  };

  const isJson = (req: IncomingMessage): boolean =>
    typeof req.headers["content-type"] === "string" &&
    req.headers["content-type"].split(";")[0]!.trim().toLowerCase() === "application/json";

  async function authenticate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<PhoneDevice | null> {
    const value = cookieValue(req.headers.cookie, PHONE_COOKIE_NAME);
    if (!value) {
      sendJson(res, 401, { error: "unauthorized" });
      return null;
    }
    const devices = await readPhoneDevices(options.root);
    if (!devices.ok) {
      sendJson(res, 500, { error: "internal" });
      return null;
    }
    const device = devices.value.find((row) => cookieMatches(value, row));
    if (!device) {
      sendJson(res, 401, { error: "unauthorized" });
      return null;
    }
    await touchPhoneDevice(options.root, device.id);
    return device;
  }

  async function hello(res: ServerResponse): Promise<void> {
    sendJson(res, 200, {
      apiVersion: 1,
      vaultName: setVaultName(),
      serverTime: new Date().toISOString(),
    });
  }

  async function pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    if (!body.ok) {
      sendJson(res, body.error === "too_large" ? 413 : 400, { error: "malformed" });
      return;
    }
    const raw = body.value as { code?: unknown; deviceName?: unknown };
    const code = typeof raw?.code === "string" ? raw.code.trim().toUpperCase() : "";
    const name = typeof raw?.deviceName === "string" ? raw.deviceName : "Phone";
    const verdict = pairing.verify(code);
    if (verdict === "locked") {
      sendJson(res, 429, { error: "rate_limited" });
      return;
    }
    if (verdict !== "ok") {
      sendJson(res, 401, { error: "bad_code" });
      return;
    }
    const deviceId = randomUUID();
    const token = newDeviceToken(deviceId);
    const added = await addPhoneDevice(options.root, {
      id: deviceId,
      name,
      tokenHash: token.tokenHash,
    });
    if (!added.ok) {
      sendJson(res, added.error.startsWith("too_many_devices") ? 409 : 500, {
        error: added.error.startsWith("too_many_devices") ? "too_many_devices" : "internal",
      });
      return;
    }
    sendJson(
      res,
      200,
      {
        deviceId: added.value.id,
        deviceName: added.value.name,
        vaultName: setVaultName(),
        serverTime: new Date().toISOString(),
      },
      { "Set-Cookie": deviceCookie(token.cookieValue) },
    );
  }

  async function state(res: ServerResponse, device: PhoneDevice): Promise<void> {
    const settings = await readPhoneSettings(options.root);
    const metricId = settings.ok ? settings.value.metric : null;
    const metricRes = await phoneMetric(options.root, metricId);
    const pending = await listPhoneDrafts(options.root, {
      deviceId: device.id,
      status: "pending",
    });
    const all = await listPhoneDrafts(options.root, { deviceId: device.id });
    const resolved = all.ok
      ? all.value.drafts
          .filter((draft) => draft.status !== "pending")
          .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""))
          .slice(0, 50)
          .map((draft) => ({
            clientId: draft.clientId,
            status: draft.status as "posted" | "dismissed",
            resolvedAt: draft.resolvedAt ?? "",
            receipt: draft.receipt,
          }))
      : [];
    const body: PhoneState = {
      apiVersion: 1,
      vaultName: setVaultName(),
      serverTime: new Date().toISOString(),
      device: { id: device.id, name: device.name },
      metric: metricRes.ok ? metricRes.value : null,
      metricUnavailable: metricRes.ok ? null : metricRes.error,
      pending: pending.ok
        ? pending.value.drafts.map((draft) => ({
            clientId: draft.clientId,
            text: draft.text,
            captureDate: draft.captureDate,
            capturedAt: draft.capturedAt,
            receivedAt: draft.receivedAt,
          }))
        : [],
      resolved,
      limits: { pending: PHONE_PENDING_CAP, text: PHONE_DRAFT_MAX_TEXT },
    };
    sendJson(res, 200, body);
  }

  async function queue(req: IncomingMessage, res: ServerResponse, device: PhoneDevice): Promise<void> {
    const body = await readJsonBody(req);
    if (!body.ok) {
      sendJson(res, body.error === "too_large" ? 413 : 400, { error: "malformed" });
      return;
    }
    const raw = body.value as {
      clientId?: unknown;
      text?: unknown;
      captureDate?: unknown;
      capturedAt?: unknown;
    };
    if (
      typeof raw?.clientId !== "string" ||
      !isClientId(raw.clientId) ||
      typeof raw.text !== "string" ||
      raw.text.trim().length === 0 ||
      raw.text.length > PHONE_DRAFT_MAX_TEXT ||
      typeof raw.captureDate !== "string" ||
      !isIsoDate(raw.captureDate)
    ) {
      sendJson(res, 400, { error: "malformed" });
      return;
    }
    const capturedAt =
      typeof raw.capturedAt === "string" ? raw.capturedAt : new Date().toISOString();
    const queued = await queuePhoneDraft(
      options.root,
      {
        clientId: raw.clientId,
        deviceId: device.id,
        deviceName: device.name,
        text: raw.text,
        captureDate: raw.captureDate,
        capturedAt,
      },
      new Date().toISOString(),
    );
    if (!queued.ok) {
      sendJson(res, /full/i.test(queued.error) ? 409 : 400, {
        error: /full/i.test(queued.error) ? "queue_full" : "malformed",
        message: queued.error,
      });
      return;
    }
    if (queued.value.created) options.onQueueChanged?.();
    if (queued.value.draft.status !== "pending") {
      sendJson(res, 409, {
        error: "already_resolved",
        status: queued.value.draft.status,
        rowId: queued.value.draft.rowId,
        receipt: queued.value.draft.receipt,
      });
      return;
    }
    sendJson(res, queued.value.created ? 201 : 200, {
      draft: publicDraft(queued.value.draft),
    });
  }

  async function withdraw(
    res: ServerResponse,
    device: PhoneDevice,
    clientId: string,
  ): Promise<void> {
    const withdrawn = await withdrawPhoneDraft(options.root, clientId, device.id);
    if (!withdrawn.ok) {
      const resolved = /^already_resolved:/.exec(withdrawn.error);
      if (resolved) {
        sendJson(res, 409, {
          error: "already_resolved",
          status: resolved[1] ?? "posted",
        });
      } else {
        sendJson(res, 404, { error: "not_found" });
      }
      return;
    }
    options.onQueueChanged?.();
    sendJson(res, 200, { draft: publicDraft(withdrawn.value.draft) });
  }

  async function unpair(res: ServerResponse, device: PhoneDevice): Promise<void> {
    await removePhoneDevice(options.root, device.id);
    sendJson(
      res,
      200,
      { unpaired: true },
      { "Set-Cookie": clearedDeviceCookie() },
    );
  }

  async function serveApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const route = pathname.slice(PHONE_API_PREFIX.length);
    if (method === "OPTIONS") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    if (method === "GET" && route === "/hello") {
      await hello(res);
      return;
    }
    if (method === "POST") {
      if (!originAllowed(req)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      if (!isJson(req)) {
        sendJson(res, 415, { error: "unsupported_media_type" });
        return;
      }
      if (route === "/pair") {
        await pair(req, res);
        return;
      }
    }
    if (method !== "GET" && method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    const device = await authenticate(req, res);
    if (!device) return;
    if (method === "GET" && route === "/state") {
      await state(res, device);
      return;
    }
    if (method === "POST" && route === "/drafts") {
      await queue(req, res, device);
      return;
    }
    const withdrawMatch = /^\/drafts\/([^/]+)\/withdraw$/.exec(route);
    if (method === "POST" && withdrawMatch) {
      let clientId: string;
      try {
        clientId = decodeURIComponent(withdrawMatch[1]!);
      } catch {
        sendJson(res, 400, { error: "malformed" });
        return;
      }
      await withdraw(res, device, clientId);
      return;
    }
    if (method === "POST" && route === "/unpair") {
      await unpair(res, device);
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  }

  async function serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      sendEmpty(res, 405);
      return;
    }
    const rel = pathname.slice(PHONE_APP_PREFIX.length) || "index.html";
    const file = path.resolve(staticRoot, rel);
    if (file !== staticRoot && !file.startsWith(staticRoot + path.sep)) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    if (!stat.isFile()) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const cache =
      rel === "index.html" || rel === "sw.js"
        ? "no-store"
        : rel.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600";
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(ext === ".html" ? { "Content-Security-Policy": CSP } : {}),
    });
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(await fs.readFile(file));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
      } catch {
        sendJson(res, 400, { error: "malformed" });
        return;
      }
      if (pathname === "/" || pathname === PHONE_APP_PREFIX.slice(0, -1)) {
        redirect(res, PHONE_APP_PREFIX);
        return;
      }
      if (pathname.startsWith(PHONE_APP_PREFIX)) {
        await serveStatic(req, res, pathname);
        return;
      }
      if (pathname === PHONE_API_PREFIX || pathname.startsWith(`${PHONE_API_PREFIX}/`)) {
        await serveApi(req, res, pathname);
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      console.error("[phone-door]", error instanceof Error ? error.message : error);
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      else res.end();
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  const listened = await new Promise<Result<number>>((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        error:
          error.code === "EADDRINUSE"
            ? `Port ${boundPort} is already in use`
            : `The phone door could not bind: ${error.message}`,
      });
    };
    server.once("error", onError);
    server.listen(boundPort, host, () => {
      server.off("error", onError);
      const address = server.address();
      resolve({
        ok: true,
        value: typeof address === "object" && address !== null ? address.port : boundPort,
      });
    });
  });
  if (!listened.ok) return listened;
  boundPort = listened.value;

  return {
    ok: true,
    value: {
      port: boundPort,
      url: `http://${host}:${boundPort}`,
      mintPairingCode: () => pairing.mint(),
      cancelPairingCode: () => pairing.cancel(),
      revokeDevice: (id: string) => removePhoneDevice(options.root, id),
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    },
  };
}
