import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveChatCredentials } from "../../lib/hermes.ts";

describe("resolveChatCredentials", () => {
  it("prefers body over stored", () => {
    const r = resolveChatCredentials({
      bodyBaseUrl: "http://127.0.0.1:8642",
      bodyApiKey: "body",
      stored: { baseUrl: "http://x", apiKey: "db" },
    });
    assert.equal(r?.apiKey, "body");
  });
  it("falls back to stored", () => {
    const r = resolveChatCredentials({
      stored: { baseUrl: "http://127.0.0.1:8642/", apiKey: "db" },
    });
    assert.equal(r?.baseUrl, "http://127.0.0.1:8642");
    assert.equal(r?.apiKey, "db");
  });
  it("returns null when incomplete", () => {
    assert.equal(resolveChatCredentials({ bodyBaseUrl: "http://x" }), null);
  });
});
