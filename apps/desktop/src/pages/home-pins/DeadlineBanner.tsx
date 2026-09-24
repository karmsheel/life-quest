import { useMemo } from "react";
import { deadlinePressureGoals, filterByLens, daysUntilDeadline } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useState } from "react";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";

function localIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DeadlineBanner() {
  const { snapshot } = useVault();
  const lens = useDomainLens();
  const [dismissed, setDismissed] = useState(false);
  const [dismissedToday, setDismissedToday] = useState(false);

  const pressureGoals = useMemo(() => {
    const goals = snapshot?.goals ?? [];
    const today = localIsoDate();
    return deadlinePressureGoals(goals, today)
      .filter((g) => filterByLens([g], lens).length > 0)
      .sort((a, b) => daysUntilDeadline(a.deadline!, today) - daysUntilDeadline(b.deadline!, today));
  }, [snapshot?.goals, lens]);

  // Check dismissed on mount
  useMemo(() => {
    void (async () => {
      const res = await api().deadlineGetDismissed();
      if (res.ok && res.value) {
        setDismissedToday(res.value === localIsoDate());
      }
    })();
  }, []);

  async function dismissDeadline() {
    const ok = await api().deadlineDismiss();
    if (ok?.ok) {
      setDismissed(true);
    }
  }

  if (pressureGoals.length === 0 || dismissed || dismissedToday) return null;

  return (
    <div role="status" className="deadline-banner" aria-live="polite">
      <div className="deadline-banner__content">
        <span className="deadline-banner__label muted">Deadline pressure</span>
        <span className="deadline-banner__text">
          {pressureGoals.length === 1 ? (
            pressureGoals[0].name
          ) : (
            <>
              {pressureGoals[0].name} and {pressureGoals.length - 1} other{pressureGoals.length > 2 ? "s" : ""}
            </>
          )}
        </span>
      </div>
      <button
        className="deadline-banner__dismiss"
        onClick={dismissDeadline}
        title="Dismiss until tomorrow"
      >
        Dismiss
      </button>
    </div>
  );
}
