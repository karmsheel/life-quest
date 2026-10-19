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
/** The two ends of the one HTML tag this renderer passes through: `<u>`. */
const UNDERLINE_OPEN = "\uE001";
const UNDERLINE_CLOSE = "\uE002";

/** One line of a pipe table: it opens and closes with a pipe. */
const PIPE_ROW = /^\s*\|.*\|\s*$/;
/** One cell of a table's delimiter row: dashes, with optional alignment colons. */
const TABLE_DELIM_CELL = /^:?-{2,}:?$/;

/**
 * One table row's cells.
 *
 * The cell separator is a pipe that is not escaped, because the app's own
 * snapshot writer escapes a literal pipe inside a cell as `\|` — and splitting
 * on every pipe would turn a merchant called "A|B" into two columns.
 */
function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/**
 * `<!-- ... -->` is not prose.
 *
 * The review system marks the blocks it fills in with HTML comments, and a
 * marker that printed as text would be worse than no marker at all: the operator
 * would read the app's own bookkeeping in the middle of their review. Obsidian
 * hides them in preview too, so hiding them is also the behaviour a markdown
 * writer already expects. A comment is removed before anything else looks at the
 * line, so a comment holding a blank line cannot open a paragraph by itself.
 */
function stripComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Swaps `<u>` and `</u>` for sentinels before escaping.
 *
 * Underline has no markdown syntax, so the file carries the HTML tag — and this
 * renderer escapes all HTML, which would print `<u>bold</u>` literally with the
 * tags showing. The tags are lifted out, the rest is escaped as usual, and the
 * two ends are put back as real elements afterwards.
 */
function stashUnderline(text: string): string {
  return text
    .replace(/<u>/gi, UNDERLINE_OPEN)
    .replace(/<\/u>/gi, UNDERLINE_CLOSE);
}

function unstashUnderline(text: string): string {
  return text
    .replace(new RegExp(UNDERLINE_OPEN, "g"), "<u>")
    .replace(new RegExp(UNDERLINE_CLOSE, "g"), "</u>");
}

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
  let s = escapeHtml(stashUnderline(stashed));
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
  // Double marks first, and each guarded from the single-mark rule: `**bold**`
  // must not be read as an italic span containing `*bold*`, and `_a_b_` in an
  // identifier must not become an italic run.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\w)__([^_]+)__(?!\w)/g, "<strong>$1</strong>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  s = s.replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "<em>$1</em>");
  s = unstashUnderline(s);
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
  const lines = stripComments(markdown).replace(/\r\n/g, "\n").split("\n");
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
    // A paragraph that prints nothing is not a paragraph. This is what keeps a
    // marker comment, a `<!-- ... -->` the renderer has just removed, from
    // leaving an empty line where the app's own bookkeeping was.
    if (para.join(" ").trim() === "") {
      para.length = 0;
      return;
    }
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
    // A pipe table. This matters to the review more than anywhere else: the
    // figures the app fills into a review are tables, and one drawn as a
    // paragraph of pipes and dashes is worse than not filling it in.
    if (PIPE_ROW.test(line)) {
      flushPara();
      closeLists();
      const rows: string[][] = [];
      while (i < lines.length && PIPE_ROW.test(lines[i]!)) {
        rows.push(tableCells(lines[i]!));
        i += 1;
      }
      // The second row is the delimiter — `| --- | --- |` — exactly when every
      // one of its cells is dashes with optional alignment colons.
      const delimiter = rows.length >= 2 && rows[1]!.every((c) => TABLE_DELIM_CELL.test(c));
      const head = delimiter ? rows[0]! : null;
      const bodyRows = delimiter ? rows.slice(2) : rows;
      out.push("<table>");
      if (head && head.length > 0) {
        out.push(
          `<thead><tr>${head
            .map((c) => `<th scope="col">${inlineFormat(c, resolveWiki)}</th>`)
            .join("")}</tr></thead>`,
        );
      }
      out.push("<tbody>");
      for (const row of bodyRows) {
        out.push(
          `<tr>${row.map((c) => `<td>${inlineFormat(c, resolveWiki)}</td>`).join("")}</tr>`,
        );
      }
      out.push("</tbody></table>");
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
