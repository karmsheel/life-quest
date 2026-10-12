import { Check, UserRoundCog } from "lucide-react";
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
 */
export function CompanionProfilePicker() {
  const { profiles, profile, ensuring, useProfile } = useCompanion();
  const installed = profiles ?? [];
  const hasLifequest = installed.some((p) => p.name === LQ_PROFILE);
  // Which row reads "In use"; null until the first read answers.
  const active = profile;

  function row(profile: CompanionProfileInfo, label?: string) {
    const isActive = profile.name === active;
    return (
      <button
        key={profile.name}
        type="button"
        role="radio"
        aria-checked={isActive}
        aria-label={`Use the ${profile.name} profile`}
        className={
          isActive
            ? "companion-profile-row companion-profile-row--active"
            : "companion-profile-row"
        }
        disabled={ensuring}
        onClick={() => void useProfile(profile.name)}
      >
        <span className="companion-profile-row__name">
          {label ?? profile.name}
          {profile.isDefault ? (
            <span className="companion-profile-row__tag">default</span>
          ) : null}
        </span>
        <span className="companion-profile-row__desc">{rowDescription(profile)}</span>
        {isActive ? (
          <span className="companion-profile-row__in-use">
            <Check size={13} aria-hidden />
            In use
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="companion-profile-picker">
      <p className="companion-profile-picker__lead">
        <UserRoundCog size={14} aria-hidden />
        LifeQuest runs on one Hermes profile. Pick an installed one, or create
        the app's own <code>lifequest</code> profile.
      </p>
      {installed.length > 0 ? (
        <div className="companion-profile-list" role="radiogroup" aria-label="Hermes profiles">
          {installed.map((entry) => row(entry))}
        </div>
      ) : (
        <p className="companion-profile-picker__empty muted">
          No Hermes profiles found on this machine.
        </p>
      )}
      {hasLifequest ? null : (
        <button
          type="button"
          role="radio"
          aria-checked={active === LQ_PROFILE}
          aria-label="Create and use the lifequest profile"
          className="companion-profile-row companion-profile-row--create"
          disabled={ensuring}
          onClick={() => void useProfile(LQ_PROFILE)}
        >
          <span className="companion-profile-row__name">
            Create the {LQ_PROFILE} profile
          </span>
          <span className="companion-profile-row__desc">
            LifeQuest's own companion profile — created and wired on first use.
          </span>
          {active === LQ_PROFILE ? (
            <span className="companion-profile-row__in-use">
              <Check size={13} aria-hidden />
              In use
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}
