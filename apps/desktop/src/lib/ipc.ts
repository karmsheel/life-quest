import type { LifequestApi } from "../vite-env";

export type { LifequestApi };
// The vault-agent contract's shapes live beside the bridge in vite-env.d.ts;
// re-exported here so a Settings screen or a provider imports its types from
// the module it already uses to call the bridge, not a second path.
export type {
  CompanionHarnessChanged,
  VaultAgentAddInput,
  VaultAgentBinding,
  VaultAgentProfile,
  VaultAgentsState,
} from "../vite-env";

export function api(): LifequestApi {
  if (!window.lifequest) {
    throw new Error("LifeQuest API missing — not running in Electron");
  }
  return window.lifequest;
}
