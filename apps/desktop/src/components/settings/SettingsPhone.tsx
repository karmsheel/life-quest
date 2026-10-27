import { useCallback, useEffect, useMemo, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { api } from "@/lib/ipc";
import type { PhonePairingView, PhoneStateView } from "@/vite-env";

const METRIC_OPTIONS = [
  { value: "", label: "No metric" },
  { value: "net_worth", label: "Net worth" },
  { value: "month_spend", label: "Spent this month" },
  { value: "month_income", label: "Received this month" },
] as const;

type PhoneMetric = "net_worth" | "month_spend" | "month_income";

function secondsLeft(expiresAt: string, now: number): number {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

function shortDate(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown";
  return new Date(at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Settings → Phone.
 *
 * Three controls, and the reason each exists:
 *
 *  - **Phone access** binds the loopback door. It is off by default, and the
 *    panel says when it could not bind rather than pretending it is serving.
 *  - **Phone address** is the https origin the phone will reach; without it a
 *    pairing code would be a code nobody can redeem, so the pair button stays
 *    disabled until it is set. The app never configures the tunnel itself.
 *  - **Pinned metric** is the one number the phone may show. It lives in the
 *    vault, so a second phone sees the same number; the phone cannot browse the
 *    ledger to change it.
 */
export function SettingsPhone() {
  const [state, setState] = useState<PhoneStateView | null>(null);
  const [originDraft, setOriginDraft] = useState("");
  const [pairing, setPairing] = useState<PhonePairingView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await api().phone.state();
    setState(next);
    setOriginDraft((current) => (current === "" ? (next.publicOrigin ?? "") : current));
  }, []);

  useEffect(() => {
    void refresh();
    return api().phone.onChanged(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  const remaining = useMemo(
    () => (pairing ? secondsLeft(pairing.expiresAt, now) : 0),
    [pairing, now],
  );

  useEffect(() => {
    if (pairing && remaining <= 0) setPairing(null);
  }, [pairing, remaining]);

  if (!state) {
    return <p className="muted">Loading phone access…</p>;
  }

  async function onToggleAccess(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      const next = await api().phone.setEnabled(enabled);
      setState(next);
      if (!enabled) setPairing(null);
      if (enabled && next.error) setError(next.error);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveAddress() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api().phone.setPublicOrigin(originDraft);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setState(saved.value);
      setPairing(null);
    } finally {
      setBusy(false);
    }
  }

  async function onPair() {
    setBusy(true);
    setError(null);
    try {
      const started = await api().phone.pairingStart();
      if (!started.ok) {
        setError(started.error);
        return;
      }
      setNow(Date.now());
      setPairing(started.value);
    } finally {
      setBusy(false);
    }
  }

  async function onCancelPair() {
    await api().phone.pairingCancel();
    setPairing(null);
  }

  async function onMetric(value: string) {
    setError(null);
    const metric = (value || null) as PhoneMetric | null;
    const saved = await api().phone.setMetric(metric);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    await refresh();
  }

  async function onForget(id: string) {
    setBusy(true);
    setError(null);
    try {
      const revoked = await api().phone.revokeDevice(id);
      if (!revoked.ok) {
        setError(revoked.error);
        return;
      }
      setState(revoked.value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      icon={<Smartphone size={18} aria-hidden />}
      title="Phone"
      subtitle="A draft queue and one pinned metric on your phone. The companion still posts the transaction from chat."
    >
      <SettingsRow
        label="Phone access"
        description="Serve the phone client from this machine on 127.0.0.1:8647. It is reachable only through the tunnel you expose it on."
        action={
          <input
            type="checkbox"
            aria-label="Phone access"
            checked={state.enabled}
            disabled={busy}
            onChange={(event) => void onToggleAccess(event.target.checked)}
          />
        }
      />

      {state.enabled ? (
        <div className="settings-hermes">
          <div className="settings-field">
            <span>Door</span>
            <p className="muted" role="status">
              {state.doorUrl || "Not listening"}
            </p>
            {state.error ? (
              <p className="form-error" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>

          <div className="settings-field">
            <span>Phone address</span>
            <input
              type="url"
              aria-label="Phone address"
              placeholder="https://studio.tailnet.ts.net"
              value={originDraft}
              onChange={(event) => setOriginDraft(event.target.value)}
            />
            <p className="settings-card__desc">
              The https address your phone reaches this door on. Expose it with{" "}
              <code>tailscale serve --bg http://127.0.0.1:8647</code>; never{" "}
              <code>tailscale funnel</code>, which publishes to the internet.
            </p>
            <div className="settings-hermes__actions">
              <Button
                variant="outline"
                disabled={busy || !originDraft.trim()}
                onClick={() => void onSaveAddress()}
              >
                Save address
              </Button>
              <Button
                variant="primary"
                disabled={busy || !state.publicOrigin}
                onClick={() => void onPair()}
              >
                Pair a phone
              </Button>
            </div>
          </div>

          {pairing ? (
            <div className="settings-field">
              <span>Pairing code</span>
              <p>
                <code>{pairing.code}</code> · expires in {remaining}s
              </p>
              {pairing.qrDataUrl ? (
                <img
                  src={pairing.qrDataUrl}
                  alt="Pairing QR code"
                  width={192}
                  height={192}
                />
              ) : null}
              <p className="settings-card__desc">
                Scan the code with the phone's camera, or open{" "}
                <code>{pairing.link}</code>.
              </p>
              <div className="settings-hermes__actions">
                <Button variant="outline" onClick={() => void onCancelPair()}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <div className="settings-field">
            <span>Pinned metric</span>
            <select
              aria-label="Pinned metric"
              value={state.metric ?? ""}
              onChange={(event) => void onMetric(event.target.value)}
            >
              {METRIC_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="settings-card__desc">
              The phone shows one number and its age. It cannot open the ledger.
            </p>
          </div>

          <div className="settings-field">
            <span>Paired phones</span>
            {state.devices.length === 0 ? (
              <p className="muted">No phone paired yet.</p>
            ) : (
              state.devices.map((device) => (
                <div key={device.id} className="settings-card__row">
                  <div className="settings-card__copy">
                    <div className="settings-card__label">{device.name}</div>
                    <p className="settings-card__desc">
                      paired {shortDate(device.createdAt)} · last seen{" "}
                      {shortDate(device.lastSeenAt)}
                    </p>
                  </div>
                  <div className="settings-card__control">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void onForget(device.id)}
                    >
                      Forget
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="muted">
          Turn phone access on to pair a phone. Nothing listens while it is off.
        </p>
      )}
    </SettingsSection>
  );
}
