import { jsonError, jsonOk } from "@/lib/api.ts";
import {
  createSessionToken,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth.ts";
import { prisma } from "@/lib/prisma.ts";

type SignInBody = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  let body: SignInBody;
  try {
    body = (await request.json()) as SignInBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return jsonError("Email and password are required", 400);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return jsonError("Invalid email or password", 401);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return jsonError("Invalid email or password", 401);
  }

  const token = await createSessionToken(user.id);
  await setSessionCookie(token);

  return jsonOk({
    user: { id: user.id, email: user.email, name: user.name },
  });
}
