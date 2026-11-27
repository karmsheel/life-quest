/**
 * Turning an operator-picked `File` into the shape the vault's upload call
 * wants.
 *
 * The bytes are read once, and the canvas is read from a decode of those same
 * bytes. The decode is best-effort: a GIF or an unusual WebP may refuse
 * `createImageBitmap` on this machine, and the vault accepts a picture without
 * its dimensions — it only uses them to reserve the right space before the
 * picture paints.
 */
export type PreparedImage = {
  bytes: Uint8Array;
  mime: string;
  name: string;
  width: number | null;
  height: number | null;
};

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/** Whether a dropped or pasted file claims to be one of ours. */
export function looksLikeImage(file: File): boolean {
  if (file.type && /^image\/(png|jpeg|gif|webp)$/i.test(file.type)) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

export async function prepareImageFile(file: File): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let width: number | null = null;
  let height: number | null = null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }));
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    // The vault will still store the bytes; the page just cannot reserve space.
  }
  return { bytes, mime: file.type, name: file.name, width, height };
}

/** Bytes in the operator's units, for the card's sub line. */
export function formatImageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
