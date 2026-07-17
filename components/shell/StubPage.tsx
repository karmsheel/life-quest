import type { ReactNode } from "react";

export function StubPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="stub-page">
      <h1 className="stub-page__title">{title}</h1>
      <p className="stub-page__desc muted">{description}</p>
      {children}
    </div>
  );
}
