import path from "node:path";

export const PROFILE_NAME = "lifequest";
/** Host multiplexer API port (Hermes default). 8643 is LifeQuest MCP; 8644 is the webhook adapter. */
export const DEFAULT_API_PORT = 8642;
export const RESERVED_PORTS = [8642, 8643, 8644] as const;
export const DISCOVERY_PORTS = [8642, 8644, 8645, 8650] as const;
export const MCP_URL = "http://127.0.0.1:8643/mcp";

/**
 * The stamp that marks a SOUL as this app's. `shouldSeedSoul` upgrades a stamped
 * file whatever seed wrote it, so a later wording reaches a profile that was
 * seeded by an earlier one — while a file the operator wrote themselves is still
 * never touched. Bump the number whenever COMPANION_SOUL changes.
 */
export const SOUL_STAMP = "<!-- lifequest-soul: 5 -->";

/**
 * Seeds this app has shipped. Only needed for the one-time migration of a file
 * written before SOUL_STAMP existed; a stamped file needs no entry here. Add the
 * outgoing text when the seed changes and the stamp cannot cover it.
 */
export const SOUL_SEEDS: readonly string[] = [
  // The "Why → What → How" seed, and the first dashboard seed, both unstamped.
  "You are the LifeQuest companion. Help the user set up and use LifeQuest: vaults, domains, Why → What → How, Life Map, Architecture, tasks, and the agent lock. Prefer LifeQuest MCP tools (lifequest) for map and task changes. If a tool returns LOCKED, tell the user the map is locked and do not retry writes. Do not rewrite Why, What, or How; use get_doctrine to read them. Do not flip the agent lock. You also exist in Hermes Desktop and other channels on this same profile — stay consistent.",
  // The 2026-10-08 seed, stamped 3: pre-paired framing, and the dashboard tools
  // described in prose with no vocabulary. Superseded because a schema-less door
  // plus a prose-only spec is exactly what made six sessions fail.
  `You are the LifeQuest companion — the app's own agent, pre-paired, acting as the operator with full access to this vault. Your LifeQuest tools are native to your session: in Hermes Desktop they appear as mcp__lifequest__*, and in the app's own chat the app runs them for you. You never need a credential, a handshake, or an invite code. Do not curl 127.0.0.1:8643 or 127.0.0.1:8646, do not read a bearer out of config.yaml or out of \`hermes mcp list\` (both mask it), and never register yourself as a connected agent. Personnel's pairing controls, bearers, grants, and domains exist for OTHER agents — never for you, and you cannot grant yourself anything. If a LifeQuest tool is missing from your tool list, say exactly that and stop; improvising a way in pairs you as a stranger and files a Decision the operator has to clean up.

Help the user set up and use LifeQuest: vaults, domains, Premise, Vision, Purpose, and Strategy (How), Life Map, Architecture, tasks, and the agent lock. Prefer your LifeQuest tools for map and task changes. If a tool returns LOCKED, tell the user the map is locked and do not retry writes. Do not rewrite Premise, Vision, Purpose, or Strategy (How); use get_doctrine to read them. Do not flip the agent lock. You also exist in Hermes Desktop and other channels on this same profile — stay consistent.

The Dashboard is the app's home screen (the pin board), one per domain plus one Overview — never a page. To put a table, chart, or metric on it: preview_view to check the numbers (at most three previews, then talk), then ONE save_view call carrying the spec, the domainSlug that owns the view, and the boardSlug to pin it on (null for Overview). save_view saves the view AND pins it in that one call — do not follow it with arrange_dashboard, and do not say the card is on the board unless the reply says applied: true. arrange_dashboard only reorders or unpins cards that already exist, and it takes the COMPLETE pin list from get_dashboard. A locked board takes neither: both file one pending Decision instead, so tell the operator a Decision is waiting. When a summary needs more than one figure, write ONE composed view with a "blocks" array — a metric panel, a table panel, and a chart panel of a single card, not three views. A view is a live query: never paste a number into a card, express it as a query so the card stays correct tomorrow. Never compute a dashboard figure with Python or side SQL — the query belongs in the view spec, and if you cannot express it there, say what is missing.

<!-- lifequest-soul: 3 -->`,
];

/**
 * What the companion is told about itself, written once into the profile's
 * SOUL.md and read by every channel on that profile — including Hermes Desktop,
 * where the app's per-session instructions never reach.
 *
 * The first paragraph is load-bearing and is the fix for 2026-10-08: a Hermes
 * Desktop session had no `lifequest` tools (the host gateway was still holding a
 * connection it made before the profile's bearer was repaired), so the agent
 * found the MCP URL in config.yaml, hand-rolled the handshake with curl, and —
 * having copied a token out of a masked listing — introduced itself as a new
 * agent named after the active domain. That row landed in Personnel as a paired
 * agent with no grant, and every call it made answered NO_GRANT. An agent that
 * knows it is pre-paired, and that a missing tool is a thing to report rather
 * than route around, does not do that.
 */
export const COMPANION_SOUL = `You are the LifeQuest companion — the app's own agent, pre-paired, acting as the operator with full access to this vault. Your LifeQuest tools are native to your session: in Hermes Desktop they appear as mcp__lifequest__*, and in the app's own chat the app runs them for you. You never need a credential, a handshake, or an invite code. Do not curl 127.0.0.1:8643 or 127.0.0.1:8646, do not read a bearer out of config.yaml or out of \`hermes mcp list\` (both mask it), and never register yourself as a connected agent. Personnel's pairing controls, bearers, grants, and domains exist for OTHER agents — never for you, and you cannot grant yourself anything. If a LifeQuest tool is missing from your tool list, say exactly that and stop; improvising a way in pairs you as a stranger and files a Decision the operator has to clean up.

Help the user set up and use LifeQuest: vaults, domains, Premise, Vision, Purpose, and Strategy (How), Life Map, Architecture, tasks, and the agent lock. Prefer your LifeQuest tools for map and task changes. If a tool returns LOCKED, tell the user the map is locked and do not retry writes. Do not rewrite Premise, Vision, Purpose, or Strategy (How); use get_doctrine to read them. Do not flip the agent lock. You also exist in Hermes Desktop and other channels on this same profile — stay consistent.

The Dashboard is the app's home screen (the pin board), one per domain plus one Overview — never a page, and never a script block on some other page.

MAKING A CARD. One call does the whole job: save_view, carrying 'spec', the 'domainSlug' that owns the view, and the 'boardSlug' to pin it on. It validates the spec, saves the card, and pins it — in that order, in one step. Its reply carries the card's own rows, so you can report the numbers without reading the data yourself: do NOT call list_rows or preview_view first for a plain "make me a weekly summary", and do NOT follow save_view with arrange_dashboard. Say the card is on the board only when the reply says applied: true.

The spec is a LIVE QUERY — the card re-runs it every time it is drawn, so a spec carries data and never looks: no totals, no currency symbols, no thousands separators, no markdown, no prose in a title. Its fields:
- databaseId (from list_databases or get_database), title, presentation ("table" | "bar" | "line" | "metric").
- measure ("sum" | "count" | "avg" | "last") and measureColumnId (the NUMBER column to measure; omit only for count).
- groupBy: the column whose values become the rows, e.g. "date" or "category". A metric takes none; table and bar require one; line requires a date one.
- timeBucket ("day" | "week" | "month") to collapse a date groupBy into periods. "week" is Monday-start and labels rows 2026-W41; "month" labels them 2026-10. This is how a weekly table is asked for.
- timeColumnId: the date column the window acts on, required whenever timeWindow is set.
- timeWindow: "all" (default), "this-month", "last-30-days", "this-year", or {"kind":"last-weeks","weeks":8} for a trailing week count, or {"kind":"custom","start":"YYYY-MM-DD","end":"YYYY-MM-DD"}.
- filters (array of {columnId, op, value}), sort ({by:"label"|"value", dir:"asc"|"desc"}), limit (1-50, default 12), convertToZar (finance amount measures only), span (2 for the full row).
A "weekly summary of expenses" over the finance kit is therefore ONE composed spec: databaseId "finance:transactions", and a 'blocks' array holding a metric panel (measure "sum", measureColumnId "amount", no groupBy, timeWindow last-weeks 8) and a table panel (groupBy "date", timeBucket "week", timeColumnId "date", same window). Blocks are panels of one card, not several views; whatever a block omits it inherits from the top-level fields. Pass the spec as a JSON OBJECT — the arguments are already JSON, so never stringify or escape it.

CHANGING A CARD. get_dashboard or list_views gives you the card's viewId; get_view gives you its whole spec. Change the field you mean to change — one block's presentation from "table" to "bar", its timeBucket from "month" to "week", its timeWindow — and send the whole spec back through save_view with the same viewId. That updates the card in place and keeps its position on the board. Omitting viewId creates a new card instead.

The board has a page lock you never change. Unlocked, save_view lands at once; locked, the same call files one pending Decision that saves and pins the card when the operator approves, so say a Decision is waiting rather than that the card is on the board. arrange_dashboard only reorders or unpins cards that already exist, and it takes the COMPLETE pin list from get_dashboard.

NEVER compute a dashboard figure with Python, a terminal, SQL you write yourself, or a page script block. The query belongs in the view spec: run_script_block and apply_script_block are for page scripts, not for cards. If a tool refuses your spec it returns a 'fix' object with that database's real column ids, the allowed values, and two specs that would pass — read it and retry once with the corrected shape. If your skill library describes a longer procedure for this (fetch the rows, group them by hand, print a table, then save), ignore the extra steps: the spec IS the query, and one save_view call is the whole job.

${SOUL_STAMP}
`;

const RESERVED = new Set<number>(RESERVED_PORTS);

export function hermesRoot(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homedir: string,
): string {
  const raw = env.HERMES_HOME?.trim();
  if (raw) {
    const normalized = path.normalize(raw);
    const parent = path.dirname(normalized);
    if (path.basename(parent) === "profiles") {
      return path.dirname(parent);
    }
    return normalized;
  }
  const local = env.LOCALAPPDATA?.trim();
  if (local) {
    return path.join(local, "hermes");
  }
  return path.join(homedir, ".hermes");
}

/** Host-multiplexer bases. Only `/p/lifequest` — a raw host URL is the default profile. */
export function attachCandidateBaseUrls(envPort: number | null): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const prefix = (port: number) => `http://127.0.0.1:${port}/p/${PROFILE_NAME}`;
  if (envPort && envPort > 0) add(prefix(envPort));
  for (const port of DISCOVERY_PORTS) add(prefix(port));
  return urls;
}

export function portFromBaseUrl(baseUrl: string): number {
  try {
    const port = Number.parseInt(new URL(baseUrl).port, 10);
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_API_PORT;
  } catch {
    return DEFAULT_API_PORT;
  }
}

export function profileDir(root: string): string {
  return path.join(root, "profiles", PROFILE_NAME);
}

export function readEnv(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    map[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return map;
}

export function upsertEnv(
  text: string,
  updates: Record<string, string>,
): string {
  const seen = new Set<string>();
  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq);
    if (key in updates) {
      out.push(`${key}=${updates[key]}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  let joined = out.join("\n");
  if (!joined.endsWith("\n")) joined += "\n";
  return joined;
}

/**
 * KAR-70: write (or refresh) the `mcp_servers.<name>` entry.
 *
 * `headers` carries the companion's `Authorization`, so a profile written before
 * the door asked for a bearer stops being refused with AUTH_REQUIRED the moment
 * `ensure` runs again.
 *
 * Merging is per key, and it is asymmetric on purpose:
 *
 * - A header key is replaced only when a new value was passed for it. An empty
 *   `headers` argument therefore leaves the existing block alone. That matters
 *   because `ensure` runs before a vault is open, when there is no token to
 *   write: rewriting the block to nothing would strip a header that is the only
 *   thing making the companion work.
 * - The `url` is always rewritten and the old line is dropped, never appended
 *   to, so repeated calls cannot accumulate duplicates.
 * - Every other key on the entry, and every other `mcp_servers` entry, is left
 *   exactly as it was.
 *
 * A header value is written unquoted only when it is a plain YAML scalar: a
 * token or key that starts with a YAML indicator (`{`, `[`, `*`, `&`, `!`, `%`,
 * `@`, `` ` ``, `>`, `|`, `#`, `,`, `?`, `:` …) would otherwise be read as
 * structure. Such a value is single-quoted, which escapes both indicators and
 * any embedded `'`.
 */
export function ensureMcpServer(
  yaml: string,
  name: string,
  url: string,
  headers?: Record<string, string>,
): string {
  const headerEntries = Object.entries(headers ?? {}).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  const keyRe = new RegExp(`(^|\\n)([ \\t]+)${escapeRegExp(name)}:[ \\t]*\\n`, "m");
  const match = /mcp_servers:/m.test(yaml) ? keyRe.exec(yaml) : null;

  if (match && match.index !== undefined) {
    return mergeIntoEntry(yaml, match.index + match[1]!.length, name, url, headerEntries);
  }

  const lines = [`  ${name}:`, `    url: ${url}`];
  if (headerEntries.length > 0) {
    lines.push("    headers:");
    for (const [key, value] of headerEntries) {
      lines.push(`      ${key}: ${yamlScalar(value)}`);
    }
  }
  const block = `${lines.join("\n")}\n`;
  if (/^mcp_servers:[ \t]*$/m.test(yaml) || /^mcp_servers:[ \t]*\n/m.test(yaml)) {
    return yaml.replace(/^(mcp_servers:[ \t]*)\n/m, `$1\n${block}`);
  }
  const prefix = yaml.endsWith("\n") || yaml.length === 0 ? yaml : `${yaml}\n`;
  return `${prefix}mcp_servers:\n${block}`;
}

/**
 * KAR-71: keep the profile's tool surface eager.
 *
 * Hermes' progressive tool disclosure ("tool search") replaces every MCP tool in
 * the model-visible array with the `tool_search` / `tool_describe` / `tool_call`
 * bridges and defers the rest behind them. The rule in `tools/tool_search.py`
 * (`is_deferrable_tool_name`) is categorical — ANY MCP tool defers, and there is
 * no "keep these eager" list — so the whole `lifequest` server disappears from
 * the companion's toolset the moment the bridge activates. That is a correct
 * optimisation for a thousand-tool API and a broken one for the companion,
 * which is *supposed* to see `preview_view`, `propose_view`, `get_dashboard`
 * and `arrange_dashboard` directly: it cannot plan a call to a tool it cannot
 * see, and `tool_search`'s embedded listing is not enough to guarantee it will
 * look. The symptom was the companion honestly reporting "the Dashboard-pinning
 * tools aren't available in my current toolset" while the door advertised all
 * 61 of them.
 *
 * `load_config()` resolves `$HERMES_HOME/config.yaml` under the per-turn profile
 * override the multiplexed gateway installs (`gateway/run.py`
 * `_profile_runtime_scope`), so this line in the PROFILE config un-defers the
 * companion alone. The operator's other eleven profiles keep progressive
 * disclosure, and the root config is never touched.
 *
 * An explicit `tools.tool_search.enabled` line is replaced in place; a profile
 * that has no `tools:` block gets one. Written plain (`off`, never quoted) so
 * `_tri_state` reads it as the tri-state it is.
 */
export function ensureEagerToolSearch(yaml: string): string {
  const nl = lineBreak(yaml);
  // Anchored to the `tools:` parent, and to the two-space indent every writer of
  // this file uses. Only the `tool_search:` ENTRY line is matched here; its
  // children are walked line by line below, because a regex spanning them would
  // also span the entry's siblings — `tools:` children all sit at the same
  // indent, so `enabled:` of a sibling block would match as if it were ours.
  const entry = /^tools:[ \t]*\r?\n([ \t]+)tool_search:[ \t]*(\r?\n|$)/m.exec(yaml);
  if (entry) {
    const indent = entry[1] ?? "  ";
    const childIndent = `${indent}  `;
    // The block ends at the first non-blank line at the entry's own indent or
    // shallower: the next sibling of `tool_search:`, or the next top-level key.
    // Blank lines inside the block stay inside it.
    const body = yaml.slice(entry.index + entry[0].length);
    let blockEnd = body.length;
    let scan = 0;
    while (scan < body.length) {
      const lineEnd = body.indexOf("\n", scan);
      const line = lineEnd < 0 ? body.slice(scan) : body.slice(scan, lineEnd + 1);
      const trimmed = line.replace(/\r?\n$/, "").trim();
      if (trimmed !== "") {
        const own = /^([ \t]*)/.exec(line)?.[1] ?? "";
        if (own.length <= indent.length) {
          blockEnd = scan;
          break;
        }
      }
      if (lineEnd < 0) break;
      scan = lineEnd + 1;
    }
    const children = body.slice(0, blockEnd);

    const enabledRe = new RegExp(`^${childIndent}enabled:[ \\t]*(.*)$`, "m");
    const enabledLine = enabledRe.exec(children);
    if (enabledLine) {
      if (enabledLine[1]?.trim() === "off") return yaml;
      return (
        yaml.slice(0, entry.index + entry[0].length) +
        children.replace(enabledRe, `${childIndent}enabled: off`) +
        body.slice(blockEnd)
      );
    }
    // A `tool_search:` block with no `enabled` key: add one as its first child.
    return (
      yaml.slice(0, entry.index + entry[0].length) +
      `${childIndent}enabled: off${nl}` +
      children +
      body.slice(blockEnd)
    );
  }

  if (hasTopLevelKey(yaml, "tools")) {
    return yaml.replace(
      /^tools:[ \t]*\r?\n/m,
      (line) => `${line}  tool_search:${nl}    enabled: off${nl}`,
    );
  }
  const block = `tools:${nl}  tool_search:${nl}    enabled: off${nl}`;
  const prefix = yaml.length === 0 || yaml.endsWith("\n") ? yaml : `${yaml}${nl}`;
  return `${prefix}${block}`;
}

/**
 * Rewrite one existing entry in place. Its block runs from the entry key to the
 * next line at that key's indent or shallower, which is where the next sibling
 * `mcp_servers` entry — or the next top-level key — starts.
 *
 * The walk keeps three things apart: the entry's own `url` (dropped, because
 * ours is written back), its `headers:` block (its keys are merged, not
 * replaced), and everything else (kept, in order).
 */
function mergeIntoEntry(
  yaml: string,
  start: number,
  name: string,
  url: string,
  headerEntries: [string, string][],
): string {
  const lines = yaml.split("\n");
  const startLine = yaml.slice(0, start).split("\n").length - 1;
  const indent = /^([ \t]*)/.exec(lines[startLine] ?? "")?.[1] ?? "  ";
  const fieldIndent = `${indent}  `;
  const headerIndent = `${fieldIndent}  `;

  let end = startLine + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() !== "") {
      const own = /^([ \t]*)/.exec(line)?.[1] ?? "";
      if (own.length <= indent.length) break;
    }
    end += 1;
  }

  // Headers already on the entry, and the lines of that block, kept unless a new
  // value replaces the key.
  const keptHeaders: [string, string][] = [];
  const other: string[] = [];

  let i = startLine + 1;
  while (i < end) {
    const line = lines[i] ?? "";
    const own = /^([ \t]*)/.exec(line)?.[1] ?? "";
    if (own.length === fieldIndent.length && /^url:/.test(line.trim())) {
      i += 1; // dropped: ours is written back below
      continue;
    }
    if (own.length === fieldIndent.length && /^headers:/.test(line.trim())) {
      i += 1;
      while (i < end) {
        const next = lines[i] ?? "";
        const nextIndent = /^([ \t]*)/.exec(next)?.[1] ?? "";
        if (next.trim() !== "" && nextIndent.length <= fieldIndent.length) break;
        const colon = next.indexOf(":");
        if (next.trim() !== "" && nextIndent.length === headerIndent.length && colon > 0) {
          const key = next.slice(nextIndent.length, colon).trim();
          keptHeaders.push([key, next.slice(colon + 1).trim()]);
        }
        i += 1;
      }
      continue;
    }
    other.push(line);
    i += 1;
  }

  const merged = new Map<string, string>(keptHeaders);
  for (const [key, value] of headerEntries) merged.set(key, value);
  const headers = [...merged.entries()];

  const rebuilt = [`${indent}${name}:`, `${fieldIndent}url: ${url}`];
  if (headers.length > 0) {
    rebuilt.push(`${fieldIndent}headers:`);
    for (const [key, value] of headers) {
      rebuilt.push(`${headerIndent}${key}: ${yamlScalar(value)}`);
    }
  }
  // The entry's other keys go after ours: a `headers:` block written above them
  // would swallow them as its children.
  return [...lines.slice(0, startLine), ...rebuilt, ...other, ...lines.slice(end)].join("\n");
}

/** Render a header value as a YAML scalar, quoted only when it has to be. */
function yamlScalar(value: string): string {
  // A value that was already quoted stays as it is rather than being requoted.
  if (/^'.*'$/.test(value)) return value;
  if (/^[A-Za-z0-9][A-Za-z0-9 ._/@=+-]*$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function lineBreak(yaml: string): "\r\n" | "\n" {
  return yaml.includes("\r\n") ? "\r\n" : "\n";
}

function hasTopLevelKey(yaml: string, key: string): boolean {
  return new RegExp(`(?:^|\\n)${key}:[ \\t]*\\r?(?:\\n|$)`).test(yaml);
}

/**
 * Copy the root Hermes `model:` block onto a profile that has none.
 * A profile that already chose a model keeps it. The copy stops at the next
 * top-level key, so the rest of the root config stays where it is.
 */
export function seedModelFromRoot(profileYaml: string, rootYaml: string): string {
  if (hasTopLevelKey(profileYaml, "model")) return profileYaml;
  const lines = rootYaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^model:[ \t]*$/.test(line));
  if (start < 0) return profileYaml;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() !== "" && !/^[ \t]/.test(line)) break;
    end += 1;
  }
  const nl = lineBreak(profileYaml.length > 0 ? profileYaml : rootYaml);
  const block = lines.slice(start, end).join(nl).replace(/\s+$/, "");
  const base =
    profileYaml.length === 0 || profileYaml.endsWith("\n")
      ? profileYaml
      : `${profileYaml}${nl}`;
  return `${base}${block}${nl}`;
}

/**
 * Write the companion Authorization onto a root config that already lists
 * `mcp_servers.lifequest`. A root config with no such server is left untouched,
 * and an entry that already has Authorization is left untouched.
 *
 * The root file is often CRLF. This inserts lines with that same break and
 * does not rewrite the rest of the file.
 */
export function ensureRootCompanionHeader(
  rootYaml: string,
  authorization: string,
): string {
  const lines = rootYaml.split(/\r?\n/);
  const start = lines.findIndex((line, index) => {
    if (!/^ {2}lifequest:[ \t]*$/.test(line)) return false;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      if ((lines[earlier] ?? "").trim() === "") continue;
      return /^mcp_servers:[ \t]*$/.test(lines[earlier] ?? "");
    }
    return false;
  });
  if (start < 0) return rootYaml;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() !== "" && !/^[ \t]/.test(line)) break;
    if (/^ {2}\S/.test(line)) break;
    end += 1;
  }
  const block = lines.slice(start, end);
  if (block.some((line) => /^\s*Authorization:/.test(line))) return rootYaml;
  let insertAt = end;
  while (insertAt > start + 1 && (lines[insertAt - 1] ?? "").trim() === "") {
    insertAt -= 1;
  }
  const nl = lineBreak(rootYaml);
  const next = [
    ...lines.slice(0, insertAt),
    "    headers:",
    `      Authorization: ${yamlScalar(authorization)}`,
    ...lines.slice(insertAt),
  ];
  const joined = next.join(nl);
  if (rootYaml.endsWith("\n") && !joined.endsWith("\n")) return joined + nl;
  return joined;
}

/**
 * Seed a missing soul, and upgrade one this app wrote in an earlier wording.
 *
 * An operator may have edited theirs, and overwriting that would discard their
 * words — so a file is only replaced when it is ours: empty, stamped with
 * SOUL_STAMP (any version), or still byte-equal to a seed in SOUL_SEEDS. A soul
 * with the operator's own words in it fails all three and is left alone, which
 * is why a changed seed is a deliberate act with a stamp bump and not something
 * this function does on its own.
 *
 * Without the upgrade a profile seeded long ago keeps its first wording forever
 * — which is how a Hermes Desktop session in October 2026 still believed the
 * dashboard tool was `propose_view` months after `save_view` replaced it, and
 * had never been told it was pre-paired.
 */
export function shouldSeedSoul(existing: string | null): boolean {
  if (existing === null || existing.trim() === "") return true;
  if (existing.includes("lifequest-soul:")) return true;
  const seen = existing.trim();
  return SOUL_SEEDS.some((seed) => seed.trim() === seen);
}

/**
 * The model a profile's config pins, if it names one. Only `model.default`
 * matters here — provider and base_url stay whatever the operator set.
 */
export function pinnedModel(configYaml: string): string | null {
  const match = /^  default: (.+)$/m.exec(configYaml.split(/^model:/m)[1] ?? "");
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  return value ? value : null;
}

/**
 * The models catalog URL for the profile's pinned provider. Only chat_completions
 * providers with a known shape are probed; anything else returns null and the
 * check is skipped rather than guessed.
 */
export function modelsUrlFromConfig(configYaml: string): string | null {
  const base = /base_url:\s*(.+)$/m.exec(configYaml)?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/models`;
}

export type ModelCheck =
  | { kind: "ok" }
  | { kind: "no-model" }
  | { kind: "unreachable" }
  | { kind: "retired"; model: string };

/**
 * Startup probe: is the profile's pinned model still live? A retired model id
 * made every companion chat end before finishing — a 404 on the first call,
 * with no visible reason in the app. `modelsUrl` is the provider's catalog
 * endpoint (e.g. the Nous inference API's /v1/models); the check is a plain
 * GET with the chat key, exactly what the model call itself would do.
 *
 * Unreachable is NOT a verdict: a gateway that is briefly down must not
 * have its model declared dead. Only a listed catalog without the id is one.
 */
export async function checkPinnedModel(
  configYaml: string,
  modelsUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ModelCheck> {
  const model = pinnedModel(configYaml);
  if (!model) return { kind: "no-model" };
  let ids: unknown;
  try {
    const res = await fetchImpl(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { kind: "unreachable" };
    ids = (await res.json()) as unknown;
  } catch {
    return { kind: "unreachable" };
  }
  const listed = Array.isArray((ids as { data?: unknown }).data)
    ? ((ids as { data: Array<{ id?: unknown }> }).data)
    : Array.isArray(ids)
      ? (ids as unknown[])
      : [];
  const known = new Set(
    listed
      .map((m) => (m && typeof m === "object" ? (m as { id?: unknown }).id : m))
      .filter((v): v is string => typeof v === "string"),
  );
  return known.has(model) ? { kind: "ok" } : { kind: "retired", model };
}

export function nextFreePort(taken: Set<number>, start: number): number {
  let port = start;
  const limit = start + 100;
  while (port <= limit) {
    if (!taken.has(port) && !RESERVED.has(port)) return port;
    port += 1;
  }
  let fallback = start + 100;
  while (RESERVED.has(fallback) || taken.has(fallback)) fallback += 1;
  return fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
