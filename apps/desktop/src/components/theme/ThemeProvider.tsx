import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemePreference,
  getStoredTheme,
  resolveThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";
import { applySkin } from "@/lib/themes/apply-skin";
import {
  getStoredSkinFavorites,
  persistSkinFavorites,
  toggleSkinFavorite,
  withoutSkinFavorite,
} from "@/lib/themes/favorites";
import { DEFAULT_SKIN_NAME, isBuiltinSkinName } from "@/lib/themes/presets";
import { listAllSkins, resolveSkin } from "@/lib/themes/registry";
import { getStoredSkinName, persistSkinName } from "@/lib/themes/storage";
import {
  installTheme,
  uninstallTheme,
  type InstallResult,
} from "@/lib/themes/user-themes";
import type { ForgeSkin } from "@/lib/themes/types";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
  skin: ForgeSkin;
  skinName: string;
  setSkin: (skinName: string) => void;
  /** Every theme this window can wear: the shipped ones, then the installed ones. */
  availableSkins: ForgeSkin[];
  /** The themes the operator brought in, in install order. */
  installedSkins: ForgeSkin[];
  /**
   * The starred names — the quick settings menu's whole list. Never empty by
   * default: an install that has never curated anything has every theme starred.
   */
  favoriteSkins: string[];
  isSkinFavorite: (skinName: string) => boolean;
  toggleSkinFavorite: (skinName: string) => void;
  /** Prove a parsed theme JSON and add it to what this window can wear. */
  installSkin: (raw: unknown) => InstallResult;
  /** Take an installed theme back out, unstarring it and leaving it if it is worn. */
  uninstallSkin: (skinName: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function overlayColor(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("rgb")) return trimmed;
  return null;
}

function syncTitleBarOverlay() {
  const chrome = window.lifequest?.windowChrome;
  if (!chrome) return;
  const styles = getComputedStyle(document.documentElement);
  const color = overlayColor(styles.getPropertyValue("--canvas-base"));
  const symbolColor = overlayColor(styles.getPropertyValue("--foreground"));
  if (!color || !symbolColor) return;
  void chrome.setTitleBarOverlay({ color, symbolColor }).catch(() => {
    /* overlay unsupported */
  });
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredTheme);
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    resolveThemePreference(getStoredTheme()),
  );
  const [skinName, setSkinNameState] = useState(getStoredSkinName);
  /*
   * `null` means the operator has never curated: every theme is starred, which is
   * what puts the full set in the quick settings menu on a fresh install. The
   * first star they clear or add persists an explicit list (see `favoriteSkins`).
   */
  const [storedFavorites, setStoredFavorites] = useState<string[] | null>(
    getStoredSkinFavorites,
  );
  const [availableSkins, setAvailableSkins] = useState<ForgeSkin[]>(listAllSkins);

  const installedSkins = useMemo(
    () => availableSkins.filter((skin) => !isBuiltinSkinName(skin.name)),
    [availableSkins],
  );

  const favoriteSkins = useMemo(
    () => storedFavorites ?? availableSkins.map((skin) => skin.name),
    [availableSkins, storedFavorites],
  );

  const applyCurrentSkin = useCallback((name: string, mode: "light" | "dark") => {
    applySkin(resolveSkin(name), mode);
    syncTitleBarOverlay();
  }, []);

  useLayoutEffect(() => {
    applyThemePreference(preference);
    const mode = resolveThemePreference(preference);
    setResolved(mode);
    applyCurrentSkin(skinName, mode);
  }, [applyCurrentSkin, preference, skinName]);

  useLayoutEffect(() => {
    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const mode = resolveThemePreference("system");
      setResolved(mode);
      applyCurrentSkin(skinName, mode);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [applyCurrentSkin, preference, skinName]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyThemePreference(next);
    const mode = resolveThemePreference(next);
    setResolved(mode);
    applyCurrentSkin(skinName, mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, [applyCurrentSkin, skinName]);

  const setSkin = useCallback(
    (nextName: string) => {
      const skin = resolveSkin(nextName);
      setSkinNameState(skin.name);
      persistSkinName(skin.name);
      applyCurrentSkin(skin.name, resolved);
    },
    [applyCurrentSkin, resolved],
  );

  const skin = useMemo(() => resolveSkin(skinName), [skinName]);

  /**
   * What the curated list is before the operator has curated anything: every
   * theme this window can wear. Passed into the state updater rather than read
   * from the render's `favoriteSkins`, so two presses that arrive in the same tick
   * compose — the second one sees the list the first one left behind.
   */
  const baseFavorites = availableSkins.map((available) => available.name);

  /** Star or unstar one theme; the first press materialises the default list. */
  const toggleFavoriteSkin = useCallback(
    (name: string) => {
      setStoredFavorites((current) => toggleSkinFavorite(current ?? baseFavorites, name));
    },
    // `baseFavorites` is rebuilt every render; keyed on the skins it is made of.
    [availableSkins],
  );

  const isSkinFavorite = useCallback(
    (name: string) => favoriteSkins.includes(name),
    [favoriteSkins],
  );

  /**
   * Installing wants the theme visible straight away, so it joins the starred
   * list as it lands — a theme you cannot reach from the quick menu reads as one
   * that did not install. Unstarring it is one press, in the same grid.
   */
  const installSkin = useCallback(
    (raw: unknown): InstallResult => {
      const result = installTheme(raw);
      if (!result.ok) return result;
      const worn = listAllSkins();
      setAvailableSkins(worn);
      setStoredFavorites((current) => {
        const base = current ?? availableSkins.map((available) => available.name);
        return base.includes(result.skin.name)
          ? base
          : [...base, result.skin.name];
      });
      return result;
    },
    [availableSkins],
  );

  /**
   * Removing a theme has to leave the window wearable: an explicit starred list
   * loses the name, and a theme being worn hands the window back to the default
   * rather than to a skin that no longer exists.
   */
  const uninstallSkin = useCallback(
    (name: string) => {
      uninstallTheme(name);
      setAvailableSkins(listAllSkins());
      setStoredFavorites((current) =>
        current ? withoutSkinFavorite(current, name) : current,
      );
      if (skinName === name) {
        setSkinNameState(DEFAULT_SKIN_NAME);
        persistSkinName(DEFAULT_SKIN_NAME);
        applyCurrentSkin(DEFAULT_SKIN_NAME, resolved);
      }
    },
    [applyCurrentSkin, resolved, skinName],
  );

  /*
   * The star list is written from the state it settles on, never from inside the
   * updater: React may run an updater twice, and a write in there would be a
   * second one.
   */
  useEffect(() => {
    if (storedFavorites) persistSkinFavorites(storedFavorites);
  }, [storedFavorites]);

  const value = useMemo(
    () => ({
      preference,
      resolved,
      setPreference,
      skin,
      skinName,
      setSkin,
      availableSkins,
      installedSkins,
      favoriteSkins,
      isSkinFavorite,
      toggleSkinFavorite: toggleFavoriteSkin,
      installSkin,
      uninstallSkin,
    }),
    [
      availableSkins,
      favoriteSkins,
      installSkin,
      installedSkins,
      isSkinFavorite,
      preference,
      resolved,
      setPreference,
      setSkin,
      skin,
      skinName,
      toggleFavoriteSkin,
      uninstallSkin,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
