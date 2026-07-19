"use client";

import { useMemo } from "react";
import { simpleMarkdownToHtml } from "@/lib/markdown-simple";

/**
 * Renders assistant chat content with safe limited markdown
 * (bold, italic, lists, code, links — see simpleMarkdownToHtml).
 */
export function ChatMarkdown({
  markdown,
  className = "",
}: {
  markdown: string;
  className?: string;
}) {
  const html = useMemo(() => simpleMarkdownToHtml(markdown || ""), [markdown]);

  if (!markdown) return null;

  return (
    <div
      className={`chat-md ${className}`.trim()}
      // Content is escaped + limited markdown only (see simpleMarkdownToHtml)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
