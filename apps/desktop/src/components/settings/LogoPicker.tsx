import { LifeQuestLogo } from "@/components/brand/LifeQuestLogo";
import { useLogoVariant } from "@/components/brand/useLogoVariant";
import {
  LOGO_VARIANTS,
  writeLogoVariant,
  type LogoVariant,
} from "@/lib/brand/logo";

/**
 * The Developer bench's logo picker: the four shipped lockups, one press each.
 *
 * It is a radio group, not four buttons. The pick is one value out of four, and
 * a screen reader should hear that: `radio`/`aria-checked` with a group label,
 * exactly the semantics the theme picker's tiles use. The preview is the real
 * component — `LifeQuestLogo` with the same theme tokens the rail wears — so a
 * swatch cannot drift from what the sidebar will draw.
 *
 * A press writes the pick immediately. The rail is subscribed to the same store
 * (`useLogoVariant`), so it repaints behind the sheet without a reload, and the
 * next launch's splash reads the same localStorage key.
 */
export function LogoPicker() {
  const active = useLogoVariant();

  const choose = (variant: LogoVariant) => {
    writeLogoVariant(variant);
  };

  return (
    <div className="logo-picker" role="radiogroup" aria-label="Logo">
      {LOGO_VARIANTS.map((variant) => {
        const selected = active === variant.id;
        return (
          <button
            key={variant.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={variant.label}
            title={`${variant.label} — ${variant.description}`}
            className={`logo-picker__option${selected ? " is-active" : ""}`}
            data-logo-option={variant.id}
            onClick={() => choose(variant.id)}
          >
            <span className="logo-picker__preview">
              <LifeQuestLogo variant={variant.id} decorative />
            </span>
            <span className="logo-picker__label">{variant.label}</span>
            <span className="logo-picker__desc">{variant.description}</span>
          </button>
        );
      })}
    </div>
  );
}
