import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { ACTIVE_DOMAIN_COOKIE } from "@/lib/constants.ts";
import { prisma } from "@/lib/prisma.ts";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const domains = await prisma.domain.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      color: true,
      sortOrder: true,
    },
  });

  const jar = await cookies();
  const cookieDomainId = jar.get(ACTIVE_DOMAIN_COOKIE)?.value ?? null;

  let activeDomainId: string | null = null;
  if (cookieDomainId && domains.some((d) => d.id === cookieDomainId)) {
    activeDomainId = cookieDomainId;
  } else if (domains[0]) {
    activeDomainId = domains[0].id;
  }

  return jsonOk({
    user: { id: user.id, email: user.email, name: user.name },
    activeDomainId,
    domains,
  });
}
