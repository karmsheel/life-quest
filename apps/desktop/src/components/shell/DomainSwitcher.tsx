import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { domainLens, overviewLens } from "@lifequest/vault-core/pure";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "./useActiveDomain";

const OVERVIEW_KEY = "__overview__";

export function DomainSwitcher() {
  const { snapshot, setLens, booting } = useVault();
  const lens = useDomainLens();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const domains = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.domains
      .filter((d) => !d.meta.archivedAt)
      .slice()
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  }, [snapshot]);

  const order: Array<string | null> = useMemo(
    () => [null, ...domains.map((d) => d.slug)],
    [domains],
  );

  async function onChange(nextSlug: string | null) {
    if (pending) return;
    if (nextSlug === null) {
      if (lens.kind === "overview") return;
    } else if (lens.kind === "domain" && lens.slug === nextSlug) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await setLens(
        nextSlug ? domainLens(nextSlug) : overviewLens(),
      );
      if (!result.ok) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch domain");
    } finally {
      setPending(false);
    }
  }

  function optionKey(slug: string | null): string {
    return slug ?? OVERVIEW_KEY;
  }

  function move(fromSlug: string | null, key: "ArrowLeft" | "ArrowRight") {
    const index = order.findIndex((s) => s === fromSlug);
    if (index < 0 || order.length === 0) return;
    const next =
      key === "ArrowRight"
        ? order[(index + 1) % order.length]
        : order[(index - 1 + order.length) % order.length];
    void onChange(next);
    refs.current[optionKey(next)]?.focus();
  }

  function onKeyDown(
    slug: string | null,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(slug, event.key);
    }
  }

  if (booting && !snapshot) {
    return (
      <div className="domain-switcher muted" aria-busy="true">
        Loading domains…
      </div>
    );
  }

  const overviewSelected = lens.kind === "overview";

  return (
    <div className="domain-switcher">
      <div
        className="ui-segmented domain-switcher__tabs"
        role="radiogroup"
        aria-label="Domain lens"
      >
        <button
          type="button"
          role="radio"
          aria-checked={overviewSelected}
          tabIndex={overviewSelected ? 0 : -1}
          disabled={pending}
          className={`ui-segmented__option${overviewSelected ? " is-active" : ""}`}
          ref={(el) => {
            refs.current[OVERVIEW_KEY] = el;
          }}
          onClick={() => void onChange(null)}
          onKeyDown={(event) => onKeyDown(null, event)}
        >
          <span className="domain-switcher__name">Overview</span>
        </button>
        {domains.map((d) => {
          const selected = lens.kind === "domain" && lens.slug === d.slug;
          return (
            <button
              key={d.slug}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={pending}
              className={`ui-segmented__option${selected ? " is-active" : ""}`}
              ref={(el) => {
                refs.current[d.slug] = el;
              }}
              onClick={() => void onChange(d.slug)}
              onKeyDown={(event) => onKeyDown(d.slug, event)}
            >
              <span className="domain-switcher__name">{d.meta.name}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <span className="domain-switcher__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
