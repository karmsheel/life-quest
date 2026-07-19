import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_ACCOUNT_EMAIL,
  LOCAL_ACCOUNT_NAME,
  isLocalAccountEmail,
} from "../../lib/constants.ts";

describe("local account identity", () => {
  it("uses a stable reserved email", () => {
    assert.equal(LOCAL_ACCOUNT_EMAIL, "local@lifequest.local");
    assert.equal(LOCAL_ACCOUNT_NAME, "Local");
  });

  it("detects local account email case-insensitively", () => {
    assert.equal(isLocalAccountEmail("local@lifequest.local"), true);
    assert.equal(isLocalAccountEmail("Local@LifeQuest.local"), true);
    assert.equal(isLocalAccountEmail("user@example.com"), false);
  });
});
