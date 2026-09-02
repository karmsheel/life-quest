import type { ReactNode } from "react";

export function SettingsRow({
  label,
  description,
  action,
  className = "",
}: {
  label: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["settings-card__row", className].filter(Boolean).join(" ")}>
      <div className="settings-card__copy">
        <div className="settings-card__label">{label}</div>
        {description ? <p className="settings-card__desc">{description}</p> : null}
      </div>
      {action ? <div className="settings-card__control">{action}</div> : null}
    </div>
  );
}
