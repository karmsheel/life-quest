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

  it("appends reviewContext when set", () => {
    const text = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
      reviewContext: "BOUND_REVIEW_PACK_JSON",
    });
    assert.match(text, /BOUND_REVIEW_PACK_JSON/);
    assert.match(text, /\n\nBOUND_REVIEW_PACK_JSON$/);
  });

  it("keeps reviewContext as the final paragraph when the fence rule is added", () => {
    const text = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
      reviewContext: "BOUND_REVIEW_PACK_JSON",
      fileUnsolicited: true,
    });
    assert.match(text, /\n\nBOUND_REVIEW_PACK_JSON$/);
    assert.equal(text.endsWith("BOUND_REVIEW_PACK_JSON"), true);
    const fenceIndex = text.indexOf("lifequest-decision");
    assert.ok(fenceIndex !== -1, "fence rule present");
    assert.ok(fenceIndex < text.indexOf("BOUND_REVIEW_PACK_JSON"));
  });

  it("says silence does not apply a proposal and project is not a document", () => {
    const text = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
    });
    assert.match(text, /lifequest-decision/);
    assert.match(text, /[Ss]ilence/);
    assert.match(text, /does not apply/);
    assert.match(text, /project/);
    assert.match(text, /not a document/);
  });

  it("tells the companion not to emit the fence when filing is off", () => {
    const off = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
      fileUnsolicited: false,
    });
    assert.match(off, /Do not emit/);
    assert.match(off, /lifequest-decision/);
    const on = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
      fileUnsolicited: true,
    });
    assert.equal(on.includes("Do not emit"), false);
    const omitted = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
    });
    assert.equal(omitted, on, "omitted fileUnsolicited keeps the on wording");
  });

  it("tells the companion to batch new rows with insert_rows", () => {
    const text = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
    });
    const captureAt = text.indexOf("capture_transaction");
    const batchAt = text.indexOf("call insert_rows once");
    assert.ok(captureAt !== -1);
    assert.ok(batchAt > captureAt);
    assert.match(text, /posted: true/);
    assert.match(text, /do not send those rows again/);
  });

  it("omits reviewContext when empty or unset", () => {
    const plain = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
    });
    assert.equal(plain.includes("BOUND_REVIEW"), false);
    const empty = buildInstructions({
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: true,
      reviewContext: "  ",
    });
    assert.equal(empty, plain);
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
