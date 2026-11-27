import { useEffect, useRef, useState } from "react";
import type { VaultImage } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";

/**
 * The bytes of the library's pictures, as blob URLs the page can draw.
 *
 * The vault keeps pictures as files, and the renderer cannot point an `<img>`
 * at a vault path: that would be a filesystem read outside the bridge, and the
 * CSP allows `blob:` rather than `file:`. So each picture is read through the
 * same guarded IPC the rest of the vault uses and turned into a blob URL once,
 * keyed by the vault-relative path.
 *
 * The URL lives until the page unmounts. A picture removed from the library
 * leaves its URL behind for the life of the page — a few hundred kilobytes the
 * operator cannot see, and cheaper than revoking a URL an image block may still
 * be painting from while the removal lands.
 */
export type ImageUrls = {
  /** relPath → blob URL, for the pictures that could be read. */
  urls: Record<string, string>;
  /** relPath → true, for a library row whose file has gone. */
  missing: Record<string, true>;
};

export function useImageUrls(images: VaultImage[] | null): ImageUrls {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<Record<string, true>>({});
  const started = useRef(new Set<string>());
  const live = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const url of live.current) URL.revokeObjectURL(url);
      live.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!images) return;
    for (const image of images) {
      if (started.current.has(image.relPath)) continue;
      started.current.add(image.relPath);
      void (async () => {
        let result;
        try {
          result = await api().imagesRead(image.relPath);
        } catch (e) {
          if (!mounted.current) return;
          setMissing((prev) => ({ ...prev, [image.relPath]: true }));
          return;
        }
        if (!mounted.current) return;
        if (!result.ok) {
          setMissing((prev) => ({ ...prev, [image.relPath]: true }));
          return;
        }
        const url = URL.createObjectURL(
          new Blob([result.value.bytes as BlobPart], { type: result.value.mime }),
        );
        live.current.add(url);
        setUrls((prev) => ({ ...prev, [image.relPath]: url }));
      })();
    }
  }, [images]);

  return { urls, missing };
}
