import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import { Button } from "@/components/ui/Button";

/**
 * The USD→ZAR rate source, as a control the operator owns.
 *
 * The rate is the one number in the finance kit that cannot be derived from
 * anything in the vault, so it comes from a URL — and a URL the operator cannot
 * see or change is a rate they cannot trust. Three fields describe a source
 * completely: where it is, where in its answer the rate sits, and where (if
 * anywhere) it dates itself. The rest of the panel is what the last read said,
 * which is what tells a source that is WRONG apart from one that is merely slow.
 *
 * It reads its own settings rather than taking them as props, so the panel is the
 * whole feature: a caller renders it and the database and settings questions are
 * already answered.
 */

type FxState = {
  url: string;
  path: string;
  asOfPath: string;
  rate: number | null;
  asOf: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
};

/** What the refresh reply carries, narrowed to what this panel shows. */
type RefreshReply = {
  refreshed?: boolean;
  rate?: number | null;
  asOf?: string | null;
  settings?: {
    fxSource?: { lastError?: string | null; lastFetchedAt?: string | null };
  };
};

const EMPTY: FxState = {
  url: "",
  path: "",
  asOfPath: "",
  rate: null,
  asOf: null,
  lastFetchedAt: null,
  lastError: null,
};

export function FxRatePanel() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [fx, setFx] = useState<FxState>(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const kitRes = await api().kitList("financial");
    const hasKit = kitRes.ok && (kitRes.value as string[]).includes("finance");
    setInstalled(hasKit);
    if (!hasKit) return;
    const res = await api().kitFinanceSettings();
    if (!res.ok || !res.value) return;
    const settings = res.value as {
      usdZarRate?: number | null;
      usdZarAsOf?: string | null;
      fxSource?: {
        url?: string;
        path?: string;
        asOfPath?: string | null;
        lastFetchedAt?: string | null;
        lastError?: string | null;
      } | null;
    };
    const source = settings.fxSource ?? null;
    setFx({
      // The main process resolves an unset source to the default before it gets
      // here, so these are the fields in force rather than blanks.
      url: source?.url ?? "",
      path: source?.path ?? "rates.ZAR",
      asOfPath: source?.asOfPath ?? "",
      rate: settings.usdZarRate ?? null,
      asOf: settings.usdZarAsOf ?? null,
      lastFetchedAt: source?.lastFetchedAt ?? null,
      lastError: source?.lastError ?? null,
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fold one refresh reply into the panel's state, and say what happened. */
  function absorb(reply: RefreshReply, whenRefused: string) {
    setFx((f) => ({
      ...f,
      rate: reply.rate ?? f.rate,
      asOf: reply.asOf ?? f.asOf,
      lastFetchedAt: reply.settings?.fxSource?.lastFetchedAt ?? f.lastFetchedAt,
      lastError: reply.settings?.fxSource?.lastError ?? null,
    }));
    setStatus(
      reply.refreshed
        ? `Read ${reply.rate} ZAR per USD${reply.asOf ? ` as of ${reply.asOf}` : ""}.`
        : `${whenRefused}: ${reply.settings?.fxSource?.lastError ?? "no reason given"}`,
    );
  }

  async function readNow(whenRefused: string) {
    const read = await api().fxRefresh();
    if (!read.ok) {
      setError(read.error);
      return;
    }
    absorb(read.value as RefreshReply, whenRefused);
  }

  if (!installed) return null;

  return (
    <section className="data-studio__panel data-rail__fx" data-testid="fx-settings">
      <div className="data-studio__panel-head">
        <h2>Exchange rate</h2>
      </div>
      <p className="data-studio__hint">
        USD amounts are converted at this rate. It is read once an hour from the source below, and
        on opening the vault.
      </p>
      <label className="data-field">
        <span className="data-field__label">Source URL</span>
        <input
          type="url"
          className="input-field"
          data-testid="fx-url"
          value={fx.url}
          spellCheck={false}
          onChange={(e) => setFx((f) => ({ ...f, url: e.target.value }))}
        />
      </label>
      <label className="data-field">
        <span className="data-field__label">Path to the rate</span>
        <input
          type="text"
          className="input-field"
          data-testid="fx-path"
          value={fx.path}
          spellCheck={false}
          placeholder="rates.ZAR"
          onChange={(e) => setFx((f) => ({ ...f, path: e.target.value }))}
        />
      </label>
      <label className="data-field">
        <span className="data-field__label">Path to the source's date (optional)</span>
        <input
          type="text"
          className="input-field"
          data-testid="fx-asof-path"
          value={fx.asOfPath}
          spellCheck={false}
          placeholder="leave empty when the source does not say"
          onChange={(e) => setFx((f) => ({ ...f, asOfPath: e.target.value }))}
        />
      </label>
      <div className="data-rail__fx-actions">
        <Button
          variant="primary"
          data-testid="fx-save"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus(null);
            setError(null);
            try {
              const saved = await api().fxSetSource({
                url: fx.url.trim(),
                path: fx.path.trim(),
                asOfPath: fx.asOfPath.trim() || null,
              });
              if (!saved.ok) {
                setError(saved.error);
                return;
              }
              // Saving only stores the source; reading it is the next step, so
              // the operator learns whether it works now rather than in an hour.
              await readNow("Saved, but the source could not be read");
            } finally {
              setBusy(false);
            }
          }}
        >
          Save and read now
        </Button>
        <Button
          variant="outline"
          data-testid="fx-refresh"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus(null);
            setError(null);
            try {
              await readNow("The source could not be read");
            } finally {
              setBusy(false);
            }
          }}
        >
          Refresh now
        </Button>
        <Button
          variant="ghost"
          data-testid="fx-reset"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus(null);
            setError(null);
            try {
              const res = await api().fxSetSource({ url: null });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              // Re-read rather than assuming the default here: the default is the
              // main process's to know, and a second copy of it in this file is a
              // second thing to keep in step.
              await load();
              setStatus("Back to the default source.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Use the default
        </Button>
      </div>
      {/* What the vault holds right now, whether or not this form was saved: a
          stale rate and a failed read are different facts, and the operator needs
          both to tell a wrong source from a slow one. */}
      <dl className="data-rail__fx-state" data-testid="fx-state">
        <div>
          <dt>Rate</dt>
          <dd data-testid="fx-rate">
            {fx.rate === null ? "not read yet" : `${fx.rate} ZAR per USD`}
            {fx.asOf ? ` · ${fx.asOf}` : ""}
          </dd>
        </div>
        <div>
          <dt>Last read</dt>
          <dd data-testid="fx-last-read">{fx.lastFetchedAt ?? "never"}</dd>
        </div>
        <div>
          <dt>Last error</dt>
          <dd data-testid="fx-last-error">{fx.lastError ?? "none"}</dd>
        </div>
      </dl>
      {status ? (
        <p className="data-studio__hint" data-testid="fx-status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert" data-testid="fx-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
