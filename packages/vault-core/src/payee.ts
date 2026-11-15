/**
 * What a payee is allowed to say.
 *
 * A payee names the merchant or the item — "Engen", "Petrol", "Woolworths".
 * The capture parser used to derive it by deleting only the amount from the
 * operator's sentence, so the field kept the date, the account name, the
 * category words and filler like "spent on"; statement imports wrote whole row
 * descriptions into it. Nothing sanitised it and `notes` was null, so the
 * polluted payee was the only surviving copy of what the operator typed.
 *
 * This module is the one definition of the rule, and it is pure: callers hand
 * it the account and category names that are known in the vault, and it returns
 * the payee plus what it had to remove. The write path (domain-databases.ts)
 * runs it on every finance:transactions write; the capture path uses the same
 * answer for its receipt.
 */

/**
 * The version the write path and the one-time history migration agree on. Bump
 * it to make an existing vault run the repair again after the rule changes.
 */
export const PAYEE_SANITISER_VERSION = 1;

export type PayeeLintIssue = "date" | "account-name" | "category-name" | "filler";

export type PayeeSanitiseInput = {
  raw: string | null | undefined;
  accountNames: string[];
  categoryNames: string[];
  /** The category the row is actually assigned to, when there is one. */
  assignedCategoryName?: string | null;
};

export type PayeeSanitiseResult = {
  payee: string | null;
  issues: PayeeLintIssue[];
  /** True when the raw text carried anything a payee must not carry. */
  flagged: boolean;
};

/** Small words that stay lowercase inside a title unless they lead it. */
const SMALL_WORDS = new Set([
  "and",
  "or",
  "of",
  "the",
  "for",
  "at",
  "in",
  "on",
  "to",
  "from",
  "into",
  "a",
  "an",
  "with",
  "via",
]);

const PREPOSITIONS = ["at", "on", "from", "to", "for", "into", "the", "a", "an", "and", "of", "with", "via"];

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/**
 * Date shapes that end up inside a payee. Each is matched anywhere in the text
 * and as a whole token, so "9/28/26" and "2026-11-06" go but "A1" or a phone
 * number fragment stays.
 */
const DATE_PATTERNS: string[] = [
  "\\b\\d{4}-\\d{2}-\\d{2}\\b",
  "\\b\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}\\b",
  `\\b\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{2,4}\\b`,
  `\\b(?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{2,4}\\b`,
];

/**
 * Filler that carries no merchant and no item. Matched longest-first so
 * "spent on" is removed before the bare "spent".
 */
const FILLER_PHRASES = [
  "spent on",
  "spent at",
  "received into",
  "received from",
  "paid to",
  "paid from",
  "payment to",
  "purchased at",
  "purchase at",
  "bought at",
  "bought from",
  "transfer to",
  "transfer from",
  "deposit into",
  "credited to",
  "debited from",
  "spent",
  "received",
  "paid",
  "expense",
  "transaction",
  "purchase",
  "deposit",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateRegex(flags: string): RegExp {
  return new RegExp(DATE_PATTERNS.join("|"), flags);
}

/** A whole-word matcher for one literal name, unicode-aware and escaped. */
function literalWordRegex(name: string, flags: string): RegExp {
  const escaped = escapeRegExp(name.trim());
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, flags);
}

function longestFirst(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
}

function stripLiteralWords(text: string, names: string[]): string {
  let out = text;
  for (const name of longestFirst(names)) {
    out = out.replace(literalWordRegex(name, "giu"), " ");
  }
  return out;
}

function stripFiller(text: string): string {
  let out = text;
  for (const phrase of [...FILLER_PHRASES].sort((a, b) => b.length - a.length)) {
    out = out.replace(literalWordRegex(phrase, "giu"), " ");
  }
  return out;
}

function containsAnyLiteral(text: string, names: string[]): boolean {
  return longestFirst(names).some((name) => literalWordRegex(name, "iu").test(text));
}

function stripEdgeWords(text: string): string {
  let out = text;
  // Leading/trailing prepositions and articles are sentence glue, not a name.
  // Only the edges: an interior "at" can be part of "Petrol at Engen".
  for (let pass = 0; pass < 4; pass++) {
    const before = out;
    const trailing = new RegExp(`\\s*\\b(?:${PREPOSITIONS.join("|")})$`, "i");
    const leading = new RegExp(`^(?:${PREPOSITIONS.join("|")})\\b\\s*`, "i");
    out = out.replace(leading, "").replace(trailing, "").trim();
    if (out === before) break;
  }
  return out;
}

function titleCaseWord(word: string, first: boolean): string {
  const lower = word.toLowerCase();
  if (!first && SMALL_WORDS.has(lower)) return lower;
  // Mixed case is a brand the operator wrote on purpose: SaaS, Nando's, iPhone.
  if (/[a-z]/.test(word) && /[A-Z]/.test(word)) return word;
  // An all-caps token is an acronym when it is short, a shouted word otherwise.
  if (/[A-Z]/.test(word) && !/[a-z]/.test(word)) {
    if (word.length <= 5) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  }
  if (!/[a-z]/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function titleCase(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      // Hyphenated names keep a capital on each side of the hyphen.
      return word
        .split("-")
        .map((part, partIndex) =>
          part ? titleCaseWord(part, index === 0 && partIndex === 0) : part,
        )
        .join("-");
    })
    .join(" ");
}

/**
 * The payee a transaction should store, plus what the raw text had to lose.
 *
 * Idempotent: running it on its own output changes nothing and finds nothing.
 */
export function sanitisePayee(input: PayeeSanitiseInput): PayeeSanitiseResult {
  const raw = typeof input.raw === "string" ? input.raw : "";
  if (!raw.trim()) return { payee: null, issues: [], flagged: false };

  const issues: PayeeLintIssue[] = [];
  if (dateRegex("iu").test(raw)) issues.push("date");
  // The relation the row already names is the category the operator chose; a
  // payee repeating it is the exact pollution this rule exists to stop.
  const assigned = input.assignedCategoryName?.trim();
  const categoryNames = assigned
    ? [...input.categoryNames, assigned]
    : input.categoryNames;
  if (containsAnyLiteral(raw, input.accountNames)) issues.push("account-name");
  if (containsAnyLiteral(raw, categoryNames)) issues.push("category-name");
  if (FILLER_PHRASES.some((phrase) => literalWordRegex(phrase, "iu").test(raw))) {
    issues.push("filler");
  }

  let cleaned = raw;
  for (const pattern of DATE_PATTERNS) {
    cleaned = cleaned.replace(new RegExp(pattern, "giu"), " ");
  }
  cleaned = stripLiteralWords(cleaned, input.accountNames);
  cleaned = stripLiteralWords(cleaned, categoryNames);
  cleaned = stripFiller(cleaned);
  // Anything left that is not a name character is separator noise (", ,", "•",
  // stray slashes from a stripped relation id).
  cleaned = cleaned.replace(/[^\p{L}\p{N}'&.\- ]+/gu, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = stripEdgeWords(cleaned);
  cleaned = cleaned.replace(/^[\s.'\-]+|[\s.'\-]+$/gu, "").trim();
  let payee: string | null = cleaned ? titleCase(cleaned) : null;

  // The edge strip runs before the title case, so a leading article can be
  // capitalised by the first pass and only then be recognisable as stripping
  // glue ("- the butcher" → "The Butcher" → "Butcher"). Settle the result, so
  // a payee the write path normalises twice is the same value both times.
  for (let pass = 0; pass < 3 && payee; pass += 1) {
    const retrimmed = stripEdgeWords(payee)
      .replace(/^[\s.'\-]+|[\s.'\-]+$/gu, "")
      .trim();
    const next = retrimmed ? titleCase(retrimmed) : null;
    if (next === payee) break;
    payee = next;
  }

  return { payee, issues, flagged: issues.length > 0 };
}
