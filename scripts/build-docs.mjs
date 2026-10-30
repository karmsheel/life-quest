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

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

copyMarkdown(wikiDir, buildDir);
copyMarkdown(lawsDir, path.join(buildDir, "LAWS"));
fs.copyFileSync(path.join(repoRoot, "VISION.md"), path.join(buildDir, "VISION.md"));
rewriteStagedLinks(buildDir);

const pages = fs
  .readdirSync(buildDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
const laws = fs
  .readdirSync(path.join(buildDir, "LAWS"))
  .filter((name) => name.endsWith(".md")).length;
console.log(`[docs] staged ${pages} wiki pages and ${laws} law files in .docs-build/`);
