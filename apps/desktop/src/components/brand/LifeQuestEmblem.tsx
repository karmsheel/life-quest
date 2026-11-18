import emblemArt from "@/assets/brand/logo/q-emblem.svg?raw";

/**
 * The lockups' Q emblem on its own, as one ink.
 *
 * This is the mark inside every supplied lockup (all four share the same path),
 * bundled once here for the places that need the icon without the words — the
 * thin rail's expand control. It is drawn inline so `--icon-color` reaches it,
 * exactly as `.quest-icon` does inside `LifeQuestLogo`; the surrounding control
 * owns the accessible name, so the drawing itself is hidden from a screen
 * reader.
 *
 * `dangerouslySetInnerHTML` is how the bundled path data is mounted: the markup
 * is build-time source, not runtime input.
 */
export function LifeQuestEmblem({ className }: { className?: string }) {
  const classes = ["lifequest-emblem", className].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: emblemArt }}
    />
  );
}
