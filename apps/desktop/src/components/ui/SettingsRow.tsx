import type { ReactNode } from "react";

export function SettingsRow({
  label,
  description,
  action,
  note,
  className = "",
}: {
  label: string;
  description?: string;
  action?: ReactNode;
  /**
   * The setting's own feedback, under its copy rather than loose in the card: a
   * switch that reports what it just did belongs to the row it belongs to.
   */
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["settings-card__row", className].filter(Boolean).join(" ")}>
      <div className="settings-card__copy">
        <div className="settings-card__label">{label}</div>
        {description ? <p className="settings-card__desc">{description}</p> : null}
        {note ? <div className="settings-card__note">{note}</div> : null}
      </div>
      {action ? <div className="settings-card__control">{action}</div> : null}
    </div>
  );
}
