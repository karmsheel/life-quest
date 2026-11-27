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
 * A picture is the other kind of backdrop: the theme names a file in the app
 * profile's `backgrounds/`, the provider reads its bytes and hands this layer a
 * blob URL, and the picture replaces the drawn sky entirely while it is set —
 * one layer, never both. While the bytes are in flight the container paints
 * empty (the picture appears when it lands, with no flash of a sky the theme
 * did not ask for). If the read is refused — a theme may name a file this
 * profile does not hold — the layer falls through to the theme's drawn preset:
 * a picture that is gone costs the page its wallpaper, never its sky. "Plain"
 * still paints nothing, picture or not.
 *
 * Its budget is part of the contract: at most ninety nodes, animation on
 * `opacity` and `transform` only, so a lively scene cannot cost a frame the
 * operator feels while typing.
 */
type Star = { x: number; y: number; size: number; delay: number; duration: number };
type Ring = { rx: number; ry: number; rotate: number; delay: number };
type Band = { top: number; height: number; hue: number; delay: number };
type Ridge = { top: number; height: number; offset: number; delay: number };
type Sun = { x: number; y: number; size: number };
type Blob = {
  x: number;
  y: number;
  size: number;
  hue: number;
  delay: number;
  duration: number;
};

const STAR_COUNT = 72;
const RING_COUNT = 3;
const BAND_COUNT = 3;
/** Four ridges and one sun: the horizon preset's whole six-node budget. */
const RIDGE_COUNT = 4;
/** Three blobs: the mesh preset's whole five-node budget. */
const BLOB_COUNT = 3;

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

/**
 * Horizon's ridges: four stacked bands with a deterministic tilt, lowest and
 * widest first, so the sky reads as layered distance rather than a stripe.
 */
function makeRidges(): Ridge[] {
  const next = random(0x4d17);
  return Array.from({ length: RIDGE_COUNT }, (_, index) => ({
    top: 48 + index * 12 + Math.round(next() * 4),
    height: 10 + Math.round(next() * 8),
    offset: Math.round(next() * 6) - 3,
    delay: Math.round(next() * 90) / 10,
  }));
}

/** The horizon's one disc: a fixed seat above the ridge line. */
function makeSun(): Sun {
  const next = random(0x5a11);
  return {
    x: 62 + Math.round(next() * 14),
    y: 18 + Math.round(next() * 10),
    size: 84 + Math.round(next() * 36),
  };
}

/** Mesh's drifting colour blobs: three fixed seats, each its own hue. */
function makeBlobs(): Blob[] {
  const next = random(0x3e11);
  return Array.from({ length: BLOB_COUNT }, (_, index) => ({
    x: 16 + index * 28 + Math.round(next() * 10),
    y: 22 + Math.round(next() * 46),
    size: 44 + Math.round(next() * 22),
    hue: 168 + index * 46,
    delay: Math.round(next() * 80) / 10,
    duration: Math.round((18 + next() * 10) * 10) / 10,
  }));
}

export function SceneBackdrop() {
  const { scene, sceneImageUrl, sceneImageStatus } = useTheme();
  const preset = scene.background.preset;
  const image = scene.background.image;
  const stars = useMemo(() => makeStars(), []);
  const rings = useMemo(() => makeRings(), []);
  const bands = useMemo(() => makeBands(), []);
  const ridges = useMemo(() => makeRidges(), []);
  const sun = useMemo(() => makeSun(), []);
  const blobs = useMemo(() => makeBlobs(), []);

  // A picture replaces the drawn sky while its bytes are there (or still on
  // their way). A refused read is the one exception: the theme's sky paints
  // instead, because an empty layer would just be a hole in the page.
  if (image && sceneImageStatus !== "missing") {
    return (
      <div
        className="scene-backdrop scene-backdrop--image"
        data-testid="scene-backdrop"
        data-scene-preset="image"
        data-image-fit={image.fit}
        data-image-position={image.position}
        data-image-dim={image.dim}
        data-image-blur={image.blur}
        aria-hidden="true"
      >
        {sceneImageUrl ? (
          <span
            className="scene-backdrop__picture"
            data-testid="scene-backdrop-image"
            style={{ backgroundImage: `url("${sceneImageUrl}")` }}
          />
        ) : null}
      </div>
    );
  }

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

      {preset === "horizon" ? (
        <div className="scene-backdrop__horizon">
          <span
            className="scene-backdrop__sun"
            style={
              {
                "--x": `${sun.x}%`,
                "--y": `${sun.y}%`,
                "--size": `${sun.size}px`,
              } as React.CSSProperties
            }
          />
          {ridges.map((ridge, index) => (
            <span
              key={index}
              className="scene-backdrop__ridge"
              style={
                {
                  "--top": `${ridge.top}%`,
                  "--height": `${ridge.height}%`,
                  "--offset": `${ridge.offset}`,
                  "--delay": `${ridge.delay}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ) : null}

      {preset === "mesh" ? (
        <div className="scene-backdrop__mesh">
          {blobs.map((blob, index) => (
            <span
              key={index}
              className="scene-backdrop__blob"
              style={
                {
                  "--x": `${blob.x}%`,
                  "--y": `${blob.y}%`,
                  "--size": `${blob.size}%`,
                  "--hue": `${blob.hue}`,
                  "--delay": `${blob.delay}s`,
                  "--duration": `${blob.duration}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
