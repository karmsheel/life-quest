import type { Metadata } from "next";
import { AppProviders } from "@/components/providers/AppProviders";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifeQuest",
  description: "Life management quests across domains",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
