import { useMemo } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";

/**
 * The scene behind the page.
 *
 * A theme names a preset and an intensity; this component owns what those words
 * look like. Every shape is generated from a fixed seed, so the same theme is
 * the same sky on every launch and the rig can count what it sees. Nothing here
 * is interactive: the layer is `aria-hidden`, sits behind a palette scrim, and
 * under `prefers-reduced-motion` it holds still.
 *
 * Its budget is part of the contract: at most ninety nodes, animation on
 * `opacity` and `transform` only, so a lively scene cannot cost a frame the
 * operator feels while typing.
 */
type Star = { x: number; y: number; size: number; delay: number; duration: number };
type Ring = { rx: number; ry: number; rotate: number; delay: number };
type Band = { top: number; height: number; hue: number; delay: number };

const STAR_COUNT = 72;
const RING_COUNT = 3;
const BAND_COUNT = 3;

/** mulberry32: small, deterministic, and seedable, so the sky never re-rolls. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(): Star[] {
  const next = random(0x5eed);
  return Array.from({ length: STAR_COUNT }, () => ({
    x: Math.round(next() * 1000) / 10,
    y: Math.round(next() * 1000) / 10,
    size: Math.round((1 + next() * 1.6) * 10) / 10,
    delay: Math.round(next() * 600) / 100,
    duration: Math.round((2.4 + next() * 3.6) * 10) / 10,
  }));
}

function makeRings(): Ring[] {
  const next = random(0x0b17);
  return Array.from({ length: RING_COUNT }, (_, index) => ({
    rx: 34 + index * 9,
    ry: 15 + index * 5,
    rotate: Math.round(next() * 40) - 20,
    delay: Math.round(next() * 80) / 10,
  }));
}

function makeBands(): Band[] {
  const next = random(0xa0a0);
  return Array.from({ length: BAND_COUNT }, (_, index) => ({
    top: 12 + index * 24 + Math.round(next() * 6),
    height: 18 + Math.round(next() * 10),
    hue: 190 + index * 40,
    delay: Math.round(next() * 120) / 10,
  }));
}

export function SceneBackdrop() {
  const { scene } = useTheme();
  const preset = scene.background.preset;
  const stars = useMemo(() => makeStars(), []);
  const rings = useMemo(() => makeRings(), []);
  const bands = useMemo(() => makeBands(), []);

  if (preset === "plain") return null;

  return (
    <div
      className={`scene-backdrop scene-backdrop--${preset}`}
      data-testid="scene-backdrop"
      data-scene-preset={preset}
      aria-hidden="true"
    >
      {preset === "starfield"
        ? stars.map((star, index) => (
            <span
              key={index}
              className="scene-backdrop__star"
              style={
                {
                  "--x": `${star.x}%`,
                  "--y": `${star.y}%`,
                  "--size": `${star.size}px`,
                  "--delay": `${star.delay}s`,
                  "--duration": `${star.duration}s`,
                } as React.CSSProperties
              }
            />
          ))
        : null}

      {preset === "orbit" ? (
        <div className="scene-backdrop__system">
          {rings.map((ring, index) => (
            <span
              key={`ring-${index}`}
              className="scene-backdrop__ring"
              style={
                {
                  "--rx": `${ring.rx}%`,
                  "--ry": `${ring.ry}%`,
                  "--rotate": `${ring.rotate}deg`,
                  "--delay": `${ring.delay}s`,
                } as React.CSSProperties
              }
            />
          ))}
          {rings.map((ring, index) => (
            <span
              key={`planet-${index}`}
              className="scene-backdrop__planet"
              style={
                {
                  "--rx": `${ring.rx}%`,
                  "--ry": `${ring.ry}%`,
                  "--rotate": `${ring.rotate + 90}deg`,
                  "--delay": `${ring.delay}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ) : null}

      {preset === "aurora" ? (
        <div className="scene-backdrop__aurora">
          {bands.map((band, index) => (
            <span
              key={index}
              className="scene-backdrop__band"
              style={
                {
                  "--top": `${band.top}%`,
                  "--height": `${band.height}%`,
                  "--hue": `${band.hue}`,
                  "--delay": `${band.delay}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
