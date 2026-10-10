/**
 * The page in front of the chat, read off the screen the operator is looking at.
 *
 * This is the app's own version of what a browser side panel does: the screen
 * the operator sees is the screen the agent is told about, so "add me an expense
 * summary" cannot be answered by offering to build the expense summary that is
 * already there. The dock asks this module for the page on the way out of the
 * composer, once per turn, so what rides the turn is what was on screen when the
 * operator pressed send — not a stale copy taken when the panel opened.
 *
 * Two facts make the read cheap and honest:
 *
 *  - **The root is declared, not guessed.** `AppShell` marks its content column
 *    with `data-page-context-root`. The nav rail, the title bar and the chat
 *    panel itself are outside it, so no selector heuristic has to decide what
 *    "the page" is — and a harness with no shell publishes an empty body rather
 *    than a guess at the whole document.
 *  - **The outline is structural, not a text dump.** Headings, tables, lists and
 *    the page's own leaf text are lifted into a compact shape with a character
 *    budget. That is what keeps a rendered dashboard's card titles and their
 *    figures in the read while the styling, the icons and the empty wrappers
 *    stay out of it.
 *
 * Everything here is untrusted data by the time it reaches a model: it is the
 * operator's own content, quoted. The fencing that says so lives in
 * `pageContextLine` in `electron/companion-client.ts`, next to every other
 * instruction; this module only reads.
 */
import { NAV_ITEMS } from "@/components/shell/nav-items";
import type { PageContextInput } from "@/vite-env";

/** The attribute `AppShell` puts on the one column that is the page. */
export const PAGE_CONTEXT_ROOT_ATTR = "data-page-context-root";
export const PAGE_CONTEXT_ROOT_SELECTOR = `[${PAGE_CONTEXT_ROOT_ATTR}]`;

/**
 * How much of the page may ride one turn, in characters.
 *
 * A dashboard of composed cards runs a few hundred characters; a database page
 * with a wide table is where the budget actually bites. Four thousand is well
 * under the smallest context window the composer offers, and the tail is
 * truncated with a note rather than silently dropped — a reader (or a model)
 * that is told the outline was cut knows to go and query for the rest.
 */
export const PAGE_CONTEXT_BUDGET = 4000;

/** How many rows of any one table, and how many list items, are quoted. */
const TABLE_ROW_LIMIT = 12;
const LIST_ITEM_LIMIT = 16;
/** A hard stop on the walk, so a pathological page cannot stall a send. */
const NODE_LIMIT = 6000;

/**
 * Elements whose text is not page content: it is markup, chrome, or pixels.
 *
 * A button is skipped for a subtler reason than a canvas is. A control's label
 * is an affordance — the view card's own row says "Metric | Table | Bar | Line",
 * which is a picker, and quoted into a turn those four words read exactly like
 * four charts that are on the screen. Skipping buttons is what keeps "what this
 * page shows" from drifting into "what this page offers". Links are kept: a
 * link's text is usually the name of a thing the page is about, and a list of
 * links is how several screens in this app display their contents.
 */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
  "PATH",
  "CANVAS",
  "IFRAME",
  "OBJECT",
  "AUDIO",
  "VIDEO",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "BUTTON",
]);

/**
 * What the rail calls the route the operator is on.
 *
 * The rail's own table is the source: a page is named the way the operator sees
 * it named, so the pill and the instruction both say "Dashboard" rather than
 * "/home". Exact matches win, then the longest href the route is nested under —
 * `/data/:slug/:dbId` is the Data screen, and `/review/weekly` is Weekly rather
 * than the Weekly whose href is shorter than Daily's.
 *
 * A route the rail does not carry — Settings, Welcome — is named here, and
 * anything else falls back to a phrase that is true of every route.
 */
const OFF_RAIL_LABELS: Record<string, string> = {
  "/settings": "Settings",
  "/welcome": "Welcome",
  "/domains": "Settings",
};

export function pageLabelFor(pathname: string): string {
  const route = normalizeRoute(pathname);
  const exact = NAV_ITEMS.find((item) => normalizeRoute(item.href) === route);
  if (exact) return exact.label;
  const offRail = OFF_RAIL_LABELS[route];
  if (offRail) return offRail;
  const nested = NAV_ITEMS.filter((item) => {
    const href = normalizeRoute(item.href);
    return route.startsWith(`${href}/`);
  }).sort((a, b) => b.href.length - a.href.length)[0];
  return nested ? nested.label : "This page";
}

/** A route as it is compared: one leading slash, no trailing slash, no query. */
function normalizeRoute(pathname: string): string {
  const bare = (pathname.split("?")[0] ?? "").split("#")[0] ?? "";
  if (!bare || bare === "/") return "/";
  return bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

/**
 * The page the operator is on right now, ready to ride a turn.
 *
 * `route` and `label` are known even when nothing is mounted — a harness, or a
 * page that has not committed yet — and the body is then empty, which the
 * instruction reads as "ask" rather than as "the screen is empty". That
 * distinction matters: an empty body is an absence of evidence, and the one
 * thing this feature must never do is give the agent a reason to invent a
 * screen.
 */
export function readPageContext(
  pathname: string,
  root: Element | null = typeof document === "undefined"
    ? null
    : document.querySelector(PAGE_CONTEXT_ROOT_SELECTOR),
): PageContextInput {
  return {
    route: normalizeRoute(pathname),
    label: pageLabelFor(pathname),
    body: capturePageOutline(root),
  };
}

/**
 * The page's own contents, flattened into lines, within the budget.
 *
 * The walk is depth-first and stops at each thing it knows how to say — a
 * heading, a table, a list, an image — so a card's title is one line and its
 * table is its own block rather than the same words twice. An element with no
 * element children is the page's leaf text: a paragraph, a badge, a figure.
 */
export function capturePageOutline(
  root: Element | null,
  budget: number = PAGE_CONTEXT_BUDGET,
): string {
  if (!root) return "";
  const lines: string[] = [];
  const seen = new Set<string>();
  let visited = 0;
  let truncated = false;
  let used = 0;

  const push = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    // A row is allowed to repeat — two weeks can both total the same — so only
    // whole lines that are not rows are de-duplicated.
    const isRow = trimmed.startsWith("- ");
    if (!isRow) {
      if (seen.has(trimmed)) return true;
      seen.add(trimmed);
    }
    if (used + trimmed.length + 1 > budget) {
      truncated = true;
      return false;
    }
    lines.push(trimmed);
    used += trimmed.length + 1;
    return true;
  };

  const walk = (node: Element): boolean => {
    for (const child of Array.from(node.children)) {
      if (visited++ > NODE_LIMIT) {
        truncated = true;
        return false;
      }
      if (shouldSkip(child)) continue;
      const said = linesFor(child);
      if (said) {
        for (const line of said) {
          if (!push(line)) return false;
        }
        continue;
      }
      if (!walk(child)) return false;
    }
    return true;
  };

  const complete = walk(root);
  if (truncated || !complete) {
    lines.push(
      "[the outline of this page was cut off here — read the rest with a tool rather than assuming it is absent]",
    );
  }
  return lines.join("\n");
}

/**
 * Whether an element is something other than the page's content.
 *
 * A page may mark any subtree it does not want quoted — a canvas of controls, a
 * hidden measurement node — with `data-page-context="ignore"`; `aria-hidden`
 * and `hidden` are honoured because both already mean "this is not for a
 * reader". Icons and form controls are skipped by tag, and a button is skipped
 * wherever it is spelled — as a `<button>` or as a `[role="button"]` — because
 * a control's label is an offer, not a thing the page is showing.
 */
function shouldSkip(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.getAttribute("role") === "button") return true;
  if (el.getAttribute("data-page-context") === "ignore") return true;
  return false;
}

/**
 * What one element has to say, or null when the answer is "ask my children".
 *
 * The return is a list because a table is a block of lines, not a line: the
 * caller's budget then applies to the table as a whole, and a table that runs
 * over the budget is cut like anything else.
 */
function linesFor(el: Element): string[] | null {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const text = headingText(el);
    return text ? [`${"#".repeat(Number(tag[1]))} ${text}`] : [];
  }
  if (tag === "TABLE") return tableLines(el);
  if (tag === "UL" || tag === "OL") return listLines(el);
  if (tag === "DL") return listLines(el);
  if (tag === "IMG") {
    const alt = el.getAttribute("alt")?.trim();
    return alt ? [`[image] ${alt}`] : null;
  }
  if (el.childElementCount === 0) {
    const text = ownText(el);
    return text ? [text] : [];
  }
  return null;
}

/** A table as its caption, its headers, and a bounded number of its rows. */
function tableLines(el: Element): string[] {
  const lines: string[] = [];
  const caption = ownText(el.querySelector("caption"));
  const headers = Array.from(el.querySelectorAll("thead th"))
    .map((th) => ownText(th))
    .filter(Boolean);
  const head = [caption ? `${caption}:` : "table", headers.join(" | ")]
    .filter(Boolean)
    .join(" ");
  lines.push(`[table] ${head}`.trim());
  const rows = Array.from(el.querySelectorAll("tbody tr, tr")).filter(
    (tr) => tr.querySelector("td") !== null,
  );
  for (const row of rows.slice(0, TABLE_ROW_LIMIT)) {
    const cells = Array.from(row.querySelectorAll("td")).map((td) => ownText(td));
    if (cells.some(Boolean)) lines.push(`- ${cells.join(" | ")}`);
  }
  if (rows.length > TABLE_ROW_LIMIT) {
    lines.push(`[${rows.length - TABLE_ROW_LIMIT} more row(s) in this table]`);
  }
  return lines;
}

/** A list — or a description list, whose terms and values pair the same way. */
function listLines(el: Element): string[] {
  const items =
    el.tagName === "DL"
      ? Array.from(el.querySelectorAll("dt, dd")).map((n) => ownText(n))
      : Array.from(el.children)
          .filter((child) => child.tagName === "LI")
          .map((li) => ownText(li));
  const kept = items.filter(Boolean).slice(0, LIST_ITEM_LIMIT);
  const lines = kept.map((item) => `- ${item}`);
  if (items.filter(Boolean).length > LIST_ITEM_LIMIT) {
    lines.push(`[${items.length - LIST_ITEM_LIMIT} more item(s) in this list]`);
  }
  return lines;
}

/**
 * A heading's own words.
 *
 * A heading often paints a badge beside its title, as the Dashboard does —
 * `<h1>Overview<span>Unlocked</span></h1>` — and `textContent` alone welds the
 * two into "OverviewUnlocked". So a heading is assembled from its own parts,
 * each joined with a space. Only headings do this: on a table cell the same
 * trick would break "1<span>,</span>111" apart into "1 ,111".
 */
function headingText(el: Element): string {
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    if (shouldSkip(child)) continue;
    const text = ownText(child);
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

/**
 * The text of one element, with its own layout flattened out.
 *
 * `textContent` rather than `innerText`: this runs while the operator is
 * sending, and `innerText` forces a layout pass for every node it is called on.
 * Hidden subtrees are already skipped by `shouldSkip`, so the difference is
 * whitespace and the small amount of text a collapsed element holds — which is
 * better quoted than silently lost.
 */
function ownText(el: Element | null): string {
  if (!el) return "";
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}
