/**
 * Keep a click on rendered markdown from navigating the privileged window.
 *
 * Rendered markdown is the app's only untrusted-HTML surface, and it renders in
 * the window that carries the preload bridge: a foreign document loaded *into
 * this window* would run with `window.lifequest` attached. Ordinary markdown
 * links are emitted with `target="_blank"` and so take the window-open path,
 * which the main process guards. A link without that target is either the hash
 * router's own (`#/…`, meant to stay in the document) or output the renderer did
 * not mean to produce — and a non-hash one of those must never be followed here.
 *
 * This is defence-in-depth, not the only line: the main process keeps its own
 * navigation allowlist. It means a future renderer bug is still only a dead
 * click rather than a bridge takeover. The markdown containers are the ones that
 * wire it up (`MarkdownView`, the composer preview); do not put it on the whole
 * document, where it would fight the router.
 */
export function containMarkdownLink(event: {
  target: EventTarget | null;
  preventDefault(): void;
}): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (!anchor) return;
  const href = anchor.getAttribute("href") ?? "";

  // The router owns the hash links this renderer emits (`#/vision/…`).
  if (href.startsWith("#")) return;

  // The one navigation this renderer does intend: an external page in a new
  // window. Main decides whether that window opens, and never in this one.
  const external = /^https?:\/\//i.test(href);
  if (external && anchor.getAttribute("target") === "_blank") return;

  event.preventDefault();
}
