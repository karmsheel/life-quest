/**
 * Header-only inspection of a receipt image.
 *
 * Kept free of Electron imports on purpose: this module is the pure part of
 * `receipt-image.ts` (what may be stored, and how big its declared canvas is),
 * and the e2e/verification harness can load it without a running app. Decoding
 * itself stays in `receipt-image.ts`.
 *
 * A receipt is attacker-supplied bytes: the file name and the declared mime are
 * both operator strings, and a 25 MB PNG can declare 60,000 x 60,000 pixels and
 * cost gigabytes of RGBA before it is ever re-encoded. So the format and the
 * declared dimensions are read from the header, before `nativeImage` sees the
 * buffer.
 */

export type ReceiptKind = "image/jpeg" | "image/png";

/** The original may be this large; the vault keeps it as it arrived. */
export const RECEIPT_ORIGINAL_CEILING = 25 * 1024 * 1024;
/** The copy Hermes sees may be this large, before base64 inflation. */
export const RECEIPT_COPY_CEILING = 2 * 1024 * 1024;
/** A decode of more than this many pixels is refused before it happens. */
export const RECEIPT_MAX_DIMENSION = 12_000;
export const RECEIPT_MAX_PIXELS = 40_000_000;

/**
 * The format is read from the bytes. The file name and the declared mime are
 * both operator-supplied strings, and a receipt that only claims to be an image
 * would reach `nativeImage` and fail there with a message about decoding rather
 * than about what the operator picked.
 */
export function sniffReceiptKind(bytes: Uint8Array): ReceiptKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, i) => bytes[i] === byte)) {
    return "image/png";
  }
  return null;
}

/** PNG IHDR / JPEG SOFn dimensions, or null when the bytes do not say. */
export function sniffImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const kind = sniffReceiptKind(bytes);
  const be16 = (o: number) => (bytes[o]! << 8) | bytes[o + 1]!;
  const be32 = (o: number) =>
    ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
  if (kind === "image/png") {
    if (bytes.length < 24) return null;
    const width = be32(16);
    const height = be32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (kind === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = be16(offset + 2);
      if (length < 2) return null;
      const isFrameHeader =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrameHeader) {
        const height = be16(offset + 5);
        const width = be16(offset + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      if (marker === 0xda) return null; // start of scan before any SOF
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

/** True when the declared canvas is larger than a receipt could ever need. */
export function dimensionsTooLarge(size: { width: number; height: number }): boolean {
  return (
    size.width > RECEIPT_MAX_DIMENSION ||
    size.height > RECEIPT_MAX_DIMENSION ||
    size.width * size.height > RECEIPT_MAX_PIXELS
  );
}
