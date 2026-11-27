/**
 * Pairing codes and device cookies, for the phone door.
 *
 * Two secrets live here and nowhere else:
 *
 *  - the one-time code, held in memory only, single-use, five minutes by
 *    default, destroyed on success and locked for five minutes after ten failed
 *    attempts. It is never written to a vault or a log.
 *  - the device secret, 32 random bytes inside the cookie. The vault stores
 *    only its SHA-256 hash; the cookie is `HttpOnly; Secure; SameSite=Strict`,
 *    so page script cannot read it and another origin cannot send it.
 *
 * The code is 8 characters over a 32-symbol alphabet (40 bits), which is
 * plenty against a five-minute, ten-attempt window.
 */
import crypto from "node:crypto";
import { PHONE_COOKIE_NAME, type Result } from "@lifequest/vault-core";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 10;
const LOCK_MS = 5 * 60_000;
export const PAIRING_TTL_MS = 5 * 60_000;
export const DEVICE_COOKIE_MAX_AGE_S = 15_552_000;

export type PairingCodes = {
  mint(): Result<{ code: string; expiresAt: string }>;
  verify(code: string): "ok" | "bad" | "expired" | "locked";
  cancel(): void;
};

function codeOf(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createPairingCodes(options: {
  ttlMs?: number;
  now?: () => number;
} = {}): PairingCodes {
  const ttlMs = options.ttlMs ?? PAIRING_TTL_MS;
  const now = options.now ?? (() => Date.now());
  let active: { code: string; expiresAt: number } | null = null;
  let attempts = 0;
  let lockedUntil = 0;

  return {
    mint() {
      if (now() < lockedUntil) {
        return {
          ok: false,
          error: "Too many pairing attempts; try again in five minutes",
        };
      }
      const code = codeOf();
      const expiresAt = now() + ttlMs;
      active = { code, expiresAt };
      attempts = 0;
      return { ok: true, value: { code, expiresAt: new Date(expiresAt).toISOString() } };
    },

    verify(code) {
      if (now() < lockedUntil) return "locked";
      if (!active) return "bad";
      if (now() >= active.expiresAt) {
        active = null;
        return "expired";
      }
      if (sameSecret(code, active.code)) {
        active = null;
        attempts = 0;
        return "ok";
      }
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        lockedUntil = now() + LOCK_MS;
        attempts = 0;
        return "locked";
      }
      return "bad";
    },

    cancel() {
      active = null;
    },
  };
}

/** A device id and the cookie value/hash pair that belongs to it. */
export function newDeviceToken(deviceId: string): {
  cookieValue: string;
  tokenHash: string;
} {
  const secret = crypto.randomBytes(32).toString("base64url");
  return {
    cookieValue: `${deviceId}.${secret}`,
    tokenHash: sha256(secret),
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Whether this cookie is the secret that belongs to this device row. The row
 * holds only a hash; the comparison is constant-time, and an unknown or
 * malformed cookie is simply false.
 */
export function cookieMatches(
  cookieValue: string,
  device: { id: string; tokenHash: string },
): boolean {
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return false;
  const deviceId = cookieValue.slice(0, dot);
  const secret = cookieValue.slice(dot + 1);
  if (!deviceId || !secret || deviceId !== device.id) return false;
  return sameSecret(sha256(secret), device.tokenHash);
}

/** The value of one cookie from a request's `Cookie` header, or null. */
export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return null;
}

export function deviceCookie(value: string, maxAgeSeconds = DEVICE_COOKIE_MAX_AGE_S): string {
  return `${PHONE_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearedDeviceCookie(): string {
  return deviceCookie("", 0);
}
