import type { WikiResolver } from "./wiki-links.ts";

const MEDIA_SRC = /^media\/[A-Za-z0-9._-]+$/;

/** A wiki token: `[[target]]`, not an embed, no nested brackets. */
const WIKI_TOKEN = /(?<!!)\[\[([^[\]]+)\]\]/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wikiAnchor(target: string, href: string, libraryId?: string): string {
  const id = libraryId ? ` data-library-id="${escapeHtml(libraryId)}"` : "";
  return `<a href="${escapeHtml(href)}"${id} class="wiki-link">${escapeHtml(
    target.trim(),
  )}</a>`;
}

/** A private-use sentinel that escapeHtml and the inline rules leave alone. */
const STASH = "\uE000";

/**
 * Swaps wiki tokens for sentinels before escaping, so a target can never inject
 * HTML and the remaining inline rules cannot rewrite an anchor. An unresolved
 * target is stashed back as its literal `[[target]]` characters.
 */
function stashWiki(text: string, resolve: WikiResolver): [string, string[]] {
  const kept: string[] = [];
  const stashed = text.replace(WIKI_TOKEN, (whole, raw: string) => {
    const link = resolve(raw);
    kept.push(link ? wikiAnchor(raw, link.href, link.libraryId) : escapeHtml(whole));
    return `${STASH}${kept.length - 1}${STASH}`;
  });
  return [stashed, kept];
}

function unstashWiki(text: string, kept: string[]): string {
  return text.replace(
    new RegExp(`${STASH}(\\d+)${STASH}`, "g"),
    (_m, i: string) => kept[Number(i)] ?? "",
  );
}

function inlineFormat(text: string, resolve?: WikiResolver): string {
  const [stashed, kept] = resolve ? stashWiki(text, resolve) : [text, []];
  let s = escapeHtml(stashed);
  s = s.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt: string, src: string) => {
      if (!MEDIA_SRC.test(src)) return "";
      return `<img data-media="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
    },
  );
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return kept.length > 0 ? unstashWiki(s, kept) : s;
}

/**
 * `resolveWiki` is optional on purpose: without it a `[[target]]` is ordinary
 * text, so doctrine and review previews are unaffected.
 */
export function doctrineMarkdownToHtml(
  markdown: string,
  resolveWiki?: WikiResolver,
): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;
  let inCode = false;
  const codeBuf: string[] = [];
  const para: string[] = [];

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inlineFormat(para.join(" "), resolveWiki)}</p>`);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim().startsWith("```")) {
      flushPara();
      closeLists();
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf.length = 0;
        inCode = false;
      } else {
        inCode = true;
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeLists();
      i += 1;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushPara();
      closeLists();
      const level = h[1]!.length;
      out.push(`<h${level}>${inlineFormat(h[2]!, resolveWiki)}</h${level}>`);
      i += 1;
      continue;
    }
    const ul = line.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inlineFormat(ul[1]!, resolveWiki)}</li>`);
      i += 1;
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inlineFormat(ol[1]!, resolveWiki)}</li>`);
      i += 1;
      continue;
    }
    closeLists();
    para.push(line);
    i += 1;
  }
  flushPara();
  closeLists();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  return out.join("");
}
