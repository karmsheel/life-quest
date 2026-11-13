#!/usr/bin/env node
/**
 * `npm run docs:check` — does the wiki still describe the app that ships?
 *
 * The wiki is Markdown in `docs/wiki/`. Nothing about Markdown makes it follow a
 * release, so this script turns the things that *can* be checked into a gate:
 *
 *  - the index's "Version covered" matches `apps/desktop/package.json`;
 *  - every wiki page is in the MkDocs nav, and every nav target exists;
 *  - every internal link resolves (including `../../LAWS/` and `VISION.md`);
 *  - every route in `App.tsx`, every rail label in `nav-items.ts`, every wing
 *    label and every Settings tab label appears somewhere in the wiki;
 *  - every page ends with `## Related` and links back to the wiki home;
 *  - the index links every page.
 *
 * It is deliberately pure Node with no dependencies: it must run in CI, in a
 * worktree, and inside `npm run release` before the installer is built.
 *
 * Exit codes: 0 = the wiki is current; 1 = drift (the report says where);
 * 2 = the check could not run (a source file it needs is missing).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wikiDir = path.join(repoRoot, "docs", "wiki");
const failures = [];
const checks = [];

function fail(check, detail) {
  failures.push({ check, detail });
}

function pass(check, detail) {
  checks.push({ check, detail });
}

function read(relative) {
  const file = path.join(repoRoot, relative);
  if (!fs.existsSync(file)) {
    console.error(`[docs:check] missing source file: ${relative}`);
    process.exit(2);
  }
  return fs.readFileSync(file, "utf8");
}

function wikiPages() {
  return fs
    .readdirSync(wikiDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

const pages = wikiPages();
const corpus = pages
  .map((name) => fs.readFileSync(path.join(wikiDir, name), "utf8"))
  .join("\n");
const index = fs.readFileSync(path.join(wikiDir, "index.md"), "utf8");
const pkg = JSON.parse(read("apps/desktop/package.json"));

// ---------------------------------------------------------------------------
// 1. Version
// ---------------------------------------------------------------------------
const versionLine = index.match(/Version covered:\*\*\s*LifeQuest\s+([0-9][^\s(]*)/);
if (!versionLine) {
  fail("version", "docs/wiki/index.md has no 'Version covered: LifeQuest <version>' line");
} else if (versionLine[1] !== pkg.version) {
  fail(
    "version",
    `docs/wiki/index.md says ${versionLine[1]}, apps/desktop/package.json is ${pkg.version}`,
  );
} else {
  pass("version", pkg.version);
}

// ---------------------------------------------------------------------------
// 2. MkDocs nav: every page listed, every target present
// ---------------------------------------------------------------------------
const mkdocs = read("mkdocs.yml");
const navTargets = [...mkdocs.matchAll(/^\s*-\s+[^:\n]+:\s*(\S+\.md)\s*$/gm)].map(
  (match) => match[1],
);
const navSet = new Set(navTargets);
for (const target of navTargets) {
  // releases.md is generated into the staged site from the GitHub Releases feed
  // by scripts/build-docs.mjs; it is deliberately not a source page.
  const generated = target === "releases.md";
  const exists =
    generated ||
    (target === "VISION.md" || target.startsWith("LAWS/")
      ? fs.existsSync(path.join(repoRoot, target))
      : fs.existsSync(path.join(wikiDir, target)));
  if (!exists) fail("nav", `mkdocs.yml lists ${target}, which does not exist`);
}
for (const page of pages) {
  if (!navSet.has(page)) fail("nav", `docs/wiki/${page} is not in the MkDocs nav`);
}
if (navTargets.length > 0) pass("nav", `${navTargets.length} targets`);

// ---------------------------------------------------------------------------
// 3. Internal links
// ---------------------------------------------------------------------------
const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const page of pages) {
  const file = path.join(wikiDir, page);
  const text = fs.readFileSync(file, "utf8");
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const raw = match[1];
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const target = raw.split("#")[0];
    if (!target || target.includes("<")) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      fail("links", `docs/wiki/${page} links to ${raw}, which does not exist`);
    }
  }
}
pass("links", `${pages.length} pages scanned`);

// ---------------------------------------------------------------------------
// 4. Routes from App.tsx
// ---------------------------------------------------------------------------
const appSource = read("apps/desktop/src/App.tsx");
const routes = [...appSource.matchAll(/path="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((route) => route !== "/" && route !== "*")
  .map((route) => route.replace(/\/:[^/]+/g, "/").replace(/\/$/, "") || "/");
for (const route of new Set(routes)) {
  // A route with parameters is checked by its stable prefix ("/review/"), and
  // the corpus may write it as /review/<cadence>.
  const probe = route.endsWith("/") ? route : route;
  if (!corpus.includes(probe)) {
    fail("routes", `App.tsx route ${route} is not mentioned anywhere in the wiki`);
  }
}
pass("routes", `${new Set(routes).size} routes`);

// ---------------------------------------------------------------------------
// 5. Rail labels and hrefs
// ---------------------------------------------------------------------------
const navItems = read("apps/desktop/src/components/shell/nav-items.ts");
const railLabels = [...navItems.matchAll(/label:\s*"([^"]+)"/g)].map((match) => match[1]);
const railHrefs = [...navItems.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);
for (const label of new Set(railLabels)) {
  if (!corpus.includes(label)) {
    fail("rail", `rail label "${label}" is not mentioned anywhere in the wiki`);
  }
}
for (const href of new Set(railHrefs)) {
  if (!corpus.includes(href)) {
    fail("rail", `rail route ${href} is not mentioned anywhere in the wiki`);
  }
}
pass("rail", `${new Set(railLabels).size} labels`);

// ---------------------------------------------------------------------------
// 6. Wing labels
// ---------------------------------------------------------------------------
const wingSource = read("apps/desktop/src/components/shell/wing.ts");
const wingLabels = [...wingSource.matchAll(/^\s+\w+:\s*"([^"]+)",?$/gm)].map(
  (match) => match[1],
);
for (const label of new Set(wingLabels)) {
  if (!corpus.includes(label)) {
    fail("wings", `wing label "${label}" is not mentioned anywhere in the wiki`);
  }
}
pass("wings", `${new Set(wingLabels).size} labels`);

// ---------------------------------------------------------------------------
// 7. Settings tabs
// ---------------------------------------------------------------------------
const settingsSource = read("apps/desktop/src/lib/settings-views.ts");
const settingsPage = fs.readFileSync(path.join(wikiDir, "28-settings.md"), "utf8");
const settingsLabels = [
  ...settingsSource.matchAll(/label:\s*"([^"]+)"/g),
].map((match) => match[1]);
for (const label of new Set(settingsLabels)) {
  if (!settingsPage.includes(label)) {
    fail("settings", `Settings tab "${label}" is not described in docs/wiki/28-settings.md`);
  }
}
pass("settings", `${new Set(settingsLabels).size} tabs`);

// ---------------------------------------------------------------------------
// 8. Page shape: Related + home link; index links every page
// ---------------------------------------------------------------------------
for (const page of pages) {
  if (page === "index.md") continue;
  const text = fs.readFileSync(path.join(wikiDir, page), "utf8");
  if (!/^## Related\s*$/m.test(text)) {
    fail("shape", `docs/wiki/${page} has no "## Related" section`);
  }
  if (!text.includes("./index.md")) {
    fail("shape", `docs/wiki/${page} does not link back to ./index.md`);
  }
}
for (const page of pages) {
  if (page === "index.md") continue;
  if (!index.includes(`./${page}`)) {
    fail("index", `docs/wiki/index.md does not link docs/wiki/${page}`);
  }
}
pass("shape", `${pages.length - 1} pages`);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const verbose = process.argv.includes("--verbose");
const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }, null, 2));
} else {
  for (const check of checks) {
    if (verbose) console.log(`  ok  ${check.check}: ${check.detail}`);
  }
  if (failures.length === 0) {
    console.log(`[docs:check] the wiki is current (${pages.length} pages).`);
  } else {
    console.error(`[docs:check] ${failures.length} problem(s):`);
    for (const failure of failures) {
      console.error(`  - ${failure.check}: ${failure.detail}`);
    }
    console.error(
      "\nFix the pages (or the nav) and run `npm run docs:check` again. A release will not build until this passes.",
    );
  }
}

process.exit(failures.length === 0 ? 0 : 1);
