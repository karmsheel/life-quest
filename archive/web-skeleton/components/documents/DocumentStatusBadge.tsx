import type { DocumentStatus } from "@/lib/document-kinds.ts";

const LABELS: Record<DocumentStatus, string> = {
  draft: "Draft",
  refined: "Refined",
  forged: "Forged",
};

export function DocumentStatusBadge({
  status,
}: {
  status: DocumentStatus | string;
}) {
  const normalized = (
    status === "refined" || status === "forged" ? status : "draft"
  ) as DocumentStatus;

  return (
    <span
      className={`doc-status-badge doc-status-badge--${normalized}`}
      data-status={normalized}
    >
      {LABELS[normalized]}
    </span>
  );
}
