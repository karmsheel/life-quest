/**
 * Theme tools — the companion's half of the authoring loop.
 *
 * The spike proved an agent can write a JSON file and the running app wears it
 * with a preview and a way back. What it did NOT have was a real agent doing the
 * writing: the rig dropped the file onto disk itself. These three tools close
 * that loop:
 *
 *  - `get_theme`       — what exists, and which file is kept (so it can iterate)
 *  - `validate_theme`  — dry run: field errors and the WCAG pair, named
 *  - `write_theme`     — write the file; the app previews it for ten seconds
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
import type { MapToolDef } from "@lifequest/vault-core";
import {
  parseThemeFile,
  resolveChrome,
  resolveMaterial,
  THEME_VOCABULARY,
  type ThemeFile,
} from "../shared/theme-file.ts";

export const THEME_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_theme",
    description:
      "Read the app's theme files and the one currently kept. Use it before writing so you iterate from what the operator is wearing instead of guessing. Returns the resolved chrome placement and material of the kept theme, and any composition widgets it carries.",
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
  const themes = await listThemes();
  const kept = themes.find((candidate) => candidate.file === keptFile && candidate.valid);
  return {
    keptFile,
    ...(kept
      ? {
          current: {
            file: kept.file,
            label: kept.label,
            chrome: kept.chrome,
            material: kept.material,
            ...(kept.composition ? { composition: kept.composition } : {}),
          },
        }
      : { current: null }),
    themes,
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
  const dir = themesDirectory();
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, file);
  const serialized = `${JSON.stringify(theme, null, 2)}\n`;
  await fs.promises.writeFile(`${target}.tmp`, serialized);
  await fs.promises.rename(`${target}.tmp`, target);
  const keptFile = await readKeptFile();
  return {
    written: file,
    path: target,
    keptFile,
    preview:
      "Written. The operator's window now wears it as a 10-second preview with Keep and Revert; it is not kept until they press Keep.",
  };
}

/**
 * One theme tool call. `name` is already known to be one of THEME_TOOL_DEFS
 * (the door advertises only these, and the dispatcher checks the list first).
 */
export async function executeThemeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === "get_theme") return getTheme();
  if (name === "validate_theme") {
    const theme = themeArgument(args);
    if ("error" in theme) return theme;
    return { ok: true, theme };
  }
  if (name === "write_theme") return writeTheme(args);
  return malformed(`Unknown theme tool: ${name}`);
}
