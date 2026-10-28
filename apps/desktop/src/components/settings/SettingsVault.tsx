import { useState } from "react";
import { Building2, Database } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import type { WeekStartDay } from "@lifequest/vault-core/pure";

const WEEK_START_OPTIONS = [
  { value: "monday" as WeekStartDay, label: "Monday" },
  { value: "sunday" as WeekStartDay, label: "Sunday" },
];

/**
 * The cost of a restore, stated on the row that offers it. Restore is the only
 * control on this page that overwrites live data, so the words travel with the
 * switch that arms it rather than sitting in the section's subtitle where the
 * operator reading one row would not see them.
 */
const RESTORE_NOTE =
  "Restore replaces the live SQLite book for this domain from books.json.";

export function SettingsVault() {
  const { snapshot, updateSettings, openVault, busy, error, clearError } =
    useVault();
  const [weekStartError, setWeekStartError] = useState<string | null>(null);
  const [exportMessages, setExportMessages] = useState<Record<string, string>>(
    {},
  );
  /**
   * Which rows have been armed for restore. A boolean per domain rather than a
   * single flag: each book is restored on its own, and arming one domain's
   * restore says nothing about another's.
   */
  const [restoreArmed, setRestoreArmed] = useState<Record<string, boolean>>({});
  const [restoreErrors, setRestoreErrors] = useState<Record<string, string>>(
    {},
  );

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  const { lifequest, rootPath, settings } = snapshot;
  const weekStartDay: WeekStartDay =
    settings.weekStartDay === "sunday" ? "sunday" : "monday";
  const weekStartDisabled = (snapshot.weeklyFileCount ?? 0) > 0;
  /*
   * The hint is shown only while it is true. With no weekly files the setting is
   * live, and a paragraph explaining why it cannot change would be a lie on the
   * line where the operator is about to change it.
   */
  const weekStartHint = weekStartDisabled
    ? (weekStartError ??
      "Cannot change while weekly review or planning files exist.")
    : (weekStartError ?? undefined);

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
    // The switch is the gate and the button is disabled without it; this is the
    // second lock, for a click that arrives from somewhere other than the
    // control (a keyboard path, a drive-by dispatch).
    if (!restoreArmed[slug]) return;
    const res = await api().dbRestoreBooks(slug, { confirm: true });
    if (!res.ok) {
      setRestoreErrors((prev) => ({ ...prev, [slug]: res.error }));
      return;
    }
    setRestoreErrors((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
    // A completed restore disarms its own row: the next restore is a new
    // destructive act, and the operator arms it again deliberately.
    setRestoreArmed((prev) => ({ ...prev, [slug]: false }));
  }

  // The path above is only a display of the folder that is open right now.
  // This is how it changes: ask the platform for a folder, open whatever
  // vault is there, and reload in place. A cancelled or refused picker leaves
  // this page on the same vault, with the provider's own error saying why.
  async function onChangeFolder() {
    clearError();
    await openVault();
  }

  return (
    <>
      <SettingsSection
        icon={<Building2 size={16} />}
        title="Vault"
        subtitle="Identity and location on disk"
        banner={
          error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : undefined
        }
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
            <dd className="settings-vault__mono settings-vault__path">
              {rootPath}
            </dd>
          </div>
        </dl>
        <SettingsRow
          label="Vault folder"
          description="Point LifeQuest at another vault folder on this computer — a second vault, or the one you meant to pick. The new vault's files load in place; nothing is moved or deleted."
          action={
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void onChangeFolder()}
            >
              {busy ? "Opening…" : "Change folder…"}
            </Button>
          }
        />
        <SettingsRow
          label="Week starts on"
          description={weekStartHint}
          action={
            <SegmentedControl
              value={weekStartDay}
              options={WEEK_START_OPTIONS}
              ariaLabel="Week starts on"
              onChange={onWeekStartChange}
              disabled={weekStartDisabled}
              size="sm"
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
          .map((domain) => {
            const armed = restoreArmed[domain.slug] ?? false;
            const exportMessage = exportMessages[domain.slug];
            const restoreError = restoreErrors[domain.slug];
            return (
              <SettingsRow
                key={domain.slug}
                className="settings-card__row--books"
                label={domain.meta.name}
                description={RESTORE_NOTE}
                action={
                  <div className="settings-books__actions">
                    <div className="settings-books__buttons">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void onExportBooks(domain.slug)}
                      >
                        Export books
                      </Button>
                      {/* The destructive control's own gate: a labelled switch,
                          large enough to read as the way in, that the row's
                          description explains. */}
                      <ToggleSwitch
                        label="Allow restore"
                        ariaLabel={`Allow restore for ${domain.meta.name}`}
                        checked={armed}
                        onChange={(checked) =>
                          setRestoreArmed((prev) => ({
                            ...prev,
                            [domain.slug]: checked,
                          }))
                        }
                      />
                      <Button
                        type="button"
                        destructive
                        disabled={!armed}
                        onClick={() => void onRestoreBooks(domain.slug)}
                      >
                        Restore books
                      </Button>
                    </div>
                    {exportMessage ? (
                      <p
                        className={
                          exportMessage.startsWith("Exported")
                            ? "settings-books__message muted"
                            : "settings-books__message form-error"
                        }
                        role={exportMessage.startsWith("Exported") ? "status" : "alert"}
                      >
                        {exportMessage}
                      </p>
                    ) : null}
                    {restoreError ? (
                      <p className="settings-books__message form-error" role="alert">
                        {restoreError}
                      </p>
                    ) : null}
                  </div>
                }
              />
            );
          })}
      </SettingsSection>
    </>
  );
}
