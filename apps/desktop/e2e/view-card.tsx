/**
 * E2E harness page for ViewCard (`components/ui/ViewCard`).
 *
 * One page because ViewCard is one component. Unlike the decision-body rig this
 * component talks to the IPC bridge, so the page stubs `window.lifequest` before
 * render with a fixture registry keyed by (domainSlug, viewId) — the same shape
 * the main process answers (parsed SavedView / ViewRunResult, envelopes included).
 * Writes the fixture registry also records (none yet) would need to model the
 * write, per the harness rules.
 *
 * `renderViewCard` bumps `viewCardCommits` from an effect — only after React has
 * committed, so a driver waits on that counter rather than on a frame.
 */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { CSSProperties } from "react";
import type { SavedView, ViewRunResult } from "@lifequest/vault-core";
import { ViewCard } from "@/components/ui/ViewCard";
import "@/styles/global.css";

type Fixture = {
  view: SavedView;
  run: { ok: true; value: ViewRunResult } | { ok: false; error: string } | null;
  missing?: boolean;
};

type HarnessWindow = Window & {
  viewCardReady?: boolean;
  viewCardCommits?: number;
  viewCardCalls?: string[];
  viewCardFixtures?: Record<string, Fixture>;
  installFixture?: (key: string, fixture: Fixture) => boolean;
  renderViewCard?: (domainSlug: string, viewId: string) => boolean;
};

const harness = window as HarnessWindow;

const WRAP: CSSProperties = {
  padding: 24,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(17rem, 1fr))",
  gap: "0.85rem",
  alignItems: "start",
};

harness.viewCardCalls = [];

const fixtures = (harness.viewCardFixtures = {});

// A fixture with `missing: true` models a view file the vault cannot open —
// viewGet itself fails, which is the branch that copy exists for.
function stubValue(key: string): unknown {
  const f = fixtures[key];
  if (!f) return { ok: false, error: "View not found" };
  return f.run ?? { ok: false, error: "View not found" };
}

// Stub the bridge before render. Named calls throw on an unexpected method —
// that is the point: an unexpected call should stop the run, not hide it.
(window as unknown as { lifequest: object }).lifequest = {
  viewGet: (slug: string, viewId: string) => {
    harness.viewCardCalls!.push(`viewGet:${slug}:${viewId}`);
    const f = fixtures[`${slug}::${viewId}`];
    if (!f || f.missing) {
      return Promise.resolve({ ok: false, error: `View not found: ${viewId}` });
    }
    return Promise.resolve({ ok: true, value: f.view });
  },
  viewRunSaved: (slug: string, viewId: string) => {
    harness.viewCardCalls!.push(`viewRunSaved:${slug}:${viewId}`);
    return Promise.resolve(stubValue(`${slug}::${viewId}`));
  },
};

function Harness({ domainSlug, viewId }: { domainSlug: string; viewId: string }) {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.viewCardCommits = commits.current;
  }, [domainSlug, viewId]);
  return (
    <div style={WRAP} className="home-dashboard__grid">
      <div className="home-pin">
        <ViewCard domainSlug={domainSlug} viewId={viewId} />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);

harness.renderViewCard = (domainSlug, viewId) => {
  root.render(
    <StrictMode>
      <Harness domainSlug={domainSlug} viewId={viewId} />
    </StrictMode>,
  );
  return true;
};

// A fixture install re-renders nothing by itself; the driver renders after it.
harness.installFixture = (key, fixture) => {
  fixtures[key] = fixture;
  return true;
};

harness.viewCardReady = true;
