/**
 * The renderer's view of the bundled gallery.
 *
 * `shared/showcase-themes.ts` is the one source of truth: main seeds the
 * profile from this list and the rigs read the same names, so the Extensions
 * page must not carry its own copy of them. Re-exported here so the page can
 * import through the `@/lib/themes/…` alias every other renderer module uses,
 * without reaching across into `shared/` directly.
 */
export * from "../../../shared/showcase-themes.ts";
