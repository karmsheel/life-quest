import { useState } from "react";
import { Building2, Database } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import type { WeekStartDay } from "@lifequest/vault-core/pure";

const WEEK_START_OPTIONS = [
  { value: "monday" as WeekStartDay, label: "Monday" },
  { value: "sunday" as WeekStartDay, label: "Sunday" },
];

export function SettingsVault() {
  const { snapshot, updateSettings } = useVault();
  const [weekStartError, setWeekStartError] = useState<string | null>(null);
  const [exportMessages, setExportMessages] = useState<Record<string, string>>(
    {},
  );
  const [restoreConfirm, setRestoreConfirm] = useState<Record<string, boolean>>(
    {},
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);

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

  async function onExportBooks(slug: string) {
    const domain = snapshot?.domains.find((d) => d.slug === slug);
    const domainName = domain?.meta.name ?? slug;
    const res = await api().dbExportBooks(slug);
    if (res.ok) {
      setExportMessages((prev) => ({
        ...prev,
        [slug]: `Exported books for ${domainName}.`,
      }));
    } else {
      setExportMessages((prev) => ({
        ...prev,
        [slug]: res.error,
      }));
    }
  }

  async function onRestoreBooks(slug: string) {
    const confirmed = restoreConfirm[slug];
    if (!confirmed) {
      setRestoreError("Check the confirmation box before restoring.");
      return;
    }
    setRestoreError(null);
    const res = await api().dbRestoreBooks(slug, { confirm: true });
    if (!res.ok) {
      setRestoreError(res.error);
    }
  }

  return (
    <>
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
      <SettingsSection
        icon={<Database size={16} />}
        title="Books"
        subtitle="Export a git-portable JSON of domain tables. Restore replaces the live SQLite book from books.json."
      >
        {snapshot.domains
          .filter((d) => !d.meta.archivedAt)
          .map((domain) => (
            <SettingsRow
              key={domain.slug}
              label={domain.meta.name}
              action={
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onExportBooks(domain.slug)}
                  >
                    Export books
                  </Button>
                  <label>
                    <input
                      type="checkbox"
                      checked={restoreConfirm[domain.slug] ?? false}
                      onChange={(e) =>
                        setRestoreConfirm((prev) => ({
                          ...prev,
                          [domain.slug]: e.target.checked,
                        }))
                      }
                    />
                    Restore replaces the live SQLite book for this domain from
                    books.json
                  </label>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!restoreConfirm[domain.slug]}
                    onClick={() => void onRestoreBooks(domain.slug)}
                  >
                    Restore books
                  </Button>
                  {exportMessages[domain.slug] ? (
                    <p
                      className={
                        exportMessages[domain.slug].startsWith("Exported")
                          ? "muted"
                          : "form-error"
                      }
                    >
                      {exportMessages[domain.slug]}
                    </p>
                  ) : null}
                </div>
              }
            />
          ))}
        {restoreError ? (
          <p className="form-error" role="alert">
            {restoreError}
          </p>
        ) : null}
      </SettingsSection>
    </>
  );
}
