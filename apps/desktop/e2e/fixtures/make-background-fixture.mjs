/**
 * The wallpaper the background rig picks through the real file-picker seam.
 *
 * Run it once (the committed `background-ridge.png` is its output — the rig
 * never depends on this script at run time):
 *
 *   node apps/desktop/e2e/fixtures/make-background-fixture.mjs
 *
 * It draws a 640×360 dusk sky: seven flat colour bands, an orange sun disc and
 * a two-tone mountain ridge. Flat regions keep the PNG small (a few KB), and
 * the bands make it obvious in a screenshot that the shell is wearing the
 * operator's picture rather than a drawn preset. No image library is used, so
 * the PNG encoder is hand-rolled: 8-bit RGB, filter type 0 on every row, one
 * zlib-deflated IDAT.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "background-ridge.png");

const WIDTH = 640;
const HEIGHT = 360;

// Dusk bands, top to bottom: night blue → violet → rose → amber.
const BANDS = [
  [18, 24, 58],
  [34, 40, 88],
  [58, 54, 112],
  [92, 66, 126],
  [140, 84, 126],
  [196, 118, 112],
  [236, 158, 96],
];

const SUN = { x: 468, y: 176, radius: 42, color: [255, 214, 138] };

const FAR_RIDGE = [58, 52, 92];
const NEAR_RIDGE = [30, 30, 54];

/** Deterministic ripples, so the fixture is reproducible byte for byte. */
function ridgeTop(x, base, amplitude, phase, period) {
  return Math.round(
    base -
      amplitude *
        Math.abs(Math.sin(x / period + phase)) *
        (0.7 + 0.3 * Math.sin(x / (period * 0.37) + phase * 2)),
  );
}

function pixel(x, y) {
  // Sky bands, with a soft one-pixel blend at each seam.
  const bandHeight = Math.ceil(HEIGHT * 0.62 / BANDS.length);
  const raw = y / bandHeight;
  const index = Math.min(BANDS.length - 1, Math.max(0, Math.floor(raw)));
  const seam = raw - index;
  let color = BANDS[index];
  if (seam > 0.82 && index + 1 < BANDS.length) {
    const t = (seam - 0.82) / 0.18;
    color = color.map((channel, i) =>
      Math.round(channel + (BANDS[index + 1][i] - channel) * t),
    );
  }

  // The sun disc glows over the bands.
  const d = Math.hypot(x - SUN.x, y - SUN.y);
  if (d <= SUN.radius) {
    const edge = Math.min(1, (SUN.radius - d) / 6);
    color = color.map((channel, i) =>
      Math.round(channel + (SUN.color[i] - channel) * edge),
    );
  } else if (d <= SUN.radius + 18) {
    const halo = 1 - (d - SUN.radius) / 18;
    color = color.map((channel, i) =>
      Math.round(channel + (SUN.color[i] - channel) * halo * 0.28),
    );
  }

  // Two ridges: a far one at ~62% of the frame and a near one at ~72%.
  const farTop = ridgeTop(x, Math.round(HEIGHT * 0.66), 34, 0.8, 96);
  if (y >= farTop) color = FAR_RIDGE;
  const nearTop = ridgeTop(x, Math.round(HEIGHT * 0.78), 52, 2.3, 74);
  if (y >= nearTop) color = NEAR_RIDGE;

  return color;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = WIDTH * 3 + 1;
  const raw = Buffer.alloc(stride * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < WIDTH; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = row + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = encodePng();
// A sanity read of the signature and IHDR, so a typo cannot ship a broken
// fixture that main's magic-byte check would refuse at the picker seam.
if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
if (png.readUInt32BE(16) !== WIDTH || png.readUInt32BE(20) !== HEIGHT) {
  throw new Error("IHDR dimensions do not match the drawing");
}
if (png.length > 200 * 1024) {
  throw new Error(`fixture is ${png.length} bytes; the contract caps it at 200 KB`);
}
fs.writeFileSync(OUT, png);
console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${png.length} bytes`);
