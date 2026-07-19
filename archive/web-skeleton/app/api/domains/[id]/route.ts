import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { appendLifeEvent } from "@/lib/life-log-write.ts";
import { prisma } from "@/lib/prisma.ts";

type RouteContext = { params: Promise<{ id: string }> };

async function findOwnedDomain(userId: string, id: string) {
  return prisma.domain.findFirst({
    where: { id, userId },
  });
}

type PatchBody = {
  name?: unknown;
  description?: unknown;
  archived?: unknown;
};

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const { id } = await context.params;
  const domain = await findOwnedDomain(user.id, id);
  if (!domain) {
    return jsonError("Domain not found", 404);
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const data: {
    name?: string;
    description?: string | null;
    archivedAt?: Date | null;
  } = {};

  let nameChanged = false;
  let previousName = domain.name;
  let restored = false;
  let archivedViaPatch = false;

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return jsonError("Name must be a non-empty string", 400);
    }
    const nextName = body.name.trim();
    if (nextName !== domain.name) {
      nameChanged = true;
      previousName = domain.name;
      data.name = nextName;
    }
  }

  if (body.description !== undefined) {
    if (body.description === null) {
      data.description = null;
    } else if (typeof body.description === "string") {
      data.description = body.description.trim() || null;
    } else {
      return jsonError("Description must be a string or null", 400);
    }
  }

  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") {
      return jsonError("archived must be a boolean", 400);
    }
    if (body.archived === false && domain.archivedAt !== null) {
      data.archivedAt = null;
      restored = true;
    } else if (body.archived === true && domain.archivedAt === null) {
      data.archivedAt = new Date();
      archivedViaPatch = true;
    }
  }

  if (Object.keys(data).length === 0) {
    return jsonOk({
      domain: {
        id: domain.id,
        name: domain.name,
        description: domain.description,
        color: domain.color,
        sortOrder: domain.sortOrder,
        archivedAt: domain.archivedAt,
        createdAt: domain.createdAt,
        updatedAt: domain.updatedAt,
      },
    });
  }

  const updated = await prisma.domain.update({
    where: { id: domain.id },
    data,
  });

  if (nameChanged) {
    await appendLifeEvent({
      userId: user.id,
      domainId: updated.id,
      type: "domain.renamed",
      summary: `Renamed domain ${previousName} → ${updated.name}`,
      payload: { previousName, name: updated.name },
    });
  }

  if (restored) {
    await appendLifeEvent({
      userId: user.id,
      domainId: updated.id,
      type: "domain.restored",
      summary: `Restored domain ${updated.name}`,
      payload: { name: updated.name },
    });
  }

  if (archivedViaPatch) {
    await appendLifeEvent({
      userId: user.id,
      domainId: updated.id,
      type: "domain.archived",
      summary: `Archived domain ${updated.name}`,
      payload: { name: updated.name },
    });
  }

  return jsonOk({
    domain: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      color: updated.color,
      sortOrder: updated.sortOrder,
      archivedAt: updated.archivedAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const { id } = await context.params;
  const domain = await findOwnedDomain(user.id, id);
  if (!domain) {
    return jsonError("Domain not found", 404);
  }

  if (domain.archivedAt) {
    return jsonOk({
      domain: {
        id: domain.id,
        name: domain.name,
        description: domain.description,
        color: domain.color,
        sortOrder: domain.sortOrder,
        archivedAt: domain.archivedAt,
        createdAt: domain.createdAt,
        updatedAt: domain.updatedAt,
      },
    });
  }

  const updated = await prisma.domain.update({
    where: { id: domain.id },
    data: { archivedAt: new Date() },
  });

  await appendLifeEvent({
    userId: user.id,
    domainId: updated.id,
    type: "domain.archived",
    summary: `Archived domain ${updated.name}`,
    payload: { name: updated.name },
  });

  return jsonOk({
    domain: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      color: updated.color,
      sortOrder: updated.sortOrder,
      archivedAt: updated.archivedAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
}
