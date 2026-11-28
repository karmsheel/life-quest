import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  calendarDateFromParts,
  isCalendarDate,
  isIsoDate as mapIsIsoDate,
  isValidLocalIsoDate,
} from "../../../packages/vault-core/src/index.ts";
import { isIsoDate as phoneIsIsoDate } from "../../../packages/vault-core/src/phone.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ACCEPTED = ["2026-01-01", "2026-02-28", "2024-02-29", "2000-02-29", "2026-12-31", "0999-01-01"];
const REJECTED = [
  "",
  "2026-02-31",
  "2026-04-31",
  "2026-00-10",
  "2026-13-01",
  "2026-01-00",
  "2026-01-32",
  "2025-02-29",
  "1900-02-29",
  "2026-2-01",
  "2026-02-1",
  "2026-02-01T00:00:00Z",
  " 2026-02-01",
  "2026-02-01 ",
  "2026/02/01",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "archive") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("calendar date", () => {
  it("accepts real days and rejects days that do not exist", () => {
    for (const value of ACCEPTED) {
      assert.equal(isCalendarDate(value), true, value);
    }
    for (const value of REJECTED) {
      assert.equal(isCalendarDate(value), false, value);
    }
  });

  it("builds a date from parts with the same rule", () => {
    assert.equal(calendarDateFromParts(2026, 2, 28), "2026-02-28");
    assert.equal(calendarDateFromParts(2024, 2, 29), "2024-02-29");
    assert.equal(calendarDateFromParts(2026, 2, 31), null);
    assert.equal(calendarDateFromParts(2025, 2, 29), null);
    assert.equal(calendarDateFromParts(1.5, 1, 1), null);
    assert.equal(calendarDateFromParts(10000, 1, 1), null);
    assert.equal(calendarDateFromParts(2026, 0, 1), null);
  });

  it("keeps the published names on the same rule", () => {
    for (const value of [...ACCEPTED, ...REJECTED]) {
      assert.equal(isValidLocalIsoDate(value), isCalendarDate(value), value);
      assert.equal(mapIsIsoDate(value), isCalendarDate(value), value);
      assert.equal(phoneIsIsoDate(value), isCalendarDate(value), value);
    }
    assert.equal(phoneIsIsoDate(null), false);
    assert.equal(phoneIsIsoDate(20260201), false);
    assert.equal(phoneIsIsoDate(undefined), false);
  });

  it("does not grow a second calendar-date implementation", () => {
    const roots = [
      path.join(repoRoot, "packages", "vault-core", "src"),
      path.join(repoRoot, "apps", "desktop", "src"),
    ];
    const offenders: string[] = [];
    const aliasFiles = new Set([
      path.normalize(path.join(repoRoot, "packages/vault-core/src/map/dates.ts")),
      path.normalize(path.join(repoRoot, "packages/vault-core/src/phone.ts")),
      path.normalize(path.join(repoRoot, "packages/vault-core/src/period.ts")),
    ]);
    const canonical = path.normalize(
      path.join(repoRoot, "packages/vault-core/src/calendar-date.ts"),
    );
    for (const file of roots.flatMap(walk)) {
      const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
      const text = fs.readFileSync(file, "utf8");
      const normalized = path.normalize(file);
      if (normalized !== canonical && /getUTCDate\(\)\s*[!=]==/.test(text)) {
        offenders.push(`${rel} reimplements the UTC round-trip`);
      }
      if (/function isValidIsoDate\(/.test(text) || /function isoDate\(/.test(text)) {
        offenders.push(`${rel} declares a private calendar-date function`);
      }
      if (/function isCalendarDate\(/.test(text) && normalized !== canonical) {
        offenders.push(`${rel} declares isCalendarDate`);
      }
      if (/function isIsoDate\(/.test(text) && !aliasFiles.has(normalized)) {
        offenders.push(`${rel} declares isIsoDate`);
      }
      if (/function isValidLocalIsoDate\(/.test(text) && !aliasFiles.has(normalized)) {
        offenders.push(`${rel} declares isValidLocalIsoDate`);
      }
      if (aliasFiles.has(normalized) && !text.includes("isCalendarDate(")) {
        offenders.push(`${rel} alias does not call isCalendarDate`);
      }
    }
    const goals = fs.readFileSync(
      path.join(repoRoot, "packages/vault-core/src/goals.ts"),
      "utf8",
    );
    if (!goals.includes("isCalendarDate(") || goals.includes("Date.parse(`${s}T00:00:00Z`)")) {
      offenders.push("goals.ts deadline check drifted off the calendar-date rule");
    }
    assert.deepEqual(offenders, []);
  });
});
