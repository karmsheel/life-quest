import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Per-session pref for unsolicited implied-Decision filing from a companion turn.
 * Stored on its own so it never touches recent.json / recent-vaults.ts.
 */
export type CompanionFilingPrefs = {
  /** sessionId -> fileUnsolicited. A missing entry means on. */
  fileUnsolicitedBySessionId: Record<string, boolean>;
};

function prefsPath(): string {
  return path.join(app.getPath("userData"), "companion-filing.json");
}

const emptyPrefs = (): CompanionFilingPrefs => ({
  fileUnsolicitedBySessionId: {},
});

async function loadFilingPrefs(): Promise<CompanionFilingPrefs> {
  try {
    const raw = await fs.readFile(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CompanionFilingPrefs>;
    const map = parsed.fileUnsolicitedBySessionId;
    return {
      fileUnsolicitedBySessionId:
        map && typeof map === "object" && !Array.isArray(map)
          ? (map as Record<string, boolean>)
          : {},
    };
  } catch {
    return emptyPrefs();
  }
}

async function saveFilingPrefs(prefs: CompanionFilingPrefs): Promise<void> {
  await fs.mkdir(path.dirname(prefsPath()), { recursive: true });
  await fs.writeFile(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}

/** Missing session or unreadable file means filing is on: the companion may file. */
export async function getFileUnsolicited(sessionId: string): Promise<boolean> {
  const prefs = await loadFilingPrefs();
  const value = prefs.fileUnsolicitedBySessionId[sessionId];
  return typeof value === "boolean" ? value : true;
}

export async function setFileUnsolicited(sessionId: string, enabled: boolean): Promise<void> {
  const prefs = await loadFilingPrefs();
  prefs.fileUnsolicitedBySessionId[sessionId] = enabled;
  await saveFilingPrefs(prefs);
}
