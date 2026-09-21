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
  for (const line of yamlBlock.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
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

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const keys = Object.keys(data);
  const lines = keys.map((k) => `${k}: ${formatValue(data[k])}`);
  const normalizedBody = body.endsWith("\n") || body === "" ? body : `${body}\n`;
  return `---\n${lines.join("\n")}\n---\n${normalizedBody}`;
}
