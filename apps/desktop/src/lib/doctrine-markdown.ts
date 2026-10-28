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
/**
 * Every sentinel the stashing above mints. Input may never carry one: a vault
 * file that spelled `\uE0000\uE000` itself would be indistinguishable from a
 * placeholder this renderer created, and would be "expanded" wherever the
 * pipeline carried it. So the characters are removed before parsing.
 */
const SENTINEL_CHARS = /[\uE000-\uE002]/g;

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

/**
 * A stashed wiki token: the anchor to put back, and the literal text it stands
 * for when the placeholder ends up somewhere an anchor cannot go (an attribute
 * value — see `expandSentinels`).
 */
type WikiStash = { html: string; text: string };

/**
 * Swaps wiki tokens for sentinels before escaping, so a target can never inject
 * HTML and the remaining inline rules cannot rewrite an anchor. An unresolved
 * target is stashed back as its literal `[[target]]` characters.
 */
function stashWiki(text: string, resolve: WikiResolver): [string, WikiStash[]] {
  const kept: WikiStash[] = [];
  const stashed = text.replace(WIKI_TOKEN, (whole, raw: string) => {
    const link = resolve(raw);
    // `text` is the token as it should print when it is not expanded: escaped
    // here because this function runs before the escaping pass.
    kept.push({
      html: link ? wikiAnchor(raw, link.href, link.libraryId) : escapeHtml(whole),
      text: escapeHtml(whole),
    });
    return `${STASH}${kept.length - 1}${STASH}`;
  });
  return [stashed, kept];
}

/**
 * Puts the stashed HTML back — but only where HTML reads text as text.
 *
 * The placeholders travel through the inline pipeline as ordinary characters,
 * so a link or image rule can carry one into an attribute value. That is how a
 * wiki token written inside a markdown link's URL used to be expanded into
 * `href="…"`: the anchor's own quotes ended the attribute early, the rest of
 * the template (`target="_blank" rel="noopener noreferrer"`) printed as text,
 * and the surviving `<a>` had no target and so navigated the privileged window
 * in place. Outside a tag, expand to the anchor (or `<u>`); inside a tag,
 * expand to the escaped literal token the placeholder stood for, which can
 * never contain a quote or an angle bracket. Nothing an attacker writes can
 * therefore put HTML inside an attribute this renderer generates.
 *
 * The tag scan is sound because raw `<` and `>` in this pipeline only come from
 * tags the renderer generated: every character of untrusted text has already
 * been escaped, and the expansions appended here are whole, balanced elements.
 */
function expandSentinels(s: string, kept: readonly WikiStash[]): string {
  let out = "";
  let i = 0;
  let inTag = false;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "<") {
      inTag = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === UNDERLINE_OPEN) {
      if (!inTag) out += "<u>";
      i += 1;
      continue;
    }
    if (ch === UNDERLINE_CLOSE) {
      if (!inTag) out += "</u>";
      i += 1;
      continue;
    }
    if (ch === STASH) {
      let j = i + 1;
      let digits = "";
      while (j < s.length && s[j]! >= "0" && s[j]! <= "9") {
        digits += s[j]!;
        j += 1;
      }
      const placeholder = digits !== "" && s[j] === STASH;
      const entry = placeholder ? kept[Number(digits)] : undefined;
      if (entry) out += inTag ? entry.text : entry.html;
      // A sentinel that is not one of ours was blanked out of the input, so it
      // can only be a stray: skip the whole placeholder, or just the character.
      i = placeholder ? j + 1 : i + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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
  return expandSentinels(s, kept);
}

/**
 * `resolveWiki` is optional on purpose: without it a `[[target]]` is ordinary
 * text, so doctrine and review previews are unaffected.
 */
export function doctrineMarkdownToHtml(
  markdown: string,
  resolveWiki?: WikiResolver,
): string {
  // The private-use characters below are this renderer's own placeholders, so
  // input may never spell one: blanked out first, a vault file cannot forge a
  // placeholder that the pipeline would later expand into HTML.
  const lines = stripComments(markdown.replace(SENTINEL_CHARS, ""))
    .replace(/\r\n/g, "\n")
    .split("\n");
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
