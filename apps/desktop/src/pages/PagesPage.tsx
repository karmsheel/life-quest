import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { PageListEntry } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { Button } from "@/components/ui/Button";

export default function PagesPage() {
  const { snapshot } = useVault();
  const lens = useDomainLens();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<PageListEntry[]>([]);
  const [name, setName] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const domainSlug = lens.kind === "domain" ? lens.slug : null;
  const showDomainSelect = lens.kind !== "domain";
  const liveDomains = (snapshot?.domains ?? []).filter((d) => !d.meta.archivedAt);

  const load = useCallback(async () => {
    const res = await api().pageList(domainSlug);
    if (res.ok) {
      setEntries(res.value as PageListEntry[]);
    } else {
      setError(res.error);
    }
  }, [domainSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (showDomainSelect && !selectedDomain) {
      setError("Select a domain to create a page in.");
      return;
    }
    const target = showDomainSelect ? selectedDomain : domainSlug;
    if (!target) {
      setError("No domain available.");
      return;
    }
    setBusy(true);
    try {
      const res = await api().pageCreate(target, { title: name });
      if (!res.ok) {
        setError(res.error);
      } else {
        setName("");
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  const domainName = useCallback(
    (slug: string) => liveDomains.find((d) => d.slug === slug)?.meta.name ?? slug,
    [liveDomains],
  );

  // Most recently touched first: the page you just edited is the one you want.
  const ordered = useMemo(
    () =>
      [...entries].sort((a, b) =>
        b.page.updatedAt.localeCompare(a.page.updatedAt),
      ),
    [entries],
  );

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? ordered.filter((entry) => entry.page.title.toLowerCase().includes(needle))
    : ordered;

  const perDomain = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.domainSlug, (counts.get(entry.domainSlug) ?? 0) + 1);
    }
    return liveDomains
      .map((d) => ({ slug: d.slug, name: d.meta.name, count: counts.get(d.slug) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [entries, liveDomains]);

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <div className="page-content pages-studio">
      <header className="pages-studio__header">
        <p className="pages-studio__eyebrow">Pages</p>
        <h1 className="pages-studio__title">Pages</h1>
        <p className="pages-studio__lead">
          Canvases in this vault. Create one here, then open it to add blocks.
        </p>
      </header>

      {error ? (
        <p className="pages-studio__banner pages-studio__banner--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="pages-studio__layout">
        <section className="pages-studio__panel" aria-labelledby="pages-list-heading">
          <div className="pages-studio__panel-head">
            <h2 id="pages-list-heading">All pages</h2>
            <span className="pages-studio__count">{visible.length}</span>
          </div>

          {entries.length > 0 ? (
            <div className="pages-studio__filter">
              <input
                type="text"
                className="input-field"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by title…"
                aria-label="Filter pages by title"
              />
            </div>
          ) : null}

          {entries.length === 0 ? (
            <div className="pages-studio__empty">
              <p className="pages-studio__empty-title">No pages yet.</p>
              <p className="pages-studio__empty-hint">
                Create one from the panel beside this list.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="pages-studio__empty">
              <p className="pages-studio__empty-title">
                No pages match “{query.trim()}”.
              </p>
              <p className="pages-studio__empty-hint">Clear the filter to see all {entries.length}.</p>
            </div>
          ) : (
            <ul className="page-list">
              {visible.map((entry) => (
                <li
                  key={`${entry.domainSlug}-${entry.page.id}`}
                  className="page-list__item"
                >
                  <button
                    type="button"
                    className="page-list__open"
                    onClick={() => navigate(`/pages/${entry.domainSlug}/${entry.page.id}`)}
                  >
                    <span className="page-list__copy">
                      <span className="page-list__name">{entry.page.title}</span>
                      <span className="page-list__sub">
                        {blockCountLabel(entry.page.blocks.length)}
                        {" · "}
                        {updatedLabel(entry.page.updatedAt)}
                      </span>
                    </span>
                    {lens.kind !== "domain" ? (
                      <span className="page-list__domain">{domainName(entry.domainSlug)}</span>
                    ) : null}
                    <svg className="page-list__chevron" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M6 3.5 10.5 8 6 12.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="pages-studio__rail">
          <section className="pages-studio__panel" aria-labelledby="pages-create-heading">
            <div className="pages-studio__panel-head">
              <h2 id="pages-create-heading">New page</h2>
            </div>
            <form onSubmit={onCreate} className="pages-studio__form">
              <label className="pages-field">
                <span className="pages-field__label">Title</span>
                <input
                  type="text"
                  placeholder="New page title"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  className="input-field"
                />
              </label>
              {showDomainSelect ? (
                <label className="pages-field">
                  <span className="pages-field__label">Domain</span>
                  <select
                    value={selectedDomain}
                    onChange={(e) => setSelectedDomain(e.target.value)}
                    className="input-field"
                  >
                    <option value="">Select domain…</option>
                    {liveDomains.map((d) => (
                      <option key={d.slug} value={d.slug}>
                        {d.meta.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                className="pages-studio__submit"
                disabled={busy || !name.trim()}
              >
                New page
              </Button>
            </form>
          </section>

          {showDomainSelect && perDomain.length > 0 ? (
            <section className="pages-studio__panel" aria-labelledby="pages-domains-heading">
              <div className="pages-studio__panel-head">
                <h2 id="pages-domains-heading">By domain</h2>
              </div>
              <ul className="pages-studio__stats">
                {perDomain.map((row) => (
                  <li key={row.slug} className="pages-studio__stat">
                    <span className="pages-studio__stat-name">{row.name}</span>
                    <span className="pages-studio__stat-count">{row.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function blockCountLabel(count: number): string {
  return count === 1 ? "1 block" : `${count} blocks`;
}

function updatedLabel(iso: string): string {
  return iso.length >= 10 ? `Updated ${iso.slice(0, 10)}` : "Updated";
}
