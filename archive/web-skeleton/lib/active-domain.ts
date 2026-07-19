import { cookies } from "next/headers";
import { ACTIVE_DOMAIN_COOKIE } from "./constants.ts";
import { prisma } from "./prisma.ts";

/** Load a non-archived domain owned by the user, or null. */
export async function resolveDomainForUser(userId: string, domainId: string) {
  return prisma.domain.findFirst({
    where: { id: domainId, userId, archivedAt: null },
  });
}

/**
 * Resolve the user's active domain id from cookie (validated ownership),
 * falling back to the first non-archived domain by sortOrder.
 */
export async function resolveActiveDomainId(
  userId: string,
): Promise<string | null> {
  const domains = await prisma.domain.findMany({
    where: { userId, archivedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  const jar = await cookies();
  const cookieDomainId = jar.get(ACTIVE_DOMAIN_COOKIE)?.value ?? null;

  if (cookieDomainId && domains.some((d) => d.id === cookieDomainId)) {
    return cookieDomainId;
  }

  return domains[0]?.id ?? null;
}
