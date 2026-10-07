/**
 * The receipt path's vault side: what may be stored, and what the model is
 * allowed to see.
 *
 * Two different byte strings come out of one attach. The vault keeps the
 * original, untouched, so the row's `source_file` cell points at what the
 * operator actually photographed. Hermes gets a re-encode small enough to ride
 * the turn: the gateway caps a request body at 10 MB and base64 costs a third
 * on top, so a phone photo handed over whole would be refused at the far end
 * with nothing useful to say about why.
 *
 * The copy is built before the write, so a copy that cannot be produced leaves
 * no orphan behind in the file store.
 */
import path from "node:path";
import { nativeImage } from "electron";
import {
  FINANCE_DOMAIN_SLUG,
  isReceiptStoreReady,
  saveDatabaseFile,
  type Result,
} from "@lifequest/vault-core";

export type ReceiptKind = "image/jpeg" | "image/png";

/** The original may be this large; the vault keeps it as it arrived. */
export const RECEIPT_ORIGINAL_CEILING = 25 * 1024 * 1024;
/** The copy Hermes sees may be this large, before base64 inflation. */
export const RECEIPT_COPY_CEILING = 2 * 1024 * 1024;

export const RECEIPT_TYPE_MESSAGE = "Receipts must be JPEG or PNG images.";
export const RECEIPT_SIZE_MESSAGE = "That receipt is larger than 25 MB.";
export const RECEIPT_KIT_MESSAGE = "Install the Finance kit first";
export const RECEIPT_COPY_MESSAGE = "This receipt could not be prepared for the agent.";

/**
 * The copy ladder: the long edge and the JPEG quality for each attempt, in
 * order. Rung one is the picture a receipt needs to stay legible; the later
 * rungs exist for the rare dense photo that rung one cannot shrink enough.
 */
const COPY_LADDER: Array<{ longEdge: number; quality: number }> = [
  { longEdge: 1600, quality: 80 },
  { longEdge: 1600, quality: 60 },
  { longEdge: 1200, quality: 55 },
];

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

/** The same shape `nativeImage.createFromBuffer` returns. */
type NativeImage = ReturnType<typeof nativeImage.createFromBuffer>;

/** The copy, down the ladder, or null when every rung stays over the ceiling. */
function buildModelCopy(image: NativeImage): Uint8Array | null {
  const size = image.getSize();
  const longest = Math.max(size.width, size.height);
  for (const rung of COPY_LADDER) {
    const scale = longest > rung.longEdge ? rung.longEdge / longest : 1;
    const resized =
      scale === 1
        ? image
        : image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "good",
          });
    const jpeg = resized.toJPEG(rung.quality);
    if (jpeg.byteLength <= RECEIPT_COPY_CEILING) return new Uint8Array(jpeg);
  }
  return null;
}

export async function prepareReceipt(
  root: string,
  input: { bytes: Uint8Array; mime: string; name: string },
): Promise<
  Result<{
    relPath: string;
    fileId: string;
    name: string;
    size: number;
    modelCopy: Uint8Array;
  }>
> {
  const kind = sniffReceiptKind(input.bytes);
  if (!kind) return { ok: false, error: RECEIPT_TYPE_MESSAGE };
  if (input.bytes.byteLength > RECEIPT_ORIGINAL_CEILING) {
    return { ok: false, error: RECEIPT_SIZE_MESSAGE };
  }
  if (!(await isReceiptStoreReady(root))) {
    return { ok: false, error: RECEIPT_KIT_MESSAGE };
  }

  const image = nativeImage.createFromBuffer(Buffer.from(input.bytes));
  if (image.isEmpty()) return { ok: false, error: RECEIPT_TYPE_MESSAGE };
  const modelCopy = buildModelCopy(image);
  if (!modelCopy) return { ok: false, error: RECEIPT_COPY_MESSAGE };

  const saved = await saveDatabaseFile(root, FINANCE_DOMAIN_SLUG, {
    bytes: input.bytes,
    mime: kind,
    name: path.basename(input.name),
  });
  if (!saved.ok) return saved;

  return {
    ok: true,
    value: {
      relPath: saved.value.relPath,
      fileId: saved.value.fileId,
      name: path.basename(input.name),
      size: input.bytes.byteLength,
      modelCopy,
    },
  };
}
