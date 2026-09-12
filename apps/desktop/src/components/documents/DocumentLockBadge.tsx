export function DocumentLockBadge({ locked }: { locked: boolean }) {
  const label = locked ? "Locked" : "Unlocked";
  return (
    <span
      className={`doc-status-badge doc-status-badge--${locked ? "locked" : "unlocked"}`}
      data-locked={locked ? "true" : "false"}
    >
      {label}
    </span>
  );
}
