import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/ipc";

/**
 * The bytes of the chain's pictures, as blob URLs the page can draw.
 *
 * A capture's picture is a file in the vault, and the renderer cannot point an
 * `<img>` at a vault path: that would be a filesystem read outside the bridge,
 * and the CSP allows `blob:` rather than `file:`. So each picture is read
 * through the same guarded IPC the rest of the vault uses and turned into a
 * blob URL once, keyed by the vault-relative path the record carries.
 *
 * The URL lives until the consumer unmounts. A path that cannot be read is
 * reported as missing rather than dropping the row: the capture still exists,
 * and a blank space where the picture was is what tells the operator so.
 */
export type SignalImageUrls = {
  /** relPath → blob URL, for the pictures that could be read. */
  urls: Record<string, string>;
  /** relPath → true, for a path whose bytes have gone. */
  missing: Record<string, true>;
};

export function useSignalImageUrls(relPaths: readonly string[]): SignalImageUrls {
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

  // A stable key: the callback below may run for the same set of paths every
  // render, and the effect only needs to start reads for paths it has not seen.
  const key = relPaths.join("\n");

  useEffect(() => {
    for (const relPath of key ? key.split("\n") : []) {
      if (started.current.has(relPath)) continue;
      started.current.add(relPath);
      void (async () => {
        let result;
        try {
          result = await api().signalChainReadImage(relPath);
        } catch {
          if (!mounted.current) return;
          setMissing((prev) => ({ ...prev, [relPath]: true }));
          return;
        }
        if (!mounted.current) return;
        if (!result.ok) {
          setMissing((prev) => ({ ...prev, [relPath]: true }));
          return;
        }
        const url = URL.createObjectURL(
          new Blob([result.value.bytes as BlobPart], { type: result.value.mime }),
        );
        live.current.add(url);
        setUrls((prev) => ({ ...prev, [relPath]: url }));
      })();
    }
  }, [key]);

  return { urls, missing };
}
