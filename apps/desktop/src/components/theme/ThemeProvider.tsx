import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
import {
  DEFAULT_SKIN_NAME,
  FALLBACK_SKIN_NAME,
  isBuiltinSkinName,
  skinSupportsMode,
} from "@/lib/themes/presets";
import { listAllSkins, resolveSkin } from "@/lib/themes/registry";
import { getStoredSkinName, persistSkinName } from "@/lib/themes/storage";
import {
  installTheme,
  uninstallTheme,
  type InstallResult,
} from "@/lib/themes/user-themes";
import type { ForgeSkin } from "@/lib/themes/types";
import {
  applyMaterial,
  DEFAULT_THEME_CHROME,
  DEFAULT_THEME_MATERIAL,
  parseThemeFile,
  resolveChrome,
  resolveMaterial,
  type ThemeChrome,
  type ThemeFile,
  type ThemeMaterial,
} from "@/lib/themes/theme-file";

/** The worn theme file's name, kept in the renderer like the skin's. */
const THEME_FILE_STORAGE_KEY = "lifequest-theme-file";
/**
 * How long a theme the companion just wrote is shown before it hands the window
 * back. Ten seconds is long enough to look at, short enough that a bad write
 * cannot strand the operator in a shell they cannot navigate.
 */
const THEME_PREVIEW_MS = 10_000;

function readStoredThemeFile(): string | null {
  try {
    return localStorage.getItem(THEME_FILE_STORAGE_KEY);
  } catch {
    return null;
  }
}

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
  /**
   * The v2 theme file this window is wearing. `null` means the shell's default
   * chrome — a window that has never been given a theme file.
   */
  themeFile: ThemeFile | null;
  /** Where the shell's own components live, resolved from `themeFile`. */
  chrome: ThemeChrome;
  /** The material layer (radius, density, motion), resolved from `themeFile`. */
  material: ThemeMaterial;
  /** A file the companion just wrote: worn, but not yet kept. */
  themePreview: { file: string; label: string } | null;
  /** Why the newest theme file was refused, if it was. */
  themeError: string | null;
  keepThemePreview: () => void;
  revertThemePreview: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function overlayColor(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("rgb")) return trimmed;
  return null;
}

/**
 * Hand the native caption strip the fill the CSS titlebar is wearing. Exported for
 * the E2E harnesses that stand in for `ThemeProvider`'s stored-preference path:
 * they apply a skin directly (`applySkin`), and the overlay has to follow the same
 * way it does when the provider itself repaints.
 */
export function syncTitleBarOverlay() {
  const chrome = window.lifequest?.windowChrome;
  if (!chrome) return;
  const styles = getComputedStyle(document.documentElement);
  // The native caption buttons sit in the same strip the CSS paints, so the
  // overlay takes the titlebar's own fill — not the mat, which the rail wears.
  // `--canvas-base` is the fallback for a document whose skin never landed (the
  // day rule makes the two the same ink anyway).
  const color =
    overlayColor(styles.getPropertyValue("--titlebar-bg")) ??
    overlayColor(styles.getPropertyValue("--canvas-base"));
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

  /**
   * The skin the window can actually wear in `mode`.
   *
   * A one-palette theme has no answer for the other half of the day/night
   * switch. Rather than paint a day palette at night, the window hands itself to
   * the fallback theme — Nous, which ships both palettes — so the switch always
   * lands on a theme that can show the answer. Callers persist the name they get
   * back, not the one they asked about.
   */
  const skinForMode = useCallback((name: string, mode: "light" | "dark") => {
    const skin = resolveSkin(name);
    return skinSupportsMode(skin, mode) ? skin.name : FALLBACK_SKIN_NAME;
  }, []);

  /*
   * The v2 theme file: chrome placement and material, loaded from the app
   * profile's `themes/` directory. The palette stays the skin's, so a theme file
   * may add colour on top but never has to own the whole look.
   */
  const [themeFile, setThemeFile] = useState<ThemeFile | null>(null);
  const [chrome, setChrome] = useState<ThemeChrome>(DEFAULT_THEME_CHROME);
  const [material, setMaterial] = useState<ThemeMaterial>(DEFAULT_THEME_MATERIAL);
  const [themePreview, setThemePreview] = useState<{
    file: string;
    label: string;
  } | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const themePreviewTimer = useRef<number | null>(null);
  /** Last mtime seen per file, so a hot reload can name what actually changed. */
  const themeMtimes = useRef<Map<string, number>>(new Map());
  /** The theme this window reverts to; the rendered `themeFile` moves on preview. */
  const keptTheme = useRef<ThemeFile | null>(null);
  /** The theme currently painted, read from callbacks that must not go stale. */
  const paintedTheme = useRef<ThemeFile | null>(null);
  const previewRef = useRef<{ file: string; label: string } | null>(null);

  /**
   * Paint one theme: resolve its defaults, write the material layer, and (when
   * it carries colours) layer its palette over the skin it sits on.
   *
   * The palette is layered rather than replaced: a theme file is allowed to name
   * three colours and inherit the rest, which is what makes a small theme file
   * possible at all.
   */
  const paintTheme = useCallback(
    (next: ThemeFile | null) => {
      paintedTheme.current = next;
      const nextMaterial = resolveMaterial(next?.material);
      setChrome(resolveChrome(next?.chrome));
      setMaterial(nextMaterial);
      applyMaterial(nextMaterial, document.documentElement);
      if (next?.colors) {
        const base = resolveSkin(skinName);
        applySkin(
          {
            ...base,
            colors: { ...base.colors, ...next.colors },
            ...(next.darkColors && base.darkColors
              ? { darkColors: { ...base.darkColors, ...next.darkColors } }
              : {}),
          } as ForgeSkin,
          resolved,
        );
      }
    },
    [resolved, skinName],
  );

  /** Stop the countdown and give the window back the theme it had kept. */
  const revertThemePreview = useCallback(() => {
    if (themePreviewTimer.current !== null) {
      window.clearTimeout(themePreviewTimer.current);
      themePreviewTimer.current = null;
    }
    previewRef.current = null;
    setThemePreview(null);
    setThemeError(null);
    setThemeFile(keptTheme.current);
    paintTheme(keptTheme.current);
  }, [paintTheme]);

  /** Wear one file as a preview; after ten seconds it reverts by itself. */
  const showPreview = useCallback(
    (next: { file: string; theme: ThemeFile }) => {
      if (themePreviewTimer.current !== null) {
        window.clearTimeout(themePreviewTimer.current);
      }
      const preview = { file: next.file, label: next.theme.label };
      previewRef.current = preview;
      setThemePreview(preview);
      setThemeError(null);
      setThemeFile(next.theme);
      paintTheme(next.theme);
      themePreviewTimer.current = window.setTimeout(() => {
        themePreviewTimer.current = null;
        revertThemePreview();
      }, THEME_PREVIEW_MS);
    },
    [paintTheme, revertThemePreview],
  );

  /** Keep the previewed theme: persisted by file name, worn from now on. */
  const keepThemePreview = useCallback(() => {
    const preview = previewRef.current;
    if (!preview) return;
    if (themePreviewTimer.current !== null) {
      window.clearTimeout(themePreviewTimer.current);
      themePreviewTimer.current = null;
    }
    try {
      localStorage.setItem(THEME_FILE_STORAGE_KEY, preview.file);
    } catch {
      /* ignore */
    }
    keptTheme.current = paintedTheme.current;
    previewRef.current = null;
    setThemePreview(null);
    setThemeError(null);
  }, []);

  /**
   * Read the directory, paint what the operator kept, and preview anything the
   * companion just wrote. `preview: false` is the first read of the session: a
   * kept theme is worn without the ten-second countdown.
   */
  const loadThemeFiles = useCallback(
    async (options?: { preview?: boolean }) => {
      const bridge = window.lifequest;
      if (!bridge?.themesList) return;
      let answer: Awaited<ReturnType<typeof bridge.themesList>>;
      try {
        answer = await bridge.themesList();
      } catch {
        return;
      }
      if (!answer.ok) {
        setThemeError(answer.error);
        return;
      }

      const known = themeMtimes.current;
      const keptName = readStoredThemeFile();
      let changed: { file: string; theme: ThemeFile } | null = null;
      let keptChanged = false;
      let kept: { file: string; theme: ThemeFile } | null = null;
      let failure: string | null = null;
      const seen = new Set<string>();

      for (const entry of answer.value) {
        seen.add(entry.file);
        const previous = known.get(entry.file);
        if ("error" in entry) {
          if (previous !== undefined || entry.file === keptName) {
            failure = `${entry.file}: ${entry.error}`;
          }
          continue;
        }
        const isNewOrChanged = previous === undefined || previous !== entry.mtime;
        const invalid = (detail: string) => {
          if (isNewOrChanged || entry.file === keptName) {
            failure = `${entry.file}: ${detail}`;
          }
        };
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(entry.raw);
        } catch {
          invalid("not valid JSON");
          continue;
        }
        known.set(entry.file, entry.mtime);
        const parsed = parseThemeFile(parsedJson);
        if (!parsed.ok) {
          invalid(parsed.error);
          continue;
        }
        if (entry.file === keptName) {
          kept = { file: entry.file, theme: parsed.theme };
          if (previous !== undefined && previous !== entry.mtime) {
            keptChanged = true;
          }
        } else if (isNewOrChanged) {
          changed = { file: entry.file, theme: parsed.theme };
        }
      }
      for (const file of [...known.keys()]) {
        if (!seen.has(file)) known.delete(file);
      }

      if (kept) keptTheme.current = kept.theme;
      if (options?.preview === false) {
        setThemeFile(kept?.theme ?? null);
        paintTheme(kept?.theme ?? null);
        return;
      }
      if (keptChanged) {
        revertThemePreview();
        return;
      }
      if (changed) showPreview(changed);
      if (failure) setThemeError(failure);
    },
    [paintTheme, revertThemePreview, showPreview],
  );

  useEffect(() => {
    void loadThemeFiles({ preview: false });
    const unsubscribe = window.lifequest?.onThemesChanged?.(() => {
      void loadThemeFiles();
    });
    return () => {
      unsubscribe?.();
      if (themePreviewTimer.current !== null) {
        window.clearTimeout(themePreviewTimer.current);
        themePreviewTimer.current = null;
      }
    };
  }, [loadThemeFiles]);

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
      const worn = skinForMode(skinName, mode);
      setResolved(mode);
      if (worn !== skinName) {
        setSkinNameState(worn);
        persistSkinName(worn);
      }
      applyCurrentSkin(worn, mode);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [applyCurrentSkin, preference, skinForMode, skinName]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyThemePreference(next);
    const mode = resolveThemePreference(next);
    const worn = skinForMode(skinName, mode);
    setResolved(mode);
    if (worn !== skinName) {
      setSkinNameState(worn);
      persistSkinName(worn);
    }
    applyCurrentSkin(worn, mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, [applyCurrentSkin, skinForMode, skinName]);

  const setSkin = useCallback(
    (nextName: string) => {
      const skin = resolveSkin(nextName);
      // The picker only offers skins that match the current mode, so this is a
      // guard rather than a path: the window must never wear a theme in a colour
      // mode the theme cannot paint.
      const worn = skinForMode(skin.name, resolved);
      setSkinNameState(worn);
      persistSkinName(worn);
      applyCurrentSkin(worn, resolved);
    },
    [applyCurrentSkin, resolved, skinForMode],
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
      themeFile,
      chrome,
      material,
      themePreview,
      themeError,
      keepThemePreview,
      revertThemePreview,
    }),
    [
      availableSkins,
      chrome,
      favoriteSkins,
      installSkin,
      installedSkins,
      isSkinFavorite,
      keepThemePreview,
      material,
      preference,
      resolved,
      revertThemePreview,
      setPreference,
      setSkin,
      skin,
      skinName,
      themeError,
      themeFile,
      themePreview,
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
