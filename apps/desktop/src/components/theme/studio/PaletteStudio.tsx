import { useId, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import { mix } from "@/lib/themes/color";
import {
  checkThemeContrast,
  contrastRatio,
  relativeLuminance,
  TEXT_CONTRAST_PAIRS,
  THEME_REQUIRED_COLORS,
  type ThemeFile,
} from "@/lib/themes/theme-file";
import type { SkinColors } from "@/lib/themes/types";

/**
 * The Customizations studio's palette editor — S3.
 *
 * A theme file may carry two complete palettes: `colors` (the day look) and
 * `darkColors` (the night one). Either may be absent, which is the honest way
 * to say "inherit the skin". When present, the shared parser demands the full
 * `THEME_REQUIRED_COLORS` set and WCAG AA on every text pair the shell paints,
 * so this editor edits whole palettes, never fragments:
 *
 *  - a group's toggle includes or removes the palette; including seeds every
 *    required token from the window's effective skin, and removing deletes the
 *    key so the shell goes back to the skin palette;
 *  - Copy current palette seeds both groups from `useTheme().skin` in one press;
 *  - every token has a hex field (and a colour picker) and the live verdict runs
 *    the same `checkThemeContrast` the parser runs, naming each failing pair
 *    with its ratio and the minimum it needs.
 *
 * Typing is local: a half-typed hex string is held in `pending` and only a
 * complete hex value reaches the draft, so the painted draft never receives an
 * invalid CSS colour.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

type PaletteMode = "light" | "dark";

function humanize(token: string): string {
  const spaced = token.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Read a colour back as hex. Skins are usually hex already; anything else is
 * normalised through the browser's own parser so a copy always produces values
 * the shared parser accepts.
 */
function toHex(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (HEX.test(trimmed)) return trimmed;
  try {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return trimmed;
    context.fillStyle = "#000000";
    context.fillStyle = trimmed;
    const parsed = String(context.fillStyle);
    if (HEX.test(parsed)) return parsed;
    const match = /^rgba?\(([^)]+)\)$/i.exec(parsed);
    if (!match) return trimmed;
    const [r, g, b, alpha] = match[1]!.split(",").map((part) => part.trim());
    const byte = (channel: string) =>
      Math.max(0, Math.min(255, Math.round(Number(channel))))
        .toString(16)
        .padStart(2, "0");
    const hex = `#${byte(r!)}${byte(g!)}${byte(b!)}`;
    if (alpha === undefined || Number(alpha) >= 1) return hex;
    return `${hex}${byte(String(Number(alpha) * 255))}`;
  } catch {
    return trimmed;
  }
}

/** The complete required set, so an included palette is a whole palette. */
function requiredFrom(colors: SkinColors): SkinColors {
  const picked = {} as SkinColors;
  for (const token of THEME_REQUIRED_COLORS) {
    (picked as unknown as Record<string, string>)[token] = toHex(colors[token]);
  }
  return picked;
}

/**
 * Copy has to hand back a palette Save can accept, and the shipped skins are
 * not all AA-clean themselves: the default Forge skin sits at 4.4:1 on the day
 * accent foreground and 3.95:1 on the night destructive foreground. A faithful
 * copy would therefore start the operator on an invalid file.
 *
 * The nudge keeps the palette's own polarity — a dark ink on a light surface
 * darkens a step, a light ink on a dark surface lightens one — and only when no
 * ink can pass on a surface does it move the surface instead (Forge's white on
 * the night destructive red cannot reach 4.5:1, so the red darkens a hair and
 * the white text stays white). Every non-failing token is copied exactly.
 */
function nudgeForAa(colors: SkinColors): SkinColors {
  const next = { ...colors } as unknown as Record<string, string>;
  for (const [surface, ink] of TEXT_CONTRAST_PAIRS) {
    const passes = () => {
      const ratio = contrastRatio(next[surface]!, next[ink]!);
      return ratio === null || ratio >= 4.5;
    };
    if (passes()) continue;
    const inkIsDark =
      (relativeLuminance(next[ink]!) ?? 0) <
      (relativeLuminance(next[surface]!) ?? 0);
    // First keep the ink's own side: darker ink on a light surface, lighter ink
    // on a dark one, by the smallest steps that clear the floor.
    const inkTarget = inkIsDark ? "#000000" : "#FFFFFF";
    for (let step = 0; step < 24 && !passes(); step += 1) {
      next[ink] = mix(next[ink]!, inkTarget, 0.06);
    }
    if (passes()) continue;
    // No ink on this surface can pass: move the surface away from the ink
    // instead, so the text keeps the colour it was written in.
    const surfaceTarget = inkIsDark ? "#FFFFFF" : "#000000";
    for (let step = 0; step < 40 && !passes(); step += 1) {
      next[surface] = mix(next[surface]!, surfaceTarget, 0.06);
    }
  }
  return next as unknown as SkinColors;
}

/** The complete, AA-clean palette an include/copy starts from. */
function seededFrom(colors: SkinColors): SkinColors {
  return nudgeForAa(requiredFrom(colors));
}

/** A colour input cannot represent alpha; the picker edits the opaque base. */
function opaqueHex(value: string | undefined): string {
  const hex = toHex(value);
  const clean = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(clean)) return clean.slice(0, 7);
  if (/^#[0-9a-f]{4}$/.test(clean)) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  }
  if (/^#[0-9a-f]{3}$/.test(clean)) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  }
  return /^#[0-9a-f]{6}$/.test(clean) ? clean : "#000000";
}

export interface PaletteStudioProps {
  draft: ThemeFile;
  onChange: (next: ThemeFile) => void;
}

export function PaletteStudio({ draft, onChange }: PaletteStudioProps) {
  const { skin } = useTheme();
  const baseId = useId();
  /** Half-typed hex strings, per `mode-token`; valid values also reach the draft. */
  const [pending, setPending] = useState<Record<string, string>>({});

  const skinLight = seededFrom(skin.colors);
  const skinDark = seededFrom(skin.darkColors ?? skin.colors);
  const palettes: Record<PaletteMode, SkinColors | undefined> = {
    light: draft.colors,
    dark: draft.darkColors,
  };

  const commitPalette = (mode: PaletteMode, next: SkinColors | undefined) => {
    const theme: ThemeFile = { ...draft };
    if (mode === "light") {
      if (next) theme.colors = next;
      else delete theme.colors;
    } else if (next) {
      theme.darkColors = next;
    } else {
      delete theme.darkColors;
    }
    onChange(theme);
  };

  const setGroup = (mode: PaletteMode, enabled: boolean) => {
    if (!enabled) {
      commitPalette(mode, undefined);
      return;
    }
    const existing = mode === "light" ? draft.colors : draft.darkColors;
    commitPalette(mode, existing ? { ...existing } : mode === "light" ? skinLight : skinDark);
  };

  const setToken = (mode: PaletteMode, token: keyof SkinColors, hex: string) => {
    const base = {
      ...(mode === "light" ? draft.colors ?? skinLight : draft.darkColors ?? skinDark),
    } as SkinColors;
    (base as unknown as Record<string, string>)[token] = hex;
    commitPalette(mode, base);
  };

  const failures = [
    ...(draft.colors
      ? checkThemeContrast(draft.colors).map((failure) => ({
          mode: "light" as const,
          ...failure,
        }))
      : []),
    ...(draft.darkColors
      ? checkThemeContrast(draft.darkColors).map((failure) => ({
          mode: "dark" as const,
          ...failure,
        }))
      : []),
  ];

  const verdictText =
    failures.length === 0
      ? draft.colors || draft.darkColors
        ? "Palettes pass WCAG AA contrast on every text pair."
        : "No palette carried — the shell inherits the skin."
      : failures
          .map(
            (failure) =>
              `${failure.mode} ${failure.pair}: ${failure.ratio}:1 (needs ${failure.minimum}:1)`,
          )
          .join("; ");

  return (
    <div className="studio-palette">
      <p className="studio__note">
        A palette is whole: either the theme carries every required colour, or it
        carries none and the skin paints the window. Every pair the shell sets
        text on is checked against WCAG AA before Save is allowed.
      </p>

      <div className="studio-palette__toolbar">
        <Button
          variant="outline"
          data-testid="studio-palette-copy"
          onClick={() =>
            onChange({
              ...draft,
              colors: { ...skinLight },
              darkColors: { ...skinDark },
            })
          }
        >
          Copy current palette
        </Button>
        <p className="studio__hint">
          Seeds both groups from the palette the window is wearing, so you edit
          deltas instead of starting from scratch. A pair the skin itself falls
          short of is nudged the minimum needed to pass AA; everything else is
          copied exactly.
        </p>
      </div>

      {(["light", "dark"] as const).map((mode) => {
        const palette = palettes[mode];
        const enabled = palette !== undefined;
        const inherited = mode === "light" ? skinLight : skinDark;
        const shown = palette ?? inherited;
        return (
          <section
            key={mode}
            className="studio-palette__group"
            aria-label={`${mode === "light" ? "Light" : "Dark"} palette`}
            data-testid={`studio-palette-${mode}`}
          >
            <div className="studio-palette__group-header">
              <label className="studio__radio studio-palette__toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  data-testid={`studio-palette-${mode}-enabled`}
                  onChange={(event) => setGroup(mode, event.target.checked)}
                />
                {mode === "light" ? "Carry a light palette" : "Carry a dark palette"}
              </label>
              <p className="studio__hint">
                {enabled
                  ? "Written into the file as a complete palette."
                  : "Off — the shell inherits this palette from the skin."}
              </p>
            </div>

            <div className="studio-palette__rows">
              {THEME_REQUIRED_COLORS.map((token) => {
                const key = `${mode}-${token}`;
                const committed = toHex(shown[token]);
                const text = pending[key] ?? committed;
                const inputId = `${baseId}-${mode}-${token}`;
                return (
                  <div className="studio-palette__row" key={key}>
                    <label className="studio-palette__label" htmlFor={inputId}>
                      {humanize(token)}
                    </label>
                    <input
                      id={inputId}
                      type="text"
                      className="studio-palette__hex"
                      spellCheck={false}
                      value={text}
                      disabled={!enabled}
                      aria-invalid={
                        pending[key] !== undefined && !HEX.test(text.trim())
                      }
                      data-testid={`studio-palette-${mode}-${token}`}
                      onChange={(event) => {
                        const next = event.target.value;
                        setPending((current) => ({ ...current, [key]: next }));
                        if (HEX.test(next.trim())) {
                          setToken(mode, token, next.trim());
                        }
                      }}
                      onBlur={() =>
                        setPending((current) => {
                          const next = { ...current };
                          delete next[key];
                          return next;
                        })
                      }
                    />
                    <input
                      type="color"
                      className="studio-palette__picker"
                      value={opaqueHex(shown[token])}
                      disabled={!enabled}
                      aria-label={`${humanize(token)} ${mode} colour`}
                      onChange={(event) => {
                        const next = event.target.value;
                        setPending((current) => {
                          const cleared = { ...current };
                          delete cleared[key];
                          return cleared;
                        });
                        setToken(mode, token, next);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p
        className={
          failures.length === 0 ? "studio__valid" : "studio-palette__failure"
        }
        role={failures.length === 0 ? "status" : "alert"}
        data-testid="studio-palette-verdict"
      >
        {verdictText}
      </p>
    </div>
  );
}
