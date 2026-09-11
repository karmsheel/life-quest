const MEDIA_SRC = /^media\/[A-Za-z0-9._-]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt: string, src: string) => {
      if (!MEDIA_SRC.test(src)) return "";
      return `<img data-media="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
    },
  );
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noopener noreferrer">$1</a>',
  );
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return s;
}

export function doctrineMarkdownToHtml(markdown: string): string {
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
    out.push(`<p>${inlineFormat(para.join(" "))}</p>`);
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
      out.push(`<h${level}>${inlineFormat(h[2]!)}</h${level}>`);
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
      out.push(`<li>${inlineFormat(ul[1]!)}</li>`);
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
      out.push(`<li>${inlineFormat(ol[1]!)}</li>`);
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
