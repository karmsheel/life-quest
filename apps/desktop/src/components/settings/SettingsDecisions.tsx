import { useState } from "react";
import { Inbox } from "lucide-react";
import {
  DEFAULT_DECISION_INBOX_SETTINGS,
  type DecisionInboxSettings,
} from "@lifequest/vault-core/pure";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { Toggle } from "@/components/ui/Toggle";
import { useVault } from "@/state/VaultProvider";

/**
 * How the Decisions inbox interrupts the operator.
 *
 * The inbox is where proposals the companion files are approved, and both
 * switches are about it moving on its own. They write straight through
 * `updateSettings` — the preference lives in the vault's settings file, so it
 * follows the vault rather than one window's storage — and each write sends the
 * whole `decisionInbox` object because the engine replaces the field with what
 * the patch contains rather than merging into it.
 *
 * The value is read defensively. A vault written before these switches existed,
 * and the e2e harness snapshots that predate them, have no `decisionInbox` key;
 * the same defaults the vault engine would write are shown instead of an
 * undefined switch position. Both default to on: the inbox exists to interrupt,
 * and a new vault should behave the way the feature was described.
 */
export function SettingsDecisions() {
  const { snapshot, updateSettings } = useVault();
  const saved: DecisionInboxSettings =
    snapshot?.settings.decisionInbox ?? DEFAULT_DECISION_INBOX_SETTINGS;

  /**
   * The switch position to draw while a write is in flight. The saved value only
   * moves when the engine answers, so without this the thumb would snap back to
   * its old position for the length of the write and then jump forward.
   */
  const [optimistic, setOptimistic] = useState<DecisionInboxSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = optimistic ?? saved;

  async function toggle(field: keyof DecisionInboxSettings, next: boolean) {
    const patch = { ...current, [field]: next };
    setOptimistic(patch);
    setBusy(true);
    setError(null);
    try {
      const result = await updateSettings({ decisionInbox: patch });
      if (!result.ok) {
        // The write never landed, so the switch must not claim it did: dropping
        // the optimistic value falls back to whatever the snapshot still holds.
        setError(result.error);
        setOptimistic(null);
        return;
      }
      setOptimistic(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save the decision inbox setting",
      );
      setOptimistic(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      icon={<Inbox size={16} />}
      title="Decisions"
      subtitle="How the inbox interrupts you"
      banner={
        error ? (
          <p className="form-error" role="alert" data-testid="settings-decision-error">
            {error}
          </p>
        ) : undefined
      }
    >
      <div className="settings-decisions">
        <SettingsRow
          label="Open for a new decision"
          description="The inbox opens over the page the moment the companion files a proposal, so it can be approved without leaving what you were doing. Decisions already waiting when the app starts do not open it: they were not filed while you were working."
          action={
            <span data-testid="settings-decision-auto-open">
              <Toggle
                label="Open the decisions inbox for a new decision"
                checked={current.autoOpen}
                disabled={busy}
                onChange={(next) => void toggle("autoOpen", next)}
              />
            </span>
          }
        />
        <SettingsRow
          label="Close after the last decision"
          description="Answering the last pending proposal closes the inbox and hands the page back exactly where you left it, so approving the queue does not leave a sheet covering the work you went back to."
          action={
            <span data-testid="settings-decision-auto-close">
              <Toggle
                label="Close the decisions inbox after the last decision"
                checked={current.autoClose}
                disabled={busy}
                onChange={(next) => void toggle("autoClose", next)}
              />
            </span>
          }
        />
      </div>
    </SettingsSection>
  );
}
