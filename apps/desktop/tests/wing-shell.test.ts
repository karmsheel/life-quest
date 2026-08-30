import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("wing shell wiring", () => {
  it("mounts WingProvider inside AppShell", () => {
    const src = read("src/components/shell/AppShell.tsx");
    assert.match(
      src,
      /import \{ WingProvider \} from ["']\.\/WingProvider["']/,
    );
    assert.match(src, /<WingProvider>/);
    assert.match(src, /<\/WingProvider>/);
  });
});
