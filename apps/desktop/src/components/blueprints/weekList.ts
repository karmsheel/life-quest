import { addDays, mondaysInYear } from "@lifequest/vault-core/map";

export function weekOptions(year: number) {
  return mondaysInYear(year).map((monday) => ({
    monday,
    label: `${monday} – ${addDays(monday, 6)}`,
  }));
}
