import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Principal, Role } from "./policy";
import { AppError } from "@/shared/errors/app-error";

// Public identity guard for module transactions. Lock order: User, then Company.
// Role/status updates must serialize on this User row too.
export async function currentActor(tx: Prisma.TransactionClient, actor: Principal, role: Role, mutation = false, lock = false) {
  if (lock) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: {
    id: true, name: true, status: true, roles: { select: { role: true } },
  } });
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (!user.roles.some((entry) => entry.role === role)) throw new AppError("FORBIDDEN");
  if (mutation && user.status !== "ACTIVE") throw new AppError("FORBIDDEN");
  return user;
}
