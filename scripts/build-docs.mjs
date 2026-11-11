#!/usr/bin/env node
/**
 * Stage the LifeQuest wiki for MkDocs.
 *
 * The wiki lives in `docs/wiki/` and its pages link to repo-root files such as
 * `../../LAWS/DASHBOARD.md` and `../../VISION.md`. MkDocs can only serve files
 * inside its `docs_dir`, so this script builds `.docs-build/`:
 *
 *   .docs-build/            <- docs/wiki/*.md (the wiki, at the site root)
 *   .docs-build/LAWS/       <- LAWS/*.md
 *   .docs-build/VISION.md   <- VISION.md
 *
 * It rewrites the outbound relative links in the staged copy only, so the
 * source wiki keeps links that work when browsing the repository on GitHub.
 * Nothing here is committed; `.docs-build/` and `site/` are gitignored.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wikiDir = path.join(repoRoot, "docs", "wiki");
const lawsDir = path.join(repoRoot, "LAWS");
const buildDir = path.join(repoRoot, ".docs-build");

function copyMarkdown(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
  }
}

function rewriteStagedLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteStagedLinks(target);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    let text = fs.readFileSync(target, "utf8");
    const before = text;
    // The wiki's "project laws" index link points at the LAWS directory.
    text = text.replaceAll("](../../LAWS/)", "](LAWS/README.md)");
    // Every other link into the repo root becomes a sibling inside the staged tree.
    text = text.replaceAll("](../../LAWS/", "](LAWS/");
    text = text.replaceAll("](../../VISION.md)", "](VISION.md)");
    if (text !== before) fs.writeFileSync(target, text);
  }
}


/**
 * The Releases page is generated, not authored.
 *
 * Every release published on GitHub is the one place the project already keeps
 * a user-facing account of what changed. Building the page from that feed means
 * a release shows up on the docs site at the next deploy without anyone
 * remembering to copy it into the wiki. If the feed cannot be read (offline
 * build, rate limit), the page still exists and points at GitHub instead of
 * failing the whole site build.
 */
const RELEASES_URL =
  "https://api.github.com/repos/karmsheel/life-quest/releases?per_page=30";

function releaseDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function releasesMarkdown(releases) {
  const lines = [
    "# Releases",
    "",
    "Every published release, newest first. This page is generated from the",
    "project's GitHub Releases feed when the docs site is built, so a release",
    "appears here on the next deploy without a wiki edit.",
    "",
  ];
  for (const release of releases) {
    const name = release.name || release.tag_name;
    const date = releaseDate(release.published_at);
    lines.push(`## ${name}${date ? ` — ${date}` : ""}`, "");
    if (release.tag_name) {
      lines.push(
        `Tag [\`${release.tag_name}\`](${release.html_url})${release.prerelease ? " (pre-release)" : ""}.`,
        "",
      );
    }
    const body = typeof release.body === "string" ? release.body.trim() : "";
    lines.push(body || "No release notes were published with this release.", "");
  }
  return lines.join("\n");
}

async function writeReleasesPage() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "lifequest-docs-build",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(RELEASES_URL, { headers });
    if (!response.ok) throw new Error(`GitHub Releases answered ${response.status}`);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error("GitHub Releases returned no list");
    fs.writeFileSync(path.join(buildDir, "releases.md"), releasesMarkdown(releases));
    console.log(`[docs] generated releases.md from ${releases.length} release(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(
      path.join(buildDir, "releases.md"),
      [
        "# Releases",
        "",
        "The release feed could not be read while this site was built.",
        "",
        `> ${message}`,
        "",
        "Read every release on [GitHub Releases](https://github.com/karmsheel/life-quest/releases).",
        "",
      ].join("\n"),
    );
    console.warn(`[docs] could not generate releases.md (${message}); wrote a fallback page`);
  }
}

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

copyMarkdown(wikiDir, buildDir);
copyMarkdown(lawsDir, path.join(buildDir, "LAWS"));
fs.copyFileSync(path.join(repoRoot, "VISION.md"), path.join(buildDir, "VISION.md"));
rewriteStagedLinks(buildDir);
await writeReleasesPage();

const pages = fs
  .readdirSync(buildDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
const laws = fs
  .readdirSync(path.join(buildDir, "LAWS"))
  .filter((name) => name.endsWith(".md")).length;
console.log(`[docs] staged ${pages} wiki pages and ${laws} law files in .docs-build/`);
