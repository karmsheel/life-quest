/**
 * Draft-theme patches — the studio's write-by-construction helpers.
 *
 * The Fields view never edits JSON text: it holds a parsed `ThemeFile` and
 * replaces one layer at a time. Each helper merges one layer's patch into the
 * theme and leaves every other key exactly as the parser produced it, so the
 * saved file can only ever contain schema keys and a layer can only ever gain
 * the values its own controls offer.
 *
 * The file stays minimal on purpose: a theme that only changed the wing
 * switcher's place must not start carrying a whole chrome object, which is why
 * the patches land in the partial the theme already has rather than a resolved
 * default.
 */
import {
  resolveChrome,
  type ThemeChrome,
  type ThemeChromeOverride,
  type ThemeFile,
  type ThemeMaterial,
  type ThemeSceneFile,
  type ThemeSceneOverride,
} from "@/lib/themes/theme-file";

/**
 * Merge chrome picks into the theme's partial `chrome`.
 *
 * A new component branch is seeded from the resolved defaults first: the parser
 * requires a place on `wingSwitcher`/`domainSwitcher` whenever their branch
 * exists, so a branch built from only the field the operator touched (say the
 * wing variant, before any place) would be refused. Seeding keeps the draft
 * valid without the studio ever writing a half-branch.
 */
export function withChromePatch(
  theme: ThemeFile,
  patch: ThemeChromeOverride,
): ThemeFile {
  const resolved = resolveChrome(theme.chrome);
  const chrome = { ...(theme.chrome ?? {}) } as Record<
    string,
    Record<string, string>
  >;
  for (const [component, values] of Object.entries(patch)) {
    if (!values) continue;
    const base =
      chrome[component] ??
      ({ ...resolved[component as keyof ThemeChrome] } as Record<string, string>);
    chrome[component] = { ...base, ...values };
  }
  return { ...theme, chrome: chrome as Partial<ThemeChrome> };
}

/** Merge material axis picks into the theme's partial `material`. */
export function withMaterialPatch(
  theme: ThemeFile,
  patch: Partial<ThemeMaterial>,
): ThemeFile {
  return { ...theme, material: { ...theme.material, ...patch } };
}

/**
 * Merge scene picks into the theme's partial `scene`; empty layers drop the key.
 *
 * A picture is whole or absent: the layers below the sky rows always report the
 * entire image object (file plus its four axes), so a patch with an image
 * replaces it rather than leaving a half image behind. An explicit
 * `image: null` is the Remove button speaking — the draft has no picture, so
 * the key goes instead of landing as a JSON `null` (the parser normalises an
 * absent picture to none anyway).
 *
 * The panel shades are the opposite shape: two independent axes in one map, and
 * the rows below the picture report only the axis that was picked. That object
 * deep-merges axis by axis, so shading the chat bar leaves the sidebar's step
 * alone (and a theme keeps only the axes it actually names). Everything else
 * keeps merging field by field, and a layer that ends up empty drops out of the
 * file entirely.
 */
export function withScenePatch(
  theme: ThemeFile,
  patch: ThemeSceneOverride,
): ThemeFile {
  const background = { ...theme.scene?.background, ...patch.background };
  if (patch.background?.panels !== undefined) {
    const panels = {
      ...theme.scene?.background?.panels,
      ...patch.background.panels,
    };
    if (Object.keys(panels).length > 0) background.panels = panels;
    else delete background.panels;
  }
  if (patch.background?.image === null) delete background.image;
  const frames = { ...theme.scene?.frames, ...patch.frames };
  const scene: ThemeSceneFile = {
    ...(Object.keys(background).length > 0 ? { background } : {}),
    ...(Object.keys(frames).length > 0 ? { frames } : {}),
  };
  const next: ThemeFile = { ...theme };
  if (Object.keys(scene).length > 0) next.scene = scene;
  else delete next.scene;
  return next;
}
