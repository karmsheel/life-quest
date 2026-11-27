/**
 * The phone's own store.
 *
 * `outbox` is the drafts this phone has captured and not yet handed to the
 * studio. `meta/snapshot` is the last `GET /state` body, so the home screen has
 * a metric and a vault name to show when the studio is quit or the phone is
 * offline. Nothing here is a copy of the vault: it is a queue and one number.
 */
import type { PhoneState } from "@lifequest/vault-core/phone";

const DB_NAME = "lq-phone";
const DB_VERSION = 1;

export type OutboxState = "local" | "queued";

export type OutboxDraft = {
  clientId: string;
  text: string;
  capturedAt: string;
  captureDate: string;
  state: OutboxState;
  lastError: string | null;
};

export type CachedState = {
  at: number;
  state: PhoneState;
};

let database: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "clientId" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB refused to open"));
  });
  return database;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function store(name: "outbox" | "meta", mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function outboxAll(): Promise<OutboxDraft[]> {
  const rows = await wrap((await store("outbox", "readonly")).getAll() as IDBRequest<OutboxDraft[]>);
  return rows.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function outboxPut(draft: OutboxDraft): Promise<void> {
  await wrap((await store("outbox", "readwrite")).put(draft));
}

export async function outboxDelete(clientId: string): Promise<void> {
  await wrap((await store("outbox", "readwrite")).delete(clientId));
}

export async function cachePut(state: PhoneState): Promise<void> {
  const cached: CachedState = { at: Date.now(), state };
  await wrap((await store("meta", "readwrite")).put(cached, "snapshot"));
}

export async function cacheGet(): Promise<CachedState | null> {
  const cached = await wrap(
    (await store("meta", "readonly")).get("snapshot") as IDBRequest<CachedState | undefined>,
  );
  return cached ?? null;
}

export async function clearAll(): Promise<void> {
  await wrap((await store("outbox", "readwrite")).clear());
  await wrap((await store("meta", "readwrite")).clear());
}
