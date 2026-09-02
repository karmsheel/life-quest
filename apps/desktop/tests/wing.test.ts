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
  WING_IDS,
} from "../src/components/shell/wing.ts";

describe("initialWingSession", () => {
  it("starts on Home with the four defaults", () => {
    const session = initialWingSession();
    assert.deepEqual(WING_IDS, ["home", "vision", "plan", "execute"]);
    assert.equal(session.active, "home");
    assert.deepEqual(session.lastPath, {
      home: "/home",
      vision: "/dream",
      plan: "/chart",
      execute: "/act",
    });
    assert.deepEqual(WING_DEFAULTS, session.lastPath);
  });
});

describe("wingForPath", () => {
  it("maps wing-owned paths", () => {
    assert.equal(wingForPath("/home"), "home");
    assert.equal(wingForPath("/chain"), "home");
    assert.equal(wingForPath("/personnel"), "home");
    assert.equal(wingForPath("/dream"), "vision");
    assert.equal(wingForPath("/documents"), "vision");
    assert.equal(wingForPath("/chart"), "plan");
    assert.equal(wingForPath("/track"), "plan");
    assert.equal(wingForPath("/act"), "execute");
    assert.equal(wingForPath("/dream/health/why"), "vision");
    assert.equal(wingForPath("/dream/health/what"), "vision");
    assert.equal(wingForPath("/track/health/how"), "plan");
  });

  it("returns null for pinned and unknown paths", () => {
    assert.equal(wingForPath("/log"), null);
    assert.equal(wingForPath("/decisions"), null);
    assert.equal(wingForPath("/settings"), null);
    assert.equal(wingForPath("/domains"), null);
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
    assert.equal(next.lastPath.home, "/home");
  });

  it("selects Home on /home", () => {
    const next = applyPath(initialWingSession(), "/home");
    assert.equal(next.active, "home");
    assert.equal(next.lastPath.home, "/home");
  });

  it("keeps Home on /log and records it as Home last path", () => {
    const next = applyPath(initialWingSession(), "/log");
    assert.equal(next.active, "home");
    assert.equal(next.lastPath.home, "/log");
    assert.equal(next.lastPath.plan, "/chart");
  });

  it("does not change the session for an unknown path", () => {
    const session = initialWingSession();
    const next = applyPath(session, "/nope");
    assert.equal(next, session);
    assert.equal(next.active, "home");
  });
});

describe("selectWing", () => {
  it("navigates to the last path, or the default if none usable", () => {
    const fromHome = selectWing(initialWingSession(), "plan");
    assert.equal(fromHome.session.active, "plan");
    assert.equal(fromHome.pathname, "/chart");
  });

  it("selects Vision at /dream from a fresh session", () => {
    const next = selectWing(initialWingSession(), "vision");
    assert.equal(next.session.active, "vision");
    assert.equal(next.pathname, "/dream");
  });

  it("after Log then Plan, returning to Home goes to Log", () => {
    const afterLog = applyPath(initialWingSession(), "/log");
    const afterPlan = selectWing(afterLog, "plan");
    assert.equal(afterPlan.pathname, "/chart");
    const back = selectWing(afterPlan.session, "home");
    assert.equal(back.pathname, "/log");
    assert.equal(back.session.active, "home");
  });

  it("falls back to the wing default when last path is unknown", () => {
    const broken = {
      ...initialWingSession(),
      lastPath: {
        home: "/home",
        vision: "/dream",
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
        home: "/home",
        vision: "/dream",
        plan: "/home",
        execute: "/act",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/chart");
  });
});

describe("NAV_ITEMS wings", () => {
  it("assigns Home, Vision, Plan, Execute, and pinned items", () => {
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "home").map((i) => i.id),
      ["dashboard", "chain", "personnel"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "vision").map((i) => i.id),
      ["dream", "documents"],
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

  it("labels Dashboard and Life-Chain", () => {
    const dashboard = NAV_ITEMS.find((i) => i.id === "dashboard");
    const chain = NAV_ITEMS.find((i) => i.id === "chain");
    assert.equal(dashboard?.label, "Dashboard");
    assert.equal(dashboard?.href, "/home");
    assert.equal(chain?.label, "Life-Chain");
    assert.equal(chain?.href, "/chain");
  });
});
