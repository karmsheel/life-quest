/**
 * The phone's only door.
 *
 * Relative URLs, same origin, `credentials: same-origin`: the device cookie is
 * `HttpOnly` and set by the door, so nothing here ever handles a token. A 401
 * is not an ordinary error — it means this phone is not paired any more, and
 * the app must say so rather than showing an empty queue.
 */
import type { PhoneState } from "@lifequest/vault-core/phone";

export class NotPaired extends Error {
  constructor() {
    super("This phone is no longer paired");
    this.name = "NotPaired";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const res = await fetch(`/api/phone${path}`, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  if (res.status === 401) throw new NotPaired();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(body?.message ?? body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export type Hello = {
  apiVersion: number;
  vaultName: string;
  serverTime: string;
};

export type QueueDraftInput = {
  clientId: string;
  text: string;
  captureDate: string;
  capturedAt: string;
};

export const phoneApi = {
  hello: () => request<Hello>("/hello"),

  state: () => request<PhoneState>("/state"),

  pair: (code: string, deviceName: string) =>
    request<{ deviceId: string; deviceName: string; vaultName: string }>("/pair", {
      method: "POST",
      body: JSON.stringify({ code, deviceName }),
    }),

  /** Queue a draft. No transaction is created by this call. */
  queueDraft: (input: QueueDraftInput) =>
    request<{ draft: { clientId: string; status: string } }>("/drafts", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  withdraw: (clientId: string) =>
    request<{ draft: unknown }>(
      `/drafts/${encodeURIComponent(clientId)}/withdraw`,
      { method: "POST", body: "{}" },
    ),

  unpair: () => request<{ unpaired: true }>("/unpair", { method: "POST", body: "{}" }),
};
