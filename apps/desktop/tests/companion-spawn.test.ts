import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hermesSpawnSpec } from "../electron/companion-spawn.ts";

describe("hermesSpawnSpec", () => {
  it("uses a shell on Windows for .cmd and .bat shims", () => {
    const cmd = hermesSpawnSpec("win32", "C:\\\\npm\\\\hermes.cmd", [
      "gateway",
      "start",
    ]);
    assert.equal(cmd.shell, true);
    assert.equal(cmd.file, "C:\\\\npm\\\\hermes.cmd");
    assert.deepEqual(cmd.args, ["gateway", "start"]);
    assert.equal(cmd.options.windowsHide, true);

    const bat = hermesSpawnSpec("win32", "D:\\\\hermes.bat", ["gateway"]);
    assert.equal(bat.shell, true);
  });

  it("does not require a shell for a Windows .exe", () => {
    const spec = hermesSpawnSpec("win32", "C:\\\\hermes\\\\hermes.exe", [
      "gateway",
      "restart",
    ]);
    assert.equal(spec.shell, false);
    assert.equal(spec.options.windowsHide, true);
  });

  it("does not use a shell on posix", () => {
    const spec = hermesSpawnSpec("linux", "/usr/bin/hermes", [
      "gateway",
      "start",
    ]);
    assert.equal(spec.shell, false);
    assert.equal(spec.options.windowsHide, false);
  });
});
