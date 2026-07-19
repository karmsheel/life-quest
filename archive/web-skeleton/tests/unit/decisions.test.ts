import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canProposeOnDocument,
  canResolveDecision,
  parseDecisionStatus,
  parseListStatusFilter,
  parseResolveAction,
} from "../../lib/decisions.ts";

describe("canProposeOnDocument", () => {
  it("allows only forged", () => {
    assert.equal(canProposeOnDocument("forged").ok, true);
    assert.equal(canProposeOnDocument("draft").ok, false);
    assert.equal(canProposeOnDocument("refined").ok, false);
  });
});

describe("canResolveDecision", () => {
  it("allows only pending", () => {
    assert.equal(canResolveDecision("pending").ok, true);
    assert.equal(canResolveDecision("approved").ok, false);
    assert.equal(canResolveDecision("rejected").ok, false);
  });
});

describe("parseResolveAction", () => {
  it("parses approve and reject", () => {
    assert.equal(parseResolveAction("approve"), "approve");
    assert.equal(parseResolveAction("reject"), "reject");
    assert.equal(parseResolveAction("maybe"), null);
    assert.equal(parseResolveAction(1), null);
  });
});

describe("parseDecisionStatus", () => {
  it("parses known statuses", () => {
    assert.equal(parseDecisionStatus("pending"), "pending");
    assert.equal(parseDecisionStatus("approved"), "approved");
    assert.equal(parseDecisionStatus("rejected"), "rejected");
    assert.equal(parseDecisionStatus("open"), null);
  });
});

describe("parseListStatusFilter", () => {
  it("defaults empty to pending; accepts all", () => {
    assert.equal(parseListStatusFilter(null), "pending");
    assert.equal(parseListStatusFilter(""), "pending");
    assert.equal(parseListStatusFilter("pending"), "pending");
    assert.equal(parseListStatusFilter("all"), "all");
    assert.equal(parseListStatusFilter("approved"), null);
  });
});
