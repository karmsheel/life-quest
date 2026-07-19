import type { ReactNode } from "react";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <NavRail />
      <div className="shell__main">
        <TopBar />
        <div className="shell__content">{children}</div>
      </div>
    </div>
  );
}
