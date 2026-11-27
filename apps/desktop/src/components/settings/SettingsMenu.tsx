import { Link } from "react-router-dom";
import { Settings } from "lucide-react";

/**
 * The titlebar's settings control.
 *
 * It is a plain link to the settings sheet, and nothing more. The quick menu
 * that used to live here — the colour-mode switcher and the starred themes —
 * now hangs off the day/night control instead, which is where the operator
 * already reaches for a palette. A gear that opens a second, smaller way into
 * the same settings is one more thing to explain, so the gear opens the settings
 * and stops there.
 */
export function SettingsMenu({ className }: { className?: string }) {
  return (
    <div className={`settings-menu ${className ?? ""}`.trim()}>
      <Link
        to="/settings"
        className="settings-menu__trigger"
        aria-label="Open settings"
        title="Settings"
      >
        <Settings size={17} />
      </Link>
    </div>
  );
}
