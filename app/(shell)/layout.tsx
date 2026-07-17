import type { ReactNode } from "react";
import { ChatbarProvider } from "@/components/chatbar/ChatbarProvider";
import { AppShell } from "@/components/shell/AppShell";
import { ShellProvider } from "@/components/shell/ShellProvider";
import { TabProvider } from "@/components/shell/TabProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ShellProvider>
        <TabProvider>
          <ChatbarProvider>
            <AppShell>{children}</AppShell>
          </ChatbarProvider>
        </TabProvider>
      </ShellProvider>
    </ThemeProvider>
  );
}
