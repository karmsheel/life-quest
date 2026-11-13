// Which vault the harness stores belong to.
//
// A vault is the profile the studio loads: its chats and its agents are the
// vault's, not the app's. The main process publishes the open vault here once —
// in `rememberOpen`, the one place a vault becomes current — so the stores that
// deliberately live outside the vault folder (Pi's transcripts, the Hermes agent
// binding) can key their data by the vault's identity instead of the app's.
//
// Deliberately free of Electron imports: the rigs and the harness bundle this
// module on its own, and an `app.getPath` here would make it unloadable outside
// a running app.
export type VaultScope = { id: string; rootPath: string };

let scope: VaultScope | null = null;
const listeners = new Set<(scope: VaultScope | null) => void>();

/**
 * Publish the open vault. A switch sets this again before anything reads the
 * chat stores, so no store can answer from a vault that is no longer open.
 */
export function setVaultScope(next: VaultScope | null): void {
  scope = next;
  for (const listener of [...listeners]) {
    try {
      listener(scope);
    } catch {
      // A listener that throws must not leave the scope half-applied.
    }
  }
}

export function currentVaultScope(): VaultScope | null {
  return scope;
}

/**
 * The folder name a store keys on: the vault's stable identity, never its path,
 * so a copied or moved vault keeps its chats.
 *
 * `unassigned` is the no-vault case — the setup screen before a vault is picked,
 * and the app-less harness pages and rigs that must keep working without one.
 * An id that is not a plain path segment is not trusted to become one.
 */
export function currentVaultBucket(): string {
  const id = scope?.id;
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : "unassigned";
}

/** Returns the unsubscribe. */
export function onVaultScopeChanged(
  fn: (scope: VaultScope | null) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
