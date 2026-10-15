/**
 * E2E harness page for `FxRatePanel` (`components/data/FxRatePanel`).
 *
 * One page because the panel is one component, and it talks to the IPC bridge
 * rather than to props: the page stubs `window.lifequest` before render, with the
 * same envelope shapes the main process answers. The stub is a small model of the
 * VAULT, not of the view — `fxSetSource` records what was sent and
 * `fxRefresh` answers from whatever source is current — because the interesting
 * claim is that pressing "Save and read now" sends the fields the operator typed
 * and then shows what came back.
 *
 * `fxPanelReady` / `fxPanelCommits` are bumped from effects, so a driver waits on
 * a commit rather than on a frame.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CSSProperties } from "react";
import { FxRatePanel } from "@/components/data/FxRatePanel";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";
import "@/styles/data.css";

const skinName = applyAppSkin("dark");

type StoredSource = {
  url: string;
  path: string;
  asOfPath: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
};

type HarnessWindow = Window & {
  fxPanelReady?: boolean;
  fxPanelCommits?: number;
  fxPanelCalls?: string[];
  fxPanelSkin?: string;
  /** What the vault holds: the settings the panel loads, and what it saves into. */
  fxPanelState?: {
    installed: boolean;
    rate: number | null;
    asOf: string | null;
    source: StoredSource;
    /** The reply `fxRefresh` gives; `refreshed` decides the panel's message. */
    refresh: { refreshed: boolean; rate: number | null; asOf: string | null; error: string | null };
  };
  /** Every input the page has sent, in order, for the driver to read back. */
  fxPanelSent?: Array<Record<string, unknown>>;
  fxPanelMount?: () => void;
};

const harness = window as HarnessWindow;

const DEFAULT_SOURCE: StoredSource = {
  url: "https://open.er-api.com/v6/latest/USD",
  path: "rates.ZAR",
  asOfPath: "time_last_update_utc",
  lastFetchedAt: null,
  lastError: null,
};

harness.fxPanelCalls = [];
harness.fxPanelSent = [];
harness.fxPanelState = {
  installed: true,
  rate: null,
  asOf: null,
  source: { ...DEFAULT_SOURCE },
  refresh: { refreshed: true, rate: 16.49, asOf: "2026-10-14", error: null },
};

/**
 * Stub the bridge. Named calls throw on an unexpected method, so a panel that
 * starts talking to something new stops the run rather than hiding it.
 */
(window as unknown as { lifequest: object }).lifequest = {
  kitList: (slug: string) => {
    harness.fxPanelCalls!.push(`kitList:${slug}`);
    return Promise.resolve({ ok: true, value: harness.fxPanelState!.installed ? ["finance"] : [] });
  },
  kitFinanceSettings: () => {
    harness.fxPanelCalls!.push("kitFinanceSettings");
    const s = harness.fxPanelState!;
    return Promise.resolve({
      ok: true,
      value: {
        homeCurrency: "ZAR",
        usdZarRate: s.rate,
        usdZarAsOf: s.asOf,
        defaultCaptureAccountId: null,
        fxSource: { ...s.source },
      },
    });
  },
  fxSetSource: (input: Record<string, unknown>) => {
    harness.fxPanelCalls!.push(`fxSetSource:${JSON.stringify(input)}`);
    harness.fxPanelSent!.push(input);
    const s = harness.fxPanelState!;
    if (input.url === null) {
      // Clearing goes back to the default, exactly as the vault does.
      s.source = { ...DEFAULT_SOURCE, lastFetchedAt: s.source.lastFetchedAt };
      return Promise.resolve({ ok: true, value: { fxSource: { ...s.source } } });
    }
    if (typeof input.url !== "string" || !/^https?:\/\//.test(input.url)) {
      return Promise.resolve({ ok: false, error: "The rate source must be an http or https URL" });
    }
    s.source = {
      url: String(input.url),
      path: String(input.path ?? ""),
      asOfPath: (input.asOfPath as string | null) ?? null,
      lastFetchedAt: null,
      lastError: null,
    };
    return Promise.resolve({ ok: true, value: { fxSource: { ...s.source } } });
  },
  fxRefresh: () => {
    harness.fxPanelCalls!.push("fxRefresh");
    const s = harness.fxPanelState!;
    const r = s.refresh;
    if (r.refreshed) {
      s.rate = r.rate;
      s.asOf = r.asOf;
      s.source = { ...s.source, lastFetchedAt: "2026-10-14T09:00:00.000Z", lastError: null };
    } else {
      s.source = { ...s.source, lastFetchedAt: "2026-10-14T09:00:00.000Z", lastError: r.error };
    }
    return Promise.resolve({
      ok: true,
      value: {
        refreshed: r.refreshed,
        rate: s.rate,
        asOf: s.asOf,
        settings: {
          usdZarRate: s.rate,
          usdZarAsOf: s.asOf,
          fxSource: { ...s.source },
        },
      },
    });
  },
};

const WRAP: CSSProperties = { padding: 24, maxWidth: "34rem" };

function Harness({ nonce }: { nonce: number }) {
  const commits = useRef(0);
  const [key, setKey] = useState(0);
  useEffect(() => {
    commits.current += 1;
    harness.fxPanelCommits = commits.current;
  }, [nonce, key]);
  harness.fxPanelMount = () => {
    commits.current += 1;
    harness.fxPanelCommits = commits.current;
    setKey((k) => k + 1);
  };
  return (
    <div style={WRAP} className="data-studio">
      <FxRatePanel key={key} />
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <Harness nonce={0} />
  </StrictMode>,
);

harness.fxPanelReady = true;
harness.fxPanelSkin = skinName;
