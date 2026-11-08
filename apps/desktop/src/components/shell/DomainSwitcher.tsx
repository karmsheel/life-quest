import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  domainLens,
  overviewLens,
  unlockedAreas,
} from "@lifequest/vault-core/pure";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "./useActiveDomain";

const OVERVIEW_KEY = "__overview__";

/**
 * The window's area lens.
 *
 * One life is the product's first surface, so the strip says "Life" and offers
 * nothing to switch until a second area is unlocked. With two or more unlocked
 * areas the same band becomes the segmented control: Life first, then the areas
 * the operator can actually see. Locked and archived areas are never chips.
 */
export function DomainSwitcher() {
  const { snapshot, setLens, booting } = useVault();
  const lens = useDomainLens();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const areas = useMemo(() => {
    if (!snapshot) return [];
    return unlockedAreas(snapshot.domains);
  }, [snapshot]);

  const order: Array<string | null> = useMemo(
    () => [null, ...areas.map((d) => d.slug)],
    [areas],
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
      setError(err instanceof Error ? err.message : "Failed to switch area");
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

  // Fewer than two unlocked areas: one surface, so the band is a quiet label
  // rather than a control. It keeps the tab's height and centres the word, so
  // the strip reads the same before and after the switcher appears.
  if (booting && !snapshot) {
    return (
      <div className="domain-switcher domain-switcher--quiet" aria-busy="true">
        <span className="domain-switcher__life">Life</span>
      </div>
    );
  }

  if (areas.length < 2) {
    return (
      <div className="domain-switcher domain-switcher--quiet">
        <span className="domain-switcher__life">Life</span>
      </div>
    );
  }

  const overviewSelected = lens.kind === "overview";

  return (
    <div className="domain-switcher">
      <div
        className="ui-segmented domain-switcher__tabs"
        role="radiogroup"
        aria-label="Area lens"
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
          <span className="domain-switcher__name">Life</span>
        </button>
        {areas.map((d) => {
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
