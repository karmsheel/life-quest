import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { ACTIVE_DOMAIN_COOKIE } from "@/lib/constants.ts";
import { prisma } from "@/lib/prisma.ts";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const { id } = await context.params;
  const domain = await prisma.domain.findFirst({
    where: { id, userId: user.id, archivedAt: null },
  });

  if (!domain) {
    return jsonError("Domain not found", 404);
  }

  const jar = await cookies();
  jar.set(ACTIVE_DOMAIN_COOKIE, domain.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });

  return jsonOk({ activeDomainId: domain.id });
}
