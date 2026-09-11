import { useEffect, useMemo, useRef } from "react";
import { doctrineMarkdownToHtml } from "@/lib/doctrine-markdown";
import { api } from "@/lib/ipc";

export function MarkdownView({
  markdown,
  slug,
}: {
  markdown: string;
  slug: string;
}) {
  const html = useMemo(() => doctrineMarkdownToHtml(markdown), [markdown]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const imgs = [...root.querySelectorAll<HTMLImageElement>("img[data-media]")];
    const urls: string[] = [];
    let cancelled = false;
    void (async () => {
      for (const img of imgs) {
        const rel = img.getAttribute("data-media");
        if (!rel) continue;
        const res = await api().documentMediaRead(slug, rel);
        if (cancelled) return;
        if (!res.ok) {
          img.replaceWith(
            Object.assign(document.createElement("span"), {
              className: "md-image-missing muted",
              textContent: img.alt || "image missing",
            }),
          );
          continue;
        }
        const blob = new Blob([res.value.bytes as BlobPart], {
          type: res.value.mime,
        });
        const url = URL.createObjectURL(blob);
        urls.push(url);
        img.src = url;
      }
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [html, slug]);

  return (
    <div
      ref={ref}
      className="md-view"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
