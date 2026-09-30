import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInstructions,
  createdSessionFromPayload,
  formatSessionWhen,
  messagesFromPayload,
  parseSseBlock,
  sessionLabel,
  sessionsFromPayload,
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

describe("session history payloads", () => {
  // List responses are { data: [...] }, not a bare array. Reading only `sessions` yields no chats.
  // `LifeQuest` and `LifeQuest · {vault}` are placeholders. The visible name is the first user message.
  // Any other title (Review, Plan, or a rename) is a name that was set, and it wins over that preview.
  // Hidden and archived rows stay out of the list. last_active is unix seconds.
  // Create nests the row under `session`. A missing top-level id is still a created chat.
  // Transcripts are { data: [...] }. Tool and system rows are not chat bubbles.

  it("reads the Hermes list envelope, preview, and last_active", () => {
    const rows = sessionsFromPayload({
      object: "list",
      data: [
        {
          id: "api_1",
          title: "LifeQuest · Personal",
          preview: "What should I focus on today?",
          last_active: 1_758_000_000,
          message_count: 4,
        },
        {
          id: "api_hidden",
          title: "Secret",
          preview: "nope",
          hidden: true,
          last_active: 1_758_000_100,
        },
        {
          id: "api_archived",
          title: "Old",
          archived: 1,
          last_active: 1_758_000_200,
        },
        { title: "missing id", preview: "skip" },
      ],
    });
    assert.deepEqual(rows, [
      {
        id: "api_1",
        title: "LifeQuest · Personal",
        preview: "What should I focus on today?",
        lastActive: 1_758_000_000,
      },
    ]);
  });

  it("accepts a bare array and a sessions envelope", () => {
    const bare = sessionsFromPayload([
      { session_id: "s1", name: "Plan · Weekly · Sep 22", started_at: 1_700_000_000 },
    ]);
    assert.equal(bare[0]?.id, "s1");
    assert.equal(bare[0]?.title, "Plan · Weekly · Sep 22");
    assert.equal(bare[0]?.lastActive, 1_700_000_000);
    assert.equal(bare[0]?.preview, null);

    const wrapped = sessionsFromPayload({
      sessions: [{ id: "s2", title: null, preview: "  hello\nthere  ", last_activity_at: 1_700_000_100 }],
    });
    assert.deepEqual(wrapped, [
      { id: "s2", title: "", preview: "hello there", lastActive: 1_700_000_100 },
    ]);
  });

  it("names a chat from the first message unless a real title was set", () => {
    assert.equal(
      sessionLabel({ title: "LifeQuest · Personal", preview: "What should I focus on today?" }),
      "What should I focus on today?",
    );
    assert.equal(
      sessionLabel({ title: "LifeQuest", preview: "Pack for the trip" }),
      "Pack for the trip",
    );
    assert.equal(
      sessionLabel({ title: "Review · Weekly · Health · Sep 22", preview: "Let's assemble the weekly review." }),
      "Review · Weekly · Health · Sep 22",
    );
    assert.equal(sessionLabel({ title: "", preview: null }), "New chat");
    assert.equal(sessionLabel({ title: "LifeQuest · Personal", preview: "   " }), "LifeQuest · Personal");
  });

  it("formats last activity against a fixed clock", () => {
    const now = new Date(2026, 8, 29, 15, 0, 0).getTime();
    const sameDay = new Date(2026, 8, 29, 9, 5, 0);
    assert.equal(
      formatSessionWhen(sameDay.getTime() / 1000, now),
      sameDay.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    );
    assert.equal(
      formatSessionWhen(new Date(2026, 8, 28, 9, 30, 0).getTime() / 1000, now),
      "Yesterday",
    );
    const threeDays = new Date(2026, 8, 26, 11, 0, 0);
    assert.equal(
      formatSessionWhen(threeDays.getTime() / 1000, now),
      threeDays.toLocaleDateString(undefined, { weekday: "short" }),
    );
    const older = new Date(2026, 7, 2, 11, 0, 0);
    assert.equal(
      formatSessionWhen(older.getTime() / 1000, now),
      older.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    assert.equal(formatSessionWhen(null, now), "");
  });

  it("reads a created session nested under session", () => {
    const created = createdSessionFromPayload(
      { object: "hermes.session", session: { id: "api_9", title: null, started_at: 1_700_000_000 } },
      "",
    );
    assert.deepEqual(created, {
      id: "api_9",
      title: "",
      preview: null,
      lastActive: 1_700_000_000,
    });
  });

  it("reads a created session from a top-level id", () => {
    const created = createdSessionFromPayload({ id: "api_3", title: "Review · Daily · Sep 29" });
    assert.equal(created?.id, "api_3");
    assert.equal(created?.title, "Review · Daily · Sep 29");
  });

  it("hydrates user and assistant messages from data and drops tool rows", () => {
    const messages = messagesFromPayload({
      object: "list",
      data: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: [{ type: "text", text: "Hi " }, { type: "text", text: "there" }] },
        { role: "tool", content: "tool output" },
        { role: "system", content: "instructions" },
        { role: "assistant", content: "   " },
        { role: "user", content: "" },
      ],
    });
    assert.deepEqual(messages, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });

  it("also reads a messages array", () => {
    const messages = messagesFromPayload({
      messages: [{ role: "user", content: "Continue this" }],
    });
    assert.deepEqual(messages, [{ role: "user", content: "Continue this" }]);
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
