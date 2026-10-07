/**
 * E2E harness page for the Pages surface (`pages/PagesPage`) next to the Data
 * surface (`pages/DataPage`) it is supposed to match, driven by
 * `pages-studio.electron.mjs`.
 *
 * Why both on one page: the claim under test is *parity* — the same header type
 * scale, the same panel chrome, the same list-row anatomy as the Home wing's
 * other two surfaces. Mounting only Pages would leave the reference numbers
 * typed into the driver, and a reference typed by hand drifts the moment Data
 * changes. Here both surfaces are the shipping components with the shipping CSS,
 * and the driver deep-equals their computed styles.
 *
 * Ways this harness can lie, written down before the assertions:
 *
 *  1. The two samples do not get the same width (a stray scrollbar), so every
 *     px-valued comparison is nonsense. The driver asserts host widths first.
 *  2. The IPC stub answers a shape the real main process never returns, so a
 *     component throws and React 19 unmounts the tree: readiness still resolves
 *     and every measurement reads `undefined`. The driver records console errors
 *     for exactly this.
 *  3. The stub does not model the write. `pageCreate` therefore returns a page
 *     that the next `pageList` never reports, and "the create path still works"
 *     is asserted against the harness's own lie. So create appends to the same
 *     array `pageList` answers from, and the driver reads the call log.
 *  4. A wait resolves against a state that was already true. Every wait here is a
 *     predicate the caller names (`rows(4)`, "the banner says X") chosen so it
 *     only becomes true after the action, and never a frame: a hidden Electron
 *     window suspends rAF, so a frame-based wait never returns. Nor a generic
 *     "did React commit" probe — a probe component's effect does not re-run when
 *     a *sibling* re-renders (measured: the filter narrowed the list 3 → 1 with
 *     the counter flat), and a MutationObserver misses property-only updates
 *     (`input.value`, `button.disabled`), which is all that typing a title does.
 *  5. `setPages` mutates the stub but the component never re-fetches (its load
 *     is mount-keyed), so the empty-vault check would measure the previous
 *     render. The harness remounts the surface by bumping its React key.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import PagesPage from "@/pages/PagesPage";
import DataPage from "@/pages/DataPage";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

type Harness = {
  pagesStudioReady?: boolean;
  pagesStudioCalls?: string[];
  pagesHarness?: {
    setPages: (next: unknown[]) => boolean;
    bumpMount: () => void;
  };
};

const h = window as unknown as Harness;

const ok = (value: unknown) => ({ ok: true, value });

const DOMAINS = [
  {
    slug: "health",
    meta: { slug: "health", name: "Health", archivedAt: null },
    documents: {},
  },
  {
    slug: "financial",
    meta: { slug: "financial", name: "Financial", archivedAt: null },
    documents: {},
  },
];

// Only `lifequest.id` and `domains` are read on the paths these two surfaces
// touch; the rest is the empty shape a fresh vault reports.
const SNAPSHOT = {
  rootPath: "C:/fixture-vault",
  lifequest: { id: "fixture-vault" },
  settings: {},
  domains: DOMAINS,
  agents: [],
  decisions: [],
  log: [],
  map: null,
  mapError: null,
  goals: [],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

const page = (
  id: string,
  domainSlug: string,
  title: string,
  blocks: number,
  updatedAt: string,
) => ({
  domainSlug,
  page: {
    id,
    domainSlug,
    title,
    blocks: Array.from({ length: blocks }, (_, i) => ({
      id: `${id}-b${i}`,
      kind: "markdown",
      markdown: "…",
    })),
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt,
  },
});

// Deliberately not in updated order: the surface sorts newest-first, so a row
// order that matches the fixture order would hide a dropped sort.
const PAGES = [
  page("p-sleep", "health", "Sleep log", 3, "2026-09-20T09:00:00.000Z"),
  page("p-budget", "financial", "Budget review", 0, "2026-09-30T09:00:00.000Z"),
  page("p-training", "health", "Training plan", 2, "2026-09-28T09:00:00.000Z"),
];

const DATABASES = [
  {
    domainSlug: "financial",
    database: {
      id: "db-ledger",
      name: "Ledger",
      columns: [{ id: "c1", name: "Date" }],
      sotMode: "local",
      updatedAt: "2026-09-29T00:00:00.000Z",
    },
  },
  {
    domainSlug: "health",
    database: {
      id: "db-metrics",
      name: "Metrics",
      columns: [{ id: "c1", name: "Date" }, { id: "c2", name: "Value" }],
      sotMode: "local",
      updatedAt: "2026-09-25T00:00:00.000Z",
    },
  },
];

let pages = PAGES;

const calls: string[] = [];
h.pagesStudioCalls = calls;

const bridge = {
  vaultGetSnapshot: async () => ok(SNAPSHOT),
  vaultListRecent: async () => ok([]),
  domainGetActive: async () => ok(null),
  onVaultFileChanged: () => () => {},
  pageList: async (slug: string | null) => {
    calls.push(`pageList:${slug ?? "all"}`);
    return ok(pages);
  },
  pageCreate: async (slug: string, input: { title: string }) => {
    calls.push(`pageCreate:${slug}:${input.title}`);
    const created = page(
      `p-new-${pages.length + 1}`,
      slug,
      input.title,
      0,
      "2026-10-01T09:00:00.000Z",
    );
    pages = [...pages, created];
    return ok(created.page);
  },
  dbList: async () => ok(DATABASES),
  kitList: async () => ok([]),
  kitFinanceSettings: async () => ok(null),
  dbListRows: async () => ok([]),
  dbSync: async () => ok(null),
};

// An unlisted call must not throw: naming only the expected calls hides the
// failure behind a bridge gap instead of reporting it as a render error.
const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = (target as Record<string | symbol, unknown>)[prop];
    if (found !== undefined) return found;
    return () => ok(null);
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

// A React effect cannot be the commit probe here: a probe component only re-runs
// its effect when *it* re-renders, and clicking the filter re-renders PagesPage
// alone — the counter stayed flat while the filter visibly narrowed the list
// (measured: rows 3 → 1 with `pagesStudioCommits` unchanged). A MutationObserver
// on the harness root observes the commit itself, whoever made it, and its
// callback runs as a microtask inside the same task as the DOM write, so a
// driver polling at 50 ms always reads the bumped value.
function Surface() {
  const [mountKey, setMountKey] = useState(0);
  h.pagesHarness = {
    setPages: (next) => {
      pages = next as typeof PAGES;
      setMountKey((k) => k + 1);
      return true;
    },
    bumpMount: () => setMountKey((k) => k + 1),
  };

  // Inline, because global.css sets `.shell__content { flex: 1; overflow: auto }`
  // and a per-sample scrollbar would narrow one surface against the other — the
  // one thing that would silently void every px parity claim.
  const host = { overflow: "visible", flex: "none" } as const;

  return (
    <>
      <div className="shell__content" id="pages-sample" style={host}>
        <PagesPage key={mountKey} />
      </div>
      <div className="shell__content" id="data-sample" style={host}>
        <DataPage />
      </div>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from pages-studio.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <VaultProvider>
        <Surface />
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

h.pagesStudioReady = true;
