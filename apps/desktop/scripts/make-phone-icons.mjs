/**
 * Writes the phone app's PNG icons from the same three shapes as the SVG.
 *
 * Run once: `node scripts/make-phone-icons.mjs`. The PNGs are committed, so a
 * build needs no image tooling. The encoder is here rather than a dependency
 * because the icon is three rounded rectangles — a 40-line PNG writer is less
 * to trust than a new package, and the repo ships no runtime dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../phone/public/icons");

const BG = [26, 25, 23, 255];
const PAPER = [232, 228, 220, 255];
const ACCENT = [201, 120, 74, 255];

const crcTable = (() => {
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
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function png(size, pixel) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const at = y * stride + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }
  return Buffer.concat([
    header,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Whether a point is inside a rounded rectangle, with a soft edge. */
function inRoundRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function icon(size) {
  const u = size / 512;
  return png(size, (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    // The rounded backplate; outside it the icon is transparent.
    if (!inRoundRect(px, py, 0, 0, size, size, 112 * u)) return [0, 0, 0, 0];
    const leftPane = inRoundRect(px, py, 96 * u, 128 * u, 132 * u, 256 * u, 26 * u);
    const topRight = inRoundRect(px, py, 252 * u, 128 * u, 164 * u, 120 * u, 26 * u);
    const bottomRight = inRoundRect(px, py, 252 * u, 272 * u, 164 * u, 112 * u, 26 * u);
    if (topRight) return ACCENT;
    if (leftPane || bottomRight) return PAPER;
    return BG;
  });
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, icon(size));
  console.log(`[phone icons] ${path.relative(process.cwd(), file)}`);
}
