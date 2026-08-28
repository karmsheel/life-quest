export function windowTitleLabel(vaultName?: string | null): string {
  const name = vaultName?.trim();
  return name ? `LifeQuest — ${name}` : "LifeQuest";
}
