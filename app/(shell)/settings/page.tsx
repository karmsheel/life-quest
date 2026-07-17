"use client";

import { StubPage } from "@/components/shell/StubPage";
import { useTheme } from "@/components/theme/ThemeProvider";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <StubPage
      title="Settings"
      description="Appearance, Hermes connection, and about. Hermes form arrives later."
    >
      <section className="settings-section">
        <h2 className="settings-section__title">Appearance</h2>
        <div className="settings-theme">
          <button
            type="button"
            className={
              theme === "light"
                ? "settings-theme__btn settings-theme__btn--active"
                : "settings-theme__btn"
            }
            onClick={() => setTheme("light")}
          >
            Light
          </button>
          <button
            type="button"
            className={
              theme === "dark"
                ? "settings-theme__btn settings-theme__btn--active"
                : "settings-theme__btn"
            }
            onClick={() => setTheme("dark")}
          >
            Dark
          </button>
        </div>
      </section>
    </StubPage>
  );
}
