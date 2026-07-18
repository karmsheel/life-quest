import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api.ts";
import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth.ts";
import {
  ACTIVE_DOMAIN_COOKIE,
  isLocalAccountEmail,
} from "@/lib/constants.ts";
import { seedDomainsForUser } from "@/lib/domains.ts";
import { appendLifeEvent } from "@/lib/life-log-write.ts";
import { prisma } from "@/lib/prisma.ts";

type SignUpBody = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  let body: SignUpBody;
  try {
    body = (await request.json()) as SignUpBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : null;

  if (!email || !isValidEmail(email)) {
    return jsonError("Valid email is required", 400);
  }
  if (isLocalAccountEmail(email)) {
    return jsonError(
      "That address is reserved for the local account. Use Continue with local account.",
      400,
    );
  }
  if (password.length < 8) {
    return jsonError("Password must be at least 8 characters", 400);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return jsonError("Email already registered", 409);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, name },
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

  const firstDomain = domains[0];
  if (firstDomain) {
    const jar = await cookies();
    jar.set(ACTIVE_DOMAIN_COOKIE, firstDomain.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  const token = await createSessionToken(user.id);
  await setSessionCookie(token);

  return jsonOk({
    user: { id: user.id, email: user.email, name: user.name },
  });
}
