import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAV_ITEMS } from "../src/components/shell/nav-items.ts";
import {
  applyPath,
  initialWingSession,
  isPinnedPath,
  selectWing,
  wingForPath,
  WING_DEFAULTS,
} from "../src/components/shell/wing.ts";

describe("initialWingSession", () => {
  it("starts on Vision with the three defaults", () => {
    const session = initialWingSession();
    assert.equal(session.active, "vision");
    assert.deepEqual(session.lastPath, {
      vision: "/home",
      plan: "/chart",
      execute: "/act",
    });
    assert.deepEqual(WING_DEFAULTS, session.lastPath);
  });
});

describe("wingForPath", () => {
  it("maps wing-owned paths", () => {
    assert.equal(wingForPath("/home"), "vision");
    assert.equal(wingForPath("/dream"), "vision");
    assert.equal(wingForPath("/domains"), "vision");
    assert.equal(wingForPath("/chain"), "vision");
    assert.equal(wingForPath("/documents"), "vision");
    assert.equal(wingForPath("/personnel"), "vision");
    assert.equal(wingForPath("/chart"), "plan");
    assert.equal(wingForPath("/track"), "plan");
    assert.equal(wingForPath("/act"), "execute");
  });

  it("returns null for pinned and unknown paths", () => {
    assert.equal(wingForPath("/log"), null);
    assert.equal(wingForPath("/decisions"), null);
    assert.equal(wingForPath("/settings"), null);
    assert.equal(wingForPath("/unknown"), null);
  });
});

describe("isPinnedPath", () => {
  it("is true only for log, decisions, and settings", () => {
    assert.equal(isPinnedPath("/log"), true);
    assert.equal(isPinnedPath("/decisions"), true);
    assert.equal(isPinnedPath("/settings"), true);
    assert.equal(isPinnedPath("/home"), false);
    assert.equal(isPinnedPath("/unknown"), false);
  });
});

describe("applyPath", () => {
  it("selects Plan and records /chart", () => {
    const next = applyPath(initialWingSession(), "/chart");
    assert.equal(next.active, "plan");
    assert.equal(next.lastPath.plan, "/chart");
    assert.equal(next.lastPath.vision, "/home");
  });

  it("keeps Vision on /log and records it as Vision last path", () => {
    const next = applyPath(initialWingSession(), "/log");
    assert.equal(next.active, "vision");
    assert.equal(next.lastPath.vision, "/log");
    assert.equal(next.lastPath.plan, "/chart");
  });

  it("does not change the session for an unknown path", () => {
    const session = initialWingSession();
    const next = applyPath(session, "/nope");
    assert.equal(next, session);
    assert.equal(next.active, "vision");
  });
});

describe("selectWing", () => {
  it("navigates to the last path, or the default if none usable", () => {
    const fromHome = selectWing(initialWingSession(), "plan");
    assert.equal(fromHome.session.active, "plan");
    assert.equal(fromHome.pathname, "/chart");
  });

  it("after Log then Plan, returning to Vision goes to Log", () => {
    const afterLog = applyPath(initialWingSession(), "/log");
    const afterPlan = selectWing(afterLog, "plan");
    assert.equal(afterPlan.pathname, "/chart");
    const back = selectWing(afterPlan.session, "vision");
    assert.equal(back.pathname, "/log");
    assert.equal(back.session.active, "vision");
  });

  it("falls back to the wing default when last path is unknown", () => {
    const broken = {
      ...initialWingSession(),
      lastPath: {
        vision: "/home",
        plan: "/nope",
        execute: "/act",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/chart");
    assert.equal(next.session.active, "plan");
  });

  it("falls back when last path belongs to a different wing", () => {
    const broken = {
      ...initialWingSession(),
      lastPath: {
        vision: "/home",
        plan: "/home",
        execute: "/act",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/chart");
  });
});

describe("NAV_ITEMS wings", () => {
  it("assigns Vision, Plan, Execute, and pinned items", () => {
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "vision").map((i) => i.id),
      ["home", "dream", "domains", "chain", "documents", "personnel"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "plan").map((i) => i.id),
      ["chart", "track"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "execute").map((i) => i.id),
      ["act"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing == null).map((i) => i.id),
      ["decisions", "log"],
    );
  });
});
