import { eyebrowFor, type EyebrowPage } from "./wing-eyebrow.ts";

/**
 * The eyebrow every wing page opens with: the page's own name, uppercase —
 * `Dashboard`, `Dream`, `Task Manager`.
 *
 * One class, one colour: every page's eyebrow is the same muted grey, so a
 * page under a new wing looks the same as a page under an old one without
 * touching its CSS. The muted grey comes from `--muted-foreground`, the token
 * the rest of the shell's secondary text uses.
 */
export function WingEyebrow({
  page,
  className = "",
}: {
  page: EyebrowPage;
  className?: string;
}) {
  const classes = ["wing-eyebrow", className].filter(Boolean).join(" ");

  return (
    <p className={classes} data-testid="wing-eyebrow" data-wing-page={page}>
      {eyebrowFor(page)}
    </p>
  );
}
