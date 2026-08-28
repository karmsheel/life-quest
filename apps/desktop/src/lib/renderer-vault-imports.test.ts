import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FROM_NODE_BARREL = /from\s+["']@lifequest\/vault-core["']/g;

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function valueImportFromNodeBarrel(source: string): boolean {
  const re = new RegExp(FROM_NODE_BARREL.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const before = source.slice(0, match.index);
    const importIdx = before.lastIndexOf("import ");
    if (importIdx === -1) continue;
    const clause = before.slice(importIdx).trim();
    if (clause.startsWith("import type ")) continue;
    const specifiers = clause.replace(/^import\s+/, "").trim();
    if (specifiers.startsWith("{") && specifiers.endsWith("}")) {
      const parts = specifiers
        .slice(1, -1)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.some((part) => !part.startsWith("type "))) return true;
      continue;
    }
    return true;
  }
  return false;
}

describe("renderer vault-core imports", () => {
  it("does not value-import the Node barrel (use /pure for runtime values)", () => {
    const offenders: string[] = [];
    for (const file of walkSourceFiles(SRC_ROOT)) {
      const source = fs.readFileSync(file, "utf8");
      if (valueImportFromNodeBarrel(source)) {
        offenders.push(path.relative(SRC_ROOT, file).replaceAll("\\", "/"));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Renderer files must not value-import @lifequest/vault-core (pulls node:crypto into Vite). Offenders: ${offenders.join(", ")}`,
    );
  });
});
