/**
 * The phone client.
 *
 * Two screens and one rule: this app queues drafts and shows one number. It
 * never posts a transaction, never renders a ledger, and never talks to the
 * companion. A draft leaves the outbox only when the studio's door has it, and
 * it becomes money only when the companion posts it after the operator confirms
 * in chat.
 *
 * Offline is a first-class state, not an error: the shell comes from the
 * service worker, the metric from the last snapshot, and the queue from
 * IndexedDB. "Waiting for your studio" is what the app says, and it is true.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PhoneState } from "@lifequest/vault-core/phone";
import { NotPaired, phoneApi } from "./api";
import {
  cacheGet,
  cachePut,
  clearAll,
  outboxAll,
  outboxDelete,
  outboxPut,
  type CachedState,
  type OutboxDraft,
  type OutboxState,
} from "./db";

type Phase = "loading" | "pair" | "home";

function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  return "Phone";
}

function money(value: number, currency: "ZAR" | "USD"): string {
  return `${currency === "ZAR" ? "R" : "$"}${value.toFixed(2)}`;
}

function ageOf(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
}

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<PhoneState | null>(null);
  const [cached, setCached] = useState<CachedState | null>(null);
  const [outbox, setOutbox] = useState<OutboxDraft[]>([]);
  const [reachable, setReachable] = useState(true);
  const [code, setCode] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);

  /**
   * Read the door's state into the app, and reconcile the outbox with it.
   *
   * The three outcomes are deliberately different: `unpaired` sends this phone
   * back to its code, `offline` keeps the cached home on screen with "waiting",
   * and `ok` is the live surface. Collapsing offline into unpaired would throw
   * a paired phone back to the pairing screen every time the studio closed.
   */
  const refresh = useCallback(async (): Promise<"ok" | "unpaired" | "offline"> => {
    try {
      const next = await phoneApi.state();
      if (!mounted.current) return "ok";
      setState(next);
      setReachable(true);
      await cachePut(next);
      const resolved = new Set(next.resolved.map((row) => row.clientId));
      const pending = new Set(next.pending.map((row) => row.clientId));
      let cleared = false;
      for (const draft of await outboxAll()) {
        if (resolved.has(draft.clientId)) {
          await outboxDelete(draft.clientId);
          cleared = true;
          continue;
        }
        const nextState: OutboxState = pending.has(draft.clientId) ? "queued" : draft.state;
        if (nextState !== draft.state || draft.lastError) {
          await outboxPut({ ...draft, state: nextState, lastError: null });
        }
      }
      if (cleared) setNotice("Posted");
      setOutbox(await outboxAll());
      return "ok";
    } catch (error) {
      if (error instanceof NotPaired) {
        setPhase("pair");
        return "unpaired";
      }
      setReachable(false);
      return "offline";
    }
  }, []);

  /** Hand every local draft to the door. A failure leaves it local. */
  const flush = useCallback(async (): Promise<void> => {
    for (const draft of (await outboxAll()).filter((row) => row.state === "local")) {
      try {
        await phoneApi.queueDraft({
          clientId: draft.clientId,
          text: draft.text,
          captureDate: draft.captureDate,
          capturedAt: draft.capturedAt,
        });
        await outboxPut({ ...draft, state: "queued", lastError: null });
      } catch (error) {
        if (error instanceof NotPaired) {
          setPhase("pair");
          return;
        }
        setReachable(false);
        await outboxPut({ ...draft, lastError: "Waiting for your studio" });
        break;
      }
    }
    if (mounted.current) setOutbox(await outboxAll());
  }, []);

  const pairWith = useCallback(
    async (value: string) => {
      const trimmed = value.trim().toUpperCase();
      if (!trimmed) return;
      setPairing(true);
      setPairError(null);
      try {
        await phoneApi.pair(trimmed, deviceName());
        const outcome = await refresh();
        setPhase(outcome === "ok" ? "home" : "pair");
        if (outcome === "ok") {
          await flush();
          await refresh();
        }
      } catch (error) {
        setPairError(error instanceof Error ? error.message : "Pairing failed");
        setPhase("pair");
      } finally {
        setPairing(false);
      }
    },
    [refresh, flush],
  );

  // Boot: read the cache and the outbox, then prove the pairing against the
  // door. A `#pair=` fragment is the QR flow: keep it out of the address bar,
  // then redeem it once.
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const snapshot = await cacheGet();
      setCached(snapshot);
      setOutbox(await outboxAll());
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("pair");
      if (fragment) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        setCode(fragment.toUpperCase());
        await pairWith(fragment);
        return;
      }
      const outcome = await refresh();
      if (!mounted.current) return;
      if (outcome === "ok") {
        setPhase("home");
        await flush();
        await refresh();
      } else if (outcome === "offline" && snapshot) {
        // A paired phone with a cache opens on its queue and its last metric.
        setPhase("home");
      } else {
        setPhase("pair");
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [pairWith, refresh, flush]);

  // While the home screen is up: sync on mount, once a minute, and whenever the
  // app comes back to the foreground. There is no background sync to lean on.
  useEffect(() => {
    if (phase !== "home") return;
    const sync = () => {
      void (async () => {
        await flush();
        await refresh();
      })();
    };
    sync();
    const timer = window.setInterval(sync, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, flush, refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const current = state ?? cached?.state ?? null;

  const rows = useMemo(() => {
    const outboxIds = new Set(outbox.map((draft) => draft.clientId));
    const server = (current?.pending ?? [])
      .filter((row) => !outboxIds.has(row.clientId))
      .map((row) => ({
        clientId: row.clientId,
        text: row.text,
        state: "queued" as OutboxState,
        meta: "Waiting for the companion",
      }));
    const local = outbox.map((draft) => ({
      clientId: draft.clientId,
      text: draft.text,
      state: draft.state,
      meta:
        draft.state === "queued"
          ? "Waiting for the companion"
          : (draft.lastError ?? "On this phone"),
    }));
    return [...local, ...server];
  }, [current, outbox]);

  async function onQueue(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    const now = new Date();
    const draft: OutboxDraft = {
      clientId: crypto.randomUUID(),
      text: value,
      capturedAt: now.toISOString(),
      captureDate: localDate(now),
      state: "local",
      lastError: null,
    };
    await outboxPut(draft);
    setOutbox(await outboxAll());
    setText("");
    await flush();
  }

  async function onWithdraw(clientId: string, rowState: OutboxState) {
    if (rowState === "queued") {
      try {
        await phoneApi.withdraw(clientId);
      } catch (error) {
        if (error instanceof NotPaired) {
          setPhase("pair");
          return;
        }
        // A draft the studio already resolved is gone on the next refresh.
      }
    }
    await outboxDelete(clientId);
    setOutbox(await outboxAll());
    await refresh();
  }

  async function onUnpair() {
    try {
      await phoneApi.unpair();
    } catch {
      // The cookie may already be gone; forgetting the local copy is still right.
    }
    await clearAll();
    setState(null);
    setCached(null);
    setOutbox([]);
    setPhase("pair");
  }

  if (phase === "loading") {
    return (
      <main className="app app--centered" data-testid="phone-loading">
        <p className="muted">Opening…</p>
      </main>
    );
  }

  if (phase === "pair") {
    return (
      <main className="app app--centered" data-testid="phone-pair">
        <header className="brand">
          <h1>LifeQuest</h1>
          <p className="muted">This phone holds a queue, not your vault.</p>
        </header>
        <form className="card" onSubmit={(event) => void (event.preventDefault(), pairWith(code))}>
          <label className="label" htmlFor="pair-code">
            Pairing code
          </label>
          <input
            id="pair-code"
            className="input input--code"
            aria-label="Pairing code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            placeholder="ABCD2345"
            disabled={pairing}
          />
          <button className="button" type="submit" disabled={pairing || code.trim().length === 0}>
            {pairing ? "Pairing…" : "Pair this phone"}
          </button>
          {pairError ? (
            <p className="error" role="alert">
              {pairError}
            </p>
          ) : null}
          <p className="hint">
            Show the code in the studio under Settings → Phone, then scan its QR
            or type the code here.
          </p>
        </form>
        {!standalone() ? (
          <p className="hint">
            Add this page to your Home Screen to keep the queue when the studio
            is closed.
          </p>
        ) : null}
      </main>
    );
  }

  const metric = current?.metric ?? null;
  const vaultName = current?.vaultName ?? "";

  return (
    <main className="app" data-testid="phone-home">
      <header className="top">
        <div>
          <h1>LifeQuest</h1>
          {vaultName ? <p className="muted">{vaultName}</p> : null}
        </div>
        <span className={`status ${reachable ? "status--up" : "status--down"}`}>
          {reachable ? "Studio reachable" : "Waiting for your studio"}
        </span>
      </header>

      {!standalone() ? (
        <p className="hint hint--install">
          Add to Home Screen to keep the queue when the studio is closed.
        </p>
      ) : null}

      <section className="card" data-testid="phone-metric">
        <p className="label">{metric?.label ?? "No metric pinned"}</p>
        {metric ? (
          <>
            <p className="metric">
              {metric.value === null ? "—" : money(metric.value, metric.currency)}
            </p>
            {metric.secondary ? (
              <p className="secondary">
                {money(metric.secondary.value, metric.secondary.currency)}
              </p>
            ) : null}
            <p className="hint">
              as of {metric.asOf} · read {ageOf(metric.computedAt)}
            </p>
            {metric.warnings.map((warning) => (
              <p className="warning" key={warning}>
                {warning}
              </p>
            ))}
          </>
        ) : (
          <p className="hint">
            {current?.metricUnavailable ??
              "Pin one in Settings → Phone on your studio."}
          </p>
        )}
      </section>

      <form className="card" onSubmit={(event) => void onQueue(event)}>
        <label className="label" htmlFor="draft">
          Queue a transaction
        </label>
        <textarea
          id="draft"
          className="input"
          aria-label="Draft a transaction"
          placeholder="R85 Pick n Pay food"
          rows={2}
          maxLength={500}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="button" type="submit" disabled={text.trim().length === 0}>
          Queue
        </button>
        <p className="hint">
          Nothing posts from the phone. The companion posts it in chat after you
          confirm.
        </p>
      </form>

      <section className="card">
        <p className="label">Waiting</p>
        {rows.length === 0 ? (
          <p className="hint">Nothing waiting.</p>
        ) : (
          rows.map((row) => (
            <div className="draft" key={row.clientId} data-testid="phone-draft">
              <div className="draft__text">
                <p>{row.text}</p>
                <p className="hint">{row.meta}</p>
              </div>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => void onWithdraw(row.clientId, row.state)}
              >
                Withdraw
              </button>
            </div>
          ))
        )}
        {notice ? (
          <p className="ok" role="status">
            {notice}
          </p>
        ) : null}
      </section>

      <footer className="foot">
        <button className="button button--quiet" type="button" onClick={() => void onUnpair()}>
          Unpair this phone
        </button>
      </footer>
    </main>
  );
}
