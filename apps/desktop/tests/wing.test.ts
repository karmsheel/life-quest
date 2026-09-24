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
  it("starts on Home with the five defaults", () => {
    const session = initialWingSession();
    assert.deepEqual(WING_IDS, [
      "home",
      "vision",
      "plan",
      "execute",
      "review",
    ]);
    assert.equal(session.active, "home");
    assert.deepEqual(session.lastPath, {
      home: "/home",
      vision: "/dream",
      plan: "/goals",
      execute: "/daily",
      review: "/review/daily",
    });
    assert.deepEqual(WING_DEFAULTS, session.lastPath);
  });
});

describe("wingForPath", () => {
  it("maps wing-owned paths", () => {
    assert.equal(wingForPath("/home"), "home");
    assert.equal(wingForPath("/data"), "home");
    assert.equal(wingForPath("/personnel"), "home");
    assert.equal(wingForPath("/dream"), "vision");
    assert.equal(wingForPath("/documents"), "vision");
    assert.equal(wingForPath("/goals"), "plan");
    assert.equal(wingForPath("/chart"), "plan");
    assert.equal(wingForPath("/track"), "plan");
    assert.equal(wingForPath("/act"), "execute");
    assert.equal(wingForPath("/daily"), "execute");
    assert.equal(wingForPath("/review/daily"), "review");
    assert.equal(wingForPath("/review/weekly"), "review");
    assert.equal(wingForPath("/review/monthly"), "review");
    assert.equal(wingForPath("/review/quarterly"), "review");
    assert.equal(wingForPath("/review/yearly"), "review");
    assert.equal(wingForPath("/dream/health/why"), "vision");
    assert.equal(wingForPath("/dream/health/what"), "vision");
    assert.equal(wingForPath("/track/health/how"), "plan");
    assert.equal(wingForPath("/data/health/abc"), "home");
  });

  it("returns null for pinned and unknown paths", () => {
    assert.equal(wingForPath("/chain"), null);
    assert.equal(wingForPath("/log"), null);
    assert.equal(wingForPath("/decisions"), null);
    assert.equal(wingForPath("/settings"), null);
    assert.equal(wingForPath("/domains"), null);
    assert.equal(wingForPath("/unknown"), null);
    assert.equal(wingForPath("/review"), null);
    assert.equal(wingForPath("/review/nope"), null);
    assert.equal(wingForPath("/review/daily/extra"), null);
  });
});

describe("isPinnedPath", () => {
  it("is true for Life-Chain, Decisions, Log, and settings", () => {
    assert.equal(isPinnedPath("/chain"), true);
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

  it("selects Review and records /review/weekly", () => {
    const next = applyPath(initialWingSession(), "/review/weekly");
    assert.equal(next.active, "review");
    assert.equal(next.lastPath.review, "/review/weekly");
    assert.equal(next.lastPath.home, "/home");
  });

  it("keeps Home on /log and records it as Home last path", () => {
    const next = applyPath(initialWingSession(), "/log");
    assert.equal(next.active, "home");
    assert.equal(next.lastPath.home, "/log");
    assert.equal(next.lastPath.plan, "/goals");
  });

  it("keeps Review on /log and records it as Review last path", () => {
    const onReview = applyPath(initialWingSession(), "/review/weekly");
    const next = applyPath(onReview, "/log");
    assert.equal(next.active, "review");
    assert.equal(next.lastPath.review, "/log");
  });

  it("does not change the session for an unknown path", () => {
    const session = initialWingSession();
    const next = applyPath(session, "/nope");
    assert.equal(next, session);
    assert.equal(next.active, "home");
  });

  it("does not change the session for unknown /review paths", () => {
    const session = initialWingSession();
    assert.equal(applyPath(session, "/review"), session);
    assert.equal(applyPath(session, "/review/nope"), session);
  });

  it("selects Execute on /daily", () => {
    const next = applyPath(initialWingSession(), "/daily");
    assert.equal(next.active, "execute");
    assert.equal(next.lastPath.execute, "/daily");
    assert.equal(next.lastPath.home, "/home");
  });
});

describe("selectWing", () => {
  it("navigates to the last path, or the default if none usable", () => {
    const fromHome = selectWing(initialWingSession(), "plan");
    assert.equal(fromHome.session.active, "plan");
    assert.equal(fromHome.pathname, "/goals");
  });

  it("keeps session memory of the last Plan path", () => {
    const afterChart = applyPath(initialWingSession(), "/chart");
    const back = selectWing(afterChart, "plan");
    assert.equal(back.pathname, "/chart");
  });

  it("selects Vision at /dream from a fresh session", () => {
    const next = selectWing(initialWingSession(), "vision");
    assert.equal(next.session.active, "vision");
    assert.equal(next.pathname, "/dream");
  });

  it("selects Review at /review/daily from a fresh session", () => {
    const next = selectWing(initialWingSession(), "review");
    assert.equal(next.session.active, "review");
    assert.equal(next.pathname, "/review/daily");
  });

  it("after Log then Plan, returning to Home goes to Log", () => {
    const afterLog = applyPath(initialWingSession(), "/log");
    const afterPlan = selectWing(afterLog, "plan");
    assert.equal(afterPlan.pathname, "/goals");
    const back = selectWing(afterPlan.session, "home");
    assert.equal(back.pathname, "/log");
    assert.equal(back.session.active, "home");
  });

  it("after Weekly then Plan, returning to Review goes to Weekly", () => {
    const afterWeekly = applyPath(initialWingSession(), "/review/weekly");
    const afterPlan = selectWing(afterWeekly, "plan");
    assert.equal(afterPlan.pathname, "/goals");
    const back = selectWing(afterPlan.session, "review");
    assert.equal(back.pathname, "/review/weekly");
    assert.equal(back.session.active, "review");
  });

  it("falls back to the wing default when last path is unknown", () => {
    const broken = {
      ...initialWingSession(),
      lastPath: {
        home: "/home",
        vision: "/dream",
        plan: "/nope",
        execute: "/act",
        review: "/review/daily",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/goals");
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
        review: "/home",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/goals");
    const review = selectWing(broken, "review");
    assert.equal(review.pathname, "/review/daily");
    assert.equal(review.session.active, "review");
  });
});

describe("NAV_ITEMS wings", () => {
  it("assigns Home, Vision, Plan, Execute, Review, and pinned items", () => {
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "home").map((i) => i.id),
      ["dashboard", "data", "personnel"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "vision").map((i) => i.id),
      ["dream", "documents"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "plan").map((i) => i.id),
      ["goals", "chart", "track"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "execute").map((i) => i.id),
      ["schedule", "act"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "review").map((i) => i.id),
      ["daily", "weekly", "monthly", "quarterly", "yearly"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.pin === "top").map((i) => i.id),
      ["chain", "decisions"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.pin === "bottom").map((i) => i.id),
      ["log"],
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

  it("labels Review cadences and points at /review/…", () => {
    const expected = [
      ["daily", "Daily", "/review/daily"],
      ["weekly", "Weekly", "/review/weekly"],
      ["monthly", "Monthly", "/review/monthly"],
      ["quarterly", "Quarterly", "/review/quarterly"],
      ["yearly", "Yearly", "/review/yearly"],
    ] as const;
    for (const [id, label, href] of expected) {
      const item = NAV_ITEMS.find((i) => i.id === id);
      assert.equal(item?.label, label);
      assert.equal(item?.href, href);
      assert.equal(item?.wing, "review");
    }
  });
});
