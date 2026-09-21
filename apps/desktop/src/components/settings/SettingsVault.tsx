import { useState } from "react";
import { Building2 } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useVault } from "@/state/VaultProvider";
import type { WeekStartDay } from "@lifequest/vault-core/pure";

const WEEK_START_OPTIONS = [
  { value: "monday" as WeekStartDay, label: "Monday" },
  { value: "sunday" as WeekStartDay, label: "Sunday" },
];

export function SettingsVault() {
  const { snapshot, updateSettings } = useVault();
  const [weekStartError, setWeekStartError] = useState<string | null>(null);

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  const { lifequest, rootPath, settings } = snapshot;
  const weekStartDay: WeekStartDay =
    settings.weekStartDay === "sunday" ? "sunday" : "monday";
  const weekStartDisabled = (snapshot.weeklyFileCount ?? 0) > 0;

  async function onWeekStartChange(value: WeekStartDay) {
    const result = await updateSettings({ weekStartDay: value });
    if (!result.ok) {
      setWeekStartError(result.error);
      return;
    }
    setWeekStartError(null);
  }

  return (
    <SettingsSection
      icon={<Building2 size={16} />}
      title="Vault"
      subtitle="Identity and location on disk"
    >
      <dl className="settings-vault">
        <div>
          <dt className="muted">Name</dt>
          <dd>{lifequest.name}</dd>
        </div>
        <div>
          <dt className="muted">Id</dt>
          <dd className="settings-vault__mono">{lifequest.id}</dd>
        </div>
        <div>
          <dt className="muted">Path</dt>
          <dd className="settings-vault__mono">{rootPath}</dd>
        </div>
      </dl>
      <SettingsRow
        label="Week starts on"
        description={
          weekStartError ??
          "Cannot change while weekly review or planning files exist."
        }
        action={
          <SegmentedControl
            value={weekStartDay}
            options={WEEK_START_OPTIONS}
            ariaLabel="Week starts on"
            onChange={onWeekStartChange}
            disabled={weekStartDisabled}
          />
        }
      />
    </SettingsSection>
  );
}
