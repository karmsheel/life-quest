import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import {
  canResolveDecision,
  parseResolveAction,
} from "@/lib/decisions.ts";
import { prisma } from "@/lib/prisma.ts";

type RouteContext = { params: Promise<{ id: string }> };

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

type ResolveBody = {
  action?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const { id } = await context.params;

  const decision = await prisma.decision.findFirst({
    where: {
      id,
      domain: { userId: user.id },
    },
    include: {
      document: true,
    },
  });

  if (!decision) {
    return jsonError("Decision not found", 404);
  }

  const resolveOk = canResolveDecision(decision.status);
  if (!resolveOk.ok) {
    return jsonError(resolveOk.reason, 400);
  }

  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const action = parseResolveAction(body.action);
  if (!action) {
    return jsonError('action must be "approve" or "reject"', 400);
  }

  const now = new Date();

  if (action === "reject") {
    const updated = await prisma.$transaction(async (tx) => {
      const rejected = await tx.decision.update({
        where: { id: decision.id },
        data: {
          status: "rejected",
          resolvedAt: now,
          resolvedByUserId: user.id,
        },
      });

      await tx.lifeEvent.create({
        data: {
          userId: user.id,
          domainId: decision.domainId,
          type: "decision.rejected",
          summary: `Rejected decision: ${decision.title}`,
          payloadJson: JSON.stringify({
            decisionId: decision.id,
            documentId: decision.documentId,
          }),
        },
      });

      return rejected;
    });

    return jsonOk({ decision: serializeDecision(updated) });
  }

  // approve: apply proposed body, keep document forged
  const updated = await prisma.$transaction(async (tx) => {
    await tx.domainDocument.update({
      where: { id: decision.documentId },
      data: {
        bodyMarkdown: decision.proposedBodyMarkdown,
        // status remains forged; do not clear forgedAt
      },
    });

    const approved = await tx.decision.update({
      where: { id: decision.id },
      data: {
        status: "approved",
        resolvedAt: now,
        resolvedByUserId: user.id,
      },
    });

    await tx.lifeEvent.create({
      data: {
        userId: user.id,
        domainId: decision.domainId,
        type: "decision.approved",
        summary: `Approved decision: ${decision.title}`,
        payloadJson: JSON.stringify({
          decisionId: decision.id,
          documentId: decision.documentId,
          kind: decision.document.kind,
        }),
      },
    });

    await tx.lifeEvent.create({
      data: {
        userId: user.id,
        domainId: decision.domainId,
        type: "document.updated",
        summary: `Updated ${decision.document.kind} document via decision`,
        payloadJson: JSON.stringify({
          documentId: decision.documentId,
          kind: decision.document.kind,
          fields: ["bodyMarkdown"],
          via: "decision.approved",
          decisionId: decision.id,
        }),
      },
    });

    return approved;
  });

  return jsonOk({ decision: serializeDecision(updated) });
}
