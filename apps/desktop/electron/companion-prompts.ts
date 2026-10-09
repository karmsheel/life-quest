import fs from "node:fs/promises";
import path from "node:path";
import { COMPANION_SOUL } from "./companion-profile.ts";
import type { CompanionInstructionsInput } from "./companion-client.ts";

/**
 * What the companion is actually told, and what it has been given to read.
 *
 * This exists because the operator could not see any of it. The system prompt is
 * assembled from three places that are invisible from inside the app — the
 * profile's SOUL.md, the per-turn `instructions` the app builds for each chat
 * turn, and the skill library Hermes keeps beside the profile — and the one time
 * it mattered most, the answer was in none of them: the MCP door was advertising
 * 62 tools with no argument schemas, so the companion was guessing at the shape
 * of every call and failing on the same one 40 times. Settings now shows all
 * three, so "what is my companion being told?" is a question the app answers
 * rather than one the operator has to go digging in %LOCALAPPDATA% for.
 *
 * Read-only by design. Nothing here writes to the profile: the SOUL is reported
 * as it stands on disk, seeded or operator-edited, and the skills are reported as
 * Hermes' curator left them.
 */

export type CompanionSkill = {
  name: string;
  description: string;
  /** The skills/ subdirectory it lives in, e.g. "lifequest" or "productivity". */
  category: string;
  /** Path relative to the Hermes home, e.g. skills/lifequest/<name>/SKILL.md. */
  relPath: string;
  /** True for skills this app's own domain owns — skills/lifequest/*. */
  lifequest: boolean;
  /** True when the file's hash is in the profile's bundled manifest. */
  bundled: boolean;
  pinned: boolean;
  useCount: number;
  viewCount: number;
  lastUsedAt: string | null;
  version: string | null;
  tags: string[];
};

export type CompanionPrompts = {
  /** The lifequest profile directory, so a reader can go and look. */
  profilePath: string;
  soul: {
    path: string;
    /** The file as it stands, or the seed when the profile has none yet. */
    text: string;
    /** True when the file is this app's own seed, unedited by the operator. */
    seeded: boolean;
    /** True when the operator has written their own words into it. */
    edited: boolean;
  };
  instructions: {
    /** The per-turn block the app appends to every chat turn, as it would read now. */
    text: string;
    context: CompanionInstructionsInput;
  };
  skills: CompanionSkill[];
  /** Where the app's own copy of the SOUL lives, for the "it is a seed" note. */
  soulSeedPath: string;
};

/**
 * The YAML frontmatter a SKILL.md opens with, read without a YAML parser.
 *
 * Only four fields are ever wanted and all four are plain scalars on one line, so
 * a targeted read is honest about what it does: a description that spans lines is
 * reported as its first line rather than silently dropped, and a file with no
 * frontmatter still lists, named after its directory.
 */
export function parseSkillFrontmatter(markdown: string): {
  name: string | null;
  description: string | null;
  version: string | null;
  tags: string[];
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return { name: null, description: null, version: null, tags: [] };
  const head = match[1] ?? "";
  const scalar = (key: string): string | null => {
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(head);
    if (!line) return null;
    const value = (line[1] ?? "").trim().replace(/^["']|["']$/g, "");
    return value || null;
  };
  const tagsLine = /^[ \t]*tags:[ \t]*(.*)$/m.exec(head);
  const tags = (tagsLine?.[1] ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  return {
    name: scalar("name"),
    description: scalar("description"),
    version: scalar("version"),
    tags,
  };
}

/** One skill's live usage record, as Hermes' curator keeps it. */
type SkillUsage = {
  state?: unknown;
  pinned?: unknown;
  use_count?: unknown;
  view_count?: unknown;
  last_used_at?: unknown;
};

function numberOr(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The profile's skill library, as the companion sees it.
 *
 * Hermes keeps skills at `<profile>/skills/<category>/<skill>/SKILL.md` — and at
 * `<profile>/skills/<skill>/SKILL.md` for one with no category — with a usage
 * ledger beside them keyed by skill NAME. An archived skill is left out: it is not
 * in the companion's catalogue either, and listing one the agent cannot read
 * would make this page lie.
 */
export async function readProfileSkills(
  profilePath: string,
): Promise<CompanionSkill[]> {
  const skillsRoot = path.join(profilePath, "skills");
  const usage = await readSkillUsage(skillsRoot);
  const bundled = await readBundledNames(skillsRoot);

  let categories: string[];
  try {
    categories = (await fs.readdir(skillsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }

  const out: CompanionSkill[] = [];
  for (const category of categories) {
    const categoryDir = path.join(skillsRoot, category);
    let entries: string[];
    try {
      entries = (await fs.readdir(categoryDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = path.join(categoryDir, entry);
      // A categorised skill is <category>/<name>/SKILL.md. A skill with no
      // category is <name>/SKILL.md, which this loop reaches as the "category"
      // itself; both shapes are tried so neither is lost.
      const candidates = [
        path.join(dir, "SKILL.md"),
        path.join(categoryDir, `${entry}.md`),
      ];
      let markdown: string | null = null;
      let found = "";
      for (const candidate of candidates) {
        try {
          markdown = await fs.readFile(candidate, "utf8");
          found = candidate;
          break;
        } catch {
          // try the next shape
        }
      }
      if (markdown === null) continue;
      const head = parseSkillFrontmatter(markdown);
      const name = head.name ?? entry;
      const record = usage.get(name);
      if (record?.state === "archived") continue;
      out.push({
        name,
        description: head.description ?? firstProseLine(markdown),
        category,
        relPath: path.relative(path.dirname(skillsRoot), found).split(path.sep).join("/"),
        lifequest: category === "lifequest",
        bundled: bundled.has(name),
        pinned: record?.pinned === true,
        useCount: numberOr(record?.use_count),
        viewCount: numberOr(record?.view_count),
        lastUsedAt: typeof record?.last_used_at === "string" ? record.last_used_at : null,
        version: head.version,
        tags: head.tags,
      });
    }
  }

  // LifeQuest's own skills first, then the ones the companion has actually used,
  // then alphabetical: the page is about what THIS agent has been given, and a
  // flat 60-row alphabetical list buries that.
  out.sort((a, b) => {
    if (a.lifequest !== b.lifequest) return a.lifequest ? -1 : 1;
    if (a.useCount !== b.useCount) return b.useCount - a.useCount;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/** The first non-blank line after the frontmatter, as a fallback description. */
function firstProseLine(markdown: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.replace(/^#+\s*/, "").trim();
    if (trimmed) return trimmed.slice(0, 200);
  }
  return "";
}

async function readSkillUsage(skillsRoot: string): Promise<Map<string, SkillUsage>> {
  const out = new Map<string, SkillUsage>();
  try {
    const raw = await fs.readFile(path.join(skillsRoot, ".usage.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        out.set(name, value as SkillUsage);
      }
    }
  } catch {
    // No ledger is not an error: every skill simply reads as never used.
  }
  return out;
}

async function readBundledNames(skillsRoot: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const raw = await fs.readFile(path.join(skillsRoot, ".bundled_manifest"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const name = line.split(":")[0]?.trim();
      if (name) out.add(name);
    }
  } catch {
    // Same: an absent manifest means "we cannot say", not "none are bundled".
  }
  return out;
}

/**
 * The whole answer for Settings, from what is on disk plus the instructions the
 * app would build for the turn in front of the operator.
 *
 * `instructions` is passed in rather than built here so that this module never
 * needs the vault: the caller already has the snapshot, and the text shown is
 * then the same text the chat path would send for the same context.
 */
export async function readCompanionPrompts(opts: {
  profilePath: string;
  instructions: string;
  context: CompanionInstructionsInput;
}): Promise<CompanionPrompts> {
  const soulPath = path.join(opts.profilePath, "SOUL.md");
  let soulText: string | null = null;
  try {
    soulText = await fs.readFile(soulPath, "utf8");
  } catch {
    soulText = null;
  }
  const seeded = soulText === null || soulText.trim() === "" || isOwnSeed(soulText);
  return {
    profilePath: opts.profilePath,
    soul: {
      path: soulPath,
      text: soulText ?? COMPANION_SOUL,
      seeded,
      // The operator's own words are never overwritten by the app, so a file
      // that is not ours is theirs and is reported as such.
      edited: !seeded,
    },
    instructions: { text: opts.instructions, context: opts.context },
    skills: await readProfileSkills(opts.profilePath),
    soulSeedPath: "companion-profile.ts → COMPANION_SOUL",
  };
}

/**
 * Whether a SOUL is this app's seed rather than the operator's prose. The stamp
 * is the marker the writer itself uses, so this agrees with `shouldSeedSoul` by
 * construction instead of by a second guess.
 */
function isOwnSeed(text: string): boolean {
  if (text.includes("lifequest-soul:")) return true;
  return text.trim() === COMPANION_SOUL.trim();
}
