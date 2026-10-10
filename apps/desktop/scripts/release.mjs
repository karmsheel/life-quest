/**
 * `npm run release` — the build that ships.
 *
 * Unlike `npm run package`, this does *not* pass `--dir`, so electron-builder
 * builds every target `electron-builder.yml` lists for Windows: the unpacked
 * folder, the NSIS installer, and the portable zip. The two uploadable files are
 * named from `version` in `package.json`, which is why the tag and the release
 * are both `v0.1.0`.
 *
 * electron-builder is run with `--publish never`: uploading is `gh release
 * create`'s job, so a build can never half-publish by itself. What this script
 * does instead is refuse to exit 0 unless both assets are really on disk, and
 * print their sizes and SHA-256 so the upload can be checked against them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runElectronBuilder } from "./electron-builder.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const productName = "LifeQuest";
const version = pkg.version;

/** The two files `gh release create` uploads, named as electron-builder names them. */
const assets = [
  `${productName}-${version}-setup.exe`,
  `${productName}-${version}-win-x64.zip`,
];

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function human(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

console.log(`[release] building ${productName} ${version} for Windows x64…`);
try {
  await runElectronBuilder(["--publish", "never"]);
} catch (err) {
  console.error(`[release] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const manifest = { productName, version, assets: [] };
let missing = false;

for (const name of assets) {
  const file = path.join(releaseDir, name);
  if (!fs.existsSync(file)) {
    console.error(`[release] MISSING: ${name} was not produced`);
    missing = true;
    continue;
  }
  const { size } = fs.statSync(file);
  const digest = sha256(file);
  manifest.assets.push({ name, bytes: size, sha256: digest });
  console.log(`[release] ${name}  ${human(size)}  sha256 ${digest}`);
}

if (missing) {
  console.error(
    "[release] the run did not produce every asset; refusing to call this a release.",
  );
  process.exit(1);
}

const manifestFile = path.join(releaseDir, "release-manifest.json");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[release] wrote ${path.relative(root, manifestFile)}`);
console.log(`[release] ${productName} ${version} is ready to upload.`);
