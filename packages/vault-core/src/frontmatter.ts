/**
 * Read one `- item` line of a frontmatter block sequence.
 *
 * The writer leaves a URL bare (it contains no YAML punctuation that this
 * reader treats specially) and quotes an item that would otherwise read as a
 * comment or a nested structure. Double quotes are read back with JSON, which
 * is the same spelling `formatValue` uses for a quoted scalar.
 */
function readSequenceItem(text: string): string {
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Not the writer's JSON spelling; keep the text as the operator typed it.
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

/**
 * The items of a `key:` block sequence starting at `start`, if there is one.
 *
 * A sequence is the YAML list the project writer emits:
 *
 *     repoUrls:
 *       - https://github.com/owner/repo
 *
 * Only lines immediately below the bare key are read; the first line that is
 * not an item ends the sequence. A key whose value stayed empty because no
 * sequence followed keeps reading as the empty scalar it always did.
 */
function readSequence(
  lines: string[],
  start: number,
): { items: string[]; next: number } | null {
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const match = /^\s*-(?:\s+(.*))?\s*$/.exec(lines[i] ?? "");
    if (!match) break;
    items.push(readSequenceItem((match[1] ?? "").trim()));
    i += 1;
  }
  return i > start ? { items, next: i } : null;
}

export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { data: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: raw };
  const yamlBlock = raw.slice(4, end).replace(/\r/g, "");
  const after = raw.slice(end + 4);
  const body = after.startsWith("\n")
    ? after.slice(1)
    : after.startsWith("\r\n")
      ? after.slice(2)
      : after;
  const data: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    // An item cannot be a key: it belongs to the sequence its `key:` line
    // started, and a stray one names nothing.
    if (/^\s*-(\s|$)/.test(line)) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value === "") {
      const sequence = readSequence(lines, i + 1);
      if (sequence) {
        data[key] = sequence.items;
        i = sequence.next - 1;
        continue;
      }
    }
    if (value === "null") {
      data[key] = null;
    } else if (value === "true") {
      data[key] = true;
    } else if (value === "false") {
      data[key] = false;
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      data[key] = value.slice(1, -1);
    } else if (value.startsWith("{") || value.startsWith("[")) {
      try {
        data[key] = JSON.parse(value);
      } catch {
        data[key] = value;
      }
    } else {
      data[key] = value;
    }
  }
  return { data, body };
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (s === "" || /[:#\n]/.test(s) || s.includes(" ")) return JSON.stringify(s);
  return s;
}

/**
 * A plain scalar list is written as YAML block sequence, one item per line —
 * the form the project writer's `repoUrls` is meant to be read in, not a
 * one-line JSON array. JSON stays the spelling for an empty list and for the
 * structured timelines (`updates`, `scopes`), where a block sequence would have
 * to spell out maps.
 */
function isPlainScalarList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((item) => typeof item === "string");
}

/** An item that would start a comment, a nested collection or a quoted scalar is quoted. */
function formatSequenceItem(item: string): string {
  if (
    item === "" ||
    /^[\s\-?#\[\]{}&*!|>'"%@`]/.test(item) ||
    item.includes(": ") ||
    item.includes(" #") ||
    /\s$/.test(item) ||
    /[\r\n]/.test(item)
  ) {
    return JSON.stringify(item);
  }
  return item;
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const lines: string[] = [];
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (isPlainScalarList(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${formatSequenceItem(item)}`);
    } else {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }
  const normalizedBody = body.endsWith("\n") || body === "" ? body : `${body}\n`;
  return `---\n${lines.join("\n")}\n---\n${normalizedBody}`;
}
