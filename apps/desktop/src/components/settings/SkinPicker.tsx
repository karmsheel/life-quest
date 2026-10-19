import { useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import { filterSkinsForPreference } from "@/lib/themes/presets";
import { SkinTile } from "./SkinTile";

/**
 * The Appearance page's theme grid: where themes are starred, installed and
 * removed.
 *
 * The star curates the quick settings menu — the popover shows nothing but the
 * starred ones. Every theme starts starred (`favorites.ts` treats "never curated"
 * as the whole set), so a fresh install opens the quick menu on everything and
 * narrows it only when the operator says so.
 *
 * Installing is a Forge theme from disk: the same JSON shape Hermes Desktop and
 * this app's presets share. The file is proved in `user-themes.ts` before it is
 * kept, and the field that failed is named if it is not a theme — a silently
 * ignored file is the one outcome that makes the button feel broken.
 */
export function SkinPicker() {
  const {
    preference,
    resolved,
    skinName,
    setSkin,
    availableSkins,
    installedSkins,
    favoriteSkins,
    isSkinFavorite,
    toggleSkinFavorite,
    installSkin,
    uninstallSkin,
  } = useTheme();
  const [installError, setInstallError] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const skins = useMemo(
    () => filterSkinsForPreference(availableSkins, preference),
    [availableSkins, preference],
  );

  const skinHint =
    preference === "system"
      ? "Follows system appearance · day & night palettes"
      : `${resolved === "dark" ? "Night" : "Day"} palette · LifeQuest themes`;

  const starredHere = skins.filter((skin) => isSkinFavorite(skin.name)).length;
  /*
   * Counted across every theme, not just the ones this colour mode can wear: a
   * dark-only theme starred while the app is in light mode is still starred, and
   * telling the operator "no themes are starred" would be a lie about their own
   * list.
   */
  const starredTotal = availableSkins.filter((skin) => isSkinFavorite(skin.name)).length;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clearing the input each time means re-picking the same file still fires.
    event.target.value = "";
    if (!file) return;

    setInstallNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setInstallError("That file is not JSON — a theme is a JSON object.");
      return;
    }

    const result = installSkin(parsed);
    if (!result.ok) {
      setInstallError(result.error);
      return;
    }
    setInstallError(null);
    setInstallNotice(`Installed “${result.skin.label}”. It is starred, so it is already in the quick settings menu.`);
  }

  return (
    <div className="settings-appearance__skins">
      <p className="settings-appearance__skin-hint">{skinHint}</p>
      <div className="settings-menu__skin-grid" role="group" aria-label="Themes">
        {skins.map((skin) => (
          <SkinTile
            key={skin.name}
            skin={skin}
            active={skinName === skin.name}
            mode={resolved}
            favorite={isSkinFavorite(skin.name)}
            onSelect={() => setSkin(skin.name)}
            onToggleFavorite={() => toggleSkinFavorite(skin.name)}
          />
        ))}
      </div>

      <p className="settings-appearance__skin-starred">
        <Star size={11} aria-hidden />
        {starredHere > 0
          ? `${starredHere} of ${skins.length} themes ${starredHere === 1 ? "is" : "are"} starred · the quick settings menu shows only these.`
          : starredTotal > 0
            ? "None of your starred themes fits this colour mode."
            : "No themes are starred — the quick settings menu is empty until you star one."}
      </p>

      <div className="settings-theme-install">
        <div className="settings-theme-install__copy">
          <p className="settings-theme-install__label">Install a theme</p>
          <p className="settings-theme-install__hint">
            A Forge theme JSON — the shape this app and Hermes Desktop share.
          </p>
        </div>
        <Button
          variant="outline"
          className="settings-theme-install__button"
          aria-describedby={installError ? errorId : undefined}
          onClick={() => fileRef.current?.click()}
        >
          <Plus size={13} aria-hidden />
          Choose file…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="Install a theme from a JSON file"
          data-theme-install-input=""
          onChange={onFile}
        />
      </div>

      {installError ? (
        <p className="form-error settings-theme-install__message" id={errorId} role="alert">
          {installError}
        </p>
      ) : null}
      {installNotice ? (
        <p className="form-message settings-theme-install__message" role="status">
          {installNotice}
        </p>
      ) : null}

      {installedSkins.length > 0 ? (
        <div className="settings-theme-installed">
          <p className="settings-theme-install__label">Installed</p>
          <ul className="settings-theme-installed__list">
            {installedSkins.map((skin) => (
              <li
                key={skin.name}
                className="settings-theme-installed__item"
                data-installed-skin={skin.name}
              >
                <span className="settings-theme-installed__name">{skin.label}</span>
                <span className="settings-theme-installed__id">{skin.name}</span>
                <button
                  type="button"
                  className="settings-theme-installed__remove"
                  aria-label={`Remove ${skin.label}`}
                  title={`Remove ${skin.label} from this app`}
                  onClick={() => {
                    setInstallNotice(null);
                    setInstallError(null);
                    uninstallSkin(skin.name);
                  }}
                >
                  <Trash2 size={12} aria-hidden />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
