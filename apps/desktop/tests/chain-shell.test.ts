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

    const cancel = src.match(/<Button\b[^>]*>\s*Cancel\s*<\/Button>/);
    assert.ok(cancel, "Cancel button");
    assert.match(cancel[0], /type="button"/);
  });

  it("row actions are a top-right domain picker with pencil and red trash", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /signal-row__side/);
    assert.match(src, /Pencil/);
    assert.match(src, /Trash2/);
    assert.match(src, /aria-label="Edit"/);
    assert.match(src, /aria-label="Delete"/);
    assert.match(src, /\bdestructive\b/);
    const css = read("src/styles/global.css");
    assert.match(css, /"content side"/);
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
    // The name is the function that holds the write, not the one that asks for
    // it: `onDelete` poses the question and `runDelete` is what takes the lock.
    for (const name of ["onAdd", "onSave", "onAssign", "runDelete", "onMakeTask"]) {
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
    assert.match(onAdd[0], /setDomainSlug\(""\)/);
  });

  it("empty copy is Write something above", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /Write something above/);
  });

  it("domain blank option is - unassigned -", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /- unassigned -/);
    assert.equal(src.includes("General"), false);
    assert.equal(src.includes(">None<"), false);
    assert.equal(src.includes("No domain"), false);
  });

  it("row domain selector assigns without an edit form", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /aria-label="Domain"/);
    assert.match(src, /onAssign/);
    const assign = src.match(
      /signalChainUpdate\(id,\s*\{([^}]+)\}\)/,
    );
    assert.ok(assign, "onAssign update patch");
    assert.match(assign[1], /domainSlug/);
    assert.equal(assign[1].includes("body"), false);
    assert.equal(assign[1].includes("title"), false);
    assert.equal(assign[1].includes("type"), false);
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

  it("row has Make task or Open task before Edit", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, />Make task</);
    assert.match(src, />Open task</);
    assert.match(src, /taskForSignal/);
    assert.match(src, /taskFromSignalBody/);
    assert.match(src, /mapApply/);
    assert.match(src, /type:\s*"createTask"/);
    assert.match(src, /column:\s*"backlog"/);
    assert.match(src, /signalId/);
    assert.match(src, /\/act\?task=/);
    assert.equal(src.includes("sourceRef"), false);
    const makeIdx = src.indexOf(">Make task<");
    const editIdx = src.indexOf('aria-label="Edit"');
    assert.ok(makeIdx > 0 && editIdx > makeIdx);
  });

  it("Make task uses busyRef and does not flash Loading chain", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    const fn = src.match(
      /async function onMakeTask[\s\S]*?finally \{[\s\S]*?\n  \}/,
    );
    assert.ok(fn, "onMakeTask function");
    assert.match(fn[0], /busyRef\.current = true/);
    assert.match(fn[0], /busyRef\.current = false/);
    assert.match(fn[0], /refresh\(/);
    assert.equal(fn[0].includes("setLoading(true)"), false);
    assert.equal(fn[0].includes("signalChainUpdate"), false);
    assert.equal(fn[0].includes("signalChainCreate"), false);
  });
});

/**
 * The Life-Chain is reachable twice: the page, and the dock's bottom bar. These
 * record the dock's half — the entry point, the payload it writes, and the two
 * decisions that make the stack read the way it does. Measured evidence for the
 * geometry: `e2e/chat-chain.electron.mjs`, wrapper
 * `tests/chat-chain-e2e.test.ts`, artifact `e2e/artifacts/chat-chain.json`.
 */
describe("Life-Chain in the chat dock", () => {
  it("the bottom bar's fourth slot is the chain, and it is live", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    assert.match(src, /aria-label="Life-Chain"/);
    assert.match(src, /aria-pressed=\{view === "chain"\}/);
    assert.match(src, /setView\(view === "chain" \? "thread" : "chain"\)/);
    // The old reserved placeholder is gone, not left beside it.
    assert.equal(src.includes("More chat actions"), false);
    assert.equal(src.includes("MoreHorizontal"), false);
    // The other reserved slot stays reserved.
    assert.match(src, /aria-label="Search chats \(coming soon\)"/);
  });

  it("the chain is the dock's third surface, not a fourth slot of chrome", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    assert.match(src, /useState<"list" \| "thread" \| "chain">/);
    assert.match(src, /className="chat-panel__body chat-panel__body--chain"[\s\S]{0,80}hidden=\{view !== "chain"\}/);
    // Both thread and chain own a composer; only the list does not.
    assert.match(src, /className="chat-panel__footer" hidden=\{view === "list"\}/);
  });

  it("the dock logs the same thought payload the page does", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    const create = src.match(/signalChainCreate\(\{([\s\S]*?)\}\)/);
    assert.ok(create, "the dock's signalChainCreate call");
    assert.match(create[1], /type:\s*"thought"/);
    assert.match(create[1], /title:\s*null/);
    assert.match(create[1], /domainSlug:\s*null/);
  });

  it("both chain composers share one key handler", () => {
    const panel = read("src/components/hermes/ChatPanel.tsx");
    const feed = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(
      panel,
      /import \{ onComposerKeyDown \} from "@\/components\/signal-chain\/SignalChainFeed"/,
    );
    assert.match(panel, /onKeyDown=\{onComposerKeyDown\}/);
    assert.match(feed, /export function onComposerKeyDown/);
  });

  it("the chain reads like a chat: oldest first, resting on the composer", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    // The vault answers newest first, so an oldest-first DOM takes a flip.
    assert.match(src, /visibleSignals\.slice\(\)\.reverse\(\)/);
    assert.match(src, /className="chat-panel__chain-list"/);
    const css = read("src/styles/global.css");
    assert.match(css, /\.chat-panel__chain-list\s*\{[\s\S]*?flex-direction:\s*column;/);
    // The reversed column is gone for good: it put the oldest entry last.
    assert.equal(/\.chat-panel__chain-list\s*\{[^}]*column-reverse/.test(css), false);
    // `auto` and not `justify-content: flex-end`: a negative free space zeroes an
    // auto margin, so the overflow stays reachable instead of clipping the top.
    assert.match(css, /\.chat-panel__chain-list\s*\{[\s\S]*?margin:\s*auto 0 0/);
    assert.equal(/\.chat-panel__body--chain\s*\{[^}]*justify-content/.test(css), false);
  });

  it("the chain follows the newest entry into view", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    assert.match(src, /ref=\{chainRef\}/);
    const effect = src.match(
      /useLayoutEffect\(\(\) => \{[\s\S]*?chainRef\.current\.scrollTop = chainRef\.current\.scrollHeight;[\s\S]*?\}, \[open, view, chainItems, chainBusy\]\);/,
    );
    assert.ok(effect, "the chain's stick-to-the-bottom effect");
  });

  it("the chain is read on landing on it, and re-read when the vault reloads", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    const effect = src.match(
      /if \(!open \|\| view !== "chain"\) return;[\s\S]*?\}, \[open, view, loadChain, reloadGeneration\]\);/,
    );
    assert.ok(effect, "the chain's read effect");
    assert.match(effect[0], /void loadChain\(\)/);
  });

  it("a row is two blocks and a picker, and the menu hangs off the message", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    // The blocks, in the order the grid areas place them.
    assert.match(src, /className="chat-panel__chain-rail"/);
    assert.match(src, /className="chat-panel__chain-stamp"/);
    assert.match(src, /className="chat-panel__chain-message"/);
    assert.match(src, /className="chat-panel__chain-assign"/);
    // The 3-dot control sits on the message box, not the row, and it is the only
    // thing that opens the menu. The picker follows the box in the markup, so the
    // slice between them is the box's whole subtree — including its editor, which
    // nests its own closing tags.
    const row = src.slice(
      src.indexOf('className="chat-panel__chain-message"'),
      src.indexOf('className="chat-panel__chain-assign"'),
    );
    assert.ok(row.length > 0, "the message box and the picker");
    assert.match(row, /aria-label="Signal actions"/);
    assert.match(row, /aria-haspopup="menu"/);
    assert.match(src, /aria-label="Edit signal"/);
    assert.match(src, /aria-label="Delete signal"/);
    // Both blocks and the picker are placed by the row's grid, which is what
    // puts the picker under the message and next to nothing else.
    const css = read("src/styles/global.css");
    assert.match(css, /\.chat-panel__chain-item\s*\{[\s\S]*?grid-template-areas:\s*\n\s*"when message"\s*\n\s*"when assign"/);
    assert.match(css, /\.chat-panel__chain-assign\s*\{[\s\S]*?grid-area:\s*assign/);
    assert.match(css, /\.chat-panel__chain-message\s*\{[\s\S]*?grid-area:\s*message/);
  });

  it("the thread is one dashed line on the list, not a stub per row", () => {
    const css = read("src/styles/global.css");
    assert.match(css, /\.chat-panel__chain-list\s*\{[\s\S]*?position:\s*relative/);
    // Dashed and 2px: at 1px dotted it was too faint to read as a line.
    assert.match(
      css,
      /\.chat-panel__chain-list::before\s*\{[\s\S]*?border-left:\s*2px dashed/,
    );
    // Per row it would break in the list's own gaps, which is the thing this
    // rule exists to avoid.
    assert.equal(/\.chat-panel__chain-item::before\s*\{/.test(css), false);
    assert.equal(/\.chat-panel__chain-rail::before\s*\{/.test(css), false);
  });

  it("the picker offers live domains, and the add-ons the page makes too", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    // Archived domains are out; a signal that names one keeps it, so the picker
    // shows what the record holds rather than silently dropping it.
    assert.match(src, /\.filter\(\(d\) => !d\.meta\.archivedAt\)/);
    assert.match(src, /if \(s\.domainSlug && !options\.some/);
    assert.match(src, /<option value="">- unassigned -<\/option>/);
  });

  it("the row's own writes are the page's calls, one write at a time", () => {
    const src = read("src/components/hermes/ChatPanel.tsx");
    assert.match(src, /signalChainUpdate\(id, \{ domainSlug: nextDomain \}\)/);
    assert.match(src, /signalChainUpdate\(id, \{ body \}\)/);
    assert.match(src, /signalChainDelete\(id\)/);
    // Delete asks first, and it asks through the dock's own dialog: a platform
    // `window.confirm` centres on the display rather than the window the app is
    // running in, and no rig can click one.
    assert.equal(
      /window\.confirm\s*\(/.test(src),
      false,
      "the dock asks through window.confirm instead of its own dialog",
    );
    assert.match(src, /function onDeleteSignal\(id: string\) \{[\s\S]*?ask\(\{/);
    // And every one of them takes the composer's lock rather than a second one.
    for (const handler of ["onAssignSignal", "onSaveSignal", "runDeleteSignal"]) {
      const body = src.match(new RegExp(`async function ${handler}\\([\\s\\S]*?\\n  \\}`));
      assert.ok(body, `the ${handler} handler`);
      assert.match(body[0], /chainBusyRef\.current/);
    }
  });
});
