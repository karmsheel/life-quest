import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * App-wide pref for unsolicited implied-Decision filing from a companion turn.
 * Stored on its own so it never touches recent.json / recent-vaults.ts.
 * A missing value means on.
 */
export type CompanionFilingPrefs = {
  fileUnsolicited?: boolean;
};

function prefsPath(): string {
  return path.join(app.getPath("userData"), "companion-filing.json");
}

const emptyPrefs = (): CompanionFilingPrefs => ({});

async function loadFilingPrefs(): Promise<CompanionFilingPrefs> {
  try {
    const raw = await fs.readFile(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CompanionFilingPrefs>;
    return {
      fileUnsolicited:
        typeof parsed.fileUnsolicited === "boolean" ? parsed.fileUnsolicited : undefined,
    };
  } catch {
    return emptyPrefs();
  }
}

async function saveFilingPrefs(prefs: CompanionFilingPrefs): Promise<void> {
  await fs.mkdir(path.dirname(prefsPath()), { recursive: true });
  await fs.writeFile(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}

/** Missing pref or an unreadable file means filing is on: the companion may file. */
export async function getFileUnsolicited(): Promise<boolean> {
  const prefs = await loadFilingPrefs();
  return prefs.fileUnsolicited !== false;
}

export async function setFileUnsolicited(enabled: boolean): Promise<void> {
  const prefs = await loadFilingPrefs();
  prefs.fileUnsolicited = enabled;
  await saveFilingPrefs(prefs);
}
