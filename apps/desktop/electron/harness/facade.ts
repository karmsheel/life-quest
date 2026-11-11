// What the app calls when it wants "the companion", whoever that is.
//
// main.ts and vault-service.ts import this instead of `companion.ts`. The
// functions keep their old names in spirit — ensure, status, sessions, catalog,
// chat, approve, stop — so the diff at every call site is one identifier, and
// the renderer never learns which harness answered.
import { activeHarness } from "./registry.ts";
import type { ChatStreamEvent, CompanionInstructionsInput, CompanionRuntimeOverride, TurnAttachment } from "../companion-client.ts";
import type { HarnessStatus, SessionPatch } from "./types.ts";

export {
  activeHarnessId,
  harnessSummaries,
  loadHarnessSelection,
  shutdownHarnesses,
  switchHarness,
  useHarness,
} from "./registry.ts";
export { onHarnessStatusChanged } from "./status-bus.ts";

export const harnessEnsure = () => activeHarness().ensure();
export const harnessStatus = () => activeHarness().status();
export const harnessStatusMessage = (status: HarnessStatus) =>
  activeHarness().statusMessage(status);

export const harnessSessionsList = (options?: { includeArchived?: boolean }) =>
  activeHarness().listSessions(options);
export const harnessSessionCreate = (title: string) =>
  activeHarness().createSession(title);
export const harnessSessionMessages = (id: string) =>
  activeHarness().sessionMessages(id);
export const harnessSessionPatch = (id: string, patch: SessionPatch) =>
  activeHarness().patchSession(id, patch);
export const harnessSessionDelete = (
  id: string,
  options?: { revision?: number | null },
) => activeHarness().deleteSession(id, options);
export const harnessSessionsOpen = () => activeHarness().openSession();

export const harnessModelOptions = () => activeHarness().modelCatalog();

/**
 * The same signature the Hermes transport had, so its callers do not change:
 * main/vault-service pass the turn's parts and one event sink, and the facade
 * decides which companion receives them.
 *
 * The receipt (`attachment`) and the general attachments (`attachments`) are
 * two different things and both ride the turn: the receipt is the one image
 * the finance flow cites, the attachments are anything the operator attached
 * for the agent to read. A dropped argument here loses the operator's files
 * silently, so both are carried through.
 */
export const harnessChatStream = (
  sessionId: string,
  input: string,
  instructionsContext: CompanionInstructionsInput,
  onEvent: (event: ChatStreamEvent) => void,
  runtime?: CompanionRuntimeOverride | null,
  attachment?: TurnAttachment | null,
  attachments?: TurnAttachment[] | null,
) =>
  activeHarness().chatStream(
    { sessionId, input, instructionsContext, runtime, attachment, attachments },
    onEvent,
  );

export const harnessApproval = (runId: string, requestId: string, allow: boolean) =>
  activeHarness().approve(runId, requestId, allow);
export const harnessRunStop = (runId: string) =>
  activeHarness().stopRun(runId);
export const harnessRunSteer = (runId: string, text: string) =>
  activeHarness().steerRun(runId, text);
