# Vault-scoped agents and chats

**Status:** implementing
**Date:** 2026-11-13
**Operator report:** after switching to a new vault, the chats of the other vault's
agents were still in the app. The vault should be the profile that is loaded: its
chats and its agents belong to it, and there must be no cross-contamination.

## Problem

Two things currently follow the app instead of the vault:

1. **Chats.** The built-in companion's transcripts live in
   `<userData>/pi-sessions/<id>.json`, one folder for the whole app. Hermes chats
   live in one Hermes profile (`lifequest`, or whatever the single profile picker
   last chose). Open a different vault and the same chat rail appears, because
   nothing in the chat store knows which vault is open.
2. **Agents.** The companion choice (`harness`) and the Hermes profile
   (`companionProfile`) are two app-level preferences. A new vault therefore
   inherits the previous vault's agent — the same Hermes profile, with the same
   memory, skills and knowledge — which is exactly the cross-contamination the
   operator described.

## Decisions (operator, 2026-11-13)

1. **One companion per vault.** A vault starts with the singular Pi agent. The
   operator can add one Hermes agent to the vault (a fresh Hermes profile bound to
   that vault), or explicitly reuse an existing profile/agent that is already
   working on another vault — with a warning that its memory and knowledge are
   shared. Reuse is never the default. The Agents page's roster of hired and
   connected agents stays multiple and is already vault-scoped; this change does
   not touch it.
2. **Existing installs adopt into the last-open vault.** The vault that is open
   when the app updates keeps the existing Pi chats and the existing Hermes
   profile, so nothing is lost. Every other vault starts clean.

Transcripts remain outside the vault (VISION: the vault stays the operator's life
database; the harness owns its transcripts). "Grouped under a vault" means keyed
by the vault's identity in the harness stores, not copied into the vault folder.

## Vault identity

`VaultSnapshot.lifequest.id` is the stable identity. The vault root path is not
used as a key: a copied or moved vault keeps its identity. The open vault's
scope is published by the main process to the chat stores:

```ts
// electron/vault-scope.ts (new)
export type VaultScope = { id: string; rootPath: string };
setVaultScope(scope: VaultScope | null): void
currentVaultScope(): VaultScope | null
currentVaultBucket(): string        // scope?.id ?? "unassigned"
onVaultScopeChanged(fn): () => void
```

`vault-service.rememberOpen` is the one place a vault becomes current, so it is
the one place the scope is set. Switching vaults sets it again before anything
reads the chat stores.

## Agent bindings

The vault's agent choice is stored in app prefs, beside `recent.json`'s existing
per-vault maps, never in the vault (it names machine-local Hermes profiles):

```ts
// recent-vaults.ts UserPrefs additions (read back by loadPrefs, like every field)
vaultAgents?: Record<string, { harness: "hermes" | "pi"; hermesProfile: string | null }>;
vaultAgentsMigrated?: boolean;
```

Absent entry means a clean vault: companion Pi, no Hermes agent. The legacy
app-level `harness` and `companionProfile` fields stay readable only for the
one-time adoption; after it they are no longer the source of truth.

New module `electron/vault-agents.ts` owns the store and the operations:

```ts
export type VaultAgentBinding = { harness: "hermes" | "pi"; hermesProfile: string | null };
getVaultAgentBinding(vaultId: string | null): Promise<VaultAgentBinding>   // materialises the default
setVaultAgentBinding(vaultId: string, next: VaultAgentBinding): Promise<void>
adoptLegacyVaultDataOnce(openedVaultId: string): Promise<void>            // one-time migration
applyVaultAgentBinding(scope: VaultScope): Promise<void>                  // called on vault open
addHermesAgentToVault(input): Promise<Result<VaultAgentBinding>>          // fresh | existing
removeHermesAgentFromVault(): Promise<Result<VaultAgentBinding>>
listReusableProfiles(vaultId): Promise<ReusableProfile[]>                 // usedBy for the warning
```

### Fresh agent

`mode: "fresh"` binds a profile that does not exist yet; the companion's existing
`ensure` seeds it (SOUL, MCP entry, eager tool search) exactly as it does for the
`lifequest` profile today. The name is generated from the vault name plus a short
suffix (`lifequest-<slug>-<id>`), validated by the existing `isSafeProfileName`,
and never collides with an installed profile.

### Reuse an existing agent

`mode: "existing"` binds an installed profile. The UI must show the profiles it
is already bound to (from `vaultAgents`, joined to `recent.json` names) and a
warning that memory, skills and knowledge are shared. This is the only path by
which two vaults share an agent.

### What a vault can be on

- Pi only (default): the dock's agent switcher draws one pill, Pi.
- Pi + Hermes: the switcher draws both; the workspace's agent is whichever the
  operator picked last for this vault (`binding.harness`).

Adding a Hermes agent makes it **available**; it does not silently make the vault
answer with it. The binding's `harness` stays where it was until the operator
chooses **Use Hermes**, so a reload between adding and choosing keeps the vault on
its previous agent while the Hermes pill exists. Removing the agent falls the vault
back to Pi.

Hermes is **absent** from the switcher, not greyed out, while the vault has no
Hermes agent: it is not a choice here.

## Chat scoping

### Pi

`pi-sessions.ts` stores sessions under
`<userData>/pi-sessions/<vaultId>/<id>.json` (`unassigned/` when no vault is
open, which is the rig/harness-page case). `listPiSessions`, create, read, write
and delete all use the same bucket, so a vault can only ever see its own chats.

Adoption moves the legacy flat files `<userData>/pi-sessions/*.json` into the
adopting vault's bucket once. The move is per file (rename); a collision keeps
the destination file and leaves the legacy one (nothing is overwritten).

### Hermes

A Hermes profile has its own session store, memory and skills, so the honest
scoping is one profile per vault: the vault binding is the profile. The app
attaches/ensures the vault's bound profile on vault open; the gateway's
`/api/sessions` list is therefore already the vault's own. No cross-vault rows
can exist because no cross-vault profile is bound by default.

`companion.ts` reads the active profile from the open vault's binding when a
vault is open (falling back to the legacy pref only before adoption/no vault).
`companionUseProfile` persists to the binding for the open vault.

### Renderer state

The dock keeps per-agent tab strips, transcripts, drafts, receipts, running
turns and runtime pins. None of that may survive a vault switch:

- `ChatSessionsProvider` keys its whole store on the vault id: a vault change
  bumps a vault epoch, clears the per-agent memory, the run/draft/receipt maps
  and the tab strip, stops live runs (a run that survived would keep writing
  through doors that now serve the other vault), then lands on the new vault's
  chats once its agent is ready. In-flight list/transcript reads carry the epoch
  and are dropped if it moved.
- Tab-strip persistence becomes
  `lifequest.companion.openTabs.<vaultId>.<agent>` and
  `lifequest.companion.lastSessionId.<vaultId>`. The pre-vault keys are not read
  by the app (the app-less harness pages keep their legacy slot); losing the old
  strip memory costs open-tab order, not chats.
- `ChatDockProvider` clears the cards in the composer's context, the requested
  session and the live-turn pin set.
- `CompanionProvider` listens to a new `companion:harnessChanged` push (from the
  main process, after a vault open applied its binding) so the switcher and
  Settings follow the new vault even when the harness id itself did not change.

## Main-process flow on vault open

`rememberOpen` (after `currentRoot`/`currentVaultId` are set), in order:

1. `setVaultScope({ id, rootPath })`.
2. `adoptLegacyVaultDataOnce(id)` — one-time, guarded by
   `vaultAgentsMigrated`; writes the adopting vault's binding from the effective
   legacy harness/profile and moves the flat Pi sessions. Adoption preserves what
   the operator actually had: on Hermes it binds `companionProfile ?? "lifequest"`;
   **on Pi it binds no Hermes profile** (`hermesProfile: null`) even when a legacy
   `companionProfile` pref exists — a Pi vault must not silently gain a shared
   Hermes agent. Reusing that profile later is the explicit step.
3. `applyVaultAgentBinding(scope)` — sets the active harness and, for Hermes, the
   bound profile. Applying module state is awaited (prefs read); the agent's
   `ensure` is fired in the background so a gateway start never holds the vault
   open or the vault queue. A `switching` status is published at once and the
   real verdict lands on the tagged status bus.
4. The existing MCP rebind and companion-token write continue unchanged.
5. A `companion:harnessChanged` push carries `{ vaultId, harness }` to every
   window.

Nothing here may fail the vault open: an unreadable binding, a missing profile or
a gateway that will not start is a companion status the operator can read, not a
reason to keep the previous vault's chats on screen.

## UI

### Settings → Hermes

The global "Companion" harness picker and "Companion profile" picker are replaced
in Settings by **Agents in this vault**:

- **Pi** card: built in, always in this vault; the active marker when the vault is
  on Pi.
- **Hermes** card, bound: the profile name, "Bound to this vault", and any
  warning that the profile is also used by other vaults (reused agent); actions
  **Use Hermes**, **Change agent**, **Remove from this vault**.
- **Hermes** card, unbound: "This vault has no Hermes agent." with **Create a new
  agent for this vault** and **Use an existing agent…** (installed profiles, with
  the shared-memory warning and the vaults each one works on).

The setup screen keeps its existing picker: it runs before a vault is open, where
the app-level choice is the only sensible one.

### Agent switcher

Filtered by the main process: Pi always, Hermes only when this vault has a
Hermes agent. No other change; the switcher already shows an agent that is not
offered as absent rather than greyed out.

## Testing

One E2E rig, `e2e/vault-scope.electron.mjs`, run by
`tests/vault-scope-e2e.test.ts` through the bench wrapper, with the reusable
world from the agent-switch rig (throwaway userData, two real vaults, fake Pi
endpoint, fake multiplexing Hermes host, `hermes` CLI stub first on PATH):

1. **Adoption.** Seed a flat legacy Pi session and legacy prefs whose effective
   harness is Pi; boot on vault Alpha. Alpha shows the legacy chat, prefs record
   `vaultAgents[Alpha] = { harness: "pi", hermesProfile: null }`,
   `vaultAgentsMigrated` is true, and the flat file moved into Alpha's bucket. The
   Hermes-profile adoption leg (effective harness Hermes) is covered by the
   existing `agent-switch` regression rig.
2. **Grouping.** Create an Alpha chat, then switch to vault Beta the way the
   operator does — the rail-foot vault chip's **Switch vault** dialog, which
   drives `openRecent` and so the real `VaultProvider` snapshot change (a bare
   `vaultOpen` does not move renderer state; do not test that path). Beta's rail is
   empty, its tab strip is empty, and the switcher draws only Pi.
3. **Fresh agent.** Add a fresh Hermes agent to Beta through Settings. The Hermes
   pill appears, the binding names the new profile, a Beta Hermes chat can be
   created, and a reload keeps it. Alpha still shows none of Beta's chats and no
   Hermes pill.
4. **Return.** Switch back to Alpha: its chats return, Beta's do not, the Hermes
   pill is gone. Switch to Beta: Beta's Hermes chats return with both pills.
5. **Reuse is explicit.** Add Hermes to Alpha using the profile already bound to
   Beta. The UI warning names Beta; only then does Alpha gain Hermes.

Artifacts: `e2e/artifacts/vault-scope.json` plus screenshots
`vault-scope-a.png`, `vault-scope-b-clean.png`, `vault-scope-b-hermes.png`,
`vault-scope-a-return.png`, `vault-scope-reuse-warning.png`. The report carries
the named checks; the test asserts them field by field and fails if the dev
server is missing rather than skipping.

Regression rigs that must still pass: `agent-switch`, `chat-sessions`,
`chat-tabs-restore`, `archived-chats`, `startup-boot`, `settings-hermes`.

## Out of scope

- Multiple companion agents in one dock (VISION keeps one companion per vault;
  the operator chose this option explicitly).
- Moving transcripts into the vault folder.
- Changing the hired/connected-agent roster or its grants.
