import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { appendLifeEvent } from "@/lib/life-log-write.ts";
import { serializeAgentHire } from "@/lib/personnel.ts";
import { prisma } from "@/lib/prisma.ts";

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  // Default: active only. status=all returns every hire.
  const includeAll = statusParam === "all";
  const statusFilter =
    statusParam === "dismissed"
      ? "dismissed"
      : includeAll
        ? undefined
        : "active";

  if (
    statusParam &&
    statusParam !== "all" &&
    statusParam !== "active" &&
    statusParam !== "dismissed"
  ) {
    return jsonError('status must be "active", "dismissed", or "all"', 400);
  }

  const hires = await prisma.agentHire.findMany({
    where: {
      userId: user.id,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonOk({
    personnel: hires.map(serializeAgentHire),
  });
}

type HireBody = {
  hermesAgentId?: unknown;
  name?: unknown;
  roleLabel?: unknown;
  domainId?: unknown;
};

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  let body: HireBody;
  try {
    body = (await request.json()) as HireBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const hermesAgentId =
    typeof body.hermesAgentId === "string" ? body.hermesAgentId.trim() : "";
  if (!hermesAgentId) {
    return jsonError("hermesAgentId is required", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return jsonError("name is required", 400);
  }

  let roleLabel: string | null = null;
  if (body.roleLabel !== undefined && body.roleLabel !== null) {
    if (typeof body.roleLabel !== "string") {
      return jsonError("roleLabel must be a string", 400);
    }
    roleLabel = body.roleLabel.trim() || null;
  }

  let domainId: string | null = null;
  if (body.domainId !== undefined && body.domainId !== null) {
    if (typeof body.domainId !== "string" || !body.domainId.trim()) {
      return jsonError("domainId must be a non-empty string", 400);
    }
    const domain = await prisma.domain.findFirst({
      where: { id: body.domainId.trim(), userId: user.id },
    });
    if (!domain) {
      return jsonError("Domain not found", 404);
    }
    domainId = domain.id;
  }

  const hire = await prisma.agentHire.create({
    data: {
      userId: user.id,
      domainId,
      hermesAgentId,
      name,
      roleLabel,
      status: "active",
    },
  });

  await appendLifeEvent({
    userId: user.id,
    domainId,
    type: "agent.hired",
    summary: `Hired agent ${name}`,
    payload: {
      hireId: hire.id,
      hermesAgentId,
      name,
      roleLabel,
    },
  });

  return jsonOk({ personnel: serializeAgentHire(hire) }, 201);
}
