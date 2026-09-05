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

describe("Life-Chain quick-fire capture", () => {
  it("composer submits via requestSubmit and ignores IME, Shift, and key repeat", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /requestSubmit/);
    assert.match(src, /isComposing/);
    assert.match(src, /keyCode === 229/);
    assert.match(src, /shiftKey/);
    assert.match(src, /e\.repeat/);
  });

  it("create payload is thought with null title", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /type:\s*"thought"/);
    assert.match(src, /title:\s*null/);
    assert.equal(src.includes("SIGNAL_TYPES"), false);
    assert.equal(src.includes("TYPE_LABEL"), false);
    assert.equal(src.includes("Title (optional)"), false);
    assert.equal(src.includes("filterType"), false);
  });

  it("edit save patch omits type and title", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    const match = src.match(/onSave\(s\.id,\s*\{([^}]+)\}/);
    assert.ok(match, "SignalRow onSave patch object");
    const patch = match[1];
    assert.match(patch, /\bbody\b/);
    assert.match(patch, /\bdomainSlug\b/);
    assert.equal(patch.includes("type"), false);
    assert.equal(patch.includes("title"), false);
  });

  it("Log button is a ghost submit", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    const log = src.match(/<Button\b[^>]*>\s*Log\s*<\/Button>/);
    assert.ok(log, "Log button");
    assert.match(log[0], /type="submit"/);
    assert.match(log[0], /variant="ghost"/);

    const save = src.match(/<Button\b[^>]*>\s*Save\s*<\/Button>/);
    assert.ok(save, "Save button");
    assert.match(save[0], /type="submit"/);

    for (const label of ["Edit", "Delete", "Cancel"]) {
      const btn = src.match(
        new RegExp(`<Button\\b[^>]*>\\s*${label}\\s*</Button>`),
      );
      assert.ok(btn, `${label} button`);
      assert.match(btn[0], /type="button"/, label);
    }
  });

  it("Escape cancels the edit form", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /Escape/);
    assert.match(src, /onCancel/);
    assert.match(src, /isComposing/);
    assert.match(src, /onKeyDown=\{onEditKeyDown\}/);
  });

  it("refresh load is quiet", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /load\(\{\s*quiet:\s*true\s*\}\)|quiet:\s*true/);
    const matches = [...src.matchAll(/setLoading\(true\)/g)];
    assert.ok(matches.length > 0, "setLoading(true) still used for initial load");
    for (const m of matches) {
      const start = Math.max(0, m.index - 80);
      const window = src.slice(start, m.index + m[0].length);
      assert.match(window, /!opts\?\.quiet/);
    }
    for (const name of ["onAdd", "onSave", "onDelete"]) {
      const fn = src.match(
        new RegExp(`async function ${name}[\\s\\S]*?finally \\{[\\s\\S]*?\\n  \\}`),
      );
      assert.ok(fn, `${name} function`);
      assert.match(fn[0], /busyRef\.current = true/, name);
      assert.match(fn[0], /busyRef\.current = false/, name);
    }
  });

  it("does not reset domain via lensSlug", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.equal(src.includes("lensSlug"), false);
    assert.equal(src.includes("domainDirty"), false);
    const onAdd = src.match(/async function onAdd[\s\S]*?finally \{[\s\S]*?\n  \}/);
    assert.ok(onAdd, "onAdd function");
    assert.equal(onAdd[0].includes("setDomainSlug"), false);
  });

  it("empty copy is Write something above", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /Write something above/);
  });

  it("domain blank option is General", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /General/);
    assert.equal(src.includes("Unassigned"), false);
    assert.equal(src.includes(">None<"), false);
    assert.equal(src.includes("No domain"), false);
  });

  it("autoFocus is on the composer textarea", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    const composer = src.match(
      /className="signal-chain__composer"[\s\S]*?<\/form>/,
    );
    assert.ok(composer, "composer form");
    assert.match(composer[0], /<textarea[\s\S]*\bautoFocus\b/);
  });

  it("does not render type or search filters", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.equal(src.includes("filterType"), false);
    assert.equal(src.includes("signal-chain__filters"), false);
    const css = read("src/styles/global.css");
    assert.equal(css.includes(".signal-chain__filters"), false);
  });
});
