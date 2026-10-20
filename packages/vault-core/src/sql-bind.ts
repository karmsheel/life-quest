/**
 * What a SQLite binding will actually take.
 *
 * `node:sqlite` binds NULL, numbers, bigints, text and blobs — and nothing else.
 * A boolean is not a number to it, and an object is not text, so either one
 * handed to `.all()` / `.run()` throws at bind time. Both shapes reach the two
 * places in the vault that build a parameterized read:
 *
 *  - a script block's `params`, which the operator writes as JSON and which
 *    this app documents as accepting `strings, numbers, booleans, or null`;
 *  - a view's `filters[].value`, which is `unknown` because an agent composes
 *    the spec and any JSON scalar may appear there.
 *
 * So every value that goes into a binding passes through `toSqlBindable` rather
 * than through a cast. A boolean becomes 1/0 — how SQLite stores a flag, and how
 * a `json_extract` of a true/false cell is compared — and anything structured
 * becomes its JSON text, which is the only comparison a JSON cell could mean.
 */
export type SqlBindable = string | number | bigint | null | Uint8Array;

export function toSqlBindable(value: unknown): SqlBindable {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
      return value;
    case "boolean":
      return value ? 1 : 0;
    default:
      break;
  }
  if (value instanceof Uint8Array) return value;
  try {
    return JSON.stringify(value);
  } catch {
    // A value JSON cannot represent (a cycle, a bigint inside an object) still
    // has to bind to something rather than take the whole read down.
    return String(value);
  }
}
