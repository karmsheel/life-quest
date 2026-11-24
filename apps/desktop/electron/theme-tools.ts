/**
 * Theme tools — the companion's half of the authoring loop.
 *
 * The spike proved an agent can write a JSON file and the running app wears it
 * with a preview and a way back. What it did NOT have was a real agent doing the
 * writing: the rig dropped the file onto disk itself. These four tools close
 * that loop:
 *
 *  - `get_theme`       — what exists, which file is kept, and the stored pictures
 *  - `validate_theme`  — dry run: field errors and the WCAG pair, named
 *  - `write_theme`     — write the file; the app previews it for ten seconds
 *  - `store_background_picture` — copy a vault picture into the profile
 *
 * They live in main, not in `vault-core`, because a theme is app profile state:
 * `userData/themes/*.json`, never the vault. A theme is presentation and needs
 * no Decision — the preview/Keep gate is its consent — which is exactly why the
 * write tool is available to the companion with no confirmation card.
 *
 * Connected (paired) agents are refused: their tools are granted per domain and
 * a theme belongs to the whole studio. `toolAllowed` answers FORBIDDEN for any
 * name it does not classify, and these names are never advertised to them.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  assertPhysicalContainment,
  type MapToolDef,
} from "@lifequest/vault-core";
import {
  DEFAULT_BACKGROUND_IMAGE,
  parseThemeFile,
  resolveChrome,
  resolveMaterial,
  resolveScene,
  THEME_VOCABULARY,
  type ThemeBackgroundImage,
  type ThemeFile,
  type ThemeScene,
} from "../shared/theme-file.ts";
import { listBackgrounds, storeBackground } from "./theme-background.js";
import { saveThemeFile } from "./theme-store.js";

export const THEME_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_theme",
    description:
      "Read the app's theme files, the one currently kept, and the pictures stored in the profile. Use it before writing so you iterate from what the operator is wearing instead of guessing. Returns the kept file, each theme's resolved scene (preset, intensity, frames, picture and panel shades), the kept theme's resolved chrome placement and material, any composition widgets it carries, and the backgrounds/ inventory (file, bytes, mime) you may name in scene.background.image.file.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "validate_theme",
    description:
      "Dry-run one theme object without writing anything. Returns ok, or the field error (and, for palettes, the WCAG pair that fails contrast) in a sentence you can act on.",
    parameters: {
      type: "object",
      properties: {
        theme: {
          type: "object",
          description:
            "The theme object: { name (slug), label, description?, chrome?, material?, scene?, composition?, colors?, darkColors? }.",
        },
      },
      required: ["theme"],
    },
  },
  {
    name: "write_theme",
    description:
      "Write a theme file into the app profile's themes/ directory. The operator's window wears it at once as a 10-second preview with Keep and Revert, so never describe it to them as applied until they keep it. This is presentation only: no Decision, nothing written to the vault.",
    parameters: {
      type: "object",
      properties: {
        theme: {
          type: "object",
          description:
            "The theme object: { name (slug), label, description?, chrome?, material?, scene?, composition?, colors?, darkColors? }.",
        },
        file: {
          type: "string",
          description:
            "Optional file name to write (lowercase slug + .json). Defaults to <name>.json.",
        },
      },
      required: ["theme"],
    },
  },
  {
    name: "store_background_picture",
    description:
      "Copy a picture from the open vault into the app profile's backgrounds/ folder and return the stored file name. The source must be an image file inside the vault (e.g. images/files/<id>.png) — never a URL or a path outside the vault. Nothing the operator sees changes until a theme names the returned file in scene.background.image.file; write_theme then previews and Keep/Revert is still the consent.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Vault-relative image path, e.g. images/files/<id>.png",
        },
      },
      required: ["source"],
    },
  },
];

const THEME_FILE = /^[a-z0-9][a-z0-9-]{1,39}\.json$/;

type ToolError = { error: { code: "MALFORMED" | "NOT_FOUND"; message: string } };

function malformed(message: string): ToolError {
  return { error: { code: "MALFORMED", message } };
}

function themesDirectory(): string {
  return path.join(app.getPath("userData"), "themes");
}

function stateFile(): string {
  return path.join(app.getPath("userData"), "theme-state.json");
}

async function readKeptFile(): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(stateFile(), "utf8")) as {
      keptFile?: unknown;
    };
    return typeof raw.keptFile === "string" && THEME_FILE.test(raw.keptFile)
      ? raw.keptFile
      : null;
  } catch {
    return null;
  }
}

type ThemeSummary = {
  file: string;
  label: string;
  valid: boolean;
  description?: string;
  chrome?: { wingSwitcher: { place: string; variant: string }; domainSwitcher: { place: string; variant: string } };
  material?: { radius: string; density: string; motion: string };
  /** The scene as worn: defaults filled in, so the agent reads real values. */
  scene?: ThemeScene;
  composition?: { layout: string; widgets: number };
  error?: string;
};

async function listThemes(): Promise<ThemeSummary[]> {
  const dir = themesDirectory();
  let names: string[] = [];
  try {
    names = (await fs.promises.readdir(dir))
      .filter((name) => THEME_FILE.test(name))
      .sort();
  } catch {
    return [];
  }
  const themes: ThemeSummary[] = [];
  for (const file of names) {
    const summary: ThemeSummary = { file, label: file, valid: false };
    try {
      const parsed = parseThemeFile(
        JSON.parse(await fs.promises.readFile(path.join(dir, file), "utf8")),
      );
      if (parsed.ok) {
        summary.valid = true;
        summary.label = parsed.theme.label;
        if (parsed.theme.description) summary.description = parsed.theme.description;
        summary.chrome = resolveChrome(parsed.theme.chrome);
        summary.material = resolveMaterial(parsed.theme.material);
        summary.scene = resolveScene(parsed.theme.scene);
        if (parsed.theme.composition) {
          summary.composition = {
            layout: parsed.theme.composition.layout,
            widgets: parsed.theme.composition.widgets.length,
          };
        }
      } else {
        summary.error = parsed.error;
      }
    } catch {
      summary.error = "not valid JSON";
    }
    themes.push(summary);
  }
  return themes;
}

async function getTheme(): Promise<unknown> {
  const keptFile = await readKeptFile();
  // The inventory is the profile's, not the vault's, so it is readable with no
  // vault open — same as the theme files it sits beside.
  const [themes, backgrounds] = await Promise.all([
    listThemes(),
    listBackgrounds(),
  ]);
  const kept = themes.find((candidate) => candidate.file === keptFile && candidate.valid);
  return {
    keptFile,
    ...(kept
      ? {
          current: {
            file: kept.file,
            label: kept.label,
            scene: kept.scene,
            chrome: kept.chrome,
            material: kept.material,
            ...(kept.composition ? { composition: kept.composition } : {}),
          },
        }
      : { current: null }),
    themes,
    backgrounds,
    vocabulary: THEME_VOCABULARY,
  };
}

function themeArgument(args: Record<string, unknown>): ThemeFile | ToolError {
  if (args.theme === undefined) return malformed("theme is required");
  const parsed = parseThemeFile(args.theme);
  if (!parsed.ok) return malformed(parsed.error);
  return parsed.theme;
}

async function writeTheme(args: Record<string, unknown>): Promise<unknown> {
  const theme = themeArgument(args);
  if ("error" in theme) return theme;
  const requested = args.file;
  const file =
    requested === undefined
      ? `${theme.name}.json`
      : typeof requested === "string" && THEME_FILE.test(requested)
        ? requested
        : null;
  if (!file) {
    return malformed(
      "file must be a lowercase slug ending in .json (a-z, 0-9, dash; 2–40 chars before .json)",
    );
  }
  // The one write path, shared with the Extensions editor: validation, the
  // history snapshot and the atomic rename all happen inside the store, so a
  // companion write is undoable in exactly the way an operator's Save is.
  const written = await saveThemeFile(file, JSON.stringify(theme, null, 2));
  if (!written.ok) return malformed(written.error);
  const keptFile = await readKeptFile();
  return {
    written: written.file,
    path: path.join(themesDirectory(), written.file),
    keptFile,
    preview:
      "Written. The operator's window now wears it as a 10-second preview with Keep and Revert; it is not kept until they press Keep.",
  };
}

/**
 * Whether a source string names a scheme instead of a path.
 *
 * A scheme is a fetch, not a file, and this tool never fetches. A Windows drive
 * letter looks like a scheme (`C:`) but is an absolute path, so it is not one.
 * The rule is `chat-image.ts`'s, kept identical so both doors refuse the same
 * strings; that module's door is the chat's and does not export the helper, and
 * this one is five lines.
 */
function hasScheme(ref: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(ref)) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref);
}

/** What the agent is told to do with a stored picture; the tool writes no theme. */
const STORE_NOTE =
  "write_theme with scene.background.image = image to wear it; the operator's Settings override still outranks the theme.";

/**
 * Copy one vault picture into the profile's `backgrounds/`.
 *
 * The vault root arrives from the dispatcher, so a path the agent sends is a
 * *vault* path: a relative one resolves against the root, an absolute one is
 * kept only if the physical containment proof puts it inside the vault (a
 * symlink out is refused). The copy is `theme-background.ts`'s, so the size,
 * type, magic-byte and atomic-write rules are the operator's picker's own. This
 * tool never writes a theme and never previews one: the returned file name is
 * something `write_theme` can name, and Keep is still the operator's consent.
 */
async function storeBackgroundPicture(
  args: Record<string, unknown>,
  vaultRoot: string | null | undefined,
): Promise<unknown> {
  const source = args.source;
  const raw = typeof source === "string" ? source.trim() : "";
  // NUL is not part of a path, it is where one ends; a scheme is not a path at
  // all. Both are refused before anything touches the filesystem.
  if (!raw || raw.includes("\u0000") || hasScheme(raw)) {
    return malformed("source must be a picture inside the vault");
  }
  if (!vaultRoot) {
    return {
      error: {
        code: "NOT_FOUND",
        message: "open a vault before storing a background picture",
      },
    };
  }
  const resolved = path.isAbsolute(raw)
    ? path.normalize(raw)
    : path.resolve(vaultRoot, raw);
  let contained: string;
  try {
    contained = await assertPhysicalContainment(vaultRoot, resolved);
  } catch {
    return malformed("source must be a picture inside the vault");
  }
  const stored = await storeBackground(contained);
  if (!stored.ok) return malformed(stored.error);
  const image: ThemeBackgroundImage = {
    file: stored.value.file,
    ...DEFAULT_BACKGROUND_IMAGE,
  };
  return { stored: stored.value.file, image, note: STORE_NOTE };
}

/**
 * One theme tool call. `name` is already known to be one of THEME_TOOL_DEFS
 * (the door advertises only these, and the dispatcher checks the list first).
 * `vaultRoot` is the open vault the dispatcher knows about; only the picture
 * store needs it, and the other tools keep working with no vault open.
 */
export async function executeThemeTool(
  name: string,
  args: Record<string, unknown>,
  vaultRoot?: string | null,
): Promise<unknown> {
  if (name === "get_theme") return getTheme();
  if (name === "validate_theme") {
    const theme = themeArgument(args);
    if ("error" in theme) return theme;
    return { ok: true, theme };
  }
  if (name === "write_theme") return writeTheme(args);
  if (name === "store_background_picture") {
    return storeBackgroundPicture(args, vaultRoot);
  }
  return malformed(`Unknown theme tool: ${name}`);
}
