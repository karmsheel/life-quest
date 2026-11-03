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

/**
 * The vault's mark in the thin rail: the vault name reduced to its initials.
 *
 * A one-word name gives one letter ("Personal" → "P"); two or three words give
 * their initials ("Harness Vault" → "HV", "My Life Vault" → "MLV"). A longer name
 * keeps the first three words' initials, because a fourth letter would stop
 * fitting the icon column and the mark has to stay one glyph. The empty state is
 * the fallback name's letter, so the chip is never blank.
 */
export function vaultInitials(vaultName?: string | null): string {
  const initials = (vaultName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return initials || "L";
}
