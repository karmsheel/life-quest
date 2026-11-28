import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const electronRoot = path.join(repoRoot, "apps", "desktop", "electron");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function sourceOf(files: string[]): string {
  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

/** String-literal channel names passed to one call. A template is a failure. */
function channels(source: string, call: string): string[] {
  const dynamic = new RegExp(call.replace(".", "\\.") + "\\s*`");
  assert.equal(
    dynamic.test(source),
    false,
    `${call} must name its channel with a string literal`,
  );
  const found = new Set<string>();
  const re = new RegExp(call.replace(".", "\\.") + "\\(\\s*[\"']([^\"']+)[\"']", "g");
  for (const match of source.matchAll(re)) found.add(match[1]!);
  return [...found].sort();
}

describe("ipc channel contract", () => {
  const files = walk(electronRoot);
  const all = sourceOf(files);
  const preload = fs.readFileSync(path.join(electronRoot, "preload.ts"), "utf8");

  it("gives every invoke a handler and every handler an invoke", () => {
    const handle = channels(all, "ipcMain.handle");
    const invoke = channels(preload, "ipcRenderer.invoke");
    assert.ok(handle.length > 0);
    assert.deepEqual(invoke, handle);
  });

  it("gives every renderer send a main listener and the reverse", () => {
    const listened = channels(all, "ipcMain.on");
    const sent = channels(preload, "ipcRenderer.send");
    assert.deepEqual(sent, listened);
  });

  it("gives every main-to-renderer event a preload listener", () => {
    const fromWebContents = channels(all, "webContents.send");
    const fromSender = channels(all, "sender.send");
    const sent = [...new Set([...fromWebContents, ...fromSender])].sort();
    const listened = channels(preload, "ipcRenderer.on");
    assert.ok(sent.length > 0);
    assert.deepEqual(listened, sent);
  });
});
