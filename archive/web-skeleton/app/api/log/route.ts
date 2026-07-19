import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { prisma } from "@/lib/prisma.ts";

function serializeLifeEvent(e: {
  id: string;
  userId: string;
  domainId: string | null;
  type: string;
  summary: string;
  payloadJson: string | null;
  createdAt: Date;
}) {
  let payload: unknown = null;
  if (e.payloadJson) {
    try {
      payload = JSON.parse(e.payloadJson);
    } catch {
      payload = e.payloadJson;
    }
  }
  return {
    id: e.id,
    userId: e.userId,
    domainId: e.domainId,
    type: e.type,
    summary: e.summary,
    payload,
    createdAt: e.createdAt,
  };
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const url = new URL(request.url);
  const domainIdParam = url.searchParams.get("domainId");

  if (domainIdParam) {
    const domain = await prisma.domain.findFirst({
      where: { id: domainIdParam, userId: user.id },
    });
    if (!domain) {
      return jsonError("Domain not found", 404);
    }
  }

  const events = await prisma.lifeEvent.findMany({
    where: {
      userId: user.id,
      ...(domainIdParam ? { domainId: domainIdParam } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonOk({
    events: events.map(serializeLifeEvent),
  });
}
