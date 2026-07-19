import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

export type RecentEntry = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
};

export type UserPrefs = {
  recent: RecentEntry[];
  activeDomainByVaultId: Record<string, string>;
};

const MAX_RECENT = 20;

function prefsPath(): string {
  return path.join(app.getPath("userData"), "recent.json");
}

const emptyPrefs = (): UserPrefs => ({
  recent: [],
  activeDomainByVaultId: {},
});

export async function loadPrefs(): Promise<UserPrefs> {
  try {
    const raw = await fs.readFile(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      activeDomainByVaultId:
        parsed.activeDomainByVaultId &&
        typeof parsed.activeDomainByVaultId === "object"
          ? parsed.activeDomainByVaultId
          : {},
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyPrefs();
    }
    throw e;
  }
}

export async function savePrefs(prefs: UserPrefs): Promise<void> {
  const file = prefsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

/** Touch or insert a recent vault entry (most-recent-first). */
export async function recordRecentVault(entry: {
  id: string;
  name: string;
  path: string;
}): Promise<void> {
  const prefs = await loadPrefs();
  const now = new Date().toISOString();
  const next: RecentEntry = {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    lastOpenedAt: now,
  };
  const filtered = prefs.recent.filter(
    (r) => r.id !== entry.id && r.path !== entry.path,
  );
  prefs.recent = [next, ...filtered].slice(0, MAX_RECENT);
  await savePrefs(prefs);
}

export async function listRecentVaults(): Promise<RecentEntry[]> {
  const prefs = await loadPrefs();
  return prefs.recent;
}

export async function getActiveDomain(vaultId: string): Promise<string | null> {
  const prefs = await loadPrefs();
  return prefs.activeDomainByVaultId[vaultId] ?? null;
}

export async function setActiveDomain(
  vaultId: string,
  slug: string,
): Promise<void> {
  const prefs = await loadPrefs();
  prefs.activeDomainByVaultId[vaultId] = slug;
  await savePrefs(prefs);
}
