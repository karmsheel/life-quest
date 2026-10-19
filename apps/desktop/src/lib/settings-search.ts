/**
 * The overlay's one search bar, over the settings it can reach.
 *
 * Hermes Desktop's settings sheet carries a search field above the section list,
 * and typing narrows that list in place rather than opening a second surface: the
 * operator keeps the same panel, the same scroll position and the same back
 * button, which is the whole reason a settings search is worth having.
 *
 * The index is the sections themselves plus two things a section label cannot
 * carry: the words for what each page holds (`keywords` beside each section) and
 * the themes, which are their own names and live on one page. A search for
 * "ember" is a search for the Appearance page, so theme names are folded into
 * that one section's haystack rather than matched as results of their own — a
 * result list that offers "Ember" and then opens a page that does not contain the
 * word would be lying about where it is taking you.
 *
 * Multiple words are ANDed, so "vault path" is narrower than either word.
 */
import { listAllSkins } from "./themes/registry.ts";
import { SETTINGS_SECTIONS, type SettingsSection } from "./settings-views.ts";

/** Whitespace-collapsed, lowercased; empty means "no filter". */
export function normalizeSettingsQuery(query: string): string {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

/**
 * The sections a query reaches, in the order the sidebar shows them. An empty
 * query reaches every section, so the caller never needs a branch of its own.
 *
 * Theme names are read on every call rather than baked at import: a theme
 * installed a moment ago is findable by its own name, and one taken away stops
 * being. One read per query, not per section — each read proves the stored skins
 * again (see `user-themes.ts`).
 */
export function searchSettingsSections(
  query: string,
  sections: SettingsSection[] = SETTINGS_SECTIONS,
): SettingsSection[] {
  const needle = normalizeSettingsQuery(query);
  if (!needle) return sections;

  const themeTerms = listAllSkins().flatMap((skin) => [skin.label, skin.name]);
  const words = needle.split(" ");

  return sections.filter((section) => {
    const terms =
      section.id === "appearance" ? themeTerms : [];
    const haystack = [section.label, ...section.keywords, ...terms]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
