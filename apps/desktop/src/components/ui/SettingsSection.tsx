import type { ReactNode } from "react";

export function SettingsSection({
  icon,
  title,
  subtitle,
  banner,
  contentClassName = "settings-card",
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  banner?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="settings-panel__heading">
        <div className="settings-panel__icon">{icon}</div>
        <div>
          <h2 className="settings-panel__title">{title}</h2>
          {subtitle ? <p className="settings-panel__subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {banner}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
