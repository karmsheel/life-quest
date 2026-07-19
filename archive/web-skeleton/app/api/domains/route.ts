import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { ensureCanonicalDocuments } from "@/lib/domains.ts";
import { appendLifeEvent } from "@/lib/life-log-write.ts";
import { prisma } from "@/lib/prisma.ts";

function documentSummary(docs: { kind: string; status: string; bodyMarkdown: string }[]) {
  return docs.map((d) => ({
    kind: d.kind,
    status: d.status,
    bodyLength: d.bodyMarkdown.length,
  }));
}

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const domains = await prisma.domain.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: { sortOrder: "asc" },
    include: {
      documents: {
        select: { kind: true, status: true, bodyMarkdown: true },
      },
    },
  });

  return jsonOk({
    domains: domains.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      color: d.color,
      sortOrder: d.sortOrder,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      documents: documentSummary(d.documents),
    })),
  });
}

type CreateBody = {
  name?: unknown;
  description?: unknown;
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return jsonError("Name is required", 400);
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const maxSort = await prisma.domain.aggregate({
    where: { userId: user.id },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const domain = await prisma.domain.create({
    data: {
      userId: user.id,
      name,
      description,
      sortOrder,
    },
  });

  await ensureCanonicalDocuments(domain.id);

  await appendLifeEvent({
    userId: user.id,
    domainId: domain.id,
    type: "domain.created",
    summary: `Created domain ${domain.name}`,
    payload: { name: domain.name },
  });

  const documents = await prisma.domainDocument.findMany({
    where: { domainId: domain.id },
    select: { kind: true, status: true, bodyMarkdown: true },
  });

  return jsonOk(
    {
      domain: {
        id: domain.id,
        name: domain.name,
        description: domain.description,
        color: domain.color,
        sortOrder: domain.sortOrder,
        createdAt: domain.createdAt,
        updatedAt: domain.updatedAt,
        documents: documentSummary(documents),
      },
    },
    201,
  );
}
