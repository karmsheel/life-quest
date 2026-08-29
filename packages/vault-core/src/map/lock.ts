import { fail, ok } from "./errors.ts";
import type { ApplyContext, Command, Result, StoreState } from "./types.ts";

export function guardAgentWrite(
  state: StoreState,
  ctx: ApplyContext,
  command: Command,
): Result<void> {
  if (ctx.actor === "agent" && command.type === "setLock") {
    return fail("AGENT_CANNOT_LOCK", "The agent cannot flip the lock");
  }
  if (ctx.actor === "agent" && state.locked && command.type !== "setLock") {
    return fail("LOCKED", "locked, read-only");
  }
  return ok(undefined);
}
