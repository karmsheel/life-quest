import type { ReactNode } from "react";

export function ListRow({
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
    <div className={`ui-list-row ${className}`.trim()}>
      <div className="ui-list-row__body">
        <span className="ui-list-row__label">{label}</span>
        {description ? <span className="ui-list-row__desc">{description}</span> : null}
      </div>
      {action ? <div className="ui-list-row__action">{action}</div> : null}
    </div>
  );
}
