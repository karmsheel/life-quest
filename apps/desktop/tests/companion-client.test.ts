import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInstructions,
  parseSseBlock,
} from "../electron/companion-client.ts";

describe("buildInstructions", () => {
  it("includes domain, about me, lock, and vault without doctrine bodies", () => {
    const text = buildInstructions({
      domainName: "Health",
      domainSlug: "health",
      aboutMe: "I like tea",
      locked: true,
      vaultOpen: true,
    });
    assert.match(text, /Health/);
    assert.match(text, /health/);
    assert.match(text, /About me: I like tea/);
    assert.match(text, /Agent lock: true/);
    assert.match(text, /Vault: open/);
    assert.equal(text.includes("## Why"), false);
  });

  it("says none and closed when no domain or vault", () => {
    const text = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "   ",
      locked: false,
      vaultOpen: false,
    });
    assert.match(text, /Active domain: none/);
    assert.match(text, /About me: \(empty\)/);
    assert.match(text, /Agent lock: false/);
    assert.match(text, /Vault: closed/);
  });
});

describe("parseSseBlock", () => {
  it("maps event + data assistant.delta", () => {
    const evt = parseSseBlock('event: assistant.delta\ndata: {"text":"Hi"}');
    assert.deepEqual(evt, { type: "assistant.delta", text: "Hi" });
  });

  it("maps data.type without an event line", () => {
    const evt = parseSseBlock('data: {"type":"assistant.delta","text":"Hi"}');
    assert.deepEqual(evt, { type: "assistant.delta", text: "Hi" });
  });

  it("maps tool start and complete", () => {
    assert.deepEqual(
      parseSseBlock('event: tool.started\ndata: {"name":"get_state"}'),
      { type: "tool.started", name: "get_state" },
    );
    assert.deepEqual(
      parseSseBlock('event: tool.completed\ndata: {"name":"get_state","ok":true}'),
      { type: "tool.completed", name: "get_state", ok: true },
    );
  });

  it("maps errors and ignores unknown events", () => {
    assert.deepEqual(parseSseBlock('event: error\ndata: {"message":"nope"}'), {
      type: "error",
      message: "nope",
    });
    assert.equal(parseSseBlock("event: ping\ndata: {}"), null);
  });
});
