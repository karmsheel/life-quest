import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_INLINE_KEYS = [
  "--bg",
  "--bg-app",
  "--text",
  "--fg",
  "--accent",
  "--accent-fg",
  "--accent-hover",
  "--accent-strong",
  "--muted",
  "--danger",
  "--red",
  "--border-strong",
];

const HEX = /#[0-9A-Fa-f]{3,8}/g;
const FUNC_COLOR = /(?:rgba?|hsla?)\(/g;

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walkUiFiles(uiDir) {
  if (!fs.existsSync(uiDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(uiDir, { withFileTypes: true })) {
    const full = path.join(uiDir, entry.name);
    if (entry.isDirectory()) out.push(...walkUiFiles(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name) && entry.name !== "AGENTS.md") {
      out.push(full);
    }
  }
  return out;
}

export function auditDesignSystem(root) {
  const findings = [];
  const applySkin = fs.readFileSync(path.join(root, "src/lib/themes/apply-skin.ts"), "utf8");
  for (const key of FORBIDDEN_INLINE_KEYS) {
    const pattern = new RegExp(`["']${key}["']\\s*:`);
    if (pattern.test(applySkin)) {
      findings.push(`apply-skin.ts inlines alias ${key}`);
    }
  }
  if (!applySkin.includes('"--background"') && !applySkin.includes("'--background'")) {
    findings.push("apply-skin.ts does not write --background");
  }
  if (!applySkin.includes('"--primary"') && !applySkin.includes("'--primary'")) {
    findings.push("apply-skin.ts does not write --primary");
  }
  if (!applySkin.includes('"--canvas-base"') && !applySkin.includes("'--canvas-base'")) {
    findings.push("apply-skin.ts does not write --canvas-base");
  }
  if (!applySkin.includes('"--card-glass"') && !applySkin.includes("'--card-glass'")) {
    findings.push("apply-skin.ts does not write --card-glass");
  }

  for (const file of walkUiFiles(path.join(root, "src/components/ui"))) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const body = stripComments(fs.readFileSync(file, "utf8"));
    HEX.lastIndex = 0;
    FUNC_COLOR.lastIndex = 0;
    if (HEX.test(body)) findings.push(`${rel} contains raw hex`);
    if (FUNC_COLOR.test(body)) findings.push(`${rel} contains rgb/hsl()`);
  }
  return findings;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const findings = auditDesignSystem(root);
  if (findings.length) {
    for (const finding of findings) console.error(finding);
    process.exit(1);
  }
}
