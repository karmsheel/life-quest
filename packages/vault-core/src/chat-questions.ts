import type {
  ChatQuestion,
  ChatQuestionScope,
  Result,
} from "./types.ts";

/**
 * The saved questions the chat composer offers, and which of them belong to the
 * screen the operator is on.
 *
 * Kept pure and beside the snapshot type because both ends need it: the settings
 * page validates what it is about to write, and the dock decides what to offer
 * from the same rules. A second copy in the renderer would be a second place for
 * "what does this scope mean" to drift.
 *
 * The scopes are intentionally one-dimensional. A question is for everywhere,
 * one wing, one domain, or one page — not a combination — so the operator never
 * has to reason about an intersection to know whether a prompt will appear.
 */

/** The app's wings, as ids rather than labels; labels belong to the renderer. */
export const CHAT_QUESTION_WINGS = [
  "home",
  "define",
  "plan",
  "execute",
  "review",
] as const;

export type ChatQuestionWing = (typeof CHAT_QUESTION_WINGS)[number];

const SCOPES: readonly ChatQuestionScope[] = [
  "everywhere",
  "wing",
  "domain",
  "page",
];

function isWing(value: string): value is ChatQuestionWing {
  return (CHAT_QUESTION_WINGS as readonly string[]).includes(value);
}

/** A route a page scope can name: rooted, one leading slash, no query or hash. */
function cleanPagePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.includes("?") || trimmed.includes("#")) return null;
  if (trimmed.length > 1 && trimmed.endsWith("/")) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

/**
 * What a question's target should be, or null when the scope/value pair does
 * not make sense. `everywhere` is the one scope that carries no target.
 */
function cleanTarget(
  scope: ChatQuestionScope,
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (scope === "everywhere") return { ok: true, value: null };
  if (typeof value !== "string" || !value.trim()) return { ok: false };
  if (scope === "wing") {
    const wing = value.trim();
    return isWing(wing) ? { ok: true, value: wing } : { ok: false };
  }
  if (scope === "domain") {
    return { ok: true, value: value.trim() };
  }
  const page = cleanPagePath(value);
  return page ? { ok: true, value: page } : { ok: false };
}

function readQuestion(entry: unknown): ChatQuestion | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const text = typeof row.text === "string" ? row.text.trim() : "";
  if (!id || !text) return null;

  const scope = row.scope;
  if (typeof scope !== "string" || !SCOPES.includes(scope as ChatQuestionScope)) {
    return null;
  }
  const target = cleanTarget(scope as ChatQuestionScope, row.value);
  if (!target.ok) return null;

  // Older or hand-edited settings may omit the stamp. It only orders the list,
  // so a stable epoch is better than dropping a question the operator can see.
  const createdAt =
    typeof row.createdAt === "string" && !Number.isNaN(Date.parse(row.createdAt))
      ? row.createdAt
      : new Date(0).toISOString();

  return {
    id,
    text,
    scope: scope as ChatQuestionScope,
    value: target.value,
    createdAt,
  };
}

/** Tolerant read for a settings file: malformed entries are skipped. */
export function chatQuestionsFromUnknown(value: unknown): ChatQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: ChatQuestion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const question = readQuestion(entry);
    if (!question || seen.has(question.id)) continue;
    seen.add(question.id);
    out.push(question);
  }
  return out;
}

/**
 * Strict read for a write: every entry has to be usable, because silently
 * dropping half a patch would leave the operator looking at a list the file
 * does not hold.
 */
export function parseChatQuestionsPatch(value: unknown): Result<ChatQuestion[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: "chatQuestions must be an array" };
  }
  const out: ChatQuestion[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const question = readQuestion(entry);
    if (!question) {
      return {
        ok: false,
        error: `chatQuestions[${index}] needs an id, text, and a target for its scope`,
      };
    }
    if (seen.has(question.id)) {
      return {
        ok: false,
        error: `chatQuestions[${index}] repeats the id ${question.id}`,
      };
    }
    seen.add(question.id);
    out.push(question);
  }
  return { ok: true, value: out };
}

/** The screen a question is being offered on. */
export type ChatQuestionContext = {
  /** The wing the current route belongs to, or null on a governance page. */
  wing: string | null;
  domainSlug: string | null;
  route: string;
};

/**
 * The questions that belong on this screen, in the operator's own order.
 *
 * A page question follows the route it names and its nested routes (`/data`
 * covers `/data/<slug>/<db>`), which is what makes "on the Data page" mean the
 * page the operator is on rather than only its landing screen. A domain
 * question follows the active lens; a wing question follows the wing. Both are
 * independent of the other axis, exactly as they are in the settings form.
 */
export function matchingChatQuestions(
  questions: readonly ChatQuestion[],
  context: ChatQuestionContext,
): ChatQuestion[] {
  return questions.filter((question) => {
    if (question.scope === "everywhere") return true;
    if (question.scope === "wing") {
      return context.wing !== null && question.value === context.wing;
    }
    if (question.scope === "domain") {
      return context.domainSlug !== null && question.value === context.domainSlug;
    }
    if (question.scope === "page") {
      const page = question.value;
      if (!page) return false;
      return (
        context.route === page ||
        (page !== "/" && context.route.startsWith(`${page}/`))
      );
    }
    return false;
  });
}
