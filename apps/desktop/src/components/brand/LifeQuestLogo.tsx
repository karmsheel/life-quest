import modernArt from "@/assets/brand/logo/01-modern.svg?raw";
import athleticArt from "@/assets/brand/logo/02-athletic.svg?raw";
import classicArt from "@/assets/brand/logo/03-classic.svg?raw";
import minimalArt from "@/assets/brand/logo/04-minimal.svg?raw";
import {
  DEFAULT_LOGO_VARIANT,
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
 */
const ART: Record<LogoVariant, string> = {
  modern: modernArt,
  athletic: athleticArt,
  classic: classicArt,
  minimal: minimalArt,
};

export function LifeQuestLogo({
  variant,
  className,
  /**
   * True inside a picker, where the surrounding option already names the mark;
   * a preview must not announce "LifeQuest" four more times in a radio group.
   */
  decorative = false,
}: {
  variant: LogoVariant;
  className?: string;
  decorative?: boolean;
}) {
  const markup = ART[variant] ?? ART[DEFAULT_LOGO_VARIANT];
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
