export function windowTitleLabel(vaultName?: string | null): string {
  const name = vaultName?.trim();
  return name ? `LifeQuest — ${name}` : "LifeQuest";
}

/**
 * The name the shell's chrome wears — the workspace's own name, not the app's.
 * Falls back to the app name while no vault is open (welcome / companion setup),
 * which is the only state where there is no vault to name.
 */
export function vaultTitleName(vaultName?: string | null): string {
  return vaultName?.trim() || "LifeQuest";
}
