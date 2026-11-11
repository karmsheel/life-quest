// The external companion, behind the seam.
//
// Nothing here re-implements Hermes: every method is the function that already
// served the app, so the seam can land without a behaviour change. What it adds
// is a place to stand — the facade and the registry can now choose.
import type { HarnessStatus, SessionPatch } from "./types.ts";
import type { AgentHarness, ProfiledHarness } from "./agent-harness.ts";
import * as companion from "../companion.ts";

export const hermesHarness: ProfiledHarness = {
  id: "hermes",
  displayName: "Hermes",
  kind: "external",

  ensure: () => companion.companionEnsure(),
  status: () => companion.companionStatus(),
  statusMessage: (status) => companion.companionStatusMessage(status),
  shutdown: () => companion.companionShutdown(),

  listSessions: (options) => companion.companionSessionsList(options),
  createSession: (title) => companion.companionSessionCreate(title),
  sessionMessages: (id) => companion.companionSessionMessages(id),
  patchSession: (id, patch: SessionPatch) => companion.companionSessionPatch(id, patch),
  deleteSession: (id) => companion.companionSessionDelete(id),
  openSession: () => companion.companionSessionsOpen(),

  modelCatalog: () => companion.companionModelOptions(),

  chatStream: (request, onEvent) =>
    companion.companionChatStream(
      request.sessionId,
      request.input,
      request.instructionsContext,
      onEvent,
      request.runtime ?? null,
      request.attachment ?? null,
      // The general attachments ride the turn as pictures (images) and as
      // named paths (everything else). They are the 7th argument, and dropping
      // it here would lose the operator's files without a word.
      request.attachments ?? null,
    ),
  approve: (runId, requestId, allow) =>
    companion.companionApproval(runId, requestId, allow),
  stopRun: (runId) => companion.companionRunStop(runId),
  // The gateway's own steer endpoint. `companionRunSteer` already speaks the
  // three answers the gateway gives (accepted / run gone / run finished) in
  // the operator's own words, so the harness only carries the text across.
  steerRun: (runId, text) => companion.companionRunSteer(runId, text),

  // Profile management: Hermes-only, and the reason the seam keeps a second
  // interface instead of putting these on every companion.
  listProfiles: () => companion.companionProfilesList(),
  useProfile: (name) => companion.companionUseProfile(name),
  openProfileFolder: () => companion.companionOpenProfileFolder(),
};

/** The status vocabulary, re-exported so a caller can type a switch without importing Hermes. */
export type { HarnessStatus };
export type { AgentHarness };
