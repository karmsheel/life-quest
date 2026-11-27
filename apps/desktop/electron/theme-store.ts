/**
 * Theme files, one write path.
 *
 * Four gestures now end in the same place: the Customizations editor's Save, the
 * companion's `write_theme`, restoring a saved version, and importing a file.
 * If each one wrote the directory itself they would drift on the two things
 * that matter — the parser every file must pass, and the atomic write that
 * keeps the watcher from ever seeing half a file — so this module is the only
 * code that touches `userData/themes/*.json`.
 *
 * It owns the second half of that promise too: before a file is replaced, its
 * previous bytes are kept under `theme-history/`. History lives *outside*
 * `themes/` on purpose. The theme list and the fs watcher read that directory
 * wholesale, so a snapshot beside the themes would be listed as a theme and
 * previewed as one the moment it was written.
 *
 * Nothing here touches the vault. A theme is presentation, kept in the app
 * profile, and the preview/Keep gate in the window is still its consent: this
 * module writes a file, it never calls `theme:setKept`.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseThemeFile } from "../shared/theme-file.ts";

/** The file-name rule the theme list, the tools and the rigs all share. */
export const THEME_FILE = /^[a-z0-9][a-z0-9-]{1,39}\.json$/;

/**
 * A version id reaches `path.join` as a path segment, so it is allow-listed
 * rather than escaped. The pattern is the contract's; `..` is refused
 * separately because the pattern itself permits dots.
 */
export const THEME_VERSION_ID = /^[A-Za-z0-9:._-]+$/;

/** How many snapshots one theme file keeps. Beyond this, the oldest is dropped. */
const HISTORY_RETENTION = 10;

/** An import is a file a person picked; these are small by nature. */
const MAX_IMPORT_BYTES = 256 * 1024;

/** One saved version of one theme file, newest first. */
export type ThemeVersion = {
  id: string;
  savedAt: string;
  label: string;
  bytes: number;
};

export type SaveResult = { ok: true; file: string } | { ok: false; error: string };

export type ImportResult =
  | { ok: true; value: { file: string; label: string } }
  | { ok: false; error: string };

const themesDirectory = (): string => path.join(app.getPath("userData"), "themes");

/**
 * `theme-history/<file-stem>/`. The file's own name decides the folder, so a
 * version can never be listed against the wrong theme, and the stem (not the
 * `.json`) keeps the path stable.
 */
const historyDirectory = (file: string): string =>
  path.join(app.getPath("userData"), "theme-history", file.replace(/\.json$/, ""));

/** A non-dot id; the separators are refused rather than trusted to path.join. */
export function isThemeVersionId(id: unknown): id is string {
  return typeof id === "string" && THEME_VERSION_ID.test(id) && !id.includes("..");
}

/**
 * `2026-11-19T08:46:14.123Z` -> `2026-11-19T08-46-14-123Z`.
 *
 * Colons are legal in an ISO string and illegal in a Windows file name, so the
 * directory holds the dash form; `savedAt` in the answer rebuilds the real ISO
 * string, because that is what the UI formats and the rig asserts.
 */
function idStamp(savedAt: string): string {
  return savedAt.replace(/[:.]/g, "-");
}

/** The real ISO timestamp back out of an id's `<stamp>--<sha8>` prefix. */
function savedAtFromId(id: string): string {
  const stamp = id.split("--")[0] ?? "";
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(stamp);
  return match
    ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`
    : stamp;
}

/**
 * Write through `<target>.tmp` and rename.
 *
 * `rename` within one directory is atomic, so the watcher either sees the old
 * file or the new one — never the bytes of a write still in progress. Every
 * write in this module goes through here for that reason.
 */
async function writeAtomic(target: string, contents: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(`${target}.tmp`, contents);
  await fs.promises.rename(`${target}.tmp`, target);
}

/** Every id this file has, newest first. A missing history dir is "none yet". */
async function historyIds(file: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(historyDirectory(file));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter(isThemeVersionId)
    // The stamp is the front of the id and fixed-width, so lexical order is
    // chronological order; newest first is the order the UI wants to show.
    .sort()
    .reverse();
}

/**
 * Drop everything past the retention window.
 *
 * A failure to prune is logged and swallowed: the write this rides with has
 * already happened, and a full history disk is a smaller problem than a save
 * the operator was told failed.
 */
async function pruneHistory(file: string): Promise<void> {
  try {
    const stale = (await historyIds(file)).slice(HISTORY_RETENTION);
    await Promise.all(
      stale.map((id) =>
        fs.promises.rm(path.join(historyDirectory(file), `${id}.json`), {
          force: true,
        }),
      ),
    );
  } catch (error) {
    console.error("[theme] history prune failed:", error);
  }
}

/**
 * Keep the bytes a write is about to replace.
 *
 * The snapshot is written *before* the new file, so a save that then fails
 * still leaves the version that existed. A file that is not there yet is the
 * normal first-save case, not an error: there is nothing to keep.
 */
async function snapshotBeforeWrite(file: string): Promise<void> {
  const target = path.join(themesDirectory(), file);
  let previous: string;
  try {
    previous = await fs.promises.readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const savedAt = new Date().toISOString();
  const sha8 = createHash("sha256").update(previous, "utf8").digest("hex").slice(0, 8);
  await writeAtomic(
    path.join(historyDirectory(file), `${idStamp(savedAt)}--${sha8}.json`),
    previous,
  );
  await pruneHistory(file);
}

/**
 * Validate one theme source and write it as `<file>`.
 *
 * The order is the contract: name, then JSON, then the shared parser — with
 * the parser's own message reaching the renderer verbatim, because it is the
 * sentence that names the field the operator or the companion must fix. Only
 * once all three pass does the previous file become history and the new bytes
 * land.
 */
export async function saveThemeFile(file: string, raw: string): Promise<SaveResult> {
  if (!THEME_FILE.test(file)) {
    return { ok: false, error: "theme file must be a lowercase .json name" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "theme source is not JSON",
    };
  }
  const parsed = parseThemeFile(json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    await snapshotBeforeWrite(file);
    await writeAtomic(path.join(themesDirectory(), file), `${raw.trim()}\n`);
    return { ok: true, file };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * One file's versions, newest first.
 *
 * A snapshot is read with a light JSON parse rather than `parseThemeFile`: the
 * row's job is to show what was saved, and an old file that has since become
 * invalid still deserves a row (and a restore attempt, which will be refused
 * with the parser's message). `bytes` is what was on disk.
 */
export async function listThemeHistory(file: string): Promise<ThemeVersion[]> {
  if (!THEME_FILE.test(file)) {
    throw new Error("theme file must be a lowercase .json name");
  }
  const dir = historyDirectory(file);
  const fallbackLabel = file.replace(/\.json$/, "");
  const versions: ThemeVersion[] = [];
  for (const id of await historyIds(file)) {
    try {
      const raw = await fs.promises.readFile(path.join(dir, `${id}.json`), "utf8");
      let label = fallbackLabel;
      try {
        const parsed = JSON.parse(raw) as { label?: unknown };
        if (typeof parsed.label === "string" && parsed.label.trim()) {
          label = parsed.label;
        }
      } catch {
        // A snapshot that is not JSON still gets a row; the label falls back.
      }
      versions.push({
        id,
        savedAt: savedAtFromId(id),
        label,
        bytes: Buffer.byteLength(raw, "utf8"),
      });
    } catch {
      // A snapshot that vanished between listing and reading is not a version.
    }
  }
  return versions;
}

/** The raw text of one saved version, or null when there is no such version. */
export async function readThemeSnapshot(
  file: string,
  id: string,
): Promise<string | null> {
  if (!THEME_FILE.test(file) || !isThemeVersionId(id)) return null;
  try {
    return await fs.promises.readFile(
      path.join(historyDirectory(file), `${id}.json`),
      "utf8",
    );
  } catch {
    return null;
  }
}

/**
 * Put one saved version back.
 *
 * History is a directory on disk, so it is re-validated before the write: an
 * edited or truncated snapshot is refused by the same parser as any other
 * source. The restore then goes through `saveThemeFile`, which means it also
 * versions the bytes it replaced — every undo of an undo is still an undo.
 */
export async function restoreThemeVersion(
  file: string,
  id: string,
): Promise<SaveResult> {
  if (!THEME_FILE.test(file)) {
    return { ok: false, error: "theme file must be a lowercase .json name" };
  }
  if (!isThemeVersionId(id)) {
    return { ok: false, error: "theme version id is not valid" };
  }
  const raw = await readThemeSnapshot(file, id);
  if (raw === null) return { ok: false, error: "theme version not found" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "theme source is not JSON",
    };
  }
  const parsed = parseThemeFile(json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return saveThemeFile(file, raw);
}

/**
 * `<name>.json`, then `<name>-imported.json`, `<name>-imported-2.json`, …
 *
 * Importing must never replace the operator's file: the imported copy is a new
 * theme, and a name collision is answered with a suffix rather than a refusal
 * or an overwrite. The check is a read, not a lock — the only race here is the
 * operator importing twice at once, and the worst case is the second copy
 * landing where the first did.
 *
 * The suffix has to fit the same 2–40 character slug rule as the base name, so
 * a long name is trimmed rather than turned into an illegal destination.
 */
async function freeDestination(name: string): Promise<string> {
  const dir = themesDirectory();
  const taken = async (file: string): Promise<boolean> => {
    try {
      await fs.promises.access(path.join(dir, file));
      return true;
    } catch {
      return false;
    }
  };
  if (!(await taken(`${name}.json`))) return `${name}.json`;
  for (let n = 1; n <= 100; n += 1) {
    const suffix = n === 1 ? "-imported" : `-imported-${n}`;
    const base = name.slice(0, Math.max(2, 40 - suffix.length)).replace(/-+$/, "");
    const candidate = `${base}${suffix}.json`;
    if (!(await taken(candidate))) return candidate;
  }
  // A hundred copies of one name is already absurd; the timestamp keeps the
  // file-name rule intact if it ever happens.
  const stamp = String(Date.now());
  return `${name.slice(0, 40 - 10 - stamp.length)}-imported-${stamp}.json`;
}

/**
 * Copy one theme file from somewhere on disk into the profile.
 *
 * The source is a path main chose — a dialog's answer, or a rig's queued
 * fixture — never a string the renderer handed over. It is sized, parsed and
 * re-serialised by the same rules as any other write, so an imported file
 * cannot be a way around validation. The copy is written through
 * `saveThemeFile`: a destination that was free has no history to keep.
 */
export async function importThemeFile(sourcePath: string): Promise<ImportResult> {
  if (typeof sourcePath !== "string" || sourcePath.trim() === "") {
    return { ok: false, error: "import source is not a file path" };
  }
  let raw: string;
  try {
    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile()) return { ok: false, error: "import source is not a file" };
    if (stat.size > MAX_IMPORT_BYTES) {
      return { ok: false, error: "theme file is larger than 256 KB" };
    }
    raw = await fs.promises.readFile(sourcePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "theme source is not JSON",
    };
  }
  const parsed = parseThemeFile(json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const file = await freeDestination(parsed.theme.name);
  const saved = await saveThemeFile(file, raw);
  if (!saved.ok) return saved;
  return { ok: true, value: { file: saved.file, label: parsed.theme.label } };
}
