import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import {
  createSessionToken,
  hashPassword,
  sessionCookieOptions,
  setSessionCookie,
} from "./auth.ts";
import {
  ACTIVE_DOMAIN_COOKIE,
  LOCAL_ACCOUNT_EMAIL,
  LOCAL_ACCOUNT_NAME,
} from "./constants.ts";
import { seedDomainsForUser } from "./domains.ts";
import { appendLifeEvent } from "./life-log-write.ts";
import { prisma } from "./prisma.ts";

/**
 * Find or create the single-machine local user (no password sign-in).
 * New users get the standard Domain seed pack.
 */
export async function ensureLocalUser() {
  const existing = await prisma.user.findUnique({
    where: { email: LOCAL_ACCOUNT_EMAIL },
  });
  if (existing) {
    return { user: existing, created: false as const };
  }

  // Unusable random password — local path never collects credentials.
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const user = await prisma.user.create({
    data: {
      email: LOCAL_ACCOUNT_EMAIL,
      name: LOCAL_ACCOUNT_NAME,
      passwordHash,
    },
  });

  const domains = await seedDomainsForUser(user.id);
  for (const domain of domains) {
    await appendLifeEvent({
      userId: user.id,
      domainId: domain.id,
      type: "domain.created",
      summary: `Created domain ${domain.name}`,
      payload: { name: domain.name },
    });
  }

  return { user, created: true as const, domains };
}

/** Ensure local user, set session + active domain cookies. */
export async function enterLocalAccount() {
  const { user, created, domains } = await ensureLocalUser();

  let activeDomainId: string | null = null;
  if (created && domains?.[0]) {
    activeDomainId = domains[0].id;
  } else {
    const first = await prisma.domain.findFirst({
      where: { userId: user.id, archivedAt: null },
      orderBy: { sortOrder: "asc" },
    });
    activeDomainId = first?.id ?? null;
  }

  if (activeDomainId) {
    const jar = await cookies();
    jar.set(ACTIVE_DOMAIN_COOKIE, activeDomainId, sessionCookieOptions());
  }

  const token = await createSessionToken(user.id);
  await setSessionCookie(token);

  return {
    user: { id: user.id, email: user.email, name: user.name },
    created,
  };
}
