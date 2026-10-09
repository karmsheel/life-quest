import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { buildInstructions } from "../electron/companion-client.ts";
import { COMPANION_SOUL, SOUL_STAMP, shouldSeedSoul } from "../electron/companion-profile.ts";
import { parseSkillFrontmatter, readCompanionPrompts } from "../electron/companion-prompts.ts";

/**
 * The Settings → Agent page's data: what the companion is told, and what it has
 * been given to read.
 *
 * WHY THIS FILE EXISTS
 *
 * The companion could not make a dashboard card for six sessions, and the answer
 * to "why not?" was in none of the three texts that decide what it does: the
 * profile's SOUL, the per-turn instructions, and the skill library. Finding that
 * out meant reading %LOCALAPPDATA%\\hermes by hand. Settings now shows all three,
 * and this rig is what proves the page's data is the real thing rather than a
 * fixture that happens to render: it writes a real profile directory with a real
 * SOUL and real SKILL.md files, and reads them back through the shipping reader.
 *
 * THE WAYS THIS COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 *   1. The page shows a stale seed while the profile on disk holds something
 *      else — the operator is told a prompt the agent never received.
 *   2. The operator's own words are reported as this app's seed, which is the
 *      same lie in the other direction, and the one that would make them stop
 *      trusting the page.
 *   3. The skill list is a directory listing: no description, no category, no
 *      usage, so the page says "here are 60 folders" and answers nothing.
 *   4. An archived skill is listed even though the companion cannot read it.
 *   5. LifeQuest's own skills are buried alphabetically among Hermes' bundled
 *      set, which is the opposite of what the page is for.
 *   6. The per-turn instructions shown are a generic sample rather than the ones
 *      the board in front of the operator would produce — the board line and the
 *      lock line are the whole reason that text exists.
 *
 * The artifact is `e2e/artifacts/agent-prompts.json`. Failures throw, so it only
 * exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/agent-prompts.json");

function skillFile(name: string, description: string, version = "1.0.0"): string {
  return [
    "---",
    `name: ${name}`,
    `description: "${description}"`,
    `version: ${version}`,
    "author: test",
    "metadata:",
    "  hermes:",
    "    tags: [LifeQuest, dashboards]",
    "---",
    "",
    `# ${name}`,
    "",
    "Body prose that is not the description.",
    "",
  ].join("\n");
}

describe("companion prompts e2e", () => {
  it("reads the profile's real SOUL, skills and per-turn instructions", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-agent-prompts-"));
    const profilePath = path.join(workDir, "hermes", "profiles", "lifequest");
    const skillsRoot = path.join(profilePath, "skills");
    const checks: Record<string, unknown> = {};

    // ── a profile with this app's own SOUL ─────────────────────────────────
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.writeFileSync(path.join(profilePath, "SOUL.md"), COMPANION_SOUL);

    // Two of LifeQuest's own, one bundled and used, one bundled and untouched,
    // and one the curator archived — which the companion cannot read either.
    fs.mkdirSync(path.join(skillsRoot, "lifequest", "lifequest-dashboard-scripting"), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, "lifequest", "lifequest-dashboard-scripting", "SKILL.md"),
      skillFile("lifequest-dashboard-scripting", "Use when adding computed tables to LifeQuest dashboards"),
    );
    fs.mkdirSync(path.join(skillsRoot, "lifequest", "lifequest-cards"), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, "lifequest", "lifequest-cards", "SKILL.md"),
      skillFile("lifequest-cards", "Making a card from chat"),
    );
    fs.mkdirSync(path.join(skillsRoot, "productivity", "lifequest-mcp"), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, "productivity", "lifequest-mcp", "SKILL.md"),
      skillFile("lifequest-mcp", "Driving the LifeQuest MCP server"),
    );
    fs.mkdirSync(path.join(skillsRoot, "media", "youtube-content"), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, "media", "youtube-content", "SKILL.md"),
      skillFile("youtube-content", "Fetching a transcript"),
    );
    fs.mkdirSync(path.join(skillsRoot, "research", "arxiv"), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, "research", "arxiv", "SKILL.md"),
      skillFile("arxiv", "Searching arXiv"),
    );

    fs.writeFileSync(
      path.join(skillsRoot, ".usage.json"),
      `${JSON.stringify(
        {
          "lifequest-mcp": {
            state: "active",
            pinned: true,
            use_count: 7,
            view_count: 3,
            last_used_at: "2026-10-08T20:00:00+00:00",
          },
          "lifequest-dashboard-scripting": { state: "active", use_count: 2, view_count: 1 },
          arxiv: { state: "archived", use_count: 0, view_count: 0 },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(skillsRoot, ".bundled_manifest"),
      "lifequest-mcp:aaaa\nyoutube-content:bbbb\narxiv:cccc\n",
    );

    // ── 1. the SOUL is reported as this app's seed ─────────────────────────
    const context = {
      domainName: "Financial",
      domainSlug: "financial",
      viewingBoard: "financial",
      viewingBoardLocked: false,
      aboutMe: "I like tea",
      locked: false,
      vaultOpen: true,
      fileUnsolicited: true,
    };
    const seeded = await readCompanionPrompts({
      profilePath,
      instructions: buildInstructions(context),
      context,
    });
    checks.soulSeeded = seeded.soul.seeded;
    checks.soulEdited = seeded.soul.edited;
    checks.soulTextIsSeed = seeded.soul.text === COMPANION_SOUL;
    assert.equal(seeded.soul.seeded, true, "this app's own SOUL was reported as the operator's");
    assert.equal(seeded.soul.edited, false);
    assert.equal(seeded.soul.text, COMPANION_SOUL, "the page showed a different prompt than the file holds");
    assert.equal(
      seeded.soul.text.includes(SOUL_STAMP),
      true,
      "the prompt the agent is given carries no stamp, so a later seed cannot reach it",
    );
    assert.equal(shouldSeedSoul(seeded.soul.text), true, "the reader and the writer disagree about the seed");

    // ── 2. the operator's own words are reported as theirs ────────────────
    const ownPath = path.join(workDir, "own-profile");
    fs.mkdirSync(ownPath, { recursive: true });
    fs.writeFileSync(path.join(ownPath, "SOUL.md"), "Be terse and never use emoji.\n");
    const own = await readCompanionPrompts({ profilePath: ownPath, instructions: "x", context });
    checks.ownSoul = { seeded: own.soul.seeded, edited: own.soul.edited, text: own.soul.text };
    assert.equal(own.soul.seeded, false, "the operator's own SOUL was reported as this app's seed");
    assert.equal(own.soul.edited, true);
    assert.equal(own.soul.text, "Be terse and never use emoji.\n", "the page rewrote the operator's words");

    // A profile with no SOUL at all shows the seed that would be written.
    const emptyPath = path.join(workDir, "empty-profile");
    fs.mkdirSync(emptyPath, { recursive: true });
    const empty = await readCompanionPrompts({ profilePath: emptyPath, instructions: "x", context });
    assert.equal(empty.soul.seeded, true, "a profile with no SOUL must report the seed it would get");
    assert.equal(empty.soul.text, COMPANION_SOUL);

    // ── 3. the skill list is the library, described ───────────────────────
    checks.skills = seeded.skills.map((s) => ({
      name: s.name,
      category: s.category,
      lifequest: s.lifequest,
      bundled: s.bundled,
      pinned: s.pinned,
      useCount: s.useCount,
      version: s.version,
      tags: s.tags,
    }));
    assert.equal(seeded.skills.length, 4, `the reader listed ${seeded.skills.length} skills, expected 4`);
    const byName = new Map(seeded.skills.map((s) => [s.name, s]));
    for (const name of ["lifequest-dashboard-scripting", "lifequest-cards", "lifequest-mcp", "youtube-content"]) {
      assert.ok(byName.has(name), `${name} is missing from the skill list`);
      assert.ok(
        (byName.get(name)!.description ?? "").length > 0,
        `${name} was listed with no description`,
      );
      assert.match(byName.get(name)!.relPath, /SKILL\.md$/, `${name} has no path to open`);
    }
    assert.equal(byName.get("lifequest-cards")!.lifequest, true, "a LifeQuest skill was not marked as one");
    assert.equal(byName.get("youtube-content")!.lifequest, false);
    assert.equal(byName.get("lifequest-mcp")!.bundled, true, "a bundled skill was reported as the operator's");
    assert.equal(byName.get("lifequest-cards")!.bundled, false, "an operator skill was reported as bundled");
    assert.equal(byName.get("lifequest-mcp")!.pinned, true);
    assert.equal(byName.get("lifequest-mcp")!.useCount, 7, "the usage ledger was not read");
    assert.deepEqual(byName.get("lifequest-dashboard-scripting")!.tags, ["LifeQuest", "dashboards"]);

    // ── 4. an archived skill is not offered ───────────────────────────────
    assert.equal(byName.has("arxiv"), false, "an archived skill was listed as readable");

    // ── 5. LifeQuest's own skills come first ──────────────────────────────
    checks.skillOrder = seeded.skills.map((s) => s.name);
    assert.deepEqual(
      seeded.skills.slice(0, 2).map((s) => s.name).sort(),
      ["lifequest-cards", "lifequest-dashboard-scripting"],
      "LifeQuest's own skills are not first",
    );

    // ── 6. the instructions shown are the ones this board would send ──────
    // The board line and the lock line are what make "the Dashboard" mean the
    // board in front of the operator, and they are the difference between an
    // applied change and one waiting in Decisions.
    const text = seeded.instructions.text;
    checks.instructionsHasBoard = text.includes("the financial dashboard (domainSlug: \"financial\")");
    checks.instructionsHasUnlocked = /UNLOCKED/.test(text);
    checks.instructionsHasCardSkill = /save_view/.test(text) && /JSON OBJECT/.test(text);
    checks.instructionsHasEditPath = /get_view/.test(text) && /viewId/.test(text);
    assert.equal(checks.instructionsHasBoard, true, "the instructions do not anchor 'the Dashboard' to the board in view");
    assert.equal(checks.instructionsHasUnlocked, true, "the instructions do not say the board is unlocked");
    assert.equal(checks.instructionsHasCardSkill, true, "the instructions do not teach the one-call card path");
    assert.equal(checks.instructionsHasEditPath, true, "the instructions do not teach how to change an existing card");
    assert.equal(
      text.includes("Active domain: Financial (financial)"),
      true,
      "the instructions lost the active domain line",
    );

    // The locked board says the other thing, and the two must not both be true.
    const lockedText = buildInstructions({ ...context, viewingBoardLocked: true });
    checks.lockedLine = /LOCKED/.test(lockedText);
    assert.equal(checks.lockedLine, true, "a locked board is not named as locked in the instructions");
    assert.equal(/UNLOCKED/.test(lockedText), false, "a locked board is described as unlocked");

    // ── 8. the card the operator put in front of the chat ─────────────────
    // The whole point of the pill is that the operator never has to describe
    // the card. Three kinds of card are changed three different ways, and the
    // instructions have to say the one that actually works for the card in hand.
    const viewCard = buildInstructions({
      ...context,
      focusedCard: {
        label: "Weekly expenses",
        pinId: "view:financial:v-weekly",
        kind: "view",
        boardSlug: null,
        domainSlug: "financial",
        viewId: "v-weekly",
      },
    });
    checks.focusedView = {
      names: viewCard.includes('the card titled "Weekly expenses"'),
      ids: viewCard.includes('viewId "v-weekly"') && viewCard.includes('domainSlug "financial"'),
      board: viewCard.includes("the Overview dashboard"),
      means: /"this card", "it", or "this block"/.test(viewCard),
      changePath: /get_view/.test(viewCard) && /save_view carrying the same viewId/.test(viewCard),
    };
    assert.equal(checks.focusedView.names, true, "the card in context is not named");
    assert.equal(checks.focusedView.ids, true, "the card's own ids are missing");
    assert.equal(checks.focusedView.board, true, "the board the card sits on is not named");
    assert.equal(checks.focusedView.means, true, "the instructions never say what 'this card' means");
    assert.equal(checks.focusedView.changePath, true, "the in-place change path is not taught");

    const systemCard = buildInstructions({
      ...context,
      focusedCard: {
        label: "Goals",
        pinId: "sys:goal-progress",
        kind: "system",
        boardSlug: "financial",
        domainSlug: null,
        system: "goal-progress",
      },
    });
    checks.focusedSystem = {
      names: systemCard.includes('the card titled "Goals"'),
      board: systemCard.includes("the financial dashboard"),
      noSpec: /no viewId and save_view cannot change it/.test(systemCard),
    };
    assert.equal(checks.focusedSystem.names, true, "the built-in card is not named");
    assert.equal(checks.focusedSystem.board, true, "the board the built-in card sits on is not named");
    assert.equal(
      checks.focusedSystem.noSpec,
      true,
      "a built-in card was offered a view spec it does not have",
    );

    const pageCard = buildInstructions({
      ...context,
      focusedCard: {
        label: "Ledger",
        pinId: "page:financial:ledger",
        kind: "page",
        boardSlug: "financial",
        domainSlug: "financial",
        pageId: "ledger",
      },
    });
    checks.focusedPage = {
      names: pageCard.includes('the card titled "Ledger"'),
      isAPage: /It is a page card, not a saved view/.test(pageCard),
      noSpec: /save_view cannot change it/.test(pageCard),
    };
    assert.equal(checks.focusedPage.names, true, "the page card is not named");
    assert.equal(checks.focusedPage.isAPage, true, "a page card was described as a view");

    // And the ordinary turn — nobody pointed at a card — is unchanged: no line,
    // and not even the word.
    checks.noCardLine =
      !/in front of this chat as context/.test(text) && !/focusedCard/.test(text);
    assert.equal(
      checks.noCardLine,
      true,
      "a turn with no card in context still carried the card line",
    );

    // ── 7. the skill parser reads a real frontmatter block ───────────────
    checks.frontmatter = parseSkillFrontmatter(skillFile("demo", "A description"));
    assert.equal(checks.frontmatter.name, "demo");
    assert.equal(checks.frontmatter.description, "A description");
    assert.equal(parseSkillFrontmatter("# No frontmatter").name, null);

    // ── the artifact ─────────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: true,
      what: "Settings → Agent: the profile's SOUL, the per-turn instructions, and the skill library",
      command: "npm test  (this file: tests/agent-prompts-e2e.test.ts)",
      checks,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
