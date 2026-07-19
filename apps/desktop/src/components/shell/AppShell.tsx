import { useEffect, useState, type ReactNode } from "react";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { useVault } from "@/state/VaultProvider";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";

function applyTheme(theme: "system" | "light" | "dark" | undefined) {
  const root = document.documentElement;
  if (!theme || theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const { snapshot } = useVault();
  const [chatOpen, setChatOpen] = useState(true);

  useEffect(() => {
    applyTheme(snapshot?.settings.theme);
  }, [snapshot?.settings.theme]);

  return (
    <div
      className={[
        "shell",
        chatOpen ? "shell--chat-open" : "shell--chat-collapsed",
      ].join(" ")}
    >
      <NavRail />
      <div className="shell__main">
        <TopBar />
        <div className="shell__content">{children}</div>
      </div>
      <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  );
}
