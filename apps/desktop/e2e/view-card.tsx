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
import type { ComposedViewRunResult, SavedView } from "@lifequest/vault-core";
import { ViewCard } from "@/components/ui/ViewCard";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first: a harness on base tokens would paint a palette the
// operator never runs, and this rig exists to judge the card they do see.
const skinName = applyAppSkin("dark");

type Fixture = {
  view: SavedView;
  run: { ok: true; value: ComposedViewRunResult } | { ok: false; error: string } | null;
  missing?: boolean;
};

type HarnessWindow = Window & {
  viewCardReady?: boolean;
  viewCardCommits?: number;
  viewCardCalls?: string[];
  viewCardFixtures?: Record<string, Fixture>;
  installFixture?: (key: string, fixture: Fixture) => boolean;
  renderViewCard?: (domainSlug: string, viewId: string) => boolean;
  /** The skin the page painted in, so a driver can refuse an unstyled run. */
  viewCardSkin?: string;
  /** The database schema the card reads to decide which switches are possible. */
  viewCardSchema?: Record<string, unknown>;
  /** Force the card read-only, the way a locked dashboard does. */
  viewCardSetEditable?: (editable: boolean) => boolean;
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

/**
 * The schema the card reads to decide which presentation switches are possible.
 * A real one from the finance kit: a date to bucket, a number to measure, and a
 * relation to group by. `retargetBlock` reads the TYPES, so a rig with the wrong
 * types would prove the wrong set of enabled controls.
 */
const SCHEMA = {
  id: "finance:transactions",
  name: "Transactions",
  sotMode: "local-canonical-mirror",
  adapter: null,
  columns: [
    { id: "date", name: "date", type: "date" },
    { id: "amount", name: "amount", type: "number" },
    { id: "category", name: "category", type: "relation", relationDatabaseId: "finance:categories" },
    { id: "payee", name: "payee", type: "text" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
harness.viewCardSchema = SCHEMA;

// A fixture with `missing: true` models a view file the vault cannot open —
// viewGet itself fails, which is the branch that copy exists for.
function stubValue(key: string): unknown {
  const f = fixtures[key];
  if (!f) return { ok: false, error: "View not found" };
  return f.run ?? { ok: false, error: "View not found" };
}

/**
 * What a real save does to the card: the file's spec changes, and the run
 * follows it. A presentation-only change keeps every row and moves the panel to
 * the shape the spec now names, which is exactly the behaviour the operator is
 * buying when they click a switch — so the stub models that rather than
 * answering with a canned second run.
 */
function applySaveToFixture(key: string, spec: Record<string, unknown>): void {
  const f = fixtures[key];
  if (!f) return;
  fixtures[key] = {
    ...f,
    view: { ...(spec as unknown as SavedView), id: f.view.id, createdAt: f.view.createdAt, updatedAt: "2026-10-08T00:00:00.000Z" },
  };
}

function applySaveToRun(key: string, spec: Record<string, unknown>): void {
  const f = fixtures[key];
  if (!f) return;
  const blocks = Array.isArray(spec.blocks) ? (spec.blocks as { id: string; presentation: string }[]) : null;
  if (!f.run || !f.run.ok) return;
  fixtures[key] = {
    ...f,
    run: {
      ok: true as const,
      value: {
        ...f.run.value,
        title: (spec.title as string) ?? f.run.value.title,
        blocks: f.run.value.blocks.map((b) => {
          const match = blocks?.find((nb) => nb.id === b.id);
          return match ? { ...b, presentation: match.presentation as typeof b.presentation } : b;
        }),
      },
    },
  };
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
  // The card reads the database's own columns so it can offer only the switches
  // that will actually validate.
  dbGet: (slug: string, databaseId: string) => {
    harness.viewCardCalls!.push(`dbGet:${slug}:${databaseId}`);
    return Promise.resolve({ ok: true, value: SCHEMA });
  },
  // The one write path an operator's block switch takes: the app's own
  // `view:save`, with the card's own id, so the file keeps its identity.
  viewSave: (slug: string, spec: Record<string, unknown>, viewId?: string) => {
    harness.viewCardCalls!.push(`viewSave:${slug}:${viewId ?? ""}`);
    // The save channel: the driver reads this line instead of asking the page,
    // so the claim survives a renderer that has stopped answering.
    console.log(
      `viewCardSave:${JSON.stringify({
        viewId,
        blocks: (spec.blocks ?? []).map((b) => {
          const block = b as { id: string; presentation: string };
          return [block.id, block.presentation];
        }),
      })}`,
    );
    applySaveToFixture(`${slug}::${viewId}`, spec);
    applySaveToRun(`${slug}::${viewId}`, spec);
    return Promise.resolve({ ok: true, value: { ...spec, id: viewId } });
  },
};

function Harness({
  domainSlug,
  viewId,
  editable,
}: {
  domainSlug: string;
  viewId: string;
  editable: boolean;
}) {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.viewCardCommits = commits.current;
  }, [domainSlug, viewId]);

  /**
   * The state channel. This page reports what it drew by CONSOLE, whenever the
   * card's own DOM changes, rather than waiting to be asked.
   *
   * The driver has to read the card AFTER a save has re-run it, and a Vite HMR
   * message can wedge this renderer's JS thread at exactly that moment: an
   * `executeJavaScript` then never settles, while a console line already emitted
   * is still in the main process's hands. The claim is about what the card drew,
   * so it must not depend on the card still being able to answer questions.
   */
  useEffect(() => {
    const host = document.querySelector(".home-pin");
    if (!host) return;
    let frame = 0;
    const report = () => {
      const blocks = Array.from(document.querySelectorAll(".view-card__block")).map((el) => ({
        title: el.querySelector(".view-card__block-title")?.textContent ?? null,
        active: Array.from(el.querySelectorAll(".view-card__tool"))
          .filter((b) => b.getAttribute("aria-pressed") === "true")
          .map((b) => b.getAttribute("data-presentation")),
        tools: Array.from(el.querySelectorAll(".view-card__tool")).map((b) =>
          b.getAttribute("data-presentation"),
        ),
        tableRows: el.querySelectorAll(".view-card__table tbody tr").length,
        bars: el.querySelectorAll(".view-card__bar").length,
        metric: el.querySelector(".view-card__metric")?.textContent ?? null,
      }));
      console.log(
        `viewCardState:${JSON.stringify({ viewId, domainSlug, editable, blocks })}`,
      );
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    });
    observer.observe(host, { childList: true, subtree: true, attributes: true });
    frame = requestAnimationFrame(report);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [domainSlug, viewId, editable]);

  return (
    <div style={WRAP} className="home-dashboard__grid">
      <div className="home-pin">
        <ViewCard domainSlug={domainSlug} viewId={viewId} editable={editable} />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);

let editableNow = true;

harness.renderViewCard = (domainSlug, viewId) => {
  root.render(
    <StrictMode>
      <Harness domainSlug={domainSlug} viewId={viewId} editable={editableNow} />
    </StrictMode>,
  );
  return true;
};

harness.viewCardSetEditable = (editable) => {
  editableNow = editable;
  return true;
};

// A fixture install re-renders nothing by itself; the driver renders after it.
harness.installFixture = (key, fixture) => {
  fixtures[key] = fixture;
  return true;
};

harness.viewCardReady = true;
harness.viewCardSkin = skinName;
