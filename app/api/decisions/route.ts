import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import {
  canProposeOnDocument,
  parseListStatusFilter,
} from "@/lib/decisions.ts";
import { appendLifeEvent } from "@/lib/life-log-write.ts";
import { prisma } from "@/lib/prisma.ts";

function serializeDecision(d: {
  id: string;
  domainId: string;
  documentId: string;
  status: string;
  title: string;
  rationale: string | null;
  proposedBodyMarkdown: string;
  previousBodyMarkdown: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
}) {
  return {
    id: d.id,
    domainId: d.domainId,
    documentId: d.documentId,
    status: d.status,
    title: d.title,
    rationale: d.rationale,
    proposedBodyMarkdown: d.proposedBodyMarkdown,
    previousBodyMarkdown: d.previousBodyMarkdown,
    createdAt: d.createdAt,
    resolvedAt: d.resolvedAt,
    resolvedByUserId: d.resolvedByUserId,
  };
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const url = new URL(request.url);
  const statusFilter = parseListStatusFilter(url.searchParams.get("status"));
  if (!statusFilter) {
    return jsonError('status must be "pending" or "all"', 400);
  }

  const domainIdParam = url.searchParams.get("domainId");

  if (domainIdParam) {
    const domain = await prisma.domain.findFirst({
      where: { id: domainIdParam, userId: user.id },
    });
    if (!domain) {
      return jsonError("Domain not found", 404);
    }
  }

  const decisions = await prisma.decision.findMany({
    where: {
      domain: { userId: user.id },
      ...(domainIdParam ? { domainId: domainIdParam } : {}),
      ...(statusFilter === "pending" ? { status: "pending" } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonOk({
    decisions: decisions.map(serializeDecision),
  });
}

type CreateBody = {
  documentId?: unknown;
  title?: unknown;
  rationale?: unknown;
  proposedBodyMarkdown?: unknown;
};

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const documentId =
    typeof body.documentId === "string" ? body.documentId.trim() : "";
  if (!documentId) {
    return jsonError("documentId is required", 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return jsonError("title is required", 400);
  }

  if (typeof body.proposedBodyMarkdown !== "string") {
    return jsonError("proposedBodyMarkdown must be a string", 400);
  }
  const proposedBodyMarkdown = body.proposedBodyMarkdown;

  let rationale: string | null = null;
  if (body.rationale !== undefined && body.rationale !== null) {
    if (typeof body.rationale !== "string") {
      return jsonError("rationale must be a string", 400);
    }
    rationale = body.rationale.trim() || null;
  }

  const document = await prisma.domainDocument.findFirst({
    where: {
      id: documentId,
      domain: { userId: user.id },
    },
    include: { domain: true },
  });

  if (!document) {
    return jsonError("Document not found", 404);
  }

  const proposeOk = canProposeOnDocument(document.status);
  if (!proposeOk.ok) {
    return jsonError(proposeOk.reason, 400);
  }

  const decision = await prisma.decision.create({
    data: {
      domainId: document.domainId,
      documentId: document.id,
      status: "pending",
      title,
      rationale,
      proposedBodyMarkdown,
      previousBodyMarkdown: document.bodyMarkdown,
    },
  });

  await appendLifeEvent({
    userId: user.id,
    domainId: document.domainId,
    type: "decision.created",
    summary: `Proposed change: ${title}`,
    payload: {
      decisionId: decision.id,
      documentId: document.id,
      kind: document.kind,
    },
  });

  return jsonOk({ decision: serializeDecision(decision) }, 201);
}
