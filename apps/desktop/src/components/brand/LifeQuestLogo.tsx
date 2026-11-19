import modernArt from "@/assets/brand/logo/01-modern.svg?raw";
import athleticArt from "@/assets/brand/logo/02-athletic.svg?raw";
import classicArt from "@/assets/brand/logo/03-classic.svg?raw";
import minimalArt from "@/assets/brand/logo/04-minimal.svg?raw";
import {
  DEFAULT_LOGO_VARIANT,
  LOGO_VARIANTS,
  type LogoVariant,
} from "@/lib/brand/logo";

/**
 * The LifeQuest lockup, drawn inline so the theme's three logo inks reach it.
 *
 * The supplied SVGs are not images with fixed fills: their three groups are
 * `life-text`, `quest-icon` and `uest-text`, and `global.css` fills each from
 * `--life-color`, `--icon-color` and `--uest-color`. An `<img>` cannot inherit
 * those, and a baked fill cannot follow a day skin — so the art is inlined from
 * the shipped files (`?raw`), with the files' own `<style>` blocks removed when
 * they were brought in (see `src/lib/brand/logo.ts`), and the classes are what
 * the stylesheet paints.
 *
 * `dangerouslySetInnerHTML` is how the exact supplied path data is mounted: the
 * markup is bundled source, not runtime input. The wrapper owns the accessible
 * name; the copied `<svg>` carries no title of its own.
 *
 * `crop` swaps the artwork's padded viewBox for its ink-tight one (the box is
 * metadata on the variant, measured from the art). The rail's header uses it so
 * the L starts on the rail's content edge, in line with the wing switcher and
 * the page rows; the splash and the picker leave the padding in, which is what
 * keeps the mark's scale on those surfaces unchanged.
 */
const ART: Record<LogoVariant, string> = {
  modern: modernArt,
  athletic: athleticArt,
  classic: classicArt,
  minimal: minimalArt,
};

/** The variant's ink-tight viewBox, from the brand metadata. */
const INK_BOX: Record<LogoVariant, string> = Object.fromEntries(
  LOGO_VARIANTS.map((variant) => [variant.id, variant.headerViewBox]),
) as Record<LogoVariant, string>;

export function LifeQuestLogo({
  variant,
  className,
  /**
   * True inside a picker, where the surrounding option already names the mark;
   * a preview must not announce "LifeQuest" four more times in a radio group.
   */
  decorative = false,
  crop = false,
}: {
  variant: LogoVariant;
  className?: string;
  decorative?: boolean;
  /** Draw the ink-tight viewBox instead of the padded one (the rail's header). */
  crop?: boolean;
}) {
  const base = ART[variant] ?? ART[DEFAULT_LOGO_VARIANT];
  const markup = crop
    ? base.replace(/viewBox="[^"]*"/, `viewBox="${INK_BOX[variant]}"`)
    : base;
  const classes = ["lifequest-logo", className].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      data-logo-variant={variant}
      {...(decorative
        ? { "aria-hidden": true as const }
        : { role: "img", "aria-label": "LifeQuest" })}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
