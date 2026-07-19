"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useChatbar } from "@/components/chatbar/ChatbarProvider";
import { DomainSwitcher } from "./DomainSwitcher";
import { RoomSwitcher } from "./RoomSwitcher";
import { TabBar } from "./TabBar";

export function TopBar() {
  const { theme, toggleTheme } = useTheme();
  const { toggle: toggleChat } = useChatbar();

  return (
    <header className="top-bar">
      <div className="top-bar__tabs">
        <TabBar />
      </div>
      <div className="top-bar__controls">
        <DomainSwitcher />
        <RoomSwitcher />
        <button
          type="button"
          className="top-bar__icon-btn"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          className="top-bar__icon-btn"
          onClick={toggleChat}
          aria-label="Toggle Hermes chat"
          title="Hermes chat"
        >
          Chat
        </button>
      </div>
    </header>
  );
}
