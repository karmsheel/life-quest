import { jsonError, jsonOk } from "@/lib/api.ts";
import { resolveDomainForUser } from "@/lib/active-domain.ts";
import { requireUser } from "@/lib/auth.ts";
import {
  parseDocumentKind,
  type DocumentStatus,
} from "@/lib/document-kinds.ts";
import { canTransitionStatus } from "@/lib/documents.ts";
import { appendLifeEvent } from "@/lib/life-log-write.ts";
import { prisma } from "@/lib/prisma.ts";

type RouteContext = { params: Promise<{ id: string; kind: string }> };

function serializeDocument(doc: {
  id: string;
  domainId: string;
  kind: string;
  title: string;
  bodyMarkdown: string;
  status: string;
  forgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: doc.id,
    domainId: doc.domainId,
    kind: doc.kind,
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown,
    status: doc.status,
    forgedAt: doc.forgedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

type StatusBody = {
  status?: unknown;
};

function parseTargetStatus(value: unknown): DocumentStatus | null {
  if (value === "refined" || value === "forged") {
    return value;
  }
  return null;
}

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const { id, kind: kindRaw } = await context.params;
  const kind = parseDocumentKind(kindRaw);
  if (!kind) {
    return jsonError("Invalid document kind", 400);
  }

  const domain = await resolveDomainForUser(user.id, id);
  if (!domain) {
    return jsonError("Domain not found", 404);
  }

  const document = await prisma.domainDocument.findUnique({
    where: { domainId_kind: { domainId: domain.id, kind } },
  });
  if (!document) {
    return jsonError("Document not found", 404);
  }

  let body: StatusBody;
  try {
    body = (await request.json()) as StatusBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const to = parseTargetStatus(body.status);
  if (!to) {
    return jsonError('status must be "refined" or "forged"', 400);
  }

  const from = document.status as DocumentStatus;
  if (!canTransitionStatus(from, to)) {
    return jsonError(`Cannot transition status from ${from} to ${to}`, 400);
  }

  const data: { status: DocumentStatus; forgedAt?: Date } = { status: to };
  if (to === "forged") {
    data.forgedAt = new Date();
  }

  const updated = await prisma.domainDocument.update({
    where: { id: document.id },
    data,
  });

  await appendLifeEvent({
    userId: user.id,
    domainId: domain.id,
    type: "document.status_changed",
    summary: `Status ${kind}: ${from} → ${to}`,
    payload: { documentId: updated.id, kind, from, to },
  });

  return jsonOk({ document: serializeDocument(updated) });
}
