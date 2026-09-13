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

describe("Home deadline banner (KAR-15)", () => {
  it("uses deadlinePressureGoals and filterByLens for pressure goals", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /deadlinePressureGoals/);
    assert.match(home, /filterByLens/);
    assert.match(home, /useDomainLens/);
  });

  it("renders a quiet status banner above the dashboard grid", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /role=["']status["']/);
    assert.match(home, /deadline/);
    assert.match(home, /Dismiss/);
  });

  it("has a dismiss IPC call that writes today's date for this vault", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /api\(\)\./);
    assert.match(home, /deadlineDismiss/);
  });

  it("does not add streaks, points, XP, celebration, scoreboard, or email", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.equal(/streak/i.test(home), false);
    assert.equal(/\bpoints\b/i.test(home), false);
    assert.equal(/xp\b/i.test(home), false);
    assert.equal(/celebration/i.test(home), false);
    assert.equal(/scoreboard/i.test(home), false);
    assert.equal(/email/i.test(home), false);
  });

  it("ChatPanel.tsx has no new nag or deadline copy", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.equal(/\bdeadline\b/i.test(chat), false);
    assert.equal(/pressure/i.test(chat), false);
  });

  it("main process registers a deadline:maybeNotify IPC and uses new Notification", () => {
    const main = read("electron/main.ts");
    assert.match(main, /deadline:maybeNotify/);
    assert.match(main, /new Notification/);
  });

  it("preload exposes a deadline-dismiss IPC method", () => {
    const preload = read("electron/preload.ts");
    assert.match(preload, /deadlineDismiss/);
  });

  it("vite-env.d.ts LifequestApi includes deadlineDismiss and deadlineMaybeNotify", () => {
    const env = read("src/vite-env.d.ts");
    assert.match(env, /deadlineDismiss/);
    assert.match(env, /deadlineMaybeNotify/);
  });

  it("main process sets AppUserModelId to com.lifequest.desktop", () => {
    const main = read("electron/main.ts");
    assert.match(main, /com\.lifequest\.desktop/);
  });
});
