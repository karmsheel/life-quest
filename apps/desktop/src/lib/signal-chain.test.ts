import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  domainLens,
  overviewLens,
  type SignalRecord,
} from "@lifequest/vault-core";
import {
  dayLabel,
  filterSignals,
  formatSignalWhen,
  groupSignalsByDay,
  localDayKey,
  signalDomainLabel,
  signalVisible,
} from "./signal-chain.ts";

function signal(
  partial: Pick<SignalRecord, "id" | "createdAt" | "type" | "body"> &
    Partial<SignalRecord>,
): SignalRecord {
  return {
    updatedAt: partial.createdAt,
    deletedAt: null,
    source: "manual",
    sourceRef: null,
    title: null,
    domainSlug: null,
    ...partial,
  };
}

describe("localDayKey", () => {
  it("uses the local calendar date, not UTC", () => {
    const local = new Date(2026, 0, 15, 21, 0, 0);
    assert.equal(localDayKey(local.toISOString()), "2026-01-15");
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 5, 10, 12, 0, 0);

  it("labels today and yesterday", () => {
    assert.equal(dayLabel("2026-06-10", now), "Today");
    assert.equal(dayLabel("2026-06-09", now), "Yesterday");
  });

  it("formats older days with medium date style", () => {
    const expected = new Date(2026, 0, 2).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
    assert.equal(dayLabel("2026-01-02", now), expected);
  });
});

describe("filterSignals", () => {
  const records: SignalRecord[] = [
    signal({
      id: "a",
      createdAt: "2026-01-01T00:00:00.000Z",
      type: "thought",
      title: "Alpha",
      body: "Hello world",
      domainSlug: "health",
    }),
    signal({
      id: "b",
      createdAt: "2026-01-02T00:00:00.000Z",
      type: "idea",
      body: "Other note",
      domainSlug: null,
    }),
  ];

  it("filters by type, none-domain, and case-insensitive search", () => {
    assert.equal(
      filterSignals(records, { type: "idea", domainSlug: "all", query: "" })
        .map((r) => r.id)
        .join(),
      "b",
    );
    assert.equal(
      filterSignals(records, { type: "all", domainSlug: "none", query: "" })
        .map((r) => r.id)
        .join(),
      "b",
    );
    assert.equal(
      filterSignals(records, {
        type: "all",
        domainSlug: "health",
        query: "HELLO",
      })
        .map((r) => r.id)
        .join(),
      "a",
    );
  });
});

describe("groupSignalsByDay", () => {
  it("groups newest day first and keeps newest-first within a day", () => {
    const now = new Date(2026, 5, 10, 18, 0, 0);
    const todayMorning = new Date(2026, 5, 10, 8, 0, 0).toISOString();
    const todayEvening = new Date(2026, 5, 10, 17, 0, 0).toISOString();
    const yesterday = new Date(2026, 5, 9, 12, 0, 0).toISOString();
    const records = [
      signal({ id: "eve", createdAt: todayEvening, type: "thought", body: "e" }),
      signal({ id: "morn", createdAt: todayMorning, type: "thought", body: "m" }),
      signal({ id: "y", createdAt: yesterday, type: "idea", body: "y" }),
    ];
    const groups = groupSignalsByDay(records, now);
    assert.equal(groups[0]?.label, "Today");
    assert.deepEqual(
      groups[0]?.items.map((i) => i.id),
      ["eve", "morn"],
    );
    assert.equal(groups[1]?.label, "Yesterday");
    assert.equal(groups[1]?.items[0]?.id, "y");
  });
});

describe("signalDomainLabel", () => {
  it("labels null as - unassigned -", () => {
    assert.equal(signalDomainLabel(null, []), "- unassigned -");
  });

  it("prefers domain name over slug", () => {
    assert.equal(
      signalDomainLabel("health", [{ slug: "health", name: "Health" }]),
      "Health",
    );
  });

  it("uses meta.name for an archived slug", () => {
    assert.equal(
      signalDomainLabel("health", [{ slug: "health", name: "Health" }]),
      "Health",
    );
  });

  it("falls back to the raw slug when unknown", () => {
    assert.equal(signalDomainLabel("mystery", []), "mystery");
  });
});

describe("formatSignalWhen", () => {
  const now = new Date(2026, 5, 10, 12, 0, 0);

  it("labels today and yesterday with a time", () => {
    const today = new Date(2026, 5, 10, 15, 42, 0).toISOString();
    const yesterday = new Date(2026, 5, 9, 15, 42, 0).toISOString();
    const todayTime = new Date(today).toLocaleTimeString(undefined, {
      timeStyle: "short",
    });
    const yesterdayTime = new Date(yesterday).toLocaleTimeString(undefined, {
      timeStyle: "short",
    });
    assert.equal(formatSignalWhen(today, now), `Today, ${todayTime}`);
    assert.equal(
      formatSignalWhen(yesterday, now),
      `Yesterday, ${yesterdayTime}`,
    );
  });

  it("formats older days with medium date and short time", () => {
    const older = new Date(2026, 0, 2, 9, 15, 0);
    const expected = older.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    assert.equal(formatSignalWhen(older.toISOString(), now), expected);
  });

  it("returns the raw iso string when the date is invalid", () => {
    assert.equal(formatSignalWhen("not-a-date"), "not-a-date");
  });
});

describe("signalVisible", () => {
  it("shows every signal in Overview", () => {
    const lens = overviewLens();
    assert.equal(signalVisible(lens, null), true);
    assert.equal(signalVisible(lens, "health"), true);
    assert.equal(signalVisible(lens, "financial"), true);
  });

  it("on a domain tab shows unassigned plus that domain", () => {
    const lens = domainLens("health");
    assert.equal(signalVisible(lens, null), true);
    assert.equal(signalVisible(lens, "health"), true);
    assert.equal(signalVisible(lens, "financial"), false);
  });
});
