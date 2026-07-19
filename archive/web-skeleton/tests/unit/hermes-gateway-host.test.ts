import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLocalGatewayControlAllowed } from "../../lib/hermes-gateway.ts";

describe("isLocalGatewayControlAllowed", () => {
  it("allows localhost hosts", () => {
    assert.equal(isLocalGatewayControlAllowed("localhost:3000"), true);
    assert.equal(isLocalGatewayControlAllowed("127.0.0.1:3000"), true);
  });
  it("denies remote hosts", () => {
    assert.equal(isLocalGatewayControlAllowed("example.com"), false);
  });
});
