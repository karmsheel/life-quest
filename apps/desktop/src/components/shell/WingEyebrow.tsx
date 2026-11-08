import { eyebrowFor, type EyebrowPage } from "./wing-eyebrow.ts";

/**
 * The eyebrow every wing page opens with: the wing it belongs to, a dot, then
 * the page's own name — `Home · Dashboard`.
 *
 * The class is the one every wing page styles alike, so a page under a new
 * wing looks the same as a page under an old one without touching its CSS.
 * `muted` rides along for the pages whose titles are not accent-coloured; the
 * accent variant is what the studio pages under Home already used.
 */
export function WingEyebrow({
  page,
  variant = "muted",
  className = "",
}: {
  page: EyebrowPage;
  variant?: "muted" | "accent";
  className?: string;
}) {
  const classes = [
    "wing-eyebrow",
    variant === "accent" ? "wing-eyebrow--accent" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <p className={classes} data-testid="wing-eyebrow" data-wing-page={page}>
      {eyebrowFor(page)}
    </p>
  );
}
