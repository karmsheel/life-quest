import { jsonError, jsonOk } from "@/lib/api.ts";
import { resolveDomainForUser } from "@/lib/active-domain.ts";
import { requireUser } from "@/lib/auth.ts";
import {
  parseDocumentKind,
  type DocumentKind,
  type DocumentStatus,
} from "@/lib/document-kinds.ts";
import { assertEditable } from "@/lib/documents.ts";
import { appendLifeEvent } from "@/lib/life-log-write.ts";
import { prisma } from "@/lib/prisma.ts";
import { getUnlockedRooms, type UnlockDoc } from "@/lib/unlock.ts";

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

async function unlockSnapshot(domainId: string) {
  const docs = await prisma.domainDocument.findMany({
    where: { domainId },
    select: { kind: true, bodyMarkdown: true },
  });
  const unlockDocs: UnlockDoc[] = docs
    .map((d) => {
      const kind = parseDocumentKind(d.kind);
      if (!kind) return null;
      return { kind, bodyMarkdown: d.bodyMarkdown };
    })
    .filter((d): d is UnlockDoc => d !== null);

  return Array.from(getUnlockedRooms(unlockDocs));
}

async function loadDocument(domainId: string, kind: DocumentKind) {
  return prisma.domainDocument.findUnique({
    where: { domainId_kind: { domainId, kind } },
  });
}

type PatchBody = {
  bodyMarkdown?: unknown;
  title?: unknown;
};

export async function GET(_request: Request, context: RouteContext) {
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

  const document = await loadDocument(domain.id, kind);
  if (!document) {
    return jsonError("Document not found", 404);
  }

  const unlockedRooms = await unlockSnapshot(domain.id);

  return jsonOk({
    document: serializeDocument(document),
    unlockedRooms,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
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

  const document = await loadDocument(domain.id, kind);
  if (!document) {
    return jsonError("Document not found", 404);
  }

  const editable = assertEditable(document.status as DocumentStatus);
  if (!editable.ok) {
    return jsonError(editable.reason, 409);
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const data: { bodyMarkdown?: string; title?: string } = {};

  if (body.bodyMarkdown !== undefined) {
    if (typeof body.bodyMarkdown !== "string") {
      return jsonError("bodyMarkdown must be a string", 400);
    }
    data.bodyMarkdown = body.bodyMarkdown;
  }

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return jsonError("title must be a non-empty string", 400);
    }
    data.title = body.title.trim();
  }

  if (Object.keys(data).length === 0) {
    return jsonOk({ document: serializeDocument(document) });
  }

  const updated = await prisma.domainDocument.update({
    where: { id: document.id },
    data,
  });

  await appendLifeEvent({
    userId: user.id,
    domainId: domain.id,
    type: "document.updated",
    summary: `Updated ${kind} document`,
    payload: {
      documentId: updated.id,
      kind,
      fields: Object.keys(data),
    },
  });

  return jsonOk({ document: serializeDocument(updated) });
}
