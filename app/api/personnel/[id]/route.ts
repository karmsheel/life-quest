import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { appendLifeEvent } from "@/lib/life-log-write.ts";
import { serializeAgentHire } from "@/lib/personnel.ts";
import { prisma } from "@/lib/prisma.ts";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const { id } = await context.params;

  const hire = await prisma.agentHire.findFirst({
    where: { id, userId: user.id },
  });

  if (!hire) {
    return jsonError("Personnel not found", 404);
  }

  if (hire.status === "dismissed") {
    return jsonError("Agent already dismissed", 400);
  }

  const dismissedAt = new Date();
  const updated = await prisma.agentHire.update({
    where: { id: hire.id },
    data: {
      status: "dismissed",
      dismissedAt,
    },
  });

  await appendLifeEvent({
    userId: user.id,
    domainId: hire.domainId,
    type: "agent.dismissed",
    summary: `Dismissed agent ${hire.name}`,
    payload: {
      hireId: hire.id,
      hermesAgentId: hire.hermesAgentId,
      name: hire.name,
    },
  });

  return jsonOk({ personnel: serializeAgentHire(updated) });
}
