import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundKickoff,
  boundSessionTitle,
  resolveBoundSession,
} from "../electron/review-sessions.ts";

describe("resolveBoundSession", () => {
  it("creates when stored id is null", () => {
    assert.equal(resolveBoundSession(null, []), "create");
  });

  it("creates when stored id is missing from list", () => {
    assert.equal(resolveBoundSession("abc", [{ id: "xyz" }]), "create");
  });

  it("reuses when stored id is present", () => {
    assert.equal(resolveBoundSession("abc", [{ id: "abc" }]), "reuse");
  });
});

describe("boundSessionTitle", () => {
  it("formats overall weekly review title", () => {
    assert.equal(
      boundSessionTitle({
        kind: "review",
        cadence: "weekly",
        period: "2026-09-21",
        scope: "overall",
        weekStartDay: "monday",
      }),
      "Review · Weekly · Week of 21 Sep 2026",
    );
  });

  it("includes domain name for domain reviews", () => {
    const title = boundSessionTitle({
      kind: "review",
      cadence: "weekly",
      period: "2026-09-21",
      scope: "health",
      domainName: "Health",
      weekStartDay: "monday",
    });
    assert.match(title, /Health/);
    assert.equal(
      title,
      "Review · Weekly · Health · Week of 21 Sep 2026",
    );
  });

  it("formats plan title", () => {
    assert.equal(
      boundSessionTitle({
        kind: "plan",
        cadence: "weekly",
        period: "2026-09-28",
        scope: "overall",
        weekStartDay: "monday",
      }),
      "Plan · Weekly · Week of 28 Sep 2026",
    );
  });
});

describe("boundKickoff", () => {
  it("review kickoff assembles period and tools", () => {
    const text = boundKickoff({
      kind: "review",
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
      weekStartDay: "monday",
    });
    assert.match(text, /Let's assemble/);
    assert.match(text, /get_period_pack/);
    assert.match(text, /Weekly review · Week of 21 Sep 2026/);
  });

  it("review kickoff includes domain scope suffix", () => {
    const text = boundKickoff({
      kind: "review",
      cadence: "weekly",
      period: "2026-09-21",
      scope: "health",
      domainName: "Health",
      weekStartDay: "monday",
    });
    assert.match(text, /\(Health\)/);
  });

  it("plan kickoff forbids writing a plan file", () => {
    const text = boundKickoff({
      kind: "plan",
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
      weekStartDay: "monday",
    });
    assert.match(text, /Do not write a plan file yet/);
    assert.match(text, /Let's plan/);
  });
});
