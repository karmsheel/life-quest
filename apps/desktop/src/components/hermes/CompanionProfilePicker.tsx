import { Check, Plus, UserRoundCog } from "lucide-react";
import type { CompanionProfileInfo } from "@/vite-env";
import { useCompanion } from "@/state/CompanionProvider";

/**
 * The app's own Hermes profile, which `companion-profile.ts` names the same
 * way. Duplicated rather than imported: that module reaches the filesystem
 * (`node:fs`), and the renderer must not.
 */
const LQ_PROFILE = "lifequest";

function rowDescription(profile: CompanionProfileInfo): string {
  if (profile.isDefault) return `${profile.path} · your main Hermes profile`;
  if (profile.name === LQ_PROFILE) return profile.path;
  const marks: string[] = [];
  if (profile.hasSoul) marks.push("has SOUL");
  if (profile.hasConfig) marks.push("has config");
  return marks.length > 0 ? `${profile.path} · ${marks.join(" · ")}` : profile.path;
}

/** One letter for the card's avatar; two for a hyphenated or spaced name. */
function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/**
 * The way out of a stuck connect: every Hermes profile this install has, the
 * one the companion runs on marked, and the app's own `lifequest` profile on
 * offer even when it does not exist yet — choosing it creates and wires it.
 *
 * Radio semantics rather than a menu: the choice is which agent the app IS,
 * it is remembered across launches, and a switch that looks like navigation
 * (a link, a menu item) hides that this rewrites the profile's SOUL and MCP
 * entry. Disabled while an ensure is in flight, because a second switch
 * mid-connect would race the first.
 *
 * Cards rather than page-wide rows: in Settings the picker sits on a page that
 * already scrolls, and a stack of full-width bars made the profile choice look
 * like the page's subject. These are short, selectable profile cards — an
 * avatar, the name, where it lives — laid out as many per row as fit.
 */
export function CompanionProfilePicker() {
  const { profiles, profile, ensuring, useProfile } = useCompanion();
  const installed = profiles ?? [];
  const hasLifequest = installed.some((p) => p.name === LQ_PROFILE);
  // Which card reads "In use"; null until the first read answers.
  const active = profile;

  function card(entry: CompanionProfileInfo) {
    const isActive = entry.name === active;
    return (
      <button
        key={entry.name}
        type="button"
        role="radio"
        aria-checked={isActive}
        aria-label={`Use the ${entry.name} profile`}
        title={rowDescription(entry)}
        className={
          isActive
            ? "companion-profile-row companion-profile-row--active"
            : "companion-profile-row"
        }
        disabled={ensuring}
        onClick={() => void useProfile(entry.name)}
      >
        <span className="companion-profile-row__avatar" aria-hidden="true">
          {initials(entry.name)}
        </span>
        <span className="companion-profile-row__body">
          <span className="companion-profile-row__name">
            <span className="companion-profile-row__label">{entry.name}</span>
            {entry.isDefault ? (
              <span className="companion-profile-row__tag">default</span>
            ) : null}
          </span>
          <span className="companion-profile-row__desc">{rowDescription(entry)}</span>
        </span>
        {isActive ? (
          <span className="companion-profile-row__in-use">
            <Check size={12} aria-hidden="true" />
            <span className="visually-hidden">In use</span>
          </span>
        ) : (
          <span className="companion-profile-row__pick" aria-hidden="true" />
        )}
      </button>
    );
  }

  return (
    <div className="companion-profile-picker">
      <p className="companion-profile-picker__lead">
        <UserRoundCog size={14} aria-hidden="true" />
        <span>
          LifeQuest runs on one Hermes profile. Pick an installed one, or create
          the app&apos;s own <code>lifequest</code> profile.
        </span>
      </p>
      {installed.length > 0 ? (
        <div className="companion-profile-list" role="radiogroup" aria-label="Hermes profiles">
          {installed.map((entry) => card(entry))}
        </div>
      ) : (
        <p className="companion-profile-picker__empty muted">
          No Hermes profiles found on this machine.
        </p>
      )}
      {hasLifequest ? null : (
        <div className="companion-profile-create">
          <button
            type="button"
            role="radio"
            aria-checked={active === LQ_PROFILE}
            aria-label="Create and use the lifequest profile"
            title="Create and use the lifequest profile"
            className={
              active === LQ_PROFILE
                ? "companion-profile-row companion-profile-row--create companion-profile-row--active"
                : "companion-profile-row companion-profile-row--create"
            }
            disabled={ensuring}
            onClick={() => void useProfile(LQ_PROFILE)}
          >
            <span className="companion-profile-row__avatar" aria-hidden="true">
              <Plus size={15} />
            </span>
            <span className="companion-profile-row__body">
              <span className="companion-profile-row__name">
                <span className="companion-profile-row__label">Create profile</span>
              </span>
              <span className="companion-profile-row__desc">
                The app's own lifequest profile — created and wired on first use.
              </span>
            </span>
            {active === LQ_PROFILE ? (
              <span className="companion-profile-row__in-use">
                <Check size={12} aria-hidden="true" />
                <span className="visually-hidden">In use</span>
              </span>
            ) : (
              <span className="companion-profile-row__pick" aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
