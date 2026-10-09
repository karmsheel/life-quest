import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import type { CompanionPrompts } from "@/vite-env";

/**
 * What the companion is told, and what it has been given to read.
 *
 * The system prompt is assembled from three places that are invisible from
 * inside the app: the profile's SOUL.md, the per-turn `instructions` the app
 * appends to every chat turn, and the skill library Hermes keeps beside the
 * profile. This page is the whole of it, in the order the model receives it.
 *
 * It earns its place. When the companion could not make a dashboard card, the
 * reason was in none of these three texts — the MCP door was advertising every
 * tool with an empty argument schema — and finding that out meant reading
 * %LOCALAPPDATA%\\hermes by hand and a Hermes state database. "What is my
 * companion being told?" should be a question the app answers.
 */
export function SettingsCompanionPrompts() {
  const { snapshot } = useVault();
  const [prompts, setPrompts] = useState<CompanionPrompts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api().companionPrompts();
      if (res.ok) {
        setPrompts(res.value);
        setError(null);
      } else {
        setPrompts(null);
        setError(res.error);
      }
    } catch (err) {
      setPrompts(null);
      setError(err instanceof Error ? err.message : "Could not read the companion's prompts");
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-read when the open vault changes: the per-turn instructions carry the
  // active domain lens and that board's lock, so they are a function of the vault.
  useEffect(() => {
    void load();
  }, [load, snapshot?.rootPath]);

  async function onCopy(label: string, text: string) {
    const ok = await copyText(text);
    setCopied(ok ? label : null);
    if (!ok) setError("Could not copy to the clipboard");
  }

  const context = prompts?.instructions.context;
  const lifequestSkills = (prompts?.skills ?? []).filter((s) => s.lifequest);
  const otherSkills = (prompts?.skills ?? []).filter((s) => !s.lifequest);

  return (
    <SettingsSection
      icon={<ScrollText size={16} />}
      title="Agent"
      subtitle="The system prompts and skills your companion is given"
      banner={
        error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : undefined
      }
    >
      <div className="settings-hermes__actions">
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Reading…" : "Re-read"}
        </Button>
      </div>

      {loading && !prompts ? <p className="muted">Reading the companion's profile…</p> : null}

      {prompts ? (
        <>
          <div className="settings-card" data-testid="agent-soul">
            <h3 className="settings-panel__section-title">
              System prompt
              <span
                className={`doc-status-badge doc-status-badge--${prompts.soul.seeded ? "unlocked" : "locked"}`}
                data-testid="agent-soul-origin"
              >
                {prompts.soul.seeded ? "LifeQuest seed" : "Edited by you"}
              </span>
            </h3>
            <p className="settings-card__desc">
              Written once into the profile's <code>SOUL.md</code> and read by every channel on
              this profile, including Hermes Desktop, where the app's per-turn instructions never
              reach. {prompts.soul.seeded
                ? "The app keeps this file up to date."
                : "You have written your own words here, so the app leaves this file alone."}
            </p>
            <p className="settings-field">
              <span>File</span>
              <code className="settings-prompt__path">{prompts.soul.path}</code>
            </p>
            <div className="settings-prompt">
              <pre className="settings-prompt__body" data-testid="agent-soul-text">
                {prompts.soul.text}
              </pre>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void onCopy("soul", prompts.soul.text)}
              >
                {copied === "soul" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="settings-card" data-testid="agent-instructions">
            <h3 className="settings-panel__section-title">Per-turn instructions</h3>
            <p className="settings-card__desc">
              Built fresh for every chat turn and sent beside your message. These lines are what
              make "the Dashboard" mean the board you are looking at, and they say whether that
              board's lock will let a change land or send it to Decisions.
            </p>
            {context ? (
              <dl className="settings-hermes">
                <div className="settings-field">
                  <span>Domain lens</span>
                  <p className="muted">{context.domainSlug ?? "Overview"}</p>
                </div>
                <div className="settings-field">
                  <span>Dashboard board</span>
                  <p className="muted">
                    {context.viewingBoard == null
                      ? "Overview board (domainSlug: null)"
                      : `${context.viewingBoard} board`}
                    {context.viewingBoardLocked === undefined
                      ? ""
                      : context.viewingBoardLocked
                        ? " · locked, so changes file a Decision"
                        : " · unlocked, so changes land"}
                  </p>
                </div>
                <div className="settings-field">
                  <span>Vault</span>
                  <p className="muted">
                    {context.vaultOpen ? "open" : "closed"} · filing implied changes:{" "}
                    {(context.fileUnsolicited ?? true) ? "on" : "off"}
                  </p>
                </div>
              </dl>
            ) : null}
            <div className="settings-prompt">
              <pre className="settings-prompt__body" data-testid="agent-instructions-text">
                {prompts.instructions.text}
              </pre>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void onCopy("instructions", prompts.instructions.text)}
              >
                {copied === "instructions" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="settings-card" data-testid="agent-skills">
            <h3 className="settings-panel__section-title">
              Skills
              <span className="settings-prompt__count" data-testid="agent-skill-count">
                {prompts.skills.length}
              </span>
            </h3>
            <p className="settings-card__desc">
              The library the companion may read while it works. LifeQuest's own skills come first;
              the rest are Hermes' bundled set, and the ones your companion has actually used are
              marked with how often.
            </p>
            {prompts.skills.length === 0 ? (
              <p className="muted">
                No skills in this profile yet. Hermes fills this library as it learns the work.
              </p>
            ) : null}

            {lifequestSkills.length > 0 ? (
              <>
                <h4 className="settings-card__label">LifeQuest</h4>
                {lifequestSkills.map((skill) => (
                  <SkillRow key={skill.relPath} skill={skill} />
                ))}
              </>
            ) : null}

            {otherSkills.length > 0 ? (
              <>
                <h4 className="settings-card__label">Hermes library</h4>
                {otherSkills.map((skill) => (
                  <SkillRow key={skill.relPath} skill={skill} />
                ))}
              </>
            ) : null}
          </div>

          <p className="muted settings-prompt__foot">
            Profile: <code>{prompts.profilePath}</code>
          </p>
        </>
      ) : null}
    </SettingsSection>
  );
}

function SkillRow({
  skill,
}: {
  skill: CompanionPrompts["skills"][number];
}) {
  const usage = skill.useCount > 0 ? `used ${skill.useCount}×` : "not used yet";
  return (
    <div className="settings-skill" data-testid="agent-skill" data-skill={skill.name}>
      <div className="settings-skill__head">
        <span className="settings-skill__name">{skill.name}</span>
        <span className="settings-skill__meta muted">
          {skill.category} · {usage}
          {skill.pinned ? " · pinned" : ""}
          {skill.bundled ? "" : " · yours"}
        </span>
      </div>
      <p className="settings-skill__desc muted">{skill.description}</p>
      <code className="settings-skill__path">{skill.relPath}</code>
    </div>
  );
}

/**
 * Copy to the clipboard, with a fallback for the packaged app.
 *
 * The window loads `file://` in a packaged build, where `navigator.clipboard` is
 * not guaranteed to exist; the execCommand path is the one that still works
 * there. A failure is reported rather than swallowed, because a Copy button that
 * silently does nothing is worse than no button.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
