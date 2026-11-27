/**
 * The small mark a chat wears at the start of its name, remembered per vault
 * and per agent.
 *
 * Some chats are not typed here: the Act board hands a task over, a review or a
 * plan interview is started from its page, an automation runs against a note.
 * Each of those kickoffs knows what kind of work it is starting, and the tab
 * strip is where the operator meets the chat again — so the kind is carried on
 * the session request and written down here, and the tab wears the matching
 * icon before its name from that moment on. Hermes's own session rows carry no
 * such field, and a chat keeps its identity when renamed, so the mark is a
 * renderer-local fact keyed by the session id rather than a title decoration.
 *
 * The memory is keyed exactly like the remembered tab strip: a chat belongs to
 * one vault's agent, so one agent's marks must not restore onto another's
 * chats. A harness page (no vault, or no agent) keeps the legacy slot, which is
 * also what the fixture pages seed. The map is small — one short word per
 * kickoff chat that is still remembered — and a malformed value is treated as
 * no marks rather than a boot failure, the same rule the strip follows.
 */
import type { HarnessId } from "@/vite-env";

/** The kickoff kinds the strip knows how to draw. */
export type SessionIcon = "task" | "review" | "plan" | "automation";

/** Durable marks: session id → the icon that session wears. */
export type SessionIcons = Record<string, SessionIcon>;

const ICONS_PREFIX = "lifequest.companion.sessionIcons.";
const LEGACY_ICONS_KEY = "lifequest.companion.sessionIcons";

const KINDS: readonly SessionIcon[] = ["task", "review", "plan", "automation"];

/** Whether a stored/requested value names one of the known kickoff kinds. */
export function isSessionIcon(value: unknown): value is SessionIcon {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

function keyFor(vaultId: string | null, agent: HarnessId | null): string {
  // No agent is a harness page, not a vault with an unknown agent — the same
  // split the tab strip's own memory makes.
  if (!vaultId || !agent) {
    return agent ? `${ICONS_PREFIX}${agent}` : LEGACY_ICONS_KEY;
  }
  return `${ICONS_PREFIX}${vaultId}.${agent}`;
}

/** Keep only known kinds on known session ids, oldest write last. */
function cleanIcons(value: unknown): SessionIcons {
  const out: SessionIcons = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, kind] of Object.entries(value as Record<string, unknown>)) {
    if (!id || !isSessionIcon(kind)) continue;
    out[id] = kind;
  }
  return out;
}

/** The marks this vault's agent remembered, or none. */
export function readStoredSessionIcons(
  vaultId: string | null,
  agent: HarnessId | null = null,
): SessionIcons {
  try {
    const raw = window.localStorage.getItem(keyFor(vaultId, agent));
    if (raw === null) return {};
    return cleanIcons(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

/** Remember the marks for the next run. */
export function writeStoredSessionIcons(
  vaultId: string | null,
  agent: HarnessId | null,
  icons: SessionIcons,
): void {
  try {
    window.localStorage.setItem(
      keyFor(vaultId, agent),
      JSON.stringify(cleanIcons(icons)),
    );
  } catch {
    // A storage refusal costs the marks their memory, not the open chats.
  }
}
