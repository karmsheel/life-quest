/**
 * The phone client's wire contract and its pure rules.
 *
 * Deliberately browser-safe: the phone app, the loopback door, and the desktop
 * all import from this module, so it must never reach `node:fs`,
 * `node:crypto`, or Electron. Vault reads and writes live beside it in
 * `phone-queue.ts`; the money lives in `phone-metric.ts`.
 *
 * The one rule the whole feature rests on: a draft is not a transaction. This
 * module describes a draft and can say whether it is well-formed; only the
 * companion, through `post_phone_draft`, can turn one into a row.
 */

import { isCalendarDate } from "./calendar-date.ts";

export const PHONE_METRIC_IDS = [
  "net_worth",
  "month_spend",
  "month_income",
] as const;
export type PhoneMetricId = (typeof PHONE_METRIC_IDS)[number];

export const PHONE_DRAFT_MAX_TEXT = 500;
export const PHONE_PENDING_CAP = 100;
export const PHONE_MAX_DEVICES = 4;
export const PHONE_RESOLVED_RETENTION_DAYS = 365;
export const PHONE_CAPTURE_CLAMP_DAYS = 7;
export const PHONE_COOKIE_NAME = "lq_phone";
export const PHONE_PORT = 8647;
export const PHONE_HOST = "127.0.0.1";
export const PHONE_API_PREFIX = "/api/phone";
export const PHONE_APP_PREFIX = "/phone/";
/** A rig or a packaged build may point the door at a different directory. */
export const PHONE_APP_DIR_ENV = "LIFEQUEST_PHONE_DIR";

export type PhoneDraftStatus = "pending" | "posted" | "dismissed";
export type PhoneCurrency = "ZAR" | "USD";

/**
 * One queued draft, exactly as it sits on disk.
 *
 * `clientId` is the phone's UUID and the file name; it is also the idempotency
 * key, so a retried POST can never produce a second draft. `captureDate` is the
 * phone's local calendar day at capture time, already clamped by the vault.
 */
export type PhoneDraft = {
  schemaVersion: 1;
  clientId: string;
  deviceId: string;
  deviceName: string;
  text: string;
  captureDate: string;
  captureDateClamped: boolean;
  capturedAt: string;
  receivedAt: string;
  status: PhoneDraftStatus;
  rowId: string | null;
  receipt: string | null;
  resolvedAt: string | null;
};

export type PhoneSettings = {
  schemaVersion: 1;
  metric: PhoneMetricId | null;
};

/**
 * A paired phone. The plaintext secret exists only in the phone's cookie; this
 * record holds its SHA-256 hash, the same "no secrets here" posture as the
 * connected-agent roster.
 */
export type PhoneDevice = {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
};

/**
 * The one number the phone may show.
 *
 * `value` is null when the vault cannot tell the truth with one number (two
 * currencies and no rate). `secondary` is the other currency when the vault can
 * name both but not convert between them. `asOf` is the vault's date;
 * `computedAt` is when the desktop read it; the phone shows the age.
 */
export type PhoneMetricSnapshot = {
  id: PhoneMetricId;
  label: string;
  value: number | null;
  currency: PhoneCurrency;
  secondary: { currency: PhoneCurrency; value: number } | null;
  periodLabel: string;
  asOf: string;
  computedAt: string;
  warnings: string[];
};

/** The entire body `GET /api/phone/state` returns. Nothing else may be added. */
export type PhoneState = {
  apiVersion: 1;
  vaultName: string;
  serverTime: string;
  device: { id: string; name: string };
  metric: PhoneMetricSnapshot | null;
  metricUnavailable: string | null;
  pending: Array<{
    clientId: string;
    text: string;
    captureDate: string;
    capturedAt: string;
    receivedAt: string;
  }>;
  resolved: Array<{
    clientId: string;
    status: "posted" | "dismissed";
    resolvedAt: string;
    receipt: string | null;
  }>;
  limits: { pending: number; text: number };
};

const CLIENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MS_PER_DAY = 86_400_000;

export function isPhoneMetricId(value: unknown): value is PhoneMetricId {
  return (
    typeof value === "string" &&
    (PHONE_METRIC_IDS as readonly string[]).includes(value)
  );
}

export function isClientId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_ID.test(value);
}

/** A real calendar date in `YYYY-MM-DD`, not merely the right shape. */
export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && isCalendarDate(value);
}

/**
 * Trim, strip control characters except a newline, and enforce the length.
 * Null means "not a draft": the caller refuses it and nothing is written.
 */
export function normalizeDraftText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();
  if (cleaned.length === 0 || cleaned.length > PHONE_DRAFT_MAX_TEXT) return null;
  return cleaned;
}

function utcDay(date: string): number | null {
  if (!isIsoDate(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

/**
 * Keep a phone's date inside the week before the desktop's today.
 *
 * The phone may be in another timezone or have a wrong clock; a draft must not
 * post a transaction in 2019 because of it. A date after today is clamped down
 * to today, not accepted as the future.
 */
export function clampCaptureDate(
  phoneDate: unknown,
  serverToday: string,
): { date: string; clamped: boolean } {
  const fallback = isIsoDate(serverToday)
    ? serverToday
    : new Date().toISOString().slice(0, 10);
  const phone = utcDay(typeof phoneDate === "string" ? phoneDate : "");
  const today = utcDay(fallback);
  if (phone === null || today === null) return { date: fallback, clamped: true };
  const earliest = today - PHONE_CAPTURE_CLAMP_DAYS * MS_PER_DAY;
  if (phone < earliest || phone > today) return { date: fallback, clamped: true };
  return { date: phoneDate as string, clamped: false };
}
