import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  domainLens,
  overviewLens,
  unlockedAreas,
} from "@lifequest/vault-core/pure";
import { useOptionalTheme } from "@/components/theme/ThemeProvider";
import {
  DEFAULT_DOMAIN_PICKER,
  resolveDomainPicker,
  type DomainPickerRecipe,
} from "@/lib/themes/theme-file";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "./useActiveDomain";

const OVERVIEW_KEY = "__overview__";

/** The union lens, as the bar writes it. The stored area name stays "Life". */
const OVERVIEW_LABEL = "LIFE";

/**
 * The classes the older variant rules still key on, so a theme that only set
 * `variant` keeps its picture: pill chips, icon letters, and the stacked
 * column. Segment (the life-mark default) adds none, which is what segmented
 * always did.
 */
function switcherClass(recipe: DomainPickerRecipe): string {
  const legacy = [
    recipe.chips === "pill" ? "domain-switcher--pill" : "",
    recipe.labels === "initials" ? "domain-switcher--icons" : "",
    recipe.arrangement === "stack" ? "domain-switcher--list" : "",
  ].filter(Boolean);
  return ["domain-switcher", ...legacy].join(" ");
}

/**
 * The window's area lens.
 *
 * One life is the product's first surface, so the strip says "LIFE" and offers
 * nothing to switch until a second area is unlocked. With two or more unlocked
 * areas the same band becomes the control the worn recipe names. Life mark,
 * the default, is a round LIFE button in the centre and the areas on either
 * side. Named strip leads with LIFE. Initials keeps the circle and spends the
 * width on letters. Stack is a column, LIFE first. Locked and archived areas
 * are never chips. The stylesheet owns the pixels; this component only sets
 * the recipe's data attributes.
 */
export function DomainSwitcher() {
  const { snapshot, setLens, booting } = useVault();
  const lens = useDomainLens();
  const choice = useOptionalTheme()?.chrome.domainPicker ?? DEFAULT_DOMAIN_PICKER;
  const recipe = resolveDomainPicker(choice);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const areas = useMemo(() => {
    if (!snapshot) return [];
    return unlockedAreas(snapshot.domains);
  }, [snapshot]);

  const centred = recipe.arrangement === "centre";
  const { leading, trailing } = useMemo(() => {
    if (!centred) return { leading: [], trailing: areas };
    const mid = Math.ceil(areas.length / 2);
    return { leading: areas.slice(0, mid), trailing: areas.slice(mid) };
  }, [areas, centred]);

  // Arrow keys follow the eye. Centre is left side, LIFE, right side. Leading
  // and stack put LIFE first, then the areas in their usual order.
  const order: Array<string | null> = useMemo(
    () =>
      centred
        ? [...leading.map((d) => d.slug), null, ...trailing.map((d) => d.slug)]
        : [null, ...areas.map((d) => d.slug)],
    [areas, centred, leading, trailing],
  );

  const leadingRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);

  // Both sides take the wider group's width, so LIFE stays on the bar's centre
  // line when one side has more chips or longer names than the other. Measured
  // from the chips, not the side box, so setting the basis does not feed back.
  useLayoutEffect(() => {
    if (!centred) return;
    const leadingEl = leadingRef.current;
    const trailingEl = trailingRef.current;
    if (!leadingEl || !trailingEl) return;

    const contentWidth = (el: HTMLElement) => {
      const children = Array.from(el.children) as HTMLElement[];
      if (children.length === 0) return 0;
      const style = getComputedStyle(el);
      const gap = Number.parseFloat(style.columnGap || "0") || 0;
      let width = 0;
      for (let i = 0; i < children.length; i += 1) {
        width += children[i].getBoundingClientRect().width;
        if (i > 0) width += gap;
      }
      return width;
    };

    let frame = 0;
    const apply = () => {
      const next = Math.ceil(
        Math.max(contentWidth(leadingEl), contentWidth(trailingEl)),
      );
      if (next <= 0) return;
      const basis = `${next}px`;
      for (const el of [leadingEl, trailingEl]) {
        if (el.style.flexBasis !== basis) {
          el.style.flexGrow = "1";
          el.style.flexShrink = "1";
          el.style.flexBasis = basis;
        }
      }
    };

    apply();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    for (const child of [...leadingEl.children, ...trailingEl.children]) {
      observer.observe(child);
    }
    const fonts = document.fonts?.ready;
    if (fonts) void fonts.then(apply);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [centred, leading, trailing]);

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
        <span className="domain-switcher__life">{OVERVIEW_LABEL}</span>
      </div>
    );
  }

  if (areas.length < 2) {
    return (
      <div className="domain-switcher domain-switcher--quiet">
        <span className="domain-switcher__life">{OVERVIEW_LABEL}</span>
      </div>
    );
  }

  const overviewSelected = lens.kind === "overview";
  const initial = (name: string) => name.trim().charAt(0).toUpperCase();

  function renderArea(d: (typeof areas)[number]) {
    const selected = lens.kind === "domain" && lens.slug === d.slug;
    return (
      <button
        key={d.slug}
        type="button"
        role="radio"
        aria-checked={selected}
        tabIndex={selected ? 0 : -1}
        aria-disabled={pending || undefined}
        className={`ui-segmented__option${selected ? " is-active" : ""}`}
        ref={(el) => {
          refs.current[d.slug] = el;
        }}
        onClick={() => void onChange(d.slug)}
        onKeyDown={(event) => onKeyDown(d.slug, event)}
      >
        {recipe.labels === "initials" ? (
          <span className="domain-switcher__initial" aria-hidden="true">
            {initial(d.meta.name)}
          </span>
        ) : (
          <span className="domain-switcher__name">{d.meta.name}</span>
        )}
      </button>
    );
  }

  const overviewButton = (
    <button
      type="button"
      role="radio"
      aria-checked={overviewSelected}
      tabIndex={overviewSelected ? 0 : -1}
      aria-disabled={pending || undefined}
      className={`ui-segmented__option domain-switcher__overview${overviewSelected ? " is-active" : ""}`}
      ref={(el) => {
        refs.current[OVERVIEW_KEY] = el;
      }}
      onClick={() => void onChange(null)}
      onKeyDown={(event) => onKeyDown(null, event)}
    >
      <span className="domain-switcher__name">{OVERVIEW_LABEL}</span>
    </button>
  );

  return (
    <div
      className={switcherClass(recipe)}
      data-mode={choice.mode}
      data-arrangement={recipe.arrangement}
      data-mark={recipe.mark}
      data-labels={recipe.labels}
      data-chips={recipe.chips}
    >
      <div
        className="ui-segmented domain-switcher__tabs"
        role="radiogroup"
        aria-label="Area lens"
      >
        {centred ? (
          <>
            <div
              className="domain-switcher__side domain-switcher__side--leading"
              ref={leadingRef}
            >
              {leading.map((d) => renderArea(d))}
            </div>
            {overviewButton}
            <div
              className="domain-switcher__side domain-switcher__side--trailing"
              ref={trailingRef}
            >
              {trailing.map((d) => renderArea(d))}
            </div>
          </>
        ) : (
          <>
            {overviewButton}
            {areas.map((d) => renderArea(d))}
          </>
        )}
      </div>
      {error ? (
        <span className="domain-switcher__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
