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

/** Every hand-written renderer source, so a scan cannot simply miss a file. */
function rendererSources(dir = "src"): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(desktopRoot, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...rendererSources(rel));
    else if (/\.tsx?$/.test(entry.name)) found.push(rel);
  }
  return found;
}

/** The surfaces that used to ask the platform, and what each one asks about. */
const ASKING_SURFACES = [
  "src/components/hermes/ChatPanel.tsx",
  "src/pages/GoalsPage.tsx",
  "src/pages/DocumentsPage.tsx",
  "src/pages/ChartPage.tsx",
  "src/components/settings/SettingsDomains.tsx",
  "src/components/signal-chain/SignalChainFeed.tsx",
];

describe("the app asks through its own confirm dialog", () => {
  it("never calls window.confirm anywhere in the renderer", () => {
    // A platform confirm is drawn by the platform: it centres on the display
    // rather than the window the app is running in, it cannot be themed, and a
    // rig cannot click it. One call anywhere is that bug coming back.
    const offenders = rendererSources().filter((rel) =>
      /window\.confirm\s*\(/.test(read(rel)),
    );
    assert.deepEqual(
      offenders,
      [],
      `these still ask the platform: ${offenders.join(", ")}`,
    );
  });

  it("asks through the hook on every surface that used to", () => {
    for (const rel of ASKING_SURFACES) {
      const src = read(rel);
      assert.match(src, /const \{ ask, dialog \} = useConfirm\(/, `${rel} does not use the hook`);
      assert.match(src, /ask\(\{/, `${rel} poses no question`);
      assert.match(src, /^      \{dialog\}$/m, `${rel} draws no dialog`);
    }
  });

  it("gates the dialog on the caller, and lets the gentle answer be the default", () => {
    const hook = read("src/components/ui/useConfirm.tsx");
    assert.match(hook, /useConfirm\(when = true\)/, "the hook takes no gate");
    assert.match(hook, /open=\{when && pending !== null\}/, "the dialog ignores the gate");
    // A surface has to say a write is unundoable; it cannot inherit the alarm.
    assert.match(hook, /destructive=\{pending\?\.destructive \?\? false\}/);
    // The write rides in the answer, so cancelling cannot fire it.
    assert.match(
      hook,
      /const request = pending;\s*\n\s*setPending\(null\);\s*\n\s*request\?\.run\(\);/,
      "the dialog does not carry the write to the answer",
    );
    assert.match(hook, /<ConfirmDialog/);
    // The dock draws its own collapsed state, so a question asked from the list
    // must not outlive the list.
    assert.match(read("src/components/hermes/ChatPanel.tsx"), /useConfirm\(open\)/);
  });

  it("wears the danger only on the writes the app cannot bring back", () => {
    const domains = read("src/components/settings/SettingsDomains.tsx");
    const archive =
      domains.match(/function archiveDomain\(slug: string\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
    assert.ok(archive, "the domain archive ask");
    assert.doesNotMatch(
      archive,
      /destructive: true/,
      "archive is a soft write — the folder stays — so it must not wear the danger",
    );
    const remove =
      domains.match(
        /function deleteDomain\(slug: string, name: string\) \{[\s\S]*?\n  \}/,
      )?.[0] ?? "";
    assert.ok(remove, "the domain delete ask");
    assert.match(
      remove,
      /destructive: true/,
      "the domain delete takes the folder and its database, so it wears the danger",
    );
  });

  it("says what the write does, and no more", () => {
    // The chain's delete is a soft one: the record keeps a `deletedAt` stamp and
    // stays in the vault, so neither surface may call the signal gone for good.
    for (const rel of [
      "src/components/signal-chain/SignalChainFeed.tsx",
      "src/components/hermes/ChatPanel.tsx",
    ]) {
      const src = read(rel);
      const signalAsk =
        src.match(/title: "Delete signal",\s*\n\s*message: "([^"]+)"/)?.[1] ?? "";
      assert.match(signalAsk, /hidden from the chain/, `${rel} does not say what the delete does`);
      assert.doesNotMatch(signalAsk, /cannot be undone|for good/, `${rel} overclaims the signal delete`);
    }
    // The chat delete is the one that is final: `DELETE /api/sessions/{id}` drops
    // the row and every message under it.
    assert.match(
      read("src/components/hermes/ChatPanel.tsx"),
      /title: "Delete chat",[\s\S]*?cannot be undone/,
      "the chat delete is not presented as final",
    );
  });
});
