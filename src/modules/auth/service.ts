import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/shared/errors/app-error";
import type { Auth } from "./factory";
import { parseRoleActivation, requireCanCreateActivity, type Principal } from "./policy";

export async function resolvePrincipal(auth: Auth, db: PrismaClient, headers: Headers): Promise<Principal> {
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!session) throw new AppError("UNAUTHENTICATED");
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: {
    id: true, name: true, email: true, emailVerified: true, status: true, roles: { select: { role: true } },
  } });
  if (!user) throw new AppError("UNAUTHENTICATED");
  return { ...user, roles: user.roles.map((entry) => entry.role) };
}

export async function grantNormalRole(db: PrismaClient, principal: Principal, input: unknown) {
  const { role } = parseRoleActivation(input);
  return db.$transaction(async (tx) => {
    // Future status transitions must lock the same user row.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${principal.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: principal.id } });
    if (!user) throw new AppError("UNAUTHENTICATED");
    requireCanCreateActivity({ ...principal, status: user.status });
    await tx.userRole.upsert({ where: { userId_role: { userId: user.id, role } },
      create: { userId: user.id, role, grantedBy: user.id }, update: {} });
    return { role };
  });
}
