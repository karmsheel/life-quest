"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { HermesConnectionProvider } from "@/components/hermes/HermesConnectionProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <HermesConnectionProvider>
        {children}
        <Toaster richColors position="top-center" />
      </HermesConnectionProvider>
    </ThemeProvider>
  );
}
